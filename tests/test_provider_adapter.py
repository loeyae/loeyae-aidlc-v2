#!/usr/bin/env python3
"""Regression checks for the Chrome DevTools Provider request adapter."""

import json
import os
import shutil
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TOOL = os.path.join(REPO_ROOT, "core", "tools", "aidlc-diagram-provider.ts")


def run_adapter(project: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", TOOL, *args],
        cwd=project,
        capture_output=True,
        text=True,
    )


def fixture() -> tuple[str, str]:
    project = tempfile.mkdtemp(prefix="aidlc-provider-adapter-")
    os.makedirs(os.path.join(project, "assets"), exist_ok=True)
    with open(os.path.join(project, "assets", "flow.svg"), "w") as handle:
        handle.write('<svg viewBox="0 0 100 80" width="100" height="80" role="img"><title>Flow</title><desc>Flow</desc></svg>\n')
    with open(os.path.join(project, "assets", "flow.diagram.json"), "w") as handle:
        json.dump({
            "version": 1,
            "document": "flow.md",
            "diagrams": [{
                "id": "flow",
                "diagramType": "flowchart",
                "title": "Flow",
                "description": "Flow",
                "canvas": {"width": 100, "height": 80},
                "nodes": [],
                "edges": [],
            }],
        }, handle)
    with open(os.path.join(project, "request.json"), "w") as handle:
        json.dump({
            "version": "1",
            "provider": "chrome-devtools",
            "target_operation": "preview",
            "stage": "requirements-methods",
            "target_reading_environment": {"viewport": {"width": 800, "height": 600}},
            "diagrams": [{
                "id": "flow",
                "source_path": "assets/flow.svg",
                "manifest_path": "assets/flow.diagram.json",
            }],
        }, handle)
    return project, os.path.join(project, "request.json")




def test_dry_run_accepts_three_reading_views() -> None:
    project, request_path = fixture()
    try:
        with open(request_path) as handle:
            request = json.load(handle)
        request["target_reading_environment"]["viewports"] = {
            "normal": {"width": 1280, "height": 720},
            "fit": {"width": 1024, "height": 768},
            "zoom": {"width": 1600, "height": 1200},
        }
        with open(request_path, "w") as handle:
            json.dump(request, handle)
        result = run_adapter(project, "run", "--request", "request.json", "--dry-run")
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["status"] == "ready"
    finally:
        shutil.rmtree(project)
def test_dry_run_validates_request() -> None:
    project, _ = fixture()
    try:
        result = run_adapter(project, "run", "--request", "request.json", "--dry-run")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["status"] == "ready"
        assert payload["provider"] == "chrome-devtools-mcp@1.6.0"
        assert payload["plan"][0]["local_preview_fallback"] is True
        with open(TOOL) as handle:
            provider_source = handle.read()
        assert '["start", "--isolated"]' in provider_source
        assert '"--sessionId",\n    sessionId,' in provider_source
        assert "BROWSER_PROFILE_CONFLICT" in provider_source
        assert 'process.once("exit"' in provider_source
    finally:
        shutil.rmtree(project)


def test_export_is_rejected() -> None:
    project, request_path = fixture()
    try:
        with open(request_path) as handle:
            request = json.load(handle)
        request["target_operation"] = "export"
        with open(request_path, "w") as handle:
            json.dump(request, handle)
        result = run_adapter(project, "run", "--request", "request.json", "--dry-run")
        assert result.returncode != 0
        assert "export is not supported" in result.stderr
    finally:
        shutil.rmtree(project)


def test_file_url_cannot_escape_project() -> None:
    project, request_path = fixture()
    try:
        with open(request_path) as handle:
            request = json.load(handle)
        request["diagrams"][0] = {"id": "flow", "url": "file:///etc/passwd"}
        with open(request_path, "w") as handle:
            json.dump(request, handle)
        result = run_adapter(project, "run", "--request", "request.json", "--dry-run")
        assert result.returncode != 0
        assert "project root" in result.stderr
    finally:
        shutil.rmtree(project)


