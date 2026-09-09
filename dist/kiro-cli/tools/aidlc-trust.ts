import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from "crypto";
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

export interface HmacIntegrityEnvelope {
  algorithm: "hmac-sha256";
  key_id: string;
  signature: string;
}

export interface DeviceIntegrityEnvelope {
  algorithm: "ed25519";
  key_id: string;
  public_key: string;
  signature: string;
}

export type IntegrityEnvelope = HmacIntegrityEnvelope | DeviceIntegrityEnvelope;

export interface EnrollmentRecord extends Record<string, unknown> {
  schema_version: 1;
  project_root: string;
  workflow_id: string;
  enrolled_at: string;
  status?: "pending" | "active";
  recovery_id?: string;
  trust_mode?: "device-signature-v1";
  event_head_hash?: string;
  device_key_id?: string;
  integrity: IntegrityEnvelope;
}

interface DeviceSigningKeyFile {
  schema_version: 1;
  kind: "aidlc.device-signing-key";
  public_key: string;
  private_key: string;
  key_id: string;
  created_at: string;
}

interface DeviceSigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicKeyDer: Buffer;
  privateKeyDer: Buffer;
  keyId: string;
}

const MIN_SECRET_LENGTH = 32;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

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

export function trustRootPath(): string {
  const configured = process.env.AIDLC_TRUST_DIR;
  if (configured) return resolve(configured);
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) throw new Error("HOME/USERPROFILE is unavailable; set AIDLC_TRUST_DIR");
  return resolve(home, ".config", "loeyae-aidlc", "trust");
}

function keyPath(): string {
  return resolve(trustRootPath(), "trust.key");
}

