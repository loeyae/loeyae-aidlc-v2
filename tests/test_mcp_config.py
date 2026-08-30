"""Regression tests for V1 MCP capability migration into Kiro Crew."""

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "harness" / "kiro-crew" / "mcp.json"
MERGE_TOOL = ROOT / "core" / "tools" / "aidlc-mcp-config.ts"


def test_declares_v1_services() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    servers = config["mcpServers"]
    assert set(servers) == {"loeyae-skills", "awesome-design", "figma", "ssot", "chrome-devtools"}
    assert servers["loeyae-skills"]["autoApprove"] == [
        "get_skill_outline",
        "get_skill_section",
        "get_skill_summary",
        "get_skill_content",
        "search_skill",
    ]
    assert servers["awesome-design"]["autoApprove"] == [
        "list_design_styles",
        "get_design_style",
        "get_design_tokens",
    ]
    assert servers["ssot"]["headers"]["Authorization"] == "Bearer ${SSOT_API_KEY}"
    assert servers["chrome-devtools"]["args"] == ["-y", "chrome-devtools-mcp"]


def test_merge_preserves_existing_and_adds_missing() -> None:
    script = f"""
import {{ mergeMcpServers }} from {json.dumps(MERGE_TOOL.as_uri())};
const empty = mergeMcpServers({{}}, {{ first: {{ type: 'http' }} }});
if (empty.added.join(',') !== 'first') throw new Error('empty config was not populated');
const result = mergeMcpServers(
  {{ mcpServers: {{ existing: {{ command: 'user-configured' }}, first: {{ type: 'custom' }} }} }},
  {{ first: {{ type: 'http', url: 'https://example.test/first' }}, restored: {{ type: 'http', url: 'https://example.test/restored' }} }}
);
if (result.added.join(',') !== 'restored') throw new Error('missing service was not added');
if (result.preserved.join(',') !== 'first') throw new Error('existing service was not preserved');
if (result.config.mcpServers.existing.command !== 'user-configured') throw new Error('existing service changed');
if (result.config.mcpServers.first.type !== 'custom') throw new Error('same-name service was overwritten');
if (result.config.mcpServers.restored.url !== 'https://example.test/restored') throw new Error('restored service is wrong');
const legacyChrome = mergeMcpServers(
  {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], disabled: false, autoApprove: [] }} }} }},
  {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'], disabled: false, autoApprove: [] }} }}
);
if (legacyChrome.upgraded.join(',') !== 'chrome-devtools') throw new Error('legacy Chrome DevTools default was not upgraded');
if (legacyChrome.config.mcpServers['chrome-devtools'].args[1] !== 'chrome-devtools-mcp') throw new Error('Chrome DevTools package spec is wrong');
const versionedChrome = mergeMcpServers(
  {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp@legacy-tag'], disabled: false, autoApprove: [] }} }} }},
  {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }} }}
);
if (versionedChrome.upgraded.join(',') !== 'chrome-devtools' || versionedChrome.config.mcpServers['chrome-devtools'].args[1] !== 'chrome-devtools-mcp') throw new Error('versioned Chrome DevTools package was not normalized');
const customChrome = mergeMcpServers(
  {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], env: {{ CUSTOM_PROFILE: '1' }} }} }} }},
  {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }} }}
);
if (customChrome.upgraded.length !== 0 || customChrome.preserved.join(',') !== 'chrome-devtools') throw new Error('custom Chrome DevTools service was overwritten');
"""
    result = subprocess.run(
        ["npx", "--no-install", "--prefix", str(ROOT), "tsx", "--eval", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_node_launcher() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "bin" / "cli.js"), "version"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert "loeyae-aidlc v2.0.2" in result.stdout


def main() -> None:
    test_declares_v1_services()
    test_merge_preserves_existing_and_adds_missing()
    test_node_launcher()
    print("MCP migration tests passed")


if __name__ == "__main__":
    main()
