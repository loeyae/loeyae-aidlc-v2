import { acquireOwnedLock } from "./aidlc-owned-lock";
/** Local Core authorization store. No workflow imports and no authoring-JSON issuer. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { userInfo,hostname } from "node:os";
import tty from "node:tty";
import readline from "node:readline/promises";
import { semanticCheckerDigest } from "./aidlc-checker-identity";
import { autonomyDigest as digest, canonicalAutonomyJson as json, object, records, safeFile } from "./aidlc-autonomy-files";
import type { SessionBinding, WorkflowState } from "./aidlc-light-state";
import { dependencyClaimConflict } from "./aidlc-dependency-inputs";
import {assertAutonomyBatchResultRef,type AutonomyBatchResultRef} from "./aidlc-autonomy-state";

type Row = Record<string, unknown>;
export const GRANT_OPERATIONS = ["design-write", "code-write", "test-write", "validation-execute", "environment-write", "decision-record", "workflow-write", "stage-report", "evidence-publish", "provider-execute", "candidate-commit", "candidate-integrate", "push", "protected-branch-write", "deploy"] as const;
export type GrantOperation = typeof GRANT_OPERATIONS[number];
export interface ExecutionGrantRef { version: "1"; grant_id: string; run_id: string; digest: string; }
export interface GrantInput { path: string; digest: string | "absent"; selector?: { record_type: string; record_id: string }; }
export interface GrantPayload {
  grant_id: string; run_id: string; batch_id: string; scope_revision: number;
  project_identity: { realpath: string; repository_identity: string };
  workflow_refs: { workflow_id: string; owner_kind: "global" | "module" | "integration"; module_id?: string }[];
  policy_ref: Row; baseline_digest: string; inputs: GrantInput[];
  request_started_at: string; expires_at: string; revocation_revision: 1;
  allowed_operations: GrantOperation[];
  executor_constraints: { host: Row; session_id: string; owner: string; initial_binding: SessionBinding; module_ids: string[]; unit_keys: string[]; implementation_unit_keys: string[]; write_paths: string[] };
  successor_policy: "disabled" | { version: "1"; mode: "same-host-session"; max_restarts: number };
  resource_limits: { wall_time_seconds: number; max_equivalent_retries: number; max_active_units: number };
  integration_permissions: Record<string, boolean>;
}
export interface IssuedExecutionGrant extends GrantPayload {
  schema: "aidlc.execution-grant/v1"; issued_at: string; authority_ref: Row; approval_digest: string;
  issuer_provenance: { key_id: string; algorithm: "ed25519"; signature: string };
}
export function grantFailure(message: string): never { throw new Error(`EXECUTION_GRANT_INVALID: ${message}`); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function assertExecutionGrantRef(value: unknown): asserts value is ExecutionGrantRef {
  const ref = object(value, "ExecutionGrantRef", ["version", "grant_id", "run_id", "digest"]);
  if (Object.keys(ref).length !== 4 || ref.version !== "1" || !uuid.test(String(ref.grant_id)) || !uuid.test(String(ref.run_id)) || !/^[a-f0-9]{64}$/.test(String(ref.digest))) grantFailure("malformed managed grant reference");
}
function bytesDigest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function localPath(base: string, label: string): string {
  if (!label || isAbsolute(label) || win32.isAbsolute(label) || /[\\:\u0000-\u001f]/.test(label) || label.split("/").some(p => !p || p === "." || p === ".." || /[ .]$/.test(p))) grantFailure("unsafe control path");
  const root = realpathSync(base), path = resolve(root, label), rel = relative(root, path);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) grantFailure("control path escapes root");
  for (let current = path; current !== root; current = dirname(current)) {
    if (existsSync(current)) { const s = lstatSync(current); if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1) grantFailure("linked control path"); }
  }
  return path;
}
function smallFile(path: string): string {
  const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 4 * 1024 * 1024) grantFailure("invalid/big control file");
  return readFileSync(path, "utf8");
}
/** External file writers cannot change pinned inputs, even through a native filesystem alias. */
function frozenWriteTarget(root: string, label: string, inputs: GrantInput[]): boolean {
  const fold = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const requested = fold(label);
  if (inputs.some(input => fold(input.path) === requested || fold(input.path).startsWith(requested + "/"))) return true;
  const target = localPath(root, label);
  if (!existsSync(target)) return false;
  const targetStat = lstatSync(target, { bigint: true }), canonical = realpathSync(target);
  return inputs.some(input => {
    const pinned = localPath(root, input.path);
    if (!existsSync(pinned)) return false;
    const pinnedStat = lstatSync(pinned, { bigint: true }), pinnedCanonical = realpathSync(pinned);
    if (fold(canonical) === fold(pinnedCanonical) || targetStat.ino !== 0n && targetStat.dev === pinnedStat.dev && targetStat.ino === pinnedStat.ino) return true;
    if (!targetStat.isDirectory()) return false;
    const rel = relative(canonical, pinnedCanonical);
    return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
  });
}
function commonGit(root: string): string {
  const entry = localPath(root, ".git"); if (!existsSync(entry)) grantFailure("grant signing requires an existing Git repository");
  let path = entry;
  if (lstatSync(entry).isFile()) {
    const match = /^gitdir: (.+)\r?\n?$/.exec(smallFile(entry)); if (!match) grantFailure("invalid Git directory reference"); path = resolve(root, match[1]);
  }
  path = realpathSync(path); if (!lstatSync(path).isDirectory()) grantFailure("invalid Git directory");
  const common = localPath(path, "commondir"); if (existsSync(common)) path = realpathSync(resolve(path, smallFile(common).trim()));
  if (!existsSync(localPath(path, "HEAD")) || !existsSync(localPath(path, "config"))) grantFailure("incomplete Git common directory");
  return path;
}
export function grantProjectIdentity(root: string): GrantPayload["project_identity"] {
  return { realpath: realpathSync(root), repository_identity: digest({ git_common_directory: commonGit(root) }) };
}
function exclusive(path: string, value: unknown): void {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
function replace(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try { exclusive(temporary, value); renameSync(temporary, path); } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function issuer(root: string, create = false): { key_id: string; public_key: string; private_key: string } {
  const common = commonGit(root), path = localPath(common, "aidlc/autonomy/issuer.json");
  if (!existsSync(path)) {
    if (!create) grantFailure("trusted issuer key is missing");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); localPath(common, "aidlc/autonomy/issuer.json");
    const pair = generateKeyPairSync("ed25519"), public_key = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    exclusive(path, { key_id: digest(public_key), public_key, private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
  }
  const value = object(JSON.parse(smallFile(path)), "issuer", ["key_id", "public_key", "private_key"]);
  if (typeof value.public_key !== "string" || typeof value.private_key !== "string") grantFailure("issuer keys must be PEM strings");
  const key = createPublicKey(value.public_key), privateKey = createPrivateKey(value.private_key);
  if (key.asymmetricKeyType !== "ed25519" || !createPublicKey(privateKey).equals(key) || digest(value.public_key) !== value.key_id) grantFailure("issuer key mismatch");
  return value as ReturnType<typeof issuer>;
}
function signed(root: string, body: Row): Row {
  const key = issuer(root, true);
  return { ...body, issuer_provenance: { key_id: key.key_id, algorithm: "ed25519", signature: sign(null, Buffer.from(json(body)), key.private_key).toString("base64") } };
}
/** Internal producer receipt, using the existing project issuer; no CLI issuer or new authority. */
export function sealPhaseExecution(root: string, body: Row): Row {
  if (body.schema !== "aidlc.phase-execution/v1" || body.producer !== "loeyae-aidlc-evidence" || body.exit_code !== 0) throw Error("CR_OBSERVATION_PROVENANCE_INVALID");
  return signed(root, body);
}
export function verifyPhaseExecution(root: string, body: unknown): Row {
  return verified(root, body, "aidlc.phase-execution/v1");
}
function verified(root: string, value: unknown, schema: string): Row {
  const row = object(value, "signed receipt"), { issuer_provenance: proof, ...body } = row, key = issuer(root);
  const p = object(proof, "issuer_provenance", ["key_id", "algorithm", "signature"]);
  if (body.schema !== schema || p.key_id !== key.key_id || p.algorithm !== "ed25519" || typeof p.signature !== "string" || !verify(null, Buffer.from(json(body)), key.public_key, Buffer.from(p.signature, "base64"))) grantFailure("unsigned or tampered Core receipt");
  return row;
}
function anchorPath(root: string, id: string): string {
  if (!uuid.test(id)) grantFailure("invalid grant id");
  return localPath(commonGit(root), `aidlc/autonomy/anchors/${digest(realpathSync(root))}-${id}.json`);
}
const locks = new Map<string, "publication" | "administration">();
const recoveryCache=new Map<string,any>();
/** P2 durable state lives outside the model writable tree. The immutable revision is
 * written before the head: a crash in between is an explicit reconciliation stop. */
export function readRecoveryState(root:string, global:WorkflowState): any | undefined {
  if(!global.execution_grant_ref)return undefined;
  const dir=localPath(commonGit(root),`aidlc/autonomy/recovery/${digest(realpathSync(root))}-${global.execution_grant_ref.grant_id}`);
  if(!existsSync(dir))return undefined;
  const names=readdirSync(dir),head=localPath(dir,'head.json');
  if(!existsSync(head))throw Error('RECOVERY_TORN_COMMIT');
  const pointer=verified(root,JSON.parse(smallFile(head)),'aidlc.recovery-head/v1');
  if(!Number.isSafeInteger(pointer.revision)||Number(pointer.revision)<1||names.length!==Number(pointer.revision)+1)throw Error('RECOVERY_TORN_COMMIT');
  const cached=recoveryCache.get(dir);
  if(cached?.record_digest===pointer.digest&&cached.revision===pointer.revision){
    const tip=JSON.parse(smallFile(localPath(dir,`${String(pointer.revision).padStart(6,'0')}.json`)));
    if(digest(tip)!==pointer.digest)throw Error('RECOVERY_IDENTITY_CHANGED');return structuredClone(cached);
  }
  const checkpoint=Math.max(1,Math.floor(Number(pointer.revision)/32)*32);let state:any,tip:string|undefined;
  for(let n=checkpoint;n<=Number(pointer.revision);n++){
    const snapshot=n===checkpoint,row=verified(root,JSON.parse(smallFile(localPath(dir,`${String(n).padStart(6,'0')}.json`))),snapshot?'aidlc.recovery-state/v1':'aidlc.recovery-delta/v1');
    if(row.project!==realpathSync(root)||json(row.grant_ref)!==json(global.execution_grant_ref)||row.revision!==n||!snapshot&&row.previous_digest!==tip)throw Error('RECOVERY_IDENTITY_CHANGED');
    if(snapshot){const {issuer_provenance:_,...body}=row;state=body;}
    else {for(const change of row.patch as [string[],unknown?][]){const [keys,value]=change;let target=state;for(const key of keys.slice(0,-1)){if(['__proto__','prototype','constructor'].includes(key))throw Error('RECOVERY_PATCH_INVALID');target=target[key]??=(Object.create(null));}const last=keys.at(-1)!;if(['__proto__','prototype','constructor'].includes(last))throw Error('RECOVERY_PATCH_INVALID');if(change.length===1)delete target[last];else target[last]=value;}state.revision=n;state.previous_digest=row.previous_digest;state.recorded_at=row.recorded_at;}
    tip=digest(row);
  }
  if(tip!==pointer.digest)throw Error('RECOVERY_IDENTITY_CHANGED');
  const result={...state,record_digest:tip};if(recoveryCache.size>=64)recoveryCache.delete(recoveryCache.keys().next().value!);recoveryCache.set(dir,result);return structuredClone(result);
}
function recoveryPatch(before:any,after:any,path:string[]=[],out:[string[],unknown?][]=[]):[string[],unknown?][]{
 if(json(before)===json(after))return out;
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
   for(const key of Object.keys(after))recoveryPatch(before[key]??null,after[key],path.concat(key),out);
   for(const key of Object.keys(before))if(!(key in after))out.push([path.concat(key)]);
 }else out.push([path,after]);return out;
}
export function storeRecoveryState(root:string,global:WorkflowState,body:any,expected:number):any {
  if(locks.get(realpathSync(root))!=='publication')throw Error('RECOVERY_PUBLICATION_REQUIRED');
  const previous=readRecoveryState(root,global);
  if((previous?.revision||0)!==expected)throw Error('RECOVERY_CAS_CONFLICT');
  if(expected>=20000)throw Error('RECOVERY_RECORD_LIMIT');
  const {issuer_provenance:_,record_digest:__,...input}=body;
  const next={...input,schema:'aidlc.recovery-state/v1',project:realpathSync(root),grant_ref:global.execution_grant_ref,revision:expected+1,previous_digest:previous?.record_digest||null,recorded_at:new Date().toISOString()};
  const snapshot=expected===0||(expected+1)%32===0;
  const {record_digest:___,...before}=previous||{};
  const row=signed(root,snapshot?next:{schema:'aidlc.recovery-delta/v1',project:next.project,grant_ref:next.grant_ref,revision:next.revision,previous_digest:next.previous_digest,recorded_at:next.recorded_at,patch:recoveryPatch(before,next)});
  if(Buffer.byteLength(JSON.stringify(next))>3*1024*1024)throw Error('RECOVERY_STATE_LIMIT');
  if(Buffer.byteLength(JSON.stringify(row))>3*1024*1024)throw Error('RECOVERY_STATE_LIMIT');
  const dir=localPath(commonGit(root),`aidlc/autonomy/recovery/${digest(realpathSync(root))}-${global.execution_grant_ref!.grant_id}`);
  mkdirSync(dir,{recursive:true});exclusive(localPath(dir,`${String(expected+1).padStart(6,'0')}.json`),row);
  replace(localPath(dir,'head.json'),signed(root,{schema:'aidlc.recovery-head/v1',revision:expected+1,digest:digest(row)}));
  const result={...next,record_digest:digest(row)};recoveryCache.set(dir,structuredClone(result));return result;
}
export function assertRecoveryExecutor(root:string,global:WorkflowState):any {
  const state=readRecoveryState(root,global);if(!state)return;
  if(state.status!=='active'||!process.env.AIDLC_ATTEMPT_TOKEN||digest(process.env.AIDLC_ATTEMPT_TOKEN)!==state.token_digest)throw Error('RECOVERY_EXECUTOR_FENCED');
  return state;
}
export function auditRecoveryHistory(root:string,global:WorkflowState):void {
 const current=readRecoveryState(root,global);if(!current)return;
 const dir=localPath(commonGit(root),`aidlc/autonomy/recovery/${digest(realpathSync(root))}-${global.execution_grant_ref!.grant_id}`);
 let previous:Row|undefined;
 for(let n=1;n<=current.revision;n++){
   const row=verified(root,JSON.parse(smallFile(localPath(dir,`${String(n).padStart(6,'0')}.json`))),n===1||n%32===0?'aidlc.recovery-state/v1':'aidlc.recovery-delta/v1');
   if(row.revision!==n||row.previous_digest!==(previous?digest(previous):null)||row.project!==realpathSync(root)||json(row.grant_ref)!==json(global.execution_grant_ref))throw Error('RECOVERY_HISTORY_CHANGED');
   previous=row;
 }
}
/** P2-01: checkpoint history in the existing trusted store, not stage state.
 * No mutable current pointer: a torn append remains visible and blocks readers.
 * Restoring the entire trusted store is still an operator reconciliation boundary.
 */
function runHistoryDirectory(root: string, global: WorkflowState): string {
  assertExecutionGrantRef(global.execution_grant_ref);
  return localPath(commonGit(root), `aidlc/autonomy/runs/${digest(realpathSync(root))}-${global.execution_grant_ref.grant_id}`);
}
export function readRunCheckpoints(root: string, global: WorkflowState): Row[] {
  if (!global.execution_grant_ref) return [];
  const directory = runHistoryDirectory(root, global);
  if (!existsSync(directory)) return [];
  const files = readdirSync(directory).sort(), rows: Row[] = [];
  if (files.length > 4096) throw Error("RUN_CHECKPOINT_LIMIT");
  for (const [index, name] of files.entries()) {
    if (name !== `${String(index + 1).padStart(6, "0")}.json`) throw Error("RUN_CHECKPOINT_CHAIN_INCOMPLETE");
    const row = verified(root, JSON.parse(smallFile(localPath(directory, name))), "aidlc.run-checkpoint/v1");
    if (row.project !== realpathSync(root) || json(row.grant_ref) !== json(global.execution_grant_ref)
      || json(row.batch_ref) !== json(global.autonomy_batch) || row.sequence !== index + 1
      || row.previous_digest !== (index ? digest(rows[index - 1]) : null)) throw Error("RUN_CHECKPOINT_IDENTITY_CHANGED");
    rows.push(row);
  }
  return rows;
}
export function storeRunCheckpoint(root: string, global: WorkflowState, body: Row, expected: string): Row {
  if (locks.get(realpathSync(root)) !== "publication" || body.schema !== "aidlc.run-checkpoint/v1"
    || body.project !== realpathSync(root) || json(body.grant_ref) !== json(global.execution_grant_ref)
    || json(body.batch_ref) !== json(global.autonomy_batch)) throw Error("RUN_CHECKPOINT_PUBLICATION_INVALID");
  const prior = readRunCheckpoints(root, global), head = prior.at(-1), headDigest = head ? digest(head) : "absent";
  if (expected !== headDigest || body.sequence !== prior.length + 1 || body.previous_digest !== (head ? headDigest : null)) throw Error("RUN_CHECKPOINT_CONFLICT");
  if (prior.length >= 4096) throw Error("RUN_CHECKPOINT_LIMIT");
  const receipt = signed(root, body);
  if (Buffer.byteLength(JSON.stringify(receipt)) > 256 * 1024) throw Error("RUN_CHECKPOINT_LIMIT");
  const directory = runHistoryDirectory(root, global);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = localPath(directory, `${String(body.sequence).padStart(6, "0")}.json`);
  exclusive(file, receipt);
  return receipt;
}
export function withGrantControl<T>(root: string, publish: () => T, administration = false, create = false): T {
  const project = realpathSync(root);
  if (locks.has(project)) { if (administration) grantFailure("cannot issue/revoke inside an in-flight publication"); return publish(); }
  const lockPath = localPath(root, ".aidlc/autonomy/control.lock");
  if (create) mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const release = acquireOwnedLock(lockPath);
  locks.set(project, administration ? "administration" : "publication");
  try { return publish(); } finally { locks.delete(project); release(); }
}

/** Opaque, process-local proof; serializing an AuthorityRef cannot create one. */
export interface OperatorApproval { readonly opaque_operator_approval: unique symbol; }
const approvals = new WeakMap<OperatorApproval, { root: string; payload: string; response: string; at: string; actor: string; source?: string }>();
/** Only reviewed, installed host code may supply this transport. Not a CLI,
 * model tool, or a JSON capability declaration. inspect verifies the native
 * user-event channel in that host; request reads its authenticated UI event. */
export interface NativeApprovalChannel {
  inspect(): { host: Row; user_channel_verified: true };
  request(prompt: { payload: Row; request_digest: string; nonce: string; challenge: string }, signal: AbortSignal): Promise<{
    origin: "user"; event_id: string; actor: string; nonce: string; request_digest: string; response: string;
  }>;
}
export async function captureNativeOperatorApproval(root: string, payload: GrantPayload, channel: NativeApprovalChannel): Promise<OperatorApproval> {
  const serialized = json(payload), requestDigest = digest(payload), nonce = randomUUID(), expectedHost = json(payload.executor_constraints.host);
  const verifyChannel = () => { const actual = channel.inspect(); if (actual?.user_channel_verified !== true || json(actual.host) !== expectedHost) grantFailure("native approval channel is not verified for the exact HostRef/configuration"); };
  verifyChannel();
  const remaining = Math.min(300_000, Date.parse(payload.expires_at) - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0 || Date.now() < Date.parse(payload.request_started_at)) grantFailure("native approval request expired");
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("NATIVE_APPROVAL_TIMEOUT")); }, remaining); });
  try {
    const event = await Promise.race([channel.request({ payload: JSON.parse(serialized), request_digest: requestDigest, nonce, challenge: `Approve ${requestDigest}` }, controller.signal), timeout]);
    verifyChannel();
    if (json(payload) !== serialized || event?.origin !== "user" || event.nonce !== nonce || event.request_digest !== requestDigest || event.response !== `Approve ${requestDigest}` || !event.actor?.trim() || !/^[A-Za-z0-9_.:-]{1,180}$/.test(event.event_id) || Date.now() >= Date.parse(payload.expires_at)) grantFailure("native approval must be the exact authenticated user event");
    const token = Object.freeze({}) as OperatorApproval;
    approvals.set(token, { root: realpathSync(root), payload: serialized, response: json(event), at: new Date().toISOString(), actor: event.actor, source: `native-host:${String(payload.executor_constraints.host.host_id)}:${event.event_id}` });
    return token;
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
export async function captureOperatorApproval(root: string, payload: Row): Promise<OperatorApproval> {
  if (!tty.isatty(0) || !tty.isatty(1)) grantFailure("authorization requires the trusted operator terminal; piped JSON/--user-input is not approval");
  const serialized = json(payload), challenge = `Approve ${digest(payload)}`;
  process.stdout.write(`\nExecution authorization request (not quality approval):\n${JSON.stringify(payload, null, 2)}\n`);
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let response: string; try { response = await terminal.question(`Type exactly ${challenge}\n> `); } finally { terminal.close(); }
  if (response !== challenge) grantFailure("operator did not approve the exact request");
  const token = Object.freeze({}) as OperatorApproval;
  approvals.set(token, { root: realpathSync(root), payload: serialized, response, at: new Date().toISOString(), actor: `os-user:${userInfo().username}` });
  return token;
}
function consumeApproval(root: string, payload: Row, token: OperatorApproval): Row {
  const proof = token && approvals.get(token);
  if (!proof || proof.root !== realpathSync(root) || proof.payload !== json(payload) || Date.now() - Date.parse(proof.at) > 300_000 || Date.now() < Date.parse(proof.at)) grantFailure("a current, exact trusted host approval is required; JSON cannot authorize");
  approvals.delete(token);
  return { source_kind: "operator-instruction", source_locator: proof.source || `operator-terminal:${digest(payload)}`, source_digest: bytesDigest(Buffer.from(proof.response, "utf8")), scope_summary: `${payload.batch_id}/${payload.scope_revision}`, actor_locator: proof.actor, captured_at: proof.at, response: proof.response };
}
export function storeIssuedGrant(root: string, payload: GrantPayload, approval: OperatorApproval): ExecutionGrantRef {
  if (locks.get(realpathSync(root)) !== "administration") grantFailure("issuer requires the control transaction");
  if (Date.now() < Date.parse(payload.request_started_at) || Date.now() >= Date.parse(payload.expires_at)) grantFailure("authorization request expired before issuance");
  const source = consumeApproval(root, payload as unknown as Row, approval);
  const receipt = signed(root, { schema: "aidlc.grant-approval/v1", project: realpathSync(root), request_digest: digest(payload), ...source });
  const { captured_at: _, response: __, ...authority_ref } = source;
  const grant = signed(root, { ...payload, schema: "aidlc.execution-grant/v1", issued_at: new Date().toISOString(), authority_ref, approval_digest: digest(receipt) });
  const path = localPath(root, `.aidlc/autonomy/grants/${payload.grant_id}`); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); mkdirSync(path, { mode: 0o700 });
  exclusive(localPath(root, `.aidlc/autonomy/grants/${payload.grant_id}/approval.json`), receipt);
  exclusive(localPath(root, `.aidlc/autonomy/grants/${payload.grant_id}/grant.json`), grant);
  const anchor = anchorPath(root, payload.grant_id); mkdirSync(dirname(anchor), { recursive: true, mode: 0o700 });
  exclusive(anchor, signed(root, { schema: "aidlc.grant-anchor/v1", project: realpathSync(root), grant_id: payload.grant_id, grant_digest: digest(grant), revision: 1, revocation_digest: null }));
  return { version: "1", grant_id: payload.grant_id, run_id: payload.run_id, digest: digest(grant) };
}
export function readIssuedGrant(root: string, ref: ExecutionGrantRef): { grant: IssuedExecutionGrant; revision: number; revoked: boolean } {
  assertExecutionGrantRef(ref);
  const base = `.aidlc/autonomy/grants/${ref.grant_id}`;
  const grant = verified(root, JSON.parse(readFileSync(safeFile(root, `${base}/grant.json`), "utf8")), "aidlc.execution-grant/v1") as unknown as IssuedExecutionGrant;
  if (grant.grant_id !== ref.grant_id || grant.run_id !== ref.run_id || digest(grant) !== ref.digest || json(grant.project_identity) !== json(grantProjectIdentity(root))) grantFailure("grant identity/project mismatch");
  const approval = verified(root, JSON.parse(readFileSync(safeFile(root, `${base}/approval.json`), "utf8")), "aidlc.grant-approval/v1");
  const { issuer_provenance: _, schema: __, issued_at: ___, authority_ref: ____, approval_digest: _____, ...payload } = grant;
  if (digest(approval) !== grant.approval_digest || approval.request_digest !== digest(payload) || approval.project !== realpathSync(root)) grantFailure("approval does not bind this grant");
  const anchor = verified(root, JSON.parse(smallFile(anchorPath(root, ref.grant_id))), "aidlc.grant-anchor/v1");
  if (anchor.project !== realpathSync(root) || anchor.grant_id !== ref.grant_id || anchor.grant_digest !== ref.digest || ![1, 2].includes(Number(anchor.revision))) grantFailure("invalid grant anchor");
  const revokedPath = `${base}/revocation.json`;
  if (anchor.revision === 2 || existsSync(join(root, revokedPath))) {
    const revocation = verified(root, JSON.parse(readFileSync(safeFile(root, revokedPath), "utf8")), "aidlc.grant-revocation/v1");
    if (anchor.revision !== 2 || anchor.revocation_digest !== digest(revocation) || revocation.grant_digest !== ref.digest || revocation.revision !== 2) grantFailure("revocation/anchor mismatch; reconciliation required");
  } else if (anchor.revocation_digest !== null) grantFailure("invalid initial grant anchor");
  return { grant, revision: anchor.revision as number, revoked: anchor.revision === 2 };
}
export function storeGrantRevocation(root: string, ref: ExecutionGrantRef, request: Row, approval: OperatorApproval): void {
  if (locks.get(realpathSync(root)) !== "administration") grantFailure("revocation requires the control transaction");
  const current = readIssuedGrant(root, ref);
  if (current.revoked || request.expected_revision !== current.revision || request.grant_digest !== ref.digest) grantFailure("revocation revision changed; reread before retry");
  const authority_ref = consumeApproval(root, request, approval);
  const event = signed(root, { schema: "aidlc.grant-revocation/v1", project: realpathSync(root), grant_id: ref.grant_id, grant_digest: ref.digest, revision: 2, recorded_at: new Date().toISOString(), reason: request.reason, authority_ref });
  exclusive(localPath(root, `.aidlc/autonomy/grants/${ref.grant_id}/revocation.json`), event);
  replace(anchorPath(root, ref.grant_id), signed(root, { schema: "aidlc.grant-anchor/v1", project: realpathSync(root), grant_id: ref.grant_id, grant_digest: ref.digest, revision: 2, revocation_digest: digest(event) }));
}

