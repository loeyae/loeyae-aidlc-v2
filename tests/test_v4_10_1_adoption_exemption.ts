/**
 * 4.10.1 (MARS-93) regression suite: `orchestrate baseline --adopt` ignores ucd_exemption units.
 *
 * A unit with an empty UC-D subset and a `ucd_exemption` runs its tdd through the
 * controlled producer (validation_command), which writes RED / BASELINE `not_required`
 * records. That tdd observes no code, so neither the "module already holds RED /
 * BASELINE / GREEN evidence" guard nor the "adoption must predate the module's first
 * tdd start" guard of --adopt may count it.
 *
 * Fixture: workflow repository + nested repository app/ (split layout, module m01-trade
 * with units u0 and u1). u0 declares `ucd_exemption`; u1 owns the characterization
 * UC-D-021 (unit_refs [u1]) on app/exporter.py. u0 completes tdd (not_required), then
 * app/ commits the implementation (after u0's tdd), then the module adopts that commit.
 * Everything is driven through the public CLI and the gate probe.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-4101-adopt-"));
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const M01 = "m01-trade";
const IN = `docs/aidlc/modules/${M01}/inception`;
const CASES = `${IN}/application-design/test-cases`;
const I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
const RED = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/red-test-evidence.json`;
const BASE = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/baseline-test-evidence.json`;
const GREEN = (unit: string) => `.aidlc/evidence/code-generation/${M01}/${unit}/green-test-evidence.json`;
const TDD = (unit: string) => `tdd@module:${M01}@unit:${unit}`;
const CODEGEN = (unit: string) => `code-generation@module:${M01}@unit:${unit}`;
const CONSTRUCTION = (unit: string) => `docs/aidlc/modules/${M01}/construction/${unit}`;
const MOD = ["--module", M01];
const UNIT = (unit: string) => ["--module", M01, "--unit", unit];
const TCD = ["--stage", "test-case-derivation", ...MOD];

type Run = { status: number; out: string; json: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE"]) delete env[key];
  return env;
}

function run(project: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
  const stdout = result.stdout || "";
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(stdout) as Record<string, unknown>;
  } catch { /* not JSON */ }
  return { status: result.status ?? 1, out: `${stdout}\n${result.stderr || ""}`, json };
}

function ok(project: string, args: string[]): Run {
  const result = run(project, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  assert.notEqual(result.json.kind, "error", `${args.join(" ")}\n${result.out}`);
  return result;
}

/** Output of a CLI run that must be rejected; "" when it was accepted. */
function rejected(result: Run): string {
  return result.status !== 0 || result.json.kind === "error" ? result.out : "";
}

function gate(project: string, instance: string, sensor: string, options: string[] = []): string {
  const result = spawnSync(process.execPath, [tsx, probe, instance, "sensors", sensor, ...options], { cwd: project, encoding: "utf8", env: cleanEnv() });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const value = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() || "{}") as { failures?: string[]; error?: string };
  if (value.error) return `probe error: ${value.error}`;
  return (value.failures || []).join("\n");
}

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function readJson(project: string, path: string): Json {
  return JSON.parse(readFileSync(join(project, path), "utf8")) as Json;
}

function git(cwd: string, args: string[], date = OLD_DATE): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} (${cwd})\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function expectRejected(label: string, output: string, pattern: RegExp): void {
  assert.ok(output, `${label}: expected a rejection matching ${pattern}, but the command was accepted`);
  assert.match(output, pattern, `${label}: unexpected rejection text`);
  console.log(`    rejected ${label}: ${(pattern.exec(output) || [""])[0].slice(0, 160)}`);
}

