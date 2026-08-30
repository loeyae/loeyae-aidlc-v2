"""Integration tests for all deterministic semantic checkers."""

import json
import os
import shutil
import subprocess
import tempfile

from diagram_fixture_style import canonicalize_svg

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
    if path.endswith(".svg"):
        content = canonicalize_svg(content)
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(content)


def fixture(project: str, with_expected: bool = False) -> None:
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
    write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox="0 0 400 300" width="400" height="300" role="img"><title>Requirements flow</title><desc>FR-001 business flow</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/><text data-text-id="node-start" x="90" y="70">开始</text></g><g data-node="done" data-node-shape="round"><rect x="260" y="40" width="100" height="50"/><text data-text-id="node-done" x="310" y="70">完成</text></g><path data-edge="start-done" data-from="start" data-from-port="right" data-to="done" data-to-port="left" data-edge-label="start-done" d="M140 65 L260 65" marker-end="url(#arrow)"/><path data-edge-arrow="start-done" data-edge="start-done" data-arrow-target="done:left" d="M252 57 L260 65 L252 73"/><g data-edge-label="start-done"><text data-text-id="label-start-done" x="200" y="47">完成</text></g><text data-text-id="requirement-reference" x="200" y="150">FR-001</text></svg>""")
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
            "edges": [{"id": "start-done", "from": "start", "fromPort": "right", "to": "done", "toPort": "left", "arrowTarget": "done:left", "kind": "directed", "points": [[140, 65], [260, 65]], "label": {"text": "完成", "x": 200, "y": 47}}],
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
                        "normal": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.normal"},
                        "fit": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.fit"},
                        "zoom": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.zoom"}
                    }
                }
            }
        }]
    }))
    if not with_expected:
        return
    manifest_path = os.path.join(project, "docs/aidlc/inception/requirements/business-flows.diagram.json")
    with open(manifest_path) as handle:
        manifest = json.load(handle)
    manifest["expected_contract_path"] = "docs/aidlc/inception/requirements/business-flows.expected.json"
    manifest["diagrams"][0]["generation"] = {
        "generator": {"name": "generic-test-generator", "version": "1.0.0"},
        "config": {"summary": "generic semantic fixture", "digest": "sha256:" + "1" * 64},
        "route_config": {"diagram_id": "requirements-flow", "edges": {"start-done": {"arrow_target": "done:left", "label_text": "完成", "topology": {"orthogonal": True, "segment_count": 1, "directions": ["right"]}}}},
        "source_refs": ["docs/aidlc/inception/requirements/business-flows.md"],
        "outputs": ["docs/aidlc/inception/requirements/business-flows.svg", "docs/aidlc/inception/requirements/business-flows.expected.json"],
        "command_argv": ["python3", "generator.py"],
    }
    with open(manifest_path, "w") as handle:
        json.dump(manifest, handle)
    write(project, "generator.py", """import json
import os
from pathlib import Path

