"""Regression tests for the Claude Code official plugin layout."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist" / "claude"


def build_claude() -> None:
    result = subprocess.run(
        ["npm", "run", "build:claude"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_official_plugin_layout() -> None:
    build_claude()
    manifest_path = DIST / ".claude-plugin" / "plugin.json"
    orchestrator_skill = DIST / "skills" / "loeyae-aidlc" / "SKILL.md"
    diagram_skill = DIST / "skills" / "aidlc-diagram-design" / "SKILL.md"

    assert manifest_path.is_file()
    assert orchestrator_skill.is_file()
    assert diagram_skill.is_file()
    assert not (DIST / ".claude").exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "loeyae-aidlc"
    assert "mcpServers" in manifest
    assert orchestrator_skill.read_text().startswith(
        "---\nname: loeyae-aidlc\n"
    )


def main() -> None:
    test_official_plugin_layout()
    print("Claude Code plugin layout tests passed")


if __name__ == "__main__":
    main()
