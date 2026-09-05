"""Installer ownership, transaction, and uninstall lifecycle tests."""

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE_COMMAND = os.environ.get("NODE", "node")
NODE = shutil.which(NODE_COMMAND) or NODE_COMMAND
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


def write_fake_host_command(directory: Path, name: str, exit_code: int = 0) -> Path:
    command = directory / name
    command.write_text(f"#!/bin/sh\nexit {exit_code}\n")
    command.chmod(0o755)
    return command


def isolated_host_env(root: Path, fake_bin: Path) -> dict:
    applications = root / "Applications"
    applications.mkdir(exist_ok=True)
    return {
        "PATH": f"{fake_bin}{os.pathsep}/usr/bin:/bin",
        "AIDLC_APPLICATIONS_ROOT": str(applications),
        "KIROCREW_HOME": "",
        "KIROCREW_VENV": "",
        "LOCALAPPDATA": "",
        "ProgramW6432": "",
        "ProgramFiles": "",
        "ProgramFiles(x86)": "",
    }


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


def write_fake_plugin_hosts(root: Path) -> dict:
    fake_bin = root / "plugin-host-bin"
    fake_bin.mkdir(exist_ok=True)
    codebuddy_log = root / "codebuddy-commands.log"
    codebuddy_market_state = root / "codebuddy-market-state"
    codebuddy_plugin_state = root / "codebuddy-plugin-state"
    codebuddy = fake_bin / "codebuddy"
    codebuddy.write_text(
        "#!/bin/sh\n"
        "printf '%s|%s|%s\\n' \"$PWD\" \"${CODEBUDDY_CONFIG_DIR:-}\" \"$*\" >> \"$CODEBUDDY_LOG\"\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = marketplace ] && [ \"$3\" = list ]; then\n"
        "  if [ -f \"$CODEBUDDY_MARKET_STATE\" ]; then name=$(cat \"$CODEBUDDY_MARKET_STATE\"); printf '[{\"name\":\"%s\"}]\\n' \"$name\"; else printf '[]\\n'; fi\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = marketplace ] && [ \"$3\" = add ]; then printf '%s' \"$6\" > \"$CODEBUDDY_MARKET_STATE\"; fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = marketplace ] && [ \"$3\" = remove ]; then rm -f \"$CODEBUDDY_MARKET_STATE\"; fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = list ]; then\n"
        "  if [ -f \"$CODEBUDDY_PLUGIN_STATE\" ]; then ref=$(cat \"$CODEBUDDY_PLUGIN_STATE\"); printf '[\"%s\"]\\n' \"$ref\"; else printf '[]\\n'; fi\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = install ]; then printf '%s' \"$3\" > \"$CODEBUDDY_PLUGIN_STATE\"; fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = update ] && [ \"${CODEBUDDY_UPDATE_FAIL:-}\" = 1 ]; then exit 31; fi\n"
        "if [ \"$1\" = plugin ] && [ \"$2\" = uninstall ]; then rm -f \"$CODEBUDDY_PLUGIN_STATE\"; fi\n"
        "exit 0\n"
    )
    codebuddy.chmod(0o755)

    qoder_log = root / "qoder-commands.log"
    qoder_plugin_state = root / "qoder-plugin-state"
    qoder = fake_bin / "qoder"
    qoder.write_text(
        "#!/bin/sh\n"
        "printf '%s|%s\\n' \"$PWD\" \"$*\" >> \"$QODER_LOG\"\n"
        "if [ \"$1\" = plugins ] && [ \"$2\" = list ]; then\n"
        "  if [ -f \"$QODER_PLUGIN_STATE\" ]; then printf '[\"loeyae-aidlc@local\"]\\n'; else printf '[]\\n'; fi\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = plugins ] && [ \"$2\" = install ] && [ \"${QODER_INSTALL_FAIL:-}\" = 1 ]; then exit 32; fi\n"
        "if [ \"$1\" = plugins ] && [ \"$2\" = install ]; then : > \"$QODER_PLUGIN_STATE\"; fi\n"
        "if [ \"$1\" = plugins ] && [ \"$2\" = uninstall ]; then rm -f \"$QODER_PLUGIN_STATE\"; fi\n"
        "exit 0\n"
    )
    qoder.chmod(0o755)
    return {
        "CODEBUDDY_CLI": str(codebuddy),
        "CODEBUDDY_LOG": str(codebuddy_log),
        "CODEBUDDY_MARKET_STATE": str(codebuddy_market_state),
        "CODEBUDDY_PLUGIN_STATE": str(codebuddy_plugin_state),
        "QODER_CLI": str(qoder),
        "QODER_LOG": str(qoder_log),
        "QODER_PLUGIN_STATE": str(qoder_plugin_state),
        "QODER_CONFIG_DIR": str(root / "qoder-config"),
        "QODER_CN_MCP_CONFIG": str(root / "qoder-cn" / "mcp.json"),
    }


