import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { argvDigest, phaseObservationDigest } from "../core/tools/aidlc-evidence";
import { readModuleManifest } from "../core/tools/aidlc-execution-context";

// MARS-271 P1/P2 engine efficiency: UC-D mapping-deferred admission, selective
// evidence invalidation, approval tiering with a post-hoc audit ledger, and the
// convergence checkpoint channel.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars271-p1-"));
const MODULE = "project";

function run(project: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: fixtureEnvironment(project, args) });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function check(project: string, sensor: string, args: string[]): { ok: boolean; value: unknown; out: string } {
  const result = run(project, ["check", "--sensor", sensor, ...args]);
  const out = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) return { ok: true, value: JSON.parse(result.stdout), out };
  return { ok: false, value: null, out };
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" };

function git(project: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: project, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function makeProject(name: string, scope = "express"): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "MARS-271 P1 regression project\n", "utf8");
  git(project, ["init", "-q"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "base"]);
  const state = createInitialState(scope, "4.22.11", `workflow-${name}`, [], "MARS-271 P1 regression") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveFixtureState(project, state);
  return project;
}

function setCurrentStage(project: string, stage: string, phase: string, instance: string, unit?: string): void {
  const state = loadWorkflowState(project);
  assert.ok(state);
  state.current_stage = stage;
  state.current_phase = phase;
  state.current_stage_instance = instance;
  state.current_module = MODULE;
  if (unit !== undefined) state.current_unit = unit;
  saveFixtureState(project, state);
}

