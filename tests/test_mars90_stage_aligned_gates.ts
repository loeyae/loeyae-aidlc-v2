/**
 * MARS-90 regression suite: stage-aligned traceability-matrix gates.
 *
 * The C2 cumulative reconciliation of traceabilityMatrix() counted "every CL-xxx of
 * clarifications.md is followed by a story/design" as a hard broken row without any
 * stage guard, so finishing the clarification inside requirements-analysis blocked the
 * stage before user-stories.md could exist. The CL layer now enforces from user-stories
 * on (advisory before), and the "owner module has not delivered the consumed contract"
 * check enforces from application-design on (the consumer's design layer).
 *
 * Everything runs through the public CLI (`evidence run`, `orchestrate report`, `check`);
 * evidence is only produced by the controlled producer.
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
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars90-"));
const sections: string[] = [];
const failed: string[] = [];

const M01 = "m01";
const IN = `docs/aidlc/modules/${M01}/inception`;
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];

type Run = { status: number; stdout: string; out: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ["AIDLC_ACTIVE_MODULE", "AIDLC_ACTIVE_UNIT", "AIDLC_ACTIVE_STAGE", "AIDLC_PHASE", "AIDLC_MODULE"]) delete env[key];
  return env;
}

function run(project: string, args: string[]): Run {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: cleanEnv() });
  const stdout = result.stdout || "";
  return { status: result.status ?? 1, stdout, out: `${stdout}\n${result.stderr || ""}` };
}

function ok(project: string, args: string[]): Run {
  const result = run(project, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.out}`);
  return result;
}

function rejected(project: string, args: string[], pattern: RegExp): string {
  const result = run(project, args);
  assert.notEqual(result.status, 0, `${args.join(" ")} should fail\n${result.out}`);
  assert.match(result.out, pattern, `${args.join(" ")} failed for another reason:\n${result.out.slice(-800)}`);
  return result.out;
}

function matrix(project: string): Json {
  return JSON.parse(ok(project, ["check", "--sensor", "traceability-matrix", "--module", M01]).stdout) as Json;
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

function remove(project: string, path: string): void {
  rmSync(join(project, path), { force: true });
}

function git(project: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function commit(project: string, message: string): void {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
}

function semanticCommands(project: string, stage: string): void {
  write(project, `.aidlc/commands/${stage}.json`, JSON.stringify({
    version: "1",
    stage,
    commands: [{ id: "traceability-matrix", role: "semantic", sensor: "traceability-matrix", argv: ["loeyae-aidlc", "check", "--sensor", "traceability-matrix"] }],
  }));
}

function setCurrent(project: string, stage: string): void {
  const state = loadWorkflowState(project)!;
  state.current_stage = stage;
  state.current_phase = "inception";
  state.current_stage_instance = `${stage}@module:${M01}`;
  state.current_module = M01;
  saveWorkflowState(project, state);
}

/** A migrated module (REQ with track) whose requirements analysis embeds a clarification CL-001. */
function makeProject(name: string, requirementsExtra = ""): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "README.md", "REQ-BASE stage-aligned gate fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [{ module_id: M01, name: "Orders", service_id: "order-service" }] }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 order export belongs to m01.\n");
  write(project, `${IN}/requirements.md`, `# Requirements\n\n## REQ-001 Order export retry\ntrack: [backend]\nThe order export retries on timeout as clarified in CL-001, with enough detail for review.${requirementsExtra}\n`);
  write(project, `${IN}/clarifications.md`, "# Clarifications\n\n## CL-001 Retry policy\nExport retries three times with exponential backoff before failing the job.\n");
  semanticCommands(project, "requirements-analysis");
  semanticCommands(project, "user-stories");
  commit(project, "fixture");
  const state: WorkflowState = createInitialState("feature", "4.9.0", `workflow-${name}`, [], "MARS-90 stage-aligned gates");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`];
  saveWorkflowState(project, state);
  setCurrent(project, "requirements-analysis");
  return project;
}

/** Finish requirements-analysis through the real producer and report gates. */
function completeRequirements(project: string): void {
  setCurrent(project, "requirements-analysis");
  ok(project, ["evidence", "run", "--stage", "requirements-analysis"]);
  ok(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);
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

try {
  await section("CL layer is advisory until user-stories, enforced from user-stories on", () => {
    const project = makeProject("cl-layer");

    // requirements-analysis: CL-001 exists, user-stories.md does not -> visible, not blocking.
    const early = matrix(project);
    assert.equal(early.clarification_cl_total, 1, JSON.stringify(early));
    assert.deepEqual(early.uncovered_cl, ["CL-001"]);
    assert.deepEqual(early.advisory_cl_pending, ["CL-001"]);
    assert.match(String(early.cl_gate), /^not_applicable/);
    assert.deepEqual(early.broken_rows, [], JSON.stringify(early));
    ok(project, ["evidence", "run", "--stage", "requirements-analysis"]);
    ok(project, ["orchestrate", "report", "--stage", "requirements-analysis", "--result", "completed"]);

    // user-stories: the story ignores CL-001 -> both story-traceability and the matrix CL layer block.
    write(project, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Retry export (REQ-001)\n- 来源: REQ-001\n- AC-01 Export succeeds after a transient timeout.\n");
    commit(project, "stories without CL");
    setCurrent(project, "user-stories");
    const late = matrix(project);
    assert.equal(late.cl_gate, "enforced");
    assert.deepEqual(late.advisory_cl_pending, []);
    assert.ok(late.broken_rows.some((row: string) => row.startsWith("CL-001: UNCOVERED_CL@downstream")), JSON.stringify(late));
    ok(project, ["evidence", "run", "--stage", "user-stories"]);
    const blocked = rejected(project, ["orchestrate", "report", "--stage", "user-stories", "--result", "completed"], /UNCOVERED_CL@downstream/);
    assert.match(blocked, /\[story-traceability\][^\n]*CL-001/);

    // The story follows CL-001 -> the user-stories gates pass.
    write(project, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Retry export (REQ-001)\n- 来源: REQ-001, CL-001\n- AC-01 Export succeeds after a transient timeout.\n");
    commit(project, "stories follow CL");
    const fixed = matrix(project);
    assert.deepEqual(fixed.broken_rows, [], JSON.stringify(fixed));
    ok(project, ["evidence", "run", "--stage", "user-stories"]);
    ok(project, ["orchestrate", "report", "--stage", "user-stories", "--result", "completed"]);
  });

  await section("undelivered cross-module contract is advisory before application-design, enforced from it on", () => {
    const project = makeProject("contract-layer", "\nIt consumes CT-OTHER-SVC.");
    write(project, "docs/aidlc/ideation/product-contracts.md", "| 契约 ID | Owner | 消费方 | 状态 |\n|---|---|---|---|\n| CT-OTHER-SVC | other/unit-contracts | m01 | registered |\n");
    write(project, `${IN}/clarifications.md`, "# Clarifications\n\n无澄清项\n");

    const early = matrix(project);
    assert.deepEqual(early.uncovered_contracts, [], JSON.stringify(early));
    assert.ok(early.advisory_contracts_pending.some((item: string) => item.startsWith("CT-OTHER-SVC")), JSON.stringify(early));
    assert.equal(early.contract_status, "passed");
    assert.deepEqual(early.broken_rows, []);

    setCurrent(project, "application-design");
    const late = matrix(project);
    assert.deepEqual(late.advisory_contracts_pending, []);
    assert.equal(late.contract_status, "BROKEN");
    assert.ok(late.broken_rows.some((row: string) => row.startsWith("CT-OTHER-SVC: Owner module other")), JSON.stringify(late));

    // An unregistered contract is decidable from the ideation contracts and stays blocking early.
    setCurrent(project, "requirements-analysis");
    write(project, "docs/aidlc/ideation/product-contracts.md", "| 契约 ID | Owner | 消费方 | 状态 |\n|---|---|---|---|\n");
    const unregistered = matrix(project);
    assert.ok(unregistered.broken_rows.some((row: string) => row.startsWith("CT-OTHER-SVC: 契约未在 product-contracts.md 登记")), JSON.stringify(unregistered));
  });

  await section("MARS-91: multi-module owner delivery only counts the owner's own application-design instance", () => {
    const project = makeProject("contract-owner-multi", "\nIt consumes CT-ORDERSVC-API.");
    write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({ schema_version: 1, modules: [
      { module_id: M01, name: "Orders", service_id: "order-service" },
      { module_id: "order-svc", name: "Order service", service_id: "order-svc" },
    ] }));
    write(project, "docs/aidlc/ideation/product-contracts.md", "| 契约 ID | Owner | 消费方 | 状态 |\n|---|---|---|---|\n| CT-ORDERSVC-API | order-svc/unit-contracts | m01 | registered |\n");
    write(project, `${IN}/clarifications.md`, "# Clarifications\n\n无澄清项\n");
    commit(project, "multi-module contract");

    // A non-owner module (and a bare instance) completed application-design: the owner has not delivered.
    const state = loadWorkflowState(project)!;
    state.completed_stage_instances = [...GLOBAL_STAGES, "application-design", `application-design@module:${M01}`];
    state.completed_stages = [...GLOBAL_STAGES, "application-design"];
    saveWorkflowState(project, state);
    setCurrent(project, "application-design");
    const blocked = matrix(project);
    assert.equal(blocked.contract_status, "BROKEN", JSON.stringify(blocked));
    assert.ok(blocked.broken_rows.some((row: string) => row.startsWith("CT-ORDERSVC-API: Owner module order-svc")), JSON.stringify(blocked));

    // The owner's own instance (hyphenated module id resolved from the manifest) delivers the contract.
    const delivered = loadWorkflowState(project)!;
    delivered.completed_stage_instances = [...delivered.completed_stage_instances, "application-design@module:order-svc"];
    saveWorkflowState(project, delivered);
    const passed = matrix(project);
    assert.equal(passed.contract_status, "passed", JSON.stringify(passed));
    assert.deepEqual(passed.uncovered_contracts, [], JSON.stringify(passed));
  });
  await section("story gate requires every CL covered by some story, not every story to cite a CL", () => {
    // Clear requirement, no clarification at all: stories without any CL pass.
    const clear = makeProject("story-no-clarification");
    remove(clear, `${IN}/clarifications.md`);
    write(clear, `${IN}/requirements.md`, "# Requirements\n\n## REQ-001 Order export\ntrack: [backend]\nThe order export writes a CSV file, with enough detail for review.\n\n## REQ-002 Export audit\ntrack: [backend]\nEvery export is recorded in the audit log, with enough detail for review.\n");
    write(clear, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Export (REQ-001)\n- 来源: REQ-001\n- AC-01 CSV produced.\n\n## STORY-002 Audit (REQ-002)\n- 来源: REQ-002\n- AC-01 Audit row written.\n");
    commit(clear, "clear requirement");
    completeRequirements(clear);
    setCurrent(clear, "user-stories");
    ok(clear, ["evidence", "run", "--stage", "user-stories"]);
    ok(clear, ["orchestrate", "report", "--stage", "user-stories", "--result", "completed"]);

    // CL-001 exists; only one of two stories cites it -> passes (coverage, not per-story).
    const partial = makeProject("story-partial-cl");
    write(partial, `${IN}/requirements.md`, "# Requirements\n\n## REQ-001 Order export retry\ntrack: [backend]\nThe order export retries on timeout, with enough detail for review.\n\n## REQ-002 Export audit\ntrack: [backend]\nEvery export is recorded in the audit log, with enough detail for review.\n");
    write(partial, `${IN}/user-stories.md`, "# User stories\n\n## STORY-001 Retry (REQ-001)\n- 来源: REQ-001 · 澄清: CL-001\n- AC-01 Retries.\n\n## STORY-002 Audit (REQ-002)\n- 来源: REQ-002\n- AC-01 Audit row written.\n");
    commit(partial, "one story follows CL");
    completeRequirements(partial);
    setCurrent(partial, "user-stories");
    ok(partial, ["evidence", "run", "--stage", "user-stories"]);
    ok(partial, ["orchestrate", "report", "--stage", "user-stories", "--result", "completed"]);
  });

  await section("cross-validation requires the UI generation stages (resolved when skipped)", () => {
    const graph = JSON.parse(readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8")) as { stages: Array<{ slug: string; requires: string[] }> };
    const requires = graph.stages.find((stage) => stage.slug === "cross-validation")!.requires;
    for (const dependency of ["user-stories", "ui-mock-generation", "ui-figma-generation"]) assert.ok(requires.includes(dependency), JSON.stringify(requires));
  });
} finally {
  if (process.env.AIDLC_KEEP_TEST_SCRATCH !== "1") rmSync(scratch, { recursive: true, force: true });
}

if (failed.length > 0) {
  console.error(`\n${failed.length} section(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${sections.length} MARS-90 sections passed.`);
