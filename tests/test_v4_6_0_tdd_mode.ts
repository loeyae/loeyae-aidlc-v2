/**
 * 4.6.0-2 (MARS-48) regression suite: I13 `ready_ucd` counted once per UC-D from its
 * own case file (S2.0), the UC-D `tdd_mode` contract (S2.1), and the I13
 * `ucd_modes` / `characterization[]` / `baseline_commit` output with its git checks
 * (S2.2). Every section has fail-closed negative cases; every case goes through the
 * public CLI (`check`, `evidence run`, `orchestrate report`, `orchestrate baseline`).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-460-s2-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const I13_EVIDENCE = ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AIDLC_ACTIVE_MODULE;
  delete env.AIDLC_ACTIVE_UNIT;
  delete env.AIDLC_ACTIVE_STAGE;
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

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function git(project: string, args: string[], date = OLD_DATE, input?: string): string {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    input,
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

function commitAll(project: string, message: string, date = OLD_DATE, paths = ["app", "README.md"]): string {
  git(project, ["add", "-A", "--", ...paths], date);
  git(project, ["commit", "-qm", message], date);
  return git(project, ["rev-parse", "HEAD"]);
}

/** Collects fail-closed expectations so one run reports every case that was accepted. */
function rejections(): { expect: (label: string, result: Run, pattern: RegExp) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    expect(label, result, pattern) {
      if (result.status === 0 || !pattern.test(result.out)) gaps.push(`${label}: expected rejection ${pattern}, got exit ${result.status}: ${result.out.trim().slice(-600) || "(no output)"}`);
      else if (process.env.AIDLC_TEST_VERBOSE) console.log(`    rejected ${label}: ${result.out.trim().slice(-300)}`);
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

const EXPORTER = "def export_orders(client):\n    return paginate(client.fetch_orders())\n\n\ndef paginate(rows, size=50):\n    return [rows[index:index + size] for index in range(0, len(rows), size)]\n";
const REQUIREMENTS = "# 需求\n\n## REQ-001 导出分页与超时重试\n\ntrack: [nfr]\n\n业务规则：订单导出接口按 50 条分页返回；下游超时时最多重试 3 次，3 次内成功则返回订单列表。\n";
const CHARACTERIZATION = {
  tdd_mode: "characterization",
  code_refs: ["app/exporter.py::export_orders"],
  reason: "补齐导出现有分页行为的回归保护，重构前锁定",
  approval_ref: "REVIEW-2026-10-01-01",
};

type Fields = Record<string, string | string[] | undefined>;

/** One UC-D case file: YAML frontmatter (fields in order) plus a Given/When/Then body. */
function ucd(id: string, fields: Fields = {}): string {
  const all: Fields = { id, status: "ready", source_ref: "REQ-001", ...fields };
  const lines = Object.entries(all).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    return [`${key}: ${value}`];
  });
  return `---\n${lines.join("\n")}\n---\n# ${id} 订单导出\n\nGiven 下游返回 120 条订单，When 调用 export_orders，Then 返回 3 页。\n`;
}

function caseRoot(moduleId: string): string {
  return `docs/aidlc/modules/${moduleId}/inception/application-design/test-cases`;
}

/** Writes requirements, `_index.md` and the UC-D case files of a module. */
function writeCases(project: string, files: Record<string, string>, index?: string, moduleId = "project"): void {
  write(project, `docs/aidlc/modules/${moduleId}/inception/requirements.md`, REQUIREMENTS);
  const ids = Object.keys(files).map((name) => /UC-D-\d+/.exec(name)?.[0]).filter(Boolean);
  write(project, `${caseRoot(moduleId)}/_index.md`, index ?? `# UC-D 索引\n\n${ids.map((id) => `- ${id} 订单导出（source_ref: REQ-001）`).join("\n")}\n`);
  for (const [name, content] of Object.entries(files)) write(project, `${caseRoot(moduleId)}/${name}`, content);
}

let counter = 0;

