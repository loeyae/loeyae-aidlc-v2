import assert from "node:assert/strict";
import { createHash, randomUUID } from "crypto";
import { spawn, spawnSync } from "child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  GitCoordinationProviderV3,
  gitCoordinationRef,
  validateGitCoordinationEventV3,
  type GitClaimResultV3,
  type GitCoordinationEventV3,
} from "../core/tools/aidlc-coordination-git-v3";
import {
  claimReceiptDigestV3,
  type ClaimReceiptV3,
} from "../core/tools/aidlc-coordination-local-v3";
import { canonicalPayload, signRecord } from "../core/tools/aidlc-trust";

const workerIndex = process.argv.indexOf("--git-claim-worker");
if (workerIndex >= 0) {
  const remote = process.argv[workerIndex + 1];
  const workflowId = process.argv[workerIndex + 2];
  const device = process.argv[workerIndex + 3];
  try {
    const provider = new GitCoordinationProviderV3({ remote, workflow_id: workflowId, default_lease_ms: 30_000 });
    const result = provider.claim("parallel-instance", {
      actor_id: "actor:git-race",
      device_id: device,
      client_id: `client:${device}`,
    }, 30_000, "2027-01-01T00:00:00.000Z");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

const originalSecret = process.env.AIDLC_TRUST_SECRET;
const originalTrustDirectory = process.env.AIDLC_TRUST_DIR;
process.env.AIDLC_TRUST_SECRET = "git-coordination-test-secret-at-least-32-bytes";
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-git-provider-"));
process.env.AIDLC_TRUST_DIR = join(root, "trust");

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "AI-DLC Test",
      GIT_AUTHOR_EMAIL: "test@loeyae.invalid",
      GIT_COMMITTER_NAME: "AI-DLC Test",
      GIT_COMMITTER_EMAIL: "test@loeyae.invalid",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || "").trim();
}

function bare(name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  git(path, ["init", "--bare", "--quiet"]);
  return path;
}

function legacyHmacLog(workflowId: string, providerId: string): { events: GitCoordinationEventV3[]; receipt: ClaimReceiptV3 } {
  const receiptUnsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.claim.receipt",
    workflow_id: workflowId,
    stage_instance: "legacy-task",
    claim_id: randomUUID(),
    actor_id: "actor:legacy-owner",
    device_id: "device:legacy-owner",
    client_id: "client:legacy-owner",
    provider_id: providerId,
    issued_at: "2027-01-02T00:00:00.000Z",
    lease_expires_at: "2027-01-02T00:01:00.000Z",
    generation: 1,
  };
  const receipt = {
    ...receiptUnsigned,
    integrity: signRecord(receiptUnsigned, true),
  } as ClaimReceiptV3;
  const claimedUnsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.git-coordination.event",
    workflow_id: workflowId,
    sequence: 1,
    event_id: randomUUID(),
    previous_event_hash: null,
    event_type: "instance_claimed",
    stage_instance: "legacy-task",
    occurred_at: "2027-01-02T00:00:00.000Z",
    payload: { receipt },
  };
  const claimed = validateGitCoordinationEventV3({
    ...claimedUnsigned,
    integrity: signRecord(claimedUnsigned, true),
  }, true);
  const releasedUnsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.git-coordination.event",
    workflow_id: workflowId,
    sequence: 2,
    event_id: randomUUID(),
    previous_event_hash: createHash("sha256").update(canonicalPayload(claimed)).digest("hex"),
    event_type: "instance_released",
    stage_instance: "legacy-task",
    occurred_at: "2027-01-02T00:00:01.000Z",
    payload: {
      claim_id: receipt.claim_id,
      receipt_digest: claimReceiptDigestV3(receipt),
      reason: "legacy handoff complete",
    },
  };
  const released = validateGitCoordinationEventV3({
    ...releasedUnsigned,
    integrity: signRecord(releasedUnsigned, true),
  }, true);
  return { events: [claimed, released], receipt };
}

