/**
 * 4.5.4 regression suite: one section per engine defect (D1-D3, D5-D8), each with
 * the positive case and at least one fail-closed negative case. D4 (I13 path
 * duplication) is covered by tests/test_i13_case_root.ts and the I13 required
 * branch of tests/test_python_refactor_e2e.ts.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

// New 4.5.4 APIs are imported per section so that, on an unfixed engine, each defect
// reports its own failure instead of the whole suite failing at module link time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;
const scanRootModule = (): Promise<AnyModule> => import("../core/tools/aidlc-scan-root");
const executionContextModule = (): Promise<AnyModule> => import("../core/tools/aidlc-execution-context");
const sourceRootsModule = (): Promise<AnyModule> => import("../core/tools/aidlc-source-roots");
const evidenceModule = (): Promise<AnyModule> => import("../core/tools/aidlc-evidence");
function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not exported`);
  return value;
}

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-454-"));
const sections: string[] = [];
const failed: string[] = [];

type Run = { status: number; out: string; stdout: string };

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AIDLC_ACTIVE_MODULE;
  delete env.AIDLC_ACTIVE_UNIT;
  delete env.AIDLC_ACTIVE_STAGE;
  return { ...env, ...extra };
}

function run(project: string, args: string[], env: Record<string, string> = {}): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv(env) });
  return { status: result.status ?? 1, stdout: result.stdout || "", out: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function ok(project: string, args: string[], env: Record<string, string> = {}): Run {
  const result = run(project, args, env);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  return result;
}

function checker(project: string, args: string[], env: Record<string, string> = {}): Record<string, unknown> {
  const result = ok(project, ["check", ...args], env);
  return JSON.parse(result.stdout);
}

function gate(project: string, instance: string, mode: "sensors" | "produces" | "consumes", sensor?: string): Record<string, string[] | string> {
  const result = spawnSync(process.execPath, [tsx, probe, instance, mode, ...(sensor ? [sensor] : [])], { cwd: project, encoding: "utf8", env: cleanEnv() });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).pop() || "{}");
}

/** SHA-256 over JSON.stringify(argv): the digest the controlled producer records for a command. */
function digestArgv(argv: string[]): string {
  return createHash("sha256").update(JSON.stringify(argv)).digest("hex");
}

function gitOut(project: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Collects fail-closed expectations so one run reports every case that was accepted
 * (or rejected for the wrong reason) instead of stopping at the first.
 */
function rejections(): { expect: (label: string, output: string, pattern: RegExp) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    expect(label, output, pattern) {
      if (!pattern.test(output)) gaps.push(`${label}: expected rejection ${pattern}, got: ${output.trim() ? output.trim().slice(-400) : "ACCEPTED (no failures)"}`);
    },
    assertAll() {
      assert.equal(gaps.length, 0, `fail-closed cases not rejected:\n- ${gaps.join("\n- ")}`);
    },
  };
}

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function makeProject(name: string, scope = "refactor"): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  write(project, "README.md", `# ${name}\n`);
  write(project, "app/exporter.py", "def export_orders(client):\n    return client.fetch_orders()\n");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
    });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  };
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  const state = createInitialState(scope, "4.5.4", `workflow-${name}`, [], "4.5.4 regression");
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveWorkflowState(project, state);
  return project;
}

/** Move the seeded workflow to a stage instance (test setup only; evidence still comes from the producer). */
function seed(project: string, instance: string, completed: string[] = []): void {
  const state = loadWorkflowState(project) as WorkflowState;
  const stage = instance.split("@", 1)[0];
  for (const done of completed) {
    if (!state.completed_stage_instances.includes(done)) state.completed_stage_instances.push(done);
    const slug = done.split("@", 1)[0];
    if (!state.completed_stages.includes(slug)) state.completed_stages.push(slug);
  }
  state.current_stage = stage;
  state.current_stage_instance = instance;
  state.current_phase = ["test-case-derivation"].includes(stage) ? "inception" : "construction";
  const moduleId = /@module:([a-z0-9-]+)/.exec(instance)?.[1];
  const unitId = /@unit:([a-z0-9-]+)/.exec(instance)?.[1];
  if (moduleId) state.current_module = moduleId; else delete state.current_module;
  if (unitId) state.current_unit = unitId; else delete state.current_unit;
  saveWorkflowState(project, state);
}

const INCEPTION = "docs/aidlc/modules/project/inception";
const CONSTRUCTION = "docs/aidlc/modules/project/construction/default";
const OBSERVER = `const { readFileSync } = require("node:fs");
const passed = /MAX_RETRIES\\s*=\\s*3/.test(readFileSync("app/exporter.py", "utf8"));
const observation = { phase: process.env.AIDLC_PHASE, status: passed ? "passed" : "failed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: passed ? 0 : 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["tests/test_exporter.py::test_retry"] }] };
if (!passed) Object.assign(observation, { failure_class: "behavior", failure_signature: "UC-D-001 no retry" });
console.log(JSON.stringify(observation));
process.exit(passed ? 0 : 1);
`;