let inputValidationSnapshot: Set<string> | undefined;
/** Synchronous, read-only preparation batch only; never spans tool execution or
 * publication. Dynamic grant/claim/deadline checks are deliberately not cached. */
export function withGrantInputSnapshot<T>(read: () => T): T {
  if (inputValidationSnapshot) return read();
  inputValidationSnapshot = new Set();
  try {
    const result = read();
    if (result && typeof (result as any).then === "function") throw Error("GRANT_INPUT_SNAPSHOT_MUST_BE_SYNCHRONOUS");
    return result;
  } finally { inputValidationSnapshot = undefined; }
}
export function validateGrantInputs(root: string, inputs: GrantInput[]): void {
  for (const input of inputs) {
    const key = JSON.stringify([realpathSync(root), input]);
    if (inputValidationSnapshot?.has(key)) continue;
    if (input.digest === "absent") { if (existsSync(localPath(root, input.path))) grantFailure(`new baseline dependency appeared: ${input.path}`); inputValidationSnapshot?.add(key); continue; }
    const bytes = readFileSync(safeFile(root, input.path));
    const selected = input.selector ? records(root, input.path).find(r => r.record_type === input.selector!.record_type && r.record_id === input.selector!.record_id) : undefined;
    if (input.selector && !selected) grantFailure(`grant baseline record is missing: ${input.path}`);
    const actual = selected ? digest(selected) : bytesDigest(bytes);
    if (actual !== input.digest) grantFailure(`grant baseline changed: ${input.path}`);
    inputValidationSnapshot?.add(key);
  }
}
export function checkExecutionGrant(root: string, global: WorkflowState, binding: SessionBinding | undefined, operations: readonly GrantOperation[], path?: string, bootstrap = false): IssuedExecutionGrant | undefined {
  if (!global.execution_grant_version) {
    if (global.autonomy_contract_version && requiresAdmission(binding, operations)) throw new Error("ADMISSION_NOT_READY: adopted autonomous implementation requires an actual ExecutionGrant and managed admission receipt");
    return undefined;
  }
  const ref = global.execution_grant_ref!; assertExecutionGrantRef(ref);
  if (!bootstrap) {
    const envRef: unknown = JSON.parse(process.env.AIDLC_EXECUTION_GRANT || "null"); assertExecutionGrantRef(envRef);
    if (json(envRef) !== json(ref)) grantFailure("the session has not bound the active grant");
  }
  const { grant, revoked } = readIssuedGrant(root, ref), now = Date.now();
  if (revoked) grantFailure("grant revoked; new operations/publication are forbidden");
  if (now < Date.parse(grant.issued_at) || now >= Date.parse(grant.expires_at) || now >= Date.parse(grant.request_started_at) + grant.resource_limits.wall_time_seconds * 1000) grantFailure("grant expired or clock precedes issuance");
  if (!binding || binding.session_id !== grant.executor_constraints.session_id || binding.owner !== grant.executor_constraints.owner || !grant.workflow_refs.some(w => w.workflow_id === binding.workflow_id)) grantFailure("grant is bound to another session/owner/workflow; successor recovery is disabled");
  const host: unknown = JSON.parse(process.env.AIDLC_AUTONOMY_HOST || "null"); if (json(host) !== json(grant.executor_constraints.host)) grantFailure("host identity/configuration differs from the approved host");
  if(grant.successor_policy!=="disabled"&&assertRecoveryExecutor(root,global)?.cancel_requested)grantFailure('run cancellation requested');
  if (global.autonomy_batch?.scope_digest !== grant.baseline_digest || json(global.autonomy_batch && { batch_id: global.autonomy_batch.batch_id, scope_revision: global.autonomy_batch.scope_revision }) !== json({ batch_id: grant.batch_id, scope_revision: grant.scope_revision })) grantFailure("grant scope/policy baseline differs from the adopted workflow");
  const module = /@module:([a-z0-9-]+)/.exec(binding.stage_instance)?.[1], unit = /@unit:([a-z0-9-]+)$/.exec(binding.stage_instance)?.[1];
  if (operations.some(op => op === "code-write" || op === "test-write") && !unit) grantFailure("code/test writes require an exact approved unit-stage claim");
  if (unit && operations.some(op => ["code-write", "test-write", "decision-record"].includes(op)) && !grant.executor_constraints.implementation_unit_keys.includes(`${module}/${unit}`)) grantFailure("consume/verify scope does not authorize implementation changes");
  if (module && !grant.executor_constraints.module_ids.includes(module) || unit && !grant.executor_constraints.unit_keys.includes(`${module}/${unit}`)) grantFailure("stage is outside the approved module/unit scope");
  for (const operation of operations) {
    if (!GRANT_OPERATIONS.includes(operation) || !grant.allowed_operations.includes(operation)) grantFailure(`operation is not allowed: ${operation}`);
    const permission: Partial<Record<GrantOperation, string>> = { "candidate-commit": "candidate_commit", "candidate-integrate": "candidate_integrate", push: "push", "protected-branch-write": "protected_branch_write", deploy: "deploy" };
    if (permission[operation] && grant.integration_permissions[permission[operation]!] !== true) grantFailure(`integration permission is absent: ${operation}`);
  }
  if (path === undefined && operations.some(op => ["design-write", "code-write", "test-write", "environment-write"].includes(op))) grantFailure("business write operations require an exact target path");
  if (path !== undefined) {
    localPath(root, path);
    if (path.split("/").some(part => part === ".git" || part === ".aidlc") || path === "aidlc/active" || path.startsWith("aidlc/active/") || !grant.executor_constraints.write_paths.some(prefix => path === prefix || path.startsWith(prefix + "/"))) grantFailure("tool target is outside approved business write paths");
    if (operations.some(operation => ["design-write", "code-write", "test-write", "environment-write"].includes(operation)) && frozenWriteTarget(root, path, grant.inputs)) grantFailure("tool target contains a frozen grant input");
  }
  validateGrantInputs(root, grant.inputs);
  if (!bootstrap && requiresAdmission(binding, operations)) assertAdmissionReceipt(root, global);
  return grant;
}

