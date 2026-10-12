import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import {
  defaultResolutionPolicy,
  freezeProviderPlan,
  resolveProjectProviderPlan,
} from "../core/tools/aidlc-provider-resolver.js";
import {
  ProviderRunnerError,
  probeRestrictedV1Sandbox,
  readCurrentProviderSourceRevision,
  runControlledProvider,
  validateRestrictedV1Manifest,
  type PreparedProviderInvocation,
  type RestrictedSandboxAdapter,
  type RestrictedSandboxExecution,
  type RestrictedSandboxProbe,
} from "../core/tools/aidlc-provider-runner.js";
import {
  LocalProviderEvidenceStore,
  ProviderEvidenceError,
  assessProviderEvidence,
  localProviderArtifactSigner,
} from "../core/tools/aidlc-provider-evidence.js";
import {
  evaluateProviderGate,
  verifyGateDecisionForReport,
  verifyGateDecisionSignature,
} from "../core/tools/aidlc-provider-gate.js";
import { PROVIDER_SCHEMA, type ProviderResultV1_1, type ProviderWaiver } from "../core/tools/aidlc-provider-types.js";

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function manifest(): string {
  return `schema: aidlc.provider/v1.1
provider_id: framework.runner-fixture
name: Runner Fixture
version: 0.1.0
kind: validation
capabilities:
  - framework.runner.validation
entrypoint:
  path: bin/check.js
  args: [--request-env]
ruleset:
  id: runner-rules
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

const completeProbe: RestrictedSandboxProbe = {
  supported: true,
  adapter: "test-restricted-v1",
  controls: { filesystem: true, network: true, environment: true, process: true, resources: true },
};

class FixtureSandbox implements RestrictedSandboxAdapter {
  calls = 0;

  constructor(
    private readonly handler: (invocation: PreparedProviderInvocation) => void,
    private readonly execution: Partial<RestrictedSandboxExecution> = {},
    private readonly probeResult: RestrictedSandboxProbe = completeProbe,
  ) {}

  probe(): RestrictedSandboxProbe { return this.probeResult; }

  async execute(invocation: PreparedProviderInvocation): Promise<RestrictedSandboxExecution> {
    this.calls++;
    this.handler(invocation);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      stdout: "token=must-redact",
      stderr: "",
      ...this.execution,
    };
  }
}

function providerResult(invocation: PreparedProviderInvocation, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: PROVIDER_SCHEMA.result,
    invocation_id: invocation.invocationId,
    status: "passed",
    checks: [{ rule_id: "runner.rule", status: "passed", severity: "error", message: "ok" }],
    diagnostics: [],
    reports: [],
    ...overrides,
  };
}

function resultSandbox(
  overrides: Record<string, unknown> = {},
  execution: Partial<RestrictedSandboxExecution> = {},
  probe: RestrictedSandboxProbe = completeProbe,
): FixtureSandbox {
  return new FixtureSandbox((invocation) => {
    writeFileSync(join(invocation.outputRoot, "result.json"), `${JSON.stringify(providerResult(invocation, overrides))}\n`, "utf8");
  }, execution, probe);
}

async function rejectsDiagnostic(action: () => Promise<unknown>, diagnostic: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(diagnostic));
    return true;
  });
}

const root = mkdtempSync(join(tmpdir(), "aidlc-provider-runner-gate-"));
const source = join(root, "provider-source");
const remote = join(root, "provider-remote.git");
const project = join(root, "project");

try {
  const providerRoot = join(source, "providers", "fixture");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "fixture@example.test");
  git(source, "config", "user.name", "Runner Fixture");
  write(join(providerRoot, "provider.yaml"), manifest());
  write(join(providerRoot, "rules", "catalog.json"), `${JSON.stringify({ rules: [
    { id: "runner.rule", title: "Runner rule", severity: "error", waivable: true },
    { id: "runner.nonwaivable", title: "Non-waivable rule", severity: "error", waivable: false },
  ] })}\n`);
  write(join(providerRoot, "provider.lock"), `${JSON.stringify({ lockfileVersion: 1, packages: {} })}\n`);
  write(join(providerRoot, "sbom.spdx.json"), `${JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "runner-fixture", documentNamespace: "https://example.test/runner-fixture" })}\n`);
  write(join(providerRoot, "bin", "check.js"), "#!/usr/bin/env node\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "fixture");
  const providerCommit = git(source, "rev-parse", "HEAD");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");

  mkdirSync(project, { recursive: true });
  git(project, "init", "-b", "main");
  git(project, "config", "user.email", "project@example.test");
  git(project, "config", "user.name", "Runner Project");
  write(join(project, "src", "input.txt"), "authorized input\n");
  write(join(project, "secret.txt"), "not authorized\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "baseline");
  write(join(project, ".aidlc", "provider-git-policy.json"), `${JSON.stringify({ version: 1, allow_file_fixtures: true, allowed_commits: [providerCommit] })}\n`);
  addProjectProvider(project, {
    source: pathToFileURL(remote).href,
    ref: "main",
    subdir: "providers/fixture",
    instance: "runner-fixture",
    id: "framework.runner-fixture",
    trust: "allowlisted-commit",
    allowFile: true,
  });

  const sourceRevision = readCurrentProviderSourceRevision(project);
  const resolutionPolicy = defaultResolutionPolicy({ policy_id: "test.runner-gate" });
  const resolved = resolveProjectProviderPlan(project, {
    scope: { stage: "code-review" },
    source_revision: sourceRevision,
    policy: resolutionPolicy,
  });
  assert.equal(resolved.resolution.resolvable, true);
  assert.equal(resolved.plan.nodes.length, 1);
  const planPath = freezeProviderPlan(project, resolved.plan);
  const nodeId = resolved.plan.nodes[0].node_id;

  // Request is constructed by Core from the immutable Plan/lock and exposes only snapshots.
  let capturedInvocation: PreparedProviderInvocation | undefined;
  const passingSandbox = new FixtureSandbox((invocation) => {
    capturedInvocation = invocation;
    assert.equal(invocation.request.permissions.command.shell, false);
    assert.equal(invocation.request.permissions.network, "denied");
    assert.deepEqual(invocation.request.permissions.environment, []);
    assert.deepEqual(invocation.request.inputs.map((entry) => entry.logical_path), ["src/input.txt"]);
    assert.doesNotMatch(JSON.stringify(invocation.request), /not authorized|secret\.txt/);
    writeFileSync(join(invocation.outputRoot, "result.json"), `${JSON.stringify(providerResult(invocation))}\n`, "utf8");
  });
  const passing = await runControlledProvider(project, {
    plan: planPath,
    nodeId,
    inputs: [{ id: "source", path: "src/input.txt" }],
    sandbox: passingSandbox,
  });
  assert.equal(passing.status, "passed");
  assert.deepEqual(passing.summary, { passed: 1, failed: 0, not_applicable: 0 });
  assert.equal(passingSandbox.calls, 1);
  assert.ok(capturedInvocation);
  assert.throws(() => validateRestrictedV1Manifest({
    ...capturedInvocation.manifest,
    policies: { ...capturedInvocation.manifest.policies, network: "allowlisted", allowlisted_hosts: ["example.test"] },
  }), /PROVIDER_NETWORK_DENIED/);
  assert.throws(() => validateRestrictedV1Manifest({
    ...capturedInvocation.manifest,
    entrypoint: { ...capturedInvocation.manifest.entrypoint, path: "bin/check.sh" },
  }), /PROVIDER_SHELL_DENIED/);
  assert.throws(() => validateRestrictedV1Manifest({
    ...capturedInvocation.manifest,
    policies: { ...capturedInvocation.manifest.policies, writes: ["outside"] },
  }), /PROVIDER_PERMISSION_DENIED/);
  assert.doesNotMatch(passing.logs.stdout, /must-redact/);
  assert.match(passing.logs.stdout, /REDACTED/);
  assert.equal(existsSync(join(project, passing.evidence_path)), true);

  const signer = localProviderArtifactSigner(project, false);
  const evidenceStore = new LocalProviderEvidenceStore(project);
  const acceptedEvidence = evidenceStore.get(passing.evidence_id);
  const accepted = assessProviderEvidence(acceptedEvidence, signer, {
    plan: { plan_id: resolved.plan.plan_id, plan_digest: resolved.plan.plan_digest, node_id: nodeId },
    projectLockDigest: resolved.plan.project_lock_digest,
    scope: resolved.plan.scope,
    sourceRevision,
  });
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.evidence.summary.passed, 1, "Runner, not Provider, computes summary");

  const passedGate = evaluateProviderGate(project, { plan: planPath, evidence: [passing.evidence_id] });
  assert.equal(passedGate.decision.status, "passed");
  assert.equal(existsSync(join(project, passedGate.path)), true);
  assert.equal(verifyGateDecisionForReport(project, passedGate.decision.decision_id, {
    scope: resolved.plan.scope,
    sourceRevision,
    resolutionPolicy,
  }).decision_id, passedGate.decision.decision_id);
  assert.throws(() => verifyGateDecisionSignature({ ...passedGate.decision, status: "blocked" }, signer), /PROVIDER_EVIDENCE_REVOKED/);
  assert.throws(() => verifyGateDecisionForReport(project, passedGate.decision.decision_id, {
    scope: { ...resolved.plan.scope, module_id: "forged-module" },
    sourceRevision,
    resolutionPolicy,
  }), /PROVIDER_PLAN_STALE/);
  const invalidFallbackGate = evaluateProviderGate(project, {
    plan: planPath,
    evidence: [passing.evidence_id],
    fallbacks: [{ from_node_id: nodeId, to_node_id: nodeId, trigger_diagnostic: "CHECK_FAILED", policy_ref: "test" }],
    policy: { allowWaivers: false, waiverAllowedStages: [], waivableRuleIds: [], allowFallback: true, fallbackAllowedStages: [resolved.plan.scope.stage] },
  });
  assert.equal(invalidFallbackGate.decision.status, "blocked");
  assert.match(invalidFallbackGate.diagnostics.map((entry) => entry.code).join(" "), /PROVIDER_FALLBACK_NOT_ALLOWED/);

  // A missing Evidence and a deferred Result both produce signed blocked decisions.
  const missingGate = evaluateProviderGate(project, { plan: planPath, evidence: [] });
  assert.equal(missingGate.decision.status, "blocked");
  assert.match(missingGate.diagnostics.map((entry) => entry.code).join(" "), /PROVIDER_GATE_EVIDENCE_MISSING/);
  await rejectsDiagnostic(async () => verifyGateDecisionForReport(project, missingGate.decision.decision_id, {
    scope: resolved.plan.scope,
    sourceRevision,
    resolutionPolicy,
  }), "PROVIDER_GATE_EVIDENCE_MISSING");

  const deferred = await runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({
      status: "deferred",
      checks: [],
      diagnostics: [{ code: "CHECK_DEFERRED", message: "dependency unavailable" }],
      deferred: {
        reason: "dependency unavailable",
        retry_after: new Date(Date.now() + 60_000).toISOString(),
        deadline: new Date(Date.now() + 120_000).toISOString(),
      },
    }),
  });
  const deferredGate = evaluateProviderGate(project, { plan: planPath, evidence: [deferred.evidence_id] });
  assert.equal(deferredGate.decision.status, "blocked");
  assert.match(deferredGate.diagnostics.map((entry) => entry.code).join(" "), /PROVIDER_DEFERRED_NOT_ALLOWED/);

  // A failed rule can pass only through a scoped, current, Core-policy-enabled human waiver.
  const failed = await runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({
      status: "failed",
      checks: [{ rule_id: "runner.rule", status: "failed", severity: "error", message: "violation" }],
      diagnostics: [{ code: "CHECK_FAILED", message: "runner.rule failed" }],
    }),
  });
  const now = new Date();
  const waiver: ProviderWaiver = {
    waiver_id: "waiver-human-1",
    approval_ref: "human:MARS-153-test",
    reason: "bounded fixture exception",
    scope: resolved.plan.scope,
    evidence_id: failed.evidence_id,
    rule_ids: ["runner.rule"],
    issued_at: new Date(now.getTime() - 1_000).toISOString(),
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    rerun_required_by: new Date(now.getTime() + 30_000).toISOString(),
  };
  const deniedWaiverGate = evaluateProviderGate(project, { plan: planPath, evidence: [failed.evidence_id], waivers: [waiver], now });
  assert.equal(deniedWaiverGate.decision.status, "blocked", "waiver is deny-by-default");
  const waivedGate = evaluateProviderGate(project, {
    plan: planPath,
    evidence: [failed.evidence_id],
    waivers: [waiver],
    now,
    policy: {
      allowWaivers: true,
      waiverAllowedStages: [resolved.plan.scope.stage],
      waivableRuleIds: ["runner.rule"],
      allowFallback: false,
      fallbackAllowedStages: [],
    },
  });
  assert.equal(waivedGate.decision.status, "passed_with_waiver");
  assert.equal(waivedGate.decision.rule_evaluations[0].status, "waived");

  const nonwaivable = await runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({
      status: "failed",
      checks: [{ rule_id: "runner.nonwaivable", status: "failed", severity: "error", message: "violation" }],
      diagnostics: [{ code: "CHECK_FAILED", message: "runner.nonwaivable failed" }],
    }),
  });
  const nonwaivableWaiver: ProviderWaiver = { ...waiver, waiver_id: "waiver-human-2", evidence_id: nonwaivable.evidence_id, rule_ids: ["runner.nonwaivable"] };
  const nonwaivableGate = evaluateProviderGate(project, {
    plan: planPath,
    evidence: [nonwaivable.evidence_id],
    waivers: [nonwaivableWaiver],
    now,
    policy: { allowWaivers: true, waiverAllowedStages: [resolved.plan.scope.stage], waivableRuleIds: ["runner.nonwaivable"], allowFallback: false, fallbackAllowedStages: [] },
  });
  assert.equal(nonwaivableGate.decision.status, "blocked", "Core policy cannot waive a rule the locked catalog marks non-waivable");

  // Provider-owned Core fields, binding forgery, report path escape and invalid status never issue Evidence.
  const evidenceCount = (): number => readdirSync(join(project, ".aidlc", "evidence", "providers")).filter((name) => name.endsWith(".json")).length;
  const beforeInvalid = evidenceCount();
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({ evidence: { state: "accepted" }, summary: { passed: 999 } }),
  }), "PROVIDER_RESULT_INVALID");
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: new FixtureSandbox((invocation) => {
      writeFileSync(join(invocation.outputRoot, "result.json"), `${JSON.stringify(providerResult(invocation, { invocation_id: "inv-forged" }))}\n`);
    }),
  }), "PROVIDER_RESULT_BINDING_MISMATCH");
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({ reports: [{ path: "../audit.md", media_type: "text/markdown", digest: `sha256:${"0".repeat(64)}` }] }),
  }), "PROVIDER_RESULT_INVALID|PROVIDER_PATH_ESCAPE");
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({ extensions: { invalid: { value: true } } }),
  }), "PROVIDER_RESULT_INVALID");
  assert.equal(evidenceCount(), beforeInvalid, "invalid Results publish no accepted Evidence");

  // Input traversal and incomplete sandbox enforcement fail before Provider execution.
  const traversalSandbox = resultSandbox();
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    inputs: [{ id: "escape", path: "../secret.txt" }],
    sandbox: traversalSandbox,
  }), "PROVIDER_PERMISSION_DENIED|PROVIDER_PATH_ESCAPE");
  assert.equal(traversalSandbox.calls, 0);
  const incompleteSandbox = resultSandbox({}, {}, {
    supported: true,
    adapter: "unsafe-test-adapter",
    controls: { filesystem: true, network: false, environment: true, process: true, resources: true },
    reason: "network isolation unavailable",
  });
  await rejectsDiagnostic(() => runControlledProvider(project, { plan: planPath, nodeId, sandbox: incompleteSandbox }), "PROVIDER_SANDBOX_UNAVAILABLE");
  assert.equal(incompleteSandbox.calls, 0);

  // Process failures, timeout and cancellation never issue Evidence.
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({}, { exitCode: 7 }),
  }), "PROVIDER_PROCESS_ERROR");
  await rejectsDiagnostic(() => runControlledProvider(project, {
    plan: planPath,
    nodeId,
    sandbox: resultSandbox({}, { timedOut: true, exitCode: null, signal: "SIGKILL" }),
  }), "PROVIDER_TIMEOUT");
  const controller = new AbortController();
  controller.abort();
  await rejectsDiagnostic(() => runControlledProvider(project, { plan: planPath, nodeId, sandbox: resultSandbox(), signal: controller.signal }), "PROVIDER_CANCELLED");
  assert.equal(evidenceCount(), beforeInvalid);

  // Effective validity is calculated by Core; historical signed Evidence is immutable.
  assert.equal(assessProviderEvidence(acceptedEvidence, signer, {
    projectLockDigest: `sha256:${"0".repeat(64)}`,
  }).state, "stale");
  assert.equal(assessProviderEvidence(acceptedEvidence, signer, {
    now: new Date(Date.parse(acceptedEvidence.validity.expires_at) + 1),
  }).state, "expired");
  assert.equal(assessProviderEvidence(acceptedEvidence, signer, {
    revokedEvidenceIds: new Set([acceptedEvidence.evidence_id]),
  }).state, "revoked");

  const forgedEvidence = JSON.parse(JSON.stringify(acceptedEvidence)) as ProviderResultV1_1 & { summary: { passed: number } };
  forgedEvidence.summary.passed = 999;
  assert.throws(() => assessProviderEvidence(forgedEvidence, signer), (error: unknown) => {
    assert.ok(error instanceof ProviderEvidenceError);
    assert.match(error.message, /PROVIDER_EVIDENCE_REVOKED/);
    return true;
  });

  const probe = await probeRestrictedV1Sandbox();
  assert.equal(typeof probe.supported, "boolean");
  if (process.platform !== "linux") assert.equal(probe.supported, false, "unsupported OS must fail closed, never best-effort execute");

  // Plan source revision drift blocks execution before the adapter runs.
  writeFileSync(join(project, "src", "input.txt"), "changed after plan\n", "utf8");
  const staleSandbox = resultSandbox();
  await rejectsDiagnostic(() => runControlledProvider(project, { plan: planPath, nodeId, sandbox: staleSandbox }), "PROVIDER_PLAN_STALE");
  assert.equal(staleSandbox.calls, 0);

  console.log("Provider restricted Runner, Evidence and GateDecision tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
