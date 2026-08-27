"""Regression tests for parity between core/ and every built harness."""

import filecmp
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "core"

HARNESS_CORE_DIRS = {
    "claude": (
        ROOT / "dist" / "claude",
        [
            ("tools", "tools"),
            ("stages/ideation", "stages/ideation"),
            ("stages/inception", "stages/inception"),
            ("stages/construction", "stages/construction"),
            ("stages/operation", "stages/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
        ],
    ),
    "codex": (
        ROOT / "dist" / "codex" / ".agents" / "skills" / "loeyae-aidlc",
        [
            ("tools", "tools"),
            ("stages/ideation", "stages/ideation"),
            ("stages/inception", "stages/inception"),
            ("stages/construction", "stages/construction"),
            ("stages/operation", "stages/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
        ],
    ),
    "kiro-cli": (
        ROOT / "dist" / "kiro-cli",
        [
            ("tools", "tools"),
            ("stages/ideation", "stages/ideation"),
            ("stages/inception", "stages/inception"),
            ("stages/construction", "stages/construction"),
            ("stages/operation", "stages/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
            ("hooks/kiro", "hooks"),
        ],
    ),
    "kiro-crew": (
        ROOT / "dist" / "kiro-crew" / "skills" / "loeyae-aidlc",
        [
            ("tools", "tools"),
            ("stages/ideation", "stages/ideation"),
            ("stages/inception", "stages/inception"),
            ("stages/construction", "stages/construction"),
            ("stages/operation", "stages/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
        ],
    ),
    "kiro-ide": (
        ROOT / "dist" / "kiro-ide",
        [
            ("tools", "tools"),
            ("stages/ideation", "steering/ideation"),
            ("stages/inception", "steering/inception"),
            ("stages/construction", "steering/construction"),
            ("stages/operation", "steering/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
            ("hooks/kiro", "hooks"),
        ],
    ),
    "opencode": (
        ROOT / "dist" / "opencode" / ".opencode",
        [
            ("tools", "tools"),
            ("stages/ideation", "stages/ideation"),
            ("stages/inception", "stages/inception"),
            ("stages/construction", "stages/construction"),
            ("stages/operation", "stages/operation"),
            ("knowledge", "knowledge"),
            ("sensors", "sensors"),
            ("skills", "skills"),
        ],
    ),
}


def check_parity() -> tuple[int, list[str]]:
    checked = 0
    failures: list[str] = []

    graph_path = CORE / "tools" / "data" / "stage-graph.json"
    if graph_path.is_file():
        graph = json.loads(graph_path.read_text())
        if "compiled_at" in graph:
            failures.append("core: stage-graph.json must not contain compiled_at")

    for harness, (destination_root, mappings) in HARNESS_CORE_DIRS.items():
        for source_relative, destination_relative in mappings:
            source_root = CORE / source_relative
            destination_root_for_mapping = destination_root / destination_relative
            if not source_root.is_dir():
                failures.append(f"{harness}: missing source {source_relative}")
                continue
            if not destination_root_for_mapping.is_dir():
                failures.append(f"{harness}: missing destination {destination_relative}")
                continue

            for source_file in source_root.rglob("*"):
                if not source_file.is_file():
                    continue
                relative = source_file.relative_to(source_root)
                checked += 1
                destination_file = destination_root_for_mapping / relative
                if not destination_file.is_file():
                    failures.append(f"{harness}: missing {destination_relative}/{relative}")
                elif not filecmp.cmp(source_file, destination_file, shallow=False):
                    failures.append(f"{harness}: mismatch {source_relative}/{relative}")

    return checked, failures


def main() -> None:
    checked, failures = check_parity()
    if failures:
        raise AssertionError("\n".join(failures))
    print(f"Distribution core parity passed ({checked} files across {len(HARNESS_CORE_DIRS)} harnesses)")


if __name__ == "__main__":
    main()