assert os.environ["AIDLC_DIAGRAM_ID"] == "requirements-flow"
route_config = json.loads(os.environ["AIDLC_ROUTE_CONFIG_JSON"])
assert route_config["edges"]["start-done"]["arrow_target"] == "done:left"
assert Path(os.environ["AIDLC_EXPECTED_CONTRACT_PATH"]).exists()
manifest_path = Path("docs/aidlc/inception/requirements/business-flows.diagram.json")
manifest = json.loads(manifest_path.read_text())
manifest["diagrams"][0]["generation"]["route_config"] = route_config
manifest_path.write_text(json.dumps(manifest))
print("route-config=", json.dumps(route_config, sort_keys=True))
""")
    write(project, "docs/aidlc/inception/requirements/business-flows.expected.json", json.dumps({
        "version": "1",
        "type": "diagram-expected-contract",
        "source": {"kind": "approved-test-source", "ref": "docs/aidlc/inception/requirements/business-flows.md", "revision": "fixture", "digest": "sha256:" + "0" * 64},
        "generator": {"name": "generic-test-generator", "version": "1.0.0", "config_summary": "generic semantic fixture", "config_digest": "sha256:" + "1" * 64, "source_refs": ["docs/aidlc/inception/requirements/business-flows.md"]},
        "diagrams": [{
            "id": "requirements-flow",
            "diagram_type": "flowchart",
            "intent": "验证业务期望、结构 actual 和正交路由的一致性",
            "nodes": [{"id": "start", "shape": "round"}, {"id": "done", "shape": "round"}],
            "edges": [{"id": "start-done", "from": "start", "to": "done", "from_port": "right", "to_port": "left", "kind": "directed"}],
            "groups": [], "legend_ids": [], "annotation_ids": [], "lifeline_ids": [],
            "route_contract": {
                "direction": "LR",
                "edge_intents": [{"edge_id": "start-done", "kind": "direct", "bend_count": 0, "label_required": True, "arrow_target": "done:left", "label_text": "完成", "topology": {"orthogonal": True, "segment_count": 1, "directions": ["right"]}}],
                "main_flow": {"entry_node_ids": ["start"], "exit_node_ids": ["done"], "node_ids": ["start", "done"], "edge_ids": ["start-done"]},
                "loop_lanes": [], "branch_groups": [], "exceptions": [],
            },
        }],
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
        fixture(project, with_expected=True)
        for sensor in SENSORS:
            result = run_checker(project, sensor)
            assert result.returncode == 0, f"{sensor}: {result.stderr}"
            payload = json.loads(result.stdout)
            assert payload["status"] in ("passed", "verified", "not_applicable"), sensor
            if sensor == "diagram-contract":
                assert payload["status"] == "passed"
                assert payload["final_status"] == "STATIC_PASS"
                assert payload["expected_contract_status"] == "passed"
                assert payload["generation_status"] == "passed"
                assert payload["geometry_status"] == "passed"
                assert payload["render_preflight_status"] == "passed"
                assert payload["render_status"] == "unverified"
                assert payload["layout_contract_valid"] is True
                assert payload["annotation_mapping_valid"] is True
                assert payload["global_decorations_absent"] is True
                assert payload["visual_style_status"] == "passed"
                assert payload["edge_label_placement_status"] == "passed"
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
        manifest_path = os.path.join(project, "diagram-003.diagram.json")
        with open(manifest_path) as handle:
            diagram = json.load(handle)["diagrams"][0]
        layout = diagram["designNotes"]["layout"]
        assert layout["direction"] == "TB"
        assert layout["mainAxis"] == 580
        assert layout["mergeNodes"] == []
        assert layout["sideSwitchExceptions"] == []
        assert layout["crossingExceptions"] == []
        assert all(edge["arrowTarget"] == f'{edge["to"]}:{edge["toPort"]}' for edge in diagram["edges"])
        retry = next(edge for edge in diagram["edges"] if edge["id"] == "delivery-address-retry")
        # 反馈边必须使用声明的左侧 lane，但不能保留旧版绕行的冗余折点。
        assert retry["points"] == [[600, 590], [500, 590], [500, 270], [760, 270]]
        assert retry["label"]["y"] == 248
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["main_flow_valid"] is True
        assert payload["loop_lanes_valid"] is True
        assert payload["decision_exit_valid"] is True
        assert payload["edge_intersection_status"] == "passed"
        assert payload["collinear_overlap_status"] == "passed"
        assert payload["target_port_direction_status"] == "passed"
        assert payload["target_port_approach_status"] == "passed"
        assert payload["routing_minimality_status"] == "passed"
        assert payload["side_switch_status"] == "passed"
        assert payload["change_impact_review_status"] == "not_applicable"
        assert payload["visible_arrow_mapping_status"] == "passed"
        assert payload["global_decorations_absent"] is True
        assert payload["visual_style_status"] == "passed"
        assert payload["edge_label_placement_status"] == "passed"
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


def test_structural_group_capacity_and_style_contract_pass() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-structural-group-pass-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: (
            diagram["nodes"][0].update({"x": 74, "y": 84}),
            diagram["nodes"][1].update({"x": 260, "y": 84}),
            diagram["edges"][0].update({"points": [[174, 109], [260, 109]], "label": {"text": "完成", "x": 217, "y": 89}}),
            diagram["designNotes"]["layout"].update({"mainAxis": 109}),
            diagram.update({"groups": [{
                "id": "lane", "label": "结构阶段", "styleRole": "structural", "semanticType": "exclusive", "members": ["start"],
                "x": 24, "y": 24, "width": 210, "height": 180,
            }]}),
        ))
        write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox="0 0 400 300" width="400" height="300" role="img">
<title>Requirements flow</title><desc>FR-001 business flow</desc>
<defs><marker id="arrow"><path d="M0 0 L6 4 L0 8 Z"/></marker><mask id="lane-mask" mask-type="alpha" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect x="24" y="24" width="210" height="180" fill="#ffffff"/><rect x="230" y="100" width="8" height="18" fill="#ffffff" fill-opacity="0"/></mask></defs>
<rect id="group-lane" data-group="lane" data-group-role="exclusive" data-group-style-role="structural" x="24" y="24" width="210" height="180" mask="url(#lane-mask)"/>
<text data-group-title="lane" data-group-style-role="structural" data-text-id="group-lane-title" x="80" y="50">结构阶段</text>
<g data-node="start" data-node-shape="round"><rect x="74" y="84" width="100" height="50"/><text data-text-id="node-start" x="124" y="109">开始</text></g>
<g data-node="done" data-node-shape="round"><rect x="260" y="84" width="100" height="50"/><text data-text-id="node-done" x="310" y="109">完成</text></g>
<path data-edge="start-done" data-from="start" data-from-port="right" data-to="done" data-to-port="left" data-edge-label="start-done" d="M174 109 L260 109" marker-end="url(#arrow)"/>
<path data-edge-arrow="start-done" data-edge="start-done" data-arrow-target="done:left" d="M252 101 L260 109 L252 117"/>
<text data-edge-label="start-done" data-text-id="label-start-done" x="217" y="89">完成</text>
<text data-text-id="requirement-reference" x="200" y="240">FR-001</text></svg>""")
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["group_capacity_status"] == "passed"
        assert payload["node_text_fit_status"] == "passed"
        assert payload["visual_style_status"] == "passed"
    finally:
        shutil.rmtree(project)


