import { saveFixtureState, saveFixtureStateWithChecks } from "./mars243_fixture_session";
import { fixtureEnvironment } from "./mars243_fixture_session";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyExecutionProfile,
  classifyExecutionProfile,
  createExecutionProfileEvent,
  type ExecutionProfile,
  type ProfileSignal,
} from "../core/tools/aidlc-execution-profile";
import {
  createInitialState,
  loadWorkflowState,
  parseLightWorkflowState,
  renderLightWorkflowState,
  saveWorkflowState,
} from "../core/tools/aidlc-light-state";
import {
  extractOwnedState,
  mergeWorkflowView,
  type WorkflowPart,
} from "../core/tools/aidlc-workflow-layout";

const AT = "2026-10-14T09:30:00.000Z";
const REPOSITORY = resolve(import.meta.dirname, "..");
const CLI = join(REPOSITORY, "bin", "cli.ts");
const TSX = join(REPOSITORY, "node_modules", "tsx", "dist", "cli.mjs");

function profile(
  scope: "bugfix" | "feature",
  signals: ReadonlySet<ProfileSignal> = new Set(),
): ExecutionProfile {
  const classified = classifyExecutionProfile({ scope, signals });
  return applyExecutionProfile({ classified, at: AT });
}

{
  const initial = profile("bugfix");
  assert.equal(initial.level, "lightweight");
  assert.equal(initial.source, "scope_default");
  assert.deepEqual(initial.active_risks, []);
  assert.deepEqual(initial.events, [{
    kind: "initialized",
    at: AT,
    actor: "engine",
    to: "lightweight",
    reason_code: "scope_default",
  }]);

  const escalated = applyExecutionProfile({
    current: initial,
    classified: classifyExecutionProfile({
      scope: "bugfix",
      current: initial,
      signals: new Set(["security_or_sensitive_data"]),
    }),
    at: "2026-10-14T10:00:00.000Z",
  });
  assert.equal(escalated.level, "complex");
  assert.equal(escalated.source, "scope_default", "source is immutable after initialization");
  assert.deepEqual(escalated.active_risks, ["security_or_sensitive_data"]);
  assert.equal(escalated.events.length, 2, "upgrade appends rather than replaces history");
  assert.equal(escalated.events[1]?.kind, "engine_escalation");
  const classifiedEscalation = classifyExecutionProfile({
    scope: "bugfix",
    current: initial,
    signals: new Set(["security_or_sensitive_data"]),
  });
  assert.equal(classifiedEscalation.source, "scope_default", "classification also preserves initial source");
  assert.equal(classifiedEscalation.primary_reason, "security_or_sensitive_data");
}

