import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import type { ClaimReceiptV3 } from "../core/tools/aidlc-coordination-local-v3";
import { LocalCoordinationProviderV3 } from "../core/tools/aidlc-coordination-local-v3";
import { appendWorkflowEventV3, createInitialWorkflowStateV3 } from "../core/tools/aidlc-state-v3";
import { initializeWorkflowStateV3, mutateWorkflowStateV3 } from "../core/tools/aidlc-state-v3-store";
import { synchronizeWorkflowInstancesV3, type WorkflowInstancePlanV3 } from "../core/tools/aidlc-scheduler-v3";

const root = resolve(import.meta.dirname, "..");
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(root, "bin", "cli.ts");
const sandbox = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-cli-v3-"));

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(project: string, trust: string, args: string[], input?: string, extraEnv: NodeJS.ProcessEnv = {}): CliResult {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], {
    cwd: project,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      AIDLC_TRUST_DIR: trust,
      AIDLC_TRUST_SECRET: "cli-v3-integration-secret-at-least-32-bytes",
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function success(project: string, trust: string, args: string[], input?: string, extraEnv: NodeJS.ProcessEnv = {}): Record<string, unknown> {
  const result = run(project, trust, args, input, extraEnv);
  assert.equal(result.status, 0, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function state(project: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(project, "docs", "aidlc", "aidlc-state.json"), "utf8")) as Record<string, unknown>;
}

try {
  const collaborativeProject = join(sandbox, "collaborative");
  const collaborativeTrust = join(sandbox, "collaborative-trust");
  mkdirSync(collaborativeProject, { recursive: true });

  const initialized = success(collaborativeProject, collaborativeTrust, [
    "orchestrate", "next", "--scope", "express",
    "--actor-id", "actor:alice", "--device-id", "device:laptop", "--client-id", "client:session-a",
  ]);
  assert.equal(initialized.schema_version, 3);
  assert.equal(state(collaborativeProject).schema_version, 3);
  assert.equal(state(collaborativeProject).version, "3.0.0");

  const first = success(collaborativeProject, collaborativeTrust, [
    "orchestrate", "next",
    "--actor-id", "actor:alice", "--device-id", "device:laptop", "--client-id", "client:session-a",
  ]);
  assert.equal(first.kind, "run-stage");
  assert.equal(first.stage_instance, "workspace-detection");
  const firstReceipt = first.claim_receipt as ClaimReceiptV3;
  assert.equal(firstReceipt.client_id, "client:session-a");

  const second = success(collaborativeProject, collaborativeTrust, [
    "orchestrate", "next",
    "--actor-id", "actor:bob", "--device-id", "device:desktop", "--client-id", "client:session-b",
  ]);
  assert.equal(second.kind, "run-stage");
  assert.notEqual(second.stage_instance, first.stage_instance, "independent clients must claim distinct ready instances");
  const instances = state(collaborativeProject).instances as Record<string, { status: string }>;
  assert.equal(instances[String(first.stage_instance)].status, "in_progress");
  assert.equal(instances[String(second.stage_instance)].status, "in_progress");

  const missingReceipt = run(collaborativeProject, collaborativeTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", "workspace-detection",
    "--result", "completed", "--instruction-ack", "workspace-detection",
  ]);
  assert.notEqual(missingReceipt.status, 0);
  assert.match(missingReceipt.stderr, /requires --claim-receipt-stdin/);

  const forged = structuredClone(firstReceipt);
  forged.device_id = "device:forged";
  const rejected = run(collaborativeProject, collaborativeTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", "workspace-detection",
    "--result", "completed", "--instruction-ack", "workspace-detection", "--claim-receipt-stdin",
  ], JSON.stringify(forged));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /claim receipt integrity failed/);

  const completed = success(collaborativeProject, collaborativeTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", "workspace-detection",
    "--result", "completed", "--instruction-ack", "workspace-detection", "--claim-receipt-stdin",
  ], JSON.stringify(firstReceipt));
  assert.equal(completed.result, "completed");

  const stale = run(collaborativeProject, collaborativeTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", "workspace-detection",
    "--result", "completed", "--instruction-ack", "workspace-detection", "--claim-receipt-stdin",
  ], JSON.stringify(firstReceipt));
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /no active claim|not in_progress/);

  const parked = success(collaborativeProject, collaborativeTrust, ["orchestrate", "park", "--reason", "integration freeze"]);
  assert.equal(parked.kind, "parked");
  assert.equal(state(collaborativeProject).status, "parked");
  const frozenNext = success(collaborativeProject, collaborativeTrust, ["orchestrate", "next"]);
  assert.equal(frozenNext.kind, "parked");
  const resumed = success(collaborativeProject, collaborativeTrust, ["orchestrate", "next", "--resume", "--status"]);
  assert.equal(resumed.status, "running");
  assert.equal(state(collaborativeProject).status, "running");

  const runningHook = success(collaborativeProject, collaborativeTrust, ["hook", "--format", "claude"]);
  assert.equal(runningHook.decision, "block");
  assert.match(String(runningHook.reason), /cannot invent actor\/device\/client identity|receipt-bound/);
  success(collaborativeProject, collaborativeTrust, ["orchestrate", "park", "--reason", "hook allow check"]);
  const parkedHook = run(collaborativeProject, collaborativeTrust, ["hook", "--format", "claude"]);
  assert.equal(parkedHook.status, 0);
  assert.equal(parkedHook.stdout, "");

  const approvalProject = join(sandbox, "approval");
  const approvalTrust = join(sandbox, "approval-trust");
  mkdirSync(approvalProject, { recursive: true });
  const previousTrustDirectory = process.env.AIDLC_TRUST_DIR;
  const previousTrustSecret = process.env.AIDLC_TRUST_SECRET;
  process.env.AIDLC_TRUST_DIR = approvalTrust;
  process.env.AIDLC_TRUST_SECRET = "cli-v3-integration-secret-at-least-32-bytes";
  try {
    const approvalInstance = "application-design@module:module-a";
    const approvalPlans: WorkflowInstancePlanV3[] = [{
      stage_instance: approvalInstance,
      stage: "application-design",
      axis: "module",
      module_id: "module-a",
      requires: [],
      order: 0,
    }];
    const created = createInitialWorkflowStateV3("feature", "3.0.0", "workflow-cli-v3-approval");
    initializeWorkflowStateV3(approvalProject, synchronizeWorkflowInstancesV3(created, approvalPlans));
    new LocalCoordinationProviderV3(approvalProject).claim(approvalInstance, {
      actor_id: "actor:approver",
      device_id: "device:approver",
      client_id: "client:approver",
    });
    mutateWorkflowStateV3(approvalProject, (current) => appendWorkflowEventV3(current, {
      event_type: "approval_requested",
      stage_instance: approvalInstance,
      occurred_at: new Date().toISOString(),
      payload: { challenge: `${Date.now()}.cli-v3-approval-challenge` },
    }));

    const missingInstance = run(approvalProject, approvalTrust, ["approve", "--stage", "application-design", "--request"]);
    assert.notEqual(missingInstance.status, 0);
    assert.match(missingInstance.stderr, /requires --instance/);
    const approvalRequest = success(approvalProject, approvalTrust, [
      "approve", "--stage", "application-design", "--instance", approvalInstance, "--request",
    ]);
    assert.equal(approvalRequest.kind, "aidlc.approval.request");
    assert.equal(approvalRequest.stage_instance, approvalInstance);
    const nonTty = run(approvalProject, approvalTrust, [
      "approve", "--stage", "application-design", "--instance", approvalInstance,
    ]);
    assert.notEqual(nonTty.status, 0);
    assert.match(nonTty.stderr, /interactive human terminal/);
  } finally {
    if (previousTrustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
    else process.env.AIDLC_TRUST_DIR = previousTrustDirectory;
    if (previousTrustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
    else process.env.AIDLC_TRUST_SECRET = previousTrustSecret;
  }

  const legacyProject = join(sandbox, "legacy");
  const legacyTrust = join(sandbox, "legacy-trust");
  mkdirSync(legacyProject, { recursive: true });
  const legacyEnvironment = { AIDLC_COLLABORATION_V3: "0" };
  success(legacyProject, legacyTrust, ["orchestrate", "next", "--scope", "express"], undefined, legacyEnvironment);
  assert.equal(state(legacyProject).schema_version, 2);

  const legacyDirective = success(legacyProject, legacyTrust, ["orchestrate", "next"], undefined, {
    AIDLC_COLLABORATION_V3: "1",
  });
  assert.equal(legacyDirective.kind, "run-stage", "existing schema v2 state must stay on the compatibility engine");
  assert.equal(legacyDirective.stage_instance, "workspace-detection");

  const dryRun = success(legacyProject, legacyTrust, [
    "state", "migrate-v3", "--actor-id", "actor:migrator", "--device-id", "device:migrator", "--client-id", "client:migrator",
  ]);
  assert.equal(dryRun.applied, false);
  assert.equal(state(legacyProject).schema_version, 2, "migration must be dry-run by default");

  const applied = success(legacyProject, legacyTrust, [
    "state", "migrate-v3", "--apply", "--actor-id", "actor:migrator", "--device-id", "device:migrator", "--client-id", "client:migrator",
  ]);
  assert.equal(applied.applied, true);
  assert.equal(state(legacyProject).schema_version, 3);
  const migratedStatus = success(legacyProject, legacyTrust, ["orchestrate", "next", "--status"]);
  assert.equal(migratedStatus.schema_version, 3);

  console.log("Schema-aware v3 CLI integration tests passed");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
