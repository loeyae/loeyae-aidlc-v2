import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendWorkflowEventV3,
  collaborationV3Enabled,
  createInitialWorkflowStateV3,
  migrateWorkflowStateFileV2ToV3,
  migrateWorkflowStateV2ToV3,
  projectMigratedWorkflowV3ToV2,
  repairWorkflowStateFileV3Migration,
  validateWorkflowStateV3,
  type WorkflowStateV3,
} from "../core/tools/aidlc-state-v3";
import {
  createInitialState,
  loadWorkflowState,
  saveWorkflowState,
  statePath,
  type WorkflowState,
} from "../core/tools/aidlc-state";
import { canonicalPayload, readEnrollment, signRecord } from "../core/tools/aidlc-trust";

const originalEnvironment = {
  trustDirectory: process.env.AIDLC_TRUST_DIR,
  trustSecret: process.env.AIDLC_TRUST_SECRET,
  collaboration: process.env.AIDLC_COLLABORATION_V3,
  failpoint: process.env.AIDLC_V3_MIGRATION_FAILPOINT,
};
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-state-v3-"));
process.env.AIDLC_TRUST_DIR = join(root, "default-trust");
process.env.AIDLC_TRUST_SECRET = "state-v3-contract-test-secret-at-least-32-bytes";
process.env.AIDLC_COLLABORATION_V3 = "1";

const migrationIdentity = {
  actor_id: "actor:test-human",
  device_id: "device:test-mac",
  client_id: "client:test-session",
};
const migrationTime = "2026-10-10T10:10:10.000Z";

function fixture(projectName: string, workflowId: string): { project: string; state: WorkflowState } {
  const project = join(root, projectName);
  mkdirSync(project, { recursive: true });
  process.env.AIDLC_TRUST_DIR = join(root, `${projectName}-trust`);
  const state = createInitialState("feature", "2.4.0", workflowId);
  state.current_phase = "inception";
  state.current_stage = "application-design";
  state.current_stage_instance = "application-design@module:module-a";
  state.current_module = "module-a";
  state.completed_stages.push("workspace-detection");
  state.completed_stage_instances!.push("workspace-detection");
  state.history.push({
    stage: "workspace-detection",
    instance_id: "workspace-detection",
    result: "completed",
    timestamp: "2026-10-09T09:00:00.000Z",
    user_input: "single-module",
  });
  state.approval_challenges[state.current_stage_instance] = "1791627000000.v3-migration-challenge";
  saveWorkflowState(project, state);
  const loaded = loadWorkflowState(project);
  assert.ok(loaded);
  return { project, state: loaded };
}

function resignState(value: WorkflowStateV3): WorkflowStateV3 {
  const unsigned = { ...value } as unknown as Record<string, unknown>;
  delete unsigned.integrity;
  return {
    ...value,
    integrity: signRecord(unsigned, true) as unknown as Record<string, unknown>,
  };
}

