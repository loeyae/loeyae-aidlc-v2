import { createHash, randomUUID } from "crypto";
import { canonicalPayload, signRecord, verifyRecord, type IntegrityEnvelope } from "./aidlc-trust";
import {
  appendWorkflowEventV3,
  validateWorkflowStateV3,
  type WorkflowStateV3,
} from "./aidlc-state-v3";
import { mutateWorkflowStateV3 } from "./aidlc-state-v3-store";

export interface CoordinationIdentityV3 {
  actor_id: string;
  device_id: string;
  client_id: string;
}

export interface ClaimReceiptV3 extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.claim.receipt";
  workflow_id: string;
  stage_instance: string;
  claim_id: string;
  actor_id: string;
  device_id: string;
  client_id: string;
  provider_id: string;
  issued_at: string;
  lease_expires_at: string;
  generation: number;
  integrity: IntegrityEnvelope;
}

export interface ClaimOperationV3 {
  state: WorkflowStateV3;
  receipt: ClaimReceiptV3;
}

export interface AssignmentInputV3 {
  actor_id: string;
  external_work_item_id?: string;
}

export interface LocalCoordinationProviderOptions {
  provider_id?: string;
  default_lease_ms?: number;
}

const RECEIPT_KEYS = new Set([
  "schema_version",
  "kind",
  "workflow_id",
  "stage_instance",
  "claim_id",
  "actor_id",
  "device_id",
  "client_id",
  "provider_id",
  "issued_at",
  "lease_expires_at",
  "generation",
  "integrity",
]);
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

function leaseDuration(value: number): number {
  if (!Number.isInteger(value) || value < MIN_LEASE_MS || value > MAX_LEASE_MS) {
    throw new Error(`lease duration must be an integer between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds`);
  }
  return value;
}

function identity(value: CoordinationIdentityV3, field = "identity"): CoordinationIdentityV3 {
  return {
    actor_id: text(value.actor_id, `${field}.actor_id`),
    device_id: text(value.device_id, `${field}.device_id`),
    client_id: text(value.client_id, `${field}.client_id`),
  };
}

function receiptDigest(receipt: ClaimReceiptV3): string {
  return createHash("sha256").update(canonicalPayload(receipt)).digest("hex");
}

function issueReceipt(
  state: WorkflowStateV3,
  stageInstance: string,
  claimId: string,
  holder: CoordinationIdentityV3,
  providerId: string,
  issuedAt: string,
  leaseExpiresAt: string,
  generation: number,
): ClaimReceiptV3 {
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.claim.receipt",
    workflow_id: state.workflow_id,
    stage_instance: stageInstance,
    claim_id: claimId,
    actor_id: holder.actor_id,
    device_id: holder.device_id,
    client_id: holder.client_id,
    provider_id: providerId,
    issued_at: issuedAt,
    lease_expires_at: leaseExpiresAt,
    generation,
  };
  return validateClaimReceiptV3({ ...unsigned, integrity: signRecord(unsigned, true) }, true);
}

export function validateClaimReceiptV3(value: unknown, requireIntegrity = true): ClaimReceiptV3 {
  const receipt = record(value, "claim receipt");
  for (const key of Object.keys(receipt)) if (!RECEIPT_KEYS.has(key)) throw new Error(`claim receipt has unknown field ${key}`);
  if (receipt.schema_version !== 1) throw new Error("claim receipt schema_version must be 1");
  if (receipt.kind !== "aidlc.claim.receipt") throw new Error('claim receipt kind must be "aidlc.claim.receipt"');
  if (!Number.isInteger(receipt.generation) || (receipt.generation as number) < 1) {
    throw new Error("claim receipt generation must be a positive integer");
  }
  if (requireIntegrity) {
    const error = verifyRecord(receipt);
    if (error) throw new Error(`claim receipt integrity failed: ${error}`);
  }
  return {
    ...receipt,
    schema_version: 1,
    kind: "aidlc.claim.receipt",
    workflow_id: text(receipt.workflow_id, "claim receipt.workflow_id"),
    stage_instance: text(receipt.stage_instance, "claim receipt.stage_instance"),
    claim_id: text(receipt.claim_id, "claim receipt.claim_id"),
    actor_id: text(receipt.actor_id, "claim receipt.actor_id"),
    device_id: text(receipt.device_id, "claim receipt.device_id"),
    client_id: text(receipt.client_id, "claim receipt.client_id"),
    provider_id: text(receipt.provider_id, "claim receipt.provider_id"),
    issued_at: timestamp(receipt.issued_at, "claim receipt.issued_at"),
    lease_expires_at: timestamp(receipt.lease_expires_at, "claim receipt.lease_expires_at"),
    generation: receipt.generation as number,
    integrity: record(receipt.integrity, "claim receipt.integrity") as unknown as IntegrityEnvelope,
  } as ClaimReceiptV3;
}