/** I13 fixture: one mapped case plus one display case with the given extra frontmatter. */
function makeDeferredI13(project: string, extraFrontmatter: string): void {
  const cases = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 订单导出\n- UC-D-002 订单明细展示\n", "utf8");
  writeFileSync(join(cases, "UC-D-001-export.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n", "utf8");
  writeFileSync(join(cases, "UC-D-002-detail.md"), `---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-1\n${extraFrontmatter}---\n# UC-D-002 订单明细展示\n`, "utf8");
  setCurrentStage(project, "test-case-derivation", "inception", `test-case-derivation@module:${MODULE}`);
}

// ---------------------------------------------------------------------------
// 1. UC-D mapping-deferred admission (P1 item 6)
// ---------------------------------------------------------------------------
{
  // P1/display UC-D may defer its mapping; the I13 payload carries the debt.
  const admitted = makeProject("deferred-admit");
  makeDeferredI13(admitted, "priority: P1\ntype: display\nmapping_deferred: 展示类用例，下一迭代补测试映射\n");
  const admittedResult = check(admitted, "test-case-derivation", ["--module", MODULE]);
  assert.ok(admittedResult.ok, `deferred display UC-D must pass I13\n${admittedResult.out}`);
  const payload = admittedResult.value as { mapping_deferred?: Array<{ id: string; reason: string }> };
  assert.ok(payload.mapping_deferred, "I13 payload must report mapping_deferred");
  assert.equal(payload.mapping_deferred!.length, 1);
  assert.equal(payload.mapping_deferred![0].id, "UC-D-002");
  assert.match(payload.mapping_deferred![0].reason, /展示类用例/);

  // P0 UC-Ds must not defer.
  const p0 = makeProject("deferred-p0");
  makeDeferredI13(p0, "priority: P0\nmapping_deferred: 计划下迭代补映射\n");
  const p0Result = check(p0, "test-case-derivation", ["--module", MODULE]);
  assert.ok(!p0Result.ok, "a P0 UC-D must not be deferrable");
  assert.match(p0Result.out, /mapping_deferred is not allowed for P0 UC-D UC-D-002/);

  // Contract/api UC-Ds must not defer either.
  const contract = makeProject("deferred-contract");
  makeDeferredI13(contract, "type: contract\nmapping_deferred: 契约展示页后续补\n");
  const contractResult = check(contract, "test-case-derivation", ["--module", MODULE]);
  assert.ok(!contractResult.ok, "a contract UC-D must not be deferrable");
  assert.match(contractResult.out, /mapping_deferred is not allowed for contract UC-D UC-D-002/);

  // An empty reason is rejected.
  const emptyReason = makeProject("deferred-empty");
  makeDeferredI13(emptyReason, "mapping_deferred: \"\"\n");
  const emptyResult = check(emptyReason, "test-case-derivation", ["--module", MODULE]);
  assert.ok(!emptyResult.ok);
  assert.match(emptyResult.out, /must be a reason string|must declare a non-empty reason/);
}

// ---------------------------------------------------------------------------
// 2. GREEN gate: deferred UC-Ds leave the coverage universe; mapping_debt is mandatory
// ---------------------------------------------------------------------------
{
  const PHASE_ARGV: Record<"RED" | "GREEN", string[]> = { RED: ["node", "red-observer.js"], GREEN: ["node", "green-observer.js"] };
  const envelope = (project: string, sensor: string, payload: Record<string, unknown>): Record<string, unknown> => {
    const phase = sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : undefined;
    const observedDigest = phase ? argvDigest(PHASE_ARGV[phase as "RED" | "GREEN"]) : undefined;
    return {
      ...payload,
      module_id: MODULE,
      unit_id: "default",
      ...(phase ? { observed_command: { id: `${phase.toLowerCase()}-command`, phase, argv_digest: observedDigest, exit_code: phase === "RED" ? 1 : 0, expected_exit_code: phase === "RED" ? 1 : 0, duration_ms: 1 } } : {}),
      evidence_version: "1",
      timestamp: new Date().toISOString(),
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: `test-${sensor}` },
      source_revision: readSourceRevision(project),
      checker: { id: `builtin:${sensor}`, sensor, argv_digest: phase ? phaseObservationDigest(phase, observedDigest!) : "a".repeat(64), exit_code: 0, status: "passed" },
    };
  };

  /** A code-generation fixture whose UC-D-002 is mapping-deferred. */
  const greenFixture = (name: string, withDebt: boolean): string => {
    const project = makeProject(name);
    const cases = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
    mkdirSync(cases, { recursive: true });
    writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "REQ-1 behavior\n", "utf8");
    writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-1\n- UC-D-002 | status: ready | source_ref: REQ-1\n", "utf8");
    writeFileSync(join(cases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n", "utf8");
    writeFileSync(join(cases, "UC-D-002.md"), "---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-1\npriority: P1\ntype: display\nmapping_deferred: 展示类用例，下一迭代补测试映射\n---\n# UC-D-002\n", "utf8");
    const i13Path = join(project, ".aidlc", "evidence", "test-case-derivation", MODULE);
    const redPath = join(project, ".aidlc", "evidence", "tdd", MODULE, "default");
    mkdirSync(i13Path, { recursive: true });
    mkdirSync(redPath, { recursive: true });
    writeFileSync(join(i13Path, "test-case-derivation.json"), JSON.stringify({
      status: "required", ucd_total: 2, ready_ucd: 2, ucd_ids: ["UC-D-001", "UC-D-002"],
      ucd_modes: { "UC-D-001": "new", "UC-D-002": "new" },
      mapping_deferred: [{ id: "UC-D-002", reason: "展示类用例，下一迭代补测试映射" }],
      index: "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md",
    }), "utf8");
    // RED covers exactly the non-deferred new UC-D.
    writeFileSync(join(redPath, "red-test-evidence.json"), JSON.stringify(envelope(project, "red-test-evidence", {
      phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
    })), "utf8");
    mkdirSync(join(project, "src"), { recursive: true });
    writeFileSync(join(project, "src", "behavior.ts"), "export const behavior = 'REQ-1 UC-D-001 behavior';\n", "utf8");
    const plans = join(project, "docs", "aidlc", "modules", MODULE, "construction", "default", "plans");
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, "code-generation-plan.md"), "# Plan\nREQ-1 UC-D-001 validates the target behavior and its deterministic implementation steps.\n", "utf8");
    writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "construction", "default", "implementation-summary.md"), "# Summary\nREQ-1 UC-D-001 behavior is implemented and verified by the target test command.\n", "utf8");
    const evidenceRoot = join(project, ".aidlc", "evidence", "code-generation", MODULE, "default");
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(join(evidenceRoot, "green-test-evidence.json"), JSON.stringify(envelope(project, "green-test-evidence", {
      phase: "GREEN", status: "passed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 0, traceability_complete: true,
      uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
      ...(withDebt ? { mapping_debt: [{ id: "UC-D-002", reason: "展示类用例，下一迭代补测试映射" }] } : {}),
    })), "utf8");
    writeFileSync(join(evidenceRoot, "test-quality.json"), JSON.stringify(envelope(project, "test-quality", {
      status: "passed", red_seen: true, green_seen: true, tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }], mapping_debt: [{ id: "UC-D-002", reason: "展示类用例，下一迭代补测试映射" }],
    })), "utf8");
    writeFileSync(join(evidenceRoot, "traceability-matrix.json"), JSON.stringify(envelope(project, "traceability-matrix", { status: "not_applicable", migration_status: "MIGRATION_REQUIRED", broken_rows: [] })), "utf8");
    writeFileSync(join(evidenceRoot, "structural-invariants.json"), JSON.stringify(envelope(project, "structural-invariants", { status: "not_applicable", skip_reason: "test fixture has no persistence manifest", violations: [] })), "utf8");
    mkdirSync(join(project, ".aidlc", "commands"), { recursive: true });
    writeFileSync(join(project, ".aidlc", "commands", "tdd.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-command", role: "red", argv: PHASE_ARGV.RED }] }), "utf8");
    writeFileSync(join(project, ".aidlc", "commands", "code-generation.json"), JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green-command", role: "green", argv: PHASE_ARGV.GREEN }] }), "utf8");
    const state = loadWorkflowState(project);
    assert.ok(state);
    state.completed_stage_instances.push(`test-case-derivation@module:${MODULE}`, `tdd@module:${MODULE}@unit:default`);
    state.completed_stages.push("test-case-derivation", "tdd");
    state.current_stage = "code-generation";
    state.current_phase = "construction";
    state.current_stage_instance = `code-generation@module:${MODULE}@unit:default`;
    state.current_module = MODULE;
    state.current_unit = "default";
    saveFixtureState(project, state);
    // The real producer writes the not_required BASELINE (no characterization UC-D declared).
    const baseline = run(project, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "default", "--sensor", "baseline-test-evidence"]);
    assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
    return project;
  };

  // With mapping_debt declared exactly, the deferred UC-D neither blocks coverage nor mapping.
  const withDebt = greenFixture("deferred-green-debt", true);
  const report = run(withDebt, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  if (report.status !== 0) {
    assert.doesNotMatch(`${report.stdout}\n${report.stderr}`, /mapping_debt|uc_mapping must cover|has no test source mapping|not covered by/, `unexpected mapping-related failure:\n${report.stdout}\n${report.stderr}`);
  }

  // Without mapping_debt the GREEN gate refuses: the debt may not silently disappear.
  const noDebt = greenFixture("deferred-green-nodebt", false);
  const blocked = run(noDebt, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  assert.notEqual(blocked.status, 0, "GREEN without mapping_debt must be rejected");
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /mapping_debt must report exactly the mapping-deferred UC-Ds/);
}

