import { randomBytes } from "crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { statePath } from "./aidlc-state";
import {
  assertCollaborationV3Enabled,
  materializeWorkflowStateV3,
  resignWorkflowStateV3ForTeam,
  validateWorkflowStateV3,
  workflowEventHashV3,
  workflowInitializationDigestV3,
  type WorkflowInitializationKindV3,
  type WorkflowStateV3,
} from "./aidlc-state-v3";
import {
  isTeamSignedRecord,
  readEnrollment,
  registerTeamEnrollment,
  type EnrollmentRecord,
} from "./aidlc-trust";

const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 30000;
const MAX_LOCK_BYTES = 4096;

interface StateLocation {
  root: string;
  directory: string;
  path: string;
  lockPath: string;
}

interface StateLock {
  fd: number;
  path: string;
  device: bigint;
  inode: bigint;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY || 0));
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function stateLocation(projectRoot: string, create: boolean): StateLocation {
  const root = realpathSync(resolve(projectRoot));
  let cursor = root;
  for (const segment of ["docs", "aidlc"]) {
    cursor = join(cursor, segment);
    if (!pathEntryExists(cursor) && create) {
      try {
        mkdirSync(cursor, { mode: 0o700 });
        fsyncDirectory(dirname(cursor));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!pathEntryExists(cursor)) continue;
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`state directory must be a regular non-symlink directory: ${cursor}`);
    }
    const real = realpathSync(cursor);
    if (!inside(root, real)) throw new Error(`state directory resolves outside project root: ${cursor}`);
  }
  const path = statePath(root);
  return { root, directory: dirname(path), path, lockPath: `${path}.lock` };
}

