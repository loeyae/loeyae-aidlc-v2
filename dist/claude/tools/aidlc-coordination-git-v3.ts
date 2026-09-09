import { createHash, randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  claimReceiptDigestV3,
  issueClaimReceiptV3,
  validateClaimReceiptV3,
  type ClaimReceiptV3,
  type CoordinationIdentityV3,
} from "./aidlc-coordination-local-v3";
import { canonicalPayload, signRecord, verifyRecord, type IntegrityEnvelope } from "./aidlc-trust";

export type GitCoordinationEventTypeV3 =
  | "instance_claimed"
  | "claim_renewed"
  | "claim_transferred"
  | "instance_released"
  | "lease_expired"
  | "instance_completed";

export interface GitCoordinationEventV3 extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.git-coordination.event";
  workflow_id: string;
  sequence: number;
  event_id: string;
  previous_event_hash: string | null;
  event_type: GitCoordinationEventTypeV3;
  stage_instance: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  integrity: IntegrityEnvelope;
}

export interface GitCoordinationClaimV3 {
  receipt: ClaimReceiptV3;
  receipt_digest: string;
}

export interface GitCoordinationSnapshotV3 {
  workflow_id: string;
  event_head: string | null;
  events: GitCoordinationEventV3[];
  claims: Record<string, GitCoordinationClaimV3>;
  completed_instances: string[];
}

export interface GitCoordinationProviderOptions {
  remote: string;
  workflow_id: string;
  scratch_root?: string;
  provider_id?: string;
  default_lease_ms?: number;
}

export interface GitClaimResultV3 {
  receipt: ClaimReceiptV3;
  remote_commit: string;
  coordination_ref: string;
}

