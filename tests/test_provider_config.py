#!/usr/bin/env python3
"""Regression checks for the Kiro IDE/Kiro CLI Chrome DevTools provider config."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "harness" / "kiro-ide" / "mcp.json"
POWER_PATH = ROOT / "harness" / "kiro-ide" / "POWER.md"


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    provider = config["mcpServers"]["chrome-devtools"]
    assert provider == {
        "command": "npx",
        "args": ["-y", "chrome-devtools-mcp"],
        "disabled": False,
        "autoApprove": [],
    }

    power = POWER_PATH.read_text()
    assert "chrome-devtools" in power
    assert "NEEDS_CAPABILITY" in power
    assert "不生成 SVG" in power

    print("Chrome DevTools provider config tests passed")


if __name__ == "__main__":
    main()
