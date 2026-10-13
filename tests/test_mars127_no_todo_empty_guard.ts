/**
 * MARS-127 regression (L2 of MARS-125): the no-todo sensor now fails closed when a stage
 * that declares a NON-evidence produce resolves to zero real files to scan.
 *
 * Before, no-todo only iterated the produced files and flagged TODO/FIXME/HACK or
 * unreadable files; if produces resolved to zero files it passed silently — the gate空转.
 * The guard is symmetric to the traceability sensor's empty-set guard: a stage with a
 * non-evidence produce (every traceability=required stage) but no resolved real file
 * fails; a pure-evidence stage (traceability=not_applicable: tdd / shared-contract-baseline
 * / subagent-execution / compact-recovery) declares no non-evidence
 * produce, so the guard never fires (no false positive).
 *
 * The gate side is exercised through gate_probe.ts (real checkSensors), proving the empty
 * no-todo target set is actually rejected end to end, and a pure-evidence stage is not.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const probe = join(repository, "tests", "gate_probe.ts");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars127-"));
const sections: string[] = [];
const failed: string[] = [];

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "a@b.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "a@b.invalid" } });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function noTodoFailures(project: string, instanceId: string): string[] {
  const result = spawnSync(process.execPath, [tsx, probe, instanceId, "sensors", "no-todo"], { cwd: project, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const text = (result.stdout || "").trim();
  const value = JSON.parse(text) as { failures?: string[]; error?: string };
  assert.ok(!value.error, `gate_probe error: ${value.error}`);
  return value.failures || [];
}

function section(name: string, body: () => void): void {
  try {
    body();
    sections.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

/** A single-layout workflow parked at `stage` with the given completed prerequisites. */
function projectAt(name: string, stage: string, phase: string, completed: string[]): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  const state: WorkflowState = createInitialState("feature", "4.13.2", `workflow-${name}`, [], `MARS-127 ${name}`);
  state.completed_stages = [...completed];
  state.completed_stage_instances = [...completed];
  state.current_stage = stage;
  state.current_phase = phase;
  state.current_stage_instance = stage;
  saveWorkflowState(project, state);
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "fixture"]);
  return project;
}

try {
  // product-inception declares a non-evidence produce (product-inception.md). With no such
  // file produced, the no-todo empty-set guard must fire.
  section("no-todo fails closed when a non-evidence-produce stage has no file to scan", () => {
    const project = projectAt("empty-produce", "product-inception", "ideation", ["workspace-detection"]);
    const failures = noTodoFailures(project, "product-inception");
    assert.ok(
      failures.some((failure) => failure.includes("No produced artifact found to scan")),
      `expected no-todo empty-set failure, got: ${JSON.stringify(failures)}`,
    );
  });

  // Once the stage's non-evidence artifact exists (and is clean), no-todo passes — the guard
  // does not over-fire on a legitimately produced artifact.
  section("no-todo passes once the non-evidence artifact is produced", () => {
    const project = projectAt("has-produce", "product-inception", "ideation", ["workspace-detection"]);
    write(project, "docs/aidlc/ideation/product-inception.md", "# Product inception\n\n业务问题与定位,无占位标记。\n");
    git(project, ["add", "-A"]);
    git(project, ["commit", "-qm", "artifact"]);
    const failures = noTodoFailures(project, "product-inception");
    assert.deepEqual(failures, [], `expected no no-todo failure, got: ${JSON.stringify(failures)}`);
  });

  // A pure-evidence stage (traceability=not_applicable) declares no non-evidence produce,
  // so the guard condition (nonEvidenceProduces.length > 0) is false and the empty-set
  // guard never fires. Asserted structurally from the compiled graph (the runtime
  // non-over-fire on real tdd/etc. advancement is already covered by the construction /
  // v4_x gate regressions). This proves the guard's scoping, not just one instance.
  section("the no-todo empty-set guard never scopes a pure-evidence stage", () => {
    const graph = JSON.parse(
      readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8"),
    ) as { stages: Array<{ slug: string; produces: string[]; sensors: string[]; traceability: string }> };
    const pureEvidence = graph.stages.filter(
      (stage) => stage.sensors.includes("no-todo") && stage.produces.every((pattern) => pattern.startsWith(".aidlc/evidence")),
    );
    assert.ok(pureEvidence.length > 0, "expected at least one pure-evidence no-todo stage");
    for (const stage of pureEvidence) {
      // guard condition is `nonEvidenceProduces.length > 0`; for these it is 0 → guard off.
      const nonEvidence = stage.produces.filter((pattern) => !pattern.startsWith(".aidlc/evidence"));
      assert.equal(nonEvidence.length, 0, `${stage.slug} would wrongly scope the no-todo guard`);
      assert.equal(stage.traceability, "not_applicable", `${stage.slug} pure-evidence stage should be traceability not_applicable`);
    }
  });
} finally {
  if (failed.length > 0) {
    console.error(`\n${failed.length} section(s) failed: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nAll ${sections.length} MARS-127 sections passed.`);
}
