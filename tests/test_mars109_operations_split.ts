/**
 * MARS-109 (P4) regression: the single `operations` stage was split into
 * `operations-planning` (approval: notify, reversible) and
 * `operations-authorization` (approval: block, irreversible authorization point).
 * Both new stages are gated by the same `has_deployment_needs` condition.
 *
 * The planned-decision branch of `has_deployment_needs` reads the workflow-plan
 * table. After the split it must honor an explicit decision on EITHER new slug and
 * keep `operations` as a backward-compatible alias for pre-split plans. These tests
 * probe the condition in a child process (same pattern as test_mars107): the module
 * `PROJECT_ROOT = realpathSync(cwd)` is fixed at import time, so each fixture is run
 * in its own process whose cwd is the fixture directory.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";
import type { WorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const orchestrateUrl = pathToFileURL(join(repository, "core", "tools", "aidlc-orchestrate.ts")).href;
const lightStateUrl = pathToFileURL(join(repository, "core", "tools", "aidlc-light-state.ts")).href;
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars109-"));

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

/**
 * Probe cwd = fixture project. Builds the condition context and prints whether
 * has_deployment_needs is true. The workflow-plan decision (if present) wins over
 * keyword inference via the `??` fallback in buildConditionContext.
 */
const PROBE = `
import { buildConditionContext, evaluateCondition } from ${JSON.stringify(orchestrateUrl)};
import { loadWorkflowState } from ${JSON.stringify(lightStateUrl)};
const state = loadWorkflowState(process.cwd());
const ctx = buildConditionContext(state);
console.log(JSON.stringify({ has_deployment_needs: evaluateCondition("has_deployment_needs", ctx) }));
`;

/**
 * Build a deployment-keyword-free fixture (so inference alone would be false),
 * write the given workflow-plan body, and probe has_deployment_needs.
 */
function probe(name: string, workflowPlan: string): boolean {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  write(project, "docs/aidlc/ideation/module-manifest.json",
    `${JSON.stringify({ schema_version: 1, modules: [{ module_id: "m01", name: "Module 1", service_id: "svc-1" }] }, null, 2)}\n`);
  // Keyword-free requirements and no deployment artifacts so inference is false and
  // only the planned decision can flip has_deployment_needs.
  write(project, "docs/aidlc/inception/requirements.md",
    "# 需求\n\n## REQ-001 普通功能\n\ntrack: [backend]\n\n一个不含任何部署措辞的纯逻辑需求。\n");
  write(project, "docs/aidlc/inception/workflow-plan.md", workflowPlan);
  // Minimal package.json without a start/serve script so packageHasRuntimeStart is false.
  write(project, "package.json", `${JSON.stringify({ name: "mars109-fixture", version: "0.0.0" }, null, 2)}\n`);
  const state = createInitialState("feature", "4.13.0", "00000000-0000-4000-8000-000000000000", [], "MARS-109 probe") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  state.current_phase = "operation";
  saveWorkflowState(project, state);
  const probeFile = join(project, "probe.mts");
  writeFileSync(probeFile, PROBE, "utf8");
  const result = spawnSync(process.execPath, [tsx, probeFile], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, `probe failed (${name}):\n${result.stdout}\n${result.stderr}`);
  const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
  return JSON.parse(line).has_deployment_needs === true;
}

const planHeader = "# 工作流计划\n\n| Stage | Decision |\n|-------|----------|\n";

try {
  // 1. Explicit execute on the new planning slug → deploy needed.
  assert.equal(
    probe("planning-execute", `${planHeader}| \`operations-planning\` | execute |\n`),
    true,
    "explicit execute on operations-planning must make has_deployment_needs true",
  );

  // 2. Explicit execute on the new authorization slug → deploy needed.
  assert.equal(
    probe("authorization-execute", `${planHeader}| \`operations-authorization\` | execute |\n`),
    true,
    "explicit execute on operations-authorization must make has_deployment_needs true",
  );

  // 3. Explicit skip on BOTH new slugs → not needed (defined decision overrides inference).
  assert.equal(
    probe("both-skip", `${planHeader}| \`operations-planning\` | skip |\n| \`operations-authorization\` | skip |\n`),
    false,
    "explicit skip on both split stages must make has_deployment_needs false",
  );

  // 4. Legacy "operations" alias (pre-split plan) still honored.
  assert.equal(
    probe("legacy-alias-execute", `${planHeader}| \`operations\` | execute |\n`),
    true,
    "legacy operations alias with execute must still make has_deployment_needs true",
  );
  assert.equal(
    probe("legacy-alias-skip", `${planHeader}| \`operations\` | skip |\n`),
    false,
    "legacy operations alias with skip must make has_deployment_needs false",
  );

  console.log("MARS-109 operations split has_deployment_needs tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
