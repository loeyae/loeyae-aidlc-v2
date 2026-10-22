import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { argvDigest, phaseObservationDigest } from "../core/tools/aidlc-evidence";

// MARS-271 engine efficiency: blocked taxonomy, unresolved-marker classification,
// gate-front lint mode, incremental structural-invariants scan cache, and the
// RED-only convergence test filter.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars271-"));
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

function makeProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "MARS-271 regression project\n", "utf8");
  git(project, ["init", "-q"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "base"]);
  const state = createInitialState("express", "4.5.0", `workflow-${name}`, [], "MARS-271 regression") as WorkflowState;
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

/** I13 fixture: one ready case plus one extra case with the given frontmatter fields. */
function makeI13(project: string, extraFrontmatter: string): string {
  const cases = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "# Requirements\nREQ-1 订单导出：验收标准为 30 秒内完成\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 订单导出\n- UC-D-002 订单明细\n", "utf8");
  writeFileSync(join(cases, "UC-D-001-export.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001 订单导出\n", "utf8");
  const extra = join(cases, "UC-D-002-detail.md");
  writeFileSync(extra, `---\nid: UC-D-002\nsource_ref: REQ-1\n${extraFrontmatter}---\n# UC-D-002 订单明细\n`, "utf8");
  setCurrentStage(project, "test-case-derivation", "inception", `test-case-derivation@module:${MODULE}`);
  return extra;
}

// ---------------------------------------------------------------------------
// 1. blocked taxonomy (P0 item 1)
// ---------------------------------------------------------------------------
{
  const cases: Array<{ label: string; frontmatter: string; pattern: RegExp }> = [
    { label: "no blocked_kind", frontmatter: "status: blocked\n", pattern: /must declare blocked_kind: business-unknown \| technical-prerequisite/ },
    { label: "invalid blocked_kind", frontmatter: "status: blocked\nblocked_kind: maybe\n", pattern: /UC-D-002 must declare blocked_kind/ },
    { label: "technical-prerequisite missing prerequisites", frontmatter: "status: blocked\nblocked_kind: technical-prerequisite\n", pattern: /must declare non-empty prerequisites/ },
    { label: "technical-prerequisite missing unblock_path", frontmatter: "status: blocked\nblocked_kind: technical-prerequisite\nprerequisites: [支付网关限流依赖]\n", pattern: /must declare unblock_path/ },
  ];
  for (const item of cases) {
    const project = makeProject(`blocked-${cases.indexOf(item)}`);
    makeI13(project, item.frontmatter);
    const result = check(project, "test-case-derivation", ["--module", MODULE]);
    assert.ok(!result.ok, `${item.label}: expected failure, passed: ${JSON.stringify(result.value)}`);
    assert.match(result.out, item.pattern, `${item.label}: wrong failure`);
  }

  // A classified blocked case still blocks completion, with the taxonomy in the message.
  const business = makeProject("blocked-business");
  makeI13(business, "status: blocked\nblocked_kind: business-unknown\n");
  const businessResult = check(business, "test-case-derivation", ["--module", MODULE]);
  assert.ok(!businessResult.ok);
  assert.match(businessResult.out, /cannot complete while any UC-D is blocked: UC-D-002 \(business-unknown\)/);

  const technical = makeProject("blocked-technical");
  makeI13(technical, "status: blocked\nblocked_kind: technical-prerequisite\nprerequisites:\n  - 订单明细服务尚未提供分页接口\nunblock_path: 先在 orders-service 完成分页 API\n");
  const technicalResult = check(technical, "test-case-derivation", ["--module", MODULE]);
  assert.ok(!technicalResult.ok);
  assert.match(technicalResult.out, /cannot complete while any UC-D is blocked: UC-D-002 \(technical-prerequisite\)/);
}

