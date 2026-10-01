import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState } from "../core/tools/aidlc-light-state";

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
  const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd, encoding: "utf8", env: { ...baseEnv, ...env } });
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  return { status: result.status ?? 1, directive: JSON.parse(text) as Record<string, unknown> };
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
  saveWorkflowState(project, state);
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
  assert.ok((single.directive.other_workflows as string[]).some((note) => note.startsWith(`module:${M01}: parked`)));

  console.log("split next module routing tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