function deviceKeyPath(): string {
  return resolve(trustRootPath(), "device-signing-key.json");
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

function canonicalBase64(value: unknown, field: string): Buffer {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error(`${field} must contain canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) throw new Error(`${field} must contain canonical base64`);
  return decoded;
}

function decodeStoredKey(raw: string): Buffer {
  const value = raw.trim();
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength < MIN_SECRET_LENGTH) {
    throw new Error(`AI-DLC trust key must contain at least ${MIN_SECRET_LENGTH} bytes`);
  }
  return decoded;
}

function decodeRecoveryStoredKey(raw: string): Buffer {
  const value = raw.trim();
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error("recovery trust key file must contain canonical base64");
  }
  const decoded = decodeStoredKey(value);
  if (decoded.toString("base64") !== value) throw new Error("recovery trust key file must contain canonical base64");
  return decoded;
}

function secretKey(value: string, label: string): Buffer {
  const key = Buffer.from(value, "utf8");
  if (key.byteLength < MIN_SECRET_LENGTH) throw new Error(`${label} must contain at least ${MIN_SECRET_LENGTH} bytes`);
  return key;
}

export function getTrustKey(createIfMissing = false): Buffer {
  const fromEnvironment = process.env.AIDLC_TRUST_SECRET;
  if (fromEnvironment !== undefined) return secretKey(fromEnvironment, "AIDLC_TRUST_SECRET");

  const path = keyPath();
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`AI-DLC trust key is not a regular file: ${path}`);
    return decodeStoredKey(readFileSync(path, "utf8"));
  }
  if (!createIfMissing) {
    throw new Error("AI-DLC trust key is missing; initialize a legacy workflow or set AIDLC_TRUST_SECRET");
  }

  const key = randomBytes(32);
  writeAtomic(path, `${key.toString("base64")}\n`);
  return key;
}

export function getRecoveryTrustKey(): Buffer {
  const fromEnvironment = process.env.AIDLC_RECOVERY_SECRET;
  const file = process.env.AIDLC_RECOVERY_KEY_FILE;
  if (fromEnvironment !== undefined && file !== undefined) {
    throw new Error("set exactly one of AIDLC_RECOVERY_SECRET or AIDLC_RECOVERY_KEY_FILE");
  }
  if (fromEnvironment !== undefined) return secretKey(fromEnvironment, "AIDLC_RECOVERY_SECRET");
  if (file === undefined) throw new Error("set AIDLC_RECOVERY_SECRET or AIDLC_RECOVERY_KEY_FILE to prove the source signature");
  if (file !== resolve(file)) throw new Error("AIDLC_RECOVERY_KEY_FILE must be an absolute normalized path");
  const path = resolve(file);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`recovery trust key is not a regular non-symlink file: ${path}`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(`recovery trust key permissions must not allow group or other access: ${path}`);
  }
  return decodeRecoveryStoredKey(readFileSync(path, "utf8"));
}

export function keyIdentifier(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function deviceKeyIdentifier(publicKey: Buffer): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 24);
}

function parseDeviceKeyFile(value: unknown, path: string): DeviceSigningKey {
  if (!isRecord(value)) throw new Error(`AI-DLC device signing key is invalid: ${path}`);
  const allowed = new Set(["schema_version", "kind", "public_key", "private_key", "key_id", "created_at"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`AI-DLC device signing key has unknown field ${key}`);
  if (value.schema_version !== 1 || value.kind !== "aidlc.device-signing-key") {
    throw new Error(`AI-DLC device signing key schema mismatch: ${path}`);
  }
  const publicKeyDer = canonicalBase64(value.public_key, "device signing public_key");
  const privateKeyDer = canonicalBase64(value.private_key, "device signing private_key");
  const keyId = deviceKeyIdentifier(publicKeyDer);
  if (value.key_id !== keyId) throw new Error(`AI-DLC device signing key_id mismatch: ${path}`);
  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at))) {
    throw new Error(`AI-DLC device signing key created_at is invalid: ${path}`);
  }
  const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  const privateKey = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const derivedPublic = createPublicKey(privateKey).export({ format: "der", type: "spki" }) as Buffer;
  if (!derivedPublic.equals(publicKeyDer)) throw new Error(`AI-DLC device signing key pair does not match: ${path}`);
  return { privateKey, publicKey, publicKeyDer, privateKeyDer, keyId };
}

function getDeviceSigningKey(createIfMissing = true): DeviceSigningKey {
  const path = deviceKeyPath();
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`AI-DLC device signing key is not a regular file: ${path}`);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      throw new Error(`AI-DLC device signing key permissions must not allow group or other access: ${path}`);
    }
    return parseDeviceKeyFile(JSON.parse(readFileSync(path, "utf8")) as unknown, path);
  }
  if (!createIfMissing) throw new Error("AI-DLC device signing key is missing; initialize or join a collaborative workflow");
  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = pair.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateKeyDer = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const record: DeviceSigningKeyFile = {
    schema_version: 1,
    kind: "aidlc.device-signing-key",
    public_key: publicKeyDer.toString("base64"),
    private_key: privateKeyDer.toString("base64"),
    key_id: deviceKeyIdentifier(publicKeyDer),
    created_at: new Date().toISOString(),
  };
  writeAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
  return parseDeviceKeyFile(record, path);
}

export function deviceSigningKeyId(): string {
  return getDeviceSigningKey(true).keyId;
}

export function signRecordWithKey(value: Record<string, unknown>, key: Buffer): HmacIntegrityEnvelope {
  return {
    algorithm: "hmac-sha256",
    key_id: keyIdentifier(key),
    signature: createHmac("sha256", key).update(canonicalPayload(value)).digest("hex"),
  };
}

export function signRecord(value: Record<string, unknown>, createKey = false): HmacIntegrityEnvelope {
  return signRecordWithKey(value, getTrustKey(createKey));
}

export function signTeamRecord(value: Record<string, unknown>): DeviceIntegrityEnvelope {
  const key = getDeviceSigningKey(true);
  return {
    algorithm: "ed25519",
    key_id: key.keyId,
    public_key: key.publicKeyDer.toString("base64"),
    signature: signBytes(null, Buffer.from(canonicalPayload(value), "utf8"), key.privateKey).toString("base64"),
  };
}

export function isTeamSignedRecord(value: Record<string, unknown>): boolean {
  return isRecord(value.integrity) && value.integrity.algorithm === "ed25519";
}

export function verifyRecordWithKey(value: Record<string, unknown>, key: Buffer): string | null {
  const integrity = value.integrity;
  if (!isRecord(integrity)) return "integrity object is required";
  if (integrity.algorithm !== "hmac-sha256") return 'integrity.algorithm must be "hmac-sha256"';
  if (typeof integrity.key_id !== "string" || typeof integrity.signature !== "string") {
    return "integrity.key_id and integrity.signature are required";
  }
  if (integrity.key_id !== keyIdentifier(key)) return "integrity.key_id does not match the supplied trust key";
  if (!DIGEST_PATTERN.test(integrity.signature)) return "integrity.signature is not valid hexadecimal";
  const expected = createHmac("sha256", key).update(canonicalPayload(value)).digest();
  const actual = Buffer.from(integrity.signature, "hex");
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    return "integrity signature verification failed";
  }
  return null;
}

function verifyTeamRecord(value: Record<string, unknown>): string | null {
  const integrity = value.integrity;
  if (!isRecord(integrity)) return "integrity object is required";
  if (integrity.algorithm !== "ed25519") return 'integrity.algorithm must be "ed25519"';
  if (typeof integrity.key_id !== "string" || typeof integrity.public_key !== "string" || typeof integrity.signature !== "string") {
    return "ed25519 integrity requires key_id, public_key, and signature";
  }
  let publicKeyDer: Buffer;
  let signature: Buffer;
  try {
    publicKeyDer = canonicalBase64(integrity.public_key, "integrity.public_key");
    signature = canonicalBase64(integrity.signature, "integrity.signature");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (integrity.key_id !== deviceKeyIdentifier(publicKeyDer)) return "integrity.key_id does not match integrity.public_key";
  try {
    const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    return verifyBytes(null, Buffer.from(canonicalPayload(value), "utf8"), publicKey, signature)
      ? null
      : "integrity signature verification failed";
  } catch (error) {
    return `integrity public key is invalid: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function verifyRecord(value: Record<string, unknown>): string | null {
  const integrity = value.integrity;
  if (!isRecord(integrity)) return "integrity object is required";
  if (integrity.algorithm === "ed25519") return verifyTeamRecord(value);
  if (integrity.algorithm !== "hmac-sha256") return `unsupported integrity.algorithm: ${String(integrity.algorithm)}`;
  let key: Buffer;
  try {
    key = getTrustKey(false);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const error = verifyRecordWithKey(value, key);
  return error === "integrity.key_id does not match the supplied trust key"
    ? "integrity.key_id does not match the active trust key"
    : error;
}

export function normalizeProjectIdentityRoot(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32" || !/^[a-zA-Z]:[\\/]/.test(root)) return root;
  return `${root[0].toUpperCase()}${root.slice(1)}`;
}

export function projectIdentity(projectRoot: string): { root: string; id: string } {
  const root = normalizeProjectIdentityRoot(realpathSync(resolve(projectRoot)));
  return { root, id: createHash("sha256").update(root).digest("hex") };
}

export function enrollmentPath(projectRoot: string): string {
  const { id } = projectIdentity(projectRoot);
  return resolve(trustRootPath(), "enrollments", `${id}.json`);
}

function validatedEnrollment(projectRoot: string, value: unknown): EnrollmentRecord {
  const path = enrollmentPath(projectRoot);
  if (!isRecord(value)) throw new Error(`AI-DLC enrollment is invalid: ${path}`);
  const error = verifyRecord(value);
  if (error) throw new Error(`AI-DLC enrollment integrity failed: ${error}`);
  const { root } = projectIdentity(projectRoot);
  const teamMode = value.trust_mode === "device-signature-v1";
  const integrity = isRecord(value.integrity) ? value.integrity : {};
  if (
    value.schema_version !== 1 ||
    value.project_root !== root ||
    typeof value.workflow_id !== "string" ||
    (value.status !== undefined && value.status !== "pending" && value.status !== "active") ||
    (value.recovery_id !== undefined &&
      (value.status !== "pending" || typeof value.recovery_id !== "string" || value.recovery_id.trim().length === 0)) ||
    (value.trust_mode !== undefined && !teamMode) ||
    (teamMode && (!DIGEST_PATTERN.test(String(value.event_head_hash || ""))
      || typeof value.device_key_id !== "string"
      || value.device_key_id !== integrity.key_id
      || integrity.algorithm !== "ed25519"))
  ) {
    throw new Error(`AI-DLC enrollment schema mismatch: ${path}`);
  }
  return value as EnrollmentRecord;
}

export function createEnrollmentRecord(
  projectRoot: string,
  workflowId: string,
  status: "pending" | "active",
  enrolledAt = new Date().toISOString(),
  recoveryId?: string,
): EnrollmentRecord {
  if (!workflowId.trim()) throw new Error("workflow ID must be non-empty");
  if (recoveryId !== undefined && (status !== "pending" || !recoveryId.trim())) {
    throw new Error("recovery ID is only allowed on a non-empty pending enrollment");
  }
  const { root } = projectIdentity(projectRoot);
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    project_root: root,
    workflow_id: workflowId,
    enrolled_at: enrolledAt,
    status,
  };
  if (recoveryId !== undefined) unsigned.recovery_id = recoveryId;
  return { ...unsigned, integrity: signRecord(unsigned, true) } as EnrollmentRecord;
}

export function createTeamEnrollmentRecord(
  projectRoot: string,
  workflowId: string,
  eventHeadHash: string,
  status: "pending" | "active" = "active",
  enrolledAt = new Date().toISOString(),
): EnrollmentRecord {
  if (!workflowId.trim()) throw new Error("workflow ID must be non-empty");
  if (!DIGEST_PATTERN.test(eventHeadHash)) throw new Error("team enrollment event head must be a SHA-256 digest");
  const { root } = projectIdentity(projectRoot);
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    project_root: root,
    workflow_id: workflowId,
    enrolled_at: enrolledAt,
    status,
    trust_mode: "device-signature-v1",
    event_head_hash: eventHeadHash.toLowerCase(),
    device_key_id: deviceSigningKeyId(),
  };
  return { ...unsigned, integrity: signTeamRecord(unsigned) } as EnrollmentRecord;
}

export function writeEnrollmentRecord(projectRoot: string, record: EnrollmentRecord): void {
  const validated = validatedEnrollment(projectRoot, record);
  writeAtomic(enrollmentPath(projectRoot), `${JSON.stringify(validated, null, 2)}\n`);
}

function writeEnrollment(projectRoot: string, workflowId: string, status: "pending" | "active"): void {
  writeEnrollmentRecord(projectRoot, createEnrollmentRecord(projectRoot, workflowId, status));
}

export function registerPendingEnrollment(projectRoot: string, workflowId: string): void {
  writeEnrollment(projectRoot, workflowId, "pending");
}

export function registerEnrollment(projectRoot: string, workflowId: string): void {
  writeEnrollment(projectRoot, workflowId, "active");
}

export function registerTeamEnrollment(
  projectRoot: string,
  workflowId: string,
  eventHeadHash: string,
  status: "pending" | "active" = "active",
): void {
  writeEnrollmentRecord(projectRoot, createTeamEnrollmentRecord(projectRoot, workflowId, eventHeadHash, status));
}

export function readEnrollment(projectRoot: string): EnrollmentRecord | null {
  const path = enrollmentPath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`AI-DLC enrollment is not a regular file: ${path}`);
  return validatedEnrollment(projectRoot, JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function localApprovalKey(): Buffer {
  try {
    return getTrustKey(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/trust key is missing/.test(message)) throw error;
    return createHash("sha256").update(getDeviceSigningKey(true).privateKeyDer).digest();
  }
}

export function approvalToken(workflowId: string, stage: string, challenge: string): string {
  const message = `aidlc-approval-v1\n${workflowId}\n${stage}\n${challenge}`;
  return createHmac("sha256", localApprovalKey()).update(message).digest("hex");
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
