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
    assert "loeyae-aidlc v2.0.0" in result.stdout


def main() -> None:
    test_declares_v1_services()
    test_merge_preserves_existing_and_adds_missing()
    test_node_launcher()
    print("MCP migration tests passed")


if __name__ == "__main__":
    main()
