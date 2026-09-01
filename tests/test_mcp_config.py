"""Regression tests for safe MCP capability merging."""

import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "harness" / "kiro-crew" / "mcp.json"
MERGE_TOOL = ROOT / "core" / "tools" / "aidlc-mcp-config.ts"


def test_declares_v1_services() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    servers = config["mcpServers"]
    assert set(servers) == {"loeyae-skills", "awesome-design", "figma", "ssot", "chrome-devtools"}
    assert servers["ssot"]["headers"]["Authorization"] == "Bearer ${SSOT_API_KEY}"
    assert servers["chrome-devtools"]["args"] == ["-y", "chrome-devtools-mcp"]


def run_eval(script: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["npx", "--no-install", "--prefix", str(ROOT), "tsx", "--eval", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )


def test_merge_preserves_pins_and_adds_missing() -> None:
    script = f"""
import {{ mergeMcpServers }} from {json.dumps(MERGE_TOOL.as_uri())};
const empty = mergeMcpServers({{}}, {{ first: {{ type: 'http' }} }});
if (empty.added.join(',') !== 'first') throw new Error('empty config was not populated');
const result = mergeMcpServers(
  {{ customTopLevel: true, mcpServers: {{ existing: {{ command: 'user-configured' }}, first: {{ type: 'custom' }} }} }},
  {{ first: {{ type: 'http' }}, restored: {{ type: 'http', url: 'https://example.test/restored' }} }}
);
if (result.added.join(',') !== 'restored' || result.preserved.join(',') !== 'first') throw new Error('merge classification is wrong');
if (result.config.mcpServers.existing.command !== 'user-configured' || result.config.mcpServers.first.type !== 'custom' || result.config.customTopLevel !== true) throw new Error('user config changed');
const knownLegacy = mergeMcpServers(
  {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.6.0'], disabled: false, autoApprove: [] }} }} }},
  {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }} }}
);
if (knownLegacy.upgraded.join(',') !== 'chrome-devtools') throw new Error('known legacy default was not migrated');
for (const packageSpec of ['chrome-devtools-mcp@latest', 'chrome-devtools-mcp@legacy-tag', 'chrome-devtools-mcp@1.7.0']) {{
  const pinned = mergeMcpServers(
    {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', packageSpec], disabled: false, autoApprove: [] }} }} }},
    {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }} }}
  );
  if (pinned.upgraded.length !== 0 || pinned.preserved.join(',') !== 'chrome-devtools' || pinned.config.mcpServers['chrome-devtools'].args[1] !== packageSpec) throw new Error(`active pin changed: ${{packageSpec}}`);
}}
const custom = mergeMcpServers(
  {{ mcpServers: {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp@1.6.0'], env: {{ CUSTOM_PROFILE: '1' }} }} }} }},
  {{ 'chrome-devtools': {{ command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }} }}
);
if (custom.upgraded.length !== 0 || custom.preserved.join(',') !== 'chrome-devtools') throw new Error('custom service was overwritten');
"""
    result = run_eval(script)
    assert result.returncode == 0, result.stderr


def test_concurrent_updates_do_not_lose_servers() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-mcp-concurrent-") as directory:
        target = Path(directory) / "mcp.json"
        target.write_text('{"customTopLevel":true,"mcpServers":{"existing":{"type":"custom"}}}\n')
        scripts = []
        for name in ("alpha", "beta"):
            scripts.append(f"""
import {{ updateMcpConfig }} from {json.dumps(MERGE_TOOL.as_uri())};
updateMcpConfig({json.dumps(str(target))}, {{ {name}: {{ type: 'http', url: 'https://example.test/{name}' }} }});
""")
        processes = [
            subprocess.Popen(
                ["npx", "--no-install", "--prefix", str(ROOT), "tsx", "--eval", script],
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for script in scripts
        ]
        results = [process.communicate() + (process.returncode,) for process in processes]
        assert all(result[2] == 0 for result in results), results
        config = json.loads(target.read_text())
        assert config["customTopLevel"] is True
        assert set(config["mcpServers"]) == {"existing", "alpha", "beta"}
        assert not Path(str(target) + ".lock").exists()


def test_node_launcher() -> None:
    result = subprocess.run(["node", str(ROOT / "bin" / "cli.js"), "version"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "loeyae-aidlc v2.1.3" in result.stdout


def main() -> None:
    test_declares_v1_services()
    test_merge_preserves_pins_and_adds_missing()
    test_concurrent_updates_do_not_lose_servers()
    test_node_launcher()
    print("MCP migration tests passed")


if __name__ == "__main__":
    main()
