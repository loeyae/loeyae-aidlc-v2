/**
 * 4.6.0-1 (MARS-47) regression suite: legacy-code detection by source roots (S1.0),
 * the workflow baseline state fields (S1.1), `orchestrate baseline` view / --set
 * (S1.2) and --replace --expect (S1.3), the shared baselineCommitErrors() (S1.4),
 * and the diagram-format audit failure (S1.5). Every section has fail-closed
 * negative cases; failure ids (F1-F14, R1-R12) follow the issue.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

// New 4.6.0 APIs are imported per section so that, on an unfixed engine, each section
// reports its own failure instead of the whole suite failing at module link time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = Record<string, any>;
const baselineModule = (): Promise<AnyModule> => import("../core/tools/aidlc-baseline");
function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} is not exported`);
  return value;
}

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-460-s1-"));
const sections: string[] = [];
const failed: string[] = [];
const OLD_DATE = "2024-01-01T00:00:00Z";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];

type Run = { status: number; out: string; stdout: string; json: Record<string, unknown> };

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.AIDLC_ACTIVE_MODULE;
  delete env.AIDLC_ACTIVE_UNIT;
  delete env.AIDLC_ACTIVE_STAGE;
  return { ...env, ...extra };
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
  return result;
}

const PROBE = join(scratch, "probe.mts");
writeFileSync(PROBE, `import { pathToFileURL } from "node:url";
const [repo, command, hook, ...args] = process.argv.slice(2);
const orchestrate = await import(pathToFileURL(repo + "/core/tools/aidlc-orchestrate.ts").href);
const light = await import(pathToFileURL(repo + "/core/tools/aidlc-light-state.ts").href);
const root = process.cwd();
const hooks: Record<string, Record<string, unknown>> = {
  none: {},
  "audit-fail": { appendAudit: () => { throw new Error("simulated audit write failure"); } },
  "bump-revision": { beforeWrite: () => { light.saveWorkflowState(root, light.loadWorkflowState(root)); } },
  "change-baseline": { beforeWrite: () => {
    const state = light.loadWorkflowState(root);
    state.baseline_commit = process.env.AIDLC_TEST_ALT_COMMIT;
    state.baseline_source = "replaced";
    light.saveWorkflowState(root, state, undefined, { baselineWrite: true });
  } },
};
if (command === "legacy") {
  try {
    const state = light.createInitialState("refactor", "4.6.0", "probe-workflow", [], "probe");
    console.log(JSON.stringify({ value: orchestrate.buildConditionContext(state).has_legacy_code }));
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
} else {
  const handler = command === "baseline" ? orchestrate.handleBaseline : orchestrate.handleDiagramFormat;
  if (typeof handler !== "function") console.log(JSON.stringify({ kind: "error", message: command + " handler is not exported" }));
  else console.log(JSON.stringify(await handler(args, hooks[hook])));
}
`, "utf8");

function probe(project: string, command: string, hook: string, args: string[], env: Record<string, string> = {}): Record<string, unknown> {
  const result = spawnSync(process.execPath, [tsx, PROBE, repository, command, hook, ...args], { cwd: project, encoding: "utf8", env: cleanEnv(env) });
  const line = (result.stdout || "").trim().split(/\r?\n/).pop() || "";
  const value = parsed(line);
  if (!Object.keys(value).length) return { kind: "error", message: `probe crashed: ${`${result.stdout}\n${result.stderr}`.slice(0, 600)}` };
  return value;
}

/**
 * Collects fail-closed expectations so one run reports every case that was accepted
 * (or rejected for the wrong reason) instead of stopping at the first.
 */
function rejections(): { expect: (label: string, result: Run | Record<string, unknown>, pattern: RegExp) => void; assertAll: () => void } {
  const gaps: string[] = [];
  return {
    expect(label, result, pattern) {
      const isRun = "out" in result && typeof (result as Run).out === "string";
      const kind = isRun ? (result as Run).json.kind : (result as Record<string, unknown>).kind;
      const text = isRun ? (result as Run).out : JSON.stringify(result);
      const rejected = isRun ? (result as Run).status !== 0 && kind === "error" : kind === "error";
      if (!rejected || !pattern.test(text)) gaps.push(`${label}: expected error ${pattern}, got: ${text.trim().slice(-500) || "(no output)"}`);
      else if (process.env.AIDLC_TEST_VERBOSE) console.log(`    rejected ${label}: ${String((isRun ? (result as Run).json : result).message || text).trim().slice(0, 300)}`);
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

function commit(project: string, file: string, date = OLD_DATE): string {
  write(project, file, `${file} ${date}\n`);
  git(project, ["add", "--", file], date);
  git(project, ["commit", "-qm", file], date);
  return git(project, ["rev-parse", "HEAD"]);
}

function gitProject(name: string): { project: string; commits: string[] } {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  const commits = [
    commit(project, "c1.txt", "2024-01-01T00:00:00Z"),
    commit(project, "c2.txt", "2024-01-02T00:00:00Z"),
    commit(project, "c3.txt", "2024-01-03T00:00:00Z"),
  ];
  return { project, commits };
}

/** A pre-4.6 workflow: created without the baseline fields, as every 4.5.x state is. */
function legacyWorkflow(project: string, scope = "refactor", mutate: (state: WorkflowState) => void = () => undefined): WorkflowState {
  const state = createInitialState(scope, "4.5.4", `workflow-${project.split(/[\\/]/).pop()}`, [], "4.6.0 S1 regression");
  state.completed_stages = ["workspace-detection"];
  state.completed_stage_instances = ["workspace-detection"];
  mutate(state);
  saveWorkflowState(project, state);
  return state;
}

function statePath(project: string, sub = ""): string {
  return join(project, "aidlc", "active", sub, "aidlc-state.md");
}

function auditText(project: string, sub = ""): string {
  const path = join(project, "aidlc", "active", sub, "audit.md");
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function count(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, "g")) || []).length;
}

function auditEvent(project: string, event: string): string {
  const blocks = auditText(project).split(/^## /m).filter((block) => block.includes(`- Event: ${event}\n`));
  return blocks.pop() || "";
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

function files(project: string, dir: string, n: number): void {
  for (let index = 0; index < n; index++) write(project, `${dir}/file-${index}.py`, `# ${index}\n`);
}

function manifest(project: string, modules: Array<Record<string, unknown>>): void {
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules }));
}