def geometry_fixture(project: str, variant: str, viewport: tuple[int, int]) -> None:
    os.makedirs(os.path.join(project, "assets"), exist_ok=True)
    nodes = [
        {"id": "start", "shape": "round", "x": 40, "y": 40, "width": 100, "height": 50},
        {"id": "done", "shape": "round", "x": 260, "y": 40, "width": 100, "height": 50},
    ]
    svg_nodes = '<g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/></g><g data-node="done" data-node-shape="round"><rect x="260" y="40" width="100" height="50"/></g>'
    groups = []
    svg_groups = ""
    legend = None
    diagram_type = "flowchart"
    svg_extra = ""
    svg_after_arrow = ""
    svg_width = 400
    svg_height = 300
    canvas_width = 400
    canvas_height = 300
    fit_viewport = viewport
    zoom_viewport = viewport
    edge_end = 260
    if variant == "node-collision":
        nodes[1]["x"] = 100
        svg_nodes = '<g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/></g><g data-node="done" data-node-shape="round"><rect x="100" y="40" width="100" height="50"/></g>'
    elif variant == "edge-collision":
        nodes.append({"id": "middle", "shape": "rect", "x": 180, "y": 40, "width": 40, "height": 50})
        svg_nodes += '<g data-node="middle" data-node-shape="rect"><rect x="180" y="40" width="40" height="50"/></g>'
    elif variant == "group-overlap":
        groups = [
            {"id": "a", "semanticType": "exclusive", "members": ["start"], "x": 20, "y": 20, "width": 180, "height": 100},
            {"id": "b", "semanticType": "exclusive", "members": ["done"], "x": 160, "y": 20, "width": 180, "height": 100},
        ]
        svg_groups = '<rect id="group-a" x="20" y="20" width="180" height="100"/><rect id="group-b" x="160" y="20" width="180" height="100"/>'
    elif variant == "legend-coverage":
        legend = {"items": [{"id": "directed-edge", "label": "流程", "meaning": "有向关系", "sample": {"kind": "edge", "ref": "start-done"}, "targets": [{"kind": "edge", "ref": "start-done"}]}]}
    elif variant == "sequence-lifeline":
        diagram_type = "sequence"
        svg_extra = '<line data-lifeline-for="start" x1="100" x2="100" y1="90" y2="260"/><line data-lifeline-for="done" x1="310" x2="310" y1="90" y2="260"/>'
    elif variant == "label-edge-collision":
        svg_extra = '<g data-edge-label="unrelated-label"><rect x="185" y="55" width="30" height="20"/><text data-text-id="label-unrelated" x="200" y="70">注</text></g>'
    elif variant == "arrow-label-occlusion":
        svg_after_arrow = '<g data-edge-label="start-done"><rect x="248" y="55" width="20" height="20"/><text data-text-id="label-start-done" x="258" y="70">注</text></g>'
    elif variant == "vertical-scroll":
        nodes[1]["x"] = 180
        nodes[1]["y"] = 500
        edge_end = 180
        svg_nodes = '<g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/></g><g data-node="done" data-node-shape="round"><rect x="180" y="500" width="100" height="50"/></g>'
        svg_extra = ""
        svg_width = 320
        svg_height = 600
        canvas_width = 320
        canvas_height = 600
        fit_viewport = (320, 720)
        zoom_viewport = (320, 720)
    if variant == "viewport-overflow":
        viewport = (320, 240)
        nodes[1]["x"] = 1000
        svg_nodes = '<g data-node="start" data-node-shape="round"><rect x="40" y="40" width="100" height="50"/></g><g data-node="done" data-node-shape="round"><rect x="1000" y="40" width="100" height="50"/></g>'
        svg_width = 1200
        canvas_width = 1200
        edge_end = 1000
    edge_path = f'M140 65 L{edge_end} 65'
    if variant == "target-port-approach":
        edge_path = "M140 65 L300 65 L260 65"
    svg_edge = f'<path data-edge="start-done" data-from="start" data-from-port="right" data-to="done" data-to-port="left" d="{edge_path}" marker-end="url(#arrow)"/>'
    svg_arrow = f'<path data-edge-arrow="start-done" data-edge="start-done" data-arrow-target="done:left" d="M{edge_end - 8} 57 L{edge_end} 65 L{edge_end - 8} 73"/>'
    svg = f'<svg viewBox="0 0 {svg_width} {svg_height}" width="{svg_width}" height="{svg_height}" role="img"><title>Geometry fixture</title><desc>FR-001 geometry fixture</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4"><path d="M0 0 L6 4 L0 8 Z"/></marker></defs>{svg_groups}{svg_nodes}{svg_extra}{svg_edge}{svg_arrow}{svg_after_arrow}<text data-text-id="requirement-reference" x="200" y="150">FR-001</text></svg>\n'
    with open(os.path.join(project, "assets", "geometry.svg"), "w") as handle:
        handle.write(svg)
    manifest = {
        "version": 1,
        "document": "geometry.md",
        "diagrams": [{
            "id": "geometry",
            "diagramType": diagram_type,
            "title": "Geometry fixture",
            "description": "Geometry fixture",
            "canvas": {"width": canvas_width, "height": canvas_height},
            "nodes": nodes,
            "edges": [{"id": "start-done", "from": "start", "fromPort": "right", "to": "done", "toPort": "left", "kind": "directed", "points": [[140, 65], [edge_end, 65]]}],
            "groups": groups,
            **({"legend": legend} if legend else {}),
        }],
    }
    with open(os.path.join(project, "assets", "geometry.diagram.json"), "w") as handle:
        json.dump(manifest, handle)
    with open(os.path.join(project, "geometry.md"), "w") as handle:
        handle.write("# Geometry\n\nFR-001\n")
    expected = {
        "version": "1",
        "type": "diagram-expected-contract",
        "source": {"kind": "approved-test-source", "ref": "geometry.md", "revision": "fixture", "digest": "sha256:" + "0" * 64},
        "generator": {"name": "generic-test-generator", "version": "1.0.0", "config_summary": "generic geometry fixture", "config_digest": "sha256:" + "1" * 64, "source_refs": ["geometry.md"]},
        "diagrams": [{
            "id": "geometry",
            "diagram_type": diagram_type,
            "intent": "验证独立业务期望与浏览器实际几何一致",
            "nodes": [{"id": node["id"], "shape": node["shape"]} for node in nodes],
            "edges": [{"id": "start-done", "from": "start", "to": "done", "from_port": "right", "to_port": "left", "kind": "directed"}],
            "groups": [{"id": group["id"], "semantic_type": group["semanticType"]} for group in groups],
            "legend_ids": [item["id"] for item in (legend or {}).get("items", [])],
            "annotation_ids": [],
            "lifeline_ids": [node["id"] for node in nodes] if diagram_type == "sequence" else [],
            "route_contract": {
                "edge_intents": [{"edge_id": "start-done", "kind": "direct", "bend_count": 0, "label_required": False}],
                "loop_lanes": [],
                "branch_groups": [],
                "exceptions": [],
            },
        }],
    }
    with open(os.path.join(project, "assets", "geometry.expected.json"), "w") as handle:
        json.dump(expected, handle)
    os.makedirs(os.path.join(project, ".aidlc", "evidence", "requirements-methods"), exist_ok=True)
    with open(os.path.join(project, ".aidlc", "evidence", "requirements-methods", "diagram-contract.json"), "w") as handle:
        json.dump({"status": "passed"}, handle)
    with open(os.path.join(project, "request.json"), "w") as handle:
        json.dump({
            "version": "1",
            "provider": "chrome-devtools",
            "target_operation": "preview",
            "stage": "requirements-methods",
            "target_reading_environment": {
                "viewport": {"width": viewport[0], "height": viewport[1]},
                "viewports": {
                    "normal": {"width": viewport[0], "height": viewport[1]},
                    "fit": {"width": fit_viewport[0], "height": fit_viewport[1]},
                    "zoom": {"width": zoom_viewport[0], "height": zoom_viewport[1]},
                },
            },
            "diagrams": [{"id": "geometry", "source_path": "assets/geometry.svg", "manifest_path": "assets/geometry.diagram.json", "expected_contract_path": "assets/geometry.expected.json"}],
        }, handle)