export function assertClaimReceiptForStateV3(
  stateValue: WorkflowStateV3,
  receiptValue: ClaimReceiptV3,
  stageInstance: string,
  now = Date.now(),
): ClaimReceiptV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  const receipt = validateClaimReceiptV3(receiptValue, true);
  const instance = state.instances[stageInstance];
  if (!instance) throw new Error(`claim receipt targets unknown stage instance ${stageInstance}`);
  if (receipt.workflow_id !== state.workflow_id || receipt.stage_instance !== stageInstance) {
    throw new Error("claim receipt is bound to a different workflow or stage instance");
  }
  if (Date.parse(receipt.lease_expires_at) <= now) throw new Error(`claim receipt lease expired for ${stageInstance}`);
  const claim = instance.claim;
  if (!claim) throw new Error(`stage instance has no active claim: ${stageInstance}`);
  if (
    claim.claim_id !== receipt.claim_id
    || claim.actor_id !== receipt.actor_id
    || claim.device_id !== receipt.device_id
    || claim.client_id !== receipt.client_id
    || claim.provider_id !== receipt.provider_id
  ) {
    throw new Error(`claim receipt holder does not match the active claim for ${stageInstance}`);
  }
  if (claim.lease_expires_at !== receipt.lease_expires_at) {
    throw new Error(`claim receipt lease is stale for ${stageInstance}`);
  }
  if (claim.provider_receipt_digest !== receiptDigest(receipt)) {
    throw new Error(`claim receipt digest does not match the active claim for ${stageInstance}`);
  }
  return receipt;
}

function append(
  state: WorkflowStateV3,
  eventType: "assignment_set" | "assignment_cleared" | "instance_claimed" | "instance_started" | "claim_renewed" | "instance_released" | "claim_transferred",
  stageInstance: string,
  occurredAt: string,
  payload: Record<string, unknown>,
): WorkflowStateV3 {
  return appendWorkflowEventV3(state, {
    event_type: eventType,
    stage_instance: stageInstance,
    occurred_at: occurredAt,
    payload,
  });
}

export function setAssignmentV3(
  stateValue: WorkflowStateV3,
  stageInstance: string,
  assignment: AssignmentInputV3,
  providerId: string,
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  if (!state.instances[stageInstance]) throw new Error(`unknown stage instance: ${stageInstance}`);
  return append(state, "assignment_set", stageInstance, occurredAt, {
    assignment: {
      actor_id: text(assignment.actor_id, "assignment.actor_id"),
      provider_id: text(providerId, "provider_id"),
      assigned_at: occurredAt,
      ...(assignment.external_work_item_id
        ? { external_work_item_id: text(assignment.external_work_item_id, "assignment.external_work_item_id") }
        : {}),
    },
  });
}

export function clearAssignmentV3(
  stateValue: WorkflowStateV3,
  stageInstance: string,
  reason: string,
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  return append(state, "assignment_cleared", stageInstance, occurredAt, { reason: text(reason, "assignment clear reason") });
}

