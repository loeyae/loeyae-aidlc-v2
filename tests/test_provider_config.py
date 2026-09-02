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
            "AI-DLC", "aidlc", "使用 AI-DLC", "继续上次的工作", "功能设计", "用户故事", "代码审查", "部署准备",
        ])
        assert "chrome-devtools" in skill
        assert "NEEDS_CAPABILITY" in skill
        assert "不生成 SVG" in skill

    assert not (ROOT / "harness" / "kiro-ide" / "POWER.md").exists()
    assert not (ROOT / "harness" / "kiro-ide" / "mcp.json").exists()

    print("Chrome DevTools provider config tests passed")


if __name__ == "__main__":
    main()