def test_browser_geometry_scenarios() -> None:
    cases = [
        ("valid", True, None, (800, 600)),
        ("node-collision", False, "node geometry collides", (800, 600)),
        ("edge-collision", False, "edge geometry collides with non-endpoint nodes", (800, 600)),
        ("group-overlap", False, "groups overlap unexpectedly", (800, 600)),
        ("legend-coverage", False, "browser legend coverage does not match", (800, 600)),
        ("sequence-lifeline", False, "sequence lifeline coordinate", (800, 600)),
        ("label-edge-collision", False, "SVG label geometry intersects edge geometry", (800, 600)),
        ("arrow-label-occlusion", False, "arrow overlay is occluded by a later decoration", (800, 600)),
        ("target-port-approach", False, "approaches a target from inside its visible shape", (800, 600)),
        ("vertical-scroll", True, None, (320, 240)),
        ("viewport-overflow", False, "outside the horizontal viewport", (320, 240)),
    ]
    for variant, should_pass, expected, viewport in cases:
        project = tempfile.mkdtemp(prefix=f"aidlc-provider-geometry-{variant}-")
        try:
            geometry_fixture(project, variant, viewport)
            result = run_adapter(project, "run", "--request", "request.json")
            if "NEEDS_CAPABILITY" in result.stderr:
                raise AssertionError(f"{variant}: Chrome DevTools capability unavailable: {result.stderr}")
            if should_pass:
                assert result.returncode == 0, result.stderr
                with open(os.path.join(project, ".aidlc", "evidence", "requirements-methods", "diagram-contract.json")) as handle:
                    assert json.load(handle)["provider_status"] == "passed"
            else:
                assert result.returncode != 0, variant
                assert expected in result.stderr, f"{variant}: {result.stderr}"
        finally:
            shutil.rmtree(project)


if __name__ == "__main__":
    test_dry_run_validates_request()
    test_dry_run_accepts_three_reading_views()
    test_export_is_rejected()
    test_file_url_cannot_escape_project()
    if os.environ.get("RUN_CHROME_PROVIDER_GEOMETRY") == "1":
        test_browser_geometry_scenarios()
        print("11 Chrome DevTools geometry scenarios passed")
    print("4 diagram provider adapter tests passed")
