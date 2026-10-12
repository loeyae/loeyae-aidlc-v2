import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { runControlledProvider, type PreparedProviderInvocation, type RestrictedSandboxAdapter } from "../core/tools/aidlc-provider-runner.js";
import { evaluateProviderGate } from "../core/tools/aidlc-provider-gate.js";
import { PROVIDER_PROFILE_REGISTRY_PATH } from "../core/tools/aidlc-provider-resolver.js";
import { PROJECT_PROVIDERS_LOCK_PATH } from "../core/tools/aidlc-project-provider.js";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string; json?: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8", shell: false });
  let json: Record<string, unknown> | undefined;
  try { json = JSON.parse(result.stdout || "") as Record<string, unknown>; } catch { /* error output may not be JSON */ }
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "", json };
}

function success(cwd: string, args: string[]): Record<string, unknown> {
  const result = run(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.json, `expected JSON output for ${args.join(" ")}`);
  return result.json;
}

function providerManifest(): string {
  return `schema: aidlc.provider/v1.1
provider_id: framework.directive-fixture
name: Directive Fixture Provider
version: 0.1.0
kind: validation
capabilities:
  - framework.directive.validation
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: directive-baseline
  version: 0.1.0
  catalog: rules/catalog.json
artifacts:
  lock: provider.lock
  sbom: sbom.spdx.json
policies:
  network: none
  writes: []
`;
}

const root = mkdtempSync(join(tmpdir(), "aidlc-provider-directive-"));
const source = join(root, "provider-source");
const remote = join(root, "provider-remote.git");
const project = join(root, "project");

