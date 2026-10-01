/**
 * Test helper: evaluates the orchestrator gates for one stage instance of the
 * project in the current working directory and prints the result as JSON.
 *
 *   tsx tests/gate_probe.ts <stage-instance> sensors [<sensor>]
 *   tsx tests/gate_probe.ts <stage-instance> produces
 *   tsx tests/gate_probe.ts <stage-instance> consumes
 */
import { checkConsumes, checkProduces, checkSensors, expandStageInstances, loadGraph, runtimeInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";

const [instanceId, mode, sensor] = process.argv.slice(2);
const state = loadWorkflowState(process.cwd());
if (!state) throw new Error("workflow state is missing");
const graph = loadGraph();
const instances = expandStageInstances(graph, state);
const found = instances.find((candidate) => candidate.instance_id === instanceId);
if (!found) throw new Error(`unknown stage instance ${instanceId}; known: ${instances.map((candidate) => candidate.instance_id).join(", ")}`);
const instance = runtimeInstance(found, state);

try {
  if (mode === "sensors") {
    const failures = (await checkSensors(instance, state)).filter((failure) => !sensor || failure.sensor === sensor);
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
