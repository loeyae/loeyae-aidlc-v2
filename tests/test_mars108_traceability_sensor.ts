/**
 * MARS-108 regression: not_applicable stages no longer carry the traceability sensor.
 *
 * scanStages() unconditionally mounted no-todo + traceability on every producing stage,
 * ignoring the stage's traceability field. The gate (orchestrate case "traceability")
 * short-circuits (break) on traceability: not_applicable, so the sensor was clean-list
 * noise. scanStages() now mounts traceability only when traceability !== "not_applicable",
 * while no-todo stays unconditional, and validateGraph() relaxes the forced-traceability
 * check for not_applicable stages (the no-todo check is untouched). This asserts the
 * compiled graph is consistent with that intent: every producing not_applicable stage has
 * no-todo but no traceability, every required stage keeps traceability, and no producing
 * stage ever loses no-todo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const graph = JSON.parse(readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8")) as {
  stages: Array<{ slug: string; produces: string[]; sensors: string[]; traceability: string }>;
};

const sections: string[] = [];
const failed: string[] = [];

function section(name: string, body: () => void): void {
  try {
    body();
    sections.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}\n${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

const producing = graph.stages.filter((stage) => stage.produces.length > 0);

section("every producing not_applicable stage drops traceability but keeps no-todo", () => {
  const notApplicable = producing.filter((stage) => stage.traceability === "not_applicable");
  assert.ok(notApplicable.length > 0, "expected at least one producing not_applicable stage");
  for (const stage of notApplicable) {
    assert.ok(!stage.sensors.includes("traceability"), `${stage.slug} must not carry traceability sensor: ${JSON.stringify(stage.sensors)}`);
    assert.ok(stage.sensors.includes("no-todo"), `${stage.slug} must still carry no-todo sensor: ${JSON.stringify(stage.sensors)}`);
  }
});

section("the known 5 not_applicable stages are present and cleaned", () => {
  const expected = ["tdd", "shared-contract-baseline", "subagent-execution", "loeyae-compliance", "compact-recovery"];
  for (const slug of expected) {
    const stage = graph.stages.find((candidate) => candidate.slug === slug);
    assert.ok(stage, `stage ${slug} missing from compiled graph`);
    assert.equal(stage!.traceability, "not_applicable", `${slug} should be not_applicable`);
    assert.ok(stage!.produces.length > 0, `${slug} should still produce artifacts`);
    assert.ok(!stage!.sensors.includes("traceability"), `${slug} must not carry traceability sensor`);
    assert.ok(stage!.sensors.includes("no-todo"), `${slug} must carry no-todo sensor`);
  }
});

section("every producing required stage keeps the traceability sensor", () => {
  const required = producing.filter((stage) => stage.traceability === "required");
  assert.ok(required.length > 0, "expected at least one producing required stage");
  for (const stage of required) {
    assert.ok(stage.sensors.includes("traceability"), `${stage.slug} must carry traceability sensor: ${JSON.stringify(stage.sensors)}`);
    assert.ok(stage.sensors.includes("no-todo"), `${stage.slug} must carry no-todo sensor: ${JSON.stringify(stage.sensors)}`);
  }
});

section("no producing stage ever loses no-todo", () => {
  for (const stage of producing) {
    assert.ok(stage.sensors.includes("no-todo"), `${stage.slug} producing stage must carry no-todo: ${JSON.stringify(stage.sensors)}`);
  }
});

if (failed.length > 0) {
  console.error(`\n${failed.length} section(s) failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${sections.length} MARS-108 sections passed.`);
