import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { buildStagePlan } from "../core/tools/aidlc-stage-plan";
import { getExecutableStages, loadGraph } from "../core/tools/aidlc-orchestrate";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { relativeStatePath, saveRegistry } from "../core/tools/aidlc-workflow-layout";

const REPOSITORY = resolve(import.meta.dirname, "..");
const CLI = join(REPOSITORY, "bin", "cli.ts");
const TSX = join(REPOSITORY, "node_modules", "tsx", "dist", "cli.mjs");
const AT = "2026-10-14T09:30:00.000Z";
const graph = loadGraph();

const lightweight = applyExecutionProfile({
  classified: classifyExecutionProfile({ scope: "bugfix" }),
  at: AT,
});
const standard = applyExecutionProfile({
  classified: classifyExecutionProfile({ scope: "feature" }),
  at: AT,
});
const complex = applyExecutionProfile({
  classified: classifyExecutionProfile({
    scope: "feature",
    signals: new Set(["security_or_sensitive_data"]),
  }),
  at: AT,
});

const lightPlan = buildStagePlan(graph, { scope: "bugfix", executionProfile: lightweight });
const standardPlan = buildStagePlan(graph, { scope: "feature", executionProfile: standard });
const complexPlan = buildStagePlan(graph, { scope: "feature", executionProfile: complex });
const legacyPlan = buildStagePlan(graph, { scope: "bugfix" });

for (const plan of [lightPlan, standardPlan, complexPlan, legacyPlan]) {
  assert.equal(plan.advisory, true);
  assert.equal(plan.selection_policy, "profile_aware_graph_semantics");
  assert.equal(plan.selected.length + plan.skipped.length, graph.stages.length);
  assert.ok(plan.required.every((stage) => stage.disposition === "selected" && stage.required));
  assert.ok(plan.selected.every((stage) => stage.disposition === "selected"));
  assert.ok(plan.skipped.every((stage) => stage.disposition === "skipped"));
}

assert.equal(lightPlan.profile.level, "lightweight");
assert.equal(standardPlan.profile.level, "standard");
assert.equal(complexPlan.profile.level, "complex");
assert.deepEqual(complexPlan.profile.active_risks, ["security_or_sensitive_data"]);
assert.deepEqual(legacyPlan.profile, {
  level: "standard",
  provenance: "legacy_standard_default",
  source: "legacy_conservative",
  primary_reason: "legacy_conservative",
  active_risks: [],
});
assert.ok(lightPlan.required.every((stage) => stage.reason === "required_by_graph"));
assert.ok(lightPlan.skipped.some((stage) => stage.reason === "scope_not_applicable"));
assert.deepEqual(
  buildStagePlan(graph, { scope: "bugfix", executionProfile: lightweight }),
  lightPlan,
  "StagePlan must be deterministic",
);

// The StagePlan must remain a pure projection of the current selector. Cover
// standard-profile parity and the user-optional PRD selection explicitly.
for (const [scope, optional] of [
  ["bugfix", []],
  ["feature", []],
  ["feature", ["prd-generation"]],
] as const) {
  const plan = buildStagePlan(graph, {
    scope,
    selectedOptionalStages: optional,
    executionProfile: standard,
  });
  assert.deepEqual(
    plan.selected.map((stage) => stage.slug),
    getExecutableStages(graph, scope, [...optional]).map((stage) => stage.slug),
    `StagePlan selection must exactly match getExecutableStages for ${scope}/${optional.join(",") || "none"}`,
  );
}

function git(project: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC",
      GIT_AUTHOR_EMAIL: "aidlc@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC",
      GIT_COMMITTER_EMAIL: "aidlc@example.invalid",
    },
  });
  assert.equal(result.error, undefined, `git ${args.join(" ")} failed to spawn: ${result.error?.message ?? "unknown error"}`);
  assert.equal(result.status, 0, result.stderr);
}

