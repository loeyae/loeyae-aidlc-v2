import assert from "node:assert/strict";
import { createHash } from "crypto";
import {
  findReadyInstances,
  nextReadyInstanceV3,
  reportInstanceV3,
  submitInstanceV3,
  synchronizeWorkflowInstancesV3,
  type WorkflowInstancePlanV3,
} from "../core/tools/aidlc-scheduler-v3";
import {
  appendWorkflowEventV3,
  createInitialWorkflowStateV3,
  type WorkflowStateV3,
} from "../core/tools/aidlc-state-v3";

const originalFlag = process.env.AIDLC_COLLABORATION_V3;
const originalSecret = process.env.AIDLC_TRUST_SECRET;
process.env.AIDLC_COLLABORATION_V3 = "1";
process.env.AIDLC_TRUST_SECRET = "scheduler-v3-test-secret-at-least-32-bytes";

const plans: WorkflowInstancePlanV3[] = [
  {
    stage_instance: "workspace-detection",
    stage: "workspace-detection",
    axis: "project",
    requires: [],
    order: 0,
  },
  {
    stage_instance: "application-design@module:module-a",
    stage: "application-design",
    axis: "module",
    module_id: "module-a",
    requires: ["workspace-detection"],
    order: 10,
  },
  {
    stage_instance: "application-design@module:module-b",
    stage: "application-design",
    axis: "module",
    module_id: "module-b",
    requires: ["workspace-detection"],
    order: 11,
  },
  {
    stage_instance: "code-generation@module:module-a@unit:unit-a",
    stage: "code-generation",
    axis: "unit",
    module_id: "module-a",
    unit_id: "unit-a",
    requires: ["application-design@module:module-a"],
    order: 20,
  },
  {
    stage_instance: "code-generation@module:module-b@unit:unit-b",
    stage: "code-generation",
    axis: "unit",
    module_id: "module-b",
    unit_id: "unit-b",
    requires: ["application-design@module:module-b"],
    order: 21,
  },
  {
    stage_instance: "implementation-report",
    stage: "implementation-report",
    axis: "project",
    requires: [
      "code-generation@module:module-a@unit:unit-a",
      "code-generation@module:module-b@unit:unit-b",
    ],
    order: 30,
  },
];

let clock = Date.parse("2026-11-11T00:00:00.000Z");
function timestamp(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

function begin(state: WorkflowStateV3, stageInstance: string): WorkflowStateV3 {
  const claimedAt = timestamp();
  const receipt = createHash("sha256").update(`scheduler-test\n${stageInstance}\n${claimedAt}`).digest("hex");
  let next = appendWorkflowEventV3(state, {
    event_type: "instance_claimed",
    stage_instance: stageInstance,
    occurred_at: claimedAt,
    payload: {
      claim: {
        claim_id: `claim-${receipt.slice(0, 20)}`,
        actor_id: "actor:scheduler-test",
        device_id: "device:scheduler-test",
        client_id: `client:${stageInstance}`,
        provider_id: "test-local-provider",
        provider_receipt_digest: receipt,
        claimed_at: claimedAt,
        renewed_at: claimedAt,
        lease_expires_at: new Date(clock + 60_000).toISOString(),
      },
    },
  });
  next = appendWorkflowEventV3(next, {
    event_type: "instance_started",
    stage_instance: stageInstance,
    occurred_at: timestamp(),
    payload: {},
  });
  return next;
}

function complete(state: WorkflowStateV3, stageInstance: string): WorkflowStateV3 {
  let next = begin(state, stageInstance);
  next = submitInstanceV3(next, plans, stageInstance, timestamp());
  return reportInstanceV3(next, plans, stageInstance, "completed", timestamp());
}

try {
  let state = createInitialWorkflowStateV3(
    "feature",
    "2.4.0",
    "workflow-scheduler-v3",
    [],
    new Date(clock).toISOString(),
  );
  state = synchronizeWorkflowInstancesV3(state, plans, timestamp());

  assert.deepEqual(findReadyInstances(state, plans).map((item) => item.stage_instance), ["workspace-detection"]);
  assert.equal(state.instances["implementation-report"].status, "blocked");

  state = complete(state, "workspace-detection");
  assert.deepEqual(
    findReadyInstances(state, plans).map((item) => item.stage_instance),
    ["application-design@module:module-a", "application-design@module:module-b"],
    "independent module instances must be ready in deterministic plan order",
  );

  const targeted = nextReadyInstanceV3(state, plans, "application-design@module:module-b");
  assert.equal(targeted.selected.stage_instance, "application-design@module:module-b");
  assert.equal(targeted.client_focus, targeted.selected.stage_instance);
  assert.equal(state.current_stage_instance, undefined, "client focus must not become a global workflow cursor");
  assert.equal(targeted.ready.length, 2);

  assert.throws(
    () => nextReadyInstanceV3(state, plans, "implementation-report"),
    /requested stage instance is not ready/,
  );
  assert.throws(
    () => reportInstanceV3(state, plans, "application-design@module:module-a", "completed", timestamp()),
    /requires a submitted stage instance/,
  );

  state = complete(state, "application-design@module:module-b");
  assert.deepEqual(
    findReadyInstances(state, plans).map((item) => item.stage_instance),
    ["application-design@module:module-a", "code-generation@module:module-b@unit:unit-b"],
    "one module path may advance while another independent module remains ready",
  );
  state = complete(state, "code-generation@module:module-b@unit:unit-b");
  assert.equal(state.instances["implementation-report"].status, "blocked", "project aggregate must wait for every declared unit dependency");

  state = complete(state, "application-design@module:module-a");
  assert.deepEqual(
    findReadyInstances(state, plans).map((item) => item.stage_instance),
    ["code-generation@module:module-a@unit:unit-a"],
  );
  state = complete(state, "code-generation@module:module-a@unit:unit-a");
  assert.deepEqual(findReadyInstances(state, plans).map((item) => item.stage_instance), ["implementation-report"]);

  const duplicate = [...plans, { ...plans[0] }];
  assert.throws(() => findReadyInstances(state, duplicate), /duplicate stage instance/);
  const unknownDependency = plans.map((plan) => plan.stage_instance === "implementation-report"
    ? { ...plan, requires: ["missing-instance"] }
    : plan);
  assert.throws(() => findReadyInstances(state, unknownDependency), /unknown dependency/);
  const cyclic: WorkflowInstancePlanV3[] = [
    { stage_instance: "a", stage: "a", axis: "project", requires: ["b"], order: 0 },
    { stage_instance: "b", stage: "b", axis: "project", requires: ["a"], order: 1 },
  ];
  assert.throws(() => findReadyInstances(state, cyclic), /dependency cycle/);

  console.log("Deterministic multi-instance scheduler tests passed");
} finally {
  if (originalFlag === undefined) delete process.env.AIDLC_COLLABORATION_V3;
  else process.env.AIDLC_COLLABORATION_V3 = originalFlag;
  if (originalSecret === undefined) delete process.env.AIDLC_TRUST_SECRET;
  else process.env.AIDLC_TRUST_SECRET = originalSecret;
}
