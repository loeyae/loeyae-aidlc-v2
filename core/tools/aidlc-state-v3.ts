import { createHash, randomUUID } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { dirname, resolve } from "path";
import type { ExecutionAxis } from "./aidlc-execution-context";
import {
  loadWorkflowState,
  statePath,
  validateWorkflowState,
  type HistoryEntry,
  type WorkflowState,
} from "./aidlc-state";
import { canonicalPayload, readEnrollment, signRecord, verifyRecord, type IntegrityEnvelope } from "./aidlc-trust";

export const COLLABORATION_V3_FLAG = "AIDLC_COLLABORATION_V3";

export type WorkflowInstanceStatusV3 =
  | "blocked"
  | "ready"
  | "claimed"
  | "in_progress"
  | "submitted"
  | "completed"
  | "rejected"
  | "skipped";

export type WorkflowEventTypeV3 =
  | "workflow_initialized"
  | "workflow_migrated"
  | "instance_registered"
  | "instance_ready"
  | "instance_claimed"
  | "instance_started"
  | "claim_renewed"
  | "instance_released"
  | "claim_transferred"
  | "instance_submitted"
  | "instance_completed"
  | "instance_blocked"
  | "instance_rejected"
  | "instance_skipped"
  | "approval_requested"
  | "approval_granted";

export interface WorkflowClaimV3 extends Record<string, unknown> {
  claim_id: string;
  actor_id: string;
  device_id: string;
  client_id: string;
  provider_id: string;
  provider_receipt_digest: string;
  claimed_at: string;
  renewed_at: string;
  lease_expires_at: string | null;
  compatibility_lock?: true;
}

export interface WorkflowApprovalV3 extends Record<string, unknown> {
  challenge: string;
  requested_at: string;
  granted_at?: string;
  provider_id?: string;
  human_event_id?: string;
}

export interface WorkflowInstanceV3 extends Record<string, unknown> {
  stage_instance: string;
  stage: string;
  axis: ExecutionAxis;
  module_id?: string;
  unit_id?: string;
  requires: string[];
  status: WorkflowInstanceStatusV3;
  revision: number;
  updated_at: string;
  claim?: WorkflowClaimV3;
  approval?: WorkflowApprovalV3;
  result?: "completed" | "approved";
}

export interface WorkflowEventV3 extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.workflow.event";
  workflow_id: string;
  sequence: number;
  event_id: string;
  previous_event_hash: string | null;
  event_type: WorkflowEventTypeV3;
  stage_instance?: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  integrity: IntegrityEnvelope;
}

export interface WorkflowEventHeadV3 extends Record<string, unknown> {
  sequence: number;
  event_id: string;
  event_hash: string;
}

export interface WorkflowStateV3 {
  schema_version: 3;
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
  routing_model: "collaboration-v3";
  current_stage_instance?: string;
  current_module?: string;
  current_unit?: string;
  completed_stage_instances: string[];
  skipped_stage_instances: string[];
  selected_optional_stages: string[];
  instances: Record<string, WorkflowInstanceV3>;
  events: WorkflowEventV3[];
  event_head: WorkflowEventHeadV3;
  integrity?: Record<string, unknown>;
}

export interface NewWorkflowEventV3 {
  workflow_id: string;
  event_type: WorkflowEventTypeV3;
  stage_instance?: string;
  occurred_at?: string;
  event_id?: string;
  payload?: Record<string, unknown>;
}

export interface V2MigrationIdentity {
  actor_id: string;
  device_id: string;
  client_id: string;
}

export interface V2MigrationOptions {
  identity?: V2MigrationIdentity;
  occurred_at?: string;
  require_feature_flag?: boolean;
}

const VALID_SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const VALID_STATUSES = new Set<WorkflowInstanceStatusV3>([
  "blocked",
  "ready",
  "claimed",
  "in_progress",
  "submitted",
  "completed",
  "rejected",
  "skipped",
]);
const EVENT_TYPES = new Set<WorkflowEventTypeV3>([
  "workflow_initialized",
  "workflow_migrated",
  "instance_registered",
  "instance_ready",
  "instance_claimed",
  "instance_started",
  "claim_renewed",
  "instance_released",
  "claim_transferred",
  "instance_submitted",
  "instance_completed",
  "instance_blocked",
  "instance_rejected",
  "instance_skipped",
  "approval_requested",
  "approval_granted",
]);
const EVENT_KEYS = new Set([
  "schema_version",
  "kind",
  "workflow_id",
  "sequence",
  "event_id",
  "previous_event_hash",
  "event_type",
  "stage_instance",
  "occurred_at",
  "payload",
  "integrity",
]);
const STATE_KEYS = new Set([
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
  "routing_model",
  "current_stage_instance",
  "current_module",
  "current_unit",
  "completed_stage_instances",
  "skipped_stage_instances",
  "selected_optional_stages",
  "instances",
  "events",
  "event_head",
  "integrity",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${field} has unknown field ${key}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function iso(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${field} must be an integer >= ${minimum}`);
  return value as number;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map((item, index) => text(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${field} contains duplicates`);
  return result;
}

function digest(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^[a-f0-9]{64}$/i.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result.toLowerCase();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unsignedRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  delete result.integrity;
  return result;
}

function hashRecord(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalPayload(value)).digest("hex");
}

