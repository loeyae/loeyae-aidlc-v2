#!/usr/bin/env python3
"""diagram-020 migrated positive regression suite."""

import json
import os
import shutil
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-020-migrated")
RAW_FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-020")
ASSET_DIR = os.path.join("docs", "草稿", "方案设计", "zhangyi", "assets")
MANIFEST_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020-migrated.diagram.json")
EXPECTED_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020-migrated.expected.json")
REQUEST_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020-migrated.provider-request.json")
SOURCE_GRAPH_RELATIVE_PATH = "diagram-020-migrated.source-graph.json"
CHECKER = os.path.join(REPO_ROOT, "core", "tools", "aidlc-semantic-checks.ts")


def load_json(root: str, relative_path: str) -> dict:
    with open(os.path.join(root, relative_path), encoding="utf-8") as handle:
        return json.load(handle)


def run_checker(project: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", CHECKER, "--sensor", "diagram-contract"],
        cwd=project,
        capture_output=True,
        text=True,
    )


def test_migrated_fixture_preserves_semantics_and_has_capacity_contract() -> None:
    manifest = load_json(FIXTURE_ROOT, MANIFEST_RELATIVE_PATH)
    expected = load_json(FIXTURE_ROOT, EXPECTED_RELATIVE_PATH)
    request = load_json(FIXTURE_ROOT, REQUEST_RELATIVE_PATH)
    source_graph = load_json(FIXTURE_ROOT, SOURCE_GRAPH_RELATIVE_PATH)
    raw_manifest = load_json(RAW_FIXTURE_ROOT, os.path.join(ASSET_DIR, "diagram-020.diagram.json"))
    diagram = manifest["diagrams"][0]
    expected_diagram = expected["diagrams"][0]

    assert manifest["version"] == 1
    assert diagram["id"] == "diagram-020"
    assert diagram["output"] == "diagram-020-migrated.svg"
    assert diagram["canvas"] == {"width": 3200, "height": 2200}
    assert os.path.isfile(os.path.join(FIXTURE_ROOT, manifest["document"]))
    assert os.path.isfile(os.path.join(FIXTURE_ROOT, "docs", "正式", "20-需求文档", "搜索域", "蓝图-搜索和推荐V1.1.md"))
    assert len(source_graph["nodes"]) == len(diagram["nodes"]) == len(expected_diagram["nodes"]) == 34
    assert len(source_graph["edges"]) == len(diagram["edges"]) == len(expected_diagram["edges"]) == 35
    assert {node["id"] for node in diagram["nodes"]} == {node["id"] for node in expected_diagram["nodes"]}
    assert {edge["id"] for edge in diagram["edges"]} == {edge["id"] for edge in expected_diagram["edges"]}
    assert {edge["id"] for edge in source_graph["edges"]} == {edge["id"] for edge in diagram["edges"]}
    raw_diagram = raw_manifest["diagrams"][0]
    raw_nodes = {node["id"]: node for node in raw_diagram["nodes"]}
    migrated_nodes = {node["id"]: node for node in diagram["nodes"]}
    assert {node_id: (node["label"], node["shape"]) for node_id, node in migrated_nodes.items()} == {node_id: (node["label"], node["shape"]) for node_id, node in raw_nodes.items()}
    raw_edges = {edge["id"]: edge for edge in raw_diagram["edges"]}
    migrated_edges = {edge["id"]: edge for edge in diagram["edges"]}
    for edge_id, raw_edge in raw_edges.items():
        migrated_edge = migrated_edges[edge_id]
        assert {key: migrated_edge[key] for key in ("from", "to", "fromPort", "toPort", "kind")} == {key: raw_edge[key] for key in ("from", "to", "fromPort", "toPort", "kind")}
        assert migrated_edge.get("label", {}).get("text") == raw_edge.get("label", {}).get("text")
    assert len(diagram["groups"]) == 3
    assert all(group["styleRole"] == "structural" for group in diagram["groups"])
    assert all(group["width"] >= 2 * 40 for group in diagram["groups"])
    assert diagram["designNotes"]["layout"]["direction"] == "TB"
    assert all(item["status"] == "UNVERIFIED" for item in diagram["designNotes"]["layout"]["readabilityEvidence"].values())

    provider_diagram = request["diagrams"][0]
    assert request["provider"] == "chrome-devtools"
    assert request["target_operation"] == "preview"
    assert provider_diagram["id"] == diagram["id"]
    assert provider_diagram["manifest_path"] == MANIFEST_RELATIVE_PATH.replace(os.sep, "/")
    assert provider_diagram["expected_contract_path"] == EXPECTED_RELATIVE_PATH.replace(os.sep, "/")
    assert set(request["target_reading_environment"]["viewports"]) == {"normal", "fit", "zoom"}


def test_migrated_fixture_reaches_static_pass_without_browser_claim() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-020-migrated-")
    try:
        shutil.copytree(FIXTURE_ROOT, project, dirs_exist_ok=True)
        result = run_checker(project)
        assert result.returncode == 0, result.stderr
        report = json.loads(result.stdout)
        assert report["final_status"] == "STATIC_PASS"
        assert report["structure_status"] == "STRUCTURE_PASS"
        assert report["route_contract_status"] == "ROUTE_CONTRACT_PASS"
        assert report["geometry_gate_status"] == "GEOMETRY_PASS"
        assert report["generation_status"] == "passed"
        assert report["node_text_fit_status"] == "passed"
        assert report["group_capacity_status"] == "passed"
        assert report["visual_status"] == "UNVERIFIED"
    finally:
        shutil.rmtree(project)


if __name__ == "__main__":
    test_migrated_fixture_preserves_semantics_and_has_capacity_contract()
    test_migrated_fixture_reaches_static_pass_without_browser_claim()
    print("diagram-020 migrated tests passed")
