import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { ownerOfInstance } from "../core/tools/aidlc-workflow-layout";
import { saveFixtureState } from "./mars243_fixture_session";
import { fixture, git, snapshot } from "./mars244_fixture";

const repository = resolve(import.meta.dirname, ".."), tsx = join(repository, "node_modules/tsx/dist/cli.mjs");
const graph = JSON.parse(readFileSync(join(repository, "core/tools/data/stage-graph.json"), "utf8"));
function run(root: string, binding: string, args: string[], ok = true, extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsx, join(repository, "bin/cli.ts"), "orchestrate", ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, ...extra, AIDLC_SESSION_BINDING: binding },
  });
  assert.equal(result.status === 0, ok, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
function project(scope = "express") {
  const root = mkdtempSync(join(tmpdir(), "aidlc-human-handoff-"));
  writeFileSync(join(root, "README.md"), "Human handoff integration fixture\n");
  git(root, "init", "-q"); git(root, "add", "README.md"); git(root, "commit", "-qm", "fixture");
  const state = createInitialState(scope, "4.26.1", undefined, [], "Continue the exact checkout task");
  state.current_stage = "workspace-detection"; state.current_stage_instance = "workspace-detection";
  saveFixtureState(root, state);
  const binding = JSON.stringify(bindSession(root, { instance: "workspace-detection", owner: "fixture", session: "human-handoff", expected: claimToken(undefined) }).binding);
  return { root, binding };
}
const completion = ["report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"];
const f = project();
const beforeRejected = snapshot(f.root, "aidlc");
const rejected = run(f.root, f.binding, ["report", "--stage", "workspace-detection", "--result", "completed"], false);
assert.equal(rejected.kind, "error"); assert.equal(rejected.next_stage_prompt, undefined);
assert.deepEqual(snapshot(f.root, "aidlc"), beforeRejected, "failed reports do not manufacture completion or handoff state");
for (const result of ["rejected", "revised"]) {
  const response = run(f.root, f.binding, ["report", "--stage", "workspace-detection", "--result", result]);
  assert.equal(response.next_stage_prompt, undefined, "review feedback is not stage completion");
}
const completed = run(f.root, f.binding, completion);
assert.match(completed.handoff_prompt, /^BOSS，/);
assert.equal(completed.handoff_status, "updated");
assert.equal(completed.next_stage_status, "planned");
assert.equal(completed.next_stage.stage_instance, "state-template");
assert.match(completed.next_stage_prompt, /^使用 AI-DLC/);
assert.match(completed.next_stage_prompt, /上一阶段：.*workspace-detection.*已完成/);
assert.match(completed.next_stage_prompt, /Continue the exact checkout task/);
assert.match(completed.next_stage_prompt, /下一阶段：.*state-template/);
assert.match(completed.next_stage_prompt, /输入：.*\n产物：.*\n验收：/);
assert.match(completed.next_stage_prompt, /inspect\/bind.*AIDLC_SESSION_BINDING/);
assert.match(completed.next_stage_prompt, /不代表准入已通过/);
assert(!completed.next_stage_prompt.includes(JSON.parse(f.binding).generation), "handoffs never copy an old claim generation");
const after = loadWorkflowState(f.root)!;
assert(after.completed_stage_instances.includes("workspace-detection"));
assert(!after.completed_stage_instances.includes("state-template"));
assert(!after.active_instances["state-template"], "planning does not claim or enter the next instance");
assert.notEqual(after.current_stage, "state-template");
const beforePreview = snapshot(f.root);
const preview = run(f.root, f.binding, ["next", "--preview"]);
assert.equal(preview.next_stage.stage_instance, completed.next_stage.stage_instance);
assert.deepEqual(snapshot(f.root), beforePreview, "copyable preview is read-only");
const rebound = JSON.stringify(bindSession(f.root, { instance: "workspace-detection", owner: "fixture", session: "re-attest-handoff", expected: claimToken(undefined) }).binding);
const progressBeforeReattest = loadWorkflowState(f.root)!.completed_stage_instances;
const reattested = run(f.root, rebound, [...completion, "--instance", "workspace-detection"]);
assert.equal(reattested.reattested, true);
assert.match(reattested.handoff_prompt, /^BOSS，.*复验通过/);
assert.equal(reattested.next_stage.stage_instance, "state-template");
assert.deepEqual(loadWorkflowState(f.root)!.completed_stage_instances, progressBeforeReattest);
console.log("PASS successful reports return exact copyable next tasks; failed/rejected/revised reports do not; preview never advances or claims");

// A project claim in a single workflow must not hide the following module stage.
const moduleStage = project();
mkdirSync(join(moduleStage.root, "docs/aidlc/ideation"), { recursive: true });
writeFileSync(join(moduleStage.root, "docs/aidlc/ideation/module-manifest.json"), JSON.stringify({ schema_version: 1, modules: [{ module_id: "shop", name: "Shop", service_id: "shop" }] }));
const moduleState = loadWorkflowState(moduleStage.root)!;
const firstModule = graph.stages.findIndex((stage: any) => stage.axis === "module");
moduleState.completed_stage_instances = graph.stages.slice(0, firstModule).map((stage: any) => stage.slug);
moduleState.completed_stages = ["module-division"];
saveFixtureState(moduleStage.root, moduleState);
const modulePreview = run(moduleStage.root, moduleStage.binding, ["next", "--preview"]);
assert.equal(modulePreview.next_stage.module_id, "shop");
assert.equal(modulePreview.next_stage.unit_id, null);
console.log("PASS a single-layout project-to-module handoff follows the real route instead of ending at the old project claim");

function unitPreview(mode: "planned" | "blocked" | "none") {
  const unit = fixture("tdd@module:shop@unit:api");
  const targetIndex = graph.stages.findIndex((stage: any) => stage.slug === (mode === "blocked" ? "tdd" : "code-generation"));
  unit.state.completed_stages = ["module-division"];
  unit.state.completed_stage_instances = graph.stages.flatMap((stage: any, index: number) => stage.axis === "project" ? [stage.slug]
    : stage.axis === "module" ? (mode === "blocked" && stage.slug === "test-case-derivation" ? [] : [`${stage.slug}@module:shop`, `${stage.slug}@module:other`])
    : mode === "none" || index < targetIndex ? [`${stage.slug}@module:shop@unit:api`] : []).filter((id: string) => id !== "units-generation@module:other");
  unit.persist();
  const binding = JSON.stringify(bindSession(unit.root, { instance: "tdd@module:shop@unit:api", owner: "fixture", session: `unit-${mode}`, expected: claimToken(undefined) }).binding);
  const before = snapshot(unit.root);
  const response = run(unit.root, binding, ["next", "--module", "shop", "--unit", "api", "--preview"]);
  assert.deepEqual(snapshot(unit.root), before);
  assert.equal(response.next_stage_status, mode);
  if (mode === "none") {
    assert.equal(response.next_stage, null);
    assert.match(response.handoff_prompt, /当前范围（global \/ module:shop \/ unit:api）没有下一候选阶段/);
    assert.match(response.handoff_prompt, /module:shop \/ unit:web/);
    assert.match(response.handoff_prompt, /module:other/);
    assert.match(response.next_stage_prompt, /loeyae-aidlc runtime summary/);
    assert.match(response.next_stage_prompt, /status、dependency_waiting 与 owner/);
    assert.match(response.next_stage_prompt, /module inspect --stage-instance <目标实例>/);
    assert(!response.next_stage_prompt.includes("next --module shop --unit api --preview"), "exhausted handoffs must not loop over the same unit");
    assert.match(response.next_stage_prompt, /不要据此宣称整个项目已经完成/);
    const exhausted = run(unit.root, binding, ["next"]);
    assert.equal(exhausted.execution_status, "scope-exhausted");
    assert.equal(exhausted.workflow_completed, false);
    assert.equal(loadWorkflowState(unit.root)!.status, "running");
    assert.deepEqual(snapshot(unit.root), before, "single-layout unit exhaustion cannot finish or rewrite the workflow");
  } else {
    assert.equal(response.next_stage.module_id, "shop"); assert.equal(response.next_stage.unit_id, "api");
    assert.match(response.next_stage_prompt, /--module shop --unit api --preview/);
    if (mode === "blocked") assert.match(response.next_stage_prompt, /当前阻断：.*test-case-derivation/);
    else assert.equal(response.next_stage.stage, "code-generation");
  }
}
for (const mode of ["planned", "blocked", "none"] as const) unitPreview(mode);
console.log("PASS unit handoffs preserve exact module/unit; blockers and exhausted chains never route into sibling work");

// A terminal route needs delivery verification, not an endless next-preview loop.
const terminal = project();
const terminalState = loadWorkflowState(terminal.root)!;
terminalState.completed_stage_instances = graph.stages.filter((stage: any) => stage.scopes.includes("express")).map((stage: any) => stage.axis === "project" ? stage.slug
  : `${stage.slug}@module:project${stage.axis === "unit" ? "@unit:default" : ""}`);
saveFixtureState(terminal.root, terminalState);
const terminalBefore = snapshot(terminal.root);
const terminalPreview = run(terminal.root, terminal.binding, ["next", "--preview"]);
assert.equal(terminalPreview.next_stage_status, "none");
assert.equal(terminalPreview.next_stage, null);
assert.match(terminalPreview.handoff_prompt, /项目路由中的阶段均已记录完成或跳过/);
assert.match(terminalPreview.next_stage_prompt, /loeyae-aidlc orchestrate state summary/);
assert.match(terminalPreview.next_stage_prompt, /阶段记录不等于验收已通过/);
assert(!terminalPreview.next_stage_prompt.includes("next --preview"));
assert.deepEqual(snapshot(terminal.root), terminalBefore);
console.log("PASS terminal handoffs request delivery verification without repeating completed stages or claiming acceptance");

// Split layouts must include sibling modules and integration in the scope handoff.
const splitExhausted = fixture("code-review@module:shop@unit:api", true);
const splitGlobal = loadWorkflowState(splitExhausted.root)!;
splitGlobal.completed_stage_instances = graph.stages.filter((stage: any) => stage.axis === "project" && ownerOfInstance(stage.slug).kind === "global").map((stage: any) => stage.slug);
splitGlobal.completed_stages = ["module-division"];
saveFixtureState(splitExhausted.root, splitGlobal);
splitExhausted.state.completed_stage_instances = graph.stages.flatMap((stage: any) => stage.axis === "module" ? [`${stage.slug}@module:shop`]
  : stage.axis === "unit" ? [`${stage.slug}@module:shop@unit:api`] : []);
splitExhausted.persist();
const siblingBinding = bindSession(splitExhausted.root, { instance: "tdd@module:shop@unit:web", owner: "other-member", session: "sibling-owner", expected: claimToken(undefined) });
const exhaustedBinding = JSON.stringify(bindSession(splitExhausted.root, { instance: "code-review@module:shop@unit:api", owner: "fixture", session: "split-exhausted", expected: claimToken(undefined) }).binding);
const splitBefore = snapshot(splitExhausted.root);
const splitPreview = run(splitExhausted.root, exhaustedBinding, ["next", "--module", "shop", "--unit", "api", "--preview"]);
assert.equal(splitPreview.next_stage_status, "none");
assert.equal(splitPreview.next_stage, null);
assert.match(splitPreview.handoff_prompt, /module:shop \/ unit:web/);
assert.match(splitPreview.handoff_prompt, /module:other/);
assert.match(splitPreview.handoff_prompt, /integration/);
assert(!splitPreview.next_stage_prompt.includes("next --module shop --unit api --preview"));
assert.deepEqual(snapshot(splitExhausted.root), splitBefore);
assert.equal(loadWorkflowState(splitExhausted.root, { kind: "module", module_id: "shop" })!.active_instances[siblingBinding.claim.stage_instance].generation, siblingBinding.claim.generation);
console.log("PASS split exhausted handoffs identify sibling and integration work without changing claims or workflow state");

const splitActual = run(splitExhausted.root, exhaustedBinding, ["next", "--module", "shop", "--unit", "api"]);
assert.equal(splitActual.execution_status, "scope-exhausted");
assert.equal(splitActual.workflow_completed, false);
assert.equal(splitActual.handoff_prompt, splitPreview.handoff_prompt);
const workflowFiles = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith("aidlc/")));
assert.deepEqual(workflowFiles(snapshot(splitExhausted.root)), workflowFiles(splitBefore), "formal next preserves all claims and workflow state at a unit boundary");
assert.equal(loadWorkflowState(splitExhausted.root, { kind: "module", module_id: "shop" })!.status, "running");

