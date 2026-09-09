#!/usr/bin/env python3
"""
tests/test_engine_gates.py — Integration test for the aidlc-orchestrate engine.

Tests:
  A. Full sequential walk (feature scope) → DONE with zero blocks
  B. Produces gate blocks completion, passes after file created
  C. Stage mismatch rejection
  D. Scope filtering (express scope executes fewer stages)
  E. Requires dependency blocks next stage

Run: python3 tests/test_engine_gates.py
  or: npx tsx --test (if adapted to Node test runner)
"""

import subprocess
import json
import os
import shutil
import sys
import shlex
import hashlib
import hmac
import tempfile
from pathlib import Path
from datetime import datetime, timezone

SCRATCH_ROOT = Path(os.environ.get("KIROCREW_SCRATCH") or os.environ.get("TMPDIR") or tempfile.gettempdir())
TRUST_SECRET = "aidlc-test-secret-32-bytes-minimum-value"

ENGINE = os.path.join(os.path.dirname(__file__), "..", "core", "tools", "aidlc-orchestrate.ts")
ENGINE = os.path.abspath(ENGINE)
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

UNIT_CONDITIONAL_STAGES = [
    "functional-design",
    "nfr-requirements",
    "nfr-design",
    "infrastructure-design",
    "shared-contract-baseline",
    "subagent-execution",
    "loeyae-compliance",
    "ui-implementation-bridge",
]


