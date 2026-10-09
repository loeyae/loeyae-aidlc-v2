import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { argvDigest, phaseObservationDigest } from "../core/tools/aidlc-evidence";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const graph = JSON.parse(readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8")) as {
  stages: Array<{ slug: string; number: string; execution: string; scopes: string[]; requires: string[]; consumes: string[]; sensors: string[]; produces: string[]; traceability: string }>;
};
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-tdd-gates-"));

function run(project: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function makeProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  mkdirSync(join(project, "docs", "aidlc"), { recursive: true });
  writeFileSync(join(project, "README.md"), "TDD gate regression project\n", "utf8");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
    });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  };
  git(["init", "-q"]);
  git(["config", "user.name", "AI-DLC"]);
  git(["config", "user.email", "aidlc@example.invalid"]);
  git(["add", "README.md"]);
  git(["commit", "-qm", "base"]);
  const state = createInitialState("express", "4.5.0", `workflow-${name}`, [], "TDD gate regression");
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveWorkflowState(project, state);
  return project;
}

function stage(slug: string) {
  const value = graph.stages.find((candidate) => candidate.slug === slug);
  assert.ok(value, `missing stage ${slug}`);
  return value;
}

function writeI13AndRed(project: string, red: Record<string, unknown>): void {
  const cases = join(project, "docs", "aidlc", "modules", "project", "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-1\n", "utf8");
  writeFileSync(join(cases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n", "utf8");
  writeFileSync(join(project, "docs", "aidlc", "modules", "project", "inception", "requirements.md"), "REQ-1 behavior\n", "utf8");
  const i13Path = join(project, ".aidlc", "evidence", "test-case-derivation", "project");
  const redPath = join(project, ".aidlc", "evidence", "tdd", "project", "default");
  mkdirSync(i13Path, { recursive: true });
  mkdirSync(redPath, { recursive: true });
  writeFileSync(join(i13Path, "test-case-derivation.json"), JSON.stringify({ status: "required", ucd_total: 1, ready_ucd: 1, ucd_ids: ["UC-D-001"], index: "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md" }), "utf8");
  writeFileSync(join(redPath, "red-test-evidence.json"), JSON.stringify(red), "utf8");
}

function envelope(project: string, sensor: string, payload: Record<string, unknown>): Record<string, unknown> {
  // 4.5.4: controlled RED/GREEN evidence records the observed test command separately
  // from the built-in checker (RED exits 1, GREEN exits 0). The observed digest is bound
  // to the stage allowlist (see writePhaseAllowlists) and the checker digest derives from it.
  const phase = sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : undefined;
  const observedDigest = phase ? argvDigest(PHASE_ARGV[phase]) : undefined;
  return {
    ...payload,
    ...(phase ? { observed_command: { id: `${phase.toLowerCase()}-command`, phase, argv_digest: observedDigest, exit_code: phase === "RED" ? 1 : 0, expected_exit_code: phase === "RED" ? 1 : 0, duration_ms: 1 } } : {}),
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: `test-${sensor}` },
    source_revision: readSourceRevision(project),
    checker: { id: `builtin:${sensor}`, sensor, argv_digest: phase ? phaseObservationDigest(phase, observedDigest!) : "a".repeat(64), exit_code: 0, status: "passed" },
  };
}

const PHASE_ARGV: Record<"RED" | "GREEN", string[]> = { RED: ["node", "red-observer.js"], GREEN: ["node", "green-observer.js"] };

/** Per-stage allowlists declaring the RED/GREEN commands the hand-built envelopes claim to have observed. */
function writePhaseAllowlists(project: string): void {
  mkdirSync(join(project, ".aidlc", "commands"), { recursive: true });
  writeFileSync(join(project, ".aidlc", "commands", "tdd.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-command", role: "red", argv: PHASE_ARGV.RED }] }), "utf8");
  writeFileSync(join(project, ".aidlc", "commands", "code-generation.json"), JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green-command", role: "green", argv: PHASE_ARGV.GREEN }] }), "utf8");
}

