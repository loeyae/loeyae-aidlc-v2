import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  loadAgentCatalog,
  planAgentExecution,
  validateAgentResult,
} from "../core/tools/aidlc-agent-runtime";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const scratch = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-agent-runtime-"));

try {
  const catalog = loadAgentCatalog();
  for (const id of [
    "aidlc-product-agent",
    "aidlc-design-agent",
    "aidlc-architect-agent",
    "aidlc-developer-agent",
    "aidlc-quality-agent",
    "aidlc-delivery-agent",
    "aidlc-operations-agent",
  ]) assert.ok(catalog.has(id), `missing agent persona: ${id}`);

  const delegate = planAgentExecution({
    slug: "code-generation",
    name: "代码生成",
    lead_agent: "aidlc-developer-agent",
    support_agents: [],
    mode: "delegate",
  });
  assert.equal(delegate.mode, "delegate");
  assert.equal(delegate.primary.id, "aidlc-developer-agent");
  assert.equal("path" in delegate.primary, false);
  assert.equal(delegate.dispatch_steps[0].isolated_context, true);
  assert.equal(delegate.state_authority, "conductor-only");
  assert.equal(delegate.nested_delegation, "forbidden");

  const pipeline = planAgentExecution({
    slug: "reverse-engineering",
    name: "逆向工程",
    lead_agent: "aidlc-developer-agent",
    support_agents: ["aidlc-architect-agent"],
    mode: "pipeline",
  });
  assert.equal(pipeline.mode, "pipeline");
  assert.equal(pipeline.dispatch_steps.length, 2);
  assert.deepEqual(pipeline.dispatch_steps.map((step) => step.agent), ["aidlc-developer-agent", "aidlc-architect-agent"]);

  const mob = planAgentExecution({
    slug: "user-stories",
    name: "用户故事",
    lead_agent: "aidlc-product-agent",
    support_agents: ["aidlc-design-agent", "aidlc-quality-agent", "aidlc-developer-agent"],
    mode: "mob",
  });
  assert.equal(mob.mode, "mob");
  assert.equal(mob.dispatch_steps.length, 4);

  const review = planAgentExecution({
    slug: "code-review",
    name: "代码审查",
    lead_agent: "aidlc-quality-agent",
    support_agents: [],
    mode: "review",
    reviewer_agent: "aidlc-quality-agent",
  });
  assert.equal(review.mode, "review");
  assert.equal(review.reviewer?.kind, "reviewer");
  assert.equal(review.dispatch_steps[0].dispatch, "review");
  assert.equal(review.dispatch_steps[0].isolated_context, true);

  const result = {
    agent: "aidlc-developer-agent",
    stage: "code-generation",
    status: "DONE",
    summary: "implemented unit behavior",
    artifacts: ["src/example.ts"],
    risks: [],
  };
  assert.deepEqual(validateAgentResult(result), {
    valid: true,
    agent: "aidlc-developer-agent",
    stage: "code-generation",
    status: "DONE",
  });
  assert.throws(() => validateAgentResult({ ...result, state: { status: "done" } }), /conductor-owned field: state/);
  assert.throws(() => validateAgentResult({ ...result, delegations: [] }), /conductor-owned field: delegations/);

  const resultPath = join(scratch, "result.json");
  writeFileSync(resultPath, JSON.stringify(result), "utf8");
  const planCli = spawnSync(process.execPath, [tsx, cli, "agent", "plan", "--stage", "code-review"], { cwd: repository, encoding: "utf8" });
  assert.equal(planCli.status, 0, `${planCli.stdout}\n${planCli.stderr}`);
  const plan = JSON.parse(planCli.stdout) as Record<string, unknown>;
  assert.equal(plan.mode, "review");
  assert.equal((plan.reviewer as Record<string, unknown>).id, "aidlc-quality-agent");

  const validateCli = spawnSync(process.execPath, [tsx, cli, "agent", "validate-result", resultPath], { cwd: repository, encoding: "utf8" });
  assert.equal(validateCli.status, 0, `${validateCli.stdout}\n${validateCli.stderr}`);
  assert.equal((JSON.parse(validateCli.stdout) as Record<string, unknown>).valid, true);

  console.log("Agent runtime tests passed");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