def test_diagram_geometry_gates_fail_closed() -> None:
    cases = [
        ("node collision", lambda diagram, _: diagram["nodes"].__setitem__(1, {**diagram["nodes"][1], "x": 100}), "geometric collision"),
        ("cjk label overflow", lambda diagram, _: diagram["nodes"][0].update({"label": "中文中文中文"}), "LABEL_OVERFLOW"),
        ("group header capacity", lambda diagram, _: diagram.update({"groups": [
            {"id": "lane", "label": "结构阶段", "styleRole": "structural", "semanticType": "exclusive", "members": ["start"], "x": 20, "y": 20, "width": 200, "height": 160},
        ]}), "GROUP_HEADER_CLEARANCE"),
        ("group style role", lambda diagram, _: diagram.update({"groups": [
            {"id": "lane", "label": "结构阶段", "semanticType": "exclusive", "members": ["start"], "x": 20, "y": 20, "width": 200, "height": 160},
        ]}), "MIGRATION_REQUIRED"),
        ("edge collision", lambda diagram, _: diagram["nodes"].append({"id": "middle", "shape": "rect", "label": "中间", "x": 180, "y": 40, "width": 64, "height": 50}), "collides with non-endpoint node middle"),
        ("node boundary overlap", lambda diagram, _: diagram["nodes"].append({"id": "boundary", "shape": "rect", "label": "边界", "x": 180, "y": 65, "width": 64, "height": 50}), "EDGE_NODE_BOUNDARY_OVERLAP"),
        ("collinear overlap", lambda diagram, _: (
            diagram["nodes"].append({"id": "other", "shape": "rect", "label": "旁路", "x": 40, "y": 110, "width": 100, "height": 50}),
            diagram["edges"].append({"id": "overlap", "from": "other", "fromPort": "right", "to": "done", "toPort": "left", "arrowTarget": "done:left", "kind": "directed", "points": [[140, 135], [180, 135], [180, 65], [260, 65]]}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "other"], "exitNodeIds": ["done"], "nodeIds": ["start", "done", "other"], "edgeIds": ["start-done", "overlap"]}),
            diagram["designNotes"]["layout"]["mergeNodes"].append({"nodeId": "done", "reason": "负例显式允许重复入边以验证共线重叠门禁", "edgeIds": ["start-done", "overlap"], "ports": {"start-done": "left", "overlap": "left"}}),
        ), "COLLINEAR_OVERLAP"),
        ("edge crossing", lambda diagram, _: (
            diagram["nodes"][0].update({"y": 125}),
            diagram["nodes"][1].update({"y": 125}),
            diagram["nodes"].extend([
                {"id": "top", "shape": "rect", "label": "上", "x": 170, "y": 40, "width": 60, "height": 50},
                {"id": "bottom", "shape": "rect", "label": "下", "x": 170, "y": 240, "width": 60, "height": 50},
            ]),
            diagram["edges"][0].update({"points": [[140, 150], [260, 150]]}),
            diagram["edges"].append({"id": "vertical", "from": "top", "fromPort": "bottom", "to": "bottom", "toPort": "top", "arrowTarget": "bottom:top", "kind": "directed", "points": [[200, 90], [200, 240]]}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "top"], "exitNodeIds": ["done", "bottom"], "nodeIds": ["start", "done", "top", "bottom"], "edgeIds": ["start-done", "vertical"]}),
            diagram["canvas"].update({"height": 340}),
        ), "EDGE_CROSSING"),
        ("label collision", lambda diagram, _: (
            diagram["nodes"].append({"id": "middle", "shape": "rect", "label": "中间", "x": 170, "y": 11, "width": 80, "height": 48}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "middle"], "exitNodeIds": ["done", "middle"], "nodeIds": ["start", "done", "middle"]}),
            diagram["edges"][0]["label"].update({"x": 200, "y": 47}),
        ), "LABEL_COLLISION"),
        ("group containment", lambda diagram, _: diagram.update({"groups": [
            {"id": "a", "label": "分组 A", "styleRole": "business-boundary", "semanticType": "exclusive", "members": ["start"], "x": 20, "y": 20, "width": 100, "height": 80},
        ]}), "GROUP_CONTAINMENT"),
        ("group overlap", lambda diagram, _: diagram.update({
            "canvas": {"width": 440, "height": 300},
            "groups": [
                {"id": "a", "label": "分组 A", "styleRole": "business-boundary", "semanticType": "exclusive", "members": ["start"], "x": 16, "y": 16, "width": 180, "height": 100},
                {"id": "b", "label": "分组 B", "styleRole": "business-boundary", "semanticType": "exclusive", "members": ["done"], "x": 160, "y": 16, "width": 224, "height": 100},
            ],
        }), "groups a and b have geometric overlap"),
        ("global legend", lambda diagram, _: diagram.update({
            "legend": {"placement": "bottom", "items": [{"id": "directed-edge", "label": "流程", "meaning": "有向关系", "sample": {"kind": "edge", "ref": "start-done"}, "targets": [{"kind": "edge", "ref": "start-done"}]}]},
            "designNotes": {**diagram["designNotes"], "legendDecision": {"status": "required", "reason": "负例验证全局图例被禁止"}},
        }), "must not define a global legend"),
        ("sequence lifeline coordinate", lambda diagram, project: (
            diagram.update({"diagramType": "sequence"}),
            diagram["designNotes"].update({"semanticModes": ["process-flow"]}),
            write(project, "docs/aidlc/inception/requirements/business-flows.svg", """<svg viewBox=\"0 0 400 300\" width=\"400\" height=\"300\" role=\"img\"><title>Requirements sequence</title><desc>FR-001 sequence</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g><rect data-node=\"start\" x=\"40\" y=\"40\" width=\"100\" height=\"50\"/><rect data-node=\"done\" x=\"260\" y=\"40\" width=\"100\" height=\"50\"/><line data-lifeline-for=\"start\" x1=\"100\" x2=\"100\" y1=\"90\" y2=\"260\"/><line data-lifeline-for=\"done\" x1=\"310\" x2=\"310\" y1=\"90\" y2=\"260\"/><path data-edge=\"start-done\" data-from=\"start\" data-from-port=\"right\" data-to=\"done\" data-to-port=\"left\" data-edge-label=\"start-done\" d=\"M140 65 L260 65\" marker-end=\"url(#arrow)\"/><path data-edge-arrow=\"start-done\" data-edge=\"start-done\" data-arrow-target=\"done:left\" d=\"M252 57 L260 65 L252 73\"/><g data-edge-label=\"start-done\"><text data-text-id=\"label-start-done\" x=\"200\" y=\"50\">完成</text></g><text data-text-id=\"requirement-reference\">FR-001</text></g></svg>"""),
        ), "sequence lifeline coordinate is invalid"),
        ("endpoint mismatch", lambda diagram, _: diagram["edges"][0].update({"points": [[143, 65], [260, 65]]}), "first point does not match fromPort"),
        ("sidecar arrow target", lambda diagram, _: diagram["edges"][0].update({"arrowTarget": "done:right"}), "ARROW_MAPPING"),
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
        mutate_diagram(project, lambda diagram, _: (
            diagram.update({"diagramType": "architecture"}),
            diagram["designNotes"].update({"semanticModes": ["static-relation"]}),
            diagram["edges"][0].update({"points": [[140, 65], [180, 65], [180, 80], [240, 80], [240, 65], [260, 65]], "label": {"text": "完成", "x": 210, "y": 100, "fontSize": 14}}),
        ))
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
            {"id": "decision", "shape": "diamond", "label": "启用条件", "x": 500, "y": 280, "width": 160, "height": 120},
            {"id": "active", "shape": "round", "label": "ACTIVE", "x": 650, "y": 700, "width": 100, "height": 50},
            {"id": "pending", "shape": "round", "label": "PENDING", "x": 310, "y": 700, "width": 100, "height": 50},
        ]
        edges = [
            {"id": "oms-receive", "from": "oms", "fromPort": "right", "to": "receive", "toPort": "left", "kind": "directed", "points": [[360, 65], [440, 65], [440, 185], [530, 185]]},
            {"id": "dmall-receive", "from": "dmall", "fromPort": "left", "to": "receive", "toPort": "right", "kind": "directed", "points": [[760, 65], [720, 65], [720, 185], [630, 185]]},
            {"id": "receive-decision", "from": "receive", "fromPort": "bottom", "to": "decision", "toPort": "top", "kind": "directed", "points": [[580, 210], [580, 280]]},
            {"id": "decision-active", "from": "decision", "fromPort": "right", "to": "active", "toPort": "top", "kind": "directed", "points": [[660, 340], [700, 340], [700, 700]], "label": {"text": "通过", "x": 680, "y": 320}},
            {"id": "decision-pending", "from": "decision", "fromPort": "left", "to": "pending", "toPort": "top", "kind": "directed", "points": [[500, 340], [360, 340], [360, 700]], "label": {"text": "未通过", "x": 430, "y": 320}},
        ]
        canvas = {"width": 1000, "height": 840}
        layout = {"direction": "TB", "mainAxis": 580, "layerTolerance": 24, "symmetryGroups": [{"nodeIds": ["oms", "dmall"], "tolerance": 1}], "mergeNodes": [{"nodeId": "receive", "reason": "OMS 与 E-Fulfilment 输入汇合后进入云 Mall", "edgeIds": ["oms-receive", "dmall-receive"], "ports": {"oms-receive": "left", "dmall-receive": "right"}}], "mainFlow": {"entryNodeIds": ["oms", "dmall"], "exitNodeIds": ["active", "pending"], "nodeIds": ["oms", "dmall", "receive", "decision", "active", "pending"], "edgeIds": ["oms-receive", "dmall-receive", "receive-decision", "decision-active", "decision-pending"]}, "loopLanes": [], "branchLayerExceptions": [], "branchPortExceptions": []}
    else:
        nodes = [
            {"id": "start", "shape": "round", "label": "完成定店", "x": 40, "y": 225, "width": 100, "height": 50},
            {"id": "decision", "shape": "diamond", "label": "商品类型", "x": 280, "y": 200, "width": 140, "height": 100},
            {"id": "physical", "shape": "rect", "label": "实物入车", "x": 500, "y": 100, "width": 100, "height": 50},
            {"id": "virtual", "shape": "rect", "label": "虚拟直购", "x": 500, "y": 350, "width": 100, "height": 50},
            {"id": "checkout", "shape": "rect", "label": "结算提交订单", "x": 680, "y": 225, "width": 140, "height": 50},
        ]
        edges = [
            {"id": "start-decision", "from": "start", "fromPort": "right", "to": "decision", "toPort": "left", "kind": "directed", "points": [[140, 250], [280, 250]]},
            {"id": "decision-physical", "from": "decision", "fromPort": "top", "to": "physical", "toPort": "left", "kind": "directed", "points": [[350, 200], [350, 125], [500, 125]], "label": {"text": "实物", "x": 425, "y": 105}},
            {"id": "decision-virtual", "from": "decision", "fromPort": "bottom", "to": "virtual", "toPort": "left", "kind": "directed", "points": [[350, 300], [350, 375], [500, 375]], "label": {"text": "虚拟", "x": 425, "y": 395}},
            {"id": "physical-checkout", "from": "physical", "fromPort": "right", "to": "checkout", "toPort": "top", "kind": "directed", "points": [[600, 125], [750, 125], [750, 225]]},
            {"id": "virtual-checkout", "from": "virtual", "fromPort": "right", "to": "checkout", "toPort": "bottom", "kind": "directed", "points": [[600, 375], [750, 375], [750, 275]]},
        ]
        canvas = {"width": 850, "height": 520}
        layout = {"direction": "LR", "mainAxis": 250, "layerTolerance": 24, "symmetryGroups": [], "mergeNodes": [{"nodeId": "checkout", "reason": "两个商品分支在结算提交订单处汇合", "edgeIds": ["physical-checkout", "virtual-checkout"], "ports": {"physical-checkout": "top", "virtual-checkout": "bottom"}}], "mainFlow": {"entryNodeId": "start", "exitNodeIds": ["checkout"], "nodeIds": ["start", "decision", "physical", "virtual", "checkout"], "edgeIds": ["start-decision", "decision-physical", "decision-virtual", "physical-checkout", "virtual-checkout"]}, "loopLanes": [], "branchLayerExceptions": [], "branchPortExceptions": []}
    for edge in edges:
        edge["arrowTarget"] = f'{edge["to"]}:{edge["toPort"]}'
    layout["readabilityEvidence"] = {
        "normal": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.normal"},
        "fit": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.fit"},
        "zoom": {"status": "UNVERIFIED", "evidence": ".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.zoom"},
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
    svg = f'<svg viewBox="0 0 {canvas["width"]} {canvas["height"]}" width="{canvas["width"]}" height="{canvas["height"]}" role="img"><title>Directional regression</title><desc>FR-002 directional regression</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs>{svg_nodes}{svg_edges}{svg_labels}</svg>'
    manifest = {"version": 1, "document": "docs/aidlc/inception/requirements/business-flows.md", "diagrams": [{"id": f"diagram-{direction.lower()}", "output": "business-flows.svg", "title": "Directional regression", "description": "Directional regression", "diagramType": "flowchart", "canvas": canvas, "nodes": nodes, "edges": edges, "annotations": [{"id": "layout-note", "text": "布局说明", "x": canvas["width"] / 2, "y": canvas["height"] - 50}], "legend": {"placement": "bottom", "items": [{"id": "flow", "label": "流程", "meaning": "业务流程", "sample": {"kind": "edge", "ref": edges[0]["id"]}, "targets": [{"kind": "edge", "ref": edges[0]["id"]}]}]}, "designNotes": {"intent": "验证主阅读方向和业务层级", "semanticModes": ["process-flow"], "visualSemantics": [{"channel": "node-shape", "role": "semantic", "reason": "矩形、菱形和圆角节点分别表达步骤、判断和状态结果"}], "legendDecision": {"status": "required", "reason": "回归夹具显式验证图例顺序"}, "splitDecision": {"status": "not-needed", "reason": "单一流程回归夹具"}, "layout": layout}}]}
    manifest_diagram = manifest["diagrams"][0]
    manifest_diagram.pop("annotations", None)
    manifest_diagram.pop("legend", None)
    manifest_diagram["designNotes"]["legendDecision"] = {"status": "exempt", "reason": "节点形状语义由节点文字和判定出口就地表达，不使用全局图例", "inlineSemanticEvidence": [f'{node["id"]}#label' for node in nodes]}
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
        ("tb-branch-layer", "TB", lambda diagram, _: (diagram["nodes"][4].update({"y": 650}), diagram["edges"][3].update({"points": [[660, 340], [700, 340], [700, 650]]})), "BRANCH_LAYER"),
        ("tb-branch-port", "TB", lambda diagram, _: (diagram["edges"][3].update({"toPort": "right", "arrowTarget": "active:right", "points": [[660, 340], [800, 340], [800, 725], [750, 725]], "label": {"text": "通过", "x": 730, "y": 320, "fontSize": 14}})), "BRANCH_PORT"),
        ("lr-branch-layer", "LR", lambda diagram, _: (diagram["nodes"][3].update({"x": 550}), diagram["edges"][2].update({"points": [[350, 300], [350, 325], [500, 325], [500, 375], [550, 375]]}), diagram["edges"][4].update({"points": [[650, 375], [750, 375], [750, 275]]})), "BRANCH_LAYER"),
        ("lr-branch-port", "LR", lambda diagram, _: (diagram["edges"][1].update({"toPort": "right", "arrowTarget": "physical:right", "points": [[350, 200], [350, 150], [650, 150], [650, 125], [600, 125]], "label": {"text": "实物", "x": 500, "y": 130, "fontSize": 14}})), "COLLINEAR_OVERLAP"),
        ("global-annotations", "TB", lambda diagram, _: diagram.update({"annotations": [{"id": "layout-note", "text": "布局说明", "x": 500, "y": 400}]}), "must not define global annotations"),
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

    project = tempfile.mkdtemp(prefix="aidlc-global-note-")
    try:
        directional_fixture(project, "TB")
        svg_path = os.path.join(project, "docs/aidlc/inception/requirements/business-flows.svg")
        with open(svg_path, encoding="utf-8") as handle:
            svg = handle.read()
        with open(svg_path, "w", encoding="utf-8") as handle:
            handle.write(svg.replace("</svg>", '<g data-note="layout-note"></g></svg>'))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "global legends and note layers are not allowed" in result.stderr
    finally:
        shutil.rmtree(project)

def test_diagram_contract_hardening() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-port-approach-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: (
            diagram.update({"diagramType": "state"}),
            diagram["edges"][0].update({"points": [[140, 65], [300, 65], [260, 65]]}),
        ))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "PORT_APPROACH" in result.stderr, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-routing-minimality-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: (
            diagram["canvas"].update({"width": 500}),
            diagram["edges"][0].update({"points": [[140, 65], [180, 65], [180, 140], [240, 140], [240, 65], [260, 65]], "label": {"text": "完成", "x": 210, "y": 160, "fontSize": 14}}),
        ))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "ROUTING_MINIMALITY" in result.stderr, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-label-edge-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: (
            diagram["nodes"].extend([
                {"id": "top", "shape": "rect", "label": "上", "x": 170, "y": 80, "width": 60, "height": 50},
                {"id": "bottom", "shape": "rect", "label": "下", "x": 170, "y": 180, "width": 60, "height": 50},
            ]),
            diagram["edges"].append({"id": "top-bottom", "from": "top", "fromPort": "bottom", "to": "bottom", "toPort": "top", "arrowTarget": "bottom:top", "kind": "directed", "points": [[200, 130], [200, 180]]}),
            diagram["edges"][0]["label"].update({"y": 145}),
            diagram["designNotes"]["layout"]["mainFlow"].update({"entryNodeIds": ["start", "top"], "exitNodeIds": ["done", "bottom"], "nodeIds": ["start", "done", "top", "bottom"], "edgeIds": ["start-done", "top-bottom"]}),
        ))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "LABEL_COLLISION" in result.stderr
        assert "intersects edge top-bottom" in result.stderr, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-change-impact-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: diagram["designNotes"]["layout"].update({
            "changeImpactReview": {
                "baseline": "git:before-layout-migration",
                "movedNodeIds": ["start"],
                "impactedEdgeIds": [],
                "edgeReviews": [],
            }
        }))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "CHANGE_IMPACT_REVIEW" in result.stderr
        assert "omits incident edge" in result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-exit-loop-")
    try:
        fixture(project)
        def declared_exit_loop(diagram: dict, project_path: str) -> None:
            loop_edge = {
                "id": "done-retry", "from": "done", "fromPort": "bottom", "to": "start", "toPort": "bottom", "arrowTarget": "start:bottom", "kind": "directed",
                "points": [[310, 90], [310, 160], [90, 160], [90, 90]],
                "label": {"text": "重试", "x": 200, "y": 180},
            }
            diagram["edges"].append(loop_edge)
            layout = diagram["designNotes"]["layout"]
            layout["mainFlow"]["edgeIds"].append("done-retry")
            layout["loopLanes"] = [{"id": "retry-right", "side": "right", "laneOffset": 80, "reason": "完成态用户重新触发已声明反馈回路", "edgeIds": ["done-retry"]}]
            svg_path = os.path.join(project_path, "docs", "aidlc", "inception", "requirements", "business-flows.svg")
            with open(svg_path) as handle:
                svg = handle.read()
            svg = svg.replace("</svg>", '<path data-edge="done-retry" data-from="done" data-from-port="bottom" data-to="start" data-to-port="bottom" data-edge-label="done-retry" d="M310 90 L310 160 L90 160 L90 90" marker-end="url(#arrow)"/><path data-edge-arrow="done-retry" data-edge="done-retry" data-arrow-target="start:bottom" d="M84 100 L90 90 L96 100"/><g data-edge-label="done-retry"><text data-text-id="label-done-retry" x="200" y="180">重试</text></g></svg>')
            write(project_path, "docs/aidlc/inception/requirements/business-flows.svg", svg)
        mutate_diagram(project, declared_exit_loop)
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-loop-routing-minimality-")
    try:
        fixture(project)
        def redundant_declared_exit_loop(diagram: dict, project_path: str) -> None:
            loop_edge = {
                "id": "done-retry", "from": "done", "fromPort": "bottom", "to": "start", "toPort": "bottom", "arrowTarget": "start:bottom", "kind": "directed",
                "points": [[310, 90], [310, 160], [380, 160], [380, 180], [90, 180], [90, 90]],
                "label": {"text": "重试", "x": 235, "y": 200},
            }
            diagram["edges"].append(loop_edge)
            layout = diagram["designNotes"]["layout"]
            layout["mainFlow"]["edgeIds"].append("done-retry")
            layout["loopLanes"] = [{"id": "retry-right", "side": "right", "laneOffset": 80, "reason": "完成态用户重新触发已声明反馈回路", "edgeIds": ["done-retry"]}]
            svg_path = os.path.join(project_path, "docs", "aidlc", "inception", "requirements", "business-flows.svg")
            with open(svg_path) as handle:
                svg = handle.read()
            svg = svg.replace("</svg>", '<path data-edge="done-retry" data-from="done" data-from-port="bottom" data-to="start" data-to-port="bottom" data-edge-label="done-retry" d="M310 90 L310 160 L380 160 L380 180 L90 180 L90 90" marker-end="url(#arrow)"/><path data-edge-arrow="done-retry" data-edge="done-retry" data-arrow-target="start:bottom" d="M84 100 L90 90 L96 100"/><g data-edge-label="done-retry"><text data-text-id="label-done-retry" x="235" y="200">重试</text></g></svg>')
            write(project_path, "docs/aidlc/inception/requirements/business-flows.svg", svg)
        mutate_diagram(project, redundant_declared_exit_loop)
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "ROUTING_MINIMALITY" in result.stderr, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-untracked-exit-loop-")
    try:
        fixture(project)
        mutate_diagram(project, lambda diagram, _: (
            diagram["edges"].append({"id": "done-retry", "from": "done", "fromPort": "bottom", "to": "start", "toPort": "bottom", "arrowTarget": "start:bottom", "kind": "directed", "points": [[310, 90], [310, 160], [90, 160], [90, 90]], "label": {"text": "重试", "x": 200, "y": 180}}),
            diagram["designNotes"]["layout"]["mainFlow"]["edgeIds"].append("done-retry"),
        ))
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "MAIN_FLOW_TRACE" in result.stderr
        assert "outside declared loopLanes" in result.stderr
    finally:
        shutil.rmtree(project)

    def crossing_fixture(project_path: str, declared: bool) -> None:
        fixture(project_path)
        manifest_path = diagram_manifest_path(project_path)
        with open(manifest_path) as handle:
            manifest = json.load(handle)
        diagram = manifest["diagrams"][0]
        diagram["canvas"] = {"width": 400, "height": 340}
        diagram["nodes"] = [
            {"id": "start", "shape": "rect", "label": "开始", "x": 40, "y": 125, "width": 100, "height": 50},
            {"id": "done", "shape": "rect", "label": "完成", "x": 260, "y": 125, "width": 100, "height": 50},
            {"id": "top", "shape": "rect", "label": "上", "x": 170, "y": 40, "width": 60, "height": 50},
            {"id": "bottom", "shape": "rect", "label": "下", "x": 170, "y": 240, "width": 60, "height": 50},
        ]
        diagram["edges"] = [
            {"id": "start-done", "from": "start", "fromPort": "right", "to": "done", "toPort": "left", "arrowTarget": "done:left", "kind": "directed", "points": [[140, 150], [260, 150]]},
            {"id": "top-bottom", "from": "top", "fromPort": "bottom", "to": "bottom", "toPort": "top", "arrowTarget": "bottom:top", "kind": "directed", "points": [[200, 90], [200, 240]]},
        ]
        layout = diagram["designNotes"]["layout"]
        layout.update({
            "direction": "TB", "mainAxis": 200, "symmetryGroups": [], "mergeNodes": [],
            "mainFlow": {"entryNodeIds": ["start", "top"], "exitNodeIds": ["done", "bottom"], "nodeIds": ["start", "done", "top", "bottom"], "edgeIds": ["start-done", "top-bottom"]},
            "loopLanes": [], "branchLayerExceptions": [], "branchPortExceptions": [], "sideSwitchExceptions": [],
            "crossingExceptions": ([{"edgeIds": ["start-done", "top-bottom"], "businessReason": "保持两个独立主方向，绕行会破坏层级", "geometricReason": "两条正交路径在业务节点之间形成唯一真实交点", "visualEvidence": {"required": True, "refs": [".aidlc/evidence/requirements-methods/diagram-contract-provider.json#views.normal"]}}] if declared else []),
        })
        with open(manifest_path, "w") as handle:
            json.dump(manifest, handle)
        write(project_path, "docs/aidlc/inception/requirements/business-flows.svg", '''<svg viewBox="0 0 400 340" width="400" height="340" role="img"><title>Crossing fixture</title><desc>FR-001 declared crossing fixture</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs><g data-node="start"><rect x="40" y="125" width="100" height="50"/><text x="90" y="155">开始</text></g><g data-node="done"><rect x="260" y="125" width="100" height="50"/><text x="310" y="155">完成</text></g><g data-node="top"><rect x="170" y="40" width="60" height="50"/><text x="200" y="70">上</text></g><g data-node="bottom"><rect x="170" y="240" width="60" height="50"/><text x="200" y="270">下</text></g><path data-edge="start-done" data-from="start" data-from-port="right" data-to="done" data-to-port="left" d="M140 150 L260 150" marker-end="url(#arrow)"/><path data-edge-arrow="start-done" data-edge="start-done" data-arrow-target="done:left" d="M252 142 L260 150 L252 158"/><path data-edge="top-bottom" data-from="top" data-from-port="bottom" data-to="bottom" data-to-port="top" d="M200 90 L200 240" marker-end="url(#arrow)"/><path data-edge-arrow="top-bottom" data-edge="top-bottom" data-arrow-target="bottom:top" d="M192 230 L200 240 L208 230"/></svg>''')

    project = tempfile.mkdtemp(prefix="aidlc-diagram-crossing-declared-")
    try:
        crossing_fixture(project, True)
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-crossing-undeclared-")
    try:
        crossing_fixture(project, False)
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "EDGE_CROSSING" in result.stderr
    finally:
        shutil.rmtree(project)

    project = tempfile.mkdtemp(prefix="aidlc-diagram-side-switch-")
    try:
        fixture(project)
        def side_switch(diagram: dict, _: str) -> None:
            diagram["nodes"][0].update({"y": 150})
            diagram["nodes"][1].update({"y": 150})
            diagram["edges"][0].update({"points": [[140, 175], [180, 175], [180, 30], [220, 30], [220, 175], [260, 175]], "label": {"text": "流程", "x": 200, "y": 175}})
        mutate_diagram(project, side_switch)
        result = run_checker(project, "diagram-contract")
        assert result.returncode != 0
        assert "SIDE_SWITCH" in result.stderr
        mutate_diagram(project, lambda diagram, _: diagram["designNotes"]["layout"].update({"sideSwitchExceptions": [{"edgeIds": ["start-done"], "reason": "验证已声明跨侧例外"}]}))
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
    finally:
        shutil.rmtree(project)


