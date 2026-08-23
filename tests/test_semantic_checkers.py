"""Integration tests for all deterministic semantic checkers."""

import json
import os
import shutil
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHECKER = os.path.join(REPO_ROOT, "core", "tools", "aidlc-semantic-checks.ts")
SENSORS = [
    "review-evidence", "test-quality", "contract-baseline", "functional-design-completeness",
    "nfr-coverage", "infrastructure-completeness", "implementation-report", "frontend-platform-spec",
    "framework-compliance", "subagent-evidence", "template-completeness", "recovery-evidence",
    "prd-completeness", "diagram-contract", "design-intent-coverage", "ui-design-alignment",
]


def write(project: str, path: str, content: str) -> None:
    target = os.path.join(project, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as handle:
        handle.write(content)


def fixture(project: str) -> None:
    write(project, "docs/aidlc/construction/code-review.md", """Spec: passed
Standards: passed
reviewer: deterministic-checker
issues_found: 0
issues_resolved: 0
issues_open: 0
Reviewed files: src/main.ts
Conclusion: passed
""")
    write(project, "docs/aidlc/inception/application-design/test-cases/_index.md", "# UC-D-001 Registration\n")
    write(project, "src/test/main.test.ts", "describe('UC-D-001', () => { it('passes', () => {}) })\n")
    write(project, ".aidlc/tdd/red-green.json", json.dumps({"red_seen": True, "green_seen": True, "tests_total": 1, "tests_failed": 0}))
    write(project, "docs/aidlc/product/contracts.md", """Owner: platform-team
Consumers: service-a, service-b
Version: v1
Compatibility: backward-compatible
""")
    write(project, "docs/aidlc/construction/functional-design.md", """UC-D-001 API interface
Data source: database repository
Error handling: exception and timeout
""")
    write(project, "docs/aidlc/construction/nfr-requirements.md", """NFR-001 performance
Acceptance criterion: P95 latency < 200ms
Measurement: load test
Verified: true
""")
    write(project, "docs/aidlc/construction/infrastructure-design.md", """deployment: service provisioned true
resources: database provisioned true
migration: database migration provisioned true
rollback: previous version provisioned true
runtime dependencies: service provisioned true
""")
    write(project, ".aidlc/evidence/build-and-test/build-test-evidence.json", "{}")
    write(project, ".aidlc/evidence/code-review/review-evidence.json", "{}")
    write(project, "docs/aidlc/construction/implementation-report.md", """all_gates_passed: true
scope: feature
stages_completed: 3
Evidence: .aidlc/evidence/build-and-test/build-test-evidence.json
Evidence: .aidlc/evidence/code-review/review-evidence.json
""")
    write(project, "docs/aidlc/frontend-platform-spec.md", """Layout primitives: stack, grid, container, flex
Component mapping: button, form, table, dialog, navigation
CSS constraints: spacing, responsive, tokens
""")
    write(project, "pom.xml", "<dependency>loeyae-boot</dependency>\n")
    write(project, "docs/aidlc/framework-check.md", "Loeyae framework skill loaded\n[x] compliance check passed\n")
    write(project, ".aidlc/subagents/result.json", json.dumps({"agent_id": "agent-1", "status": "completed", "success": True}))
    write(project, "docs/aidlc/construction/build-and-test/build-instructions.md", "Build instructions with environment and commands. This is complete.\n")
    write(project, "docs/aidlc/construction/build-and-test/unit-test-instructions.md", "Unit test instructions with scope and commands. This is complete.\n")
    write(project, ".aidlc/context-compacted", "true\n")
    write(project, "docs/aidlc/state.md", "context_compacted: true\n")
    write(project, "docs/aidlc/handoff.md", "State restored and handoff recorded.\n")
    write(project, "docs/aidlc/ideation/prd.md", """# Overview
# Goals
# Features
# Non-goals
# Questions
# Sources
FR-001: Registration
Acceptance criteria: registration succeeds
Clarification consistency: passed
""")
    write(project, "docs/aidlc/inception/application-design.md", "设计项 [意图:删除]\n")
    write(project, "docs/aidlc/inception/application-design/unit-of-work.md", "删除\n允许修改范围\n完成证据\n")
    write(project, "docs/aidlc/inception/ui-design/page-plan.md", "PAGE-001 Registration\n")
    write(project, "docs/aidlc/inception/ui-mock/web.html", """<html><style>.box { display: block; }</style><body>PAGE-001<div class="mock-box">condition visible</div></body></html>""")
    write(project, "docs/aidlc/inception/requirements/business-flows.md", "# Business flows\n\nREQ-001\n")
    write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox="0 0 400 300" width="400" height="300" role="img"><title>Requirements flow</title><desc>FR-001 business flow</desc><g><rect data-node="start" x="40" y="40" width="100" height="50"/><rect data-node="done" x="260" y="40" width="100" height="50"/><path data-edge="start-done" data-edge-arrow="start-done" data-arrow-target="done:left" d="M140 65 L260 65" marker-end="url(#arrow)"/><text>FR-001</text></g></svg>""")
    write(project, "docs/aidlc/inception/requirements/business-flows.diagram.json", json.dumps({
        "version": 1,
        "document": "docs/aidlc/inception/requirements/business-flows.md",
        "diagrams": [{
            "id": "requirements-flow", "output": "business-flows.svg", "title": "Requirements flow",
            "description": "A minimal approved requirements flow.", "diagramType": "flowchart",
            "canvas": {"width": 400, "height": 300},
            "nodes": [
                {"id": "start", "shape": "round", "label": "开始", "x": 40, "y": 40, "width": 100, "height": 50},
                {"id": "done", "shape": "round", "label": "完成", "x": 260, "y": 40, "width": 100, "height": 50}
            ],
            "edges": [{"id": "start-done", "from": "start", "fromPort": "right", "to": "done", "toPort": "left", "kind": "directed", "points": [[140, 65], [260, 65]], "label": {"text": "完成", "x": 200, "y": 50}}],
            "designNotes": {
                "intent": "展示需求从开始到完成的单一流程",
                "semanticModes": ["process-flow"],
                "visualSemantics": [],
                "legendDecision": {"status": "not-needed", "reason": "只有一种有向连线视觉语义且没有复用差异"},
                "splitDecision": {"status": "not-needed", "reason": "图只表达一个短流程目标"}
            }
        }]
    }))


def run_checker(project: str, sensor: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", CHECKER, "--sensor", sensor],
        cwd=project,
        capture_output=True,
        text=True,
    )


def test_all_checkers_pass_on_realistic_fixture() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-semantic-checkers-")
    try:
        fixture(project)
        for sensor in SENSORS:
            result = run_checker(project, sensor)
            assert result.returncode == 0, f"{sensor}: {result.stderr}"
            payload = json.loads(result.stdout)
            assert payload["status"] in ("passed", "verified", "not_applicable"), sensor
    finally:
        shutil.rmtree(project)


def test_checker_fails_closed_when_required_artifact_is_removed() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-semantic-checkers-fail-")
    try:
        fixture(project)
        os.remove(os.path.join(project, "docs/aidlc/ideation/prd.md"))
        result = run_checker(project, "prd-completeness")
        assert result.returncode != 0
        assert "PRD artifact is missing" in result.stderr
    finally:
        shutil.rmtree(project)


def test_checker_rejects_legacy_diagram_without_structured_contract() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-semantic-checkers-migration-")
    try:
        fixture(project)
        manifest_path = os.path.join(project, "docs/aidlc/inception/requirements/business-flows.diagram.json")
        with open(manifest_path) as handle:
            manifest = json.load(handle)
        del manifest["diagrams"][0]["designNotes"]
        with open(manifest_path, "w") as handle:
            json.dump(manifest, handle)
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "MIGRATION_REQUIRED" in result.stderr
    finally:
        shutil.rmtree(project)


if __name__ == "__main__":
    test_all_checkers_pass_on_realistic_fixture()
    test_checker_fails_closed_when_required_artifact_is_removed()
    test_checker_rejects_legacy_diagram_without_structured_contract()
    print("17 semantic checker tests passed")