const EVENT_TYPES = new Set<GitCoordinationEventTypeV3>([
  "instance_claimed",
  "claim_renewed",
  "claim_transferred",
  "instance_released",
  "lease_expired",
  "instance_completed",
]);
const EVENT_KEYS = new Set([
  "schema_version",
  "kind",
  "workflow_id",
  "sequence",
  "event_id",
  "previous_event_hash",
  "event_type",
  "stage_instance",
  "occurred_at",
  "payload",
  "integrity",
]);
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60 * 60 * 1000;
const MAX_LOG_BYTES = 16 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${field} must not contain control characters`);
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

function digest(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result.toLowerCase();
}

function leaseDuration(value: number): number {
  if (!Number.isInteger(value) || value < MIN_LEASE_MS || value > MAX_LEASE_MS) {
    throw new Error(`lease duration must be an integer between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds`);
  }
  return value;
}

function holder(value: CoordinationIdentityV3, field = "identity"): CoordinationIdentityV3 {
  return {
    actor_id: text(value.actor_id, `${field}.actor_id`),
    device_id: text(value.device_id, `${field}.device_id`),
    client_id: text(value.client_id, `${field}.client_id`),
  };
}

function eventHash(event: GitCoordinationEventV3): string {
  return createHash("sha256").update(canonicalPayload(event)).digest("hex");
}

function exactPayload(payload: Record<string, unknown>, keys: string[], eventType: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(payload)) if (!allowed.has(key)) throw new Error(`${eventType} payload has unknown field ${key}`);
}

function validatePayload(eventType: GitCoordinationEventTypeV3, value: unknown): Record<string, unknown> {
  const payload = record(value, `${eventType} payload`);
  if (eventType === "instance_claimed" || eventType === "claim_renewed" || eventType === "claim_transferred") {
    exactPayload(payload, ["receipt"], eventType);
    validateClaimReceiptV3(payload.receipt, true);
  } else {
    exactPayload(payload, ["claim_id", "receipt_digest", "reason"], eventType);
    text(payload.claim_id, `${eventType}.claim_id`);
    digest(payload.receipt_digest, `${eventType}.receipt_digest`);
    if (eventType !== "instance_completed") text(payload.reason, `${eventType}.reason`);
    else if (payload.reason !== undefined) throw new Error("instance_completed payload cannot include reason");
  }
  return payload;
}

export function validateGitCoordinationEventV3(value: unknown, requireIntegrity = true): GitCoordinationEventV3 {
  const event = record(value, "git coordination event");
  for (const key of Object.keys(event)) if (!EVENT_KEYS.has(key)) throw new Error(`git coordination event has unknown field ${key}`);
  if (event.schema_version !== 1) throw new Error("git coordination event schema_version must be 1");
  if (event.kind !== "aidlc.git-coordination.event") throw new Error('git coordination event kind must be "aidlc.git-coordination.event"');
  const eventType = text(event.event_type, "git coordination event.event_type") as GitCoordinationEventTypeV3;
  if (!EVENT_TYPES.has(eventType)) throw new Error(`unknown git coordination event type: ${eventType}`);
  if (!Number.isInteger(event.sequence) || (event.sequence as number) < 1) throw new Error("git coordination event.sequence must be positive");
  const previousHash = event.previous_event_hash === null
    ? null
    : digest(event.previous_event_hash, "git coordination event.previous_event_hash");
  validatePayload(eventType, event.payload);
  if (requireIntegrity) {
    const error = verifyRecord(event);
    if (error) throw new Error(`git coordination event integrity failed: ${error}`);
  }
  return {
    ...event,
    schema_version: 1,
    kind: "aidlc.git-coordination.event",
    workflow_id: text(event.workflow_id, "git coordination event.workflow_id"),
    sequence: event.sequence as number,
    event_id: text(event.event_id, "git coordination event.event_id"),
    previous_event_hash: previousHash,
    event_type: eventType,
    stage_instance: text(event.stage_instance, "git coordination event.stage_instance"),
    occurred_at: timestamp(event.occurred_at, "git coordination event.occurred_at"),
    payload: event.payload as Record<string, unknown>,
    integrity: record(event.integrity, "git coordination event.integrity") as unknown as IntegrityEnvelope,
  } as GitCoordinationEventV3;
}

function createEvent(
  workflowId: string,
  eventType: GitCoordinationEventTypeV3,
  stageInstance: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  previous?: GitCoordinationEventV3,
): GitCoordinationEventV3 {
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.git-coordination.event",
    workflow_id: workflowId,
    sequence: previous ? previous.sequence + 1 : 1,
    event_id: randomUUID(),
    previous_event_hash: previous ? eventHash(previous) : null,
    event_type: eventType,
    stage_instance: stageInstance,
    occurred_at: occurredAt,
    payload,
  };
  return validateGitCoordinationEventV3({ ...unsigned, integrity: signRecord(unsigned, true) }, true);
}

export function reduceGitCoordinationEventsV3(
  workflowId: string,
  values: readonly GitCoordinationEventV3[],
): GitCoordinationSnapshotV3 {
  const claims: Record<string, GitCoordinationClaimV3> = {};
  const completed = new Set<string>();
  const events: GitCoordinationEventV3[] = [];
  let previous: GitCoordinationEventV3 | undefined;
  const eventIds = new Set<string>();
  for (const value of values) {
    const event = validateGitCoordinationEventV3(value, true);
    if (event.workflow_id !== workflowId) throw new Error(`coordination event ${event.event_id} belongs to another workflow`);
    const expectedSequence = previous ? previous.sequence + 1 : 1;
    if (event.sequence !== expectedSequence) throw new Error(`coordination event sequence gap: expected ${expectedSequence}, found ${event.sequence}`);
    const expectedHash = previous ? eventHash(previous) : null;
    if (event.previous_event_hash !== expectedHash) throw new Error(`coordination event hash chain is broken at sequence ${event.sequence}`);
    if (eventIds.has(event.event_id)) throw new Error(`duplicate coordination event_id: ${event.event_id}`);
    eventIds.add(event.event_id);
    const stage = event.stage_instance;
    const current = claims[stage];
    if (event.event_type === "instance_claimed") {
      if (current) throw new Error(`duplicate active claim for ${stage}`);
      if (completed.has(stage)) throw new Error(`cannot claim completed stage instance ${stage}`);
      const receipt = validateClaimReceiptV3(event.payload.receipt, true);
      if (receipt.workflow_id !== workflowId || receipt.stage_instance !== stage) throw new Error(`claim receipt binding mismatch for ${stage}`);
      claims[stage] = { receipt, receipt_digest: claimReceiptDigestV3(receipt) };
    } else if (event.event_type === "claim_renewed") {
      if (!current) throw new Error(`claim_renewed has no active claim for ${stage}`);
      const receipt = validateClaimReceiptV3(event.payload.receipt, true);
      if (receipt.claim_id !== current.receipt.claim_id || receipt.generation <= current.receipt.generation) {
        throw new Error(`claim_renewed receipt is not a newer generation for ${stage}`);
      }
      if (
        receipt.workflow_id !== workflowId
        || receipt.stage_instance !== stage
        || receipt.actor_id !== current.receipt.actor_id
        || receipt.device_id !== current.receipt.device_id
        || receipt.client_id !== current.receipt.client_id
        || receipt.provider_id !== current.receipt.provider_id
      ) {
        throw new Error(`claim_renewed changes immutable claim holder fields for ${stage}`);
      }
      claims[stage] = { receipt, receipt_digest: claimReceiptDigestV3(receipt) };
    } else if (event.event_type === "claim_transferred") {
      if (!current) throw new Error(`claim_transferred has no active claim for ${stage}`);
      const receipt = validateClaimReceiptV3(event.payload.receipt, true);
      if (receipt.workflow_id !== workflowId || receipt.stage_instance !== stage || receipt.claim_id === current.receipt.claim_id) {
        throw new Error(`claim_transferred receipt binding is invalid for ${stage}`);
      }
      claims[stage] = { receipt, receipt_digest: claimReceiptDigestV3(receipt) };
    } else {
      if (!current) throw new Error(`${event.event_type} has no active claim for ${stage}`);
      const claimId = text(event.payload.claim_id, `${event.event_type}.claim_id`);
      const receiptDigest = digest(event.payload.receipt_digest, `${event.event_type}.receipt_digest`);
      if (claimId !== current.receipt.claim_id || receiptDigest !== current.receipt_digest) {
        throw new Error(`${event.event_type} does not match the active claim for ${stage}`);
      }
      if (event.event_type === "lease_expired" && Date.parse(event.occurred_at) < Date.parse(current.receipt.lease_expires_at)) {
        throw new Error(`lease_expired occurred before lease expiry for ${stage}`);
      }
      delete claims[stage];
      if (event.event_type === "instance_completed") completed.add(stage);
    }
    events.push(event);
    previous = event;
  }
  return {
    workflow_id: workflowId,
    event_head: previous ? eventHash(previous) : null,
    events,
    claims,
    completed_instances: [...completed].sort(),
  };
}

export function gitCoordinationRef(workflowId: string): string {
  const safe = text(workflowId, "workflow_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(safe)) {
    throw new Error("workflow_id is not safe for a Git coordination ref");
  }
  return `refs/heads/aidlc/coordination/${safe}`;
}

interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], input?: string, allowFailure = false): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Loeyae AI-DLC Coordination",
      GIT_AUTHOR_EMAIL: "coordination@loeyae.invalid",
      GIT_COMMITTER_NAME: "Loeyae AI-DLC Coordination",
      GIT_COMMITTER_EMAIL: "coordination@loeyae.invalid",
    },
  });
  const status = result.status ?? 1;
  const response = { status, stdout: result.stdout || "", stderr: result.stderr || "" };
  if (status !== 0 && !allowFailure) {
    throw new Error(`git ${args[0]} failed: ${(response.stderr || response.stdout).trim()}`);
  }
  return response;
}

function encodeLog(events: readonly GitCoordinationEventV3[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
}

function parseLog(content: string): GitCoordinationEventV3[] {
  if (Buffer.byteLength(content, "utf8") > MAX_LOG_BYTES) throw new Error("Git coordination event log exceeds size limit");
  const lines = content.split("\n").filter((line) => line.length > 0);
  return lines.map((line, index) => {
    try {
      return validateGitCoordinationEventV3(JSON.parse(line) as unknown, true);
    } catch (error) {
      throw new Error(`invalid Git coordination log line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