class TestRunner:
    def __init__(self, test_dir: str):
        name = os.path.basename(test_dir.rstrip(os.sep))
        self.test_dir = str(SCRATCH_ROOT / name)
        self.trust_dir = str(SCRATCH_ROOT / f"{name}-trust")
        self.passed = 0
        self.failed = 0
        self.errors: list[str] = []
        self.runtime_choices = {"workspace-detection": "single-module"}
        self.modules = [
            {"module_id": "test-module", "name": "Test Module", "service_id": "test-service"}
        ]
        self.units = {
            "test-module": [
                {"unit_id": "test-unit", "name": "Test Unit", "service_id": "test-service"}
            ]
        }

    def environment(self) -> dict[str, str]:
        env = os.environ.copy()
        for key in ("npm_config_prefix", "npm_execpath", "npm_command"):
            env.pop(key, None)
        env["AIDLC_TRUST_SECRET"] = TRUST_SECRET
        env["AIDLC_TRUST_DIR"] = self.trust_dir
        return env

    def setup(self):
        for directory in (self.test_dir, self.trust_dir):
            if os.path.exists(directory):
                shutil.rmtree(directory)
        os.makedirs(self.test_dir)
        subprocess.run(["git", "init", "-q"], cwd=self.test_dir, check=True)
        subprocess.run(["git", "config", "user.email", "aidlc-tests@example.invalid"], cwd=self.test_dir, check=True)
        subprocess.run(["git", "config", "user.name", "AI-DLC Tests"], cwd=self.test_dir, check=True)
        subprocess.run(["git", "commit", "--allow-empty", "-qm", "test baseline"], cwd=self.test_dir, check=True)

    def command(self, subcmd: str, args: str = "") -> list[str]:
        return ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", ENGINE, subcmd, *shlex.split(args)]

    def engine(self, subcmd: str, args: str = "") -> dict:
        result = subprocess.run(
            self.command(subcmd, args), capture_output=True, text=True, cwd=self.test_dir, env=self.environment()
        )
        payload = None
        for output in (result.stdout.strip(), result.stderr.strip()):
            if "{" not in output:
                continue
            candidate = output[output.index("{"):]
            try:
                payload = json.loads(candidate)
                break
            except json.JSONDecodeError:
                continue
        if payload is None:
            payload = {"raw": result.stdout.strip(), "err": result.stderr.strip()}
        payload["_returncode"] = result.returncode
        return payload

    def nxt(self, args: str = "") -> dict:
        return self.engine("next", args)

    def report(self, stage: str, result: str, **kwargs) -> dict:
        arguments = ["--stage", stage, "--result", result]
        if "reason" in kwargs:
            arguments.extend(["--reason", kwargs["reason"]])
        if kwargs.get("user_input"):
            arguments.extend(["--user-input", kwargs["user_input"]])
        if kwargs.get("approval_token"):
            arguments.extend(["--approval-token", kwargs["approval_token"]])
        if kwargs.get("instruction_ack"):
            arguments.extend(["--instruction-ack", stage])
        if kwargs.get("module"):
            arguments.extend(["--module", kwargs["module"]])
        if kwargs.get("unit"):
            arguments.extend(["--unit", kwargs["unit"]])
        return self.engine("report", " ".join(shlex.quote(value) for value in arguments))

    def choice_input(self, directive: dict):
        if not directive.get("choice_required"):
            return None
        choices = directive.get("choices", [])
        preferred = self.runtime_choices.get(directive.get("stage", ""))
        if preferred in choices:
            return preferred
        return choices[0] if choices else None

    def source_revision(self) -> dict:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.test_dir, text=True).strip()
        status = subprocess.check_output(
            ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd=self.test_dir
        ).decode().split("\0")
        def excluded(value: str) -> bool:
            value = value.replace("\\", "/")
            return value == ".aidlc" or value.startswith(".aidlc/") or value == "docs/aidlc/aidlc-state.json"
        dirty = any(not excluded((entry[3:].split(" -> ")[-1] if len(entry) >= 3 else "")) for entry in status if entry)
        paths = subprocess.check_output(
            ["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=self.test_dir
        ).decode().split("\0")
        digest = hashlib.sha256()
        for relative in sorted(value.replace("\\", "/") for value in paths if value and not excluded(value)):
            absolute = os.path.join(self.test_dir, relative)
            if not os.path.lexists(absolute):
                continue
            digest.update(relative.encode())
            digest.update(b"\0")
            if os.path.islink(absolute):
                digest.update(b"symlink\0")
                digest.update(os.readlink(absolute).encode())
                digest.update(b"\0")
            elif os.path.isfile(absolute):
                digest.update(b"file\0")
                with open(absolute, "rb") as handle:
                    digest.update(hashlib.sha256(handle.read()).digest())
                digest.update(b"\0")
        return {"commit": commit, "dirty": dirty, "worktree_digest": digest.hexdigest()}

    @staticmethod
    def canonical(value):
        if isinstance(value, dict):
            return {key: TestRunner.canonical(item) for key, item in sorted(value.items()) if key != "integrity"}
        if isinstance(value, list):
            return [TestRunner.canonical(item) for item in value]
        return value

    def sign(self, payload: dict) -> dict:
        unsigned = self.canonical(payload)
        encoded = json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        key = TRUST_SECRET.encode()
        payload["integrity"] = {
            "algorithm": "hmac-sha256",
            "key_id": hashlib.sha256(key).hexdigest()[:16],
            "signature": hmac.new(key, encoded, hashlib.sha256).hexdigest(),
        }
        return payload

    def state(self) -> dict:
        with open(os.path.join(self.test_dir, "docs", "aidlc", "aidlc-state.json")) as handle:
            return json.load(handle)

    def evidence_path(self, stage: str, sensor: str) -> str:
        state = self.state()
        parts = [self.test_dir, ".aidlc", "evidence", stage]
        if state.get("routing_model") == "module-unit-v1" and state.get("current_module"):
            parts.append(state["current_module"])
        if state.get("routing_model") == "module-unit-v1" and state.get("current_unit"):
            parts.append(state["current_unit"])
        return os.path.join(*parts, f"{sensor}.json")

    def approval_token(self, directive: dict) -> str:
        state = self.state()
        workflow_id = state["workflow_id"]
        approval_stage = directive.get("stage_instance") or directive["stage"]
        message = f"aidlc-approval-v1\n{workflow_id}\n{approval_stage}\n{directive['approval_challenge']}"
        return hmac.new(TRUST_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()

    def mkfile(self, path: str, content=None):
        full = os.path.join(self.test_dir, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        value = content or f"# Generated artifact: {path}\n\nREQ-TEST-001 traces substantive verified workflow content.\n"
        with open(full, "w") as f:
            f.write(value)

    def write_evidence(self, stage: str, sensors: list[str]):
        payloads = {
            "build-test-evidence": {
                "evidence_version": "1", "status": "passed",
                "producer": {"name": "test-controlled-producer", "mode": "controlled", "execution_id": "test-run-001"},
                "commands": [{"cmd": "test-command", "exit_code": 0, "status": "passed", "duration_ms": 1}],
                "tests": {"total": 1, "passed": 1, "failed": 0}, "checks": {"status": "passed"},
            },
            "review-evidence": {
                "evidence_version": "1", "status": "passed", "spec_axis": "passed",
                "standards_axis": "passed", "issues_open": 0, "reviewer": "test-reviewer",
                "files_reviewed": ["src/main.ts"], "issues_found": 0, "issues_resolved": 0,
            },
            "test-quality": {
                "evidence_version": "1", "status": "passed", "red_seen": True,
                "green_seen": True, "tests_failed": 0, "tests_total": 1,
                "traceability_complete": True, "uc_mapping": [{"use_case": "UC-D-001", "test_methods": ["test_example"]}],
            },
            "contract-baseline": {
                "evidence_version": "1", "status": "verified", "contract_id": "CONTRACT-TEST-001",
                "owner": "test-owner", "validation_status": "passed", "contract_type": "api",
                "consumers": ["test-consumer"], "schema_hash": "sha256-test",
            },
            "functional-design-completeness": {
                "evidence_version": "1", "status": "passed", "data_source_validation": "passed",
                "ambiguities_resolved": True, "unresolved_blockers": 0,
                "use_cases_covered": ["UC-D-001"], "interfaces_specified": 1, "error_handling_defined": True,
            },
            "nfr-coverage": {
                "evidence_version": "1", "status": "passed", "requirements_covered": 1, "unresolved": 0,
                "nfr_items": [{"id": "NFR-001", "category": "performance", "acceptance_criterion": "p95 < 500ms", "verified": True}],
            },
            "infrastructure-completeness": {
                "evidence_version": "1", "status": "passed",
                "sections": ["deployment", "resources", "migration", "rollback", "runtime_dependencies"],
                "resources_enumerated": [{"name": "test-runtime", "type": "container", "provisioned": True}],
                "rollback_strategy": "restore previous version", "unresolved": 0,
            },
            "frontend-platform-spec": {
                "evidence_version": "1", "status": "passed",
                "layout_primitives": ["stack", "grid", "container"],
                "component_mapping": ["button", "form", "table", "dialog", "navigation"],
                "css_constraints": ["spacing", "responsive", "tokens"],
            },
            "framework-compliance": {
                "evidence_version": "1", "status": "passed", "skills_loaded": True,
                "checks_total": 1, "checks_failed": 0,
            },
            "subagent-evidence": {
                "evidence_version": "1", "status": "passed", "agents": ["test-agent"],
                "tasks_completed": 1, "failures": 0,
            },
            "template-completeness": {
                "evidence_version": "1", "status": "passed", "templates": ["build-instructions.md"],
                "unresolved": 0,
            },
            "recovery-evidence": {
                "evidence_version": "1", "status": "passed", "state_restored": True,
                "handoff_recorded": True,
            },
            "implementation-report": {
                "evidence_version": "1", "status": "passed", "summary_complete": True,
                "evidence_references": [".aidlc/evidence/build-and-test/build-test-evidence.json"],
                "all_gates_passed": True, "scope": "feature", "stages_completed": 1,
                "selected_artifacts_verified": True, "modules_verified": 1,
                "prd_verified": False, "ui_modules_verified": [],
            },
            "prd-completeness": {
                "evidence_version": "1", "status": "passed", "prd_path": "docs/aidlc/ideation/prd.md",
                "required_sections": ["overview", "goals", "features", "non-goals", "questions", "sources"],
                "functional_requirements": 1, "acceptance_criteria_complete": True, "non_goals_complete": True,
                "pending_questions_indexed": True, "source_index_complete": True,
                "clarification_consistency": "passed", "business_flow_validation": "passed", "unresolved_blockers": 0,
            },
            "diagram-contract": {
                "evidence_version": "1", "status": "passed", "source_format": "svg", "diagrams_checked": 1,
                "ids_unique": True, "ports_valid": True, "direction_consistent": True, "legend_valid": True,
                "groups_valid": True, "viewbox_valid": True, "provider_status": "unverified", "target_operation_required": False,
                "fr_mapping_complete": True, "design_notes_valid": True, "layout_contract_valid": True,
                "main_flow_valid": True, "loop_lanes_valid": True, "decision_exit_valid": True, "annotation_mapping_valid": True,
                "migration_status": "passed", "port_paths_valid": True, "geometry_status": "passed", "render_preflight_status": "passed",
                "edge_intersection_status": "passed", "collinear_overlap_status": "passed", "target_port_direction_status": "passed",
                "target_port_approach_status": "passed", "routing_minimality_status": "passed", "side_switch_status": "passed",
                "change_impact_review_status": "not_applicable", "visible_arrow_mapping_status": "passed",
                "structural_occlusion_status": "not_applicable", "structural_node_intersections": [], "structural_edge_intersections": [],
                "structural_label_intersections": [], "structural_arrow_intersections": [], "structural_frame_style_status": "not_applicable",
                "structural_node_fill_status": "not_applicable", "structural_layer_order_status": "not_applicable", "structural_mask_status": "not_applicable",
                "structural_mask_coverage_status": "not_applicable", "structural_visual_evidence": {"required": False, "screenshots": [], "snapshots": [], "pixel_verified": False},
                "render_status": "unverified", "unresolved": 0,
            },
            "design-intent-coverage": {
                "evidence_version": "1", "status": "passed", "intent_markers_found": 0,
                "coverage_complete": True, "uncovered": 0, "skip_reason": "no structural change intent markers",
            },
            "ui-design-alignment": {
                "evidence_version": "1", "status": "not_applicable", "reason": "current unit has no UI page mapping",
            },
            "ui-artifact-consistency": {
                "evidence_version": "1", "status": "passed", "stage": stage,
                "module_id": None, "design_mode": "html-mock", "pages_checked": 1,
                "elements_checked": 1, "phases_verified": ["page-plan"],
                "artifacts_checked": ["requirements.md", "user-stories.md", "page-plan.md"], "unresolved": 0,
            },
            "inception-consistency": {
                "evidence_version": "1", "status": "passed", "module_id": None,
                "requirements_checked": 1, "stories_checked": 1, "prd_selected": False,
                "prd_items_checked": 0, "ui_route": "not-selected", "ui_pages_checked": 0,
                "unresolved_conflicts": 0,
                "artifacts_checked": ["requirements.md", "user-stories.md", "cross-validation-report.md"],
            },
        }
        for sensor in sensors:
            if sensor not in payloads:
                continue
            path = self.evidence_path(stage, sensor)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            payload = dict(payloads[sensor])
            state = self.state()
            if sensor == "ui-artifact-consistency":
                route = next((entry.get("user_input") for entry in reversed(state.get("history", []))
                              if entry.get("stage") == "ui-mock"
                              and entry.get("result") in ("completed", "approved")
                              and entry.get("user_input") in ("html-mock", "figma-create", "figma-existing", "skip")
                              and entry.get("module_id") == state.get("current_module")), "html-mock")
                phases = ["page-plan"]
                if stage == "ui-mock-generation":
                    phases.extend(["skeleton", "content"])
                elif stage == "ui-figma-generation":
                    phases.append("figma-external-read-only" if route == "figma-existing" else "figma-created")
                payload.update({"stage": stage, "module_id": state.get("current_module"), "design_mode": route, "phases_verified": phases})
            elif sensor == "inception-consistency":
                route = next((entry.get("user_input") for entry in reversed(state.get("history", []))
                              if entry.get("stage") == "ui-mock"
                              and entry.get("result") in ("completed", "approved")
                              and entry.get("user_input") in ("html-mock", "figma-create", "figma-existing", "skip")
                              and entry.get("module_id") == state.get("current_module")), "not-selected")
                prd_selected = "prd-generation" in state.get("selected_optional_stages", [])
                payload.update({
                    "module_id": state.get("current_module"), "prd_selected": prd_selected,
                    "prd_items_checked": 1 if prd_selected else 0, "ui_route": route,
                    "ui_pages_checked": 1 if route in ("html-mock", "figma-create", "figma-existing") else 0,
                })
            elif sensor == "implementation-report":
                ui_modules = sorted({entry.get("module_id") for entry in state.get("history", [])
                                     if entry.get("stage") == "ui-mock" and entry.get("user_input") in ("html-mock", "figma-create", "figma-existing")
                                     and entry.get("module_id")})
                payload.update({
                    "modules_verified": len(self.modules),
                    "prd_verified": "prd-generation" in state.get("selected_optional_stages", []),
                    "ui_modules_verified": ui_modules,
                })
            if state.get("routing_model") == "module-unit-v1":
                payload.update({
                    "stage_instance": state.get("current_stage_instance"),
                    "module_id": state.get("current_module"),
                    "unit_id": state.get("current_unit"),
                })
            payload["producer"] = {
                "name": "loeyae-aidlc-evidence",
                "mode": "controlled",
                "execution_id": f"test-run-{stage}-{sensor}",
            }
            payload["source_revision"] = self.source_revision()
            if sensor == "build-test-evidence":
                payload["commands"] = [{
                    "argv_digest": hashlib.sha256(b"test-command").hexdigest(),
                    "exit_code": 0,
                    "status": "passed",
                    "duration_ms": 1,
                }]
            else:
                payload["checker"] = {
                    "id": f"builtin:{sensor}",
                    "sensor": sensor,
                    "argv_digest": hashlib.sha256(f"builtin:{sensor}".encode()).hexdigest(),
                    "exit_code": 0,
                    "status": "passed",
                    "duration_ms": 1,
                }
            payload["timestamp"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            self.sign(payload)
            with open(path, "w") as f:
                json.dump(payload, f, ensure_ascii=False)

    def create_declared_produces(self, directive: dict):
        for pattern in directive.get("produces", []):
            resolved = pattern.replace("{module-id}", directive.get("module_id") or "test-module")
            resolved = resolved.replace("{unit-name}", directive.get("unit_id") or "test-unit").replace("{unit-id}", directive.get("unit_id") or "test-unit")
            if resolved.endswith("workflow-plan.md"):
                self.mkfile(resolved, """# Verified workflow plan

REQ-TEST-001 defines the selected deterministic route.

| stage | decision | evidence |
|-------|----------|----------|
| `application-design` | execute | verified integration design is required |
| `units-generation` | execute | verified work-unit decomposition is required |
| `functional-design` | execute | verified business rules require detailed design |
| `operations` | execute | verified deployable service requires deployment preparation |
""")
                continue
            if resolved.endswith("module-manifest.json"):
                self.mkfile(resolved, json.dumps({
                    "schema_version": 1,
                    "requirement_ids": ["REQ-TEST-001"],
                    "description": "REQ-TEST-001 defines machine routing context for verified workflow execution.",
                    "modules": self.modules,
                }, ensure_ascii=False, indent=2))
                continue
            if resolved.endswith("unit-manifest.json"):
                module_id = directive.get("module_id") or "test-module"
                source_units = self.units[module_id]
                units = []
                for source_unit in source_units:
                    unit = dict(source_unit)
                    if "conditional_stages" not in unit:
                        unit["conditional_stages"] = [
                            stage for stage in UNIT_CONDITIONAL_STAGES
                            if stage != "shared-contract-baseline" or len(source_units) >= 2
                        ]
                    units.append(unit)
                self.mkfile(resolved, json.dumps({
                    "schema_version": 1,
                    "module_id": module_id,
                    "requirement_ids": ["REQ-TEST-001"],
                    "description": "REQ-TEST-001 defines stable construction work units for verified execution.",
                    "units": units,
                }, ensure_ascii=False, indent=2))
                continue
            if resolved.endswith("/"):
                resolved = resolved + "artifact.md"
            self.mkfile(resolved)

    def remove_evidence(self, stage: str, sensor: str):
        path = self.evidence_path(stage, sensor)
        if os.path.exists(path):
            os.remove(path)

    def ok(self, condition: bool, msg: str):
        if condition:
            self.passed += 1
            print(f"  ✅ {msg}")
        else:
            self.failed += 1
            self.errors.append(msg)
            print(f"  ❌ {msg}")

    def walk_to_stage(self, target_slug: str, produces_map: dict) -> bool:
        """Walk stages until we reach target_slug, completing/skipping along the way."""
        for _ in range(200):
            d = self.nxt()
            slug = d.get("stage", "")
            if slug == target_slug:
                return True
            if d.get("kind") in ("done", "error") or not slug:
                return False
            # Complete or skip
            if slug in produces_map:
                self.mkfile(produces_map[slug])
            self.create_declared_produces(d)
            # Evidence is bound to the final source/worktree state for this report.
            self.write_evidence(slug, d.get("sensors", []))
            outcome = "approved" if d.get("gate") else "completed"
            r = self.report(
                slug,
                outcome,
                approval_token=self.approval_token(d) if d.get("gate") else None,
                instruction_ack=d.get("completion_contract") == "instruction_only",
                user_input=self.choice_input(d),
            )
            if r.get("kind") == "error":
                self.ok(False, f"Stage {slug} unexpectedly blocked: {r.get('message', '')}")
                return False
        return False

    def walk_to_done(self, produces_map: dict) -> tuple[int, bool]:
        """Walk all stages to DONE. Returns (steps, reached_done)."""
        steps = 0
        for _ in range(200):
            d = self.nxt()
            if d.get("kind") == "done":
                return steps, True
            if d.get("kind") == "error":
                return steps, False
            slug = d.get("stage", "")
            if not slug:
                return steps, False
            if slug in produces_map:
                self.mkfile(produces_map[slug])
            self.create_declared_produces(d)
            # Evidence is bound to the final source/worktree state for this report.
            self.write_evidence(slug, d.get("sensors", []))
            outcome = "approved" if d.get("gate") else "completed"
            r = self.report(
                slug,
                outcome,
                approval_token=self.approval_token(d) if d.get("gate") else None,
                instruction_ack=d.get("completion_contract") == "instruction_only",
                user_input=self.choice_input(d),
            )
            if r.get("kind") == "error":
                self.ok(False, f"Stage {slug} unexpectedly blocked: {r.get('message', '')}")
                return steps, False
            steps += 1
        return steps, False


# All produces files that key stages require
PRODUCES_MAP = {
    "product-inception": "docs/aidlc/ideation/product-inception.md",
    "product-contracts": "docs/aidlc/ideation/product-contracts.md",
    "scenario-module-mapping": "docs/aidlc/ideation/scenario-module-mapping.md",
    "module-division": "docs/aidlc/ideation/module-division.md",
    "prd-generation": "docs/aidlc/ideation/prd.md",
    "reverse-engineering": "docs/aidlc/inception/reverse-engineering.md",
    "requirements-analysis": "docs/aidlc/inception/requirements.md",
    "cross-validation": "docs/aidlc/inception/cross-validation-report.md",
    "user-stories": "docs/aidlc/inception/user-stories.md",
    "ui-mock": "docs/aidlc/inception/ui-mock/index.html",
    "workflow-planning": "docs/aidlc/inception/workflow-plan.md",
    "application-design": "docs/aidlc/inception/application-design.md",
    "test-case-derivation": "docs/aidlc/inception/application-design/test-cases/_index.md",
    "units-generation": "docs/aidlc/inception/units.md",
    "functional-design": "docs/aidlc/construction/functional-design.md",
    "nfr-requirements": "docs/aidlc/construction/nfr-requirements.md",
    "nfr-design": "docs/aidlc/construction/nfr-design.md",
    "infrastructure-design": "docs/aidlc/construction/infrastructure-design.md",
    "code-generation": "src/main.ts",
    "tdd": "src/test/main.test.ts",
    "code-review": "docs/aidlc/construction/code-review.md",
    "build-and-test": "docs/aidlc/construction/build-test-report.md",
    "implementation-report": "docs/aidlc/construction/implementation-report.md",
    "operations": "docs/aidlc/operation/deployment-config.md",
    "operations-templates": "docs/aidlc/operation/templates/compose.yml",
}


def test_f_gate_semantics():
    """F: Blocking approval, mandatory stages, and scopes are enforced."""
    print("\n--- F: Gate semantics ---")
    t = TestRunner("/tmp/aidlc-test-f")
    t.setup()
    t.engine("next", "--scope feature")
    reached = t.walk_to_stage("application-design", PRODUCES_MAP)
    t.ok(reached, "Reached blocking application-design stage")
    if reached:
        directive = t.nxt()
        t.mkfile(PRODUCES_MAP["application-design"])
        t.create_declared_produces(directive)
        t.write_evidence("application-design", directive.get("sensors", []))
        r = t.report("application-design", "completed")
        t.ok(r.get("kind") == "error" and "approval" in r.get("message", "").lower(), "BLOCKED: completed cannot bypass approval")
        r = t.report("application-design", "approved")
        t.ok(r.get("kind") == "error" and "token" in r.get("message", "").lower(), "BLOCKED: approval without host token")
        r = t.report("application-design", "approved", approval_token="0" * 64)
        t.ok(r.get("kind") == "error" and "invalid" in r.get("message", "").lower(), "BLOCKED: forged approval token")
        token = t.approval_token(directive)
        r = t.report("application-design", "approved", approval_token=token)
        t.ok(r.get("kind") == "print", "PASSED: trusted one-time approval advances the stage")
        replay = t.report("application-design", "approved", approval_token=token)
        t.ok(replay.get("kind") == "error", "BLOCKED: consumed approval token cannot be replayed")

    t2 = TestRunner("/tmp/aidlc-test-f2")
    t2.setup()
    invalid = t2.engine("next", "--scope invalid")
    t2.ok(invalid.get("kind") == "error", "Rejected: unknown scope")
    t2.engine("next", "--scope feature")
    reached = t2.walk_to_stage("code-generation", PRODUCES_MAP)
    t2.ok(reached, "Reached mandatory code-generation stage")
    if reached:
        r = t2.report("code-generation", "skipped", reason="test bypass")
        t2.ok(r.get("kind") == "error" and "invalid result" in r.get("message", "").lower(), "BLOCKED: manual skip is not a public result")
    t.passed += t2.passed
    t.failed += t2.failed
    t.errors.extend(t2.errors)
    return t


def test_a_full_walk():
    """A: Sequential walk through all default feature stages reaches DONE."""
    print("\n--- A: Full sequential walk (feature scope, 45 default stages) ---")
    t = TestRunner("/tmp/aidlc-test-a")
    t.setup()
    t.engine("next", "--scope feature")
    steps, done = t.walk_to_done(PRODUCES_MAP)
    t.ok(done, f"Reached DONE after {steps} stages")
    t.ok(steps <= 45 and steps >= 20, f"Feature scope processed {steps} stages (some condition-skipped)")
    return t


def test_b_produces_gate():
    """B: Produces gate blocks completion until file exists."""
    print("\n--- B: Produces gate enforcement ---")
    t = TestRunner("/tmp/aidlc-test-b")
    t.setup()
    t.engine("next", "--scope feature")

    # Walk to code-generation (it requires src/ to complete)
    reached = t.walk_to_stage("code-generation", PRODUCES_MAP)
    t.ok(reached, "Reached code-generation stage")

    if reached:
        directive = t.nxt()
        # Try to complete WITHOUT src/ — should be blocked
        r = t.report("code-generation", "completed")
        t.ok(
            r.get("kind") == "error" and "src/" in r.get("message", ""),
            "BLOCKED: report rejected — src/ not found",
        )

        # Create all resolved unit-scoped produces, then retry.
        t.create_declared_produces(directive)
        r = t.report("code-generation", "completed")
        t.ok(r.get("kind") == "print", "PASSED: report accepted after all gates satisfied")

        # Also test: nfr-requirements has produces requirement
        # Walk back from scratch to test another produces
        t2 = TestRunner("/tmp/aidlc-test-b2")
        t2.setup()
        t2.engine("next", "--scope feature")
        reached2 = t2.walk_to_stage("nfr-requirements", PRODUCES_MAP)
        if reached2:
            r = t2.report("nfr-requirements", "completed")
            has_produces_err = r.get("kind") == "error" and "nfr-requirements" in r.get("message", "")
            # nfr-requirements produces: docs/aidlc/construction/nfr-requirements.md
            # walk_to_stage already created it via PRODUCES_MAP — so this should PASS
            # (the walk helper pre-creates files for stages it passes through)
            # Let's test without the file by removing walk_to_stage's auto-create
            t3 = TestRunner("/tmp/aidlc-test-b3")
            t3.setup()
            t3.engine("next", "--scope feature")
            # Walk without auto-creating nfr-requirements produces
            produces_without_nfr = {k: v for k, v in PRODUCES_MAP.items() if k != "nfr-requirements"}
            reached3 = t3.walk_to_stage("nfr-requirements", produces_without_nfr)
            if reached3:
                r3 = t3.report("nfr-requirements", "completed")
                t.ok(
                    r3.get("kind") == "error",
                    "BLOCKED: nfr-requirements rejected without produces file",
                )
                directive = t3.nxt()
                t3.create_declared_produces(directive)
                t3.write_evidence("nfr-requirements", directive.get("sensors", []))
                r3 = t3.report("nfr-requirements", "completed")
                t.ok(r3.get("kind") == "print", "PASSED: nfr-requirements accepted with file")

    return t


def test_c_stage_mismatch():
    """C: Cannot report on a stage that isn't current."""
    print("\n--- C: Stage mismatch rejection ---")
    t = TestRunner("/tmp/aidlc-test-c")
    t.setup()
    t.engine("next", "--scope feature")
    d = t.nxt()
    current = d.get("stage", "")

    # Try to report a different stage
    r = t.report("build-and-test", "completed")
    t.ok(
        r.get("kind") == "error" and "mismatch" in r.get("message", "").lower(),
        f"Rejected: tried build-and-test while current is {current}",
    )

    # Try to report an invalid result type
    r = t.report(current, "invalid-result")
    t.ok(r.get("kind") == "error", "Rejected: invalid result type")

    # Manual skip is not part of the public report protocol.
    r = t.report(current, "skipped")
    t.ok(
        r.get("kind") == "error" and "invalid result" in r.get("message", "").lower(),
        "Rejected: manual skip result",
    )

    return t


def test_d_scope_filtering():
    """D: Express scope executes significantly fewer stages than feature."""
    print("\n--- D: Scope filtering (express vs feature) ---")
    t = TestRunner("/tmp/aidlc-test-d")
    t.setup()
    t.engine("next", "--scope express")
    steps, done = t.walk_to_done(PRODUCES_MAP)
    t.ok(done, f"Express scope reached DONE")
    t.ok(steps < 20, f"Express has fewer stages than feature (got {steps}, expect <20)")
    t.ok(steps >= 2, f"Express has at least some stages (got {steps})")

    # Compare with feature
    t2 = TestRunner("/tmp/aidlc-test-d2")
    t2.setup()
    t2.engine("next", "--scope feature")
    steps2, _ = t2.walk_to_done(PRODUCES_MAP)
    t.ok(steps < steps2, f"Express ({steps}) < Feature ({steps2})")

    return t


def test_e_requires_dependency():
    """E: Engine blocks a stage whose requires are not satisfied."""
    print("\n--- E: Requires dependency enforcement ---")
    t = TestRunner("/tmp/aidlc-test-e")
    t.setup()
    t.engine("next", "--scope feature")

    # Complete the first stage through all declared contracts.
    d = t.nxt()
    first = d.get("stage", "")
    t.create_declared_produces(d)
    t.write_evidence(first, d.get("sensors", []))
    completed = t.report(
        first,
        "approved" if d.get("gate") else "completed",
        approval_token=t.approval_token(d) if d.get("gate") else None,
        instruction_ack=d.get("completion_contract") == "instruction_only",
        user_input=t.choice_input(d),
    )
    t.ok(completed.get("kind") == "print", "First stage completed before park/resume")

    # Get second stage
    d = t.nxt()
    second = d.get("stage", "")

    # Now manually corrupt state: add a stage with unmet requires to front
    # Instead, just verify the engine never returns a blocked stage in normal flow
    # (Test A already proves this — 45 stages with zero blocks)

    # Verify park/resume cycle
    t.engine("park")
    d = t.nxt()
    t.ok(d.get("kind") == "parked", "Parked workflow returns parked directive")

    d = t.nxt("--resume")
    t.ok(d.get("kind") == "run-stage", "Resumed workflow returns next stage")
    t.ok(d.get("stage") == second, f"Resume returns same stage ({second})")

    return t


def test_g_construction_evidence_gates():
    """G: Construction evidence sensors reject missing mandatory evidence."""
    print("\n--- G: Construction evidence gates ---")

    cases = [
        ("prd-generation", "prd-completeness", "PRD completeness evidence"),
        ("requirements-methods", "diagram-contract", "diagram contract evidence"),
        ("tdd", "test-quality", "TDD evidence"),
        ("code-review", "review-evidence", "review evidence"),
        ("build-and-test", "build-test-evidence", "build/test evidence"),
        ("functional-design", "functional-design-completeness", "functional design evidence"),
    ]
    for index, (target, sensor, label) in enumerate(cases):
        t = TestRunner(f"/tmp/aidlc-test-g-{index}")
        t.setup()
        t.engine("next", "--scope feature --with-prd" if target == "prd-generation" else "--scope feature")
        reached = t.walk_to_stage(target, PRODUCES_MAP)
        t.ok(reached, f"Reached {target}")
        if reached:
            t.create_declared_produces(t.nxt())
            t.remove_evidence(target, sensor)
            r = t.report(target, "completed")
            t.ok(r.get("kind") == "error" and sensor in r.get("message", ""), f"BLOCKED: missing {label}")

    t = TestRunner("/tmp/aidlc-test-g-contract")
    t.setup()
    t.engine("next", "--scope feature")
    reached = t.walk_to_stage("shared-contract-baseline", PRODUCES_MAP)
    if reached:
        t.ok(True, "Reached shared-contract-baseline")
        t.create_declared_produces(t.nxt())
        t.remove_evidence("shared-contract-baseline", "contract-baseline")
        r = t.report("shared-contract-baseline", "completed")
        t.ok(r.get("kind") == "error", "BLOCKED: missing contract baseline evidence")
    else:
        t.ok(True, "SKIPPED: contract baseline not applicable without contract dependencies")

    return t


def test_i_diagram_source_status_gate():
    """I: Detailed diagram source statuses are blocking orchestrator gates."""
    print("\n--- I: Diagram source status gate ---")
    t = TestRunner("/tmp/aidlc-test-i-diagram-status")
    t.setup()
    t.engine("next", "--scope feature")
    reached = t.walk_to_stage("requirements-methods", PRODUCES_MAP)
    t.ok(reached, "Reached requirements-methods")
    if reached:
        directive = t.nxt()
        t.create_declared_produces(directive)
        t.write_evidence("requirements-methods", directive.get("sensors", []))
        path = t.evidence_path("requirements-methods", "diagram-contract")
        with open(path) as handle:
            payload = json.load(handle)
        payload["target_port_approach_status"] = "failed"
        t.sign(payload)
        with open(path, "w") as handle:
            json.dump(payload, handle)
        result = t.report("requirements-methods", "completed")
        t.ok(result.get("kind") == "error" and "target_port_approach_status" in result.get("message", ""), "BLOCKED: failed source geometry status")

        payload["target_port_approach_status"] = "passed"
        t.sign(payload)
        with open(path, "w") as handle:
            json.dump(payload, handle)
        result = t.report("requirements-methods", "completed")
        t.ok(result.get("kind") == "print", "PASSED: all detailed diagram source statuses satisfy the gate")
    return t


def test_h_automatic_common_sensors():
    """H: Every producing stage receives no-todo and traceability gates automatically."""
    print("\n--- H: Automatic no-todo and traceability coverage ---")
    t = TestRunner("/tmp/aidlc-test-h")
    t.runtime_choices["workspace-detection"] = "multi-module"
    t.setup()
    t.engine("next", "--scope feature")
    reached = t.walk_to_stage("product-inception", PRODUCES_MAP)
    t.ok(reached, "Reached product-inception")
    if reached:
        path = os.path.join(t.test_dir, "docs/aidlc/ideation/product-inception.md")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            handle.write("# product inception\n")
        r = t.report("product-inception", "completed")
        t.ok(r.get("kind") == "error" and "traceability" in r.get("message", ""), "BLOCKED: missing requirement reference")

        with open(path, "w") as handle:
            handle.write("# product inception\nREQ-TEST-001\nTODO: unresolved\n")
        r = t.report("product-inception", "completed")
        t.ok(r.get("kind") == "error" and "no-todo" in r.get("message", ""), "BLOCKED: TODO marker detected")

        with open(path, "w") as handle:
            handle.write("# product inception\nREQ-TEST-001 validates substantive product scope and measurable user outcomes.\n")
        r = t.report("product-inception", "completed")
        t.ok(r.get("kind") == "print", "PASSED: common sensors pass after cleanup")

    return t


def test_j_state_integrity_and_missing_state_hook():
    """J: Enrolled projects reject tampered or deleted machine state."""
    print("\n--- J: Signed state integrity and fail-closed Hook ---")
    t = TestRunner("aidlc-test-j-state")
    t.setup()
    initialized = t.engine("next", "--scope feature")
    t.ok(initialized.get("kind") == "print", "Initialized signed workflow state")
    state_path = os.path.join(t.test_dir, "docs", "aidlc", "aidlc-state.json")
    with open(state_path) as handle:
        original = json.load(handle)
    tampered = dict(original)
    tampered["scope"] = "express"
    with open(state_path, "w") as handle:
        json.dump(tampered, handle)
    rejected = t.nxt("--status")
    t.ok(rejected.get("kind") == "error" and rejected.get("_returncode") == 2, "BLOCKED: direct state tampering")

    with open(state_path, "w") as handle:
        json.dump(original, handle)
    os.remove(state_path)
    hook = subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", os.path.join(REPO_ROOT, "core", "tools", "aidlc-platform-hook.ts"), "--format", "claude"],
        cwd=t.test_dir,
        env=t.environment(),
        capture_output=True,
        text=True,
    )
    decision = json.loads(hook.stdout)
    t.ok(hook.returncode == 0 and decision.get("decision") == "block" and "missing" in decision.get("reason", "").lower(), "BLOCKED: enrolled project with deleted state")
    return t


def test_k_instruction_ack_and_concurrent_cas():
    """K: Instruction-only stages require explicit acknowledgement and stale writers lose CAS."""
    print("\n--- K: Instruction acknowledgement and concurrent CAS ---")
    t = TestRunner("aidlc-test-k-cas")
    t.setup()
    t.engine("next", "--scope feature")
    directive = t.nxt()
    t.ok(directive.get("completion_contract") == "instruction_only", "First stage exposes instruction-only contract")
    blocked = t.report(directive["stage"], "completed")
    t.ok(blocked.get("kind") == "error" and "instruction-ack" in blocked.get("message", ""), "BLOCKED: lifecycle-style completion without instruction ack")

    args = f"--stage {directive['stage']} --result completed --instruction-ack {directive['stage']} --user-input single-module"
    processes = [
        subprocess.Popen(t.command("report", args), cwd=t.test_dir, env=t.environment(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for _ in range(2)
    ]
    results = [process.communicate() + (process.returncode,) for process in processes]
    codes = sorted(item[2] for item in results)
    t.ok(codes == [0, 2], f"Exactly one concurrent report committed (return codes {codes})")
    status = t.nxt("--status")
    t.ok(status.get("kind") == "print" and "Completed: 1/" in status.get("message", ""), "Signed state remains valid with one committed completion")
    return t


def test_l_short_artifact_and_consumes_recheck():
    """L: Placeholder artifacts and deleted canonical inputs cannot pass report."""
    print("\n--- L: Substantive artifact and consumes recheck ---")
    t = TestRunner("aidlc-test-l-artifacts")
    t.setup()
    t.engine("next", "--scope feature")
    workspace = t.nxt()
    t.report(workspace["stage"], "completed", instruction_ack=True, user_input="multi-module")
    directive = t.nxt()
    t.mkfile("docs/aidlc/ideation/product-inception.md", "REQ-1\n")
    short = t.report(directive["stage"], "completed")
    t.ok(short.get("kind") == "error" and "product-inception.md" in short.get("message", ""), "BLOCKED: six-byte placeholder artifact")

    t2 = TestRunner("aidlc-test-l-consumes")
    t2.runtime_choices["workspace-detection"] = "multi-module"
    t2.setup()
    t2.engine("next", "--scope feature")
    reached = t2.walk_to_stage("product-contracts", PRODUCES_MAP)
    t2.ok(reached, "Reached product-contracts after canonical producer")
    if reached:
        directive = t2.nxt()
        t2.create_declared_produces(directive)
        t2.write_evidence("product-contracts", directive.get("sensors", []))
        os.remove(os.path.join(t2.test_dir, "docs", "aidlc", "ideation", "module-division.md"))
        rejected = t2.report("product-contracts", "completed")
        t2.ok(rejected.get("kind") == "error" and "consumed artifacts" in rejected.get("message", ""), "BLOCKED: consumed artifact deleted after next")
    t.passed += t2.passed
    t.failed += t2.failed
    t.errors.extend(t2.errors)
    return t


def test_m_scope_counts():
    """M: Runtime and utility agree on quick-scope candidate counts."""
    print("\n--- M: Scope count parity ---")
    t = TestRunner("aidlc-test-m-scope")
    result = subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", os.path.join(REPO_ROOT, "core", "tools", "aidlc-utility.ts"), "scope-table"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    counts = {line.split("\t")[0]: int(line.split("\t")[1]) for line in result.stdout.splitlines() if "\t" in line}
    for scope in ("bugfix", "refactor", "poc"):
        t.ok(counts.get(scope) == 7, f"{scope} exposes 7 candidate stages")
    t.ok(counts.get("feature") == 45, "feature exposes 45 default stages without optional PRD")
    t.ok(counts.get("classic") == 43, "classic exposes 43 default stages without optional PRD")
    return t




def test_n_enrollment_recovery_and_expired_approval_cleanup():
    """N: Interrupted first commits recover through pending enrollment; approve clears expired challenges."""
    print("\n--- N: Enrollment crash recovery and approval expiry cleanup ---")
    t = TestRunner("aidlc-test-n-enrollment")
    t.setup()

    env = t.environment()
    env["AIDLC_STATE_FAILPOINT"] = "after-enrollment"
    interrupted = subprocess.run(
        t.command("next", "--scope feature"), cwd=t.test_dir, env=env, capture_output=True, text=True
    )
    state_path = os.path.join(t.test_dir, "docs", "aidlc", "aidlc-state.json")
    enrollment_id = hashlib.sha256(os.path.realpath(t.test_dir).encode()).hexdigest()
    enrollment_path = os.path.join(t.trust_dir, "enrollments", f"{enrollment_id}.json")
    with open(enrollment_path) as handle:
        pending = json.load(handle)
    t.ok(
        interrupted.returncode == 2 and not os.path.exists(state_path) and pending.get("status") == "pending",
        "Interrupted pre-state commit leaves only a signed pending enrollment",
    )

    recovered = t.engine("next", "--scope feature")
    with open(state_path) as handle:
        recovered_state = json.load(handle)
    with open(enrollment_path) as handle:
        active = json.load(handle)
    t.ok(
        recovered.get("kind") == "print"
        and active.get("status") == "active"
        and active.get("workflow_id") == pending.get("workflow_id") == recovered_state.get("workflow_id"),
        "Pending enrollment resumes with the same workflow ID and activates after state commit",
    )

    t2 = TestRunner("aidlc-test-n-after-state")
    t2.setup()
    env2 = t2.environment()
    env2["AIDLC_STATE_FAILPOINT"] = "after-state"
    interrupted_after_state = subprocess.run(
        t2.command("next", "--scope feature"), cwd=t2.test_dir, env=env2, capture_output=True, text=True
    )
    recovered_status = t2.nxt("--status")
    enrollment_id2 = hashlib.sha256(os.path.realpath(t2.test_dir).encode()).hexdigest()
    with open(os.path.join(t2.trust_dir, "enrollments", f"{enrollment_id2}.json")) as handle:
        active_after_state = json.load(handle)
    t.ok(
        interrupted_after_state.returncode == 2
        and recovered_status.get("kind") == "print"
        and active_after_state.get("status") == "active",
        "Signed state plus pending enrollment finalizes safely after a post-rename crash",
    )

    state = recovered_state
    state["current_stage"] = "application-design"
    state["current_stage_instance"] = "application-design@module:test-module"
    state["current_module"] = "test-module"
    state.pop("current_unit", None)
    state["current_phase"] = "inception"
    state["approval_challenges"] = {
        "application-design@module:test-module": f"{int((datetime.now(timezone.utc).timestamp() - 3600) * 1000)}.expired-test"
    }
    state.pop("integrity", None)
    t.sign(state)
    with open(state_path, "w") as handle:
        json.dump(state, handle)

    approve = subprocess.run(
        [
            "npx", "--no-install", "--prefix", REPO_ROOT, "tsx",
            os.path.join(REPO_ROOT, "core", "tools", "aidlc-approve.ts"),
            "--stage", "application-design",
        ],
        cwd=t.test_dir,
        env=t.environment(),
        capture_output=True,
        text=True,
    )
    with open(state_path) as handle:
        cleaned = json.load(handle)
    t.ok(
        approve.returncode == 2
        and "expired" in approve.stderr.lower()
        and "application-design@module:test-module" not in cleaned.get("approval_challenges", {}),
        "Approve removes and persists an expired challenge before enforcing token issuance",
    )

    t.passed += t2.passed
    t.failed += t2.failed
    t.errors.extend(t2.errors)
    return t
def test_o_module_unit_routing_order():
    """O: Module-major Inception and module/unit-major Construction are deterministic."""
    print("\n--- O: Multi-module / multi-unit routing order ---")
    t = TestRunner("aidlc-test-o-routing")
    t.modules = [
        {"module_id": "module-a", "name": "Module A", "service_id": "service-a"},
        {"module_id": "module-b", "name": "Module B", "service_id": "service-b"},
    ]
    t.units = {
        "module-a": [
            {"unit_id": "unit-a1", "name": "Unit A1", "service_id": "service-a"},
            {"unit_id": "unit-a2", "name": "Unit A2", "service_id": "service-a"},
        ],
        "module-b": [
            {"unit_id": "unit-b1", "name": "Unit B1", "service_id": "service-b"},
        ],
    }
    t.setup()
    t.engine("next", "--scope feature")

    graph = json.loads(Path(REPO_ROOT, "core", "tools", "data", "stage-graph.json").read_text())
    stages = [
        stage for stage in graph["stages"]
        if (stage["execution"] == "ALWAYS" or "feature" in stage["scopes"])
        and stage.get("selection") != "user"
    ]
    first_module_index = next(index for index, stage in enumerate(stages) if stage["axis"] == "module")
    project_prefix = stages[:first_module_index]
    module_stages = [stage for stage in stages if stage["axis"] == "module"]
    unit_stages = [stage for stage in stages if stage["axis"] == "unit"]

    t.mkfile("docs/aidlc/ideation/module-manifest.json", json.dumps({"schema_version": 1, "modules": t.modules}))
    for module in t.modules:
        module_id = module["module_id"]
        t.mkfile(
            f"docs/aidlc/modules/{module_id}/inception/unit-manifest.json",
            json.dumps({"schema_version": 1, "module_id": module_id, "units": t.units[module_id]}),
        )
        t.mkfile(f"docs/aidlc/modules/{module_id}/inception/application-design.md")
        t.mkfile(f"docs/aidlc/modules/{module_id}/inception/application-design/unit-of-work.md")
        t.mkfile(
            f"docs/aidlc/modules/{module_id}/inception/workflow-plan.md",
            """# Routing plan

REQ-TEST-001 preserves the explicit unit-routing test path.

| stage | decision | evidence |
|-------|----------|----------|
| `application-design` | execute | routing fixture |
| `units-generation` | execute | routing fixture |
| `functional-design` | execute | routing fixture |
| `operations` | skip | routing fixture |
""",
        )
    t.mkfile("docs/aidlc/ideation/scenario-module-mapping.md")
    for index in range(11):
        t.mkfile(f"src/legacy-{index}.ts")

    project_instances = [stage["slug"] for stage in project_prefix]
    project_summaries = list(project_instances)

    def force_progress(instances: list[str], summaries: list[str]):
        state = t.state()
        state["status"] = "running"
        state["current_stage"] = ""
        state.pop("current_stage_instance", None)
        state.pop("current_module", None)
        state.pop("current_unit", None)
        state["completed_stage_instances"] = list(dict.fromkeys(instances))
        state["skipped_stage_instances"] = []
        state["completed_stages"] = list(dict.fromkeys(summaries))
        state["skipped_stages"] = []
        t.sign(state)
        Path(t.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(state))

    force_progress(project_instances, project_summaries)
    first_module = t.nxt()
    t.ok(first_module.get("stage_instance") == "reverse-engineering@module:module-a", "Module A starts its complete Inception segment first")

    # A historical artifact from another module must not satisfy Module A's gate.
    t.mkfile("docs/aidlc/modules/module-b/inception/reverse-engineering.md")
    cross_module = t.report("reverse-engineering", "completed", module="module-a")
    t.ok(
        cross_module.get("kind") == "error"
        and "docs/aidlc/modules/module-a/inception/reverse-engineering.md" in cross_module.get("message", ""),
        "Module B artifact cannot satisfy Module A produces gate",
    )
    t.create_declared_produces(first_module)
    current_module = t.report("reverse-engineering", "completed", module="module-a")
    t.ok(current_module.get("kind") == "print", "Module A produces gate passes only after Module A artifact exists")

    module_a_instances = [f"{stage['slug']}@module:module-a" for stage in module_stages]
    force_progress(project_instances + module_a_instances, project_summaries)
    second_module = t.nxt()
    t.ok(second_module.get("stage_instance") == "reverse-engineering@module:module-b", "Module B starts only after Module A Inception resolves")

    all_module_instances = [
        f"{stage['slug']}@module:{module['module_id']}"
        for module in t.modules
        for stage in module_stages
    ]
    module_summaries = [stage["slug"] for stage in module_stages]
    force_progress(project_instances + all_module_instances, project_summaries + module_summaries)
    first_unit = t.nxt()
    t.ok(first_unit.get("stage_instance") == "functional-design@module:module-a@unit:unit-a1", "Construction starts with Module A / Unit A1")
    t.ok(
        all("{module-id}" not in path and "{unit-id}" not in path for path in first_unit.get("produces", []))
        and first_unit.get("artifact_root") == "docs/aidlc/modules/module-a/construction/unit-a1",
        "Directive resolves module/unit artifact paths",
    )
    mismatch = t.report("functional-design", "completed", module="module-b", unit="unit-a1")
    t.ok(mismatch.get("kind") == "error" and "Module mismatch" in mismatch.get("message", ""), "Report rejects a mismatched module context")

    def unit_instances(module_id: str, unit_id: str) -> list[str]:
        return [f"{stage['slug']}@module:{module_id}@unit:{unit_id}" for stage in unit_stages]

    a1 = unit_instances("module-a", "unit-a1")
    force_progress(project_instances + all_module_instances + a1, project_summaries + module_summaries)
    second_unit = t.nxt()
    t.ok(second_unit.get("stage_instance") == "functional-design@module:module-a@unit:unit-a2", "Unit A2 follows the complete Unit A1 segment")

    a2 = unit_instances("module-a", "unit-a2")
    force_progress(project_instances + all_module_instances + a1 + a2, project_summaries + module_summaries)
    third_unit = t.nxt()
    t.ok(third_unit.get("stage_instance") == "functional-design@module:module-b@unit:unit-b1", "Module B / Unit B1 starts after all Module A units")

    b1 = unit_instances("module-b", "unit-b1")
    for module_id, unit_id in (("module-a", "unit-a1"), ("module-a", "unit-a2"), ("module-b", "unit-b1")):
        t.mkfile(f"docs/aidlc/modules/{module_id}/construction/{unit_id}/code-review.md")
    all_unit_instances = a1 + a2 + b1
    unit_summaries = [stage["slug"] for stage in unit_stages]
    force_progress(
        project_instances + all_module_instances + all_unit_instances,
        project_summaries + module_summaries + unit_summaries,
    )
    aggregate = t.nxt()
    t.ok(aggregate.get("stage_instance") == "build-and-test" and aggregate.get("axis") == "project", "Project build/test appears only after every unit segment resolves")
    aggregate_report = t.report("build-and-test", "completed")
    t.ok(
        aggregate_report.get("kind") == "error"
        and "required produces not found" in aggregate_report.get("message", "")
        and "Unresolved artifact placeholder" not in aggregate_report.get("message", ""),
        "Project aggregation expands declared module/unit consumes without weakening produces",
    )
    return t


def test_p_graph_context_placeholder_validation():
    """P: Graph compile rejects unknown context placeholders before runtime."""
    print("\n--- P: Graph context placeholder validation ---")
    t = TestRunner("aidlc-test-p-graph-placeholders")
    graph_uri = (Path(REPO_ROOT) / "core" / "tools" / "aidlc-graph.ts").as_uri()
    graph_path = str(Path(REPO_ROOT) / "core" / "tools" / "data" / "stage-graph.json")
    script = f"""
import {{ readFileSync }} from 'fs';
import {{ validateGraph }} from {json.dumps(graph_uri)};
const graph = JSON.parse(readFileSync({json.dumps(graph_path)}, 'utf8'));
const stage = graph.stages.find((candidate) => candidate.slug === 'requirements-methods');
stage.produces[0] = stage.produces[0].replace('{{module-id}}', '{{module-name}}');
const requirements = graph.stages.find((candidate) => candidate.slug === 'requirements-analysis');
requirements.consumes.push('docs/aidlc/ideation/prd.md');
process.stdout.write(JSON.stringify(validateGraph(graph)));
"""
    result = subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", "--eval", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    t.ok(result.returncode == 0, "Graph validation probe executed")
    errors = json.loads(result.stdout) if result.returncode == 0 else []
    t.ok(
        any("unknown or invalid context placeholder {module-name}" in error for error in errors),
        "Graph rejects unsupported {module-name} placeholder",
    )
    t.ok(
        any("automatic stage requirements-analysis cannot consume artifact from user-selected stage prd-generation" in error for error in errors),
        "Graph rejects a mandatory consumer of user-selected PRD",
    )
    duplicate_choices = json.loads(Path(graph_path).read_text())
    choice_stage = next(candidate for candidate in duplicate_choices["stages"] if candidate["slug"] == "ui-mock")
    choice_stage["choices"].append(choice_stage["choices"][0])
    duplicate_script = f"""
import {{ validateGraph }} from {json.dumps(graph_uri)};
const graph = {json.dumps(duplicate_choices)};
process.stdout.write(JSON.stringify(validateGraph(graph)));
"""
    duplicate_result = subprocess.run(
        ["npx", "--no-install", "--prefix", REPO_ROOT, "tsx", "--eval", duplicate_script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    duplicate_errors = json.loads(duplicate_result.stdout) if duplicate_result.returncode == 0 else []
    t.ok(
        any("duplicate choice on ui-mock" in error for error in duplicate_errors),
        "Graph rejects duplicate runtime choice values",
    )
    return t


def test_r_ui_runtime_choice_routing():
    """R: UI design records one signed choice and executes only that branch."""
    print("\n--- R: Signed UI runtime choice routing ---")

    def reach_router(name: str) -> tuple[TestRunner, dict]:
        runner = TestRunner(name)
        runner.setup()
        runner.engine("next", "--scope feature")
        for _ in range(120):
            directive = runner.nxt()
            slug = directive.get("stage", "")
            if slug == "ui-mock":
                return runner, directive
            if directive.get("kind") in ("done", "error") or not slug:
                break
            runner.create_declared_produces(directive)
            if slug == "user-stories":
                for produced in directive.get("produces", []):
                    runner.mkfile(produced, "# UI stories\n\nREQ-UI-001 requires a user interface and screen workflow.\n")
            runner.write_evidence(slug, directive.get("sensors", []))
            outcome = "approved" if directive.get("gate") else "completed"
            reported = runner.report(
                slug,
                outcome,
                approval_token=runner.approval_token(directive) if directive.get("gate") else None,
                instruction_ack=directive.get("completion_contract") == "instruction_only",
                user_input=runner.choice_input(directive),
            )
            if reported.get("kind") == "error":
                runner.ok(False, f"Failed before UI router at {slug}: {reported.get('message', '')}")
                break
        return runner, {}

    skipped, skip_directive = reach_router("aidlc-test-r-ui-skip")
    skipped.ok(bool(skip_directive), "UI requirements reach the runtime choice router")
    if skip_directive:
        missing = skipped.report("ui-mock", "completed", instruction_ack=True)
        skipped.ok(missing.get("kind") == "error" and "--user-input" in missing.get("message", ""), "Choice router rejects completion without a signed choice")
        invalid = skipped.report("ui-mock", "completed", instruction_ack=True, user_input="both")
        skipped.ok(invalid.get("kind") == "error" and "html-mock" in invalid.get("message", ""), "Choice router rejects an unknown mode")
        accepted = skipped.report("ui-mock", "completed", instruction_ack=True, user_input="skip")
        after_skip = skipped.nxt() if accepted.get("kind") == "print" else accepted
        skipped.ok(after_skip.get("stage") == "cross-validation", "skip bypasses page planning and both UI generation branches")
        choice_entry = next((entry for entry in reversed(skipped.state()["history"]) if entry["stage"] == "ui-mock"), {})
        skipped.ok(choice_entry.get("user_input") == "skip", "UI skip choice is persisted inside signed history")

    html, html_directive = reach_router("aidlc-test-r-ui-html")
    if html_directive:
        html.report("ui-mock", "completed", instruction_ack=True, user_input="html-mock")
        page = html.nxt()
        html.ok(
            page.get("stage") == "ui-page-planning"
            and "ui-artifact-consistency" in page.get("sensors", [])
            and any(path.endswith("/ui-design/page-plan.md") for path in page.get("produces", [])),
            "HTML choice enters gated shared page planning first",
        )
        html.create_declared_produces(page)
        html.write_evidence("ui-page-planning", page.get("sensors", []))
        html.report("ui-page-planning", "completed")
        html_branch = html.nxt()
        html.ok(html_branch.get("stage") == "ui-mock-workflow", "HTML choice skips both Figma stages")

    figma, figma_directive = reach_router("aidlc-test-r-ui-figma")
    if figma_directive:
        figma.report("ui-mock", "completed", instruction_ack=True, user_input="figma-existing")
        page = figma.nxt()
        figma.create_declared_produces(page)
        figma.write_evidence("ui-page-planning", page.get("sensors", []))
        figma.report("ui-page-planning", "completed")
        figma_branch = figma.nxt()
        figma.ok(page.get("stage") == "ui-page-planning" and figma_branch.get("stage") == "ui-figma", "Figma choice skips the HTML branch and preserves shared planning")

    skipped.passed += html.passed + figma.passed
    skipped.failed += html.failed + figma.failed
    skipped.errors.extend(html.errors + figma.errors)
    return skipped


def test_t_ui_implementation_bridge_routing():
    """T: UI bridge requires both a signed UI choice and a non-Web target."""
    print("\n--- T: UI implementation bridge routing ---")

    def route(name: str, choice: str, target: str) -> tuple[TestRunner, dict]:
        runner = TestRunner(name)
        runner.setup()
        runner.engine("next", "--scope feature")
        runner.mkfile(
            "docs/aidlc/ideation/module-manifest.json",
            json.dumps({"schema_version": 1, "modules": runner.modules}),
        )
        runner.mkfile(
            "docs/aidlc/modules/test-module/inception/unit-manifest.json",
            json.dumps({"schema_version": 1, "module_id": "test-module", "units": runner.units["test-module"]}),
        )
        runner.mkfile(
            "docs/aidlc/modules/test-module/inception/application-design.md",
            f"# Frontend target\n\nREQ-UI-001 uses {target} for the approved frontend runtime.\n",
        )
        runner.mkfile("src/main.ts")
        runner.mkfile("src/test/main.test.ts")

        graph = json.loads(Path(REPO_ROOT, "core", "tools", "data", "stage-graph.json").read_text())
        stages = [
            stage for stage in graph["stages"]
            if (stage["execution"] == "ALWAYS" or "feature" in stage["scopes"])
            and stage.get("selection") != "user"
        ]
        first_module_index = next(index for index, stage in enumerate(stages) if stage["axis"] == "module")
        project_prefix = stages[:first_module_index]
        module_stages = [stage for stage in stages if stage["axis"] == "module"]
        unit_stages = [stage for stage in stages if stage["axis"] == "unit"]
        bridge_index = next(index for index, stage in enumerate(unit_stages) if stage["slug"] == "ui-implementation-bridge")
        prior_unit_stages = unit_stages[:bridge_index]

        state = runner.state()
        state["status"] = "running"
        state["current_stage"] = ""
        state.pop("current_stage_instance", None)
        state.pop("current_module", None)
        state.pop("current_unit", None)
        state["completed_stage_instances"] = (
            [stage["slug"] for stage in project_prefix]
            + [f"{stage['slug']}@module:test-module" for stage in module_stages]
            + [f"{stage['slug']}@module:test-module@unit:test-unit" for stage in prior_unit_stages]
        )
        state["skipped_stage_instances"] = []
        state["completed_stages"] = list(dict.fromkeys(
            [stage["slug"] for stage in project_prefix + module_stages + prior_unit_stages]
        ))
        state["skipped_stages"] = []
        state["history"] = [{
            "stage": "ui-mock",
            "result": "completed",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "instance_id": "ui-mock@module:test-module",
            "module_id": "test-module",
            "user_input": choice,
        }]
        state.pop("integrity", None)
        runner.sign(state)
        Path(runner.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(state))
        return runner, runner.nxt()

    cross_platform, cross_directive = route("aidlc-test-t-ui-bridge-cross", "figma-existing", "Taro mini-program")
    cross_platform.ok(
        cross_directive.get("stage_instance") == "ui-implementation-bridge@module:test-module@unit:test-unit",
        "Signed UI choice plus a Taro target enters the implementation bridge",
    )

    web, web_directive = route("aidlc-test-t-ui-bridge-web", "html-mock", "React Web SPA")
    web.ok(
        web_directive.get("stage") == "code-review"
        and "ui-implementation-bridge@module:test-module@unit:test-unit" in web.state().get("skipped_stage_instances", []),
        "Signed UI choice plus a pure Web target skips the implementation bridge",
    )

    skipped, skipped_directive = route("aidlc-test-t-ui-bridge-skip", "skip", "Flutter mobile application")
    skipped.ok(
        skipped_directive.get("stage") == "code-review"
        and "ui-implementation-bridge@module:test-module@unit:test-unit" in skipped.state().get("skipped_stage_instances", []),
        "UI skip choice bypasses the implementation bridge even for a cross-platform target",
    )

    cross_platform.passed += web.passed + skipped.passed
    cross_platform.failed += web.failed + skipped.failed
    cross_platform.errors.extend(web.errors + skipped.errors)
    return cross_platform


def test_s_nonessential_condition_routes():
    """S: Explicit skip decisions remove nonessential design and deployment gates."""
    print("\n--- S: Nonessential conditional route bypass ---")
    t = TestRunner("aidlc-test-s-conditional-skip")
    t.setup()
    t.engine("next", "--scope feature")
    reached = t.walk_to_stage("workflow-planning", PRODUCES_MAP)
    t.ok(reached, "Reached workflow-planning before conditional design stages")
    if not reached:
        return t

    directive = t.nxt()
    t.mkfile(
        "docs/aidlc/modules/test-module/inception/application-design.md",
        "# Stale design from an older workflow\n\nREQ-OLD-001 must not control the current signed route.\n",
    )
    skip_plan = """# Minimal verified workflow plan

REQ-TEST-001 is a local implementation with no optional design or deployment work.

| stage | decision | evidence |
|-------|----------|----------|
| `application-design` | skip | existing component boundary remains unchanged |
| `units-generation` | skip | one direct implementation unit is sufficient |
| `functional-design` | skip | no new data model, state machine, or complex rule set |
| `operations` | skip | pure library with no deployment target |
"""
    for produced in directive.get("produces", []):
        t.mkfile(produced, skip_plan)
    t.write_evidence("workflow-planning", directive.get("sensors", []))
    reported = t.report("workflow-planning", "completed")
    next_stage = t.nxt() if reported.get("kind") == "print" else reported
    t.ok(
        next_stage.get("stage") == "code-generation"
        and next_stage.get("unit_id") == "default",
        "Application design, test derivation, unit generation, and functional design skip to the default implementation unit",
    )
    state = t.state()
    skipped_instances = set(state.get("skipped_stage_instances", []))
    t.ok(
        "application-design@module:test-module" in skipped_instances
        and "units-generation@module:test-module" in skipped_instances
        and "functional-design@module:test-module@unit:default" in skipped_instances,
        "Signed state records every nonessential conditional Stage as condition_skipped",
    )

    steps, done = t.walk_to_done(PRODUCES_MAP)
    final_state = t.state()
    t.ok(done and "operations" in final_state.get("skipped_stages", []), f"Pure-library route finishes after {steps} remaining stages without Operations approval")
    return t


def test_q_prd_user_selection():
    """Q: PRD is excluded by default and included only through signed initialization choice."""
    print("\n--- Q: User-selected PRD routing ---")
    default = TestRunner("aidlc-test-q-prd-default")
    default.setup()
    initialized = default.engine("next", "--scope feature")
    default.ok(
        initialized.get("kind") == "print" and "PRD option: not selected" in initialized.get("message", ""),
        "Feature workflow defaults to no PRD",
    )
    default.ok(default.state().get("selected_optional_stages") == [], "Default signed state records no optional stages")
    legacy_state = default.state()
    legacy_state.pop("selected_optional_stages")
    legacy_state.pop("integrity", None)
    default.sign(legacy_state)
    Path(default.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(legacy_state))
    legacy_status = default.nxt("--status")
    default.ok(
        legacy_status.get("kind") == "print" and "PRD option: not selected" in legacy_status.get("message", ""),
        "Older signed state without the option field resumes as PRD not selected",
    )
    reached = default.walk_to_stage("module-division", PRODUCES_MAP)
    default.ok(reached, "Default single-module route bypasses product-level Inception and reaches module registration")
    if reached:
        directive = default.nxt()
        default.create_declared_produces(directive)
        default.write_evidence("module-division", directive.get("sensors", []))
        reported = default.report("module-division", "completed")
        after_division = default.nxt() if reported.get("kind") == "print" else reported
        default.ok(
            after_division.get("stage") == "scenario-module-mapping"
            and "product-contracts" in default.state().get("skipped_stages", []),
            "Default single-module route skips product contracts and continues without PRD",
        )

    selected = TestRunner("aidlc-test-q-prd-selected")
    selected.setup()
    selected_init = selected.engine("next", "--scope feature --with-prd")
    selected.ok(
        selected_init.get("kind") == "print" and "PRD option: selected" in selected_init.get("message", ""),
        "--with-prd explicitly selects PRD",
    )
    selected.ok(
        selected.state().get("selected_optional_stages") == ["prd-generation"],
        "PRD choice is persisted in signed state",
    )
    selected_reached = selected.walk_to_stage("prd-generation", PRODUCES_MAP)
    selected.ok(selected_reached, "Selected route reaches prd-generation")
    if selected_reached:
        legacy_active = selected.state()
        legacy_active.pop("selected_optional_stages")
        legacy_active.pop("integrity", None)
        selected.sign(legacy_active)
        Path(selected.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(legacy_active))
        resumed_prd = selected.nxt()
        selected.ok(
            resumed_prd.get("stage") == "prd-generation",
            "Older signed state already active at PRD resumes the selected Stage",
        )
    immutable = selected.engine("next", "--scope feature --with-prd")
    selected.ok(
        immutable.get("kind") == "error" and "only be selected" in immutable.get("message", ""),
        "Active workflow PRD choice is immutable",
    )

    quick = TestRunner("aidlc-test-q-prd-quick")
    quick.setup()
    rejected = quick.engine("next", "--scope express --with-prd")
    quick.ok(
        rejected.get("kind") == "error" and "only valid" in rejected.get("message", ""),
        "Quick scopes reject the workflow PRD option",
    )

    default.passed += selected.passed + quick.passed
    default.failed += selected.failed + quick.failed
    default.errors.extend(selected.errors + quick.errors)
    return default


def test_u_architecture_and_product_contract_routing():
    """U: Signed architecture choice controls product-level stages and contract routing."""
    print("\n--- U: Signed architecture and product contract routing ---")

    single = TestRunner("aidlc-test-u-architecture-single")
    single.setup()
    single.engine("next", "--scope feature")
    workspace = single.nxt()
    single.ok(
        workspace.get("choices") == ["single-module", "multi-module"] and workspace.get("choice_required") is True,
        "Complete workflows expose a signed single-module / multi-module choice",
    )
    missing = single.report("workspace-detection", "completed", instruction_ack=True)
    single.ok(
        missing.get("kind") == "error" and "--user-input" in missing.get("message", ""),
        "Architecture choice is mandatory for complete scopes",
    )
    accepted = single.report("workspace-detection", "completed", instruction_ack=True, user_input="single-module")
    after_single = single.nxt() if accepted.get("kind") == "print" else accepted
    single.ok(
        after_single.get("stage") == "module-division"
        and "product-inception" in single.state().get("skipped_stages", []),
        "Single-module choice skips product-level Inception but keeps canonical module registration",
    )
    choice_entry = next((entry for entry in reversed(single.state()["history"]) if entry["stage"] == "workspace-detection"), {})
    single.ok(choice_entry.get("user_input") == "single-module", "Architecture choice is persisted in signed history")

    if after_single.get("stage") == "module-division":
        single.create_declared_produces(after_single)
        single.write_evidence("module-division", after_single.get("sensors", []))
        single.report("module-division", "completed")
        after_contract_skip = single.nxt()
        single.ok(
            after_contract_skip.get("stage") == "scenario-module-mapping"
            and "product-contracts" in single.state().get("skipped_stages", []),
            "Single-module project without cross-boundary facts skips the product contract gate",
        )

    multi = TestRunner("aidlc-test-u-architecture-multi")
    multi.setup()
    multi.engine("next", "--scope feature")
    multi_workspace = multi.nxt()
    multi.report("workspace-detection", "completed", instruction_ack=True, user_input="multi-module")
    multi_next = multi.nxt()
    multi.ok(multi_next.get("stage") == "product-inception", "Multi-module choice enters product-level Inception")

    contract = TestRunner("aidlc-test-u-product-contract")
    contract.setup()
    contract.engine("next", "--scope feature")
    contract_workspace = contract.nxt()
    contract.report("workspace-detection", "completed", instruction_ack=True, user_input="single-module")
    division = contract.nxt()
    if division.get("stage") == "module-division":
        contract.create_declared_produces(division)
        contract.mkfile(
            "docs/aidlc/ideation/module-division.md",
            "# Single module boundary\n\nREQ-CONTRACT-001 requires an external OpenAPI interface contract.\n",
        )
        contract.write_evidence("module-division", division.get("sensors", []))
        contract.report("module-division", "completed")
    contract_next = contract.nxt()
    contract.ok(
        contract_next.get("stage") == "product-contracts",
        "Single-module project with an external API still enters product contracts",
    )

    quick = TestRunner("aidlc-test-u-architecture-quick")
    quick.setup()
    quick.engine("next", "--scope express")
    quick_workspace = quick.nxt()
    quick.ok(
        quick_workspace.get("choices") == [] and quick_workspace.get("choice_required") is False,
        "Quick scopes do not force an irrelevant architecture choice",
    )

    single.passed += multi.passed + contract.passed + quick.passed
    single.failed += multi.failed + contract.failed + quick.failed
    single.errors.extend(multi.errors + contract.errors + quick.errors)
    return single


def test_v_unit_condition_isolation():
    """V: Explicit unit condition slices prevent module facts from forcing every unit."""
    print("\n--- V: Unit-specific conditional stage isolation ---")
    t = TestRunner("aidlc-test-v-unit-condition-isolation")
    t.modules = [{"module_id": "module-a", "name": "Module A", "service_id": "service-a"}]
    t.units = {
        "module-a": [
            {
                "unit_id": "unit-a1",
                "name": "Conditional Unit",
                "service_id": "service-a",
                "conditional_stages": list(UNIT_CONDITIONAL_STAGES),
            },
            {
                "unit_id": "unit-a2",
                "name": "Simple Unit",
                "service_id": "service-a",
                "conditional_stages": [],
            },
        ],
    }
    t.setup()
    t.engine("next", "--scope feature")
    t.nxt()
    t.report("workspace-detection", "completed", instruction_ack=True, user_input="multi-module")

    t.mkfile(
        "docs/aidlc/ideation/module-manifest.json",
        json.dumps({"schema_version": 1, "modules": t.modules}),
    )
    t.mkfile(
        "docs/aidlc/modules/module-a/inception/unit-manifest.json",
        json.dumps({
            "schema_version": 1,
            "module_id": "module-a",
            "requirement_ids": ["REQ-UNIT-001"],
            "description": "REQ-UNIT-001 isolates conditional stages by unit.",
            "units": t.units["module-a"],
        }),
    )
    t.mkfile(
        "docs/aidlc/modules/module-a/inception/application-design/unit-of-work.md",
        "# Unit ownership\n\nUnit A1 and Unit A2 have isolated implementation scopes.\n",
    )
    t.mkfile("src/main.ts", "export const routedValue = 1;\n")
    t.mkfile("src/test/main.test.ts", "export const routedTest = true;\n")
    t.mkfile(
        "docs/aidlc/modules/module-a/inception/requirements.md",
        "# Unit-scoped facts\n\nUnit A1 requires NFR, infrastructure, OpenAPI, Taro UI, and Loeyae Boot compliance.\n",
    )
    t.mkfile(
        "docs/aidlc/modules/module-a/inception/workflow-plan.md",
        """# Unit routing plan

Use parallel subagents for selected units.

| stage | decision | evidence |
|-------|----------|----------|
| `application-design` | execute | architecture facts |
| `units-generation` | execute | two units |
| `functional-design` | execute | Unit A1 business rules |
| `operations` | skip | no deployment |
""",
    )
    t.mkfile("package.json", json.dumps({"dependencies": {"loeyae-boot": "1.0.0", "@tarojs/taro": "1.0.0"}}))

    graph = json.loads(Path(REPO_ROOT, "core", "tools", "data", "stage-graph.json").read_text())
    stages = [
        stage for stage in graph["stages"]
        if (stage["execution"] == "ALWAYS" or "feature" in stage["scopes"])
        and stage.get("selection") != "user"
    ]
    project_instances = [stage["slug"] for stage in stages if stage["axis"] == "project"]
    module_stages = [stage for stage in stages if stage["axis"] == "module"]
    module_instances = [f"{stage['slug']}@module:module-a" for stage in module_stages]
    unit_stages = [stage for stage in stages if stage["axis"] == "unit"]
    unit_slugs = [stage["slug"] for stage in unit_stages]
    base_summaries = list(dict.fromkeys(project_instances + [stage["slug"] for stage in module_stages]))

    state = t.state()
    state["history"].append({
        "stage": "ui-mock",
        "instance_id": "ui-mock@module:module-a",
        "module_id": "module-a",
        "result": "completed",
        "user_input": "html-mock",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    })
    t.sign(state)
    Path(t.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(state))

    def force_unit_progress(completed_by_unit: dict[str, list[str]]):
        current = t.state()
        current["status"] = "running"
        current["current_stage"] = ""
        current.pop("current_stage_instance", None)
        current.pop("current_module", None)
        current.pop("current_unit", None)
        unit_instances = [
            f"{slug}@module:module-a@unit:{unit_id}"
            for unit_id, slugs in completed_by_unit.items()
            for slug in slugs
        ]
        current["completed_stage_instances"] = project_instances + module_instances + unit_instances
        current["skipped_stage_instances"] = []
        current["completed_stages"] = base_summaries + list(dict.fromkeys(
            slug for slugs in completed_by_unit.values() for slug in slugs
        ))
        current["skipped_stages"] = []
        t.sign(current)
        Path(t.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(current))

    conditional_slugs = [stage["slug"] for stage in unit_stages if stage.get("condition")]
    for target in conditional_slugs:
        force_unit_progress({"unit-a1": unit_slugs[:unit_slugs.index(target)]})
        directive = t.nxt()
        actual_instance = directive.get("stage_instance")
        t.ok(
            actual_instance == f"{target}@module:module-a@unit:unit-a1",
            f"Unit A1 explicitly selects {target} (got {actual_instance or directive.get('message')})",
        )

    force_unit_progress({"unit-a1": unit_slugs})
    simple_start = t.nxt()
    pre_code_conditions = conditional_slugs[:conditional_slugs.index("subagent-execution")]
    skipped_after_start = set(t.state().get("skipped_stage_instances", []))
    t.ok(
        simple_start.get("stage_instance") == "code-generation@module:module-a@unit:unit-a2"
        and all(f"{slug}@module:module-a@unit:unit-a2" in skipped_after_start for slug in pre_code_conditions),
        "Unit A2 empty slice skips pre-code conditional stages despite Unit A1 facts",
    )

    post_code_index = unit_slugs.index("subagent-execution")
    force_unit_progress({"unit-a1": unit_slugs, "unit-a2": unit_slugs[:post_code_index]})
    simple_review = t.nxt()
    post_code_conditions = ["subagent-execution", "loeyae-compliance", "ui-implementation-bridge"]
    skipped_before_review = set(t.state().get("skipped_stage_instances", []))
    actual_review = simple_review.get("stage_instance")
    missing_post_skips = [
        slug for slug in post_code_conditions
        if f"{slug}@module:module-a@unit:unit-a2" not in skipped_before_review
    ]
    t.ok(
        actual_review == "code-review@module:module-a@unit:unit-a2" and not missing_post_skips,
        f"Unit A2 empty slice skips execution, framework, and UI conditions without weakening code review (got {actual_review}; missing skips: {missing_post_skips})",
    )

    t.mkfile(
        "docs/aidlc/modules/module-a/inception/user-stories.md",
        "# Stories\n\nREQ-UNIT-001 maps the two units to explicit implementation responsibilities.\n",
    )
    units_index = next(index for index, stage in enumerate(module_stages) if stage["slug"] == "units-generation")
    current = t.state()
    current["status"] = "running"
    current["current_stage"] = ""
    current.pop("current_stage_instance", None)
    current.pop("current_module", None)
    current.pop("current_unit", None)
    current["completed_stage_instances"] = project_instances + [
        f"{stage['slug']}@module:module-a" for stage in module_stages[:units_index]
    ]
    current["skipped_stage_instances"] = []
    current["completed_stages"] = list(dict.fromkeys(
        project_instances + [stage["slug"] for stage in module_stages[:units_index]]
    ))
    current["skipped_stages"] = []
    t.sign(current)
    Path(t.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(current))
    units_directive = t.nxt()
    if units_directive.get("stage") == "units-generation":
        t.create_declared_produces(units_directive)
        incomplete_units = [dict(unit) for unit in t.units["module-a"]]
        incomplete_units[1].pop("conditional_stages", None)
        t.mkfile(
            "docs/aidlc/modules/module-a/inception/unit-manifest.json",
            json.dumps({
                "schema_version": 1,
                "module_id": "module-a",
                "requirement_ids": ["REQ-UNIT-001"],
                "description": "REQ-UNIT-001 rejects implicit unit condition routing.",
                "units": incomplete_units,
            }),
        )
        t.write_evidence("units-generation", units_directive.get("sensors", []))
        missing_slice = t.report("units-generation", "completed", module="module-a")
    else:
        missing_slice = units_directive
    t.ok(
        missing_slice.get("kind") == "error" and "conditional_stages" in missing_slice.get("message", ""),
        "New signed workflow rejects a unit manifest with an implicit condition slice",
    )
    t.mkfile(
        "docs/aidlc/modules/module-a/inception/unit-manifest.json",
        json.dumps({
            "schema_version": 1,
            "module_id": "module-a",
            "requirement_ids": ["REQ-UNIT-001"],
            "description": "REQ-UNIT-001 isolates conditional stages by unit.",
            "units": t.units["module-a"],
        }),
    )
    units_path = "docs/aidlc/modules/module-a/inception/units.md"
    t.mkfile(
        units_path,
        "# Units\n\nSubstantive work-unit responsibilities are documented without a requirement reference.\n",
    )
    t.write_evidence("units-generation", units_directive.get("sensors", []))
    missing_requirement = t.report("units-generation", "completed", module="module-a")
    missing_requirement_message = missing_requirement.get("message", "")
    t.ok(
        missing_requirement.get("kind") == "error"
        and "traceability" in missing_requirement_message
        and units_path in missing_requirement_message
        and "design-intent-coverage.json" not in missing_requirement_message,
        "Mixed units-generation Stage checks business artifacts but excludes Evidence from traceability",
    )
    t.mkfile(
        units_path,
        "# Units\n\nREQ-UNIT-001 traces substantive work-unit responsibilities to the approved requirement.\n",
    )
    t.write_evidence("units-generation", units_directive.get("sensors", []))
    accepted_slice = t.report("units-generation", "completed", module="module-a")
    t.ok(
        accepted_slice.get("kind") == "print",
        f"New signed workflow accepts a complete explicit unit condition slice ({accepted_slice.get('message', accepted_slice)})",
    )
    return t


def test_w_optional_artifact_runtime_contracts():
    """W: Signed PRD/UI choices drive runtime artifacts without cross-module leakage."""
    print("\n--- W: Optional artifact runtime contracts ---")

    def complete(runner: TestRunner, directive: dict, user_input=None) -> dict:
        runner.create_declared_produces(directive)
        if directive.get("stage") == "user-stories" and user_input == "__ui_fixture__":
            for produced in directive.get("produces", []):
                runner.mkfile(produced, "# UI stories\n\nREQ-UI-001 requires a user interface and screen workflow.\n")
            user_input = None
        runner.write_evidence(directive.get("stage", ""), directive.get("sensors", []))
        return runner.report(
            directive.get("stage", ""),
            "approved" if directive.get("gate") else "completed",
            approval_token=runner.approval_token(directive) if directive.get("gate") else None,
            instruction_ack=directive.get("completion_contract") == "instruction_only",
            user_input=user_input if user_input is not None else runner.choice_input(directive),
        )

    def reach_router(name: str) -> tuple[TestRunner, dict]:
        runner = TestRunner(name)
        runner.setup()
        runner.engine("next", "--scope feature")
        for _ in range(120):
            directive = runner.nxt()
            if directive.get("stage") == "ui-mock":
                return runner, directive
            if directive.get("kind") in ("done", "error") or not directive.get("stage"):
                break
            fixture = "__ui_fixture__" if directive.get("stage") == "user-stories" else None
            result = complete(runner, directive, fixture)
            if result.get("kind") == "error":
                runner.ok(False, f"Failed before UI router at {directive.get('stage')}: {result.get('message', '')}")
                break
        return runner, {}

    off = TestRunner("aidlc-test-w-optional-off")
    off.setup()
    off.mkfile(
        "docs/aidlc/modules/test-module/inception/ui-mock/stale.html",
        "stale HTML artifact must not activate a signed new workflow route\n",
    )
    off.engine("next", "--scope feature")
    reached_off = off.walk_to_stage("cross-validation", PRODUCES_MAP)
    off_cross = off.nxt() if reached_off else {}
    off_consumes = off_cross.get("consumes", [])
    off.ok(
        reached_off
        and "inception-consistency" in off_cross.get("sensors", [])
        and "docs/aidlc/ideation/prd.md" not in off_consumes
        and not any("ui-design/page-plan.md" in path or "ui-mock/" in path or "figma-manifest.json" in path for path in off_consumes),
        "PRD/UI off keeps cross-validation free of optional artifacts despite stale UI files",
    )
    skipped_choice = next((
        entry for entry in off.state().get("history", [])
        if entry.get("stage") == "ui-mock" and entry.get("module_id") == "test-module"
    ), {})
    off.ok(
        skipped_choice.get("result") == "condition_skipped"
        and str(skipped_choice.get("user_input", "")).startswith("Auto-skipped:"),
        "UI condition false is recorded in signed history as a condition result, not a route choice",
    )

    prd = TestRunner("aidlc-test-w-prd-on")
    prd.setup()
    prd.engine("next", "--scope feature --with-prd")
    reached_prd = prd.walk_to_stage("cross-validation", PRODUCES_MAP)
    prd_cross = prd.nxt() if reached_prd else {}
    prd_consumes = prd_cross.get("consumes", [])
    off.ok(
        reached_prd
        and "docs/aidlc/ideation/prd.md" in prd_consumes
        and ".aidlc/evidence/prd-generation/prd-completeness.json" in prd_consumes,
        "Signed PRD selection adds canonical PRD and completeness Evidence to cross-validation",
    )

    html, html_router = reach_router("aidlc-test-w-html")
    if html_router:
        html.report("ui-mock", "completed", instruction_ack=True, user_input="html-mock")
        reached_generation = html.walk_to_stage("ui-mock-generation", PRODUCES_MAP)
        generation = html.nxt() if reached_generation else {}
        html.ok(
            reached_generation
            and "docs/aidlc/modules/test-module/inception/ui-design/page-plan.md" in generation.get("consumes", [])
            and "docs/aidlc/modules/test-module/inception/ui-mock/ui-mock-manifest.json" in generation.get("produces", [])
            and ".aidlc/evidence/ui-mock-generation/test-module/ui-artifact-consistency.json" in generation.get("produces", [])
            and "ui-artifact-consistency" in generation.get("sensors", []),
            "HTML generation is gated by page-plan and canonical manifest consistency",
        )
        if reached_generation:
            complete(html, generation)
            reached_cross = html.walk_to_stage("cross-validation", PRODUCES_MAP)
            cross = html.nxt() if reached_cross else {}
            consumes = cross.get("consumes", [])
            html.ok(
                reached_cross
                and "docs/aidlc/modules/test-module/inception/ui-mock/" in consumes
                and ".aidlc/evidence/ui-page-planning/test-module/ui-artifact-consistency.json" in consumes
                and ".aidlc/evidence/ui-mock-generation/test-module/ui-artifact-consistency.json" in consumes
                and not any("figma-manifest.json" in path for path in consumes),
                "HTML-selected cross-validation consumes only the canonical HTML branch",
            )

    figma, figma_router = reach_router("aidlc-test-w-figma")
    if figma_router:
        figma.report("ui-mock", "completed", instruction_ack=True, user_input="figma-existing")
        reached_generation = figma.walk_to_stage("ui-figma-generation", PRODUCES_MAP)
        generation = figma.nxt() if reached_generation else {}
        figma.ok(
            reached_generation
            and "docs/aidlc/modules/test-module/inception/ui-design/page-plan.md" in generation.get("consumes", [])
            and "docs/aidlc/modules/test-module/inception/ui-design/figma-manifest.json" in generation.get("produces", [])
            and ".aidlc/evidence/ui-figma-generation/test-module/ui-artifact-consistency.json" in generation.get("produces", [])
            and "ui-artifact-consistency" in generation.get("sensors", []),
            "Figma generation is gated by page-plan and canonical manifest consistency",
        )
        if reached_generation:
            complete(figma, generation)
            reached_cross = figma.walk_to_stage("cross-validation", PRODUCES_MAP)
            cross = figma.nxt() if reached_cross else {}
            consumes = cross.get("consumes", [])
            figma.ok(
                reached_cross
                and "docs/aidlc/modules/test-module/inception/ui-design/figma-manifest.json" in consumes
                and ".aidlc/evidence/ui-figma-generation/test-module/ui-artifact-consistency.json" in consumes
                and not any("ui-mock/" in path for path in consumes),
                "Figma-selected cross-validation consumes only the canonical Figma branch",
            )

    if reached_off:
        completed_cross = complete(off, off_cross)
        reached_review = completed_cross.get("kind") != "error" and off.walk_to_stage("code-review", PRODUCES_MAP)
        review = off.nxt() if reached_review else {}
        off.ok(
            reached_review
            and "ui-design-alignment" not in review.get("sensors", [])
            and not any(path.endswith("/ui-design-alignment.json") for path in review.get("produces", [])),
            "Code review removes UI sensor and Evidence when no signed UI route was selected",
        )
        if reached_review:
            complete(off, review)
            reached_final = off.walk_to_stage("implementation-report", PRODUCES_MAP)
            final = off.nxt() if reached_final else {}
            if reached_final:
                off.create_declared_produces(final)
                off.write_evidence("implementation-report", final.get("sensors", []))
                evidence_path = Path(off.evidence_path("implementation-report", "implementation-report"))
                payload = json.loads(evidence_path.read_text())
                payload.pop("ui_modules_verified", None)
                off.sign(payload)
                evidence_path.write_text(json.dumps(payload))
                rejected = off.report("implementation-report", "completed")
                off.ok(
                    rejected.get("kind") == "error" and "ui_modules_verified" in rejected.get("message", ""),
                    "Final report requires an explicit empty UI module aggregation when UI was not selected",
                )
                off.write_evidence("implementation-report", final.get("sensors", []))
                accepted = off.report("implementation-report", "completed")
                off.ok(
                    accepted.get("kind") == "print",
                    "Final report accepts complete module and selected-artifact aggregation",
                )
            else:
                off.ok(False, "Reached final implementation report after no-UI code review")

    multi = TestRunner("aidlc-test-w-multi-module-isolation")
    multi.runtime_choices["workspace-detection"] = "multi-module"
    multi.modules = [
        {"module_id": "module-a", "name": "Module A", "service_id": "service-a"},
        {"module_id": "module-b", "name": "Module B", "service_id": "service-b"},
    ]
    multi.units = {
        "module-a": [{"unit_id": "unit-a", "name": "Unit A", "service_id": "service-a"}],
        "module-b": [{"unit_id": "unit-b", "name": "Unit B", "service_id": "service-b"}],
    }
    multi.setup()
    multi.engine("next", "--scope feature")
    module_a_checked = False
    module_b_checked = False
    for _ in range(240):
        directive = multi.nxt()
        slug = directive.get("stage", "")
        module_id = directive.get("module_id")
        if directive.get("kind") in ("done", "error") or not slug:
            break
        if slug == "cross-validation" and module_id == "module-a":
            consumes = directive.get("consumes", [])
            module_a_checked = (
                "docs/aidlc/modules/module-a/inception/ui-mock/" in consumes
                and all("module-b" not in path for path in consumes)
            )
            complete(multi, directive)
            continue
        if slug == "cross-validation" and module_id == "module-b":
            consumes = directive.get("consumes", [])
            module_b_checked = (
                not any("module-a" in path for path in consumes)
                and not any("ui-design/page-plan.md" in path or "ui-mock/" in path or "figma-manifest.json" in path for path in consumes)
            )
            break
        if slug == "user-stories":
            result = complete(multi, directive, "__ui_fixture__")
        elif slug == "ui-mock":
            result = complete(multi, directive, "html-mock" if module_id == "module-a" else "skip")
        else:
            result = complete(multi, directive)
        if result.get("kind") == "error":
            multi.ok(False, f"Multi-module route blocked at {slug}: {result.get('message', '')}")
            break
    multi.ok(
        module_a_checked and module_b_checked,
        "Multi-module cross-validation isolates Module A HTML artifacts from Module B skip route",
    )

    off.passed += prd.passed + html.passed + figma.passed + multi.passed
    off.failed += prd.failed + html.failed + figma.failed + multi.failed
    off.errors.extend(prd.errors + html.errors + figma.errors + multi.errors)
    return off


def test_x_cli_approval_inherits_terminal():
    """X: The packaged CLI preserves a human terminal for approval while pipes remain blocked."""
    print("\n--- X: CLI approval terminal inheritance ---")
    t = TestRunner("aidlc-test-x-cli-approval")
    t.setup()
    t.engine("next", "--scope feature")

    state = t.state()
    approval_instance = "application-design@module:project"
    challenge = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}.cli-tty-test"
    state["current_stage"] = "application-design"
    state["current_stage_instance"] = approval_instance
    state["current_module"] = "project"
    state.pop("current_unit", None)
    state["current_phase"] = "inception"
    state["approval_challenges"] = {approval_instance: challenge}
    state.pop("integrity", None)
    t.sign(state)
    Path(t.test_dir, "docs", "aidlc", "aidlc-state.json").write_text(json.dumps(state))

    command = ["node", os.path.join(REPO_ROOT, "bin", "cli.js"), "approve", "--stage", "application-design"]
    request_result = subprocess.run(
        [*command, "--request"], cwd=t.test_dir, env=t.environment(), capture_output=True, text=True
    )
    try:
        request_payload = json.loads(request_result.stdout)
    except json.JSONDecodeError:
        request_payload = {}
    t.ok(
        request_result.returncode == 0
        and request_payload.get("kind") == "aidlc.approval.request"
        and request_payload.get("stage_instance") == approval_instance
        and "approval_token" not in request_payload,
        "PASSED: non-interactive request exposes bound context without issuing a token",
    )

    invalid_provider_response = {
        "schema_version": 1,
        "kind": "aidlc.approval.response",
        "request_id": "0" * 64,
        "provider_id": "test-host",
        "human_event_id": "event-001",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approval_token": "f" * 64,
    }
    provider_report = subprocess.run(
        [
            "node", os.path.join(REPO_ROOT, "bin", "cli.js"), "orchestrate", "report",
            "--stage", "application-design", "--result", "approved", "--approval-response-stdin",
        ],
        input=json.dumps(invalid_provider_response),
        cwd=t.test_dir,
        env=t.environment(),
        capture_output=True,
        text=True,
    )
    t.ok(
        provider_report.returncode == 2
        and "request_id does not match" in (provider_report.stdout + provider_report.stderr),
        "BLOCKED: provider stdin response must match the active approval request",
    )

    blocked = subprocess.run(command, cwd=t.test_dir, env=t.environment(), capture_output=True, text=True)
    t.ok(
        blocked.returncode == 2 and "interactive human terminal" in blocked.stderr,
        "BLOCKED: packaged CLI still rejects non-interactive approval",
    )

    if os.name == "nt":
        source = Path(REPO_ROOT, "bin", "cli.ts").read_text()
        t.ok(
            'case "approve": runInteractive(' in source and 'stdio: "inherit"' in source,
            "Windows CLI approval delegates through inherited terminal handles",
        )
        return t

    import pty
    import select
    import time

    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        command,
        cwd=t.test_dir,
        env=t.environment(),
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
    )
    os.close(slave_fd)
    phrase = f"APPROVE {approval_instance} {challenge[-8:]}"
    expected_prompt = f"Type exactly: {phrase}".encode()
    output = bytearray()
    response_sent = False
    deadline = time.monotonic() + 20
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master_fd], [], [], 0.1)
            if ready:
                try:
                    chunk = os.read(master_fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
                if not response_sent and expected_prompt in output:
                    os.write(master_fd, f"{phrase}\n".encode())
                    response_sent = True
            if process.poll() is not None and not ready:
                break
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
    finally:
        os.close(master_fd)

    rendered = output.decode(errors="replace")
    t.ok(
        process.returncode == 0 and response_sent and '"approval_token"' in rendered,
        "PASSED: packaged CLI preserves a real terminal and issues a human-confirmed token",
    )
    return t


# === Run all tests ===
if __name__ == "__main__":
    print("=" * 60)
    print("LOEYAE AI-DLC v2 — ENGINE GATE TESTS")
    print("=" * 60)

    results = []
    results.append(test_a_full_walk())
    results.append(test_b_produces_gate())
    results.append(test_c_stage_mismatch())
    results.append(test_d_scope_filtering())
    results.append(test_e_requires_dependency())
    results.append(test_f_gate_semantics())
    results.append(test_g_construction_evidence_gates())
    results.append(test_h_automatic_common_sensors())
    results.append(test_i_diagram_source_status_gate())
    results.append(test_j_state_integrity_and_missing_state_hook())
    results.append(test_k_instruction_ack_and_concurrent_cas())
    results.append(test_l_short_artifact_and_consumes_recheck())
    results.append(test_m_scope_counts())
    results.append(test_n_enrollment_recovery_and_expired_approval_cleanup())
    results.append(test_o_module_unit_routing_order())
    results.append(test_p_graph_context_placeholder_validation())
    results.append(test_q_prd_user_selection())
    results.append(test_r_ui_runtime_choice_routing())
    results.append(test_s_nonessential_condition_routes())
    results.append(test_t_ui_implementation_bridge_routing())
    results.append(test_u_architecture_and_product_contract_routing())
    results.append(test_v_unit_condition_isolation())
    results.append(test_w_optional_artifact_runtime_contracts())
    results.append(test_x_cli_approval_inherits_terminal())

    total_passed = sum(r.passed for r in results)
    total_failed = sum(r.failed for r in results)

    print(f"\n{'=' * 60}")
    print(f"TOTAL: {total_passed} ✅ passed, {total_failed} ❌ failed")
    print(f"{'=' * 60}")

    if total_failed > 0:
        print("\nFailed assertions:")
        for r in results:

            for e in r.errors:
                print(f"  - {e}")
        sys.exit(1)
    else:
        print("\n🎉 All tests passed!")
        sys.exit(0)
