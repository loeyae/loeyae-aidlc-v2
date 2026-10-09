/**
 * 4.8.0 (MARS-75) regression suite: unit-scoped UC-D coverage (`unit_refs`).
 *
 * In the split layout a module with several units used to demand, at every unit's
 * tdd / code-generation, the UC-D set of the whole module: the first unit's GREEN had
 * to make every UC-D of the module pass. A UC-D now declares the units it belongs to
 * (`unit_refs`, frontmatter only); I13 records them as `ucd_units`; RED / BASELINE /
 * GREEN, test-quality, the traceability tests layer and the functional design check
 * the unit's own subset; build-and-test and the integration barrier reconcile the
 * module (every UC-D covered by the GREEN of every unit it names).
 *
 * Every fixture is driven through the public CLI (`orchestrate`, `evidence run`,
 * `check`) and the gate probe; evidence is only ever produced by the controlled
 * producer. Tampered evidence is restored byte for byte.
 *
 * AIDLC_ONLY=<substring> runs only the matching sections; AIDLC_TRANSCRIPT=<file>
 * writes the normalized transcript of the compatibility section (two units, no
 * unit_refs) so it can be compared with the 4.7.1 engine.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = process.env.AIDLC_TSX || join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-480-unit-scope-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const M01 = "m01-trade";
const ONLY = process.env.AIDLC_ONLY || "";

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Phase = "RED" | "GREEN" | "BASELINE";

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

interface Ucd {
  id: string;
  mode: "new" | "characterization";
  title: string;
  /** File the observer reads and the marker it must contain for the UC-D to pass. */
  file: string;
  marker: string;
  /** Frontmatter `unit_refs`; undefined = not declared. */
  unitRefs?: string[];
  /** characterization only: `path::symbol`. */
  codeRef?: string;
}

/** Legacy code committed before the workflow starts (epoch 0); every file is traced to REQ-001. */
const APP_INIT = "\"\"\"Order application package; every module implements REQ-001.\"\"\"\n";
const APP_A = "# REQ-001 alpha: legacy pagination helper\ndef alpha(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const APP_B = "# REQ-001 beta: legacy export helper\ndef beta(client):\n    return list(client.fetch_orders())\n";

function caseFile(ucd: Ucd, options: { bodyUnitRefs?: string } = {}): string {
  const lines = ["---", `id: ${ucd.id}`, "status: ready", "source_ref: REQ-001"];
  if (ucd.mode === "characterization") lines.push("tdd_mode: characterization", "code_refs:", `  - ${ucd.codeRef}`, "reason: 改动前锁定现有行为", "approval_ref: REVIEW-2026-10-05-01");
  else lines.push("tdd_mode: new");
  if (ucd.unitRefs !== undefined) lines.push(ucd.unitRefs.length === 0 ? "unit_refs: []" : `unit_refs: [${ucd.unitRefs.join(", ")}]`);
  lines.push("---", `# ${ucd.id} ${ucd.title}`, "", `Given REQ-001 的输入，When 执行 ${ucd.title}，Then 行为符合预期。`, "");
  if (options.bodyUnitRefs !== undefined) lines.push(`unit_refs: ${options.bodyUnitRefs}`, "");
  return lines.join("\n");
}

/** Body-only case file (no frontmatter block): the UC-D is named by the file name. */
function bodyOnlyCaseFile(ucd: Ucd, bodyUnitRefs: string): string {
  return `# ${ucd.id} ${ucd.title}\n\nstatus: ready\nsource_ref: REQ-001\nunit_refs: ${bodyUnitRefs}\n\nGiven REQ-001 的输入，When 执行 ${ucd.title}，Then 行为符合预期。\n`;
}

function testMethod(ucd: Ucd): string {
  return `tests/test_features.py::test_${ucd.id.toLowerCase().replace(/-/g, "_")}`;
}

function pythonTests(ucds: Ucd[]): string {
  const body = ucds.map((ucd) => `def ${testMethod(ucd).split("::")[1]}():\n    # ${ucd.id}\n    assert True\n`).join("\n\n");
  return `# REQ-001 ${ucds.map((ucd) => ucd.id).join(" ")}\n\n\n${body}`;
}

/**
 * Deterministic observer. `.aidlc/ucd-plan.json` (outside the revision digest, test
 * fixture input only) lists per unit and phase which UC-Ds the command observes; each
 * UC-D passes when its file contains its marker. AIDLC_ACTIVE_UNIT is exported by the
 * controlled producer; without it (build-and-test) the `*` entry is used.
 */
const OBSERVER = `const { existsSync, readFileSync } = require("node:fs");
const plan = JSON.parse(readFileSync(".aidlc/ucd-plan.json", "utf8"));
const phase = process.env.AIDLC_PHASE || "GREEN";
const unit = process.env.AIDLC_ACTIVE_UNIT || "*";
const ids = ((plan.phases[unit] || {})[phase]) || ((plan.phases["*"] || {})[phase]) || [];
const results = ids.map((id) => {
  const ucd = plan.ucds[id];
  return { id, test: ucd.test, pass: existsSync(ucd.file) && readFileSync(ucd.file, "utf8").includes(ucd.marker) };
});
const failing = results.filter((result) => !result.pass);
const observation = { phase, status: failing.length ? "failed" : "passed", compile_status: "passed", environment_status: "passed", tests_total: results.length, tests_failed: failing.length, traceability_complete: true, uc_mapping: results.map((result) => ({ use_case: result.id, test_methods: [result.test] })) };
if (failing.length) Object.assign(observation, { failure_class: "behavior", failure_signature: failing.map((result) => result.id + " not satisfied").join("; ") });
console.log(JSON.stringify(observation));
console.log(results.length - failing.length + " passed, " + failing.length + " failed");
process.exit(failing.length ? 1 : 0);
`;

/** Contract validation used as the `validation_command` of an empty-subset unit; logs every run. */
const CONTRACT_VALIDATOR = `const { appendFileSync, existsSync, readFileSync } = require("node:fs");
appendFileSync(".aidlc/contract-validation.log", (process.env.AIDLC_PHASE || "run") + "\\n");
if (existsSync(".aidlc/contract-broken")) { console.error("contract schema invalid"); process.exit(3); }
if (!/REQ-001/.test(readFileSync("app/contract.py", "utf8"))) process.exit(4);
console.log("contract ok");
`;

