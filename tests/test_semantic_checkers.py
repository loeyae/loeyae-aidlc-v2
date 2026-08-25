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
    write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox="0 0 400 300" width="400" height="300" role="img"><title>Requirements flow</title><desc>FR-001 business flow</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/><text data-text-id="node-start" x="90" y="70">开始</text></g><g data-node="done" data-node-shape="round"><rect x="260" y="40" width="100" height="50"/><text data-text-id="node-done" x="310" y="70">完成</text></g><path data-edge="start-done" data-from="start" data-from-port="right" data-to="done" data-to-port="left" data-edge-label="start-done" d="M140 65 L260 65" marker-end="url(#arrow)"/><path data-edge-arrow="start-done" data-edge="start-done" data-arrow-target="done:left" d="M252 57 L260 65 L252 73"/><g data-edge-label="start-done"><text data-text-id="label-start-done" x="200" y="50">完成</text></g><text data-text-id="requirement-reference" x="200" y="150">FR-001</text></svg>""")
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
                "splitDecision": {"status": "not-needed", "reason": "图只表达一个短流程目标"},
                "layout": {
                    "direction": "LR",
                    "mainAxis": 65,
                    "layerTolerance": 24,
                    "symmetryGroups": [],
                    "mergeNodes": [],
                    "mainFlow": {"entryNodeId": "start", "exitNodeIds": ["done"], "nodeIds": ["start", "done"], "edgeIds": ["start-done"]},
                    "loopLanes": [],
                    "branchLayerExceptions": [],
                    "branchPortExceptions": [],
                    "readabilityEvidence": {
                        "normal": {"status": "UNVERIFIED", "evidence": "source-only fixture"},
                        "fit": {"status": "UNVERIFIED", "evidence": "source-only fixture"},
                        "zoom": {"status": "UNVERIFIED", "evidence": "source-only fixture"}
                    }
                }
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
            if sensor == "diagram-contract":
                assert payload["geometry_status"] == "passed"
                assert payload["render_preflight_status"] == "passed"
                assert payload["render_status"] == "unverified"
                assert payload["layout_contract_valid"] is True
                assert payload["annotation_mapping_valid"] is True
                assert payload["risk"]["level"] == "LOW"
                assert payload["risk"]["score"] == 1
                assert payload["risk"]["reasons"] == ["browser-sensitive SVG features"]

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


def test_diagram_003_fixed_regression() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-003-regression-")
    try:
        source = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-003")
        shutil.copytree(source, project, dirs_exist_ok=True)
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["main_flow_valid"] is True
        assert payload["loop_lanes_valid"] is True
        assert payload["decision_exit_valid"] is True
        assert payload["edge_intersection_status"] == "passed"
        assert payload["collinear_overlap_status"] == "passed"
        assert payload["target_port_direction_status"] == "passed"
        assert payload["visible_arrow_mapping_status"] == "passed"
    finally:
        shutil.rmtree(project)


def diagram_manifest_path(project: str) -> str:
    return os.path.join(project, "docs", "aidlc", "inception", "requirements", "business-flows.diagram.json")


def mutate_diagram(project: str, mutation) -> None:
    path = diagram_manifest_path(project)
    with open(path) as handle:
        manifest = json.load(handle)
    mutation(manifest["diagrams"][0], project)
    with open(path, "w") as handle:
        json.dump(manifest, handle)


def test_diagram_geometry_gates_fail_closed() -> None:
    cases = [
        ("node collision", lambda diagram, _: diagram["nodes"].__setitem__(1, {**diagram["nodes"][1], "x": 100}), "geometric collision"),
        ("edge collision", lambda diagram, _: diagram["nodes"].append({"id": "middle", "shape": "rect", "label": "中间", "x": 180, "y": 40, "width": 60, "height": 50}), "collides with non-endpoint node middle"),
        ("collinear overlap", lambda diagram, _: (
            diagram["nodes"].append({"id": "other", "shape": "rect", "label": "旁路", "x": 40, "y": 110, "width": 100, "height": 50}),
            diagram["edges"].append({"id": "overlap", "from": "other", "fromPort": "right", "to": "done", "toPort": "left", "kind": "directed", "points": [[140, 135], [180, 135], [180, 65], [260, 65]]}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "other"], "exitNodeIds": ["done"], "nodeIds": ["start", "done", "other"], "edgeIds": ["start-done", "overlap"]}),
            diagram["designNotes"]["layout"]["mergeNodes"].append({"nodeId": "done", "reason": "负例显式允许重复入边以验证共线重叠门禁"}),
        ), "COLLINEAR_OVERLAP"),
        ("edge crossing", lambda diagram, _: (
            diagram["nodes"][0].update({"y": 125}),
            diagram["nodes"][1].update({"y": 125}),
            diagram["nodes"].extend([
                {"id": "top", "shape": "rect", "label": "上", "x": 180, "y": 40, "width": 40, "height": 50},
                {"id": "bottom", "shape": "rect", "label": "下", "x": 180, "y": 240, "width": 40, "height": 50},
            ]),
            diagram["edges"][0].update({"points": [[140, 150], [260, 150]]}),
            diagram["edges"].append({"id": "vertical", "from": "top", "fromPort": "bottom", "to": "bottom", "toPort": "top", "kind": "directed", "points": [[200, 90], [200, 240]]}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "top"], "exitNodeIds": ["done", "bottom"], "nodeIds": ["start", "done", "top", "bottom"], "edgeIds": ["start-done", "vertical"]}),
            diagram["canvas"].update({"height": 340}),
        ), "EDGE_CROSSING"),
        ("label collision", lambda diagram, _: (
            diagram["nodes"].append({"id": "middle", "shape": "rect", "label": "中间", "x": 180, "y": 20, "width": 60, "height": 42}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "middle"], "exitNodeIds": ["done", "middle"], "nodeIds": ["start", "done", "middle"]}),
            diagram["edges"][0]["label"].update({"x": 200, "y": 50}),
        ), "LABEL_COLLISION"),
        ("group containment", lambda diagram, _: diagram.update({"groups": [
            {"id": "a", "semanticType": "exclusive", "members": ["start"], "x": 20, "y": 20, "width": 80, "height": 80},
        ]}), "GROUP_CONTAINMENT"),
        ("group overlap", lambda diagram, _: diagram.update({
            "canvas": {"width": 440, "height": 300},
            "groups": [
                {"id": "a", "semanticType": "exclusive", "members": ["start"], "x": 16, "y": 16, "width": 180, "height": 100},
                {"id": "b", "semanticType": "exclusive", "members": ["done"], "x": 160, "y": 16, "width": 224, "height": 100},
            ],
        }), "groups a and b have geometric overlap"),
        ("legend coverage", lambda diagram, _: diagram.update({
            "legend": {"placement": "bottom", "items": [{"id": "directed-edge", "label": "流程", "meaning": "有向关系", "sample": {"kind": "edge", "ref": "start-done"}, "targets": [{"kind": "edge", "ref": "start-done"}]}]},
            "designNotes": {**diagram["designNotes"], "legendDecision": {"status": "required", "reason": "有向关系需要图例"}},
        }), "SVG legend coverage is incomplete"),
        ("sequence lifeline coordinate", lambda diagram, project: (
            diagram.update({"diagramType": "sequence"}),
            diagram["designNotes"].update({"semanticModes": ["process-flow"]}),
            write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox=\"0 0 400 300\" width=\"400\" height=\"300\" role=\"img\"><title>Requirements sequence</title><desc>FR-001 sequence</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g><rect data-node=\"start\" x=\"40\" y=\"40\" width=\"100\" height=\"50\"/><rect data-node=\"done\" x=\"260\" y=\"40\" width=\"100\" height=\"50\"/><line data-lifeline-for=\"start\" x1=\"100\" x2=\"100\" y1=\"90\" y2=\"260\"/><line data-lifeline-for=\"done\" x1=\"310\" x2=\"310\" y1=\"90\" y2=\"260\"/><path data-edge=\"start-done\" data-from=\"start\" data-from-port=\"right\" data-to=\"done\" data-to-port=\"left\" data-edge-label=\"start-done\" d=\"M140 65 L260 65\" marker-end=\"url(#arrow)\"/><path data-edge-arrow=\"start-done\" data-edge=\"start-done\" data-arrow-target=\"done:left\" d=\"M252 57 L260 65 L252 73\"/><g data-edge-label=\"start-done\"><text data-text-id=\"label-start-done\" x=\"200\" y=\"50\">完成</text></g><text data-text-id=\"requirement-reference\">FR-001</text></g></svg>"""),
        ), "sequence lifeline coordinate is invalid"),
        ("endpoint mismatch", lambda diagram, _: diagram["edges"][0].update({"points": [[143, 65], [260, 65]]}), "first point does not match fromPort"),
        ("non-orthogonal path", lambda diagram, _: diagram["edges"][0].update({"points": [[140, 65], [200, 80], [260, 65]]}), "is not orthogonal"),
        ("viewport overflow", lambda diagram, _: diagram["nodes"][1].update({"x": 350}), "is outside the canvas"),
        ("canvas too empty", lambda diagram, _: diagram["canvas"].update({"width": 2000, "height": 2000}), "CANVAS_TOO_EMPTY"),
    ]
    for name, mutation, expected in cases:
        project = tempfile.mkdtemp(prefix=f"aidlc-diagram-geometry-{name.replace(' ', '-')}-")
        try:
            fixture(project)
            mutate_diagram(project, mutation)
            result = run_checker(project, "diagram-contract")
            assert result.returncode != 0, name
            assert expected in result.stderr, f"{name}: {result.stderr}"
        finally:
            shutil.rmtree(project)


