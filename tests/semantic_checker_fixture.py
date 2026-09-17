"""Cross-platform Markdown workflow fixture for direct semantic checker tests."""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TSX = subprocess.check_output(
    ["node", "-p", "require.resolve('tsx/cli')"],
    cwd=REPO_ROOT,
    text=True,
).strip()


def checker_environment(project: str) -> dict[str, str]:
    env = os.environ.copy()
    env.pop("AIDLC_ACTIVE_MODULE", None)
    env.pop("AIDLC_ACTIVE_UNIT", None)
    return env


def write_checker_state(project: str) -> None:
    state_uri = (REPO_ROOT / "core" / "tools" / "aidlc-light-state.ts").as_uri()
    script = f"""
import {{ createInitialState, saveWorkflowState }} from {json.dumps(state_uri)};
const state = createInitialState('feature', '4.0.0', 'semantic-checker-fixture', [], 'semantic checker fixture');
state.current_phase = 'inception';
state.current_stage = 'requirements-methods';
saveWorkflowState(process.cwd(), state);
"""
    result = subprocess.run(
        ["node", TSX, "--eval", script],
        cwd=project,
        env=checker_environment(project),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr or result.stdout)
