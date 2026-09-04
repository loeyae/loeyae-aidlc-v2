#!/usr/bin/env python3
"""End-to-end regression tests for the loeyae-aidlc export command."""

from __future__ import annotations

import os
import shutil
import struct
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "bin" / "cli.js"


def run_cli(*arguments: str, timeout: int = 240) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(CLI), *arguments],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def browser_available() -> bool:
    configured = os.environ.get("AIDLC_CHROME_BIN") or os.environ.get("CHROME_BIN")
    if configured:
        return Path(configured).is_file() or shutil.which(configured) is not None
    names = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "msedge")
    if any(shutil.which(name) for name in names):
        return True
    candidates = (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    )
    return any(Path(candidate).is_file() for candidate in candidates)


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data.startswith(b"\x89PNG\r\n\x1a\n"), "missing PNG signature"
    return struct.unpack(">II", data[16:24])


def assert_docx(path: Path) -> tuple[str, set[str]]:
    data = path.read_bytes()
    assert data.startswith(b"PK"), "missing DOCX ZIP signature"
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        for required in ("[Content_Types].xml", "word/document.xml", "word/styles.xml"):
            assert required in names, f"missing DOCX member: {required}"
        document_xml = archive.read("word/document.xml").decode("utf-8")
    return document_xml, names


def write_fixtures(directory: Path) -> tuple[Path, Path]:
    svg = directory / "diagram.svg"
    svg.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">
<rect x="2" y="2" width="116" height="56" rx="8" fill="#ffffff" stroke="#111827" stroke-width="2"/>
<path d="M20 30 H95" stroke="#2563eb" stroke-width="3"/>
<polygon points="105,30 94,24 94,36" fill="#2563eb"/>
<text x="60" y="22" text-anchor="middle" font-size="12">导出测试</text>
</svg>\n""",
        encoding="utf-8",
    )
    markdown = directory / "document.md"
    markdown.write_text(
        """# 导出能力测试

<!-- 该注释不得进入对外文档 -->

## 原生格式