def test_diagram_geometry_gates_pass_on_valid_sequence() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-geometry-valid-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, project: (
            diagram.update({"diagramType": "sequence"}),
            diagram["designNotes"].update({"semanticModes": ["process-flow"]}),
            write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox=\"0 0 400 300\" width=\"400\" height=\"300\" role=\"img\"><title>Requirements sequence</title><desc>FR-001 sequence</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g><rect data-node=\"start\" x=\"40\" y=\"40\" width=\"100\" height=\"50\"/><rect data-node=\"done\" x=\"260\" y=\"40\" width=\"100\" height=\"50\"/><line data-lifeline-for=\"start\" x1=\"90\" x2=\"90\" y1=\"90\" y2=\"260\"/><line data-lifeline-for=\"done\" x1=\"310\" x2=\"310\" y1=\"90\" y2=\"260\"/><path data-edge=\"start-done\" data-from=\"start\" data-from-port=\"right\" data-to=\"done\" data-to-port=\"left\" data-edge-label=\"start-done\" d=\"M140 65 L260 65\" marker-end=\"url(#arrow)\"/><path data-edge-arrow=\"start-done\" data-edge=\"start-done\" data-arrow-target=\"done:left\" d=\"M252 57 L260 65 L252 73\"/><g data-edge-label=\"start-done\"><text data-text-id=\"label-start-done\" x=\"200\" y=\"50\">完成</text></g><text data-text-id=\"requirement-reference\">FR-001</text></g></svg>""")
        ))
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
    finally:
        shutil.rmtree(project)



