"""Regression tests for native lifecycle gate adapters."""

import json
import os
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE", "node")


def run_cli(args: list[str], cwd: Path, home: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    return subprocess.run(
        [NODE, str(ROOT / "bin" / "cli.js"), *args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
    )


def main() -> None:
    kiro_hook = json.loads(
        (ROOT / "core" / "hooks" / "kiro" / "aidlc-gates.json").read_text()
    )
    assert kiro_hook["version"] == "v1"
    assert kiro_hook["hooks"][0]["trigger"] == "Stop"
    assert "loeyae-aidlc hook --format kiro" in kiro_hook["hooks"][0]["action"]["command"]

    claude_hooks = json.loads(
        (ROOT / "harness" / "claude" / "hooks" / "hooks.json").read_text()
    )
    assert "Stop" in claude_hooks["hooks"]
    assert claude_hooks["hooks"]["Stop"][0]["hooks"][0]["args"] == [
        "hook",
        "--format",
        "claude",
    ]

    codex_hooks = json.loads(
        (ROOT / "harness" / "codex" / "hooks" / "hooks.json").read_text()
    )
    assert "Stop" in codex_hooks["hooks"]
    assert "--format codex" in codex_hooks["hooks"]["Stop"][0]["hooks"][0]["command"]

    opencode_plugin = (ROOT / "harness" / "opencode" / "plugins" / "loeyae-aidlc.js").read_text()
    assert 'event.type !== "session.idle"' in opencode_plugin
    assert '"--format", "opencode"' in opencode_plugin

    with tempfile.TemporaryDirectory(prefix="loeyae-platform-hooks-") as directory:
        home = Path(directory)
        project = home / "project"
        project.mkdir()

        result = run_cli(
            ["install", "--harness", "kiro-ide", "--project", str(project)],
            ROOT,
            home,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        project_hook = project / ".kiro" / "hooks" / "loeyae-aidlc.json"
        assert project_hook.is_file()
        assert json.loads(project_hook.read_text()) == kiro_hook

        unsafe_target = home / "existing-project"
        unsafe_target.mkdir()
        sentinel = unsafe_target / "source.ts"
        sentinel.write_text("export const preserved = true;\n")
        result = run_cli(
            ["install", "--harness", "kiro-ide", "--target", str(unsafe_target)],
            ROOT,
            home,
        )
        assert result.returncode != 0
        assert sentinel.read_text() == "export const preserved = true;\n"
        assert "Refusing to replace non-empty --target directory" in result.stderr

        result = run_cli(["install", "--harness", "codex"], ROOT, home)
        assert result.returncode == 0, result.stdout + result.stderr
        registered = home / ".codex" / "hooks.json"
        assert registered.is_file()
        assert "Stop" in json.loads(registered.read_text())["hooks"]

        done_project = home / "done"
        (done_project / "docs" / "aidlc").mkdir(parents=True)
        (done_project / "docs" / "aidlc" / "aidlc-state.json").write_text(
            json.dumps({"status": "done", "current_stage": ""})
        )
        result = run_cli(["hook", "--format", "claude"], done_project, home)
        assert result.returncode == 0, result.stdout + result.stderr

        blocked_project = home / "blocked"
        (blocked_project / "docs" / "aidlc").mkdir(parents=True)
        (blocked_project / "docs" / "aidlc" / "aidlc-state.json").write_text(
            json.dumps({"status": "running", "current_stage": "missing-stage"})
        )
        result = run_cli(["hook", "--format", "claude"], blocked_project, home)
        assert result.returncode == 0, result.stdout + result.stderr
        decision = json.loads(result.stdout)
        assert decision["decision"] == "block"
        assert "missing-stage" in decision["reason"]

    print("Platform lifecycle hook tests passed")


if __name__ == "__main__":
    main()