const EXPORTER = "# REQ-001 legacy order exporter\ndef export_orders(client):\n    return list(client.fetch_orders())\n";
/** Implementation committed by the old process after u0's tdd, before u1's tdd. */
const EXPORTER_RETRY = "# REQ-001 order export with retry (implemented before AI-DLC took u1 over)\ndef export_orders(client, attempts=3):\n    for attempt in range(attempts):\n        try:\n            return list(client.fetch_orders())\n        except TimeoutError:\n            if attempt == attempts - 1:\n                raise\n";
const OBSERVER = `const { existsSync, readFileSync } = require("node:fs");
const phase = process.env.AIDLC_PHASE || "GREEN";
const passed = existsSync("app/exporter.py") && readFileSync("app/exporter.py", "utf8").includes("def export_orders(client, attempts=3)");
const observation = { phase, status: passed ? "passed" : "failed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: passed ? 0 : 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-021", test_methods: ["tests/test_order_export.py::test_uc_d_021"] }] };
if (!passed) Object.assign(observation, { failure_class: "behavior", failure_signature: "export_orders retry changed" });
console.log(JSON.stringify(observation));
process.exit(passed ? 0 : 1);
`;
const VALIDATOR = "console.log(\"contract ok\");\n";
const CONTRACT = "# REQ-001 u0: order export contract (declaration only)\nEXPORT_FIELDS = (\"id\", \"amount\")\n";
const EXEMPTION = { reason_code: "pure-declaration", reason: "u0 只声明订单导出契约，不含业务行为", approval_ref: "REVIEW-2026-10-07-93", alternative_validation: "契约结构校验（node tests/validate_contract.cjs）", validation_command: ["node", "tests/validate_contract.cjs"] };
const UCD = `---\nid: UC-D-021\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\nunit_refs: [u1]\ncode_refs:\n  - app/exporter.py::export_orders\nreason: 接管前旧流程已实现导出重试，改动前锁定其现有行为\napproval_ref: REVIEW-2026-10-07-93\n---\n# UC-D-021 导出超时重试\n\nGiven 下游前两次超时，When 调用 export_orders，Then 第三次返回订单列表。\n`;

interface Fixture {
  project: string;
  app: string;
  workflowCommit: string;
  nextModule: (expected: string, refreshes?: string[][]) => void;
}

