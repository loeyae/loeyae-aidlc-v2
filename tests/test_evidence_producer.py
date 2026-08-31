"""Integration tests for the controlled and signed evidence producer."""

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TOOL = REPO_ROOT / "core" / "tools" / "aidlc-evidence.ts"
ORCHESTRATE = REPO_ROOT / "core" / "tools" / "aidlc-orchestrate.ts"
SCRATCH_ROOT = Path(os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir())
TRUST_SECRET = "aidlc-evidence-test-secret-at-least-32-bytes"


def environment(project: Path, secret=TRUST_SECRET) -> dict:
    env = os.environ.copy()
    for key in ("npm_config_prefix", "npm_execpath", "npm_command"):
        env.pop(key, None)
    if secret is None:
        env.pop("AIDLC_TRUST_SECRET", None)
    else:
        env["AIDLC_TRUST_SECRET"] = secret
    env["AIDLC_TRUST_DIR"] = str(SCRATCH_ROOT / f"{project.name}-trust")
    return env


def new_project(prefix: str) -> Path:
    project = Path(tempfile.mkdtemp(prefix=prefix, dir=str(SCRATCH_ROOT)))
    subprocess.run(["git", "init", "-q"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.email", "aidlc-tests@example.invalid"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.name", "AI-DLC Tests"], cwd=project, check=True)
    subprocess.run(["git", "commit", "--allow-empty", "-qm", "baseline"], cwd=project, check=True)
    return project


def cleanup(project: Path) -> None:
    shutil.rmtree(project, ignore_errors=True)
    shutil.rmtree(SCRATCH_ROOT / f"{project.name}-trust", ignore_errors=True)


def run_producer(project: Path, *args: str, secret=TRUST_SECRET) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["npx", "--no-install", "--prefix", str(REPO_ROOT), "tsx", str(TOOL), *args],
        cwd=project,
        env=environment(project, secret),
        capture_output=True,
        text=True,
    )