interface FetchedLog {
  head: string | null;
  events: GitCoordinationEventV3[];
}

export class GitCoordinationProviderV3 {
  readonly workflow_id: string;
  readonly coordination_ref: string;
  readonly provider_id: string;
  readonly default_lease_ms: number;
  private readonly remote: string;
  private readonly scratchRoot: string;

  constructor(options: GitCoordinationProviderOptions) {
    this.remote = text(options.remote, "Git coordination remote");
    this.workflow_id = text(options.workflow_id, "workflow_id");
    this.coordination_ref = gitCoordinationRef(this.workflow_id);
    this.provider_id = options.provider_id
      || `git-coordination:${createHash("sha256").update(this.remote).digest("hex").slice(0, 16)}`;
    this.default_lease_ms = leaseDuration(options.default_lease_ms || 5 * 60 * 1000);
    this.scratchRoot = resolve(options.scratch_root || process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir());
    mkdirSync(this.scratchRoot, { recursive: true });
  }

  private workspace(): string {
    const directory = mkdtempSync(join(this.scratchRoot, "aidlc-git-coordination-"));
    git(directory, ["init", "--quiet"]);
    git(directory, ["remote", "add", "origin", this.remote]);
    return directory;
  }

  private fetch(directory: string): FetchedLog {
    const lookup = git(directory, ["ls-remote", "--heads", "origin", this.coordination_ref], undefined, true);
    if (lookup.status !== 0) throw new Error(`failed to query Git coordination ref: ${(lookup.stderr || lookup.stdout).trim()}`);
    const line = lookup.stdout.trim();
    if (!line) return { head: null, events: [] };
    const head = line.split(/\s+/, 1)[0];
    if (!/^[a-f0-9]{40,64}$/i.test(head)) throw new Error("Git coordination remote returned an invalid object ID");
    git(directory, ["fetch", "--quiet", "--no-tags", "origin", `+${this.coordination_ref}:refs/remotes/origin/aidlc-coordination`]);
    const content = git(directory, ["show", `${head}:events.ndjson`]).stdout;
    const events = parseLog(content);
    reduceGitCoordinationEventsV3(this.workflow_id, events);
    return { head, events };
  }

