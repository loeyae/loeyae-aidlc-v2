/** P1-09: real CLI sequencing, explicit mode isolation and transport boundaries. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createAdmissionFixture } from "./helpers/autonomy-admission-fixture";
import {
  createInitialState,
  saveWorkflowState,
  loadWorkflowState,
  renderLightWorkflowState,
} from "../core/tools/aidlc-light-state";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { nativeHostDirective } from "../core/tools/aidlc-native-host";
import { buildRuleLoadPlan, AUTONOMOUS_EXECUTION_PROTOCOL } from "../core/tools/aidlc-rule-load-plan";
import { coreResponse, Gateway, requiredAdmissionWindow } from "../harness/codex/runtime/aidlc-codex-host.mjs";
const repository = resolve(import.meta.dirname, ".."),
  scratch = mkdtempSync(join(tmpdir(), "aidlc-autonomous-rules-")),
  env = { ...process.env };
const graph = JSON.parse(readFileSync(join(repository, "core/tools/data/stage-graph.json"), "utf8"));
let count = 0;
const transcript: any[] = [];
async function test(name: string, fn: () => unknown) {
  await fn();
  count++;
  console.log("PASS " + name);
}
function cli(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), "orchestrate", ...args],
    { cwd: root, env: process.env, encoding: "utf8", timeout: 60000 },
  );
}
function output(r: ReturnType<typeof cli>) {
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}
try {
  await test("autonomy rule loading adds only an explicit supplemental protocol", () => {
    const old = buildRuleLoadPlan(graph, { scope: "feature", targetStageSlug: "code-generation" }),
      adopted = buildRuleLoadPlan(graph, {
        scope: "feature",
        targetStageSlug: "code-generation",
        autonomyContractVersion: "1",
      });
    const { supplemental_protocols, ...unchanged } = adopted;
    assert.deepEqual(unchanged, old);
    assert.deepEqual(supplemental_protocols, [AUTONOMOUS_EXECUTION_PROTOCOL]);
    assert.equal(old.supplemental_protocols, undefined);
    assert.ok(existsSync(join(repository, AUTONOMOUS_EXECUTION_PROTOCOL)));
  });
  const f = createAdmissionFixture(scratch, "notify-sequence", (_plan, f) => {
    const state = f.current();
    const prepared = graph.stages
      .slice(
        0,
        graph.stages.findIndex((s: any) => s.slug === "state-template"),
      )
      .filter((s: any) => s.selection !== "user");
    state.completed_stage_instances = prepared.map((s: any) => s.slug);
    state.completed_stages = prepared.map((s: any) => s.slug);
    state.history.push({
      stage: "workspace-detection",
      result: "completed",
      timestamp: new Date().toISOString(),
      user_input: "single-module",
    });
    writeFileSync(join(f.root, "aidlc/active/aidlc-state.md"), renderLightWorkflowState(state));
  });
  await f.issue();
  assert.equal(f.run().admission_result, "ready");
  await test("adopted preview guides autonomous execution without claiming authority or writing state", () => {
    const before = readFileSync(join(f.root, "aidlc/active/aidlc-state.md"));
    const r = output(f.cli(["next", "--preview"]));
    assert.equal(r.autonomous_execution.routine_stage_confirmation, "not-required");
    assert.equal(r.autonomous_execution.execution_authorized, false);
    assert.equal(r.autonomous_execution.protocol_file, AUTONOMOUS_EXECUTION_PROTOCOL);
    const rules = output(f.cli(["state", "rules"]));
    assert.deepEqual(rules.rule_load_plan.supplemental_protocols, [AUTONOMOUS_EXECUTION_PROTOCOL]);
    assert.deepEqual(readFileSync(join(f.root, "aidlc/active/aidlc-state.md")), before);
  });
  const context = nativeHostDirective(f.root, ["context"]).host_context;
  context.coordinator_binding = context.binding;
  process.env.AIDLC_COORDINATOR_BINDING = JSON.stringify(context.binding);
  const core = async (args: string[]) => {
    const r = f.cli(args.slice(1));
    return coreResponse(
      {
        status: r.status === 0 ? "succeeded" : "failed",
        exit_code: r.status,
        reconciled: r.status !== null,
        stdout: r.stdout,
        stderr: r.stderr,
      },
      args,
    );
  };
  const gateway = new Gateway({ commands: [] }, f.root, context, core);
  // Standalone Gateway fixture: consume the real Core receipt instead of the driver installer.
  gateway.requireAdmissionWindow = async (action: any) => {
    const admission = (await core(['orchestrate','autonomy','admission','inspect'])).autonomous_admission;
    assert.ok(['ready','ready-with-delegated-decisions'].includes(admission.admission_result));
    gateway.admissionDeadline = Date.parse(admission.valid_until);
    assert.ok(gateway.admissionDeadline-Date.now() >= requiredAdmissionWindow(action,{commands:[]},gateway.budget.deadline));
  };
  await test("real notify report releases its claim and returns to a live same-session coordinator", async () => {
    for (const stage of ["state-template"]) {
      const selected = nativeHostDirective(f.root, ["select", "--instance", stage]);
      context.binding = selected.host_context.binding;
      process.env.AIDLC_SESSION_BINDING = JSON.stringify(selected.host_context.binding);
      const next = await gateway.invoke({ action: "core", args: ["orchestrate", "next"] });
      assert.equal(next.kind, "run-stage", JSON.stringify(next));
      assert.equal(next.stage, stage);
      assert.equal(next.approval, "notify");
      const args = ["report", "--stage", stage, "--result", "completed", "--instruction-ack", stage];
      const r = await gateway.invoke({ action: "core", args: ["orchestrate", ...args] });
      assert.ok(f.current().completed_stage_instances.includes(stage));
      assert.equal(r.next_stage_status, "planned");
      assert.equal(f.current().active_instances[stage], undefined);
      assert.equal(nativeHostDirective(f.root, ["context"]).host_context.binding.stage_instance, "workspace-detection");
      assert.equal(gateway.readyInstance, null);
      transcript.push({
        stage,
        session_id: selected.host_context.binding.session_id,
        approval: next.approval,
        command: args,
        completed: true,
        next_stage: r.next_stage?.stage,
      });
    }
    assert.equal(new Set(transcript.map((r) => r.session_id)).size, 1);
  });
  await test("coordinator selection requires the held credential and renews through normal binding", () => {
    const target = "build-and-test";
    context.binding = nativeHostDirective(f.root, ["select", "--instance", target]).host_context.binding;
    process.env.AIDLC_SESSION_BINDING = JSON.stringify(context.binding);
    const held = process.env.AIDLC_COORDINATOR_BINDING!;
    delete process.env.AIDLC_COORDINATOR_BINDING;
    assert.throws(
      () => nativeHostDirective(f.root, ["select", "--instance", "workspace-detection"]),
      /COORDINATOR_BINDING_REQUIRED/,
    );
    process.env.AIDLC_COORDINATOR_BINDING = JSON.stringify({ ...JSON.parse(held), generation: "not-held" });
    assert.throws(
      () => nativeHostDirective(f.root, ["select", "--instance", "workspace-detection"]),
      /generation|binding|claim/i,
    );
    process.env.AIDLC_COORDINATOR_BINDING = held;
    const back = nativeHostDirective(f.root, ["select", "--instance", "workspace-detection"]).host_context.binding;
    assert.equal(back.generation, JSON.parse(held).generation);
    assert.equal(f.current().active_instances[target], undefined);
    context.binding = context.coordinator_binding = back;
    process.env.AIDLC_SESSION_BINDING = process.env.AIDLC_COORDINATOR_BINDING = JSON.stringify(back);
  });
  await test("actual CLI routing exit 2 retains structured diagnostics without accepting process failures", () => {
    const r = f.cli(["next", "--work", "Must not replace the active workflow"]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const value = JSON.parse(r.stdout);
    assert.equal(value.kind, "error");
    const result = { status: "failed", exit_code: r.status, reconciled: true, stdout: r.stdout, stderr: r.stderr };
    assert.deepEqual(coreResponse(result, ["orchestrate", "next", "--preview"]), value);
    for (const changes of [
      { reconciled: false },
      { status: "cancelled" },
      { status: "timeout" },
      { exit_code: 1 },
      { stdout: "not JSON" },
    ])
      assert.throws(() => coreResponse({ ...result, ...changes }, ["orchestrate", "next"]));
    assert.throws(() => coreResponse(result, ["evidence", "run"]));
    assert.throws(() => coreResponse({ ...result, status: "succeeded", exit_code: 0 }, ["orchestrate", "report"]));
  });
  await test("host selection cannot claim a module outside the frozen implement set", () =>
    assert.throws(
      () => nativeHostDirective(f.root, ["select", "--instance", "functional-design@module:future"]),
      /OUTSIDE_IMPLEMENT_SCOPE/,
    ));
  for (const key of [
    "AIDLC_SESSION_BINDING",
    "AIDLC_COORDINATOR_BINDING",
    "AIDLC_EXECUTION_GRANT",
    "AIDLC_AUTONOMY_HOST",
  ])
    delete process.env[key];
  const legacy = join(scratch, "legacy");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "README.md"), "Unadopted compatibility fixture\n");
  for (const args of [
    ["init", "-q"],
    ["add", "README.md"],
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"],
  ]) {
    const r = spawnSync("git", args, { cwd: legacy, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  saveWorkflowState(
    legacy,
    createInitialState("express", undefined, "legacy-rules", [], "Legacy notify compatibility"),
  );
  await test("unadopted stages retain original routes and require no new grant or admission", () => {
    for (const stage of ["workspace-detection", "state-template"]) {
      const s = loadWorkflowState(legacy)!;
      const b = bindSession(legacy, {
        instance: stage,
        owner: "agent",
        session: "legacy-session",
        expected: claimToken(s.active_instances[stage]),
      }).binding;
      process.env.AIDLC_SESSION_BINDING = JSON.stringify(b);
      const r = output(cli(legacy, ["next"]));
      assert.equal(r.stage, stage);
      assert.equal(r.autonomous_execution, undefined);
      assert.equal(r.autonomous_admission, undefined);
      assert.equal(r.rule_load_plan.supplemental_protocols, undefined);
      output(cli(legacy, ["report", "--stage", stage, "--result", "completed", "--instruction-ack", stage]));
    }
    assert.equal(loadWorkflowState(legacy)!.autonomy_contract_version, undefined);
    assert.equal(existsSync(join(legacy, ".git/aidlc/autonomy")), false);
    assert.equal(existsSync(join(legacy, ".aidlc/evidence/autonomous-admission")), false);
  });
  const out = resolve(process.env.AIDLC_EVAL_DIR || "docs/evals/autonomy/p1-09");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "notify-sequence.json"),
    JSON.stringify(
      {
        kind: "engineering-real-cli-sequence",
        authority: "simulated operator/reception adapter; not business authorization",
        stages: transcript,
        human_continuation_inputs: 0,
        business_verified: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Autonomous rules: ${count} scenarios passed; real CLI, explicit fixture authority; no full native model pilot`,
  );
} finally {
  for (const k of [
    "AIDLC_SESSION_BINDING",
    "AIDLC_COORDINATOR_BINDING",
    "AIDLC_EXECUTION_GRANT",
    "AIDLC_AUTONOMY_HOST",
  ])
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