// Finishing every owned instance may close this module, while its siblings and
// integration remain explicitly pending in the same completion handoff.
const completeState = loadWorkflowState(splitExhausted.root, { kind: "module", module_id: "shop" })!;
completeState.completed_stage_instances.push(...graph.stages.filter((stage: any) => stage.axis === "unit").map((stage: any) => `${stage.slug}@module:shop@unit:web`));
splitExhausted.persist(completeState);
const otherBefore = snapshot(splitExhausted.root, "aidlc/active/modules/other");
const trulyDone = run(splitExhausted.root, exhaustedBinding, ["next", "--module", "shop", "--unit", "api"]);
assert.equal(trulyDone.kind, "done");
assert.equal(trulyDone.workflow_completed, true);
assert.equal(loadWorkflowState(splitExhausted.root, { kind: "module", module_id: "shop" })!.status, "done");
assert.match(trulyDone.handoff_prompt, /module:other/);
assert.match(trulyDone.handoff_prompt, /integration/);
assert.match(trulyDone.next_stage_prompt, /工作流状态：done/);
assert.deepEqual(snapshot(splitExhausted.root, "aidlc/active/modules/other"), otherBefore);
const inconsistentDone = loadWorkflowState(splitExhausted.root, { kind: "module", module_id: "shop" })!;
inconsistentDone.completed_stage_instances = inconsistentDone.completed_stage_instances.filter(id => id !== "code-generation@module:shop@unit:web");
splitExhausted.persist(inconsistentDone);
const inconsistentBefore = workflowFiles(snapshot(splitExhausted.root));
const inconsistent = run(splitExhausted.root, exhaustedBinding, ["next", "--module", "shop", "--unit", "api"], false);
assert.equal(inconsistent.workflow_completed, false);
assert.match(inconsistent.message, /WORKFLOW_COMPLETION_MISMATCH/);
assert.deepEqual(workflowFiles(snapshot(splitExhausted.root)), inconsistentBefore, "an inconsistent historical done record is diagnosed without silently rewriting it");
console.log("PASS formal next distinguishes exhausted units from resolved workflows and preserves pending project work");