def run_orchestrate(project: Path, *args: str) -> dict:
    result = subprocess.run(
        ["npx", "--no-install", "--prefix", str(REPO_ROOT), "tsx", str(ORCHESTRATE), *args],
        cwd=project,
        env=environment(project),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


def write_build_config(project: Path, test_output="22 passed, 0 failed", secret_argument="") -> None:
    suffix = [secret_argument] if secret_argument else []
    config = {
        "version": "1",
        "stage": "build-and-test",
        "commands": [
            {"id": "build", "role": "build", "argv": ["node", "-e", "process.stdout.write('build ok')", *suffix]},
            {"id": "test", "role": "test", "argv": ["node", "-e", f"process.stdout.write({test_output!r})", *suffix]},
            {"id": "check", "role": "check", "argv": ["node", "-e", "process.stdout.write('lint passed')", *suffix]},
        ],
        "artifacts": [{"id": "bundle", "path": "dist/app.js"}],
    }
    write(project / ".aidlc" / "evidence-commands.json", json.dumps(config))
    write(project / "dist" / "app.js", "substantive build artifact")


def write_semantic_config(project: Path, stage: str, sensor: str, argv=None) -> None:
    config = {
        "version": "1",
        "stage": stage,
        "commands": [{
            "id": f"{sensor}-checker",
            "role": "semantic",
            "sensor": sensor,
            "argv": argv or ["loeyae-aidlc", "check", "--sensor", sensor],
        }],
    }
    write(project / ".aidlc" / "evidence-commands.json", json.dumps(config))


def evidence_path(project: Path, stage="build-and-test", sensor="build-test-evidence") -> Path:
    return project / ".aidlc" / "evidence" / stage / f"{sensor}.json"


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in sorted(value.items()) if key != "integrity"}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def verify_signature(payload: dict, secret=TRUST_SECRET) -> bool:
    encoded = json.dumps(canonical(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    expected = hmac.new(secret.encode(), encoded, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, payload["integrity"]["signature"])


def commit_all(project: Path, message="fixture") -> None:
    subprocess.run(["git", "add", "-A"], cwd=project, check=True)
    subprocess.run(["git", "commit", "-qm", message], cwd=project, check=True)


def test_success_signature_and_secret_redaction() -> None:
    project = new_project("aidlc-evidence-success-")
    try:
        marker = "api_key=TOP-SECRET-VALUE"
        write_build_config(project, secret_argument=marker)
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 0, result.stderr
        payload = json.loads(evidence_path(project).read_text())
        assert payload["status"] == "passed"
        assert payload["producer"]["name"] == "loeyae-aidlc-evidence"
        assert payload["tests"] == {"total": 22, "passed": 22, "failed": 0, "skipped": 0}
        assert payload["source_revision"]["worktree_digest"]
        assert len(payload["commands"][0]["argv_digest"]) == 64
        assert "argv" not in payload["commands"][0]
        assert marker not in evidence_path(project).read_text()
        assert verify_signature(payload)
        tampered = dict(payload)
        tampered["status"] = "failed"
        assert not verify_signature(tampered)
    finally:
        cleanup(project)


def test_missing_and_short_secret_fail_closed() -> None:
    for secret in (None, "too-short"):
        project = new_project("aidlc-evidence-secret-")
        try:
            write_build_config(project)
            result = run_producer(project, "run", "--stage", "build-and-test", secret=secret)
            assert result.returncode == 2
            assert "AIDLC_TRUST_SECRET" in result.stderr
            assert not evidence_path(project).exists()
        finally:
            cleanup(project)


def test_failed_run_preserves_existing_evidence() -> None:
    project = new_project("aidlc-evidence-failure-")
    try:
        write_build_config(project, "1 failed, 0 passed")
        output = evidence_path(project)
        write(output, "existing evidence")
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 2
        assert output.read_text() == "existing evidence"
        assert not any(".tmp-" in path.name for path in output.parent.iterdir())
    finally:
        cleanup(project)


def test_revision_clean_staged_unstaged_and_untracked() -> None:
    project = new_project("aidlc-evidence-revision-")
    try:
        write_build_config(project)
        write(project / "src" / "base.txt", "baseline source\n")
        commit_all(project)
        assert subprocess.check_output(["git", "status", "--porcelain"], cwd=project, text=True) == ""

        assert run_producer(project, "run", "--stage", "build-and-test").returncode == 0
        clean = json.loads(evidence_path(project).read_text())["source_revision"]
        assert clean["dirty"] is False

        write(project / "src" / "base.txt", "staged source change\n")
        subprocess.run(["git", "add", "src/base.txt"], cwd=project, check=True)
        assert run_producer(project, "run", "--stage", "build-and-test").returncode == 0
        staged = json.loads(evidence_path(project).read_text())["source_revision"]
        assert staged["dirty"] is True and staged["worktree_digest"] != clean["worktree_digest"]

        subprocess.run(["git", "reset", "--hard", "-q", "HEAD"], cwd=project, check=True)
        write(project / "src" / "base.txt", "unstaged source change\n")
        assert run_producer(project, "run", "--stage", "build-and-test").returncode == 0
        unstaged = json.loads(evidence_path(project).read_text())["source_revision"]
        assert unstaged["dirty"] is True and unstaged["worktree_digest"] != clean["worktree_digest"]

        subprocess.run(["git", "reset", "--hard", "-q", "HEAD"], cwd=project, check=True)
        write(project / "src" / "untracked.txt", "untracked source\n")
        assert run_producer(project, "run", "--stage", "build-and-test").returncode == 0
        untracked = json.loads(evidence_path(project).read_text())["source_revision"]
        assert untracked["dirty"] is True and untracked["worktree_digest"] != clean["worktree_digest"]
    finally:
        cleanup(project)


def test_builtin_semantic_checker_and_arbitrary_command_rejection() -> None:
    project = new_project("aidlc-evidence-semantic-")
    try:
        write(
            project / "docs" / "aidlc" / "construction" / "code-review.md",
            "# Spec axis: passed\n# Standards axis: passed\nReviewer: quality-bot\n"
            "issues_found: 1\nissues_resolved: 1\nissues_open: 0\nReviewed src/main.ts\n",
        )
        write_semantic_config(project, "code-review", "review-evidence")
        result = run_producer(project, "run", "--stage", "code-review", "--sensor", "review-evidence")
        assert result.returncode == 0, result.stderr
        payload = json.loads(evidence_path(project, "code-review", "review-evidence").read_text())
        assert payload["checker"]["id"] == "builtin:review-evidence"
        assert payload["reviewer"] == "quality-bot"
        assert verify_signature(payload)

        write_semantic_config(
            project,
            "code-review",
            "review-evidence",
            ["node", "-e", "process.stdout.write('{}')"],
        )
        rejected = run_producer(project, "run", "--stage", "code-review", "--sensor", "review-evidence")
        assert rejected.returncode == 2
        assert "must declare the built-in command" in rejected.stderr
    finally:
        cleanup(project)


def test_symlink_boundaries() -> None:
    # Config symlink.
    project = new_project("aidlc-evidence-symlink-config-")
    try:
        write_build_config(project)
        real_config = project / ".aidlc" / "real-config.json"
        real_config.write_text((project / ".aidlc" / "evidence-commands.json").read_text())
        link = project / ".aidlc" / "config-link.json"
        link.symlink_to(real_config)
        result = run_producer(project, "run", "--stage", "build-and-test", "--config", ".aidlc/config-link.json")
        assert result.returncode == 2 and "link" in result.stderr.lower()
    finally:
        cleanup(project)

    # CWD symlink.
    project = new_project("aidlc-evidence-symlink-cwd-")
    try:
        write_build_config(project)
        (project / "real-cwd").mkdir()
        (project / "cwd-link").symlink_to(project / "real-cwd", target_is_directory=True)
        config = json.loads((project / ".aidlc" / "evidence-commands.json").read_text())
        config["commands"][0]["cwd"] = "cwd-link"
        (project / ".aidlc" / "evidence-commands.json").write_text(json.dumps(config))
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 2 and "link" in result.stderr.lower()
    finally:
        cleanup(project)

    # Artifact symlink.
    project = new_project("aidlc-evidence-symlink-artifact-")
    try:
        write_build_config(project)
        (project / "dist" / "app.js").unlink()
        write(project / "real-artifact.js", "real artifact")
        (project / "dist" / "app.js").symlink_to(project / "real-artifact.js")
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 2 and "link" in result.stderr.lower()
    finally:
        cleanup(project)

    # Output directory symlink.
    project = new_project("aidlc-evidence-symlink-output-")
    external = Path(tempfile.mkdtemp(prefix="aidlc-evidence-output-", dir=str(SCRATCH_ROOT)))
    try:
        write_build_config(project)
        target = project / ".aidlc" / "evidence" / "build-and-test"
        target.parent.mkdir(parents=True)
        target.symlink_to(external, target_is_directory=True)
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 2 and "link" in result.stderr.lower()
        assert not (external / "build-test-evidence.json").exists()
    finally:
        cleanup(project)
        shutil.rmtree(external, ignore_errors=True)


def test_concurrent_producer_has_single_writer() -> None:
    project = new_project("aidlc-evidence-concurrent-")
    try:
        write_build_config(project)
        config_path = project / ".aidlc" / "evidence-commands.json"
        config = json.loads(config_path.read_text())
        config["commands"][0]["argv"] = ["node", "-e", "setTimeout(() => process.stdout.write('build ok'), 500)"]
        config_path.write_text(json.dumps(config))
        command = ["npx", "--no-install", "--prefix", str(REPO_ROOT), "tsx", str(TOOL), "run", "--stage", "build-and-test"]
        first = subprocess.Popen(command, cwd=project, env=environment(project), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(0.15)
        second = subprocess.Popen(command, cwd=project, env=environment(project), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        first.communicate()
        second.communicate()
        codes = sorted([first.returncode, second.returncode])
        assert codes == [0, 2], codes
        payload = json.loads(evidence_path(project).read_text())
        assert verify_signature(payload)
        assert not (Path(str(evidence_path(project)) + ".producer.lock")).exists()
    finally:
        cleanup(project)


def create_declared_artifacts(project: Path, produces: list) -> None:
    for pattern in produces:
        if pattern.startswith(".aidlc/evidence/"):
            continue
        value = pattern.replace("{unit-name}", "test-unit").replace("{unit-id}", "test-unit")
        if value.endswith("/"):
            value += "artifact.md"
        write(project / value, f"# Generated {value}\nREQ-E2E-001 provides substantive traceable workflow content.\n")


def reach_stage(project: Path, target: str) -> dict:
    assert run_orchestrate(project, "next", "--scope", "feature")["kind"] == "print"
    for _ in range(20):
        directive = run_orchestrate(project, "next")
        assert directive["kind"] == "run-stage", directive
        if directive["stage"] == target:
            return directive
        create_declared_artifacts(project, directive.get("produces", []))
        args = ["report", "--stage", directive["stage"], "--result", "completed"]
        if directive.get("completion_contract") == "instruction_only":
            args.extend(["--instruction-ack", directive["stage"]])
        report = run_orchestrate(project, *args)
        assert report["kind"] == "print", report
    raise AssertionError(f"stage {target} was not reached")


def test_producer_output_passes_orchestrator() -> None:
    project = new_project("aidlc-evidence-orchestrator-")
    try:
        directive = reach_stage(project, "prd-generation")
        assert "prd-completeness" in directive["sensors"]
        write(
            project / "docs" / "aidlc" / "ideation" / "prd.md",
            "# Overview\nProduct context and verified scope.\n## Goals\nMeasurable delivery.\n"
            "## Features\nFR-001 user authentication.\n### Acceptance Criteria\nValid users sign in.\n"
            "## Non-goals\nBilling excluded.\n## Questions\nNone.\n## Sources\nStakeholder interview.\n"
            "Clarification consistency passed.\nREQ-E2E-001 traces this complete product requirement.\n",
        )
        write_semantic_config(project, "prd-generation", "prd-completeness")
        produced = run_producer(project, "run", "--stage", "prd-generation", "--sensor", "prd-completeness")
        assert produced.returncode == 0, produced.stderr
        payload = json.loads(evidence_path(project, "prd-generation", "prd-completeness").read_text())
        assert payload["checker"]["id"] == "builtin:prd-completeness"
        reported = run_orchestrate(project, "report", "--stage", "prd-generation", "--result", "completed")
        assert reported["kind"] == "print", reported
    finally:
        cleanup(project)


if __name__ == "__main__":
    test_success_signature_and_secret_redaction()
    test_missing_and_short_secret_fail_closed()
    test_failed_run_preserves_existing_evidence()
    test_revision_clean_staged_unstaged_and_untracked()
    test_builtin_semantic_checker_and_arbitrary_command_rejection()
    test_symlink_boundaries()
    test_concurrent_producer_has_single_writer()
    test_producer_output_passes_orchestrator()
    print("8 evidence producer test groups passed")