/** Split layout, module m01-trade with units u0 (ucd_exemption) and u1, driven to the I13 stage. */
function fixture(name: string): Fixture {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n\nDocs and AI-DLC state; the code lives in the app/ repository.\n");
  write(project, ".gitignore", "app/\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] })}\n`);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "w1 workflow repository"]);
  const workflowCommit = git(project, ["rev-parse", "HEAD"]);
  const app = join(project, "app");
  mkdirSync(app, { recursive: true });
  git(app, ["init", "-q"]);
  git(app, ["checkout", "-q", "-b", "main"]);
  write(app, "__init__.py", "\"\"\"Order export application package (REQ-001).\"\"\"\n");
  write(app, "exporter.py", EXPORTER);
  git(app, ["add", "-A"]);
  git(app, ["commit", "-qm", "a1 legacy exporter"]);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: [{ path: "app", repo: "nested" }] })}\n`);

  const step = (args: string[]) => ok(project, args);
  step(["orchestrate", "next", "--scope", "feature", "--work", `4.10.1 adoption exemption ${name}`]);
  const global = loadWorkflowState(project)!;
  const globalStages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  global.completed_stages = [...globalStages];
  global.completed_stage_instances = [...globalStages];
  global.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
  saveWorkflowState(project, global);
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", `# 场景模块映射\n\nREQ-001 订单导出属于 ${M01}。\n`);
  step(["orchestrate", "split", "--from", global.workflow_id]);
  const nextModule = (expected: string, refreshes: string[][] = []): void => {
    for (const args of refreshes) step(["evidence", "run", ...args, "--refresh"]);
    const result = step(["orchestrate", "next", ...MOD]);
    assert.equal(result.json.stage_instance, expected, JSON.stringify(result.json, null, 2));
  };
  const report = (stage: string, extra: string[] = []) => step(["orchestrate", "report", "--stage", stage, ...MOD, "--result", "completed", ...extra]);
  const ack = (stage: string) => report(stage, ["--instruction-ack", stage]);
  const RA = ["--stage", "requirements-analysis", ...MOD];
  nextModule(`requirements-analysis@module:${M01}`);
  write(project, `${IN}/requirements.md`, "# 需求\n\n## REQ-001 订单导出重试\n\ntrack: [backend]\n\n业务规则：订单导出遇到下游超时时重试三次；接管前已实现的重试行为在改动中保持不变。\n");
  report("requirements-analysis");
  nextModule(`requirement-clarification@module:${M01}`);
  write(project, `${IN}/clarifications.md`, "# 需求澄清\n\nNo clarifications needed.\n\nREQ-001 的重试行为由接管前的实现定义，本次改动沿用。\n");
  report("requirement-clarification");
  nextModule(`requirements-methods@module:${M01}`, [RA]);
  write(project, `${IN}/requirements/business-flows.md`, "# 业务流程\n\n## REQ-001 订单导出流程\n\n```mermaid\nflowchart LR\n  A[调用导出] --> B{超时?}\n  B -- 是 --> A\n  B -- 否 --> C[返回订单]\n```\n");
  report("requirements-methods");
  nextModule(`user-stories@module:${M01}`, [RA]);
  write(project, `${IN}/user-stories.md`, "# 用户故事\n\n## STORY-001 / US-001 运营导出订单\n\n- 关联需求：REQ-001\n- 作为运营人员，我希望订单导出在下游超时时自动重试。\n- 验收标准：接管前实现的重试行为在改动后保持不变。\n");
  report("user-stories");
  nextModule(`cross-validation@module:${M01}`, [RA]);
  write(project, `${IN}/cross-validation-report.md`, "# 交叉验证报告\n\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: not-selected\n\n| 需求 | 故事 | 结论 |\n| --- | --- | --- |\n| REQ-001 | STORY-001 / US-001 | 一致 |\n");
  report("cross-validation");
  nextModule(`workflow-planning@module:${M01}`, [RA, ["--stage", "user-stories", ...MOD]]);
  write(project, `${IN}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：单元 u0 只声明契约（ucd_exemption），单元 u1 改动嵌套仓库 app/；接管前的实现走 BASELINE→GREEN；不需要应用设计。\n\n| 阶段 | 决定 |\n| --- | --- |\n| application-design | skip |\n");
  report("workflow-planning");
  write(project, `${IN}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: [
    { unit_id: "u0", name: "Unit u0", service_id: "trade-service", conditional_stages: [], ucd_exemption: EXEMPTION },
    { unit_id: "u1", name: "Unit u1", service_id: "trade-service", conditional_stages: [] },
  ] }, null, 2)}\n`);
  const moduleRef = { kind: "module" as const, module_id: M01 };
  const moduleState = loadWorkflowState(project, moduleRef)!;
  moduleState.completed_stages.push("units-generation");
  moduleState.completed_stage_instances.push(`units-generation@module:${M01}`);
  saveWorkflowState(project, moduleState, moduleRef);
  write(project, `${CONSTRUCTION("u0")}/functional-design.md`, "# 功能设计 — u0\n\nREQ-001：u0 只声明订单导出契约，不含业务行为；无 UC-D。\n");
  write(project, `${CONSTRUCTION("u1")}/functional-design.md`, "# 功能设计 — u1\n\nREQ-001 / UC-D-021：u1 只补充追溯注释，不改变接管前实现的重试行为；无新增接口与数据结构。\n");
  nextModule(`test-case-derivation@module:${M01}`);
  write(project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-021 导出超时重试（source_ref: REQ-001）\n");
  write(project, `${CASES}/UC-D-021.md`, UCD);
  write(project, "tests/__init__.py", "\"\"\"Tests for the order export (REQ-001).\"\"\"\n");
  write(project, "tests/test_order_export.py", "# REQ-001 UC-D-021\n\n\ndef test_uc_d_021():\n    # UC-D-021\n    assert True\n");
  write(project, "tests/observe_uc.cjs", OBSERVER);
  write(project, "tests/validate_contract.cjs", VALIDATOR);
  write(project, ".aidlc/commands/tdd.json", `${JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "uc-baseline", role: "baseline", argv: ["node", "tests/observe_uc.cjs"] }] }, null, 2)}\n`);
  write(project, ".aidlc/commands/code-generation.json", `${JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "uc-green", role: "green", argv: ["node", "tests/observe_uc.cjs"] }] }, null, 2)}\n`);
  return { project, app, workflowCommit, nextModule };
}

const APPROVAL = ["--approval-ref", "REVIEW-2026-10-07-93 架构评审纪要"];
const ADOPT = (f: Fixture, appCommit: string, extra: string[] = []) => ["orchestrate", "baseline", "--adopt", f.workflowCommit, "--repo", `app=${appCommit}`, "--module", M01, "--user-input", "Approve", ...APPROVAL, "--reason", "u1 接管前旧流程已提交的导出重试实现", ...extra];
const auditText = (project: string): string => readFileSync(join(project, "aidlc", "active", "modules", M01, "audit.md"), "utf8");

async function main(): Promise<void> {
  console.log("4.10.1 adoption ignores ucd_exemption units");
  try {
    const f = fixture("exempt");
    const moduleRef = { kind: "module" as const, module_id: M01 };

    // ---- I13 against the global baseline; u0 (ucd_exemption) completes tdd with not_required.
    ok(f.project, ["orchestrate", "report", ...TCD, "--result", "completed"]);
    assert.deepEqual(readJson(f.project, I13).ucd_units, { "UC-D-021": ["u1"] });
    f.nextModule(TDD("u0"), [TCD]);
    ok(f.project, ["orchestrate", "report", "--stage", "tdd", ...UNIT("u0"), "--result", "completed"]);
    for (const path of [RED("u0"), BASE("u0")]) {
      const evidence = readJson(f.project, path);
      assert.equal(evidence.status, "not_required", path);
      assert.equal(evidence.ucd_exemption.reason_code, "pure-declaration", path);
    }
    const u0TddAt = loadWorkflowState(f.project, moduleRef)!.history.filter((entry) => entry.instance_id === TDD("u0")).map((entry) => entry.timestamp);
    assert.ok(u0TddAt.length > 0, "u0 tdd is recorded in the module history");
    // u0 code-generation (GREEN not_required) and code-review complete as well.
    f.nextModule(CODEGEN("u0"), [TCD]);
    write(f.app, "contract.py", CONTRACT);
    write(f.project, `${CONSTRUCTION("u0")}/plans/code-generation-plan.md`, "# 代码生成计划 — u0\n\n- REQ-001：u0 只声明订单导出契约 app/contract.py，无 UC-D（ucd_exemption）。\n");
    write(f.project, `${CONSTRUCTION("u0")}/implementation-summary.md`, "# 实现摘要 — u0\n\nREQ-001：app/contract.py 声明订单导出字段，契约结构由 tests/validate_contract.cjs 校验。\n");
    ok(f.project, ["orchestrate", "report", "--stage", "code-generation", ...UNIT("u0"), "--result", "completed"]);
    assert.equal(readJson(f.project, GREEN("u0")).status, "not_required");
    f.nextModule(`code-review@module:${M01}@unit:u0`);
    write(f.project, `${CONSTRUCTION("u0")}/code-review.md`, ["# 代码审查 — 单元 u0", "", "- 审查模式: 集成双轴审查", "- reviewer: aidlc-quality-agent", "- execution_context: isolated", "- review_only: true", "- Spec 结果: passed（REQ-001 契约声明）", "- Standards 结果: passed", "- issues_found: 0", "- issues_resolved: 0", "- issues_open: 0", "- 审查文件: app/contract.py", "- 修复状态: 无需修复", ""].join("\n"));
    write(f.project, `${CONSTRUCTION("u0")}/audit.md`, "# 审计 — 单元 u0\n\n代码审查（REQ-001 契约声明）结论：passed。\n");
    ok(f.project, ["orchestrate", "report", "--stage", "code-review", ...UNIT("u0"), "--result", "completed"]);

    // ---- The old process commits u1's implementation after u0's tdd.
    write(f.app, "exporter.py", EXPORTER_RETRY);
    git(f.app, ["add", "-A"]);
    git(f.app, ["commit", "-qm", "a2 export with retry (old process, after u0 tdd)"], new Date(Date.now() + 60_000).toISOString());
    const appAdopted = git(f.app, ["rev-parse", "HEAD"]);

    // ---- --adopt: neither the u0 not_required evidence nor u0's tdd start blocks it.
    const dry = ok(f.project, ADOPT(f, appAdopted, ["--dry-run"])).json as Json;
    assert.equal(dry.checks.tdd_started_at, null, "u0's tdd start is not the module's first tdd start");
    assert.deepEqual(dry.checks.ignored_exemption_instances, [TDD("u0"), GREEN("u0"), BASE("u0"), RED("u0")]);
    const adopted = ok(f.project, ADOPT(f, appAdopted)).json;
    console.log(`    --adopt: ${String(adopted.message).slice(0, 160)}`);
    assert.equal(loadWorkflowState(f.project, moduleRef)!.adoption_baseline, f.workflowCommit);
    const audit = auditText(f.project);
    assert.match(audit, /- Event: BASELINE_ADOPTED[\s\S]*- TDD Started At: not started/);
    assert.match(audit, new RegExp(`- Ignored Exemption Instances: ${[TDD("u0"), GREEN("u0"), BASE("u0"), RED("u0")].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(", ")}`));

    // ---- u0's not_required evidence stays valid after adoption (it binds no baseline); the app/ commit is ordinary revision drift of a completed stage.
    assert.equal(gate(f.project, TDD("u0"), "red-test-evidence", [...MOD, "--drift"]), "", "u0 RED not_required passes its gate re-check");
    assert.equal(gate(f.project, TDD("u0"), "baseline-test-evidence", [...MOD, "--drift"]), "", "u0 BASELINE not_required passes its gate re-check");
    assert.equal(gate(f.project, CODEGEN("u0"), "green-test-evidence", [...MOD, "--drift"]), "", "u0 GREEN not_required passes its gate re-check");

    // ---- u1's BASELINE passes against the adoption baseline. The app/ commit drifted the
    // module scope of u0's completed tdd (independent of adoption): refresh it as next asks.
    ok(f.project, ["evidence", "run", ...TCD, "--refresh"]);
    ok(f.project, ["evidence", "run", "--stage", "tdd", ...UNIT("u0"), "--refresh"]);
    ok(f.project, ["evidence", "run", "--stage", "code-generation", ...UNIT("u0"), "--refresh"]);
    assert.equal(readJson(f.project, BASE("u0")).status, "not_required", "u0 BASELINE stays not_required after the refresh");
    const i13 = readJson(f.project, I13);
    const blob = git(f.app, ["rev-parse", `${appAdopted}:exporter.py`]);
    assert.equal(i13.baseline_kind, "adoption");
    assert.deepEqual(i13.characterization[0].code_refs, [{ path: "app/exporter.py", symbol: "export_orders", repo: "app", baseline_blob: blob }]);
    f.nextModule(TDD("u1"));

    ok(f.project, ["orchestrate", "report", "--stage", "tdd", ...UNIT("u1"), "--result", "completed"]);
    const baseline = readJson(f.project, BASE("u1"));
    assert.equal(baseline.status, "passed");
    assert.equal(baseline.baseline_kind, "adoption");
    assert.deepEqual(baseline.baseline_repos, { app: appAdopted });
    assert.equal(gate(f.project, TDD("u1"), "baseline-test-evidence", MOD), "", "u1 BASELINE passes against the adoption baseline");
    assert.equal(gate(f.project, TDD("u0"), "baseline-test-evidence", [...MOD, "--drift"]), "", "u0 BASELINE not_required still passes");

    // ---- Negative: once u1 holds BASELINE passed, adoption is refused again.
    const reset = loadWorkflowState(f.project, moduleRef)!;
    delete reset.adoption_baseline;
    delete reset.adoption_baseline_repos;
    delete reset.adoption_approval_ref;
    delete reset.adopted_at;
    saveWorkflowState(f.project, reset, moduleRef, { baselineWrite: true });
    const refused = rejected(run(f.project, ADOPT(f, appAdopted)));
    expectRejected("--adopt after u1 BASELINE passed", refused, /already holds RED \/ BASELINE \/ GREEN evidence \(\.aidlc\/evidence\/tdd\/m01-trade\/u1\/baseline-test-evidence\.json/);
    assert.doesNotMatch(refused, /u0\/(?:red|baseline)-test-evidence\.json/, "u0's not_required evidence is not listed as held");
    console.log("  ok adoption ignores ucd_exemption units: adopt after u0 tdd, u0 evidence re-check, u1 BASELINE on the adoption baseline, refused after u1 BASELINE");
  } catch (error) {
    failed.push("adoption exemption");
    console.log(`  FAIL adoption exemption\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log("PASS");
}

await main();