export function collaborationV3Enabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[COLLABORATION_V3_FLAG] === "1";
}

export function assertCollaborationV3Enabled(environment: NodeJS.ProcessEnv = process.env): void {
  if (!collaborationV3Enabled(environment)) {
    throw new Error(`${COLLABORATION_V3_FLAG}=1 is required for collaborative state v3`);
  }
}

export function workflowEventHashV3(event: WorkflowEventV3): string {
  return hashRecord(event);
}

function validateClaim(value: unknown, field: string): WorkflowClaimV3 {
  const claim = record(value, field);
  exactKeys(claim, new Set([
    "claim_id",
    "actor_id",
    "device_id",
    "client_id",
    "provider_id",
    "provider_receipt_digest",
    "claimed_at",
    "renewed_at",
    "lease_expires_at",
    "compatibility_lock",
  ]), field);
  const compatibilityLock = claim.compatibility_lock === true;
  if (claim.compatibility_lock !== undefined && !compatibilityLock) throw new Error(`${field}.compatibility_lock must be true when present`);
  const lease = claim.lease_expires_at === null ? null : iso(claim.lease_expires_at, `${field}.lease_expires_at`);
  if (lease === null && !compatibilityLock) throw new Error(`${field}.lease_expires_at may be null only for a migration compatibility lock`);
  return {
    claim_id: text(claim.claim_id, `${field}.claim_id`),
    actor_id: text(claim.actor_id, `${field}.actor_id`),
    device_id: text(claim.device_id, `${field}.device_id`),
    client_id: text(claim.client_id, `${field}.client_id`),
    provider_id: text(claim.provider_id, `${field}.provider_id`),
    provider_receipt_digest: digest(claim.provider_receipt_digest, `${field}.provider_receipt_digest`),
    claimed_at: iso(claim.claimed_at, `${field}.claimed_at`),
    renewed_at: iso(claim.renewed_at, `${field}.renewed_at`),
    lease_expires_at: lease,
    ...(compatibilityLock ? { compatibility_lock: true as const } : {}),
  };
}

