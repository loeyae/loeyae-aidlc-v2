import { checkSensors, loadGraph, type StageInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { buildEvidenceReusePlan } from "../core/tools/aidlc-evidence-reuse-plan";
import { evidenceSourceRevision, evidenceScopeForInstance } from "../core/tools/aidlc-workflow-layout";
const state = loadWorkflowState(process.cwd())!;
const stage = loadGraph().stages.find(stage => stage.slug === state.current_stage)!;
const sensors = process.argv[2].split(",");
// A sensor probe may explicitly select a conditional stage to exercise its reuse
// policy independently of the workflow's scope/route selector.
const probeSelection = process.argv.includes("--select-stage") ? { scopes: [state.scope], execution: "ALWAYS" as const } : {};
const instance: StageInstance = { stage: { ...stage, ...probeSelection, sensors }, axis: stage.axis, instance_id: state.current_stage_instance!, module_id: state.current_module, unit_id: state.current_unit };
const failures = await checkSensors(instance, state, { tolerateRevisionDrift: process.argv.includes("--historical"), requireCurrentBaselineEpoch: process.argv.includes("--current-epoch"), onlySensors: sensors });
const plan = buildEvidenceReusePlan({ version: "test", stage_count: 1, stages: [instance.stage] }, {
  projectRoot: process.cwd(), scope: state.scope, now: new Date().toISOString(),
  evidenceScope: evidenceScopeForInstance(process.cwd(), instance.instance_id).label,
  target: { stage_slug: stage.slug, instance_id: instance.instance_id, axis: instance.axis, module_id: instance.module_id, unit_id: instance.unit_id },
  expectedSourceRevision: evidenceSourceRevision(process.cwd(), instance.instance_id), sensorFailures: failures,
});
console.log(JSON.stringify({ failures, plan }));
