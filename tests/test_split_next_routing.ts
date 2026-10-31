import { saveFixtureState, saveFixtureStateWithChecks } from "./mars243_fixture_session";
import { fixtureEnvironment } from "./mars243_fixture_session";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import { snapshot as rawSnapshot } from "./mars244_fixture";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-split-next-"));
const M01 = "m01-trade";
const M02 = "m02-product";
const WORKFLOW_ID = "0b6f3c2a-7d41-4e8b-9a52-1c3d5e7f9a01";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];

function run(cwd: string, args: string[], env: Record<string, string> = {}): { status: number; directive: Record<string, unknown> } {
  const baseEnv = { ...process.env };
  delete baseEnv.AIDLC_MODULE;
  const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd, encoding: "utf8", env: { ...fixtureEnvironment(cwd, ["orchestrate", ...args, ...(!args.includes("--module") && env.AIDLC_MODULE && env.AIDLC_MODULE !== "m09-unknown" ? ["--module", env.AIDLC_MODULE] : [])]), ...({ ...baseEnv, ...env }) } });
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  const directive = JSON.parse(text) as Record<string, unknown>;
  if (directive.binding_required && args[0] === "next" && args.includes("--module")) {
    const retry = args.filter((arg, i) => arg !== "--work" && args[i - 1] !== "--work");
    return run(cwd, retry);
  }
  return { status: result.status ?? 1, directive };
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