/** Split-layout project: a global workflow (created by next --scope) with one module. */
function splitProject(name: string, moduleId = "m01-trade"): { project: string; commits: string[]; workflowId: string } {
  const { project, commits } = gitProject(name);
  manifest(project, [{ module_id: moduleId, name: "Trade", service_id: "trade-service" }]);
  ok(project, ["orchestrate", "next", "--scope", "feature", "--work", "split baseline fixture"]);
  const global = loadWorkflowState(project)!;
  global.completed_stages = [...GLOBAL_STAGES];
  global.completed_stage_instances = [...GLOBAL_STAGES];
  global.skipped_stage_instances = [`reverse-engineering@module:${moduleId}`];
  saveWorkflowState(project, global);
  ok(project, ["orchestrate", "split", "--from", global.workflow_id]);
  return { project, commits, workflowId: global.workflow_id };
}

/**
 * A workflow created outside git (baseline recorded as `unavailable`), after which the
 * directory becomes a repository whose first commit c1 carries `commitDate`.
 */
function unavailableProject(name: string, commitDate = OLD_DATE, mutate: (state: WorkflowState) => void = () => undefined): { project: string; c1: string } {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  ok(project, ["orchestrate", "next", "--scope", "refactor", "--work", "unavailable baseline fixture"]);
  const state = loadWorkflowState(project)!;
  assert.equal(state.baseline_commit, "unavailable", "fixture baseline is unavailable");
  mutate(state);
  saveWorkflowState(project, state);
  git(project, ["init", "-q"]);
  git(project, ["checkout", "-q", "-b", "main"]);
  return { project, c1: commit(project, "c1.txt", commitDate) };
}

const SET = (sha: string, ...extra: string[]) => ["orchestrate", "baseline", "--set", sha, "--user-input", "Approve", "--reason", "登记存量基线", ...extra];
const REPLACE = (sha: string, expect: string, ...extra: string[]) => ["orchestrate", "baseline", "--set", sha, "--replace", "--expect", expect, "--user-input", "Approve", "--reason", "更正基线", ...extra];

