import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, renderLightWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { applyCurrentContext, loadGraph, makeInstance } from "../core/tools/aidlc-orchestrate";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { lightStatePath } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { argvDigest, phaseObservationDigest } from "../core/tools/aidlc-evidence";

// MARS-271 P2 item 8: unit-level parallel state chains. Two units of one module
// advance and report without overwriting each other's gate state; a shared
// baseline worktree warmup removes the per-subtask full checkout.

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars271-p2-"));
const MODULE = "project";

function run(project: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8", env: fixtureEnvironment(project, args) });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_COMMITTER_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" };

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return (result.stdout || "").trim();
}

function makeProject(name: string): string {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "MARS-271 P2 parallel regression project\n", "utf8");
  git(project, ["init", "-q"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "base"]);
  const state = createInitialState("express", "4.22.11", `workflow-${name}`, [], "MARS-271 P2 parallel regression") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveFixtureState(project, state);
  return project;
}

const PHASE_ARGV: Record<"RED" | "GREEN", string[]> = { RED: ["node", "red-observer.js"], GREEN: ["node", "green-observer.js"] };

function envelope(project: string, sensor: string, payload: Record<string, unknown>): Record<string, unknown> {
  const phase = sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : undefined;
  const observedDigest = phase ? argvDigest(PHASE_ARGV[phase as "RED" | "GREEN"]) : undefined;
  return {
    ...payload,
    ...(phase ? { observed_command: { id: `${phase.toLowerCase()}-command`, phase, argv_digest: observedDigest, exit_code: phase === "RED" ? 1 : 0, expected_exit_code: phase === "RED" ? 1 : 0, duration_ms: 1 } } : {}),
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: `test-${sensor}` },
    source_revision: readSourceRevision(project),
    checker: { id: `builtin:${sensor}`, sensor, argv_digest: phase ? phaseObservationDigest(phase, observedDigest!) : "a".repeat(64), exit_code: 0, status: "passed" },
  };
}

function unitInstance(stage: string, unit: string): string {
  return `${stage}@module:${MODULE}@unit:${unit}`;
}

// ---------------------------------------------------------------------------
// 1. applyCurrentContext: a unit records its own chain position when the global
//    current pointer is held by a different unresolved unit
// ---------------------------------------------------------------------------
{
  const graph = loadGraph();
  const stage = graph.stages.find((candidate) => candidate.slug === "code-generation");
  assert.ok(stage);
  const u1 = makeInstance(stage, "unit", { module_id: MODULE, unit_id: "u1" });
  const u2 = makeInstance(stage, "unit", { module_id: MODULE, unit_id: "u2" });
  const base = createInitialState("express", "4.22.11", "workflow-context", [], "ctx") as WorkflowState;

  const held = structuredClone(base);
  held.current_stage = u1.stage.slug;
  held.current_stage_instance = u1.instance_id;
  held.current_module = MODULE;
  held.current_unit = "u1";
  applyCurrentContext(held, u2);
  assert.equal(held.current_stage_instance, u1.instance_id, "u2 advance must not move the global pointer held by u1");
  assert.equal(held.current_unit, "u1");
  assert.deepEqual(held.unit_contexts, { [`${MODULE}:u2`]: { stage: "code-generation", phase: u2.stage.phase, stage_instance: u2.instance_id } }, "u2 advance records its own unit context");

  const free = structuredClone(base);
  applyCurrentContext(free, u2);
  assert.equal(free.current_stage_instance, u2.instance_id, "a free global pointer is written normally");
  assert.equal(free.unit_contexts, undefined, "no unit context when the global pointer moves");

  const resolved = structuredClone(base);
  resolved.completed_stage_instances.push(u1.instance_id);
  resolved.current_stage_instance = u1.instance_id;
  resolved.current_module = MODULE;
  resolved.current_unit = "u1";
  applyCurrentContext(resolved, u2);
  assert.equal(resolved.current_stage_instance, u2.instance_id, "a resolved global holder is replaced, not diverted");

  const reown = structuredClone(base);
  reown.current_stage_instance = u1.instance_id;
  reown.current_module = MODULE;
  reown.current_unit = "u1";
  reown.unit_contexts = { [`${MODULE}:u1`]: { stage: "code-generation", phase: u1.stage.phase, stage_instance: u1.instance_id } };
  applyCurrentContext(reown, u1);
  assert.equal(reown.current_stage_instance, u1.instance_id);
  assert.equal(reown.unit_contexts, undefined, "taking the global pointer clears the unit's own context entry");
}