function validateEventPayload(eventType: WorkflowEventTypeV3, payloadValue: unknown): Record<string, unknown> {
  const payload = record(payloadValue, `event ${eventType} payload`);
  const exact = (keys: string[]): void => exactKeys(payload, new Set(keys), `event ${eventType} payload`);
  switch (eventType) {
    case "workflow_initialized": {
      exact(["version", "scope", "depth", "created_at", "selected_optional_stages"]);
      text(payload.version, "workflow_initialized.version");
      const scope = text(payload.scope, "workflow_initialized.scope");
      if (!VALID_SCOPES.has(scope)) throw new Error(`invalid workflow scope: ${scope}`);
      text(payload.depth, "workflow_initialized.depth");
      iso(payload.created_at, "workflow_initialized.created_at");
      strings(payload.selected_optional_stages, "workflow_initialized.selected_optional_stages");
      break;
    }
    case "workflow_migrated": {
      exact(["legacy_state", "source_integrity", "source_state_digest"]);
      const legacy = record(payload.legacy_state, "workflow_migrated.legacy_state");
      validateWorkflowState(legacy, false);
      record(payload.source_integrity, "workflow_migrated.source_integrity");
      digest(payload.source_state_digest, "workflow_migrated.source_state_digest");
      break;
    }
    case "instance_registered": {
      exact(["stage", "axis", "module_id", "unit_id", "requires", "initial_status"]);
      text(payload.stage, "instance_registered.stage");
      if (payload.axis !== "project" && payload.axis !== "module" && payload.axis !== "unit") {
        throw new Error("instance_registered.axis must be project, module, or unit");
      }
      if (payload.module_id !== undefined) text(payload.module_id, "instance_registered.module_id");
      if (payload.unit_id !== undefined) text(payload.unit_id, "instance_registered.unit_id");
      if (payload.axis === "project" && (payload.module_id !== undefined || payload.unit_id !== undefined)) {
        throw new Error("project instance cannot have module_id or unit_id");
      }
      if (payload.axis === "module" && (payload.module_id === undefined || payload.unit_id !== undefined)) {
        throw new Error("module instance requires module_id and cannot have unit_id");
      }
      if (payload.axis === "unit" && (payload.module_id === undefined || payload.unit_id === undefined)) {
        throw new Error("unit instance requires module_id and unit_id");
      }
      strings(payload.requires, "instance_registered.requires");
      if (payload.initial_status !== "blocked" && payload.initial_status !== "ready") {
        throw new Error("instance_registered.initial_status must be blocked or ready");
      }
      break;
    }
    case "instance_ready":
      exact(["reason"]);
      if (payload.reason !== undefined) text(payload.reason, "instance_ready.reason");
      break;
    case "instance_claimed":
    case "claim_transferred":
      exact(["claim"]);
      validateClaim(payload.claim, `${eventType}.claim`);
      break;
    case "instance_started":
    case "instance_submitted":
      exact([]);
      break;
    case "claim_renewed":
      exact(["lease_expires_at", "provider_receipt_digest"]);
      iso(payload.lease_expires_at, "claim_renewed.lease_expires_at");
      digest(payload.provider_receipt_digest, "claim_renewed.provider_receipt_digest");
      break;
    case "instance_released":
      exact(["reason", "target_status"]);
      text(payload.reason, "instance_released.reason");
      if (payload.target_status !== "ready" && payload.target_status !== "blocked") {
        throw new Error("instance_released.target_status must be ready or blocked");
      }
      break;
    case "instance_completed":
      exact(["result", "user_input", "migration"]);
      if (payload.result !== "completed" && payload.result !== "approved") {
        throw new Error("instance_completed.result must be completed or approved");
      }
      if (payload.user_input !== undefined) text(payload.user_input, "instance_completed.user_input");
      if (payload.migration !== undefined && payload.migration !== true) throw new Error("instance_completed.migration must be true when present");
      break;
    case "instance_blocked":
    case "instance_rejected":
      exact(["reason"]);
      text(payload.reason, `${eventType}.reason`);
      break;
    case "instance_skipped":
      exact(["reason", "source"]);
      text(payload.reason, "instance_skipped.reason");
      if (payload.source !== "condition" && payload.source !== "migration") {
        throw new Error("instance_skipped.source must be condition or migration");
      }
      break;
    case "approval_requested":
      exact(["challenge"]);
      text(payload.challenge, "approval_requested.challenge");
      break;
    case "approval_granted":
      exact(["provider_id", "human_event_id"]);
      text(payload.provider_id, "approval_granted.provider_id");
      text(payload.human_event_id, "approval_granted.human_event_id");
      break;
  }
  return payload;
}

export function validateWorkflowEventV3(value: unknown, requireIntegrity = true): WorkflowEventV3 {
  const event = record(value, "workflow event");
  exactKeys(event, EVENT_KEYS, "workflow event");
  if (event.schema_version !== 1) throw new Error("workflow event schema_version must be 1");
  if (event.kind !== "aidlc.workflow.event") throw new Error('workflow event kind must be "aidlc.workflow.event"');
  const eventType = text(event.event_type, "workflow event.event_type") as WorkflowEventTypeV3;
  if (!EVENT_TYPES.has(eventType)) throw new Error(`unknown workflow event type: ${eventType}`);
  const stageInstance = event.stage_instance === undefined ? undefined : text(event.stage_instance, "workflow event.stage_instance");
  if ((eventType === "workflow_initialized" || eventType === "workflow_migrated") && stageInstance !== undefined) {
    throw new Error(`${eventType} cannot target a stage instance`);
  }
  if (eventType !== "workflow_initialized" && eventType !== "workflow_migrated" && stageInstance === undefined) {
    throw new Error(`${eventType} requires stage_instance`);
  }
  const previousHash = event.previous_event_hash === null
    ? null
    : digest(event.previous_event_hash, "workflow event.previous_event_hash");
  validateEventPayload(eventType, event.payload);
  if (requireIntegrity) {
    const error = verifyRecord(event);
    if (error) throw new Error(`workflow event integrity failed: ${error}`);
  }
  return {
    ...event,
    schema_version: 1,
    kind: "aidlc.workflow.event",
    workflow_id: text(event.workflow_id, "workflow event.workflow_id"),
    sequence: integer(event.sequence, "workflow event.sequence", 1),
    event_id: text(event.event_id, "workflow event.event_id"),
    previous_event_hash: previousHash,
    event_type: eventType,
    ...(stageInstance ? { stage_instance: stageInstance } : {}),
    occurred_at: iso(event.occurred_at, "workflow event.occurred_at"),
    payload: event.payload as Record<string, unknown>,
    integrity: record(event.integrity, "workflow event.integrity") as unknown as IntegrityEnvelope,
  } as WorkflowEventV3;
}

