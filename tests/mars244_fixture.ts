import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, renderLightWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state";
import { renderRegistry } from "../core/tools/aidlc-workflow-layout";
export const repository = resolve(import.meta.dirname, "..");
export function write(root: string, p: string, body: unknown) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), typeof body === "string" ? body : JSON.stringify(body));
}
export function git(root: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env,
    GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
export function fixture(instance = "units-generation@module:shop", split = false) {
  const root = mkdtempSync(join(tmpdir(), "mars244-"));
  write(root, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [
    { module_id: "shop", name: "Shop", service_id: "shop", paths: ["src/shop"], contract_paths: ["shared/api.json"] },
    { module_id: "other", name: "Other", service_id: "other", paths: ["src/other"] },
  ] });
  const state = createInitialState("feature", "4.21.0", undefined, [], "MARS-244 regression");
  state.current_stage = instance.split("@")[0]; state.current_stage_instance = instance;
  state.current_module = "shop"; state.current_phase = "inception";
  const unitId = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(instance)?.[1];
  if (unitId) state.current_unit = unitId;
  state.completed_stages = ["module-division"]; state.completed_stage_instances = ["module-division"];
  if (instance.includes("@unit:")) { state.completed_stages.push("units-generation"); state.completed_stage_instances.push("units-generation@module:shop"); }
  const base = "docs/aidlc/modules/shop/inception";
  const units = ["api", "web"].map((id, index) => ({ unit_id: id, name: id, service_id: "shop", req_refs: [`REQ-00${index + 1}`], conditional_stages: [],
    evidence_inputs: { version: 1, paths: [`src/shop/${id}`], shared_paths: ["shared/api.json"], depends_on_units: [] as string[] } }));
  write(root, `${base}/unit-manifest.json`, { schema_version: 1, module_id: "shop", units });
  write(root, `${base}/requirements.md`, "# Requirements\n## REQ-001\nFirst behavior\n## REQ-002\nSecond behavior\n");
  write(root, `${base}/user-stories.md`, "# Stories\n## US-001\nSource: REQ-001\n### AC-001\nGiven A When B Then C\n## US-002\nSource: REQ-002\n### AC-002\nGiven D When E Then F\n");
  write(root, `${base}/application-design/unit-of-work-story-map.md`, '```aidlc-story-map\n'+JSON.stringify({ schema_version: 1, status: "approved", approved_by: "fixture", mappings: [
    { story_id: "US-001", unit_ids: ["api"] }, { story_id: "US-002", unit_ids: ["web"] },
  ], shared_req_refs: [] })+'\n```\n');
  write(root, `${base}/ui-design/page-plan.md`, "# Pages\nPAGE-001 REQ-001 US-001 AC-001\n");
  write(root, "shared/api.json", "{}"); write(root, "src/shop/api/code.ts", "api"); write(root, "src/shop/web/code.ts", "web"); write(root, "src/other/code.ts", "other"); write(root, "package-lock.json", "{}");
  if (split) {
    const global = createInitialState("feature", "4.21.0", undefined, [], "global fixture");
    write(root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(global));
    state.workflow_kind = "module"; state.module_id = "shop"; state.parent_workflow_id = global.workflow_id;
    const other = createInitialState("feature", "4.21.0", undefined, [], "sibling sentinel");
    other.workflow_kind = "module"; other.module_id = "other"; other.parent_workflow_id = global.workflow_id;
    write(root, "aidlc/active/modules/other/aidlc-state.md", renderLightWorkflowState(other));
    const integration = createInitialState("feature", "4.21.0", undefined, [], "integration sentinel");
    integration.workflow_kind = "integration"; integration.parent_workflow_id = global.workflow_id;
    write(root, "aidlc/active/integration/aidlc-state.md", renderLightWorkflowState(integration));
    write(root, "aidlc/active/registry.md", renderRegistry({ version: "1", global_workflow_id: global.workflow_id,
      split_from_workflow_id: global.workflow_id, split_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      modules: [state, other].map(s => ({ module_id: s.module_id!, workflow_id: s.workflow_id, state_path: `aidlc/active/modules/${s.module_id}/aidlc-state.md`,
        status: s.status, current_stage: s.current_stage, inception_done: false, construction_done: false, owner: "-" })),
      integration: { workflow_id: integration.workflow_id, state_path: "aidlc/active/integration/aidlc-state.md", status: "running", current_stage: "-", barrier_ready: false, blocking: [] },
      shared_contracts: [], cross_module_requires: [],
    }));
  }
  const statePath = split ? "aidlc/active/modules/shop/aidlc-state.md" : "aidlc/active/aidlc-state.md";
  const persist = (value: WorkflowState = state) => write(root, statePath, renderLightWorkflowState(value));
  persist(); git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "fixture");
  git(root, "update-ref", "refs/remotes/origin/main", git(root, "rev-parse", "HEAD"));
  return { root, state, base, units, persist, statePath };
}
export function cli(root: string, args: string[], binding = process.env.AIDLC_SESSION_BINDING) {
  return spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, AIDLC_SESSION_BINDING: binding || "" },
  });
}
export function snapshot(root: string, prefix = ""): Record<string, string> {
  const result: Record<string,string> = {};
  for (const entry of readdirSync(join(root,prefix), { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const p = prefix ? `${prefix}/${entry.name}` : entry.name;
    if(entry.isDirectory()) Object.assign(result,snapshot(root,p)); else result[p] = readFileSync(join(root,p)).toString("base64");
  }
  return result;
}
