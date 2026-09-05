#!/usr/bin/env python3
"""End-to-end regression tests for conservative DOCX beautification."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from test_docx_inspect import run_cli, write_docx

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def zip_parts(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        return {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}


def style_by_id(styles: ET.Element, style_id: str) -> ET.Element:
    for style in styles.findall(W + "style"):
        if style.get(W + "styleId") == style_id:
            return style
    raise AssertionError(f"style not found: {style_id}")


def val(parent: ET.Element, path: str) -> str | None:
    node = parent.find(path)
    return node.get(W + "val") if node is not None else None


def rewrite_part(source: Path, target: Path, part: str, replacement: bytes) -> None:
    with zipfile.ZipFile(source) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist() if not info.is_dir()]
    with zipfile.ZipFile(target, "w") as archive:
        for info, content in entries:
            archive.writestr(info, replacement if info.filename == part else content)


def relocate_styles(source: Path, target: Path) -> str:
    relocated_part = "word/custom/styles-main.xml"
    with zipfile.ZipFile(source) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist() if not info.is_dir()]
    with zipfile.ZipFile(target, "w") as archive:
        for info, content in entries:
            if info.filename == "word/styles.xml":
                archive.writestr(relocated_part, content)
                continue
            if info.filename == "word/_rels/document.xml.rels":
                content = content.replace(b'Target="styles.xml"', b'Target="custom/styles-main.xml"')
            elif info.filename == "[Content_Types].xml":
                content = content.replace(b'PartName="/word/styles.xml"', b'PartName="/word/custom/styles-main.xml"')
            archive.writestr(info, content)
    return relocated_part


def test_help() -> None:
    result = run_cli("docx", "--help")
    assert result.returncode == 0, result.stderr
    assert "docx beautify <input.docx>" in result.stdout
    assert "docx validate <output.docx> --against <input.docx>" in result.stdout
    assert "styles-only" in result.stdout


def test_dry_run(directory: Path) -> None:
    source = directory / "source.docx"
    write_docx(source)
    before = source.stat()
    before_hash = digest(source)

    result = run_cli("docx", "beautify", str(source), "--preset", "professional-zh", "--dry-run", "--json")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["schema_version"] == "1"
    assert report["operation"] == "beautify"
    assert report["status"] == "DRY_RUN"
    assert report["policy"]["preset"] == "professional-zh"
    assert report["policy"]["mode"] == "conservative"
    assert report["output"] is None
    assert report["planned_changed_parts"] == ["word/styles.xml"]
    assert report["changed_parts"] == []
    mappings = {entry["role"]: entry for entry in report["styles"]["mappings"]}
    assert mappings["normal"]["style_id"] == "Normal"
    assert mappings["normal"]["used_count"] == 5
    assert mappings["title"]["style_id"] == "Title"
    assert mappings["heading1"]["style_id"] == "Heading1"
    assert mappings["table"]["style_id"] == "TableGrid"
    assert report["coverage"]["paragraphs_total"] == 7
    assert report["coverage"]["paragraphs_style_mapped"] == 7
    assert report["coverage"]["paragraphs_with_direct_visual_overrides"] == 1
    assert report["coverage"]["runs_with_direct_visual_overrides"] == 1
    assert report["coverage"]["estimated_effective_paragraphs"] == 6
    assert any("direct formatting" in warning for warning in report["warnings"])

    after = source.stat()
    assert digest(source) == before_hash
    assert after.st_size == before.st_size
    assert after.st_mtime_ns == before.st_mtime_ns
    assert list(directory.glob("*.tmp*")) == []


def test_style_name_wins_over_numeric_style_id(directory: Path) -> None:
    base = directory / "numeric-style-base.docx"
    source = directory / "numeric-style.docx"
    write_docx(base)
    styles = zip_parts(base)["word/styles.xml"]
    marker = b'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
    competing_styles = marker + (
        b'<w:style w:type="paragraph" w:styleId="2"><w:name w:val="List Number 2"/></w:style>'
        b'<w:style w:type="paragraph" w:styleId="21"><w:name w:val="heading 2"/></w:style>'
    )
    assert marker in styles
    rewrite_part(base, source, "word/styles.xml", styles.replace(marker, competing_styles))

    result = run_cli("docx", "beautify", str(source), "--dry-run", "--json")
    assert result.returncode == 0, result.stderr
    mappings = {entry["role"]: entry for entry in json.loads(result.stdout)["styles"]["mappings"]}
    assert mappings["heading2"]["style_id"] == "21"
    assert mappings["heading2"]["style_name"] == "heading 2"
    assert mappings["heading2"]["matched_by"] == "style-name"


def test_relationship_resolved_styles_part(directory: Path) -> None:
    base = directory / "relocated-base.docx"
    source = directory / "relocated-source.docx"
    output = directory / "relocated-output.docx"
    write_docx(base)
    styles_part = relocate_styles(base, source)

    result = run_cli(
        "docx", "beautify", str(source), "--output", str(output),
        "--preset", "professional-zh", "--json",
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["planned_changed_parts"] == [styles_part]
    assert report["changed_parts"] == [styles_part]

    original_parts = zip_parts(source)
    output_parts = zip_parts(output)
    assert set(original_parts) == set(output_parts)
    assert styles_part in original_parts
    assert "word/styles.xml" not in original_parts
    assert original_parts[styles_part] != output_parts[styles_part]
    for name, content in original_parts.items():
        if name != styles_part:
            assert output_parts[name] == content, f"unexpected changed part: {name}"

    validated = run_cli("docx", "validate", str(output), "--against", str(source), "--json")
    assert validated.returncode == 0, validated.stderr
    assert json.loads(validated.stdout)["changed_parts"] == [styles_part]


def test_beautify_and_validate(directory: Path) -> None:
    source = directory / "source-write.docx"
    output = directory / "polished.docx"
    write_docx(source)
    source_before = digest(source)

    result = run_cli(
        "docx", "beautify", str(source), "--output", str(output),
        "--preset", "professional-zh", "--json",
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "STATIC_PASS"
    assert report["output"]["path"] == str(output.resolve())
    assert report["output"]["sha256"] == digest(output)
    assert report["planned_changed_parts"] == ["word/styles.xml"]
    assert report["changed_parts"] == ["word/styles.xml"]
    assert report["visual_validation"] == "not_run"
    assert report["invariants"] == {
        "part_set": "unchanged",
        "non_style_parts": "byte-identical",
        "document_xml": "byte-identical",
        "relationships": "byte-identical",
        "text": "unchanged",
        "media": "unchanged",
        "comments_and_revisions": "unchanged",
    }
    assert digest(source) == source_before

    original_parts = zip_parts(source)
    output_parts = zip_parts(output)
    assert set(original_parts) == set(output_parts)
    assert original_parts["word/styles.xml"] != output_parts["word/styles.xml"]
    for name, content in original_parts.items():
        if name != "word/styles.xml":
            assert output_parts[name] == content, f"unexpected changed part: {name}"

    styles = ET.fromstring(output_parts["word/styles.xml"])
    defaults = styles.find(".//" + W + "rPrDefault/" + W + "rPr")
    assert defaults is not None
    fonts = defaults.find(W + "rFonts")
    assert fonts is not None
    assert fonts.get(W + "ascii") == "Aptos"
    assert fonts.get(W + "hAnsi") == "Aptos"
    assert fonts.get(W + "eastAsia") == "Microsoft YaHei"
    assert fonts.get(W + "asciiTheme") is None
    assert val(defaults, W + "sz") == "21"

    heading = style_by_id(styles, "Heading1")
    assert val(heading, W + "rPr/" + W + "sz") == "36"
    assert val(heading, W + "rPr/" + W + "color") == "17365D"
    assert heading.find(W + "rPr/" + W + "b") is not None
    assert val(heading, W + "pPr/" + W + "outlineLvl") == "0"

    table = style_by_id(styles, "TableGrid")
    first_row = next(
        node for node in table.findall(W + "tblStylePr") if node.get(W + "type") == "firstRow"
    )
    shading = first_row.find(W + "tcPr/" + W + "shd")
    assert shading is not None
    assert shading.get(W + "fill") == "D9EAF7"

    validated = run_cli("docx", "validate", str(output), "--against", str(source), "--json")
    assert validated.returncode == 0, validated.stderr
    validation = json.loads(validated.stdout)
    assert validation["operation"] == "validate"
    assert validation["status"] == "STATIC_PASS"
    assert validation["changed_parts"] == ["word/styles.xml"]

    blocked = run_cli("docx", "beautify", str(source), "--output", str(output), "--json")
    assert blocked.returncode != 0
    assert "already exists" in blocked.stderr
    output_before_force = digest(output)

    forced = run_cli("docx", "beautify", str(source), "--output", str(output), "--force", "--json")
    assert forced.returncode == 0, forced.stderr
    assert digest(output) == output_before_force
    assert not any(path.name.startswith(".polished.docx") for path in directory.iterdir())

    same_path = run_cli("docx", "beautify", str(source), "--output", str(source), "--force")
    assert same_path.returncode != 0
    assert "output path must differ from input" in same_path.stderr
    assert digest(source) == source_before

    hardlink = directory / "source-hardlink.docx"
    os.link(source, hardlink)
    same_inode = run_cli("docx", "beautify", str(source), "--output", str(hardlink), "--force")
    assert same_inode.returncode != 0
    assert "output path must differ from input" in same_inode.stderr
    assert digest(source) == source_before


def test_custom_spec_and_validation_failure(directory: Path) -> None:
    source = directory / "source-custom.docx"
    output = directory / "custom.docx"
    write_docx(source)
    spec = directory / "style.json"
    spec.write_text(
        json.dumps({
            "schema_version": "1",
            "id": "custom-test",
            "fonts": {"latin": "Arial", "east_asia": "SimSun"},
            "styles": {
                "normal": {
                    "size_pt": 12,
                    "color": "112233",
                    "line_spacing": 1.2,
                    "space_after_pt": 4
                },
                "heading1": {
                    "size_pt": 20,
                    "color": "445566",
                    "bold": True,
                    "keep_next": True,
                    "outline_level": 0
                }
            }
        }),
        encoding="utf-8",
    )
    result = run_cli(
        "docx", "beautify", str(source), "--output", str(output),
        "--style-spec", str(spec), "--json",
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["policy"]["preset"] == "custom-test"
    styles = ET.fromstring(zip_parts(output)["word/styles.xml"])
    defaults = styles.find(".//" + W + "rPrDefault/" + W + "rPr")
    assert defaults is not None
    fonts = defaults.find(W + "rFonts")
    assert fonts is not None
    assert fonts.get(W + "ascii") == "Arial"
    assert fonts.get(W + "eastAsia") == "SimSun"
    assert val(defaults, W + "sz") == "24"

    invalid_spec = directory / "invalid-style.json"
    invalid_spec.write_text(
        json.dumps({
            "schema_version": "1",
            "id": "unsafe",
            "fonts": {"latin": "Arial", "east_asia": "SimSun"},
            "styles": {"normal": {"size_pt": 12}},
            "xml": "<w:evil/>"
        }),
        encoding="utf-8",
    )
    invalid_output = directory / "invalid.docx"
    rejected = run_cli(
        "docx", "beautify", str(source), "--output", str(invalid_output),
        "--style-spec", str(invalid_spec), "--json",
    )
    assert rejected.returncode != 0
    assert "unknown style spec field" in rejected.stderr
    assert not invalid_output.exists()

    tampered = directory / "tampered.docx"
    original_document = zip_parts(output)["word/document.xml"]
    rewrite_part(output, tampered, "word/document.xml", original_document.replace("正文内容".encode(), "篡改内容".encode()))
    failed = run_cli("docx", "validate", str(tampered), "--against", str(source), "--json")
    assert failed.returncode != 0
    assert "DOCX invariant failed" in failed.stderr


def main() -> None:
    test_help()
    with tempfile.TemporaryDirectory(prefix="aidlc-docx-beautify-") as temp:
        directory = Path(temp)
        test_dry_run(directory)
        test_style_name_wins_over_numeric_style_id(directory)
        test_relationship_resolved_styles_part(directory)
        test_beautify_and_validate(directory)
        test_custom_spec_and_validation_failure(directory)
    print("DOCX beautify CLI tests passed")


if __name__ == "__main__":
    main()
