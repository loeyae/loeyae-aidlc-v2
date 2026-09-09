import { createHash } from "crypto";
import { moduleInceptionRoot, unitConstructionRoot } from "./aidlc-execution-context";
import { canonicalPayload, verifyApprovalToken } from "./aidlc-trust";
import type { WorkflowState } from "./aidlc-state";

export interface ApprovalProviderRequest {
  schema_version: 1;
  kind: "aidlc.approval.request";
  request_id: string;
  workflow_id: string;
  stage: string;
  stage_instance: string;
  module_id: string | null;
  unit_id: string | null;
  challenge: string;
  issued_at: string;
  expires_at: string;
  artifact_root: string;
  evidence_root: string;
}

export interface ApprovalProviderResponse {
  schema_version: 1;
  kind: "aidlc.approval.response";
  request_id: string;
  provider_id: string;
  human_event_id: string;
  approved_at: string;
  approval_token: string;
}

export interface ValidatedApprovalProviderResponse {
  approval_token: string;
  provider_id: string;
  human_event_id: string;
  approved_at: string;
  request_id: string;
}

const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RESPONSE_KEYS = new Set([
  "schema_version",
  "kind",
  "request_id",
  "provider_id",
  "human_event_id",
  "approved_at",
  "approval_token",
]);

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function challengeIssuedAt(challenge: string): number {
  const issuedAt = Number(challenge.split(".", 1)[0]);
  if (!Number.isFinite(issuedAt)) throw new Error("approval challenge has an invalid timestamp");
  return issuedAt;
}

function assertChallengeCurrent(challenge: string, now: number): number {
  const issuedAt = challengeIssuedAt(challenge);
  if (issuedAt > now + CLOCK_SKEW_MS) throw new Error("approval challenge timestamp is in the future");
  if (now - issuedAt > CHALLENGE_TTL_MS) throw new Error("approval challenge expired; run orchestrate next again");
  return issuedAt;
}

function requestArtifactRoot(state: WorkflowState): string {
  if (state.current_module && state.current_unit) {
    return unitConstructionRoot(state.current_module, state.current_unit);
  }
  if (state.current_module) return moduleInceptionRoot(state.current_module);
  const phase = state.current_phase === "operation" ? "operations" : state.current_phase;
  return `docs/aidlc/${phase}`;
}

function requestEvidenceRoot(state: WorkflowState, stage: string): string {
  const parts = [".aidlc", "evidence", stage];
  if (state.current_module) parts.push(state.current_module);
  if (state.current_unit) parts.push(state.current_unit);
  return parts.join("/");
}

export function buildApprovalProviderRequest(
  state: WorkflowState,
  stage: string,
  now = Date.now(),
): ApprovalProviderRequest {
  if (state.status !== "running") throw new Error(`workflow is ${state.status}, not running`);
  if (state.current_stage !== stage) throw new Error(`stage ${stage} is not the active running stage`);
  const stageInstance = state.current_stage_instance || stage;
  const challenge = state.approval_challenges[stageInstance];
  if (!challenge) throw new Error(`stage instance ${stageInstance} has no active approval challenge; run orchestrate next first`);
  const issuedAt = assertChallengeCurrent(challenge, now);
  const unsigned: Omit<ApprovalProviderRequest, "request_id"> = {
    schema_version: 1,
    kind: "aidlc.approval.request",
    workflow_id: state.workflow_id,
    stage,
    stage_instance: stageInstance,
    module_id: state.current_module || null,
    unit_id: state.current_unit || null,
    challenge,
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(issuedAt + CHALLENGE_TTL_MS).toISOString(),
    artifact_root: requestArtifactRoot(state),
    evidence_root: requestEvidenceRoot(state, stage),
  };
  const requestId = createHash("sha256")
    .update(canonicalPayload(unsigned as Record<string, unknown>))
    .digest("hex");
  return { ...unsigned, request_id: requestId };
}

function parseResponseJson(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`approval provider response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("approval provider response must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("approval provider response must be a JSON object");
  }
  const response = value as Record<string, unknown>;
  for (const key of Object.keys(response)) {
    if (!RESPONSE_KEYS.has(key)) throw new Error(`approval provider response has unknown field ${key}`);
  }
  return response;
}

export function validateApprovalProviderResponse(
  raw: string,
  request: ApprovalProviderRequest,
  now = Date.now(),
): ValidatedApprovalProviderResponse {
  const response = parseResponseJson(raw);
  if (response.schema_version !== 1) throw new Error("approval provider response schema_version must be 1");
  if (response.kind !== "aidlc.approval.response") {
    throw new Error('approval provider response kind must be "aidlc.approval.response"');
  }
  const requestId = nonEmptyString(response.request_id, "approval provider response request_id");
  if (requestId !== request.request_id) throw new Error("approval provider response request_id does not match the active request");
  const providerId = nonEmptyString(response.provider_id, "approval provider response provider_id");
  const humanEventId = nonEmptyString(response.human_event_id, "approval provider response human_event_id");
  const approvedAtText = nonEmptyString(response.approved_at, "approval provider response approved_at");
  const approvedAt = new Date(approvedAtText).getTime();
  if (!Number.isFinite(approvedAt)) throw new Error("approval provider response approved_at must be an ISO timestamp");
  const issuedAt = new Date(request.issued_at).getTime();
  const expiresAt = new Date(request.expires_at).getTime();
  if (approvedAt < issuedAt - CLOCK_SKEW_MS) throw new Error("approval provider response predates the active request");
  if (approvedAt > now + CLOCK_SKEW_MS) throw new Error("approval provider response approved_at is in the future");
  if (approvedAt > expiresAt || now > expiresAt) throw new Error("approval provider response is expired");
  const token = nonEmptyString(response.approval_token, "approval provider response approval_token");
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("approval provider response approval_token must be 64 hexadecimal characters");
  if (!verifyApprovalToken(request.workflow_id, request.stage_instance, request.challenge, token)) {
    throw new Error("approval provider response token is invalid or stale");
  }
  return {
    approval_token: token,
    provider_id: providerId,
    human_event_id: humanEventId,
    approved_at: new Date(approvedAt).toISOString(),
    request_id: requestId,
  };
}
