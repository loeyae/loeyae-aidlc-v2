#!/usr/bin/env python3
"""Regression checks for document diagram format routing."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / "core" / "knowledge" / "protocols" / "core-workflow.md"
DESIGN_STANDARD = ROOT / "core" / "knowledge" / "design" / "common-diagram-design-standards.md"
MERMAID_STANDARD = ROOT / "core" / "knowledge" / "design" / "common-mermaid-diagram-standards.md"
CONTENT_VALIDATION = ROOT / "core" / "knowledge" / "standards" / "common-content-validation.md"
SVG_CAPABILITY = ROOT / "core" / "skills" / "aidlc-diagram-design" / "SKILL.md"
REQUIREMENTS_STAGE = ROOT / "core" / "stages" / "inception" / "inception-requirements-analysis.md"


def require(text: str, *phrases: str) -> None:
    for phrase in phrases:
        assert phrase in text, f"missing document diagram policy: {phrase}"


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
        "未执行真实语法解析",
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

    print("Document diagram format policy tests passed")


if __name__ == "__main__":
    main()
