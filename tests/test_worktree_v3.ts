import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalCoordinationProviderV3 } from "../core/tools/aidlc-coordination-local-v3";
import { synchronizeWorkflowInstancesV3, type WorkflowInstancePlanV3 } from "../core/tools/aidlc-scheduler-v3";
import { createInitialWorkflowStateV3 } from "../core/tools/aidlc-state-v3";
import { initializeWorkflowStateV3 } from "../core/tools/aidlc-state-v3-store";
import { readSourceRevision } from "../core/tools/aidlc-revision";
import { signTeamRecord } from "../core/tools/aidlc-trust";
import { createV3WorktreeMergePlan, prepareV3Worktree } from "../core/tools/aidlc-worktree-v3";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const root = join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), `aidlc-worktree-${process.pid}`);
const project = join(root, "project");
const worktree = join(root, "worker");
const trust = join(root, "trust");
const originalTrust = process.env.AIDLC_TRUST_DIR;
const originalSecret = process.env.AIDLC_TRUST_SECRET;

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC Worktree Test",
      GIT_AUTHOR_EMAIL: "worktree@example.invalid",
      GIT_COMMITTER_NAME: "AI-DLC Worktree Test",
      GIT_COMMITTER_EMAIL: "worktree@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout || ""}\n${result.stderr || ""}`);
  return (result.stdout || "").trim();
}

function writeReviewEvidence(path: string, stageInstance: string): void {
  const revision = readSourceRevision(worktree);
  assert.equal(revision.dirty, false);
  const record = {
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    stage_instance: stageInstance,
    module_id: "module-a",
    unit_id: "unit-a",
    status: "passed",
    spec_axis: "passed",
    standards_axis: "passed",
    reviewer: "reviewer:worktree-test",
    files_reviewed: ["src/unit.ts"],
    issues_found: 0,
    issues_resolved: 0,
    issues_open: 0,
    source_revision: revision,
  };
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...record, integrity: signTeamRecord(record) }, null, 2)}\n`, "utf8");
}

try {
  process.env.AIDLC_TRUST_DIR = trust;
  delete process.env.AIDLC_TRUST_SECRET;
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-q"]);
  git(project, ["config", "user.email", "worktree@example.invalid"]);
  git(project, ["config", "user.name", "AI-DLC Worktree Test"]);
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "src", "unit.ts"), "export const value = 1;\n", "utf8");
  git(project, ["add", "src/unit.ts"]);
  git(project, ["commit", "-qm", "base source"]);

  const instance = "code-generation@module:module-a@unit:unit-a";
  const plans: WorkflowInstancePlanV3[] = [{
    stage_instance: instance,
    stage: "code-generation",
    axis: "unit",
    module_id: "module-a",
    unit_id: "unit-a",
    requires: [],
    order: 0,
  }];
  const initial = synchronizeWorkflowInstancesV3(createInitialWorkflowStateV3("feature", "3.0.0", "worktree-workflow"), plans);
  initializeWorkflowStateV3(project, initial);
  const claim = new LocalCoordinationProviderV3(project).claim(instance, {
    actor_id: "actor:worktree",
    device_id: "device:worktree",
    client_id: "client:worktree",
  });

  const prepared = prepareV3Worktree(project, instance, claim.receipt, worktree);
  assert.ok(existsSync(prepared.registry_path));
  assert.ok(existsSync(prepared.worktree_metadata_path));
  assert.equal(prepared.metadata.authoritative, false);
  assert.equal(prepared.metadata.claim_receipt_digest.length, 64);
  assert.match(prepared.metadata.branch, /^aidlc-worktree\//);

  writeFileSync(join(worktree, "src", "unit.ts"), "export const value = 2;\n", "utf8");
  git(worktree, ["add", "src/unit.ts"]);
  git(worktree, ["commit", "-qm", "implement unit"]);

  const reviewPath = join(worktree, ".aidlc", "evidence", "code-review", "module-a", "unit-a", "review-evidence.json");
  writeReviewEvidence(reviewPath, instance);
  const plan = createV3WorktreeMergePlan(project, instance, claim.receipt, worktree, ".aidlc/evidence/code-review/module-a/unit-a/review-evidence.json");
  assert.equal(plan.authorized, false);
  assert.deepEqual(plan.changed_paths, ["src/unit.ts"]);
  assert.match(plan.merge_command, /git -C/);
  assert.match(plan.merge_command, /merge --no-ff/);

  const cliPlan = spawnSync(process.execPath, [tsx, cli, "worktree", "merge-plan", "--instance", instance, "--path", worktree, "--review-evidence", ".aidlc/evidence/code-review/module-a/unit-a/review-evidence.json", "--claim-receipt-stdin"], {
    cwd: project,
    input: JSON.stringify(claim.receipt),
    encoding: "utf8",
    env: { ...process.env, AIDLC_TRUST_DIR: trust },
  });
  assert.equal(cliPlan.status, 0, `${cliPlan.stdout || ""}\n${cliPlan.stderr || ""}`);
  assert.equal((JSON.parse(cliPlan.stdout) as { kind: string }).kind, "aidlc.v3-worktree.merge-plan");

  const uncoveredPath = join(worktree, ".aidlc", "evidence", "code-review", "module-a", "unit-a", "uncovered.json");
  const revision = readSourceRevision(worktree);
  const uncovered = {
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    stage_instance: instance,
    module_id: "module-a",
    unit_id: "unit-a",
    status: "passed",
    spec_axis: "passed",
    standards_axis: "passed",
    reviewer: "reviewer:worktree-test",
    files_reviewed: ["src/other.ts"],
    issues_found: 0,
    issues_resolved: 0,
    issues_open: 0,
    source_revision: revision,
  };
  writeFileSync(uncoveredPath, `${JSON.stringify({ ...uncovered, integrity: signTeamRecord(uncovered) }, null, 2)}\n`, "utf8");
  assert.throws(
    () => createV3WorktreeMergePlan(project, instance, claim.receipt, worktree, ".aidlc/evidence/code-review/module-a/unit-a/uncovered.json"),
    /does not cover all committed worktree changes/,
  );

  const forged = structuredClone(claim.receipt);
  forged.device_id = "device:forged";
  assert.throws(
    () => createV3WorktreeMergePlan(project, instance, forged, worktree, ".aidlc/evidence/code-review/module-a/unit-a/review-evidence.json"),
    /claim receipt integrity failed/,
  );

  console.log("V3 worktree adapter tests passed");
} finally {
  if (originalTrust === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalTrust;
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
