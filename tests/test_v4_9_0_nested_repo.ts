/**
 * 4.9.0 (MARS-78) regression suite: nested independent git repositories as source roots.
 *
 * The workflow repository holds docs, `aidlc/` state and `.aidlc/` evidence; the
 * business code lives in `app/`, an independent git repository ignored by the workflow
 * repository. Characterization code refs, BASELINE and the source revision must bind to
 * the nested repository.
 *
 * Every fixture is driven through the public CLI (`orchestrate`, `evidence run`,
 * `worktree`, `attest`) and the gate probe; evidence is only ever produced by the
 * controlled producer. Nested repositories are created under the scratch directory only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-490-nested-"));
const sections: string[] = [];
const failed: string[] = [];
const ONLY = process.env.AIDLC_ONLY || "";
const OLD_DATE = "2024-01-01T00:00:00Z";
const TDD = "tdd@module:project@unit:default";
const CODEGEN = "code-generation@module:project@unit:default";
const I13_PATH = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
const BASELINE_PATH = ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json";
const GREEN_PATH = ".aidlc/evidence/code-generation/project/default/green-test-evidence.json";
const CASES = "docs/aidlc/modules/project/inception/application-design/test-cases";

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

function git(cwd: string, args: string[], date = OLD_DATE): string {
  const result = spawnSync("git", args, {
    cwd,
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
  assert.equal(result.status, 0, `git ${args.join(" ")} (${cwd})\n${result.stdout}\n${result.stderr}`);
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
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await body();
    sections.push(name);
    console.log(`  ok ${name}`);
  } catch (error) {
    failed.push(name);
    console.log(`  FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
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

const EXPORTER = "# REQ-001 legacy order exporter\ndef export_orders(client):\n    return paginate(client.fetch_orders())\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const REQUIREMENTS = "# 需求\n\n## REQ-001 导出分页\n\ntrack: [nfr]\n\n业务规则：订单导出接口按 50 条分页返回，现有分页与导出行为在改动中保持不变。\n";

function characterizationCase(id: string, codeRef: string, unitRefs?: string[]): string {
  return `---\nid: ${id}\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\ncode_refs:\n  - ${codeRef}\nreason: 改动前锁定导出的现有行为\napproval_ref: REVIEW-2026-10-06-01\n${unitRefs ? `unit_refs: [${unitRefs.join(", ")}]\n` : ""}---\n# ${id} 导出分页\n\nGiven 下游返回 120 条订单，When 调用 export_orders，Then 返回 3 页。\n`;
}

/** Deterministic observer: every UC-D passes while app/exporter.py still paginates by 50. */
const OBSERVER = `const { readFileSync } = require("node:fs");
const source = readFileSync("app/exporter.py", "utf8");
const ids = JSON.parse(readFileSync("tests/ucds.json", "utf8"));
const phase = process.env.AIDLC_PHASE || "GREEN";
const passed = /def paginate\\(rows, size=50\\)/.test(source);
const observation = { phase, status: passed ? "passed" : "failed", compile_status: "passed", environment_status: "passed", tests_total: ids.length, tests_failed: passed ? 0 : ids.length, traceability_complete: true, uc_mapping: ids.map((id) => ({ use_case: id, test_methods: ["tests/test_exporter.py::test_" + id.toLowerCase().replace(/-/g, "_")] })) };
if (!passed) Object.assign(observation, { failure_class: "behavior", failure_signature: "pagination changed" });
console.log(JSON.stringify(observation));
process.exit(passed ? 0 : 1);
`;

function allowlist(stage: string, commands: Array<{ id: string; role: string; argv: string[] }>): string {
  return `${JSON.stringify({ version: "1", stage, commands }, null, 2)}\n`;
}

const OBSERVE = ["node", "tests/observe_uc.cjs"];
let counter = 0;

interface NestedFixture {
  project: string;
  app: string;
  workflowCommit: string;
  appCommit: string;
}

/**
 * Workflow repository with an ignored nested repository `app/` holding the legacy
 * exporter. `sourceRoots` is written to .aidlc/source-roots.json.
 */
