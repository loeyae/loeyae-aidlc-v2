#!/usr/bin/env python3
"""Regression checks for document diagram format routing and Mermaid rendering."""

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "core" / "knowledge" / "protocols" / "core-workflow.md"
DESIGN_STANDARD = ROOT / "core" / "knowledge" / "design" / "common-diagram-design-standards.md"
MERMAID_STANDARD = ROOT / "core" / "knowledge" / "design" / "common-mermaid-diagram-standards.md"
CONTENT_VALIDATION = ROOT / "core" / "knowledge" / "standards" / "common-content-validation.md"
SVG_CAPABILITY = ROOT / "core" / "skills" / "aidlc-diagram-design" / "SKILL.md"
REQUIREMENTS_STAGE = ROOT / "core" / "stages" / "inception" / "inception-requirements-analysis.md"

MERMAID_TEST_MARKDOWN = """# Mermaid 回流边路由测试

```mermaid
flowchart LR
    Start["开始"] --> ReviewEntry["审核入口"]
    ReviewEntry --> Retry["准备重试"]
    Retry mbBack@-->|"重新检查"| ReviewEntry
    mbBack@{ curve: stepBefore }
```
"""


def require(text: str, *phrases: str) -> None:
    for phrase in phrases:
        assert phrase in text, f"missing document diagram policy: {phrase}"


