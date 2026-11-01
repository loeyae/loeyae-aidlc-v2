import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyExecutionProfile,
  classifyExecutionProfile,
  type ExecutionProfile,
  type ProfileScope,
  type ProfileSignal,
} from "../core/tools/aidlc-execution-profile";
import type { StageGraph } from "../core/tools/aidlc-orchestrate";
import { buildStagePlan } from "../core/tools/aidlc-stage-plan";
import { riskRequiredStages, selectExecutableStages } from "../core/tools/aidlc-stage-selection";

const graph = JSON.parse(readFileSync(resolve(import.meta.dirname, "../core/tools/data/stage-graph.json"), "utf8")) as StageGraph;
const scopes: ProfileScope[] = ["bugfix", "refactor", "express", "workshop", "feature", "mvp", "classic", "enterprise"];
const risks: ProfileSignal[] = [
  "impact_boundary_unknown", "cross_module_dependency", "external_contract_changed",
  "compatibility_or_rollback_risk", "provider_or_mandatory_gate", "security_or_sensitive_data",
  "data_schema_or_migration", "irreversible_change", "architecture_or_cross_service_change",
];
const at = "2026-11-01T00:00:00.000Z";
function profile(scope: ProfileScope, signals: ProfileSignal[] = []): ExecutionProfile {
  return applyExecutionProfile({ classified: classifyExecutionProfile({ scope, signals: new Set(signals) }), at });
}

// AU4232-03: a security escalation must expose the same candidates as execution,
// even when design stages and their prerequisites are outside the original scope.
const security = profile("bugfix", ["security_or_sensitive_data"]);
const securityPlan = buildStagePlan(graph, { scope: "bugfix", executionProfile: security });
assert.deepEqual(
  securityPlan.selected.map(stage => stage.slug),
  selectExecutableStages(graph.stages, "bugfix", [], security).map(stage => stage.slug),
  "security escalation must not hide risk-required stages behind the bugfix scope filter",
);
for (const slug of riskRequiredStages(security)) {
  const stage = securityPlan.selected.find(candidate => candidate.slug === slug);
  assert.ok(stage, `${slug} must appear in the advisory plan`);
  assert.equal(stage.reason, "risk_required", `${slug} must explain its risk requirement`);
  assert.equal(stage.required, true);
}
const riskDependencies = securityPlan.selected.filter(stage => stage.reason === "risk_dependency");
assert.ok(riskDependencies.length > 0, "out-of-scope prerequisites must explain the dependency on risk-required stages");
assert.ok(riskDependencies.every(stage => stage.required));

let parityCases = 0;
const allOptional = graph.stages.filter(stage => stage.selection === "user").map(stage => stage.slug);
for (const scope of scopes) {
  const profiles: [string, ExecutionProfile | undefined][] = [
    ["legacy", undefined],
    ["default", profile(scope)],
    ...(["standard", "complex"] as const).map(level => [level, applyExecutionProfile({
      classified: classifyExecutionProfile({
        scope, requested_level: level,
        signals: level === "complex" ? new Set(["user_requested_full_flow"] as const) : undefined,
      }), at,
    })] as [string, ExecutionProfile]),
    ...risks.map(risk => [risk, profile(scope, [risk])] as [string, ExecutionProfile]),
    ["all-risks", profile(scope, risks)],
  ];
  for (const [label, executionProfile] of profiles) {
    for (const selectedOptionalStages of [[], ["prd-generation"], allOptional]) {
      const context = `${scope}/${label}/${selectedOptionalStages.join(",") || "no-optionals"}`;
      const input = { scope, selectedOptionalStages, executionProfile };
      const plan = buildStagePlan(graph, input);
      const actual = selectExecutableStages(graph.stages, scope, selectedOptionalStages, executionProfile);
      assert.deepEqual(plan.selected.map(stage => stage.slug), actual.map(stage => stage.slug), context);
      assert.equal(plan.selected.length + plan.skipped.length, graph.stages.length, context);
      assert.deepEqual(plan.required, plan.selected.filter(stage => stage.required), context);
      assert.deepEqual(buildStagePlan(graph, input), plan, `${context}: deterministic projection`);
      for (const stage of graph.stages.filter(candidate => candidate.selection === "user")) {
        if (!selectedOptionalStages.includes(stage.slug)) {
          assert.ok(plan.skipped.some(candidate => candidate.slug === stage.slug), `${context}: optional selection stays explicit`);
        }
      }
      parityCases += 1;
    }
  }
}

// The advisory view lists candidates; condition evaluation and UI choices are
// still owned by the executor, so the plan must not claim they have been waived.
const conditional = graph.stages.find(stage => stage.slug === "product-inception");
assert.equal(conditional?.condition, "multi_module");
assert.ok(buildStagePlan(graph, { scope: "feature" }).selected.some(stage => stage.slug === conditional?.slug));
assert.ok(buildStagePlan(graph, { scope: "feature" }).skipped.some(stage => stage.slug === "prd-generation"));

const lightweight = buildStagePlan(graph, { scope: "bugfix", executionProfile: profile("bugfix") });
assert.equal(lightweight.skipped.find(stage => stage.slug === "state-template")?.reason, "lightweight_instruction_only");
assert.ok(lightweight.selected.some(stage => stage.slug === "workspace-detection"));
assert.ok(lightweight.selected.some(stage => stage.slug === "test-case-derivation"));
console.log(`PASS audit stage plan: ${parityCases} parity cases across ${scopes.length} scopes and ${risks.length} risks; risk reasons, optional choices, conditions and lightweight gates preserved`);
