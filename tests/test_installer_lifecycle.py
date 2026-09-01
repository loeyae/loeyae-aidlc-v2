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


def write_recognized_legacy_runtime(target: Path, note: str = "preserve legacy customization") -> Path:
    graph = target / "tools" / "data" / "stage-graph.json"
    graph.parent.mkdir(parents=True)
    graph.write_text(json.dumps({
        "version": "2.0.2",
        "stages": [{"slug": "workspace-detection"}],
    }))
    marker = target / "user-note.txt"
    marker.write_text(note)
    return marker


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

        unknown_migration = run_cli(home, [
            "install", "--harness", "kiro-cli", "--target", str(target), "--migrate-legacy",
        ])
        assert unknown_migration.returncode != 0 and "not a recognized Loeyae AI-DLC v2 legacy install" in unknown_migration.stderr
        assert marker.read_text() == "preserve me"
        assert not list(target.parent.glob(f"{target.name}.pre-managed-backup-*"))

        legacy_target = home / ".kiro" / "skills" / "loeyae-aidlc"
        legacy_marker = write_recognized_legacy_runtime(legacy_target)
        migrated = run_cli(home, ["install", "--harness", "kiro-cli", "--migrate-legacy"])
        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        assert "Preserved legacy install backup" in migrated.stdout
        backups = list(legacy_target.parent.glob(f"{legacy_target.name}.pre-managed-backup-*"))
        assert len(backups) == 1 and (backups[0] / legacy_marker.name).read_text() == "preserve legacy customization"
        assert not (legacy_target / legacy_marker.name).exists()
        assert (legacy_target / "tools" / "aidlc-orchestrate.ts").is_file()

        managed_graph = legacy_target / "tools" / "data" / "stage-graph.json"
        managed_graph.write_text(managed_graph.read_text() + "\n")
        modified = run_cli(home, ["install", "--harness", "kiro-cli", "--migrate-legacy"])
        assert modified.returncode != 0 and "was modified" in modified.stderr
        assert len(list(legacy_target.parent.glob(f"{legacy_target.name}.pre-managed-backup-*"))) == 1

        rollback_target = home / ".kiro" / "powers" / "loeyae-aidlc"
        rollback_marker = write_recognized_legacy_runtime(rollback_target, "restore me")
        rolled_back = run_cli(
            home,
            ["install", "--harness", "kiro-ide", "--migrate-legacy"],
            {"AIDLC_INSTALL_FAILPOINT": "after-assets"},
        )
        assert rolled_back.returncode != 0 and "after-assets" in rolled_back.stderr
        assert rollback_marker.read_text() == "restore me"
        assert not list(rollback_target.parent.glob(f"{rollback_target.name}.pre-managed-backup-*"))
        assert not list(rollback_target.parent.glob(".*.loeyae-stage-*"))

        invalid_cases = [
            ["install", "--all", "--harness", "kiro-crew"],
            ["install", "--harness", "kiro-ide", "--target", str(target), "--project", str(target)],
            ["install", "--project", str(target)],
            ["install", "--harness", "kiro-crew", "--harness", "kiro-cli"],
            ["install", "--list", "--migrate-legacy"],
            ["install", "--migrate-legacy", "--migrate-legacy"],
            ["uninstall", "--list"],
            ["uninstall", "--migrate-legacy"],
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


def test_claude_activation_refreshes_existing_plugin() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-claude-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        fake_bin = root / "bin"
        fake_bin.mkdir()
        command_log = root / "claude-commands.log"
        claude = fake_bin / "claude"
        claude.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$CLAUDE_LOG\"\n"
            "if [ \"${CLAUDE_UPDATE_FAIL:-}\" = 1 ] && [ \"$2\" = update ]; then exit 29; fi\n"
            "exit 0\n"
        )
        claude.chmod(0o755)
        path = f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"

        home = root / "success-home"
        home.mkdir()
        installed = run_cli(home, ["install", "--harness", "claude"], {
            "PATH": path,
            "CLAUDE_LOG": str(command_log),
        })
        assert installed.returncode == 0, installed.stdout + installed.stderr
        commands = command_log.read_text().splitlines()
        plugin_ref = "loeyae-aidlc@loeyae-aidlc --scope user"
        assert commands[0].startswith("plugin marketplace add ")
        assert commands[1] == f"plugin install {plugin_ref}"
        assert commands[2] == f"plugin update {plugin_ref}"
        assert "registered and refreshed" in installed.stdout

        failed_home = root / "failed-home"
        failed_home.mkdir()
        failed = run_cli(failed_home, ["install", "--harness", "claude"], {
            "PATH": path,
            "CLAUDE_LOG": str(command_log),
            "CLAUDE_UPDATE_FAIL": "1",
        })
        assert failed.returncode != 0 and "plugin install/update failed" in failed.stderr
        marketplace = failed_home / ".claude" / "plugins" / "loeyae-aidlc-marketplace"
        assert not (marketplace / "plugins" / "loeyae-aidlc").exists()
        assert not (marketplace / ".claude-plugin" / "marketplace.json").exists()
        state = failed_home / ".config" / "loeyae-aidlc" / "installations"
        assert not list(state.glob("*.json"))


def test_install_all_aggregates_failures_and_continues() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-all-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        home.mkdir()
        fake_bin.mkdir()
        legacy_target = home / ".kiro" / "powers" / "loeyae-aidlc"
        legacy_marker = write_recognized_legacy_runtime(legacy_target, "all migration backup")
        claude = fake_bin / "claude"
        claude.write_text("#!/bin/sh\nexit 23\n")
        claude.chmod(0o755)
        path = f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}"
        result = run_cli(home, ["install", "--all", "--migrate-legacy"], {"PATH": path})
        assert result.returncode != 0
        assert "install --all failed" in result.stderr
        assert "claude" in result.stderr
        output = result.stdout + result.stderr
        build_messages = output.count("Using current prebuilt harness set") + output.count("Harness set requires rebuild; building all once")
        assert build_messages == 1
        assert "Prebuilt harness is stale; rebuilding" not in output
        backups = list(legacy_target.parent.glob(f"{legacy_target.name}.pre-managed-backup-*"))
        assert len(backups) == 1 and (backups[0] / legacy_marker.name).read_text() == "all migration backup"
        # Later platforms still ran after the Claude failure.
        assert (home / ".config" / "opencode" / "plugins" / "loeyae-aidlc.js").is_file()
        assert (home / ".agents" / "skills" / "loeyae-aidlc").is_dir()


if __name__ == "__main__":
    test_managed_upgrade_rollback_and_uninstall()
    test_unowned_targets_and_argument_contracts()
    test_opencode_multi_asset_transaction_and_uninstall()
    test_claude_activation_refreshes_existing_plugin()
    test_install_all_aggregates_failures_and_continues()
    print("Installer lifecycle tests passed")
