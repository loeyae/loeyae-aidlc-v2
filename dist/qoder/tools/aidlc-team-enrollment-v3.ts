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
import { validateWorkflowStateV3, type WorkflowStateV3 } from "./aidlc-state-v3";
import {
  canonicalPayload,
  deviceSigningKeyId,
  isTeamSignedRecord,
  projectIdentity,
  readEnrollment,
  registerTeamEnrollment,
  signTeamRecord,
  trustRootPath,
  verifyRecord,
} from "./aidlc-trust";

export interface TeamEnrollmentDirective extends Record<string, unknown> {
  kind: "ask";
  schema_version: 3;
  ask_type: "team-enrollment-confirmation";
  workflow_id: string;
  request_id: string;
  state_sha256: string;
  event_head_hash: string;
  device_key_id: string;
  confirmation_phrase: string;
  expires_at: string;
  question: string;
}

interface TeamEnrollmentRequest extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.team.enrollment.request";
  request_id: string;
  workflow_id: string;
  project_root: string;
  state_sha256: string;
  event_head_hash: string;
  device_key_id: string;
  challenge: string;
  confirmation_phrase: string;
  issued_at: string;
  expires_at: string;
  integrity: Record<string, unknown>;
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

function pendingPath(projectRoot: string): string {
  return resolve(trustRootPath(), "team-enrollment-requests", `${projectIdentity(projectRoot).id}.json`);
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

function readState(projectRoot: string): { state: WorkflowStateV3; raw: Buffer; sha256: string } | null {
  const path = statePath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`state must be a regular non-symlink file: ${path}`);
  if (stat.size > MAX_STATE_BYTES) throw new Error(`workflow state exceeds ${MAX_STATE_BYTES} bytes`);
  const raw = readFileSync(path);
  const value = JSON.parse(raw.toString("utf8")) as unknown;
  if (!isRecord(value) || value.schema_version !== 3) return null;
  try {
    return { state: validateWorkflowStateV3(value, true), raw, sha256: sha256(raw) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isRecord(value.integrity) && value.integrity.algorithm === "hmac-sha256") {
      throw new Error(`legacy shared-secret v3 state is not portable yet; an original trusted client must open it once with this version before another device can join (${message})`);
    }
    throw error;
  }
}

function validateRequest(value: unknown, projectRoot: string): TeamEnrollmentRequest {
  if (!isRecord(value)) throw new Error("team enrollment request must be an object");
  exactKeys(value, REQUEST_KEYS, "team enrollment request");
  if (value.schema_version !== 1 || value.kind !== "aidlc.team.enrollment.request") {
    throw new Error("team enrollment request schema or kind is invalid");
  }
  const error = verifyRecord(value);
  if (error) throw new Error(`team enrollment request integrity failed: ${error}`);
  const request = value as unknown as TeamEnrollmentRequest;
  if (request.project_root !== projectIdentity(projectRoot).root) throw new Error("team enrollment request targets another project root");
  text(request.request_id, "team enrollment request.request_id");
  text(request.workflow_id, "team enrollment request.workflow_id");
  digest(request.state_sha256, "team enrollment request.state_sha256");
  digest(request.event_head_hash, "team enrollment request.event_head_hash");
  text(request.device_key_id, "team enrollment request.device_key_id");
  if (!/^[a-f0-9]{48}$/.test(text(request.challenge, "team enrollment request.challenge"))) {
    throw new Error("team enrollment request.challenge is invalid");
  }
  text(request.confirmation_phrase, "team enrollment request.confirmation_phrase");
  if (Number.isNaN(Date.parse(request.issued_at)) || Number.isNaN(Date.parse(request.expires_at))) {
    throw new Error("team enrollment request timestamps are invalid");
  }
  const unsigned = { ...request } as Record<string, unknown>;
  delete unsigned.integrity;
  const requestId = String(unsigned.request_id);
  delete unsigned.request_id;
  if (requestId !== sha256(canonicalPayload(unsigned))) throw new Error("team enrollment request_id is invalid");
  return request;
}

function existingRequest(projectRoot: string, snapshot: { state: WorkflowStateV3; sha256: string }, now: number): TeamEnrollmentRequest | null {
  const path = pendingPath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIRMATION_BYTES) {
    throw new Error(`team enrollment request is not a safe regular file: ${path}`);
  }
  try {
    const request = validateRequest(JSON.parse(readFileSync(path, "utf8")) as unknown, projectRoot);
    if (Date.parse(request.expires_at) <= now
      || request.workflow_id !== snapshot.state.workflow_id
      || request.state_sha256 !== snapshot.sha256
      || request.event_head_hash !== snapshot.state.event_head.event_hash
      || request.device_key_id !== deviceSigningKeyId()) {
      unlinkSync(path);
      return null;
    }
    return request;
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
}