function allowlist(stage: string, commands: Array<{ id: string; role: string; argv: string[] }>): string {
  return `${JSON.stringify({ version: "1", stage, commands }, null, 2)}\n`;
}

const OBSERVE = ["node", "tests/observe_uc.cjs"];
const VALIDATE = ["node", "tests/validate_contract.cjs"];
const EXEMPTION = { reason_code: "pure-declaration", reason: "u3 只声明跨单元的订单契约，不含业务行为", approval_ref: "REVIEW-2026-10-05-02", alternative_validation: "契约结构校验（node tests/validate_contract.cjs）", validation_command: VALIDATE };
let counter = 0;

interface UnitSpec {
  id: string;
  exemption?: Record<string, unknown>;
}

interface Scenario {
  project: string;
  epoch0: string;
  ucds: Ucd[];
  units: UnitSpec[];
  /** Phase sets the observer reports, per unit (overrides the defaults). */
  plan: Record<string, Partial<Record<Phase, string[]>>>;
  savePlan: () => void;
  writeUnitManifest: (units: UnitSpec[]) => void;
  writeCases: (ucds: Ucd[]) => void;
  nextModule: (expected: string, refreshes?: string[][]) => Run;
  reportUnit: (stage: string, unit: string) => Run;
  report: (stage: string, extra?: string[]) => Run;
  step: (args: string[], expectOk?: boolean) => Run;
  transcript: string[];
}

const IN = `docs/aidlc/modules/${M01}/inception`;
const CASES = `${IN}/application-design/test-cases`;
const I13 = `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`;
const RED = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/red-test-evidence.json`;
const BASE = (unit: string) => `.aidlc/evidence/tdd/${M01}/${unit}/baseline-test-evidence.json`;
const GREEN = (unit: string) => `.aidlc/evidence/code-generation/${M01}/${unit}/green-test-evidence.json`;
const construction = (unit: string) => `docs/aidlc/modules/${M01}/construction/${unit}`;
const TCD = ["--stage", "test-case-derivation", "--module", M01];
const RA = ["--stage", "requirements-analysis", "--module", M01];
const unitArgs = (unit: string) => ["--module", M01, "--unit", unit];

function normalizer(): (value: unknown) => string {
  return (value: unknown): string => String(value ?? "")
    .split(scratch).join("<scratch>")
    .replace(/\\\\/g, "/").replace(/\\/g, "/")
    .replace(/[0-9a-f]{64}|[0-9a-f]{40}/g, "<sha>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
    .replace(/p\d+-/g, "p<n>-")
    .replace(/\b4\.8\.0\b|\b4\.7\.1\b/g, "<version>");
}

/**
 * Split-layout project with one module and `units`, driven through the module
 * inception up to (not including) the test-case-derivation report. Every phase of
 * every unit defaults to the unit's own UC-Ds when `unit_refs` are declared, and to
 * the module set otherwise.
 */
function scenario(name: string, units: UnitSpec[], ucds: Ucd[]): Scenario {
  const project = join(scratch, `p${++counter}-${name}`);
  const transcript: string[] = [];
  const normalize = normalizer();
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n\nPython order service.\n");
  write(project, "app/__init__.py", APP_INIT);
  write(project, "app/a.py", APP_A);
  write(project, "app/b.py", APP_B);
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] })}\n`);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "c1 legacy order service"], "2024-01-01T00:00:00Z");
  const epoch0 = git(project, ["rev-parse", "HEAD"]);

  const step = (args: string[], expectOk = true): Run => {
    const result = expectOk ? ok(project, args) : run(project, args);
    transcript.push(`$ ${normalize(args.join(" "))}\n  kind=${normalize(result.json.kind)} stage_instance=${normalize(result.json.stage_instance)}\n  message=${normalize(result.json.message)}`);
    return result;
  };
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

  step(["orchestrate", "next", "--scope", "feature", "--work", `4.8.0 unit scope ${name}`]);
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
  write(project, `${IN}/requirements.md`, "# 需求\n\n## REQ-001 订单处理\n\ntrack: [backend]\n\n业务规则：订单处理由多个单元分别实现，每个单元只交付自己负责的用例，模块收口时全部用例都必须通过。\n");
  report("requirements-analysis");
  nextModule(`requirement-clarification@module:${M01}`);
  write(project, `${IN}/clarifications.md`, "# 需求澄清\n\nNo clarifications needed.\n\nREQ-001 的单元划分已在需求中明确，本次改动沿用现有行为。\n");
  report("requirement-clarification");
  nextModule(`requirements-methods@module:${M01}`, [RA]);
  write(project, `${IN}/requirements/business-flows.md`, "# 业务流程\n\n## REQ-001 订单处理流程\n\n```mermaid\nflowchart LR\n  A[接收订单] --> B[按单元处理]\n  B --> C[返回结果]\n```\n");
  report("requirements-methods");
  nextModule(`user-stories@module:${M01}`, [RA]);
  write(project, `${IN}/user-stories.md`, "# 用户故事\n\n## STORY-001 / US-001 运营处理订单\n\n- 关联需求：REQ-001\n- 作为运营人员，我希望订单按单元交付的能力被正确处理，以便逐项核对。\n- 验收标准：每个单元的用例在该单元完成时通过，模块完成时全部通过。\n");
  report("user-stories");
  nextModule(`cross-validation@module:${M01}`, [RA]);
  write(project, `${IN}/cross-validation-report.md`, "# 交叉验证报告\n\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: not-selected\n\n| 需求 | 故事 | 结论 |\n| --- | --- | --- |\n| REQ-001 | STORY-001 / US-001 | 一致：单元划分由故事验收标准覆盖 |\n");
  report("cross-validation");
  nextModule(`workflow-planning@module:${M01}`, [RA, ["--stage", "user-stories", ...moduleArgs]]);
  write(project, `${IN}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：每个单元只交付自己的 UC-D，各自经 RED/BASELINE→GREEN 复验，模块收口时对账；不需要应用设计。\n");
  report("workflow-planning");

  const writeUnitManifest = (specs: UnitSpec[]) => {
    write(project, `${IN}/unit-manifest.json`, `${JSON.stringify({ schema_version: 1, module_id: M01, units: specs.map((unit) => ({ unit_id: unit.id, name: `Unit ${unit.id}`, service_id: "trade-service", conditional_stages: [], ...(unit.exemption ? { ucd_exemption: unit.exemption } : {}) })) }, null, 2)}\n`);
  };
  writeUnitManifest(units);
  const moduleState = loadWorkflowState(project, moduleRef)!;
  moduleState.completed_stages.push("units-generation");
  moduleState.completed_stage_instances.push(`units-generation@module:${M01}`);
  saveWorkflowState(project, moduleState, moduleRef);
  for (const unit of units) {
    write(project, `${construction(unit.id)}/functional-design.md`, `# 功能设计 — ${unit.id}\n\nREQ-001：${unit.id} 交付自己负责的用例；无新增接口与数据结构。\n`);
  }
  nextModule(`test-case-derivation@module:${M01}`);
  const writeCases = (list: Ucd[]) => {
    rmSync(join(project, CASES), { recursive: true, force: true });
    write(project, `${CASES}/_index.md`, `# UC-D 索引\n\n${list.map((ucd) => `- ${ucd.id} ${ucd.title}（source_ref: REQ-001）`).join("\n")}\n`);
    for (const ucd of list) write(project, `${CASES}/${ucd.id}.md`, caseFile(ucd));
  };

  write(project, "tests/__init__.py", "\"\"\"Tests for the order service (REQ-001).\"\"\"\n");
  write(project, "tests/test_features.py", pythonTests(ucds));
  write(project, "tests/observe_uc.cjs", OBSERVER);
  write(project, "tests/validate_contract.cjs", CONTRACT_VALIDATOR);
  const hasNew = ucds.some((ucd) => ucd.mode === "new");
  const hasCharacterization = ucds.some((ucd) => ucd.mode === "characterization");
  write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [
    ...(hasNew ? [{ id: "uc-red", role: "red", argv: OBSERVE }] : []),
    ...(hasCharacterization ? [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }] : []),
  ]));
  write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));

  const plan: Record<string, Partial<Record<Phase, string[]>>> = {};
  const scoped = ucds.some((ucd) => ucd.unitRefs !== undefined);
  for (const unit of units) {
    const own = ucds.filter((ucd) => !scoped || (ucd.unitRefs || []).includes(unit.id));
    plan[unit.id] = {
      RED: own.filter((ucd) => ucd.mode === "new").map((ucd) => ucd.id),
      BASELINE: own.filter((ucd) => ucd.mode === "characterization").map((ucd) => ucd.id),
      GREEN: own.map((ucd) => ucd.id),
    };
  }
  plan["*"] = { GREEN: ucds.map((ucd) => ucd.id) };
  const state: Scenario = {
    project, epoch0, ucds, units, plan, transcript,
    savePlan: () => write(project, ".aidlc/ucd-plan.json", `${JSON.stringify({ ucds: Object.fromEntries(ucds.map((ucd) => [ucd.id, { file: ucd.file, marker: ucd.marker, test: testMethod(ucd) }])), phases: plan }, null, 2)}\n`),
    writeUnitManifest, writeCases, nextModule, reportUnit, report, step,
  };
  state.savePlan();
  return state;
}