function prepareCodeGeneration(project: string, greenStatus: "failed" | "passed"): void {
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "docs", "aidlc", "modules", "project", "construction", "default", "plans"), { recursive: true });
  writeFileSync(join(project, "src", "behavior.ts"), "export const behavior = 'REQ-1 UC-D-001 behavior';\n", "utf8");
  writeFileSync(join(project, "docs", "aidlc", "modules", "project", "construction", "default", "plans", "code-generation-plan.md"), "# Plan\nREQ-1 UC-D-001 validates the target behavior and its deterministic implementation steps.\n", "utf8");
  writeFileSync(join(project, "docs", "aidlc", "modules", "project", "construction", "default", "implementation-summary.md"), "# Summary\nREQ-1 UC-D-001 behavior is implemented and verified by the target test command.\n", "utf8");
  const evidenceRoot = join(project, ".aidlc", "evidence", "code-generation", "project", "default");
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, "green-test-evidence.json"), JSON.stringify(envelope(project, "green-test-evidence", {
    phase: "GREEN", status: greenStatus, compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: greenStatus === "passed" ? 0 : 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
  })), "utf8");
  writeFileSync(join(evidenceRoot, "test-quality.json"), JSON.stringify(envelope(project, "test-quality", {
    status: "passed", red_seen: true, green_seen: true, tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
  })), "utf8");
  writeFileSync(join(evidenceRoot, "traceability-matrix.json"), JSON.stringify(envelope(project, "traceability-matrix", { status: "not_applicable", migration_status: "MIGRATION_REQUIRED", broken_rows: [] })), "utf8");
  writeFileSync(join(evidenceRoot, "structural-invariants.json"), JSON.stringify(envelope(project, "structural-invariants", { status: "not_applicable", skip_reason: "test fixture has no persistence manifest", violations: [] })), "utf8");
}

/**
 * 4.6.0 S3a: the tdd stage also produces baseline-test-evidence. These fixtures declare
 * no tdd_mode characterization UC-D, so the controlled producer writes `not_required`
 * (no command, no allowlist entry needed). Completed tdd instances need --refresh.
 */
function produceNotRequiredBaseline(project: string, extra: string[]): void {
  const produced = run(project, ["evidence", "run", "--stage", "tdd", "--module", "project", "--unit", "default", "--sensor", "baseline-test-evidence", ...extra]);
  assert.equal(produced.status, 0, `${produced.stdout}\n${produced.stderr}`);
  assert.equal(JSON.parse(readFileSync(join(project, ".aidlc", "evidence", "tdd", "project", "default", "baseline-test-evidence.json"), "utf8")).status, "not_required");
}

