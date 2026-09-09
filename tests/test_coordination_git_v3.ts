import assert from "node:assert/strict";
import { spawn, spawnSync } from "child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  GitCoordinationProviderV3,
  gitCoordinationRef,
  type GitClaimResultV3,
} from "../core/tools/aidlc-coordination-git-v3";

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
process.env.AIDLC_TRUST_SECRET = "git-coordination-test-secret-at-least-32-bytes";
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-git-provider-"));

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
  assert.equal(provider.currentReceipt("module-a@unit:unit-a"), null);

  const completing = provider.claim("module-a@unit:unit-a", {
    actor_id: "actor:alice",
    device_id: "device:desktop",
    client_id: "client:desktop-session-2",
  }, 30_000, "2027-01-01T00:00:06.000Z");
  provider.complete(completing.receipt, "2027-01-01T00:00:07.000Z");
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

  console.log("Git coordination provider CAS, ACK, ref isolation, and tamper tests passed");
} finally {
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
  rmSync(root, { recursive: true, force: true });
}
