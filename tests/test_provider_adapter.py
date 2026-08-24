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


def test_dry_run_validates_request() -> None:
    project, _ = fixture()
    try:
        result = run_adapter(project, "run", "--request", "request.json", "--dry-run")
        assert result.returncode == 0, result.stderr
        payload = json.loads(result.stdout)
        assert payload["status"] == "ready"
        assert payload["provider"] == "chrome-devtools-mcp@1.6.0"
        assert payload["plan"][0]["local_preview_fallback"] is True
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


if __name__ == "__main__":
    test_dry_run_validates_request()
    test_export_is_rejected()
    test_file_url_cannot_escape_project()
    print("3 diagram provider adapter tests passed")