{
  const state = {
    ...createInitialState("feature", "4.14.1", "workflow-phase1-global", [], "Global profile persistence"),
    workflow_kind: "global" as const,
    execution_profile: profile("feature"),
  };
  const rendered = renderLightWorkflowState(state);
  assert.match(rendered, /## Execution Profile\n/);
  assert.match(rendered, /## Execution Profile Active Risks\n/);
  assert.match(rendered, /## Execution Profile Events\n/);
  assert.deepEqual(parseLightWorkflowState(rendered).execution_profile, state.execution_profile);
}

{
  const withRisks = applyExecutionProfile({
    classified: classifyExecutionProfile({
      scope: "bugfix",
      signals: new Set(["external_contract_changed", "cross_module_dependency"]),
    }),
    at: AT,
  });
  const state = {
    ...createInitialState("bugfix", "4.14.1", "workflow-phase1-malformed", [], "Malformed profile persistence"),
    workflow_kind: "global" as const,
    execution_profile: withRisks,
  };
  const rendered = renderLightWorkflowState(state);
  const initialized = rendered.match(/^\| initialized \|.*$/m)?.[0];
  assert.ok(initialized, "rendered profile must have an initialized event");

  assert.throws(
    () => parseLightWorkflowState(rendered.replace(initialized, initialized.replace(/\| - \| (?:lightweight|standard|complex) \| - \|$/, "| lightweight | standard | - |"))),
    /initialized event requires to and forbids from/,
    "persisted initialized events must obey factory semantics",
  );
  assert.throws(
    () => parseLightWorkflowState(rendered.replace(initialized, `${initialized}\n| risk_recorded | ${AT} | engine | external_contract_changed | lightweight | - | - |`)),
    /risk_recorded event forbids from and to levels/,
    "persisted risk events must not contain level transitions",
  );
  assert.throws(
    () => parseLightWorkflowState(rendered.replace(initialized, `${initialized}\n| engine_escalation | ${AT} | engine | external_contract_changed | complex | standard | - |`)),
    /engine_escalation requires increasing from and to levels/,
    "persisted escalation events must increase the level",
  );
  assert.throws(
    () => parseLightWorkflowState(rendered.replace(initialized, "| - | - | - | - | - | - | - |")),
    /Invalid execution profile/,
    "persisted profiles require an event history",
  );
  assert.throws(
    () => parseLightWorkflowState(rendered.replace(
      "- external_contract_changed\n- cross_module_dependency",
      "- cross_module_dependency\n- external_contract_changed",
    )),
    /unique and sorted/,
    "persisted risks must be canonical rather than silently normalized",
  );
  assert.throws(
    () => parseLightWorkflowState(rendered.replace(
      "- external_contract_changed\n- cross_module_dependency",
      "- external_contract_changed\n- cross_module_dependency\n- cross_module_dependency",
    )),
    /duplicates/,
    "persisted risks must not repeat",
  );
}

{
  const global = {
    ...createInitialState("feature", "4.14.1", "workflow-phase1-global-owner", [], "Profile ownership"),
    workflow_kind: "global" as const,
    execution_profile: profile("feature"),
  };
  const module = {
    ...createInitialState("feature", "4.14.1", "workflow-phase1-module-owner", [], "Module profile ownership"),
    workflow_kind: "module" as const,
    module_id: "m01-core",
    parent_workflow_id: global.workflow_id,
  };
  const parts = new Map<string, WorkflowPart>([
    ["global", { ref: { kind: "global" }, state: global }],
    ["module:m01-core", { ref: { kind: "module", module_id: "m01-core" }, state: module }],
  ]);
  const view = mergeWorkflowView(parts, { kind: "module", module_id: "m01-core" });
  assert.deepEqual(view.execution_profile, global.execution_profile, "merged view reads the global profile");
  const owned = extractOwnedState(view, module, { kind: "module", module_id: "m01-core" });
  assert.equal(Object.hasOwn(owned, "execution_profile"), false, "module extraction never persists the global profile");
  assert.throws(
    () => renderLightWorkflowState({ ...module, execution_profile: global.execution_profile }),
    /only valid in the global workflow state/,
  );
}

{
  assert.throws(
    () => createExecutionProfileEvent({
      kind: "engine_escalation",
      at: AT,
      actor: "engine",
      from: "complex",
      to: "standard",
      reason_code: "security_or_sensitive_data",
    }),
    /requires increasing/,
  );
  assert.throws(
    () => applyExecutionProfile({
      classified: {
        level: "lightweight",
        source: "scope_default",
        primary_reason: "scope_default",
        active_risks: ["provider_or_mandatory_gate", "external_contract_changed"],
      },
      at: AT,
    }),
    /Classified execution profile risks must be unique and sorted/,
    "apply validates a caller-supplied classified profile before materializing it",
  );
  assert.throws(
    () => applyExecutionProfile({
      classified: classifyExecutionProfile({ scope: "feature" }),
      at: "not-a-timestamp",
    }),
    /Apply timestamp/,
  );
  assert.throws(
    () => applyExecutionProfile({
      classified: classifyExecutionProfile({ scope: "feature" }),
      at: AT,
      actor: "not-an-actor" as never,
    }),
    /Invalid event actor/,
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
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

function orchestrate(project: string, args: string[]): void {
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], {
    cwd: project,
    encoding: "utf8", env: fixtureEnvironment(project, ["orchestrate", ...args]) });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function projectFixture(root: string, name: string): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "MARS-161 fixture\n", "utf8");
  git(project, ["init", "-q"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "fixture"]);
  return project;
}

function loadState(project: string) {
  const state = loadWorkflowState(project);
  assert.ok(state, "workflow state must exist");
  return state;
}

function saveState(project: string, state: ReturnType<typeof createInitialState>): void {
  saveFixtureState(project, state);
}

{
  const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-profile-"));
  try {
    const bugfix = projectFixture(root, "bugfix");
    orchestrate(bugfix, ["next", "--scope", "bugfix", "--work", "Fix a narrow defect"]);
    assert.equal(loadState(bugfix).execution_profile?.level, "lightweight");

    const feature = projectFixture(root, "feature");
    orchestrate(feature, ["next", "--scope", "feature", "--work", "Deliver a capability"]);
    assert.equal(loadState(feature).execution_profile?.level, "standard");

    const legacy = projectFixture(root, "legacy");
    const legacyState = createInitialState("bugfix", "4.14.1", "workflow-phase1-legacy", [], "Legacy resume");
    saveState(legacy, legacyState);
    orchestrate(legacy, ["next"]);
    assert.equal(
      Object.hasOwn(loadState(legacy), "execution_profile"),
      false,
      "resuming a legacy workflow does not synthesize a profile",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("execution profile phase-1 persistence tests passed");
