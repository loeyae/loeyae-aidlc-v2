import assert from "node:assert/strict";
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { GitCoordinationProviderV3 } from "../core/tools/aidlc-coordination-git-v3";
import { selectMigrationClaimRecoveryInstanceV3 } from "../core/tools/aidlc-migration-claim-v3";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const root = resolve(import.meta.dirname, "..");
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const cli = join(root, "bin", "cli.ts");
const sandbox = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-migration-claim-v3-"));
const legacySecret = "migration-claim-recovery-legacy-secret-at-least-32-bytes";

function environment(trust: string | undefined, extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AIDLC_COLLABORATION_V3: "1",
    AIDLC_TRUST_DIR: trust,
    AIDLC_TRUST_SECRET: undefined,
    ...extraEnv,
  };
}

function withParentEnvironment<T>(trust: string, operation: () => T): T {
  const previousCollaboration = process.env.AIDLC_COLLABORATION_V3;
  const previousTrustDir = process.env.AIDLC_TRUST_DIR;
  const previousTrustSecret = process.env.AIDLC_TRUST_SECRET;
  process.env.AIDLC_COLLABORATION_V3 = "1";
  process.env.AIDLC_TRUST_DIR = trust;
  delete process.env.AIDLC_TRUST_SECRET;
  try {
    return operation();
  } finally {
    if (previousCollaboration === undefined) delete process.env.AIDLC_COLLABORATION_V3;
    else process.env.AIDLC_COLLABORATION_V3 = previousCollaboration;
    if (previousTrustDir === undefined) delete process.env.AIDLC_TRUST_DIR;
    else process.env.AIDLC_TRUST_DIR = previousTrustDir;
    if (previousTrustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
    else process.env.AIDLC_TRUST_SECRET = previousTrustSecret;
  }
}

function run(
  project: string,
  trust: string | undefined,
  args: string[],
  input?: string,
  extraEnv: NodeJS.ProcessEnv = {},
): CliResult {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], {
    cwd: project,
    encoding: "utf8",
    input,
    env: environment(trust, extraEnv),
  });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runAsync(
  project: string,
  trust: string,
  args: string[],
  input: string,
): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [tsx, cli, ...args], {
      cwd: project,
      env: environment(trust),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => { stdout += value; });
    child.stderr.on("data", (value: string) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (status) => resolveResult({ status: status ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function success(
  project: string,
  trust: string | undefined,
  args: string[],
  input?: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Record<string, unknown> {
  const result = run(project, trust, args, input, extraEnv);
  assert.equal(result.status, 0, `${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function state(project: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(project, "docs", "aidlc", "aidlc-state.json"), "utf8")) as Record<string, unknown>;
}

function identityArgs(device: string, client: string, actor = "actor:owner"): string[] {
  return ["--actor-id", actor, "--device-id", device, "--client-id", client];
}

function enrollmentEnvelope(request: Record<string, unknown>): string {
  return JSON.stringify({
    schema_version: 1,
    kind: "aidlc.team.enrollment.confirmation",
    request_id: request.request_id,
    confirmation_phrase: request.confirmation_phrase,
  });
}

function recoveryEnvelope(request: Record<string, unknown>, phrase = String(request.confirmation_phrase), extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    kind: "aidlc.migration-claim.recovery.confirmation",
    request_id: request.request_id,
    confirmation_phrase: phrase,
    ...extra,
  });
}

function initializeMigratedProject(project: string, trust: string): string {
  mkdirSync(project, { recursive: true });
  success(project, trust, ["orchestrate", "next", "--scope", "express"], undefined, {
    AIDLC_COLLABORATION_V3: "0",
    AIDLC_TRUST_SECRET: legacySecret,
  });
  const directive = success(project, trust, ["orchestrate", "next"], undefined, {
    AIDLC_COLLABORATION_V3: "0",
    AIDLC_TRUST_SECRET: legacySecret,
  });
  const stageInstance = String(directive.stage_instance);
  const migrated = success(project, trust, [
    "state", "migrate-v3", "--apply",
    ...identityArgs("device:old-tool", "client:old-tool"),
  ], undefined, { AIDLC_TRUST_SECRET: legacySecret });
  assert.equal(migrated.applied, true);
  const migratedState = state(project);
  const instance = (migratedState.instances as Record<string, Record<string, unknown>>)[stageInstance];
  const claim = instance.claim as Record<string, unknown>;
  assert.equal(claim.compatibility_lock, true);
  assert.equal(claim.lease_expires_at, null);
  assert.equal(claim.provider_id, "migration:v2");
  assert.equal(claim.provider_receipt, undefined);
  return stageInstance;
}

function git(directory: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

function seedExpiredGitClaim(
  project: string,
  trust: string,
  remote: string,
  stageInstance: string,
): string {
  const workflowId = String(state(project).workflow_id);
  return withParentEnvironment(trust, () => {
    const provider = new GitCoordinationProviderV3({
      remote,
      workflow_id: workflowId,
      scratch_root: sandbox,
    });
    return provider.claim(
      stageInstance,
      {
        actor_id: "actor:owner",
        device_id: "device:expired-holder",
        client_id: "client:expired-holder",
      },
      undefined,
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    ).receipt.claim_id;
  });
}

async function main(): Promise<void> {
  const lockedInstances = [
    { stage_instance: "stage:a", actor_id: "actor:owner" },
    { stage_instance: "stage:b", actor_id: "actor:owner" },
    { stage_instance: "stage:c", actor_id: "actor:other" },
  ];
  assert.throws(
    () => selectMigrationClaimRecoveryInstanceV3(lockedInstances, "actor:owner"),
    /multiple migration compatibility locks.*--instance/,
  );
  assert.equal(
    selectMigrationClaimRecoveryInstanceV3(lockedInstances, "actor:owner", "stage:b"),
    "stage:b",
  );
  assert.equal(selectMigrationClaimRecoveryInstanceV3(lockedInstances, "actor:missing"), undefined);

  const localProject = join(sandbox, "local-project");
  const localOwnerTrust = join(sandbox, "local-owner-trust");
  const localMemberTrust = join(sandbox, "local-member-trust");
  const stageInstance = initializeMigratedProject(localProject, localOwnerTrust);

  const status = success(localProject, localOwnerTrust, ["orchestrate", "next", "--status"]);
  assert.deepEqual(status.migration_locked_instances, [stageInstance]);

  const enrollment = success(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    ...identityArgs("device:new-tool", "client:new-tool"),
  ]);
  assert.equal(enrollment.ask_type, "team-enrollment-confirmation");

  const recovery = success(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    "--team-enrollment-confirmation-stdin",
    ...identityArgs("device:new-tool", "client:new-tool"),
  ], enrollmentEnvelope(enrollment));
  assert.equal(recovery.ask_type, "migration-claim-recovery-confirmation");
  assert.match(String(recovery.confirmation_phrase), /^TAKEOVER .+ [a-f0-9]{8}$/);
  assert.doesNotMatch(JSON.stringify(recovery), /private_key|AIDLC_TRUST_SECRET|claim_receipt/);

  const wrongActor = run(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    ...identityArgs("device:new-tool", "client:new-tool", "actor:other"),
  ]);
  assert.notEqual(wrongActor.status, 0);
  assert.match(wrongActor.stderr, /belongs to actor actor:owner/);

  success(localProject, localOwnerTrust, ["orchestrate", "park", "--reason", "advance state head"]);
  success(localProject, localOwnerTrust, ["orchestrate", "next", "--resume", "--status"]);
  const stale = run(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    "--migration-claim-recovery-confirmation-stdin",
    ...identityArgs("device:new-tool", "client:new-tool"),
  ], recoveryEnvelope(recovery));
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /another request|stale/);

  const refreshed = success(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    ...identityArgs("device:new-tool", "client:new-tool"),
  ]);
  assert.equal(refreshed.ask_type, "migration-claim-recovery-confirmation");

  const unknown = run(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    "--migration-claim-recovery-confirmation-stdin",
    ...identityArgs("device:new-tool", "client:new-tool"),
  ], recoveryEnvelope(refreshed, String(refreshed.confirmation_phrase), { unexpected: true }));
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown field unexpected/);

  const trailing = run(localProject, localMemberTrust, [
    "orchestrate", "next", "--instance", stageInstance,
    "--migration-claim-recovery-confirmation-stdin",
    ...identityArgs("device:new-tool", "client:new-tool"),
  ], recoveryEnvelope(refreshed, `${String(refreshed.confirmation_phrase)} `));
  assert.notEqual(trailing.status, 0);
  assert.match(trailing.stderr, /must exactly match/);

  const confirmationArgs = [
    "orchestrate", "next", "--instance", stageInstance,
    "--migration-claim-recovery-confirmation-stdin",
    ...identityArgs("device:new-tool", "client:new-tool"),
  ];
  const concurrent = await Promise.all([
    runAsync(localProject, localMemberTrust, confirmationArgs, recoveryEnvelope(refreshed)),
    runAsync(localProject, localMemberTrust, confirmationArgs, recoveryEnvelope(refreshed)),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 0).length, 1, JSON.stringify(concurrent));
  const recovered = JSON.parse(concurrent.find((result) => result.status === 0)!.stdout) as Record<string, unknown>;
  assert.equal(recovered.kind, "run-stage");
  assert.equal(recovered.stage_instance, stageInstance);
  const receipt = recovered.claim_receipt as Record<string, unknown>;
  assert.equal(receipt.actor_id, "actor:owner");
  assert.equal(receipt.device_id, "device:new-tool");
  assert.equal(receipt.client_id, "client:new-tool");
  assert.equal((receipt.integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.ok(Date.parse(String(receipt.lease_expires_at)) > Date.now());

  const recoveredState = state(localProject);
  const recoveredInstance = (recoveredState.instances as Record<string, Record<string, unknown>>)[stageInstance];
  const recoveredClaim = recoveredInstance.claim as Record<string, unknown>;
  assert.equal(recoveredClaim.compatibility_lock, undefined);
  assert.deepEqual(recoveredClaim.provider_receipt, receipt);
  const transferEvent = (recoveredState.events as Array<Record<string, unknown>>).findLast((event) => event.event_type === "claim_transferred");
  const transferPayload = transferEvent?.payload as Record<string, unknown>;
  assert.equal(transferPayload.recovery_request_id, refreshed.request_id);
  assert.equal(typeof transferPayload.previous_claim_id, "string");
  assert.ok(String(transferPayload.previous_claim_id).length > 0);
  assert.match(String(transferPayload.previous_claim_digest), /^[a-f0-9]{64}$/);
  assert.equal(existsSync(join(localMemberTrust, "trust.key")), false);

  const completed = success(localProject, localMemberTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", stageInstance,
    "--result", "completed", "--instruction-ack", "workspace-detection", "--claim-receipt-stdin",
  ], JSON.stringify(receipt));
  assert.equal(completed.result, "completed");

  const replay = run(localProject, localMemberTrust, confirmationArgs, recoveryEnvelope(refreshed));
  assert.notEqual(replay.status, 0);

  const defaultProject = join(sandbox, "default-trust-project");
  const defaultOwnerTrust = join(sandbox, "default-owner-trust");
  const defaultMemberHome = join(sandbox, "default-member-home");
  mkdirSync(defaultProject, { recursive: true });
  mkdirSync(defaultMemberHome, { recursive: true });
  success(defaultProject, defaultOwnerTrust, ["orchestrate", "next", "--scope", "express", ...identityArgs("device:default-owner", "client:default-owner")]);
  const defaultEnrollment = success(defaultProject, undefined, ["orchestrate", "next", "--status"], undefined, {
    HOME: defaultMemberHome,
    USERPROFILE: defaultMemberHome,
  });
  assert.equal(defaultEnrollment.ask_type, "team-enrollment-confirmation");
  assert.notEqual(defaultEnrollment.ask_type, "scope-selection");

  const gitProject = join(sandbox, "git-project");
  const gitOwnerTrust = join(sandbox, "git-owner-trust");
  const gitMemberTrust = join(sandbox, "git-member-trust");
  const gitRemote = join(sandbox, "coordination.git");
  mkdirSync(gitRemote, { recursive: true });
  git(gitRemote, ["init", "--bare", "--quiet"]);
  const gitStage = initializeMigratedProject(gitProject, gitOwnerTrust);
  const expiredGitClaimId = seedExpiredGitClaim(gitProject, gitOwnerTrust, gitRemote, gitStage);
  const gitFlags = ["--coordination-provider", "git", "--coordination-remote", gitRemote];
  const gitEnrollment = success(gitProject, gitMemberTrust, [
    "orchestrate", "next", "--instance", gitStage,
    ...gitFlags,
    ...identityArgs("device:git-new-tool", "client:git-new-tool"),
  ]);
  const gitRecovery = success(gitProject, gitMemberTrust, [
    "orchestrate", "next", "--instance", gitStage,
    "--team-enrollment-confirmation-stdin",
    ...gitFlags,
    ...identityArgs("device:git-new-tool", "client:git-new-tool"),
  ], enrollmentEnvelope(gitEnrollment));
  assert.equal(gitRecovery.ask_type, "migration-claim-recovery-confirmation");
  const gitDirective = success(gitProject, gitMemberTrust, [
    "orchestrate", "next", "--instance", gitStage,
    "--migration-claim-recovery-confirmation-stdin",
    ...gitFlags,
    ...identityArgs("device:git-new-tool", "client:git-new-tool"),
  ], recoveryEnvelope(gitRecovery));
  const gitReceipt = gitDirective.claim_receipt as Record<string, unknown>;
  assert.match(String(gitReceipt.provider_id), /^git-coordination:/);
  assert.equal(gitReceipt.device_id, "device:git-new-tool");
  assert.notEqual(gitReceipt.claim_id, expiredGitClaimId);
  const remoteHead = spawnSync("git", ["ls-remote", "--heads", gitRemote], { encoding: "utf8" });
  assert.equal(remoteHead.status, 0);
  assert.match(remoteHead.stdout, /refs\/heads\/aidlc\/coordination\//);
  const gitCompleted = success(gitProject, gitMemberTrust, [
    "orchestrate", "report", "--stage", "workspace-detection", "--instance", gitStage,
    "--result", "completed", "--instruction-ack", "workspace-detection", "--claim-receipt-stdin",
    ...gitFlags,
  ], JSON.stringify(gitReceipt));
  assert.equal(gitCompleted.result, "completed");

  console.log("Cross-tool migration compatibility claim recovery tests passed");
}

main()
  .finally(() => rmSync(sandbox, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