def test_managed_upgrade_rollback_and_uninstall() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-managed-", dir=str(SCRATCH_ROOT)) as directory:
        home = Path(directory) / "home"
        home.mkdir()
        target = Path(directory) / "managed-skill"

        installed = run_cli(home, ["install", "--harness", "kiro-ide", "--target", str(target)])
        assert installed.returncode == 0, installed.stdout + installed.stderr
        assert (target / "SKILL.md").is_file()
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

        skill = target / "SKILL.md"
        original = skill.read_text()
        skill.write_text(original + "\nuser modification\n")
        refused = run_cli(home, ["install", "--harness", "kiro-ide", "--target", str(target)])
        assert refused.returncode != 0 and "was modified" in refused.stderr
        refused = run_cli(home, ["uninstall", "--harness", "kiro-ide", "--target", str(target)])
        assert refused.returncode != 0 and "was modified" in refused.stderr
        assert skill.read_text().endswith("user modification\n")

        skill.write_text(original)
        removed = run_cli(home, ["uninstall", "--harness", "kiro-ide", "--target", str(target)])
        assert removed.returncode == 0, removed.stdout + removed.stderr
        assert not target.exists()
        assert not manifests[0].exists()


def test_shared_kiro_global_skill_lifecycle() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-shared-kiro-", dir=str(SCRATCH_ROOT)) as directory:
        home = Path(directory) / "home"
        home.mkdir()
        shared_skill = home / ".kiro" / "skills" / "loeyae-aidlc"
        legacy_power = home / ".kiro" / "powers" / "loeyae-aidlc"
        state = home / ".config" / "loeyae-aidlc" / "installations"

        legacy_cli = run_cli(home, ["install", "--harness", "kiro-cli", "--target", str(shared_skill)])
        assert legacy_cli.returncode == 0, legacy_cli.stdout + legacy_cli.stderr
        manifests = list(state.glob("*.json"))
        assert len(manifests) == 1
        assert json.loads(manifests[0].read_text())["owner"] == "loeyae-aidlc:kiro-cli"

        adopted = run_cli(home, ["install", "--harness", "kiro-ide"])
        assert adopted.returncode == 0, adopted.stdout + adopted.stderr
        assert "Adopted legacy Kiro CLI ownership" in adopted.stdout
        assert (shared_skill / "SKILL.md").is_file()
        assert not legacy_power.exists()
        manifests = list(state.glob("*.json"))
        assert len(manifests) == 1
        manifest = json.loads(manifests[0].read_text())
        assert manifest["owner"] == "loeyae-aidlc:kiro-global-skill"
        assert manifest["assets"][0]["target"] == str(shared_skill.resolve())

        before = tree_digest(shared_skill)
        repeated = run_cli(home, ["install", "--harness", "kiro-cli"])
        assert repeated.returncode == 0, repeated.stdout + repeated.stderr
        assert tree_digest(shared_skill) == before
        assert len(list(state.glob("*.json"))) == 1

        removed = run_cli(home, ["uninstall", "--harness", "kiro-cli"])
        assert removed.returncode == 0, removed.stdout + removed.stderr
        assert not shared_skill.exists()
        assert not list(state.glob("*.json"))

        old_power = run_cli(home, ["install", "--harness", "kiro-ide", "--target", str(legacy_power)])
        assert old_power.returncode == 0, old_power.stdout + old_power.stderr
        assert legacy_power.is_dir()
        migrated = run_cli(home, ["install", "--harness", "kiro-ide"])
        assert migrated.returncode == 0, migrated.stdout + migrated.stderr
        assert "Removed installer-owned legacy Kiro IDE Power" in migrated.stdout
        assert not legacy_power.exists()
        assert (shared_skill / "SKILL.md").is_file()
        assert len(list(state.glob("*.json"))) == 1

        removed_all = run_cli(home, ["uninstall", "--all"])
        assert removed_all.returncode == 0, removed_all.stdout + removed_all.stderr
        assert not shared_skill.exists()
        assert not list(state.glob("*.json"))


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

        rollback_target = Path(directory) / "rollback-skill"
        rollback_marker = write_recognized_legacy_runtime(rollback_target, "restore me")
        rolled_back = run_cli(
            home,
            ["install", "--harness", "kiro-ide", "--target", str(rollback_target), "--migrate-legacy"],
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
            ["install", "--harness", "zcode", "--project", str(target)],
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


def test_new_plugin_host_lifecycles() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-new-hosts-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        project = root / "project"
        home.mkdir()
        project.mkdir()
        host_env = write_fake_plugin_hosts(root)

        zcode_config_path = home / ".zcode" / "cli" / "config.json"
        zcode_config_path.parent.mkdir(parents=True)
        custom_hook = {"hooks": [{"type": "process", "command": "user-hook", "args": []}]}
        custom_figma = {"type": "http", "url": "https://example.test/custom-figma"}
        zcode_config_path.write_text(json.dumps({
            "userSetting": "preserve",
            "hooks": {"enabled": False, "events": {"Stop": [custom_hook]}},
            "mcp": {"servers": {"figma": custom_figma}},
        }))
        qoder_mcp_config_paths = [
            Path(host_env["QODER_CONFIG_DIR"]) / "settings.json",
            Path(host_env["QODER_CN_MCP_CONFIG"]),
        ]
        for config_path in qoder_mcp_config_paths:
            config_path.parent.mkdir(parents=True)
            config_path.write_text(json.dumps({
                "userSetting": "preserve",
                "mcpServers": {"figma": custom_figma},
            }))

        for harness in ["codebuddy", "qoder", "zcode"]:
            first = run_cli(home, ["install", "--harness", harness], host_env)
            assert first.returncode == 0, first.stdout + first.stderr
            if harness == "qoder":
                assert "Qoder plugin installed and enabled for CN IDE / Desktop / CLI" in first.stdout
            second = run_cli(home, ["install", "--harness", harness], host_env)
            assert second.returncode == 0, second.stdout + second.stderr

        codebuddy_log = Path(host_env["CODEBUDDY_LOG"]).read_text().splitlines()
        assert any("plugin marketplace add " in line for line in codebuddy_log)
        assert any("plugin marketplace update loeyae-aidlc" in line for line in codebuddy_log)
        assert sum("plugin update loeyae-aidlc@loeyae-aidlc --scope user" in line for line in codebuddy_log) == 2
        assert sum("plugin enable loeyae-aidlc@loeyae-aidlc --scope user" in line for line in codebuddy_log) == 2

        qoder_log = Path(host_env["QODER_LOG"]).read_text().splitlines()
        assert sum("plugins install " in line and "--scope user" in line for line in qoder_log) == 2
        assert sum("plugins enable loeyae-aidlc --scope user" in line for line in qoder_log) == 2
        expected_qoder_mcp = {"loeyae-skills", "awesome-design", "figma", "ssot"}
        for config_path in qoder_mcp_config_paths:
            config = json.loads(config_path.read_text())
            assert config["userSetting"] == "preserve"
            assert config["mcpServers"]["figma"] == custom_figma
            assert set(config["mcpServers"]) == expected_qoder_mcp

        zcode_config = json.loads(zcode_config_path.read_text())
        stop_groups = zcode_config["hooks"]["events"]["Stop"]
        assert custom_hook in stop_groups
        assert sum(
            group.get("hooks", [{}])[0].get("args") == ["hook", "--format", "zcode"]
            for group in stop_groups
        ) == 1
        assert zcode_config["hooks"]["enabled"] is True
        assert zcode_config["mcp"]["servers"]["figma"] == custom_figma
        assert set(zcode_config["mcp"]["servers"]) == {"loeyae-skills", "awesome-design", "figma", "ssot"}
        assert zcode_config["userSetting"] == "preserve"

        for harness in ["codebuddy", "qoder", "zcode"]:
            removed = run_cli(home, ["uninstall", "--harness", harness], host_env)
            assert removed.returncode == 0, removed.stdout + removed.stderr

        assert not (home / ".config" / "loeyae-aidlc" / "host-assets" / "codebuddy" / "user").exists()
        assert not (home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc").exists()
        assert not (home / ".zcode" / "skills" / "loeyae-aidlc").exists()
        zcode_after = json.loads(zcode_config_path.read_text())
        assert zcode_after["hooks"]["events"]["Stop"] == [custom_hook]
        assert set(zcode_after["mcp"]["servers"]) == {"loeyae-skills", "awesome-design", "figma", "ssot"}
        for config_path in qoder_mcp_config_paths:
            config = json.loads(config_path.read_text())
            assert config["mcpServers"]["figma"] == custom_figma
            assert set(config["mcpServers"]) == expected_qoder_mcp

        for harness in ["codebuddy", "qoder"]:
            installed = run_cli(home, ["install", "--harness", harness, "--project", str(project)], host_env)
            assert installed.returncode == 0, installed.stdout + installed.stderr
        codebuddy_project_lines = Path(host_env["CODEBUDDY_LOG"]).read_text().splitlines()
        qoder_project_lines = Path(host_env["QODER_LOG"]).read_text().splitlines()
        project_cwd = str(project.resolve())
        assert any(line.startswith(f"{project_cwd}|") and "--scope project" in line for line in codebuddy_project_lines)
        assert any(line.startswith(f"{project_cwd}|") and "--scope project" in line for line in qoder_project_lines)
        assert len(list((home / ".config" / "loeyae-aidlc" / "host-assets" / "codebuddy").glob("project-*"))) == 1
        assert len(list((home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder").glob("project-*"))) == 1

        for harness in ["codebuddy", "qoder"]:
            removed = run_cli(home, ["uninstall", "--harness", harness, "--project", str(project)], host_env)
            assert removed.returncode == 0, removed.stdout + removed.stderr

        failed_codebuddy_home = root / "failed-codebuddy-home"
        failed_codebuddy_home.mkdir()
        failed_codebuddy = run_cli(failed_codebuddy_home, ["install", "--harness", "codebuddy"], {
            **host_env,
            "CODEBUDDY_UPDATE_FAIL": "1",
        })
        assert failed_codebuddy.returncode != 0 and "install/update failed" in failed_codebuddy.stderr
        assert not (failed_codebuddy_home / ".config" / "loeyae-aidlc" / "host-assets" / "codebuddy" / "user").exists()

        failed_qoder_home = root / "failed-qoder-home"
        failed_qoder_home.mkdir()
        failed_qoder = run_cli(failed_qoder_home, ["install", "--harness", "qoder"], {
            **host_env,
            "QODER_INSTALL_FAIL": "1",
        })
        assert failed_qoder.returncode != 0 and "plugin install failed" in failed_qoder.stderr
        assert not (failed_qoder_home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc").exists()


def test_workbuddy_embedded_cli_uses_workbuddy_config_dir() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-workbuddy-home-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        home.mkdir()
        host_env = write_fake_plugin_hosts(root)
        embedded_cli = (
            root
            / "Applications"
            / "WorkBuddy.app"
            / "Contents"
            / "Resources"
            / "app.asar.unpacked"
            / "cli"
            / "bin"
            / "codebuddy"
        )
        embedded_cli.parent.mkdir(parents=True)
        shutil.copy2(host_env["CODEBUDDY_CLI"], embedded_cli)
        host_env["CODEBUDDY_CLI"] = str(embedded_cli)

        installed = run_cli(home, ["install", "--harness", "codebuddy"], host_env)
        assert installed.returncode == 0, installed.stdout + installed.stderr
        lines = Path(host_env["CODEBUDDY_LOG"]).read_text().splitlines()
        config_dirs = {line.split("|", 2)[1] for line in lines}
        assert config_dirs == {str(home / ".workbuddy")}, lines


def test_install_all_detects_qoder_cn_desktop_without_cli() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-qoder-cn-desktop-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        local_app_data = root / "LocalAppData"
        qoder_executable = local_app_data / "Programs" / "Qoder" / "Qoder.exe"
        home.mkdir()
        fake_bin.mkdir()
        qoder_executable.parent.mkdir(parents=True)
        qoder_executable.write_text("fake Qoder CN Desktop executable")
        qoder_cn_config = home / ".qoder-cn" / "mcp.json"
        env = isolated_host_env(root, fake_bin)
        env.update({
            "LOCALAPPDATA": str(local_app_data),
            "QODER_CONFIG_DIR": str(home / ".qoder"),
            "QODER_CN_MCP_CONFIG": str(qoder_cn_config),
        })

        installed = run_cli(home, ["install", "--all"], env)
        assert installed.returncode == 0, installed.stdout + installed.stderr
        output = installed.stdout + installed.stderr
        detected_line = next(line for line in output.splitlines() if "Detected supported hosts:" in line)
        assert f"qoder ({qoder_executable})" in detected_line
        assert "Qoder CN Desktop detected without qoder CLI" in output
        expected_mcp = {"loeyae-skills", "awesome-design", "figma", "ssot"}
        assert set(json.loads(qoder_cn_config.read_text())["mcpServers"]) == expected_mcp
        assert set(json.loads((home / ".qoder" / "settings.json").read_text())["mcpServers"]) == expected_mcp
        qoder_assets = home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc"
        assert (qoder_assets / "mcp-cn.json").is_file()

        repeated = run_cli(home, ["install", "--all"], env)
        assert repeated.returncode == 0, repeated.stdout + repeated.stderr
        assert "MCP services already present" in repeated.stdout

        project = root / "project"
        project.mkdir()
        project_install = run_cli(home, ["install", "--harness", "qoder", "--project", str(project)], env)
        assert project_install.returncode != 0
        assert "project-scope installation requires the qoder CLI" in project_install.stderr

        removed = run_cli(home, ["uninstall", "--all"], env)
        assert removed.returncode == 0, removed.stdout + removed.stderr
        assert not qoder_assets.exists()
        assert set(json.loads(qoder_cn_config.read_text())["mcpServers"]) == expected_mcp


def test_install_all_detects_machine_wide_windows_kiro_crew() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-windows-crew-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        program_files = root / "Program Files"
        kiro_crew_executable = program_files / "KiroCrew" / "KiroCrew.exe"
        home.mkdir()
        fake_bin.mkdir()
        kiro_crew_executable.parent.mkdir(parents=True)
        kiro_crew_executable.write_text("fake machine-wide Windows KiroCrew executable")
        env = isolated_host_env(root, fake_bin)
        env["ProgramFiles"] = str(program_files)

        installed = run_cli(home, ["install", "--all"], env)
        assert installed.returncode == 0, installed.stdout + installed.stderr
        detected_line = next(line for line in installed.stdout.splitlines() if "Detected supported hosts:" in line)
        assert f"kiro-crew ({kiro_crew_executable})" in detected_line
        assert (home / ".kiro" / "crew" / "skills" / "loeyae-aidlc").is_dir()
        state = home / ".config" / "loeyae-aidlc" / "installations"
        assert len(list(state.glob("*.json"))) == 1


def test_install_all_detects_hosts_and_uninstall_all_uses_ownership() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-detected-all-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        home.mkdir()
        fake_bin.mkdir()
        local_app_data = root / "LocalAppData"
        kiro_crew_executable = local_app_data / "Programs" / "KiroCrew" / "KiroCrew.exe"
        kiro_crew_executable.parent.mkdir(parents=True)
        kiro_crew_executable.write_text("fake Windows KiroCrew desktop executable")
        for command in ["claude", "kiro", "kiro-cli"]:
            write_fake_host_command(fake_bin, command)
        env = isolated_host_env(root, fake_bin)
        env["LOCALAPPDATA"] = str(local_app_data)

        installed = run_cli(home, ["install", "--all"], env)
        assert installed.returncode == 0, installed.stdout + installed.stderr
        output = installed.stdout + installed.stderr
        detected_line = next(line for line in output.splitlines() if "Detected supported hosts:" in line)
        assert all(harness in detected_line for harness in ["kiro-crew", "kiro-ide", "kiro-cli", "claude"])
        assert f"kiro-crew ({kiro_crew_executable})" in detected_line
        assert all(harness not in detected_line for harness in ["opencode", "codex", "codebuddy", "qoder", "zcode"])
        assert "Skipping unavailable hosts:" in output
        assert (home / ".kiro" / "crew" / "skills" / "loeyae-aidlc").is_dir()
        assert not (home / ".kiro" / "powers" / "loeyae-aidlc").exists()
        assert (home / ".kiro" / "skills" / "loeyae-aidlc" / "SKILL.md").is_file()
        assert (home / ".claude" / "plugins" / "loeyae-aidlc-marketplace" / "plugins" / "loeyae-aidlc").is_dir()
        assert not (home / ".config" / "opencode" / "plugins" / "loeyae-aidlc.js").exists()
        assert not (home / ".agents" / "skills" / "loeyae-aidlc").exists()
        assert not (home / ".config" / "loeyae-aidlc" / "host-assets").exists()
        assert not (home / ".zcode" / "skills" / "loeyae-aidlc").exists()
        state = home / ".config" / "loeyae-aidlc" / "installations"
        assert len(list(state.glob("*.json"))) == 3

        removed = run_cli(home, ["uninstall", "--all"], env)
        assert removed.returncode == 0, removed.stdout + removed.stderr
        removed_output = removed.stdout + removed.stderr
        assert "Installer-owned global installations: kiro-crew, kiro-ide, claude" in removed_output
        assert "Uninstalled 3 installer-owned global platform installations" in removed_output
        assert not (home / ".kiro" / "crew" / "skills" / "loeyae-aidlc").exists()
        assert not (home / ".kiro" / "powers" / "loeyae-aidlc").exists()
        assert not (home / ".kiro" / "skills" / "loeyae-aidlc").exists()
        assert not (home / ".claude" / "plugins" / "loeyae-aidlc-marketplace" / "plugins" / "loeyae-aidlc").exists()
        assert not list(state.glob("*.json"))

        empty = run_cli(home, ["uninstall", "--all"], env)
        assert empty.returncode == 0, empty.stdout + empty.stderr
        assert "No installer-owned global platform installations were found" in empty.stdout


def test_install_all_aggregates_failures_and_continues() -> None:
    with tempfile.TemporaryDirectory(prefix="aidlc-installer-all-", dir=str(SCRATCH_ROOT)) as directory:
        root = Path(directory)
        home = root / "home"
        fake_bin = root / "bin"
        home.mkdir()
        fake_bin.mkdir()
        legacy_target = home / ".kiro" / "skills" / "loeyae-aidlc"
        legacy_marker = write_recognized_legacy_runtime(legacy_target, "all migration backup")
        for command in ["kiro", "opencode", "codex", "zcode"]:
            write_fake_host_command(fake_bin, command)
        write_fake_host_command(fake_bin, "claude", 23)
        path_env = isolated_host_env(root, fake_bin)
        host_env = write_fake_plugin_hosts(root)
        result = run_cli(home, ["install", "--all", "--migrate-legacy"], {
            **path_env,
            **host_env,
        })
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
        assert (home / ".config" / "loeyae-aidlc" / "host-assets" / "codebuddy" / "user").is_dir()
        assert (home / ".config" / "loeyae-aidlc" / "host-assets" / "qoder" / "user" / "loeyae-aidlc").is_dir()
        assert (home / ".zcode" / "skills" / "loeyae-aidlc").is_dir()


if __name__ == "__main__":
    test_managed_upgrade_rollback_and_uninstall()
    test_shared_kiro_global_skill_lifecycle()
    test_unowned_targets_and_argument_contracts()
    test_opencode_multi_asset_transaction_and_uninstall()
    test_claude_activation_refreshes_existing_plugin()
    test_new_plugin_host_lifecycles()
    test_workbuddy_embedded_cli_uses_workbuddy_config_dir()
    test_install_all_detects_qoder_cn_desktop_without_cli()
    test_install_all_detects_machine_wide_windows_kiro_crew()
    test_install_all_detects_hosts_and_uninstall_all_uses_ownership()
    test_install_all_aggregates_failures_and_continues()
    print("Installer lifecycle tests passed")
