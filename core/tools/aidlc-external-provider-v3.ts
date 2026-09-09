import { createHash, randomUUID } from "crypto";
import type { CoordinationIdentityV3 } from "./aidlc-coordination-local-v3";
import { canonicalPayload, signRecord, verifyRecord, type IntegrityEnvelope } from "./aidlc-trust";

export type ExternalWorkStatusV3 = "ready" | "claimed" | "completed";
export type ExternalProviderOperationV3 = "claim" | "renew" | "release" | "transfer" | "complete";

export interface ExternalWorkItemV3 extends Record<string, unknown> {
  schema_version: 1;
  provider_id: string;
  workflow_id: string;
  external_work_item_id: string;
  stage_instance: string;
  title: string;
  status: ExternalWorkStatusV3;
  assignee_actor_id: string | null;
  claimed_by_actor_id: string | null;
  claimed_by_device_id: string | null;
  claimed_by_client_id: string | null;
  lease_expires_at: string | null;
  provider_version: string;
  etag: string;
  updated_at: string;
}

export interface ExternalProviderReceiptV3 extends Record<string, unknown> {
  schema_version: 1;
  kind: "aidlc.external-provider.receipt";
  provider_id: string;
  operation: ExternalProviderOperationV3;
  workflow_id: string;
  external_work_item_id: string;
  stage_instance: string;
  actor_id: string;
  device_id: string;
  client_id: string;
  previous_provider_version: string;
  previous_etag: string;
  provider_version: string;
  etag: string;
  lease_expires_at: string | null;
  issued_at: string;
  provider_event_id: string;
  integrity: IntegrityEnvelope;
}

export interface ExternalReadyRequestV3 {
  workflow_id: string;
}

export interface ExternalClaimRequestV3 {
  workflow_id: string;
  external_work_item_id: string;
  expected_provider_version: string;
  expected_etag: string;
  holder: CoordinationIdentityV3;
  lease_ms: number;
  occurred_at?: string;
}

export interface ExternalReceiptRequestV3 {
  receipt: ExternalProviderReceiptV3;
  occurred_at?: string;
}

export interface ExternalRenewRequestV3 extends ExternalReceiptRequestV3 {
  lease_ms: number;
}

export interface ExternalReleaseRequestV3 extends ExternalReceiptRequestV3 {
  reason: string;
}

export interface ExternalTransferRequestV3 extends ExternalReceiptRequestV3 {
  next_holder: CoordinationIdentityV3;
  lease_ms: number;
}

export interface ExternalProviderResultV3 {
  item: ExternalWorkItemV3;
  receipt: ExternalProviderReceiptV3;
}

export type ProviderResponseV3<T> = T | Promise<T>;

export interface ExternalWorkManagementProviderV3 {
  readonly provider_id: string;
  listReady(request: ExternalReadyRequestV3): ProviderResponseV3<ExternalWorkItemV3[]>;
  claim(request: ExternalClaimRequestV3): ProviderResponseV3<ExternalProviderResultV3>;
  renew(request: ExternalRenewRequestV3): ProviderResponseV3<ExternalProviderResultV3>;
  release(request: ExternalReleaseRequestV3): ProviderResponseV3<ExternalProviderResultV3>;
  transfer(request: ExternalTransferRequestV3): ProviderResponseV3<ExternalProviderResultV3>;
  complete(request: ExternalReceiptRequestV3): ProviderResponseV3<ExternalProviderResultV3>;
}

export interface ReferenceWorkItemInputV3 {
  workflow_id: string;
  external_work_item_id: string;
  stage_instance: string;
  title: string;
  assignee_actor_id?: string;
}

