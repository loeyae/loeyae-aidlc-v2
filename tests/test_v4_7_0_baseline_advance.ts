/**
 * 4.7.0 (MARS-71) regression suite: the workflow baseline chain (epochs) and
 * `orchestrate baseline --advance`.
 *
 * A multi-unit characterization workflow (split layout, one module, units u1 and u2,
 * every UC-D characterization, a code ref shared by both units) used to dead-end:
 * once u1's code-generation legitimately changed the shared code ref, u2's tdd
 * BASELINE could never observe "unmodified baseline code" again, and the baseline
 * could not be replaced because it was in use. `--advance` appends u1's completion
 * commit as a new epoch; every BASELINE evidence stays bound to the epoch it was
 * produced in.
 *
 * Every fixture is driven through the public CLI (`orchestrate`, `evidence run`) and
 * the gate probe; evidence is only ever produced by the controlled producer. Tampered
 * evidence is restored byte for byte. Set AIDLC_TRANSCRIPT=<file> to write the
 * normalized single-unit transcript used to compare against the 4.6.1 engine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, parseLightWorkflowState, renderLightWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-470-advance-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const M01 = "m01-trade";

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE"]) delete env[key];
  return env;
}

function parsed(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function run(project: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}`, json: parsed(stdout) };
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

/** Gate failures of one stage instance (optionally one sensor), joined; "" when the gate accepts. */
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

function sha256(project: string, path: string): string {
  return createHash("sha256").update(readFileSync(join(project, path))).digest("hex");
}

function git(project: string, args: string[], date = OLD_DATE): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC",
      GIT_AUTHOR_EMAIL: "aidlc@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC",
      GIT_COMMITTER_EMAIL: "aidlc@example.invalid",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

/** Collects fail-closed expectations so one run reports every case that was accepted. */
function rejections(): { expect: (label: string, output: string, pattern: RegExp) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    expect(label, output, pattern) {
      if (!pattern.test(output)) gaps.push(`${label}: expected rejection ${pattern}, got: ${output.trim() ? output.trim().slice(-900) : "ACCEPTED (no failures)"}`);
      else if (process.env.AIDLC_TEST_VERBOSE) console.log(`    rejected ${label}: ${output.trim().slice(-400)}`);
    },
    assertAll() {
      assert.equal(gaps.length, 0, `fail-closed cases not rejected:\n- ${gaps.join("\n- ")}`);
    },
  };
}

async function section(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    sections.push(name);
    console.log(`  ok ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

/** Run `body` against a tampered copy of a file and restore the original bytes afterwards. */
function withTampered<T>(project: string, path: string, mutate: (value: Json) => Json, body: () => T): T {
  const original = readFileSync(join(project, path));
  try {
    write(project, path, `${JSON.stringify(mutate(JSON.parse(original.toString("utf8")) as Json), null, 2)}\n`);
    return body();
  } finally {
    writeFileSync(join(project, path), original);
  }
}

function listEvidence(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listEvidence(path) : entry.name.endsWith(".json") ? [path] : [];
  });
}

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

/** Legacy order exporter committed before the workflow starts (epoch 0). */
const EXPORTER_BASELINE = "def export_orders(client):\n    return paginate(client.fetch_orders())\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const U1_ANNOTATION = "# REQ-001 u1: pagination traced to REQ-001 (comment only, behaviour unchanged)\n";
const U2_ANNOTATION = "# REQ-001 u2: export traced to REQ-001 (comment only, behaviour unchanged)\n";
const INIT_ANNOTATED = "\"\"\"Order export application package; export behaviour is REQ-001.\"\"\"\n";

interface Ucd {
  id: string;
  check: "pagination" | "export";
  title: string;
  given: string;
  codeRef: string;
}

/** Both UC-Ds characterize code in app/exporter.py: the code ref is shared by u1 and u2. */
const UCDS: Ucd[] = [
  { id: "UC-D-002", check: "pagination", title: "导出按 50 条分页", given: "Given 下游返回 120 条订单，When 调用 export_orders，Then 返回 3 页。", codeRef: "app/exporter.py::paginate" },
  { id: "UC-D-003", check: "export", title: "导出调用下游并分页", given: "Given 下游返回订单，When 调用 export_orders，Then 结果经 paginate 分页。", codeRef: "app/exporter.py::export_orders" },
];

function caseFile(ucd: Ucd): string {
  return `---\nid: ${ucd.id}\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\ncode_refs:\n  - ${ucd.codeRef}\nreason: 改动前锁定导出的现有行为\napproval_ref: REVIEW-2026-10-04-01\n---\n# ${ucd.id} ${ucd.title}\n\n${ucd.given}\n`;
}

function testMethod(ucd: Ucd): string {
  return `tests/test_exporter.py::test_${ucd.id.toLowerCase().replace(/-/g, "_")}`;
}

function pythonTests(): string {
  const body = UCDS.map((ucd) => {
    const name = testMethod(ucd).split("::")[1];
    if (ucd.check === "pagination") return `def ${name}():\n    # ${ucd.id}\n    assert [len(page) for page in paginate(list(range(120)))] == [50, 50, 20]\n`;
    return `def ${name}():\n    # ${ucd.id}\n    assert export_orders(StaticClient()) == [["order-1", "order-2"]]\n`;
  }).join("\n\n");
  return `# REQ-001 ${UCDS.map((ucd) => ucd.id).join(" ")}\nfrom app.exporter import export_orders, paginate\n\n\nclass StaticClient:\n    def fetch_orders(self):\n        return ["order-1", "order-2"]\n\n\n${body}`;
}

/** Deterministic observer of app/exporter.py: BASELINE and GREEN both run every (characterization) UC-D. */
function observer(): string {
  return `const { readFileSync } = require("node:fs");
const source = readFileSync("app/exporter.py", "utf8");
const checks = {
  pagination: () => /def paginate\\(rows, size=50\\)/.test(source),
  export: () => /def export_orders\\(client\\)/.test(source) && /paginate\\(/.test(source),
};
const ucds = ${JSON.stringify(UCDS.map((ucd) => ({ id: ucd.id, check: ucd.check, test: testMethod(ucd) })))};
const phase = process.env.AIDLC_PHASE || "GREEN";
const failing = ucds.filter((ucd) => !checks[ucd.check]());
const observation = { phase, status: failing.length ? "failed" : "passed", compile_status: "passed", environment_status: "passed", tests_total: ucds.length, tests_failed: failing.length, traceability_complete: true, uc_mapping: ucds.map((ucd) => ({ use_case: ucd.id, test_methods: [ucd.test] })) };
if (failing.length) Object.assign(observation, { failure_class: "behavior", failure_signature: failing.map((ucd) => ucd.id).join("; ") });
console.log(JSON.stringify(observation));
console.log(ucds.length - failing.length + " passed, " + failing.length + " failed");
process.exit(failing.length ? 1 : 0);
`;
}

function allowlist(stage: string, commands: Array<{ id: string; role: string; argv: string[] }>): string {
  return `${JSON.stringify({ version: "1", stage, commands }, null, 2)}\n`;
}

const OBSERVE = ["node", "tests/observe_uc.cjs"];
let counter = 0;

/** Git project with the legacy exporter under `app/` (no `src/`), committed on two old dates. */
function legacyRepository(name: string): { project: string; commits: string[] } {
  const project = join(scratch, `p${++counter}-${name}`);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n\nPython order export service.\n");
  write(project, "app/__init__.py", "\"\"\"Order export application package.\"\"\"\n");
  write(project, "app/exporter.py", EXPORTER_BASELINE);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "c1 legacy exporter"], "2024-01-01T00:00:00Z");
  const commits = [git(project, ["rev-parse", "HEAD"])];
  write(project, "README.md", "# Orders service\n\nPython order export service.\n");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "c2 readme"], "2024-01-02T00:00:00Z");
  commits.push(git(project, ["rev-parse", "HEAD"]));
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
  return { project, commits };
}