// ---------------------------------------------------------------------------
// 3. Selective evidence invalidation on --refresh (P1 item 5)
// ---------------------------------------------------------------------------
{
  // Express scope, code-generation, traceability-matrix: a light passing fixture whose
  // stage consumes real artifacts (the UC-D directory), so the inputs fingerprint and
  // the reuse/regenerate decision are both observable end to end.
  const project = makeProject("invalidate");
  const cases = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), `${JSON.stringify({ schema_version: 1, modules: [{ module_id: MODULE, name: "Project", service_id: "not-applicable", paths: ["src"] }] }, null, 2)}\n`, "utf8");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "feature.py"), "# TASK-42 export\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 导出\n", "utf8");
  const ucdPath = join(cases, "UC-D-001-export.md");
  writeFileSync(ucdPath, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\ntdd_mode: new\nchange_ref: TASK-42\n---\n# UC-D-001 导出\n", "utf8");
  setCurrentStage(project, "code-generation", "construction", `code-generation@module:${MODULE}@unit:default`, "default");

  const instance = `code-generation@module:${MODULE}@unit:default`;
  const evidencePath = join(project, ".aidlc", "evidence", "code-generation", MODULE, "default", "traceability-matrix.json");
  const first = run(project, ["evidence", "run", "--stage", "code-generation", "--instance", instance, "--sensor", "traceability-matrix"]);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const firstEvidence = JSON.parse(readFileSync(evidencePath, "utf8")) as { inputs?: { digest: string; artifacts: string[] } };
  assert.ok(firstEvidence.inputs, "evidence must record its inputs fingerprint");
  assert.match(firstEvidence.inputs!.digest, /^[a-f0-9]{64}$/);
  assert.ok(firstEvidence.inputs!.artifacts.some((path) => path.endsWith("UC-D-001-export.md")), "the fingerprint covers the consumed UC-D artifact");

  // Complete the instance so --refresh becomes the regeneration path.
  const state = loadWorkflowState(project);
  assert.ok(state);
  state.completed_stage_instances.push(instance);
  state.completed_stages.push("code-generation");
  state.current_stage_instance = null;
  saveFixtureState(project, state);

  const refreshArgs = ["evidence", "run", "--stage", "code-generation", "--instance", instance, "--sensor", "traceability-matrix", "--refresh"];

  // Unchanged inputs: the controlled evidence is reused, not regenerated.
  const reused = run(project, refreshArgs);
  assert.equal(reused.status, 0, `${reused.stdout}\n${reused.stderr}`);
  assert.match(reused.stdout, /"action": "reused"/, `refresh must report reuse\n${reused.stdout}`);

  // A diff that touches one consumed artifact invalidates only its dependents.
  writeFileSync(ucdPath, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\ntdd_mode: new\nchange_ref: TASK-42\n---\n# UC-D-001 导出\n（本次修订补充验收说明）\n", "utf8");
  const regenerated = run(project, refreshArgs);
  assert.equal(regenerated.status, 0, `${regenerated.stdout}\n${regenerated.stderr}`);
  assert.match(regenerated.stdout, /"action": "regenerated"/, `refresh must regenerate after an input change\n${regenerated.stdout}`);
  const regeneratedEvidence = JSON.parse(readFileSync(evidencePath, "utf8")) as { inputs?: { digest: string } };
  assert.notEqual(regeneratedEvidence.inputs!.digest, firstEvidence.inputs!.digest, "the inputs digest must change with the artifact");

  // And an unchanged run after that reuses again.
  const reusedAgain = run(project, refreshArgs);
  assert.equal(reusedAgain.status, 0, `${reusedAgain.stdout}\n${reusedAgain.stderr}`);
  assert.match(reusedAgain.stdout, /"action": "reused"/);
}

// ---------------------------------------------------------------------------
// 4. Approval tiering (P1 item 7)
// ---------------------------------------------------------------------------
{
  // Module manifests carry approval_overrides; invalid tiers are rejected.
  const manifest = (project: string, approvalOverrides: Record<string, unknown>): void => {
    mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
    writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), `${JSON.stringify({
      schema_version: 1,
      modules: [{ module_id: MODULE, name: "Project", service_id: "not-applicable", approval_overrides: approvalOverrides }],
    }, null, 2)}\n`, "utf8");
  };
  const valid = makeProject("approval-valid");
  manifest(valid, { "code-review": "notify", "implementation-report": "confirm" });
  const parsed = readModuleManifest(valid);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].approval_overrides, { "code-review": "notify", "implementation-report": "confirm" });

  const invalid = makeProject("approval-invalid");
  manifest(invalid, { "code-review": "whenever" });
  assert.throws(() => readModuleManifest(invalid), /approval_overrides\.code-review must be block \| confirm \| notify/);

  // A module may not downgrade a contract/architecture block gate.
  const downgrade = makeProject("approval-downgrade", "feature");
  manifest(downgrade, { "application-design": "notify" });
  const inception = join(downgrade, "docs", "aidlc", "modules", MODULE, "inception");
  mkdirSync(inception, { recursive: true });
  writeFileSync(join(inception, "requirements.md"), "# Requirements\nREQ-1 导出\n", "utf8");
  writeFileSync(join(inception, "user-stories.md"), "# Stories\nREQ-1 导出用户故事\n", "utf8");
  setCurrentStage(downgrade, "application-design", "inception", `application-design@module:${MODULE}`);
  const report = run(downgrade, ["orchestrate", "report", "--stage", "application-design", "--result", "completed"]);
  assert.notEqual(report.status, 0, "downgrading a block stage must fail");
  assert.match(`${report.stdout}\n${report.stderr}`, /cannot downgrade stage application-design/);

  // notify-tier stages land in the post-hoc audit ledger; findings are written back.
  const auditProject = makeProject("approval-audit");
  const auditDir = join(auditProject, ".aidlc", "reports", "approval-audit");
  mkdirSync(auditDir, { recursive: true });
  writeFileSync(join(auditDir, `${MODULE}.json`), `${JSON.stringify([
    { stage_instance: `test-case-derivation@module:${MODULE}`, stage: "test-case-derivation", module_id: MODULE, approval: "notify", recorded_at: new Date().toISOString(), sampled: false },
  ], null, 2)}\n`, "utf8");
  const list = run(auditProject, ["orchestrate", "audit", "--list"]);
  assert.equal(list.status, 0, `${list.stdout}\n${list.stderr}`);
  assert.match(list.stdout, /test-case-derivation/);
  const writeBack = run(auditProject, ["orchestrate", "audit", "--instance", `test-case-derivation@module:${MODULE}`, "--finding", "UC-D 映射缺失一处", "--follow-up", "CL-271"]);
  assert.equal(writeBack.status, 0, `${writeBack.stdout}\n${writeBack.stderr}`);
  const entries = JSON.parse(readFileSync(join(auditDir, `${MODULE}.json`), "utf8")) as Array<{ sampled: boolean; finding: string; follow_up: string }>;
  assert.equal(entries[0].sampled, true);
  assert.equal(entries[0].finding, "UC-D 映射缺失一处");
  assert.equal(entries[0].follow_up, "CL-271");
  // An instance with no audit entry is refused rather than silently dropped.
  const missing = run(auditProject, ["orchestrate", "audit", "--instance", `tdd@module:${MODULE}@unit:default`, "--finding", "x", "--follow-up", "CL-1"]);
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /has no entry for stage instance/);
}