/** Produce controlled I13 evidence (required branch) for module `project`. */
function produceRequiredI13(project: string): void {
  write(project, `${INCEPTION}/requirements.md`, "# 需求\n\n## REQ-001 导出重试\n\ntrack: [nfr]\n\n业务规则：导出接口超时后重试 3 次。\n");
  write(project, `${INCEPTION}/application-design/test-cases/_index.md`, "# UC-D\n\n| UC-D | 来源 |\n| --- | --- |\n| UC-D-001 | REQ-001 |\n");
  write(project, `${INCEPTION}/application-design/test-cases/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-001\n---\n# UC-D-001\n\nGiven 超时 When 导出 Then 重试。\n");
  seed(project, "test-case-derivation@module:project");
  ok(project, ["evidence", "run", "--stage", "test-case-derivation"]);
}

/** Produce controlled I13 evidence (not_applicable branch) for module `project`. */
function produceNotApplicableI13(project: string): void {
  write(project, `${INCEPTION}/requirements.md`, "# 需求\n\n## REQ-001 配置声明\n\ntrack: [nfr]\n\n只调整配置声明。\n");
  write(project, `${INCEPTION}/application-design/test-cases/non-applicable.json`, JSON.stringify({ schema_version: "1", status: "not_applicable", reason_code: "pure-configuration", reason: "只调整配置声明", approval_ref: "approved design decision", alternative_validation: "config validation", validation_command: "node check.cjs", source_refs: ["REQ-001"] }));
  seed(project, "test-case-derivation@module:project");
  ok(project, ["evidence", "run", "--stage", "test-case-derivation"]);
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

try {
  // ---------------------------------------------------------------- D1
  await section("D1 review-evidence emits review-mode fields from stage metadata and record declarations", () => {
    const project = makeProject("d1-review");
    const instance = "code-review@module:project@unit:default";
    seed(project, instance, ["test-case-derivation@module:project", "tdd@module:project@unit:default", "code-generation@module:project@unit:default"]);
    const record = (extra: string[]) => [
      "# 代码审查 — 单元 default",
      "- reviewer: aidlc-quality-agent",
      ...extra,
      "- Spec 结果: passed",
      "- Standards 结果: passed",
      "- issues_found: 0",
      "- issues_resolved: 0",
      "- issues_open: 0",
      "- 审查文件: app/exporter.py",
      "",
    ].join("\n");
    const produceAndGate = (extra: string[]): string[] => {
      write(project, `${CONSTRUCTION}/code-review.md`, record(extra));
      ok(project, ["evidence", "run", "--stage", "code-review", "--sensor", "review-evidence"]);
      return gate(project, instance, "sensors", "review-evidence").failures as string[];
    };

    const declared = ["- execution_context: isolated", "- review_only: true"];
    write(project, `${CONSTRUCTION}/code-review.md`, record(declared));
    const declaredPayload = checker(project, ["--sensor", "review-evidence", "--module", "project", "--unit", "default"], { AIDLC_ACTIVE_STAGE: "code-review" });
    assert.equal(declaredPayload.reviewer_agent, "aidlc-quality-agent");
    assert.equal(declaredPayload.execution_context, "isolated");
    assert.equal(declaredPayload.review_only, true);
    assert.deepEqual(produceAndGate(declared), [], "controlled review evidence with both declarations passes the review-mode gate");

    // Fail-closed: a missing or wrong declaration is never filled in by the checker.
    assert.match(produceAndGate(["- review_only: true"]).join("\n"), /execution_context must be "isolated"/);
    assert.match(produceAndGate(["- execution_context: isolated"]).join("\n"), /review_only must be true/);
    assert.match(produceAndGate(["- execution_context: inline", "- review_only: true"]).join("\n"), /execution_context must be "isolated"/);
    assert.match(produceAndGate(["- execution_context: isolated", "- review_only: false"]).join("\n"), /review_only must be true/);
    assert.match(produceAndGate(["- reviewer_agent: aidlc-developer-agent", ...declared]).join("\n"), /reviewer_agent must be aidlc-quality-agent/);
    write(project, `${CONSTRUCTION}/code-review.md`, record([]));
    const undeclared = checker(project, ["--sensor", "review-evidence", "--module", "project", "--unit", "default"], { AIDLC_ACTIVE_STAGE: "code-review" });
    assert.equal("execution_context" in undeclared, false);
    assert.equal("review_only" in undeclared, false);
  });

  // ---------------------------------------------------------------- D2
  await section("D2 empty AIDLC_ACTIVE_MODULE/UNIT do not request module context", async () => {
    const project = makeProject("d2-context");
    produceNotApplicableI13(project);
    seed(project, "build-and-test", ["test-case-derivation@module:project"]);
    // Checker half: explicitly empty variables (what 4.5.3 producers exported) are not a context request.
    const payload = checker(project, ["--sensor", "test-quality"], { AIDLC_ACTIVE_MODULE: "", AIDLC_ACTIVE_UNIT: "" });
    assert.equal(payload.status, "not_applicable");
    // End to end through the controlled producer on the project-axis stage.
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--sensor", "test-quality"]);
    assert.deepEqual(gate(project, "build-and-test", "sensors", "test-quality").failures, []);

    // Fail-closed: a non-empty unit without module, an explicit --module without unit,
    // and a state module without unit keep the original context errors.
    const unitOnly = run(project, ["check", "--sensor", "test-quality"], { AIDLC_ACTIVE_UNIT: "default" });
    assert.notEqual(unitOnly.status, 0);
    assert.match(unitOnly.out, /active module is required for semantic sensor test-quality/);
    const moduleArg = run(project, ["check", "--sensor", "test-quality", "--module", "project"]);
    assert.notEqual(moduleArg.status, 0);
    assert.match(moduleArg.out, /active unit is required for semantic sensor test-quality/);
    const state = loadWorkflowState(project) as WorkflowState;
    state.current_module = "project";
    saveWorkflowState(project, state);
    const stateModule = run(project, ["check", "--sensor", "test-quality"]);
    assert.notEqual(stateModule.status, 0);
    assert.match(stateModule.out, /active unit is required for semantic sensor test-quality/);

    // Producer half: empty context is not exported, and inherited stale values are dropped.
    const semanticCheckerEnv = required((await evidenceModule()).semanticCheckerEnv, "semanticCheckerEnv");
    const env = semanticCheckerEnv({ current_stage: "build-and-test" }, { PATH: "x", AIDLC_ACTIVE_MODULE: "stale", AIDLC_ACTIVE_UNIT: "stale" });
    assert.equal(Object.prototype.hasOwnProperty.call(env, "AIDLC_ACTIVE_MODULE"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(env, "AIDLC_ACTIVE_UNIT"), false);
    assert.equal(env.AIDLC_ACTIVE_STAGE, "build-and-test");
    const scoped = semanticCheckerEnv({ current_stage: "tdd", current_module: "project", current_unit: "default" }, {});
    assert.equal(scoped.AIDLC_ACTIVE_MODULE, "project");
    assert.equal(scoped.AIDLC_ACTIVE_UNIT, "default");
  });

  // ---------------------------------------------------------------- D3
  await section("D3 modules_verified is computed by one shared function", async () => {
    const project = makeProject("d3-report");
    produceNotApplicableI13(project);
    seed(project, "implementation-report", ["test-case-derivation@module:project"]);
    write(project, "docs/aidlc/construction/implementation-report.md", "# 实施报告\n\n- scope: refactor\n- stages_completed: 3\n- all_gates_passed: true\n\nREQ-001 证据：\n\n- .aidlc/evidence/test-case-derivation/project/test-case-derivation.json\n");
    const payload = checker(project, ["--sensor", "implementation-report"]);
    assert.equal(payload.modules_verified, 1);
    ok(project, ["evidence", "run", "--stage", "implementation-report", "--sensor", "implementation-report"]);
    assert.deepEqual(gate(project, "implementation-report", "sensors", "implementation-report").failures, []);

    // Fail-closed: once the participating module set changes, the recorded count is rejected.
    write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "orders", name: "Orders", service_id: "orders" }, { module_id: "billing", name: "Billing", service_id: "billing" }] }));
    assert.match((gate(project, "implementation-report", "sensors", "implementation-report").failures as string[]).join("\n"), /modules_verified must be 2/);

    const context = await executionContextModule();
    const verifiedModuleIds = required(context.verifiedModuleIds, "verifiedModuleIds");
    const DEFAULT_MODULE_ID = required(context.DEFAULT_MODULE_ID, "DEFAULT_MODULE_ID");
    const noManifest = makeProject("d3-shared");
    assert.deepEqual(verifiedModuleIds(noManifest, "refactor"), [DEFAULT_MODULE_ID]);
    assert.throws(() => verifiedModuleIds(noManifest, "feature"), /module manifest is missing/);
    assert.deepEqual(verifiedModuleIds(project, "refactor"), ["billing", "orders"]);
  });

  // ---------------------------------------------------------------- D5
  await section("D5 traceability-matrix and test-quality share the source language list", async () => {
    const project = makeProject("d5-python");
    write(project, `${INCEPTION}/requirements.md`, "# 需求\n\n## REQ-001 Python\n\ntrack: [nfr]\n\n## REQ-002 Go\n\ntrack: [nfr]\n\n## REQ-003 Rust\n\ntrack: [nfr]\n\n## REQ-004 C#\n\ntrack: [nfr]\n");
    write(project, "app/exporter.py", "# REQ-001\nMAX_RETRIES = 3\n");
    write(project, "svc/retry.go", "// REQ-002\npackage svc\n");
    write(project, "svc/retry.rs", "// REQ-003\npub fn retry() {}\n");
    write(project, "svc/Retry.cs", "// REQ-004\nclass Retry {}\n");
    seed(project, "code-generation@module:project@unit:default", ["test-case-derivation@module:project", "tdd@module:project@unit:default"]);
    const args = ["--sensor", "traceability-matrix", "--module", "project", "--unit", "default"];
    assert.deepEqual(checker(project, args).broken_rows, []);

    // Fail-closed: Python source without the REQ reference still breaks at code_refs.
    write(project, "app/exporter.py", "MAX_RETRIES = 3\n");
    assert.deepEqual(checker(project, args).broken_rows, ["REQ-001: BROKEN@code_refs"]);

    const scan = await scanRootModule();
    const SOURCE_EXTENSIONS = required(scan.SOURCE_EXTENSIONS, "SOURCE_EXTENSIONS") as string[];
    const SOURCE_FILE_PATTERN = required(scan.SOURCE_FILE_PATTERN, "SOURCE_FILE_PATTERN") as RegExp;
    const TEST_FILE_PATTERN = required(scan.TEST_FILE_PATTERN, "TEST_FILE_PATTERN") as RegExp;
    for (const extension of ["java", "kt", "ts", "tsx", "js", "jsx", "vue", "py", "go", "rs", "cs"]) assert.ok(SOURCE_EXTENSIONS.includes(extension), extension);
    assert.ok(SOURCE_FILE_PATTERN.test("/repo/app/exporter.py"));
    assert.ok(SOURCE_FILE_PATTERN.test("C:\\repo\\web\\src\\Export.vue"));
    assert.ok(TEST_FILE_PATTERN.test("/repo/tests/test_exporter.py"));
    assert.ok(TEST_FILE_PATTERN.test("C:\\repo\\tests\\test_exporter.py"));
    // A "test" directory higher up the absolute path must not turn every file into a test file.
    assert.equal(TEST_FILE_PATTERN.test("C:\\tmp\\aidlc-tests\\app\\exporter.py"), false);
    assert.equal(TEST_FILE_PATTERN.test("/tmp/aidlc-tests/app/exporter.py"), false);
  });

  // ---------------------------------------------------------------- D6
  await section("D6 source roots resolve from manifest paths, .aidlc config, then src/", async () => {
    const SOURCE_ROOTS_CONFIG = ".aidlc/source-roots.json";
    const project = makeProject("d6-produces");
    const instance = "code-generation@module:project@unit:default";
    seed(project, instance, ["test-case-derivation@module:project", "tdd@module:project@unit:default"]);
    write(project, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["app"] }));
    const missing = gate(project, instance, "produces").missing as string[];
    assert.equal(missing.some((item) => /^(src|app)\/$/.test(item)), false, `configured source root satisfies code-generation: ${missing.join(", ")}`);

    // Fail-closed: a configured root that does not exist, or is empty, does not satisfy the produce.
    write(project, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["lib"] }));
    assert.ok((gate(project, instance, "produces").missing as string[]).includes("lib/"));
    mkdirSync(join(project, "lib"), { recursive: true });
    assert.ok((gate(project, instance, "produces").missing as string[]).includes("lib/"));
    write(project, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["../outside"] }));
    assert.match(String(gate(project, instance, "produces").error), /source root/);
    // The default stays src/ and is still enforced when nothing is configured.
    rmSync(join(project, SOURCE_ROOTS_CONFIG));
    assert.ok((gate(project, instance, "produces").missing as string[]).includes("src/"));

    // Symbolic links (POSIX symlink / Windows junction) are rejected inside the project root.
    const outside = join(scratch, "d6-outside");
    write(outside, "leak.py", "LEAK = True\n");
    symlinkSync(outside, join(project, "linked"), process.platform === "win32" ? "junction" : "dir");
    write(project, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["linked"] }));
    assert.match(String(gate(project, instance, "produces").error), /symbolic link|outside project root/);

    const roots = await sourceRootsModule().catch((error) => { throw new Error(`aidlc-source-roots is missing: ${error instanceof Error ? error.message : String(error)}`); });
    const normalizeSourceRoot = required(roots.normalizeSourceRoot, "normalizeSourceRoot");
    const resolveSourceRoots = required(roots.resolveSourceRoots, "resolveSourceRoots");
    assert.equal(roots.SOURCE_ROOTS_CONFIG, SOURCE_ROOTS_CONFIG);
    assert.equal(normalizeSourceRoot("app", "root"), "app");
    assert.equal(normalizeSourceRoot("web\\src\\", "root"), "web/src");
    assert.equal(normalizeSourceRoot("web/src/", "root"), "web/src");
    for (const invalid of ["", "/abs", "C:\\abs", "C:abs", "\\\\server\\share", "..\\x", "../x", "a/../b", "./app", ".aidlc", "aidlc/active", "docs/aidlc/x"]) {
      assert.throws(() => normalizeSourceRoot(invalid, "root"), /source root/, `must reject ${JSON.stringify(invalid)}`);
    }

    const defaults = makeProject("d6-default");
    assert.deepEqual(resolveSourceRoots(defaults), { roots: ["src"], origin: "default" });
    write(defaults, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["app", "web\\src"] }));
    assert.deepEqual(resolveSourceRoots(defaults), { roots: ["app", "web/src"], origin: "config" });
    write(defaults, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: "orders", name: "Orders", service_id: "orders", paths: ["services/orders"] }, { module_id: "billing", name: "Billing", service_id: "billing" }] }));
    assert.deepEqual(resolveSourceRoots(defaults, "orders"), { roots: ["services/orders"], origin: "manifest" });
    assert.deepEqual(resolveSourceRoots(defaults, "billing"), { roots: ["app", "web/src"], origin: "config" }, "a module without manifest paths falls back to the project config");
    assert.deepEqual(resolveSourceRoots(defaults), { roots: ["services/orders"], origin: "manifest" }, "project-axis uses the union of manifest paths");
    write(defaults, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: ["../outside"] }));
    assert.throws(() => resolveSourceRoots(defaults, "billing"), /source root/);
    write(defaults, SOURCE_ROOTS_CONFIG, JSON.stringify({ version: "1", source_roots: [] }));
    assert.throws(() => resolveSourceRoots(defaults, "billing"), /source_roots must be a non-empty array/);
  });

  // ---------------------------------------------------------------- D7
  await section("D7 command allowlist resolves --config, then .aidlc/commands/<stage>.json, then the default", async () => {
    const project = makeProject("d7-config");
    seed(project, "build-and-test");
    write(project, "mark.cjs", "require('node:fs').writeFileSync('marker.txt', process.argv[2]); console.log('1 passed');\n");
    const config = (source: string, stage = "build-and-test") => JSON.stringify({ version: "1", stage, commands: [
      { id: "build", role: "build", argv: ["node", "mark.cjs", source] },
      { id: "test", role: "test", argv: ["node", "mark.cjs", source] },
      { id: "check", role: "check", argv: ["node", "mark.cjs", source] },
    ] });
    const marker = () => readFileSync(join(project, "marker.txt"), "utf8");
    write(project, ".aidlc/evidence-commands.json", config("default"));
    ok(project, ["evidence", "run", "--stage", "build-and-test"]);
    assert.equal(marker(), "default");
    write(project, ".aidlc/commands/build-and-test.json", config("per-stage"));
    ok(project, ["evidence", "run", "--stage", "build-and-test"]);
    assert.equal(marker(), "per-stage");
    write(project, "explicit.json", config("explicit"));
    ok(project, ["evidence", "run", "--stage", "build-and-test", "--config", "explicit.json"]);
    assert.equal(marker(), "explicit");

    // Fail-closed: a per-stage file locked to another stage is rejected, not skipped.
    write(project, ".aidlc/commands/build-and-test.json", config("wrong", "tdd"));
    const wrong = run(project, ["evidence", "run", "--stage", "build-and-test"]);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.out, /command allowlist stage must be "build-and-test"/);

    const resolveCommandConfigPath = required((await evidenceModule()).resolveCommandConfigPath, "resolveCommandConfigPath");
    const fresh = makeProject("d7-resolve");
    const root = resolve(fresh);
    assert.equal(resolveCommandConfigPath(root, "build-and-test"), join(root, ".aidlc", "evidence-commands.json"));
    write(fresh, ".aidlc/commands/build-and-test.json", "{}");
    assert.equal(resolveCommandConfigPath(root, "build-and-test"), join(root, ".aidlc", "commands", "build-and-test.json"));
    assert.equal(resolveCommandConfigPath(root, "build-and-test", "custom.json"), join(root, "custom.json"));
    assert.throws(() => resolveCommandConfigPath(root, "../x"), /stage/);
  });

  // ---------------------------------------------------------------- D8
  await section("D8 controlled RED/GREEN evidence passes the gate; observed command is still enforced", () => {
    const project = makeProject("d8-phase");
    produceRequiredI13(project);
    write(project, "tests/observe.cjs", OBSERVER);
    // The default allowlist is used here so D8 does not depend on the D7 lookup.
    write(project, ".aidlc/evidence-commands.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red", role: "red", argv: ["node", "tests/observe.cjs"] }] }));
    const redInstance = "tdd@module:project@unit:default";
    seed(project, redInstance, ["test-case-derivation@module:project"]);
    ok(project, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
    assert.deepEqual(gate(project, redInstance, "sensors", "red-test-evidence").failures, []);
    const redPath = join(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json");
    const red = JSON.parse(readFileSync(redPath, "utf8"));
    assert.equal(red.checker.id, "builtin:red-test-evidence");
    assert.equal(red.observed_command.exit_code, 1);

    // Fail-closed: tampering with the observed command record is rejected.
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: undefined }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command is required/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, exit_code: 0 } }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command\.exit_code must be 1/);
    writeFileSync(redPath, JSON.stringify({ ...red, checker: { ...red.checker, id: "red" } }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /checker\.id must be builtin:red-test-evidence/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, phase: "GREEN" } }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command\.phase must be RED/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, argv_digest: "not-a-digest" } }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command\.argv_digest must be a SHA-256 digest/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, id: " " } }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command\.id is required/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: "red" }), "utf8");
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /observed_command is required/);

    // G1: observed_command.argv_digest is bound to the allowlisted red command, and
    // checker.argv_digest to the observation derived from it.
    assert.equal(red.observed_command.argv_digest, digestArgv(["node", "tests/observe.cjs"]));
    assert.equal(red.checker.argv_digest, digestArgv(["RED-observation", red.observed_command.argv_digest]));
    const g1 = rejections();
    const redFailures = () => (gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n");
    const otherDigest = digestArgv(["node", "tests/other.cjs"]);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, argv_digest: otherDigest } }), "utf8");
    g1.expect("observed argv_digest swapped for another valid digest", redFailures(), /observed_command\.argv_digest does not match the allowlisted red command/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, argv_digest: otherDigest }, checker: { ...red.checker, argv_digest: digestArgv(["RED-observation", otherDigest]) } }), "utf8");
    g1.expect("observed and checker digests forged consistently", redFailures(), /observed_command\.argv_digest does not match the allowlisted red command/);
    writeFileSync(redPath, JSON.stringify({ ...red, checker: { ...red.checker, argv_digest: "c".repeat(64) } }), "utf8");
    g1.expect("checker.argv_digest not derived from observed_command", redFailures(), /checker\.argv_digest does not match the RED observation/);
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: { ...red.observed_command, id: "other" } }), "utf8");
    g1.expect("observed_command.id differs from the allowlisted command", redFailures(), /observed_command\.id must be red/);
    writeFileSync(redPath, JSON.stringify(red), "utf8");
    const allowlist = join(project, ".aidlc/evidence-commands.json");
    const declared = readFileSync(allowlist, "utf8");
    rmSync(allowlist);
    g1.expect("allowlist deleted", redFailures(), /cannot bind observed_command to the red command allowlist/);
    write(project, ".aidlc/evidence-commands.json", JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "red", role: "red", argv: ["node", "tests/observe.cjs"] }] }));
    g1.expect("allowlist locked to another stage", redFailures(), /cannot bind observed_command[\s\S]*command allowlist stage must be "tdd"/);
    write(project, ".aidlc/evidence-commands.json", "{ not json");
    g1.expect("allowlist unparsable", redFailures(), /cannot bind observed_command[\s\S]*cannot read command allowlist/);
    write(project, ".aidlc/evidence-commands.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red", role: "red", argv: ["node", "tests/observe.cjs"] }, { id: "red-2", role: "red", argv: ["node", "tests/other.cjs"] }] }));
    g1.expect("allowlist declares two red commands", redFailures(), /exactly one red command/);
    write(project, ".aidlc/evidence-commands.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "check", role: "check", argv: ["node", "tests/observe.cjs"] }] }));
    g1.expect("allowlist declares no red command", redFailures(), /exactly one red command/);
    write(project, ".aidlc/evidence-commands.json", declared);
    assert.deepEqual(gate(project, redInstance, "sensors", "red-test-evidence").failures, [], "restored allowlist binds the controlled RED evidence again");
    g1.assertAll();
    writeFileSync(redPath, JSON.stringify(red), "utf8");

    write(project, "app/exporter.py", "MAX_RETRIES = 3\n\n\ndef export_orders(client):\n    return client.fetch_orders()\n");
    const greenInstance = "code-generation@module:project@unit:default";
    seed(project, greenInstance, [redInstance]);
    write(project, ".aidlc/evidence-commands.json", JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green", role: "green", argv: ["node", "tests/observe.cjs"] }] }));
    ok(project, ["evidence", "run", "--stage", "code-generation", "--sensor", "green-test-evidence"]);
    assert.deepEqual(gate(project, greenInstance, "sensors", "green-test-evidence").failures, []);
    const greenPath = join(project, ".aidlc/evidence/code-generation/project/default/green-test-evidence.json");
    const green = JSON.parse(readFileSync(greenPath, "utf8"));
    writeFileSync(greenPath, JSON.stringify({ ...green, observed_command: { ...green.observed_command, exit_code: 1 } }), "utf8");
    assert.match((gate(project, greenInstance, "sensors", "green-test-evidence").failures as string[]).join("\n"), /observed_command\.exit_code must be 0/);
    const g1Green = rejections();
    writeFileSync(greenPath, JSON.stringify({ ...green, observed_command: { ...green.observed_command, argv_digest: otherDigest }, checker: { ...green.checker, argv_digest: digestArgv(["GREEN-observation", otherDigest]) } }), "utf8");
    g1Green.expect("GREEN observed digest forged consistently", (gate(project, greenInstance, "sensors", "green-test-evidence").failures as string[]).join("\n"), /observed_command\.argv_digest does not match the allowlisted green command/);
    writeFileSync(greenPath, JSON.stringify({ ...green, checker: { ...green.checker, argv_digest: digestArgv(["RED-observation", green.observed_command.argv_digest]) } }), "utf8");
    g1Green.expect("GREEN checker digest derived as RED", (gate(project, greenInstance, "sensors", "green-test-evidence").failures as string[]).join("\n"), /checker\.argv_digest does not match the GREEN observation/);
    g1Green.assertAll();
  });

  // ---------------------------------------------------------------- D9
  await section("D9 GREEN completion accepts RED evidence observed on the pre-implementation worktree", () => {
    const project = makeProject("d9-red-drift");
    produceRequiredI13(project);
    write(project, "tests/observe.cjs", OBSERVER);
    write(project, "tests/test_exporter.py", "# REQ-001 UC-D-001\nfrom app.exporter import export_orders\n");
    // Per-stage allowlists: the GREEN-completion re-check binds RED to the tdd allowlist (G1),
    // so the tdd and code-generation commands must not overwrite each other.
    write(project, ".aidlc/commands/tdd.json", JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red", role: "red", argv: ["node", "tests/observe.cjs"] }] }));
    const redInstance = "tdd@module:project@unit:default";
    seed(project, redInstance, ["test-case-derivation@module:project"]);
    ok(project, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence"]);
    const redPath = join(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json");
    const red = JSON.parse(readFileSync(redPath, "utf8"));

    // GREEN changes the worktree by definition; RED keeps the digest of the failing tree.
    write(project, "app/exporter.py", "\"\"\"REQ-001 UC-D-001 export retry implementation for timeouts.\"\"\"\nMAX_RETRIES = 3\n\n\ndef export_orders(client):\n    return client.fetch_orders()\n");
    write(project, `${CONSTRUCTION}/plans/code-generation-plan.md`, "# 计划\n\nREQ-001 / UC-D-001：在 app/exporter.py 增加超时重试。\n");
    write(project, `${CONSTRUCTION}/implementation-summary.md`, "# 摘要\n\nREQ-001 / UC-D-001 已在 app/exporter.py 实现超时重试。\n");
    write(project, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app"] }));
    write(project, ".aidlc/commands/code-generation.json", JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green", role: "green", argv: ["node", "tests/observe.cjs"] }] }));
    seed(project, "code-generation@module:project@unit:default", [redInstance]);
    const report = () => run(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed"]);
    const completed = report();
    assert.doesNotMatch(completed.out, /RED gate evidence is invalid/);
    assert.equal(completed.status, 0, completed.out);
    // The drift tolerance is scoped to the GREEN-completion re-check: the ordinary RED
    // gate (as used by next/upstream re-validation) still binds RED to the current tree.
    assert.match((gate(project, redInstance, "sensors", "red-test-evidence").failures as string[]).join("\n"), /worktree_digest no longer matches the current worktree/);

    // Fail-closed: provenance drift is the only tolerance; forged or malformed RED is still rejected.
    const state = loadWorkflowState(project) as WorkflowState;
    state.completed_stage_instances = state.completed_stage_instances.filter((id) => !id.startsWith("code-generation@"));
    state.completed_stages = state.completed_stages.filter((slug) => slug !== "code-generation");
    saveWorkflowState(project, state);
    seed(project, "code-generation@module:project@unit:default");
    writeFileSync(redPath, JSON.stringify({ ...red, producer: { ...red.producer, mode: "manual" } }), "utf8");
    const forged = report();
    assert.notEqual(forged.status, 0);
    assert.match(forged.out, /RED gate evidence is invalid[\s\S]*producer\.mode must be \\?"controlled\\?"/);
    writeFileSync(redPath, JSON.stringify({ ...red, source_revision: { ...red.source_revision, worktree_digest: "not-a-digest" } }), "utf8");
    const malformed = report();
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.out, /RED gate evidence is invalid[\s\S]*worktree_digest must be a SHA-256 digest/);
    // The tolerance never relaxes the RED content contract.
    writeFileSync(redPath, JSON.stringify({ ...red, observed_command: undefined }), "utf8");
    const unobserved = report();
    assert.notEqual(unobserved.status, 0);
    assert.match(unobserved.out, /RED gate evidence is invalid[\s\S]*observed_command is required/);
    writeFileSync(redPath, JSON.stringify({ ...red, checker: { ...red.checker, id: "red" } }), "utf8");
    const wrongChecker = report();
    assert.notEqual(wrongChecker.status, 0);
    assert.match(wrongChecker.out, /RED gate evidence is invalid[\s\S]*checker\.id must be builtin:red-test-evidence/);
    writeFileSync(redPath, JSON.stringify({ ...red, status: "passed", tests_failed: 0 }), "utf8");
    const notFailing = report();
    assert.notEqual(notFailing.status, 0);
    assert.match(notFailing.out, /RED gate evidence is invalid[\s\S]*RED status must be \\?"failed\\?"/);

    // G3: drift tolerance still requires the recorded commit to be HEAD or an ancestor of HEAD.
    const head = gitOut(project, ["rev-parse", "HEAD"]);
    assert.equal(red.source_revision.commit, head, "controlled RED records the pre-implementation HEAD");
    const sideCommit = gitOut(project, ["commit-tree", `${head}^{tree}`, "-p", head, "-m", "side branch commit"]);
    gitOut(project, ["update-ref", "refs/heads/side", sideCommit]);
    const g3 = rejections();
    const withCommit = (commit: string, digest = red.source_revision.worktree_digest) => {
      // An accepted case would complete code-generation; reopen it so each case is evaluated alone.
      const reopened = loadWorkflowState(project) as WorkflowState;
      reopened.completed_stage_instances = reopened.completed_stage_instances.filter((id) => !id.startsWith("code-generation@"));
      reopened.completed_stages = reopened.completed_stages.filter((slug) => slug !== "code-generation");
      saveWorkflowState(project, reopened);
      seed(project, "code-generation@module:project@unit:default");
      writeFileSync(redPath, JSON.stringify({ ...red, source_revision: { ...red.source_revision, commit, worktree_digest: digest } }), "utf8");
      const result = report();
      return result.status === 0 ? "" : result.out;
    };
    g3.expect("nonexistent 40-hex commit", withCommit("0123456789abcdef0123456789abcdef01234567", "e".repeat(64)), /RED gate evidence is invalid[\s\S]*source_revision\.commit 0123456789abcdef0123456789abcdef01234567 is not the current HEAD or one of its ancestors/);
    g3.expect("commit on a side branch (not an ancestor)", withCommit(sideCommit), new RegExp(`RED gate evidence is invalid[\\s\\S]*source_revision\\.commit ${sideCommit} is not the current HEAD or one of its ancestors`));
    g3.expect("malformed commit id", withCommit("HEAD"), /RED gate evidence is invalid[\s\S]*source_revision\.commit must be a 40- or 64-character hex commit id/);
    g3.expect("option-like commit id", withCommit("--all"), /RED gate evidence is invalid[\s\S]*source_revision\.commit must be a 40- or 64-character hex commit id/);
    g3.expect("unavailable commit in a git project", withCommit("unavailable"), /RED gate evidence is invalid[\s\S]*source_revision\.commit unavailable does not match current HEAD/);
    g3.assertAll();
    // Positive: compliant RED (recorded at the pre-implementation HEAD) is still accepted.
    writeFileSync(redPath, JSON.stringify(red), "utf8");
    assert.equal(withCommit(red.source_revision.commit), "", "compliant RED recorded at the pre-implementation HEAD is accepted");
  });

  // ---------------------------------------------------------------- M1
  await section("M1 RED/GREEN producer rejects --config that is not the default-lookup allowlist", () => {
    const m1 = rejections();
    const rejected = (label: string, result: Run, evidence: string, pattern: RegExp) => {
      // Rejection must happen before any command runs or evidence is written.
      m1.expect(label, result.status === 0 ? "" : result.out, pattern);
      m1.expect(`${label}: no evidence file`, existsSync(evidence) ? `evidence written: ${evidence}` : "not written", /^not written$/);
    };
    const evidenceFiles = (dir: string): string[] => existsSync(dir)
      ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name)
      : [];
    const redOnly = (stage: string, role: "red" | "green") => JSON.stringify({ version: "1", stage, commands: [{ id: role, role, argv: ["node", "tests/observe.cjs"] }] });

    // ---- RED (tdd), required I13
    const project = makeProject("m1-config");
    produceRequiredI13(project);
    write(project, "tests/observe.cjs", OBSERVER);
    write(project, ".aidlc/commands/tdd.json", redOnly("tdd", "red"));
    write(project, "other.json", redOnly("tdd", "red"));
    const redInstance = "tdd@module:project@unit:default";
    seed(project, redInstance, ["test-case-derivation@module:project"]);
    const redPath = join(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json");
    const tddRun = (args: string[]) => { rmSync(redPath, { force: true }); return run(project, ["evidence", "run", "--stage", "tdd", ...args]); };
    const lockedTo = /RED\/GREEN evidence binds only the default allowlist lookup[\s\S]*\.aidlc\/commands\/tdd\.json/;
    rejected("tdd --sensor red-test-evidence --config other.json", tddRun(["--sensor", "red-test-evidence", "--config", "other.json"]), redPath, lockedTo);
    rejected("tdd --all-sensors --config other.json", tddRun(["--all-sensors", "--config", "other.json"]), redPath, lockedTo);

    // Same file as the default lookup, in several spellings: allowed.
    const sameFile = [".aidlc/commands/tdd.json", "./.aidlc/commands/tdd.json", ".aidlc/commands/../commands/tdd.json"];
    if (process.platform === "win32") sameFile.push(".aidlc\\commands\\tdd.json", ".\\.AIDLC\\Commands\\TDD.json");
    for (const spelling of sameFile) {
      const allowed = tddRun(["--sensor", "red-test-evidence", "--config", spelling]);
      assert.equal(allowed.status, 0, `--config ${spelling} names the default allowlist and must be accepted\n${allowed.out}`);
      assert.deepEqual(gate(project, redInstance, "sensors", "red-test-evidence").failures, [], `evidence produced with --config ${spelling} passes the gate`);
    }

    // Default lookup falls back to .aidlc/evidence-commands.json.
    rmSync(join(project, ".aidlc/commands/tdd.json"));
    write(project, ".aidlc/evidence-commands.json", redOnly("tdd", "red"));
    const fallback = tddRun(["--sensor", "red-test-evidence", "--config", ".aidlc/evidence-commands.json"]);
    assert.equal(fallback.status, 0, fallback.out);
    assert.deepEqual(gate(project, redInstance, "sensors", "red-test-evidence").failures, []);
    rejected("--config .aidlc/commands/tdd.json while the default lookup is evidence-commands.json", tddRun(["--sensor", "red-test-evidence", "--config", ".aidlc/commands/tdd.json"]), redPath, /RED\/GREEN evidence binds only the default allowlist lookup/);

    // ---- GREEN (code-generation)
    write(project, ".aidlc/commands/tdd.json", redOnly("tdd", "red"));
    write(project, "app/exporter.py", "MAX_RETRIES = 3\n\n\ndef export_orders(client):\n    return client.fetch_orders()\n");
    write(project, ".aidlc/commands/code-generation.json", redOnly("code-generation", "green"));
    write(project, "other-cg.json", redOnly("code-generation", "green"));
    seed(project, "code-generation@module:project@unit:default", [redInstance]);
    const cgDir = join(project, ".aidlc/evidence/code-generation");
    const greenPath = join(cgDir, "project/default/green-test-evidence.json");
    const cgRun = (args: string[]) => { rmSync(cgDir, { recursive: true, force: true }); return run(project, ["evidence", "run", "--stage", "code-generation", ...args]); };
    const cgLocked = /RED\/GREEN evidence binds only the default allowlist lookup[\s\S]*\.aidlc\/commands\/code-generation\.json/;
    rejected("code-generation --sensor green-test-evidence --config other-cg.json", cgRun(["--sensor", "green-test-evidence", "--config", "other-cg.json"]), greenPath, cgLocked);
    const cgAll = cgRun(["--all-sensors", "--config", "other-cg.json"]);
    rejected("code-generation --all-sensors --config other-cg.json", cgAll, greenPath, cgLocked);
    m1.expect("code-generation --all-sensors writes no evidence for any sensor", `written: [${evidenceFiles(cgDir).join(", ")}]`, /^written: \[\]$/);
    const greenAllowed = cgRun(["--sensor", "green-test-evidence", "--config", ".aidlc/commands/code-generation.json"]);
    assert.equal(greenAllowed.status, 0, greenAllowed.out);
    assert.deepEqual(gate(project, "code-generation@module:project@unit:default", "sensors", "green-test-evidence").failures, []);

    // ---- not_applicable RED: the check command must not run with another allowlist either.
    const na = makeProject("m1-not-applicable");
    produceNotApplicableI13(na);
    write(na, "check.cjs", "require('node:fs').writeFileSync('ran.txt', 'yes'); console.log('ok');\n");
    const checkOnly = JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "check", role: "check", argv: ["node", "check.cjs"] }] });
    write(na, ".aidlc/commands/tdd.json", checkOnly);
    write(na, "other.json", checkOnly);
    seed(na, redInstance, ["test-case-derivation@module:project"]);
    const naRed = join(na, ".aidlc/evidence/tdd/project/default/red-test-evidence.json");
    rejected("not_applicable RED --config other.json", run(na, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence", "--config", "other.json"]), naRed, lockedTo);
    m1.expect("not_applicable RED runs no check command before rejecting", existsSync(join(na, "ran.txt")) ? "check command ran" : "not run", /^not run$/);
    const naAllowed = run(na, ["evidence", "run", "--stage", "tdd", "--sensor", "red-test-evidence", "--config", ".aidlc/commands/tdd.json"]);
    assert.equal(naAllowed.status, 0, naAllowed.out);
    m1.assertAll();
    // build-and-test --config precedence is covered unchanged by the D7 section.
  });

  assert.equal(existsSync(scratch), true);
  if (failed.length > 0) {
    console.log(`4.5.4 engine defect regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.5.4 engine defect regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