try {
  const providerRoot = join(source, "providers", "fixture");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "fixture@example.test");
  git(source, "config", "user.name", "Directive Fixture");
  write(join(providerRoot, "provider.yaml"), providerManifest());
  write(join(providerRoot, "rules", "catalog.json"), JSON.stringify({ rules: [{ id: "directive.rule", title: "Directive", severity: "error", appliesTo: ["source"] }] }) + "\n");
  write(join(providerRoot, "provider.lock"), JSON.stringify({ lockfileVersion: 1, packages: {} }) + "\n");
  write(join(providerRoot, "sbom.spdx.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "directive-fixture", documentNamespace: "https://example.test/sbom/directive-fixture/0.1.0" }) + "\n");
  write(join(providerRoot, "bin", "validate.js"), "#!/usr/bin/env node\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "fixture v1");
  const providerCommit = git(source, "rev-parse", "HEAD");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");

  mkdirSync(project, { recursive: true });
  git(project, "init", "-b", "main");
  git(project, "config", "user.email", "project@example.test");
  git(project, "config", "user.name", "Directive Project");
  write(join(project, "README.md"), "# Provider directive fixture\n");
  git(project, "add", "README.md");
  git(project, "commit", "-m", "project baseline");

  write(join(project, ".aidlc", "provider-git-policy.json"), JSON.stringify({
    version: 1,
    allow_file_fixtures: true,
    allowed_commits: [providerCommit],
  }) + "\n");
  addProjectProvider(project, {
    source: pathToFileURL(remote).href,
    ref: "main",
    subdir: "providers/fixture",
    instance: "directive-fixture",
    id: "framework.directive-fixture",
    trust: "allowlisted-commit",
    allowFile: true,
  });
  write(join(project, PROVIDER_PROFILE_REGISTRY_PATH), JSON.stringify({
    version: 1,
    active: "protected-project",
    profiles: {
      "protected-project": {
        facts: { languages: ["typescript"] },
        risk: { level: "protected", protected_gate: true },
      },
    },
  }) + "\n");

  const initialized = success(project, ["orchestrate", "next", "--scope", "express", "--work", "Provider directive integration"]);
  assert.equal(initialized.kind, "print");

  const pending = success(project, ["orchestrate", "next"]);
  assert.equal(pending.kind, "ask");
  assert.equal(pending.ask_type, "provider-plan-approval");
  const pendingContext = pending.provider_context as Record<string, unknown>;
  const pendingPlan = pendingContext.plan as Record<string, unknown>;
  assert.equal(pendingPlan.status, "pending");
  assert.equal(pendingContext.project_provider_lock, PROJECT_PROVIDERS_LOCK_PATH);
  assert.ok(typeof pendingPlan.path === "string" && existsSync(join(project, pendingPlan.path)));
  const pendingActions = pending.provider_actions as Array<Record<string, unknown>>;
  assert.equal(pendingActions.length, 1);
  assert.equal(pendingActions[0].provider_instance_id, "directive-fixture");
  assert.equal(pendingActions[0].project_lock_digest, pendingContext.lock_digest);
  assert.equal(pendingActions[0].plan_id, pendingPlan.id);
  assert.equal(pendingActions[0].plan_digest, pendingPlan.digest);
  assert.equal(pendingActions[0].plan_node_id, pendingActions[0].node);
  assert.equal(pendingActions[0].required, true);
  assert.equal(pendingActions[0].type, "validation");
  assert.equal(pendingActions[0].required_after, "stage-execution");
  const actionBinding = pendingActions[0].binding as Record<string, unknown>;
  assert.equal(actionBinding.provider_instance_id, pendingActions[0].provider_instance_id);
  assert.equal(actionBinding.project_lock_digest, pendingActions[0].project_lock_digest);
  assert.equal(actionBinding.plan_node_id, pendingActions[0].plan_node_id);

  const approved = success(project, ["orchestrate", "next", "--provider-approval", "approval:MARS-152-test"]);
  assert.equal(approved.kind, "run-stage");
  const approvedContext = approved.provider_context as Record<string, unknown>;
  const approvedPlan = approvedContext.plan as Record<string, unknown>;
  assert.equal(approvedPlan.status, "approved");
  assert.notEqual(approvedPlan.id, pendingPlan.id, "pending and approved plans must have distinct immutable identities");
  assert.ok(typeof approvedPlan.path === "string" && existsSync(join(project, approvedPlan.path)));
  const approvedAction = (approved.provider_actions as Array<Record<string, unknown>>)[0];
  assert.equal(approvedAction.provider_instance_id, "directive-fixture");
  assert.equal(approvedAction.plan_id, approvedPlan.id);
  assert.equal(approvedAction.plan_digest, approvedPlan.digest);
  assert.equal(approvedAction.project_lock_digest, approvedContext.lock_digest);
  assert.match(String(approved.handoff_prompt), /Provider 计划：/);
  assert.match(String(approved.handoff_prompt), /directive-fixture\/framework\.directive\.validation@node-/);
  assert.match(String(approved.handoff_prompt), /不得从全局缓存、远端 branch 或同名仓库替换/);

  const repeated = success(project, ["orchestrate", "next", "--provider-approval", "approval:MARS-152-test"]);
  const repeatedPlan = ((repeated.provider_context as Record<string, unknown>).plan as Record<string, unknown>);
  assert.equal(repeatedPlan.id, approvedPlan.id);
  assert.equal(repeatedPlan.digest, approvedPlan.digest, "same Profile/lock/stage policy/revision must produce the same Plan");

  const stage = String(approved.stage);
  const reportArgs = ["orchestrate", "report", "--stage", stage];
  if (approved.approval === "block") reportArgs.push("--result", "approved", "--user-input", "Approve");
  else reportArgs.push("--result", "completed");
  if (approved.completion_contract === "instruction_only") reportArgs.push("--instruction-ack", stage);
  const choices = Array.isArray(approved.choices) ? approved.choices as string[] : [];
  if (choices.length > 0 && approved.approval !== "block") reportArgs.push("--user-input", choices[0]);
  const statePath = join(project, "aidlc", "active", "aidlc-state.md");
  const stateBeforeGate = readFileSync(statePath, "utf8");
  const withoutGate = run(project, reportArgs);
  assert.notEqual(withoutGate.status, 0);
  assert.match(`${withoutGate.stdout}\n${withoutGate.stderr}`, /--gate-decision/);
  assert.equal(readFileSync(statePath, "utf8"), stateBeforeGate, "missing GateDecision must not advance state");
  const forgedGate = run(project, [...reportArgs, "--gate-decision", `gate-${"0".repeat(32)}`]);
  assert.notEqual(forgedGate.status, 0);
  assert.match(`${forgedGate.stdout}\n${forgedGate.stderr}`, /GateDecision.*cannot authorize report/);
  assert.equal(readFileSync(statePath, "utf8"), stateBeforeGate, "forged GateDecision must not advance state");

  const sandbox: RestrictedSandboxAdapter = {
    probe: () => ({ supported: true, adapter: "integration-fixture", controls: { filesystem: true, network: true, environment: true, process: true, resources: true } }),
    execute: async (invocation: PreparedProviderInvocation) => {
      writeFileSync(join(invocation.outputRoot, "result.json"), `${JSON.stringify({
        schema: "aidlc.provider-result/v1.1",
        invocation_id: invocation.invocationId,
        status: "passed",
        checks: [{ rule_id: "directive.rule", status: "passed", severity: "error", message: "ok" }],
        diagnostics: [],
        reports: [],
      })}\n`, "utf8");
      return { exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: "", stderr: "" };
    },
  };
  const evidence = await runControlledProvider(project, {
    plan: String(approvedPlan.path),
    nodeId: String(approvedAction.plan_node_id),
    sandbox,
  });
  const gate = evaluateProviderGate(project, { plan: String(approvedPlan.path), evidence: [evidence.evidence_id] });
  assert.equal(gate.decision.status, "passed");
  const withGate = run(project, [...reportArgs, "--gate-decision", gate.decision.decision_id]);
  assert.doesNotMatch(`${withGate.stdout}\n${withGate.stderr}`, /GateDecision .*cannot authorize report|--gate-decision <gate-id>/, "current passing GateDecision must satisfy Provider report binding");

  const lockPath = join(project, PROJECT_PROVIDERS_LOCK_PATH);
  const originalLock = readFileSync(lockPath, "utf8");
  writeFileSync(lockPath, originalLock.replace(/lock_digest: sha256:[0-9a-f]{64}/, `lock_digest: sha256:${"0".repeat(64)}`), "utf8");
  const drifted = run(project, ["orchestrate", "next", "--provider-approval", "approval:MARS-152-test"]);
  assert.notEqual(drifted.status, 0);
  assert.match(`${drifted.stdout}\n${drifted.stderr}`, /PROVIDER_LOCK_MISMATCH/);

  console.log("Provider orchestrate directive integration tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