const ITEM_KEYS = new Set([
  "schema_version",
  "provider_id",
  "workflow_id",
  "external_work_item_id",
  "stage_instance",
  "title",
  "status",
  "assignee_actor_id",
  "claimed_by_actor_id",
  "claimed_by_device_id",
  "claimed_by_client_id",
  "lease_expires_at",
  "provider_version",
  "etag",
  "updated_at",
]);
const RECEIPT_KEYS = new Set([
  "schema_version",
  "kind",
  "provider_id",
  "operation",
  "workflow_id",
  "external_work_item_id",
  "stage_instance",
  "actor_id",
  "device_id",
  "client_id",
  "previous_provider_version",
  "previous_etag",
  "provider_version",
  "etag",
  "lease_expires_at",
  "issued_at",
  "provider_event_id",
  "integrity",
]);
const OPERATIONS = new Set<ExternalProviderOperationV3>(["claim", "renew", "release", "transfer", "complete"]);
const STATUSES = new Set<ExternalWorkStatusV3>(["ready", "claimed", "completed"]);
const MIN_LEASE_MS = 5_000;
const MAX_LEASE_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function exact(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${field} has unknown field ${key}`);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : text(value, field);
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO timestamp`);
  return result;
}

function identity(value: CoordinationIdentityV3, field = "identity"): CoordinationIdentityV3 {
  return {
    actor_id: text(value.actor_id, `${field}.actor_id`),
    device_id: text(value.device_id, `${field}.device_id`),
    client_id: text(value.client_id, `${field}.client_id`),
  };
}

