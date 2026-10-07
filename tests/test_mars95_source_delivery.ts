/**
 * MARS-95 regression suite: the file-level sensors (no-todo, traceability) and
 * the produce presence of the canonical `src/` judge only the source files a unit
 * delivers since its baseline, never the whole source root.
 *
 * Fixture: a workflow repository with the declared nested repository app/. app/ holds a
 * legacy Base.java with a TODO and no REQ, and an ignored binary target/x.class; after
 * the baseline a new Impl.java carrying REQ-1 is committed. Unit u-a has req_refs
 * [REQ-1]; unit u-b declares ucd_exemption. Gates are evaluated through tests/gate_probe.ts.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const probe = join(repository, "tests", "gate_probe.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars95-"));
const sections: string[] = [];
const failed: string[] = [];

const M01 = "m01";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const EXEMPTION = { reason_code: "pure-declaration", reason: "u-b 只声明跨单元契约，不含业务行为", approval_ref: "REVIEW-2026-10-07-02", alternative_validation: "契约结构校验", validation_command: ["node", "-e", "0"] };
const UNIT_A = `code-generation@module:${M01}@unit:u-a`;
const UNIT_B = `code-generation@module:${M01}@unit:u-b`;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE", "AIDLC_SUBPROCESS_MAX_BUFFER"]) delete env[key];
  return env;
}

function write(project: string, path: string, content: string | Buffer): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content);
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function commit(cwd: string, message: string): string {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-qm", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

type Probe = { failures?: string[]; missing?: string[]; error?: string };

function gate(project: string, instance: string, mode: "sensors" | "produces", sensor?: string): Probe {
  const result = spawnSync(process.execPath, [tsx, probe, instance, mode, ...(sensor ? [sensor] : [])], { cwd: project, encoding: "utf8", env: cleanEnv() });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() || "{}") as Probe;
  assert.equal(parsed.error, undefined, `gate_probe error: ${parsed.error}`);
  return parsed;
}

const sensor = (project: string, instance: string, name: string): string => (gate(project, instance, "sensors", name).failures || []).join("\n");
/** Missing produces that concern source (evidence JSON files are out of scope of this suite). */
const sourceMissing = (project: string, instance: string): string[] => (gate(project, instance, "produces").missing || []).filter((label) => !label.startsWith(".aidlc/evidence/"));

async function section(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    sections.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

function moduleDocs(project: string, sourcePaths?: string[]): void {
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [{ module_id: M01, name: "Orders", service_id: "order-service", ...(sourcePaths ? { paths: sourcePaths } : {}) }],
  }));
  write(project, `docs/aidlc/modules/${M01}/inception/unit-manifest.json`, `${JSON.stringify({
    schema_version: 1,
    module_id: M01,
    units: [
      { unit_id: "u-a", name: "Unit u-a", service_id: "order-service", req_refs: ["REQ-1"] },
      { unit_id: "u-b", name: "Unit u-b", service_id: "order-service", ucd_exemption: EXEMPTION },
    ],
  }, null, 2)}\n`);
  for (const unit of ["u-a", "u-b"]) {
    const root = `docs/aidlc/modules/${M01}/construction/${unit}`;
    write(project, `${root}/plans/code-generation-plan.md`, `# Code generation plan ${unit}\n\nREQ-1 order export retry is implemented by the export service.\n`);
    write(project, `${root}/implementation-summary.md`, `# Implementation summary ${unit}\n\nREQ-1 order export retry delivered as described in the plan.\n`);
  }
}

function saveState(project: string, name: string, baseline?: { commit: string; repos?: Record<string, string> }): void {
  const state: WorkflowState = createInitialState("feature", "4.11.0", `workflow-${name}`, [], "MARS-95 source delivery");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES, `units-generation@module:${M01}`];
  if (baseline) {
    state.baseline_commit = baseline.commit;
    state.baseline_source = "created";
    if (baseline.repos) state.baseline_repos = baseline.repos;
  }
  saveWorkflowState(project, state);
}

