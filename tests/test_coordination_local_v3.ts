import assert from "node:assert/strict";
import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  LocalCoordinationProviderV3,
  assertClaimReceiptForStateV3,
  claimInstanceV3,
  clearAssignmentV3,
  expireClaimsV3,
  heartbeatClaimV3,
  releaseClaimV3,
  setAssignmentV3,
  transferClaimV3,
  type ClaimReceiptV3,
  type CoordinationIdentityV3,
} from "../core/tools/aidlc-coordination-local-v3";
import {
  reportInstanceV3,
  submitInstanceV3,
  synchronizeWorkflowInstancesV3,
  type WorkflowInstancePlanV3,
} from "../core/tools/aidlc-scheduler-v3";
import { initializeWorkflowStateV3, loadWorkflowStateV3 } from "../core/tools/aidlc-state-v3-store";
import { createInitialWorkflowStateV3, type WorkflowStateV3 } from "../core/tools/aidlc-state-v3";

const workerIndex = process.argv.indexOf("--claim-worker");
if (workerIndex >= 0) {
  const project = process.argv[workerIndex + 1];
  const device = process.argv[workerIndex + 2];
  try {
    const provider = new LocalCoordinationProviderV3(project, { default_lease_ms: 30_000 });
    const operation = provider.claim("parallel-task", {
      actor_id: "actor:race",
      device_id: device,
      client_id: `client:${device}`,
    });
    process.stdout.write(`${JSON.stringify(operation.receipt)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

const originalEnvironment = {
  trustDirectory: process.env.AIDLC_TRUST_DIR,
  trustSecret: process.env.AIDLC_TRUST_SECRET,
  collaboration: process.env.AIDLC_COLLABORATION_V3,
};
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-coordination-v3-"));
process.env.AIDLC_COLLABORATION_V3 = "1";
process.env.AIDLC_TRUST_SECRET = "coordination-v3-test-secret-at-least-32-bytes";

const plans: WorkflowInstancePlanV3[] = [
  { stage_instance: "task-a", stage: "task-a", axis: "project", requires: [], order: 0 },
  { stage_instance: "task-b", stage: "task-b", axis: "project", requires: [], order: 1 },
  { stage_instance: "task-c", stage: "task-c", axis: "project", requires: [], order: 2 },
];
let now = Date.parse("2026-12-12T00:00:00.000Z");
function tick(milliseconds = 1000): string {
  now += milliseconds;
  return new Date(now).toISOString();
}

const actorDeviceA: CoordinationIdentityV3 = {
  actor_id: "actor:alice",
  device_id: "device:alice-laptop",
  client_id: "client:session-a",
};
const actorDeviceB: CoordinationIdentityV3 = {
  actor_id: "actor:alice",
  device_id: "device:alice-desktop",
  client_id: "client:session-b",
};
const otherActor: CoordinationIdentityV3 = {
  actor_id: "actor:bob",
  device_id: "device:bob-laptop",
  client_id: "client:bob-session",
};

function initialState(workflowId: string, instancePlans = plans): WorkflowStateV3 {
  const created = createInitialWorkflowStateV3("feature", "2.4.0", workflowId, [], tick());
  return synchronizeWorkflowInstancesV3(created, instancePlans, tick());
}

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runClaimWorker(project: string, device: string): Promise<ChildResult> {
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const testFile = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, testFile, "--claim-worker", project, device], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  let state = initialState("workflow-local-coordination-v3");
  state = setAssignmentV3(
    state,
    "task-a",
    { actor_id: actorDeviceA.actor_id, external_work_item_id: "WORK-101" },
    "local-test",
    tick(),
  );
  assert.equal(state.instances["task-a"].assignment?.actor_id, actorDeviceA.actor_id);
  assert.equal(state.instances["task-a"].assignment?.external_work_item_id, "WORK-101");
  assert.throws(
    () => claimInstanceV3(state, "task-a", otherActor, "local-test", 30_000, tick()),
    /assigned to actor:alice, not actor:bob/,
  );

  let claim = claimInstanceV3(state, "task-a", actorDeviceA, "local-test", 30_000, tick());
  state = claim.state;
  const firstReceipt = claim.receipt;
  assert.equal(state.instances["task-a"].status, "in_progress");
  assert.equal(assertClaimReceiptForStateV3(state, firstReceipt, "task-a", now).device_id, actorDeviceA.device_id);

  const heartbeat = heartbeatClaimV3(state, firstReceipt, 45_000, tick());
  state = heartbeat.state;
  assert.equal(heartbeat.receipt.generation, 2);
  assert.throws(
    () => assertClaimReceiptForStateV3(state, firstReceipt, "task-a", now),
    /lease is stale|digest does not match/,
  );

  const transferred = transferClaimV3(state, heartbeat.receipt, actorDeviceB, 30_000, tick());
  state = transferred.state;
  assert.equal(state.instances["task-a"].claim?.device_id, actorDeviceB.device_id);
  assert.equal(state.instances["task-a"].claim?.actor_id, actorDeviceA.actor_id);
  assert.throws(
    () => assertClaimReceiptForStateV3(state, heartbeat.receipt, "task-a", now),
    /holder does not match|lease is stale|digest does not match/,
  );

  const forged = structuredClone(transferred.receipt);
  forged.device_id = "device:forged";
  assert.throws(
    () => assertClaimReceiptForStateV3(state, forged, "task-a", now),
    /claim receipt integrity failed/,
  );

  state = submitInstanceV3(state, plans, "task-a", transferred.receipt, tick());
  assert.throws(
    () => reportInstanceV3(state, plans, "task-a", heartbeat.receipt, "completed", tick()),
    /holder does not match|lease is stale|digest does not match/,
  );
  state = reportInstanceV3(state, plans, "task-a", transferred.receipt, "completed", tick());
  assert.equal(state.instances["task-a"].status, "completed");
  assert.throws(
    () => assertClaimReceiptForStateV3(state, transferred.receipt, "task-a", now),
    /no active claim/,
  );

  state = clearAssignmentV3(state, "task-b", "should fail", tick());
  assert.fail("clearing a missing assignment should have failed");
} catch (error) {
  if (!(error instanceof Error) || !/assignment_cleared requires an assignment/.test(error.message)) throw error;
}

try {
  let state = initialState("workflow-local-coordination-lifecycle");
  const claimed = claimInstanceV3(state, "task-b", actorDeviceA, "local-test", 10_000, tick());
  state = releaseClaimV3(claimed.state, claimed.receipt, "Switching devices", tick());
  assert.equal(state.instances["task-b"].status, "ready");
  assert.equal(state.instances["task-b"].claim, undefined);

  const expiring = claimInstanceV3(state, "task-b", actorDeviceB, "local-test", 5_000, tick());
  const expiresAt = Date.parse(expiring.receipt.lease_expires_at);
  state = expireClaimsV3(expiring.state, new Date(expiresAt + 1).toISOString());
  assert.equal(state.instances["task-b"].status, "ready");
  assert.throws(
    () => assertClaimReceiptForStateV3(state, expiring.receipt, "task-b", expiresAt + 1),
    /lease expired/,
  );

  const assigned = setAssignmentV3(state, "task-c", { actor_id: actorDeviceA.actor_id }, "local-test", tick());
  state = clearAssignmentV3(assigned, "task-c", "Work item unassigned", tick());
  assert.equal(state.instances["task-c"].assignment, undefined);

  const raceProject = join(root, "race-project");
  mkdirSync(raceProject, { recursive: true });
  process.env.AIDLC_TRUST_DIR = join(root, "race-trust");
  const racePlans: WorkflowInstancePlanV3[] = [
    { stage_instance: "parallel-task", stage: "parallel-task", axis: "project", requires: [], order: 0 },
  ];
  initializeWorkflowStateV3(raceProject, initialState("workflow-local-provider-race", racePlans));
  const results = await Promise.all([
    runClaimWorker(raceProject, "device:race-a"),
    runClaimWorker(raceProject, "device:race-b"),
  ]);
  const successes = results.filter((result) => result.code === 0);
  const failures = results.filter((result) => result.code !== 0);
  assert.equal(successes.length, 1, `exactly one concurrent claimant must succeed: ${JSON.stringify(results)}`);
  assert.equal(failures.length, 1);
  assert.match(failures[0].stderr, /not ready for claim.*in_progress/);
  const winningReceipt = JSON.parse(successes[0].stdout.trim()) as ClaimReceiptV3;
  const persisted = loadWorkflowStateV3(raceProject);
  assert.ok(persisted);
  assert.equal(persisted.instances["parallel-task"].status, "in_progress");
  assert.equal(persisted.instances["parallel-task"].claim?.device_id, winningReceipt.device_id);
  assert.equal(persisted.revision, 2, "initialization and exactly one atomic claim must each advance revision once");

  console.log("Local coordination claims, leases, identity, and race tests passed");
} finally {
  if (originalEnvironment.trustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalEnvironment.trustDirectory;
  if (originalEnvironment.trustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalEnvironment.trustSecret;
  if (originalEnvironment.collaboration === undefined) delete process.env.AIDLC_COLLABORATION_V3;
  else process.env.AIDLC_COLLABORATION_V3 = originalEnvironment.collaboration;
  rmSync(root, { recursive: true, force: true });
}
