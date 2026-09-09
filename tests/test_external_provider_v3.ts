import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  InMemoryExternalWorkManagementProviderV3,
  validateExternalProviderReceiptV3,
  validateExternalWorkItemV3,
  type ExternalWorkManagementProviderV3,
} from "../core/tools/aidlc-external-provider-v3";

const originalSecret = process.env.AIDLC_TRUST_SECRET;
const originalTrustDirectory = process.env.AIDLC_TRUST_DIR;
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-external-provider-v3-"));
process.env.AIDLC_TRUST_DIR = join(root, "trust");
process.env.AIDLC_TRUST_SECRET = "external-provider-test-secret-at-least-32-bytes";

const workflowId = "workflow-external-provider";
const alice = {
  actor_id: "actor:alice",
  device_id: "device:alice-laptop",
  client_id: "client:alice-session",
};
const bob = {
  actor_id: "actor:bob",
  device_id: "device:bob-desktop",
  client_id: "client:bob-session",
};

try {
  const provider: ExternalWorkManagementProviderV3 = new InMemoryExternalWorkManagementProviderV3(
    "reference-external-provider",
    [
      {
        workflow_id: workflowId,
        external_work_item_id: "WORK-2",
        stage_instance: "module-b@unit:unit-b",
        title: "Implement module B",
      },
      {
        workflow_id: workflowId,
        external_work_item_id: "WORK-1",
        stage_instance: "module-a@unit:unit-a",
        title: "Implement module A",
        assignee_actor_id: alice.actor_id,
      },
    ],
    "2027-02-02T00:00:00.000Z",
  );

  const ready = await provider.listReady({ workflow_id: workflowId });
  assert.deepEqual(ready.map((item) => item.external_work_item_id), ["WORK-1", "WORK-2"]);
  assert.equal(ready[0].assignee_actor_id, alice.actor_id);
  assert.equal(ready[0].provider_version, "1");
  assert.match(ready[0].etag, /^"[a-f0-9]{64}"$/);
  validateExternalWorkItemV3(ready[0]);

  await assert.rejects(
    async () => provider.claim({
      workflow_id: workflowId,
      external_work_item_id: "WORK-1",
      expected_provider_version: ready[0].provider_version,
      expected_etag: ready[0].etag,
      holder: bob,
      lease_ms: 30_000,
      occurred_at: "2027-02-02T00:00:01.000Z",
    }),
    /assigned to actor:alice, not actor:bob/,
  );

  const claimed = await provider.claim({
    workflow_id: workflowId,
    external_work_item_id: "WORK-1",
    expected_provider_version: ready[0].provider_version,
    expected_etag: ready[0].etag,
    holder: alice,
    lease_ms: 30_000,
    occurred_at: "2027-02-02T00:00:01.000Z",
  });
  assert.equal(claimed.item.status, "claimed");
  assert.equal(claimed.item.claimed_by_actor_id, alice.actor_id);
  assert.equal(claimed.item.provider_version, "2");
  assert.equal(claimed.receipt.previous_provider_version, "1");
  assert.equal(claimed.receipt.provider_version, "2");
  assert.equal(claimed.receipt.etag, claimed.item.etag);
  validateExternalProviderReceiptV3(claimed.receipt, true);

  await assert.rejects(
    async () => provider.claim({
      workflow_id: workflowId,
      external_work_item_id: "WORK-1",
      expected_provider_version: ready[0].provider_version,
      expected_etag: ready[0].etag,
      holder: alice,
      lease_ms: 30_000,
      occurred_at: "2027-02-02T00:00:02.000Z",
    }),
    /CAS conflict/,
  );

  const tampered = structuredClone(claimed.receipt);
  tampered.actor_id = bob.actor_id;
  assert.throws(() => validateExternalProviderReceiptV3(tampered, true), /integrity failed/);
  const unknown = { ...claimed.receipt, unexpected: true } as Record<string, unknown>;
  assert.throws(() => validateExternalProviderReceiptV3(unknown, true), /unknown field unexpected/);

  const renewed = await provider.renew({
    receipt: claimed.receipt,
    lease_ms: 45_000,
    occurred_at: "2027-02-02T00:00:03.000Z",
  });
  assert.equal(renewed.item.provider_version, "3");
  assert.notEqual(renewed.item.etag, claimed.item.etag);
  assert.equal(renewed.receipt.operation, "renew");
  await assert.rejects(
    async () => provider.renew({
      receipt: claimed.receipt,
      lease_ms: 45_000,
      occurred_at: "2027-02-02T00:00:04.000Z",
    }),
    /CAS conflict/,
  );

  const transferred = await provider.transfer({
    receipt: renewed.receipt,
    next_holder: bob,
    lease_ms: 30_000,
    occurred_at: "2027-02-02T00:00:05.000Z",
  });
  assert.equal(transferred.item.assignee_actor_id, bob.actor_id);
  assert.equal(transferred.item.claimed_by_device_id, bob.device_id);
  assert.equal(transferred.receipt.operation, "transfer");

  const released = await provider.release({
    receipt: transferred.receipt,
    reason: "Pause execution while retaining long-term assignee",
    occurred_at: "2027-02-02T00:00:06.000Z",
  });
  assert.equal(released.item.status, "ready");
  assert.equal(released.item.assignee_actor_id, bob.actor_id, "assignment must remain separate from execution lease");
  assert.equal(released.item.claimed_by_actor_id, null);
  assert.equal(released.item.lease_expires_at, null);

  const readyAfterRelease = await provider.listReady({ workflow_id: workflowId });
  const work1 = readyAfterRelease.find((item) => item.external_work_item_id === "WORK-1");
  assert.ok(work1);
  await assert.rejects(
    async () => provider.claim({
      workflow_id: workflowId,
      external_work_item_id: work1.external_work_item_id,
      expected_provider_version: work1.provider_version,
      expected_etag: work1.etag,
      holder: alice,
      lease_ms: 30_000,
      occurred_at: "2027-02-02T00:00:07.000Z",
    }),
    /assigned to actor:bob, not actor:alice/,
  );

  const reclaimed = await provider.claim({
    workflow_id: workflowId,
    external_work_item_id: work1.external_work_item_id,
    expected_provider_version: work1.provider_version,
    expected_etag: work1.etag,
    holder: bob,
    lease_ms: 30_000,
    occurred_at: "2027-02-02T00:00:07.000Z",
  });
  const completed = await provider.complete({
    receipt: reclaimed.receipt,
    occurred_at: "2027-02-02T00:00:08.000Z",
  });
  assert.equal(completed.item.status, "completed");
  assert.equal(completed.receipt.operation, "complete");
  assert.equal((await provider.listReady({ workflow_id: workflowId })).some((item) => item.external_work_item_id === "WORK-1"), false);

  console.log("External work management provider contract tests passed");
} finally {
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
  if (originalTrustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalTrustDirectory;
  rmSync(root, { recursive: true, force: true });
}
