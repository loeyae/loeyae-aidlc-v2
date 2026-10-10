/**
 * MARS-112 regression: the traceability-matrix gate is no longer a determinate no-op for
 * the lightweight scopes (bugfix / refactor) that skip requirements-analysis and so have
 * no requirements.md root.
 *
 * Before MARS-112 the producer returned `status: not_applicable` whenever requirements.md
 * was absent, and the gate (orchestrate case "traceability-matrix") passes not_applicable
 * unconditionally — so bugfix/refactor code-generation had no real REQ→code tracing.
 *
 * The producer now anchors each lightweight scope to its own source of truth:
 *   - bugfix:            at least one tdd_mode new UC-D must declare a `defect_ref`; once
 *                        the code_refs layer (code-generation) is reached the delivered
 *                        source must reference that defect anchor.
 *   - express/workshop:  at least one tdd_mode new UC-D must declare a `change_ref`
 *                        (MARS-116, same new-UC-D mechanism as bugfix, semantically
 *                        neutral); reconciled against the delivered source the same way.
 *   - refactor:          at least one tdd_mode characterization UC-D must declare a
 *                        non-empty `code_refs` baseline anchor.
 * Any other scope without requirements.md stays not_applicable (unchanged).
 *
 * Producer side runs through the public `check` CLI; the gate side generates real
 * provenance-stamped evidence (`evidence run`) and evaluates the orchestrator gate
 * (`gate_probe.ts`), proving the broken anchor is actually rejected and the sound one
 * accepted end to end.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const probe = join(repository, "tests", "gate_probe.ts");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars112-"));
const sections: string[] = [];
const failed: string[] = [];

const M01 = "m01";
const IN = `docs/aidlc/modules/${M01}/inception`;
const CASES = `${IN}/application-design/test-cases`;
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];

type Run = { status: number; stdout: string; out: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE", "AIDLC_SUBPROCESS_MAX_BUFFER"]) delete env[key];
  return { ...env, ...extra };
}

function run(project: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = spawnSync(process.execPath, [tsx, ...args], { cwd: project, encoding: "utf8", env: cleanEnv(env), maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}` };
}

function ok(project: string, args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = run(project, [cli, ...args], env);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  return result;
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function commit(project: string, message: string): void {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
}

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

function matrix(project: string, stage: string): Json {
  const result = ok(project, ["check", "--sensor", "traceability-matrix", "--module", M01], { AIDLC_ACTIVE_STAGE: stage });
  return JSON.parse(result.stdout) as Json;
}

/**
 * A lightweight-scope workflow (bugfix or refactor) with no requirements.md. The caller
 * supplies the UC-D case files that follow. The module source root is the default `src/`.
 */
function lightProject(name: string, scope: string, source: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [{ module_id: M01, name: "Orders", service_id: "order-service", paths: ["src"] }],
  }));
  write(project, "src/placeholder.py", source);
  const state: WorkflowState = createInitialState(scope, "4.13.1", `workflow-${name}`, [], `MARS-112 ${scope}`);
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  saveWorkflowState(project, state);
  return project;
}

