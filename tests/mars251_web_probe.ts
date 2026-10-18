import { buildConditionContext, runtimeInstance, loadGraph, type StageInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const state=loadWorkflowState(process.cwd())!;
const instance:StageInstance={stage:loadGraph().stages.find(x=>x.slug==="code-generation")!,axis:"unit",instance_id:"code-generation@module:project@unit:default",module_id:"project",unit_id:"default"};
const bridge=buildConditionContext(state,instance).needs_ui_implementation_bridge;
if(runtimeInstance(instance,state).stage.consumes.some(p=>p.includes("frontend-platform-spec")))throw new Error("pure Web unexpectedly consumes bridge output");
console.log(JSON.stringify({bridge}));
