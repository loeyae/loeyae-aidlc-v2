/**
 * MARS-98 (4.13.0): workflow lineage protection.
 *
 * Reproduces the incident: one member splits workflow X and advances a module on main;
 * another member, on a checkout that predates X, starts workflow Y, splits it and merges
 * "keep local" — X disappears from aidlc/active silently. Now:
 * - next --scope / split refuse to create a second lineage next to one git tracks,
 *   unless --replace-lineage names it (recorded in Retired Lineages + LINEAGE_RETIRED);
 * - next / report / state verify refuse a workflow whose git history carries another
 *   lineage that was neither archived nor retired; state retire records the decision;
 * - state verify reports a state file whose Revision is lower than a committed one;
 * - a module state of another lineage mixed into the layout is rejected on every command;
 * - an archived lineage never counts as a conflict.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, loadWorkflowState, saveWorkflowState, type WorkflowRef } from "../core/tools/aidlc-light-state";
import { loadRegistry } from "../core/tools/aidlc-workflow-layout";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mars98-"));
const M01 = "m01-trade";
const M02 = "m02-product";
const M03 = "m03-merchant";
const M03_REF: WorkflowRef = { kind: "module", module_id: M03 };
const LINEAGE_X = "0b6f3c2a-7d41-4e8b-9a52-1c3d5e7f9a01";
const LINEAGE_Y = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const LINEAGE_Z = "9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a";
const GLOBAL_STAGES = ["workspace-detection", "product-inception", "module-division", "product-contracts", "scenario-module-mapping", "state-template"];
const M01_REF: WorkflowRef = { kind: "module", module_id: M01 };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "AI-DLC", GIT_AUTHOR_EMAIL: "aidlc@example.invalid", GIT_COMMITTER_NAME: "AI-DLC", GIT_COMMITTER_EMAIL: "aidlc@example.invalid" };

function run(cwd: string, args: string[]): { status: number; directive: Record<string, unknown> } {
  const env = { ...process.env };
  delete env.AIDLC_MODULE;
  const result = spawnSync(process.execPath, [tsx, cli, "orchestrate", ...args], { cwd, encoding: "utf8", env });
  const text = (result.stdout || "").trim() || (result.stderr || "").trim();
  return { status: result.status ?? 1, directive: JSON.parse(text) as Record<string, unknown> };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(project: string, path: string, content: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content, "utf8");
}

const MANIFEST = "docs/aidlc/ideation/module-manifest.json";

function declareM03(project: string): void {
  const manifest = JSON.parse(readFileSync(join(project, MANIFEST), "utf8"));
  manifest.modules.push({ module_id: M03, name: "Merchant", service_id: "merchant-service" });
  write(project, MANIFEST, JSON.stringify(manifest));
}

function fixture(name: string): string {
  const project = join(root, name);
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q", "-b", "main"]);
  git(project, ["config", "core.autocrlf", "false"]);
  write(project, "README.md", "REQ-BASE lineage fixture\n");
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
  return project;
}

/** A single-layout workflow that finished the global stages (written through the state API). */
function seedWorkflow(project: string, workflowId: string): void {
  const state = createInitialState("feature", "4.1.0", workflowId, [], `Deliver modules (${workflowId.slice(0, 8)})`);
  state.completed_stages = [...GLOBAL_STAGES];
  state.completed_stage_instances = [...GLOBAL_STAGES];
  state.skipped_stage_instances = [`reverse-engineering@module:${M01}`, `reverse-engineering@module:${M02}`];
  saveWorkflowState(project, state);
}

function bumpModule(project: string, times: number): number {
  for (let index = 0; index < times; index++) {
    const state = loadWorkflowState(project, M01_REF)!;
    saveWorkflowState(project, state, M01_REF);
  }
  return loadWorkflowState(project, M01_REF)!.revision;
}

function commitAll(project: string, message: string): string {
  git(project, ["add", "-A"]);
  git(project, ["commit", "-qm", message]);
  return git(project, ["rev-parse", "HEAD"]);
}