function createRequest(projectRoot: string, snapshot: { state: WorkflowStateV3; sha256: string }, now: number): TeamEnrollmentRequest {
  const challenge = randomBytes(24).toString("hex");
  const workflowLabel = snapshot.state.workflow_id.slice(0, 24);
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.team.enrollment.request",
    workflow_id: snapshot.state.workflow_id,
    project_root: projectIdentity(projectRoot).root,
    state_sha256: snapshot.sha256,
    event_head_hash: snapshot.state.event_head.event_hash,
    device_key_id: deviceSigningKeyId(),
    challenge,
    confirmation_phrase: `JOIN ${workflowLabel} ${challenge.slice(-8)}`,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + REQUEST_TTL_MS).toISOString(),
  };
  const requestId = sha256(canonicalPayload(unsigned));
  const request = validateRequest({ ...unsigned, request_id: requestId, integrity: signTeamRecord({ ...unsigned, request_id: requestId }) }, projectRoot);
  writeAtomic(pendingPath(projectRoot), `${JSON.stringify(request, null, 2)}\n`);
  return request;
}

function directive(request: TeamEnrollmentRequest): TeamEnrollmentDirective {
  return {
    kind: "ask",
    schema_version: 3,
    ask_type: "team-enrollment-confirmation",
    workflow_id: request.workflow_id,
    request_id: request.request_id,
    state_sha256: request.state_sha256,
    event_head_hash: request.event_head_hash,
    device_key_id: request.device_key_id,
    confirmation_phrase: request.confirmation_phrase,
    expires_at: request.expires_at,
    question: "This device is not enrolled for the collaborative workflow. Show the exact confirmation phrase and end the turn; submit only after the user types it in the next message.",
  };
}

function confirmation(raw: string): { request_id: string; confirmation_phrase: string } {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIRMATION_BYTES) throw new Error("team enrollment confirmation exceeds 64 KB");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("team enrollment confirmation must be valid JSON");
  }
  if (!isRecord(value)) throw new Error("team enrollment confirmation must be an object");
  exactKeys(value, CONFIRMATION_KEYS, "team enrollment confirmation");
  if (value.schema_version !== 1) throw new Error("team enrollment confirmation schema_version must be 1");
  if (value.kind !== "aidlc.team.enrollment.confirmation") {
    throw new Error('team enrollment confirmation kind must be "aidlc.team.enrollment.confirmation"');
  }
  return {
    request_id: text(value.request_id, "team enrollment confirmation.request_id"),
    confirmation_phrase: text(value.confirmation_phrase, "team enrollment confirmation.confirmation_phrase"),
  };
}

export function teamEnrollmentGate(
  projectRoot: string,
  confirmationRaw?: string,
  now = Date.now(),
): TeamEnrollmentDirective | null {
  let enrollmentValid = false;
  try {
    enrollmentValid = readEnrollment(projectRoot) !== null;
  } catch {
    enrollmentValid = false;
  }
  const snapshot = readState(projectRoot);
  if (!snapshot) {
    if (confirmationRaw !== undefined) throw new Error("team enrollment confirmation requires an existing schema v3 workflow");
    return null;
  }
  if (enrollmentValid) {
    if (confirmationRaw !== undefined) throw new Error("this device is already enrolled for the workflow");
    return null;
  }
  if (!isTeamSignedRecord(snapshot.state as unknown as Record<string, unknown>)
    || snapshot.state.events.some((event) => !isTeamSignedRecord(event))) {
    throw new Error("legacy v3 state must be converted by an original trusted client before conversation enrollment");
  }
  const request = existingRequest(projectRoot, snapshot, now) || createRequest(projectRoot, snapshot, now);
  if (confirmationRaw === undefined) return directive(request);
  const supplied = confirmation(confirmationRaw);
  if (Date.parse(request.expires_at) <= now) throw new Error("team enrollment confirmation expired; request a new phrase");
  if (supplied.request_id !== request.request_id) throw new Error("team enrollment confirmation request_id does not match the active request");
  if (supplied.confirmation_phrase !== request.confirmation_phrase) {
    throw new Error("team enrollment confirmation phrase must exactly match the active phrase");
  }
  const current = readState(projectRoot);
  if (!current
    || current.sha256 !== request.state_sha256
    || current.state.event_head.event_hash !== request.event_head_hash
    || current.state.workflow_id !== request.workflow_id) {
    throw new Error("workflow state changed after the enrollment request; request a new phrase");
  }
  registerTeamEnrollment(projectRoot, current.state.workflow_id, current.state.event_head.event_hash, "active");
  const path = pendingPath(projectRoot);
  if (existsSync(path)) unlinkSync(path);
  return null;
}
