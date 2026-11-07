/** Trusted Core journal. Immutable, signed CAS events; uncertain writes are never resent.
 * Same local operator boundary as Provider policy. Backup/rollback of the entire project
 * requires operator reconciliation; this is not a distributed exactly-once guarantee. */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalProviderJson, sha256ProviderDigest as digest } from "./aidlc-project-provider.js";

export type OperationStatus = "prepared" | "dispatched" | "succeeded" | "failed" | "unknown";
export interface OperationEvent {
  schema: "aidlc.operation-event/v1"; project: string; operation_id: string; binding_digest: string;
  sequence: number; previous: string | null; status: OperationStatus; recorded_at: string;
  evidence: unknown; signature: string;
}
export function operationPath(project: string, path: string): string {
  const root = realpathSync(project), p = resolve(root, path), rel = relative(root, p);
  if (!rel || isAbsolute(path) || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("OPERATION_UNSAFE_PATH");
  for (let cursor = p; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && (lstatSync(cursor).isSymbolicLink() || lstatSync(cursor).isFile() && lstatSync(cursor).nlink !== 1)) throw new Error("OPERATION_UNSAFE_PATH");
    if (cursor === dirname(cursor)) break;
  }
  return p;
}
export function durableExclusive(path: string, value: unknown) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  // Windows does not support opening directories for fsync. File contents are flushed;
  // directory-entry loss on power failure remains an operator reconciliation boundary.
  if (process.platform !== "win32") { const dir = openSync(dirname(path), "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
}
const allowed: Record<OperationStatus, OperationStatus[]> = {
  prepared: ["dispatched", "failed"], dispatched: ["succeeded", "unknown"], unknown: ["succeeded"], succeeded: ["succeeded"], failed: [],
};
export function openOperationJournal(project: string, id: string, binding: unknown, publicKeyPem: string, privateKeyPem?: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("OPERATION_INVALID_ID");
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("OPERATION_INVALID_KEY");
  const dir = operationPath(project, `.aidlc/operations/${id}`), root = realpathSync(project), bindingDigest = digest(binding);
  function read(): OperationEvent[] {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).sort(), events: OperationEvent[] = [];
    for (let index = 0; index < files.length; index++) {
      if (files[index] !== `${String(index).padStart(6, "0")}.json`) throw new Error("OPERATION_JOURNAL_INCOMPLETE");
      const path = operationPath(project, `.aidlc/operations/${id}/${files[index]}`);
      if (!lstatSync(path).isFile() || lstatSync(path).size > 4 * 1024 * 1024) throw new Error("OPERATION_JOURNAL_INVALID");
      let event: OperationEvent;
      try { event = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("OPERATION_JOURNAL_INCOMPLETE"); }
      const { signature, ...payload } = event;
      if (event.schema !== "aidlc.operation-event/v1" || event.project !== root || event.operation_id !== id || event.binding_digest !== bindingDigest
        || event.sequence !== index || event.previous !== (index ? digest(events[index - 1]) : null)
        || !Number.isFinite(Date.parse(event.recorded_at)) || typeof signature !== "string"
        || !verify(null, Buffer.from(canonicalProviderJson(payload)), publicKey, Buffer.from(signature, "base64"))
        || (index ? !allowed[events[index - 1].status]?.includes(event.status) : event.status !== "prepared")) throw new Error("OPERATION_JOURNAL_TAMPERED");
      events.push(event);
    }
    return events;
  }
  function append(prior: OperationEvent[], status: OperationStatus, evidence: unknown): OperationEvent {
    if (!privateKeyPem) throw new Error("OPERATION_SIGNER_REQUIRED");
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519" || !createPublicKey(key).equals(publicKey)) throw new Error("OPERATION_INVALID_KEY");
    if (digest(read()) !== digest(prior)) throw new Error("OPERATION_CONCURRENT_CHANGE");
    if (prior.length ? !allowed[prior.at(-1)!.status].includes(status) : status !== "prepared") throw new Error("OPERATION_INVALID_TRANSITION");
    const payload = { schema: "aidlc.operation-event/v1" as const, project: root, operation_id: id, binding_digest: bindingDigest,
      sequence: prior.length, previous: prior.length ? digest(prior.at(-1)) : null, status, recorded_at: new Date().toISOString(), evidence };
    const event = { ...payload, signature: sign(null, Buffer.from(canonicalProviderJson(payload)), key).toString("base64") };
    mkdirSync(dir, { recursive: true, mode: 0o700 }); operationPath(project, `.aidlc/operations/${id}`);
    try { durableExclusive(resolve(dir, `${String(prior.length).padStart(6, "0")}.json`), event); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("OPERATION_ALREADY_CLAIMED"); throw error; }
    return event;
  }
  return { read, append };
}