正文包含 **粗体**、`行内代码`、~~删除线~~和[官网](https://example.com)。

> 这是引用内容。

- 第一项
- 第二项

| 编号 | 功能 | 说明 |
|---|---|---|
| 1 | DOCX | 保留表格样式 |
| 2 | PNG | 保留图表清晰度 |

![架构图](diagram.svg)

```text
const exported = true;
```

## 内部备注

该段内容不应导出。
""",
        encoding="utf-8",
    )
    return svg, markdown


def test_help() -> None:
    result = run_cli("help")
    assert result.returncode == 0, result.stderr
    assert "export <md|svg>" in result.stdout
    export_help = run_cli("export", "--help")
    assert export_help.returncode == 0, export_help.stderr
    assert "export md <input.md> --to <docx|pdf>" in export_help.stdout
    assert "never downloads remote images" in export_help.stdout


def test_svg_png(directory: Path, svg: Path) -> None:
    png = directory / "diagram.png"
    result = run_cli("export", "svg", str(svg), "--to", "png", "--output", str(png), "--scale", "2")
    assert result.returncode == 0, result.stderr
    assert png_dimensions(png) == (240, 120)

    original = png.read_bytes()
    blocked = run_cli("export", "svg", str(svg), "--to", "png", "--output", str(png))
    assert blocked.returncode != 0
    assert "already exists" in blocked.stderr
    assert png.read_bytes() == original

    forced = run_cli("export", "svg", str(svg), "--to", "png", "--output", str(png), "--width", "300", "--force")
    assert forced.returncode == 0, forced.stderr
    assert png_dimensions(png) == (300, 150)

    unsafe_svg = directory / "unsafe.svg"
    unsafe_svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><image href="https://example.com/a.png"/></svg>',
        encoding="utf-8",
    )
    unsafe_png = directory / "unsafe.png"
    rejected = run_cli("export", "svg", str(unsafe_svg), "--to", "png", "--output", str(unsafe_png))
    assert rejected.returncode != 0
    assert "external resource reference" in rejected.stderr
    assert not unsafe_png.exists()


def test_markdown_docx(directory: Path, markdown: Path) -> None:
    docx = directory / "document.docx"
    result = run_cli(
        "export", "md", str(markdown), "--to", "docx", "--output", str(docx),
        "--strip", "内部备注", "--toc",
    )
    assert result.returncode == 0, result.stderr
    document_xml, names = assert_docx(docx)
    for expected in ("导出能力测试", "目录", "原生格式", "粗体", "行内代码", "DOCX"):
        assert expected in document_xml, f"missing DOCX text: {expected}"
    for forbidden in ("内部备注", "该段内容不应导出", "该注释不得进入对外文档"):
        assert forbidden not in document_xml, f"unexpected DOCX text: {forbidden}"
    assert "<w:tbl>" in document_xml
    assert "<w:drawing>" in document_xml
    assert any(name.startswith("word/media/") and name.endswith(".png") for name in names)

    templated = directory / "templated.docx"
    template_result = run_cli(
        "export", "md", str(markdown), "--to", "docx", "--output", str(templated),
        "--strip", "内部备注", "--template", str(docx),
    )
    assert template_result.returncode == 0, template_result.stderr
    assert_docx(templated)

    remote_md = directory / "remote.md"
    remote_md.write_text("# Remote\n\n![remote](https://example.com/image.png)\n", encoding="utf-8")
    remote_docx = directory / "remote.docx"
    rejected = run_cli("export", "md", str(remote_md), "--to", "docx", "--output", str(remote_docx))
    assert rejected.returncode != 0
    assert "remote and data image resources are not allowed" in rejected.stderr
    assert not remote_docx.exists()


def test_markdown_pdf(directory: Path, markdown: Path) -> None:
    pdf = directory / "document.pdf"
    result = run_cli(
        "export", "md", str(markdown), "--to", "pdf", "--output", str(pdf),
        "--strip", "内部备注", "--toc",
    )
    if not browser_available():
        assert result.returncode != 0
        assert "requires Chrome, Chromium, or Edge" in result.stderr or "configured browser executable not found" in result.stderr
        assert not pdf.exists()
        return
    assert result.returncode == 0, result.stderr
    data = pdf.read_bytes()
    assert data.startswith(b"%PDF-")
    assert b"%%EOF" in data[-2048:]


def test_mermaid_fail_closed(directory: Path) -> None:
    valid_md = directory / "mermaid.md"
    valid_md.write_text(
        """# Mermaid

```mermaid
flowchart TD
  A[开始] --> B[结束]
```
""",
        encoding="utf-8",
    )
    valid_docx = directory / "mermaid.docx"
    valid = run_cli("export", "md", str(valid_md), "--to", "docx", "--output", str(valid_docx))
    if not browser_available():
        assert valid.returncode != 0
        assert "requires Chrome, Chromium, or Edge" in valid.stderr
        assert not valid_docx.exists()
        return
    assert valid.returncode == 0, valid.stderr
    _, names = assert_docx(valid_docx)
    assert any(name.startswith("word/media/") and name.endswith(".png") for name in names)

    invalid_md = directory / "invalid-mermaid.md"
    invalid_md.write_text("# Invalid\n\n```mermaid\nflowchart TD\n  A -->\n```\n", encoding="utf-8")
    invalid_docx = directory / "invalid-mermaid.docx"
    invalid = run_cli("export", "md", str(invalid_md), "--to", "docx", "--output", str(invalid_docx))
    assert invalid.returncode != 0
    assert "Mermaid diagram 1 failed" in invalid.stderr
    assert not invalid_docx.exists()


def main() -> None:
    test_help()
    with tempfile.TemporaryDirectory(prefix="aidlc-export-test-") as temp:
        directory = Path(temp)
        svg, markdown = write_fixtures(directory)
        test_svg_png(directory, svg)
        test_markdown_docx(directory, markdown)
        test_markdown_pdf(directory, markdown)
        test_mermaid_fail_closed(directory)
    print("Document export CLI tests passed")


if __name__ == "__main__":
    main()