function codeReview(unit: string): string {
  return [
    `# 代码审查 — 单元 ${unit}`,
    "",
    "- 审查模式: 集成双轴审查",
    "- reviewer: aidlc-quality-agent",
    "- execution_context: isolated",
    "- review_only: true",
    `- Spec 结果: passed（REQ-001 / ${UCDS.map((ucd) => ucd.id).join(" / ")}）`,
    "- Standards 结果: passed",
    "- issues_found: 0",
    "- issues_resolved: 0",
    "- issues_open: 0",
    "- 审查文件: app/exporter.py, app/__init__.py, tests/test_exporter.py",
    "- 修复状态: 无需修复",
    "",
  ].join("\n");
}

function writeBuildAndTest(project: string, ids: string): void {
  write(project, "tests/build_check.cjs", "const { readFileSync } = require('node:fs');\nreadFileSync('app/exporter.py', 'utf8');\nconsole.log('build ok');\n");
  write(project, "tests/run_tests.cjs", "const { spawnSync } = require('node:child_process');\nconst result = spawnSync(process.execPath, ['tests/observe_uc.cjs'], { encoding: 'utf8', env: { ...process.env, AIDLC_PHASE: 'GREEN' } });\nprocess.stdout.write(result.stdout.split(/\\r?\\n/).filter((line) => !line.startsWith('{')).join('\\n'));\nprocess.exit(result.status ?? 1);\n");
  write(project, "tests/lint_check.cjs", "const { readFileSync } = require('node:fs');\nif (/\\t/.test(readFileSync('app/exporter.py', 'utf8'))) process.exit(1);\nconsole.log('lint ok');\n");
  write(project, ".aidlc/commands/build-and-test.json", allowlist("build-and-test", [
    { id: "build", role: "build", argv: ["node", "tests/build_check.cjs"] },
    { id: "unit-tests", role: "test", argv: ["node", "tests/run_tests.cjs"] },
    { id: "lint", role: "check", argv: ["node", "tests/lint_check.cjs"] },
  ]));
  write(project, "docs/aidlc/construction/build-test-report.md", `# 构建与测试报告\n\nREQ-001 / ${ids}：构建、单元测试与 lint 均通过（0 failed）。\n`);
  write(project, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# 构建与测试摘要\n\nREQ-001 的实现通过构建、测试和静态检查；存量行为由各单元按基线分代产出的 BASELINE 证据锁定。\n");
}

function writeImplementationReport(project: string, stages: number, ids: string): void {
  const evidenceRefs = listEvidence(join(project, ".aidlc", "evidence"))
    .map((file) => file.slice(project.length + 1).replace(/\\/g, "/"))
    .filter((file) => !file.startsWith(".aidlc/evidence/implementation-report/"))
    .sort();
  write(project, "docs/aidlc/construction/implementation-report.md", [
    "# 实施报告",
    "",
    "- scope: feature",
    `- stages_completed: ${stages}`,
    "- all_gates_passed: true",
    "",
    `REQ-001 / ${ids} 已完成：u1、u2 依次 BASELINE→GREEN，u1 完成后基线推进到第 1 代。`,
    "",
    "## 证据",
    "",
    ...evidenceRefs.map((file) => `- ${file}`),
    "",
  ].join("\n"));
}

const ADVANCE = (target: string, expect: string, extra: string[] = []) => ["orchestrate", "baseline", "--advance", target, "--expect", expect, "--user-input", "Approve", "--reason", "u1 已完成并提交，基线推进到 u1 的完成点", ...extra];
const auditText = (project: string): string => readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8");

/**
 * (A) end to end. `globalDone` (4.7.1, MARS-72) splits while the current stage already
 * belongs to the module, so the split leaves the global workflow legitimately `done`
 * (as in a real consumer repository) and every baseline write must still succeed.
 */
async function endToEnd(globalDone: boolean): Promise<void> {
    const checks = rejections();
    const { project, commits } = legacyRepository(globalDone ? "advance-global-done" : "advance");
    write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] })}\n`);
    git(project, ["add", "docs/aidlc/ideation/module-manifest.json"]);
    git(project, ["commit", "-qm", "c3 module manifest"], "2024-01-03T00:00:00Z");
    const epoch0 = git(project, ["rev-parse", "HEAD"]);
    ok(project, ["orchestrate", "next", "--scope", "feature", "--work", "4.7.0 baseline advance u1/u2"]);
    const global = loadWorkflowState(project)!;
    assert.equal(global.baseline_commit, epoch0, "next --scope records HEAD as epoch 0");
    // Product-level stages are recorded as completed exactly like the existing split
    // fixtures (test_v4_6_0_downstream (d), test_split_next_routing).
    const globalStages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
    global.completed_stages = [...globalStages];
    global.completed_stage_instances = [...globalStages];
    global.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
    if (globalDone) {
      // The current stage already belongs to the module: split resolves every global-owned
      // instance and leaves the global workflow done (summarizeOwned).
      global.current_stage = "requirements-analysis";
      global.current_stage_instance = `requirements-analysis@module:${M01}`;
      global.current_module = M01;
    }
    saveWorkflowState(project, global);
    write(project, "docs/aidlc/ideation/scenario-module-mapping.md", `# 场景模块映射\n\nREQ-001 订单导出分页属于 ${M01}。\n`);
    ok(project, ["orchestrate", "split", "--from", global.workflow_id]);
    const moduleRef = { kind: "module" as const, module_id: M01 };
    if (globalDone) {
      assert.equal(loadWorkflowState(project)!.status, "done", "split leaves the global workflow done");
      assert.equal(loadWorkflowState(project, moduleRef)!.status, "running", "the module workflow runs");
      // --set / --replace on the done global workflow of a split layout: an unused baseline can still be corrected.
      const corrected = ok(project, ["orchestrate", "baseline", "--set", commits[1], "--replace", "--expect", epoch0, "--user-input", "Approve", "--reason", "更正基线（dry run）", "--dry-run"]).json;
      assert.equal(corrected.dry_run, true, JSON.stringify(corrected));
    }

    const moduleArgs = ["--module", M01];
    const unitArgs = (unit: string) => ["--module", M01, "--unit", unit];
    const nextModule = (expected: string, refreshes: string[][] = []) => {
      for (const args of refreshes) ok(project, ["evidence", "run", ...args, "--refresh"]);
      const directive = ok(project, ["orchestrate", "next", ...moduleArgs]).json;
      assert.equal(directive.stage_instance, expected, JSON.stringify(directive, null, 2));
    };
    const report = (stage: string, extra: string[] = []) => ok(project, ["orchestrate", "report", "--stage", stage, ...moduleArgs, "--result", "completed", ...extra]);
    const reportUnit = (stage: string, unit: string) => run(project, ["orchestrate", "report", "--stage", stage, ...unitArgs(unit), "--result", "completed"]);
    const ack = (stage: string) => report(stage, ["--instruction-ack", stage]);
    const RA = ["--stage", "requirements-analysis", ...moduleArgs];
    const TCD = ["--stage", "test-case-derivation", ...moduleArgs];
    const inception = `docs/aidlc/modules/${M01}/inception`;

    nextModule(`requirements-analysis@module:${M01}`);
    write(project, `${inception}/requirements.md`, "# 需求\n\n## REQ-001 订单导出分页\n\ntrack: [backend]\n\n业务规则：订单导出接口按 50 条分页返回，现有分页与导出行为在两个单元的改动中保持不变。\n");
    report("requirements-analysis");
    nextModule(`requirement-clarification@module:${M01}`);
    write(project, `${inception}/clarifications.md`, "# 需求澄清\n\nNo clarifications needed.\n\nREQ-001 的分页规则（50 条一页）已在需求中明确，本次改动沿用现有行为。\n");
    report("requirement-clarification");
    nextModule(`requirements-data-model@module:${M01}`, [RA]);
    ack("requirements-data-model");
    nextModule(`requirements-methods@module:${M01}`, [RA]);
    write(project, `${inception}/requirements/business-flows.md`, "# 业务流程\n\n## REQ-001 订单导出分页流程\n\n```mermaid\nflowchart LR\n  A[调用 export_orders] --> B[读取下游订单]\n  B --> C[按 50 条分页返回]\n```\n");
    report("requirements-methods");
    nextModule(`requirements-prioritization@module:${M01}`, [RA]);
    ack("requirements-prioritization");
    nextModule(`requirements-validation@module:${M01}`, [RA]);
    ack("requirements-validation");
    nextModule(`user-stories@module:${M01}`, [RA]);
    write(project, `${inception}/user-stories.md`, "# 用户故事\n\n## STORY-001 / US-001 运营导出分页订单\n\n- 关联需求：REQ-001\n- 作为运营人员，我希望导出订单时按 50 条分页返回，以便逐页核对。\n- 验收标准：下游返回 120 条订单时，导出结果为 50、50、20 三页。\n");
    report("user-stories");
    nextModule(`cross-validation@module:${M01}`, [RA]);
    write(project, `${inception}/cross-validation-report.md`, "# 交叉验证报告\n\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: not-selected\n\n| 需求 | 故事 | 结论 |\n| --- | --- | --- |\n| REQ-001 | STORY-001 / US-001 | 一致：分页 50 条的需求由故事验收标准覆盖 |\n");
    report("cross-validation");
    nextModule(`workflow-planning@module:${M01}`, [RA, ["--stage", "user-stories", ...moduleArgs]]);
    write(project, `${inception}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：现有分页与导出行为以 characterization UC-D 锁定（BASELINE），u1、u2 两个单元依次改动 app/exporter.py，各自经 GREEN 复验；不需要应用设计。\n");
    report("workflow-planning");

    // Two units u1 / u2. units-generation is recorded as completed in the module
    // workflow (as the product-level stages above); the unit manifest is real content.
    write(project, `${inception}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: [
      { unit_id: "u1", name: "Pagination annotations", service_id: "trade-service", conditional_stages: [] },
      { unit_id: "u2", name: "Export annotations", service_id: "trade-service", conditional_stages: [] },
    ] }, null, 2)}\n`);
    const moduleState = loadWorkflowState(project, moduleRef)!;
    moduleState.completed_stages.push("units-generation");
    moduleState.completed_stage_instances.push(`units-generation@module:${M01}`);
    saveWorkflowState(project, moduleState, moduleRef);
    // doc-cascade of code-generation reads stage-level skips: functional-design only counts
    // as skipped once every unit skipped it, so each unit carries a real design note.
    for (const unit of ["u1", "u2"]) {
      write(project, `docs/aidlc/modules/${M01}/construction/${unit}/functional-design.md`, `# 功能设计 — ${unit}\n\nREQ-001：${unit} 只为 app/exporter.py 补充 REQ-001 追溯注释，不改变 paginate / export_orders 的行为；无新增接口与数据结构。\n`);
    }

    // I13 (module level): both characterization UC-Ds bind app/exporter.py to epoch 0.
    nextModule(`test-case-derivation@module:${M01}`);
    const caseRoot = `${inception}/application-design/test-cases`;
    write(project, `${caseRoot}/_index.md`, `# UC-D 索引\n\n${UCDS.map((ucd) => `- ${ucd.id} ${ucd.title}（source_ref: REQ-001）`).join("\n")}\n`);
    for (const ucd of UCDS) write(project, `${caseRoot}/${ucd.id}.md`, caseFile(ucd));
    report("test-case-derivation");
    const I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
    const i13 = readJson(project, I13);
    assert.deepEqual(i13.ucd_modes, { "UC-D-002": "characterization", "UC-D-003": "characterization" });
    assert.equal(i13.baseline_commit, epoch0, "module I13 binds epoch 0");

    // ---- u1: BASELINE at epoch 0, annotate the shared code ref, commit, GREEN.
    const BASE = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/baseline-test-evidence.json`;
    const GREEN = (unit: string) => `.aidlc/evidence/code-generation/${M01}/${unit}/green-test-evidence.json`;
    nextModule(`tdd@module:${M01}@unit:u1`);
    write(project, "tests/__init__.py", "\"\"\"Tests for the order export service (REQ-001).\"\"\"\n");
    write(project, "tests/test_exporter.py", pythonTests());
    write(project, "tests/observe_uc.cjs", observer());
    write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
    write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
    assert.equal(reportUnit("tdd", "u1").json.kind !== "error", true);
    const u1Baseline = readJson(project, BASE("u1"));
    assert.equal(u1Baseline.status, "passed");
    assert.equal(u1Baseline.baseline_commit, epoch0, "u1 BASELINE binds epoch 0");
    const u1BaselineSha = sha256(project, BASE("u1"));

    nextModule(`code-generation@module:${M01}@unit:u1`, [TCD]);
    write(project, "app/exporter.py", `${EXPORTER_BASELINE}${U1_ANNOTATION}`);
    write(project, "app/__init__.py", INIT_ANNOTATED);
    const construction = (unit: string) => `docs/aidlc/modules/${M01}/construction/${unit}`;
    const ids = UCDS.map((ucd) => ucd.id).join(" / ");
    for (const unit of ["u1"]) {
      write(project, `${construction(unit)}/plans/code-generation-plan.md`, `# 代码生成计划 — ${unit}\n\n- REQ-001 / ${ids}：为 app/exporter.py 补充 REQ-001 注释，存量行为由 BASELINE 锁定。\n`);
      write(project, `${construction(unit)}/implementation-summary.md`, `# 实现摘要 — ${unit}\n\nREQ-001 / ${ids}：app/exporter.py 仅追加注释行，行为不变；tests/test_exporter.py 覆盖全部 UC-D。\n`);
    }
    git(project, ["add", "app", "tests", "docs"]);
    git(project, ["commit", "-qm", "u1 annotate exporter"], "2024-01-04T00:00:00Z");
    const u1Commit = git(project, ["rev-parse", "HEAD"]);
    const u1Report = reportUnit("code-generation", "u1");
    assert.notEqual(u1Report.json.kind, "error", u1Report.out);
    const u1Green = readJson(project, GREEN("u1"));
    assert.equal(u1Green.status, "passed");
    assert.equal(u1Green.source_revision.commit, u1Commit, "u1 GREEN anchors the u1 commit");

    nextModule(`code-review@module:${M01}@unit:u1`);
    write(project, `${construction("u1")}/code-review.md`, codeReview("u1"));
    write(project, `${construction("u1")}/audit.md`, `# 审计 — 单元 u1\n\n代码审查（REQ-001 / ${ids}）结论：passed。\n`);
    assert.notEqual(reportUnit("code-review", "u1").json.kind, "error");
    git(project, ["add", "docs"]);
    git(project, ["commit", "-qm", "u1 review"], "2024-01-05T00:00:00Z");
    const reviewCommit = git(project, ["rev-parse", "HEAD"]);

    // ---- RED: u2's BASELINE cannot observe the shared code ref changed by u1.
    nextModule(`tdd@module:${M01}@unit:u2`, [TCD]);
    const redOutput = rejected(reportUnit("tdd", "u2"));
    console.log(`    RED (u2 tdd before --advance): ${(/BASELINE refuses to run[^\n"]*/.exec(redOutput) || [redOutput.trim().slice(-400)])[0]}`);
    assert.match(redOutput, /BASELINE refuses to run: code ref app\/exporter\.py changed since the workflow baseline/, "u2 BASELINE is refused before --advance");
    assert.equal(existsSync(join(project, BASE("u2"))), false, "the refused BASELINE writes no evidence");

    // ---- --advance fail-closed cases (nothing may be written).
    const revisionBefore = loadWorkflowState(project)!.revision;
    const after = git(project, ["commit-tree", `${reviewCommit}^{tree}`, "-p", reviewCommit, "-m", "after HEAD"]);
    checks.expect("--advance to the current epoch", rejected(run(project, ADVANCE(epoch0, epoch0))), /is the current baseline epoch; --advance needs a strict descendant/);
    checks.expect("--advance to a non-descendant", rejected(run(project, ADVANCE(commits[0], epoch0))), /is not a descendant of the current baseline epoch/);
    checks.expect("--advance past HEAD", rejected(run(project, ADVANCE(after, epoch0))), /is not the current HEAD or one of its ancestors/);
    checks.expect("--advance to a commit that anchors no completed GREEN", rejected(run(project, ADVANCE(reviewCommit, epoch0))), /is not the source_revision\.commit of the controlled GREEN evidence of any completed code-generation instance/);
    checks.expect("--user-input not Approve", rejected(run(project, ["orchestrate", "baseline", "--advance", u1Commit, "--expect", epoch0, "--user-input", "Reject", "--reason", "x"])), /--user-input must be exactly Approve/);
    checks.expect("--reason missing", rejected(run(project, ["orchestrate", "baseline", "--advance", u1Commit, "--expect", epoch0, "--user-input", "Approve"])), /--reason is required/);
    checks.expect("--expect missing", rejected(run(project, ["orchestrate", "baseline", "--advance", u1Commit, "--user-input", "Approve", "--reason", "x"])), /--advance requires --expect/);
    checks.expect("--expect not the current baseline", rejected(run(project, ADVANCE(u1Commit, commits[1]))), /does not match the current workflow baseline/);
    checks.expect("--advance with --set", rejected(run(project, [...ADVANCE(u1Commit, epoch0), "--set", u1Commit])), /--advance cannot be combined with --set or --replace/);
    checks.expect("--advance with --replace", rejected(run(project, [...ADVANCE(u1Commit, epoch0), "--replace"])), /--advance cannot be combined with --set or --replace/);
    checks.expect("--advance with an abbreviated commit", rejected(run(project, ADVANCE(u1Commit.slice(0, 12), epoch0))), /--advance must be a full 40- or 64-character lowercase hex commit id/);
    checks.expect("--advance with --module", rejected(run(project, [...ADVANCE(u1Commit, epoch0), "--module", M01])), /Drop --module/);
    checks.expect("--advance with a positional argument", rejected(run(project, [...ADVANCE(u1Commit, epoch0), "extra"])), /Unexpected baseline argument/);
    const dry = ok(project, ADVANCE(u1Commit, epoch0, ["--dry-run"])).json;
    assert.equal(dry.dry_run, true);
    assert.equal(loadWorkflowState(project)!.revision, revisionBefore, "rejected and dry-run --advance write no state");
    assert.equal(/BASELINE_COMMIT_ADVANCED/.test(auditText(project)), false, "no advance audited yet");

    // ---- --advance to u1's completion point.
    const advanced = ok(project, ADVANCE(u1Commit, epoch0)).json;
    console.log(`    --advance: ${String(advanced.message)}`);
    const advancedState = loadWorkflowState(project)!;
    if (globalDone) assert.equal(advancedState.status, "done", "--advance keeps the global workflow done");
    assert.equal(advancedState.baseline_source, "advanced");
    assert.equal(advancedState.baseline_commit, u1Commit);
    assert.deepEqual(advancedState.baseline_history, [epoch0, u1Commit], "baseline chain has two epochs");
    assert.match(readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8"), new RegExp(`^- Baseline History: ${epoch0}, ${u1Commit}$`, "m"));
    assert.doesNotMatch(readFileSync(join(project, "aidlc", "active", "modules", M01, "aidlc-state.md"), "utf8"), /Baseline/, "the module workflow carries no chain");
    const audit = auditText(project);
    assert.match(audit, /- Event: BASELINE_COMMIT_ADVANCED[\s\S]*- From: [0-9a-f]{40}[\s\S]*- To: [0-9a-f]{40}[\s\S]*- Epoch: 1[\s\S]*- Anchor: \.aidlc\/evidence\/code-generation\/m01-trade\/u1\/green-test-evidence\.json @ [0-9a-f]{40}[\s\S]*- Reason: [\s\S]*- User Input: Approve/);
    assert.equal(advancedState.history.filter((entry) => entry.stage === "baseline" && entry.result === "advanced").length, 1);
    const shown = ok(project, ["orchestrate", "baseline"]).json;
    assert.equal(shown.baseline_epoch, 1);
    assert.deepEqual(shown.baseline_history, [epoch0, u1Commit]);
    assert.match(String(shown.message), /epoch 1\)\. Baseline chain: #0 [0-9a-f]{40} → #1 [0-9a-f]{40}/);
    assert.equal(sha256(project, BASE("u1")), u1BaselineSha, "u1 BASELINE evidence is byte-identical after --advance");
    checks.expect("--replace on an advanced workflow", rejected(run(project, ["orchestrate", "baseline", "--set", commits[1], "--replace", "--expect", u1Commit, "--user-input", "Approve", "--reason", "x"])), /advanced baseline chain is append-only and cannot be replaced/);

    // u1's BASELINE (epoch 0) still passes its by-epoch re-check; it is not the current epoch.
    assert.equal(gate(project, `tdd@module:${M01}@unit:u1`, "baseline-test-evidence", ["--module", M01, "--drift"]), "", "u1 BASELINE re-check passes after --advance");
    checks.expect("u1 BASELINE as a current-epoch BASELINE", gate(project, `tdd@module:${M01}@unit:u1`, "baseline-test-evidence", ["--module", M01, "--drift", "--current-epoch"]), /is epoch 0 of the baseline chain, but the current epoch is .* a unit's BASELINE and GREEN must complete within one epoch/);
    // u1 code-generation re-attests (it re-checks u1's tdd evidence with drift tolerated).
    ok(project, ["evidence", "run", "--stage", "code-generation", ...unitArgs("u1"), "--all-sensors", "--refresh"]);
    const reattest = ok(project, ["orchestrate", "report", "--stage", "code-generation", ...unitArgs("u1"), "--result", "completed"]).json;
    assert.equal(reattest.reattested, true, JSON.stringify(reattest));

    // ---- u2 at epoch 1: a code ref changed by u2 itself is still refused.
    const committed = readFileSync(join(project, "app", "exporter.py"), "utf8");
    write(project, "app/exporter.py", `${committed}${U2_ANNOTATION}`);
    checks.expect("u2 BASELINE after u2 changed the code ref", rejected(run(project, ["evidence", "run", "--stage", "tdd", ...unitArgs("u2"), "--sensor", "baseline-test-evidence"])), new RegExp(`BASELINE refuses to run: code ref app/exporter\\.py changed since the workflow baseline ${u1Commit}`));
    write(project, "app/exporter.py", committed);
    ok(project, ["evidence", "run", "--stage", "tdd", ...unitArgs("u2"), "--sensor", "baseline-test-evidence"]);
    const u2Baseline = readJson(project, BASE("u2"));
    assert.equal(u2Baseline.status, "passed");
    assert.equal(u2Baseline.baseline_commit, u1Commit, "u2 BASELINE binds epoch 1");
    const epoch1Blob = git(project, ["rev-parse", `${u1Commit}:app/exporter.py`]);
    assert.deepEqual(u2Baseline.code_ref_digests, [{ path: "app/exporter.py", baseline_blob: epoch1Blob, worktree_blob: epoch1Blob }]);
    const u2Tdd = `tdd@module:${M01}@unit:u2`;
    assert.equal(gate(project, u2Tdd, "baseline-test-evidence", ["--module", M01, "--current-epoch"]), "", "u2 BASELINE passes as a current-epoch BASELINE");
    const otherBlob = git(project, ["rev-parse", `${commits[0]}:README.md`]);
    checks.expect("BASELINE baseline_commit outside the chain", withTampered(project, BASE("u2"), (value) => ({ ...value, baseline_commit: commits[0] }), () => gate(project, u2Tdd, "baseline-test-evidence", ["--module", M01])), /BASELINE baseline_commit .* does not match the workflow baseline .* or any earlier epoch of the baseline chain/);
    checks.expect("BASELINE relabelled to epoch 0 with epoch-1 blobs", withTampered(project, BASE("u2"), (value) => ({ ...value, baseline_commit: epoch0 }), () => gate(project, u2Tdd, "baseline-test-evidence", ["--module", M01])), /code_ref_digests app\/exporter\.py baseline_blob .* does not match .* at the workflow baseline/);
    checks.expect("BASELINE baseline_blob forged consistently", withTampered(project, BASE("u2"), (value) => ({ ...value, code_ref_digests: [{ path: "app/exporter.py", baseline_blob: otherBlob, worktree_blob: otherBlob }] }), () => gate(project, u2Tdd, "baseline-test-evidence", ["--module", M01])), /code_ref_digests app\/exporter\.py baseline_blob .* does not match .* at the workflow baseline/);
    checks.expect("BASELINE worktree_blob differs", withTampered(project, BASE("u2"), (value) => ({ ...value, code_ref_digests: [{ path: "app/exporter.py", baseline_blob: epoch1Blob, worktree_blob: otherBlob }] }), () => gate(project, u2Tdd, "baseline-test-evidence", ["--module", M01])), /worktree_blob .* must equal baseline_blob/);
    // A unit between BASELINE and GREEN blocks --advance.
    checks.expect("--advance while u2 holds BASELINE evidence", rejected(run(project, ADVANCE(reviewCommit, u1Commit))), /sits between its BASELINE and GREEN[\s\S]*tdd@module:m01-trade@unit:u2 already holds BASELINE evidence/);
    assert.notEqual(reportUnit("tdd", "u2").json.kind, "error");

    // ---- u2 GREEN at epoch 1.
    nextModule(`code-generation@module:${M01}@unit:u2`, [TCD]);
    checks.expect("--advance while u2 code-generation is active", rejected(run(project, ADVANCE(reviewCommit, u1Commit))), /code-generation@module:m01-trade@unit:u2 is active in the module:m01-trade workflow/);
    write(project, "app/exporter.py", `${committed}${U2_ANNOTATION}`);
    write(project, `${construction("u2")}/plans/code-generation-plan.md`, `# 代码生成计划 — u2\n\n- REQ-001 / ${ids}：为 app/exporter.py 的导出补充 REQ-001 注释，存量行为由第 1 代 BASELINE 锁定。\n`);
    write(project, `${construction("u2")}/implementation-summary.md`, `# 实现摘要 — u2\n\nREQ-001 / ${ids}：app/exporter.py 再追加一行注释，行为不变；tests/test_exporter.py 覆盖全部 UC-D。\n`);
    const u2Report = reportUnit("code-generation", "u2");
    assert.notEqual(u2Report.json.kind, "error", u2Report.out);
    assert.equal(readJson(project, GREEN("u2")).status, "passed");
    nextModule(`code-review@module:${M01}@unit:u2`);
    write(project, `${construction("u2")}/code-review.md`, codeReview("u2"));
    write(project, `${construction("u2")}/audit.md`, `# 审计 — 单元 u2\n\n代码审查（REQ-001 / ${ids}）结论：passed。\n`);
    assert.notEqual(reportUnit("code-review", "u2").json.kind, "error");
    assert.equal(ok(project, ["orchestrate", "next", ...moduleArgs]).json.kind, "done", "module workflow resolved");

    // ---- Integration: u1 and u2 code-generation / code-review are re-verified upstream.
    for (const unit of ["u1", "u2"]) {
      ok(project, ["evidence", "run", "--stage", "code-generation", ...unitArgs(unit), "--all-sensors", "--refresh"]);
      ok(project, ["evidence", "run", "--stage", "code-review", ...unitArgs(unit), "--all-sensors", "--refresh"]);
    }
    for (const unit of ["u1", "u2"]) {
      for (const stage of ["code-generation", "code-review"]) {
        const value = ok(project, ["orchestrate", "report", "--stage", stage, ...unitArgs(unit), "--result", "completed"]).json;
        assert.equal(value.reattested, true, `${stage} ${unit} re-attests after --advance: ${JSON.stringify(value)}`);
      }
    }
    const directive = ok(project, ["orchestrate", "next"]).json;
    assert.equal(directive.stage_instance, "build-and-test", JSON.stringify(directive, null, 2));
    writeBuildAndTest(project, ids);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test"]);
    ok(project, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
    assert.equal(ok(project, ["orchestrate", "next"]).json.stage_instance, "build-and-test-templates");
    write(project, "docs/aidlc/construction/build-and-test/build-instructions.md", "# 构建说明\n\nREQ-001：执行 node tests/build_check.cjs 校验 app/exporter.py 可读取，作为 Python 源码的构建检查。\n");
    write(project, "docs/aidlc/construction/build-and-test/unit-test-instructions.md", `# 单元测试说明\n\nREQ-001：执行 node tests/run_tests.cjs 运行 ${ids} 的 GREEN 观察，期望 0 failed。\n`);
    ok(project, ["orchestrate", "report", "--stage", "build-and-test-templates", "--result", "completed"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--all-sensors", "--refresh"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--sensor", "test-quality", "--refresh"]);
    assert.equal(ok(project, ["orchestrate", "next"]).json.stage_instance, "implementation-report");
    const completed = [undefined, moduleRef, { kind: "integration" as const }].reduce((total, ref) => total + loadWorkflowState(project, ref)!.completed_stage_instances.length, 0) + 1;
    writeImplementationReport(project, completed, ids);
    ok(project, ["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
    assert.equal(ok(project, ["orchestrate", "next"]).json.kind, "done");
    for (const path of listEvidence(join(project, ".aidlc", "evidence"))) {
      const evidence = JSON.parse(readFileSync(path, "utf8"));
      assert.equal(evidence.producer?.mode, "controlled", path);
    }
    assert.equal(sha256(project, BASE("u1")), u1BaselineSha, "u1 BASELINE evidence is byte-identical at the end of the workflow");
    assert.deepEqual(loadWorkflowState(project)!.baseline_history, [epoch0, u1Commit], "the chain is unchanged by ordinary saves");
    console.log(`    u1 BASELINE sha256 before/after --advance: ${u1BaselineSha}`);
    if (globalDone) {
      // Every sub-workflow resolved: the done global workflow no longer takes baseline writes.
      for (const ref of [undefined, moduleRef, { kind: "integration" as const }]) assert.equal(loadWorkflowState(project, ref)!.status, "done");
      const u2Green = readJson(project, GREEN("u2")).source_revision.commit as string;
      checks.expect("--advance once every sub-workflow is done", rejected(run(project, ADVANCE(u2Green, u1Commit, ["--dry-run"]))), /is done; baseline --advance requires a running or parked workflow: it is the global workflow of a split layout, but no module or integration sub-workflow is running or parked/);
    }
    checks.assertAll();
}

try {
  await section("e2e: split layout, one module with u1/u2, shared characterization code ref — u2 BASELINE RED, --advance, u2 GREEN, u1 evidence unchanged", () => endToEnd(false));
  await section("e2e (4.7.1): split leaves the global workflow done — --advance still succeeds, u2 BASELINE controlled, u1 evidence unchanged; refused once every sub-workflow is done", () => endToEnd(true));

  // ---------------------------------------------------------------- (A2) done single workflow
  await section("4.7.1: a done non-split workflow still refuses --advance and --set", () => {
    const checks = rejections();
    const { project, commits } = legacyRepository("single-done");
    ok(project, ["orchestrate", "next", "--scope", "feature", "--work", "4.7.1 single done"]);
    const state = loadWorkflowState(project)!;
    const current = state.baseline_commit!;
    state.status = "done";
    saveWorkflowState(project, state);
    checks.expect("--advance on a done single workflow", rejected(run(project, ADVANCE(commits[1], current, ["--dry-run"]))), /^[\s\S]*is done; baseline --advance requires a running or parked workflow\./);
    checks.expect("--set --replace on a done single workflow", rejected(run(project, ["orchestrate", "baseline", "--set", commits[0], "--replace", "--expect", current, "--user-input", "Approve", "--reason", "x", "--dry-run"])), /is done; its baseline can no longer be registered or replaced\./);
    assert.equal(loadWorkflowState(project)!.revision, state.revision, "nothing was written");
    checks.assertAll();
  });

  // ---------------------------------------------------------------- (B) state chain rules
  await section("state: Baseline History load / save rules fail closed", () => {
    const base = createInitialState("feature", "4.7.0", "workflow-chain-rules", [], "chain rules");
    const c0 = "a".repeat(40);
    const c1 = "b".repeat(40);
    const advanced: WorkflowState = { ...base, baseline_commit: c1, baseline_source: "advanced", baseline_history: [c0, c1] };
    const roundTrip = parseLightWorkflowState(renderLightWorkflowState(advanced));
    assert.deepEqual(roundTrip.baseline_history, [c0, c1]);
    assert.equal(roundTrip.baseline_source, "advanced");
    const parse = (state: WorkflowState): string => {
      try {
        parseLightWorkflowState(renderLightWorkflowState(state));
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const checks = rejections();
    checks.expect("last entry differs from Baseline Commit", parse({ ...advanced, baseline_commit: c0, baseline_history: [c1, "c".repeat(40)] }), /last Baseline History entry .* must equal Baseline Commit/);
    checks.expect("advanced without a chain", parse({ ...advanced, baseline_history: undefined }), /Baseline Source advanced requires a Baseline History chain/);
    checks.expect("chain without advanced", parse({ ...advanced, baseline_source: "registered" }), /Baseline History is only valid with Baseline Source advanced/);
    checks.expect("chain of one epoch", parse({ ...advanced, baseline_history: [c1] }), /at least two epochs/);
    checks.expect("abbreviated chain entry", parse({ ...advanced, baseline_history: ["abc1234", c1] }), /Baseline History entries must be 40- or 64-character/);
    checks.expect("duplicate chain entries", parse({ ...advanced, baseline_history: [c1, c1] }), /duplicate commits/);
    const moduleMarkdown = renderLightWorkflowState({ ...base, workflow_kind: "module", module_id: M01 }).replace("- Depth:", `- Baseline History: ${c0}, ${c1}\n- Depth:`);
    let moduleError = "";
    try {
      parseLightWorkflowState(moduleMarkdown);
    } catch (error) {
      moduleError = error instanceof Error ? error.message : String(error);
    }
    checks.expect("module sub-workflow carries a chain", moduleError, /module sub-workflow state must not carry Baseline Commit \/ Baseline Source \/ Baseline History/);

    // Pre-4.7 state without the field stays without it; ordinary saves cannot touch the chain.
    const project = join(scratch, "chain-rules");
    mkdirSync(project, { recursive: true });
    const legacy = createInitialState("feature", "4.6.1", "workflow-legacy-chain", [], "legacy chain");
    legacy.baseline_commit = c0;
    legacy.baseline_source = "created";
    saveWorkflowState(project, legacy);
    const reloaded = loadWorkflowState(project)!;
    saveWorkflowState(project, reloaded);
    assert.doesNotMatch(readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8"), /Baseline History/, "a 4.6 state stays without a chain");
    const forged = loadWorkflowState(project)!;
    let saveError = "";
    try {
      saveWorkflowState(project, { ...forged, baseline_commit: c1, baseline_source: "advanced", baseline_history: [c0, c1] });
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
    checks.expect("ordinary save appends to the chain", saveError, /ordinary save must keep Baseline Commit \/ Baseline Source \/ Baseline History unchanged/);
    checks.assertAll();
  });

  // ---------------------------------------------------------------- (C) single unit, never advanced
  await section("single unit, never advanced: 4.6.1 behaviour — no chain, unchanged view and --replace refusal", () => {
    const transcript: string[] = [];
    const { project, commits } = legacyRepository("single");
    const normalize = (value: unknown): string => String(value ?? "")
      .split(scratch).join("<scratch>")
      .replace(/\\\\/g, "/").replace(/\\/g, "/")
      .replace(/[0-9a-f]{64}|[0-9a-f]{40}/g, "<sha>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
      .replace(/4\.7\.0|4\.6\.1/g, "<version>");
    const step = (args: string[], expectOk = true): Run => {
      const result = expectOk ? ok(project, args) : run(project, args);
      transcript.push(`$ ${normalize(args.join(" "))}\n  kind=${normalize(result.json.kind)} stage_instance=${normalize(result.json.stage_instance)}\n  message=${normalize(result.json.message)}`);
      return result;
    };
    step(["orchestrate", "next", "--scope", "refactor", "--work", "4.7.0 single unit"]);
    const baseline = commits[1];
    for (const stage of ["workspace-detection", "state-template"]) {
      step(["orchestrate", "next"]);
      step(["orchestrate", "report", "--stage", stage, "--result", "completed", "--instruction-ack", stage]);
    }
    step(["orchestrate", "next"]);
    const caseRoot = "docs/aidlc/modules/project/inception/application-design/test-cases";
    write(project, "docs/aidlc/modules/project/inception/requirements.md", "# 需求\n\n## REQ-001 订单导出分页\n\ntrack: [nfr]\n\n业务规则：订单导出接口按 50 条分页返回。\n");
    write(project, `${caseRoot}/_index.md`, `# UC-D 索引\n\n${UCDS.map((ucd) => `- ${ucd.id} ${ucd.title}（source_ref: REQ-001）`).join("\n")}\n`);
    for (const ucd of UCDS) write(project, `${caseRoot}/${ucd.id}.md`, caseFile(ucd));
    step(["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
    step(["orchestrate", "next"]);
    write(project, "tests/__init__.py", "\"\"\"Tests for the order export service (REQ-001).\"\"\"\n");
    write(project, "tests/test_exporter.py", pythonTests());
    write(project, "tests/observe_uc.cjs", observer());
    write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
    step(["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
    const evidence = readJson(project, ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json");
    assert.equal(evidence.baseline_commit, baseline);

    const shown = step(["orchestrate", "baseline"]).json;
    assert.equal(shown.message, `Workflow baseline: ${baseline} (source: created).`, "the single-epoch view message is the 4.6.1 text");
    const refused = step(["orchestrate", "baseline", "--set", commits[0], "--replace", "--expect", baseline, "--user-input", "Approve", "--reason", "更正基线"], false);
    assert.match(String(refused.json.message), new RegExp(`^Workflow baseline ${baseline} is already in use and cannot be replaced \\(U1=used U2=used U3=used U4=clear \\(workflows scanned: 1\\)\\): `), "the U1-U4 refusal text is unchanged");
    const state = readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8");
    assert.doesNotMatch(state, /Baseline History/, "a never-advanced workflow has no chain");
    assert.match(state, /^- Baseline Source: created$/m);

    step(["evidence", "run", "--stage", "test-case-derivation", "--instance", "test-case-derivation@module:project", "--all-sensors", "--refresh"]);
    step(["orchestrate", "next"]);
    write(project, "app/exporter.py", `${EXPORTER_BASELINE}${U1_ANNOTATION}`);
    write(project, "app/__init__.py", INIT_ANNOTATED);
    const construction = "docs/aidlc/modules/project/construction/default";
    const ids = UCDS.map((ucd) => ucd.id).join(" / ");
    write(project, `${construction}/plans/code-generation-plan.md`, `# 代码生成计划\n\n- REQ-001 / ${ids}：为 app/exporter.py 补充注释，存量行为由 BASELINE 锁定。\n`);
    write(project, `${construction}/implementation-summary.md`, `# 实现摘要\n\nREQ-001 / ${ids}：app/exporter.py 仅追加注释行，tests/test_exporter.py 覆盖全部 UC-D。\n`);
    write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
    step(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
    step(["orchestrate", "next"]);
    write(project, `${construction}/code-review.md`, codeReview("default"));
    write(project, `${construction}/audit.md`, `# 审计 — 单元 default\n\n代码审查（REQ-001 / ${ids}）结论：passed。\n`);
    step(["orchestrate", "report", "--stage", "code-review", "--result", "completed"]);
    step(["orchestrate", "baseline"]);
    assert.doesNotMatch(readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8"), /Baseline History/);
    if (process.env.AIDLC_TRANSCRIPT) writeFileSync(process.env.AIDLC_TRANSCRIPT, `${transcript.join("\n")}\n`, "utf8");
  });

  if (failed.length > 0) {
    console.log(`4.7.0 baseline advance regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.7.0 baseline advance regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
