import { appendAuditEvent, assertSessionClaim, loadWorkflowState, saveWorkflowState } from "./aidlc-light-state";
import { sessionRef } from "./aidlc-session";

/** Retire only the named execution checkpoint. No real stage is marked complete,
 * no evidence/approval is manufactured and no sibling workflow is rewritten. */
export function retireExecutionCheckpoint(root: string, instance: string, humanRef: string, dryRun = false) {
  if (!/^subagent-execution@module:[a-z0-9][a-z0-9-]*@unit:[a-z0-9][a-z0-9-]*$/.test(instance))
    throw new Error("retirement requires one exact historical subagent-execution instance");
  if (!humanRef.trim()) throw new Error("retirement requires an explicit human instruction reference");
  const ref = sessionRef(root, instance);
  const state = loadWorkflowState(root, ref);
  if (!state) throw new Error("target workflow does not exist");
  const legacyCurrent = !state.current_stage_instance && state.current_stage === "subagent-execution"
    && state.current_module === /@module:([^@]+)/.exec(instance)?.[1] && (state.current_unit || "default") === instance.split("@unit:")[1];
  const known = legacyCurrent || state.current_stage_instance === instance || Boolean(state.active_instances[instance])
    || state.completed_stage_instances.includes(instance) || state.skipped_stage_instances.includes(instance)
    || state.history.some(row => row.instance_id === instance);
  if (!known) throw new Error("target has no historical execution checkpoint");
  const result = { kind: "print" as const, instance, dry_run: dryRun,
    message: "Execution checkpoint retired; historical evidence, logs and approvals preserved. Use next --preview, bind its exact target, then next/report to recheck real dependencies and quality gates. Parked workflows still require --resume." };
  if (dryRun) return result;
  assertSessionClaim(root, state, instance);
  if (legacyCurrent || state.current_stage_instance === instance) {
    delete state.current_stage_instance;
    state.current_stage = "";
  }
  delete state.active_instances[instance];
  state.history.push({ stage: "subagent-execution", instance_id: instance, result: "execution_retired",
    timestamp: new Date().toISOString(), user_input: humanRef });
  saveWorkflowState(root, state, ref, { afterCommit: () => appendAuditEvent(root, ref, "EXECUTION_CHECKPOINT_RETIRED", {
    Instance: instance, "Human Instruction": humanRef, "Quality Gates": "unchanged; dependencies rechecked by next/report",
  }) });
  return result;
}