try {
  delete process.env.AIDLC_COLLABORATION_V3;
  assert.equal(collaborationV3Enabled(), true, "schema v3 is the 3.0 default");
  const defaultV3 = createInitialWorkflowStateV3("express");
  assert.equal(defaultV3.schema_version, 3);
  assert.equal(defaultV3.integrity?.algorithm, "ed25519");
  assert.ok(defaultV3.events.length > 0);
  assert.ok(defaultV3.events.every((event) => event.integrity?.algorithm === "ed25519"));
  assert.equal(createInitialState("express").schema_version, 2, "the explicit v2 compatibility constructor remains available");
  process.env.AIDLC_COLLABORATION_V3 = "0";
  assert.equal(collaborationV3Enabled(), false);
  assert.throws(
    () => createInitialWorkflowStateV3("express"),
    /explicitly disables collaborative state v3/,
  );

  process.env.AIDLC_COLLABORATION_V3 = "1";
  const { state: source } = fixture("migration-success", "workflow-v3-migration-success");
  const sourceCanonical = canonicalPayload(source);
  const migrationRequires = {
    "workspace-detection": [],
    "application-design@module:module-a": ["workspace-detection"],
  };
  const migrated = migrateWorkflowStateV2ToV3(source, {
    identity: migrationIdentity,
    occurred_at: migrationTime,
    instance_requires: migrationRequires,
  });

  assert.equal(migrated.schema_version, 3);
  assert.equal(migrated.routing_model, "collaboration-v3");
  assert.equal(migrated.workflow_id, source.workflow_id);
  assert.equal(migrated.revision, source.revision + 1);
  assert.deepEqual(migrated.completed_stage_instances, source.completed_stage_instances);
  assert.deepEqual(migrated.skipped_stage_instances, source.skipped_stage_instances);
  assert.deepEqual(migrated.history, source.history);
  assert.equal(migrated.event_head.sequence, migrated.events.length);
  assert.equal(migrated.integrity?.algorithm, "ed25519");
  assert.ok(migrated.events.every((event) => event.integrity?.algorithm === "ed25519"));
  assert.equal(migrated.instances["workspace-detection"].status, "completed");
  const active = migrated.instances["application-design@module:module-a"];
  assert.equal(active.status, "in_progress");
  assert.deepEqual(active.requires, ["workspace-detection"]);
  assert.equal(active.claim?.actor_id, migrationIdentity.actor_id);
  assert.equal(active.claim?.device_id, migrationIdentity.device_id);
  assert.equal(active.claim?.client_id, migrationIdentity.client_id);
  assert.equal(active.claim?.compatibility_lock, true);
  assert.equal(active.claim?.lease_expires_at, null);
  assert.equal(active.approval?.challenge, source.approval_challenges[source.current_stage_instance!]);
  assert.equal(canonicalPayload(projectMigratedWorkflowV3ToV2(migrated)), sourceCanonical);
  validateWorkflowStateV3(migrated, true);

  assert.throws(
    () => migrateWorkflowStateV2ToV3(source, { occurred_at: migrationTime }),
    /requires explicit actor_id, device_id, and client_id/,
  );

  const tamperedEvent = structuredClone(migrated);
  tamperedEvent.events[1].payload.stage = "tampered-stage";
  assert.throws(
    () => validateWorkflowStateV3(resignState(tamperedEvent), true),
    /workflow event integrity failed/,
  );

  const tamperedProjection = structuredClone(migrated);
  tamperedProjection.instances["workspace-detection"].status = "ready";
  assert.throws(
    () => validateWorkflowStateV3(resignState(tamperedProjection), true),
    /projection does not match its signed event stream/,
  );

  const brokenSequence = structuredClone(migrated);
  brokenSequence.events.splice(1, 1);
  assert.throws(
    () => validateWorkflowStateV3(resignState(brokenSequence), true),
    /sequence gap|hash chain is broken/,
  );

  const initial = createInitialWorkflowStateV3(
    "express",
    "3.0.0",
    "workflow-v3-illegal-transition",
    [],
    "2026-10-10T11:00:00.000Z",
  );
  const registered = appendWorkflowEventV3(initial, {
    event_type: "instance_registered",
    stage_instance: "requirements-analysis",
    occurred_at: "2026-10-10T11:00:01.000Z",
    payload: {
      stage: "requirements-analysis",
      axis: "project",
      module_id: undefined,
      unit_id: undefined,
      requires: [],
      initial_status: "blocked",
    },
  });
  assert.throws(
    () => appendWorkflowEventV3(registered, {
      event_type: "instance_completed",
      stage_instance: "requirements-analysis",
      occurred_at: "2026-10-10T11:00:02.000Z",
      payload: { result: "completed" },
    }),
    /illegal instance_completed transition/,
  );

  const frozen = appendWorkflowEventV3(initial, {
    event_type: "workflow_frozen",
    occurred_at: "2026-10-10T11:01:00.000Z",
    payload: { reason: "Explicit integration freeze" },
  });
  assert.equal(frozen.status, "parked");
  const resumed = appendWorkflowEventV3(frozen, {
    event_type: "workflow_resumed",
    occurred_at: "2026-10-10T11:02:00.000Z",
    payload: {},
  });
  assert.equal(resumed.status, "running");
  const unresolved = appendWorkflowEventV3(resumed, {
    event_type: "instance_registered",
    stage_instance: "freeze-contract-stage",
    occurred_at: "2026-10-10T11:03:00.000Z",
    payload: {
      stage: "freeze-contract-stage",
      axis: "project",
      requires: [],
      initial_status: "blocked",
    },
  });
  assert.throws(
    () => appendWorkflowEventV3(unresolved, {
      event_type: "workflow_completed",
      occurred_at: "2026-10-10T11:04:00.000Z",
      payload: {},
    }),
    /every registered instance to be resolved/,
  );
  const resolved = appendWorkflowEventV3(unresolved, {
    event_type: "instance_skipped",
    stage_instance: "freeze-contract-stage",
    occurred_at: "2026-10-10T11:05:00.000Z",
    payload: { reason: "condition=false", source: "condition" },
  });
  const completedWorkflow = appendWorkflowEventV3(resolved, {
    event_type: "workflow_completed",
    occurred_at: "2026-10-10T11:06:00.000Z",
    payload: {},
  });
  assert.equal(completedWorkflow.status, "done");
  assert.throws(
    () => appendWorkflowEventV3(completedWorkflow, {
      event_type: "workflow_resumed",
      occurred_at: "2026-10-10T11:07:00.000Z",
      payload: {},
    }),
    /workflow_resumed requires parked status/,
  );

  const interrupted = fixture("migration-interrupted", "workflow-v3-migration-interrupted");
  const before = readFileSync(statePath(interrupted.project));
  process.env.AIDLC_V3_MIGRATION_FAILPOINT = "before-rename";
  assert.throws(
    () => migrateWorkflowStateFileV2ToV3(interrupted.project, {
      identity: migrationIdentity,
      occurred_at: migrationTime,
    }),
    /failpoint before-rename/,
  );
  assert.ok(readFileSync(statePath(interrupted.project)).equals(before), "failed migration must leave original state bytes unchanged");
  assert.equal(loadWorkflowState(interrupted.project)?.schema_version, 2);

  delete process.env.AIDLC_V3_MIGRATION_FAILPOINT;
  const fileMigrated = migrateWorkflowStateFileV2ToV3(interrupted.project, {
    identity: migrationIdentity,
    occurred_at: migrationTime,
    instance_requires: migrationRequires,
  });
  const persisted = JSON.parse(readFileSync(statePath(interrupted.project), "utf8")) as WorkflowStateV3;
  assert.equal(persisted.schema_version, 3);
  assert.equal(persisted.integrity?.algorithm, "ed25519");
  assert.ok(persisted.events.every((event) => event.integrity?.algorithm === "ed25519"));
  assert.equal(validateWorkflowStateV3(fileMigrated, true).workflow_id, interrupted.state.workflow_id);
  const enrollment = readEnrollment(interrupted.project);
  assert.equal(enrollment?.workflow_id, interrupted.state.workflow_id);
  assert.equal(enrollment?.trust_mode, "device-signature-v1");
  assert.equal(enrollment?.event_head_hash, fileMigrated.event_head.event_hash);
  assert.equal(enrollment?.device_key_id, persisted.integrity?.key_id);

  const repaired = repairWorkflowStateFileV3Migration(interrupted.project, {
    identity: migrationIdentity,
    occurred_at: migrationTime,
    instance_requires: migrationRequires,
  });
  assert.equal(repaired.schema_version, 3);
  assert.equal(repaired.instances["application-design@module:module-a"].requires?.[0], "workspace-detection");
  assert.equal(validateWorkflowStateV3(repaired, true).workflow_id, interrupted.state.workflow_id);

  console.log("State v3 reducer and migration tests passed");
} finally {
  if (originalEnvironment.trustDirectory === undefined) delete process.env.AIDLC_TRUST_DIR;
  else process.env.AIDLC_TRUST_DIR = originalEnvironment.trustDirectory;
  if (originalEnvironment.trustSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalEnvironment.trustSecret;
  if (originalEnvironment.collaboration === undefined) delete process.env.AIDLC_COLLABORATION_V3;
  else process.env.AIDLC_COLLABORATION_V3 = originalEnvironment.collaboration;
  if (originalEnvironment.failpoint === undefined) delete process.env.AIDLC_V3_MIGRATION_FAILPOINT;
  else process.env.AIDLC_V3_MIGRATION_FAILPOINT = originalEnvironment.failpoint;
  rmSync(root, { recursive: true, force: true });
}
