#!/usr/bin/env python3
"""End-to-end regression tests for the read-only DOCX inspector."""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "cli.js"


def run_cli(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(CLI), *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


def write_docx(path: Path, *, traversal: bool = False, macro: bool = False, signed: bool = False) -> None:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""
    document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>季度报告</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>执行摘要</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:color w:val="AA0000"/><w:sz w:val="24"/></w:rPr><w:t>正文内容</w:t></w:r><w:hyperlink r:id="rIdHyper"><w:r><w:t>外部链接</w:t></w:r></w:hyperlink><w:fldSimple w:instr="PAGE"/><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:ins w:id="1" w:author="Reviewer"><w:r><w:t>新增内容</w:t></w:r></w:ins><w:del w:id="2" w:author="Reviewer"><w:r><w:delText>删除内容</w:delText></w:r></w:del></w:p>
    <w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:sdt><w:sdtContent><w:p><w:r><w:drawing/><w:t>受控内容</w:t></w:r></w:p></w:sdtContent></w:sdt>
    <w:sectPr/>
  </w:body>
</w:document>"""
    styles = """<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei" w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>"""
    document_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHyper" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/report" TargetMode="External"/>
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>"""
    theme = """<?xml version="1.0" encoding="UTF-8"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture Theme">
  <a:themeElements><a:fontScheme name="Fixture Fonts">
    <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hans" typeface="Microsoft YaHei"/></a:majorFont>
    <a:minorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hans" typeface="DengXian"/></a:minorFont>
  </a:fontScheme></a:themeElements>
</a:theme>"""
    comments = """<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Reviewer"><w:p><w:r><w:t>请核对</w:t></w:r></w:p></w:comment></w:comments>"""
    footnotes = """<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1"/><w:footnote w:id="1"><w:p><w:r><w:t>脚注</w:t></w:r></w:p></w:footnote></w:footnotes>"""
    numbering = """<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"/><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"""
    core = """<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>季度报告</dc:title><dc:creator>Loeyae</dc:creator><cp:lastModifiedBy>Reviewer</cp:lastModifiedBy><dcterms:created>2026-09-05T00:00:00Z</dcterms:created></cp:coreProperties>"""
    app = """<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Loeyae Test</Application><Pages>2</Pages><Words>12</Words><Characters>48</Characters></Properties>"""

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/theme/theme1.xml", theme)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
        archive.writestr("word/comments.xml", comments)
        archive.writestr("word/footnotes.xml", footnotes)
        archive.writestr("word/numbering.xml", numbering)
        archive.writestr("word/media/image1.png", b"\x89PNG\r\n\x1a\nfixture")
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        if traversal:
            archive.writestr("../outside.xml", "unsafe")
        if macro:
            archive.writestr("word/vbaProject.bin", b"macro")
        if signed:
            archive.writestr("_xmlsignatures/sig1.xml", "<Signature/>")


def test_help() -> None:
    result = run_cli("docx", "--help")
    assert result.returncode == 0, result.stderr
    assert "docx inspect <input.docx>" in result.stdout
    assert "read-only" in result.stdout.lower()


def test_inspect(directory: Path) -> None:
    source = directory / "report.docx"
    write_docx(source)
    before = source.stat()
    before_digest = hashlib.sha256(source.read_bytes()).hexdigest()

    result = run_cli("docx", "inspect", str(source), "--json")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["schema_version"] == "1"
    assert report["input"]["path"] == str(source.resolve())
    assert report["input"]["sha256"] == before_digest
    assert report["package"]["has_macros"] is False
    assert report["package"]["has_digital_signatures"] is False
    assert report["package"]["external_relationships"] == 1
    assert report["document"]["paragraphs"] == 7
    assert report["document"]["tables"] == 1
    assert report["document"]["table_rows"] == 1
    assert report["document"]["table_cells"] == 2
    assert report["document"]["media_files"] == 1
    assert report["document"]["comments"] == 1
    assert report["document"]["footnotes"] == 1
    assert report["document"]["tracked_insertions"] == 1
    assert report["document"]["tracked_deletions"] == 1
    assert report["document"]["content_controls"] == 1
    assert report["styles"]["defined"] == 5
    assert report["styles"]["by_type"] == {"character": 1, "paragraph": 3, "table": 1}
    assert report["styles"]["used_ids"] == ["Heading1", "TableGrid", "Title"]
    assert report["styles"]["default_fonts"]["eastAsia"] == "Microsoft YaHei"
    assert report["styles"]["default_font_refs"] == {
        "asciiTheme": "minorHAnsi",
        "eastAsiaTheme": "minorEastAsia",
        "hAnsiTheme": "minorHAnsi",
    }
    assert report["styles"]["theme_fonts"]["major_latin"] == "Calibri"
    assert report["styles"]["theme_fonts"]["minor_latin"] == "Cambria"
    assert report["styles"]["theme_fonts"]["major_east_asia"] == ""
    assert report["styles"]["theme_fonts"]["minor_script_Hans"] == "DengXian"
    assert report["metadata"]["title"] == "季度报告"
    assert report["metadata"]["creator"] == "Loeyae"
    assert report["metadata"]["pages"] == 2

    after = source.stat()
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before_digest
    assert after.st_mtime_ns == before.st_mtime_ns
    assert after.st_size == before.st_size

    human = run_cli("docx", "inspect", str(source))
    assert human.returncode == 0, human.stderr
    assert "DOCX inspection" in human.stdout
    assert "Paragraphs: 7" in human.stdout
    assert "Tracked changes: 2" in human.stdout


def test_exported_docx(directory: Path) -> None:
    markdown = directory / "generated.md"
    markdown.write_text("# 自动生成文档\n\n## 概览\n\n这是导出器生成的 DOCX。\n", encoding="utf-8")
    exported = directory / "generated.docx"
    result = run_cli("export", "md", str(markdown), "--to", "docx", "--output", str(exported))
    assert result.returncode == 0, result.stderr

    inspected = run_cli("docx", "inspect", str(exported), "--json")
    assert inspected.returncode == 0, inspected.stderr
    report = json.loads(inspected.stdout)
    assert report["document"]["paragraphs"] >= 3
    assert report["styles"]["defined"] > 0
    assert report["package"]["has_macros"] is False
    assert report["package"]["has_digital_signatures"] is False


def test_fail_closed(directory: Path) -> None:
    traversal = directory / "traversal.docx"
    write_docx(traversal, traversal=True)
    result = run_cli("docx", "inspect", str(traversal), "--json")
    assert result.returncode != 0
    assert "unsafe ZIP entry path" in result.stderr

    macro = directory / "macro.docx"
    write_docx(macro, macro=True)
    result = run_cli("docx", "inspect", str(macro), "--json")
    assert result.returncode != 0
    assert "macro-enabled content" in result.stderr

    signed = directory / "signed.docx"
    write_docx(signed, signed=True)
    result = run_cli("docx", "inspect", str(signed), "--json")
    assert result.returncode != 0
    assert "digital signatures" in result.stderr

    text = directory / "not-docx.txt"
    text.write_text("not a document", encoding="utf-8")
    result = run_cli("docx", "inspect", str(text))
    assert result.returncode != 0
    assert "input must end with .docx" in result.stderr


def main() -> None:
    test_help()
    with tempfile.TemporaryDirectory(prefix="aidlc-docx-inspect-") as temp:
        directory = Path(temp)
        test_inspect(directory)
        test_exported_docx(directory)
        test_fail_closed(directory)
    print("DOCX inspect CLI tests passed")


if __name__ == "__main__":
    main()
