import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInitialState, saveWorkflowState, lightStatePath, loadWorkflowState, renderLightWorkflowState, type SessionBinding } from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { git, write, snapshot, repository } from "./mars244_fixture";
export { write, snapshot, git };

export function fixture(current = "state-template") {
  const root = mkdtempSync(join(tmpdir(), "aidlc-mars245-"));
  write(root, ".gitignore", "aidlc/\n.aidlc/\n");
  write(root, "docs/aidlc/ideation/module-manifest.json", { schema_version: 1, modules: [
    { module_id: "alpha", name: "Alpha", service_id: "alpha", paths: ["src/alpha"] },
    { module_id: "beta", name: "Beta", service_id: "beta", paths: ["src/beta"] },
  ] });
  write(root, "docs/aidlc/ideation/scenario-module-mapping.md", "# Mapping\nREQ-001 alpha; REQ-002 beta\n");
  write(root, "docs/aidlc/ideation/product-contracts.md", "# Contracts\n\n## 契约清单\n| 契约 ID | 类型 | 提供方 | 权威来源 | 版本/策略 | 兼容状态 | Owner |\n| --- | --- | --- | --- | --- | --- | --- |\n\n## 消费者状态\n| 契约 ID | 消费者 | 影响 | 状态 | 验证证据 |\n| --- | --- | --- | --- | --- |\n");
  write(root, "src/alpha/index.ts", "export const alpha = 1;\n");
  write(root, "src/beta/index.ts", "export const beta = 2;\n");
  git(root, "init", "-q"); git(root, "add", "."); git(root, "commit", "-qm", "source baseline");
  const baseline = git(root, "rev-parse", "HEAD");
  write(root, "README.md", "split regression\n");
  git(root, "add", "."); git(root, "commit", "-qm", "source current");
  const state = createInitialState("feature", "4.22.0", undefined, [], "MARS-245 real split");
  state.baseline_commit = git(root, "rev-parse", "HEAD"); state.baseline_source = "advanced";
  state.baseline_history = [baseline, state.baseline_commit];
  state.completed_stages = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
  state.completed_stage_instances = [...state.completed_stages, "application-design@module:alpha"];
  state.skipped_stage_instances = ["reverse-engineering@module:alpha", "reverse-engineering@module:beta"];
  state.current_stage_instance = current; state.current_stage = current.split("@")[0];
  state.current_module = current.includes("@module:") ? current.split("@module:")[1] : undefined;
  state.history = [
    { stage: "module-division", result: "completed", timestamp: state.created_at, instance_id: "module-division" },
    { stage: "application-design", result: "approved", user_input: "Approve", timestamp: state.created_at, instance_id: "application-design@module:alpha", module_id: "alpha" },
  ];
  saveWorkflowState(root, state, { kind: "global" }, { baselineWrite: true });
  const session = bindSession(root, { instance: current, owner: "maintainer", session: "split-A", expected: claimToken(undefined) });
  const revision = readSourceRevision(root);
  for (const module of ["alpha", "beta"]) write(root, `.aidlc/evidence/application-design/${module}/evidence.json`, {
    stage_instance: `application-design@module:${module}`, source_revision: revision, sentinel: "valid legacy proof",
  });
  write(root, ".aidlc/evidence/requirements-analysis/beta/evidence.json", { stage_instance: "requirements-analysis@module:beta", source_revision: { ...revision, worktree_digest: "stale" } });
  return { root, state: loadWorkflowState(root)!, session, sourceBytes: readFileSync(lightStatePath(root), "utf8") };
}

export function cli(root: string, args: string[], binding?: SessionBinding, fault?: string) {
  const env = { ...process.env, AIDLC_SESSION_BINDING: binding ? JSON.stringify(binding) : "", AIDLC_MODULE: "" };
  const command = fault
    ? [join(repository, "tests/mars245_fault_child.ts"), fault, ...args.slice(1)]
    : [join(repository, "bin/cli.ts"), ...args];
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), ...command], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  assert.ifError(result.error);
  const output = (result.stdout || result.stderr).trim();
  let directive: Record<string, any>;
  try { directive = JSON.parse(output); } catch { throw new Error(`${result.status}: ${output}\n${result.stderr}`); }
  return { status: result.status, directive, stderr: result.stderr };
}

export function expire(root: string, instance: string) {
  const state = loadWorkflowState(root)!;
  state.active_instances[instance].expires_at = "2000-01-01T00:00:00.000Z";
  // Fixture-only persisted clock boundary; never used by the product.
  write(root, "aidlc/active/aidlc-state.md", renderLightWorkflowState(state));
}