function leaseDuration(value: number): number {
  if (!Number.isInteger(value) || value < MIN_LEASE_MS || value > MAX_LEASE_MS) {
    throw new Error(`lease duration must be an integer between ${MIN_LEASE_MS} and ${MAX_LEASE_MS} milliseconds`);
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function itemEtag(item: Omit<ExternalWorkItemV3, "etag">): string {
  return `"${createHash("sha256").update(canonicalPayload(item)).digest("hex")}"`;
}

export function validateExternalWorkItemV3(value: unknown): ExternalWorkItemV3 {
  const item = record(value, "external work item");
  exact(item, ITEM_KEYS, "external work item");
  if (item.schema_version !== 1) throw new Error("external work item schema_version must be 1");
  const status = text(item.status, "external work item.status") as ExternalWorkStatusV3;
  if (!STATUSES.has(status)) throw new Error(`invalid external work item status: ${status}`);
  const lease = item.lease_expires_at === null ? null : timestamp(item.lease_expires_at, "external work item.lease_expires_at");
  const claimedActor = nullableText(item.claimed_by_actor_id, "external work item.claimed_by_actor_id");
  const claimedDevice = nullableText(item.claimed_by_device_id, "external work item.claimed_by_device_id");
  const claimedClient = nullableText(item.claimed_by_client_id, "external work item.claimed_by_client_id");
  const hasClaim = claimedActor !== null || claimedDevice !== null || claimedClient !== null || lease !== null;
  if (status === "claimed" && (!claimedActor || !claimedDevice || !claimedClient || !lease)) {
    throw new Error("claimed external work item requires a complete holder and lease");
  }
  if (status !== "claimed" && hasClaim) throw new Error(`${status} external work item cannot retain a claim holder or lease`);
  return {
    ...item,
    schema_version: 1,
    provider_id: text(item.provider_id, "external work item.provider_id"),
    workflow_id: text(item.workflow_id, "external work item.workflow_id"),
    external_work_item_id: text(item.external_work_item_id, "external work item.external_work_item_id"),
    stage_instance: text(item.stage_instance, "external work item.stage_instance"),
    title: text(item.title, "external work item.title"),
    status,
    assignee_actor_id: nullableText(item.assignee_actor_id, "external work item.assignee_actor_id"),
    claimed_by_actor_id: claimedActor,
    claimed_by_device_id: claimedDevice,
    claimed_by_client_id: claimedClient,
    lease_expires_at: lease,
    provider_version: text(item.provider_version, "external work item.provider_version"),
    etag: text(item.etag, "external work item.etag"),
    updated_at: timestamp(item.updated_at, "external work item.updated_at"),
  } as ExternalWorkItemV3;
}

export function validateExternalProviderReceiptV3(
  value: unknown,
  requireIntegrity = true,
): ExternalProviderReceiptV3 {
  const receipt = record(value, "external provider receipt");
  exact(receipt, RECEIPT_KEYS, "external provider receipt");
  if (receipt.schema_version !== 1) throw new Error("external provider receipt schema_version must be 1");
  if (receipt.kind !== "aidlc.external-provider.receipt") {
    throw new Error('external provider receipt kind must be "aidlc.external-provider.receipt"');
  }
  const operation = text(receipt.operation, "external provider receipt.operation") as ExternalProviderOperationV3;
  if (!OPERATIONS.has(operation)) throw new Error(`invalid external provider operation: ${operation}`);
  if (requireIntegrity) {
    const error = verifyRecord(receipt);
    if (error) throw new Error(`external provider receipt integrity failed: ${error}`);
  }
  return {
    ...receipt,
    schema_version: 1,
    kind: "aidlc.external-provider.receipt",
    provider_id: text(receipt.provider_id, "external provider receipt.provider_id"),
    operation,
    workflow_id: text(receipt.workflow_id, "external provider receipt.workflow_id"),
    external_work_item_id: text(receipt.external_work_item_id, "external provider receipt.external_work_item_id"),
    stage_instance: text(receipt.stage_instance, "external provider receipt.stage_instance"),
    actor_id: text(receipt.actor_id, "external provider receipt.actor_id"),
    device_id: text(receipt.device_id, "external provider receipt.device_id"),
    client_id: text(receipt.client_id, "external provider receipt.client_id"),
    previous_provider_version: text(receipt.previous_provider_version, "external provider receipt.previous_provider_version"),
    previous_etag: text(receipt.previous_etag, "external provider receipt.previous_etag"),
    provider_version: text(receipt.provider_version, "external provider receipt.provider_version"),
    etag: text(receipt.etag, "external provider receipt.etag"),
    lease_expires_at: receipt.lease_expires_at === null
      ? null
      : timestamp(receipt.lease_expires_at, "external provider receipt.lease_expires_at"),
    issued_at: timestamp(receipt.issued_at, "external provider receipt.issued_at"),
    provider_event_id: text(receipt.provider_event_id, "external provider receipt.provider_event_id"),
    integrity: record(receipt.integrity, "external provider receipt.integrity") as unknown as IntegrityEnvelope,
  } as ExternalProviderReceiptV3;
}

function createReceipt(
  providerId: string,
  operation: ExternalProviderOperationV3,
  previous: ExternalWorkItemV3,
  next: ExternalWorkItemV3,
  holder: CoordinationIdentityV3,
  occurredAt: string,
): ExternalProviderReceiptV3 {
  const unsigned: Record<string, unknown> = {
    schema_version: 1,
    kind: "aidlc.external-provider.receipt",
    provider_id: providerId,
    operation,
    workflow_id: next.workflow_id,
    external_work_item_id: next.external_work_item_id,
    stage_instance: next.stage_instance,
    actor_id: holder.actor_id,
    device_id: holder.device_id,
    client_id: holder.client_id,
    previous_provider_version: previous.provider_version,
    previous_etag: previous.etag,
    provider_version: next.provider_version,
    etag: next.etag,
    lease_expires_at: next.lease_expires_at,
    issued_at: occurredAt,
    provider_event_id: randomUUID(),
  };
  return validateExternalProviderReceiptV3({ ...unsigned, integrity: signRecord(unsigned, true) }, true);
}

export class InMemoryExternalWorkManagementProviderV3 implements ExternalWorkManagementProviderV3 {
  readonly provider_id: string;
  private readonly items = new Map<string, ExternalWorkItemV3>();

  constructor(providerId: string, inputs: readonly ReferenceWorkItemInputV3[], createdAt = new Date().toISOString()) {
    this.provider_id = text(providerId, "provider_id");
    const at = timestamp(createdAt, "created_at");
    for (const input of inputs) {
      const id = text(input.external_work_item_id, "external_work_item_id");
      if (this.items.has(id)) throw new Error(`duplicate external_work_item_id: ${id}`);
      const withoutEtag: Omit<ExternalWorkItemV3, "etag"> = {
        schema_version: 1,
        provider_id: this.provider_id,
        workflow_id: text(input.workflow_id, "workflow_id"),
        external_work_item_id: id,
        stage_instance: text(input.stage_instance, "stage_instance"),
        title: text(input.title, "title"),
        status: "ready",
        assignee_actor_id: input.assignee_actor_id ? text(input.assignee_actor_id, "assignee_actor_id") : null,
        claimed_by_actor_id: null,
        claimed_by_device_id: null,
        claimed_by_client_id: null,
        lease_expires_at: null,
        provider_version: "1",
        updated_at: at,
      };
      this.items.set(id, validateExternalWorkItemV3({ ...withoutEtag, etag: itemEtag(withoutEtag) }));
    }
  }

  listReady(request: ExternalReadyRequestV3): ExternalWorkItemV3[] {
    const workflowId = text(request.workflow_id, "workflow_id");
    return [...this.items.values()]
      .filter((item) => item.workflow_id === workflowId && item.status === "ready")
      .sort((left, right) => left.stage_instance.localeCompare(right.stage_instance) || left.external_work_item_id.localeCompare(right.external_work_item_id))
      .map(clone);
  }

  claim(request: ExternalClaimRequestV3): ExternalProviderResultV3 {
    const previous = this.expectedItem(
      request.workflow_id,
      request.external_work_item_id,
      request.expected_provider_version,
      request.expected_etag,
    );
    if (previous.status !== "ready") throw new Error(`external work item is not ready: ${previous.external_work_item_id} (${previous.status})`);
    const claimHolder = identity(request.holder);
    if (previous.assignee_actor_id && previous.assignee_actor_id !== claimHolder.actor_id) {
      throw new Error(`external work item is assigned to ${previous.assignee_actor_id}, not ${claimHolder.actor_id}`);
    }
    const occurredAt = timestamp(request.occurred_at || new Date().toISOString(), "claim occurred_at");
    const leaseExpiresAt = new Date(Date.parse(occurredAt) + leaseDuration(request.lease_ms)).toISOString();
    const next = this.update(previous, occurredAt, {
      status: "claimed",
      assignee_actor_id: previous.assignee_actor_id || claimHolder.actor_id,
      claimed_by_actor_id: claimHolder.actor_id,
      claimed_by_device_id: claimHolder.device_id,
      claimed_by_client_id: claimHolder.client_id,
      lease_expires_at: leaseExpiresAt,
    });
    return this.result("claim", previous, next, claimHolder, occurredAt);
  }

  renew(request: ExternalRenewRequestV3): ExternalProviderResultV3 {
    const { previous, holder: claimHolder } = this.fromReceipt(request.receipt, request.occurred_at);
    const occurredAt = timestamp(request.occurred_at || new Date().toISOString(), "renew occurred_at");
    const next = this.update(previous, occurredAt, {
      lease_expires_at: new Date(Date.parse(occurredAt) + leaseDuration(request.lease_ms)).toISOString(),
    });
    return this.result("renew", previous, next, claimHolder, occurredAt);
  }

  release(request: ExternalReleaseRequestV3): ExternalProviderResultV3 {
    text(request.reason, "release reason");
    const { previous, holder: claimHolder } = this.fromReceipt(request.receipt, request.occurred_at);
    const occurredAt = timestamp(request.occurred_at || new Date().toISOString(), "release occurred_at");
    const next = this.update(previous, occurredAt, {
      status: "ready",
      claimed_by_actor_id: null,
      claimed_by_device_id: null,
      claimed_by_client_id: null,
      lease_expires_at: null,
    });
    return this.result("release", previous, next, claimHolder, occurredAt);
  }

  transfer(request: ExternalTransferRequestV3): ExternalProviderResultV3 {
    const { previous } = this.fromReceipt(request.receipt, request.occurred_at);
    const nextHolder = identity(request.next_holder, "next_holder");
    const occurredAt = timestamp(request.occurred_at || new Date().toISOString(), "transfer occurred_at");
    const next = this.update(previous, occurredAt, {
      assignee_actor_id: nextHolder.actor_id,
      claimed_by_actor_id: nextHolder.actor_id,
      claimed_by_device_id: nextHolder.device_id,
      claimed_by_client_id: nextHolder.client_id,
      lease_expires_at: new Date(Date.parse(occurredAt) + leaseDuration(request.lease_ms)).toISOString(),
    });
    return this.result("transfer", previous, next, nextHolder, occurredAt);
  }

  complete(request: ExternalReceiptRequestV3): ExternalProviderResultV3 {
    const { previous, holder: claimHolder } = this.fromReceipt(request.receipt, request.occurred_at);
    const occurredAt = timestamp(request.occurred_at || new Date().toISOString(), "complete occurred_at");
    const next = this.update(previous, occurredAt, {
      status: "completed",
      claimed_by_actor_id: null,
      claimed_by_device_id: null,
      claimed_by_client_id: null,
      lease_expires_at: null,
    });
    return this.result("complete", previous, next, claimHolder, occurredAt);
  }

  private expectedItem(workflowIdValue: string, itemIdValue: string, versionValue: string, etagValue: string): ExternalWorkItemV3 {
    const workflowId = text(workflowIdValue, "workflow_id");
    const itemId = text(itemIdValue, "external_work_item_id");
    const item = this.items.get(itemId);
    if (!item || item.workflow_id !== workflowId) throw new Error(`external work item not found: ${itemId}`);
    const version = text(versionValue, "expected_provider_version");
    const etag = text(etagValue, "expected_etag");
    if (item.provider_version !== version || item.etag !== etag) {
      throw new Error(`external work item CAS conflict for ${itemId}: expected ${version}/${etag}, found ${item.provider_version}/${item.etag}`);
    }
    return item;
  }

  private fromReceipt(receiptValue: ExternalProviderReceiptV3, occurredAt?: string): {
    previous: ExternalWorkItemV3;
    holder: CoordinationIdentityV3;
  } {
    const receipt = validateExternalProviderReceiptV3(receiptValue, true);
    if (receipt.provider_id !== this.provider_id) throw new Error("external provider receipt belongs to another provider");
    const previous = this.expectedItem(receipt.workflow_id, receipt.external_work_item_id, receipt.provider_version, receipt.etag);
    if (previous.stage_instance !== receipt.stage_instance || previous.status !== "claimed") {
      throw new Error(`external provider receipt no longer matches claimed item ${receipt.external_work_item_id}`);
    }
    if (
      previous.claimed_by_actor_id !== receipt.actor_id
      || previous.claimed_by_device_id !== receipt.device_id
      || previous.claimed_by_client_id !== receipt.client_id
    ) {
      throw new Error(`external provider receipt holder is stale for ${receipt.external_work_item_id}`);
    }
    const now = Date.parse(timestamp(occurredAt || new Date().toISOString(), "operation occurred_at"));
    if (!previous.lease_expires_at || Date.parse(previous.lease_expires_at) <= now) {
      throw new Error(`external provider lease expired for ${receipt.external_work_item_id}`);
    }
    return {
      previous,
      holder: { actor_id: receipt.actor_id, device_id: receipt.device_id, client_id: receipt.client_id },
    };
  }

  private update(
    previous: ExternalWorkItemV3,
    occurredAt: string,
    changes: Partial<ExternalWorkItemV3>,
  ): ExternalWorkItemV3 {
    const withoutEtag = {
      ...previous,
      ...changes,
      provider_version: String(Number(previous.provider_version) + 1),
      updated_at: occurredAt,
    } as Omit<ExternalWorkItemV3, "etag">;
    delete (withoutEtag as Partial<ExternalWorkItemV3>).etag;
    const next = validateExternalWorkItemV3({ ...withoutEtag, etag: itemEtag(withoutEtag) });
    this.items.set(next.external_work_item_id, next);
    return next;
  }

  private result(
    operation: ExternalProviderOperationV3,
    previous: ExternalWorkItemV3,
    next: ExternalWorkItemV3,
    claimHolder: CoordinationIdentityV3,
    occurredAt: string,
  ): ExternalProviderResultV3 {
    return {
      item: clone(next),
      receipt: createReceipt(this.provider_id, operation, previous, next, claimHolder, occurredAt),
    };
  }
}
