/**
 * Test helper: evaluates the orchestrator gates for one stage instance of the
 * project in the current working directory and prints the result as JSON.
 *
 *   tsx tests/gate_probe.ts <stage-instance> sensors [<sensor>] [options]
 *   tsx tests/gate_probe.ts <stage-instance> produces [options]
 *   tsx tests/gate_probe.ts <stage-instance> consumes [options]
 *
 * Options (4.7.0):
 *   --module <id>     evaluate against the merged split-layout view of that module workflow
 *   --drift           tolerate source revision drift (as the code-generation completion re-check)
 *   --current-epoch   demand BASELINE evidence of the current baseline epoch
 */
import { checkConsumes, checkProduces, checkSensors, expandStageInstances, loadGraph, runtimeInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { loadWorkflowView } from "../core/tools/aidlc-workflow-layout";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : "true";
  args.splice(index, value === "true" ? 1 : 2);
  return value;
};
const moduleId = option("--module");
const drift = option("--drift") === "true";
const currentEpoch = option("--current-epoch") === "true";
const [instanceId, mode, sensor] = args;
const state = moduleId ? loadWorkflowView(process.cwd(), moduleId) : loadWorkflowState(process.cwd());
if (!state) throw new Error("workflow state is missing");
const graph = loadGraph();
const instances = expandStageInstances(graph, state);
const found = instances.find((candidate) => candidate.instance_id === instanceId);
if (!found) throw new Error(`unknown stage instance ${instanceId}; known: ${instances.map((candidate) => candidate.instance_id).join(", ")}`);
const instance = runtimeInstance(found, state);

try {
  if (mode === "sensors") {
    const options = { ...(drift ? { tolerateRevisionDrift: true } : {}), ...(currentEpoch ? { requireCurrentBaselineEpoch: true } : {}) };
    const failures = (await checkSensors(instance, state, options)).filter((failure) => !sensor || failure.sensor === sensor);
    console.log(JSON.stringify({ failures: failures.map((failure) => `[${failure.sensor}] ${failure.message}`) }));
  } else if (mode === "produces") {
    console.log(JSON.stringify({ missing: checkProduces(instance) }));
  } else if (mode === "consumes") {
    console.log(JSON.stringify({ failures: checkConsumes(instance, state, graph, instances) }));
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
} catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
}
