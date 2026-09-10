import { createHash, randomBytes } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname, resolve } from "path";
import { statePath } from "./aidlc-state";
import { canonicalPayload, deviceSigningKeyId, projectIdentity, readEnrollment, signTeamRecord, trustRootPath, verifyRecord } from "./aidlc-trust";
import { validateWorkflowStateV3, type WorkflowStateV3 } from "./aidlc-state-v3";
import type { CoordinationIdentityV3 } from "./aidlc-coordination-local-v3";

export interface MigrationClaimRecoveryDirective extends Record<string, unknown> {
  kind: "ask";
  schema_version: 3;
  ask_type: "migration-claim-recovery-confirmation";
  workflow_id: string;
  stage_instance: string;
  request_id: string;
  state_sha256: string;
  event_head_hash: string;
  previous_claim_digest: string;
  device_key_id: string;
  confirmation_phrase: string;
  expires_at: string;
  question: string;
}

export interface MigrationClaimRecoveryRequest extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.migration-claim.recovery.request";
  request_id: string;
  workflow_id: string;
  project_root: string;
  state_sha256: string;
  event_head_hash: string;
  stage_instance: string;
  previous_claim_id: string;
  previous_claim_digest: string;
  actor_id: string;
  device_id: string;
  client_id: string;
  provider_id: string;
  device_key_id: string;
  challenge: string;
  confirmation_phrase: string;
  issued_at: string;
  expires_at: string;
  integrity: Record<string, unknown>;
}

export interface MigrationLockedInstanceV3 {
  stage_instance: string;
  actor_id: string;
}

export function selectMigrationClaimRecoveryInstanceV3(
  lockedInstances: readonly MigrationLockedInstanceV3[],
  actorId: string,
  requested?: string,
): string | undefined {
  if (requested) {
    return lockedInstances.find((instance) => instance.stage_instance === requested)?.stage_instance;
  }
  const owned = lockedInstances.filter((instance) => instance.actor_id === actorId);
  if (owned.length > 1) {
    throw new Error(
      `multiple migration compatibility locks match the current actor; pass --instance with one of: ${owned.map((instance) => instance.stage_instance).join(", ")}`,
    );
  }
  return owned[0]?.stage_instance;
}