export function claimInstanceV3(
  stateValue: WorkflowStateV3,
  stageInstance: string,
  holderValue: CoordinationIdentityV3,
  providerId: string,
  leaseMs: number,
  occurredAt = new Date().toISOString(),
): ClaimOperationV3 {
  let state = expireClaimsV3(validateWorkflowStateV3(stateValue, true), occurredAt);
  const instance = state.instances[stageInstance];
  if (!instance) throw new Error(`unknown stage instance: ${stageInstance}`);
  if (instance.status !== "ready") throw new Error(`stage instance is not ready for claim: ${stageInstance} (${instance.status})`);
  const holder = identity(holderValue);
  if (instance.assignment && instance.assignment.actor_id !== holder.actor_id) {
    throw new Error(`stage instance is assigned to ${instance.assignment.actor_id}, not ${holder.actor_id}`);
  }
  const duration = leaseDuration(leaseMs);
  const issuedAt = timestamp(occurredAt, "claim occurred_at");
  const leaseExpiresAt = new Date(Date.parse(issuedAt) + duration).toISOString();
  const claimId = randomUUID();
  const receipt = issueReceipt(state, stageInstance, claimId, holder, text(providerId, "provider_id"), issuedAt, leaseExpiresAt, 1);
  state = append(state, "instance_claimed", stageInstance, issuedAt, {
    claim: {
      claim_id: claimId,
      ...holder,
      provider_id: providerId,
      provider_receipt_digest: receiptDigest(receipt),
      claimed_at: issuedAt,
      renewed_at: issuedAt,
      lease_expires_at: leaseExpiresAt,
    },
  });
  state = append(state, "instance_started", stageInstance, issuedAt, {});
  return { state, receipt };
}

export function heartbeatClaimV3(
  stateValue: WorkflowStateV3,
  receiptValue: ClaimReceiptV3,
  leaseMs: number,
  occurredAt = new Date().toISOString(),
): ClaimOperationV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  const now = Date.parse(timestamp(occurredAt, "heartbeat occurred_at"));
  const receipt = assertClaimReceiptForStateV3(state, receiptValue, receiptValue.stage_instance, now);
  const duration = leaseDuration(leaseMs);
  const leaseExpiresAt = new Date(now + duration).toISOString();
  const nextReceipt = issueReceipt(
    state,
    receipt.stage_instance,
    receipt.claim_id,
    identity(receipt, "claim receipt holder"),
    receipt.provider_id,
    occurredAt,
    leaseExpiresAt,
    receipt.generation + 1,
  );
  const next = append(state, "claim_renewed", receipt.stage_instance, occurredAt, {
    lease_expires_at: leaseExpiresAt,
    provider_receipt_digest: receiptDigest(nextReceipt),
  });
  return { state: next, receipt: nextReceipt };
}

export function releaseClaimV3(
  stateValue: WorkflowStateV3,
  receiptValue: ClaimReceiptV3,
  reason: string,
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  const state = validateWorkflowStateV3(stateValue, true);
  const receipt = assertClaimReceiptForStateV3(state, receiptValue, receiptValue.stage_instance, Date.parse(occurredAt));
  return append(state, "instance_released", receipt.stage_instance, occurredAt, {
    reason: text(reason, "release reason"),
    target_status: state.instances[receipt.stage_instance].status === "submitted" ? "blocked" : "ready",
  });
}

export function transferClaimV3(
  stateValue: WorkflowStateV3,
  receiptValue: ClaimReceiptV3,
  nextHolderValue: CoordinationIdentityV3,
  leaseMs: number,
  occurredAt = new Date().toISOString(),
): ClaimOperationV3 {
  let state = validateWorkflowStateV3(stateValue, true);
  const receipt = assertClaimReceiptForStateV3(state, receiptValue, receiptValue.stage_instance, Date.parse(occurredAt));
  const nextHolder = identity(nextHolderValue, "transfer identity");
  const instance = state.instances[receipt.stage_instance];
  if (instance.assignment && instance.assignment.actor_id !== nextHolder.actor_id) {
    throw new Error(`stage instance is assigned to ${instance.assignment.actor_id}, not ${nextHolder.actor_id}`);
  }
  const duration = leaseDuration(leaseMs);
  const leaseExpiresAt = new Date(Date.parse(occurredAt) + duration).toISOString();
  const claimId = randomUUID();
  const nextReceipt = issueReceipt(
    state,
    receipt.stage_instance,
    claimId,
    nextHolder,
    receipt.provider_id,
    occurredAt,
    leaseExpiresAt,
    1,
  );
  state = append(state, "claim_transferred", receipt.stage_instance, occurredAt, {
    claim: {
      claim_id: claimId,
      ...nextHolder,
      provider_id: receipt.provider_id,
      provider_receipt_digest: receiptDigest(nextReceipt),
      claimed_at: occurredAt,
      renewed_at: occurredAt,
      lease_expires_at: leaseExpiresAt,
    },
  });
  state = append(state, "instance_started", receipt.stage_instance, occurredAt, {});
  return { state, receipt: nextReceipt };
}

