import { saveFixtureState, saveFixtureStateWithChecks } from "./mars243_fixture_session";
import { fixtureEnvironment } from "./mars243_fixture_session";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { getExecutableStages, loadGraph } from "../core/tools/aidlc-orchestrate";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { selectExecutableStages } from "../core/tools/aidlc-stage-selection";

const REPOSITORY = resolve(import.meta.dirname, "..");
const CLI = join(REPOSITORY, "bin", "cli.ts");
const TSX = join(REPOSITORY, "node_modules", "tsx", "dist", "cli.mjs");
const AT = "2026-10-14T09:30:00.000Z";
const graph = loadGraph();

for (const scope of ["bugfix", "refactor", "express", "workshop", "feature", "mvp", "classic", "enterprise"] as const) {
  const defaultProfile = applyExecutionProfile({
    classified: classifyExecutionProfile({ scope }),
    at: AT,
  });
  const standard = applyExecutionProfile({
    classified: classifyExecutionProfile({ scope, requested_level: "standard" }),
    at: AT,
  });
  const complex = applyExecutionProfile({
    classified: classifyExecutionProfile({
      scope,
      signals: new Set(["security_or_sensitive_data"]),
    }),
    at: AT,
  });
  const baseline = getExecutableStages(graph, scope).map((stage) => stage.slug);
  const defaultSlugs = getExecutableStages(graph, scope, [], defaultProfile).map((stage) => stage.slug);
  const isLightweightScope = ["bugfix", "refactor", "express", "workshop"].includes(scope);

  assert.deepEqual(
    baseline.filter((slug) => !defaultSlugs.includes(slug)),
    isLightweightScope ? ["state-template"] : [],
    `${scope}: default profile may only trim graph-proven instruction-only stages`,
  );

  for (const stage of graph.stages.filter((stage) => baseline.includes(stage.slug))) {
    const retained = defaultSlugs.includes(stage.slug);
    const protectedStage =
      stage.completion_contract === "gated" ||
      stage.approval === "block" ||
      stage.sensors.length > 0 ||
      stage.produces.length > 0 ||
      graph.stages.some((candidate) =>
        baseline.includes(candidate.slug) &&
        (candidate.requires.includes(stage.slug) || candidate.cross_module_requires?.includes(stage.slug) === true),
      );
    if (protectedStage) {
      assert.equal(retained, true, `${scope}: ${stage.slug} is a mandatory gate, evidence producer, or dependency root`);
    }
  }

  for (const [name, profile] of [["standard", standard], ["legacy", undefined]] as const) {
    assert.deepEqual(
      getExecutableStages(graph, scope, [], profile).map((stage) => stage.slug),
      baseline,
      `${scope}/${name} must preserve historical selector parity`,
    );
  }

  const complexSlugs = getExecutableStages(graph, scope, [], complex).map(stage => stage.slug);
  for (const slug of [...baseline, "application-design", "nfr-requirements", "nfr-design"]) assert.ok(complexSlugs.includes(slug), `${scope}: security escalation retains gates and adds risk-required design`);

  const escalated = applyExecutionProfile({
    current: defaultProfile,
    classified: classifyExecutionProfile({
      scope,
      current: defaultProfile,
      signals: new Set(["security_or_sensitive_data"]),
    }),
    at: "2026-10-14T09:31:00.000Z",
  });
  assert.equal(escalated.level, "complex", `${scope}: escalation must reach/retain complex`);
  assert.deepEqual(
    getExecutableStages(graph, scope, [], escalated).map((stage) => stage.slug),
    complexSlugs,
    `${scope}: profile escalation must use the same risk-required stage closure`,
  );
}

// Future graph additions must not make a blocking approval silently optional,
// even if they otherwise look like an instruction-only no-op.
const blockingApprovalFixture = [{
  slug: "future-blocking-approval",
  execution: "ALWAYS",
  selection: "automatic",
  scopes: ["bugfix"],
  completion_contract: "instruction_only",
  approval: "block",
  sensors: [],
  produces: [],
  requires: [],
  cross_module_requires: [],
}];
const fixtureLightweight = applyExecutionProfile({
  classified: classifyExecutionProfile({ scope: "bugfix" }),
  at: AT,
});
assert.deepEqual(
  selectExecutableStages(blockingApprovalFixture, "bugfix", [], fixtureLightweight).map((stage) => stage.slug),
  ["future-blocking-approval"],
  "approval:block stages must remain selected even without sensors, artifacts, or dependents",
);

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
    encoding: "utf8", env: fixtureEnvironment(project, ["orchestrate", ...args]) });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function runFailure(project: string, args: string[]): string {
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], {
    cwd: project,
    encoding: "utf8", env: fixtureEnvironment(project, ["orchestrate", ...args]) });
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-phase3-"));
try {
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "README.md"), "fixture\n");
  git(project, ["init", "-q"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-qm", "fixture"]);

  run(project, ["next", "--scope", "bugfix", "--work", "Phase 3 fixture"]);
  assert.equal(run(project, ["next"]).stage, "workspace-detection");
  run(project, ["report", "--stage", "workspace-detection", "--result", "completed", "--instruction-ack", "workspace-detection"]);
  assert.equal(
    run(project, ["next"]).stage,
    "test-case-derivation",
    "actual lightweight execution must skip only state-template",
  );

  const escalation = run(project, [
    "profile", "escalate",
    "--signal", "security_or_sensitive_data",
    "--detail", "Security review found sensitive data handling.",
  ]);
  const profile = escalation.execution_profile as { level: string; events: Array<Record<string, unknown>> };
  assert.equal(profile.level, "complex");
  const escalationEvent = profile.events.at(-1);
  assert.deepEqual(profile.events.at(-1), {
    kind: "profile_escalation",
    at: escalationEvent?.at,
    actor: "user",
    reason_code: "security_or_sensitive_data",
    from: "lightweight",
    to: "complex",
    detail: "Security review found sensitive data handling.",
  });
  assert.equal(
    run(project, ["next"]).stage,
    "state-template",
    "escalation must restore the previously trimmed instruction stage",
  );
  assert.match(runFailure(project, ["profile", "escalate", "--signal", "not-a-signal"]), /requires a valid --signal/);
  assert.match(runFailure(project, ["profile", "escalate", "--signal", "security_or_sensitive_data", "--module", "module-a"]), /global-only/);

  const legacy = join(root, "legacy");
  mkdirSync(legacy, { recursive: true });
  saveFixtureState(legacy, createInitialState("bugfix", "4.14.1", "legacy-profile", [], "Legacy profile"));
  assert.match(runFailure(legacy, ["profile", "escalate", "--signal", "security_or_sensitive_data"]), /does not implicitly migrate legacy state/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("execution profile phase-3 lightweight slice tests passed");
