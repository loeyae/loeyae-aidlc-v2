/**
 * MARS-107 (P2, 方案B) regression: shared-contract-baseline is on by default for a
 * multi-module workflow even when no contract keyword appears, closing the keyword
 * under-detection gap. A single-module workflow keeps the keyword-only behaviour.
 *
 * `buildConditionContext` reads the module-level `PROJECT_ROOT = realpathSync(cwd)`
 * fixed at import time, so each fixture is probed in its own child process whose cwd
 * is the fixture directory (the probe dynamically imports after the cwd is set).
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
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars107-"));

function write(project: string, path: string, content: string): void {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

/**
 * A probe executed with cwd = the fixture project. It builds the condition context
 * (no instance → unit selections are undefined, the fallback default applies) and
 * prints whether has_contract_dependencies is true.
 */
const PROBE = `
import { buildConditionContext, evaluateCondition } from ${JSON.stringify(orchestrateUrl)};
import { loadWorkflowState } from ${JSON.stringify(lightStateUrl)};
const state = loadWorkflowState(process.cwd());
const ctx = buildConditionContext(state);
console.log(JSON.stringify({ has_contract_dependencies: evaluateCondition("has_contract_dependencies", ctx) }));
`;

/** Build a fixture with N modules and keyword-free requirements, then probe it. */
function probe(name: string, moduleCount: number): boolean {
  const project = join(scratch, name);
  mkdirSync(project, { recursive: true });
  const modules = Array.from({ length: moduleCount }, (_, index) => ({
    module_id: `m0${index + 1}`,
    name: `Module ${index + 1}`,
    service_id: `svc-${index + 1}`,
  }));
  write(project, "docs/aidlc/ideation/module-manifest.json", `${JSON.stringify({ schema_version: 1, modules }, null, 2)}\n`);
  // Keyword-free requirements so moduleHasContractDependencies is false.
  write(project, "docs/aidlc/inception/requirements.md", "# 需求\n\n## REQ-001 普通功能\n\ntrack: [backend]\n\n一个不含任何契约措辞的业务需求。\n");
  // Real workflow state via the state helper; a >1 module manifest makes multi_module true.
  const state = createInitialState("feature", "4.13.0", "00000000-0000-4000-8000-000000000000", [], "MARS-107 probe") as WorkflowState;
  state.completed_stages = ["workspace-detection", "state-template"];
  state.completed_stage_instances = ["workspace-detection", "state-template"];
  state.current_phase = "construction";
  saveWorkflowState(project, state);
  const probeFile = join(project, "probe.mts");
  writeFileSync(probeFile, PROBE, "utf8");
  const result = spawnSync(process.execPath, [tsx, probeFile], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, `probe failed (${moduleCount} modules):\n${result.stdout}\n${result.stderr}`);
  const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
  return JSON.parse(line).has_contract_dependencies === true;
}

try {
  const multi = probe("multi", 2);
  assert.equal(multi, true, "multi-module without a contract keyword must default has_contract_dependencies to true");
  const single = probe("single", 1);
  assert.equal(single, false, "single-module without a contract keyword must keep has_contract_dependencies false");
  console.log("MARS-107 contract-baseline multi-module default tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
