import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { advance, loadGraph, type StageGraph, type StageNode } from "../core/tools/aidlc-orchestrate";
import { buildRuleLoadPlan } from "../core/tools/aidlc-rule-load-plan";
import { createInitialState, saveWorkflowState, bindingFor, type WorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment } from "./mars243_fixture_session";

function authorizeFixture(state: WorkflowState, instance: string): void {
  const now = new Date().toISOString();
  const claim = { module_id: "global", stage_instance: instance, owner: "fixture", session_id: "fixture", generation: "fixture", claimed_at: now, heartbeat_at: now, expires_at: new Date(Date.now() + 600000).toISOString() };
  state.active_instances[instance] = claim;
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(bindingFor(process.cwd(), state, claim));
}

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
  classified: classifyExecutionProfile({ scope: "bugfix", requested_level: "standard" }),
  at: AT,
});
const complex = applyExecutionProfile({
  classified: classifyExecutionProfile({
    scope: "bugfix",
    signals: new Set(["security_or_sensitive_data"]),
  }),
  at: AT,
});

const names = (plan: ReturnType<typeof buildRuleLoadPlan>): string[] => plan.selected.map((entry) => entry.slug);
const files = (plan: ReturnType<typeof buildRuleLoadPlan>): string[] => plan.selected.map((entry) => entry.stage_file);

const legacy = buildRuleLoadPlan(graph, { scope: "bugfix" });
const standardPlan = buildRuleLoadPlan(graph, { scope: "bugfix", executionProfile: standard });
const complexPlan = buildRuleLoadPlan(graph, { scope: "bugfix", executionProfile: complex });
const lightPlan = buildRuleLoadPlan(graph, {
  scope: "bugfix",
  executionProfile: lightweight,
  targetStageSlug: "test-case-derivation",
});

assert.equal(legacy.profile.provenance, "legacy_standard_default");
assert.deepEqual(names(standardPlan), names(legacy), "standard preserves legacy complete rule selection");
assert.deepEqual(names(complexPlan), names(legacy), "complex preserves legacy complete rule selection");
assert.deepEqual(
  names(legacy).filter((slug) => !names(lightPlan).includes(slug)),
  ["state-template"],
  "lightweight reduces rule context only for the Phase-3-safe omitted stage",
);
assert.equal(files(lightPlan).includes("core/stages/inception/inception-state-template.md"), false);

assert.deepEqual(
  lightPlan.load_now.map((entry) => entry.slug),
  ["workspace-detection", "test-case-derivation"],
  "current stage hand-off loads its selected dependency closure in graph order",
);
for (const entry of lightPlan.selected.filter((entry) => entry.mandatory)) {
  assert.ok(lightPlan.selected.some((candidate) => candidate.slug === entry.slug), `mandatory ${entry.slug} remains selected`);
}
assert.ok(
  lightPlan.selected.find((entry) => entry.slug === "test-case-derivation")?.mandatory,
  "gated/evidence stage rule remains mandatory",
);
assert.ok(
  lightPlan.selected.find((entry) => entry.slug === "workspace-detection")?.mandatory,
  "a selected dependency root remains mandatory",
);

const escalated = applyExecutionProfile({
  current: lightweight,
  classified: classifyExecutionProfile({
    scope: "bugfix",
    current: lightweight,
    signals: new Set(["security_or_sensitive_data"]),
  }),
  at: "2026-10-14T09:31:00.000Z",
});
const restored = buildRuleLoadPlan(graph, { scope: "bugfix", executionProfile: escalated });
assert.ok(names(restored).includes("state-template"), "escalation restores the omitted rule file");

assert.throws(
  () => buildRuleLoadPlan(graph, { scope: "bugfix", executionProfile: lightweight, targetStageSlug: "state-template" }),
  /not selected/,
  "a non-selected rule must not be hand-loaded",
);

function syntheticStage(overrides: Partial<StageNode> & Pick<StageNode, "slug">): StageNode {
  return {
    slug: overrides.slug,
    number: overrides.number ?? "X",
    name: overrides.name ?? overrides.slug,
    phase: overrides.phase ?? "fixture",
    axis: overrides.axis ?? "project",
    execution: overrides.execution ?? "ALWAYS",
    selection: overrides.selection ?? "automatic",
    choices: overrides.choices ?? [],
    scopes: overrides.scopes ?? ["bugfix"],
    requires: overrides.requires ?? [],
    cross_module_requires: overrides.cross_module_requires ?? [],
    scope_waived_requires: overrides.scope_waived_requires ?? [],
    consumes: overrides.consumes ?? [],
    produces: overrides.produces ?? [],
    sensors: overrides.sensors ?? [],
    traceability: overrides.traceability ?? "not_applicable",
    completion_contract: overrides.completion_contract ?? "instruction_only",
    condition: overrides.condition ?? "",
    approval: overrides.approval ?? "notify",
    file: overrides.file ?? `stages/fixture/${overrides.slug}.md`,
  };
}