try {
  const i13 = stage("test-case-derivation");
  const red = stage("tdd");
  const green = stage("code-generation");
  const review = stage("code-review");
  const build = stage("build-and-test");
  assert.equal(i13.execution, "ALWAYS");
  assert.ok(i13.scopes.includes("express") && i13.scopes.includes("bugfix") && i13.scopes.includes("refactor"));
  assert.deepEqual(red.requires, ["test-case-derivation"]);
  assert.deepEqual(green.requires, ["test-case-derivation", "tdd"]);
  assert.equal(red.number.localeCompare(green.number, undefined, { numeric: true }) < 0, true);
  assert.ok(green.consumes.some((path) => path.includes("red-test-evidence")));
  assert.deepEqual(review.requires, ["code-generation"]);
  assert.ok(build.requires.includes("code-generation") && build.requires.includes("code-review"));
  assert.ok(review.sensors.includes("test-quality") && build.sensors.includes("test-quality"));

  // P3 (MARS-108): a producing stage auto-mounts no-todo unconditionally, but traceability
  // only when traceability: required. A not_applicable stage must not carry the (space-filling,
  // gate-short-circuited) traceability sensor; it must still carry no-todo.
  for (const node of graph.stages) {
    if (node.produces.length === 0) continue;
    assert.ok(node.sensors.includes("no-todo"), `producing stage ${node.slug} must auto-mount no-todo`);
    if (node.traceability === "not_applicable") {
      assert.ok(!node.sensors.includes("traceability"), `not_applicable stage ${node.slug} must not carry a traceability sensor`);
    } else {
      assert.ok(node.sensors.includes("traceability"), `required stage ${node.slug} must auto-mount traceability`);
    }
  }
  for (const slug of ["tdd", "shared-contract-baseline", "subagent-execution", "loeyae-compliance", "compact-recovery"]) {
    const node = stage(slug);
    assert.equal(node.traceability, "not_applicable", `${slug} is expected to be traceability: not_applicable`);
    assert.ok(!node.sensors.includes("traceability"), `${slug} must not carry traceability after P3`);
    assert.ok(node.sensors.includes("no-todo"), `${slug} must still carry no-todo`);
  }

  const quick = makeProject("quick");
  const first = run(quick, ["orchestrate", "next"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /"stage": "test-case-derivation"/);
  const quickState = loadWorkflowState(quick);
  assert.ok(quickState);
  quickState!.completed_stage_instances.push("test-case-derivation@module:project");
  quickState!.completed_stages.push("test-case-derivation");
  saveWorkflowState(quick, quickState!);
  const noRed = run(quick, ["orchestrate", "next"]);
  assert.notEqual(noRed.status, 0);
  assert.match(`${noRed.stdout}\n${noRed.stderr}`, /canonical consumed artifacts|test-case-derivation/);

  const missingSource = makeProject("missing-source");
  const missingSourceCases = join(missingSource, "docs", "aidlc", "modules", "project", "inception", "application-design", "test-cases");
  mkdirSync(missingSourceCases, { recursive: true });
  writeFileSync(join(missingSourceCases, "non-applicable.json"), JSON.stringify({ schema_version: "1", status: "not_applicable", reason_code: "pure-declaration", reason: "只生成声明", approval_ref: "approved design decision", alternative_validation: "compile validation", validation_command: "npm run typecheck", source_refs: ["REQ-CONFIG-001"] }), "utf8");
  const missingSourceState = loadWorkflowState(missingSource);
  assert.ok(missingSourceState);
  missingSourceState!.current_stage = "test-case-derivation";
  missingSourceState!.current_phase = "inception";
  missingSourceState!.current_stage_instance = "test-case-derivation@module:project";
  missingSourceState!.current_module = "project";
  saveWorkflowState(missingSource, missingSourceState!);
  const missingSourceResult = run(missingSource, ["check", "--sensor", "test-case-derivation", "--module", "project"]);
  assert.notEqual(missingSourceResult.status, 0);
  assert.match(`${missingSourceResult.stdout}\n${missingSourceResult.stderr}`, /at least one requirement, story, application-design, or clarification source artifact/);

  const nonApplicable = makeProject("non-applicable");
  const nonApplicableCases = join(nonApplicable, "docs", "aidlc", "modules", "project", "inception", "application-design", "test-cases");
  mkdirSync(nonApplicableCases, { recursive: true });
  writeFileSync(join(nonApplicable, "docs", "aidlc", "modules", "project", "inception", "requirements.md"), "REQ-CONFIG-001 declaration metadata\n", "utf8");
  writeFileSync(join(nonApplicableCases, "non-applicable.json"), JSON.stringify({ schema_version: "1", status: "not_applicable", reason_code: "pure-declaration", reason: "只生成声明，不包含可执行业务行为", approval_ref: "approved design decision", alternative_validation: "compile and schema validation", validation_command: "npm run typecheck", source_refs: ["REQ-CONFIG-001"] }), "utf8");
  const nonApplicableState = loadWorkflowState(nonApplicable);
  assert.ok(nonApplicableState);
  nonApplicableState!.current_stage = "test-case-derivation";
  nonApplicableState!.current_phase = "inception";
  nonApplicableState!.current_stage_instance = "test-case-derivation@module:project";
  nonApplicableState!.current_module = "project";
  saveWorkflowState(nonApplicable, nonApplicableState!);
  const nonApplicableResult = run(nonApplicable, ["check", "--sensor", "test-case-derivation", "--module", "project"]);
  assert.equal(nonApplicableResult.status, 0, `${nonApplicableResult.stdout}\\n${nonApplicableResult.stderr}`);
  assert.equal(JSON.parse(nonApplicableResult.stdout).status, "not_applicable");
  writeFileSync(join(nonApplicable, "alternative-validation.js"), "require('node:fs').writeFileSync('alternative-validation-ran.txt', 'validated');\n", "utf8");
  mkdirSync(join(nonApplicable, ".aidlc"), { recursive: true });
  writeFileSync(join(nonApplicable, ".aidlc", "evidence-commands.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "alternative-validation", role: "check", argv: ["node", "alternative-validation.js"] }] }), "utf8");
  const nonApplicableEvidenceRoot = join(nonApplicable, ".aidlc", "evidence", "test-case-derivation", "project");
  mkdirSync(nonApplicableEvidenceRoot, { recursive: true });
  writeFileSync(join(nonApplicableEvidenceRoot, "test-case-derivation.json"), JSON.stringify(envelope(nonApplicable, "test-case-derivation", { status: "not_applicable", reason_code: "pure-declaration", reason: "只生成声明，不包含可执行业务行为", approval_ref: "approved design decision", alternative_validation: "compile and schema validation", validation_command: "npm run typecheck", source_refs: ["REQ-CONFIG-001"] })), "utf8");
  nonApplicableState!.completed_stage_instances.push("test-case-derivation@module:project");
  nonApplicableState!.completed_stages.push("test-case-derivation");
  nonApplicableState!.current_stage = "tdd";
  nonApplicableState!.current_phase = "construction";
  nonApplicableState!.current_stage_instance = "tdd@module:project@unit:default";
  nonApplicableState!.current_module = "project";
  nonApplicableState!.current_unit = "default";
  saveWorkflowState(nonApplicable, nonApplicableState!);
  const nonApplicableRed = run(nonApplicable, ["evidence", "run", "--stage", "tdd", "--module", "project", "--unit", "default", "--sensor", "red-test-evidence"]);
  assert.equal(nonApplicableRed.status, 0, `${nonApplicableRed.stdout}\n${nonApplicableRed.stderr}`);
  assert.equal(readFileSync(join(nonApplicable, "alternative-validation-ran.txt"), "utf8"), "validated");
  const nonApplicableRedEvidence = JSON.parse(readFileSync(join(nonApplicable, ".aidlc", "evidence", "tdd", "project", "default", "red-test-evidence.json"), "utf8"));
  assert.equal(nonApplicableRedEvidence.alternative_validation_execution.id, "alternative-validation");

  const producer = makeProject("producer");
  writeI13AndRed(producer, { evidence_version: "1", timestamp: new Date().toISOString() });
  writeFileSync(join(producer, "red-observer.js"), "console.log(JSON.stringify({phase:'RED',status:'failed',failure_class:'behavior',failure_signature:'expected behavior is absent',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:1,traceability_complete:true,uc_mapping:[{use_case:'UC-D-001',test_methods:['behaviorTest']}]})); process.exit(1);\n", "utf8");
  mkdirSync(join(producer, ".aidlc"), { recursive: true });
  writeFileSync(join(producer, ".aidlc", "evidence-commands.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-observer", role: "red", argv: ["node", "red-observer.js"] }] }), "utf8");
  const producerState = loadWorkflowState(producer);
  assert.ok(producerState);
  producerState!.completed_stage_instances.push("test-case-derivation@module:project");
  producerState!.completed_stages.push("test-case-derivation");
  producerState!.current_stage = "tdd";
  producerState!.current_phase = "construction";
  producerState!.current_stage_instance = "tdd@module:project@unit:default";
  producerState!.current_module = "project";
  producerState!.current_unit = "default";
  saveWorkflowState(producer, producerState!);
  const producedRed = run(producer, ["evidence", "run", "--stage", "tdd", "--module", "project", "--unit", "default", "--sensor", "red-test-evidence"]);
  assert.equal(producedRed.status, 0, `${producedRed.stdout}\\n${producedRed.stderr}`);
  const producedRedPath = join(producer, ".aidlc", "evidence", "tdd", "project", "default", "red-test-evidence.json");
  assert.equal(JSON.parse(readFileSync(producedRedPath, "utf8")).failure_class, "behavior");

  const invalid = makeProject("invalid-red");
  writeI13AndRed(invalid, { evidence_version: "1", timestamp: new Date().toISOString() });
  const invalidState = loadWorkflowState(invalid);
  assert.ok(invalidState);
  invalidState!.completed_stage_instances.push("test-case-derivation@module:project", "tdd@module:project@unit:default");
  invalidState!.completed_stages.push("test-case-derivation", "tdd");
  saveWorkflowState(invalid, invalidState!);
  const invalidRed = run(invalid, ["orchestrate", "next"]);
  assert.notEqual(invalidRed.status, 0);
  assert.match(`${invalidRed.stdout}\n${invalidRed.stderr}`, /RED|Evidence rejected|evidence_version/);

  const mismatchedExemption = makeProject("mismatched-exemption");
  writeI13AndRed(mismatchedExemption, {});
  writeFileSync(join(mismatchedExemption, ".aidlc", "evidence", "tdd", "project", "default", "red-test-evidence.json"), JSON.stringify(envelope(mismatchedExemption, "red-test-evidence", { phase: "RED", status: "not_applicable", not_applicable_reason: "pure declaration", alternative_validation: "compile validation", alternative_validation_execution: { id: "alternative-validation", argv_digest: "a".repeat(64), exit_code: 0, status: "passed", duration_ms: 1 } })));
  const mismatchedState = loadWorkflowState(mismatchedExemption);
  assert.ok(mismatchedState);
  mismatchedState!.completed_stage_instances.push("test-case-derivation@module:project");
  mismatchedState!.completed_stages.push("test-case-derivation");
  mismatchedState!.current_stage = "tdd";
  mismatchedState!.current_phase = "construction";
  mismatchedState!.current_stage_instance = "tdd@module:project@unit:default";
  mismatchedState!.current_module = "project";
  mismatchedState!.current_unit = "default";
  saveWorkflowState(mismatchedExemption, mismatchedState!);
  // 4.6.0 S3a: tdd also produces BASELINE; I13 declares no characterization UC-D, so the controlled producer writes not_required.
  produceNotRequiredBaseline(mismatchedExemption, []);
  const mismatchedResult = run(mismatchedExemption, ["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
  assert.notEqual(mismatchedResult.status, 0);
  assert.match(`${mismatchedResult.stdout}\n${mismatchedResult.stderr}`, /only when I13 evidence is not_applicable/);

  const greenFailure = makeProject("green-failure");
  const validRed = envelope(greenFailure, "red-test-evidence", { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] });
  writeI13AndRed(greenFailure, validRed);
  prepareCodeGeneration(greenFailure, "failed");
  writePhaseAllowlists(greenFailure);
  writeFileSync(join(greenFailure, ".aidlc", "evidence", "tdd", "project", "default", "red-test-evidence.json"), JSON.stringify(envelope(greenFailure, "red-test-evidence", { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] })), "utf8");
  const greenState = loadWorkflowState(greenFailure);
  assert.ok(greenState);
  greenState!.completed_stage_instances.push("test-case-derivation@module:project", "tdd@module:project@unit:default");
  greenState!.completed_stages.push("test-case-derivation", "tdd");
  greenState!.current_stage = "code-generation";
  greenState!.current_phase = "construction";
  greenState!.current_stage_instance = "code-generation@module:project@unit:default";
  greenState!.current_module = "project";
  greenState!.current_unit = "default";
  saveWorkflowState(greenFailure, greenState!);
  produceNotRequiredBaseline(greenFailure, ["--refresh"]);
  const blockedGreen = run(greenFailure, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  assert.notEqual(blockedGreen.status, 0);
  assert.match(`${blockedGreen.stdout}\n${blockedGreen.stderr}`, /GREEN|tests_failed|phase/);

  const greenPass = makeProject("green-pass");
  writeI13AndRed(greenPass, envelope(greenPass, "red-test-evidence", { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] }));
  prepareCodeGeneration(greenPass, "passed");
  writePhaseAllowlists(greenPass);
  writeFileSync(join(greenPass, ".aidlc", "evidence", "tdd", "project", "default", "red-test-evidence.json"), JSON.stringify(envelope(greenPass, "red-test-evidence", { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] })), "utf8");
  const passState = loadWorkflowState(greenPass);
  assert.ok(passState);
  passState!.completed_stage_instances.push("test-case-derivation@module:project", "tdd@module:project@unit:default");
  passState!.completed_stages.push("test-case-derivation", "tdd");
  passState!.current_stage = "code-generation";
  passState!.current_phase = "construction";
  passState!.current_stage_instance = "code-generation@module:project@unit:default";
  passState!.current_module = "project";
  passState!.current_unit = "default";
  saveWorkflowState(greenPass, passState!);
  produceNotRequiredBaseline(greenPass, ["--refresh"]);
  const completedGreen = run(greenPass, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  assert.equal(completedGreen.status, 0, `${completedGreen.stdout}\n${completedGreen.stderr}`);
  assert.ok(loadWorkflowState(greenPass)?.completed_stage_instances.includes("code-generation@module:project@unit:default"));

  console.log("Construction I13/RED/GREEN gate tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