try {
  // -------------------------------------------------------------------------
  // Producer side — bugfix
  // -------------------------------------------------------------------------
  await section("bugfix: a new UC-D with no defect_ref anchor is a broken_row", () => {
    const project = lightProject("bugfix-missing", "bugfix", "# code\ndef fix():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 reproduce the bug\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: BUG-999\ntdd_mode: new\n---\n# UC-D-001\nReproduce the bug.\n");
    commit(project, "fixture");
    // before code-generation: anchor presence is already demanded
    const planning = matrix(project, "tdd");
    assert.equal(planning.status, "passed");
    assert.equal(planning.scope, "bugfix");
    assert.equal(planning.lightweight_anchor, "defect_ref");
    assert.ok(planning.broken_rows.some((row: string) => row.includes("ANCHOR_MISSING@defect_ref")), JSON.stringify(planning.broken_rows));
  });

  await section("bugfix: a new UC-D with a defect_ref referenced in source passes", () => {
    const project = lightProject("bugfix-anchored", "bugfix", "# BUG-123 fix the timeout\ndef fix():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 reproduce BUG-123\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: BUG-123\ntdd_mode: new\ndefect_ref: BUG-123\n---\n# UC-D-001\nReproduce BUG-123.\n");
    commit(project, "fixture");
    const result = matrix(project, "code-generation");
    assert.equal(result.status, "passed");
    assert.deepEqual(result.broken_rows, [], JSON.stringify(result.broken_rows));
    assert.deepEqual(result.anchored_ucds, ["UC-D-001"]);
    assert.deepEqual(result.defect_refs, { "UC-D-001": "BUG-123" });
    assert.equal(result.migration_status, "passed");
  });

  await section("bugfix: a defect_ref the delivered source never references is a broken_row", () => {
    const project = lightProject("bugfix-unref", "bugfix", "# unrelated code\ndef fix():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 reproduce BUG-123\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: BUG-123\ntdd_mode: new\ndefect_ref: BUG-123\n---\n# UC-D-001\nReproduce BUG-123.\n");
    commit(project, "fixture");
    // at code-generation the anchor must be reconciled against the source
    const atGreen = matrix(project, "code-generation");
    assert.ok(atGreen.broken_rows.some((row: string) => row.includes("ANCHOR_UNREFERENCED@code_refs")), JSON.stringify(atGreen.broken_rows));
    // before code-generation the reconciliation does not yet apply (anchor present is enough)
    const atTdd = matrix(project, "tdd");
    assert.deepEqual(atTdd.broken_rows, [], JSON.stringify(atTdd.broken_rows));
  });

  // -------------------------------------------------------------------------
  // Producer side — refactor
  // -------------------------------------------------------------------------
  await section("refactor: no characterization code_refs anchor is a broken_row", () => {
    const project = lightProject("refactor-missing", "refactor", "# code\ndef legacy():\n    return 1\n");
    // A new UC-D only — refactor has no characterization anchor.
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 behaviour\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: legacy\ntdd_mode: new\n---\n# UC-D-001\nSome behaviour.\n");
    commit(project, "fixture");
    const result = matrix(project, "code-generation");
    assert.equal(result.status, "passed");
    assert.equal(result.scope, "refactor");
    assert.equal(result.lightweight_anchor, "code_refs");
    assert.ok(result.broken_rows.some((row: string) => row.includes("ANCHOR_MISSING@code_refs")), JSON.stringify(result.broken_rows));
  });

  await section("refactor: a characterization UC-D with code_refs anchor passes", () => {
    const project = lightProject("refactor-anchored", "refactor", "# code\ndef legacy():\n    return 1\n");
    const blob = git(project, ["hash-object", "src/placeholder.py"]);
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 characterize legacy\n");
    write(project, `${CASES}/UC-D-001.md`, `---\nid: UC-D-001\nstatus: ready\nsource_ref: legacy\ntdd_mode: characterization\ncode_refs: [src/placeholder.py]\nreason: lock in legacy behaviour before refactor\napproval_ref: REVIEW-2026-10-09-01\n---\n# UC-D-001\nCharacterize legacy (${blob.slice(0, 7)}).\n`);
    commit(project, "fixture");
    const result = matrix(project, "code-generation");
    assert.equal(result.status, "passed");
    assert.deepEqual(result.broken_rows, [], JSON.stringify(result.broken_rows));
    assert.deepEqual(result.anchored_ucds, ["UC-D-001"]);
    assert.deepEqual(result.code_refs, ["src/placeholder.py"]);
  });

  // -------------------------------------------------------------------------
  // Producer side — express / workshop (MARS-116: same new-UC-D anchor as bugfix,
  // using the semantically neutral `change_ref` field)
  // -------------------------------------------------------------------------
  for (const scope of ["express", "workshop"]) {
    await section(`${scope}: a new UC-D with no change_ref anchor is a broken_row`, () => {
      const project = lightProject(`${scope}-missing`, scope, "# code\ndef feature():\n    return 1\n");
      write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 micro change\n");
      write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: notes\ntdd_mode: new\n---\n# UC-D-001\nMicro change.\n");
      commit(project, "fixture");
      // before code-generation: anchor presence is already demanded
      const planning = matrix(project, "tdd");
      assert.equal(planning.status, "passed");
      assert.equal(planning.scope, scope);
      assert.equal(planning.lightweight_anchor, "change_ref");
      assert.ok(planning.broken_rows.some((row: string) => row.includes("ANCHOR_MISSING@change_ref")), JSON.stringify(planning.broken_rows));
    });

    await section(`${scope}: a new UC-D with a change_ref referenced in source passes`, () => {
      const project = lightProject(`${scope}-anchored`, scope, "# TASK-42 add the micro feature\ndef feature():\n    return 1\n");
      write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 TASK-42\n");
      write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: TASK-42\ntdd_mode: new\nchange_ref: TASK-42\n---\n# UC-D-001\nImplement TASK-42.\n");
      commit(project, "fixture");
      const result = matrix(project, "code-generation");
      assert.equal(result.status, "passed");
      assert.deepEqual(result.broken_rows, [], JSON.stringify(result.broken_rows));
      assert.deepEqual(result.anchored_ucds, ["UC-D-001"]);
      assert.deepEqual(result.change_refs, { "UC-D-001": "TASK-42" });
      assert.equal(result.migration_status, "passed");
    });

    await section(`${scope}: a change_ref the delivered source never references is a broken_row`, () => {
      const project = lightProject(`${scope}-unref`, scope, "# unrelated code\ndef feature():\n    return 1\n");
      write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 TASK-42\n");
      write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: TASK-42\ntdd_mode: new\nchange_ref: TASK-42\n---\n# UC-D-001\nImplement TASK-42.\n");
      commit(project, "fixture");
      // at code-generation the anchor must be reconciled against the source
      const atGreen = matrix(project, "code-generation");
      assert.ok(atGreen.broken_rows.some((row: string) => row.includes("ANCHOR_UNREFERENCED@code_refs")), JSON.stringify(atGreen.broken_rows));
      // before code-generation the reconciliation does not yet apply (anchor present is enough)
      const atTdd = matrix(project, "tdd");
      assert.deepEqual(atTdd.broken_rows, [], JSON.stringify(atTdd.broken_rows));
    });
  }

  await section("change_ref must be a single clean token in frontmatter (regex escape of . - /)", () => {
    const project = lightProject("express-badref", "express", "# code\ndef feature():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 micro\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: x\ntdd_mode: new\nchange_ref: 'bad token'\n---\n# UC-D-001\nMicro.\n");
    commit(project, "fixture");
    const result = run(project, [cli, "check", "--sensor", "traceability-matrix", "--module", M01], { AIDLC_ACTIVE_STAGE: "code-generation" });
    assert.notEqual(result.status, 0, result.out);
    assert.match(result.out, /change_ref .* is not a valid anchor token/);
  });

  await section("change_ref with regex metacharacters is escaped and matched literally", () => {
    // a valid token containing `.` `-` `/` (DEFECT_REF_PATTERN allows these); the source
    // reconciliation must match it literally, not as a regex.
    const project = lightProject("express-escape", "express", "# implements EXP-1.2/a now\ndef feature():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 EXP\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: x\ntdd_mode: new\nchange_ref: EXP-1.2/a\n---\n# UC-D-001\nExperiment.\n");
    commit(project, "fixture");
    const result = matrix(project, "code-generation");
    assert.equal(result.status, "passed");
    assert.deepEqual(result.broken_rows, [], JSON.stringify(result.broken_rows));
    assert.deepEqual(result.change_refs, { "UC-D-001": "EXP-1.2/a" });
  });

  // -------------------------------------------------------------------------
  // Producer side — other scopes stay not_applicable
  // -------------------------------------------------------------------------
  await section("non-lightweight scope without requirements.md stays not_applicable", () => {
    const project = lightProject("feature-na", "feature", "# code\ndef f():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 something\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: x\ntdd_mode: new\n---\n# UC-D-001\nSomething.\n");
    commit(project, "fixture");
    const result = matrix(project, "code-generation");
    assert.equal(result.status, "not_applicable");
    assert.match(String(result.reason), /requirements\.md not present yet/);
  });

  // -------------------------------------------------------------------------
  // defect_ref contract validation
  // -------------------------------------------------------------------------
  await section("defect_ref must be a single clean token in frontmatter", () => {
    const project = lightProject("bugfix-badref", "bugfix", "# code\ndef fix():\n    return 1\n");
    write(project, `${CASES}/_index.md`, "# UC-D index\n- UC-D-001 bug\n");
    write(project, `${CASES}/UC-D-001.md`, "---\nid: UC-D-001\nstatus: ready\nsource_ref: x\ntdd_mode: new\ndefect_ref: [BUG-1, BUG-2]\n---\n# UC-D-001\nBug.\n");
    commit(project, "fixture");
    const result = run(project, [cli, "check", "--sensor", "traceability-matrix", "--module", M01], { AIDLC_ACTIVE_STAGE: "code-generation" });
    assert.notEqual(result.status, 0, result.out);
    assert.match(result.out, /defect_ref must be a single non-empty token/);
  });

  // -------------------------------------------------------------------------
  // Gate side — the broken anchor is actually rejected end to end
  // -------------------------------------------------------------------------
  // Single-layout fixture (module `project`, unit `default`): the controlled producer
  // stamps real evidence via `evidence run`, and gate_probe evaluates the orchestrator
  // gate against it. No module-manifest, so the module resolves to `project`.
  const PROJECT = "project";
  const PCASES = `docs/aidlc/modules/${PROJECT}/inception/application-design/test-cases`;

  function gateProject(name: string, source: string, ucd: string): string {
    const project = join(scratch, name);
    mkdirSync(project, { recursive: true });
    git(project, ["init", "-q"]);
    write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
      schema_version: 1,
      modules: [{ module_id: PROJECT, name: "Orders", service_id: "order-service", paths: ["src"] }],
    }));
    write(project, "src/placeholder.py", source);
    write(project, `${PCASES}/_index.md`, "# UC-D index\n- UC-D-001 bug\n");
    write(project, `${PCASES}/UC-D-001.md`, ucd);
    const instance = `code-generation@module:${PROJECT}@unit:default`;
    const state: WorkflowState = createInitialState("bugfix", "4.13.1", `workflow-${name}`, [], "MARS-112 gate");
    state.completed_stages = [...GLOBAL_STAGES];
    state.completed_stage_instances = [...GLOBAL_STAGES];
    state.current_stage = "code-generation";
    state.current_phase = "construction";
    state.current_stage_instance = instance;
    state.current_module = PROJECT;
    state.current_unit = "default";
    saveWorkflowState(project, state);
    commit(project, "fixture");
    return project;
  }

  function gateFailures(project: string, instance: string): string[] {
    ok(project, ["evidence", "run", "--stage", "code-generation", "--instance", instance, "--sensor", "traceability-matrix"]);
    const result = run(project, [probe, instance, "sensors", "traceability-matrix"]);
    const value = JSON.parse(result.stdout || result.out) as { failures?: string[]; error?: string };
    assert.ok(!value.error, `gate_probe error: ${value.error}\n${result.out}`);
    return value.failures || [];
  }

  await section("gate: bugfix code-generation rejects a missing defect_ref anchor", () => {
    const instance = `code-generation@module:${PROJECT}@unit:default`;
    const project = gateProject("gate-reject", "# unrelated\ndef fix():\n    return 1\n",
      "---\nid: UC-D-001\nstatus: ready\nsource_ref: BUG-7\ntdd_mode: new\n---\n# UC-D-001\nBug.\n");
    const failures = gateFailures(project, instance);
    assert.ok(failures.some((failure) => failure.includes("ANCHOR_MISSING@defect_ref")), JSON.stringify(failures));
  });

  await section("gate: bugfix code-generation accepts a referenced defect_ref anchor", () => {
    const instance = `code-generation@module:${PROJECT}@unit:default`;
    const project = gateProject("gate-accept", "# BUG-7 fix the timeout\ndef fix():\n    return 1\n",
      "---\nid: UC-D-001\nstatus: ready\nsource_ref: BUG-7\ntdd_mode: new\ndefect_ref: BUG-7\n---\n# UC-D-001\nBug.\n");
    const failures = gateFailures(project, instance);
    assert.deepEqual(failures, [], JSON.stringify(failures));
  });
} finally {
  if (failed.length > 0) {
    console.error(`\n${failed.length} section(s) failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${sections.length} MARS-112 sections passed.`);
}
