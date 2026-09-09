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
  assert.equal(collaborationV3Enabled(), false);
  assert.equal(createInitialState("express").schema_version, 2, "v2 remains the default state schema");
  assert.throws(
    () => createInitialWorkflowStateV3("express"),
    /AIDLC_COLLABORATION_V3=1 is required/,
  );

  process.env.AIDLC_COLLABORATION_V3 = "1";
  const { state: source } = fixture("migration-success", "workflow-v3-migration-success");
  const sourceCanonical = canonicalPayload(source);
  const migrated = migrateWorkflowStateV2ToV3(source, {
    identity: migrationIdentity,
    occurred_at: migrationTime,
  });

  assert.equal(migrated.schema_version, 3);
  assert.equal(migrated.routing_model, "collaboration-v3");
  assert.equal(migrated.workflow_id, source.workflow_id);
  assert.equal(migrated.revision, source.revision + 1);
  assert.deepEqual(migrated.completed_stage_instances, source.completed_stage_instances);
  assert.deepEqual(migrated.skipped_stage_instances, source.skipped_stage_instances);
  assert.deepEqual(migrated.history, source.history);
  assert.equal(migrated.event_head.sequence, migrated.events.length);
  assert.equal(migrated.instances["workspace-detection"].status, "completed");
  const active = migrated.instances["application-design@module:module-a"];
  assert.equal(active.status, "in_progress");
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
    "2.4.0",
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
  });
  assert.equal(JSON.parse(readFileSync(statePath(interrupted.project), "utf8")).schema_version, 3);
  assert.equal(validateWorkflowStateV3(fileMigrated, true).workflow_id, interrupted.state.workflow_id);
  assert.equal(readEnrollment(interrupted.project)?.workflow_id, interrupted.state.workflow_id);

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