def test_diagram_risk_assessment() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-risk-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: diagram["edges"][0].update({"points": [[140, 65], [180, 65], [180, 80], [240, 80], [240, 65], [260, 65]]}))
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["risk"]["level"] == "MEDIUM"
        assert payload["risk"]["score"] == 3
        assert payload["risk"]["reasons"] == ["browser-sensitive SVG features", "complex edge routing"]
    finally:
        shutil.rmtree(project)

def directional_fixture(project: str, direction: str) -> None:
    if direction == "TB":
        nodes = [
            {"id": "oms", "shape": "rect", "label": "OMS", "x": 260, "y": 40, "width": 100, "height": 50},
            {"id": "dmall", "shape": "rect", "label": "E-Fulfilment", "x": 760, "y": 40, "width": 180, "height": 50},
            {"id": "receive", "shape": "rect", "label": "接收", "x": 530, "y": 160, "width": 100, "height": 50},
            {"id": "decision", "shape": "diamond", "label": "启用条件", "x": 530, "y": 300, "width": 100, "height": 80},
            {"id": "active", "shape": "round", "label": "ACTIVE", "x": 650, "y": 700, "width": 100, "height": 50},
            {"id": "pending", "shape": "round", "label": "PENDING", "x": 310, "y": 700, "width": 100, "height": 50},
        ]
        edges = [
            {"id": "oms-receive", "from": "oms", "fromPort": "right", "to": "receive", "toPort": "left", "kind": "directed", "points": [[360, 65], [440, 65], [440, 185], [530, 185]]},
            {"id": "dmall-receive", "from": "dmall", "fromPort": "left", "to": "receive", "toPort": "right", "kind": "directed", "points": [[760, 65], [720, 65], [720, 185], [630, 185]]},
            {"id": "receive-decision", "from": "receive", "fromPort": "bottom", "to": "decision", "toPort": "top", "kind": "directed", "points": [[580, 210], [580, 300]]},
            {"id": "decision-active", "from": "decision", "fromPort": "right", "to": "active", "toPort": "top", "kind": "directed", "points": [[630, 340], [700, 340], [700, 700]], "label": {"text": "通过", "x": 680, "y": 320}},
            {"id": "decision-pending", "from": "decision", "fromPort": "left", "to": "pending", "toPort": "top", "kind": "directed", "points": [[530, 340], [360, 340], [360, 700]], "label": {"text": "未通过", "x": 450, "y": 320}},
        ]
        canvas = {"width": 1000, "height": 840}
        layout = {"direction": "TB", "mainAxis": 580, "layerTolerance": 24, "symmetryGroups": [{"nodeIds": ["oms", "dmall"], "tolerance": 1}], "mergeNodes": [{"nodeId": "receive", "reason": "OMS 与 E-Fulfilment 输入汇合后进入云 Mall"}], "mainFlow": {"entryNodeIds": ["oms", "dmall"], "exitNodeIds": ["active", "pending"], "nodeIds": ["oms", "dmall", "receive", "decision", "active", "pending"], "edgeIds": ["oms-receive", "dmall-receive", "receive-decision", "decision-active", "decision-pending"]}, "loopLanes": [], "branchLayerExceptions": [], "branchPortExceptions": []}
    else:
        nodes = [
            {"id": "start", "shape": "round", "label": "完成定店", "x": 40, "y": 225, "width": 100, "height": 50},
            {"id": "decision", "shape": "diamond", "label": "商品类型", "x": 300, "y": 200, "width": 100, "height": 100},
            {"id": "physical", "shape": "rect", "label": "实物加入购物车", "x": 500, "y": 100, "width": 100, "height": 50},
            {"id": "virtual", "shape": "rect", "label": "虚拟商品直接购买", "x": 500, "y": 350, "width": 100, "height": 50},
            {"id": "checkout", "shape": "rect", "label": "结算提交订单", "x": 700, "y": 225, "width": 100, "height": 50},
        ]
        edges = [
            {"id": "start-decision", "from": "start", "fromPort": "right", "to": "decision", "toPort": "left", "kind": "directed", "points": [[140, 250], [300, 250]]},
            {"id": "decision-physical", "from": "decision", "fromPort": "top", "to": "physical", "toPort": "left", "kind": "directed", "points": [[350, 200], [350, 150], [450, 150], [450, 125], [500, 125]], "label": {"text": "实物", "x": 420, "y": 180}},
            {"id": "decision-virtual", "from": "decision", "fromPort": "bottom", "to": "virtual", "toPort": "left", "kind": "directed", "points": [[350, 300], [350, 325], [450, 325], [450, 375], [500, 375]], "label": {"text": "虚拟", "x": 420, "y": 320}},
            {"id": "physical-checkout", "from": "physical", "fromPort": "right", "to": "checkout", "toPort": "top", "kind": "directed", "points": [[600, 125], [750, 125], [750, 225]]},
            {"id": "virtual-checkout", "from": "virtual", "fromPort": "right", "to": "checkout", "toPort": "bottom", "kind": "directed", "points": [[600, 375], [750, 375], [750, 275]]},
        ]
        canvas = {"width": 840, "height": 520}
        layout = {"direction": "LR", "mainAxis": 250, "layerTolerance": 24, "symmetryGroups": [], "mergeNodes": [{"nodeId": "checkout", "reason": "两个商品分支在结算提交订单处汇合"}], "mainFlow": {"entryNodeId": "start", "exitNodeIds": ["checkout"], "nodeIds": ["start", "decision", "physical", "virtual", "checkout"], "edgeIds": ["start-decision", "decision-physical", "decision-virtual", "physical-checkout", "virtual-checkout"]}, "loopLanes": [], "branchLayerExceptions": [], "branchPortExceptions": []}
    layout["readabilityEvidence"] = {
        "normal": {"status": "UNVERIFIED", "evidence": "source-only regression fixture"},
        "fit": {"status": "UNVERIFIED", "evidence": "source-only regression fixture"},
        "zoom": {"status": "UNVERIFIED", "evidence": "source-only regression fixture"},
    }
    def arrow_path(edge: dict) -> str:
        x, y = edge["points"][-1]
        if edge["toPort"] == "top":
            return f"M{x - 6} {y - 10} L{x} {y} L{x + 6} {y - 10}"
        if edge["toPort"] == "bottom":
            return f"M{x - 6} {y + 10} L{x} {y} L{x + 6} {y + 10}"
        if edge["toPort"] == "left":
            return f"M{x - 10} {y - 6} L{x} {y} L{x - 10} {y + 6}"
        return f"M{x + 10} {y - 6} L{x} {y} L{x + 10} {y + 6}"

    svg_nodes = "".join(f'<g data-node="{node["id"]}" data-node-shape="{node["shape"]}"><rect x="{node["x"]}" y="{node["y"]}" width="{node["width"]}" height="{node["height"]}"/><text data-text-id="node-{node["id"]}" x="{node["x"] + node["width"] / 2}" y="{node["y"] + node["height"] / 2 + 5}">{node["label"]}</text></g>' for node in nodes)
    svg_edges = "".join(f'<path data-edge="{edge["id"]}" data-from="{edge["from"]}" data-from-port="{edge["fromPort"]}" data-to="{edge["to"]}" data-to-port="{edge["toPort"]}"' + (f' data-edge-label="{edge["id"]}"' if edge.get("label") else "") + f' d="M{edge["points"][0][0]} {edge["points"][0][1]} ' + " ".join(f'L{point[0]} {point[1]}' for point in edge["points"][1:]) + f'" marker-end="url(#arrow)"/><path data-edge-arrow="{edge["id"]}" data-edge="{edge["id"]}" data-arrow-target="{edge["to"]}:{edge["toPort"]}" d="{arrow_path(edge)}"/>' for edge in edges)
    svg_labels = "".join(f'<g data-edge-label="{edge["id"]}"><text data-text-id="label-{edge["id"]}" x="{edge["label"]["x"]}" y="{edge["label"]["y"]}">{edge["label"]["text"]}</text></g>' for edge in edges if edge.get("label"))
    svg = f'<svg viewBox="0 0 {canvas["width"]} {canvas["height"]}" width="{canvas["width"]}" height="{canvas["height"]}" role="img"><title>Directional regression</title><desc>FR-002 directional regression</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs>{svg_nodes}{svg_edges}{svg_labels}<g data-legend-item="flow"><text data-text-id="legend-flow">流程</text></g><g data-note="layout-note"><text data-text-id="note-layout">布局说明</text></g></svg>'
    manifest = {"version": 1, "document": "docs/aidlc/inception/requirements/business-flows.md", "diagrams": [{"id": f"diagram-{direction.lower()}", "output": "business-flows.svg", "title": "Directional regression", "description": "Directional regression", "diagramType": "flowchart", "canvas": canvas, "nodes": nodes, "edges": edges, "annotations": [{"id": "layout-note", "text": "布局说明", "x": canvas["width"] / 2, "y": canvas["height"] - 50}], "legend": {"placement": "bottom", "items": [{"id": "flow", "label": "流程", "meaning": "业务流程", "sample": {"kind": "edge", "ref": edges[0]["id"]}, "targets": [{"kind": "edge", "ref": edges[0]["id"]}]}]}, "designNotes": {"intent": "验证主阅读方向和业务层级", "semanticModes": ["process-flow"], "visualSemantics": [{"channel": "node-shape", "role": "semantic", "reason": "矩形、菱形和圆角节点分别表达步骤、判断和状态结果"}], "legendDecision": {"status": "required", "reason": "回归夹具显式验证图例顺序"}, "splitDecision": {"status": "not-needed", "reason": "单一流程回归夹具"}, "layout": layout}}]}
    write(project, "docs/aidlc/inception/requirements/business-flows.md", "# Business flows\n\nFR-002\n")
    write(project, "docs/aidlc/inception/requirements/business-flows.diagram.json", json.dumps(manifest))
    write(project, "docs/aidlc/inception/requirements/business-flows.svg", svg)