/** Workflow repository + nested app/ with a legacy base and one delivered Impl.java after the baseline. */
function nestedProject(name: string, baselineAtHead = false, save = true): { project: string; app: string; workflowCommit: string; appBase: string } {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, ".gitignore", "app/\n");
  write(project, ".aidlc/source-roots.json", `${JSON.stringify({ version: "1", source_roots: [{ path: "app", repo: "nested" }] })}\n`);
  moduleDocs(project);
  const workflowCommit = commit(project, "workflow repository");

  const app = join(project, "app");
  mkdirSync(app, { recursive: true });
  git(app, ["init", "-q"]);
  write(project, "app/.gitignore", "target/\n");
  write(project, "app/Base.java", "// TODO: legacy cleanup, owned by another module\nclass Base { void run() {} }\n");
  write(project, "app/target/x.class", Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
  const appBase = commit(app, "legacy base");
  write(project, "app/Impl.java", "// REQ-1 order export retry implementation\nclass Impl { int retry(int attempts) { return attempts + 1; } }\n");
  commit(app, "u-a delivers Impl.java");
  // baselineAtHead: the baseline advanced to the completion point of an earlier unit.
  if (save) saveState(project, name, { commit: workflowCommit, repos: { app: baselineAtHead ? git(app, ["rev-parse", "HEAD"]) : appBase } });
  return { project, app, workflowCommit, appBase };
}

