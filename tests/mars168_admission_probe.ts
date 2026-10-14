import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { expandStageInstances, loadGraph, qualityDevelopmentFailures } from "../core/tools/aidlc-orchestrate";
const state = loadWorkflowState(process.cwd())!;
const instances = expandStageInstances(loadGraph(), state);
const instance = instances.find(i => i.stage.slug === "functional-design" && i.module_id === "shop")!;
console.log(JSON.stringify(qualityDevelopmentFailures(instance, state, instances)));