try {
  // ---- main: lineage X is split and m01 advances (Zhangyi). ----
  const project = fixture("team");
  const base = git(project, ["rev-parse", "HEAD"]);
  seedWorkflow(project, LINEAGE_X);
  const splitX = run(project, ["split", "--from", LINEAGE_X]);
  assert.equal(splitX.status, 0, JSON.stringify(splitX.directive));
  const m01Revision = bumpModule(project, 5);
  // A module added after the split gets its own work description (--work on creation only).
  declareM03(project);
  assert.equal(run(project, ["next", "--module", M03, "--work", "Merchant center"]).directive.kind, "run-stage");
  assert.equal(loadWorkflowState(project, M03_REF)!.work_description, "Merchant center");
  assert.match(String(run(project, ["next", "--module", M01, "--work", "Other"]).directive.message), /already exists; --work only describes a module workflow when next --module creates it/);
  const m03Revision = loadWorkflowState(project, M03_REF)!.revision;
  const progressCommit = commitAll(project, "lineage X: split and m01/m03 progress");
  // Registry version 2 keeps identity rows only: advancing a module never rewrites it.
  const registryText = readFileSync(join(project, "aidlc", "active", "registry.md"), "utf8");
  assert.match(registryText, /- Registry Version: 2\n/);
  assert.doesNotMatch(registryText, /Updated At|Current Stage|Barrier Ready/);
  assert.equal(run(project, ["next", "--module", M01]).directive.kind, "run-stage", "a single lineage keeps working");
  assert.equal(readFileSync(join(project, "aidlc", "active", "registry.md"), "utf8"), registryText, "advancing a module leaves registry.md untouched");
  assert.notEqual(loadWorkflowState(project, M01_REF)!.revision, m01Revision, "the module state itself was written");
  const clean = run(project, ["state", "verify"]);
  assert.equal(clean.directive.kind, "print", JSON.stringify(clean.directive));
  assert.match(String(clean.directive.message), /one lineage, no revision regressions/);
  git(project, ["checkout", "-q", "--", "."]);

  // ---- yuanli: a checkout that predates lineage X. ----
  git(project, ["checkout", "-q", "-b", "yuanli", base]);
  const refused = run(project, ["next", "--scope", "feature", "--work", "Second lineage"]);
  assert.equal(refused.directive.kind, "error", "next --scope must not start a second lineage");
  assert.match(String(refused.directive.message), /Starting a new workflow would create a second workflow lineage/);
  assert.match(String(refused.directive.message), new RegExp(`${LINEAGE_X} \\(seen in refs/heads/main \\(split\\)`));
  assert.match(String(refused.directive.retry_command), new RegExp(`--replace-lineage ${LINEAGE_X}$`));
  assert.equal(loadWorkflowState(project), null, "nothing written");

  // A workflow created by a pre-4.13 engine: split refuses to make it a second lineage.
  seedWorkflow(project, LINEAGE_Y);
  const splitY = run(project, ["split", "--from", LINEAGE_Y]);
  assert.equal(splitY.directive.kind, "error");
  assert.match(String(splitY.directive.message), new RegExp(`Splitting workflow ${LINEAGE_Y} would create a second workflow lineage.*${LINEAGE_X}`));
  assert.equal(loadWorkflowState(project, M01_REF), null, "split wrote nothing");
  const typo = run(project, ["split", "--from", LINEAGE_Y, "--replace-lineage", LINEAGE_Z]);
  assert.match(String(typo.directive.message), new RegExp(`--replace-lineage ${LINEAGE_Z}: no such active workflow lineage`));

  // Explicit replacement: split proceeds and records the retired lineage.
  const replaced = run(project, ["split", "--from", LINEAGE_Y, "--replace-lineage", LINEAGE_X]);
  assert.equal(replaced.status, 0, JSON.stringify(replaced.directive));
  assert.deepEqual(loadWorkflowState(project)!.retired_lineages, [LINEAGE_X]);
  const audit = readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8");
  assert.match(audit, new RegExp(`Event: LINEAGE_RETIRED\\n- Lineage: ${LINEAGE_X}`));
  assert.match(audit, new RegExp(`Replaced Lineages: ${LINEAGE_X}`));

  // ---- The incident: a pre-4.13 split (no retirement recorded) merged with "keep local". ----
  const statePath = join(project, "aidlc", "active", "aidlc-state.md");
  writeFileSync(statePath, readFileSync(statePath, "utf8").replace(/^- Retired Lineages: .*\n/m, ""), "utf8");
  commitAll(project, "lineage Y: split");
  git(project, ["merge", "-q", "-s", "ours", "--no-edit", "main"]);
  assert.equal(loadWorkflowState(project)!.workflow_id, LINEAGE_Y, "keep local replaced lineage X");

  const next = run(project, ["next", "--module", M01]);
  assert.equal(next.directive.kind, "error", "next refuses the replaced lineage");
  assert.match(String(next.directive.message), new RegExp(`Workflow lineage conflict: the active workflow is ${LINEAGE_Y}`));
  assert.match(String(next.directive.message), new RegExp(`last present at ${progressCommit}`));
  assert.match(String(next.directive.message), new RegExp(`${M01}: revision ${m01Revision}, running, current`));
  assert.match(String(next.directive.message), new RegExp(`git checkout ${progressCommit} -- aidlc/active`));
  const conflicts = next.directive.lineage_conflicts as { workflow_id: string; last_present_commit: string }[];
  assert.deepEqual(conflicts.map((item) => [item.workflow_id, item.last_present_commit]), [[LINEAGE_X, progressCommit]]);
  const report = run(project, ["report", "--stage", "requirements-analysis", "--module", M01, "--result", "completed"]);
  assert.equal(report.directive.kind, "error");
  assert.match(String(report.directive.message), /Workflow lineage conflict/);
  const verify = run(project, ["state", "verify"]);
  assert.equal(verify.directive.kind, "error");
  assert.equal(verify.status, 2);
  assert.deepEqual((verify.directive.lineage_conflicts as { workflow_id: string }[]).map((item) => item.workflow_id), [LINEAGE_X]);

  // ---- state adopt: carry m03 of lineage X over into lineage Y before retiring X. ----
  const adoptArgs = ["state", "adopt", "--module", M03, "--from", progressCommit, "--user-input", "Approve", "--reason", "keep Zhangyi's m03"];
  assert.match(String(run(project, ["state", "adopt", "--module", M03, "--from", progressCommit, "--reason", "x"]).directive.message), /--user-input must be exactly Approve/);
  assert.match(String(run(project, adoptArgs).directive.message), /not declared in docs\/aidlc\/ideation\/module-manifest\.json/);
  assert.match(String(run(project, ["state", "adopt", "--module", M01, "--from", progressCommit, "--user-input", "Approve", "--reason", "x"]).directive.message), /already has a workflow in the active lineage/);
  declareM03(project);
  const adopted = run(project, adoptArgs);
  assert.equal(adopted.directive.kind, "print", JSON.stringify(adopted.directive));
  assert.equal(adopted.directive.from_lineage, LINEAGE_X);
  assert.equal(adopted.directive.from_commit, progressCommit);
  const m03 = loadWorkflowState(project, M03_REF)!;
  assert.equal(m03.parent_workflow_id, LINEAGE_Y, "re-parented to the active lineage");
  assert.equal(m03.revision, m03Revision + 1, "revision continues");
  assert.equal(m03.work_description, "Merchant center");
  const m03Audit = readFileSync(join(project, "aidlc", "active", "modules", M03, "audit.md"), "utf8");
  assert.match(m03Audit, /Event: WORKFLOW_CREATED[\s\S]*Event: STATE_ADOPTED\n- Module: m03-merchant\n- Module Workflow ID: [^\n]+\n- From Lineage: 0b6f3c2a/, "history of the source audit is kept");
  assert.match(readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8"), new RegExp(`Event: STATE_ADOPTED[\\s\\S]*From Commit: ${progressCommit}`));
  assert.ok(loadRegistry(project)!.modules.some((row) => row.module_id === M03 && row.workflow_id === m03.workflow_id));
  assert.match(String(run(project, adoptArgs).directive.message), /already has a workflow in the active lineage/, "adopting twice is refused");
  commitAll(project, "adopt m03 from lineage X");

  // The decision is recorded explicitly; progress of X stays recoverable from git.
  assert.match(String(run(project, ["state", "retire", "--lineage", LINEAGE_X, "--reason", "keep Y"]).directive.message), /--user-input must be exactly Approve/);
  assert.match(String(run(project, ["state", "retire", "--lineage", LINEAGE_Y, "--user-input", "Approve", "--reason", "x"]).directive.message), /is the active lineage and cannot be retired/);
  const retire = run(project, ["state", "retire", "--lineage", LINEAGE_X, "--user-input", "Approve", "--reason", "keep Y, re-register m01"]);
  assert.equal(retire.directive.kind, "print", JSON.stringify(retire.directive));
  assert.match(String(retire.directive.message), new RegExp(`git show ${progressCommit}:./aidlc/active/aidlc-state.md`));
  assert.match(readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8"), /Event: LINEAGE_RETIRED\n- Lineage: [^\n]+\n- Trigger: orchestrate state retire\n- Last Present Commit: [0-9a-f]{40}\n- Seen In: [^\n]+\n- Reason: keep Y, re-register m01/);
  assert.equal(run(project, ["next", "--module", M01]).directive.kind, "run-stage", "a retired lineage no longer blocks");
  assert.equal(run(project, ["next", "--module", M03]).directive.kind, "run-stage", "the adopted module advances in the active lineage");
  const afterAdopt = run(project, ["state", "verify"]);
  assert.equal(afterAdopt.directive.kind, "print", JSON.stringify(afterAdopt.directive));

  // ---- Revision regression on lineage X (main). ----
  git(project, ["checkout", "-q", "-f", "main"]);
  const m01Path = join(project, "aidlc", "active", "modules", M01, "aidlc-state.md");
  writeFileSync(m01Path, readFileSync(m01Path, "utf8").replace(/^- Revision: \d+$/m, "- Revision: 1"), "utf8");
  const regressed = run(project, ["state", "verify"]);
  assert.equal(regressed.directive.kind, "error", JSON.stringify(regressed.directive));
  const regressions = regressed.directive.revision_regressions as { path: string; current_revision: number; committed_revision: number; commit: string; restore_command: string }[];
  assert.deepEqual(regressions.map((item) => [item.path, item.current_revision, item.committed_revision, item.commit]), [[`aidlc/active/modules/${M01}/aidlc-state.md`, 1, m01Revision, progressCommit]]);
  assert.equal(regressions[0].restore_command, `git show ${progressCommit}:./aidlc/active/modules/${M01}/aidlc-state.md`);
  // main's history never carried lineage Y; it is reported only as the active lineage at the tip of branch yuanli.
  const atTips = regressed.directive.lineage_conflicts as { workflow_id: string; sightings: { source: string; ref?: string }[] }[];
  assert.deepEqual(atTips.map((item) => [item.workflow_id, item.sightings.map((sighting) => `${sighting.source}:${sighting.ref}`)]), [[LINEAGE_Y, ["ref:refs/heads/yuanli"]]]);
  assert.equal(run(project, ["next", "--module", M01]).directive.kind, "run-stage", "next only checks the history of HEAD, not other branches");
  git(project, ["checkout", "-q", "--", "."]);

  // ---- Two lineages mixed file by file: every command rejects the layout. ----
  writeFileSync(m01Path, readFileSync(m01Path, "utf8").replace(/^- Parent Workflow ID: .*$/m, `- Parent Workflow ID: ${LINEAGE_Y}`), "utf8");
  const mixed = run(project, ["next", "--module", M01]);
  assert.equal(mixed.directive.kind, "error");
  assert.match(String(mixed.directive.message), new RegExp(`workflow lineage conflict: module workflow ${M01} .* belongs to lineage ${LINEAGE_Y}, but the registry and the global workflow are lineage ${LINEAGE_X}`));
  assert.match(String(run(project, ["state", "verify"]).directive.layout_error), /workflow lineage conflict/);
  git(project, ["checkout", "-q", "--", "."]);

  // ---- A 4.12 (version 1) registry is read and rewritten once as identity-only version 2. ----
  const identity = loadRegistry(project)!;
  const legacyRows = identity.modules.map((row) => `| ${row.module_id} | ${row.workflow_id} | ${row.state_path} | running | - | no | no | - |`).join("\n");
  const registryFile = join(project, "aidlc", "active", "registry.md");
  writeFileSync(registryFile, `# AI-DLC Workflow Registry\n\n- Registry Version: 1\n- Global Workflow ID: ${identity.global_workflow_id}\n- Split From Workflow ID: ${identity.split_from_workflow_id}\n- Split At: ${identity.split_at}\n- Updated At: 2026-10-07T00:00:00.000Z\n\n## Modules\n| Module | Workflow ID | State Path | Status | Current Stage | Inception Done | Construction Done | Owner |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${legacyRows}\n\n## Integration\n| Workflow ID | State Path | Status | Current Stage | Barrier Ready | Blocking |\n| --- | --- | --- | --- | --- | --- |\n| ${identity.integration.workflow_id} | ${identity.integration.state_path} | running | - | no | - |\n\n## Shared Contracts\n| Contract | Provider | Consumers | Verified | Source |\n| --- | --- | --- | --- | --- |\n| - | - | - | - | - |\n\n## Cross Module Requires\n| Consumer | Consumer Stage | Provider | Provider Stage | Satisfied | Source |\n| --- | --- | --- | --- | --- | --- |\n| - | - | - | - | - | - |\n`, "utf8");
  assert.equal(run(project, ["next", "--module", M01]).directive.kind, "run-stage", "a version-1 registry is still readable");
  assert.match(readFileSync(registryFile, "utf8"), /- Registry Version: 2\n/);
  assert.deepEqual(loadRegistry(project)!.modules.map((row) => [row.module_id, row.workflow_id]), identity.modules.map((row) => [row.module_id, row.workflow_id]).sort());
  git(project, ["checkout", "-q", "--", "."]);

  // ---- An archived lineage is not a conflict. ----
  const archived = fixture("archived");
  assert.equal(run(archived, ["next", "--scope", "express", "--work", "First work"]).directive.kind, "print");
  commitAll(archived, "first workflow");
  assert.equal(run(archived, ["park"]).directive.kind, "parked");
  assert.equal(run(archived, ["archive", "--reason", "done"]).directive.kind, "print");
  commitAll(archived, "archive first workflow");
  const second = run(archived, ["next", "--scope", "express", "--work", "Second work"]);
  assert.equal(second.directive.kind, "print", JSON.stringify(second.directive));
  assert.equal(run(archived, ["next"]).directive.kind !== "error", true);
  assert.equal(run(archived, ["state", "verify"]).directive.kind, "print");

  // ---- Outside git the checks are skipped. ----
  const plain = join(root, "plain");
  mkdirSync(plain, { recursive: true });
  assert.equal(run(plain, ["next", "--scope", "express", "--work", "No git"]).directive.kind, "print");
  const noGit = run(plain, ["state", "verify"]);
  assert.equal(noGit.directive.kind, "print");
  assert.equal(noGit.directive.git_available, false);

  console.log("MARS-98 lineage protection tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
