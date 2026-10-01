/**
 * 4.5.4 end-to-end fixture: a Python project whose sources live in `app/` (and
 * `web/src/`), with no `src/`, no module-manifest, scope=refactor.
 *
 * The workflow is driven from workspace-detection to implementation-report using
 * only the public CLI. No evidence JSON is written by this test: every gate file
 * comes from the controlled producer (`report` auto-production or `evidence run`).
 * No placeholder files are added; every artifact carries real fixture content.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-py-refactor-"));
const project = join(scratch, "orders");

function run(args: string[]): { status: number; out: string; json: Record<string, unknown> | null } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(result.stdout || ""); } catch { json = null; }
  return { status: result.status ?? 1, out, json };
}

/** Run a CLI step that must succeed and must not return an error directive. */
function ok(args: string[]): Record<string, unknown> {
  const result = run(args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  assert.notEqual(result.json?.kind, "error", `${args.join(" ")}\n${result.out}`);
  return result.json || {};
}

function write(path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function git(args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

/** Advance with `next` and assert which stage instance it hands out. */
function next(expectedInstance: string): void {
  const directive = ok(["orchestrate", "next"]);
  assert.equal(directive.kind, "run-stage", JSON.stringify(directive, null, 2));
  assert.equal(directive.stage_instance, expectedInstance, JSON.stringify(directive, null, 2));
}

/**
 * Single-layout evidence is bound to the whole worktree, so `next` re-verifies a
 * completed upstream stage only after its evidence is re-produced by the
 * controlled producer (`--refresh`) once later stages have written files.
 */
function refresh(instance: string): void {
  const stage = instance.split("@", 1)[0];
  ok(["evidence", "run", "--stage", stage, "--instance", instance, "--all-sensors", "--refresh"]);
}

function listEvidence(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? listEvidence(path) : entry.name.endsWith(".json") ? [path] : [];
  });
}

// Deterministic test observer: evaluates UC-D-001 against the Python source and
// reports the controlled RED/GREEN observation the evidence producer expects.
const OBSERVER = `const { readFileSync } = require("node:fs");
const source = readFileSync("app/exporter.py", "utf8");
const passed = /MAX_RETRIES\\s*=\\s*3/.test(source) && /except\\s+TimeoutError/.test(source);
const phase = process.env.AIDLC_PHASE || "GREEN";
const observation = { phase, status: passed ? "passed" : "failed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: passed ? 0 : 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["tests/test_exporter.py::test_export_retries_on_timeout"] }] };
if (!passed) Object.assign(observation, { failure_class: "behavior", failure_signature: "UC-D-001 export_orders raised TimeoutError without retrying" });
console.log(JSON.stringify(observation));
console.log(passed ? "1 passed" : "1 failed");
process.exit(passed ? 0 : 1);
`;

try {
  mkdirSync(project, { recursive: true });
  write("README.md", "# Orders service\n\nPython order export service.\n");
  write("app/__init__.py", "\"\"\"Order export application package.\"\"\"\n");
  write("app/exporter.py", "def export_orders(client):\n    return client.fetch_orders()\n");
  write("web/src/export-button.js", "export function exportLabel() {\n  return 'Export orders';\n}\n");
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  assert.equal(existsSync(join(project, "src")), false, "fixture must not contain src/");

  // Source roots for a non-src project (D6). No module-manifest exists.
  write(".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app", "web/src"] }, null, 2)}\n`);

  ok(["orchestrate", "next", "--scope", "refactor", "--work", "重构订单导出：超时后重试"]);
  next("workspace-detection");
  ok(["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  next("state-template");
  ok(["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);

  // I13 test-case derivation.
  next("test-case-derivation@module:project");
  const inception = "docs/aidlc/modules/project/inception";
  write(`${inception}/requirements.md`, "# 需求\n\n## REQ-001 导出超时重试\n\ntrack: [nfr]\n\n业务规则：订单导出接口在下游超时时最多重试 3 次，3 次内成功则返回订单列表。\n");
  write(`${inception}/application-design/test-cases/_index.md`, "# UC-D 索引\n\n| UC-D | 来源 |\n| --- | --- |\n| UC-D-001 | REQ-001 |\n");
  write(`${inception}/application-design/test-cases/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\n---\n# UC-D-001 导出超时后重试\n\nGiven 下游首次调用超时，When 调用 export_orders，Then 重试后返回订单列表。\n");
  ok(["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
  // D4: the module-layout I13 required branch (UC-D cases read from the module test-case root).
  const i13 = JSON.parse(readFileSync(join(project, ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json"), "utf8"));
  assert.equal(i13.status, "required");
  assert.deepEqual(i13.ucd_ids, ["UC-D-001"]);

  // RED.
  next("tdd@module:project@unit:default");
  write("tests/__init__.py", "\"\"\"Tests for the order export service.\"\"\"\n");
  write("tests/test_exporter.py", "# REQ-001 UC-D-001\nfrom app.exporter import export_orders\n\n\nclass FlakyClient:\n    def __init__(self):\n        self.calls = 0\n\n    def fetch_orders(self):\n        self.calls += 1\n        if self.calls == 1:\n            raise TimeoutError(\"upstream timeout\")\n        return [\"order-1\"]\n\n\ndef test_export_retries_on_timeout():\n    assert export_orders(FlakyClient()) == [\"order-1\"]\n");
  write("tests/observe_uc.cjs", OBSERVER);
  write(".aidlc/commands/tdd.json", `${JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "uc-red", role: "red", argv: ["node", "tests/observe_uc.cjs"] }] }, null, 2)}\n`);
  ok(["orchestrate", "report", "--stage", "tdd", "--result", "completed"]);
  const red = JSON.parse(readFileSync(join(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json"), "utf8"));
  assert.equal(red.status, "failed");
  assert.equal(red.producer.mode, "controlled");

  // GREEN: implementation lives in app/, never in src/.
  refresh("test-case-derivation@module:project");
  next("code-generation@module:project@unit:default");
  write("app/exporter.py", "\"\"\"Order export with timeout retry (REQ-001, UC-D-001).\"\"\"\n\nMAX_RETRIES = 3\n\n\ndef export_orders(client):\n    last_error = None\n    for _ in range(MAX_RETRIES):\n        try:\n            return client.fetch_orders()\n        except TimeoutError as error:\n            last_error = error\n    raise last_error\n");
  // Every file under the configured source roots must trace a requirement (traceability sensor).
  write("app/__init__.py", "\"\"\"Order export application package; export retry behaviour is REQ-001.\"\"\"\n");
  write("web/src/export-button.js", "// REQ-001: the export button relies on the backend timeout retry.\nexport function exportLabel() {\n  return 'Export orders';\n}\n");
  const construction = "docs/aidlc/modules/project/construction/default";
  write(`${construction}/plans/code-generation-plan.md`, "# 代码生成计划\n\n- REQ-001 / UC-D-001：在 app/exporter.py 中为 export_orders 增加最多 3 次的超时重试。\n");
  write(`${construction}/implementation-summary.md`, "# 实现摘要\n\nREQ-001 / UC-D-001 已在 app/exporter.py 实现：超时重试 3 次，tests/test_exporter.py 覆盖。\n");
  write(".aidlc/commands/code-generation.json", `${JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "uc-green", role: "green", argv: ["node", "tests/observe_uc.cjs"] }] }, null, 2)}\n`);
  ok(["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
  const matrix = JSON.parse(readFileSync(join(project, ".aidlc/evidence/code-generation/project/default/traceability-matrix.json"), "utf8"));
  assert.deepEqual(matrix.broken_rows, [], JSON.stringify(matrix, null, 2));

  // Review mode: isolated, review-only reviewer declared in the record (D1).
  next("code-review@module:project@unit:default");
  const review = [
    "# 代码审查 — 单元 default",
    "",
    "- 审查模式: 集成双轴审查",
    "- reviewer: aidlc-quality-agent",
    "- execution_context: isolated",
    "- review_only: true",
    "- Spec 结果: passed（REQ-001 / UC-D-001 已实现）",
    "- Standards 结果: passed",
    "- issues_found: 0",
    "- issues_resolved: 0",
    "- issues_open: 0",
    "- 审查文件: app/exporter.py, tests/test_exporter.py",
    "- 修复状态: 无需修复",
    "",
  ].join("\n");
  write(`${construction}/code-review.md`, review);
  write(`${construction}/audit.md`, "# 审计 — 单元 default\n\n代码审查（REQ-001 / UC-D-001）结论：passed，Spec 与 Standards 均通过，无需修复。\n");
  ok(["orchestrate", "report", "--stage", "code-review", "--result", "completed"]);
  const reviewEvidence = JSON.parse(readFileSync(join(project, ".aidlc/evidence/code-review/project/default/review-evidence.json"), "utf8"));
  assert.equal(reviewEvidence.reviewer_agent, "aidlc-quality-agent");
  assert.equal(reviewEvidence.execution_context, "isolated");
  assert.equal(reviewEvidence.review_only, true);

  // Project-axis build-and-test: test-quality must not demand a module (D2).
  refresh("code-generation@module:project@unit:default");
  next("build-and-test");
  write("tests/build_check.cjs", "const { readFileSync } = require('node:fs');\nfor (const file of ['app/__init__.py', 'app/exporter.py']) readFileSync(file, 'utf8');\nconsole.log('build ok');\n");
  write("tests/run_tests.cjs", "const { spawnSync } = require('node:child_process');\nconst result = spawnSync(process.execPath, ['tests/observe_uc.cjs'], { encoding: 'utf8', env: { ...process.env, AIDLC_PHASE: 'GREEN' } });\nprocess.stdout.write(result.stdout.split(/\\r?\\n/).filter((line) => !line.startsWith('{')).join('\\n'));\nprocess.exit(result.status ?? 1);\n");
  write("tests/lint_check.cjs", "const { readFileSync } = require('node:fs');\nif (/\\t/.test(readFileSync('app/exporter.py', 'utf8'))) process.exit(1);\nconsole.log('lint ok');\n");
  write(".aidlc/commands/build-and-test.json", `${JSON.stringify({ version: "1", stage: "build-and-test", commands: [
    { id: "build", role: "build", argv: ["node", "tests/build_check.cjs"] },
    { id: "unit-tests", role: "test", argv: ["node", "tests/run_tests.cjs"] },
    { id: "lint", role: "check", argv: ["node", "tests/lint_check.cjs"] },
  ] }, null, 2)}\n`);
  write("docs/aidlc/construction/build-test-report.md", "# 构建与测试报告\n\nREQ-001 / UC-D-001：构建、单元测试与 lint 均通过（1 passed, 0 failed）。\n");
  write("docs/aidlc/construction/build-and-test/build-and-test-summary.md", "# 构建与测试摘要\n\nREQ-001 的超时重试实现通过构建、测试和静态检查。\n");
  ok(["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
  ok(["evidence", "run", "--stage", "build-and-test"]);
  ok(["orchestrate", "report", "--stage", "build-and-test", "--result", "completed"]);

  // Implementation report: modules_verified agrees between checker and gate (D3).
  next("implementation-report");
  const evidenceRefs = listEvidence(join(project, ".aidlc", "evidence"))
    .map((path) => path.slice(project.length + 1).replace(/\\/g, "/"))
    .filter((path) => !path.startsWith(".aidlc/evidence/implementation-report/"))
    .sort();
  write("docs/aidlc/construction/implementation-report.md", [
    "# 实施报告",
    "",
    "- scope: refactor",
    "- stages_completed: 8",
    "- all_gates_passed: true",
    "",
    "REQ-001 / UC-D-001 已完成：app/exporter.py 实现超时重试，RED→GREEN、审查、构建与测试证据如下。",
    "",
    "## 证据",
    "",
    ...evidenceRefs.map((path) => `- ${path}`),
    "",
  ].join("\n"));
  ok(["orchestrate", "report", "--stage", "implementation-report", "--result", "completed"]);
  const report = JSON.parse(readFileSync(join(project, ".aidlc/evidence/implementation-report/implementation-report.json"), "utf8"));
  assert.equal(report.modules_verified, 1);

  const done = run(["orchestrate", "next"]);
  assert.equal(done.status, 0, done.out);
  assert.notEqual(done.json?.kind, "run-stage", done.out);
  assert.notEqual(done.json?.kind, "error", done.out);
  assert.equal(existsSync(join(project, "src")), false, "the workflow must not require creating src/");

  // Every evidence file came from the controlled producer.
  for (const path of listEvidence(join(project, ".aidlc", "evidence"))) {
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(evidence.producer?.mode, "controlled", path);
    assert.equal(evidence.producer?.name, "loeyae-aidlc-evidence", path);
  }

  console.log("Python refactor end-to-end workflow test passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
