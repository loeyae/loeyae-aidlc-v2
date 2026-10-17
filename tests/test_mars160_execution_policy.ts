import assert from "node:assert/strict";
import { executionPolicyFor, type StageInstance } from "../core/tools/aidlc-orchestrate";

function instance(axis: "project" | "module" | "unit", completionContract: "gated" | "instruction_only" = "gated"): StageInstance {
  return {
    axis,
    instance_id: `${axis}-stage`,
    ...(axis !== "project" ? { module_id: "orders" } : {}),
    ...(axis === "unit" ? { unit_id: "checkout" } : {}),
    stage: {
      slug: `${axis}-stage`,
      name: `${axis} stage`,
      phase: "construction",
      requires: ["upstream"],
      consumes: ["docs/input.md"],
      produces: ["docs/output.md"],
      sensors: ["traceability-matrix"],
      approval: "notify",
      completion_contract: completionContract,
    },
  } as StageInstance;
}

const state = { work_description: "Fix checkout validation" };

const question = executionPolicyFor(state, instance("project", "instruction_only"));
assert.equal(question.task_level, "question");
assert.match(question.allowed_exploration, /不修改或探索代码/);

const localChange = executionPolicyFor(state, instance("unit"));
assert.equal(localChange.task_level, "local-change");
assert.match(localChange.allowed_exploration, /当前 unit/);

const multiFileFeature = executionPolicyFor(state, instance("module"));
assert.equal(multiFileFeature.task_level, "multi-file-feature");
assert.match(multiFileFeature.allowed_exploration, /多个文件本身不能升级为全仓审查/);

const crossModule = executionPolicyFor(state, instance("project"));
assert.equal(crossModule.task_level, "cross-module-infrastructure");
assert.match(crossModule.allowed_exploration, /不得默认进行全仓审计/);

assert.deepEqual(localChange.required.requires, ["upstream"]);
assert.deepEqual(localChange.required.consumes, ["docs/input.md"]);
assert.deepEqual(localChange.required.produces, ["docs/output.md"]);
assert.deepEqual(localChange.required.sensors, ["traceability-matrix"]);
assert.match(localChange.reusable_evidence, /source revision.*provenance.*digest.*新鲜度/);
assert.match(localChange.reusable_evidence, /修复后仅重新执行受影响、已失效或尚未满足的声明检查/);
assert.match(localChange.prohibited_actions.join("\n"), /重复审查/);
assert.match(localChange.stop_conditions.join("\n"), /结束当前阶段工作/);
assert.match(localChange.stop_conditions.join("\n"), /未验证及原因/);
assert.match(localChange.stop_conditions.join("\n"), /连续失败两次后/);
assert.match(localChange.expansion_triggers.join("\n"), /Provider gate 失败/);
assert.deepEqual(localChange.priority, [
  "用户明确要求及安全约束",
  "当前 AIDLC directive 与强制门禁",
  "当前任务的执行范围、必需检查和停止条件",
  "Agent 一般行为准则",
]);

console.log("MARS-160 execution policy tests passed");
