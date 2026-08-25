"""Regression tests for native layouts of the supported local harnesses."""

import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE", "node")


def run_install(harness: str, home: Path) -> None:
    env = os.environ.copy()
    env["HOME"] = str(home)
    result = subprocess.run(
        [NODE, str(ROOT / "bin" / "cli.js"), "install", "--harness", harness],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"{harness}: {result.stdout}\n{result.stderr}"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="loeyae-platform-layout-") as directory:
        home = Path(directory)

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

    print("Native platform layout tests passed")


if __name__ == "__main__":
    main()