const safetyGraph: StageGraph = {
  version: "fixture",
  stage_count: 5,
  stages: [
    syntheticStage({ slug: "approval-block", approval: "block" }),
    syntheticStage({ slug: "sensor-stage", sensors: ["fixture-sensor"] }),
    syntheticStage({ slug: "produces-stage", produces: ["docs/fixture.md"] }),
    syntheticStage({ slug: "dependency-root" }),
    syntheticStage({ slug: "consumer", requires: ["dependency-root"], completion_contract: "gated" }),
  ],
};
const safetyPlan = buildRuleLoadPlan(safetyGraph, {
  scope: "bugfix",
  executionProfile: lightweight,
  targetStageSlug: "consumer",
});
const safetySlugs = ["approval-block", "sensor-stage", "produces-stage", "dependency-root", "consumer"];
assert.deepEqual(safetyPlan.selected.map((entry) => entry.slug), safetySlugs);
assert.deepEqual(safetyPlan.selected.filter((entry) => entry.mandatory).map((entry) => entry.slug), safetySlugs);
for (const slug of safetySlugs) {
  const entry = safetyPlan.selected.find((candidate) => candidate.slug === slug);
  assert.ok(entry, `${slug} remains selected under lightweight`);
  assert.equal(entry.mandatory, true, `${slug} is mandatory in the rule plan`);
}

const malformedGraph: StageGraph = {
  version: "fixture",
  stage_count: 1,
  stages: [
    syntheticStage({
      slug: "unsafe-stage",
      requires: ["missing-selected-dependency"],
      scope_waived_requires: ["missing-selected-dependency"],
    }),
  ],
};
const malformedState = createInitialState("bugfix", "fixture", "malformed-plan", [], "Rule plan failure");
authorizeFixture(malformedState, "unsafe-stage");
let malformedCommitCount = 0;
const malformedDirective = await advance(malformedGraph, {
  state: malformedState,
  flags: {},
  commit: () => { malformedCommitCount += 1; },
  retry: async () => ({ kind: "error", message: "unexpected retry" }),
  label: "Malformed workflow",
  finishedMessage: () => "unexpected completion",
  persistProviderPlans: false,
});
assert.equal(malformedDirective.kind, "error");
assert.match(String(malformedDirective.message), /Rule-load plan blocked/);
assert.equal(malformedCommitCount, 0, "failed rule-load planning must not commit or advance workflow state");
assert.equal(malformedState.current_stage, "", "failed rule-load planning must not set current stage");

const parkedMalformedState = createInitialState("bugfix", "fixture", "parked-malformed-plan", [], "Parked rule plan failure");
authorizeFixture(parkedMalformedState, "unsafe-stage");
parkedMalformedState.status = "parked";
parkedMalformedState.current_stage = "previous-stage";
parkedMalformedState.current_phase = "previous-phase";
const parkedBefore = JSON.stringify(parkedMalformedState);
let parkedCommitCount = 0;
const parkedMalformedDirective = await advance(malformedGraph, {
  state: parkedMalformedState,
  flags: { resume: "true" },
  commit: () => { parkedCommitCount += 1; },
  retry: async () => ({ kind: "error", message: "unexpected retry" }),
  label: "Parked malformed workflow",
  finishedMessage: () => "unexpected completion",
  persistProviderPlans: false,
});
assert.equal(parkedMalformedDirective.kind, "error");
assert.equal(parkedCommitCount, 0, "failed parked resume must not commit");
assert.equal(JSON.stringify(parkedMalformedState), parkedBefore, "failed parked resume preserves status and current context exactly");

const skippedThenConsumeGraph: StageGraph = {
  version: "fixture",
  stage_count: 2,
  stages: [
    syntheticStage({ slug: "condition-false", completion_contract: "gated", condition: "ui_design_selected" }),
    syntheticStage({ slug: "consume-fails", completion_contract: "gated", consumes: ["missing-required-input.md"] }),
  ],
};
const skippedThenConsumeState = createInitialState("bugfix", "fixture", "skip-then-consume", [], "Later gate failure");
authorizeFixture(skippedThenConsumeState, "consume-fails");
skippedThenConsumeState.execution_profile = lightweight;
const skippedThenConsumeBefore = JSON.stringify(skippedThenConsumeState);
let skippedThenConsumeCommitCount = 0;
const skippedThenConsumeDirective = await advance(skippedThenConsumeGraph, {
  state: skippedThenConsumeState,
  flags: {},
  commit: () => { skippedThenConsumeCommitCount += 1; },
  retry: async () => ({ kind: "error", message: "unexpected retry" }),
  label: "Later gate workflow",
  finishedMessage: () => "unexpected completion",
  persistProviderPlans: false,
});
assert.equal(skippedThenConsumeDirective.kind, "error");
assert.match(String(skippedThenConsumeDirective.message), /missing canonical consumed artifacts/);
assert.equal(skippedThenConsumeCommitCount, 0, "later gate failure must not commit speculative condition skips");
assert.equal(JSON.stringify(skippedThenConsumeState), skippedThenConsumeBefore, "later gate failure preserves state exactly");

