import { randomBytes } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname } from "path";
import { statePath } from "./aidlc-state";
import {
  assertCollaborationV3Enabled,
  materializeWorkflowStateV3,
  resignWorkflowStateV3ForTeam,
  validateWorkflowStateV3,
  workflowEventHashV3,
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

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireLock(path: string): number {
  const started = Date.now();
  while (true) {
    try {
      return openSync(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(path);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= LOCK_WAIT_MS) throw new Error(`timed out waiting for state v3 lock: ${path}`);
      sleep(20);
    }
  }
}

function checkedEnrollment(projectRoot: string): EnrollmentRecord | null {
  const enrollment = readEnrollment(projectRoot);
  if (enrollment?.recovery_id) {
    throw new Error(`recovery transaction ${enrollment.recovery_id} is incomplete; rerun recover re-enroll`);
  }
  return enrollment;
}

function writeStateUnderLock(path: string, state: WorkflowStateV3): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, `${JSON.stringify(state, null, 2)}\n`, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function containsAcceptedHead(state: WorkflowStateV3, eventHeadHash: string): boolean {
  return state.event_head.event_hash === eventHeadHash
    || state.events.some((event) => workflowEventHashV3(event) === eventHeadHash);
}

function readStateUnderLock(projectRoot: string, enrollment: EnrollmentRecord | null): WorkflowStateV3 | null {
  const path = statePath(projectRoot);
  if (!existsSync(path)) {
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
    writeStateUnderLock(path, state);
  }

  if (enrollment.trust_mode === "device-signature-v1") {
    if (!enrollment.event_head_hash || !containsAcceptedHead(state, enrollment.event_head_hash)) {
      throw new Error("workflow event chain does not extend the locally enrolled event head; refusing rollback or fork");
    }
  }
  if (needsTeamResign
    || enrollment.trust_mode !== "device-signature-v1"
    || enrollment.status === "pending"
    || enrollment.event_head_hash !== state.event_head.event_hash) {
    registerTeamEnrollment(projectRoot, state.workflow_id, state.event_head.event_hash, "active");
  }
  return state;
}

function withStateLock<T>(projectRoot: string, operation: () => T): T {
  const path = statePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const fd = acquireLock(lockPath);
  try {
    return operation();
  } finally {
    closeSync(fd);
    if (existsSync(lockPath)) unlinkSync(lockPath);
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
  return readStateUnderLock(projectRoot, enrollment);
}

export function initializeWorkflowStateV3(projectRoot: string, stateValue: WorkflowStateV3): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  const state = validateWorkflowStateV3(stateValue, true);
  if (state.revision !== 0) throw new Error("new schema v3 workflow must start at revision 0");
  return withStateLock(projectRoot, () => {
    const enrollment = checkedEnrollment(projectRoot);
    if (enrollment && enrollment.workflow_id !== state.workflow_id) {
      throw new Error("workflow_id does not match the pending project enrollment");
    }
    if (readStateUnderLock(projectRoot, enrollment)) throw new Error("workflow state already exists");
    if (!enrollment) registerTeamEnrollment(projectRoot, state.workflow_id, state.event_head.event_hash, "pending");
    if (process.env.AIDLC_STATE_V3_FAILPOINT === "after-enrollment") {
      throw new Error("state v3 failpoint after-enrollment");
    }
    const persisted = materializeWorkflowStateV3(state.workflow_id, state.events, 1);
    writeStateUnderLock(statePath(projectRoot), persisted);
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
    writeStateUnderLock(statePath(projectRoot), persisted);
    registerTeamEnrollment(projectRoot, persisted.workflow_id, persisted.event_head.event_hash, "active");
    return persisted;
  });
}
