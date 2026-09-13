import { existsSync, lstatSync, readFileSync } from "fs";
import {
  loadWorkflowState,
  statePath,
  validateWorkflowState,
  type WorkflowState,
} from "./aidlc-state";
import {
  validateWorkflowStateV3,
  workflowEventHashV3,
  type WorkflowStateV3,
} from "./aidlc-state-v3";
import { loadWorkflowStateV3 } from "./aidlc-state-v3-store";
import {
  isTeamSignedRecord,
  readEnrollment,
  type EnrollmentRecord,
} from "./aidlc-trust";

const MAX_STATE_BYTES = 2 * 1024 * 1024;

export type AnyWorkflowState = WorkflowState | WorkflowStateV3;

export interface WorkflowStateSnapshot {
  path: string;
  raw: Buffer;
  record: Record<string, unknown>;
  state: AnyWorkflowState;
}

export interface SchemaAwareLoadOptions {
  allowPublicV3Read?: boolean;
  requireState?: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseState(raw: Buffer): Record<string, unknown> {
  try {
    return record(JSON.parse(raw.toString("utf8")) as unknown, "workflow state");
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`workflow state contains invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function validateWorkflowStateBySchema(
  value: unknown,
  requireIntegrity = true,
): AnyWorkflowState {
  const state = record(value, "workflow state");
  if (state.schema_version === 3) {
    return validateWorkflowStateV3(state, requireIntegrity);
  }
  if (state.schema_version === 2) {
    return validateWorkflowState(state, requireIntegrity);
  }
  throw new Error(
    `unsupported workflow state schema_version: ${String(state.schema_version)}`,
  );
}

/**
 * Read and validate a state file without changing state, enrollment, accepted
 * event head, or any local credential. This is the only loader recovery inspect
 * may use.
 */
export function readWorkflowStateSnapshot(
  projectRoot: string,
  requireIntegrity = true,
): WorkflowStateSnapshot | null {
  const path = statePath(projectRoot);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`state must be a regular non-symlink file: ${path}`);
  }
  if (stat.size > MAX_STATE_BYTES) {
    throw new Error(`workflow state exceeds ${MAX_STATE_BYTES} bytes: ${path}`);
  }
  const raw = readFileSync(path);
  const recordValue = parseState(raw);
  return {
    path,
    raw,
    record: recordValue,
    state: validateWorkflowStateBySchema(recordValue, requireIntegrity),
  };
}

function containsAcceptedHead(
  state: WorkflowStateV3,
  eventHeadHash: string,
): boolean {
  return (
    state.event_head.event_hash === eventHeadHash ||
    state.events.some(
      (event) => workflowEventHashV3(event) === eventHeadHash,
    )
  );
}

/**
 * Validate an existing local enrollment against a verified v3 snapshot without
 * advancing its accepted head. A missing enrollment is valid for public,
 * read-only signature checks; mutation loaders still require enrollment.
 */
export function validateWorkflowStateV3EnrollmentReadOnly(
  projectRoot: string,
  stateValue: WorkflowStateV3,
): EnrollmentRecord | null {
  const state = validateWorkflowStateV3(stateValue, true);
  const enrollment = readEnrollment(projectRoot);
  if (!enrollment) return null;
  if (enrollment.recovery_id) {
    throw new Error(
      `recovery transaction ${enrollment.recovery_id} is incompatible with schema v3; use team enrollment and continuity`,
    );
  }
  if (enrollment.workflow_id !== state.workflow_id) {
    throw new Error(
      "workflow_id does not match the enrolled project workflow",
    );
  }

  const teamState =
    isTeamSignedRecord(state as unknown as Record<string, unknown>) &&
    state.events.every((event) => isTeamSignedRecord(event));
  if (teamState) {
    if (enrollment.trust_mode !== "device-signature-v1") {
      throw new Error(
        "schema v3 team state requires a device-signature-v1 local enrollment",
      );
    }
    if (
      !enrollment.event_head_hash ||
      !containsAcceptedHead(state, enrollment.event_head_hash)
    ) {
      throw new Error(
        "workflow event chain does not extend the locally enrolled event head; refusing rollback or fork",
      );
    }
  } else if (enrollment.trust_mode === "device-signature-v1") {
    throw new Error(
      "schema v3 state integrity mode does not match the local team enrollment",
    );
  }
  return enrollment;
}

/**
 * Load a supported workflow using its normal mutation-safe loader. Schema v3
 * may fall back to self-contained public signature validation only when the
 * caller explicitly declares a read-only operation and no local enrollment
 * exists.
 */
export function loadWorkflowStateBySchema(
  projectRoot: string,
  options: SchemaAwareLoadOptions = {},
): AnyWorkflowState | null {
  const snapshot = readWorkflowStateSnapshot(projectRoot, false);
  if (!snapshot) {
    if (options.requireState) {
      throw new Error(`signed workflow state is missing: ${statePath(projectRoot)}`);
    }
    return null;
  }
  if (snapshot.state.schema_version === 2) {
    const state = loadWorkflowState(projectRoot);
    if (!state && options.requireState) {
      throw new Error(`signed workflow state is missing: ${snapshot.path}`);
    }
    return state;
  }

  const enrollment = readEnrollment(projectRoot);
  if (enrollment) {
    const state = loadWorkflowStateV3(projectRoot);
    if (!state && options.requireState) {
      throw new Error(`signed workflow state is missing: ${snapshot.path}`);
    }
    return state;
  }
  if (!options.allowPublicV3Read) {
    throw new Error(
      "signed state v3 is not bound to a local team enrollment; run orchestrate next and confirm the JOIN phrase before mutation",
    );
  }
  return validateWorkflowStateV3(snapshot.record, true);
}