// ---------------------------------------------------------------------------
// 5. Convergence checkpoint channel (P2 item 9)
// ---------------------------------------------------------------------------
{
  const project = makeProject("checkpoint");
  const requirements = join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md");
  mkdirSync(join(project, "docs", "aidlc", "modules", MODULE, "inception"), { recursive: true });
  writeFileSync(requirements, "# Requirements\nREQ-1 导出行为\n", "utf8");
  setCurrentStage(project, "requirement-clarification", "inception", `requirement-clarification@module:${MODULE}`);
  // Warm the fixture session binding first so its claim transaction (a revision bump of
  // the bind itself, not of the checkpoint) stays out of the measurement below.
  fixtureEnvironment(project, ["orchestrate", "checkpoint"]);
  const before = loadWorkflowState(project);
  assert.ok(before);
  const revisionBefore = before.revision;

  const record = run(project, ["orchestrate", "checkpoint", "--note", "收敛期第 3 轮非正式进度：RED 观察已复现"]);
  assert.equal(record.status, 0, `${record.stdout}\n${record.stderr}`);
  const dir = join(project, ".aidlc", "checkpoints", `requirement-clarification@module:${MODULE}`.replace(/[^a-z0-9@_-]/gi, "_"));
  assert.ok(existsSync(dir), "checkpoint directory must be written");
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1);
  const checkpoint = JSON.parse(readFileSync(join(dir, files[0]), "utf8")) as Record<string, unknown>;
  assert.equal(checkpoint.stage_instance, `requirement-clarification@module:${MODULE}`);
  assert.equal(checkpoint.revision, revisionBefore, "an informal checkpoint must not advance the revision");
  assert.match(String(checkpoint.note), /收敛期第 3 轮/);

  // The engine state itself is untouched.
  const after = loadWorkflowState(project);
  assert.ok(after);
  assert.equal(after.revision, revisionBefore, "checkpoint must not change the workflow revision");
  assert.equal(after.current_stage_instance, `requirement-clarification@module:${MODULE}`);

  // Checkpoints are listable and recoverable from any informal round.
  const list = run(project, ["orchestrate", "checkpoint", "--list"]);
  assert.equal(list.status, 0, `${list.stdout}\n${list.stderr}`);
  assert.match(list.stdout, /收敛期第 3 轮/);
  const listInstance = run(project, ["orchestrate", "checkpoint", "--list", "--instance", `requirement-clarification@module:${MODULE}`]);
  assert.equal(listInstance.status, 0, `${listInstance.stdout}\n${listInstance.stderr}`);
  assert.match(listInstance.stdout, /checkpoints/);
}

console.log("MARS-271 P1 efficiency tests passed");
rmSync(scratch, { recursive: true, force: true });