export function validateWorkflowStateV3Target(projectRoot: string): void {
  stateLocation(projectRoot, false);
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function acquireLock(path: string): StateLock {
  const started = Date.now();
  while (true) {
    let fd: number | undefined;
    let created: { device: bigint; inode: bigint } | undefined;
    try {
      fd = openSync(path, "wx", 0o600);
      const opened = fstatSync(fd, { bigint: true });
      created = { device: opened.dev, inode: opened.ino };
      writeSync(fd, `${JSON.stringify({
        schema_version: 1,
        pid: process.pid,
        token: randomBytes(16).toString("hex"),
        created_at: new Date().toISOString(),
      })}\n`, undefined, "utf8");
      fsyncSync(fd);
      return { fd, path, device: opened.dev, inode: opened.ino };
    } catch (error) {
      if (fd !== undefined) {
        try {
          const current = lstatSync(path, { bigint: true });
          if (created && current.dev === created.device && current.ino === created.inode) unlinkSync(path);
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
        } finally {
          closeSync(fd);
        }
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const before = lstatSync(path, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new Error(`state v3 lock must be a regular non-symlink file: ${path}`);
      }
      if (Date.now() - Number(before.mtimeMs) > LOCK_STALE_MS) {
        if (before.size > BigInt(MAX_LOCK_BYTES)) throw new Error(`state v3 lock is too large: ${path}`);
        let owner: unknown;
        try {
          owner = JSON.parse(readFileSync(path, "utf8"));
        } catch {
          throw new Error(`stale state v3 lock has unverifiable ownership: ${path}`);
        }
        const pid = owner && typeof owner === "object" && !Array.isArray(owner)
          ? (owner as Record<string, unknown>).pid
          : undefined;
        if (!Number.isInteger(pid) || (pid as number) < 1) {
          throw new Error(`stale state v3 lock has unverifiable ownership: ${path}`);
        }
        if (!processIsAlive(pid as number)) {
          const after = lstatSync(path, { bigint: true });
          if (after.dev === before.dev && after.ino === before.ino) {
            unlinkSync(path);
            fsyncDirectory(dirname(path));
            continue;
          }
        }
      }
      if (Date.now() - started >= LOCK_WAIT_MS) throw new Error(`timed out waiting for state v3 lock: ${path}`);
      sleep(20);
    }
  }
}

function releaseLock(lock: StateLock): void {
  try {
    const current = lstatSync(lock.path, { bigint: true });
    if (!current.isSymbolicLink() && current.dev === lock.device && current.ino === lock.inode) {
      unlinkSync(lock.path);
      fsyncDirectory(dirname(lock.path));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    closeSync(lock.fd);
  }
}

function checkedEnrollment(projectRoot: string): EnrollmentRecord | null {
  const enrollment = readEnrollment(projectRoot);
  if (enrollment?.recovery_id) {
    throw new Error(`recovery transaction ${enrollment.recovery_id} is incomplete; rerun recover re-enroll`);
  }
  return enrollment;
}

function writeStateUnderLock(
  projectRoot: string,
  state: WorkflowStateV3,
  mode: "create" | "replace" = "replace",
): void {
  const location = stateLocation(projectRoot, true);
  const temporary = `${location.path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, `${JSON.stringify(state, null, 2)}\n`, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    stateLocation(projectRoot, false);
    if (mode === "create") {
      linkSync(temporary, location.path);
      unlinkSync(temporary);
    } else {
      renameSync(temporary, location.path);
    }
    fsyncDirectory(location.directory);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function containsAcceptedHead(state: WorkflowStateV3, eventHeadHash: string): boolean {
  return state.event_head.event_hash === eventHeadHash
    || state.events.some((event) => workflowEventHashV3(event) === eventHeadHash);
}

function readStateUnderLock(
  projectRoot: string,
  enrollment: EnrollmentRecord | null,
  promoteEnrollment = true,
): WorkflowStateV3 | null {
  const path = stateLocation(projectRoot, false).path;
  if (!pathEntryExists(path)) {
    if (enrollment && enrollment.status !== "pending") {
      throw new Error(`enrolled project is missing its signed state: ${path}`);
    }
    return null;
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`state must be a regular non-symlink file: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as Record<string, unknown>).schema_version !== 3) {
    throw new Error("state is not schema v3; use the controlled v2 migration before collaborative operations");
  }
  let state = validateWorkflowStateV3(parsed, true);
  if (!enrollment) throw new Error("signed state v3 is not bound to a local team enrollment; run orchestrate next and confirm the enrollment phrase");
  if (enrollment.workflow_id !== state.workflow_id) throw new Error("workflow_id does not match the enrolled project workflow");

  const needsTeamResign = !isTeamSignedRecord(state as unknown as Record<string, unknown>)
    || state.events.some((event) => !isTeamSignedRecord(event));
  if (needsTeamResign) {
    state = resignWorkflowStateV3ForTeam(state);
    writeStateUnderLock(projectRoot, state);
  }

  if (enrollment.trust_mode === "device-signature-v1") {
    if (!enrollment.event_head_hash || !containsAcceptedHead(state, enrollment.event_head_hash)) {
      throw new Error("workflow event chain does not extend the locally enrolled event head; refusing rollback or fork");
    }
  }
  if (promoteEnrollment && (needsTeamResign
    || enrollment.trust_mode !== "device-signature-v1"
    || enrollment.status === "pending"
    || enrollment.event_head_hash !== state.event_head.event_hash)) {
    registerTeamEnrollment(projectRoot, state.workflow_id, state.event_head.event_hash, "active");
  }
  return state;
}

function withStateLock<T>(projectRoot: string, operation: () => T): T {
  const location = stateLocation(projectRoot, true);
  const lock = acquireLock(location.lockPath);
  try {
    return operation();
  } finally {
    releaseLock(lock);
  }
}

function assertAppendOnly(before: WorkflowStateV3, candidate: WorkflowStateV3): void {
  if (candidate.workflow_id !== before.workflow_id) throw new Error("state v3 mutation cannot change workflow_id");
  if (candidate.revision !== before.revision) throw new Error("state v3 mutation cannot change revision directly");
  if (candidate.events.length < before.events.length) throw new Error("state v3 event stream cannot be truncated");
  for (let index = 0; index < before.events.length; index++) {
    if (JSON.stringify(candidate.events[index]) !== JSON.stringify(before.events[index])) {
      throw new Error(`state v3 event stream is not append-only at sequence ${index + 1}`);
    }
  }
}

export function loadWorkflowStateV3(projectRoot: string): WorkflowStateV3 | null {
  assertCollaborationV3Enabled();
  const enrollment = checkedEnrollment(projectRoot);
  const location = stateLocation(projectRoot, false);
  if (!pathEntryExists(location.path) && !enrollment) return null;
  return withStateLock(projectRoot, () => readStateUnderLock(projectRoot, checkedEnrollment(projectRoot)));
}

export function initializeWorkflowStateV3(projectRoot: string, stateValue: WorkflowStateV3): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  const state = validateWorkflowStateV3(stateValue, true);
  if (state.revision !== 0) throw new Error("new schema v3 workflow must start at revision 0");
  const initializationKind = state.events[0].event_type as WorkflowInitializationKindV3;
  if (initializationKind !== "workflow_initialized" && initializationKind !== "workflow_regenerated") {
    throw new Error("new schema v3 workflow requires an initialized or regenerated bootstrap event");
  }
  const initializationDigest = workflowInitializationDigestV3(state);
  return withStateLock(projectRoot, () => {
    const enrollment = checkedEnrollment(projectRoot);
    if (enrollment) {
      if (enrollment.workflow_id !== state.workflow_id) {
        throw new Error("workflow_id does not match the pending project enrollment");
      }
      if (enrollment.status !== "pending") throw new Error("workflow state already exists");
      if (enrollment.trust_mode !== "device-signature-v1"
        || enrollment.initialization_kind !== initializationKind
        || enrollment.initialization_digest !== initializationDigest
        || enrollment.device_key_id !== state.events[0].integrity.key_id) {
        throw new Error("pending project enrollment does not match this workflow initialization intent");
      }
    }
    const existing = readStateUnderLock(projectRoot, enrollment, false);
    if (existing) {
      if (workflowInitializationDigestV3(existing) !== initializationDigest) {
        throw new Error("existing workflow state does not match the pending initialization intent");
      }
      registerTeamEnrollment(projectRoot, existing.workflow_id, existing.event_head.event_hash, "active");
      return existing;
    }
    if (!enrollment) {
      registerTeamEnrollment(
        projectRoot,
        state.workflow_id,
        state.event_head.event_hash,
        "pending",
        { kind: initializationKind, digest: initializationDigest },
      );
    }
    if (process.env.AIDLC_STATE_V3_FAILPOINT === "after-enrollment") {
      throw new Error("state v3 failpoint after-enrollment");
    }
    const persisted = materializeWorkflowStateV3(state.workflow_id, state.events, 1);
    writeStateUnderLock(projectRoot, persisted, "create");
    if (process.env.AIDLC_STATE_V3_FAILPOINT === "after-state") {
      throw new Error("state v3 failpoint after-state");
    }
    registerTeamEnrollment(projectRoot, persisted.workflow_id, persisted.event_head.event_hash, "active");
    return persisted;
  });
}

export function mutateWorkflowStateV3(
  projectRoot: string,
  mutation: (state: WorkflowStateV3) => WorkflowStateV3,
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  return withStateLock(projectRoot, () => {
    const enrollment = checkedEnrollment(projectRoot);
    const before = readStateUnderLock(projectRoot, enrollment);
    if (!before) throw new Error("schema v3 workflow state is missing");
    const candidate = validateWorkflowStateV3(mutation(structuredClone(before)), true);
    assertAppendOnly(before, candidate);
    if (candidate.events.length === before.events.length) return before;
    const persisted = materializeWorkflowStateV3(before.workflow_id, candidate.events, before.revision + 1);
    writeStateUnderLock(projectRoot, persisted);
    registerTeamEnrollment(projectRoot, persisted.workflow_id, persisted.event_head.event_hash, "active");
    return persisted;
  });
}