def diagram009_expected_path(project: str) -> str:
    return os.path.join(project, "diagram-009.expected.json")


def mutate_diagram009_expected(project: str, mutation) -> None:
    path = diagram009_expected_path(project)
    with open(path) as handle:
        expected = json.load(handle)
    mutation(expected["diagrams"][0])
    with open(path, "w") as handle:
        json.dump(expected, handle)


def diagram009_intent(expected_diagram: dict, edge_id: str) -> dict:
    return next(intent for intent in expected_diagram["route_contract"]["edge_intents"] if intent["edge_id"] == edge_id)


def diagram009_edge(expected_diagram: dict, edge_id: str) -> dict:
    return next(edge for edge in expected_diagram["edges"] if edge["id"] == edge_id)


def test_diagram_009_route_contract() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-009-route-contract-")
    try:
        source = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-009")
        shutil.copytree(source, project, dirs_exist_ok=True)
        result = run_checker(project, "diagram-contract")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["final_status"] == "STATIC_PASS"
        assert payload["gate_statuses"] == {
            "structure": "STRUCTURE_PASS",
            "route_contract": "ROUTE_CONTRACT_PASS",
            "geometry": "GEOMETRY_PASS",
            "visual": "UNVERIFIED",
            "overall": "STATIC_PASS",
        }
        assert payload["generation_closure"][0]["reloaded"] is True
        assert payload["generation_closure"][0]["route_config"]["diagram_id"] == "diagram-009"
        assert payload["loop_lanes_valid"] is True
        with open(os.path.join(project, "diagram-009.diagram.json"), encoding="utf-8") as handle:
            generated = json.load(handle)["diagrams"][0]
        edges = {edge["id"]: edge for edge in generated["edges"]}
        assert "edge-028" not in edges
        assert len(edges["edge-027"]["points"]) == 2
        assert edges["edge-027"]["points"][0][0] == edges["edge-027"]["points"][1][0]
        assert edges["edge-027"]["points"][1][1] > edges["edge-027"]["points"][0][1]
        assert edges["edge-027"]["label"]["text"] == "主动取消／支付超时15分钟未付"
        assert edges["edge-027"]["label"]["x"] - edges["edge-027"]["points"][0][0] > 100
        lanes = {lane["id"]: lane for lane in generated["designNotes"]["layout"]["loopLanes"]}
        assert lanes["cart-retry-right"]["laneOffset"] == 840
        assert lanes["payment-retry-left"]["laneOffset"] == 890
        merge = next(item for item in generated["designNotes"]["sourceRelationMerges"] if item["display_edge_id"] == "edge-027")
        assert merge["source_relation_ordinals"] == [27, 28]
    finally:
        shutil.rmtree(project)

    cases = [
        ("endpoint", lambda diagram: (diagram009_edge(diagram, "edge-024").update({"to": "pending-action", "arrow_target": "pending-action:top"}), diagram009_intent(diagram, "edge-024").update({"arrow_target": "pending-action:top"})), "SOURCE_RELATION_FIDELITY"),
        ("port", lambda diagram: diagram009_edge(diagram, "edge-002").update({"from_port": "left"}), "ROUTE_PORT_DIFF"),
        ("arrow", lambda diagram: diagram009_intent(diagram, "edge-003").update({"arrow_target": "browse-products:right"}), "ROUTE_ARROW_TARGET_DIFF"),
        ("bend", lambda diagram: diagram009_intent(diagram, "edge-005").update({"bend_count": 1}), "ROUTE_BEND_DIFF"),
        ("topology", lambda diagram: diagram009_intent(diagram, "edge-002").update({"topology": {"orthogonal": True, "segment_count": 3, "directions": ["left", "down", "right"]}}), "ROUTE_TOPOLOGY"),
        ("label", lambda diagram: diagram009_intent(diagram, "edge-007").update({"label_text": "到店自提"}), "ROUTE_LABEL_DIFF"),
    ]
    for name, mutation, expected_error in cases:
        project = tempfile.mkdtemp(prefix=f"aidlc-diagram-009-{name}-")
        try:
            source = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-009")
            shutil.copytree(source, project, dirs_exist_ok=True)
            mutate_diagram009_expected(project, mutation)
            result = run_checker(project, "diagram-contract")
            assert result.returncode != 0, name
            assert expected_error in result.stderr, f"{name}: {result.stderr}"
        finally:
            shutil.rmtree(project)


if __name__ == "__main__":
    test_all_checkers_pass_on_realistic_fixture()
    test_checker_fails_closed_when_required_artifact_is_removed()
    test_checker_rejects_legacy_diagram_without_structured_contract()
    test_diagram_003_fixed_regression()
    test_structural_group_capacity_and_style_contract_pass()
    test_diagram_geometry_gates_fail_closed()
    test_diagram_geometry_gates_pass_on_valid_sequence()
    test_diagram_risk_assessment()
    test_directional_layout_contracts()
    test_diagram_contract_hardening()
    test_diagram_009_route_contract()
    print("semantic checker regression tests passed")
