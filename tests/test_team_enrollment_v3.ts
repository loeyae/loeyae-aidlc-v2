import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendWorkflowEventV3,
  createInitialWorkflowStateV3,
} from "../core/tools/aidlc-state-v3";
import {
  initializeWorkflowStateV3,
  loadWorkflowStateV3,
  mutateWorkflowStateV3,
} from "../core/tools/aidlc-state-v3-store";
import { teamEnrollmentGate } from "../core/tools/aidlc-team-enrollment-v3";
import {
  deviceSigningKeyId,
  readEnrollment,
} from "../core/tools/aidlc-trust";
import { statePath } from "../core/tools/aidlc-state";

const originalEnvironment = {
  collaboration: process.env.AIDLC_COLLABORATION_V3,
  trustDirectory: process.env.AIDLC_TRUST_DIR,
  trustSecret: process.env.AIDLC_TRUST_SECRET,
};
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-team-enrollment-v3-"));
const project = join(root, "project");
const ownerTrust = join(root, "owner-trust");
const memberTrust = join(root, "member-trust");
mkdirSync(project, { recursive: true });
process.env.AIDLC_COLLABORATION_V3 = "1";
delete process.env.AIDLC_TRUST_SECRET;

function confirmation(request: Record<string, unknown>, phrase: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    kind: "aidlc.team.enrollment.confirmation",
    request_id: request.request_id,
    confirmation_phrase: phrase,
    ...extra,
  });
}

try {
  process.env.AIDLC_TRUST_DIR = ownerTrust;
  const ownerKey = deviceSigningKeyId();
  const initialized = initializeWorkflowStateV3(
    project,
    createInitialWorkflowStateV3("express", "3.0.0", "workflow-team-no-shared-secret", [], "2027-03-01T00:00:00.000Z"),
  );
  assert.equal((initialized.integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.equal((initialized.events[0].integrity as Record<string, unknown>).algorithm, "ed25519");
  assert.equal(readEnrollment(project)?.trust_mode, "device-signature-v1");
  assert.equal(existsSync(join(ownerTrust, "trust.key")), false, "v3 initialization must not create a shared HMAC key");
  const initialBytes = readFileSync(statePath(project));

  process.env.AIDLC_TRUST_DIR = memberTrust;
  const memberKey = deviceSigningKeyId();
  assert.notEqual(memberKey, ownerKey, "each trust root must receive an independent device key");
  const request = teamEnrollmentGate(project) as Record<string, unknown>;
  assert.equal(request.kind, "ask");
  assert.equal(request.ask_type, "team-enrollment-confirmation");
  assert.equal(request.device_key_id, memberKey);
  assert.match(String(request.confirmation_phrase), /^JOIN workflow-team-no-shared- [a-f0-9]{8}$/);
  const stableRequest = teamEnrollmentGate(project) as Record<string, unknown>;
  assert.equal(stableRequest.request_id, request.request_id, "active enrollment request must remain stable during its TTL");

  assert.throws(
    () => teamEnrollmentGate(project, confirmation(request, String(request.confirmation_phrase), { unexpected: true })),
    /unknown field unexpected/,
  );
  assert.throws(
    () => teamEnrollmentGate(project, confirmation(request, `${String(request.confirmation_phrase)} `)),
    /must exactly match/,
  );
  assert.equal(readEnrollment(project), null, "invalid confirmations must not enroll the device");

  assert.equal(teamEnrollmentGate(project, confirmation(request, String(request.confirmation_phrase))), null);
  const memberEnrollment = readEnrollment(project);
  assert.equal(memberEnrollment?.trust_mode, "device-signature-v1");
  assert.equal(memberEnrollment?.device_key_id, memberKey);
  assert.equal(loadWorkflowStateV3(project)?.workflow_id, initialized.workflow_id);
  assert.equal(existsSync(join(memberTrust, "trust.key")), false, "joining must not create or copy a shared HMAC key");

  process.env.AIDLC_TRUST_DIR = ownerTrust;
  const frozen = mutateWorkflowStateV3(project, (state) => appendWorkflowEventV3(state, {
    event_type: "workflow_frozen",
    occurred_at: "2027-03-01T00:01:00.000Z",
    payload: { reason: "cross-device verification" },
  }));
  assert.equal((frozen.integrity as Record<string, unknown>).key_id, ownerKey);
  const frozenBytes = readFileSync(statePath(project));

  process.env.AIDLC_TRUST_DIR = memberTrust;
  const accepted = loadWorkflowStateV3(project);
  assert.equal(accepted?.status, "parked");
  assert.equal(readEnrollment(project)?.event_head_hash, accepted?.event_head.event_hash);

  writeFileSync(statePath(project), initialBytes);
  assert.throws(
    () => loadWorkflowStateV3(project),
    /does not extend the locally enrolled event head|rollback or fork/,
  );
  writeFileSync(statePath(project), frozenBytes);

  const resumed = mutateWorkflowStateV3(project, (state) => appendWorkflowEventV3(state, {
    event_type: "workflow_resumed",
    occurred_at: "2027-03-01T00:02:00.000Z",
    payload: {},
  }));
  assert.equal((resumed.integrity as Record<string, unknown>).key_id, memberKey);

  process.env.AIDLC_TRUST_DIR = ownerTrust;
  const ownerView = loadWorkflowStateV3(project);
  assert.equal(ownerView?.status, "running");
  assert.equal(ownerView?.events.length, 3);
  assert.equal(readEnrollment(project)?.event_head_hash, ownerView?.event_head.event_hash);

  console.log("Conversation-confirmed team enrollment and per-device signing tests passed");
} finally {
  if (originalEnvironment.collaboration === undefined) delete process.env.AIDLC_COLLABORATION_V3;
  else process.env.AIDLC_COLLABORATION_V3 = originalEnvironment.collaboration;
  if (originalEnvironment.trustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalEnvironment.trustDirectory;
  if (originalEnvironment.trustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalEnvironment.trustSecret;
  rmSync(root, { recursive: true, force: true });
}