// ---------------------------------------------------------------------------
// 2. unresolved-marker classification (P0 item 2)
// ---------------------------------------------------------------------------
{
  // contract-baseline fixture: module manifest + unit manifest + active instance.
  const root = (name: string): string => {
    const project = makeProject(name);
    const incept = join(project, "docs", "aidlc", "modules", "m01", "inception");
    mkdirSync(incept, { recursive: true });
    mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
    mkdirSync(join(project, "services", "m01", "contracts"), { recursive: true });
    writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), `${JSON.stringify({
      schema_version: 1,
      modules: [
        { module_id: "m01", name: "Orders", service_id: "order-service", paths: ["services/m01"] },
        { module_id: "m02", name: "Payments", service_id: "payment-service", paths: ["services/m02"] },
      ],
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(incept, "unit-manifest.json"), `${JSON.stringify({
      schema_version: 1,
      module_id: "m01",
      units: [{ unit_id: "u1", name: "Unit u1", service_id: "order-service", conditional_stages: ["shared-contract-baseline"] }],
    }, null, 2)}\n`, "utf8");
    writeFileSync(join(project, "services", "m01", "app.py"), "def orders():\n    return []\n", "utf8");
    const state = loadWorkflowState(project);
    assert.ok(state);
    state.completed_stages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template", "units-generation"];
    state.completed_stage_instances = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template", "units-generation@module:m01"];
    state.current_stage = "shared-contract-baseline";
    state.current_phase = "construction";
    state.current_stage_instance = "shared-contract-baseline@module:m01@unit:u1";
    state.current_module = "m01";
    state.current_unit = "u1";
    saveFixtureState(project, state);
    return project;
  };

  const BASE = "# 订单查询契约\n\nowner: m01\nconsumers: m02\nversion: 1.0.0（向后兼容）\n\nGET /orders/{id} 返回订单详情。\n";
  const CONTEXT = ["--module", "m01", "--unit", "u1"];

  // Historical records and notes no longer count as unresolved markers.
  const clean = root("markers-clean");
  writeFileSync(join(clean, "services", "m01", "contracts", "orders-contract.md"), `${BASE}
## 历史记录

- 2024-05-01 字段含义待确认 已解决
- 变更记录：分页语义待定 已关闭

> 备注：导出语义待确认，仅备注非待决
注：排序行为待定，见历史讨论
`, "utf8");
  const cleanResult = check(clean, "contract-baseline", CONTEXT);
  assert.ok(cleanResult.ok, `historical/note markers must pass\n${cleanResult.out}`);

  // A pending marker still fails, with file position and classification in the message.
  const pending = root("markers-pending");
  writeFileSync(join(pending, "services", "m01", "contracts", "orders-contract.md"), `${BASE}
排序行为待定
`, "utf8");
  const pendingResult = check(pending, "contract-baseline", CONTEXT);
  assert.ok(!pendingResult.ok, "pending marker must fail");
  assert.match(pendingResult.out, /unresolved marker found in project artifact: services[\\/]m01[\\/]contracts[\\/]orders-contract\.md:\d+: [^\n]*\[待决\]/);
}

/** The lint producer prints one pretty-printed JSON report; tolerate leading log lines. */
function parseLintReport(stdout: string): Record<string, unknown> {
  const start = stdout.indexOf('{\n  "mode"');
  assert.ok(start >= 0, `lint report not found in output:\n${stdout}`);
  return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 3. gate-front lint mode (P0 item 3)
// ---------------------------------------------------------------------------
{
  const project = makeProject("lint");
  makeI13(project, "status: ready\n");

  const passing = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE, "--sensor", "test-case-derivation", "--lint"]);
  assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);
  const report = parseLintReport(passing.stdout);
  assert.equal(report.mode, "lint");
  assert.equal(report.status, "passed");
  assert.match(String(report.note), /no evidence written and no engine state changed/);
  // lint writes no evidence anywhere.
  assert.ok(!existsSync(join(project, ".aidlc", "evidence", "test-case-derivation", MODULE, "test-case-derivation.json")), "lint must not write evidence");

  const failing = makeProject("lint-fail");
  makeI13(failing, "status: blocked\n");
  const lintFail = run(failing, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE, "--sensor", "test-case-derivation", "--lint"]);
  assert.notEqual(lintFail.status, 0, "a failing checker must fail the lint run");
  const failReport = parseLintReport(lintFail.stdout);
  assert.equal(failReport.status, "failed");
  const results = failReport.results as Array<{ sensor: string; error?: string }>;
  assert.match(String(results[0].error), /must declare blocked_kind/);
  assert.ok(!existsSync(join(failing, ".aidlc", "evidence", "test-case-derivation", MODULE, "test-case-derivation.json")), "a failed lint must not write evidence either");

  // lint refuses command-shaped flags.
  const mixed = run(project, ["evidence", "run", "--stage", "test-case-derivation", "--module", MODULE, "--lint", "--test-filter", "UC-D-001"]);
  assert.notEqual(mixed.status, 0);
  assert.match(`${mixed.stdout}\n${mixed.stderr}`, /--lint runs no commands and takes no --test-filter/);
}

// ---------------------------------------------------------------------------
// 4. incremental structural-invariants scan cache (P0 item 4)
// ---------------------------------------------------------------------------
{
  const project = makeProject("scan-cache");
  const design = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design");
  mkdirSync(design, { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "# Requirements\nREQ-1 订单导出\n", "utf8");
  writeFileSync(join(design, "structural-invariants.json"), `${JSON.stringify({ schema_version: "1", invariants: [] }, null, 2)}\n`, "utf8");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "app.ts"), "export const app = 'REQ-1 UC-D-001';\n", "utf8");
  setCurrentStage(project, "application-design", "inception", `application-design@module:${MODULE}`);

  const first = check(project, "structural-invariants", ["--module", MODULE]);
  assert.ok(first.ok, `first scan must pass\n${first.out}`);
  const firstPayload = first.value as { scan_cache?: { reused: number; parsed: number } };
  assert.ok(firstPayload.scan_cache, "payload must report scan_cache");
  assert.equal(firstPayload.scan_cache!.reused, 0, "first scan parses everything");
  assert.ok(firstPayload.scan_cache!.parsed >= 1, "fixture has at least one scanned file");
  assert.ok(existsSync(join(project, ".aidlc", "cache", "structural-invariants", `${MODULE}.json`)), "scan cache must be written");

  const second = check(project, "structural-invariants", ["--module", MODULE]);
  assert.ok(second.ok, `second scan must pass\n${second.out}`);
  const secondPayload = second.value as { scan_cache?: { reused: number; parsed: number } };
  assert.equal(secondPayload.scan_cache!.parsed, 0, "unchanged files must not be re-parsed");
  assert.ok(secondPayload.scan_cache!.reused >= 1, "unchanged files must be reused from the cache");

  // Changing a file invalidates just that entry.
  writeFileSync(join(project, "src", "app.ts"), "export const app = 'REQ-1 UC-D-001 changed';\n", "utf8");
  const third = check(project, "structural-invariants", ["--module", MODULE]);
  assert.ok(third.ok, `third scan must pass\n${third.out}`);
  const thirdPayload = third.value as { scan_cache?: { reused: number; parsed: number } };
  assert.ok(thirdPayload.scan_cache!.parsed >= 1 && thirdPayload.scan_cache!.reused >= 1, "a changed file is re-parsed while unchanged files stay cached");
}

// ---------------------------------------------------------------------------
// 5. RED-only convergence test filter (P0 item 4)
// ---------------------------------------------------------------------------
{
  const PHASE_ARGV: Record<"RED" | "GREEN", string[]> = { RED: ["node", "red-observer.js"], GREEN: ["node", "green-observer.js"] };
  const envelope = (project: string, sensor: string, payload: Record<string, unknown>): Record<string, unknown> => {
    const phase = sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : undefined;
    const observedDigest = phase ? argvDigest(PHASE_ARGV[phase as "RED" | "GREEN"]) : undefined;
    return {
      ...payload,
      ...(phase ? { observed_command: { id: `${phase.toLowerCase()}-command`, phase, argv_digest: observedDigest, exit_code: phase === "RED" ? 1 : 0, expected_exit_code: phase === "RED" ? 1 : 0, duration_ms: 1 } } : {}),
      evidence_version: "1",
      timestamp: new Date().toISOString(),
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: `test-${sensor}` },
      source_revision: readSourceRevision(project),
      checker: { id: `builtin:${sensor}`, sensor, argv_digest: phase ? phaseObservationDigest(phase, observedDigest!) : "a".repeat(64), exit_code: 0, status: "passed" },
    };
  };

  // producer: an active tdd unit whose red observer ignores the filter env var.
  const producer = makeProject("filter-red");
  const cases = join(producer, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(producer, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "REQ-1 behavior\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-1\n", "utf8");
  writeFileSync(join(cases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n", "utf8");
  mkdirSync(join(producer, ".aidlc", "evidence", "test-case-derivation", MODULE), { recursive: true });
  writeFileSync(join(producer, ".aidlc", "evidence", "test-case-derivation", MODULE, "test-case-derivation.json"), JSON.stringify({ status: "required", ucd_total: 1, ready_ucd: 1, ucd_ids: ["UC-D-001"], index: "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md" }), "utf8");
  writeFileSync(join(producer, "red-observer.js"), "console.log(JSON.stringify({phase:'RED',status:'failed',failure_class:'behavior',failure_signature:'expected behavior is absent',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:1,traceability_complete:true,uc_mapping:[{use_case:'UC-D-001',test_methods:['behaviorTest']}]})); process.exit(1);\n", "utf8");
  writeFileSync(join(producer, ".aidlc", "evidence-commands.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-observer", role: "red", argv: PHASE_ARGV.RED }] }), "utf8");
  const producerState = loadWorkflowState(producer);
  assert.ok(producerState);
  producerState.completed_stage_instances.push(`test-case-derivation@module:${MODULE}`);
  producerState.completed_stages.push("test-case-derivation");
  producerState.current_stage = "tdd";
  producerState.current_phase = "construction";
  producerState.current_stage_instance = `tdd@module:${MODULE}@unit:default`;
  producerState.current_module = MODULE;
  producerState.current_unit = "default";
  saveFixtureState(producer, producerState);

  const produced = run(producer, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "default", "--sensor", "red-test-evidence", "--test-filter", "UC-D-001"]);
  assert.equal(produced.status, 0, `${produced.stdout}\n${produced.stderr}`);
  const redEvidence = JSON.parse(readFileSync(join(producer, ".aidlc", "evidence", "tdd", MODULE, "default", "red-test-evidence.json"), "utf8")) as Record<string, unknown>;
  assert.equal(redEvidence.test_filter, "UC-D-001", "RED evidence records the convergence filter");

  // producer rejects a filter outside RED outright.
  const wrongPhase = run(producer, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "default", "--sensor", "green-test-evidence", "--test-filter", "UC-D-001"]);
  assert.notEqual(wrongPhase.status, 0);
  assert.match(`${wrongPhase.stdout}\n${wrongPhase.stderr}`, /--test-filter is only supported for RED evidence/);

  // gate: a GREEN evidence carrying test_filter is rejected even when otherwise valid.
  const greenProject = makeProject("filter-green");
  const greenCases = join(greenProject, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(greenCases, { recursive: true });
  writeFileSync(join(greenProject, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "REQ-1 behavior\n", "utf8");
  writeFileSync(join(greenCases, "_index.md"), "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-1\n", "utf8");
  writeFileSync(join(greenCases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n", "utf8");
  const i13Path = join(greenProject, ".aidlc", "evidence", "test-case-derivation", MODULE);
  const redPath = join(greenProject, ".aidlc", "evidence", "tdd", MODULE, "default");
  mkdirSync(i13Path, { recursive: true });
  mkdirSync(redPath, { recursive: true });
  writeFileSync(join(i13Path, "test-case-derivation.json"), JSON.stringify({ status: "required", ucd_total: 1, ready_ucd: 1, ucd_ids: ["UC-D-001"], index: "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md" }), "utf8");
  const redPayload = { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] };
  writeFileSync(join(redPath, "red-test-evidence.json"), JSON.stringify(envelope(greenProject, "red-test-evidence", redPayload)), "utf8");
  mkdirSync(join(greenProject, "src"), { recursive: true });
  writeFileSync(join(greenProject, "src", "behavior.ts"), "export const behavior = 'REQ-1 UC-D-001 behavior';\n", "utf8");
  const plans = join(greenProject, "docs", "aidlc", "modules", MODULE, "construction", "default", "plans");
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, "code-generation-plan.md"), "# Plan\nREQ-1 UC-D-001 validates the target behavior and its deterministic implementation steps.\n", "utf8");
  writeFileSync(join(greenProject, "docs", "aidlc", "modules", MODULE, "construction", "default", "implementation-summary.md"), "# Summary\nREQ-1 UC-D-001 behavior is implemented and verified by the target test command.\n", "utf8");
  const evidenceRoot = join(greenProject, ".aidlc", "evidence", "code-generation", MODULE, "default");
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(join(evidenceRoot, "green-test-evidence.json"), JSON.stringify(envelope(greenProject, "green-test-evidence", {
    phase: "GREEN", status: "passed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }], test_filter: "UC-D-001",
  })), "utf8");
  writeFileSync(join(evidenceRoot, "test-quality.json"), JSON.stringify(envelope(greenProject, "test-quality", {
    status: "passed", red_seen: true, green_seen: true, tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
  })), "utf8");
  writeFileSync(join(evidenceRoot, "traceability-matrix.json"), JSON.stringify(envelope(greenProject, "traceability-matrix", { status: "not_applicable", migration_status: "MIGRATION_REQUIRED", broken_rows: [] })), "utf8");
  writeFileSync(join(evidenceRoot, "structural-invariants.json"), JSON.stringify(envelope(greenProject, "structural-invariants", { status: "not_applicable", skip_reason: "test fixture has no persistence manifest", violations: [] })), "utf8");
  mkdirSync(join(greenProject, ".aidlc", "commands"), { recursive: true });
  writeFileSync(join(greenProject, ".aidlc", "commands", "tdd.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-command", role: "red", argv: PHASE_ARGV.RED }] }), "utf8");
  writeFileSync(join(greenProject, ".aidlc", "commands", "code-generation.json"), JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green-command", role: "green", argv: PHASE_ARGV.GREEN }] }), "utf8");
  const greenState = loadWorkflowState(greenProject);
  assert.ok(greenState);
  greenState.completed_stage_instances.push(`test-case-derivation@module:${MODULE}`, `tdd@module:${MODULE}@unit:default`);
  greenState.completed_stages.push("test-case-derivation", "tdd");
  greenState.current_stage = "code-generation";
  greenState.current_phase = "construction";
  greenState.current_stage_instance = `code-generation@module:${MODULE}@unit:default`;
  greenState.current_module = MODULE;
  greenState.current_unit = "default";
  saveFixtureState(greenProject, greenState);
  // The real producer writes the not_required BASELINE (no characterization UC-D declared).
  const baseline = run(greenProject, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "default", "--sensor", "baseline-test-evidence"]);
  assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);
  const blocked = run(greenProject, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  assert.notEqual(blocked.status, 0, "GREEN evidence with a test_filter must be rejected");
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /test_filter is only allowed for RED|must be a full run/);
}

console.log("MARS-271 engine efficiency tests passed");
rmSync(scratch, { recursive: true, force: true });
