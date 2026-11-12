/** P2-01: durable observation checkpoints. Never grants restart or succession. */
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { loadWorkflowState, sessionBinding, withSessionPublication } from "./aidlc-light-state";
import { loadWorkflowParts } from "./aidlc-workflow-layout";
import { sessionRef } from "./aidlc-session";
import { checkCurrentExecutionGrant } from "./aidlc-execution-grant";
import { readIssuedGrant, readRunCheckpoints, storeRunCheckpoint,readRecoveryState } from "./aidlc-grant-store";
import { autonomyDigest as digest, canonicalAutonomyJson as json, safeFile } from "./aidlc-autonomy-files";
import { readSourceRevision } from "./aidlc-revision";
import { nestedSourceRepos } from "./aidlc-nested-repos";

type Row = Record<string, any>;
function fail(reason: string): never { throw Error(`RUN_CHECKPOINT_${reason}`); }
function object(value: unknown, keys: string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail("SCHEMA_INVALID");
  return value as Row;
}
export function checkpointInput(value: unknown): Row {
  const v = object(value, ["schema", "reason", "budget_observation", "pending_operations", "candidate_commit"]);
  if (v.schema !== "aidlc.host-checkpoint-input/v1" || !["binding-change", "before-operation", "operation-dispatched", "result-committed", "candidate-prepared", "context-boundary", "stopping"].includes(v.reason)) fail("SCHEMA_INVALID");
  const budget = object(v.budget_observation, ["steps", "turns", "active_elapsed_ms"]);
  if (["steps", "turns", "active_elapsed_ms"].some(k => !Number.isSafeInteger(budget[k]) || budget[k] < 0)) fail("BUDGET_INVALID");
  if (!Array.isArray(v.pending_operations) || v.pending_operations.length > 512) fail("OPERATIONS_INVALID");
  const ids = new Set<string>();
  for (const item of v.pending_operations) {
    const op = object(item, ["operation_id", "status", "binding_digest"]);
    if (typeof op.operation_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(op.operation_id) || ids.has(op.operation_id)
      || !["prepared", "dispatched", "unknown"].includes(op.status) || !/^[a-f0-9]{64}$/.test(op.binding_digest)) fail("OPERATIONS_INVALID");
    ids.add(op.operation_id);
  }
  if (v.candidate_commit !== undefined && !/^[a-f0-9]{40,64}$/.test(v.candidate_commit)) fail("CANDIDATE_INVALID");
  return v;
}
function projection(head?: Row): Row {
  return { enabled: Boolean(head), head_digest: head ? digest(head) : "absent", checkpoint: head || null,
    requires_operation_reconciliation: Boolean(head?.host_observation.pending_operations.length),
    budget_is_observation_only: true, recovery_allowed: false, execution_authorized: false };
}
export function inspectRun(root: string): Row {
  const global = loadWorkflowState(root);
  const state=global?.execution_grant_ref?readRecoveryState(root,global):undefined;
  return {...projection(global?.execution_grant_ref ? readRunCheckpoints(root, global).at(-1) : undefined),...(state?{durable_execution:{schema:'aidlc.durable-run-projection/v1',run_id:state.run_id,attempt_id:state.attempt_id,generation:state.generation,restarts:state.restarts,status:state.status,revision:state.revision,...(state.outer_worker?{worker:{status:state.outer_worker.status,replacements:state.outer_worker.replacements,epoch:state.outer_worker.epoch,pending_resources:Object.values(state.outer_worker.resources as Row).filter((r:any)=>r.status!=='closed').length}}:{}),steps:state.supervisor?.steps||0,turns:state.supervisor?.turns||0,pending_operations:Object.values(state.operations as Row).filter((op:any)=>['reserved','unknown'].includes(op.status)).length,execution_authorized:false,recovery_allowed:false}}:{})};
}
export function captureRunCheckpoint(root: string, value: unknown, expected: string): Row {
  const input = checkpointInput(value);
  if (expected !== "absent" && !/^[a-f0-9]{64}$/.test(expected)) fail("EXPECTED_REQUIRED");
  checkCurrentExecutionGrant(root, ["workflow-write"]);
  const binding = sessionBinding(), global = loadWorkflowState(root);
  if (!binding || !global?.execution_grant_ref || global.autonomy_contract_version !== "1") fail("MANAGED_GRANT_REQUIRED");
  return withSessionPublication(root, sessionRef(root, binding.stage_instance), binding.stage_instance, () => {
    checkCurrentExecutionGrant(root, ["workflow-write"]);
    const current = loadWorkflowState(root)!, grant = readIssuedGrant(root, current.execution_grant_ref!).grant;
    const history = readRunCheckpoints(root, current), prior = history.at(-1) as Row | undefined;
    if ((prior ? digest(prior) : "absent") !== expected) fail("CONFLICT");
    const now = Date.now(), deadline = Math.min(Date.parse(grant.expires_at), Date.parse(grant.request_started_at) + grant.resource_limits.wall_time_seconds * 1000);
    if (now >= deadline || now < Date.parse(grant.request_started_at) || prior && now < Date.parse(prior.recorded_at)) fail("CLOCK_OR_DEADLINE_INVALID");
    if (input.budget_observation.active_elapsed_ms > grant.resource_limits.wall_time_seconds * 1000) fail("BUDGET_INVALID");
    if (prior) {
      if (prior.attempt.session_id !== binding.session_id || prior.attempt.owner !== binding.owner || json(prior.host_ref) !== json(grant.executor_constraints.host)) fail("SUCCESSOR_NOT_IMPLEMENTED");
      for (const k of ["steps", "turns", "active_elapsed_ms"]) if (input.budget_observation[k] < prior.host_observation.budget_observation[k]) fail("BUDGET_REGRESSION");
      for (const op of prior.host_observation.pending_operations) {
        const next = input.pending_operations.find((r: Row) => r.operation_id === op.operation_id);
        const allowed: Record<string, string[]> = { prepared: ["prepared", "dispatched", "unknown"], dispatched: ["dispatched", "unknown"], unknown: ["unknown"] };
        if (!next || next.binding_digest !== op.binding_digest || !allowed[op.status].includes(next.status)) fail("OPERATION_RECONCILIATION_REQUIRED");
      }
    }
    const source = readSourceRevision(root, undefined, nestedSourceRepos(root));
    if (input.candidate_commit !== undefined && input.candidate_commit !== source.commit) fail("CANDIDATE_CHANGED");
    const states = [...loadWorkflowParts(root).parts.values()].filter(part => grant.workflow_refs.some(ref => ref.workflow_id === part.state.workflow_id))
      .map(part => ({ workflow_id: part.state.workflow_id, revision: part.state.revision, stage_instance: part.state.current_stage_instance || null, status: part.state.status }));
    const body = { schema: "aidlc.run-checkpoint/v1", project: realpathSync(root), run_id: grant.run_id,
      grant_ref: current.execution_grant_ref, batch_ref: current.autonomy_batch, host_ref: grant.executor_constraints.host,
      sequence: history.length + 1, previous_digest: prior ? digest(prior) : null, recorded_at: new Date(now).toISOString(), deadline_at: new Date(deadline).toISOString(),
      attempt: prior?.attempt || { attempt_id: randomUUID(), session_id: binding.session_id, owner: binding.owner, observed_started_at: new Date(now).toISOString() },
      claim_ref: { workflow_id: binding.workflow_id, stage_instance: binding.stage_instance, binding_digest: digest(binding) },
      state_refs: states, source_revision: source, host_observation: input, successor_policy: grant.successor_policy,
      recovery_allowed: false, execution_authorized: false };
    return projection(storeRunCheckpoint(root, current, body, expected));
  }, binding, "workflow-write");
}
export function autonomyRunDirective(root: string, args: string[]): Row {
  let result: Row;
  if (args.length === 1 && args[0] === "inspect") result = inspectRun(root);
  else if (args[0] === "checkpoint" && args.length === 5) {
    const options = new Map<string, string>();
    for (let i = 1; i < args.length; i += 2) {
      if (!["--input", "--expect"].includes(args[i]) || options.has(args[i])) fail("ARGUMENTS_INVALID");
      options.set(args[i], args[i + 1]);
    }
    if (!options.has("--input") || !options.has("--expect")) fail("ARGUMENTS_INVALID");
    const file = safeFile(root, options.get("--input")!);
    if (lstatSync(file).size > 128 * 1024) fail("INPUT_LIMIT");
    result = captureRunCheckpoint(root, JSON.parse(readFileSync(file, "utf8")), options.get("--expect")!);
  } else fail("ARGUMENTS_INVALID");
  return { kind: "print", autonomy_run: result };
}
