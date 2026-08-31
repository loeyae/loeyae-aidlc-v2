"""Installer ownership, transaction, and uninstall lifecycle tests."""

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE", "node")
SCRATCH_ROOT = Path(os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir())


def run_cli(home: Path, args: list, extra_env=None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["AIDLC_INSTALL_STATE_DIR"] = str(home / ".config" / "loeyae-aidlc" / "installations")
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [NODE, str(ROOT / "bin" / "cli.js"), *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode() + b"\0")
        if path.is_file():
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def test_managed_upgrade_rollback_and_uninstall() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-managed-", dir=str(SCRATCH_ROOT)) as directory:
        home = Path(directory) / "home"
        home.mkdir()
        target = Path(directory) / "managed-power"

        installed = run_cli(home, ["install", "--harness", "kiro-ide", "--target", str(target)])
        assert installed.returncode == 0, installed.stdout + installed.stderr
        assert (target / "POWER.md").is_file()
        manifests = list((home / ".config" / "loeyae-aidlc" / "installations").glob("*.json"))
        assert len(manifests) == 1
        manifest = json.loads(manifests[0].read_text())
        assert manifest["schema_version"] == 1 and manifest["owner"] == "loeyae-aidlc:kiro-ide"
        before = tree_digest(target)

        rolled_back = run_cli(
            home,
            ["install", "--harness", "kiro-ide", "--target", str(target)],
            {"AIDLC_INSTALL_FAILPOINT": "after-backup"},
        )
        assert rolled_back.returncode != 0
        assert tree_digest(target) == before
        assert not list(target.parent.glob(".*.loeyae-stage-*"))
        assert not list(target.parent.glob(".*.loeyae-backup-*"))

        uninstall_rollback = run_cli(
            home,
            ["uninstall", "--harness", "kiro-ide", "--target", str(target)],
            {"AIDLC_INSTALL_FAILPOINT": "uninstall-after-backup"},
        )
        assert uninstall_rollback.returncode != 0
        assert tree_digest(target) == before

        power = target / "POWER.md"
        original = power.read_text()
        power.write_text(original + "\nuser modification\n")
        refused = run_cli(home, ["install", "--harness", "kiro-ide", "--target", str(target)])
        assert refused.returncode != 0 and "was modified" in refused.stderr
        refused = run_cli(home, ["uninstall", "--harness", "kiro-ide", "--target", str(target)])
        assert refused.returncode != 0 and "was modified" in refused.stderr
        assert power.read_text().endswith("user modification\n")

        power.write_text(original)
        removed = run_cli(home, ["uninstall", "--harness", "kiro-ide", "--target", str(target)])
        assert removed.returncode == 0, removed.stdout + removed.stderr
        assert not target.exists()
        assert not manifests[0].exists()


def test_unowned_targets_and_argument_contracts() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-args-", dir=str(SCRATCH_ROOT)) as directory:
        home = Path(directory) / "home"
        home.mkdir()
        target = Path(directory) / "foreign"
        target.mkdir()
        marker = target / "source.txt"
        marker.write_text("preserve me")
        result = run_cli(home, ["install", "--harness", "kiro-cli", "--target", str(target)])
        assert result.returncode != 0 and "unowned install target" in result.stderr
        assert marker.read_text() == "preserve me"

        invalid_cases = [
            ["install", "--all", "--harness", "kiro-crew"],
            ["install", "--harness", "kiro-ide", "--target", str(target), "--project", str(target)],
            ["install", "--project", str(target)],
            ["install", "--harness", "kiro-crew", "--harness", "kiro-cli"],
            ["uninstall", "--list"],
        ]
        for args in invalid_cases:
            result = run_cli(home, args)
            assert result.returncode != 0, args


def test_opencode_multi_asset_transaction_and_uninstall() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-opencode-", dir=str(SCRATCH_ROOT)) as directory:
        home = Path(directory) / "home"
        home.mkdir()
        installed = run_cli(home, ["install", "--harness", "opencode"])
        assert installed.returncode == 0, installed.stdout + installed.stderr
        plugin = home / ".config" / "opencode" / "plugins" / "loeyae-aidlc.js"
        assets = home / ".config" / "opencode" / "loeyae-aidlc"
        assert plugin.is_file() and (assets / "tools" / "aidlc-orchestrate.ts").is_file()
        plugin_before = plugin.read_bytes()
        assets_before = tree_digest(assets)

        failed = run_cli(home, ["install", "--harness", "opencode"], {"AIDLC_INSTALL_FAILPOINT": "after-assets"})
        assert failed.returncode != 0
        assert plugin.read_bytes() == plugin_before and tree_digest(assets) == assets_before

        removed = run_cli(home, ["uninstall", "--harness", "opencode"])
        assert removed.returncode == 0, removed.stdout + removed.stderr
        assert not plugin.exists() and not assets.exists()


def test_install_all_aggregates_failures_and_continues() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-all-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        home.mkdir()
        fake_bin.mkdir()
        claude = fake_bin / "claude"
        claude.write_text("#!/bin/sh\nexit 23\n")
        claude.chmod(0o755)
        path = f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"
        result = run_cli(home, ["install", "--all"], {"PATH": path})
        assert result.returncode != 0
        assert "install --all failed" in result.stderr
        assert "claude" in result.stderr
        # Later platforms still ran after the Claude failure.
        assert (home / ".config" / "opencode" / "plugins" / "loeyae-aidlc.js").is_file()
        assert (home / ".agents" / "skills" / "loeyae-aidlc").is_dir()


if __name__ == "__main__":
    test_managed_upgrade_rollback_and_uninstall()
    test_unowned_targets_and_argument_contracts()
    test_opencode_multi_asset_transaction_and_uninstall()
    test_install_all_aggregates_failures_and_continues()
    print("Installer lifecycle tests passed")