  private commit(directory: string, parent: string | null, events: GitCoordinationEventV3[]): string {
    const blob = git(directory, ["hash-object", "-w", "--stdin"], encodeLog(events)).stdout.trim();
    const tree = git(directory, ["mktree"], `100644 blob ${blob}\tevents.ndjson\n`).stdout.trim();
    const args = ["commit-tree", tree, "-m", "AI-DLC coordination event append"];
    if (parent) args.push("-p", parent);
    return git(directory, args).stdout.trim();
  }

  private push(directory: string, expectedHead: string | null, commit: string): void {
    const lease = expectedHead
      ? `--force-with-lease=${this.coordination_ref}:${expectedHead}`
      : `--force-with-lease=${this.coordination_ref}:`;
    const result = git(
      directory,
      ["push", "--porcelain", lease, "origin", `${commit}:${this.coordination_ref}`],
      undefined,
      true,
    );
    if (result.status !== 0) {
      throw new Error(`Git coordination CAS conflict or remote rejection; no claim receipt was acknowledged: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  private update<T>(builder: (snapshot: GitCoordinationSnapshotV3) => { events: GitCoordinationEventV3[]; result: T }): { result: T; commit: string } {
    const directory = this.workspace();
    try {
      const fetched = this.fetch(directory);
      const snapshot = reduceGitCoordinationEventsV3(this.workflow_id, fetched.events);
      const built = builder(snapshot);
      if (built.events.length <= fetched.events.length) throw new Error("Git coordination update must append at least one event");
      for (let index = 0; index < fetched.events.length; index++) {
        if (JSON.stringify(built.events[index]) !== JSON.stringify(fetched.events[index])) {
          throw new Error(`Git coordination update rewrote event sequence ${index + 1}`);
        }
      }
      reduceGitCoordinationEventsV3(this.workflow_id, built.events);
      const commit = this.commit(directory, fetched.head, built.events);
      this.push(directory, fetched.head, commit);
      return { result: built.result, commit };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  snapshot(): GitCoordinationSnapshotV3 {
    const directory = this.workspace();
    try {
      const fetched = this.fetch(directory);
      return reduceGitCoordinationEventsV3(this.workflow_id, fetched.events);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  claim(
    stageInstanceValue: string,
    holderValue: CoordinationIdentityV3,
    leaseMs = this.default_lease_ms,
    occurredAt = new Date().toISOString(),
  ): GitClaimResultV3 {
    const stageInstance = text(stageInstanceValue, "stage_instance");
    const claimHolder = holder(holderValue);
    const duration = leaseDuration(leaseMs);
    const at = timestamp(occurredAt, "claim occurred_at");
    const operation = this.update((snapshot) => {
      const events = [...snapshot.events];
      const active = snapshot.claims[stageInstance];
      if (snapshot.completed_instances.includes(stageInstance)) throw new Error(`stage instance is already completed: ${stageInstance}`);
      if (active && Date.parse(active.receipt.lease_expires_at) > Date.parse(at)) {
        throw new Error(`stage instance already has an active remote claim: ${stageInstance}`);
      }
      if (active) {
        events.push(createEvent(this.workflow_id, "lease_expired", stageInstance, at, {
          claim_id: active.receipt.claim_id,
          receipt_digest: active.receipt_digest,
          reason: "Execution lease expired before a new remote claim",
        }, events.at(-1)));
      }
      const claimId = randomUUID();
      const leaseExpiresAt = new Date(Date.parse(at) + duration).toISOString();
      const receipt = issueClaimReceiptV3(
        this.workflow_id,
        stageInstance,
        claimId,
        claimHolder,
        this.provider_id,
        at,
        leaseExpiresAt,
        1,
      );
      events.push(createEvent(this.workflow_id, "instance_claimed", stageInstance, at, { receipt }, events.at(-1)));
      return { events, result: receipt };
    });
    return { receipt: operation.result, remote_commit: operation.commit, coordination_ref: this.coordination_ref };
  }

  heartbeat(
    receiptValue: ClaimReceiptV3,
    leaseMs = this.default_lease_ms,
    occurredAt = new Date().toISOString(),
  ): GitClaimResultV3 {
    const supplied = validateClaimReceiptV3(receiptValue, true);
    const duration = leaseDuration(leaseMs);
    const at = timestamp(occurredAt, "heartbeat occurred_at");
    const operation = this.update((snapshot) => {
      const active = this.assertRemoteReceipt(snapshot, supplied, Date.parse(at));
      const next = issueClaimReceiptV3(
        this.workflow_id,
        supplied.stage_instance,
        supplied.claim_id,
        holder(supplied, "claim receipt holder"),
        this.provider_id,
        at,
        new Date(Date.parse(at) + duration).toISOString(),
        supplied.generation + 1,
      );
      const events = [...snapshot.events];
      events.push(createEvent(this.workflow_id, "claim_renewed", supplied.stage_instance, at, { receipt: next }, events.at(-1)));
      void active;
      return { events, result: next };
    });
    return { receipt: operation.result, remote_commit: operation.commit, coordination_ref: this.coordination_ref };
  }

  transfer(
    receiptValue: ClaimReceiptV3,
    nextHolderValue: CoordinationIdentityV3,
    leaseMs = this.default_lease_ms,
    occurredAt = new Date().toISOString(),
  ): GitClaimResultV3 {
    const supplied = validateClaimReceiptV3(receiptValue, true);
    const nextHolder = holder(nextHolderValue, "transfer identity");
    const duration = leaseDuration(leaseMs);
    const at = timestamp(occurredAt, "transfer occurred_at");
    const operation = this.update((snapshot) => {
      this.assertRemoteReceipt(snapshot, supplied, Date.parse(at));
      const next = issueClaimReceiptV3(
        this.workflow_id,
        supplied.stage_instance,
        randomUUID(),
        nextHolder,
        this.provider_id,
        at,
        new Date(Date.parse(at) + duration).toISOString(),
        1,
      );
      const events = [...snapshot.events];
      events.push(createEvent(this.workflow_id, "claim_transferred", supplied.stage_instance, at, { receipt: next }, events.at(-1)));
      return { events, result: next };
    });
    return { receipt: operation.result, remote_commit: operation.commit, coordination_ref: this.coordination_ref };
  }

  release(receiptValue: ClaimReceiptV3, reasonValue: string, occurredAt = new Date().toISOString()): string {
    const supplied = validateClaimReceiptV3(receiptValue, true);
    const at = timestamp(occurredAt, "release occurred_at");
    return this.update((snapshot) => {
      const active = this.assertRemoteReceipt(snapshot, supplied, Date.parse(at));
      const events = [...snapshot.events];
      events.push(createEvent(this.workflow_id, "instance_released", supplied.stage_instance, at, {
        claim_id: supplied.claim_id,
        receipt_digest: active.receipt_digest,
        reason: text(reasonValue, "release reason"),
      }, events.at(-1)));
      return { events, result: "released" };
    }).commit;
  }

  complete(receiptValue: ClaimReceiptV3, occurredAt = new Date().toISOString()): string {
    const supplied = validateClaimReceiptV3(receiptValue, true);
    const at = timestamp(occurredAt, "complete occurred_at");
    return this.update((snapshot) => {
      const active = this.assertRemoteReceipt(snapshot, supplied, Date.parse(at));
      const events = [...snapshot.events];
      events.push(createEvent(this.workflow_id, "instance_completed", supplied.stage_instance, at, {
        claim_id: supplied.claim_id,
        receipt_digest: active.receipt_digest,
      }, events.at(-1)));
      return { events, result: "completed" };
    }).commit;
  }

  currentReceipt(stageInstanceValue: string, expectedHolder?: CoordinationIdentityV3): ClaimReceiptV3 | null {
    const stageInstance = text(stageInstanceValue, "stage_instance");
    const active = this.snapshot().claims[stageInstance];
    if (!active) return null;
    if (expectedHolder) {
      const expected = holder(expectedHolder);
      if (
        active.receipt.actor_id !== expected.actor_id
        || active.receipt.device_id !== expected.device_id
        || active.receipt.client_id !== expected.client_id
      ) {
        throw new Error(`active remote claim belongs to a different holder for ${stageInstance}`);
      }
    }
    return active.receipt;
  }

  private assertRemoteReceipt(
    snapshot: GitCoordinationSnapshotV3,
    receipt: ClaimReceiptV3,
    now: number,
  ): GitCoordinationClaimV3 {
    if (receipt.workflow_id !== this.workflow_id || receipt.provider_id !== this.provider_id) {
      throw new Error("claim receipt is bound to a different Git coordination provider or workflow");
    }
    if (Date.parse(receipt.lease_expires_at) <= now) throw new Error(`remote claim receipt expired for ${receipt.stage_instance}`);
    const active = snapshot.claims[receipt.stage_instance];
    if (!active) throw new Error(`no active remote claim for ${receipt.stage_instance}`);
    if (active.receipt.claim_id !== receipt.claim_id || active.receipt_digest !== claimReceiptDigestV3(receipt)) {
      throw new Error(`remote claim receipt is stale for ${receipt.stage_instance}`);
    }
    return active;
  }
}
