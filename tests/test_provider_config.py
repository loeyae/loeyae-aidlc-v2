#!/usr/bin/env python3
"""Regression checks for the Kiro IDE/Kiro CLI Chrome DevTools provider config."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "harness" / "kiro-crew" / "mcp.json"
SKILL_PATHS = [
    ROOT / "harness" / "kiro-ide" / "SKILL.md",
    ROOT / "harness" / "kiro-cli" / "SKILL.md",
]
# Since 4.0.0 the Kiro SKILL.md is only an entry point; the Chrome DevTools provider rules live in
# diagram-contract.md ("Chrome DevTools Provider 运行时适配"), which ships unchanged into kiro-ide/kiro-cli.
DIAGRAM_CONTRACT_PATH = ROOT / "core" / "sensors" / "diagram-contract.md"


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    provider = config["mcpServers"]["chrome-devtools"]
    assert provider == {
        "command": "npx",
        "args": ["-y", "chrome-devtools-mcp"],
        "disabled": False,
        "autoApprove": [],
    }

    skills = [path.read_text() for path in SKILL_PATHS]
    assert skills[0] == skills[1]
    for skill in skills:
        assert skill.startswith("---\nname: loeyae-aidlc\n")
        frontmatter = skill.split("---", 2)[1]
        assert "description:" in frontmatter
        assert all(keyword in frontmatter for keyword in [
            "AI-DLC", "aidlc", "使用 AI-DLC", "继续当前工作", "功能设计", "用户故事", "代码审查", "部署准备",
        ])

    provider_doc = DIAGRAM_CONTRACT_PATH.read_text(encoding="utf-8")
    assert "未固定版本的 `chrome-devtools-mcp`" in provider_doc
    assert "Provider 能力不可用时写入 `final_status: \"NEEDS_CAPABILITY\"`，不得伪造通过" in provider_doc
    assert "不修改 SVG 源" in provider_doc

    assert not (ROOT / "harness" / "kiro-ide" / "POWER.md").exists()
    assert not (ROOT / "harness" / "kiro-ide" / "mcp.json").exists()

    print("Chrome DevTools provider config tests passed")


if __name__ == "__main__":
    main()
