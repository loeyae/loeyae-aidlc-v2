import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { applyExecutionProfile, classifyExecutionProfile } from "../core/tools/aidlc-execution-profile";
import { buildExecutionProfileReleaseMeasurements } from "../core/tools/aidlc-execution-profile-measurements";
import { createInitialState, lightStatePath, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { loadGraph } from "../core/tools/aidlc-orchestrate";
import { bindSession, claimToken } from "../core/tools/aidlc-session";

const REPOSITORY = resolve(import.meta.dirname, "..");
const CLI = join(REPOSITORY, "bin", "cli.ts");
const TSX = join(REPOSITORY, "node_modules", "tsx", "dist", "cli.mjs");
const AT = "2026-10-14T13:00:00.000Z";
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

const legacy = buildExecutionProfileReleaseMeasurements(graph, { scope: "bugfix" });
assert.equal(legacy.profile.provenance, "legacy_standard_default");
assert.equal(legacy.migration.execution_profile_present, false);
assert.equal(legacy.migration.policy, "legacy_read_without_migration");
assert.equal(legacy.migration.state_write_performed, false);
assert.equal(legacy.regression.legacy_standard_parity, true);
assert.equal(legacy.release_authority, "not_a_gate");

for (const profile of [standard, complex]) {
  const measurement = buildExecutionProfileReleaseMeasurements(graph, { scope: "bugfix", executionProfile: profile });
  assert.equal(measurement.regression.legacy_standard_parity, profile.level === "standard", `${profile.level} reports risk-driven additions accurately`);
  assert.deepEqual(measurement.regression.omitted_stage_slugs, [], `${profile.level} has no reduction`);
  assert.equal(measurement.regression.mandatory_rules_retained, true);
}

const lightMeasurement = buildExecutionProfileReleaseMeasurements(graph, { scope: "bugfix", executionProfile: lightweight });
assert.equal(lightMeasurement.profile.provenance, "persisted_execution_profile");
assert.deepEqual(lightMeasurement.regression.omitted_stage_slugs, ["state-template"], "only the Phase-3 safe slice is measured as reduced");
assert.equal(lightMeasurement.regression.mandatory_rules_retained, true, "measurements prove mandatory rule retention without granting a pass");
assert.equal(lightMeasurement.regression.measured_selected_stage_count + 1, lightMeasurement.regression.historical_selected_stage_count);

function run(project: string, args: string[], binding?: unknown): Record<string, unknown> {
  const env = { ...process.env };
  delete env.AIDLC_SESSION_BINDING;
  if (binding) env.AIDLC_SESSION_BINDING = JSON.stringify(binding);
  const result = spawnSync(process.execPath, [TSX, CLI, "orchestrate", ...args], { cwd: project, encoding: "utf8", env });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
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
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function write(project: string, relativePath: string, content: string): void {
  const target = join(project, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

const root = mkdtempSync(join(tmpdir(), "aidlc-mars161-phase6-"));
try {
  const legacyProject = join(root, "legacy");
  mkdirSync(legacyProject, { recursive: true });
  saveWorkflowState(legacyProject, createInitialState("bugfix", "4.14.1", "phase6-legacy", [], "Phase 6 legacy fixture"));
  const legacyPath = lightStatePath(legacyProject);
  const before = readFileSync(legacyPath, "utf8");
  const legacyCli = run(legacyProject, ["state", "measurements"]);
  const legacyCliMeasurement = legacyCli.execution_profile_measurements as {
    migration: { execution_profile_present: boolean; state_write_performed: boolean };
    release_authority: string;
  };
  assert.equal(legacyCliMeasurement.migration.execution_profile_present, false);
  assert.equal(legacyCliMeasurement.migration.state_write_performed, false);
  assert.equal(legacyCliMeasurement.release_authority, "not_a_gate");
  assert.equal(readFileSync(legacyPath, "utf8"), before, "measurement CLI must not migrate or rewrite a legacy WorkflowState");

  const lightProject = join(root, "lightweight");
  mkdirSync(lightProject, { recursive: true });
  const state = createInitialState("bugfix", "4.14.1", "phase6-light", [], "Phase 6 lightweight fixture");
  state.execution_profile = lightweight;
  saveWorkflowState(lightProject, state);
  const lightPath = lightStatePath(lightProject);
  const lightBefore = readFileSync(lightPath, "utf8");
  const lightCli = run(lightProject, ["state", "measurements"]);
  const lightCliMeasurement = lightCli.execution_profile_measurements as {
    regression: { omitted_stage_slugs: string[]; mandatory_rules_retained: boolean };
  };
  assert.deepEqual(lightCliMeasurement.regression.omitted_stage_slugs, ["state-template"]);
  assert.equal(lightCliMeasurement.regression.mandatory_rules_retained, true);
  assert.equal(readFileSync(lightPath, "utf8"), lightBefore, "measurement CLI must not rewrite a persisted global execution_profile");

  const splitProject = join(root, "split-lightweight");
  mkdirSync(splitProject, { recursive: true });
  git(splitProject, ["init", "-q"]);
  write(splitProject, "README.md", "Phase 6 split measurement fixture\n");
  write(splitProject, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: "m01-measurements", name: "Measurements", service_id: "measurements-service" },
    ],
  }));
  write(splitProject, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 belongs to m01-measurements.\n");
  write(splitProject, "docs/aidlc/ideation/product-contracts.md", [
    "# 产品级契约索引",
    "",
    "## 契约清单",
    "| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |",
    "|---------|------|--------|----------|-----------|----------|-------|",
    "",
    "## 消费者状态",
    "| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |",
    "|---------|--------|------|------|----------|",
    "",
  ].join("\n"));
  git(splitProject, ["add", "-A"]);
  git(splitProject, ["commit", "-qm", "phase6 split fixture"]);
  const splitState = createInitialState("feature", "4.14.1", "phase6-split", [], "Phase 6 split lightweight fixture");
  splitState.execution_profile = lightweight;
  splitState.completed_stages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  splitState.completed_stage_instances = [...splitState.completed_stages];
  splitState.skipped_stage_instances = ["reverse-engineering@module:m01-measurements"];
  saveWorkflowState(splitProject, splitState);
  const session = bindSession(splitProject, { instance: "state-template", owner: "phase6", session: "phase6-split", expected: claimToken(undefined) });
  run(splitProject, ["split", "--from", "phase6-split"], session.binding);
  const modulePath = lightStatePath(splitProject, { kind: "module", module_id: "m01-measurements" });
  const moduleBefore = readFileSync(modulePath, "utf8");
  const splitCli = run(splitProject, ["state", "measurements", "--module", "m01-measurements"]);
  const splitMeasurement = splitCli.execution_profile_measurements as {
    profile: { level: string; provenance: string };
  };
  assert.deepEqual(splitMeasurement.profile, {
    level: "lightweight",
    provenance: "persisted_execution_profile",
  }, "split module measurements inherit the persisted global lightweight profile");
  assert.equal(readFileSync(modulePath, "utf8"), moduleBefore, "module measurement must not rewrite a module WorkflowState");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("execution profile phase-6 regression, migration, and release measurements tests passed");