def test_directional_layout_contracts() -> None:
    for direction in ("TB", "LR"):
        project = tempfile.mkdtemp(prefix=f"aidlc-directional-{direction.lower()}-")
        try:
            directional_fixture(project, direction)
            result = run_checker(project, "diagram-contract")
            assert result.returncode == 0, f"{direction}: {result.stderr}"
        finally:
            shutil.rmtree(project)

    cases = [
        ("tb-asymmetry", "TB", lambda diagram, _: (diagram["nodes"][0].update({"x": 300}), diagram["edges"][0].update({"points": [[400, 65], [440, 65], [440, 185], [530, 185]]})), "LAYOUT_SYMMETRY"),
        ("tb-branch-layer", "TB", lambda diagram, _: (diagram["nodes"][4].update({"y": 650}), diagram["edges"][3].update({"points": [[630, 340], [700, 340], [700, 650]]})), "BRANCH_LAYER"),
        ("tb-branch-port", "TB", lambda diagram, _: (diagram["edges"][3].update({"toPort": "right", "points": [[630, 340], [800, 340], [800, 725], [750, 725]]})), "BRANCH_PORT"),
        ("lr-branch-layer", "LR", lambda diagram, _: (diagram["nodes"][3].update({"x": 550}), diagram["edges"][2].update({"points": [[350, 300], [350, 325], [500, 325], [500, 375], [550, 375]]}), diagram["edges"][4].update({"points": [[650, 375], [750, 375], [750, 275]]})), "BRANCH_LAYER"),
        ("lr-branch-port", "LR", lambda diagram, _: (diagram["edges"][1].update({"toPort": "right", "points": [[350, 200], [350, 150], [650, 150], [650, 125], [600, 125]]})), "BRANCH_PORT"),
        ("annotation-order", "TB", lambda diagram, _: diagram["annotations"].__getitem__(0).update({"y": 400}), "ANNOTATION_ORDER"),
    ]
    for name, direction, mutation, expected in cases:
        project = tempfile.mkdtemp(prefix=f"aidlc-directional-{name}-")
        try:
            directional_fixture(project, direction)
            mutate_diagram(project, mutation)
            result = run_checker(project, "diagram-contract")
            assert result.returncode != 0, name
            assert expected in result.stderr, f"{name}: {result.stderr}"
        finally:
            shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-annotation-mapping-")
    try:
        directional_fixture(project, "TB")
        write(project, "docs/aidlc/inception/requirements/business-flows.svg", open(os.path.join(project, "docs/aidlc/inception/requirements/business-flows.svg")).read().replace('data-note="layout-note"', 'data-note="merged-note"'))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "ANNOTATION_MAPPING" in result.stderr
    finally:
        shutil.rmtree(project)


if __name__ == "__main__":
    test_all_checkers_pass_on_realistic_fixture()
    test_checker_fails_closed_when_required_artifact_is_removed()
    test_checker_rejects_legacy_diagram_without_structured_contract()
    test_diagram_003_fixed_regression()
    test_diagram_geometry_gates_fail_closed()
    test_diagram_geometry_gates_pass_on_valid_sequence()
    test_diagram_risk_assessment()
    test_directional_layout_contracts()
    print("22 semantic checker tests passed")