/** Admission is a second gate, never a replacement for checkExecutionGrant. */
export const ADMISSION_CHECKS = ["scope-policy", "execution-grant", "design-reception", "dependency-readiness", "validation-plan", "environment", "host-capabilities", "execution-preflight"] as const;
export const IMPLEMENTATION_ENTRY_STAGES = ["shared-contract-baseline", "tdd", "code-generation"] as const;
export function requiresAdmission(binding: SessionBinding | undefined, operations: readonly GrantOperation[]): boolean {
  return operations.some(op => op === "code-write" || op === "test-write") || operations.some(op => op !== "decision-record") && IMPLEMENTATION_ENTRY_STAGES.some(stage => binding?.stage_instance.split("@")[0] === stage);
}
export function admissionEnvironment(names: string[], executables: string[]): Row {
  return { variables: names.map(name => [name, digest(process.env[name] ?? null)]), executables: executables.map(path => {
    if (!isAbsolute(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("ADMISSION_INPUT_CHANGED: invalid executable");
    return [path, bytesDigest(readFileSync(path))];
  }) };
}
export function admissionDecisions(root: string): string {
  const path = "docs/aidlc/handoff.md";
  if (!existsSync(join(root, path))) return digest([]);
  const text = readFileSync(safeFile(root, path), "utf8");
  return digest(text.includes("```aidlc-autonomy") ? records(root, path).filter(r => r.record_type === "decision").map(r => {
    // Output/evidence bookkeeping does not change the effective design. Unknown fields
    // stay in the fingerprint; a changed/rejected human decision still invalidates it.
    const { revision: _, implementation_refs: __, validation_refs: ___, recorded_by: ____, human_review, ...design } = r;
    const review = human_review as Row | undefined;
    return { ...design, review_gate: ["pending", "accepted"].includes(String(review?.status)) ? "no-rework" : human_review };
  }) : []);
}
function admissionPointer(global: WorkflowState): string {
  const s = global.autonomy_batch!;
  if (!s || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.batch_id) || !Number.isSafeInteger(s.scope_revision) || s.scope_revision < 1) throw new Error("ADMISSION_NOT_READY: no adopted batch");
  return `.aidlc/evidence/autonomous-admission/${s.batch_id}/${s.scope_revision}/current.json`;
}
/** Internal producer API. CLI authoring data never calls this signer directly. */
export function storeAdmissionReport(root: string, global: WorkflowState, body: Row): Row {
  if (locks.get(realpathSync(root)) !== "publication") throw new Error("ADMISSION_NOT_READY: managed publication transaction required");
  if (body.schema !== "aidlc.admission-receipt/v1" || body.checker_digest !== semanticCheckerDigest(true) || json(body.batch_ref) !== json(global.autonomy_batch) || json(body.grant_ref) !== json(global.execution_grant_ref)) throw new Error("ADMISSION_NOT_READY: producer binding differs");
  const checks = body.checks as Row[];
  if (!Array.isArray(checks) || checks.length !== ADMISSION_CHECKS.length || ADMISSION_CHECKS.some(id => checks.filter(c => c.check_id === id && c.required === true).length !== 1)) throw new Error("ADMISSION_NOT_READY: incomplete check inventory");
  const ready = checks.every(c => c.status === "passed" || c.status === "not-applicable");
  if (ready !== ["ready", "ready-with-delegated-decisions"].includes(String(body.admission_result))) throw new Error("ADMISSION_NOT_READY: inconsistent outcome");
  validateGrantInputs(root, body.baseline_inputs as GrantInput[]);
  const pointer = admissionPointer(global), path = pointer.replace("current.json", `${randomUUID()}.json`), receipt = signed(root, body);
  if (Buffer.byteLength(JSON.stringify(receipt)) > 2 * 1024 * 1024 - 1) throw new Error("ADMISSION_NOT_READY: receipt exceeds bounded reader size");
  mkdirSync(dirname(localPath(root, path)), { recursive: true });
  exclusive(localPath(root, path), receipt);
  replace(localPath(root, pointer), signed(root, { schema: "aidlc.admission-pointer/v1", path, digest: digest(receipt), project: realpathSync(root) }));
  return { path, digest: digest(receipt) };
}
export function readAdmissionReport(root: string, global: WorkflowState): Row {
  const pointer = admissionPointer(global);
  if (!existsSync(join(root, pointer))) throw new Error("ADMISSION_NOT_READY: managed receipt missing; run design reception and execution preflight");
  const ref = verified(root, JSON.parse(readFileSync(safeFile(root, pointer), "utf8")), "aidlc.admission-pointer/v1");
  if (ref.project !== realpathSync(root) || typeof ref.path !== "string" || !ref.path.startsWith(dirname(pointer).replace(/\\/g, "/") + "/") || !/\/[0-9a-f-]{36}\.json$/.test(ref.path)) throw new Error("ADMISSION_NOT_READY: receipt location mismatch");
  const receipt = verified(root, JSON.parse(readFileSync(safeFile(root, ref.path), "utf8")), "aidlc.admission-receipt/v1");
  if (digest(receipt) !== ref.digest) throw new Error("ADMISSION_INPUT_CHANGED: receipt digest differs");
  return { ...receipt, receipt_ref: { path: ref.path, digest: ref.digest } };
}
/** Independent capability provenance: business admission may fail without erasing this observation. */
function hostCapabilityPointer(global:WorkflowState):string {
  const run=global.execution_grant_ref?.run_id;if(!run||!uuid.test(run))throw Error('HOST_CAPABILITY_GRANT_REQUIRED');
  return `.aidlc/evidence/native-host/${run}/capabilities/current.json`;
}
export function storeHostCapabilityReport(root:string,global:WorkflowState,body:Row):Row {
  if(locks.get(realpathSync(root))!=='publication'||body.schema!=='aidlc.host-capability-receipt/v1'||json(body.grant_ref)!==json(global.execution_grant_ref)||json(body.batch_ref)!==json(global.autonomy_batch))throw Error('HOST_CAPABILITY_PUBLICATION_INVALID');
  const pointer=hostCapabilityPointer(global),path=pointer.replace('current.json',randomUUID()+'.json'),receipt=signed(root,body);
  if(Buffer.byteLength(JSON.stringify(receipt))>2*1024*1024-1)throw Error('HOST_CAPABILITY_REPORT_LIMIT');
  mkdirSync(dirname(localPath(root,path)),{recursive:true});exclusive(localPath(root,path),receipt);
  replace(localPath(root,pointer),signed(root,{schema:'aidlc.host-capability-pointer/v1',path,digest:digest(receipt),project:realpathSync(root)}));
  return {path,digest:digest(receipt)};
}
export function readHostCapabilityReport(root:string,global:WorkflowState):any|undefined {
  const pointer=hostCapabilityPointer(global);if(!existsSync(join(root,pointer)))return undefined;
  const ref=verified(root,JSON.parse(readFileSync(safeFile(root,pointer),'utf8')),'aidlc.host-capability-pointer/v1');
  if(ref.project!==realpathSync(root)||typeof ref.path!=='string'||!ref.path.startsWith(dirname(pointer).replace(/\\/g,'/')+'/')||!/\/[a-f0-9-]{36}\.json$/.test(ref.path))throw Error('HOST_CAPABILITY_LOCATION_INVALID');
  const receipt=verified(root,JSON.parse(readFileSync(safeFile(root,ref.path),'utf8')),'aidlc.host-capability-receipt/v1');
  if(digest(receipt)!==ref.digest)throw Error('HOST_CAPABILITY_DIGEST_CHANGED');
  return {...receipt,receipt_ref:{path:ref.path,digest:ref.digest}};
}
/** P1-07 internal producer publication; distinct signature domain from admission. */
export function storeObservationReport(root:string,global:WorkflowState,body:Row):Row {
  if(locks.get(realpathSync(root))!=="publication"||body.schema!=="aidlc.observation-bundle/v1"||json(body.batch_ref)!==json(global.autonomy_batch)||json(body.grant_ref)!==json(global.execution_grant_ref))throw new Error("OBSERVATION_PUBLICATION_BINDING_INVALID");
  const current=readIssuedGrant(root,global.execution_grant_ref!);if(current.revoked||Date.now()>=Date.parse(current.grant.expires_at))throw new Error("OBSERVATION_GRANT_INVALID");
  const base=`.aidlc/evidence/autonomous-observations/${global.autonomy_batch!.batch_id}/${global.autonomy_batch!.scope_revision}`;
  const path=`${base}/${randomUUID()}.json`,receipt=signed(root,body);if(Buffer.byteLength(JSON.stringify(receipt))>2*1024*1024-1)throw new Error("OBSERVATION_RECEIPT_LIMIT");
  mkdirSync(dirname(localPath(root,path)),{recursive:true});exclusive(localPath(root,path),receipt);
  replace(localPath(root,`${base}/current.json`),signed(root,{schema:"aidlc.observation-pointer/v1",path,digest:digest(receipt),project:realpathSync(root)}));return {path,digest:digest(receipt)};
}
export function readObservationReport(root:string,global:WorkflowState):any {
  const s=global.autonomy_batch;if(!s)throw new Error("OBSERVATION_BATCH_REQUIRED");
  const base=`.aidlc/evidence/autonomous-observations/${s.batch_id}/${s.scope_revision}`;
  const pointer=verified(root,JSON.parse(readFileSync(safeFile(root,`${base}/current.json`),"utf8")),"aidlc.observation-pointer/v1");
  if(pointer.project!==realpathSync(root)||typeof pointer.path!=="string"||!pointer.path.startsWith(base+"/")||!/^\/[a-f0-9-]{36}\.json$/.test(pointer.path.slice(base.length)))throw new Error("OBSERVATION_POINTER_INVALID");
  const report=verified(root,JSON.parse(readFileSync(safeFile(root,pointer.path),"utf8")),"aidlc.observation-bundle/v1");if(digest(report)!==pointer.digest)throw new Error("OBSERVATION_DIGEST_INVALID");return {...report,receipt_ref:{path:pointer.path,digest:pointer.digest}};
}
/** P1-08 producer API: no author-supplied result or completion boolean is signed. */
export function storeBatchResult(root:string,global:WorkflowState,body:Row):AutonomyBatchResultRef {
  if(locks.get(realpathSync(root))!=="publication"||body.schema!=="aidlc.batch-result/v1"||json(body.batch_ref)!==json(global.autonomy_batch)||json(body.grant_ref)!==json(global.execution_grant_ref))throw Error("BATCH_RESULT_PUBLICATION_INVALID");
  const {grant,revoked}=readIssuedGrant(root,global.execution_grant_ref!);
  if(revoked||Date.now()>=Date.parse(grant.expires_at))throw Error("BATCH_RESULT_GRANT_INVALID");
  const result_id=randomUUID(),path=`.aidlc/evidence/autonomous-results/${global.autonomy_batch!.batch_id}/${global.autonomy_batch!.scope_revision}/${result_id}.json`;
  const receipt=signed(root,{...body,result_id});if(Buffer.byteLength(JSON.stringify(receipt))>2*1024*1024-1)throw Error("BATCH_RESULT_LIMIT");
  mkdirSync(dirname(localPath(root,path)),{recursive:true});exclusive(localPath(root,path),receipt);
  return {version:"1",result_id,batch_id:global.autonomy_batch!.batch_id,scope_revision:global.autonomy_batch!.scope_revision,path,digest:bytesDigest(readFileSync(safeFile(root,path)))};
}
export function readBatchResult(root:string,ref:AutonomyBatchResultRef):any {
  assertAutonomyBatchResultRef(ref);const bytes=readFileSync(safeFile(root,ref.path));
  if(bytesDigest(bytes)!==ref.digest)throw Error("BATCH_RESULT_BYTES_CHANGED");
  const body=verified(root,JSON.parse(bytes.toString("utf8")),"aidlc.batch-result/v1");
  if(body.result_id!==ref.result_id||(body.batch_ref as any)?.batch_id!==ref.batch_id||(body.batch_ref as any)?.scope_revision!==ref.scope_revision)throw Error("BATCH_RESULT_IDENTITY_INVALID");
  return body;
}
/** Historical decision links remain provenance, never a current-candidate verdict. */
export function readObservationAt(root:string,path:string,rawDigest:string):any {
  if(!/^\.aidlc\/evidence\/autonomous-observations\/[a-z0-9-]+\/[1-9][0-9]*\/[a-f0-9-]{36}\.json$/.test(path))throw Error("DECISION_OBSERVATION_PATH_INVALID");
  const bytes=readFileSync(safeFile(root,path));if(bytesDigest(bytes)!==rawDigest)throw Error("DECISION_OBSERVATION_CHANGED");
  return verified(root,JSON.parse(bytes.toString("utf8")),"aidlc.observation-bundle/v1");
}
/** Private same-attempt journal. A liveness observation is never authorization. */
export function readAttemptRepairState(root:string,global:WorkflowState):any|undefined {
  if(!global.execution_grant_ref)return undefined;
  const path=localPath(root,`.aidlc/autonomy/grants/${global.execution_grant_ref.grant_id}/attempt-repair.json`);
  if(!existsSync(path))return undefined;
  const body=verified(root,JSON.parse(smallFile(path)),"aidlc.attempt-repair-state/v1");
  if(json(body.grant_ref)!==json(global.execution_grant_ref)||json(body.batch_ref)!==json(global.autonomy_batch))throw Error("ATTEMPT_REPAIR_SCOPE_CHANGED");return body;
}
export function storeAttemptRepairState(root:string,global:WorkflowState,body:Record<string,any>):void {
  if(locks.get(realpathSync(root))!=="publication"||body.schema!=="aidlc.attempt-repair-state/v1"||json(body.grant_ref)!==json(global.execution_grant_ref)||json(body.batch_ref)!==json(global.autonomy_batch))throw Error("ATTEMPT_REPAIR_PUBLICATION_INVALID");
  const prior=readAttemptRepairState(root,global);
  if(body.revision!==(prior?.revision||0)+1)throw Error("ATTEMPT_REPAIR_REVISION_CONFLICT");
  const receipt=signed(root,body);if(Buffer.byteLength(JSON.stringify(receipt))>1024*1024)throw Error("ATTEMPT_REPAIR_LIMIT");
  const audit=`.aidlc/evidence/attempt-repairs/${global.execution_grant_ref!.run_id}/journal/${body.revision}.json`;
  mkdirSync(dirname(localPath(root,audit)),{recursive:true});exclusive(localPath(root,audit),receipt);
  const pointer=localPath(root,`.aidlc/autonomy/grants/${global.execution_grant_ref!.grant_id}/attempt-repair.json`);
  if(prior)replace(pointer,receipt);else exclusive(pointer,receipt);
}
/** A failed phase is diagnostic evidence, never a successful GREEN or stage result. */
export function storeAttemptPhaseFailure(root:string,global:WorkflowState,body:Record<string,any>):Row {
  if(locks.get(realpathSync(root))!=="publication"||!readAttemptRepairState(root,global)||body.schema!=="aidlc.attempt-phase-failure/v1"||json(body.grant_ref)!==json(global.execution_grant_ref)||json(body.batch_ref)!==json(global.autonomy_batch))throw Error("ATTEMPT_PHASE_FAILURE_PUBLICATION_INVALID");
  const path=`.aidlc/evidence/attempt-repairs/${global.execution_grant_ref!.run_id}/native-failures/${randomUUID()}.json`,receipt=signed(root,body);
  if(Buffer.byteLength(JSON.stringify(receipt))>2*1024*1024)throw Error("ATTEMPT_PHASE_FAILURE_LIMIT");
  mkdirSync(dirname(localPath(root,path)),{recursive:true});exclusive(localPath(root,path),receipt);
  const pointer=localPath(root,`.aidlc/autonomy/grants/${global.execution_grant_ref!.grant_id}/phase-failures/${digest(body.stage_instance)}.json`);mkdirSync(dirname(pointer),{recursive:true});
  replace(pointer,signed(root,{schema:'aidlc.attempt-phase-failure-pointer/v1',path,digest:digest(receipt),stage_instance:body.stage_instance}));return {path,digest:bytesDigest(readFileSync(safeFile(root,path)))};
}
export function readAttemptPhaseFailure(root:string,global:WorkflowState,instance:string):any|undefined {
  if(!global.execution_grant_ref)return undefined;const pointer=localPath(root,`.aidlc/autonomy/grants/${global.execution_grant_ref.grant_id}/phase-failures/${digest(instance)}.json`);if(!existsSync(pointer))return undefined;
  const ref=verified(root,JSON.parse(smallFile(pointer)),"aidlc.attempt-phase-failure-pointer/v1");
  if(typeof ref.path!=='string'||!ref.path.startsWith(`.aidlc/evidence/attempt-repairs/${global.execution_grant_ref.run_id}/native-failures/`))throw Error("ATTEMPT_PHASE_FAILURE_REF_INVALID");
  const body=verified(root,JSON.parse(readFileSync(safeFile(root,ref.path),'utf8')),"aidlc.attempt-phase-failure/v1");if(digest(body)!==ref.digest||body.stage_instance!==instance||json(body.grant_ref)!==json(global.execution_grant_ref)||json(body.batch_ref)!==json(global.autonomy_batch))throw Error("ATTEMPT_PHASE_FAILURE_CHANGED");
  return {...body,receipt_ref:{path:ref.path,digest:bytesDigest(readFileSync(safeFile(root,ref.path)))}};
}
/** Recomputed on every controlled implementation entry/publication, including report. */
export function assertAdmissionReceipt(root: string, global: WorkflowState): Row | undefined {
  if (!global.autonomy_contract_version) return undefined;
  const receipt = readAdmissionReport(root, global), now = Date.now();
  if (!["ready", "ready-with-delegated-decisions"].includes(String(receipt.admission_result))) throw new Error("ADMISSION_NOT_READY: latest controlled outcome is not-ready");
  const checks = receipt.checks as Row[];
  if (!Array.isArray(checks) || checks.length !== ADMISSION_CHECKS.length || ADMISSION_CHECKS.some(id => checks.filter(c => c.check_id === id && c.required === true && ["passed", "not-applicable"].includes(String(c.status))).length !== 1)) throw new Error("ADMISSION_NOT_READY: incomplete hard checks");
  const current = readIssuedGrant(root, global.execution_grant_ref!);
  for (const [instance, claim] of Object.entries(global.active_instances)) if (claim.session_id !== current.grant.executor_constraints.session_id && IMPLEMENTATION_ENTRY_STAGES.some(stage => instance.split("@")[0] === stage) && (!(receipt.dependency_plan as { units?: Record<string, any>[] } | undefined)?.units || dependencyClaimConflict(root, (receipt.dependency_plan as { units: Record<string, any>[] }).units, instance))) throw new Error(`ADMISSION_INPUT_CHANGED: conflicting implementation claim ${instance}`);
  if (json(receipt.batch_ref) !== json(global.autonomy_batch) || json(receipt.grant_ref) !== json(global.execution_grant_ref)) throw new Error("ADMISSION_INPUT_CHANGED: scope/grant changed");
  if (!Number.isFinite(Date.parse(String(receipt.issued_at))) || !Number.isFinite(Date.parse(String(receipt.valid_until))) || now < Date.parse(String(receipt.issued_at)) || now >= Date.parse(String(receipt.valid_until))) throw new Error("ADMISSION_INPUT_CHANGED: receipt expired/clock invalid");
  if (receipt.checker_digest !== semanticCheckerDigest(true) || receipt.decision_digest !== admissionDecisions(root) || json(receipt.environment_binding) !== json(admissionEnvironment(receipt.environment_variables as string[], receipt.executables as string[]))) throw new Error("ADMISSION_INPUT_CHANGED: checker/decision/environment changed; rerun affected reception");
  try { validateGrantInputs(root, receipt.baseline_inputs as GrantInput[]); }
  catch (error) { throw new Error(`ADMISSION_INPUT_CHANGED: ${String(error instanceof Error ? error.message : error)}`); }
  if (current.revoked || now >= Date.parse(current.grant.expires_at)) throw new Error("ADMISSION_NOT_READY: execution grant revoked/expired");
  return receipt;
}