function run(project: string, args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, `${args.join(" ")} failed to spawn: ${result.error?.message ?? "unknown error"}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function runFailure(project: string, args: string[]): string {
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(result.error, undefined, `${args.join(" ")} failed to spawn: ${result.error?.message ?? "unknown error"}`);
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-stage-plan-"));
try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "fixture\n");
  git(project, ["init", "-q"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "fixture"]);
  run(project, ["next", "--scope", "bugfix", "--work", "Stage plan fixture"]);
  const response = run(project, ["state", "plan"]);
  assert.equal(response.kind, "print");
  const plan = response.stage_plan as {
    advisory: boolean;
    profile: { level: string; provenance: string };
  };
  assert.equal(plan.advisory, true);
  assert.equal(plan.profile.level, "lightweight");
  assert.equal(plan.profile.provenance, "persisted_execution_profile");
  assert.match(runFailure(project, ["state", "plan", "--module", "missing-module"]), /requires the split workflow layout/);

  // Persisted legacy state remains unwritten, while the advisory plan reports
  // the conservative standard default with explicit provenance.
  const legacy = join(root, "legacy");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, "README.md"), "legacy fixture\n");
  git(legacy, ["init", "-q"]);
  git(legacy, ["add", "README.md"]);
  git(legacy, ["commit", "-qm", "fixture"]);
  saveWorkflowState(legacy, createInitialState("bugfix", "4.14.1", "legacy-stage-plan", [], "Legacy plan"));
  const legacyResponse = run(legacy, ["state", "plan"]);
  const legacyCliPlan = legacyResponse.stage_plan as { profile: { level: string; provenance: string } };
  assert.equal(legacyCliPlan.profile.level, "standard");
  assert.equal(legacyCliPlan.profile.provenance, "legacy_standard_default");

  // Build the minimum valid split layout directly: plan must target its module,
  // while an unknown module must be rejected rather than silently returning
  // the global view.
  const split = join(root, "split");
  mkdirSync(split, { recursive: true });
  writeFileSync(join(split, "README.md"), "split fixture\n");
  git(split, ["init", "-q"]);
  git(split, ["add", "README.md"]);
  git(split, ["commit", "-qm", "fixture"]);
  const global = {
    ...createInitialState("feature", "4.14.1", "split-global", [], "Split plan"),
    workflow_kind: "global" as const,
    execution_profile: standard,
  };
  const module = {
    ...createInitialState("feature", "4.14.1", "split-module", [], "Split plan"),
    workflow_kind: "module" as const,
    module_id: "module-a",
    parent_workflow_id: global.workflow_id,
  };
  const integration = {
    ...createInitialState("feature", "4.14.1", "split-integration", [], "Split plan"),
    workflow_kind: "integration" as const,
    parent_workflow_id: global.workflow_id,
  };
  saveWorkflowState(split, global);
  saveWorkflowState(split, module, { kind: "module", module_id: "module-a" });
  saveWorkflowState(split, integration, { kind: "integration" });
  saveRegistry(split, {
    version: "1",
    global_workflow_id: global.workflow_id,
    split_from_workflow_id: global.workflow_id,
    split_at: AT,
    updated_at: AT,
    modules: [{
      module_id: "module-a",
      workflow_id: module.workflow_id,
      state_path: relativeStatePath(split, { kind: "module", module_id: "module-a" }),
      status: module.status,
      current_stage: "-",
      inception_done: false,
      construction_done: false,
      owner: "-",
    }],
    integration: {
      workflow_id: integration.workflow_id,
      state_path: relativeStatePath(split, { kind: "integration" }),
      status: integration.status,
      current_stage: "-",
      barrier_ready: false,
      blocking: [],
    },
    shared_contracts: [],
    cross_module_requires: [],
  });
  const moduleResponse = run(split, ["state", "plan", "--module", "module-a"]);
  assert.equal((moduleResponse.stage_plan as { profile: { level: string } }).profile.level, "standard");
  assert.match(runFailure(split, ["state", "plan", "--module", "missing-module"]), /module missing-module has no workflow state/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("execution profile phase-2 StagePlan tests passed");