function nestedRepository(name: string, sourceRoots: unknown[]): NestedFixture {
  const project = join(scratch, `p${++counter}-${name}`);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders workflow\n\nDocs and AI-DLC state; the code lives in the app/ repository.\n");
  write(project, ".gitignore", "app/\n");
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "w1 workflow repository"], "2024-01-01T00:00:00Z");
  const workflowCommit = git(project, ["rev-parse", "HEAD"]);
  const app = join(project, "app");
  mkdirSync(app, { recursive: true });
  git(app, ["init", "-q"]);
  git(app, ["checkout", "-q", "-b", "main"]);
  write(app, "__init__.py", "\"\"\"Order export application package (REQ-001).\"\"\"\n");
  write(app, "exporter.py", EXPORTER);
  git(app, ["add", "-A"]);
  git(app, ["commit", "-qm", "a1 legacy exporter"], "2024-01-01T00:00:00Z");
  const appCommit = git(app, ["rev-parse", "HEAD"]);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: sourceRoots })}\n`);
  return { project, app, workflowCommit, appCommit };
}

/** Drive a refactor workflow to the test-case-derivation report (single layout). */
function toI13(f: NestedFixture, ucds: Array<{ id: string; codeRef: string }>): Run {
  ok(f.project, ["orchestrate", "next", "--scope", "refactor", "--work", "4.9.0 nested repository fixture"]);
  const expect = (instance: string) => {
    const directive = ok(f.project, ["orchestrate", "next"]).json;
    assert.equal(directive.stage_instance, instance, JSON.stringify(directive, null, 2));
  };
  expect("workspace-detection");
  ok(f.project, ["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  expect("state-template");
  ok(f.project, ["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);
  expect("test-case-derivation@module:project");
  write(f.project, "docs/aidlc/modules/project/inception/requirements.md", REQUIREMENTS);
  write(f.project, `${CASES}/_index.md`, `# UC-D 索引\n\n${ucds.map((ucd) => `- ${ucd.id} 订单导出（source_ref: REQ-001）`).join("\n")}\n`);
  for (const ucd of ucds) write(f.project, `${CASES}/${ucd.id}.md`, characterizationCase(ucd.id, ucd.codeRef));
  write(f.project, "tests/ucds.json", `${JSON.stringify(ucds.map((ucd) => ucd.id))}\n`);
  write(f.project, "tests/test_exporter.py", `# REQ-001 ${ucds.map((ucd) => ucd.id).join(" ")}\nfrom app.exporter import export_orders\n`);
  write(f.project, "tests/observe_uc.cjs", OBSERVER);
  write(f.project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
  write(f.project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
  return run(f.project, ["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
}

const ONE_UCD = [{ id: "UC-D-001", codeRef: "app/exporter.py::paginate" }];
const CONSTRUCTION = "docs/aidlc/modules/project/construction/default";
const SET = (commit: string, extra: string[] = []) => ["orchestrate", "baseline", "--set", commit, "--user-input", "Approve", "--reason", "登记工作流与嵌套仓库基线", ...extra];
const auditText = (project: string): string => readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8");
const stateText = (project: string): string => readFileSync(join(project, "aidlc", "active", "aidlc-state.md"), "utf8");

/** Single layout: refresh a completed upstream instance (worktree-bound evidence) before `next`. */
function refresh(project: string, instance: string): void {
  ok(project, ["evidence", "run", "--stage", instance.split("@", 1)[0], "--instance", instance, "--all-sensors", "--refresh"]);
}

function nextIs(project: string, instance: string): void {
  const directive = ok(project, ["orchestrate", "next"]).json;
  assert.equal(directive.stage_instance, instance, JSON.stringify(directive, null, 2));
}

/** Remove the baseline lines from the state (simulates a workflow created before 4.6.0). */
function stripBaseline(project: string): void {
  const path = join(project, "aidlc", "active", "aidlc-state.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(/^- Baseline (?:Commit|Source|History|Repos|Repos History):.*\n/gm, ""), "utf8");
}

function codeGenerationDocs(project: string): void {
  write(project, `${CONSTRUCTION}/plans/code-generation-plan.md`, "# 代码生成计划\n\n- REQ-001 / UC-D-001：在 app/exporter.py 中补充 REQ-001 追溯注释，现有分页行为由 BASELINE 锁定。\n");
  write(project, `${CONSTRUCTION}/implementation-summary.md`, "# 实现摘要\n\nREQ-001 / UC-D-001：app/exporter.py 仅追加注释行，行为不变；tests/test_exporter.py 覆盖 UC-D-001。\n");
}

// ---------------------------------------------------------------------------
// Split layout fixture (acceptance A): one module, units u1/u2/u3
// ---------------------------------------------------------------------------

const M01 = "m01-trade";
const IN = `docs/aidlc/modules/${M01}/inception`;
const SPLIT_CASES = `${IN}/application-design/test-cases`;
const SPLIT_I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
const UNIT_BASE = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/baseline-test-evidence.json`;
const UNIT_GREEN = (unit: string) => `.aidlc/evidence/code-generation/${M01}/${unit}/green-test-evidence.json`;
const unitConstruction = (unit: string) => `docs/aidlc/modules/${M01}/construction/${unit}`;
const TCD = ["--stage", "test-case-derivation", "--module", M01];
const RA = ["--stage", "requirements-analysis", "--module", M01];
const unitArgs = (unit: string) => ["--module", M01, "--unit", unit];
const LIB_A = "# REQ-001 alpha: legacy pagination helper\ndef alpha(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const LIB_B = "# REQ-001 beta: legacy export helper\ndef beta(client):\n    return list(client.fetch_orders())\n";

interface SplitUcd {
  id: string;
  title: string;
  file: string;
  marker: string;
  codeRef: string;
  unit: string;
}

const UCD_A: SplitUcd = { id: "UC-D-011", title: "alpha 分页", file: "lib/a.py", marker: "def alpha(rows, size=50)", codeRef: "lib/a.py::alpha", unit: "u1" };
const UCD_B: SplitUcd = { id: "UC-D-012", title: "beta 导出", file: "lib/b.py", marker: "def beta(client)", codeRef: "lib/b.py::beta", unit: "u2" };
const UCD_APP: SplitUcd = { id: "UC-D-013", title: "导出分页（app/ 仓库）", file: "app/exporter.py", marker: "def paginate(rows, size=50)", codeRef: "app/exporter.py::paginate", unit: "u3" };
/** u4 shares the code ref file app/exporter.py with u3 (multi-unit characterization inside the nested repository). */
const UCD_APP2: SplitUcd = { id: "UC-D-014", title: "导出调用下游（app/ 仓库）", file: "app/exporter.py", marker: "def export_orders(client)", codeRef: "app/exporter.py::export_orders", unit: "u4" };
const UNITS = ["u1", "u2", "u3", "u4"];

/** Plan-driven observer: a unit's phase observes its own UC-Ds; each passes while its file holds its marker. */
const PLAN_OBSERVER = `const { existsSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(".aidlc/ucd-plan.json", "utf8"));
const phase = process.env.AIDLC_PHASE || "GREEN";
const unit = process.env.AIDLC_ACTIVE_UNIT || "*";
const ids = ((plan.phases[unit] || {})[phase]) || ((plan.phases["*"] || {})[phase]) || [];
const results = ids.map((id) => ({ id, test: plan.ucds[id].test, pass: existsSync(plan.ucds[id].file) && readFileSync(plan.ucds[id].file, "utf8").includes(plan.ucds[id].marker) }));
const failing = results.filter((result) => !result.pass);
const observation = { phase, status: failing.length ? "failed" : "passed", compile_status: "passed", environment_status: "passed", tests_total: results.length, tests_failed: failing.length, traceability_complete: true, uc_mapping: results.map((result) => ({ use_case: result.id, test_methods: [result.test] })) };
if (failing.length) Object.assign(observation, { failure_class: "behavior", failure_signature: failing.map((result) => result.id).join("; ") });
console.log(JSON.stringify(observation));
console.log(results.length - failing.length + " passed, " + failing.length + " failed");
process.exit(failing.length ? 1 : 0);
`;

function splitCase(ucd: SplitUcd): string {
  return `---\nid: ${ucd.id}\nstatus: ready\nsource_ref: REQ-001\ntdd_mode: characterization\ncode_refs:\n  - ${ucd.codeRef}\nreason: 改动前锁定现有行为\napproval_ref: REVIEW-2026-10-06-02\nunit_refs: [${ucd.unit}]\n---\n# ${ucd.id} ${ucd.title}\n\nGiven REQ-001 的输入，When 执行 ${ucd.title}，Then 行为保持不变。\n`;
}

interface SplitFixture {
  project: string;
  app: string;
  epoch0: string;
  appCommit: string;
  step: (args: string[], expectOk?: boolean) => Run;
  nextModule: (expected: string, refreshes?: string[][]) => Run;
  reportUnit: (stage: string, unit: string) => Run;
  writeCases: (ucds: SplitUcd[]) => void;
}

/**
 * Split layout: workflow repository with the legacy helpers under lib/ (string source
 * root) and the ignored nested repository app/ (declared as a plain string root, i.e.
 * a 4.8.1-style project). Driven through the module inception to the I13 report.
 */
function splitFixture(name: string, sourceRoots: unknown[] = ["lib", "app"]): SplitFixture {
  const project = join(scratch, `p${++counter}-${name}`);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n\nPython order service.\n");
  write(project, ".gitignore", "app/\n");
  write(project, "lib/__init__.py", "\"\"\"Order library; every helper implements REQ-001.\"\"\"\n");
  write(project, "lib/a.py", LIB_A);
  write(project, "lib/b.py", LIB_B);
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] })}\n`);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "c1 legacy order service"], "2024-01-01T00:00:00Z");
  const epoch0 = git(project, ["rev-parse", "HEAD"]);
  const app = join(project, "app");
  mkdirSync(app, { recursive: true });
  git(app, ["init", "-q"]);
  git(app, ["checkout", "-q", "-b", "main"]);
  write(app, "__init__.py", "\"\"\"Order export application package (REQ-001).\"\"\"\n");
  write(app, "exporter.py", EXPORTER);
  git(app, ["add", "-A"]);
  git(app, ["commit", "-qm", "a1 legacy exporter"], "2024-01-01T00:00:00Z");
  const appCommit = git(app, ["rev-parse", "HEAD"]);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: sourceRoots })}\n`);

  const step = (args: string[], expectOk = true): Run => (expectOk ? ok(project, args) : run(project, args));
  const moduleArgs = ["--module", M01];
  const nextModule = (expected: string, refreshes: string[][] = []): Run => {
    for (const args of refreshes) step(["evidence", "run", ...args, "--refresh"]);
    const result = step(["orchestrate", "next", ...moduleArgs]);
    assert.equal(result.json.stage_instance, expected, JSON.stringify(result.json, null, 2));
    return result;
  };
  const report = (stage: string, extra: string[] = []) => step(["orchestrate", "report", "--stage", stage, ...moduleArgs, "--result", "completed", ...extra]);
  const reportUnit = (stage: string, unit: string) => step(["orchestrate", "report", "--stage", stage, ...unitArgs(unit), "--result", "completed"], false);
  const ack = (stage: string) => report(stage, ["--instruction-ack", stage]);

  step(["orchestrate", "next", "--scope", "feature", "--work", `4.9.0 nested ${name}`]);
  const global = loadWorkflowState(project)!;
  const globalStages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  global.completed_stages = [...globalStages];
  global.completed_stage_instances = [...globalStages];
  global.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
  saveWorkflowState(project, global);
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", `# 场景模块映射\n\nREQ-001 订单处理属于 ${M01}。\n`);
  step(["orchestrate", "split", "--from", global.workflow_id]);
  const moduleRef = { kind: "module" as const, module_id: M01 };
  nextModule(`requirements-analysis@module:${M01}`);
  write(project, `${IN}/requirements.md`, "# 需求\n\n## REQ-001 订单处理\n\ntrack: [backend]\n\n业务规则：订单处理由多个单元分别改动，每个单元的存量行为由 characterization UC-D 锁定。\n");
  report("requirements-analysis");
  nextModule(`requirement-clarification@module:${M01}`);
  write(project, `${IN}/clarifications.md`, "# 需求澄清\n\nNo clarifications needed.\n\nREQ-001 的单元划分已在需求中明确，本次改动沿用现有行为。\n");
  report("requirement-clarification");
  nextModule(`requirements-data-model@module:${M01}`, [RA]);
  ack("requirements-data-model");
  nextModule(`requirements-methods@module:${M01}`, [RA]);
  write(project, `${IN}/requirements/business-flows.md`, "# 业务流程\n\n## REQ-001 订单处理流程\n\n```mermaid\nflowchart LR\n  A[接收订单] --> B[按单元处理]\n  B --> C[返回结果]\n```\n");
  report("requirements-methods");
  nextModule(`requirements-prioritization@module:${M01}`, [RA]);
  ack("requirements-prioritization");
  nextModule(`requirements-validation@module:${M01}`, [RA]);
  ack("requirements-validation");
  nextModule(`user-stories@module:${M01}`, [RA]);
  write(project, `${IN}/user-stories.md`, "# 用户故事\n\n## STORY-001 / US-001 运营处理订单\n\n- 关联需求：REQ-001\n- 作为运营人员，我希望订单处理的存量行为在各单元改动后保持不变。\n- 验收标准：每个单元的 characterization 用例在该单元完成时通过。\n");
  report("user-stories");
  nextModule(`cross-validation@module:${M01}`, [RA]);
  write(project, `${IN}/cross-validation-report.md`, "# 交叉验证报告\n\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: not-selected\n\n| 需求 | 故事 | 结论 |\n| --- | --- | --- |\n| REQ-001 | STORY-001 / US-001 | 一致 |\n");
  report("cross-validation");
  nextModule(`workflow-planning@module:${M01}`, [RA, ["--stage", "user-stories", ...moduleArgs]]);
  write(project, `${IN}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：u1、u2 改动 lib/，u3 改动嵌套仓库 app/；各单元 BASELINE→GREEN；不需要应用设计。\n");
  report("workflow-planning");
  write(project, `${IN}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: UNITS.map((unit) => ({ unit_id: unit, name: `Unit ${unit}`, service_id: "trade-service", conditional_stages: [] })) }, null, 2)}\n`);
  const moduleState = loadWorkflowState(project, moduleRef)!;
  moduleState.completed_stages.push("units-generation");
  moduleState.completed_stage_instances.push(`units-generation@module:${M01}`);
  saveWorkflowState(project, moduleState, moduleRef);
  for (const unit of UNITS) write(project, `${unitConstruction(unit)}/functional-design.md`, `# 功能设计 — ${unit}\n\nREQ-001：${unit} 只补充追溯注释，不改变存量行为；无新增接口与数据结构。\n`);
  nextModule(`test-case-derivation@module:${M01}`);
  const writeCases = (ucds: SplitUcd[]) => {
    rmSync(join(project, SPLIT_CASES), { recursive: true, force: true });
    write(project, `${SPLIT_CASES}/_index.md`, `# UC-D 索引\n\n${ucds.map((ucd) => `- ${ucd.id} ${ucd.title}（source_ref: REQ-001）`).join("\n")}\n`);
    for (const ucd of ucds) write(project, `${SPLIT_CASES}/${ucd.id}.md`, splitCase(ucd));
    const all = [UCD_A, UCD_B, UCD_APP, UCD_APP2];
    write(project, ".aidlc/ucd-plan.json", `${JSON.stringify({
      ucds: Object.fromEntries(all.map((ucd) => [ucd.id, { file: ucd.file, marker: ucd.marker, test: `tests/test_features.py::test_${ucd.id.toLowerCase().replace(/-/g, "_")}` }])),
      phases: { ...Object.fromEntries(UNITS.map((unit) => [unit, { BASELINE: ucds.filter((ucd) => ucd.unit === unit).map((ucd) => ucd.id), GREEN: ucds.filter((ucd) => ucd.unit === unit).map((ucd) => ucd.id) }])), "*": { GREEN: ucds.map((ucd) => ucd.id) } },
    }, null, 2)}\n`);
    write(project, "tests/test_features.py", `# REQ-001 ${ucds.map((ucd) => ucd.id).join(" ")}\n\n\n${ucds.map((ucd) => `def test_${ucd.id.toLowerCase().replace(/-/g, "_")}():\n    # ${ucd.id}\n    assert True\n`).join("\n\n")}`);
  };
  write(project, "tests/__init__.py", "\"\"\"Tests for the order service (REQ-001).\"\"\"\n");
  write(project, "tests/observe_uc.cjs", PLAN_OBSERVER);
  write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
  write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
  return { project, app, epoch0, appCommit, step, nextModule, reportUnit, writeCases };
}

function splitImplement(f: SplitFixture, unit: string, ucdIds: string): void {
  write(f.project, `${unitConstruction(unit)}/plans/code-generation-plan.md`, `# 代码生成计划 — ${unit}\n\n- REQ-001 / ${ucdIds}：${unit} 只补充追溯注释，存量行为由 BASELINE 锁定。\n`);
  write(f.project, `${unitConstruction(unit)}/implementation-summary.md`, `# 实现摘要 — ${unit}\n\nREQ-001 / ${ucdIds}：${unit} 的注释已补充，行为不变；tests/test_features.py 覆盖对应 UC-D。\n`);
}

function splitReview(f: SplitFixture, unit: string, ucdIds: string, files: string): void {
  write(f.project, `${unitConstruction(unit)}/code-review.md`, [
    `# 代码审查 — 单元 ${unit}`, "", "- 审查模式: 集成双轴审查", "- reviewer: aidlc-quality-agent", "- execution_context: isolated", "- review_only: true",
    `- Spec 结果: passed（REQ-001 / ${ucdIds}）`, "- Standards 结果: passed", "- issues_found: 0", "- issues_resolved: 0", "- issues_open: 0",
    `- 审查文件: ${files}, tests/test_features.py`, "- 修复状态: 无需修复", "",
  ].join("\n"));
  write(f.project, `${unitConstruction(unit)}/audit.md`, `# 审计 — 单元 ${unit}\n\n代码审查（REQ-001 / ${ucdIds}）结论：passed。\n`);
}

