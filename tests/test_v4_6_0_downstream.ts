/**
 * 4.6.0-3 S3b (MARS-49) regression suite: the downstream gates of the tdd BASELINE
 * evidence (code-generation GREEN coverage and the RED / BASELINE re-check,
 * test-quality by tdd_mode) and the end-to-end fixtures that run a characterization
 * workflow from workspace-detection to implementation-report.
 *
 * Every fixture is driven through the public CLI (`orchestrate`, `evidence run`) and
 * the gate probe. Evidence is only ever produced by the controlled producer; the
 * fail-closed cases tamper with a produced file on purpose and restore it byte for
 * byte afterwards. No placeholder files are added: every artifact carries real
 * fixture content.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-460-s3b-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";

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

/** Gate failures of one stage instance (optionally one sensor), joined; "" when the gate accepts. */
function gate(project: string, instance: string, sensor?: string): string {
  const result = spawnSync(process.execPath, [tsx, probe, instance, "sensors", ...(sensor ? [sensor] : [])], { cwd: project, encoding: "utf8", env: cleanEnv() });
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
      else if (process.env.AIDLC_TEST_VERBOSE) console.log(`    rejected ${label}: ${output.trim().slice(-300)}`);
    },
    assertAll() {
      assert.equal(gaps.length, 0, `fail-closed cases not rejected:\n- ${gaps.join("\n- ")}`);
    },
  };
}

