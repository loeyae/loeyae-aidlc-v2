"""Integration tests for the controlled build/test evidence producer."""

import json
import os
import shutil
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOOL = os.path.join(REPO_ROOT, "core", "tools", "aidlc-evidence.ts")


def run_producer(project: str, *args: str) -> subprocess.CompletedProcess[str]:
    command = [
        "npx",
        "--no-install",
        "--prefix",
        REPO_ROOT,
        "tsx",
        TOOL,
        *args,
    ]
    return subprocess.run(command, cwd=project, capture_output=True, text=True)


def write_config(project: str, test_output: str = "22 passed, 0 failed") -> None:
    os.makedirs(os.path.join(project, ".aidlc"), exist_ok=True)
    config = {
        "version": "1",
        "stage": "build-and-test",
        "commands": [
            {"id": "build", "role": "build", "argv": ["node", "-e", "process.stdout.write('build ok')"]},
            {"id": "test", "role": "test", "argv": ["node", "-e", f"process.stdout.write({test_output!r})"]},
            {"id": "check", "role": "check", "argv": ["node", "-e", "process.stdout.write('lint passed')"]},
        ],
        "artifacts": [{"id": "bundle", "path": "dist/app.js"}],
    }
    with open(os.path.join(project, ".aidlc", "evidence-commands.json"), "w") as handle:
        json.dump(config, handle)
    os.makedirs(os.path.join(project, "dist"), exist_ok=True)
    with open(os.path.join(project, "dist", "app.js"), "w") as handle:
        handle.write("artifact")


def test_successful_production() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-evidence-success-")
    try:
        write_config(project)
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode == 0, result.stderr
        output = os.path.join(project, ".aidlc", "evidence", "build-and-test", "build-test-evidence.json")
        assert os.path.isfile(output)
        with open(output) as handle:
            evidence = json.load(handle)
        assert evidence["status"] == "passed"
        assert evidence["producer"]["mode"] == "controlled"
        assert evidence["tests"] == {"total": 22, "passed": 22, "failed": 0, "skipped": 0}
        assert evidence["commands"][1]["exit_code"] == 0
        assert evidence["artifacts"][0]["sha256"]
    finally:
        shutil.rmtree(project)


def test_failed_run_does_not_replace_existing_evidence() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-evidence-failure-")
    try:
        write_config(project, "1 failed, 0 passed")
        evidence_dir = os.path.join(project, ".aidlc", "evidence", "build-and-test")
        os.makedirs(evidence_dir, exist_ok=True)
        output = os.path.join(evidence_dir, "build-test-evidence.json")
        with open(output, "w") as handle:
            handle.write("existing evidence")
        result = run_producer(project, "run", "--stage", "build-and-test")
        assert result.returncode != 0
        with open(output) as handle:
            assert handle.read() == "existing evidence"
        assert not any(name.startswith("build-test-evidence.json.tmp-") for name in os.listdir(evidence_dir))
    finally:
        shutil.rmtree(project)


def test_command_selection_cannot_escape_allowlist() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-evidence-allowlist-")
    try:
        write_config(project)
        result = run_producer(project, "run", "--stage", "build-and-test", "--command-id", "not-allowed")
        assert result.returncode != 0
        assert "not in the allowlist" in result.stderr
    finally:
        shutil.rmtree(project)


def test_semantic_checker_production() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-evidence-semantic-")
    try:
        payload = {
            "status": "passed",
            "spec_axis": "passed",
            "standards_axis": "passed",
            "reviewer": "checker-agent",
            "files_reviewed": ["src/main.ts"],
            "issues_found": 1,
            "issues_resolved": 1,
            "issues_open": 0,
        }
        payload_text = json.dumps(payload, separators=(",", ":"))
        config = {
            "version": "1",
            "stage": "code-review",
            "commands": [{
                "id": "review-checker",
                "role": "semantic",
                "sensor": "review-evidence",
                "argv": ["node", "-e", f"process.stdout.write({json.dumps(payload_text)})"],
            }],
        }
        os.makedirs(os.path.join(project, ".aidlc"), exist_ok=True)
        with open(os.path.join(project, ".aidlc", "evidence-commands.json"), "w") as handle:
            json.dump(config, handle)
        result = run_producer(project, "run", "--stage", "code-review", "--sensor", "review-evidence")
        assert result.returncode == 0, result.stderr
        output = os.path.join(project, ".aidlc", "evidence", "code-review", "review-evidence.json")
        with open(output) as handle:
            evidence = json.load(handle)
        assert evidence["producer"]["mode"] == "controlled"
        assert evidence["checker"]["id"] == "review-checker"
        assert evidence["spec_axis"] == "passed"
    finally:
        shutil.rmtree(project)


def test_semantic_checker_cannot_forge_common_fields() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-evidence-semantic-forge-")
    try:
        payload = {"status": "passed", "producer": {"mode": "controlled"}}
        payload_text = json.dumps(payload, separators=(",", ":"))
        config = {
            "version": "1",
            "stage": "code-review",
            "commands": [{
                "id": "review-checker",
                "role": "semantic",
                "sensor": "review-evidence",
                "argv": ["node", "-e", f"process.stdout.write({json.dumps(payload_text)})"],
            }],
        }
        os.makedirs(os.path.join(project, ".aidlc"), exist_ok=True)
        with open(os.path.join(project, ".aidlc", "evidence-commands.json"), "w") as handle:
            json.dump(config, handle)
        result = run_producer(project, "run", "--stage", "code-review", "--sensor", "review-evidence")
        assert result.returncode != 0
        assert "producer-controlled field producer" in result.stderr
        assert not os.path.exists(os.path.join(project, ".aidlc", "evidence", "code-review", "review-evidence.json"))
    finally:
        shutil.rmtree(project)


if __name__ == "__main__":
    test_successful_production()
    test_failed_run_does_not_replace_existing_evidence()
    test_command_selection_cannot_escape_allowlist()
    test_semantic_checker_production()
    test_semantic_checker_cannot_forge_common_fields()
    print("5 evidence producer tests passed")
