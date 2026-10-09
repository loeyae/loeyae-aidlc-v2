/**
 * 4.10.0 (MARS-92) regression suite: adoption baseline (`orchestrate baseline --adopt`).
 *
 * A module whose implementation kept being committed after the workflow started (T0)
 * cannot register that implementation as the characterization baseline with --set (the
 * committer date is later than T0). --adopt registers a module-level adoption baseline
 * instead; I13 and BASELINE of that module resolve against it, every other module keeps
 * the global baseline chain.
 *
 * Fixture: workflow repository + nested repository app/ (split layout, modules m01-trade
 * and m02-billing). After T0 the nested repository commits app/order_export.py; the I13
 * of m01-trade declares one characterization UC-D whose code ref points at that file.
 * Everything is driven through the public CLI and the gate probe; evidence is only
 * produced by the controlled producer.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { workflowBaselineForModule } from "../core/tools/aidlc-baseline";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-4100-adopt-"));
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const M01 = "m01-trade";
const M02 = "m02-billing";
const IN = `docs/aidlc/modules/${M01}/inception`;
const CASES = `${IN}/application-design/test-cases`;
const I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
const BASE = `.aidlc/evidence/tdd/${M01}/u1/baseline-test-evidence.json`;
const GREEN = `.aidlc/evidence/code-generation/${M01}/u1/green-test-evidence.json`;
const TDD = `tdd@module:${M01}@unit:u1`;
const CODEGEN = `code-generation@module:${M01}@unit:u1`;
const CONSTRUCTION = `docs/aidlc/modules/${M01}/construction/u1`;
const MOD = ["--module", M01];
const UNIT = ["--module", M01, "--unit", "u1"];
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
/** Implementation written by the old process after the workflow had started (T0). */
const ORDER_EXPORT = "# REQ-001 order export with retry (implemented before AI-DLC took the module over)\ndef export_with_retry(client, attempts=3):\n    for attempt in range(attempts):\n        try:\n            return list(client.fetch_orders())\n        except TimeoutError:\n            if attempt == attempts - 1:\n                raise\n";
const OBSERVER = `const { existsSync, readFileSync } = require("node:fs");
const phase = process.env.AIDLC_PHASE || "GREEN";
const passed = existsSync("app/order_export.py") && readFileSync("app/order_export.py", "utf8").includes("def export_with_retry(client, attempts=3)");
const observation = { phase, status: passed ? "passed" : "failed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: passed ? 0 : 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-021", test_methods: ["tests/test_order_export.py::test_uc_d_021"] }] };
if (!passed) Object.assign(observation, { failure_class: "behavior", failure_signature: "export_with_retry changed" });
console.log(JSON.stringify(observation));
process.exit(passed ? 0 : 1);
`;
const UCD = `---\nid: UC-D-021\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\ncode_refs:\n  - app/order_export.py::export_with_retry\nreason: 接管前旧流程已实现导出重试，改动前锁定其现有行为\napproval_ref: REVIEW-2026-10-06-92\n---\n# UC-D-021 导出超时重试\n\nGiven 下游前两次超时，When 调用 export_with_retry，Then 第三次返回订单列表。\n`;

function allowlist(stage: string, role: string): string {
  return `${JSON.stringify({ version: "1", stage, commands: [{ id: `uc-${role}`, role, argv: ["node", "tests/observe_uc.cjs"] }] }, null, 2)}\n`;
}

interface Fixture {
  project: string;
  app: string;
  workflowCommit: string;
  appLegacy: string;
  appAdopted: string;
  globalWorkflowId: string;
  nextModule: (expected: string, refreshes?: string[][]) => void;
}

/**
 * Split layout with modules m01-trade and m02-billing; the global workflow is created
 * (T0) with app=a1, then app/ commits a2 (order_export.py) with a committer date after
 * T0. m01-trade is driven through its inception to the I13 stage.
 */
