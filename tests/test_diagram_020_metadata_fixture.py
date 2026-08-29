"""Regression suite for the copied diagram-020 metadata baseline."""

import json
import os
import shutil
import subprocess
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE_ROOT = os.path.join(REPO_ROOT, "tests", "fixtures", "diagram-020")
ASSET_DIR = os.path.join("docs", "草稿", "方案设计", "zhangyi", "assets")
MANIFEST_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020.diagram.json")
EXPECTED_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020.expected.json")
REQUEST_RELATIVE_PATH = os.path.join(ASSET_DIR, "diagram-020.provider-request.json")
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


def test_diagram_020_metadata_snapshot_is_self_contained() -> None:
    manifest = load_json(FIXTURE_ROOT, MANIFEST_RELATIVE_PATH)
    expected = load_json(FIXTURE_ROOT, EXPECTED_RELATIVE_PATH)
    request = load_json(FIXTURE_ROOT, REQUEST_RELATIVE_PATH)
    diagram = manifest["diagrams"][0]
    expected_diagram = expected["diagrams"][0]

    assert manifest["version"] == 1
    assert diagram["id"] == "diagram-020"
    assert diagram["output"] == "diagram-020.svg"
    assert os.path.isfile(os.path.join(FIXTURE_ROOT, manifest["document"]))
    assert os.path.isfile(os.path.join(FIXTURE_ROOT, "docs", "正式", "20-需求文档", "搜索域", "蓝图-搜索和推荐V1.1.md"))
    assert os.path.isfile(os.path.join(FIXTURE_ROOT, "docs", "正式", "20-需求文档", "搜索域", "images", "蓝图-搜索和推荐V1.1", "搜索域运营流程-正交.svg"))
    assert len(diagram["nodes"]) == len(expected_diagram["nodes"]) == 34
    assert len(diagram["edges"]) == len(expected_diagram["edges"]) == 35
    assert {node["id"] for node in diagram["nodes"]} == {node["id"] for node in expected_diagram["nodes"]}
    assert {edge["id"] for edge in diagram["edges"]} == {edge["id"] for edge in expected_diagram["edges"]}
    assert len(diagram["groups"]) == 3

    provider_diagram = request["diagrams"][0]
    assert request["provider"] == "chrome-devtools"
    assert request["target_operation"] == "preview"
    assert provider_diagram["id"] == diagram["id"]
    assert provider_diagram["manifest_path"] == MANIFEST_RELATIVE_PATH.replace(os.sep, "/")
    assert provider_diagram["expected_contract_path"] == EXPECTED_RELATIVE_PATH.replace(os.sep, "/")
    assert set(request["target_reading_environment"]["viewports"]) == {"normal", "fit", "zoom"}


def test_diagram_020_raw_metadata_is_explicitly_marked_as_unmigrated() -> None:
    manifest = load_json(FIXTURE_ROOT, MANIFEST_RELATIVE_PATH)
    diagram = manifest["diagrams"][0]

    assert "canvas" not in diagram
    assert all("styleRole" not in group for group in diagram["groups"])
    assert "command_argv" not in diagram["generation"]


def test_diagram_020_raw_metadata_fails_closed_in_source_checker() -> None:
    project = tempfile.mkdtemp(prefix="aidlc-diagram-020-metadata-")
    try:
        shutil.copytree(FIXTURE_ROOT, project, dirs_exist_ok=True)
        result = run_checker(project)
        assert result.returncode != 0
        assert "diagram diagram-020 canvas is invalid" in result.stderr
    finally:
        shutil.rmtree(project)


if __name__ == "__main__":
    test_diagram_020_metadata_snapshot_is_self_contained()
    test_diagram_020_raw_metadata_is_explicitly_marked_as_unmigrated()
    test_diagram_020_raw_metadata_fails_closed_in_source_checker()
    print("diagram-020 metadata fixture tests passed")