const REQUEST_TTL_MS = 15 * 60 * 1000;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_CONFIRMATION_BYTES = 64 * 1024;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_KEYS = new Set([
  "schema_version",
  "kind",
  "request_id",
  "workflow_id",
  "project_root",
  "state_sha256",
  "event_head_hash",
  "stage_instance",
  "previous_claim_id",
  "previous_claim_digest",
  "actor_id",
  "device_id",
  "client_id",
  "provider_id",
  "device_key_id",
  "challenge",
  "confirmation_phrase",
  "issued_at",
  "expires_at",
  "integrity",
]);
const CONFIRMATION_KEYS = new Set(["schema_version", "kind", "request_id", "confirmation_phrase"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function digest(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${field} has unknown field ${key}`);
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function claimDigest(claim: Record<string, unknown>): string {
  return sha256(canonicalPayload(claim));
}

function pendingPath(projectRoot: string, stageInstance: string): string {
  const suffix = sha256(stageInstance).slice(0, 24);
  return resolve(trustRootPath(), "migration-claim-recovery-requests", `${projectIdentity(projectRoot).id}-${suffix}.json`);
}

function writeAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, value, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

interface Snapshot {
  state: WorkflowStateV3;
  raw: Buffer;
  state_sha256: string;
  previous_claim_id: string;
  previous_claim_digest: string;
}

function snapshot(projectRoot: string, stageInstance: string, identity: CoordinationIdentityV3): Snapshot {
  const path = statePath(projectRoot);
  if (!existsSync(path)) throw new Error("migration claim recovery requires an existing schema v3 workflow");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`state must be a regular non-symlink file: ${path}`);
  if (stat.size > MAX_STATE_BYTES) throw new Error(`workflow state exceeds ${MAX_STATE_BYTES} bytes`);
  const raw = readFileSync(path);
  const state = validateWorkflowStateV3(JSON.parse(raw.toString("utf8")) as unknown, true);
  if (state.status !== "running") throw new Error(`migration claim recovery requires a running workflow; found ${state.status}`);
  const enrollment = readEnrollment(projectRoot);
  if (!enrollment || enrollment.status !== "active" || enrollment.workflow_id !== state.workflow_id) {
    throw new Error("migration claim recovery requires an active enrollment for this workflow");
  }
  if (enrollment.device_key_id !== deviceSigningKeyId()) {
    throw new Error("migration claim recovery enrollment does not belong to the current device key");
  }
  const instance = state.instances[stageInstance];
  if (!instance) throw new Error(`migration claim recovery targets unknown stage instance ${stageInstance}`);
  const claim = instance.claim;
  if (
    instance.status !== "in_progress"
    || !claim
    || claim.compatibility_lock !== true
    || claim.lease_expires_at !== null
    || !claim.provider_id.startsWith("migration:")
    || claim.provider_receipt !== undefined
  ) {
    throw new Error(`stage instance is not protected by a recoverable migration compatibility lock: ${stageInstance}`);
  }
  if (identity.actor_id !== claim.actor_id) {
    throw new Error(`migration claim belongs to actor ${claim.actor_id}; actor ${identity.actor_id} cannot recover it`);
  }
  if (instance.assignment && instance.assignment.actor_id !== identity.actor_id) {
    throw new Error(`stage instance is assigned to ${instance.assignment.actor_id}, not ${identity.actor_id}`);
  }
  return {
    state,
    raw,
    state_sha256: sha256(raw),
    previous_claim_id: claim.claim_id,
    previous_claim_digest: claimDigest(claim as unknown as Record<string, unknown>),
  };
}

function validateRequest(value: unknown, projectRoot: string): MigrationClaimRecoveryRequest {
  if (!isRecord(value)) throw new Error("migration claim recovery request must be an object");
  exactKeys(value, REQUEST_KEYS, "migration claim recovery request");
  if (value.schema_version !== 1 || value.kind !== "aidlc.migration-claim.recovery.request") {
    throw new Error("migration claim recovery request schema or kind is invalid");
  }
  const error = verifyRecord(value);
  if (error) throw new Error(`migration claim recovery request integrity failed: ${error}`);
  const request = value as unknown as MigrationClaimRecoveryRequest;
  if (request.project_root !== projectIdentity(projectRoot).root) throw new Error("migration claim recovery request targets another project root");
  text(request.request_id, "migration claim recovery request.request_id");
  text(request.workflow_id, "migration claim recovery request.workflow_id");
  digest(request.state_sha256, "migration claim recovery request.state_sha256");
  digest(request.event_head_hash, "migration claim recovery request.event_head_hash");
  text(request.stage_instance, "migration claim recovery request.stage_instance");
  text(request.previous_claim_id, "migration claim recovery request.previous_claim_id");
  digest(request.previous_claim_digest, "migration claim recovery request.previous_claim_digest");
  text(request.actor_id, "migration claim recovery request.actor_id");
  text(request.device_id, "migration claim recovery request.device_id");
  text(request.client_id, "migration claim recovery request.client_id");
  const providerId = text(request.provider_id, "migration claim recovery request.provider_id");
  if (providerId.startsWith("migration:")) throw new Error("migration claim recovery target provider cannot be a migration provider");
  text(request.device_key_id, "migration claim recovery request.device_key_id");
  if (!/^[a-f0-9]{48}$/.test(text(request.challenge, "migration claim recovery request.challenge"))) {
    throw new Error("migration claim recovery request.challenge is invalid");
  }
  text(request.confirmation_phrase, "migration claim recovery request.confirmation_phrase");
  if (Number.isNaN(Date.parse(request.issued_at)) || Number.isNaN(Date.parse(request.expires_at))) {
    throw new Error("migration claim recovery request timestamps are invalid");
  }
  const unsigned = { ...request } as Record<string, unknown>;
  delete unsigned.integrity;
  const requestId = String(unsigned.request_id);
  delete unsigned.request_id;
  if (requestId !== sha256(canonicalPayload(unsigned))) throw new Error("migration claim recovery request_id is invalid");
  return request;
}

function requestMatches(
  request: MigrationClaimRecoveryRequest,
  current: Snapshot,
  identity: CoordinationIdentityV3,
  providerId: string,
  now: number,
): boolean {
  return Date.parse(request.expires_at) > now
    && request.workflow_id === current.state.workflow_id
    && request.state_sha256 === current.state_sha256
    && request.event_head_hash === current.state.event_head.event_hash
    && request.previous_claim_id === current.previous_claim_id
    && request.previous_claim_digest === current.previous_claim_digest
    && request.actor_id === identity.actor_id
    && request.device_id === identity.device_id
    && request.client_id === identity.client_id
    && request.provider_id === providerId
    && request.device_key_id === deviceSigningKeyId();
}

function existingRequest(
  projectRoot: string,
  stageInstance: string,
  current: Snapshot,
  identity: CoordinationIdentityV3,
  providerId: string,
  now: number,
): MigrationClaimRecoveryRequest | null {
  const path = pendingPath(projectRoot, stageInstance);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIRMATION_BYTES) {
    throw new Error(`migration claim recovery request is not a safe regular file: ${path}`);
  }
  try {
    const request = validateRequest(JSON.parse(readFileSync(path, "utf8")) as unknown, projectRoot);
    if (!requestMatches(request, current, identity, providerId, now)) {
      unlinkSync(path);
      return null;
    }
    return request;
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
}

function createRequest(
  projectRoot: string,
  stageInstance: string,
  current: Snapshot,
  identity: CoordinationIdentityV3,
  providerId: string,
  now: number,
): MigrationClaimRecoveryRequest {
  if (providerId.startsWith("migration:")) throw new Error("migration claim recovery requires a runtime coordination provider");
  const challenge = randomBytes(24).toString("hex");
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.migration-claim.recovery.request",
    workflow_id: current.state.workflow_id,
    project_root: projectIdentity(projectRoot).root,
    state_sha256: current.state_sha256,
    event_head_hash: current.state.event_head.event_hash,
    stage_instance: stageInstance,
    previous_claim_id: current.previous_claim_id,
    previous_claim_digest: current.previous_claim_digest,
    actor_id: identity.actor_id,
    device_id: identity.device_id,
    client_id: identity.client_id,
    provider_id: providerId,
    device_key_id: deviceSigningKeyId(),
    challenge,
    confirmation_phrase: `TAKEOVER ${current.state.workflow_id.slice(0, 24)} ${challenge.slice(-8)}`,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + REQUEST_TTL_MS).toISOString(),
  };
  const requestId = sha256(canonicalPayload(unsigned));
  const request = validateRequest({ ...unsigned, request_id: requestId, integrity: signTeamRecord({ ...unsigned, request_id: requestId }) }, projectRoot);
  writeAtomic(pendingPath(projectRoot, stageInstance), `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

function directive(request: MigrationClaimRecoveryRequest): MigrationClaimRecoveryDirective {
  return {
    kind: "ask",
    schema_version: 3,
    ask_type: "migration-claim-recovery-confirmation",
    workflow_id: request.workflow_id,
    stage_instance: request.stage_instance,
    request_id: request.request_id,
    state_sha256: request.state_sha256,
    event_head_hash: request.event_head_hash,
    previous_claim_digest: request.previous_claim_digest,
    device_key_id: request.device_key_id,
    confirmation_phrase: request.confirmation_phrase,
    expires_at: request.expires_at,
    question: "This migrated instance has a permanent compatibility lock without a usable receipt. Show the exact TAKEOVER phrase and end the turn; submit only after the same actor types it in the next message.",
  };
}

function confirmation(raw: string): { request_id: string; confirmation_phrase: string } {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIRMATION_BYTES) throw new Error("migration claim recovery confirmation exceeds 64 KB");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("migration claim recovery confirmation must be valid JSON");
  }
  if (!isRecord(value)) throw new Error("migration claim recovery confirmation must be an object");
  exactKeys(value, CONFIRMATION_KEYS, "migration claim recovery confirmation");
  if (value.schema_version !== 1) throw new Error("migration claim recovery confirmation schema_version must be 1");
  if (value.kind !== "aidlc.migration-claim.recovery.confirmation") {
    throw new Error('migration claim recovery confirmation kind must be "aidlc.migration-claim.recovery.confirmation"');
  }
  return {
    request_id: text(value.request_id, "migration claim recovery confirmation.request_id"),
    confirmation_phrase: text(value.confirmation_phrase, "migration claim recovery confirmation.confirmation_phrase"),
  };
}

export function migrationClaimRecoveryGate<T>(
  projectRoot: string,
  stageInstance: string,
  identity: CoordinationIdentityV3,
  providerId: string,
  confirmationRaw: string | undefined,
  recover: (request: MigrationClaimRecoveryRequest) => T,
  now = Date.now(),
): MigrationClaimRecoveryDirective | T {
  const current = snapshot(projectRoot, stageInstance, identity);
  const request = existingRequest(projectRoot, stageInstance, current, identity, providerId, now)
    || createRequest(projectRoot, stageInstance, current, identity, providerId, now);
  if (confirmationRaw === undefined) return directive(request);
  const supplied = confirmation(confirmationRaw);
  if (supplied.request_id !== request.request_id) throw new Error("migration claim recovery confirmation targets another request");
  if (Date.parse(request.expires_at) <= now) throw new Error("migration claim recovery request expired");
  if (supplied.confirmation_phrase !== request.confirmation_phrase) {
    throw new Error("migration claim recovery confirmation phrase must exactly match the active request");
  }
  const latest = snapshot(projectRoot, stageInstance, identity);
  if (!requestMatches(request, latest, identity, providerId, now)) {
    throw new Error("migration claim recovery request is stale because workflow state, claim, identity, or provider changed");
  }
  const result = recover(request);
  const path = pendingPath(projectRoot, stageInstance);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
    }
  }
  return result;
}