export function expireClaimsV3(
  stateValue: WorkflowStateV3,
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  let state = validateWorkflowStateV3(stateValue, true);
  const now = Date.parse(timestamp(occurredAt, "expiry occurred_at"));
  for (const instanceId of Object.keys(state.instances).sort()) {
    const instance = state.instances[instanceId];
    const claim = instance.claim;
    if (!claim || claim.compatibility_lock || claim.lease_expires_at === null) continue;
    if (Date.parse(claim.lease_expires_at) > now) continue;
    state = append(state, "instance_released", instanceId, occurredAt, {
      reason: "Execution lease expired",
      target_status: instance.status === "submitted" ? "blocked" : "ready",
    });
  }
  return state;
}

export class LocalCoordinationProviderV3 {
  readonly provider_id: string;
  readonly default_lease_ms: number;

  constructor(private readonly projectRoot: string, options: LocalCoordinationProviderOptions = {}) {
    this.provider_id = options.provider_id || "local-state-v3";
    this.default_lease_ms = leaseDuration(options.default_lease_ms || 5 * 60 * 1000);
  }

  assign(stageInstance: string, assignment: AssignmentInputV3, occurredAt?: string): WorkflowStateV3 {
    return mutateWorkflowStateV3(this.projectRoot, (state) =>
      setAssignmentV3(state, stageInstance, assignment, this.provider_id, occurredAt));
  }

  clearAssignment(stageInstance: string, reason: string, occurredAt?: string): WorkflowStateV3 {
    return mutateWorkflowStateV3(this.projectRoot, (state) =>
      clearAssignmentV3(state, stageInstance, reason, occurredAt));
  }

  claim(
    stageInstance: string,
    holder: CoordinationIdentityV3,
    leaseMs = this.default_lease_ms,
    occurredAt?: string,
  ): ClaimOperationV3 {
    let operation: ClaimOperationV3 | undefined;
    const state = mutateWorkflowStateV3(this.projectRoot, (current) => {
      operation = claimInstanceV3(current, stageInstance, holder, this.provider_id, leaseMs, occurredAt);
      return operation.state;
    });
    if (!operation) throw new Error("local claim operation did not produce a receipt");
    return { state, receipt: operation.receipt };
  }

  heartbeat(receipt: ClaimReceiptV3, leaseMs = this.default_lease_ms, occurredAt?: string): ClaimOperationV3 {
    let operation: ClaimOperationV3 | undefined;
    const state = mutateWorkflowStateV3(this.projectRoot, (current) => {
      operation = heartbeatClaimV3(current, receipt, leaseMs, occurredAt);
      return operation.state;
    });
    if (!operation) throw new Error("local heartbeat operation did not produce a receipt");
    return { state, receipt: operation.receipt };
  }

  release(receipt: ClaimReceiptV3, reason: string, occurredAt?: string): WorkflowStateV3 {
    return mutateWorkflowStateV3(this.projectRoot, (state) => releaseClaimV3(state, receipt, reason, occurredAt));
  }

  transfer(
    receipt: ClaimReceiptV3,
    nextHolder: CoordinationIdentityV3,
    leaseMs = this.default_lease_ms,
    occurredAt?: string,
  ): ClaimOperationV3 {
    let operation: ClaimOperationV3 | undefined;
    const state = mutateWorkflowStateV3(this.projectRoot, (current) => {
      operation = transferClaimV3(current, receipt, nextHolder, leaseMs, occurredAt);
      return operation.state;
    });
    if (!operation) throw new Error("local transfer operation did not produce a receipt");
    return { state, receipt: operation.receipt };
  }

  expire(occurredAt?: string): WorkflowStateV3 {
    return mutateWorkflowStateV3(this.projectRoot, (state) => expireClaimsV3(state, occurredAt));
  }
}