// ---------------------------------------------------------------------------
// 2. unit_contexts Markdown round-trip and parse validation
// ---------------------------------------------------------------------------
{
  const project = makeProject("context-roundtrip");
  const state = loadWorkflowState(project);
  assert.ok(state);
  state.current_stage = "code-generation";
  state.current_stage_instance = unitInstance("code-generation", "u1");
  state.current_module = MODULE;
  state.current_unit = "u1";
  state.unit_contexts = { [`${MODULE}:u2`]: { stage: "code-generation", phase: "construction", stage_instance: unitInstance("code-generation", "u2") } };
  saveFixtureState(project, state);
  const reloaded = loadWorkflowState(project);
  assert.ok(reloaded);
  assert.deepEqual(reloaded.unit_contexts, state.unit_contexts, "unit contexts survive the Markdown round-trip");
  assert.match(readFileSync(lightStatePath(project), "utf8"), /## Unit Contexts/);

  // A key/instance mismatch must be rejected at parse time.
  const broken = renderLightWorkflowState(state)
    .replace(`| ${MODULE}:u2 | code-generation | construction | ${unitInstance("code-generation", "u2")} |`, `| ${MODULE}:u2 | code-generation | construction | ${unitInstance("code-generation", "u9")} |`);
  writeFileSync(lightStatePath(project), broken, "utf8");
  assert.throws(() => loadWorkflowState(project), /does not match key/);
}

// ---------------------------------------------------------------------------
// 3. bindSession: a claimed current unit instance does not block a parallel
//    unit binding; an unclaimed one still does
// ---------------------------------------------------------------------------
{
  const project = makeProject("bind-parallel");
  const state = loadWorkflowState(project);
  assert.ok(state);
  mkdirSync(join(project, "docs", "aidlc", "modules", MODULE, "inception"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "unit-manifest.json"), JSON.stringify({ schema_version: 1, module_id: MODULE, units: [{ unit_id: "u1", name: "Unit 1", service_id: "service-a", conditional_stages: [] }, { unit_id: "u2", name: "Unit 2", service_id: "service-a", conditional_stages: [] }] }));
  state.completed_stage_instances.push(`units-generation@module:${MODULE}`);
  const u1 = unitInstance("tdd", "u1");
  const u2 = unitInstance("tdd", "u2");
  state.current_stage = "tdd";
  state.current_stage_instance = u1;
  state.current_module = MODULE;
  state.current_unit = "u1";
  saveFixtureState(project, state);
  assert.throws(() => bindSession(project, { instance: u2, owner: "bob", session: "bob-session", expected: claimToken(undefined) }), /another stage is still current/, "an unclaimed current instance still blocks binding");
  bindSession(project, { instance: u1, owner: "alice", session: "alice-session", expected: claimToken(undefined) });
  const bound = bindSession(project, { instance: u2, owner: "bob", session: "bob-session", expected: claimToken(undefined) });
  assert.equal(bound.claim.owner, "bob", "a claimed current unit instance does not block a parallel unit binding");
}

// ---------------------------------------------------------------------------
// 4. interleaved two-unit report: completing u2 leaves u1's gate state untouched
// ---------------------------------------------------------------------------
{
  const project = makeProject("parallel-report");
  const cases = join(project, "docs", "aidlc", "modules", MODULE, "inception", "application-design", "test-cases");
  mkdirSync(cases, { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "unit-manifest.json"), JSON.stringify({ schema_version: 1, module_id: MODULE, units: [{ unit_id: "u1", name: "Unit 1", service_id: "service-a", conditional_stages: [] }, { unit_id: "u2", name: "Unit 2", service_id: "service-a", conditional_stages: [] }] }));
  writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "inception", "requirements.md"), "REQ-1 behavior\n", "utf8");
  writeFileSync(join(cases, "_index.md"), "# UC-D index\n- UC-D-001 | status: ready | source_ref: REQ-1\n", "utf8");
  writeFileSync(join(cases, "UC-D-001.md"), "---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\n---\n# UC-D-001\n", "utf8");
  const i13Path = join(project, ".aidlc", "evidence", "test-case-derivation", MODULE);
  mkdirSync(i13Path, { recursive: true });
  writeFileSync(join(i13Path, "test-case-derivation.json"), JSON.stringify({ status: "required", ucd_total: 1, ready_ucd: 1, ucd_ids: ["UC-D-001"], index: "docs/aidlc/modules/project/inception/application-design/test-cases/_index.md" }), "utf8");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "behavior.ts"), "export const behavior = 'REQ-1 UC-D-001 behavior';\n", "utf8");
  mkdirSync(join(project, ".aidlc", "commands"), { recursive: true });
  writeFileSync(join(project, ".aidlc", "commands", "tdd.json"), JSON.stringify({ version: "1", stage: "tdd", commands: [{ id: "red-command", role: "red", argv: PHASE_ARGV.RED }] }), "utf8");
  writeFileSync(join(project, ".aidlc", "commands", "code-generation.json"), JSON.stringify({ version: "1", stage: "code-generation", commands: [{ id: "green-command", role: "green", argv: PHASE_ARGV.GREEN }] }), "utf8");

  // Per-unit artifacts and evidence: u1 (the global current holder) and u2 (the
  // parallel unit) each carry a full set. Docs files are written first so every
  // evidence envelope records the same final worktree digest.
  for (const unit of ["u1", "u2"]) {
    const plans = join(project, "docs", "aidlc", "modules", MODULE, "construction", unit, "plans");
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(plans, "code-generation-plan.md"), "# Plan\nREQ-1 UC-D-001 validates the target behavior and its deterministic implementation steps.\n", "utf8");
    writeFileSync(join(project, "docs", "aidlc", "modules", MODULE, "construction", unit, "implementation-summary.md"), "# Summary\nREQ-1 UC-D-001 behavior is implemented and verified by the target test command.\n", "utf8");
  }
  for (const unit of ["u1", "u2"]) {
    const redPath = join(project, ".aidlc", "evidence", "tdd", MODULE, unit);
    mkdirSync(redPath, { recursive: true });
    const redPayload = { phase: "RED", status: "failed", failure_class: "behavior", failure_signature: "expected behavior is absent", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 1, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }] };
    writeFileSync(join(redPath, "red-test-evidence.json"), JSON.stringify(envelope(project, "red-test-evidence", redPayload)), "utf8");
    const evidenceRoot = join(project, ".aidlc", "evidence", "code-generation", MODULE, unit);
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(join(evidenceRoot, "green-test-evidence.json"), JSON.stringify(envelope(project, "green-test-evidence", {
      phase: "GREEN", status: "passed", compile_status: "passed", environment_status: "passed", tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
    })), "utf8");
    writeFileSync(join(evidenceRoot, "test-quality.json"), JSON.stringify(envelope(project, "test-quality", {
      status: "passed", red_seen: true, green_seen: true, tests_total: 1, tests_failed: 0, traceability_complete: true, uc_mapping: [{ use_case: "UC-D-001", test_methods: ["behaviorTest"] }],
    })), "utf8");
    writeFileSync(join(evidenceRoot, "traceability-matrix.json"), JSON.stringify(envelope(project, "traceability-matrix", { status: "not_applicable", migration_status: "MIGRATION_REQUIRED", broken_rows: [] })), "utf8");
    writeFileSync(join(evidenceRoot, "structural-invariants.json"), JSON.stringify(envelope(project, "structural-invariants", { status: "not_applicable", skip_reason: "test fixture has no persistence manifest", violations: [] })), "utf8");
  }

  const state = loadWorkflowState(project);
  assert.ok(state);
  state.completed_stage_instances.push(
    "test-case-derivation@module:" + MODULE,
    `units-generation@module:${MODULE}`,
    unitInstance("tdd", "u1"),
    unitInstance("tdd", "u2"),
  );
  state.completed_stages.push("test-case-derivation", "tdd");
  state.current_stage = "code-generation";
  state.current_phase = "construction";
  state.current_stage_instance = unitInstance("code-generation", "u1");
  state.current_module = MODULE;
  state.current_unit = "u1";
  state.unit_contexts = { [`${MODULE}:u2`]: { stage: "code-generation", phase: "construction", stage_instance: unitInstance("code-generation", "u2") } };
  saveFixtureState(project, state);
  const alice = bindSession(project, { instance: unitInstance("code-generation", "u1"), owner: "alice", session: "alice-session", expected: claimToken(undefined) });
  bindSession(project, { instance: unitInstance("code-generation", "u2"), owner: "fixture-owner", session: "fixture-session", expected: claimToken(undefined) });

  const baseline = run(project, ["evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "u2", "--sensor", "baseline-test-evidence"]);
  assert.equal(baseline.status, 0, `${baseline.stdout}\n${baseline.stderr}`);

  // u2 reports its own unit completion while u1 stays current.
  const report = run(project, ["orchestrate", "report", "--stage", "code-generation", "--result", "completed", "--instance", unitInstance("code-generation", "u2")]);
  assert.equal(report.status, 0, `${report.stdout}\n${report.stderr}`);

  const after = loadWorkflowState(project);
  assert.ok(after);
  assert.equal(after.current_stage, "code-generation", "u1 keeps the global stage");
  assert.equal(after.current_stage_instance, unitInstance("code-generation", "u1"), "u2's report does not overwrite u1's current instance");
  assert.equal(after.current_unit, "u1");
  assert.ok(after.completed_stage_instances.includes(unitInstance("code-generation", "u2")), "u2's instance is completed");
  assert.ok(!after.completed_stage_instances.includes(unitInstance("code-generation", "u1")), "u1's instance is not silently completed");
  assert.ok(after.active_instances[unitInstance("code-generation", "u1")], "u1's claim survives u2's report");
  assert.ok(!after.active_instances[unitInstance("code-generation", "u2")], "u2's claim is released by its report");
  assert.equal(after.unit_contexts, undefined, "the completed unit's context is cleared");

  // The u1 session still reports its own unit afterwards (no overwrite in reverse).
  const aliceTdd = bindSession(project, { instance: unitInstance("tdd", "u1"), owner: "alice", session: "alice-session", expected: claimToken(loadWorkflowState(project)!.active_instances[unitInstance("tdd", "u1")]) });
  const aliceTddEnv = { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(aliceTdd.binding) };
  const baselineU1 = spawnSync(process.execPath, [tsx, cli, "evidence", "run", "--stage", "tdd", "--module", MODULE, "--unit", "u1", "--sensor", "baseline-test-evidence"], { cwd: project, encoding: "utf8", env: aliceTddEnv });
  assert.equal(baselineU1.status, 0, `${baselineU1.stdout}\n${baselineU1.stderr}`);
  const u1Env = { ...process.env, AIDLC_SESSION_BINDING: JSON.stringify(alice.binding) };
  const reportU1 = spawnSync(process.execPath, [tsx, cli, "orchestrate", "report", "--stage", "code-generation", "--result", "completed", "--instance", unitInstance("code-generation", "u1")], { cwd: project, encoding: "utf8", env: u1Env });
  assert.equal(reportU1.status, 0, `${reportU1.stdout}\n${reportU1.stderr}`);
  const final = loadWorkflowState(project);
  assert.ok(final);
  assert.ok(final.completed_stage_instances.includes(unitInstance("code-generation", "u1")));
  assert.ok(final.completed_stage_instances.includes(unitInstance("code-generation", "u2")));
  assert.equal(final.current_stage, "", "both units done clears the active context");
}

// ---------------------------------------------------------------------------
// 5. shared baseline worktree warmup: prepare hard-links the warm cache instead
//    of a full checkout, for every parallel unit
// ---------------------------------------------------------------------------
{
  const root = join(scratch, "warm");
  const project = join(root, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "user.email", "aidlc@example.invalid"]);
  git(project, ["config", "user.name", "AI-DLC"]);
  for (let index = 0; index < 40; index++) writeFileSync(join(project, "src", `file${index}.ts`), `export const value${index} = ${index};\n`);
  git(project, ["add", "src"]);
  git(project, ["commit", "-qm", "base"]);
  const warmRun = (args: string[]): Record<string, unknown> => {
    const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout as string) as Record<string, unknown>;
  };

  const state = createInitialState("feature", "4.22.11", "workflow-warm", [], "warm") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  saveFixtureState(project, state);
  mkdirSync(join(project, "docs", "aidlc", "ideation"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), JSON.stringify({ schema_version: 1, modules: [{ module_id: "module-a", name: "Module A", service_id: "service-a" }] }));
  mkdirSync(join(project, "docs", "aidlc", "modules", "module-a", "inception"), { recursive: true });
  writeFileSync(join(project, "docs", "aidlc", "modules", "module-a", "inception", "unit-manifest.json"), JSON.stringify({ schema_version: 1, module_id: "module-a", units: [{ unit_id: "unit-a", name: "Unit A", service_id: "service-a", conditional_stages: [] }, { unit_id: "unit-b", name: "Unit B", service_id: "service-a", conditional_stages: [] }] }));
  git(project, ["add", "docs"]);
  git(project, ["commit", "-qm", "units"]);
  const warmed = warmRun(["worktree", "warmup"]);
  assert.equal(warmed.reused, false, "the first warmup checks out the baseline once");
  assert.equal(warmed.files, 42, "the warm cache covers every baseline file");
  const again = warmRun(["worktree", "warmup"]);
  assert.equal(again.reused, true, "a second warmup at the same commit reuses the cache");
  const selectA = spawnSync(process.execPath, [tsx, cli, "unit", "select", "--module", "module-a", "--unit", "unit-a", "--member", "alice", "--branch", "feat/unit-a"], { cwd: project, encoding: "utf8" });
  assert.equal(selectA.status, 0, `${selectA.stdout}\n${selectA.stderr}`);
  const selectB = spawnSync(process.execPath, [tsx, cli, "unit", "select", "--module", "module-a", "--unit", "unit-b", "--member", "bob", "--branch", "feat/unit-b"], { cwd: project, encoding: "utf8" });
  assert.equal(selectB.status, 0, `${selectB.stdout}\n${selectB.stderr}`);

  for (const [unit, member] of [["unit-a", "alice"], ["unit-b", "bob"]] as const) {
    const target = join(root, `worker-${unit}`);
    const prepared = warmRun(["worktree", "prepare", "--instance", `code-generation@module:module-a@unit:${unit}`, "--member", member, "--path", target]);
    assert.equal(prepared.warm_reused, true, `${unit} prepare must reuse the warm cache`);
    const porcelain = git(target, ["status", "--porcelain"]);
    assert.ok(porcelain === "" || porcelain === "?? .aidlc/", `${unit} warm-linked worktree is clean apart from the local metadata copy: ${porcelain}`);
    assert.equal(readFileSync(join(target, "src", "file7.ts"), "utf8"), "export const value7 = 7;\n", `${unit} file content matches the baseline`);
    git(project, ["worktree", "remove", "--force", target]);
    git(project, ["branch", "-D", String(prepared.branch)]);
  }
}

console.log("MARS-271 P2 unit-parallel chain tests passed");
rmSync(scratch, { recursive: true, force: true });