const conditionSkip = syntheticStage({ slug: "condition-false", condition: "ui_design_selected" });
const invalidCondition = syntheticStage({ slug: "invalid-condition", condition: "not-a-registered-condition" });
const conditionErrorGraph: StageGraph = { version: "fixture", stage_count: 2, stages: [conditionSkip, invalidCondition] };
const conditionErrorState = createInitialState("bugfix", "fixture", "legacy-condition-error", [], "Legacy condition persistence");
authorizeFixture(conditionErrorState, "invalid-condition");
let conditionErrorCommits = 0;
const conditionErrorDirective = await advance(conditionErrorGraph, {
  state: conditionErrorState,
  flags: {},
  commit: () => { conditionErrorCommits += 1; },
  retry: async () => ({ kind: "error", message: "unexpected retry" }),
  label: "Legacy condition workflow",
  finishedMessage: () => "unexpected completion",
  persistProviderPlans: false,
});
assert.equal(conditionErrorDirective.kind, "error");
assert.equal(conditionErrorCommits, 1, "legacy condition-error path persists preceding condition skips");
assert.ok(conditionErrorState.skipped_stage_instances.includes("condition-false"));

const blockedGraph: StageGraph = {
  version: "fixture",
  stage_count: 2,
  stages: [conditionSkip, syntheticStage({ slug: "blocked-after-skip", requires: ["missing-dependency"] })],
};
const blockedState = createInitialState("bugfix", "fixture", "legacy-blocked", [], "Legacy blocked persistence");
authorizeFixture(blockedState, "blocked-after-skip");
let blockedCommits = 0;
const blockedDirective = await advance(blockedGraph, {
  state: blockedState,
  flags: {},
  commit: () => { blockedCommits += 1; },
  retry: async () => ({ kind: "error", message: "unexpected retry" }),
  label: "Legacy blocked workflow",
  finishedMessage: () => "unexpected completion",
  persistProviderPlans: false,
});
assert.equal(blockedDirective.kind, "error");
assert.equal(blockedCommits, 1, "legacy blocked path persists preceding condition skips");
assert.ok(blockedState.skipped_stage_instances.includes("condition-false"));
delete process.env.AIDLC_SESSION_BINDING;

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
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], { cwd: project, encoding: "utf8", env: fixtureEnvironment(project, ["orchestrate", ...args]) });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-phase4-"));
try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "fixture\n");
  git(project, ["init", "-q"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "fixture"]);

  run(project, ["next", "--scope", "bugfix", "--work", "Phase 4 fixture"]);
  const next = run(project, ["next"]);
  const handoff = next.rule_load_plan as { load_now: Array<{ slug: string }>; selected: Array<{ slug: string }> };
  assert.equal(next.stage, "workspace-detection");
  assert.deepEqual(handoff.load_now.map((entry) => entry.slug), ["workspace-detection"]);
  assert.equal(handoff.selected.some((entry) => entry.slug === "state-template"), false);

  run(project, ["report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  const testCaseHandoff = run(project, ["next"]);
  const testCaseRules = testCaseHandoff.rule_load_plan as { load_now: Array<{ slug: string }>; selected: Array<{ slug: string }> };
  assert.equal(testCaseHandoff.stage, "test-case-derivation");
  assert.deepEqual(testCaseRules.load_now.map((entry) => entry.slug), ["workspace-detection", "test-case-derivation"]);
  assert.equal(testCaseRules.selected.some((entry) => entry.slug === "state-template"), false);

  const readPlan = run(project, ["state", "rules"]);
  const rulePlan = readPlan.rule_load_plan as { selected: Array<{ slug: string }> };
  assert.equal(rulePlan.selected.some((entry) => entry.slug === "state-template"), false);

  run(project, ["profile", "escalate", "--signal", "security_or_sensitive_data"]);
  const restoredRead = run(project, ["state", "rules"]);
  const restoredRules = restoredRead.rule_load_plan as { selected: Array<{ slug: string }> };
  assert.equal(restoredRules.selected.some((entry) => entry.slug === "state-template"), true);

  const legacyProject = join(root, "legacy");
  mkdirSync(legacyProject, { recursive: true });
  saveWorkflowState(legacyProject, createInitialState("bugfix", "4.14.1", "legacy-profile", [], "Legacy profile"));
  const legacyRead = run(legacyProject, ["state", "rules"]);
  const legacyRules = legacyRead.rule_load_plan as { profile: { provenance: string }; selected: Array<{ slug: string }> };
  assert.equal(legacyRules.profile.provenance, "legacy_standard_default");
  assert.equal(legacyRules.selected.some((entry) => entry.slug === "state-template"), true);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("execution profile phase-4 progressive rule loading tests passed");