/**
 * Single-layout git project with legacy Python sources under `app/` (configured as
 * the source root), committed before `next --scope` records the baseline (HEAD).
 */
function legacyProject(scope = "refactor", options: { symlink?: boolean; createWorkflow?: boolean } = {}): { project: string; commits: string[]; baseline: string } {
  const project = join(scratch, `p${++counter}-${scope}`);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  write(project, "README.md", "# Orders\n");
  write(project, "app/__init__.py", "\"\"\"Orders.\"\"\"\n");
  write(project, "app/exporter.py", EXPORTER);
  write(project, "app/sub/__init__.py", "\"\"\"Sub package.\"\"\"\n");
  const commits = [commitAll(project, "c1 legacy exporter", "2024-01-01T00:00:00Z")];
  if (options.symlink) {
    // A symbolic link recorded in the baseline tree (mode 120000), without needing
    // symlink privileges on the file system.
    const blob = git(project, ["hash-object", "-w", "--stdin"], OLD_DATE, "exporter.py");
    git(project, ["update-index", "--add", "--cacheinfo", `120000,${blob},app/link.py`]);
    git(project, ["commit", "-qm", "symlink"], "2024-01-01T12:00:00Z");
    commits.push(git(project, ["rev-parse", "HEAD"]));
  }
  write(project, "README.md", "# Orders service\n");
  commits.push(commitAll(project, "c2 readme", "2024-01-02T00:00:00Z", ["README.md"]));
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
  if (options.createWorkflow !== false) ok(project, ["orchestrate", "next", "--scope", scope, "--work", "4.6.0 S2 tdd_mode fixture"]);
  const baseline = options.createWorkflow === false ? "" : String(loadWorkflowState(project)!.baseline_commit);
  return { project, commits, baseline };
}

function check(project: string, moduleId = "project"): Run {
  return run(project, ["check", "--sensor", "test-case-derivation", "--module", moduleId]);
}

function checked(project: string, moduleId = "project"): Record<string, unknown> {
  const result = check(project, moduleId);
  assert.equal(result.status, 0, result.out);
  assert.equal(result.json.status, "required", result.out);
  return result.json;
}

/** Advance a single-layout workflow to the I13 instance through the public CLI. */
function toI13(project: string): void {
  const expect = (instance: string) => {
    const directive = ok(project, ["orchestrate", "next"]).json;
    assert.equal(directive.stage_instance, instance, JSON.stringify(directive, null, 2));
  };
  expect("workspace-detection");
  ok(project, ["orchestrate", "report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  expect("state-template");
  ok(project, ["orchestrate", "report", "--stage", "state-template", "--result", "completed", "--instruction-ack", "state-template"]);
  expect("test-case-derivation@module:project");
}

function evidence(project: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(project, I13_EVIDENCE), "utf8")) as Record<string, unknown>;
}

function report(project: string): Run {
  return run(project, ["orchestrate", "report", "--stage", "test-case-derivation", "--result", "completed"]);
}

