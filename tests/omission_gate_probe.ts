/** Evaluate only the requested consumer, preserving real controlled gate validation. */
import { checkHistoricalTddSensors, checkSensors, expandStageInstances, loadGraph, reviewCoverageErrors } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const [id, sensor, historical, currentEpoch] = process.argv.slice(2);
const state = loadWorkflowState(process.cwd())!;
const instance = expandStageInstances(loadGraph(), state).find(item => item.instance_id === id);
if (!instance) throw new Error(`unknown stage instance ${id}`);
const options = { onlySensors: [sensor], requireCurrentBaselineEpoch: currentEpoch === "current" };
const failures = sensor === "delivery" ? reviewCoverageErrors({ files_reviewed: ["src/behavior.cjs"] }, instance)
  : (await (historical ? checkHistoricalTddSensors(instance, state, options) : checkSensors(instance, state, options))).map(item => `[${item.sensor}] ${item.message}`);
console.log(JSON.stringify({ failures }));