export function createWorkflowEventV3(
  input: NewWorkflowEventV3,
  previous?: WorkflowEventV3,
): WorkflowEventV3 {
  if (previous && previous.workflow_id !== input.workflow_id) throw new Error("previous event belongs to a different workflow");
  const sequence = previous ? previous.sequence + 1 : 1;
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.workflow.event",
    workflow_id: text(input.workflow_id, "workflow_id"),
    sequence,
    event_id: input.event_id || randomUUID(),
    previous_event_hash: previous ? workflowEventHashV3(previous) : null,
    event_type: input.event_type,
    occurred_at: input.occurred_at || new Date().toISOString(),
    payload: input.payload || {},
  };
  if (input.stage_instance) unsigned.stage_instance = input.stage_instance;
  const event = { ...unsigned, integrity: signRecord(unsigned, true) } as WorkflowEventV3;
  return validateWorkflowEventV3(event, true);
}

function parseStageInstance(instanceId: string): { stage: string; axis: ExecutionAxis; module_id?: string; unit_id?: string } {
  const unit = /^([^@]+)@module:([^@]+)@unit:([^@]+)$/.exec(instanceId);
  if (unit) return { stage: unit[1], axis: "unit", module_id: unit[2], unit_id: unit[3] };
  const module = /^([^@]+)@module:([^@]+)$/.exec(instanceId);
  if (module) return { stage: module[1], axis: "module", module_id: module[2] };
  if (!instanceId.includes("@")) return { stage: text(instanceId, "stage_instance"), axis: "project" };
  throw new Error(`invalid stage_instance: ${instanceId}`);
}

function stateFromInitialization(workflowId: string, event: WorkflowEventV3): Omit<WorkflowStateV3, "integrity"> {
  const payload = event.payload;
  return {
    schema_version: 3,
    version: text(payload.version, "workflow_initialized.version"),
    workflow_id: workflowId,
    revision: 0,
    scope: text(payload.scope, "workflow_initialized.scope"),
    depth: text(payload.depth, "workflow_initialized.depth"),
    current_phase: "ideation",
    current_stage: "",
    status: "running",
    completed_stages: [],
    skipped_stages: [],
    approval_challenges: {},
    history: [],
    created_at: iso(payload.created_at, "workflow_initialized.created_at"),
    updated_at: event.occurred_at,
    routing_model: "collaboration-v3",
    completed_stage_instances: [],
    skipped_stage_instances: [],
    selected_optional_stages: strings(payload.selected_optional_stages, "workflow_initialized.selected_optional_stages"),
    instances: {},
    events: [],
    event_head: { sequence: event.sequence, event_id: event.event_id, event_hash: workflowEventHashV3(event) },
  };
}

function stateFromMigration(workflowId: string, event: WorkflowEventV3): Omit<WorkflowStateV3, "integrity"> {
  const legacy = validateWorkflowState(event.payload.legacy_state, false);
  if (legacy.workflow_id !== workflowId) throw new Error("migrated state workflow_id does not match its event stream");
  return {
    schema_version: 3,
    version: legacy.version,
    workflow_id: legacy.workflow_id,
    revision: legacy.revision + 1,
    scope: legacy.scope,
    depth: legacy.depth,
    current_phase: legacy.current_phase,
    current_stage: legacy.current_stage,
    status: legacy.status,
    completed_stages: [...legacy.completed_stages],
    skipped_stages: [...legacy.skipped_stages],
    approval_challenges: { ...legacy.approval_challenges },
    history: clone(legacy.history),
    created_at: legacy.created_at,
    updated_at: event.occurred_at,
    routing_model: "collaboration-v3",
    ...(legacy.current_stage_instance ? { current_stage_instance: legacy.current_stage_instance } : {}),
    ...(legacy.current_module ? { current_module: legacy.current_module } : {}),
    ...(legacy.current_unit ? { current_unit: legacy.current_unit } : {}),
    completed_stage_instances: [...(legacy.completed_stage_instances || legacy.completed_stages)],
    skipped_stage_instances: [...(legacy.skipped_stage_instances || legacy.skipped_stages)],
    selected_optional_stages: [...(legacy.selected_optional_stages || [])],
    instances: {},
    events: [],
    event_head: { sequence: event.sequence, event_id: event.event_id, event_hash: workflowEventHashV3(event) },
  };
}

function requireInstance(state: Omit<WorkflowStateV3, "integrity">, event: WorkflowEventV3): WorkflowInstanceV3 {
  const instanceId = event.stage_instance as string;
  const instance = state.instances[instanceId];
  if (!instance) throw new Error(`${event.event_type} references unknown stage instance ${instanceId}`);
  return instance;
}

function expectStatus(instance: WorkflowInstanceV3, event: WorkflowEventV3, allowed: WorkflowInstanceStatusV3[]): void {
  if (!allowed.includes(instance.status)) {
    throw new Error(`illegal ${event.event_type} transition for ${instance.stage_instance}: ${instance.status}`);
  }
}