function implement(s: Scenario, unit: string, files: Record<string, string>, ucdIds: string): void {
  for (const [path, content] of Object.entries(files)) write(s.project, path, content);
  write(s.project, `${construction(unit)}/plans/code-generation-plan.md`, `# 代码生成计划 — ${unit}\n\n- REQ-001 / ${ucdIds}：${unit} 实现自己负责的用例。\n`);
  write(s.project, `${construction(unit)}/implementation-summary.md`, `# 实现摘要 — ${unit}\n\nREQ-001 / ${ucdIds}：${unit} 的实现已完成，tests/test_features.py 覆盖对应 UC-D。\n`);
}

function codeReview(unit: string, ucdIds: string, files: string): string {
  return [
    `# 代码审查 — 单元 ${unit}`,
    "",
    "- 审查模式: 集成双轴审查",
    "- reviewer: aidlc-quality-agent",
    "- execution_context: isolated",
    "- review_only: true",
    `- Spec 结果: passed（REQ-001 / ${ucdIds}）`,
    "- Standards 结果: passed",
    "- issues_found: 0",
    "- issues_resolved: 0",
    "- issues_open: 0",
    `- 审查文件: ${files}, tests/test_features.py`,
    "- 修复状态: 无需修复",
    "",
  ].join("\n");
}

function review(s: Scenario, unit: string, ucdIds: string, files: string): void {
  write(s.project, `${construction(unit)}/code-review.md`, codeReview(unit, ucdIds, files));
  write(s.project, `${construction(unit)}/audit.md`, `# 审计 — 单元 ${unit}\n\n代码审查（REQ-001 / ${ucdIds}）结论：passed。\n`);
}

