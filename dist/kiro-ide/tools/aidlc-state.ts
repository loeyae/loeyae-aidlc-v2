import { randomBytes, randomUUID } from "crypto";
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
import { dirname, resolve } from "path";
import {
  readEnrollment,
  registerEnrollment,
  registerPendingEnrollment,
  signRecord,
  verifyRecord,
  type EnrollmentRecord,
} from "./aidlc-trust";

export interface HistoryEntry {
  stage: string;
  result: string;
  timestamp: string;
  user_input?: string;
}

export interface WorkflowState extends Record<string, unknown> {
  schema_version: 2;
  version: string;
  workflow_id: string;
  revision: number;
  scope: string;
  depth: string;
  current_phase: string;
  current_stage: string;
  status: "running" | "parked" | "done";
  completed_stages: string[];
  skipped_stages: string[];
  approval_challenges: Record<string, string>;
  history: HistoryEntry[];
  created_at: string;
  updated_at: string;
  integrity?: Record<string, unknown>;
}

const LOCK_WAIT_MS = 3000;
const LOCK_STALE_MS = 30000;
const VALID_STATUS = new Set(["running", "parked", "done"]);
const VALID_SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const ALLOWED_KEYS = new Set([
  "schema_version",
  "version",
  "workflow_id",
  "revision",
  "scope",
  "depth",
  "current_phase",
  "current_stage",
  "status",
  "completed_stages",
  "skipped_stages",
  "approval_challenges",
  "history",
  "created_at",
  "updated_at",
  "integrity",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${field} contains duplicate entries`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function isoDate(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  if (Number.isNaN(new Date(text).getTime())) throw new Error(`${field} must be an ISO timestamp`);
  return text;
}

function validateHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) throw new Error("history must be an array");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`history[${index}] must be an object`);
    const allowed = new Set(["stage", "result", "timestamp", "user_input"]);
    for (const key of Object.keys(item)) if (!allowed.has(key)) throw new Error(`history[${index}] has unknown field ${key}`);
    const entry: HistoryEntry = {
      stage: nonEmptyString(item.stage, `history[${index}].stage`),
      result: nonEmptyString(item.result, `history[${index}].result`),
      timestamp: isoDate(item.timestamp, `history[${index}].timestamp`),
    };
    if (item.user_input !== undefined) entry.user_input = nonEmptyString(item.user_input, `history[${index}].user_input`);
    return entry;
  });
}

function validateChallenges(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("approval_challenges must be an object");
  const result: Record<string, string> = {};
  for (const [stage, challenge] of Object.entries(value)) result[nonEmptyString(stage, "approval challenge stage")] = nonEmptyString(challenge, `approval_challenges.${stage}`);
  return result;
}

export function validateWorkflowState(value: unknown, requireIntegrity = true): WorkflowState {
  if (!isRecord(value)) throw new Error("state must be a JSON object");
  for (const key of Object.keys(value)) if (!ALLOWED_KEYS.has(key)) throw new Error(`state has unknown field ${key}`);
  if (value.schema_version !== 2) throw new Error("state.schema_version must be 2");
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) throw new Error("state.revision must be a non-negative integer");
  const status = nonEmptyString(value.status, "state.status");
  if (!VALID_STATUS.has(status)) throw new Error(`invalid state.status: ${status}`);
  const scope = nonEmptyString(value.scope, "state.scope");
  if (!VALID_SCOPES.has(scope)) throw new Error(`invalid state.scope: ${scope}`);
  const state = {
    ...value,
    schema_version: 2,
    version: nonEmptyString(value.version, "state.version"),
    workflow_id: nonEmptyString(value.workflow_id, "state.workflow_id"),
    revision: value.revision as number,
    scope,
    depth: nonEmptyString(value.depth, "state.depth"),
    current_phase: typeof value.current_phase === "string" ? value.current_phase : "",
    current_stage: typeof value.current_stage === "string" ? value.current_stage : "",
    status: status as WorkflowState["status"],
    completed_stages: stringArray(value.completed_stages, "state.completed_stages"),
    skipped_stages: stringArray(value.skipped_stages, "state.skipped_stages"),
    approval_challenges: validateChallenges(value.approval_challenges),
    history: validateHistory(value.history),
    created_at: isoDate(value.created_at, "state.created_at"),
    updated_at: isoDate(value.updated_at, "state.updated_at"),
  } as WorkflowState;
  if (requireIntegrity) {
    const integrityError = verifyRecord(state);
    if (integrityError) throw new Error(`state integrity failed: ${integrityError}`);
  }
  return state;
}

function migrateLegacyState(value: unknown, workflowId: string = randomUUID()): WorkflowState {
  if (!isRecord(value)) throw new Error("legacy state must be a JSON object");
  const status = typeof value.status === "string" && VALID_STATUS.has(value.status) ? value.status as WorkflowState["status"] : "running";
  const scope = typeof value.scope === "string" && VALID_SCOPES.has(value.scope) ? value.scope : "feature";
  const now = new Date().toISOString();
  return validateWorkflowState({
    schema_version: 2,
    version: typeof value.version === "string" && value.version ? value.version : "2.1.5",
    workflow_id: workflowId,
    revision: 0,
    scope,
    depth: typeof value.depth === "string" && value.depth ? value.depth : "standard",
    current_phase: typeof value.current_phase === "string" ? value.current_phase : "",
    current_stage: typeof value.current_stage === "string" ? value.current_stage : "",
    status,
    completed_stages: Array.isArray(value.completed_stages) ? value.completed_stages : [],
    skipped_stages: Array.isArray(value.skipped_stages) ? value.skipped_stages : [],
    approval_challenges: {},
    history: Array.isArray(value.history) ? value.history : [],
    created_at: typeof value.created_at === "string" ? value.created_at : now,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : now,
  }, false);
}

export function statePath(projectRoot: string): string {
  return resolve(projectRoot, "docs", "aidlc", "aidlc-state.json");
}

export function createInitialState(scope: string, version = "2.1.5", workflowId: string = randomUUID()): WorkflowState {
  if (!VALID_SCOPES.has(scope)) throw new Error(`invalid workflow scope: ${scope}`);
  if (!workflowId) throw new Error("workflow ID must be non-empty");
  const now = new Date().toISOString();
  return {
    schema_version: 2,
    version,
    workflow_id: workflowId,
    revision: 0,
    scope,
    depth: "standard",
    current_phase: "ideation",
    current_stage: "",
    status: "running",
    completed_stages: [],
    skipped_stages: [],
    approval_challenges: {},
    history: [],
    created_at: now,
    updated_at: now,
  };
}

export function loadWorkflowState(projectRoot: string): WorkflowState | null {
  const path = statePath(projectRoot);
  const enrollment = readEnrollment(projectRoot);
  if (!existsSync(path)) {
    if (enrollment && enrollment.status !== "pending") {
      throw new Error(`enrolled project is missing its signed state: ${path}`);
    }
    return null;
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`state must be a regular non-symlink file: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (isRecord(parsed) && parsed.schema_version === 2 && parsed.integrity !== undefined) {
    const state = validateWorkflowState(parsed, true);
    if (!enrollment) throw new Error("signed state is not bound to a project enrollment");
    if (enrollment.workflow_id !== state.workflow_id) throw new Error("workflow_id does not match the enrolled project workflow");
    if (enrollment.status === "pending") registerEnrollment(projectRoot, state.workflow_id);
    return state;
  }
  if (enrollment && enrollment.status !== "pending") throw new Error("unsigned or legacy state is forbidden for an enrolled project");
  return migrateLegacyState(parsed, enrollment?.workflow_id);
}

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
      if (Date.now() - started >= LOCK_WAIT_MS) throw new Error(`timed out waiting for state lock: ${path}`);
      sleep(20);
    }
  }
}