try {
  // ---------------------------------------------------------------- S1.0
  await section("S1.0 has_legacy_code counts files under the resolved source roots", () => {
    const legacy = (name: string, setup: (project: string) => void): Record<string, unknown> => {
      const project = join(scratch, `s10-${name}`);
      mkdirSync(project, { recursive: true });
      setup(project);
      return probe(project, "legacy", "none", []);
    };
    const gaps: string[] = [];
    const expectValue = (label: string, result: Record<string, unknown>, value: boolean) => {
      if (result.value !== value) gaps.push(`${label}: expected ${value}, got ${JSON.stringify(result)}`);
    };
    const expectError = (label: string, result: Record<string, unknown>, pattern: RegExp) => {
      if (typeof result.error !== "string" || !pattern.test(result.error)) gaps.push(`${label}: expected error ${pattern}, got ${JSON.stringify(result)}`);
    };
    // Negative before the fix: roots other than src/ were never counted.
    expectValue("app/ 11 files via source-roots.json, no src/", legacy("app", (p) => {
      files(p, "app", 11);
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app"] }));
    }), true);
    expectValue("two configured roots with 6 files each", legacy("two-roots", (p) => {
      files(p, "app", 6);
      files(p, "web/src", 6);
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app", "web/src"] }));
    }), true);
    expectValue("module-manifest paths with 11 files", legacy("manifest", (p) => {
      files(p, "services/trade", 11);
      manifest(p, [{ module_id: "m01-trade", name: "Trade", service_id: "trade", paths: ["services/trade"] }]);
    }), true);
    expectValue("node_modules/dist/build/target/.git are not counted", legacy("skips", (p) => {
      files(p, "src", 5);
      for (const skipped of ["node_modules", "dist", "build", "target", ".git"]) files(p, `src/${skipped}`, 3);
    }), false);
    expectValue("nested roots are not counted twice (5 + 5 unique files)", legacy("nested", (p) => {
      files(p, "app", 5);
      files(p, "app/sub", 5);
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app", "app/sub"] }));
    }), false);
    // Unchanged behavior for src/.
    expectValue("src/ with 11 files", legacy("src-11", (p) => files(p, "src", 11)), true);
    expectValue("src/ with exactly 10 files", legacy("src-10", (p) => files(p, "src", 10)), false);
    expectValue("source root does not exist", legacy("missing", () => undefined), false);
    expectValue("configured root does not exist", legacy("missing-config", (p) => {
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app"] }));
    }), false);
    // Fail-closed: an invalid configuration is an error, never "no legacy code".
    expectError("source root ../outside", legacy("outside", (p) => {
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["../outside"] }));
    }), /source root/);
    expectError("absolute POSIX source root", legacy("absolute-posix", (p) => {
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["/abs/app"] }));
    }), /project-relative/);
    expectError("absolute Windows source root", legacy("absolute-windows", (p) => {
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["C:\\abs\\app"] }));
    }), /project-relative/);
    expectError("symbolic-link source root", legacy("symlink", (p) => {
      const outside = join(scratch, "s10-symlink-target");
      files(outside, ".", 11);
      symlinkSync(outside, join(p, "app"), "junction");
      write(p, ".aidlc/source-roots.json", JSON.stringify({ version: "1", source_roots: ["app"] }));
    }), /symbolic link|outside project root/);
    expectError("invalid module-manifest paths", legacy("manifest-escape", (p) => {
      manifest(p, [{ module_id: "m01-trade", name: "Trade", service_id: "trade", paths: ["../outside"] }]);
    }), /paths|source root/);
    assert.equal(gaps.length, 0, `has_legacy_code cases failed:\n- ${gaps.join("\n- ")}`);
  });

  // ---------------------------------------------------------------- S1.1
  await section("S1.1 baseline is recorded only when next --scope creates a workflow", () => {
    const { project, commits } = gitProject("s11-created");
    ok(project, ["orchestrate", "next", "--scope", "refactor", "--work", "baseline created"]);
    const state = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(state.baseline_commit, commits[2], "baseline is the HEAD at creation");
    assert.equal(state.baseline_source, "created");
    const markdown = readFileSync(statePath(project), "utf8");
    assert.match(markdown, new RegExp(`^- Baseline Commit: ${commits[2]}$`, "m"));
    assert.match(markdown, /^- Baseline Source: created$/m);
    const event = auditEvent(project, "BASELINE_COMMIT_RECORDED");
    assert.match(event, new RegExp(`- Commit: ${commits[2]}`));
    assert.match(event, /- Source: created/);
    assert.match(event, new RegExp(`- Workflow ID: ${state.workflow_id}`));

    // createInitialState itself never records a baseline.
    const initial = createInitialState("refactor", "4.6.0", "plain", [], "plain") as WorkflowState & Record<string, unknown>;
    assert.equal("baseline_commit" in initial, false);
    assert.equal("baseline_source" in initial, false);
  });

  await section("S1.1 non-git project records unavailable", () => {
    const project = join(scratch, "s11-non-git");
    mkdirSync(project, { recursive: true });
    ok(project, ["orchestrate", "next", "--scope", "refactor", "--work", "no git"]);
    const state = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(state.baseline_commit, "unavailable");
    assert.equal(state.baseline_source, "created");
    assert.match(auditEvent(project, "BASELINE_COMMIT_RECORDED"), /- Commit: unavailable/);
  });

  await section("S1.1 pre-4.6 state stays without baseline through next, report, upgrade, park and save", () => {
    const { project } = gitProject("s11-legacy");
    legacyWorkflow(project);
    const before = loadWorkflowState(project)!.revision;
    run(project, ["orchestrate", "next"]);
    const directive = run(project, ["orchestrate", "next"]).json;
    const stage = typeof directive.stage === "string" ? directive.stage : "workspace-detection";
    run(project, ["orchestrate", "report", "--stage", stage, "--result", "completed"]);
    ok(project, ["orchestrate", "upgrade", "--dry-run"]);
    run(project, ["orchestrate", "park"]);
    const state = loadWorkflowState(project)!;
    saveWorkflowState(project, state);
    const after = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.ok(after.revision > before + 1, `the state was rewritten (revision ${before} -> ${after.revision})`);
    assert.equal(after.status, "parked");
    assert.doesNotMatch(readFileSync(statePath(project), "utf8"), /Baseline/);
    assert.equal("baseline_commit" in after, false);
    assert.doesNotMatch(auditText(project), /BASELINE_COMMIT/);
  });

  await section("S1.1 module sub-workflows never carry the baseline; workflowBaseline reads the parent", async () => {
    const workflowBaseline = required((await baselineModule()).workflowBaseline, "workflowBaseline");
    const { project, commits, workflowId } = splitProject("s11-split");
    const global = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(global.workflow_id, workflowId);
    assert.equal(global.baseline_commit, commits[2], "split keeps the global baseline");
    assert.equal(global.baseline_source, "created", "split keeps the baseline source");
    for (const sub of ["modules/m01-trade", "integration"]) {
      assert.doesNotMatch(readFileSync(statePath(project, sub), "utf8"), /Baseline/, `${sub} has no baseline fields`);
    }
    assert.equal(count(auditText(project), /BASELINE_COMMIT_RECORDED/), 1, "split records no new baseline");
    for (const ref of [{ kind: "global" }, { kind: "module", module_id: "m01-trade" }, { kind: "integration" }]) {
      const value = workflowBaseline(project, ref);
      assert.equal(value.registered, true, JSON.stringify(ref));
      assert.equal(value.commit, commits[2]);
      assert.equal(value.source, "created");
    }

    // Parent without a baseline: the module workflow reports "not registered".
    const legacy = gitProject("s11-split-legacy").project;
    manifest(legacy, [{ module_id: "m01-trade", name: "Trade", service_id: "trade-service" }]);
    const old = legacyWorkflow(legacy, "feature", (state) => {
      state.completed_stages = [...GLOBAL_STAGES];
      state.completed_stage_instances = [...GLOBAL_STAGES];
      state.skipped_stage_instances = ["reverse-engineering@module:m01-trade"];
    });
    ok(legacy, ["orchestrate", "split", "--from", old.workflow_id]);
    assert.doesNotMatch(readFileSync(statePath(legacy), "utf8"), /Baseline/);
    assert.equal(workflowBaseline(legacy, { kind: "module", module_id: "m01-trade" }).registered, false);
    assert.equal(workflowBaseline(legacy, { kind: "global" }).registered, false);
  });

  await section("S1.1 malformed, partial, injected or silently changed baseline fields are rejected", () => {
    const { project, commits } = splitProject("s11-reject");
    const checks = rejections();
    const loadError = (path: string, mutate: (markdown: string) => string, sub = ""): Record<string, unknown> => {
      const original = readFileSync(path, "utf8");
      writeFileSync(path, mutate(original), "utf8");
      try {
        loadWorkflowState(project, sub ? (sub === "integration" ? { kind: "integration" } : { kind: "module", module_id: "m01-trade" }) : undefined);
        return { kind: "accepted" };
      } catch (error) {
        return { kind: "error", message: error instanceof Error ? error.message : String(error) };
      } finally {
        writeFileSync(path, original, "utf8");
      }
    };
    const inject = (markdown: string) => markdown.replace(/^- Depth:/m, `- Baseline Commit: ${commits[0]}\n- Baseline Source: registered\n- Depth:`);
    checks.expect("module state with injected baseline", loadError(statePath(project, "modules/m01-trade"), inject, "module"), /sub-workflow|module workflow/i);
    checks.expect("integration state with injected baseline", loadError(statePath(project, "integration"), inject, "integration"), /sub-workflow|integration workflow/i);
    const global = statePath(project);
    checks.expect("abbreviated commit", loadError(global, (m) => m.replace(/^- Baseline Commit: .*$/m, `- Baseline Commit: ${commits[2].slice(0, 12)}`)), /Baseline Commit/);
    checks.expect("uppercase commit", loadError(global, (m) => m.replace(/^- Baseline Commit: .*$/m, `- Baseline Commit: ${commits[2].toUpperCase()}`)), /Baseline Commit/);
    checks.expect("ref name commit", loadError(global, (m) => m.replace(/^- Baseline Commit: .*$/m, "- Baseline Commit: HEAD")), /Baseline Commit/);
    checks.expect("only Baseline Commit", loadError(global, (m) => m.replace(/^- Baseline Source: .*\n/m, "")), /Baseline Commit and Baseline Source/);
    checks.expect("only Baseline Source", loadError(global, (m) => m.replace(/^- Baseline Commit: .*\n/m, "")), /Baseline Commit and Baseline Source/);
    checks.expect("invalid Baseline Source", loadError(global, (m) => m.replace(/^- Baseline Source: .*$/m, "- Baseline Source: guessed")), /Baseline Source/);

    // Ordinary saves preserve the baseline verbatim.
    const trySave = (mutate: (state: WorkflowState & Record<string, unknown>) => void, ref?: Record<string, string>): Record<string, unknown> => {
      const state = loadWorkflowState(project, ref as never) as WorkflowState & Record<string, unknown>;
      mutate(state);
      try {
        saveWorkflowState(project, state, ref as never);
        return { kind: "accepted" };
      } catch (error) {
        return { kind: "error", message: error instanceof Error ? error.message : String(error) };
      }
    };
    checks.expect("ordinary save changes the commit", trySave((s) => { s.baseline_commit = commits[0]; }), /baseline/i);
    checks.expect("ordinary save changes the source", trySave((s) => { s.baseline_source = "registered"; }), /baseline/i);
    checks.expect("ordinary save drops the baseline", trySave((s) => { delete s.baseline_commit; delete s.baseline_source; }), /baseline/i);
    checks.expect("module save adds a baseline", trySave((s) => { s.baseline_commit = commits[0]; s.baseline_source = "registered"; }, { kind: "module", module_id: "m01-trade" }), /sub-workflow|module workflow/i);
    checks.assertAll();
    const after = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(after.baseline_commit, commits[2]);
    assert.equal(after.baseline_source, "created");
    // A save that leaves the baseline alone still works.
    after.depth = "standard";
    saveWorkflowState(project, after);
    assert.equal((loadWorkflowState(project) as WorkflowState & Record<string, unknown>).baseline_commit, commits[2]);
  });

  // ---------------------------------------------------------------- S1.2
  await section("S1.2 baseline view and --set registers a valid ancestor", () => {
    const { project, commits } = gitProject("s12-set");
    const workflow = legacyWorkflow(project);
    const view = ok(project, ["orchestrate", "baseline"]).json;
    assert.equal(view.registered, false, JSON.stringify(view));
    assert.equal(view.baseline_commit, null);

    // --dry-run checks everything and writes nothing.
    const revision = loadWorkflowState(project)!.revision;
    const auditBefore = auditText(project);
    const dry = ok(project, SET(commits[1], "--dry-run")).json;
    assert.equal(dry.dry_run, true, JSON.stringify(dry));
    assert.equal(dry.changed, true);
    assert.equal(loadWorkflowState(project)!.revision, revision);
    assert.equal(auditText(project), auditBefore);

    const set = ok(project, SET(commits[1])).json;
    assert.equal(set.changed, true, JSON.stringify(set));
    const state = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(state.baseline_commit, commits[1]);
    assert.equal(state.baseline_source, "registered");
    const entry = state.history[state.history.length - 1];
    assert.deepEqual({ stage: entry.stage, result: entry.result, user_input: entry.user_input }, { stage: "baseline", result: "registered", user_input: "Approve" });
    const event = auditEvent(project, "BASELINE_COMMIT_SET");
    for (const field of [
      `Workflow ID: ${workflow.workflow_id}`,
      `Commit: ${commits[1]}`,
      "Source: registered",
      `HEAD At Registration: ${commits[2]}`,
      "Committer Date (self-reported): 2024-01-02T00:00:00",
      "Author Date (self-reported): 2024-01-02T00:00:00",
      `Workflow Started At: ${workflow.created_at}`,
      "Anchor Commits: none",
      "Tracked State At Commit: untracked",
      "Reason: 登记存量基线",
      "User Input: Approve",
    ]) assert.ok(event.includes(`- ${field}`), `audit field ${field}\n${event}`);

    const again = ok(project, SET(commits[1])).json;
    assert.equal(again.changed, false, JSON.stringify(again));
    assert.equal(count(auditText(project), /BASELINE_COMMIT_SET/), 1);
    const shown = ok(project, ["orchestrate", "baseline"]).json;
    assert.equal(shown.baseline_commit, commits[1]);
    assert.equal(shown.baseline_source, "registered");
  });

  await section("S1.2 --set fails closed (F1-F14)", () => {
    const checks = rejections();
    const { project, commits } = gitProject("s12-reject");
    const tree = git(project, ["rev-parse", "HEAD^{tree}"]);
    git(project, ["checkout", "-q", "-b", "side", commits[0]]);
    const side = commit(project, "side.txt", "2024-01-02T12:00:00Z");
    git(project, ["checkout", "-q", "main"]);

    // F1: no workflow, done workflow.
    checks.expect("F1 no active workflow", run(project, SET(commits[0])), /No active workflow/);
    legacyWorkflow(project, "refactor", (state) => { state.status = "done"; });
    checks.expect("F1 done workflow", run(project, SET(commits[0])), /done/);
    rmSync(join(project, "aidlc"), { recursive: true, force: true });
    legacyWorkflow(project);

    // F2: module sub-workflow.
    checks.expect("F2 --module", run(project, [...SET(commits[0]), "--module", "m01-trade"]), /global|module/i);
    // F5: arguments.
    checks.expect("F5 missing --user-input", run(project, ["orchestrate", "baseline", "--set", commits[0], "--reason", "r"]), /--user-input/);
    checks.expect("F5 --user-input not Approve", run(project, ["orchestrate", "baseline", "--set", commits[0], "--user-input", "yes", "--reason", "r"]), /--user-input/);
    checks.expect("F5 missing --reason", run(project, ["orchestrate", "baseline", "--set", commits[0], "--user-input", "Approve"]), /--reason/);
    checks.expect("F5 empty --reason", run(project, ["orchestrate", "baseline", "--set", commits[0], "--user-input", "Approve", "--reason", "  "]), /--reason/);
    // F6: not a full lowercase hex id.
    for (const value of [commits[0].slice(0, 7), "HEAD~1", "main", commits[0].toUpperCase(), `${commits[0]}0`]) {
      checks.expect(`F6 --set ${value}`, run(project, SET(value)), /40- or 64-character/);
    }
    checks.expect("F6 --set --all", run(project, ["orchestrate", "baseline", "--set", "--all", "--user-input", "Approve", "--reason", "r"]), /--set|--all/);
    // F7: unknown object, not a commit.
    checks.expect("F7 unknown object", run(project, SET("0123456789abcdef0123456789abcdef01234567")), /does not exist|not a commit/);
    checks.expect("F7 tree object", run(project, SET(tree)), /not a commit/);
    // F8: not an ancestor of HEAD.
    checks.expect("F8 non-ancestor", run(project, SET(side)), /not the current HEAD or one of its ancestors/);
    // F10: not an ancestor of a controlled evidence anchor (evidence produced at c1, then c2/c3 committed).
    write(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json", JSON.stringify({ evidence_version: "1", producer: { mode: "controlled" }, source_revision: { commit: commits[0] } }));
    checks.expect("F10 newer than an evidence anchor", run(project, SET(commits[1])), /evidence anchor/);
    rmSync(join(project, ".aidlc"), { recursive: true, force: true });
    // F12: committer date later than the workflow start.
    const late = gitProject("s12-late");
    const future = commit(late.project, "future.txt", "2099-01-01T00:00:00Z");
    legacyWorkflow(late.project);
    checks.expect("F12 committer date after workflow start", run(late.project, SET(future)), /committer date/);
    // F14: boolean and unknown flags, positional arguments.
    checks.expect("F14 --dry-run with a value", run(project, [...SET(commits[0]), "--dry-run", "yes"]), /--dry-run/);
    checks.expect("F14 unknown flag", run(project, [...SET(commits[0]), "--force"]), /Unsupported baseline option: --force/);
    checks.expect("F14 positional argument", run(project, [...SET(commits[0]), "extra"]), /Unexpected baseline argument/);
    checks.expect("F14 --dry-run without --set", run(project, ["orchestrate", "baseline", "--dry-run"]), /--set/);
    // F3: already registered with a different value.
    ok(project, SET(commits[0]));
    checks.expect("F3 different value", run(project, SET(commits[1])), /--replace/);
    // F4: non-git project.
    const nonGit = join(scratch, "s12-non-git");
    mkdirSync(nonGit, { recursive: true });
    legacyWorkflow(nonGit);
    checks.expect("F4 non-git", run(nonGit, SET(commits[0])), /git/);
    // F9: shallow clone cannot decide ancestry.
    const source = gitProject("s12-shallow-source");
    const shallow = join(scratch, "s12-shallow");
    git(scratch, ["clone", "-q", "--depth", "1", pathToFileURL(source.project).href, shallow]);
    legacyWorkflow(shallow);
    checks.expect("F9 shallow clone", run(shallow, SET(source.commits[0])), /git fetch --unshallow/);
    // F11: the commit's tree already holds this workflow's state file.
    const tracked = gitProject("s12-tracked");
    legacyWorkflow(tracked.project);
    git(tracked.project, ["add", "aidlc/active/aidlc-state.md"]);
    git(tracked.project, ["commit", "-qm", "track state"]);
    const withState = git(tracked.project, ["rev-parse", "HEAD"]);
    checks.expect("F11 state already tracked at commit", run(tracked.project, SET(withState)), /already contains/);
    // F13: the state changes between the checks and the write.
    const conflict = gitProject("s12-conflict");
    legacyWorkflow(conflict.project);
    checks.expect("F13 revision conflict", probe(conflict.project, "baseline", "bump-revision", ["--set", conflict.commits[0], "--user-input", "Approve", "--reason", "r"]), /revision/);
    checks.assertAll();

    // Nothing was written by any rejection: one SET event (the F3 setup), no baseline elsewhere.
    assert.equal(count(auditText(project), /BASELINE_COMMIT_SET/), 1);
    for (const target of [late.project, nonGit, shallow, conflict.project]) {
      assert.doesNotMatch(readFileSync(statePath(target), "utf8"), /Baseline/, target);
      assert.doesNotMatch(auditText(target), /BASELINE_COMMIT/, target);
    }
    // F11 positive counterpart: an earlier commit without the state file is accepted.
    const accepted = ok(tracked.project, SET(tracked.commits[0])).json;
    assert.equal(accepted.changed, true);
    assert.match(auditEvent(tracked.project, "BASELINE_COMMIT_SET"), /- Tracked State At Commit: absent/);
  });

  await section("S1.2 evidence anchors: an ancestor of every controlled evidence commit is accepted", () => {
    const { project, commits } = gitProject("s12-anchor");
    legacyWorkflow(project);
    write(project, ".aidlc/evidence/tdd/project/default/red-test-evidence.json", JSON.stringify({ evidence_version: "1", producer: { mode: "controlled" }, source_revision: { commit: commits[2] } }));
    write(project, ".aidlc/evidence/workspace-detection/traceability.json", JSON.stringify({ evidence_version: "1", producer: { mode: "manual" }, source_revision: { commit: "0123456789abcdef0123456789abcdef01234567" } }));
    ok(project, SET(commits[1]));
    assert.match(auditEvent(project, "BASELINE_COMMIT_SET"), new RegExp(`- Anchor Commits: ${commits[2]}`));
  });

  // ---------------------------------------------------------------- S1.3
  await section("S1.3 --replace --expect replaces an unused baseline", async () => {
    const { project, commits } = gitProject("s13-replace");
    const workflow = legacyWorkflow(project);
    ok(project, SET(commits[1]));
    const revision = loadWorkflowState(project)!.revision;
    const dry = ok(project, REPLACE(commits[0], commits[1], "--dry-run")).json;
    assert.equal(dry.dry_run, true, JSON.stringify(dry));
    assert.equal(loadWorkflowState(project)!.revision, revision);
    assert.equal(count(auditText(project), /BASELINE_COMMIT_REPLACED/), 0);

    const replaced = ok(project, REPLACE(commits[0], commits[1])).json;
    assert.equal(replaced.changed, true, JSON.stringify(replaced));
    const state = loadWorkflowState(project) as WorkflowState & Record<string, unknown>;
    assert.equal(state.baseline_commit, commits[0]);
    assert.equal(state.baseline_source, "replaced");
    const entry = state.history[state.history.length - 1];
    assert.deepEqual({ stage: entry.stage, result: entry.result, user_input: entry.user_input }, { stage: "baseline", result: "replaced", user_input: "Approve" });
    const event = auditEvent(project, "BASELINE_COMMIT_REPLACED");
    for (const field of [
      `Workflow ID: ${workflow.workflow_id}`,
      `From: ${commits[1]}`,
      "From Source: registered",
      `To: ${commits[0]}`,
      `Expected: ${commits[1]}`,
      `HEAD At Replacement: ${commits[2]}`,
      "Committer Date (self-reported): 2024-01-01T00:00:00",
      "Author Date (self-reported): 2024-01-01T00:00:00",
      `Workflow Started At: ${workflow.created_at}`,
      "Anchor Commits: none",
      "Tracked State At Commit: untracked",
      "Usage Check: U1=clear U2=clear U3=clear U4=clear (workflows scanned: 1)",
      "Replacement Count: 1",
      "Reason: 更正基线",
      "User Input: Approve",
    ]) assert.ok(event.includes(`- ${field}`), `audit field ${field}\n${event}`);

    const same = ok(project, REPLACE(commits[0], commits[0])).json;
    assert.equal(same.changed, false, JSON.stringify(same));
    assert.equal(count(auditText(project), /BASELINE_COMMIT_REPLACED/), 1);
    ok(project, REPLACE(commits[1], commits[0]));
    assert.match(auditEvent(project, "BASELINE_COMMIT_REPLACED"), /- Replacement Count: 2/);
    assert.equal((loadWorkflowState(project) as WorkflowState & Record<string, unknown>).baseline_source, "replaced");

    // A1: an `unavailable` baseline is corrected with --expect unavailable.
    const dryUnavailable = unavailableProject("s13-unavailable-dry");
    const unavailableRevision = loadWorkflowState(dryUnavailable.project)!.revision;
    const dryRun = ok(dryUnavailable.project, REPLACE(dryUnavailable.c1, "unavailable", "--dry-run")).json;
    assert.equal(dryRun.dry_run, true, JSON.stringify(dryRun));
    assert.equal(loadWorkflowState(dryUnavailable.project)!.revision, unavailableRevision, "--dry-run does not write the state");
    assert.equal((loadWorkflowState(dryUnavailable.project) as WorkflowState & Record<string, unknown>).baseline_commit, "unavailable");
    assert.equal(count(auditText(dryUnavailable.project), /BASELINE_COMMIT_REPLACED/), 0, "--dry-run does not write the audit");

    const fromUnavailable = unavailableProject("s13-unavailable");
    const corrected = ok(fromUnavailable.project, REPLACE(fromUnavailable.c1, "unavailable")).json;
    assert.equal(corrected.changed, true, JSON.stringify(corrected));
    const correctedState = loadWorkflowState(fromUnavailable.project) as WorkflowState & Record<string, unknown>;
    assert.equal(correctedState.baseline_commit, fromUnavailable.c1);
    assert.equal(correctedState.baseline_source, "replaced");
    const correctedEvent = auditEvent(fromUnavailable.project, "BASELINE_COMMIT_REPLACED");
    for (const field of ["From: unavailable", "From Source: created", `To: ${fromUnavailable.c1}`, "Expected: unavailable", "Replacement Count: 1"]) {
      assert.ok(correctedEvent.includes(`- ${field}`), `audit field ${field}\n${correctedEvent}`);
    }
    const baselineCommitErrors = required((await baselineModule()).baselineCommitErrors, "baselineCommitErrors");
    assert.deepEqual(baselineCommitErrors(fromUnavailable.project, correctedState), []);
  });

  await section("S1.3 --replace fails closed (R1-R12)", () => {
    const checks = rejections();
    const { project, commits } = gitProject("s13-reject");
    git(project, ["checkout", "-q", "-b", "side", commits[0]]);
    const side = commit(project, "side.txt", "2024-01-02T12:00:00Z");
    git(project, ["checkout", "-q", "main"]);
    legacyWorkflow(project);
    checks.expect("R1 --replace without a baseline", run(project, REPLACE(commits[0], commits[1])), /--set/);
    ok(project, SET(commits[1]));
    checks.expect("R2 --set without --replace", run(project, SET(commits[0])), /--replace/);
    checks.expect("R3 --replace with a value", run(project, ["orchestrate", "baseline", "--set", commits[0], "--replace", "yes", "--expect", commits[1], "--user-input", "Approve", "--reason", "r"]), /--replace/);
    checks.expect("R3 --replace without --set", run(project, ["orchestrate", "baseline", "--replace", "--expect", commits[1], "--user-input", "Approve", "--reason", "r"]), /--set/);
    checks.expect("R4 --expect missing", run(project, ["orchestrate", "baseline", "--set", commits[0], "--replace", "--user-input", "Approve", "--reason", "r"]), /--expect/);
    checks.expect("R4 --expect malformed", run(project, REPLACE(commits[0], commits[1].slice(0, 10))), /--expect/);
    checks.expect("R4 --expect does not match", run(project, REPLACE(commits[0], commits[2])), /--expect/);
    checks.expect("R4 --expect without --replace", run(project, [...SET(commits[0]), "--expect", commits[1]]), /--expect|--replace/);
    checks.expect("R9 new commit fails the --set checks", run(project, REPLACE(side, commits[1])), /not the current HEAD or one of its ancestors/);
    checks.expect("R10 --module", run(project, [...REPLACE(commits[0], commits[1]), "--module", "m01-trade"]), /global|module/i);

    const usage = (label: string, mutate: (state: WorkflowState) => void, evidence: Record<string, string> = {}, pattern: RegExp) => {
      const target = gitProject(`s13-${label}`);
      legacyWorkflow(target.project, "refactor", mutate);
      ok(target.project, SET(target.commits[1]));
      for (const [path, content] of Object.entries(evidence)) write(target.project, path, content);
      checks.expect(label, run(target.project, REPLACE(target.commits[0], target.commits[1])), pattern);
    };
    for (const stage of ["tdd", "code-generation", "code-review"]) {
      usage(`R5-U1-completed-${stage}`, (state) => { state.completed_stage_instances.push(`${stage}@module:project@unit:default`); }, {}, /U1/);
    }
    usage("R5-U1-completed-build-and-test", (state) => { state.completed_stage_instances.push("build-and-test"); }, {}, /U1/);
    usage("R5-U1-active-tdd", (state) => {
      const now = new Date().toISOString();
      state.active_instances["tdd@module:project@unit:default"] = { module_id: "project", stage_instance: "tdd@module:project@unit:default", owner: "alice", claimed_at: now, heartbeat_at: now, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
    }, {}, /U1/);
    usage("R6-U2-characterization", (state) => { state.completed_stage_instances.push("test-case-derivation@module:project"); }, {
      ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json": JSON.stringify({ evidence_version: "1", characterization: [{ use_case: "UC-D-001" }] }),
    }, /U2/);
    usage("R7-U3-baseline-evidence", () => undefined, {
      ".aidlc/evidence/tdd/project/default/baseline-test-evidence.json": JSON.stringify({ evidence_version: "1", baseline_commit: "0123456789abcdef0123456789abcdef01234567" }),
    }, /U3/);
    usage("R8-U4-unparseable-evidence", () => undefined, { ".aidlc/evidence/tdd/project/default/red-test-evidence.json": "{not json" }, /U4/);

    const done = gitProject("s13-done");
    legacyWorkflow(done.project);
    ok(done.project, SET(done.commits[1]));
    const doneState = loadWorkflowState(done.project)!;
    doneState.status = "done";
    saveWorkflowState(done.project, doneState);
    checks.expect("R11 done workflow", run(done.project, REPLACE(done.commits[0], done.commits[1])), /done/);

    const race = gitProject("s13-race");
    legacyWorkflow(race.project);
    ok(race.project, SET(race.commits[1]));
    checks.expect("R12 revision conflict", probe(race.project, "baseline", "bump-revision", ["--set", race.commits[0], "--replace", "--expect", race.commits[1], "--user-input", "Approve", "--reason", "r"]), /revision/);
    checks.expect("R12 --expect invalidated before write", probe(race.project, "baseline", "change-baseline", ["--set", race.commits[0], "--replace", "--expect", race.commits[1], "--user-input", "Approve", "--reason", "r"], { AIDLC_TEST_ALT_COMMIT: race.commits[2] }), /revision|--expect/);

    // Split layout: any sub-workflow that used the baseline blocks the replacement.
    const split = splitProject("s13-split");
    const moduleRef = { kind: "module" as const, module_id: "m01-trade" };
    const moduleState = loadWorkflowState(split.project, moduleRef)!;
    moduleState.completed_stage_instances.push("tdd@module:m01-trade@unit:default");
    saveWorkflowState(split.project, moduleState, moduleRef);
    checks.expect("U1 in a module sub-workflow", run(split.project, REPLACE(split.commits[0], split.commits[2])), /U1.*m01-trade|m01-trade.*U1/);
    checks.assertAll();

    assert.equal(count(auditText(project), /BASELINE_COMMIT_REPLACED/), 0);
    assert.equal((loadWorkflowState(project) as WorkflowState & Record<string, unknown>).baseline_commit, commits[1]);
    assert.equal((loadWorkflowState(split.project) as WorkflowState & Record<string, unknown>).baseline_commit, split.commits[2]);

    // U2 positive counterpart: an empty characterization does not count as use.
    const unused = gitProject("s13-u2-empty");
    legacyWorkflow(unused.project, "refactor", (state) => { state.completed_stage_instances.push("test-case-derivation@module:project"); });
    ok(unused.project, SET(unused.commits[1]));
    write(unused.project, ".aidlc/evidence/test-case-derivation/project/test-case-derivation.json", JSON.stringify({ evidence_version: "1", characterization: [] }));
    assert.equal(ok(unused.project, REPLACE(unused.commits[0], unused.commits[1])).json.changed, true);

    // A1: --expect unavailable is exact and still subject to every other check.
    const a1 = rejections();
    a1.expect("A1-1 --expect unavailable against a real baseline", run(project, REPLACE(commits[0], "unavailable")), /--expect unavailable does not match the current workflow baseline/);
    for (const spelling of ["UNAVAILABLE", "unavail", "Unavailable"]) {
      a1.expect(`A1-2 --expect ${spelling}`, run(project, REPLACE(commits[0], spelling)), /--expect must be/);
    }
    a1.expect("A1-3 --set unavailable", run(project, REPLACE("unavailable", commits[1])), /--set must be a full/);
    const usedUnavailable = unavailableProject("s13-a1-used", OLD_DATE, (state) => { state.completed_stage_instances.push("tdd@module:project@unit:default"); });
    a1.expect("A1-4 unavailable baseline already in use (U1)", run(usedUnavailable.project, REPLACE(usedUnavailable.c1, "unavailable")), /U1/);
    const lateCommit = unavailableProject("s13-a1-late", new Date(Date.now() + 3_600_000).toISOString());
    a1.expect("A1-5 first commit after the workflow start (F12)", run(lateCommit.project, REPLACE(lateCommit.c1, "unavailable")), /later than the workflow start[\s\S]*重新开始工作流/);
    const hinted = unavailableProject("s13-a1-hint");
    const f3 = run(hinted.project, SET(hinted.c1));
    a1.expect("A1-6 --set without --replace on an unavailable baseline (F3)", f3, /--replace --expect unavailable/);
    a1.assertAll();
    for (const target of [usedUnavailable, lateCommit, hinted]) {
      assert.equal((loadWorkflowState(target.project) as WorkflowState & Record<string, unknown>).baseline_commit, "unavailable", `${target.project} keeps unavailable`);
      assert.equal(count(auditText(target.project), /BASELINE_COMMIT_REPLACED|BASELINE_COMMIT_SET/), 0, `${target.project} has no baseline write audit`);
    }
    // The F3 hint is directly executable once --reason is filled in.
    const hint = /orchestrate baseline (--set \S+ --replace --expect unavailable --user-input Approve) --reason "<why>"/.exec(String(f3.json.message));
    assert.ok(hint, `F3 hint is an executable command: ${f3.json.message}`);
    const followed = ok(hinted.project, ["orchestrate", "baseline", ...hint![1].split(" "), "--reason", "按提示更正基线"]).json;
    assert.equal(followed.changed, true, JSON.stringify(followed));
    assert.equal((loadWorkflowState(hinted.project) as WorkflowState & Record<string, unknown>).baseline_commit, hinted.c1);
  });

  // ---------------------------------------------------------------- S1.4
  await section("S1.4 baselineCommitErrors re-checks the baseline on every call", async () => {
    const baselineCommitErrors = required((await baselineModule()).baselineCommitErrors, "baselineCommitErrors");
    const { project, commits } = gitProject("s14-errors");
    legacyWorkflow(project);
    const unregistered = baselineCommitErrors(project, loadWorkflowState(project));
    assert.ok(unregistered.length > 0 && /not registered/.test(unregistered.join("\n")), JSON.stringify(unregistered));
    ok(project, SET(commits[1]));
    assert.deepEqual(baselineCommitErrors(project, loadWorkflowState(project)), []);
    // Rewrite history: c3 is rebased onto c1 and c2 (the baseline) becomes orphaned.
    git(project, ["rebase", "-q", "--onto", commits[0], commits[1], "main"]);
    const orphaned = baselineCommitErrors(project, loadWorkflowState(project));
    assert.ok(orphaned.length > 0 && /not the current HEAD or one of its ancestors/.test(orphaned.join("\n")), JSON.stringify(orphaned));
    const unavailable = baselineCommitErrors(project, { baseline_commit: "unavailable", baseline_source: "created" });
    assert.ok(unavailable.length > 0 && /unavailable/.test(unavailable.join("\n")), JSON.stringify(unavailable));
    const missing = baselineCommitErrors(project, { baseline_commit: "0123456789abcdef0123456789abcdef01234567", baseline_source: "registered" });
    assert.ok(missing.length > 0 && /does not exist|not a commit/.test(missing.join("\n")), JSON.stringify(missing));
  });

  // ---------------------------------------------------------------- S1.5
  await section("S1.5 diagram-format reports an audit write failure as an error", () => {
    const { project } = gitProject("s15-audit");
    legacyWorkflow(project);
    const result = probe(project, "diagram-format", "audit-fail", ["--set", "svg", "--user-input", "请用 SVG"]);
    assert.equal(result.kind, "error", JSON.stringify(result));
    assert.match(String(result.message), /状态已写入、审计缺失，请人工补记/);
    assert.equal(loadWorkflowState(project)!.diagram_format, "svg", "the state write itself is kept");
    // The same failure on baseline --set is reported the same way.
    const baseline = gitProject("s15-baseline-audit");
    legacyWorkflow(baseline.project);
    const set = probe(baseline.project, "baseline", "audit-fail", ["--set", baseline.commits[0], "--user-input", "Approve", "--reason", "r"]);
    assert.equal(set.kind, "error", JSON.stringify(set));
    assert.match(String(set.message), /状态已写入、审计缺失，请人工补记/);
    assert.equal((loadWorkflowState(baseline.project) as WorkflowState & Record<string, unknown>).baseline_commit, baseline.commits[0]);
  });

  if (failed.length > 0) {
    console.log(`4.6.0 S1 baseline regression tests FAILED: ${failed.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log(`4.6.0 S1 baseline regression tests passed (${sections.length} sections)`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