try {
  await section("delivery: u-a only checks Impl.java (legacy TODO, ignored binary, REQ-less base ignored)", () => {
    const { project } = nestedProject("unit-a");
    assert.equal(sensor(project, UNIT_A, "no-todo"), "");
    assert.equal(sensor(project, UNIT_A, "traceability"), "");
    assert.deepEqual(sourceMissing(project, UNIT_A), []);
  });

  await section("delivery: a TODO in the delivered Impl.java fails no-todo", () => {
    const { project } = nestedProject("unit-a-todo");
    write(project, "app/Impl.java", "// REQ-1 order export retry implementation\n// TODO: tune the back-off\nclass Impl { int retry(int attempts) { return attempts + 1; } }\n");
    const failure = sensor(project, UNIT_A, "no-todo");
    assert.match(failure, /TODO\/FIXME\/HACK in: app\/Impl\.java/, failure);
    assert.doesNotMatch(failure, /Base\.java|x\.class|unreadable/, failure);
  });

  await section("delivery: delivered files must reference the unit req_refs", () => {
    const { project, app } = nestedProject("unit-a-untraced");
    write(project, "app/Impl.java", "// REQ-9 belongs to another unit\nclass Impl { int retry(int attempts) { return attempts + 1; } }\n");
    commit(app, "untraced");
    const failure = sensor(project, UNIT_A, "traceability");
    assert.match(failure, /No delivered source file \(app\/Impl\.java\) references a REQ of u-a\.req_refs \(REQ-1\)/, failure);
    // A second delivered file without any REQ is fine once one file references REQ-1.
    write(project, "app/Impl.java", "// REQ-1 order export retry implementation\nclass Impl { int retry(int attempts) { return attempts + 1; } }\n");
    write(project, "app/Helper.java", "class Helper { static int next(int value) { return value + 1; } }\n");
    assert.equal(sensor(project, UNIT_A, "traceability"), "");
  });

  await section("delivery: empty delta — u-b (ucd_exemption) not_applicable, u-a reports no source change", () => {
    const { project } = nestedProject("empty-delta", true);
    assert.deepEqual(sourceMissing(project, UNIT_B), []);
    assert.equal(sensor(project, UNIT_B, "no-todo"), "");
    assert.equal(sensor(project, UNIT_B, "traceability"), "");
    const missing = sourceMissing(project, UNIT_A);
    assert.equal(missing.length, 1, JSON.stringify(missing));
    assert.match(missing[0], /^app\/: 本单元未交付任何源码变更 \(no source change in app\/ since the baseline app=[0-9a-f]{40}\)$/, missing[0]);
    // An uncommitted new file counts as delivered.
    write(project, "app/Next.java", "// REQ-1 next step\nclass Next { int step() { return 2; } }\n");
    assert.deepEqual(sourceMissing(project, UNIT_A), []);
    // An ignored file does not.
    rmSync(join(project, "app/Next.java"));
    write(project, "app/target/Gen.java", "// REQ-1 generated\nclass Gen {}\n");
    assert.equal(sourceMissing(project, UNIT_A).length, 1);
  });

  await section("delivery: a completed unit the baseline advanced past is judged on its own committed range", () => {
    const { project, app, workflowCommit, appBase } = nestedProject("advanced", false, false);
    write(project, "docs/aidlc/modules/m01/construction/u-a/code-review.md", "# Code review u-a\n\nREQ-1 reviewed.\n");
    const workflowEpoch1 = commit(project, "u-a done");
    const appEpoch1 = git(app, ["rev-parse", "HEAD"]);
    // u-a GREEN anchors epoch 1 (orchestrate baseline --advance to u-a's completion point).
    write(project, `.aidlc/evidence/code-generation/${M01}/u-a/green-test-evidence.json`, `${JSON.stringify({ status: "passed", source_revision: { commit: workflowEpoch1, repos: { app: { commit: appEpoch1 } } } })}\n`);
    const state: WorkflowState = createInitialState("feature", "4.11.0", "workflow-advanced", [], "MARS-95 source delivery");
    state.completed_stages = [...GLOBAL_STAGES];
    state.completed_stage_instances = [...GLOBAL_STAGES, `units-generation@module:${M01}`];
    state.baseline_commit = workflowCommit;
    state.baseline_source = "created";
    state.baseline_repos = { app: appBase };
    saveWorkflowState(project, state);
    const advanced = loadWorkflowState(project)!;
    advanced.baseline_commit = workflowEpoch1;
    advanced.baseline_source = "advanced";
    advanced.baseline_history = [workflowCommit, workflowEpoch1];
    advanced.baseline_repos = { app: appEpoch1 };
    advanced.baseline_repos_history = { app: { start: 0, commits: [appBase, appEpoch1] } };
    saveWorkflowState(project, advanced, undefined, { baselineWrite: true });
    // Later work of another unit (uncommitted TODO) never leaks into u-a's range.
    write(project, "app/Later.java", "// TODO: next unit\nclass Later {}\n");
    assert.equal(sensor(project, UNIT_A, "no-todo"), "");
    assert.equal(sensor(project, UNIT_A, "traceability"), "");
    assert.deepEqual(sourceMissing(project, UNIT_A), []);
    // u-b (no GREEN anchor) is judged against the current epoch and sees Later.java.
    assert.match(sensor(project, UNIT_B, "no-todo"), /TODO\/FIXME\/HACK in: app\/Later\.java/);
  });

  await section("compatibility: no baseline, no nested repository keeps the 4.11.0 per-file rules", () => {
    const project = join(scratch, "compat");
    mkdirSync(project, { recursive: true });
    git(project, ["init", "-q"]);
    write(project, ".gitignore", "build/\n");
    moduleDocs(project, ["src"]);
    write(project, "src/export_retry.py", "# REQ-1 retry on timeout\ndef retry(job):\n    return job\n");
    write(project, "src/logo.bin", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]));
    write(project, "src/build/cache.txt", "TODO: generated cache without requirement ids\n");
    commit(project, "small project");
    saveState(project, "compat");
    assert.equal(sensor(project, UNIT_A, "no-todo"), "", "ignored and binary files are not checked");
    assert.equal(sensor(project, UNIT_A, "traceability"), "");
    assert.deepEqual(sourceMissing(project, UNIT_A), []);
    // Every tracked (or untracked, not ignored) text source file still needs a REQ and no TODO.
    write(project, "src/audit.py", "# TODO: audit rows\ndef audit(job):\n    return job\n");
    assert.match(sensor(project, UNIT_A, "no-todo"), /TODO\/FIXME\/HACK in: src\/audit\.py/);
    assert.match(sensor(project, UNIT_A, "traceability"), /No requirement ID \(REQ-xxx or R-xxx\) found in: src\/audit\.py/);
  });
} finally {
  if (!process.env.AIDLC_KEEP_SCRATCH) rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${sections.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(", ")}`);
  process.exit(1);
}
