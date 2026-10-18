import { checkProduces, checkConsumes, checkSensors, loadGraph, type StageInstance } from "../core/tools/aidlc-orchestrate";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
const state = loadWorkflowState(process.cwd())!;
const graph = loadGraph();
const producer: StageInstance = { axis: "project", instance_id: "fixture-producer", stage: { ...graph.stages[0], slug: "fixture-producer", produces: [process.argv[2]], sensors: ["no-todo"], traceability: "not_applicable" } };
if (process.argv.includes("--delta")) Object.assign(producer, { axis: "unit", module_id: "project", unit_id: "default" });
const consumer: StageInstance = { axis: "project", instance_id: "fixture-consumer", stage: { ...producer.stage, slug: "fixture-consumer", produces: [], consumes: [process.argv[2]] } };
state.completed_stage_instances.push(producer.instance_id);
try {
  console.log(JSON.stringify({ produces: checkProduces(producer), consumes: checkConsumes(consumer, state, { ...graph, stages: [producer.stage, consumer.stage] }, [producer, consumer]), sensors: await checkSensors(producer, state) }));
} catch (error) { console.log(JSON.stringify({ error: String(error) })); }
