import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname, resolve } from "path";

export interface IntegrityEnvelope {
  algorithm: "hmac-sha256";
  key_id: string;
  signature: string;
}

export interface EnrollmentRecord extends Record<string, unknown> {
  schema_version: 1;
  project_root: string;
  workflow_id: string;
  enrolled_at: string;
  status?: "pending" | "active";
  integrity: IntegrityEnvelope;
}

const MIN_SECRET_LENGTH = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "integrity") continue;
    normalized[key] = canonicalValue(value[key]);
  }
  return normalized;
}

export function canonicalPayload(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalValue(value));
}

function trustRoot(): string {
  const configured = process.env.AIDLC_TRUST_DIR;
  if (configured) return resolve(configured);
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) throw new Error("HOME/USERPROFILE is unavailable; set AIDLC_TRUST_DIR");
  return resolve(home, ".config", "loeyae-aidlc", "trust");
}

function keyPath(): string {
  return resolve(trustRoot(), "trust.key");
}

function writeAtomic(path: string, content: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", mode);
    writeSync(fd, content, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function decodeStoredKey(raw: string): Buffer {
  const value = raw.trim();
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < MIN_SECRET_LENGTH) {
    throw new Error(`AI-DLC trust key must contain at least ${MIN_SECRET_LENGTH} bytes`);
  }
  return decoded;
}

export function getTrustKey(createIfMissing = false): Buffer {
  const fromEnvironment = process.env.AIDLC_TRUST_SECRET;
  if (fromEnvironment !== undefined) {
    const value = Buffer.from(fromEnvironment, "utf8");
    if (value.byteLength < MIN_SECRET_LENGTH) {
      throw new Error(`AIDLC_TRUST_SECRET must contain at least ${MIN_SECRET_LENGTH} bytes`);
    }
    return value;
  }

  const path = keyPath();
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`AI-DLC trust key is not a regular file: ${path}`);
    return decodeStoredKey(readFileSync(path, "utf8"));
  }
  if (!createIfMissing) {
    throw new Error("AI-DLC trust key is missing; initialize a workflow or set AIDLC_TRUST_SECRET");
  }

  const key = randomBytes(32);
  writeAtomic(path, `${key.toString("base64")}\n`);
  return key;
}

function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function signRecord(value: Record<string, unknown>, createKey = false): IntegrityEnvelope {
  const key = getTrustKey(createKey);
  return {
    algorithm: "hmac-sha256",
    key_id: keyId(key),
    signature: createHmac("sha256", key).update(canonicalPayload(value)).digest("hex"),
  };
}

export function verifyRecord(value: Record<string, unknown>): string | null {
  const integrity = value.integrity;
  if (!isRecord(integrity)) return "integrity object is required";
  if (integrity.algorithm !== "hmac-sha256") return 'integrity.algorithm must be "hmac-sha256"';
  if (typeof integrity.key_id !== "string" || typeof integrity.signature !== "string") {
    return "integrity.key_id and integrity.signature are required";
  }

  let key: Buffer;
  try {
    key = getTrustKey(false);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (integrity.key_id !== keyId(key)) return "integrity.key_id does not match the active trust key";
  const expected = createHmac("sha256", key).update(canonicalPayload(value)).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(integrity.signature, "hex");
  } catch {
    return "integrity.signature is not valid hexadecimal";
  }
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    return "integrity signature verification failed";
  }
  return null;
}

export function normalizeProjectIdentityRoot(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" || !/^[a-zA-Z]:[\\/]/.test(root)) return root;
  return `${root[0].toUpperCase()}${root.slice(1)}`;
}

function projectIdentity(projectRoot: string): { root: string; id: string } {
  const root = normalizeProjectIdentityRoot(realpathSync(resolve(projectRoot)));
  return { root, id: createHash("sha256").update(root).digest("hex") };
}

function enrollmentPath(projectRoot: string): string {
  const { id } = projectIdentity(projectRoot);
  return resolve(trustRoot(), "enrollments", `${id}.json`);
}

function writeEnrollment(projectRoot: string, workflowId: string, status: "pending" | "active"): void {
  const { root } = projectIdentity(projectRoot);
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    project_root: root,
    workflow_id: workflowId,
    enrolled_at: new Date().toISOString(),
    status,
  };
  const record = { ...unsigned, integrity: signRecord(unsigned, true) };
  writeAtomic(enrollmentPath(projectRoot), `${JSON.stringify(record, null, 2)}\n`);
}

export function registerPendingEnrollment(projectRoot: string, workflowId: string): void {
  writeEnrollment(projectRoot, workflowId, "pending");
}

export function registerEnrollment(projectRoot: string, workflowId: string): void {
  writeEnrollment(projectRoot, workflowId, "active");
}

export function readEnrollment(projectRoot: string): EnrollmentRecord | null {
  const path = enrollmentPath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`AI-DLC enrollment is not a regular file: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`AI-DLC enrollment is invalid: ${path}`);
  const error = verifyRecord(parsed);
  if (error) throw new Error(`AI-DLC enrollment integrity failed: ${error}`);
  const { root } = projectIdentity(projectRoot);
  if (
    parsed.schema_version !== 1 ||
    parsed.project_root !== root ||
    typeof parsed.workflow_id !== "string" ||
    (parsed.status !== undefined && parsed.status !== "pending" && parsed.status !== "active")
  ) {
    throw new Error(`AI-DLC enrollment schema mismatch: ${path}`);
  }
  return parsed as EnrollmentRecord;
}

export function approvalToken(workflowId: string, stage: string, challenge: string): string {
  const key = getTrustKey(false);
  const message = `aidlc-approval-v1\n${workflowId}\n${stage}\n${challenge}`;
  return createHmac("sha256", key).update(message).digest("hex");
}

export function verifyApprovalToken(workflowId: string, stage: string, challenge: string, token: string): boolean {
  const expected = Buffer.from(approvalToken(workflowId, stage, challenge), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(token, "hex");
  } catch {
    return false;
  }
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
