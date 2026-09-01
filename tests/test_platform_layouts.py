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
        }
        package_version = json.loads((ROOT / "package.json").read_text())["version"]

        run_install("kiro-ide", home)
        kiro_power = home / ".kiro" / "powers" / "loeyae-aidlc"
        assert (kiro_power / "POWER.md").is_file()
        assert (kiro_power / "mcp.json").is_file()
        assert (kiro_power / "steering").is_dir()

        run_install("kiro-cli", home)
        kiro_skill = home / ".kiro" / "skills" / "loeyae-aidlc"
        assert (kiro_skill / "SKILL.md").is_file()
        assert not (kiro_skill / "POWER.md").exists()
        assert (home / ".kiro" / "settings" / "mcp.json").is_file()

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
        assert json.loads((codebuddy_marketplace / ".codebuddy-plugin" / "marketplace.json").read_text())["version"] == package_version
        assert json.loads((codebuddy_plugin / ".codebuddy-plugin" / "plugin.json").read_text())["version"] == package_version

        run_install("qoder", home, host_env)
        qoder_plugin = home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc"
        assert (qoder_plugin / ".qoder-plugin" / "plugin.json").is_file()
        assert (qoder_plugin / "skills" / "loeyae-aidlc" / "SKILL.md").is_file()
        assert (qoder_plugin / "hooks" / "hooks.json").is_file()
        assert (qoder_plugin / ".mcp.json").is_file()
        assert json.loads((qoder_plugin / ".qoder-plugin" / "plugin.json").read_text())["version"] == package_version

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
