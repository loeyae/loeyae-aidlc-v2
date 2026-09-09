import type { ExecutionAxis } from "./aidlc-execution-context";
import {
  assertClaimReceiptForStateV3,
  type ClaimReceiptV3,
} from "./aidlc-coordination-local-v3";
import {
  appendWorkflowEventV3,
  assertCollaborationV3Enabled,
  validateWorkflowStateV3,
  type WorkflowEventTypeV3,
  type WorkflowInstanceV3,
  type WorkflowStateV3,
} from "./aidlc-state-v3";

export interface WorkflowInstancePlanV3 {
  stage_instance: string;
  stage: string;
  axis: ExecutionAxis;
  module_id?: string;
  unit_id?: string;
  requires: string[];
  order: number;
  condition_met?: boolean;
}

export interface WorkflowSynchronizationOptionsV3 {
  registration?: "all" | "ready-frontier";
}

export interface ReadyInstanceV3 {
  stage_instance: string;
  stage: string;
  axis: ExecutionAxis;
  module_id?: string;
  unit_id?: string;
  order: number;
}

export interface TargetedNextV3 {
  ready: ReadyInstanceV3[];
  selected: ReadyInstanceV3;
  client_focus: string;
}

export type TargetedReportResultV3 = "completed" | "approved" | "rejected";

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function validatePlan(plans: readonly WorkflowInstancePlanV3[]): WorkflowInstancePlanV3[] {
  if (plans.length === 0) throw new Error("workflow instance plan must not be empty");
  const byId = new Map<string, WorkflowInstancePlanV3>();
  for (const [index, plan] of plans.entries()) {
    const id = nonEmpty(plan.stage_instance, `plans[${index}].stage_instance`);
    if (byId.has(id)) throw new Error(`duplicate stage instance in plan: ${id}`);
    if (!Number.isInteger(plan.order) || plan.order < 0) throw new Error(`plan order must be a non-negative integer for ${id}`);
    if (plan.axis !== "project" && plan.axis !== "module" && plan.axis !== "unit") throw new Error(`invalid axis for ${id}`);
    if (!Array.isArray(plan.requires) || !plan.requires.every((dependency) => typeof dependency === "string" && dependency.length > 0)) {
      throw new Error(`requires must contain non-empty stage instance IDs for ${id}`);
    }
    if (new Set(plan.requires).size !== plan.requires.length) throw new Error(`duplicate dependency for ${id}`);
    if (plan.requires.includes(id)) throw new Error(`stage instance cannot depend on itself: ${id}`);
    byId.set(id, {
      ...plan,
      stage_instance: id,
      stage: nonEmpty(plan.stage, `plans[${index}].stage`),
      requires: [...plan.requires],
    });
  }
  for (const plan of byId.values()) {
    for (const dependency of plan.requires) {
      if (!byId.has(dependency)) throw new Error(`unknown dependency ${dependency} required by ${plan.stage_instance}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`workflow instance plan contains a dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)!.requires) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  return [...byId.values()].sort((left, right) => left.order - right.order || left.stage_instance.localeCompare(right.stage_instance));
}

function resolved(instance: WorkflowInstanceV3 | undefined): boolean {
  return instance?.status === "completed" || instance?.status === "skipped";
}

function dependenciesResolved(state: WorkflowStateV3, plan: WorkflowInstancePlanV3): boolean {
  return plan.requires.every((dependency) => resolved(state.instances[dependency]));
}

function append(
  state: WorkflowStateV3,
  eventType: WorkflowEventTypeV3,
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

function planMap(plans: readonly WorkflowInstancePlanV3[]): Map<string, WorkflowInstancePlanV3> {
  return new Map(validatePlan(plans).map((plan) => [plan.stage_instance, plan]));
}

export function synchronizeWorkflowInstancesV3(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
  occurredAt = new Date().toISOString(),
  options: WorkflowSynchronizationOptionsV3 = {},
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  let state = validateWorkflowStateV3(stateValue, true);
  const ordered = validatePlan(plans);

  for (const plan of ordered) {
    const existing = state.instances[plan.stage_instance];
    if (existing) {
      if (
        existing.stage !== plan.stage
        || existing.axis !== plan.axis
        || existing.module_id !== plan.module_id
        || existing.unit_id !== plan.unit_id
        || JSON.stringify(existing.requires) !== JSON.stringify(plan.requires)
      ) {
        throw new Error(`registered instance no longer matches immutable plan: ${plan.stage_instance}`);
      }
      continue;
    }
    if (options.registration === "ready-frontier" && !dependenciesResolved(state, plan)) continue;
    state = append(state, "instance_registered", plan.stage_instance, occurredAt, {
      stage: plan.stage,
      axis: plan.axis,
      module_id: plan.module_id,
      unit_id: plan.unit_id,
      requires: [...plan.requires],
      initial_status: dependenciesResolved(state, plan) ? "ready" : "blocked",
    });
    if (plan.condition_met === false) {
      state = append(state, "instance_skipped", plan.stage_instance, occurredAt, {
        reason: "Deterministic stage condition evaluated to false",
        source: "condition",
      });
    }
  }

  return reconcileReadyInstancesV3(state, ordered, occurredAt);
}

export function reconcileReadyInstancesV3(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  let state = validateWorkflowStateV3(stateValue, true);
  const ordered = validatePlan(plans);
  let changed = true;
  while (changed) {
    changed = false;
    for (const plan of ordered) {
      const instance = state.instances[plan.stage_instance];
      if (!instance || instance.status !== "blocked" || plan.condition_met === false) continue;
      if (!dependenciesResolved(state, plan)) continue;
      state = append(state, "instance_ready", plan.stage_instance, occurredAt, {
        reason: "All declared stage instance dependencies are resolved",
      });
      changed = true;
    }
  }
  return state;
}

export function findReadyInstances(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
): ReadyInstanceV3[] {
  const state = validateWorkflowStateV3(stateValue, true);
  const ordered = validatePlan(plans);
  return ordered
    .filter((plan) => state.instances[plan.stage_instance]?.status === "ready" && dependenciesResolved(state, plan))
    .map((plan) => ({
      stage_instance: plan.stage_instance,
      stage: plan.stage,
      axis: plan.axis,
      ...(plan.module_id ? { module_id: plan.module_id } : {}),
      ...(plan.unit_id ? { unit_id: plan.unit_id } : {}),
      order: plan.order,
    }));
}

export function nextReadyInstanceV3(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
  requestedInstance?: string,
): TargetedNextV3 {
  assertCollaborationV3Enabled();
  const state = validateWorkflowStateV3(stateValue, true);
  const ready = findReadyInstances(state, plans);
  if (ready.length === 0) throw new Error("no ready stage instances are available");
  const selected = requestedInstance
    ? ready.find((instance) => instance.stage_instance === requestedInstance)
    : ready[0];
  if (!selected) {
    const requested = nonEmpty(requestedInstance, "requested stage instance");
    const status = state.instances[requested]?.status || "unknown";
    throw new Error(`requested stage instance is not ready: ${requested} (${status})`);
  }
  return {
    ready,
    selected,
    client_focus: selected.stage_instance,
  };
}

export function submitInstanceV3(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
  stageInstance: string,
  receipt: ClaimReceiptV3,
  occurredAt = new Date().toISOString(),
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  const state = validateWorkflowStateV3(stateValue, true);
  const planned = planMap(plans).get(nonEmpty(stageInstance, "stage_instance"));
  if (!planned) throw new Error(`stage instance is not in the workflow plan: ${stageInstance}`);
  assertClaimReceiptForStateV3(state, receipt, stageInstance, Date.parse(occurredAt));
  if (state.instances[stageInstance]?.status !== "in_progress") {
    throw new Error(`stage instance must be in_progress before submission: ${stageInstance}`);
  }
  return append(state, "instance_submitted", stageInstance, occurredAt, {});
}

export function reportInstanceV3(
  stateValue: WorkflowStateV3,
  plans: readonly WorkflowInstancePlanV3[],
  stageInstance: string,
  receipt: ClaimReceiptV3,
  result: TargetedReportResultV3,
  occurredAt = new Date().toISOString(),
  userInput?: string,
): WorkflowStateV3 {
  assertCollaborationV3Enabled();
  const state = validateWorkflowStateV3(stateValue, true);
  const planned = planMap(plans).get(nonEmpty(stageInstance, "stage_instance"));
  if (!planned) throw new Error(`stage instance is not in the workflow plan: ${stageInstance}`);
  assertClaimReceiptForStateV3(state, receipt, stageInstance, Date.parse(occurredAt));
  if (state.instances[stageInstance]?.status !== "submitted") {
    throw new Error(`targeted report requires a submitted stage instance: ${stageInstance}`);
  }
  let next: WorkflowStateV3;
  if (result === "rejected") {
    next = append(state, "instance_rejected", stageInstance, occurredAt, { reason: userInput || "Stage result rejected" });
  } else {
    next = append(state, "instance_completed", stageInstance, occurredAt, {
      result,
      ...(userInput ? { user_input: userInput } : {}),
    });
  }
  return reconcileReadyInstancesV3(next, plans, occurredAt);
}