function currentRevision(path: string, enrollment: EnrollmentRecord | null): number | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (isRecord(parsed) && parsed.schema_version === 2 && parsed.integrity !== undefined) {
    const state = validateWorkflowState(parsed, true);
    if (!enrollment) throw new Error("cannot update signed state without a project enrollment");
    if (enrollment.workflow_id !== state.workflow_id) throw new Error("workflow_id does not match the enrolled project workflow");
    return state.revision;
  }
  if (enrollment && enrollment.status !== "pending") throw new Error("cannot overwrite unsigned state in an enrolled project");
  return 0;
}

export function saveWorkflowState(projectRoot: string, state: WorkflowState): void {
  validateWorkflowState(state, false);
  const path = statePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const lockFd = acquireLock(lockPath);
  let temporary = "";
  try {
    const enrollment = readEnrollment(projectRoot);
    const onDiskRevision = currentRevision(path, enrollment);
    if (onDiskRevision !== null && onDiskRevision !== state.revision) {
      throw new Error(`state revision conflict: expected ${state.revision}, found ${onDiskRevision}`);
    }
    if (onDiskRevision === null && state.revision !== 0) {
      throw new Error(`state revision conflict: state file is missing, expected ${state.revision}`);
    }
    if (enrollment && enrollment.workflow_id !== state.workflow_id) {
      throw new Error("workflow_id does not match the enrolled project workflow");
    }
    if (onDiskRevision === null && enrollment && enrollment.status !== "pending") {
      throw new Error("active enrollment is missing its signed state; refusing to initialize a replacement");
    }

    const nextState = {
      ...state,
      revision: state.revision + 1,
      updated_at: new Date().toISOString(),
    } as WorkflowState;
    const unsigned = { ...nextState } as Record<string, unknown>;
    delete unsigned.integrity;
    nextState.integrity = signRecord(unsigned, true) as unknown as Record<string, unknown>;

    if (!enrollment) {
      registerPendingEnrollment(projectRoot, state.workflow_id);
      if (process.env.AIDLC_STATE_FAILPOINT === "after-enrollment") {
        throw new Error("state failpoint after-enrollment");
      }
    }

    temporary = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(nextState, null, 2)}\n`, undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    temporary = "";

    if (process.env.AIDLC_STATE_FAILPOINT === "after-state") {
      throw new Error("state failpoint after-state");
    }
    if (!enrollment || enrollment.status === "pending") registerEnrollment(projectRoot, state.workflow_id);
    Object.assign(state, nextState);
  } finally {
    closeSync(lockFd);
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