function unitEvidence(project: string, units: string[]): string[] {
  return units.flatMap((unit) => ["tdd", "code-generation", "code-review"].flatMap((stage) => listEvidence(join(project, ".aidlc", "evidence", stage, M01, unit))))
    .map((path) => path.slice(project.length + 1).replace(/\\/g, "/")).sort();
}

function hashes(project: string, paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, sha256(project, path)]));
}

/**
 * build-and-test → build-and-test-templates → implementation-report → done. When the
 * integration upstream re-check refuses the completed unit evidence only because later
 * units changed the module digest scope (4.8.0 behaviour, unrelated to nested
 * repositories; see test_v4_8_0 reattestUnits), the units are re-attested as there.
 */
function integrationRun(f: SplitFixture, first: Run): void {
  let directive = first;
  if (directive.json.kind === "error") {
    assert.match(String(directive.json.message), /scope_digest no longer matches the module:m01-trade scope/, directive.out);
    assert.doesNotMatch(String(directive.json.message), /source_revision\.repos|nested (?:source )?repositor/, directive.out);
    for (const unit of UNITS) for (const stage of ["code-generation", "code-review"]) f.step(["evidence", "run", "--stage", stage, ...unitArgs(unit), "--all-sensors", "--refresh"]);
    for (const unit of UNITS) for (const stage of ["code-generation", "code-review"]) f.step(["orchestrate", "report", "--stage", stage, ...unitArgs(unit), "--result", "completed"]);
    directive = f.step(["orchestrate", "next"]);
  }
  assert.equal(directive.json.stage_instance, "build-and-test", directive.out);
  const ids = [UCD_A, UCD_B, UCD_APP, UCD_APP2].map((ucd) => ucd.id).join(" / ");
  write(f.project, "tests/build_check.cjs", "const { readFileSync } = require('node:fs');\nreadFileSync('app/exporter.py', 'utf8');\nconsole.log('build ok');\n");
  write(f.project, "tests/run_tests.cjs", "const { spawnSync } = require('node:child_process');\nconst env = { ...process.env, AIDLC_PHASE: 'GREEN' };\ndelete env.AIDLC_ACTIVE_UNIT;\nconst result = spawnSync(process.execPath, ['tests/observe_uc.cjs'], { encoding: 'utf8', env });\nprocess.stdout.write(result.stdout.split(/\\r?\\n/).filter((line) => !line.startsWith('{')).join('\\n'));\nprocess.exit(result.status ?? 1);\n");
  write(f.project, "tests/lint_check.cjs", "console.log('lint ok');\n");
  write(f.project, ".aidlc/commands/build-and-test.json", allowlist("build-and-test", [
    { id: "build", role: "build", argv: ["node", "tests/build_check.cjs"] },
    { id: "unit-tests", role: "test", argv: ["node", "tests/run_tests.cjs"] },
    { id: "lint", role: "check", argv: ["node", "tests/lint_check.cjs"] },
  ]));
  write(f.project, "docs/aidlc/construction/build-test-report.md", `# 构建与测试报告\n\nREQ-001 / ${ids}：构建、单元测试与 lint 均通过（0 failed）。\n`);
  write(f.project, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# 构建与测试摘要\n\nREQ-001 的实现通过构建、测试和静态检查；存量行为由各单元的 BASELINE 证据锁定（u3 在嵌套仓库 app/ 中）。\n");
  f.step(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  f.step(["evidence", "run", "--stage", "build-and-test"]);
  f.step(["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
  assert.equal(f.step(["orchestrate", "next"]).json.stage_instance, "build-and-test-templates");
  write(f.project, "docs/aidlc/construction/build-and-test/build-instructions.md", "# 构建说明\n\nREQ-001：执行 node tests/build_check.cjs 校验 app/exporter.py 可读取。\n");
  write(f.project, "docs/aidlc/construction/build-and-test/unit-test-instructions.md", `# 单元测试说明\n\nREQ-001：执行 node tests/run_tests.cjs 运行 ${ids} 的 GREEN 观察，期望 0 failed。\n`);
  f.step(["orchestrate", "report", "--stage", "build-and-test-templates", "--result", "completed"]);
  f.step(["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--all-sensors", "--refresh"]);
  f.step(["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--sensor", "test-quality", "--refresh"]);
  assert.equal(f.step(["orchestrate", "next"]).json.stage_instance, "implementation-report");
  const moduleRef = { kind: "module" as const, module_id: M01 };
  const completed = [undefined, moduleRef, { kind: "integration" as const }].reduce((total, ref) => total + loadWorkflowState(f.project, ref)!.completed_stage_instances.length, 0) + 1;
  const evidenceRefs = listEvidence(join(f.project, ".aidlc", "evidence")).map((file) => file.slice(f.project.length + 1).replace(/\\/g, "/")).filter((file) => !file.startsWith(".aidlc/evidence/implementation-report/")).sort();
  write(f.project, "docs/aidlc/construction/implementation-report.md", ["# 实施报告", "", "- scope: feature", `- stages_completed: ${completed}`, "- all_gates_passed: true", "", `REQ-001 / ${ids} 已完成：u1、u2 改动 lib/，u3 改动嵌套仓库 app/。`, "", "## 证据", "", ...evidenceRefs.map((file) => `- ${file}`), ""].join("\n"));
  f.step(["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
  assert.equal(f.step(["orchestrate", "next"]).json.kind, "done");
  for (const path of listEvidence(join(f.project, ".aidlc", "evidence"))) assert.equal(JSON.parse(readFileSync(path, "utf8")).producer?.mode, "controlled", path);
}

// ---------------------------------------------------------------------------
// E: 4.8.1 comparison
// ---------------------------------------------------------------------------

/** The 4.8.1 engine (b3c7aa2) extracted with git archive into the scratch directory, node_modules shared. */
function engine481(): string | undefined {
  const commit = "b3c7aa2f9f7b6c47fabff683205e371767b7e88d";
  if (spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: repository }).status !== 0) return undefined;
  const target = join(scratch, "engine-4.8.1");
  mkdirSync(target, { recursive: true });
  const archive = join(scratch, "engine-4.8.1.tar");
  git(repository, ["archive", "--format=tar", "-o", archive, commit, "bin", "core", "tests/gate_probe.ts", "package.json", "tsconfig.json"]);
  const extracted = spawnSync("tar", ["-xf", archive, "-C", target], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  symlinkSync(join(repository, "node_modules"), join(target, "node_modules"), "junction");
  return target;
}

function normalizeText(value: string, project: string): string {
  return value
    .split(project).join("<project>").split(project.replace(/\\/g, "/")).join("<project>").split(project.replace(/\\/g, "\\\\")).join("<project>")
    .replace(/\\\\/g, "/").replace(/\\/g, "/")
    .replace(/[0-9a-f]{64}|[0-9a-f]{40}/g, "<sha>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, "<ts>")
    .replace(/"duration_ms": \d+/g, "\"duration_ms\": <n>")
    .replace(/\b4\.8\.1\b|\b4\.(?:9|10|11|12|13)\.\d+\b/g, "<version>")
    .replace(/\(\d+h old/g, "(<n>h old")
    // E-fixture only ignores two intentional engine evolutions so the "≡ 4.8.1" lock still
    // guards every other behaviour (symmetric on both engines):
    //   P4 (MARS-109): operations split into planning+authorization raised the stage total.
    .replace(/Executable stages: (\d+)\/\d+/g, "Executable stages: $1/<total>")
    //   P3 (MARS-108): not_applicable stages no longer carry the (gate-short-circuited)
    //   traceability sensor. Dropping the traceability sensor line on BOTH engines keeps the
    //   comparison symmetric; sensor-mount correctness itself is covered by test_construction_tdd_gates.
    .replace(/,\n(\s*)"traceability"(?=\n\s*\])/g, "")
    .replace(/\n\s*"traceability",/g, "");
}

/**
 * The same no-nested project driven by one engine: refactor workflow, characterization
 * I13 on lib/a.py, BASELINE, GREEN at a new commit, --advance, baseline show, attest.
 */
function eFixture(name: string, engineRoot: string): { transcript: string[]; state: string; audit: string; evidence: Record<string, string> } {
  const engineCli = join(engineRoot, "bin", "cli.ts");
  const project = join(scratch, `p${++counter}-${name}`);
  const transcript: string[] = [];
  const step = (args: string[]): Run => {
    const result = spawnSync(process.execPath, [tsx, engineCli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
    const stdout = result.stdout || "";
    transcript.push(`$ ${args.join(" ")}\n${normalizeText(stdout, project)}\nexit=${result.status}`);
    const value = { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}`, json: parsed(stdout) };
    assert.equal(value.status, 0, `${engineRoot}: ${args.join(" ")}\n${value.out}`);
    return value;
  };
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n");
  write(project, "lib/__init__.py", "\"\"\"Order library (REQ-001).\"\"\"\n");
  write(project, "lib/a.py", LIB_A);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["lib"] })}\n`);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "e1 legacy"], "2024-01-01T00:00:00Z");
  step(["orchestrate", "next", "--scope", "refactor", "--work", "E no nested"]);
  step(["orchestrate", "next"]);
  step(["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  step(["orchestrate", "next"]);
  step(["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);
  step(["orchestrate", "next"]);
  write(project, "docs/aidlc/modules/project/inception/requirements.md", REQUIREMENTS);
  write(project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-001 订单导出（source_ref: REQ-001）\n");
  write(project, `${CASES}/UC-D-001.md`, characterizationCase("UC-D-001", "lib/a.py::alpha"));
  write(project, "tests/ucds.json", "[\"UC-D-001\"]\n");
  write(project, "tests/test_exporter.py", "# REQ-001 UC-D-001\nfrom lib.a import alpha\n");
  write(project, "tests/observe_uc.cjs", OBSERVER.replace('readFileSync("app/exporter.py", "utf8")', 'readFileSync("lib/a.py", "utf8")').replace("def paginate\\(rows, size=50\\)", "def alpha\\(rows, size=50\\)"));
  write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
  write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
  step(["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
  step(["orchestrate", "next"]);
  step(["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
  step(["evidence", "run", "--stage", "test-case-derivation", "--instance", "test-case-derivation@module:project", "--all-sensors", "--refresh"]);
  step(["orchestrate", "next"]);
  write(project, "lib/a.py", `${LIB_A}# REQ-001 traced (comment only)\n`);
  write(project, `${CONSTRUCTION}/plans/code-generation-plan.md`, "# 代码生成计划\n\n- REQ-001 / UC-D-001：在 lib/a.py 中补充 REQ-001 追溯注释，现有分页行为由 BASELINE 锁定。\n");
  write(project, `${CONSTRUCTION}/implementation-summary.md`, "# 实现摘要\n\nREQ-001 / UC-D-001：lib/a.py 仅追加注释行，行为不变；tests/test_exporter.py 覆盖 UC-D-001。\n");
  git(project, ["add", "lib", "tests", "docs"]);
  git(project, ["commit", "-qm", "e2 annotate"], "2024-01-04T00:00:00Z");
  const head = git(project, ["rev-parse", "HEAD"]);
  const epoch0 = String(loadWorkflowState(project)!.baseline_commit);
  step(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  step(["orchestrate", "baseline", "--advance", head, "--expect", epoch0, "--user-input", "Approve", "--reason", "E advance"]);
  step(["orchestrate", "baseline"]);
  step(["attest", "resolve", "--base", epoch0, "--head", "HEAD", "--as-of", "2026-10-06T00:00:00Z"]);
  step(["runtime", "doctor"]);
  const evidence: Record<string, string> = {};
  for (const path of listEvidence(join(project, ".aidlc", "evidence")).sort()) {
    evidence[path.slice(project.length + 1).replace(/\\/g, "/")] = normalizeText(readFileSync(path, "utf8"), project);
  }
  return {
    transcript,
    state: normalizeText(stateText(project), project),
    audit: normalizeText(auditText(project), project),
    evidence,
  };
}
try {
  // ------------------------------------------------------------------ RED (pre-4.9.0 behaviour)
  await section("RED→GREEN: nested app/ declared repo nested — 4.8.1 rejected the object entry; 4.9.0 binds the code ref", () => {
    const f = nestedRepository("red-nested", [{ path: "app", repo: "nested" }]);
    const result = toI13(f, ONE_UCD);
    const output = rejected(result) || result.out;
    console.log(`    RED (declared nested): ${(/[^\n]*(?:does not exist in the workflow baseline|source root must be)[^\n]*/.exec(output) || [output.trim().slice(-600)])[0]}`);
    if (process.env.AIDLC_RED_ONLY) return;
    assert.equal(rejected(result), "", `I13 binds the nested code ref\n${result.out}`);
  });

  await section("compat: nested app/ declared as a plain string root — still does not exist in the workflow baseline (hint appended)", () => {
    const f = nestedRepository("red-string", ["app"]);
    const result = toI13(f, ONE_UCD);
    const output = rejected(result);
    console.log(`    RED (string root): ${(/[^\n]*(?:does not exist in the workflow baseline|characterization covers code that already existed)[^\n]*/.exec(output) || [output.trim().slice(-600)])[0]}`);
    assert.match(output, /does not exist in the workflow baseline|characterization covers code that already existed at the baseline/);
    if (process.env.AIDLC_RED_ONLY) return;
    // 4.9.0 compatibility: same refusal; only a hint is appended (the producer message keeps its tail).
    assert.match(output, /app\/ is an independent git repository; declare it in \.aidlc\/source-roots\.json as \{ \\"path\\": \\"app\\", \\"repo\\": \\"nested\\" \}/);
    assert.equal(existsSync(join(f.project, I13_PATH)), false);
    // The gate on the same code ref names the full 4.8.1 message (plus the hint).
    const gateRun = run(f.project, ["evidence", "run", "--stage", "test-case-derivation", "--sensor", "test-case-derivation"]);
    assert.notEqual(gateRun.status, 0);
  });

  if (process.env.AIDLC_RED_ONLY) throw new Error("RED only");

  // ------------------------------------------------------------------ GREEN (single layout)
  await section("GREEN: next --scope records app=<sha>; BASELINE repo app; uncommitted change refused; GREEN repos.app; drift detected; --advance --repo; epoch-0 BASELINE unchanged", () => {
    const checks = rejections();
    const f = nestedRepository("green", [{ path: "app", repo: "nested" }]);
    const reported = toI13(f, ONE_UCD);
    assert.equal(rejected(reported), "", reported.out);
    const state = loadWorkflowState(f.project)!;
    assert.equal(state.baseline_commit, f.workflowCommit, "baseline_commit is the workflow repository commit");
    assert.deepEqual(state.baseline_repos, { app: f.appCommit }, "next --scope records the nested HEAD");
    assert.match(stateText(f.project), new RegExp(`^- Baseline Commit: ${f.workflowCommit}\\n- Baseline Source: created\\n- Baseline Repos: app=${f.appCommit}$`, "m"));
    assert.match(auditText(f.project), new RegExp(`- Event: BASELINE_COMMIT_RECORDED[\\s\\S]*- Repos: app=${f.appCommit}`));
    const i13 = readJson(f.project, I13_PATH);
    const blob = git(f.app, ["rev-parse", `${f.appCommit}:exporter.py`]);
    assert.equal(i13.baseline_commit, f.workflowCommit, "I13 baseline_commit stays the workflow commit");
    assert.deepEqual(i13.baseline_repos, { app: f.appCommit });
    assert.deepEqual(i13.characterization[0].code_refs, [{ path: "app/exporter.py", symbol: "paginate", repo: "app", baseline_blob: blob }]);
    console.log(`    GREEN I13: baseline_commit=${i13.baseline_commit} baseline_repos=${JSON.stringify(i13.baseline_repos)} code_refs=${JSON.stringify(i13.characterization[0].code_refs)}`);

    // BASELINE: a change in the nested repository (uncommitted) is refused before the command runs.
    nextIs(f.project, TDD);
    write(f.app, "exporter.py", `${EXPORTER}# local edit\n`);
    checks.expect("BASELINE after an uncommitted change in app/", rejected(run(f.project, ["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"])), /BASELINE refuses to run: code ref app\/exporter\.py changed since the baseline [0-9a-f]{40} of the nested repository app\//);
    assert.equal(existsSync(join(f.project, BASELINE_PATH)), false, "the refused BASELINE writes no evidence");
    write(f.app, "exporter.py", EXPORTER);
    ok(f.project, ["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
    const baseline = readJson(f.project, BASELINE_PATH);
    assert.equal(baseline.status, "passed");
    assert.equal(baseline.baseline_commit, f.workflowCommit);
    assert.deepEqual(baseline.baseline_repos, { app: f.appCommit });
    assert.deepEqual(baseline.code_ref_digests, [{ path: "app/exporter.py", repo: "app", baseline_blob: blob, worktree_blob: blob }]);
    assert.equal(baseline.source_revision.repos.app.commit, f.appCommit);
    console.log(`    GREEN BASELINE code_ref_digests: ${JSON.stringify(baseline.code_ref_digests)}`);
    const baselineSha = sha256(f.project, BASELINE_PATH);

    // u1 code-generation: commit in the nested repository, GREEN records repos.app.
    refresh(f.project, "test-case-derivation@module:project");
    nextIs(f.project, CODEGEN);
    write(f.app, "exporter.py", `${EXPORTER}# REQ-001 u1: traced (comment only)\n`);
    git(f.app, ["add", "-A"]);
    git(f.app, ["commit", "-qm", "a2 u1 annotate exporter"], "2024-01-04T00:00:00Z");
    const appU1 = git(f.app, ["rev-parse", "HEAD"]);
    codeGenerationDocs(f.project);
    const generated = run(f.project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
    assert.equal(rejected(generated), "", generated.out);
    const green = readJson(f.project, GREEN_PATH);
    assert.equal(green.source_revision.commit, f.workflowCommit);
    assert.equal(green.source_revision.repos.app.commit, appU1, "GREEN records the nested commit");

    // Drift: an uncommitted change in app/ after GREEN invalidates it.
    assert.equal(gate(f.project, CODEGEN, "green-test-evidence"), "", "GREEN passes before the drift");
    write(f.app, "exporter.py", `${EXPORTER}# REQ-001 u1: traced (comment only)\n# drift\n`);
    const drift = gate(f.project, CODEGEN, "green-test-evidence");
    console.log(`    drift: ${(/source_revision\.repos\.app[^;\n]*/.exec(drift) || [drift])[0]}`);
    checks.expect("GREEN after an uncommitted change in app/", drift, /source_revision\.repos\.app\.worktree_digest no longer matches the nested repository app\//);
    checks.expect("tdd re-check after the drift (worktree bound)", gate(f.project, TDD, "baseline-test-evidence"), /source_revision\.repos\.app\.(?:commit|worktree_digest)/);
    git(f.app, ["checkout", "--", "exporter.py"]);
    assert.equal(gate(f.project, CODEGEN, "green-test-evidence"), "", "GREEN passes again once the drift is reverted");

    // --advance: the workflow commit stays, app advances to the GREEN commit.
    const ADV = (extra: string[]) => ["orchestrate", "baseline", "--advance", f.workflowCommit, "--expect", f.workflowCommit, "--user-input", "Approve", "--reason", "u1 已在 app/ 提交", ...extra];
    const revision = loadWorkflowState(f.project)!.revision;
    checks.expect("--advance without --repo", rejected(run(f.project, ADV(["--expect-repo", `app=${f.appCommit}`]))), /--advance must name the target of every registered nested repository explicitly \(there is no default\); missing: --repo app=<commit>/);
    checks.expect("--advance without --expect-repo", rejected(run(f.project, ADV(["--repo", `app=${appU1}`]))), /--advance requires --expect-repo <path>=<current commit> for every registered nested repository/);
    const unrelated = git(f.app, ["commit-tree", `${f.appCommit}^{tree}`, "-m", "unrelated root"]);
    checks.expect("--advance to a non-descendant app commit", rejected(run(f.project, ADV(["--repo", `app=${unrelated}`, "--expect-repo", `app=${f.appCommit}`]))), /app\/:? .*(?:is not the current HEAD or one of its ancestors|is not a descendant of the current baseline epoch)/);
    checks.expect("--advance where nothing moves", rejected(run(f.project, ADV(["--repo", `app=${f.appCommit}`, "--expect-repo", `app=${f.appCommit}`]))), /neither the workflow repository .* nor any nested repository .* moves/);
    assert.equal(loadWorkflowState(f.project)!.revision, revision, "rejected --advance writes nothing");
    const advanced = ok(f.project, ADV(["--repo", `app=${appU1}`, "--expect-repo", `app=${f.appCommit}`])).json;
    console.log(`    --advance: ${String(advanced.message)}`);
    const after = loadWorkflowState(f.project)!;
    assert.deepEqual(after.baseline_history, [f.workflowCommit, f.workflowCommit]);
    assert.deepEqual(after.baseline_repos, { app: appU1 });
    assert.deepEqual(after.baseline_repos_history, { app: { start: 0, commits: [f.appCommit, appU1] } });
    assert.match(stateText(f.project), new RegExp(`^- Baseline Repos History: app=@0:${f.appCommit}\\+${appU1}$`, "m"));
    assert.match(auditText(f.project), /- Event: BASELINE_COMMIT_ADVANCED[\s\S]*- To Repos: app=[0-9a-f]{40}[\s\S]*- Repos Moved: app=yes/);
    assert.equal(sha256(f.project, BASELINE_PATH), baselineSha, "the epoch-0 BASELINE evidence is byte-identical");
    assert.equal(gate(f.project, TDD, "baseline-test-evidence", ["--drift"]), "", "the epoch-0 BASELINE still passes its by-epoch re-check");
    checks.expect("epoch-0 BASELINE as a current-epoch BASELINE", gate(f.project, TDD, "baseline-test-evidence", ["--drift", "--current-epoch"]), /is epoch 0 of the baseline chain, but the current epoch is/);
    // Every baseline_commit field holds the workflow repository commit.
    for (const path of listEvidence(join(f.project, ".aidlc", "evidence"))) {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.baseline_commit !== undefined) assert.match(String(value.baseline_commit), /^[0-9a-f]{40}$/, path);
    }
    checks.assertAll();
  });

  // ------------------------------------------------------------------ declarations (fail closed)
  await section("negative: invalid nested declarations are refused (plain dir, sub-directory of a repository, tracked by the workflow repo, junction/symlink, nested in nested, manifest object, extra registered key)", () => {
    const checks = rejections();
    const create = (name: string, roots: unknown[], prepare?: (f: NestedFixture) => void): string => {
      const f = nestedRepository(name, roots);
      prepare?.(f);
      const result = run(f.project, ["orchestrate", "next", "--scope", "refactor", "--work", "nested declaration"]);
      const output = rejected(result);
      if (output) assert.equal(existsSync(join(f.project, "aidlc", "active", "aidlc-state.md")), false, `${name}: a refused next --scope writes no state`);
      return output;
    };
    checks.expect("plain directory of the workflow repository", create("plain-dir", [{ path: "lib", repo: "nested" }], (f) => write(f.project, "lib/util.py", "# REQ-001\n")), /nested repository lib\/ is not a git repository root: lib\/\.git does not exist/);
    checks.expect("sub-directory of the nested repository", create("sub-dir", [{ path: "app/pkg", repo: "nested" }], (f) => write(f.app, "pkg/mod.py", "# REQ-001\n")), /nested repository app\/pkg\/ is not a git repository root/);
    checks.expect("missing directory", create("missing", [{ path: "web", repo: "nested" }]), /nested repository web\/ does not exist/);
    checks.expect("also tracked by the workflow repository", create("tracked", [{ path: "app", repo: "nested" }], (f) => {
      // The workflow repository tracked app/legacy.txt before app/ became its own repository.
      const blobId = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: f.project, input: "legacy\n", encoding: "utf8" }).stdout.trim();
      git(f.project, ["update-index", "--add", "--cacheinfo", `100644,${blobId},app/legacy.txt`]);
      git(f.project, ["commit", "-qm", "w2 track app/legacy.txt"], "2024-01-02T00:00:00Z");
    }), /nested repository app\/ is also tracked by the workflow repository \(app\/legacy\.txt\)/);
    checks.expect("junction / symbolic link", create("link", [{ path: "linked", repo: "nested" }], (f) => {
      symlinkSync(f.app, join(f.project, "linked"), "junction");
    }), /linked is a symbolic link or junction/);
    checks.expect("nested repositories containing each other", create("contain", [{ path: "app", repo: "nested" }, { path: "app/inner", repo: "nested" }], (f) => {
      const inner = join(f.app, "inner");
      mkdirSync(inner, { recursive: true });
      git(inner, ["init", "-q"]);
      write(inner, "x.py", "# REQ-001\n");
      git(inner, ["add", "-A"]);
      git(inner, ["commit", "-qm", "inner"]);
    }), /nested repository app\/inner\/ lies inside the nested repository app\//);
    checks.expect("object entry with an unknown key", create("bad-object", [{ path: "app", repo: "nested", extra: true }]), /an object source root must have exactly the keys \\?"path\\?" and \\?"repo\\?"/);
    checks.expect("object entry with another repo kind", create("bad-repo", [{ path: "app", repo: "submodule" }]), /repo must be \\?"nested\\?", got \\?"submodule\\?"/);

    // module-manifest paths: objects are refused explicitly.
    const manifest = nestedRepository("manifest-object", [{ path: "app", repo: "nested" }]);
    write(manifest.project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: "m01", name: "M", service_id: "s", paths: [{ path: "app", repo: "nested" }] }] })}\n`);
    ok(manifest.project, ["orchestrate", "next", "--scope", "refactor", "--work", "manifest"]);
    checks.expect("module-manifest paths object entry", rejected(run(manifest.project, ["orchestrate", "next"])) || run(manifest.project, ["runtime", "summary"]).out, /modules\[0\]\.paths\[0\] must be a string: nested git repositories are declared only in \.aidlc\/source-roots\.json/);

    // Extra registered key: app registered, then dropped from source-roots.json.
    const extra = nestedRepository("extra-key", [{ path: "app", repo: "nested" }]);
    assert.equal(rejected(toI13(extra, ONE_UCD)), "");
    write(extra.project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
    const revision = loadWorkflowState(extra.project)!.revision;
    checks.expect("gate with an extra registered key", gate(extra.project, "test-case-derivation@module:project", "test-case-derivation"), /registers nested repositories that \.aidlc\/source-roots\.json no longer declares: app\//);
    checks.expect("--set with an extra registered key", rejected(run(extra.project, ["orchestrate", "baseline", "--set", extra.workflowCommit, "--replace", "--expect", extra.workflowCommit, "--repo", `app=${extra.appCommit}`, "--user-input", "Approve", "--reason", "x"])), /names no nested repository declared|no longer declares: app\//);
    checks.expect("--advance with an extra registered key", rejected(run(extra.project, ["orchestrate", "baseline", "--advance", extra.workflowCommit, "--expect", extra.workflowCommit, "--user-input", "Approve", "--reason", "x"])), /no longer declares: app\//);
    const shown = ok(extra.project, ["orchestrate", "baseline"]).json;
    assert.match(String(shown.message), /Registered but no longer declared in \.aidlc\/source-roots\.json: app\//);
    assert.equal(loadWorkflowState(extra.project)!.revision, revision, "refused operations write no state");
    // Loading the state only checks the format: a well-formed extra key loads fine (shown above).
    checks.assertAll();
  });

  // ------------------------------------------------------------------ dirty nested repositories
  await section("dirty: next --scope refused (nothing written); --set without --repo refused; --set --repo allowed with dirty audited; nested repository without commits refused", () => {
    const checks = rejections();
    const f = nestedRepository("dirty", [{ path: "app", repo: "nested" }]);
    write(f.app, "scratch.txt", "untracked\n");
    checks.expect("next --scope with an untracked file in app/", rejected(run(f.project, ["orchestrate", "next", "--scope", "refactor", "--work", "dirty"])), /app\/ has uncommitted or untracked changes[\s\S]*Nothing was written/);
    assert.equal(existsSync(join(f.project, "aidlc")), false, "no state and no audit were written");
    rmSync(join(f.app, "scratch.txt"));
    ok(f.project, ["orchestrate", "next", "--scope", "refactor", "--work", "dirty"]);
    stripBaseline(f.project);
    assert.equal(loadWorkflowState(f.project)!.baseline_commit, undefined, "the fixture simulates a workflow without baseline");
    write(f.app, "exporter.py", `${EXPORTER}# local edit\n`);
    const revision = loadWorkflowState(f.project)!.revision;
    checks.expect("--set without --repo while app/ is dirty", rejected(run(f.project, SET(f.workflowCommit))), /Cannot take the HEAD of the nested repositories as their baseline: app\/ has uncommitted or untracked changes/);
    assert.equal(loadWorkflowState(f.project)!.revision, revision);
    const set = ok(f.project, SET(f.workflowCommit, ["--repo", `app=${f.appCommit}`])).json;
    assert.deepEqual(set.baseline_repos, { app: f.appCommit });
    assert.match(auditText(f.project), new RegExp(`- Event: BASELINE_COMMIT_SET[\\s\\S]*- Repos: app=${f.appCommit}\\n- Repo Dirty: app=yes`));
    console.log(`    --set --repo (dirty): ${String(set.message)}`);

    const empty = nestedRepository("no-commit", [{ path: "app", repo: "nested" }]);
    const fresh = join(empty.project, "web");
    mkdirSync(fresh, { recursive: true });
    git(fresh, ["init", "-q"]);
    write(empty.project, ".gitignore", "app/\nweb/\n");
    git(empty.project, ["add", ".gitignore"]);
    git(empty.project, ["commit", "-qm", "w2 ignore web"], "2024-01-02T00:00:00Z");
    write(empty.project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: [{ path: "app", repo: "nested" }, { path: "web", repo: "nested" }] })}\n`);
    checks.expect("next --scope with a nested repository without commits", rejected(run(empty.project, ["orchestrate", "next", "--scope", "refactor", "--work", "no commit"])), /web\/ has no commit yet/);
    assert.equal(existsSync(join(empty.project, "aidlc")), false);
    checks.assertAll();
  });

  // ------------------------------------------------------------------ acceptance A (+ C, D)
  await section("A: advanced split workflow (u1/u2 done with 4.8.1-structure evidence) migrates with one command; u3 characterizes app/ to implementation-report; C refusals; D legacy/new re-check isolation", () => {
    const checks = rejections();
    const f = splitFixture("acceptance-a");
    f.writeCases([UCD_A, UCD_B]);
    f.step(["orchestrate", "report", "--stage", "test-case-derivation", "--module", M01, "--result", "completed"]);
    const i13Legacy = readJson(f.project, SPLIT_I13);
    assert.equal(i13Legacy.baseline_repos, undefined, "4.8.1-structure I13 before the declaration");

    // ---- step 2: u1 tdd → code-generation → code-review, --advance; u2 tdd → code-generation.
    f.nextModule(`tdd@module:${M01}@unit:u1`, [TCD]);
    assert.equal(rejected(f.reportUnit("tdd", "u1")), "");
    f.nextModule(`code-generation@module:${M01}@unit:u1`, [TCD]);
    write(f.project, "lib/a.py", `${LIB_A}# REQ-001 u1: traced (comment only)\n`);
    splitImplement(f, "u1", UCD_A.id);
    git(f.project, ["add", "lib", "tests", "docs"]);
    git(f.project, ["commit", "-qm", "c2 u1"], "2024-01-04T00:00:00Z");
    const u1Commit = git(f.project, ["rev-parse", "HEAD"]);
    assert.equal(rejected(f.reportUnit("code-generation", "u1")), "");
    f.nextModule(`code-review@module:${M01}@unit:u1`);
    splitReview(f, "u1", UCD_A.id, "lib/a.py");
    assert.equal(rejected(f.reportUnit("code-review", "u1")), "");
    f.step(["orchestrate", "baseline", "--advance", u1Commit, "--expect", f.epoch0, "--user-input", "Approve", "--reason", "u1 已完成并提交"]);
    f.nextModule(`tdd@module:${M01}@unit:u2`, [TCD]);
    assert.equal(rejected(f.reportUnit("tdd", "u2")), "");
    f.nextModule(`code-generation@module:${M01}@unit:u2`, [TCD]);
    write(f.project, "lib/b.py", `${LIB_B}# REQ-001 u2: traced (comment only)\n`);
    splitImplement(f, "u2", UCD_B.id);
    git(f.project, ["add", "lib", "tests", "docs"]);
    git(f.project, ["commit", "-qm", "c3 u2"], "2024-01-05T00:00:00Z");
    assert.equal(rejected(f.reportUnit("code-generation", "u2")), "");
    const legacyFiles = unitEvidence(f.project, ["u1", "u2"]);
    for (const path of legacyFiles) {
      const value = readJson(f.project, path);
      assert.equal(value.source_revision?.repos, undefined, `${path} has the 4.8.1 structure`);
      assert.equal(value.baseline_repos, undefined, `${path} has the 4.8.1 structure`);
    }
    const before = hashes(f.project, [...legacyFiles, SPLIT_I13]);
    const probes = () => ({
      u1Baseline: gate(f.project, `tdd@module:${M01}@unit:u1`, "baseline-test-evidence", ["--module", M01, "--drift"]),
      u2Baseline: gate(f.project, `tdd@module:${M01}@unit:u2`, "baseline-test-evidence", ["--module", M01, "--drift"]),
      u1Green: gate(f.project, `code-generation@module:${M01}@unit:u1`, "green-test-evidence", ["--module", M01, "--drift"]),
      u2Green: gate(f.project, `code-generation@module:${M01}@unit:u2`, "green-test-evidence", ["--module", M01, "--drift"]),
    });
    const probesBefore = probes();
    assert.deepEqual(probesBefore, { u1Baseline: "", u2Baseline: "", u1Green: "", u2Green: "" }, JSON.stringify(probesBefore, null, 2));
    const attestArgs = ["attest", "resolve", "--base", f.epoch0, "--head", "HEAD", "--as-of", "2026-10-06T00:00:00Z"];
    const attestBefore = ok(f.project, attestArgs).json;

    // ---- step 3: declare app/ nested → pending migration.
    write(f.project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["lib", { path: "app", repo: "nested" }] })}\n`);
    assert.deepEqual(probes(), probesBefore, "completed u1/u2 re-checks are unchanged by the declaration");
    const reattest = run(f.project, ["orchestrate", "report", "--stage", "code-generation", ...unitArgs("u2"), "--result", "completed"]);
    assert.equal(rejected(reattest), "", reattest.out);
    assert.equal(reattest.json.reattested, true, reattest.out);
    const attestAfter = ok(f.project, attestArgs).json;
    assert.deepEqual(attestAfter.nested_source_roots, ["app"], "attest hints the declared nested repository");
    const { nested_source_roots: _hint, ...attestAfterRest } = attestAfter;
    assert.deepEqual(JSON.parse(JSON.stringify(attestAfterRest).split(f.project.replace(/\\/g, "\\\\")).join("<p>")), JSON.parse(JSON.stringify(attestBefore).split(f.project.replace(/\\/g, "\\\\")).join("<p>")), "attest resolve is unchanged apart from the hint");
    // u2 code-review (not involving app/) completes in the pending state; its evidence records repos.app.
    f.nextModule(`code-review@module:${M01}@unit:u2`);
    splitReview(f, "u2", UCD_B.id, "lib/b.py");
    assert.equal(rejected(f.reportUnit("code-review", "u2")), "");
    const u2Review = readJson(f.project, `.aidlc/evidence/code-review/${M01}/u2/review-evidence.json`);
    assert.equal(u2Review.source_revision.repos.app.commit, f.appCommit, "new evidence records repos.app in the pending state");
    const shown = ok(f.project, ["orchestrate", "baseline"]).json;
    assert.deepEqual(shown.pending_nested_repos, ["app"]);
    console.log(`    pending: ${String(shown.migration_command)}`);
    const doctor = ok(f.project, ["runtime", "doctor"]).json;
    assert.match(JSON.stringify(doctor), /app\/ is declared as a nested source repository but the workflow baseline has no commit for it/);
    // I13 that points into app/ is refused with the migration command (and nothing is written).
    f.writeCases([UCD_A, UCD_B, UCD_APP]);
    const pendingI13 = rejected(run(f.project, ["evidence", "run", ...TCD, "--refresh"]));
    console.log(`    pending I13 (producer tail): ${pendingI13.trim().split(/\r?\n/).filter(Boolean).pop()}`);
    checks.expect("I13 into app/ while pending", pendingI13, /--repo app=[0-9a-f]{40} --user-input Approve --reason "\.\.\." \(pending migration of app\/; orchestrate baseline prints this command\)/);
    // The full refusal (reason + command) as the I13 gate reports it on the same input:
    assert.match(String(shown.migration_command), /^loeyae-aidlc orchestrate baseline --set [0-9a-f]{40} --replace --expect [0-9a-f]{40} --repo app=[0-9a-f]{40} --user-input Approve --reason "\.\.\."$/);
    f.writeCases([UCD_A, UCD_B]);
    checks.expect("--advance while pending", rejected(run(f.project, ["orchestrate", "baseline", "--advance", u1Commit, "--expect", u1Commit, "--user-input", "Approve", "--reason", "x"])), /app\/ is declared as a nested source repository but the workflow baseline has no commit for it/);
    // D: an uncommitted change in app/ leaves the legacy evidence's re-check unchanged; the new evidence notices it.
    const legacyGate = () => gate(f.project, `code-generation@module:${M01}@unit:u2`, "green-test-evidence", ["--module", M01]);
    const legacyBeforeDrift = legacyGate();
    assert.equal(gate(f.project, `code-review@module:${M01}@unit:u2`, "review-evidence", ["--module", M01]), "", "new evidence passes before the app/ change");
    write(f.app, "exporter.py", `${EXPORTER}# drift\n`);
    assert.equal(legacyGate(), legacyBeforeDrift, "D: legacy GREEN (no repos) keeps the 4.8.1 algorithm — the app/ change does not alter its re-check");
    assert.doesNotMatch(legacyBeforeDrift, /source_revision\.repos|nested repositor/, "D: the legacy re-check never mentions nested repositories");
    const newDrift = gate(f.project, `code-review@module:${M01}@unit:u2`, "review-evidence", ["--module", M01]);
    console.log(`    D new evidence: ${(/source_revision\.scope_digest[^;\n]*/.exec(newDrift) || [newDrift])[0]}`);
    checks.expect("D: new evidence with repos after an app/ change", newDrift, /source_revision\.scope_digest no longer matches the module:m01-trade scope/);
    git(f.app, ["checkout", "--", "exporter.py"]);
    assert.equal(gate(f.project, `code-review@module:${M01}@unit:u2`, "review-evidence", ["--module", M01]), "");

    // C: migration refusals (state revision unchanged).
    const MIGRATE = (extra: string[] = [], commit = u1Commit) => ["orchestrate", "baseline", "--set", commit, "--replace", "--expect", u1Commit, "--repo", `app=${f.appCommit}`, "--user-input", "Approve", "--reason", "登记嵌套仓库 app/", ...extra];
    const revision = loadWorkflowState(f.project)!.revision;
    checks.expect("C: different workflow commit", rejected(run(f.project, MIGRATE([], f.epoch0))), /advanced baseline chain is append-only and cannot be replaced/);
    write(f.project, `.aidlc/evidence/tdd/${M01}/zz-corrupt.json`, "{ not json");
    checks.expect("C: unparseable evidence", rejected(run(f.project, MIGRATE())), /zz-corrupt\.json: cannot be parsed .*treated as referencing/);
    rmSync(join(f.project, `.aidlc/evidence/tdd/${M01}/zz-corrupt.json`));
    assert.equal(loadWorkflowState(f.project)!.revision, revision, "refused migrations write nothing");
    const dry = ok(f.project, MIGRATE(["--dry-run"])).json;
    assert.equal(dry.dry_run, true);

    // ---- step 4: one restricted migration command.
    const migrated = ok(f.project, MIGRATE()).json;
    console.log(`    migration: ${String(migrated.message)}`);
    const state = loadWorkflowState(f.project)!;
    assert.equal(state.baseline_commit, u1Commit, "workflow commit unchanged");
    assert.deepEqual(state.baseline_history, [f.epoch0, u1Commit], "Baseline History unchanged");
    assert.equal(state.baseline_source, "advanced", "Baseline Source unchanged");
    assert.deepEqual(state.baseline_repos, { app: f.appCommit });
    assert.deepEqual(state.baseline_repos_history, { app: { start: 1, commits: [f.appCommit] } }, "app starts at the current epoch");
    assert.match(stateText(f.project), new RegExp(`^- Baseline Repos History: app=@1:${f.appCommit}$`, "m"));
    assert.match(auditText(f.project), new RegExp(`- Event: BASELINE_REPOS_REGISTERED[\\s\\S]*- Repos: app=${f.appCommit}\\n- Start Epoch: 1[\\s\\S]*- Evidence Scan: no evidence refers to app/`));
    checks.expect("C: modifying a registered key", rejected(run(f.project, ["orchestrate", "baseline", "--set", u1Commit, "--replace", "--expect", u1Commit, "--expect-repo", `app=${f.appCommit}`, "--repo", `app=${git(f.app, ["commit-tree", `${f.appCommit}^{tree}`, "-p", f.appCommit, "-m", "x"])}`, "--user-input", "Approve", "--reason", "x"])), /advanced baseline chain is append-only and cannot be replaced/);
    assert.deepEqual(probes(), probesBefore, "completed u1/u2 re-checks still pass after the migration");

    // ---- step 5: I13 gains characterizations into app/ for u3 and u4 (refresh of I13 only).
    f.writeCases([UCD_A, UCD_B, UCD_APP, UCD_APP2]);
    f.step(["evidence", "run", ...TCD, "--refresh"]);
    const i13 = readJson(f.project, SPLIT_I13);
    const appBlob = git(f.app, ["rev-parse", `${f.appCommit}:exporter.py`]);
    assert.equal(i13.baseline_commit, f.epoch0, "I13 binds epoch 0 of the workflow repository");
    assert.deepEqual(i13.baseline_repos, { app: f.appCommit }, "I13 binds app at its start epoch");
    assert.deepEqual(i13.characterization.find((entry: Json) => entry.ucd === UCD_APP.id).code_refs, [{ path: "app/exporter.py", symbol: "paginate", repo: "app", baseline_blob: appBlob }]);
    assert.equal(i13.characterization.find((entry: Json) => entry.ucd === UCD_A.id).code_refs[0].repo, ".");
    assert.equal(gate(f.project, `test-case-derivation@module:${M01}`, "test-case-derivation", ["--module", M01]), "", "the refreshed I13 passes its gate");
    assert.deepEqual(probes(), probesBefore, "completed u1/u2 re-checks still pass after the I13 refresh");
    assert.deepEqual(hashes(f.project, legacyFiles), Object.fromEntries(legacyFiles.map((path) => [path, before[path]])), "u1/u2 evidence bytes unchanged (steps 2–5)");
    ok(f.project, ["unit", "select", "--module", M01, "--unit", "u3", "--member", "alice", "--branch", "feat/u3"]);
    const worktreeTarget = join(scratch, `wt-${counter}-u3`);
    const branchesBefore = git(f.project, ["branch", "--list"]);
    const prepare = rejected(run(f.project, ["worktree", "prepare", "--instance", `code-generation@module:${M01}@unit:u3`, "--member", "alice", "--path", worktreeTarget]));
    console.log(`    u3 worktree prepare: ${(/worktree prepare cannot isolate[^\n]*/.exec(prepare) || [prepare.slice(-400)])[0]}`);
    checks.expect("u3 worktree prepare (code_ref)", prepare, /worktree prepare cannot isolate code-generation@module:m01-trade@unit:u3: it involves the nested source repository app\/ \(code_ref app\/exporter\.py\)/);
    assert.equal(existsSync(worktreeTarget), false, "no worktree directory is left behind");
    assert.equal(git(f.project, ["branch", "--list"]), branchesBefore, "no branch is created");
    assert.equal(git(f.project, ["worktree", "list"]).split(/\r?\n/).length, 1, "git worktree list is unchanged");

    // ---- step 6: u3 BASELINE (repo app) → GREEN (repos.app) → code-review → integration.
    f.nextModule(`tdd@module:${M01}@unit:u3`);
    assert.equal(rejected(f.reportUnit("tdd", "u3")), "");
    const u3Baseline = readJson(f.project, UNIT_BASE("u3"));
    assert.equal(u3Baseline.baseline_commit, u1Commit);
    assert.deepEqual(u3Baseline.baseline_repos, { app: f.appCommit });
    assert.deepEqual(u3Baseline.code_ref_digests, [{ path: "app/exporter.py", repo: "app", baseline_blob: appBlob, worktree_blob: appBlob }]);
    f.nextModule(`code-generation@module:${M01}@unit:u3`, [TCD]);
    write(f.app, "exporter.py", `${EXPORTER}# REQ-001 u3: traced (comment only)\n`);
    git(f.app, ["add", "-A"]);
    git(f.app, ["commit", "-qm", "a2 u3"], "2024-01-06T00:00:00Z");
    const appU3 = git(f.app, ["rev-parse", "HEAD"]);
    splitImplement(f, "u3", UCD_APP.id);
    const u3Generated = f.reportUnit("code-generation", "u3");
    assert.equal(rejected(u3Generated), "", u3Generated.out);
    assert.equal(readJson(f.project, UNIT_GREEN("u3")).source_revision.repos.app.commit, appU3);
    f.nextModule(`code-review@module:${M01}@unit:u3`);
    splitReview(f, "u3", UCD_APP.id, "app/exporter.py");
    assert.equal(rejected(f.reportUnit("code-review", "u3")), "");
    assert.deepEqual(hashes(f.project, legacyFiles), Object.fromEntries(legacyFiles.map((path) => [path, before[path]])), "u1/u2 evidence bytes unchanged through u3");

    // ---- u4 shares app/exporter.py with u3: BASELINE refused until --advance --repo app=<u3 commit>.
    f.nextModule(`tdd@module:${M01}@unit:u4`, [TCD]);
    const u4Refused = rejected(f.reportUnit("tdd", "u4"));
    checks.expect("u4 BASELINE after u3 changed app/exporter.py", u4Refused, /BASELINE refuses to run: code ref app\/exporter\.py changed since the baseline [0-9a-f]{40} of the nested repository app\//);
    assert.equal(existsSync(join(f.project, UNIT_BASE("u4"))), false);
    const u3Green = readJson(f.project, UNIT_GREEN("u3"));
    const u3BaselineSha = sha256(f.project, UNIT_BASE("u3"));
    const ADVANCE = (repo: string[]) => ["orchestrate", "baseline", "--advance", u3Green.source_revision.commit, "--expect", u1Commit, "--expect-repo", `app=${f.appCommit}`, ...repo, "--user-input", "Approve", "--reason", "u3 已在 app/ 提交"];
    checks.expect("--advance omitting --repo", rejected(run(f.project, ADVANCE([]))), /--advance must name the target of every registered nested repository explicitly/);
    checks.expect("--advance with an app/ commit no GREEN anchors", rejected(run(f.project, ADVANCE(["--repo", `app=${f.appCommit}`]))), /is not the source_revision\.commit \(with source_revision\.repos\.app\.commit [0-9a-f]{40}\) of the controlled GREEN evidence/);
    const advanced = ok(f.project, ADVANCE(["--repo", `app=${appU3}`])).json;
    console.log(`    --advance (A, u3 → u4): ${String(advanced.message)}`);
    const chainState = loadWorkflowState(f.project)!;
    assert.deepEqual(chainState.baseline_history, [f.epoch0, u1Commit, u3Green.source_revision.commit]);
    assert.deepEqual(chainState.baseline_repos_history, { app: { start: 1, commits: [f.appCommit, appU3] } });
    assert.equal(rejected(f.reportUnit("tdd", "u4")), "");
    const u4Baseline = readJson(f.project, UNIT_BASE("u4"));
    const appU3Blob = git(f.app, ["rev-parse", `${appU3}:exporter.py`]);
    assert.deepEqual(u4Baseline.baseline_repos, { app: appU3 }, "u4 BASELINE binds the new epoch of app/");
    assert.deepEqual(u4Baseline.code_ref_digests, [{ path: "app/exporter.py", repo: "app", baseline_blob: appU3Blob, worktree_blob: appU3Blob }]);
    assert.equal(sha256(f.project, UNIT_BASE("u3")), u3BaselineSha, "u3 BASELINE evidence is byte-identical");
    assert.equal(gate(f.project, `tdd@module:${M01}@unit:u3`, "baseline-test-evidence", ["--module", M01, "--drift"]), "", "u3 BASELINE passes its re-check at its own epoch (1)");
    checks.expect("u3 BASELINE relabelled to the new epoch", gate(f.project, `tdd@module:${M01}@unit:u3`, "baseline-test-evidence", ["--module", M01, "--drift", "--current-epoch"]), /is epoch 1 of the baseline chain, but the current epoch is/);
    assert.deepEqual(probes(), probesBefore, "u1/u2 re-checks still pass after the nested --advance");
    f.nextModule(`code-generation@module:${M01}@unit:u4`, [TCD]);
    write(f.app, "exporter.py", `${EXPORTER}# REQ-001 u3: traced (comment only)\n# REQ-001 u4: traced (comment only)\n`);
    git(f.app, ["add", "-A"]);
    git(f.app, ["commit", "-qm", "a3 u4"], "2024-01-07T00:00:00Z");
    splitImplement(f, "u4", UCD_APP2.id);
    const u4Generated = f.reportUnit("code-generation", "u4");
    assert.equal(rejected(u4Generated), "", u4Generated.out);
    f.nextModule(`code-review@module:${M01}@unit:u4`);
    splitReview(f, "u4", UCD_APP2.id, "app/exporter.py");
    assert.equal(rejected(f.reportUnit("code-review", "u4")), "");
    assert.equal(f.step(["orchestrate", "next", "--module", M01]).json.kind, "done", "module workflow resolved");
    assert.deepEqual(hashes(f.project, legacyFiles), Object.fromEntries(legacyFiles.map((path) => [path, before[path]])), "u1/u2 evidence bytes unchanged through u4");
    const integration = run(f.project, ["orchestrate", "next"]);
    console.log(`    integration next without refresh: ${integration.json.kind === "error" ? String(integration.json.message).split("\n").slice(0, 3).join(" | ") : integration.json.stage_instance}`);
    integrationRun(f, integration);
    checks.assertAll();
  });

  // ------------------------------------------------------------------ acceptance B (+ C, C2, B2)
  await section("B/C/C2/B2: never-advanced single workflow migrates at epoch 0; key-set and registered-key refusals; a later web/ repository is pending alone and registered alone; attest refuses changed_path / evidence_repos", () => {
    const checks = rejections();
    const f = nestedRepository("acceptance-b", ["lib", "app"]);
    write(f.project, "lib/a.py", LIB_A);
    git(f.project, ["add", "lib/a.py"]);
    git(f.project, ["commit", "-qm", "w2 lib"], "2024-01-02T00:00:00Z");
    const main = git(f.project, ["rev-parse", "HEAD"]);
    const reported = toI13(f, [{ id: "UC-D-001", codeRef: "lib/a.py::alpha" }]);
    assert.equal(rejected(reported), "", reported.out);
    write(f.project, "tests/observe_uc.cjs", OBSERVER.replace('readFileSync("app/exporter.py", "utf8")', 'readFileSync("lib/a.py", "utf8")').replace("def paginate\\(rows, size=50\\)", "def alpha\\(rows, size=50\\)"));
    refresh(f.project, "test-case-derivation@module:project");
    nextIs(f.project, TDD);
    ok(f.project, ["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
    const legacyBaseline = readJson(f.project, BASELINE_PATH);
    assert.equal(legacyBaseline.baseline_repos, undefined);
    assert.equal(legacyBaseline.source_revision.repos, undefined);
    const legacySha = sha256(f.project, BASELINE_PATH);
    assert.equal(loadWorkflowState(f.project)!.baseline_repos, undefined, "4.8.1-style workflow: no nested repositories");
    const attestArgs = ["attest", "resolve", "--base", f.workflowCommit, "--head", "HEAD", "--as-of", "2026-10-06T00:00:00Z"];
    const scrub = (value: unknown) => JSON.parse(JSON.stringify(value).split(f.project.replace(/\\/g, "\\\\")).join("<p>"));
    const attestPlain = scrub(ok(f.project, attestArgs).json);

    // Declare app/ nested → pending; the legacy BASELINE still passes its exact re-check.
    const roots = (list: unknown[]) => write(f.project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: list })}\n`);
    roots(["lib", { path: "app", repo: "nested" }]);
    assert.equal(gate(f.project, TDD, "baseline-test-evidence"), "", "legacy BASELINE (no repos) passes after the declaration");
    const { nested_source_roots: hint, ...attestNested } = ok(f.project, attestArgs).json;
    assert.deepEqual(hint, ["app"]);
    assert.deepEqual(scrub(attestNested), attestPlain, "B2: attest with only workflow-repository paths and evidence without repos is unchanged (apart from the hint)");
    const attestPath = rejected(run(f.project, [...attestArgs, "--path", "app/exporter.py"])) || ok(f.project, [...attestArgs, "--path", "app/exporter.py"]).out;
    console.log(`    B2 changed_path: ${(/attest resolve does not support nested source repositories yet[^"]*/.exec(attestPath) || [attestPath.slice(-300)])[0]}`);
    checks.expect("B2: attest --path app/exporter.py", attestPath, /attest resolve does not support nested source repositories yet: app\/ \(changed_path app\/exporter\.py\)/);

    // C: key set mismatch (web/ declared too, only app passed).
    const web = join(f.project, "web");
    mkdirSync(web, { recursive: true });
    git(web, ["init", "-q"]);
    write(web, "index.js", "// REQ-001 web client\nexport const label = 'Export orders';\n");
    git(web, ["add", "-A"]);
    git(web, ["commit", "-qm", "b1 web"], "2024-01-01T00:00:00Z");
    const webCommit = git(web, ["rev-parse", "HEAD"]);
    write(f.project, ".git/info/exclude", "web/\n");
    const MIGRATE = (repos: string[], extra: string[] = []) => ["orchestrate", "baseline", "--set", main, "--replace", "--expect", main, ...repos.flatMap((repo) => ["--repo", repo]), ...extra, "--user-input", "Approve", "--reason", "登记嵌套仓库"];
    const revision = loadWorkflowState(f.project)!.revision;
    roots(["lib", { path: "app", repo: "nested" }, { path: "web", repo: "nested" }]);
    checks.expect("C: key set differs from the declaration", rejected(run(f.project, MIGRATE([`app=${f.appCommit}`]))), /would be app, but \.aidlc\/source-roots\.json declares app, web; also pass --repo for web/);
    roots(["lib", { path: "app", repo: "nested" }]);
    assert.equal(loadWorkflowState(f.project)!.revision, revision);

    // B: one migration command at epoch 0 (never advanced: Baseline Repos only).
    const migrated = ok(f.project, MIGRATE([`app=${f.appCommit}`])).json;
    console.log(`    B migration: ${String(migrated.message)}`);
    const state = loadWorkflowState(f.project)!;
    assert.equal(state.baseline_commit, main);
    assert.equal(state.baseline_source, "created");
    assert.equal(state.baseline_history, undefined);
    assert.deepEqual(state.baseline_repos, { app: f.appCommit });
    assert.equal(state.baseline_repos_history, undefined, "epoch 0: no Baseline Repos History");
    assert.match(auditText(f.project), /- Event: BASELINE_REPOS_REGISTERED[\s\S]*- Start Epoch: 0/);
    assert.equal(sha256(f.project, BASELINE_PATH), legacySha);
    assert.equal(gate(f.project, TDD, "baseline-test-evidence"), "", "legacy BASELINE passes after the migration");
    const child = git(f.app, ["commit-tree", `${f.appCommit}^{tree}`, "-p", f.appCommit, "-m", "child"]);
    const revision2 = loadWorkflowState(f.project)!.revision;
    checks.expect("C: modifying a registered key of a used baseline", rejected(run(f.project, MIGRATE([`app=${child}`], ["--expect-repo", `app=${f.appCommit}`]))), /is already in use and cannot be replaced/);
    checks.expect("C: changing the workflow commit with --repo", rejected(run(f.project, ["orchestrate", "baseline", "--set", f.workflowCommit, "--replace", "--expect", main, "--expect-repo", `app=${f.appCommit}`, "--repo", `app=${f.appCommit}`, "--user-input", "Approve", "--reason", "x"])), /is already in use and cannot be replaced/);
    assert.equal(loadWorkflowState(f.project)!.revision, revision2);

    // C2: web/ declared later → pending for web/ only.
    roots(["lib", { path: "app", repo: "nested" }, { path: "web", repo: "nested" }]);
    const shown = ok(f.project, ["orchestrate", "baseline"]).json;
    assert.deepEqual(shown.pending_nested_repos, ["web"]);
    write(f.project, `${CASES}/UC-D-002.md`, characterizationCase("UC-D-002", "app/exporter.py::paginate"));
    write(f.project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-001 订单导出（source_ref: REQ-001）\n- UC-D-002 订单导出（source_ref: REQ-001）\n");
    const I13_REFRESH = ["evidence", "run", "--stage", "test-case-derivation", "--instance", "test-case-derivation@module:project", "--sensor", "test-case-derivation", "--refresh"];
    ok(f.project, I13_REFRESH);
    assert.deepEqual(readJson(f.project, I13_PATH).baseline_repos, { app: f.appCommit }, "C2: an I13 into app/ is produced while only web/ is pending");
    write(f.project, `${CASES}/UC-D-003.md`, characterizationCase("UC-D-003", "web/index.js::label"));
    write(f.project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-001 订单导出（source_ref: REQ-001）\n- UC-D-002 订单导出（source_ref: REQ-001）\n- UC-D-003 订单导出（source_ref: REQ-001）\n");
    checks.expect("C2: an I13 into web/ while web/ is pending", rejected(run(f.project, I13_REFRESH)), /pending migration of web\/; orchestrate baseline prints this command/);
    rmSync(join(f.project, `${CASES}/UC-D-003.md`));
    write(f.project, `${CASES}/_index.md`, "# UC-D 索引\n\n- UC-D-001 订单导出（source_ref: REQ-001）\n- UC-D-002 订单导出（source_ref: REQ-001）\n");
    checks.expect("C2: re-registering app/ together with web/", rejected(run(f.project, MIGRATE([`app=${f.appCommit}`, `web=${webCommit}`], ["--expect-repo", `app=${f.appCommit}`]))), /is already in use and cannot be replaced/);
    const c2 = ok(f.project, MIGRATE([`web=${webCommit}`], ["--expect-repo", `app=${f.appCommit}`])).json;
    console.log(`    C2 migration: ${String(c2.message)}`);
    assert.deepEqual(loadWorkflowState(f.project)!.baseline_repos, { app: f.appCommit, web: webCommit });
    assert.deepEqual(ok(f.project, ["orchestrate", "baseline"]).json.pending_nested_repos, []);

    // B2: evidence recording source_revision.repos is refused by attest resolve.
    const produced = run(f.project, ["evidence", "run", "--stage", "tdd", "--sensor", "baseline-test-evidence"]);
    if (produced.status !== 0) ok(f.project, ["evidence", "run", "--stage", "tdd", "--instance", TDD, "--sensor", "baseline-test-evidence", "--refresh"]);
    assert.deepEqual(Object.keys(readJson(f.project, BASELINE_PATH).source_revision.repos), ["app", "web"]);
    git(f.project, ["add", "-A"]);
    git(f.project, ["commit", "-qm", "w3 evidence"], "2024-01-03T00:00:00Z");
    const attestRepos = rejected(run(f.project, attestArgs)) || ok(f.project, attestArgs).out;
    console.log(`    B2 evidence_repos: ${(/attest resolve does not support nested source repositories yet[^"]*/.exec(attestRepos) || [attestRepos.slice(-300)])[0]}`);
    checks.expect("B2: evidence with source_revision.repos", attestRepos, /attest resolve does not support nested source repositories yet: app\/ \(evidence_repos \.aidlc\/evidence\/tdd\/project\/default\/baseline-test-evidence\.json\)/);
    assert.match(attestRepos, /"status": "unverifiable"/);
    checks.assertAll();
  });
  // ------------------------------------------------------------------ E: no nested repositories ≡ 4.8.1
  await section("E: a project without nested repositories — CLI transcript, state and evidence structure equal the 4.8.1 engine (b3c7aa2)", () => {
    const engine = engine481();
    if (!engine) {
      console.log("    SKIP: commit b3c7aa2 (4.8.1) is not available in this repository");
      return;
    }
    assert.match(readFileSync(join(engine, "package.json"), "utf8"), /"version": "4\.8\.1"/, "the comparison engine is 4.8.1");
    const current = eFixture("e-current", repository);
    const previous = eFixture("e-481", engine);
    console.log(`    E: ${current.transcript.length} CLI steps, ${Object.keys(current.evidence).length} evidence files compared`);
    assert.deepEqual(current.transcript, previous.transcript, "normalized CLI transcript");
    assert.equal(current.state, previous.state, "normalized state file");
    assert.equal(current.audit, previous.audit, "normalized audit");
    assert.deepEqual(current.evidence, previous.evidence, "normalized evidence");
  });
  // ------------------------------------------------------------------ B1 worktree
  await section("B1: worktree — u1 (not involving app/) prepares with nested_repos_skipped and merge-plans; gates run in the main checkout; an I13 refresh adding app/ to u1 refuses merge-plan (code_ref)", () => {
    const checks = rejections();
    const f = splitFixture("worktree", ["lib", { path: "app", repo: "nested" }]);
    f.writeCases([UCD_A, UCD_B]);
    f.step(["orchestrate", "report", "--stage", "test-case-derivation", "--module", M01, "--result", "completed"]);
    assert.deepEqual(loadWorkflowState(f.project)!.baseline_repos, { app: f.appCommit });
    const U1 = `code-generation@module:${M01}@unit:u1`;
    ok(f.project, ["unit", "select", "--module", M01, "--unit", "u1", "--member", "alice", "--branch", "feat/u1"]);
    git(f.project, ["add", "-A"]);
    git(f.project, ["commit", "-qm", "c2 workflow state and evidence"], "2024-01-03T00:00:00Z");
    const worktree = join(scratch, `wt-${counter}-u1`);
    const prepared = ok(f.project, ["worktree", "prepare", "--instance", U1, "--member", "alice", "--path", worktree]).json;
    assert.deepEqual(prepared.nested_repos_skipped, ["app"]);
    assert.deepEqual(prepared.nested_source_roots, ["app"]);
    const metadataText = readdirSync(join(f.project, "aidlc", "active", "worktrees")).map((name) => readFileSync(join(f.project, "aidlc", "active", "worktrees", name), "utf8")).join("\n");
    assert.match(metadataText, /^- Nested Repos Skipped: app$/m);
    assert.equal(existsSync(join(worktree, "app")), false, "git worktree add does not check out the nested repository");
    // Verified first (4.9.0 pre-implementation run): gates run where `orchestrate` runs; a
    // worktree holding a committed copy of the workflow listed `app/` as a missing produce
    // because git worktree add skips the nested repository. Produces/consumes of a skipped
    // nested root are now judged in the main checkout; everything else is unchanged.
    const inWorktree = spawnSync(process.execPath, [tsx, probe, U1, "produces", "--module", M01], { cwd: worktree, encoding: "utf8", env: cleanEnv() });
    const inMain = spawnSync(process.execPath, [tsx, probe, U1, "produces", "--module", M01], { cwd: f.project, encoding: "utf8", env: cleanEnv() });
    const worktreeProduces = inWorktree.stdout.trim().split(/\r?\n/).pop() || inWorktree.stderr.trim().split(/\r?\n/).pop() || "";
    const mainProduces = inMain.stdout.trim().split(/\r?\n/).pop() || "";
    console.log(`    produces in worktree: ${worktreeProduces} | in main checkout: ${mainProduces}`);
    assert.equal(worktreeProduces, mainProduces, "the skipped app/ root is judged in the main checkout: same produces result");
    assert.doesNotMatch(worktreeProduces, /"app\/"/);
    write(worktree, "lib/a.py", `${LIB_A}# REQ-001 u1: traced in the worktree\n`);
    git(worktree, ["add", "lib/a.py"]);
    git(worktree, ["commit", "-qm", "wt u1"], "2024-01-04T00:00:00Z");
    write(worktree, ".aidlc/review.json", JSON.stringify({ status: "passed", spec_axis: "passed", standards_axis: "passed", issues_open: 0, files_reviewed: ["lib/a.py"] }));
    const PLAN = ["worktree", "merge-plan", "--instance", U1, "--member", "alice", "--path", worktree, "--review-evidence", ".aidlc/review.json"];
    const plan = ok(f.project, PLAN).json;
    assert.equal(plan.kind, "aidlc.aws-light.merge-plan");
    assert.deepEqual(plan.changed_paths, ["lib/a.py"]);
    assert.deepEqual(plan.nested_repos_skipped, ["app"]);
    const { nested_repos_skipped: _skipped, nested_source_roots: _roots, ...planCore } = plan;
    assert.deepEqual(Object.keys(planCore).sort(), ["authorized", "base_commit", "branch", "changed_paths", "head_commit", "kind", "member", "merge_command", "stage_instance", "workflow_id"], "merge-plan keeps the 4.8.1 structure");
    // After prepare, an I13 refresh gives u1 a characterization in app/: merge-plan refuses (code_ref).
    f.writeCases([UCD_A, UCD_B, { ...UCD_APP, unit: "u1" }]);
    f.step(["evidence", "run", ...TCD, "--refresh"]);
    const refused = rejected(run(f.project, PLAN));
    console.log(`    merge-plan after the I13 refresh: ${(/worktree merge-plan cannot isolate[^\n]*/.exec(refused) || [refused.slice(-300)])[0]}`);
    checks.expect("merge-plan after an I13 refresh into app/", refused, /worktree merge-plan cannot isolate code-generation@module:m01-trade@unit:u1: it involves the nested source repository app\/ \(code_ref app\/exporter\.py\)/);
    checks.assertAll();
  });
} finally {
  if (!process.env.AIDLC_KEEP_SCRATCH) rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${sections.length} section(s) passed${failed.length ? `, ${failed.length} failed: ${failed.join("; ")}` : ""}`);
if (failed.length > 0) process.exitCode = 1;
else console.log("4.9.0 nested repository tests passed");