try {
  // ---------------------------------------------------------------- S2.0
  await section("S2.0 ready_ucd counts each UC-D once, from its own case file", () => {
    const { project } = legacyProject();
    const index = "# UC-D 索引\n\n- UC-D-001 导出分页（status: ready，source_ref: REQ-001）\n- UC-D-002 超时重试（status: ready，source_ref: REQ-001）\n";
    writeCases(project, { "UC-D-001-pages.md": ucd("UC-D-001"), "UC-D-002-retry.md": ucd("UC-D-002") }, index);
    const result = checked(project);
    assert.equal(result.ucd_total, 2, JSON.stringify(result));
    assert.equal(result.ready_ucd, 2, "status: ready in _index.md must not be counted");
    assert.deepEqual(result.ucd_ids, ["UC-D-001", "UC-D-002"]);
    // The gate accepts the same project end to end.
    toI13(project);
    const completed = report(project);
    assert.equal(completed.status, 0, completed.out);
    assert.notEqual(completed.json.kind, "error", completed.out);
    assert.equal(evidence(project).ready_ucd, 2);
  });

  await section("S2.0 a UC-D whose own case file is not ready is still rejected", () => {
    const checks = rejections();
    const index = "# UC-D 索引\n\n- UC-D-001 status: ready\n- UC-D-002 status: ready\n";
    const notReady = legacyProject().project;
    writeCases(notReady, { "UC-D-001-pages.md": ucd("UC-D-001"), "UC-D-002-retry.md": ucd("UC-D-002", { status: "deprecated" }) }, index);
    checks.expect("case file without status: ready (index says ready)", check(notReady), /every UC-D must declare status: ready[\s\S]*UC-D-002/);
    const missing = legacyProject().project;
    writeCases(missing, { "UC-D-001-pages.md": ucd("UC-D-001"), "UC-D-002-retry.md": ucd("UC-D-002", { status: undefined }) }, index);
    checks.expect("case file without any status", check(missing), /every UC-D must declare status: ready[\s\S]*UC-D-002/);
    const onlyIndex = legacyProject().project;
    writeCases(onlyIndex, { "UC-D-001-pages.md": ucd("UC-D-001") }, index);
    checks.expect("UC-D declared only in _index.md", check(onlyIndex), /UC-D-002/);
    const duplicate = legacyProject().project;
    writeCases(duplicate, { "UC-D-001-pages.md": ucd("UC-D-001"), "UC-D-001-copy.md": ucd("UC-D-001") });
    checks.expect("UC-D declared in two case files", check(duplicate), /UC-D-001 is declared in more than one case file/);
    checks.assertAll();
  });

  // ---------------------------------------------------------------- S2.1 / S2.2 compatibility
  await section("S2.1 compatibility: no tdd_mode keeps the I13 verdict, every ucd_modes entry is new", () => {
    const { project } = legacyProject();
    writeCases(project, { "UC-D-001-pages.md": ucd("UC-D-001"), "UC-D-002-retry.md": ucd("UC-D-002") });
    const result = checked(project);
    assert.deepEqual(result.ucd_modes, { "UC-D-001": "new", "UC-D-002": "new" });
    assert.equal("characterization" in result, false, "no characterization key without characterization UC-Ds");
    assert.equal("baseline_commit" in result, false, "no baseline_commit without characterization (S1.3 U3)");
    const explicit = legacyProject().project;
    writeCases(explicit, { "UC-D-001-pages.md": ucd("UC-D-001", { tdd_mode: "new" }) });
    assert.deepEqual(checked(explicit).ucd_modes, { "UC-D-001": "new" });
  });

  // ---------------------------------------------------------------- S2.2 positive
  await section("S2.2 characterization records code_refs with baseline blobs and the baseline commit", () => {
    const { project, baseline } = legacyProject();
    writeCases(project, {
      "UC-D-001-retry.md": ucd("UC-D-001"),
      "UC-D-003-pages.md": ucd("UC-D-003", { ...CHARACTERIZATION, code_refs: ["app/exporter.py::export_orders", "app\\exporter.py::paginate", "app/__init__.py"] }),
    });
    const result = checked(project);
    assert.deepEqual(result.ucd_modes, { "UC-D-001": "new", "UC-D-003": "characterization" });
    assert.equal(result.baseline_commit, baseline);
    const blob = git(project, ["rev-parse", `${baseline}:app/exporter.py`]);
    const init = git(project, ["rev-parse", `${baseline}:app/__init__.py`]);
    assert.deepEqual(result.characterization, [{
      ucd: "UC-D-003",
      code_refs: [
        { path: "app/exporter.py", symbol: "export_orders", baseline_blob: blob },
        { path: "app/exporter.py", symbol: "paginate", baseline_blob: blob },
        { path: "app/__init__.py", baseline_blob: init },
      ],
      reason: CHARACTERIZATION.reason,
      approval_ref: CHARACTERIZATION.approval_ref,
    }]);
    // refactor may consist of characterization UC-Ds only; bugfix with one new is accepted.
    const allCharacterization = legacyProject().project;
    writeCases(allCharacterization, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    assert.deepEqual(checked(allCharacterization).ucd_modes, { "UC-D-003": "characterization" });
    const bugfix = legacyProject("bugfix").project;
    writeCases(bugfix, { "UC-D-001-bug.md": ucd("UC-D-001"), "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    assert.deepEqual(checked(bugfix).ucd_modes, { "UC-D-001": "new", "UC-D-003": "characterization" });
  });

  // ---------------------------------------------------------------- S2.1 / S2.2 negative
  await section("S2.1/S2.2 the tdd_mode contract and the code_refs checks fail closed", () => {
    const checks = rejections();
    const single = (fields: Fields, label: string, pattern: RegExp, scope = "refactor") => {
      const { project } = legacyProject(scope);
      writeCases(project, { "UC-D-003-pages.md": ucd("UC-D-003", fields) });
      checks.expect(label, check(project), pattern);
    };
    // Contract (S2.1).
    single({ tdd_mode: "legacy" }, "unknown tdd_mode", /tdd_mode must be new or characterization/);
    single({ ...CHARACTERIZATION, reason: undefined }, "characterization without reason", /UC-D-003.*reason/);
    single({ ...CHARACTERIZATION, approval_ref: undefined }, "characterization without approval_ref", /UC-D-003.*approval_ref/);
    single({ ...CHARACTERIZATION, code_refs: undefined }, "characterization without code_refs", /UC-D-003.*code_refs/);
    single({ ...CHARACTERIZATION, code_refs: [] }, "characterization with empty code_refs", /UC-D-003.*code_refs/);
    single({ code_refs: ["app/exporter.py::export_orders"] }, "new with code_refs", /UC-D-003.*new.*code_refs/);
    single({ tdd_mode: "new", reason: "r" }, "new with reason", /UC-D-003.*new.*reason/);
    single({ approval_ref: "REVIEW-1" }, "new (default) with approval_ref", /UC-D-003.*new.*approval_ref/);
    // code_refs paths.
    const ref = (value: string, label: string, pattern: RegExp) => single({ ...CHARACTERIZATION, code_refs: [value] }, label, pattern);
    ref("app/new_feature.py::export_orders", "file absent from the baseline (new code posing as legacy)", /does not exist in the workflow baseline/);
    ref("app/exporter.py::export_invoices", "symbol absent from the baseline file", /symbol export_invoices.*not found/);
    ref("app/exporter.py::export_order", "symbol prefix only (no whole-token match)", /symbol export_order .*not found|symbol export_order\b.*not found/);
    ref("docs/notes/exporter.py", "outside the source roots", /outside the source roots/);
    ref("README.md", "project file outside the source roots", /outside the source roots/);
    ref("app/../README.md", "contains ..", /normalized project-relative|"\."|\.\./);
    ref("app\\..\\README.md", "contains .. (Windows separators)", /normalized project-relative|\.\./);
    ref("/etc/exporter.py", "POSIX absolute path", /project-relative/);
    ref("C:\\work\\app\\exporter.py", "Windows absolute path", /project-relative/);
    ref("\\\\server\\share\\app\\exporter.py", "UNC path", /project-relative/);
    ref("app/sub", "directory instead of a file", /not a file/);
    ref("app/exporter.py::", "empty symbol", /symbol/);
    ref(".aidlc/source-roots.json", "control plane", /control plane|outside the source roots/);
    const symlink = legacyProject("refactor", { symlink: true }).project;
    writeCases(symlink, { "UC-D-003-pages.md": ucd("UC-D-003", { ...CHARACTERIZATION, code_refs: ["app/link.py"] }) });
    checks.expect("symbolic link in the baseline tree", check(symlink), /symbolic link/);
    // bugfix needs at least one new UC-D reproducing the bug.
    single(CHARACTERIZATION, "bugfix with only characterization UC-Ds", /bugfix.*at least one.*new/, "bugfix");
    checks.assertAll();
  });

  await section("S2.2 characterization requires a registered, reachable git baseline", () => {
    const checks = rejections();
    // Non-git project: the workflow records `unavailable` and there is no repository.
    const nonGit = join(scratch, "non-git");
    mkdirSync(nonGit, { recursive: true });
    write(nonGit, "app/exporter.py", EXPORTER);
    write(nonGit, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
    ok(nonGit, ["orchestrate", "next", "--scope", "refactor", "--work", "non-git fixture"]);
    writeCases(nonGit, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    checks.expect("non-git project", check(nonGit), /git repository/);
    // Workflow created outside git, repository initialized afterwards: baseline unavailable.
    const late = join(scratch, "late-git");
    mkdirSync(late, { recursive: true });
    write(late, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: ["app"] })}\n`);
    ok(late, ["orchestrate", "next", "--scope", "refactor", "--work", "late git fixture"]);
    git(late, ["init", "-q"]);
    write(late, "README.md", "# late\n");
    write(late, "app/exporter.py", EXPORTER);
    commitAll(late, "c1");
    writeCases(late, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    checks.expect("baseline unavailable", check(late), /unavailable/);
    // Pre-4.6 workflow in git without a registered baseline.
    const preBaseline = (project: string, id: string) => {
      const state = createInitialState("refactor", "4.5.4", id, [], "pre-4.6 workflow");
      state.completed_stages = ["workspace-detection"];
      state.completed_stage_instances = ["workspace-detection"];
      saveWorkflowState(project, state);
    };
    const legacy = legacyProject("refactor", { createWorkflow: false }).project;
    preBaseline(legacy, "workflow-legacy");
    writeCases(legacy, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    checks.expect("existing workflow without a registered baseline", check(legacy), /not registered/);
    // The same pre-4.6 workflow without characterization keeps its verdict.
    const legacyNew = legacyProject("refactor", { createWorkflow: false }).project;
    preBaseline(legacyNew, "workflow-legacy-new");
    writeCases(legacyNew, { "UC-D-001-pages.md": ucd("UC-D-001") });
    assert.deepEqual(checked(legacyNew).ucd_modes, { "UC-D-001": "new" });
    // Registered, then a rebase rewrites history and orphans the baseline commit.
    const rebased = legacyProject();
    git(rebased.project, ["reset", "-q", "--hard", rebased.commits[0]]);
    write(rebased.project, "README.md", "# Orders service (rewritten)\n");
    commitAll(rebased.project, "c2 rewritten", "2024-01-02T00:00:00Z");
    writeCases(rebased.project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    checks.expect("baseline orphaned by a rebase", check(rebased.project), /not the current HEAD or one of its ancestors/);
    checks.assertAll();
  });

  await section("S2.2 the I13 gate rejects evidence that disagrees with the workflow baseline", () => {
    const checks = rejections();
    const INSTANCE = "test-case-derivation@module:project";
    // Evidence whose baseline_commit differs from the state.
    const edited = legacyProject();
    toI13(edited.project);
    writeCases(edited.project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    ok(edited.project, ["evidence", "run", "--stage", "test-case-derivation", "--instance", INSTANCE, "--all-sensors"]);
    const value = evidence(edited.project);
    assert.equal(value.baseline_commit, edited.baseline);
    writeFileSync(join(edited.project, I13_EVIDENCE), JSON.stringify({ ...value, baseline_commit: edited.commits[0] }, null, 2), "utf8");
    checks.expect("evidence baseline_commit != state baseline", report(edited.project), /baseline_commit .* does not match the workflow baseline/);
    // The state baseline changes after the evidence was produced.
    const moved = legacyProject();
    toI13(moved.project);
    writeCases(moved.project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    ok(moved.project, ["evidence", "run", "--stage", "test-case-derivation", "--instance", INSTANCE, "--all-sensors"]);
    const state = loadWorkflowState(moved.project) as WorkflowState;
    saveWorkflowState(moved.project, { ...state, baseline_commit: moved.commits[0], baseline_source: "replaced" }, undefined, { baselineWrite: true });
    checks.expect("state baseline replaced after I13", report(moved.project), /baseline_commit .* does not match the workflow baseline/);
    // Evidence that drops the characterization of a characterization UC-D.
    const dropped = legacyProject();
    toI13(dropped.project);
    writeCases(dropped.project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    ok(dropped.project, ["evidence", "run", "--stage", "test-case-derivation", "--instance", INSTANCE, "--all-sensors"]);
    const full = evidence(dropped.project);
    delete full.characterization;
    writeFileSync(join(dropped.project, I13_EVIDENCE), JSON.stringify(full, null, 2), "utf8");
    checks.expect("characterization missing for a characterization UC-D", report(dropped.project), /characterization/);
    checks.assertAll();
  });

  // ---------------------------------------------------------------- split layout
  await section("S2.2 split layout: a module sub-workflow uses the parent baseline; an injected sub-workflow baseline is rejected", () => {
    const moduleId = "m01-trade";
    const { project, baseline } = legacyProject("feature", { createWorkflow: false });
    write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: moduleId, name: "Trade", service_id: "trade-service", paths: ["app"] }] }));
    ok(project, ["orchestrate", "next", "--scope", "feature", "--work", "split tdd_mode fixture"]);
    const global = loadWorkflowState(project)!;
    global.completed_stages = [...GLOBAL_STAGES];
    global.completed_stage_instances = [...GLOBAL_STAGES];
    global.skipped_stage_instances = [`reverse-engineering@module:${moduleId}`];
    saveWorkflowState(project, global);
    ok(project, ["orchestrate", "split", "--from", global.workflow_id]);
    const parentBaseline = String(loadWorkflowState(project)!.baseline_commit);
    assert.equal(baseline, "", "fixture created the workflow after the commits");
    writeCases(project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) }, undefined, moduleId);
    const result = checked(project, moduleId);
    assert.deepEqual(result.ucd_modes, { "UC-D-003": "characterization" });
    assert.equal(result.baseline_commit, parentBaseline, "the module uses the global workflow baseline");
    // Inject a baseline into the module sub-workflow state file.
    const statePath = join(project, "aidlc", "active", "modules", moduleId, "aidlc-state.md");
    const original = readFileSync(statePath, "utf8");
    const injected = original.replace(/^(- Workflow Kind: module\r?\n)/m, `$1- Baseline Commit: ${parentBaseline}\n- Baseline Source: created\n`);
    assert.notEqual(injected, original, "fixture injected the baseline fields");
    writeFileSync(statePath, injected, "utf8");
    const rejected = check(project, moduleId);
    assert.notEqual(rejected.status, 0, rejected.out);
    assert.match(rejected.out, /must not carry Baseline Commit/);
  });

  // ---------------------------------------------------------------- end to end
  await section("S2.2 end to end: real I13 characterization evidence blocks baseline --replace (S1.3 U2)", () => {
    const { project, commits, baseline } = legacyProject();
    toI13(project);
    writeCases(project, { "UC-D-003-pages.md": ucd("UC-D-003", CHARACTERIZATION) });
    const completed = report(project);
    assert.equal(completed.status, 0, completed.out);
    assert.notEqual(completed.json.kind, "error", completed.out);
    const i13 = evidence(project);
    assert.equal(i13.producer && (i13.producer as Record<string, unknown>).mode, "controlled");
    assert.equal(i13.baseline_commit, baseline);
    const replace = run(project, ["orchestrate", "baseline", "--set", commits[0], "--replace", "--expect", baseline, "--user-input", "Approve", "--reason", "更正基线"]);
    assert.notEqual(replace.status, 0, replace.out);
    assert.equal(replace.json.kind, "error", replace.out);
    assert.match(replace.out, /U2 [^"]*test-case-derivation@module:project/);
    assert.equal(loadWorkflowState(project)!.baseline_commit, baseline, "the baseline is unchanged");
  });

  if (failed.length > 0) {
    console.log(`4.6.0 S2 tdd_mode regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.6.0 S2 tdd_mode regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