function pushCoordinationLog(remote: string, workflowId: string, events: readonly GitCoordinationEventV3[], name: string): void {
  const work = join(root, name);
  mkdirSync(work);
  git(work, ["init", "--quiet"]);
  git(work, ["remote", "add", "origin", remote]);
  writeFileSync(join(work, "events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  git(work, ["add", "events.ndjson"]);
  git(work, ["commit", "--quiet", "-m", "legacy coordination log"]);
  git(work, ["push", "--quiet", "origin", `HEAD:${gitCoordinationRef(workflowId)}`]);
}

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runWorker(remote: string, workflowId: string, device: string): Promise<ChildResult> {
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const testFile = fileURLToPath(import.meta.url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, testFile, "--git-claim-worker", remote, workflowId, device], {
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
  const remote = bare("coordination.git");
  const workflowId = "workflow-git-provider";
  const provider = new GitCoordinationProviderV3({ remote, workflow_id: workflowId, scratch_root: root, default_lease_ms: 30_000 });
  assert.equal(provider.coordination_ref, `refs/heads/aidlc/coordination/${workflowId}`);
  assert.deepEqual(provider.snapshot().events, []);

  const first = provider.claim("module-a@unit:unit-a", {
    actor_id: "actor:alice",
    device_id: "device:laptop",
    client_id: "client:laptop-session",
  }, 30_000, "2027-01-01T00:00:00.000Z");
  assert.match(first.remote_commit, /^[a-f0-9]{40,64}$/);
  assert.equal(first.coordination_ref, provider.coordination_ref);
  assert.equal(provider.currentReceipt("module-a@unit:unit-a")?.claim_id, first.receipt.claim_id);
  assert.throws(
    () => provider.claim("module-a@unit:unit-a", {
      actor_id: "actor:bob",
      device_id: "device:bob",
      client_id: "client:bob",
    }, 30_000, "2027-01-01T00:00:01.000Z"),
    /already has an active remote claim/,
  );

  const renewed = provider.heartbeat(first.receipt, 30_000, "2027-01-01T00:00:02.000Z");
  assert.equal(renewed.receipt.generation, 2);
  assert.throws(
    () => provider.release(first.receipt, "stale release", "2027-01-01T00:00:03.000Z"),
    /remote claim receipt is stale/,
  );
  const transferred = provider.transfer(renewed.receipt, {
    actor_id: "actor:alice",
    device_id: "device:desktop",
    client_id: "client:desktop-session",
  }, 30_000, "2027-01-01T00:00:04.000Z");
  assert.equal(transferred.receipt.device_id, "device:desktop");
  assert.notEqual(transferred.receipt.claim_id, renewed.receipt.claim_id);
  provider.release(transferred.receipt, "handoff complete", "2027-01-01T00:00:05.000Z");
  assert.equal(provider.receiptTerminalStatus(transferred.receipt), "released");
  assert.equal(provider.currentReceipt("module-a@unit:unit-a"), null);

  const completing = provider.claim("module-a@unit:unit-a", {
    actor_id: "actor:alice",
    device_id: "device:desktop",
    client_id: "client:desktop-session-2",
  }, 30_000, "2027-01-01T00:00:06.000Z");
  provider.complete(completing.receipt, "2027-01-01T00:00:07.000Z");
  assert.equal(provider.receiptTerminalStatus(completing.receipt), "completed");
  assert.ok(provider.snapshot().completed_instances.includes("module-a@unit:unit-a"));
  assert.throws(
    () => provider.claim("module-a@unit:unit-a", {
      actor_id: "actor:alice",
      device_id: "device:desktop",
      client_id: "client:again",
    }, 30_000, "2027-01-01T00:00:08.000Z"),
    /already completed/,
  );

  const refs = git(remote, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  assert.deepEqual(refs, [provider.coordination_ref], "Git Provider must not create or update business main/master refs");

  const raceRemote = bare("race.git");
  const raceWorkflow = "workflow-git-race";
  const raceResults = await Promise.all([
    runWorker(raceRemote, raceWorkflow, "device:race-a"),
    runWorker(raceRemote, raceWorkflow, "device:race-b"),
  ]);
  const raceSuccesses = raceResults.filter((result) => result.code === 0);
  const raceFailures = raceResults.filter((result) => result.code !== 0);
  assert.equal(raceSuccesses.length, 1, `exactly one remote claim must be acknowledged: ${JSON.stringify(raceResults)}`);
  assert.equal(raceFailures.length, 1);
  assert.match(raceFailures[0].stderr, /active remote claim|CAS conflict|remote rejection/);
  const raceWinner = JSON.parse(raceSuccesses[0].stdout.trim()) as GitClaimResultV3;
  const raceProvider = new GitCoordinationProviderV3({ remote: raceRemote, workflow_id: raceWorkflow, scratch_root: root });
  const raceSnapshot = raceProvider.snapshot();
  assert.equal(raceSnapshot.events.length, 1);
  assert.equal(raceSnapshot.claims["parallel-instance"].receipt.claim_id, raceWinner.receipt.claim_id);
  assert.deepEqual(
    git(raceRemote, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean),
    [gitCoordinationRef(raceWorkflow)],
  );

  const rejectedRemote = bare("rejected.git");
  const hook = join(rejectedRemote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho coordination push rejected >&2\nexit 1\n", { mode: 0o700 });
  chmodSync(hook, 0o700);
  const rejectedProvider = new GitCoordinationProviderV3({
    remote: rejectedRemote,
    workflow_id: "workflow-git-rejected",
    scratch_root: root,
  });
  assert.throws(
    () => rejectedProvider.claim("task", {
      actor_id: "actor:alice",
      device_id: "device:laptop",
      client_id: "client:rejected",
    }, 30_000, "2027-01-01T00:00:00.000Z"),
    /no claim receipt was acknowledged/,
  );
  assert.equal(git(rejectedRemote, ["for-each-ref", "--format=%(refname)"]), "");

  const tamperedRemote = bare("tampered.git");
  const tamperedWorkflow = "workflow-git-tampered";
  const tamperedProvider = new GitCoordinationProviderV3({ remote: tamperedRemote, workflow_id: tamperedWorkflow, scratch_root: root });
  tamperedProvider.claim("task", {
    actor_id: "actor:alice",
    device_id: "device:laptop",
    client_id: "client:tamper",
  }, 30_000, "2027-01-01T00:00:00.000Z");
  const tamperWork = join(root, "tamper-work");
  mkdirSync(tamperWork);
  git(tamperWork, ["init", "--quiet"]);
  git(tamperWork, ["remote", "add", "origin", tamperedRemote]);
  git(tamperWork, ["fetch", "--quiet", "origin", gitCoordinationRef(tamperedWorkflow)]);
  git(tamperWork, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const logPath = join(tamperWork, "events.ndjson");
  const originalLog = readFileSync(logPath, "utf8");
  writeFileSync(logPath, originalLog.replace("actor:alice", "actor:mallory"));
  git(tamperWork, ["add", "events.ndjson"]);
  git(tamperWork, ["commit", "--quiet", "-m", "tamper coordination log"]);
  git(tamperWork, ["push", "--quiet", "--force", "origin", `HEAD:${gitCoordinationRef(tamperedWorkflow)}`]);
  assert.throws(() => tamperedProvider.snapshot(), /integrity failed/);

  const legacyRemote = bare("legacy-hmac.git");
  const legacyWorkflow = "workflow-git-legacy-hmac";
  const ownerTrust = join(root, "legacy-owner-trust");
  const memberTrust = join(root, "legacy-member-trust");
  process.env.AIDLC_TRUST_SECRET = "git-coordination-test-secret-at-least-32-bytes";
  process.env.AIDLC_TRUST_DIR = ownerTrust;
  const legacyProvider = new GitCoordinationProviderV3({
    remote: legacyRemote,
    workflow_id: legacyWorkflow,
    scratch_root: root,
    default_lease_ms: 30_000,
  });
  const legacy = legacyHmacLog(legacyWorkflow, legacyProvider.provider_id);
  assert.ok(legacy.events.every((event) => event.integrity.algorithm === "hmac-sha256"));
  pushCoordinationLog(legacyRemote, legacyWorkflow, legacy.events, "legacy-hmac-work");

  delete process.env.AIDLC_TRUST_SECRET;
  process.env.AIDLC_TRUST_DIR = memberTrust;
  const unenrolledMember = new GitCoordinationProviderV3({
    remote: legacyRemote,
    workflow_id: legacyWorkflow,
    scratch_root: root,
  });
  assert.throws(
    () => unenrolledMember.snapshot(),
    /legacy HMAC coordination logs must first be opened and mutated once by an original trusted client/,
  );

  process.env.AIDLC_TRUST_SECRET = "git-coordination-test-secret-at-least-32-bytes";
  process.env.AIDLC_TRUST_DIR = ownerTrust;
  const upgradedOwner = new GitCoordinationProviderV3({
    remote: legacyRemote,
    workflow_id: legacyWorkflow,
    scratch_root: root,
    default_lease_ms: 30_000,
  });
  upgradedOwner.claim("team-task", {
    actor_id: "actor:owner",
    device_id: "device:owner",
    client_id: "client:owner",
  }, 30_000, "2027-01-02T00:00:02.000Z");
  assert.equal(existsSync(join(ownerTrust, "trust.key")), false);

  delete process.env.AIDLC_TRUST_SECRET;
  process.env.AIDLC_TRUST_DIR = memberTrust;
  const migratedSnapshot = new GitCoordinationProviderV3({
    remote: legacyRemote,
    workflow_id: legacyWorkflow,
    scratch_root: root,
  }).snapshot();
  assert.equal(migratedSnapshot.events.length, 3);
  assert.deepEqual(
    migratedSnapshot.events.slice(0, 2).map((event) => event.event_id),
    legacy.events.map((event) => event.event_id),
    "migration must preserve legacy event identities and business semantics",
  );
  assert.ok(migratedSnapshot.events.every((event) => event.integrity.algorithm === "ed25519"));
  assert.equal(
    ((migratedSnapshot.events[0].payload.receipt as ClaimReceiptV3).integrity).algorithm,
    "ed25519",
  );
  assert.ok(migratedSnapshot.claims["team-task"]);
  assert.equal(existsSync(join(memberTrust, "trust.key")), false);

  const activeLegacyRemote = bare("legacy-active-hmac.git");
  const activeLegacyWorkflow = "workflow-git-legacy-active-hmac";
  const activeOwnerTrust = join(root, "legacy-active-owner-trust");
  process.env.AIDLC_TRUST_SECRET = "git-coordination-test-secret-at-least-32-bytes";
  process.env.AIDLC_TRUST_DIR = activeOwnerTrust;
  const activeOwner = new GitCoordinationProviderV3({
    remote: activeLegacyRemote,
    workflow_id: activeLegacyWorkflow,
    scratch_root: root,
    default_lease_ms: 30_000,
  });
  const activeLegacy = legacyHmacLog(activeLegacyWorkflow, activeOwner.provider_id);
  pushCoordinationLog(activeLegacyRemote, activeLegacyWorkflow, activeLegacy.events.slice(0, 1), "legacy-active-hmac-work");
  const renewedLegacy = activeOwner.heartbeat(activeLegacy.receipt, 30_000, "2027-01-02T00:00:10.000Z");
  assert.equal(renewedLegacy.receipt.integrity.algorithm, "ed25519");
  assert.equal(renewedLegacy.receipt.generation, 2);

  delete process.env.AIDLC_TRUST_SECRET;
  process.env.AIDLC_TRUST_DIR = join(root, "legacy-active-member-trust");
  const activeMigratedSnapshot = new GitCoordinationProviderV3({
    remote: activeLegacyRemote,
    workflow_id: activeLegacyWorkflow,
    scratch_root: root,
  }).snapshot();
  assert.equal(activeMigratedSnapshot.events.length, 2);
  assert.ok(activeMigratedSnapshot.events.every((event) => event.integrity.algorithm === "ed25519"));
  assert.equal(activeMigratedSnapshot.claims["legacy-task"].receipt.generation, 2);

  console.log("Git coordination provider CAS, ACK, legacy migration, ref isolation, and tamper tests passed");
} finally {
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
  if (originalTrustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalTrustDirectory;
  rmSync(root, { recursive: true, force: true });
}
