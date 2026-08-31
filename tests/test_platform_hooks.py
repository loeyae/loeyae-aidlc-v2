"""Regression tests for native lifecycle gate adapters."""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE", "node")
TRUST_SECRET = "aidlc-platform-test-secret-at-least-32-bytes"


def environment(home: Path, trust: Path = None) -> dict:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env["AIDLC_TRUST_SECRET"] = TRUST_SECRET
    env["AIDLC_TRUST_DIR"] = str(trust or home / "trust")
    env["AIDLC_INSTALL_STATE_DIR"] = str(home / ".config" / "loeyae-aidlc" / "installations")
    return env


def run_cli(args: list, cwd: Path, home: Path, trust: Path = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NODE, str(ROOT / "bin" / "cli.js"), *args],
        cwd=cwd,
        env=environment(home, trust),
        capture_output=True,
        text=True,
    )


def save_state(project: Path, home: Path, status="running", current_stage="") -> None:
    state_uri = (ROOT / "core" / "tools" / "aidlc-state.ts").as_uri()
    script = f"""
import {{ createInitialState, saveWorkflowState }} from {json.dumps(state_uri)};
const state = createInitialState('feature');
state.status = {json.dumps(status)};
state.current_stage = {json.dumps(current_stage)};
state.current_phase = 'inception';
saveWorkflowState(process.cwd(), state);
"""
    result = subprocess.run(
        ["npx", "--no-install", "--prefix", str(ROOT), "tsx", "--eval", script],
        cwd=project,
        env=environment(home, home / f"trust-{project.name}"),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def main() -> None:
    kiro_hook = json.loads((ROOT / "core" / "hooks" / "kiro" / "aidlc-gates.json").read_text())
    assert kiro_hook["version"] == "v1"
    assert kiro_hook["hooks"][0]["trigger"] == "Stop"
    assert "loeyae-aidlc hook --format kiro" in kiro_hook["hooks"][0]["action"]["command"]

    claude_hooks = json.loads((ROOT / "harness" / "claude" / "hooks" / "hooks.json").read_text())
    assert claude_hooks["hooks"]["Stop"][0]["hooks"][0]["args"] == ["hook", "--format", "claude"]

    codex_hooks = json.loads((ROOT / "harness" / "codex" / "hooks" / "hooks.json").read_text())
    codex_group = codex_hooks["hooks"]["Stop"][0]
    assert codex_group["id"] == "loeyae-aidlc-stop-gate-v1"
    assert "--format codex" in codex_group["hooks"][0]["command"]

    plugin = (ROOT / "harness" / "opencode" / "plugins" / "loeyae-aidlc.js").read_text()
    assert 'event.type !== "session.idle"' in plugin
    assert '"--format", "opencode"' in plugin
    assert "<missing-session-id>" in plugin
    assert "Symbol.for" in plugin and "activeGuards" in plugin
    assert "throw new Error" in plugin

    with tempfile.TemporaryDirectory(prefix="loeyae-platform-hooks-") as directory:
        home = Path(directory)
        project = home / "project"
        project.mkdir()

        result = run_cli(["install", "--harness", "kiro-ide", "--project", str(project)], ROOT, home)
        assert result.returncode == 0, result.stdout + result.stderr
        project_hook = project / ".kiro" / "hooks" / "loeyae-aidlc.json"
        assert json.loads(project_hook.read_text()) == kiro_hook

        foreign_project = home / "foreign-project"
        foreign_hook = foreign_project / ".kiro" / "hooks" / "loeyae-aidlc.json"
        foreign_hook.parent.mkdir(parents=True)
        foreign_hook.write_text('{"owner":"user"}\n')
        rejected = run_cli(["install", "--harness", "kiro-ide", "--project", str(foreign_project)], ROOT, home)
        assert rejected.returncode != 0
        assert foreign_hook.read_text() == '{"owner":"user"}\n'
        assert "unowned install target" in rejected.stderr

        unsafe_target = home / "existing-project"
        unsafe_target.mkdir()
        sentinel = unsafe_target / "source.ts"
        sentinel.write_text("export const preserved = true;\n")
        rejected = run_cli(["install", "--harness", "kiro-ide", "--target", str(unsafe_target)], ROOT, home)
        assert rejected.returncode != 0
        assert sentinel.read_text() == "export const preserved = true;\n"
        assert "unowned install target" in rejected.stderr

        custom_group = {"id": "user-hook", "hooks": [{"type": "command", "command": "echo user"}]}
        codex_path = home / ".codex" / "hooks.json"
        codex_path.parent.mkdir(parents=True)
        codex_path.write_text(json.dumps({"hooks": {"Stop": [custom_group]}}))
        for _ in range(2):
            result = run_cli(["install", "--harness", "codex"], ROOT, home)
            assert result.returncode == 0, result.stdout + result.stderr
        registered = json.loads(codex_path.read_text())["hooks"]["Stop"]
        assert sum(group.get("id") == "loeyae-aidlc-stop-gate-v1" for group in registered) == 1
        assert custom_group in registered
        result = run_cli(["uninstall", "--harness", "codex"], ROOT, home)
        assert result.returncode == 0, result.stdout + result.stderr
        remaining = json.loads(codex_path.read_text())["hooks"]["Stop"]
        assert remaining == [custom_group]

        # Valid signed done state allows stopping.
        done_project = home / "done"
        done_project.mkdir()
        save_state(done_project, home, status="done")
        result = run_cli(["hook", "--format", "claude"], done_project, home, home / "trust-done")
        assert result.returncode == 0 and result.stdout == "", result.stdout + result.stderr

        # Valid signed running state with an unknown stage exercises nonzero JSON error parsing.
        blocked_project = home / "blocked"
        blocked_project.mkdir()
        save_state(blocked_project, home, current_stage="missing-stage")
        result = run_cli(["hook", "--format", "claude"], blocked_project, home, home / "trust-blocked")
        assert result.returncode == 0
        decision = json.loads(result.stdout)
        assert decision["decision"] == "block"
        assert "Unknown stage" in decision["reason"]

        # Tampering a signed state fails closed.
        state_path = blocked_project / "docs" / "aidlc" / "aidlc-state.json"
        state = json.loads(state_path.read_text())
        state["current_stage"] = "workspace-detection"
        state_path.write_text(json.dumps(state))
        result = run_cli(["hook", "--format", "claude"], blocked_project, home, home / "trust-blocked")
        assert json.loads(result.stdout)["decision"] == "block"
        assert "integrity" in json.loads(result.stdout)["reason"]

        # Enrolled state deletion also fails closed.
        state_path.unlink()
        result = run_cli(["hook", "--format", "claude"], blocked_project, home, home / "trust-blocked")
        assert json.loads(result.stdout)["decision"] == "block"
        assert "missing its signed state" in json.loads(result.stdout)["reason"]

        # Stop Hook cannot auto-complete instruction-only stages.
        instruction_project = home / "instruction"
        instruction_project.mkdir()
        init = run_cli(["orchestrate", "next", "--scope", "feature"], instruction_project, home, home / "trust-instruction")
        assert init.returncode == 0
        directive = run_cli(["orchestrate", "next"], instruction_project, home, home / "trust-instruction")
        assert json.loads(directive.stdout)["completion_contract"] == "instruction_only"
        result = run_cli(["hook", "--format", "claude"], instruction_project, home, home / "trust-instruction")
        decision = json.loads(result.stdout)
        assert decision["decision"] == "block" and "instruction-ack" in decision["reason"]

        shutil.rmtree(home / "trust", ignore_errors=True)

    print("Platform lifecycle hook tests passed")


if __name__ == "__main__":
    main()