def test_mermaid_edge_id_and_direct_png() -> None:
    start = MERMAID_TEST_MARKDOWN.index("```mermaid") + len("```mermaid")
    end = MERMAID_TEST_MARKDOWN.index("```", start)
    source = MERMAID_TEST_MARKDOWN[start:end].strip()
    assert 'Retry mbBack@-->|"重新检查"| ReviewEntry' in source
    assert "mbBack@{ curve: stepBefore }" in source
    assert source.count("mbBack@") == 2

    mmdc = shutil.which("mmdc")
    if not mmdc:
        print("Mermaid direct render: UNVERIFIED (mmdc unavailable)")
        return

    scratch_root = Path(os.environ.get("KIROCREW_SCRATCH", tempfile.gettempdir()))
    scratch_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aidlc-mermaid-routing-", dir=scratch_root) as temp:
        directory = Path(temp)
        source_file = directory / "source.mmd"
        source_file.write_text(source + "\n", encoding="utf-8")

        def render(output: Path, input_file: Path) -> None:
            result = subprocess.run(
                [mmdc, "-i", str(input_file), "-o", str(output), "--quiet"],
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stderr or result.stdout

        step_svg = directory / "step-before.svg"
        render(step_svg, source_file)
        step_text = step_svg.read_text(encoding="utf-8")
        step_tag = re.search(r'<path[^>]*data-id="mbBack"[^>]*>', step_text)
        assert step_tag, "rendered SVG must preserve the stable mbBack edge ID"
        step_path = re.search(r'\bd="([^"]+)"', step_tag.group(0))
        assert step_path, "rendered mbBack edge must contain a path"

        path_points = [
            (float(x), float(y))
            for x, y in re.findall(r'[ML]\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)', step_path.group(1))
        ]
        assert len(path_points) >= 2, "rendered edge must contain at least two SVG path points"
        previous, endpoint = path_points[-2], path_points[-1]
        assert abs(previous[1] - endpoint[1]) < 0.01, "回流箭头末段必须水平进入审核入口"
        assert endpoint[0] < previous[0], "回流箭头必须向左进入审核入口右侧"
        assert 'marker-end="url(#my-svg_flowchart-v2-pointEnd)"' in step_tag.group(0)
        assert re.search(r'<marker id="[^"]+pointEnd"[^>]*>.*?<path d="M 0 0 L 10 5 L 0 10 z"', step_text, re.S)
        review_node = re.search(
            r'<g class="node [^"]*" id="[^"]*flowchart-ReviewEntry-[^"]*"[^>]*transform="translate\(([-\d.]+),\s*([-\d.]+)\)"[^>]*>(.*?)</g></g>',
            step_text,
            re.S,
        )
        assert review_node, "rendered SVG must expose the ReviewEntry rectangle"
        review_rect = re.search(
            r'<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([-\d.]+)"[^>]*height="([-\d.]+)"',
            review_node.group(3),
        )
        assert review_rect, "ReviewEntry must have a measurable rectangle"
        tx, ty, x, y, width, height = (*map(float, review_node.group(1, 2)), *map(float, review_rect.groups()))
        left, right = tx + x, tx + x + width
        top, bottom = ty + y, ty + y + height
        assert 0 <= endpoint[0] - right <= 5.0, "arrow tip must touch the target right boundary without entering the node"
        assert top <= endpoint[1] <= bottom, "arrow tip must be centered within the target right face"

        linear_file = directory / "linear.mmd"
        linear_file.write_text(source.replace("stepBefore", "linear") + "\n", encoding="utf-8")
        linear_svg = directory / "linear.svg"
        render(linear_svg, linear_file)
        linear_text = linear_svg.read_text(encoding="utf-8")
        linear_tag = re.search(r'<path[^>]*data-id="mbBack"[^>]*>', linear_text)
        assert linear_tag, "linear render must preserve the same stable edge ID"
        linear_path = re.search(r'\bd="([^"]+)"', linear_tag.group(0))
        assert linear_path, "linear mbBack edge must contain a path"
        assert step_path.group(1) != linear_path.group(1), "edge-level curve must affect the rendered path"

        png = directory / "step-before.png"
        render(png, source_file)
        png_data = png.read_bytes()
        assert png_data[:8] == b"\x89PNG\r\n\x1a\n", "direct Mermaid render must produce PNG"
        assert int.from_bytes(png_data[16:20], "big") > 0
        assert int.from_bytes(png_data[20:24], "big") > 0
        print("Mermaid direct render: PASS (PNG generated; edge mbBack; curve stepBefore; target-normal arrow verified)")


def main() -> None:
    workflow = WORKFLOW.read_text()
    design = DESIGN_STANDARD.read_text()
    mermaid = MERMAID_STANDARD.read_text()
    validation = CONTENT_VALIDATION.read_text()
    capability = SVG_CAPABILITY.read_text()
    requirements = REQUIREMENTS_STAGE.read_text()

    require(
        workflow,
        "## 文档图表格式决策（强制）",
        "其余文档创建或优化场景默认选择 `mermaid`",
        "同目录存在未引用的 `.svg` 文件不构成依据",
        "阶段的 `produces`、sensor 或目标产物契约明确要求 SVG",
        "不调用仅处理 SVG 的 `aidlc-diagram-design` Capability",
    )
    require(
        design,
        "## 输出格式选择（强制）",
        "文档创建或优化中的图表默认使用 Mermaid",
        "同目录存在孤立 SVG、其他文档使用 SVG 或 Agent 偏好均不能改变默认选择",
        "任一模式失败都应修复当前格式或报告能力/验证缺口",
    )
    require(
        mermaid,
        "# Mermaid 图表标准",
        "Mermaid 是创建或优化 Markdown 及其他文本型文档时的新图表默认格式",
        "不生成 `.svg`、`.diagram.json`、expected contract 或 Provider Request",
        "真实语法解析",
        "最小范围路由调整",
        "稳定、唯一且不随语句重排变化的 edge ID",
        "mbBack@{ curve: stepBefore }",
        "目标箭头前的最后一个有效线段",
        "直接渲染 PNG",
        "UNVERIFIED",
        "themeCSS",
    )
    require(
        validation,
        "## Mermaid 图表写入前验证",
        "其他情况默认 Mermaid",
        "两种格式的证据不得互相替代",
    )
    require(
        capability,
        "本能力只处理已由 `core-workflow.md` 判定为 SVG 的请求",
        "**output_format**：必须为 `svg`",
    )
    require(
        requirements,
        "普通文档创建或优化默认写入 Mermaid",
        "`diagram-contract` 契约要求 SVG",
    )

    forbidden = {
        WORKFLOW: "默认且唯一的新图表格式",
        MERMAID_STANDARD: "Mermaid fenced block 不再是本仓图表设计的输出格式",
        CONTENT_VALIDATION: "不得新建 Mermaid fenced block",
        DESIGN_STANDARD: "Mermaid fenced block 与二维 ASCII/Unicode 图已不再是本仓的新图表输出格式",
    }
    for path, phrase in forbidden.items():
        assert phrase not in path.read_text(), f"obsolete SVG-only rule remains in {path}: {phrase}"

    test_mermaid_edge_id_and_direct_png()
    print("Document diagram format policy tests passed")


if __name__ == "__main__":
    main()