function fixture(name: string): Fixture {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n\nDocs and AI-DLC state; the code lives in the app/ repository.\n");
  write(project, ".gitignore", "app/\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }, { module_id: M02, name: "Billing", service_id: "billing-service" }] })}\n`);
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
  const appLegacy = git(app, ["rev-parse", "HEAD"]);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: [{ path: "app", repo: "nested" }] })}\n`);

  const step = (args: string[]) => ok(project, args);
  step(["orchestrate", "next", "--scope", "feature", "--work", `4.10.0 adoption ${name}`]);
  // T0 is now; the old process keeps committing the implementation into app/ afterwards.
  write(app, "order_export.py", ORDER_EXPORT);
  git(app, ["add", "-A"]);
  git(app, ["commit", "-qm", "a2 export with retry (old process, after T0)"], new Date(Date.now() + 60_000).toISOString());
  const appAdopted = git(app, ["rev-parse", "HEAD"]);

  const global = loadWorkflowState(project)!;
  const globalStages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  global.completed_stages = [...globalStages];
  global.completed_stage_instances = [...globalStages];
  global.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M02}`];
  saveWorkflowState(project, global);
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", `# 场景模块映射\n\nREQ-001 订单导出属于 ${M01}；账单属于 ${M02}。\n`);
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
  write(project, `${IN}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：单元 u1 改动嵌套仓库 app/；接管前的实现走 BASELINE→GREEN；不需要应用设计。\n\n| 阶段 | 决定 |\n| --- | --- |\n| application-design | skip |\n");
  report("workflow-planning");
  write(project, `${IN}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: [{ unit_id: "u1", name: "Unit u1", service_id: "trade-service", conditional_stages: [] }] }, null, 2)}\n`);
  const moduleRef = { kind: "module" as const, module_id: M01 };
  const moduleState = loadWorkflowState(project, moduleRef)!;
  moduleState.completed_stages.push("units-generation");
  moduleState.completed_stage_instances.push(`units-generation@module:${M01}`);
  saveWorkflowState(project, moduleState, moduleRef);
  write(project, `${CONSTRUCTION}/functional-design.md`, "# 功能设计 — u1\n\nREQ-001：u1 只补充追溯注释，不改变接管前实现的重试行为；无新增接口与数据结构。\n");
  nextModule(`test-case-derivation@module:${M01}`);
  write(project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-021 导出超时重试（source_ref: REQ-001）\n");
  write(project, `${CASES}/UC-D-021.md`, UCD);
  write(project, "tests/__init__.py", "\"\"\"Tests for the order export (REQ-001).\"\"\"\n");
  write(project, "tests/test_order_export.py", "# REQ-001 UC-D-021\n\n\ndef test_uc_d_021():\n    # UC-D-021\n    assert True\n");
  write(project, "tests/observe_uc.cjs", OBSERVER);
  write(project, ".aidlc/commands/tdd.json", allowlist("tdd", "baseline"));
  write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", "green"));
  return { project, app, workflowCommit, appLegacy, appAdopted, globalWorkflowId: global.workflow_id, nextModule };
}

const ADOPT = (f: Fixture, extra: string[] = []) => ["orchestrate", "baseline", "--adopt", f.workflowCommit, "--repo", `app=${f.appAdopted}`, "--module", M01, "--user-input", "Approve", "--reason", "接管前旧流程已提交的导出重试实现", ...extra];
const APPROVAL = ["--approval-ref", "REVIEW-2026-10-06-92 架构评审纪要"];
const stateText = (project: string, ref = ""): string => readFileSync(join(project, "aidlc", "active", ...(ref ? ["modules", ref] : []), "aidlc-state.md"), "utf8");
const auditText = (project: string, ref = ""): string => readFileSync(join(project, "aidlc", "active", ...(ref ? ["modules", ref] : []), "audit.md"), "utf8");
const baselineLines = (text: string): string => text.split(/\r?\n/).filter((line) => /^- (?:Adoption )?Baseline|^- Adopt/.test(line)).join("\n");

async function main(): Promise<void> {
  console.log("4.10.0 adoption baseline");
  try {
    const f = fixture("adopt");

    // ---- Before: --set cannot register the post-T0 implementation, I13 cannot characterize it.
    const setRefused = rejected(run(f.project, ["orchestrate", "baseline", "--set", f.workflowCommit, "--replace", "--expect", f.workflowCommit, "--repo", `app=${f.appAdopted}`, "--expect-repo", `app=${f.appLegacy}`, "--user-input", "Approve", "--reason", "登记接管前实现"]));
    expectRejected("--set of the post-T0 app/ commit", setRefused, /app\/: commit [0-9a-f]{40} committer date \S+ \(self-reported\) is later than the workflow start/);
    const i13Refused = rejected(run(f.project, ["orchestrate", "report", ...TCD, "--result", "completed"]));
    expectRejected("I13 before adoption", i13Refused, /app\/order_export\.py does not exist in the baseline [0-9a-f]{40} of the nested repository app\//);
    const globalBefore = baselineLines(stateText(f.project));

    // ---- Negative: --approval-ref missing / empty; --module missing; single flags.
    expectRejected("--adopt without --approval-ref", rejected(run(f.project, ADOPT(f))), /--approval-ref is required/);
    expectRejected("--adopt with an empty --approval-ref", rejected(run(f.project, ADOPT(f, ["--approval-ref", ""]))), /--approval-ref is required/);
    expectRejected("--adopt without --module", rejected(run(f.project, ["orchestrate", "baseline", "--adopt", f.workflowCommit, "--user-input", "Approve", ...APPROVAL, "--reason", "x"])), /--adopt requires --module <id>/);
    expectRejected("--adopt with --set", rejected(run(f.project, [...ADOPT(f, APPROVAL), "--set", f.workflowCommit])), /--adopt cannot be combined with --set/);

    // ---- Negative: the adopted commit is later than the first tdd start of the module.
    const moduleRef = { kind: "module" as const, module_id: M01 };
    const withTddStart = loadWorkflowState(f.project, moduleRef)!;
    const tddStartedAt = new Date(Date.now() + 1_000).toISOString();
    withTddStart.history.push({ stage: "tdd", instance_id: TDD, module_id: M01, unit_id: "u1", result: "rejected", timestamp: tddStartedAt, user_input: "fixture: tdd entered" });
    saveWorkflowState(f.project, withTddStart, moduleRef);
    expectRejected("--adopt later than the first tdd start", rejected(run(f.project, ADOPT(f, APPROVAL))), /app\/: commit [0-9a-f]{40} committer date \S+ \(self-reported\) is later than the first tdd start of the module/);
    const withoutTddStart = loadWorkflowState(f.project, moduleRef)!;
    withoutTddStart.history = withoutTddStart.history.filter((entry) => entry.stage !== "tdd");
    saveWorkflowState(f.project, withoutTddStart, moduleRef);

    // ---- Negative: the module already holds GREEN evidence.
    write(f.project, GREEN, "{}\n");
    expectRejected("--adopt with GREEN evidence of the module", rejected(run(f.project, ADOPT(f, APPROVAL))), /already holds RED \/ BASELINE \/ GREEN evidence \(\.aidlc\/evidence\/code-generation\/m01-trade\/u1\/green-test-evidence\.json\)/);
    rmSync(join(f.project, GREEN));
    assert.equal(loadWorkflowState(f.project, moduleRef)!.adoption_baseline, undefined, "refused adoptions write nothing");

    // ---- --adopt (dry run, then for real).
    const dry = ok(f.project, ADOPT(f, [...APPROVAL, "--dry-run"])).json;
    assert.equal(dry.dry_run, true);
    assert.equal(loadWorkflowState(f.project, moduleRef)!.adoption_baseline, undefined, "dry run writes nothing");
    const adopted = ok(f.project, ADOPT(f, APPROVAL)).json;
    console.log(`    --adopt: ${String(adopted.message).slice(0, 160)}`);
    const moduleText = stateText(f.project, M01);
    assert.match(moduleText, new RegExp(`^- Adoption Baseline: ${f.workflowCommit}\\n- Adoption Baseline Repos: app=${f.appAdopted}\\n- Adoption Approval Ref: REVIEW-2026-10-06-92 架构评审纪要\\n- Adopted At: \\S+$`, "m"));
    const audit = auditText(f.project, M01);
    assert.match(audit, /- Event: BASELINE_ADOPTED[\s\S]*- Approval Ref: REVIEW-2026-10-06-92 架构评审纪要[\s\S]*- Reason: 接管前旧流程已提交的导出重试实现/);
    assert.match(audit, /- Exempted Rules: committer date no later than the workflow start \(T0\); commit must not contain this workflow's state file/);
    assert.equal(baselineLines(stateText(f.project)), globalBefore, "the global baseline chain is unchanged");
    expectRejected("--adopt a second time with another commit", rejected(run(f.project, ["orchestrate", "baseline", "--adopt", f.workflowCommit, "--repo", `app=${f.appLegacy}`, "--module", M01, "--user-input", "Approve", ...APPROVAL, "--reason", "x"])), /already has the adoption baseline/);

    // ---- Resolution: m01 uses the adoption baseline, m02 keeps the global baseline.
    const m01 = ok(f.project, ["orchestrate", "baseline", "--module", M01]).json;
    assert.equal(m01.baseline_kind, "adoption");
    assert.equal(m01.baseline_commit, f.workflowCommit);
    const m02 = ok(f.project, ["orchestrate", "baseline", "--module", M02]).json;
    assert.equal(m02.baseline_kind, "workflow", "the module without adoption keeps the global baseline");
    const m02Baseline = workflowBaselineForModule(f.project, M02);
    assert.ok(m02Baseline.registered && m02Baseline.kind === "workflow");
    assert.deepEqual(m02Baseline.registered ? m02Baseline.repos : {}, { app: { start: 0, commits: [f.appLegacy] } }, "m02 resolves app/ at the global a1 commit");
    const m01Baseline = workflowBaselineForModule(f.project, M01);
    assert.deepEqual(m01Baseline.registered ? m01Baseline.repos : {}, { app: { start: 0, commits: [f.appAdopted] } }, "m01 resolves app/ at the adopted a2 commit");
    const shown = ok(f.project, ["orchestrate", "baseline"]).json;
    assert.deepEqual(shown.adoption_baselines, { [M01]: f.workflowCommit });

    // ---- I13 characterizes the adopted implementation.
    ok(f.project, ["orchestrate", "report", ...TCD, "--result", "completed"]);
    const i13 = readJson(f.project, I13);
    const blob = git(f.app, ["rev-parse", `${f.appAdopted}:order_export.py`]);
    assert.equal(i13.baseline_kind, "adoption");
    assert.equal(i13.baseline_commit, f.workflowCommit);
    assert.deepEqual(i13.baseline_repos, { app: f.appAdopted });
    assert.deepEqual(i13.characterization[0].code_refs, [{ path: "app/order_export.py", symbol: "export_with_retry", repo: "app", baseline_blob: blob }]);

    // ---- BASELINE: refused once the code ref changes, passes on the unmodified adopted code.
    f.nextModule(TDD, [TCD]);
    write(f.app, "order_export.py", `${ORDER_EXPORT}# local edit\n`);
    expectRejected("BASELINE after changing the code ref", rejected(run(f.project, ["evidence", "run", "--stage", "tdd", ...UNIT, "--sensor", "baseline-test-evidence"])), /BASELINE refuses to run: code ref app\/order_export\.py changed since the baseline [0-9a-f]{40} of the nested repository app\//);
    assert.equal(existsSync(join(f.project, BASE)), false, "the refused BASELINE writes no evidence");
    write(f.app, "order_export.py", ORDER_EXPORT);
    ok(f.project, ["orchestrate", "report", "--stage", "tdd", ...UNIT, "--result", "completed"]);
    const baseline = readJson(f.project, BASE);
    assert.equal(baseline.status, "passed");
    assert.equal(baseline.baseline_kind, "adoption");
    assert.deepEqual(baseline.baseline_repos, { app: f.appAdopted });
    assert.deepEqual(baseline.code_ref_digests, [{ path: "app/order_export.py", repo: "app", baseline_blob: blob, worktree_blob: blob }]);
    assert.equal(gate(f.project, TDD, "baseline-test-evidence", MOD), "", "BASELINE passes its gate re-check");

    // ---- Gate re-check selects the baseline by baseline_kind: a relabelled evidence is refused.
    const original = readFileSync(join(f.project, BASE), "utf8");
    const { baseline_kind: _kind, ...relabelled } = baseline;
    writeFileSync(join(f.project, BASE), `${JSON.stringify(relabelled, null, 2)}\n`, "utf8");
    expectRejected("BASELINE without baseline_kind against the adoption baseline", gate(f.project, TDD, "baseline-test-evidence", MOD), /BASELINE baseline_kind workflow does not match the adoption baseline/);
    writeFileSync(join(f.project, BASE), original, "utf8");

    // ---- code-generation (GREEN) then --advance --module on the adoption chain.
    f.nextModule(CODEGEN, [TCD]);
    write(f.app, "order_export.py", `${ORDER_EXPORT}# REQ-001 u1: traced (comment only)\n`);
    git(f.app, ["add", "-A"]);
    git(f.app, ["commit", "-qm", "a3 u1 annotate order export"], new Date(Date.now() + 120_000).toISOString());
    const appU1 = git(f.app, ["rev-parse", "HEAD"]);
    write(f.project, `${CONSTRUCTION}/plans/code-generation-plan.md`, "# 代码生成计划 — u1\n\n- REQ-001 / UC-D-021：在 app/order_export.py 中补充 REQ-001 追溯注释，接管前的重试行为由 BASELINE 锁定。\n");
    write(f.project, `${CONSTRUCTION}/implementation-summary.md`, "# 实现摘要 — u1\n\nREQ-001 / UC-D-021：app/order_export.py 仅追加注释行，行为不变；tests/test_order_export.py 覆盖 UC-D-021。\n");
    const generated = run(f.project, ["orchestrate", "report", "--stage", "code-generation", ...UNIT, "--result", "completed"]);
    assert.equal(rejected(generated), "", generated.out);
    assert.equal(readJson(f.project, GREEN).source_revision.repos.app.commit, appU1);
    const ADVANCE = ["orchestrate", "baseline", "--advance", f.workflowCommit, "--module", M01, "--expect", f.workflowCommit, "--repo", `app=${appU1}`, "--expect-repo", `app=${f.appAdopted}`, "--user-input", "Approve", "--reason", "u1 已在 app/ 提交"];
    const advanced = ok(f.project, ADVANCE).json;
    console.log(`    --advance --module: ${String(advanced.message).slice(0, 160)}`);
    const after = loadWorkflowState(f.project, moduleRef)!;
    assert.deepEqual(after.adoption_baseline_history, [f.workflowCommit, f.workflowCommit]);
    assert.deepEqual(after.adoption_baseline_repos, { app: appU1 });
    assert.deepEqual(after.adoption_baseline_repos_history, { app: { start: 0, commits: [f.appAdopted, appU1] } });
    assert.match(auditText(f.project, M01), /- Event: BASELINE_ADOPTION_ADVANCED[\s\S]*- Repos Moved: app=yes/);
    assert.equal(baselineLines(stateText(f.project)), globalBefore, "the global baseline chain is still unchanged");
    assert.equal(gate(f.project, TDD, "baseline-test-evidence", [...MOD, "--drift"]), "", "the epoch-0 BASELINE still passes its by-epoch re-check");
    expectRejected("--advance --module of a module without adoption", rejected(run(f.project, ["orchestrate", "baseline", "--advance", f.workflowCommit, "--module", M02, "--expect", f.workflowCommit, "--user-input", "Approve", "--reason", "x"])), /Module m02-billing has no adoption baseline[\s\S]*Drop --module/);
    console.log("  ok adoption baseline: --set refused, --adopt negatives, adopt, I13/BASELINE resolve per module, baseline_kind re-check, --advance --module");
  } catch (error) {
    failed.push("adoption baseline");
    console.log(`  FAIL adoption baseline\n${error instanceof Error ? error.stack || error.message : String(error)}`);
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
