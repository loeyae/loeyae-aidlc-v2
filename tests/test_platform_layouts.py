"""Regression tests for native layouts of the supported local harnesses."""

import json
import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE", "node")


def run_install(harness: str, home: Path, extra_env=None) -> None:
    env = os.environ.copy()
    env["HOME"] = str(home)
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(
        [NODE, str(ROOT / "bin" / "cli.js"), "install", "--harness", harness],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"{harness}: {result.stdout}\n{result.stderr}"


def fake_host_cli(path: Path, marketplace_list=False) -> None:
    body = ["#!/bin/sh"]
    if marketplace_list:
        body.extend([
            "if [ \"$1\" = plugin ] && [ \"$2\" = marketplace ] && [ \"$3\" = list ]; then",
            "  printf '[]\\n'",
            "fi",
        ])
    body.append("exit 0")
    path.write_text("\n".join(body) + "\n")
    path.chmod(0o755)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="loeyae-platform-layout-") as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        home.mkdir()
        fake_bin.mkdir()
        codebuddy = fake_bin / "codebuddy"
        qoder = fake_bin / "qoder"
        fake_host_cli(codebuddy, marketplace_list=True)
        fake_host_cli(qoder)
        host_env = {
            "CODEBUDDY_CLI": str(codebuddy),
            "QODER_CLI": str(qoder),
            "QODER_CONFIG_DIR": str(root / "qoder-config"),
            "QODER_CN_MCP_CONFIG": str(root / "qoder-cn" / "mcp.json"),
        }
        package_version = json.loads((ROOT / "package.json").read_text())["version"]

        run_install("kiro-ide", home)
        kiro_skill = home / ".kiro" / "skills" / "loeyae-aidlc"
        skill_entry = kiro_skill / "SKILL.md"
        assert skill_entry.is_file()
        assert not (kiro_skill / "POWER.md").exists()
        assert (kiro_skill / "stages").is_dir()
        assert not (home / ".kiro" / "powers" / "loeyae-aidlc").exists()
        assert (home / ".kiro" / "settings" / "mcp.json").is_file()
        skill_text = skill_entry.read_text()
        assert skill_text.startswith("---\nname: loeyae-aidlc\n")
        assert "Kiro IDE or CLI" in skill_text.split("---", 2)[1]
        assert all(keyword in skill_text.split("---", 2)[1] for keyword in ["AI-DLC", "使用 AI-DLC", "功能设计", "代码审查"])

        run_install("kiro-cli", home)
        assert skill_entry.is_file()
        manifests = list((home / ".config" / "loeyae-aidlc" / "installations").glob("*.json"))
        assert len(manifests) == 1
        assert json.loads(manifests[0].read_text())["owner"] == "loeyae-aidlc:kiro-global-skill"

        run_install("opencode", home)
        opencode_config = home / ".config" / "opencode"
        assert (opencode_config / "plugins" / "loeyae-aidlc.js").is_file()
        assert (opencode_config / "loeyae-aidlc" / "tools" / "aidlc-orchestrate.ts").is_file()
        assert not (opencode_config / "plugins" / "loeyae-aidlc" / ".opencode").exists()

        run_install("codebuddy", home, host_env)
        codebuddy_marketplace = home / ".config" / "loeyae-aidlc" / "host-assets" / "codebuddy" / "user"
        codebuddy_plugin = codebuddy_marketplace / "plugins" / "loeyae-aidlc"
        assert (codebuddy_marketplace / ".codebuddy-plugin" / "marketplace.json").is_file()
        assert (codebuddy_plugin / ".codebuddy-plugin" / "plugin.json").is_file()
        assert (codebuddy_plugin / "skills" / "loeyae-aidlc" / "SKILL.md").is_file()
        assert (codebuddy_plugin / "hooks" / "hooks.json").is_file()
        assert (codebuddy_plugin / ".mcp.json").is_file()
        codebuddy_marketplace_manifest = json.loads((codebuddy_marketplace / ".codebuddy-plugin" / "marketplace.json").read_text())
        codebuddy_plugin_manifest = json.loads((codebuddy_plugin / ".codebuddy-plugin" / "plugin.json").read_text())
        assert codebuddy_marketplace_manifest["version"] == package_version
        assert codebuddy_plugin_manifest["version"] == package_version
        assert codebuddy_marketplace_manifest["plugins"][0]["skills"] == ["./plugins/loeyae-aidlc/skills/loeyae-aidlc"]
        assert codebuddy_plugin_manifest["skills"] == ["./skills/loeyae-aidlc"]

        run_install("qoder", home, host_env)
        qoder_plugin = home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc"
        assert (qoder_plugin / ".qoder-plugin" / "plugin.json").is_file()
        assert (qoder_plugin / "skills" / "loeyae-aidlc" / "SKILL.md").is_file()
        assert (qoder_plugin / "hooks" / "hooks.json").is_file()
        assert (qoder_plugin / ".mcp.json").is_file()
        assert (qoder_plugin / "mcp-cn.json").is_file()
        qoder_plugin_manifest = json.loads((qoder_plugin / ".qoder-plugin" / "plugin.json").read_text())
        qoder_mcp_manifest = json.loads((qoder_plugin / ".mcp.json").read_text())
        qoder_settings = json.loads((root / "qoder-config" / "settings.json").read_text())
        qoder_cn_config = json.loads((root / "qoder-cn" / "mcp.json").read_text())
        assert qoder_plugin_manifest["version"] == package_version
        assert qoder_plugin_manifest["skills"] == "./skills"
        assert qoder_plugin_manifest["hooks"] == "./hooks/hooks.json"
        assert qoder_plugin_manifest["mcpServers"] == "./.mcp.json"
        expected_qoder_mcp = {"loeyae-skills", "awesome-design", "figma", "ssot"}
        assert set(qoder_mcp_manifest["mcpServers"]) == expected_qoder_mcp
        assert set(qoder_settings["mcpServers"]) == expected_qoder_mcp
        assert set(qoder_cn_config["mcpServers"]) == expected_qoder_mcp
        for server in qoder_cn_config["mcpServers"].values():
            assert server["command"] == "npx"
            assert server["args"][:2] == ["-y", "mcp-remote@0.8.3"]
            assert server["args"][-2:] == ["--transport", "http-only"] or server["args"][-4:-2] == ["--transport", "http-only"]
        ssot_args = qoder_cn_config["mcpServers"]["ssot"]["args"]
        assert ssot_args[-2:] == ["--header", "Authorization: Bearer ${SSOT_API_KEY}"]

        run_install("zcode", home)
        zcode_skill = home / ".zcode" / "skills" / "loeyae-aidlc"
        assert (zcode_skill / "SKILL.md").is_file()
        assert (zcode_skill / ".zcode-plugin" / "plugin.json").is_file()
        assert json.loads((zcode_skill / ".zcode-plugin" / "plugin.json").read_text())["version"] == package_version
        assert json.loads((ROOT / "dist" / "zcode" / "marketplace.json").read_text())["plugins"][0]["version"] == package_version
        zcode_config = json.loads((home / ".zcode" / "cli" / "config.json").read_text())
        assert zcode_config["hooks"]["enabled"] is True
        assert zcode_config["hooks"]["events"]["Stop"][0]["hooks"][0]["args"] == ["hook", "--format", "zcode"]
        assert set(zcode_config["mcp"]["servers"]) == {"loeyae-skills", "awesome-design", "figma", "ssot"}

    print("Native platform layout tests passed")


if __name__ == "__main__":
    main()