function touch(instance: WorkflowInstanceV3, event: WorkflowEventV3): void {
  instance.revision += 1;
  instance.updated_at = event.occurred_at;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function removeValue(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

function applyInstanceEvent(state: Omit<WorkflowStateV3, "integrity">, event: WorkflowEventV3): void {
  const instanceId = event.stage_instance as string;
  const payload = event.payload;
  if (event.event_type === "instance_registered") {
    if (state.instances[instanceId]) throw new Error(`stage instance already registered: ${instanceId}`);
    const parsed = parseStageInstance(instanceId);
    if (parsed.stage !== payload.stage || parsed.axis !== payload.axis || parsed.module_id !== payload.module_id || parsed.unit_id !== payload.unit_id) {
      throw new Error(`instance_registered payload does not match stage_instance ${instanceId}`);
    }
    state.instances[instanceId] = {
      stage_instance: instanceId,
      stage: parsed.stage,
      axis: parsed.axis,
      ...(parsed.module_id ? { module_id: parsed.module_id } : {}),
      ...(parsed.unit_id ? { unit_id: parsed.unit_id } : {}),
      requires: strings(payload.requires, "instance_registered.requires"),
      status: payload.initial_status as "blocked" | "ready",
      revision: 0,
      updated_at: event.occurred_at,
    };
    return;
  }

  const instance = requireInstance(state, event);
  switch (event.event_type) {
    case "instance_ready":
      expectStatus(instance, event, ["blocked", "rejected"]);
      instance.status = "ready";
      delete instance.claim;
      touch(instance, event);
      break;
    case "instance_claimed":
      expectStatus(instance, event, ["ready"]);
      instance.claim = validateClaim(payload.claim, "instance_claimed.claim");
      instance.status = "claimed";
      touch(instance, event);
      break;
    case "instance_started":
      expectStatus(instance, event, ["claimed"]);
      instance.status = "in_progress";
      touch(instance, event);
      break;
    case "claim_renewed":
      expectStatus(instance, event, ["claimed", "in_progress"]);
      if (!instance.claim || instance.claim.compatibility_lock) throw new Error(`claim_renewed requires a renewable claim for ${instanceId}`);
      instance.claim.lease_expires_at = iso(payload.lease_expires_at, "claim_renewed.lease_expires_at");
      instance.claim.provider_receipt_digest = digest(payload.provider_receipt_digest, "claim_renewed.provider_receipt_digest");
      instance.claim.renewed_at = event.occurred_at;
      touch(instance, event);
      break;
    case "instance_released":
      expectStatus(instance, event, ["claimed", "in_progress", "rejected"]);
      delete instance.claim;
      instance.status = payload.target_status as "ready" | "blocked";
      touch(instance, event);
      break;
    case "claim_transferred":
      expectStatus(instance, event, ["claimed", "in_progress"]);
      instance.claim = validateClaim(payload.claim, "claim_transferred.claim");
      instance.status = "claimed";
      touch(instance, event);
      break;
    case "instance_submitted":
      expectStatus(instance, event, ["in_progress"]);
      instance.status = "submitted";
      touch(instance, event);
      break;
    case "instance_completed": {
      const migration = payload.migration === true;
      expectStatus(instance, event, migration ? ["ready", "blocked", "submitted"] : ["submitted"]);
      if (payload.result === "approved" && !migration && !instance.approval?.granted_at) {
        throw new Error(`approved completion requires approval_granted for ${instanceId}`);
      }
      instance.status = "completed";
      instance.result = payload.result as "completed" | "approved";
      delete instance.claim;
      touch(instance, event);
      appendUnique(state.completed_stage_instances, instanceId);
      removeValue(state.skipped_stage_instances, instanceId);
      if (state.current_stage_instance === instanceId) {
        state.current_stage = "";
        delete state.current_stage_instance;
        delete state.current_module;
        delete state.current_unit;
      }
      if (!migration) {
        const historyEntry: HistoryEntry = {
          stage: instance.stage,
          instance_id: instanceId,
          module_id: instance.module_id,
          unit_id: instance.unit_id,
          result: payload.result as string,
          timestamp: event.occurred_at,
        };
        if (payload.user_input !== undefined) historyEntry.user_input = text(payload.user_input, "instance_completed.user_input");
        state.history.push(historyEntry);
      }
      break;
    }
    case "instance_blocked":
      expectStatus(instance, event, ["ready", "claimed", "in_progress", "submitted", "rejected"]);
      instance.status = "blocked";
      delete instance.claim;
      touch(instance, event);
      break;
    case "instance_rejected":
      expectStatus(instance, event, ["submitted"]);
      instance.status = "rejected";
      touch(instance, event);
      state.history.push({
        stage: instance.stage,
        instance_id: instanceId,
        module_id: instance.module_id,
        unit_id: instance.unit_id,
        result: "rejected",
        timestamp: event.occurred_at,
      });
      break;
    case "instance_skipped":
      expectStatus(instance, event, ["blocked", "ready", "claimed", "in_progress"]);
      instance.status = "skipped";
      delete instance.claim;
      touch(instance, event);
      appendUnique(state.skipped_stage_instances, instanceId);
      removeValue(state.completed_stage_instances, instanceId);
      if (payload.source !== "migration") {
        state.history.push({
          stage: instance.stage,
          instance_id: instanceId,
          module_id: instance.module_id,
          unit_id: instance.unit_id,
          result: "condition_skipped",
          timestamp: event.occurred_at,
          user_input: text(payload.reason, "instance_skipped.reason"),
        });
      }
      break;
    case "approval_requested":
      if (instance.status === "completed" || instance.status === "skipped") throw new Error(`cannot request approval for resolved instance ${instanceId}`);
      instance.approval = { challenge: text(payload.challenge, "approval_requested.challenge"), requested_at: event.occurred_at };
      state.approval_challenges[instanceId] = instance.approval.challenge;
      touch(instance, event);
      break;
    case "approval_granted":
      if (!instance.approval) throw new Error(`approval_granted requires approval_requested for ${instanceId}`);
      instance.approval.granted_at = event.occurred_at;
      instance.approval.provider_id = text(payload.provider_id, "approval_granted.provider_id");
      instance.approval.human_event_id = text(payload.human_event_id, "approval_granted.human_event_id");
      touch(instance, event);
      break;
    default:
      throw new Error(`unsupported instance event: ${event.event_type}`);
  }
}

export function reduceWorkflowEventsV3(
  workflowId: string,
  eventValues: readonly WorkflowEventV3[],
  materializationRevision?: number,
): Omit<WorkflowStateV3, "integrity"> {
  if (eventValues.length === 0) throw new Error("workflow event stream must not be empty");
  let state: Omit<WorkflowStateV3, "integrity"> | null = null;
  let previous: WorkflowEventV3 | undefined;
  const eventIds = new Set<string>();

  for (const value of eventValues) {
    const event = validateWorkflowEventV3(value, true);
    if (event.workflow_id !== workflowId) throw new Error(`event ${event.event_id} belongs to a different workflow`);
    const expectedSequence = previous ? previous.sequence + 1 : 1;
    if (event.sequence !== expectedSequence) throw new Error(`workflow event sequence gap: expected ${expectedSequence}, found ${event.sequence}`);
    const expectedPreviousHash = previous ? workflowEventHashV3(previous) : null;
    if (event.previous_event_hash !== expectedPreviousHash) throw new Error(`workflow event hash chain is broken at sequence ${event.sequence}`);
    if (eventIds.has(event.event_id)) throw new Error(`duplicate workflow event_id: ${event.event_id}`);
    eventIds.add(event.event_id);

    if (event.event_type === "workflow_initialized" || event.event_type === "workflow_migrated") {
      if (state !== null || event.sequence !== 1) throw new Error(`${event.event_type} must be the first and only bootstrap event`);
      state = event.event_type === "workflow_initialized"
        ? stateFromInitialization(workflowId, event)
        : stateFromMigration(workflowId, event);
    } else {
      if (!state) throw new Error("workflow event stream must start with workflow_initialized or workflow_migrated");
      applyInstanceEvent(state, event);
    }

    state.events.push(event);
    state.event_head = {
      sequence: event.sequence,
      event_id: event.event_id,
      event_hash: workflowEventHashV3(event),
    };
    state.updated_at = event.occurred_at;
    previous = event;
  }

  if (!state) throw new Error("workflow event stream did not initialize state");
  if (materializationRevision !== undefined) state.revision = integer(materializationRevision, "materialization revision");
  return state;
}

export function materializeWorkflowStateV3(
  workflowId: string,
  events: readonly WorkflowEventV3[],
  materializationRevision?: number,
): WorkflowStateV3 {
  const projection = reduceWorkflowEventsV3(workflowId, events, materializationRevision);
  return {
    ...projection,
    integrity: signRecord(projection as unknown as Record<string, unknown>, true) as unknown as Record<string, unknown>,
  };
}

export function validateWorkflowStateV3(value: unknown, requireIntegrity = true): WorkflowStateV3 {
  const state = record(value, "workflow state v3");
  exactKeys(state, STATE_KEYS, "workflow state v3");
  if (state.schema_version !== 3) throw new Error("workflow state v3 schema_version must be 3");
  if (state.routing_model !== "collaboration-v3") throw new Error('workflow state v3 routing_model must be "collaboration-v3"');
  const workflowId = text(state.workflow_id, "workflow state v3.workflow_id");
  const revision = integer(state.revision, "workflow state v3.revision");
  if (!Array.isArray(state.events)) throw new Error("workflow state v3.events must be an array");
  if (requireIntegrity) {
    const error = verifyRecord(state);
    if (error) throw new Error(`workflow state v3 integrity failed: ${error}`);
  }
  const rebuilt = reduceWorkflowEventsV3(workflowId, state.events as WorkflowEventV3[], revision);
  const unsigned = unsignedRecord(state);
  if (canonicalPayload(unsigned) !== canonicalPayload(rebuilt as unknown as Record<string, unknown>)) {
    throw new Error("workflow state v3 projection does not match its signed event stream");
  }
  return state as unknown as WorkflowStateV3;
}

function deterministicEventId(workflowId: string, sequence: number, type: WorkflowEventTypeV3, instanceId = "workflow"): string {
  return createHash("sha256").update(`${workflowId}\n${sequence}\n${type}\n${instanceId}`).digest("hex");
}

function addMigrationEvent(
  events: WorkflowEventV3[],
  input: Omit<NewWorkflowEventV3, "workflow_id" | "event_id">,
  workflowId: string,
): void {
  const sequence = events.length + 1;
  events.push(createWorkflowEventV3({
    ...input,
    workflow_id: workflowId,
    event_id: deterministicEventId(workflowId, sequence, input.event_type, input.stage_instance),
  }, events.at(-1)));
}

function migrationInstanceIds(state: WorkflowState): string[] {
  const completed = state.completed_stage_instances || state.completed_stages;
  const skipped = state.skipped_stage_instances || state.skipped_stages;
  const fromHistory = state.history.map((entry) => entry.instance_id || entry.stage);
  const approval = Object.keys(state.approval_challenges);
  const current = state.current_stage_instance || state.current_stage;
  return [...new Set([...completed, ...skipped, ...fromHistory, ...approval, ...(current ? [current] : [])])].sort();
}

function requireMigrationIdentity(state: WorkflowState, options: V2MigrationOptions): V2MigrationIdentity | undefined {
  const current = state.current_stage_instance || state.current_stage;
  if (!current) return undefined;
  if (!options.identity) throw new Error("migrating an active v2 instance requires explicit actor_id, device_id, and client_id");
  return {
    actor_id: text(options.identity.actor_id, "migration identity.actor_id"),
    device_id: text(options.identity.device_id, "migration identity.device_id"),
    client_id: text(options.identity.client_id, "migration identity.client_id"),
  };
}

export function migrateWorkflowStateV2ToV3(stateValue: WorkflowState, options: V2MigrationOptions = {}): WorkflowStateV3 {
  if (options.require_feature_flag !== false) assertCollaborationV3Enabled();
  const state = validateWorkflowState(stateValue, true);
  const identity = requireMigrationIdentity(state, options);
  const occurredAt = options.occurred_at || new Date().toISOString();
  iso(occurredAt, "migration occurred_at");
  const source = unsignedRecord(state as unknown as Record<string, unknown>);
  const events: WorkflowEventV3[] = [];
  addMigrationEvent(events, {
    event_type: "workflow_migrated",
    occurred_at: occurredAt,
    payload: {
      legacy_state: source,
      source_integrity: clone(state.integrity),
      source_state_digest: hashRecord(source),
    },
  }, state.workflow_id);

  const completed = new Set(state.completed_stage_instances || state.completed_stages);
  const skipped = new Set(state.skipped_stage_instances || state.skipped_stages);
  const current = state.current_stage_instance || state.current_stage;
  for (const instanceId of migrationInstanceIds(state)) {
    const parsed = parseStageInstance(instanceId);
    addMigrationEvent(events, {
      event_type: "instance_registered",
      stage_instance: instanceId,
      occurred_at: occurredAt,
      payload: {
        stage: parsed.stage,
        axis: parsed.axis,
        module_id: parsed.module_id,
        unit_id: parsed.unit_id,
        requires: [],
        initial_status: "ready",
      },
    }, state.workflow_id);
    if (completed.has(instanceId)) {
      const historical = [...state.history].reverse().find((entry) => (entry.instance_id || entry.stage) === instanceId);
      const result = historical?.result === "approved" ? "approved" : "completed";
      addMigrationEvent(events, {
        event_type: "instance_completed",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: { result, migration: true },
      }, state.workflow_id);
    } else if (skipped.has(instanceId)) {
      addMigrationEvent(events, {
        event_type: "instance_skipped",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: { reason: "Imported from signed schema v2 state", source: "migration" },
      }, state.workflow_id);
    } else if (instanceId === current && identity) {
      const receiptDigest = createHash("sha256")
        .update(`v2-migration\n${state.workflow_id}\n${instanceId}\n${identity.actor_id}\n${identity.device_id}\n${identity.client_id}`)
        .digest("hex");
      addMigrationEvent(events, {
        event_type: "instance_claimed",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: {
          claim: {
            claim_id: `migration-${receiptDigest.slice(0, 24)}`,
            actor_id: identity.actor_id,
            device_id: identity.device_id,
            client_id: identity.client_id,
            provider_id: "migration:v2",
            provider_receipt_digest: receiptDigest,
            claimed_at: occurredAt,
            renewed_at: occurredAt,
            lease_expires_at: null,
            compatibility_lock: true,
          },
        },
      }, state.workflow_id);
      addMigrationEvent(events, {
        event_type: "instance_started",
        stage_instance: instanceId,
        occurred_at: occurredAt,
        payload: {},
      }, state.workflow_id);
    }
  }

  for (const [instanceId, challenge] of Object.entries(state.approval_challenges).sort(([left], [right]) => left.localeCompare(right))) {
    const target = migrationInstanceIds(state).includes(instanceId)
      ? instanceId
      : current && instanceId === state.current_stage ? current
      : instanceId;
    if (!events.some((event) => event.event_type === "instance_registered" && event.stage_instance === target)) {
      throw new Error(`approval challenge references unknown v2 stage instance ${instanceId}`);
    }
    addMigrationEvent(events, {
      event_type: "approval_requested",
      stage_instance: target,
      occurred_at: occurredAt,
      payload: { challenge },
    }, state.workflow_id);
  }

  const migrated = materializeWorkflowStateV3(state.workflow_id, events, state.revision + 1);
  return validateWorkflowStateV3(migrated, true);
}

export function projectMigratedWorkflowV3ToV2(stateValue: WorkflowStateV3): WorkflowState {
  const state = validateWorkflowStateV3(stateValue, true);
  const migration = state.events[0];
  if (migration.event_type !== "workflow_migrated") throw new Error("workflow state v3 was not created from schema v2");
  const legacy = record(migration.payload.legacy_state, "workflow_migrated.legacy_state");
  const integrity = record(migration.payload.source_integrity, "workflow_migrated.source_integrity");
  return validateWorkflowState({ ...legacy, integrity }, true);
}

export function createInitialWorkflowStateV3(
  scope: string,
  version = "2.4.0",
  workflowId = randomUUID(),
  selectedOptionalStages: string[] = [],
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  if (!VALID_SCOPES.has(scope)) throw new Error(`invalid workflow scope: ${scope}`);
  const event = createWorkflowEventV3({
    workflow_id: workflowId,
    event_type: "workflow_initialized",
    occurred_at: occurredAt,
    payload: {
      version,
      scope,
      depth: "standard",
      created_at: occurredAt,
      selected_optional_stages: [...selectedOptionalStages],
    },
  });
  return materializeWorkflowStateV3(workflowId, [event], 0);
}

export function appendWorkflowEventV3(stateValue: WorkflowStateV3, input: Omit<NewWorkflowEventV3, "workflow_id">): WorkflowStateV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  const event = createWorkflowEventV3({ ...input, workflow_id: state.workflow_id }, state.events.at(-1));
  return materializeWorkflowStateV3(state.workflow_id, [...state.events, event], state.revision);
}

export function migrateWorkflowStateFileV2ToV3(
  projectRoot: string,
  options: V2MigrationOptions = {},
): WorkflowStateV3 {
  if (options.require_feature_flag !== false) assertCollaborationV3Enabled();
  const root = resolve(projectRoot);
  const path = statePath(root);
  if (!existsSync(path)) throw new Error(`schema v2 state is missing: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`state must be a regular non-symlink file: ${path}`);
  const lockPath = `${path}.lock`;
  let lockFd: number | undefined;
  let temporary = "";
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    const original = readFileSync(path);
    const state = loadWorkflowState(root);
    if (!state) throw new Error("schema v2 state disappeared during migration");
    const enrollment = readEnrollment(root);
    if (!enrollment || enrollment.status !== "active") throw new Error("schema v2 migration requires an active project enrollment");
    if (enrollment.recovery_id) throw new Error(`recovery transaction ${enrollment.recovery_id} is incomplete; rerun recover re-enroll`);
    if (enrollment.workflow_id !== state.workflow_id) throw new Error("workflow_id does not match the enrolled project workflow");
    const migrated = migrateWorkflowStateV2ToV3(state, options);
    temporary = `${path}.v3-${process.pid}-${Date.now()}-${randomUUID()}`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(migrated, null, 2)}\n`, undefined, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    validateWorkflowStateV3(JSON.parse(readFileSync(temporary, "utf8")) as unknown, true);
    if (process.env.AIDLC_V3_MIGRATION_FAILPOINT === "before-rename") {
      throw new Error("state v3 migration failpoint before-rename");
    }
    if (!readFileSync(path).equals(original)) throw new Error("state changed concurrently during schema v3 migration");
    renameSync(temporary, path);
    temporary = "";
    return migrated;
  } finally {
    if (lockFd !== undefined) {
      closeSync(lockFd);
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
  }
}