/** Two modules that both start at requirements-analysis right after the split. */
function prepareSplitProject(name: string): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  write(project, "README.md", "REQ-BASE split next routing fixture\n");
  write(project, "docs/aidlc/ideation/module-manifest.json", JSON.stringify({
    schema_version: 1,
    modules: [
      { module_id: M01, name: "Trade", service_id: "trade-service" },
      { module_id: M02, name: "Product", service_id: "product-service" },
    ],
  }));
  write(project, "docs/aidlc/ideation/scenario-module-mapping.md", "# Scenario module mapping\nREQ-001 checkout belongs to m01-trade; REQ-201 catalog belongs to m02-product.\n");
  write(project, "docs/aidlc/ideation/product-contracts.md", "# 产品级契约索引\n\n## 契约清单\n| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |\n|---------|------|--------|----------|-----------|----------|-------|\n\n## 消费者状态\n| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |\n|---------|--------|------|------|----------|\n");
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", "fixture"]);
  const state = createInitialState("feature", "4.1.0", WORKFLOW_ID, [], "Deliver trade and product modules");
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M02}`];
  saveFixtureState(project, state);
  const split = run(project, ["split", "--from", WORKFLOW_ID]);
  assert.equal(split.status, 0, JSON.stringify(split.directive));
  return project;
}

try {
  const project = prepareSplitProject("routing");

  // Several module workflows can advance: ask instead of picking the first registry row.
  const asked = run(project, ["next"]);
  assert.equal(asked.status, 0, JSON.stringify(asked.directive));
  assert.equal(asked.directive.kind, "ask");
  assert.equal(asked.directive.ask_type, "module-selection");
  assert.deepEqual(asked.directive.options, [M01, M02]);
  const modules = asked.directive.modules as { module_id: string; stage_instance: string }[];
  assert.deepEqual(modules.map((item) => item.stage_instance), [`requirements-analysis@module:${M01}`, `requirements-analysis@module:${M02}`]);
  assert.equal(asked.directive.command_template, "loeyae-aidlc orchestrate next --module <module-id>");
  for (const moduleId of [M01, M02]) {
    const state = loadWorkflowState(project, { kind: "module", module_id: moduleId })!;
    assert.equal(state.current_stage_instance, undefined, `asking must not select a stage for ${moduleId}`);
  }

  // AIDLC_MODULE is equivalent to --module; explicit --module wins; an unknown module never falls back.
  const fromEnv = run(project, ["next"], { AIDLC_MODULE: M02 });
  assert.equal(fromEnv.directive.kind, "run-stage");
  assert.equal(fromEnv.directive.stage_instance, `requirements-analysis@module:${M02}`);
  const explicit = run(project, ["next", "--module", M01], { AIDLC_MODULE: M02 });
  assert.equal(explicit.directive.stage_instance, `requirements-analysis@module:${M01}`);
  const unknown = run(project, ["next"], { AIDLC_MODULE: "m09-unknown" });
  assert.equal(unknown.directive.kind, "error");
  assert.match(String(unknown.directive.message), /^AIDLC_MODULE: Unknown module "m09-unknown"/);

  // Only one module can advance: the existing direct routing is unchanged.
  assert.equal(run(project, ["park", "--module", M01]).directive.kind, "parked");
  const single = run(project, ["next"]);
  assert.equal(single.directive.kind, "run-stage");
  assert.equal(single.directive.stage_instance, `requirements-analysis@module:${M02}`);
  assert.equal(loadWorkflowState(project, { kind: "module", module_id: M01 })!.status, "parked", "bound next preserves the sibling workflow");

  // Unbound integration previews select the real next project instance after
  // module handoff, and never write state/audit/claims while projecting it.
  const integrated = prepareSplitProject("integration-preview");
  const global = loadWorkflowState(integrated)!;
  global.status = "done";
  saveFixtureState(integrated, global);
  for (const moduleId of [M01, M02]) {
    const ref = { kind: "module" as const, module_id: moduleId };
    const state = loadWorkflowState(integrated, ref)!;
    state.status = "done";
    saveFixtureState(integrated, state, ref);
  }
  const integrationRef = { kind: "integration" as const };
  const integration = loadWorkflowState(integrated, integrationRef)!;
  const rawPreview = () => {
    const before = rawSnapshot(integrated);
    const env = { ...process.env, AIDLC_SESSION_BINDING: "" };
    delete env.AIDLC_MODULE;
    const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", "next", "--preview"], { cwd: integrated, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(rawSnapshot(integrated), before, "raw preview must not bind or persist routing");
    return JSON.parse(result.stdout);
  };
  for (const [completed, expected] of [
    [[], "build-and-test"],
    [["build-and-test"], "build-and-test-templates"],
    [["build-and-test", "build-and-test-templates"], "implementation-report"],
  ] as const) {
    integration.completed_stage_instances = [...completed];
    integration.completed_stages = [...completed];
    saveFixtureState(integrated, integration, integrationRef);
    const projected = rawPreview();
    assert.equal(projected.workflow, "integration");
    assert.equal(projected.stage_instance, expected);
  }
  const graph = JSON.parse(readFileSync(join(repository, "core/tools/data/stage-graph.json"), "utf8"));
  for (const moduleId of [M01, M02]) {
    const ref = { kind: "module" as const, module_id: moduleId };
    const state = loadWorkflowState(integrated, ref)!;
    write(integrated, `docs/aidlc/modules/${moduleId}/inception/unit-manifest.json`, JSON.stringify({
      schema_version: 1, module_id: moduleId,
      units: [{ unit_id: "default", name: "Default", service_id: moduleId === M01 ? "trade-service" : "product-service", req_refs: [moduleId === M01 ? "REQ-001" : "REQ-201"], conditional_stages: [] }],
    }));
    state.completed_stage_instances = graph.stages.flatMap((stage: { slug: string; axis: string }) =>
      stage.axis === "module" ? [`${stage.slug}@module:${moduleId}`]
        : stage.axis === "unit" ? [`${stage.slug}@module:${moduleId}@unit:default`] : []);
    state.completed_stages = graph.stages.filter((stage: { axis: string }) => stage.axis !== "project").map((stage: { slug: string }) => stage.slug);
    saveFixtureState(integrated, state, ref);
  }
  integration.completed_stage_instances = ["build-and-test", "build-and-test-templates", "implementation-report"];
  integration.completed_stages = [...integration.completed_stage_instances];
  saveFixtureState(integrated, integration, integrationRef);
  assert.equal(rawPreview().stage_instance, null);
  const terminalEnv = fixtureEnvironment(integrated, ["orchestrate", "next"]);
  assert.equal(JSON.parse(terminalEnv.AIDLC_SESSION_BINDING!).stage_instance, "implementation-report");
  const terminal = spawnSync(process.execPath, [tsx, cli, "orchestrate", "next"], { cwd: integrated, encoding: "utf8", env: terminalEnv });
  assert.equal(terminal.status, 0, terminal.stdout + terminal.stderr);
  assert.equal(JSON.parse(terminal.stdout).kind, "done");
  assert.equal(loadWorkflowState(integrated, integrationRef)!.status, "done");
  const parked = loadWorkflowState(integrated, { kind: "module", module_id: M01 })!;
  parked.status = "parked";
  saveFixtureState(integrated, parked, { kind: "module", module_id: M01 });
  assert.notEqual(rawPreview().workflow, "integration", "a parked module is not an integration handoff");
  parked.status = "done";
  saveFixtureState(integrated, parked, { kind: "module", module_id: M01 });
  global.completed_stages = global.completed_stages.filter(stage => stage !== "workspace-detection");
  global.completed_stage_instances = global.completed_stage_instances.filter(stage => stage !== "workspace-detection");
  saveFixtureState(integrated, global);
  assert.equal(rawPreview().workflow, "global", "stale done status cannot hide unresolved global stages");

  console.log("split next module routing tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