function writeBuildAndTest(s: Scenario, ids: string): void {
  write(s.project, "tests/build_check.cjs", "const { readFileSync } = require('node:fs');\nreadFileSync('app/__init__.py', 'utf8');\nconsole.log('build ok');\n");
  write(s.project, "tests/run_tests.cjs", "const { spawnSync } = require('node:child_process');\nconst env = { ...process.env, AIDLC_PHASE: 'GREEN' };\ndelete env.AIDLC_ACTIVE_UNIT;\nconst result = spawnSync(process.execPath, ['tests/observe_uc.cjs'], { encoding: 'utf8', env });\nprocess.stdout.write(result.stdout.split(/\\r?\\n/).filter((line) => !line.startsWith('{')).join('\\n'));\nprocess.exit(result.status ?? 1);\n");
  write(s.project, "tests/lint_check.cjs", "const { readFileSync } = require('node:fs');\nif (/\\t/.test(readFileSync('app/__init__.py', 'utf8'))) process.exit(1);\nconsole.log('lint ok');\n");
  write(s.project, ".aidlc/commands/build-and-test.json", allowlist("build-and-test", [
    { id: "build", role: "build", argv: ["node", "tests/build_check.cjs"] },
    { id: "unit-tests", role: "test", argv: ["node", "tests/run_tests.cjs"] },
    { id: "lint", role: "check", argv: ["node", "tests/lint_check.cjs"] },
  ]));
  write(s.project, "docs/aidlc/construction/build-test-report.md", `# 构建与测试报告\n\nREQ-001 / ${ids}：构建、单元测试与 lint 均通过（0 failed）。\n`);
  write(s.project, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# 构建与测试摘要\n\nREQ-001 的实现通过构建、测试和静态检查；各单元只交付自己的 UC-D，模块收口对账通过。\n");
}

function writeImplementationReport(s: Scenario, stages: number, ids: string): void {
  const evidenceRefs = listEvidence(join(s.project, ".aidlc", "evidence"))
    .map((file) => file.slice(s.project.length + 1).replace(/\\/g, "/"))
    .filter((file) => !file.startsWith(".aidlc/evidence/implementation-report/"))
    .sort();
  write(s.project, "docs/aidlc/construction/implementation-report.md", [
    "# 实施报告",
    "",
    "- scope: feature",
    `- stages_completed: ${stages}`,
    "- all_gates_passed: true",
    "",
    `REQ-001 / ${ids} 已完成：各单元按 unit_refs 只覆盖自己的 UC-D，模块收口对账通过。`,
    "",
    "## 证据",
    "",
    ...evidenceRefs.map((file) => `- ${file}`),
    "",
  ].join("\n"));
}

/**
 * Later units change the module digest scope, so (as in test_v4_7_0) every unit's
 * code-generation / code-review evidence is re-produced and re-attested before the
 * integration workflow re-checks them upstream.
 */
function reattestUnits(s: Scenario): void {
  for (const unit of s.units) {
    for (const stage of ["code-generation", "code-review"]) s.step(["evidence", "run", "--stage", stage, ...unitArgs(unit.id), "--all-sensors", "--refresh"]);
  }
  for (const unit of s.units) {
    for (const stage of ["code-generation", "code-review"]) s.step(["orchestrate", "report", "--stage", stage, ...unitArgs(unit.id), "--result", "completed"]);
  }
}

/** build-and-test → build-and-test-templates → implementation-report → done. */
function integrationToEnd(s: Scenario, ids: string): void {
  reattestUnits(s);
  const directive = s.step(["orchestrate", "next"]).json;
  assert.equal(directive.stage_instance, "build-and-test", JSON.stringify(directive, null, 2));
  writeBuildAndTest(s, ids);
  s.step(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  s.step(["evidence", "run", "--stage", "build-and-test"]);
  s.step(["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
  assert.equal(s.step(["orchestrate", "next"]).json.stage_instance, "build-and-test-templates");
  write(s.project, "docs/aidlc/construction/build-and-test/build-instructions.md", "# 构建说明\n\nREQ-001：执行 node tests/build_check.cjs 校验 app 包可读取，作为 Python 源码的构建检查。\n");
  write(s.project, "docs/aidlc/construction/build-and-test/unit-test-instructions.md", `# 单元测试说明\n\nREQ-001：执行 node tests/run_tests.cjs 运行 ${ids} 的 GREEN 观察，期望 0 failed。\n`);
  s.step(["orchestrate", "report", "--stage", "build-and-test-templates", "--result", "completed"]);
  s.step(["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--all-sensors", "--refresh"]);
  s.step(["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--sensor", "test-quality", "--refresh"]);
  assert.equal(s.step(["orchestrate", "next"]).json.stage_instance, "implementation-report");
  const moduleRef = { kind: "module" as const, module_id: M01 };
  const completed = [undefined, moduleRef, { kind: "integration" as const }].reduce((total, ref) => total + loadWorkflowState(s.project, ref)!.completed_stage_instances.length, 0) + 1;
  writeImplementationReport(s, completed, ids);
  s.step(["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
  assert.equal(s.step(["orchestrate", "next"]).json.kind, "done");
  for (const path of listEvidence(join(s.project, ".aidlc", "evidence"))) {
    assert.equal(JSON.parse(readFileSync(path, "utf8")).producer?.mode, "controlled", path);
  }
}

const UCD1: Ucd = { id: "UC-D-001", mode: "new", title: "u1 订单校验", file: "app/u1_feature.py", marker: "def validate_order" };
const UCD2: Ucd = { id: "UC-D-002", mode: "new", title: "u2 订单定价", file: "app/u2_feature.py", marker: "def price_order" };
const UCD3: Ucd = { id: "UC-D-003", mode: "new", title: "跨单元订单流转", file: "app/flow.py", marker: "def flow_u2" };
const U1_FILE = "# REQ-001 UC-D-001: order validation (u1)\ndef validate_order(order):\n    return bool(order)\n";
const U2_FILE = "# REQ-001 UC-D-002: order pricing (u2)\ndef price_order(order):\n    return len(order)\n";

/** Run one new-mode unit through tdd / code-generation / code-review. */
function newUnit(s: Scenario, unit: string, files: Record<string, string>, ucdIds: string, refreshes: string[][] = [TCD]): void {
  s.nextModule(`tdd@module:${M01}@unit:${unit}`, refreshes);
  const tdd = s.reportUnit("tdd", unit);
  assert.equal(rejected(tdd), "", `tdd ${unit}\n${tdd.out}`);
  s.nextModule(`code-generation@module:${M01}@unit:${unit}`, [TCD]);
  implement(s, unit, files, ucdIds);
  const generation = s.reportUnit("code-generation", unit);
  assert.equal(rejected(generation), "", `code-generation ${unit}\n${generation.out}`);
  s.nextModule(`code-review@module:${M01}@unit:${unit}`);
  review(s, unit, ucdIds, Object.keys(files).join(", "));
  const reviewed = s.reportUnit("code-review", unit);
  assert.equal(rejected(reviewed), "", `code-review ${unit}\n${reviewed.out}`);
}

try {
  // ------------------------------------------------------------------ (1)(2)(3a)(6)(7)
  await section("e2e: split, u1/u2 each with its own new UC-D (unit_refs) — unit_refs validation, FD subset, per-unit RED/GREEN, u2 missing its UC-D rejected, reconciliation to implementation-report", () => {
    const checks = rejections();
    const ucds = [{ ...UCD1, unitRefs: ["u1"] }, { ...UCD2, unitRefs: ["u2"] }];
    const s = scenario("unit-scope", [{ id: "u1" }, { id: "u2" }], ucds);
    const tcdRun = () => run(s.project, ["evidence", "run", ...TCD, "--sensor", "test-case-derivation"]);

    // (6) unit_refs validation: every malformed declaration is refused by I13.
    s.writeCases([{ ...ucds[0], unitRefs: ["u9"] }, ucds[1]]);
    checks.expect("unit_refs names an unknown unit", rejected(tcdRun()), /UC-D-001 unit_refs names unknown unit u9 \(units of m01-trade: u1, u2\)/);
    s.writeCases([{ ...ucds[0], unitRefs: [] }, ucds[1]]);
    checks.expect("unit_refs is an empty list", rejected(tcdRun()), /UC-D-001 unit_refs must be a non-empty list of unit ids/);
    s.writeCases([{ ...ucds[0], unitRefs: ["u1", "u1"] }, ucds[1]]);
    checks.expect("unit_refs repeats a unit", rejected(tcdRun()), /UC-D-001 unit_refs lists u1 more than once/);
    s.writeCases(ucds);
    write(s.project, `${CASES}/UC-D-001.md`, bodyOnlyCaseFile(ucds[0], "[u1]"));
    checks.expect("unit_refs written in the body", rejected(tcdRun()), /UC-D-001 declares unit_refs outside a frontmatter block/);
    s.writeCases([{ ...ucds[0], unitRefs: undefined }, ucds[1]]);
    checks.expect("unit_refs declared by some UC-Ds only", rejected(tcdRun()), /unit_refs must be declared by every UC-D of the module once one declares it; missing: UC-D-001/);

    s.writeCases(ucds);
    s.step(["evidence", "run", ...TCD, "--sensor", "test-case-derivation"]);
    s.report("test-case-derivation");
    const i13 = readJson(s.project, I13);
    checks.expect("I13 records ucd_units", String(JSON.stringify(i13.ucd_units)), /^\{"UC-D-001":\["u1"\],"UC-D-002":\["u2"\]\}$/);

    // (7) functional-design-completeness checks the unit subset.
    const fdCheck = () => run(s.project, ["check", "--sensor", "functional-design-completeness", ...unitArgs("u1")]);
    const fd = (ucdText: string) => write(s.project, `${construction("u1")}/functional-design.md`, `# 功能设计 — u1\n\nREQ-001 ${ucdText}：u1 提供公共方法 validate_order 作为接口；数据源为订单 repository；校验失败时抛出错误并记录异常。\n`);
    fd("UC-D-001");
    const fdOk = fdCheck();
    checks.expect("u1 FD naming only UC-D-001 passes", fdOk.status === 0 ? "accepted" : fdOk.out, /^accepted$/);
    fd("（未列出用例）");
    checks.expect("u1 FD without UC-D-001", rejected(fdCheck()), /functional design does not cover every UC-D case/);
    write(s.project, `${construction("u1")}/functional-design.md`, "# 功能设计 — u1\n\nREQ-001：u1 交付自己负责的用例；无新增接口与数据结构。\n");

    // (1)(2) u1: RED and GREEN cover UC-D-001 only.
    s.nextModule(`tdd@module:${M01}@unit:u1`, [TCD]);
    const u1TddRejection = rejected(s.reportUnit("tdd", "u1"));
    if (u1TddRejection) {
      // Pre-4.8 engines demand the module's new UC-Ds in u1's RED; record it and let u1's
      // RED observe both so the run reaches the GREEN gate (the RED-first demonstration).
      console.log(`    RED (u1 RED rejected): ${(/RED uc_mapping must cover[^\n"]*/.exec(u1TddRejection) || [u1TddRejection.trim().slice(-600)])[0]}`);
      checks.expect("u1 RED covering only UC-D-001 passes", u1TddRejection, /^$/);
      s.plan.u1.RED = ["UC-D-001", "UC-D-002"];
      s.savePlan();
      s.step(["evidence", "run", "--stage", "tdd", ...unitArgs("u1"), "--sensor", "red-test-evidence"]);
      assert.equal(rejected(s.reportUnit("tdd", "u1")), "");
      s.plan.u1.RED = ["UC-D-001"];
      s.savePlan();
    }
    const u1Red = readJson(s.project, RED("u1"));
    assert.equal(u1Red.status, "failed");
    checks.expect("u1 RED covers UC-D-001 only", u1Red.uc_mapping.map((entry: Json) => entry.use_case).join(","), /^UC-D-001$/);
    assert.equal(readJson(s.project, BASE("u1")).status, "not_required");
    s.nextModule(`code-generation@module:${M01}@unit:u1`, [TCD]);
    implement(s, "u1", { [UCD1.file]: U1_FILE }, "UC-D-001");
    const u1Generation = s.reportUnit("code-generation", "u1");
    const u1Rejection = rejected(u1Generation);
    if (u1Rejection) console.log(`    RED (u1 GREEN rejected): ${(/GREEN uc_mapping must cover[^\n"]*/.exec(u1Rejection) || [u1Rejection.trim().slice(-600)])[0]}`);
    assert.equal(u1Rejection, "", `u1 GREEN covering only UC-D-001 must pass\n${u1Generation.out}`);
    const u1Green = readJson(s.project, GREEN("u1"));
    assert.equal(u1Green.status, "passed");
    assert.deepEqual(u1Green.uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-001"]);
    console.log(`    GREEN (u1): status=${u1Green.status} uc_mapping=${u1Green.uc_mapping.map((entry: Json) => entry.use_case).join(",")}`);
    s.nextModule(`code-review@module:${M01}@unit:u1`);
    review(s, "u1", "UC-D-001", UCD1.file);
    assert.equal(rejected(s.reportUnit("code-review", "u1")), "");

    // (3a) u2: a GREEN that misses u2's own UC-D is refused by the gate.
    s.nextModule(`tdd@module:${M01}@unit:u2`, [TCD]);
    assert.equal(rejected(s.reportUnit("tdd", "u2")), "");
    assert.deepEqual(readJson(s.project, RED("u2")).uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-002"]);
    s.nextModule(`code-generation@module:${M01}@unit:u2`, [TCD]);
    implement(s, "u2", { [UCD2.file]: U2_FILE }, "UC-D-002");
    s.plan.u2.GREEN = ["UC-D-001"];
    s.savePlan();
    checks.expect("u2 GREEN without UC-D-002", rejected(s.reportUnit("code-generation", "u2")), /GREEN uc_mapping must cover every UC-D of unit u2 \(UC-D-002\): missing UC-D-002; unexpected UC-D-001/);
    s.plan.u2.GREEN = ["UC-D-002"];
    s.savePlan();
    s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u2"), "--sensor", "green-test-evidence"]);
    const u2Generation = s.reportUnit("code-generation", "u2");
    assert.equal(rejected(u2Generation), "", u2Generation.out);
    assert.deepEqual(readJson(s.project, GREEN("u2")).uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-002"]);
    // GREEN may not be not_required while the unit subset is non-empty.
    checks.expect("u2 GREEN relabelled not_required", withTampered(s.project, GREEN("u2"), (value) => ({ ...value, status: "not_required", ucd_ids: [] }), () => gate(s.project, `code-generation@module:${M01}@unit:u2`, "green-test-evidence", ["--module", M01])), /GREEN may be not_required only when the UC-D subset of unit u2 is empty; unit u2: UC-D-002/);
    s.nextModule(`code-review@module:${M01}@unit:u2`);
    review(s, "u2", "UC-D-002", UCD2.file);
    assert.equal(rejected(s.reportUnit("code-review", "u2")), "");
    assert.equal(s.step(["orchestrate", "next", "--module", M01]).json.kind, "done", "module workflow resolved");

    integrationToEnd(s, "UC-D-001 / UC-D-002");
    const reconciled = readJson(s.project, ".aidlc/evidence/build-and-test/test-quality.json");
    assert.deepEqual(reconciled.ucd_coverage, [{ module_id: M01, ucd_units: { "UC-D-001": ["u1"], "UC-D-002": ["u2"] }, status: "passed" }]);
    checks.assertAll();
  });

  // ------------------------------------------------------------------ (3b)
  await section("reconciliation: a cross-unit UC-D (unit_refs [u1, u2]) covered by only one unit fails build-and-test test-quality and blocks the integration barrier", () => {
    const checks = rejections();
    const ucds = [{ ...UCD1, unitRefs: ["u1"] }, { ...UCD2, unitRefs: ["u2"] }, { ...UCD3, unitRefs: ["u1", "u2"] }];
    const s = scenario("reconcile", [{ id: "u1" }, { id: "u2" }], ucds);
    s.writeCases(ucds);
    s.report("test-case-derivation");
    assert.deepEqual(readJson(s.project, I13).ucd_units, { "UC-D-001": ["u1"], "UC-D-002": ["u2"], "UC-D-003": ["u1", "u2"] });
    const FLOW = "# REQ-001 UC-D-003: cross-unit order flow (u1 + u2)\ndef flow_u1(order):\n    return order\n\n\ndef flow_u2(order):\n    return order\n";
    newUnit(s, "u1", { [UCD1.file]: U1_FILE, [UCD3.file]: FLOW }, "UC-D-001 / UC-D-003");
    assert.deepEqual(readJson(s.project, GREEN("u1")).uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-001", "UC-D-003"]);
    // u2's tdd RED must cover UC-D-002 and UC-D-003; app/flow.py already passes UC-D-003, so u2 observes RED with a failing UC-D-002 only.
    newUnit(s, "u2", { [UCD2.file]: U2_FILE }, "UC-D-002 / UC-D-003");
    assert.equal(s.step(["orchestrate", "next", "--module", M01]).json.kind, "done");
    // The gate already refuses a u2 GREEN without UC-D-003 at code-generation. The
    // reconciliation is reached by a later --refresh of u2's GREEN that drops it
    // (the controlled producer validates the observation, not the module coverage).
    s.plan.u2.GREEN = ["UC-D-002"];
    s.savePlan();
    s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u2"), "--sensor", "green-test-evidence", "--refresh"]);
    assert.deepEqual(readJson(s.project, GREEN("u2")).uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-002"]);
    const barrier = rejected(run(s.project, ["orchestrate", "next"]));
    checks.expect("integration barrier with a UC-D missing from one unit", barrier, /Cross-module integration barrier is not ready: ucd-coverage:m01-trade/);
    console.log(`    barrier: ${(/Cross-module integration barrier is not ready: [^\n".]*/.exec(barrier) || [barrier.trim().slice(-300)])[0]}`);
    // Restoring u2's GREEN opens the barrier; build-and-test becomes active.
    s.plan.u2.GREEN = ["UC-D-002", "UC-D-003"];
    s.savePlan();
    reattestUnits(s);
    assert.equal(s.step(["orchestrate", "next"]).json.stage_instance, "build-and-test");
    writeBuildAndTest(s, "UC-D-001 / UC-D-002 / UC-D-003");
    // Drop UC-D-003 from u2's GREEN again while build-and-test is active: the project-axis
    // test-quality reconciliation refuses it and names the UC-D and the unit.
    s.plan.u2.GREEN = ["UC-D-002"];
    s.savePlan();
    s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u2"), "--sensor", "green-test-evidence", "--refresh"]);
    const reconciliation = rejected(run(s.project, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]));
    checks.expect("build-and-test test-quality reconciliation", reconciliation, /module m01-trade UC-D coverage is incomplete: UC-D-003 is not covered by the GREEN uc_mapping of unit u2/);
    console.log(`    reconciliation: ${(/module m01-trade UC-D coverage is incomplete[^\n"\\]*/.exec(reconciliation) || [reconciliation.trim().slice(-400)])[0]}`);
    s.plan.u2.GREEN = ["UC-D-002", "UC-D-003"];
    s.savePlan();
    s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u2"), "--sensor", "green-test-evidence", "--refresh"]);
    s.step(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
    assert.equal(readJson(s.project, ".aidlc/evidence/build-and-test/test-quality.json").ucd_coverage[0].status, "passed");
    checks.assertAll();
  });

  // ------------------------------------------------------------------ (4)
  await section("empty subset: contract unit u3 without UC-D — refused without ucd_exemption or with a failing validation_command; with it RED/BASELINE/GREEN are not_required and the command runs", () => {
    const checks = rejections();
    const ucds = [{ ...UCD1, unitRefs: ["u1"] }];
    const s = scenario("empty-subset", [{ id: "u1" }, { id: "u3" }], ucds);
    s.writeCases(ucds);
    s.report("test-case-derivation");
    newUnit(s, "u1", { [UCD1.file]: U1_FILE }, "UC-D-001");
    const log = () => (existsSync(join(s.project, ".aidlc/contract-validation.log")) ? readFileSync(join(s.project, ".aidlc/contract-validation.log"), "utf8").split(/\r?\n/).filter(Boolean).length : 0);
    write(s.project, "app/contract.py", "# REQ-001 u3: cross-unit order contract (declaration only)\nORDER_FIELDS = (\"id\", \"amount\")\n");

    s.nextModule(`tdd@module:${M01}@unit:u3`, [TCD]);
    checks.expect("empty subset without ucd_exemption", rejected(s.reportUnit("tdd", "u3")), /unit u3 owns no UC-D of module m01-trade \(unit_refs\); declare ucd_exemption for it in .*unit-manifest\.json/);
    assert.equal(existsSync(join(s.project, RED("u3"))), false, "the refused RED writes no evidence");
    s.writeUnitManifest([{ id: "u1" }, { id: "u3", exemption: EXEMPTION }]);
    write(s.project, ".aidlc/contract-broken", "1\n");
    checks.expect("validation_command exits non-zero", rejected(s.reportUnit("tdd", "u3")), /command ucd-exemption:u3 failed: exit code 3/);
    assert.equal(existsSync(join(s.project, RED("u3"))), false, "a failing validation writes no evidence");
    rmSync(join(s.project, ".aidlc/contract-broken"));
    s.writeUnitManifest([{ id: "u1" }, { id: "u3", exemption: { ...EXEMPTION, approval_ref: "" } }]);
    checks.expect("ucd_exemption without approval_ref", rejected(s.reportUnit("tdd", "u3")), /units\[1\]\.ucd_exemption\.approval_ref must be a non-empty string/);
    s.writeUnitManifest([{ id: "u1" }, { id: "u3", exemption: EXEMPTION }]);
    const before = log();
    const u3Tdd = s.reportUnit("tdd", "u3");
    assert.equal(rejected(u3Tdd), "", u3Tdd.out);
    assert.ok(log() >= before + 2, `validation_command ran for RED and BASELINE (${before} → ${log()})`);
    for (const path of [RED("u3"), BASE("u3")]) {
      const evidence = readJson(s.project, path);
      assert.equal(evidence.status, "not_required", path);
      assert.deepEqual(evidence.ucd_ids, []);
      assert.equal(evidence.ucd_exemption.reason_code, "pure-declaration");
      assert.equal(evidence.exemption_validation_execution.exit_code, 0);
    }
    s.nextModule(`code-generation@module:${M01}@unit:u3`, [TCD]);
    implement(s, "u3", { "app/contract.py": "# REQ-001 u3: cross-unit order contract (declaration only)\nORDER_FIELDS = (\"id\", \"amount\")\n" }, "无 UC-D（契约单元）");
    const beforeGreen = log();
    const u3Generation = s.reportUnit("code-generation", "u3");
    assert.equal(rejected(u3Generation), "", u3Generation.out);
    assert.ok(log() >= beforeGreen + 1, "validation_command ran for GREEN");
    const u3Green = readJson(s.project, GREEN("u3"));
    assert.equal(u3Green.status, "not_required");
    assert.deepEqual(u3Green.ucd_ids, []);
    console.log(`    u3 GREEN: status=${u3Green.status} reason=${u3Green.not_required_reason}`);
    // The exemption is re-read by the gate: a changed validation_command no longer matches.
    checks.expect("exemption execution digest mismatch", withTampered(s.project, GREEN("u3"), (value) => ({ ...value, exemption_validation_execution: { ...value.exemption_validation_execution, argv_digest: "0".repeat(64) } }), () => gate(s.project, `code-generation@module:${M01}@unit:u3`, "green-test-evidence", ["--module", M01])), /exemption_validation_execution\.argv_digest does not match the ucd_exemption validation_command of unit u3/);
    s.nextModule(`code-review@module:${M01}@unit:u3`);
    review(s, "u3", "无 UC-D（契约单元）", "app/contract.py");
    assert.equal(rejected(s.reportUnit("code-review", "u3")), "");
    assert.equal(s.step(["orchestrate", "next", "--module", M01]).json.kind, "done");
    integrationToEnd(s, "UC-D-001");
    assert.deepEqual(readJson(s.project, ".aidlc/evidence/build-and-test/test-quality.json").ucd_coverage, [{ module_id: M01, ucd_units: { "UC-D-001": ["u1"] }, status: "passed" }]);
    checks.assertAll();
  });

  // ------------------------------------------------------------------ (5)
  await section("characterization subset: u1/u2 with different code refs — BASELINE code_ref_digests are per unit; a u2 code ref changed by u1 still refuses u2's BASELINE until --advance", () => {
    const checks = rejections();
    const ucds: Ucd[] = [
      { id: "UC-D-011", mode: "characterization", title: "alpha 分页", file: "app/a.py", marker: "def alpha(rows, size=50)", codeRef: "app/a.py::alpha", unitRefs: ["u1"] },
      { id: "UC-D-012", mode: "characterization", title: "beta 导出", file: "app/b.py", marker: "def beta(client)", codeRef: "app/b.py::beta", unitRefs: ["u2"] },
    ];
    const s = scenario("characterization", [{ id: "u1" }, { id: "u2" }], ucds);
    s.writeCases(ucds);
    s.report("test-case-derivation");
    const i13 = readJson(s.project, I13);
    assert.deepEqual(i13.ucd_units, { "UC-D-011": ["u1"], "UC-D-012": ["u2"] });

    s.nextModule(`tdd@module:${M01}@unit:u1`, [TCD]);
    assert.equal(rejected(s.reportUnit("tdd", "u1")), "");
    const u1Baseline = readJson(s.project, BASE("u1"));
    const aBlob = git(s.project, ["rev-parse", `${s.epoch0}:app/a.py`]);
    assert.deepEqual(u1Baseline.code_ref_digests, [{ path: "app/a.py", baseline_blob: aBlob, worktree_blob: aBlob }], "u1 BASELINE digests only u1's code ref");
    assert.deepEqual(u1Baseline.uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-011"]);
    checks.expect("u1 BASELINE claiming u2's code ref", withTampered(s.project, BASE("u1"), (value) => ({ ...value, code_ref_digests: [...value.code_ref_digests, { path: "app/b.py", baseline_blob: aBlob, worktree_blob: aBlob }] }), () => gate(s.project, `tdd@module:${M01}@unit:u1`, "baseline-test-evidence", ["--module", M01])), /code_ref_digests must cover exactly the characterization code refs of unit u1 \(app\/a\.py\)/);

    // u1 changes app/b.py (u2's code ref) and commits.
    s.nextModule(`code-generation@module:${M01}@unit:u1`, [TCD]);
    implement(s, "u1", { "app/a.py": `${APP_A}# REQ-001 u1: traced\n`, "app/b.py": `${APP_B}# REQ-001 u1 touched beta\n` }, "UC-D-011");
    git(s.project, ["add", "app", "tests", "docs"]);
    git(s.project, ["commit", "-qm", "u1 changes a.py and b.py"], "2024-01-04T00:00:00Z");
    const u1Commit = git(s.project, ["rev-parse", "HEAD"]);
    assert.equal(rejected(s.reportUnit("code-generation", "u1")), "");
    s.nextModule(`code-review@module:${M01}@unit:u1`);
    review(s, "u1", "UC-D-011", "app/a.py, app/b.py");
    assert.equal(rejected(s.reportUnit("code-review", "u1")), "");

    s.nextModule(`tdd@module:${M01}@unit:u2`, [TCD]);
    const refused = rejected(s.reportUnit("tdd", "u2"));
    checks.expect("u2 BASELINE after u1 changed app/b.py", refused, /BASELINE refuses to run: code ref app\/b\.py changed since the workflow baseline/);
    assert.equal(existsSync(join(s.project, BASE("u2"))), false);
    s.step(["orchestrate", "baseline", "--advance", u1Commit, "--expect", s.epoch0, "--user-input", "Approve", "--reason", "u1 已完成并提交 app/b.py 的改动"]);
    assert.equal(rejected(s.reportUnit("tdd", "u2")), "");
    const u2Baseline = readJson(s.project, BASE("u2"));
    const bBlob = git(s.project, ["rev-parse", `${u1Commit}:app/b.py`]);
    assert.equal(u2Baseline.baseline_commit, u1Commit, "u2 BASELINE binds epoch 1");
    assert.deepEqual(u2Baseline.code_ref_digests, [{ path: "app/b.py", baseline_blob: bBlob, worktree_blob: bBlob }], "u2 BASELINE digests only u2's code ref at epoch 1");
    assert.equal(gate(s.project, `tdd@module:${M01}@unit:u1`, "baseline-test-evidence", ["--module", M01, "--drift"]), "", "u1 BASELINE (epoch 0, a.py only) stays valid");
    checks.assertAll();
  });

  // ------------------------------------------------------------------ (8)
  await section("compat: two units without unit_refs — RED/GREEN still cover the module set (4.7.1 behaviour, transcript)", () => {
    const checks = rejections();
    const ucds = [UCD1, UCD2];
    const s = scenario("compat", [{ id: "u1" }, { id: "u2" }], ucds);
    s.writeCases(ucds);
    s.report("test-case-derivation");
    assert.equal("ucd_units" in readJson(s.project, I13), false, "no unit_refs → no ucd_units");
    s.nextModule(`tdd@module:${M01}@unit:u1`, [TCD]);
    assert.equal(rejected(s.reportUnit("tdd", "u1")), "");
    assert.deepEqual(readJson(s.project, RED("u1")).uc_mapping.map((entry: Json) => entry.use_case), ["UC-D-001", "UC-D-002"], "RED covers the module set");
    s.nextModule(`code-generation@module:${M01}@unit:u1`, [TCD]);
    implement(s, "u1", { [UCD1.file]: U1_FILE }, "UC-D-001 / UC-D-002");
    s.plan.u1.GREEN = ["UC-D-001"];
    s.savePlan();
    const partial = rejected(s.reportUnit("code-generation", "u1"));
    checks.expect("u1 GREEN covering only UC-D-001", partial, /GREEN uc_mapping must cover every I13 UC-D \(UC-D-001, UC-D-002\): missing UC-D-002/);
    s.plan.u1.GREEN = ["UC-D-001", "UC-D-002"];
    s.savePlan();
    const failing = rejected(s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u1"), "--sensor", "green-test-evidence"], false));
    checks.expect("u1 GREEN while UC-D-002 is not implemented", failing, /controlled GREEN command uc-green must exit 0; got 1/);
    implement(s, "u1", { [UCD1.file]: U1_FILE, [UCD2.file]: U2_FILE }, "UC-D-001 / UC-D-002");
    s.step(["evidence", "run", "--stage", "code-generation", ...unitArgs("u1"), "--all-sensors"]);
    assert.equal(rejected(s.reportUnit("code-generation", "u1")), "");
    s.nextModule(`code-review@module:${M01}@unit:u1`);
    review(s, "u1", "UC-D-001 / UC-D-002", `${UCD1.file}, ${UCD2.file}`);
    assert.equal(rejected(s.reportUnit("code-review", "u1")), "");
    s.nextModule(`tdd@module:${M01}@unit:u2`, [TCD]);
    // Module-wide RED: both UC-Ds already pass after u1, so u2 cannot observe RED (4.7.1 behaviour).
    checks.expect("u2 RED after u1 implemented the module set", rejected(s.reportUnit("tdd", "u2")), /controlled RED command uc-red must exit 1; got 0/);
    if (process.env.AIDLC_TRANSCRIPT) writeFileSync(process.env.AIDLC_TRANSCRIPT, `${s.transcript.join("\n")}\n`, "utf8");
    checks.assertAll();
  });
} finally {
  if (!process.env.AIDLC_KEEP_SCRATCH) rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${sections.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.log(`failed: ${failed.join("; ")}`);
  process.exit(1);
}
