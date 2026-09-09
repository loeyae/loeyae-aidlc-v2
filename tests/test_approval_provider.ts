import { strict as assert } from "assert";
import { createHmac } from "crypto";
import {
  approvalConfirmationPhrase,
  buildApprovalProviderRequest,
  validateApprovalConversationConfirmation,
  validateApprovalProviderResponse,
  type ApprovalConversationConfirmation,
  type ApprovalProviderResponse,
} from "../core/tools/aidlc-approval-provider";
import type { WorkflowState } from "../core/tools/aidlc-state";

const secret = "approval-provider-test-secret-32-bytes";
process.env.AIDLC_TRUST_SECRET = secret;

const issuedAt = Date.parse("2026-09-09T00:00:00.000Z");
const stageInstance = "application-design@module:module-a";
const challenge = `${issuedAt}.provider-test-challenge`;
const state: WorkflowState = {
  schema_version: 2,
  version: "2.4.0",
  workflow_id: "workflow-provider-test",
  revision: 4,
  scope: "feature",
  depth: "standard",
  current_phase: "inception",
  current_stage: "application-design",
  status: "running",
  completed_stages: [],
  skipped_stages: [],
  approval_challenges: { [stageInstance]: challenge },
  history: [],
  created_at: "2026-09-08T00:00:00.000Z",
  updated_at: "2026-09-09T00:00:00.000Z",
  routing_model: "module-unit-v1",
  current_stage_instance: stageInstance,
  current_module: "module-a",
  completed_stage_instances: [],
  skipped_stage_instances: [],
  selected_optional_stages: [],
};

const request = buildApprovalProviderRequest(state, "application-design", issuedAt + 1000);
assert.equal(request.stage_instance, stageInstance);
assert.equal(request.module_id, "module-a");
assert.equal(request.unit_id, null);
assert.equal(request.artifact_root, "docs/aidlc/modules/module-a/inception");
assert.equal(request.evidence_root, ".aidlc/evidence/application-design/module-a");
assert.equal(request.confirmation_phrase, approvalConfirmationPhrase(stageInstance, challenge));
assert.equal(request.confirmation_phrase, `APPROVE ${stageInstance} ${challenge.slice(-8)}`);
assert.match(request.request_id, /^[a-f0-9]{64}$/);
assert.deepEqual(
  buildApprovalProviderRequest(state, "application-design", issuedAt + 2000),
  request,
  "the same active challenge must produce a stable request and confirmation phrase",
);

const token = createHmac("sha256", Buffer.from(secret, "utf8"))
  .update(`aidlc-approval-v1\n${state.workflow_id}\n${stageInstance}\n${challenge}`)
  .digest("hex");

const conversationConfirmation: ApprovalConversationConfirmation = {
  schema_version: 1,
  kind: "aidlc.approval.confirmation",
  request_id: request.request_id,
  confirmation_phrase: request.confirmation_phrase,
};
const validatedConversation = validateApprovalConversationConfirmation(
  JSON.stringify(conversationConfirmation),
  request,
);
assert.equal(validatedConversation.approval_token, token);
assert.equal(validatedConversation.provider_id, "conversation-confirmation");
assert.match(validatedConversation.human_event_id, /^conversation-[a-f0-9]{24}$/);

function conversationRejected(mutate: (value: Record<string, unknown>) => void, message: RegExp): void {
  const value = { ...conversationConfirmation } as Record<string, unknown>;
  mutate(value);
  assert.throws(
    () => validateApprovalConversationConfirmation(JSON.stringify(value), request),
    message,
  );
}

conversationRejected((value) => { value.request_id = "0".repeat(64); }, /request_id does not match/);
conversationRejected((value) => { value.confirmation_phrase = `${request.confirmation_phrase} `; }, /did not match exactly/);
conversationRejected((value) => { value.kind = "aidlc.approval.response"; }, /kind must be/);
conversationRejected((value) => { value.unexpected = true; }, /unknown field unexpected/);

const response: ApprovalProviderResponse = {
  schema_version: 1,
  kind: "aidlc.approval.response",
  request_id: request.request_id,
  provider_id: "test-trusted-host",
  human_event_id: "human-event-001",
  approved_at: new Date(issuedAt + 3000).toISOString(),
  approval_token: token,
};
const validated = validateApprovalProviderResponse(
  JSON.stringify(response),
  request,
  issuedAt + 4000,
);
assert.equal(validated.approval_token, token);
assert.equal(validated.provider_id, "test-trusted-host");
assert.equal(validated.human_event_id, "human-event-001");

function rejected(mutate: (value: Record<string, unknown>) => void, message: RegExp): void {
  const value = { ...response } as Record<string, unknown>;
  mutate(value);
  assert.throws(
    () => validateApprovalProviderResponse(JSON.stringify(value), request, issuedAt + 4000),
    message,
  );
}

rejected((value) => { value.request_id = "0".repeat(64); }, /request_id does not match/);
rejected((value) => { value.approval_token = "f".repeat(64); }, /token is invalid or stale/);
rejected((value) => { value.approved_at = "not-a-date"; }, /ISO timestamp/);
rejected((value) => { value.unexpected = true; }, /unknown field unexpected/);
assert.throws(
  () => validateApprovalProviderResponse(JSON.stringify(response), request, issuedAt + 16 * 60 * 1000),
  /expired/,
);
assert.throws(
  () => buildApprovalProviderRequest(state, "operations", issuedAt + 1000),
  /not the active running stage/,
);
assert.throws(
  () => buildApprovalProviderRequest(state, "application-design", issuedAt + 16 * 60 * 1000),
  /challenge expired/,
);

console.log("Approval request, conversation confirmation, and provider contract tests passed");