const architecture = fixture("application-design@module:shop", true);
const architectureIndex = graph.stages.findIndex((stage: any) => stage.slug === "application-design");
architecture.state.completed_stage_instances = graph.stages.slice(0, architectureIndex).flatMap((stage: any) => stage.axis === "project" ? [stage.slug] : [`${stage.slug}@module:shop`]);
architecture.persist();
writeFileSync(join(architecture.root, architecture.base, "requirements.md"), "# Requirements\nREQ-001 新接口需要定义边界与应用服务。\n");
const architectureBinding = JSON.stringify(bindSession(architecture.root, { instance: "application-design@module:shop", owner: "fixture", session: "architecture-handoff", expected: claimToken(undefined) }).binding);
const architecturePreview = run(architecture.root, architectureBinding, ["next", "--module", "shop", "--preview"]);
assert.equal(architecturePreview.next_stage.stage, "application-design");
assert.equal(architecturePreview.next_stage.approval, "block");
assert.match(architecturePreview.next_stage_prompt, /取得 BOSS 明确审批/);
assert(!architecturePreview.next_stage_prompt.includes("--user-input Approve"), "copyable advice cannot fabricate approval");
const unapproved = run(architecture.root, architectureBinding, ["report", "--module", "shop", "--stage", "application-design", "--result", "completed"], false);
assert.equal(unapproved.next_stage_prompt, undefined);
console.log("PASS split-module architecture prompts preserve real approval gates and never fabricate a successful report");

const fault = project(), preload = join(fault.root, "handoff-fault.cjs");
writeFileSync(preload, `const fs = require('node:fs'); const original = fs.readFileSync;
fs.readFileSync = function(...args) { const value = original.apply(this, args); if (String(args[0]).endsWith('aidlc-state.md') && /^- Current Stage: -$/m.test(String(value))) throw new Error('HANDOFF_PREVIEW_FAILURE'); return value; };
require('node:module').syncBuiltinESMExports();\n`);
const committed = run(fault.root, fault.binding, completion, true, { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(preload.replace(/\\/g, "/"))}`.trim() });
assert.equal(committed.handoff_status, "unverified");
assert.equal(committed.next_stage_status, "unavailable");
assert.equal(committed.next_stage, null);
assert.match(committed.handoff_error, /HANDOFF_PREVIEW_FAILURE/);
assert.match(committed.next_stage_prompt, /不要|不凭本提示词/);
assert(loadWorkflowState(fault.root)!.completed_stage_instances.includes("workspace-detection"), "preview failure cannot undo committed completion or turn it into a failed report");
console.log("PASS post-commit preview failure returns a recovery prompt while preserving the successful completion");