/** Output of a CLI run that must be rejected; "" when it was accepted. */
function rejected(result: Run): string {
  return result.status !== 0 || result.json.kind === "error" ? result.out : "";
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
  const original = readFileSync(join(project, path), "utf8");
  try {
    write(project, path, `${JSON.stringify(mutate(JSON.parse(original) as Json), null, 2)}\n`);
    return body();
  } finally {
    writeFileSync(join(project, path), original, "utf8");
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

/** Legacy order exporter committed before the workflow starts (the workflow baseline). */
const EXPORTER_BASELINE = "def export_orders(client):\n    return paginate(client.fetch_orders())\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
/** refactor: page size extracted into a constant, behaviour unchanged. */
const EXPORTER_REFACTORED = "\"\"\"Order export (REQ-001): pagination refactored without behaviour change.\"\"\"\n\nPAGE_SIZE = 50\n\n\ndef export_orders(client):\n    rows = client.fetch_orders()\n    return paginate(rows)\n\n\ndef paginate(rows, size=PAGE_SIZE):\n    return [rows[start:start + size] for start in range(0, len(rows), size)]\n";
/** bugfix: timeout retry added, pagination unchanged. */
const EXPORTER_FIXED = "\"\"\"Order export (REQ-001): timeout retry added, pagination unchanged.\"\"\"\n\nMAX_RETRIES = 3\n\n\ndef export_orders(client):\n    last_error = None\n    for _ in range(MAX_RETRIES):\n        try:\n            return paginate(client.fetch_orders())\n        except TimeoutError as error:\n            last_error = error\n    raise last_error\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";

type Check = "retry" | "pagination" | "export";
interface Ucd {
  id: string;
  mode: "new" | "characterization";
  check: Check;
  title: string;
  given: string;
  codeRefs?: string[];
}

const UCD_RETRY: Ucd = { id: "UC-D-001", mode: "new", check: "retry", title: "导出超时后重试", given: "Given 下游首次调用超时，When 调用 export_orders，Then 重试后返回订单。" };
const UCD_PAGINATION: Ucd = { id: "UC-D-002", mode: "characterization", check: "pagination", title: "导出按 50 条分页", given: "Given 下游返回 120 条订单，When 调用 export_orders，Then 返回 3 页。", codeRefs: ["app/exporter.py::paginate"] };
const UCD_EXPORT: Ucd = { id: "UC-D-003", mode: "characterization", check: "export", title: "导出调用下游并分页", given: "Given 下游返回订单，When 调用 export_orders，Then 结果经 paginate 分页。", codeRefs: ["app/exporter.py::export_orders"] };

const REQUIREMENTS = "# 需求\n\n## REQ-001 订单导出分页与超时重试\n\ntrack: [nfr]\n\n业务规则：订单导出接口按 50 条分页返回；下游超时时最多重试 3 次，3 次内成功则返回订单列表。\n";

function caseFile(ucd: Ucd): string {
  const characterization = ucd.mode === "characterization"
    ? `tdd_mode: characterization\ncode_refs:\n${(ucd.codeRefs || []).map((ref) => `  - ${ref}`).join("\n")}\nreason: 改动前锁定导出的现有行为\napproval_ref: REVIEW-2026-10-02-02\n`
    : "";
  return `---\nid: ${ucd.id}\nstatus: ready\nsource_ref: REQ-001\n${characterization}---\n# ${ucd.id} ${ucd.title}\n\n${ucd.given}\n`;
}

function testMethod(ucd: Ucd): string {
  return `tests/test_exporter.py::test_${ucd.id.toLowerCase().replace(/-/g, "_")}`;
}

function pythonTests(ucds: Ucd[]): string {
  const body = ucds.map((ucd) => {
    const name = testMethod(ucd).split("::")[1];
    if (ucd.check === "retry") return `def ${name}():\n    # ${ucd.id}\n    assert export_orders(FlakyClient()) == [["order-1"]]\n`;
    if (ucd.check === "pagination") return `def ${name}():\n    # ${ucd.id}\n    assert [len(page) for page in paginate(list(range(120)))] == [50, 50, 20]\n`;
    return `def ${name}():\n    # ${ucd.id}\n    assert export_orders(StaticClient()) == [["order-1", "order-2"]]\n`;
  }).join("\n\n");
  return `# REQ-001 ${ucds.map((ucd) => ucd.id).join(" ")}\nfrom app.exporter import export_orders, paginate\n\n\nclass FlakyClient:\n    def __init__(self):\n        self.calls = 0\n\n    def fetch_orders(self):\n        self.calls += 1\n        if self.calls == 1:\n            raise TimeoutError("upstream timeout")\n        return ["order-1"]\n\n\nclass StaticClient:\n    def fetch_orders(self):\n        return ["order-1", "order-2"]\n\n\n${body}`;
}

/**
 * Deterministic observer: evaluates each UC-D against app/exporter.py and reports
 * the controlled observation of the phase in AIDLC_PHASE — RED runs the tdd_mode new
 * UC-Ds, BASELINE the characterization UC-Ds, GREEN all of them. `--omit <id>`
 * leaves a UC-D out of the reported mapping (negative cases only).
 */
function observer(ucds: Ucd[]): string {
  return `const { readFileSync } = require("node:fs");
const source = readFileSync("app/exporter.py", "utf8");
const checks = {
  retry: () => /MAX_RETRIES\\s*=\\s*3/.test(source) && /except\\s+TimeoutError/.test(source),
  pagination: () => /def paginate\\(rows, size=(?:50|PAGE_SIZE)\\)/.test(source) && (/size=50\\)/.test(source) || /PAGE_SIZE\\s*=\\s*50/.test(source)),
  export: () => /def export_orders\\(client\\)/.test(source) && /paginate\\(/.test(source),
};
const ucds = ${JSON.stringify(ucds.map((ucd) => ({ id: ucd.id, mode: ucd.mode, check: ucd.check, test: testMethod(ucd) })))};
const phase = process.env.AIDLC_PHASE || "GREEN";
const omitAt = process.argv.indexOf("--omit");
const omitted = omitAt > 0 ? process.argv[omitAt + 1] : "";
const selected = ucds.filter((ucd) => phase === "GREEN" || (phase === "RED" ? ucd.mode === "new" : ucd.mode === "characterization"));
const failing = selected.filter((ucd) => !checks[ucd.check]());
const observation = { phase, status: failing.length ? "failed" : "passed", compile_status: "passed", environment_status: "passed", tests_total: selected.length, tests_failed: failing.length, traceability_complete: true, uc_mapping: selected.filter((ucd) => ucd.id !== omitted).map((ucd) => ({ use_case: ucd.id, test_methods: [ucd.test] })) };
if (failing.length) Object.assign(observation, { failure_class: "behavior", failure_signature: failing.map((ucd) => ucd.id + " " + ucd.check + " not satisfied").join("; ") });
console.log(JSON.stringify(observation));
console.log(selected.length - failing.length + " passed, " + failing.length + " failed");
process.exit(failing.length ? 1 : 0);
`;
}

function allowlist(stage: string, commands: Array<{ id: string; role: string; argv: string[] }>): string {
  return `${JSON.stringify({ version: "1", stage, commands }, null, 2)}\n`;
}

const OBSERVE = ["node", "tests/observe_uc.cjs"];

// ---------------------------------------------------------------------------
// Single-layout end-to-end driver
// ---------------------------------------------------------------------------

interface Paths {
  tdd: string;
  codeGeneration: string;
  codeReview: string;
  i13: string;
  red: string;
  baseline: string;
  green: string;
  testQuality: string;
}

const SINGLE: Paths = {
  tdd: "tdd@module:project@unit:default",
  codeGeneration: "code-generation@module:project@unit:default",
  codeReview: "code-review@module:project@unit:default",
  i13: ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json",
  red: ".aidlc/evidence/tdd/project/default/red-test-evidence.json",
  baseline: ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json",
  green: ".aidlc/evidence/code-generation/project/default/green-test-evidence.json",
  testQuality: ".aidlc/evidence/code-generation/project/default/test-quality.json",
};

interface Fixture {
  project: string;
  commits: string[];
  baseline: string;
  ucds: Ucd[];
}

interface Hooks {
  /** After the tdd stage completed (real RED / BASELINE evidence on disk). */
  afterTdd?: (fixture: Fixture) => void;
  /** Implementation and code-generation artifacts written, GREEN not yet produced. */
  beforeCodeGenerationReport?: (fixture: Fixture) => void;
}

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
  assert.equal(existsSync(join(project, "src")), false, "fixture must not contain src/");
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
  return { project, commits };
}

function next(project: string, expected: string): void {
  const directive = ok(project, ["orchestrate", "next"]).json;
  assert.equal(directive.kind, "run-stage", JSON.stringify(directive, null, 2));
  assert.equal(directive.stage_instance, expected, JSON.stringify(directive, null, 2));
}

/** Single-layout evidence is bound to the whole worktree: re-produce it after later writes. */
function refresh(project: string, instance: string): void {
  ok(project, ["evidence", "run", "--stage", instance.split("@", 1)[0], "--instance", instance, "--all-sensors", "--refresh"]);
}

/**
 * Drive a single-layout workflow (the state already exists) from workspace-detection
 * to implementation-report. `implementation` is the post-change app/exporter.py.
 */
function driveSingle(fixture: Fixture, scope: string, implementation: string, hooks: Hooks = {}): void {
  const { project, ucds } = fixture;
  next(project, "workspace-detection");
  ok(project, ["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  next(project, "state-template");
  ok(project, ["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);

  // I13: characterization UC-Ds bind their code refs to the workflow baseline.
  next(project, "test-case-derivation@module:project");
  const caseRoot = "docs/aidlc/modules/project/inception/application-design/test-cases";
  write(project, "docs/aidlc/modules/project/inception/requirements.md", REQUIREMENTS);
  write(project, `${caseRoot}/_index.md`, `# UC-D 索引\n\n${ucds.map((ucd) => `- ${ucd.id} ${ucd.title}（source_ref: REQ-001）`).join("\n")}\n`);
  for (const ucd of ucds) write(project, `${caseRoot}/${ucd.id}.md`, caseFile(ucd));
  ok(project, ["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
  const i13 = readJson(project, SINGLE.i13);
  assert.equal(i13.status, "required");
  assert.deepEqual(i13.ucd_modes, Object.fromEntries([...ucds].sort((a, b) => a.id.localeCompare(b.id)).map((ucd) => [ucd.id, ucd.mode])));
  const characterized = ucds.filter((ucd) => ucd.mode === "characterization");
  if (characterized.length > 0) assert.equal(i13.baseline_commit, fixture.baseline, "I13 records the workflow baseline");

  // tdd: RED for new UC-Ds, BASELINE for characterization UC-Ds, against the unmodified code.
  next(project, SINGLE.tdd);
  write(project, "tests/__init__.py", "\"\"\"Tests for the order export service.\"\"\"\n");
  write(project, "tests/test_exporter.py", pythonTests(ucds));
  write(project, "tests/observe_uc.cjs", observer(ucds));
  const roles = [
    ...(ucds.some((ucd) => ucd.mode === "new") ? [{ id: "uc-red", role: "red", argv: OBSERVE }] : []),
    ...(characterized.length > 0 ? [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }] : []),
  ];
  write(project, ".aidlc/commands/tdd.json", allowlist("tdd", roles));
  ok(project, ["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
  const red = readJson(project, SINGLE.red);
  const baselineEvidence = readJson(project, SINGLE.baseline);
  const newIds = ucds.filter((ucd) => ucd.mode === "new").map((ucd) => ucd.id);
  if (newIds.length > 0) {
    assert.equal(red.status, "failed");
    assert.deepEqual(red.uc_mapping.map((entry: Json) => entry.use_case), newIds);
  } else {
    assert.equal(red.status, "not_required");
  }
  if (characterized.length > 0) {
    assert.equal(baselineEvidence.status, "passed");
    assert.equal(baselineEvidence.baseline_commit, fixture.baseline);
    assert.deepEqual(baselineEvidence.uc_mapping.map((entry: Json) => entry.use_case), characterized.map((ucd) => ucd.id));
  } else {
    assert.equal(baselineEvidence.status, "not_required");
  }
  hooks.afterTdd?.(fixture);

  // GREEN: the implementation lives in app/, never in src/.
  refresh(project, "test-case-derivation@module:project");
  next(project, SINGLE.codeGeneration);
  write(project, "app/exporter.py", implementation);
  write(project, "app/__init__.py", "\"\"\"Order export application package; export behaviour is REQ-001.\"\"\"\n");
  const construction = "docs/aidlc/modules/project/construction/default";
  const ids = ucds.map((ucd) => ucd.id).join(" / ");
  write(project, `${construction}/plans/code-generation-plan.md`, `# 代码生成计划\n\n- REQ-001 / ${ids}：修改 app/exporter.py，存量行为由 BASELINE 锁定，新行为经 RED→GREEN。\n`);
  write(project, `${construction}/implementation-summary.md`, `# 实现摘要\n\nREQ-001 / ${ids} 已在 app/exporter.py 实现，tests/test_exporter.py 覆盖全部 UC-D。\n`);
  write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
  hooks.beforeCodeGenerationReport?.(fixture);
  ok(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  const green = readJson(project, SINGLE.green);
  assert.equal(green.status, "passed");
  assert.deepEqual(green.uc_mapping.map((entry: Json) => entry.use_case), ucds.map((ucd) => ucd.id));
  const quality = readJson(project, SINGLE.testQuality);
  assert.equal(quality.red_seen, newIds.length > 0, "test-quality red_seen follows the new UC-Ds");
  assert.equal(quality.baseline_seen, characterized.length > 0, "test-quality baseline_seen follows the characterization UC-Ds");
  const matrix = readJson(project, ".aidlc/evidence/code-generation/project/default/traceability-matrix.json");
  assert.deepEqual(matrix.broken_rows, [], JSON.stringify(matrix, null, 2));

  // Review: isolated, review-only reviewer.
  next(project, SINGLE.codeReview);
  write(project, `${construction}/code-review.md`, [
    "# 代码审查 — 单元 default",
    "",
    "- 审查模式: 集成双轴审查",
    "- reviewer: aidlc-quality-agent",
    "- execution_context: isolated",
    "- review_only: true",
    `- Spec 结果: passed（REQ-001 / ${ids}）`,
    "- Standards 结果: passed",
    "- issues_found: 0",
    "- issues_resolved: 0",
    "- issues_open: 0",
    "- 审查文件: app/exporter.py, tests/test_exporter.py",
    "- 修复状态: 无需修复",
    "",
  ].join("\n"));
  write(project, `${construction}/audit.md`, `# 审计 — 单元 default\n\n代码审查（REQ-001 / ${ids}）结论：passed，Spec 与 Standards 均通过。\n`);
  ok(project, ["orchestrate", "report", "--stage", "code-review", "--result", "completed"]);

  // Project-axis build-and-test.
  refresh(project, SINGLE.codeGeneration);
  next(project, "build-and-test");
  writeBuildAndTest(project, "app/exporter.py", ids);
  ok(project, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  ok(project, ["evidence", "run", "--stage", "build-and-test"]);
  ok(project, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);

  next(project, "implementation-report");
  writeImplementationReport(project, "docs/aidlc/construction/implementation-report.md", scope, 8, ids);
  ok(project, ["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
  assertDone(project);
}

function writeBuildAndTest(project: string, source: string, ids: string): void {
  write(project, "tests/build_check.cjs", `const { readFileSync } = require('node:fs');\nreadFileSync(${JSON.stringify(source)}, 'utf8');\nconsole.log('build ok');\n`);
  write(project, "tests/run_tests.cjs", "const { spawnSync } = require('node:child_process');\nconst result = spawnSync(process.execPath, ['tests/observe_uc.cjs'], { encoding: 'utf8', env: { ...process.env, AIDLC_PHASE: 'GREEN' } });\nprocess.stdout.write(result.stdout.split(/\\r?\\n/).filter((line) => !line.startsWith('{')).join('\\n'));\nprocess.exit(result.status ?? 1);\n");
  write(project, "tests/lint_check.cjs", `const { readFileSync } = require('node:fs');\nif (/\\t/.test(readFileSync(${JSON.stringify(source)}, 'utf8'))) process.exit(1);\nconsole.log('lint ok');\n`);
  write(project, ".aidlc/commands/build-and-test.json", allowlist("build-and-test", [
    { id: "build", role: "build", argv: ["node", "tests/build_check.cjs"] },
    { id: "unit-tests", role: "test", argv: ["node", "tests/run_tests.cjs"] },
    { id: "lint", role: "check", argv: ["node", "tests/lint_check.cjs"] },
  ]));
  write(project, "docs/aidlc/construction/build-test-report.md", `# 构建与测试报告\n\nREQ-001 / ${ids}：构建、单元测试与 lint 均通过（0 failed）。\n`);
  write(project, "docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# 构建与测试摘要\n\nREQ-001 的实现通过构建、测试和静态检查；存量行为由 BASELINE 证据锁定。\n");
}

function writeImplementationReport(project: string, path: string, scope: string, stages: number, ids: string): void {
  const evidenceRefs = listEvidence(join(project, ".aidlc", "evidence"))
    .map((file) => file.slice(project.length + 1).replace(/\\/g, "/"))
    .filter((file) => !file.startsWith(".aidlc/evidence/implementation-report/"))
    .sort();
  write(project, path, [
    "# 实施报告",
    "",
    `- scope: ${scope}`,
    `- stages_completed: ${stages}`,
    "- all_gates_passed: true",
    "",
    `REQ-001 / ${ids} 已完成：存量行为 BASELINE→GREEN，新行为 RED→GREEN，审查、构建与测试证据如下。`,
    "",
    "## 证据",
    "",
    ...evidenceRefs.map((file) => `- ${file}`),
    "",
  ].join("\n"));
}

function assertDone(project: string): void {
  const done = run(project, ["orchestrate", "next"]);
  assert.equal(done.status, 0, done.out);
  assert.notEqual(done.json.kind, "run-stage", done.out);
  assert.notEqual(done.json.kind, "error", done.out);
  assert.equal(existsSync(join(project, "src")), false, "the workflow must not require creating src/");
  for (const path of listEvidence(join(project, ".aidlc", "evidence"))) {
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(evidence.producer?.mode, "controlled", path);
    assert.equal(evidence.producer?.name, "loeyae-aidlc-evidence", path);
  }
}

/** A workflow started by `next --scope` (records HEAD as the baseline). */
function startedFixture(name: string, scope: string, ucds: Ucd[]): Fixture {
  const { project, commits } = legacyRepository(name);
  ok(project, ["orchestrate", "next", "--scope", scope, "--work", `4.6.0 S3b ${name}`]);
  const baseline = String(loadWorkflowState(project)!.baseline_commit);
  assert.equal(baseline, commits[1], "next --scope records HEAD as the workflow baseline");
  return { project, commits, baseline, ucds };
}

const REPLACE = (sha: string, expect: string) => ["orchestrate", "baseline", "--set", sha, "--replace", "--expect", expect, "--user-input", "Approve", "--reason", "更正基线"];

try {
  // ---------------------------------------------------------------- (a) refactor
  await section("e2e (a) refactor: Python app/ without src/, every UC-D characterization — BASELINE→GREEN to implementation-report", () => {
    const fixture = startedFixture("refactor", "refactor", [UCD_PAGINATION, UCD_EXPORT]);
    driveSingle(fixture, "refactor", EXPORTER_REFACTORED);
  });

  // ---------------------------------------------------------------- (b) bugfix + downstream negatives
  await section("e2e (b) bugfix: new and characterization UC-Ds mixed, with the downstream fail-closed cases and U3", () => {
    const checks = rejections();
    const fixture = startedFixture("bugfix", "bugfix", [UCD_RETRY, UCD_PAGINATION]);
    const { project } = fixture;
    let driveError: unknown;
    try {
      driveBugfix();
    } catch (error) {
      driveError = error;
    }
    // Report every fail-closed gap first, then any end-to-end failure.
    checks.assertAll();
    if (driveError) throw driveError;

    function driveBugfix(): void { driveSingle(fixture, "bugfix", EXPORTER_FIXED, {
      afterTdd: ({ commits, baseline }) => {
        // S1.3 U3 with a real BASELINE evidence file: --replace is refused, nothing written.
        const revision = loadWorkflowState(project)!.revision;
        const refused = run(project, REPLACE(commits[0], baseline));
        checks.expect("U3: --replace with real BASELINE evidence", rejected(refused), /already in use and cannot be replaced[\s\S]*U3 \.aidlc\/evidence\/tdd\/project\/default\/baseline-test-evidence\.json/);
        const after = loadWorkflowState(project)!;
        assert.equal(after.baseline_commit, baseline, "refused --replace keeps the baseline");
        assert.equal(after.revision, revision, "refused --replace writes no state");
      },
      beforeCodeGenerationReport: ({ commits, baseline }) => {
        // GREEN uc_mapping must cover every UC-D, characterization included.
        write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: [...OBSERVE, "--omit", UCD_PAGINATION.id] }]));
        ok(project, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
        checks.expect("GREEN uc_mapping misses the characterization UC-D", gate(project, SINGLE.codeGeneration, "green-test-evidence"), /GREEN uc_mapping must cover every I13 UC-D[\s\S]*missing UC-D-002/);
        write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
        rmSync(join(project, SINGLE.green));
        ok(project, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
        assert.equal(gate(project, SINGLE.codeGeneration, "green-test-evidence"), "", "GREEN covering every UC-D passes");

        // code-generation completion re-checks BASELINE (drift tolerated, provenance not).
        checks.expect("BASELINE producer.mode manual at code-generation", withTampered(project, SINGLE.baseline, (value) => ({ ...value, producer: { ...value.producer, mode: "manual" } }), () => rejected(run(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]))), /RED gate evidence is invalid[\s\S]*\[baseline-test-evidence\][\s\S]*producer\.mode must be \\*"controlled/);
        const orphan = git(project, ["commit-tree", `${commits[0]}^{tree}`, "-m", "orphan"]);
        checks.expect("BASELINE source_revision.commit not an ancestor of HEAD", withTampered(project, SINGLE.baseline, (value) => ({ ...value, source_revision: { ...value.source_revision, commit: orphan } }), () => rejected(run(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]))), new RegExp(`\\[baseline-test-evidence\\][\\s\\S]*source_revision\\.commit ${orphan} is not the current HEAD or one of its ancestors`));
        // The baseline replaced after BASELINE was produced: the old evidence no longer binds.
        const state = loadWorkflowState(project) as WorkflowState;
        saveWorkflowState(project, { ...state, baseline_commit: commits[0], baseline_source: "replaced" }, undefined, { baselineWrite: true });
        checks.expect("BASELINE produced under the replaced baseline", rejected(run(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"])), /\[baseline-test-evidence\][\s\S]*BASELINE baseline_commit .* does not match the workflow baseline/);
        saveWorkflowState(project, { ...(loadWorkflowState(project) as WorkflowState), baseline_commit: baseline, baseline_source: state.baseline_source }, undefined, { baselineWrite: true });

        // test-quality follows tdd_mode: characterization needs BASELINE passed, new needs RED failed.
        const quality = (): string => {
          rmSync(join(project, SINGLE.testQuality), { force: true });
          return rejected(run(project, ["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"]));
        };
        checks.expect("test-quality: characterization UC-D without BASELINE passed", withTampered(project, SINGLE.baseline, (value) => ({ ...value, status: "not_required", ucd_ids: [] }), quality), /BASELINE evidence/);
        checks.expect("test-quality: new UC-D without RED failed", withTampered(project, SINGLE.red, (value) => ({ ...value, status: "not_required", ucd_ids: [] }), quality), /RED evidence/);
        rmSync(join(project, SINGLE.testQuality), { force: true });
        ok(project, ["evidence", "run", "--stage", "code-generation", "--sensor", "test-quality"]);
        assert.equal(gate(project, SINGLE.codeGeneration, "test-quality"), "", "controlled test-quality passes");
        checks.expect("test-quality gate: baseline_seen false with a characterization UC-D", withTampered(project, SINGLE.testQuality, (value) => ({ ...value, baseline_seen: false }), () => gate(project, SINGLE.codeGeneration, "test-quality")), /baseline_seen must be true/);
        checks.expect("test-quality gate: red_seen false with a new UC-D", withTampered(project, SINGLE.testQuality, (value) => ({ ...value, red_seen: false }), () => gate(project, SINGLE.codeGeneration, "test-quality")), /red_seen must be true/);
        rmSync(join(project, SINGLE.testQuality), { force: true });
        rmSync(join(project, SINGLE.green), { force: true });
      },
    }); }
  });

  // ---------------------------------------------------------------- (c) existing workflow
  await section("e2e (c) existing workflow: pre-4.6 state, orchestrate baseline --set, then characterization to implementation-report", () => {
    const { project, commits } = legacyRepository("existing");
    const legacy = createInitialState("refactor", "4.5.4", `workflow-existing-${counter}`, [], "4.6.0 S3b existing workflow");
    saveWorkflowState(project, legacy);
    assert.equal((loadWorkflowState(project) as WorkflowState & Record<string, unknown>).baseline_commit, undefined, "pre-4.6 state has no baseline");
    ok(project, ["orchestrate", "baseline", "--set", commits[1], "--user-input", "Approve", "--reason", "登记存量基线"]);
    const state = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(state.baseline_commit, commits[1]);
    assert.equal(state.baseline_source, "registered");
    driveSingle({ project, commits, baseline: commits[1], ucds: [UCD_PAGINATION] }, "refactor", EXPORTER_REFACTORED);
  });

  // ---------------------------------------------------------------- (d) split layout
  await section("e2e (d) split layout: module sub-workflow with a characterization UC-D inherits the parent baseline to implementation-report", () => {
    const M01 = "m01-trade";
    const { project, commits } = legacyRepository("split");
    write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Trade", service_id: "trade-service" }] })}\n`);
    git(project, ["add", "docs/aidlc/ideation/module-manifest.json"]);
    git(project, ["commit", "-qm", "c3 module manifest"], "2024-01-03T00:00:00Z");
    const baseline = git(project, ["rev-parse", "HEAD"]);
    ok(project, ["orchestrate", "next", "--scope", "feature", "--work", "4.6.0 S3b split characterization"]);
    const global = loadWorkflowState(project)!;
    assert.equal(global.baseline_commit, baseline, "next --scope records HEAD as the parent baseline");
    // Product-level stages are recorded as completed exactly like the existing split
    // fixtures (test_split_next_routing, test_v4_6_0_baseline splitProject); their
    // artifacts that module stages consume are real content below.
    const globalStages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
    global.completed_stages = [...globalStages];
    global.completed_stage_instances = [...globalStages];
    global.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
    saveWorkflowState(project, global);
    write(project, "docs/aidlc/ideation/scenario-module-mapping.md", `# 场景模块映射\n\nREQ-001 订单导出分页属于 ${M01}。\n`);
    ok(project, ["orchestrate", "split", "--from", global.workflow_id]);
    const moduleRef = { kind: "module" as const, module_id: M01 };
    assert.equal((loadWorkflowState(project, moduleRef) as WorkflowState & Record<string, unknown>).baseline_commit, undefined, "module sub-workflow carries no baseline of its own");

    const moduleArgs = ["--module", M01];
    const unitArgs = ["--module", M01, "--unit", "default"];
    const nextModule = (expected: string, refreshes: string[][] = []) => {
      for (const args of refreshes) ok(project, ["evidence", "run", ...args, "--refresh"]);
      const directive = ok(project, ["orchestrate", "next", ...moduleArgs]).json;
      assert.equal(directive.stage_instance, expected, JSON.stringify(directive, null, 2));
    };
    const report = (stage: string, extra: string[] = []) => ok(project, ["orchestrate", "report", "--stage", stage, ...(stage === "tdd" || stage === "code-generation" || stage === "code-review" ? unitArgs : moduleArgs), "--result", "completed", ...extra]);
    const ack = (stage: string) => report(stage, ["--instruction-ack", stage]);
    const RA = ["--stage", "requirements-analysis", ...moduleArgs];
    const inception = `docs/aidlc/modules/${M01}/inception`;

    nextModule(`requirements-analysis@module:${M01}`);
    write(project, `${inception}/requirements.md`, "# 需求\n\n## REQ-001 订单导出分页\n\ntrack: [backend]\n\n业务规则：订单导出接口按 50 条分页返回，现有分页行为在本次重构中保持不变。\n");
    report("requirements-analysis");
    nextModule(`requirement-clarification@module:${M01}`);
    write(project, `${inception}/clarifications.md`, "# 需求澄清\n\nNo clarifications needed.\n\nREQ-001 的分页规则（50 条一页）已在需求中明确，本次重构沿用现有行为。\n");
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
    write(project, `${inception}/workflow-plan.md`, "# 工作流规划\n\nREQ-001：现有分页行为以 characterization UC-D 锁定（BASELINE），重构后经 GREEN 复验；不需要应用设计与单元拆分。\n");
    report("workflow-planning");

    // I13 in the module workflow binds the characterization code refs to the parent baseline.
    nextModule(`test-case-derivation@module:${M01}`);
    const caseRoot = `${inception}/application-design/test-cases`;
    write(project, `${caseRoot}/_index.md`, `# UC-D 索引\n\n- ${UCD_PAGINATION.id} ${UCD_PAGINATION.title}（source_ref: REQ-001）\n`);
    write(project, `${caseRoot}/${UCD_PAGINATION.id}.md`, caseFile(UCD_PAGINATION));
    report("test-case-derivation");
    const i13 = readJson(project, `.aidlc/evidence/test-case-derivation/${M01}/test-case-derivation.json`);
    assert.deepEqual(i13.ucd_modes, { [UCD_PAGINATION.id]: "characterization" });
    assert.equal(i13.baseline_commit, baseline, "module I13 inherits the parent baseline");

    nextModule(`tdd@module:${M01}@unit:default`);
    write(project, "tests/__init__.py", "\"\"\"Tests for the order export service.\"\"\"\n");
    write(project, "tests/test_exporter.py", pythonTests([UCD_PAGINATION]));
    write(project, "tests/observe_uc.cjs", observer([UCD_PAGINATION]));
    write(project, ".aidlc/commands/tdd.json", allowlist("tdd", [{ id: "uc-baseline", role: "baseline", argv: OBSERVE }]));
    report("tdd");
    const red = readJson(project, `.aidlc/evidence/tdd/${M01}/default/red-test-evidence.json`);
    const baselineEvidence = readJson(project, `.aidlc/evidence/tdd/${M01}/default/baseline-test-evidence.json`);
    assert.equal(red.status, "not_required");
    assert.equal(baselineEvidence.status, "passed");
    assert.equal(baselineEvidence.baseline_commit, baseline, "module BASELINE binds the parent baseline");
    assert.equal(baselineEvidence.source_revision.scope, `module:${M01}`);

    nextModule(`code-generation@module:${M01}@unit:default`, [["--stage", "test-case-derivation", ...moduleArgs]]);
    write(project, "app/exporter.py", EXPORTER_REFACTORED);
    write(project, "app/__init__.py", "\"\"\"Order export application package; export behaviour is REQ-001.\"\"\"\n");
    const construction = `docs/aidlc/modules/${M01}/construction/default`;
    write(project, `${construction}/plans/code-generation-plan.md`, `# 代码生成计划\n\n- REQ-001 / ${UCD_PAGINATION.id}：重构 app/exporter.py 的分页常量，存量行为由 BASELINE 锁定。\n`);
    write(project, `${construction}/implementation-summary.md`, `# 实现摘要\n\nREQ-001 / ${UCD_PAGINATION.id} 已在 app/exporter.py 重构，tests/test_exporter.py 覆盖。\n`);
    write(project, ".aidlc/commands/code-generation.json", allowlist("code-generation", [{ id: "uc-green", role: "green", argv: OBSERVE }]));
    report("code-generation");
    const quality = readJson(project, `.aidlc/evidence/code-generation/${M01}/default/test-quality.json`);
    assert.equal(quality.red_seen, false);
    assert.equal(quality.baseline_seen, true);

    nextModule(`code-review@module:${M01}@unit:default`);
    write(project, `${construction}/code-review.md`, [
      "# 代码审查 — 单元 default",
      "",
      "- 审查模式: 集成双轴审查",
      "- reviewer: aidlc-quality-agent",
      "- execution_context: isolated",
      "- review_only: true",
      `- Spec 结果: passed（REQ-001 / ${UCD_PAGINATION.id}）`,
      "- Standards 结果: passed",
      "- issues_found: 0",
      "- issues_resolved: 0",
      "- issues_open: 0",
      "- 审查文件: app/exporter.py, tests/test_exporter.py",
      "- 修复状态: 无需修复",
      "",
    ].join("\n"));
    write(project, `${construction}/audit.md`, `# 审计 — 单元 default\n\n代码审查（REQ-001 / ${UCD_PAGINATION.id}）结论：passed。\n`);
    report("code-review");
    assert.equal(ok(project, ["orchestrate", "next", ...moduleArgs]).json.kind, "done", "module workflow resolved");

    // Integration workflow: build-and-test, templates, implementation-report.
    ok(project, ["evidence", "run", "--stage", "code-generation", ...unitArgs, "--refresh"]);
    next(project, "build-and-test");
    writeBuildAndTest(project, "app/exporter.py", UCD_PAGINATION.id);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test"]);
    ok(project, ["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);
    next(project, "build-and-test-templates");
    write(project, "docs/aidlc/construction/build-and-test/build-instructions.md", "# 构建说明\n\nREQ-001：执行 node tests/build_check.cjs 校验 app/exporter.py 可读取，作为 Python 源码的构建检查。\n");
    write(project, "docs/aidlc/construction/build-and-test/unit-test-instructions.md", `# 单元测试说明\n\nREQ-001：执行 node tests/run_tests.cjs 运行 ${UCD_PAGINATION.id} 的 GREEN 观察，期望 0 failed。\n`);
    ok(project, ["orchestrate", "report", "--stage", "build-and-test-templates", "--result", "completed"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--all-sensors", "--refresh"]);
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--instance", "build-and-test", "--sensor", "test-quality", "--refresh"]);
    next(project, "implementation-report");
    const completed = [undefined, moduleRef, { kind: "integration" as const }].reduce((total, ref) => total + loadWorkflowState(project, ref)!.completed_stage_instances.length, 0) + 1;
    writeImplementationReport(project, "docs/aidlc/construction/implementation-report.md", "feature", completed, UCD_PAGINATION.id);
    ok(project, ["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
    const done = ok(project, ["orchestrate", "next"]).json;
    assert.equal(done.kind, "done", JSON.stringify(done, null, 2));
    assertDone(project);
    assert.equal(loadWorkflowState(project)!.baseline_commit, baseline, "parent baseline unchanged");
    assert.notEqual(baseline, commits[1]);
  });

  if (failed.length > 0) {
    console.log(`4.6.0 S3b downstream regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.6.0 S3b downstream regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
