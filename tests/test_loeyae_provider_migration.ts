import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import {
  getLoeyaeCompatibilityStatus,
  setLoeyaeCompatibilityMode,
} from "../core/tools/aidlc-provider-compatibility.js";
import { createInitialState, saveWorkflowState, type WorkflowState } from "../core/tools/aidlc-light-state.js";
import { evaluateProviderGate } from "../core/tools/aidlc-provider-gate.js";
import {
  runControlledProvider,
  type PreparedProviderInvocation,
  type RestrictedSandboxAdapter,
} from "../core/tools/aidlc-provider-runner.js";

const repository = resolve(import.meta.dirname, "..");
const cli = join(repository, "bin", "cli.ts");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const graph = JSON.parse(readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8")) as {
  stages: Array<{ slug: string; axis: "project" | "module" | "unit"; scopes: string[]; provider_capabilities?: string[] }>;
};

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  json?: Record<string, unknown>;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(cwd: string, args: string[]): RunResult {
  const result = spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8", shell: false });
  let json: Record<string, unknown> | undefined;
  try { json = JSON.parse(result.stdout || "") as Record<string, unknown>; } catch { /* blocked commands may emit only stderr */ }
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "", ...(json ? { json } : {}) };
}

function ok(cwd: string, args: string[]): Record<string, unknown> {
  const result = run(cwd, args);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.json, `expected JSON: ${args.join(" ")}`);
  return result.json;
}

function providerManifest(): string {
  return `schema: aidlc.provider/v1.1
provider_id: framework.java-loeyae-boot
name: Loeyae Boot E2E Fixture
version: 0.1.0
kind: validation
capabilities:
  - implementation-validation
selectors:
  languages: [java]
  frameworks: [loeyae-boot]
  profiles: [is_loeyae_boot]
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: loeyae-boot-baseline
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

function createProviderRemote(root: string): { url: string; commit: string } {
  const source = join(root, "provider-source");
  const remote = join(root, "provider-remote.git");
  const provider = join(source, "providers", "loeyae-boot");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "fixture@example.test");
  git(source, "config", "user.name", "Loeyae Fixture");
  write(join(provider, "provider.yaml"), providerManifest());
  write(join(provider, "rules", "catalog.json"), `${JSON.stringify({ rules: [{ id: "loeyae.entity.table-name", title: "Entity table", severity: "error", waivable: false }] })}\n`);
  write(join(provider, "provider.lock"), `${JSON.stringify({ lockfileVersion: 1, packages: {} })}\n`);
  write(join(provider, "sbom.spdx.json"), `${JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "loeyae-boot-e2e", documentNamespace: "https://example.test/loeyae-boot-e2e" })}\n`);
  write(join(provider, "bin", "validate.js"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const request = JSON.parse(fs.readFileSync(process.env.AIDLC_PROVIDER_REQUEST, "utf8"));
const input = request.inputs[0];
function files(root) { return fs.statSync(root).isDirectory() ? fs.readdirSync(root).flatMap((name) => files(path.join(root, name))) : [root]; }
const java = files(path.resolve(process.cwd(), input.sandbox_path)).find((file) => file.endsWith(".java"));
const source = java ? fs.readFileSync(java, "utf8") : "";
const passed = /@TableName\\(\\"orders_order\\"\\)/.test(source);
const check = { rule_id: "loeyae.entity.table-name", status: passed ? "passed" : "failed", severity: "error", message: passed ? "@TableName is valid" : "@TableName is invalid", locations: [{ path: input.logical_path + "/main/java/Order.java", line: 2 }] };
const result = { schema: "aidlc.provider-result/v1.1", invocation_id: request.invocation_id, status: passed ? "passed" : "failed", checks: [check], diagnostics: passed ? [] : [{ code: "CHECK_FAILED", message: "Loeyae rule failed" }], reports: [] };
fs.writeFileSync(path.resolve(process.cwd(), request.output.result_path), JSON.stringify(result) + "\\n");
`);
  git(source, "add", ".");
  git(source, "commit", "-m", "loeyae fixture");
  const commit = git(source, "rev-parse", "HEAD");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");
  return { url: pathToFileURL(remote).href, commit };
}

function instanceId(stage: { slug: string; axis: "project" | "module" | "unit" }): string {
  if (stage.axis === "project") return stage.slug;
  if (stage.axis === "module") return `${stage.slug}@module:orders`;
  return `${stage.slug}@module:orders@unit:orders-unit`;
}

function prepareWorkflow(project: string, scope: string, includeLegacyChecklist: boolean, loeyae = true, providerPass = true): void {
  mkdirSync(project, { recursive: true });
  git(project, "init", "-b", "main");
  git(project, "config", "user.email", "project@example.test");
  git(project, "config", "user.name", "Loeyae Project");
  write(join(project, ".gitignore"), ".aidlc/\naidlc/\n");
  write(join(project, "pom.xml"), "<project><modules><module>services/orders</module></modules></project>\n");
  write(join(project, "services", "orders", "pom.xml"), loeyae ? "<project><dependency>loeyae-boot</dependency></project>\n" : "<project><dependency>spring-boot</dependency></project>\n");
  write(join(project, "services", "orders", "src", "main", "java", "Order.java"), providerPass
    ? "// BUG-154\n@TableName(\"orders_order\")\nclass Order {}\n"
    : "// BUG-154\n@TableName(\"wrong_name\")\nclass Order {}\n");
  write(join(project, "docs", "aidlc", "ideation", "module-manifest.json"), `${JSON.stringify({ schema_version: 1, modules: [{ module_id: "orders", name: "Orders", service_id: "orders-service", paths: ["services/orders/src"] }] })}\n`);
  write(join(project, "docs", "aidlc", "modules", "orders", "inception", "unit-manifest.json"), `${JSON.stringify({ schema_version: 1, module_id: "orders", units: [{ unit_id: "orders-unit", name: "Orders unit", service_id: "orders-service", conditional_stages: ["loeyae-compliance"] }] })}\n`);
  if (includeLegacyChecklist) write(join(project, "docs", "aidlc", "framework-check.md"), "Loeyae framework skill loaded\n[x]\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "project fixture");

  const state: WorkflowState = createInitialState(scope, "4.13.3", `workflow-${scope}-${includeLegacyChecklist ? "shadow" : "enforce"}`, [], `MARS-154 ${scope}`);
  const target = graph.stages.findIndex((stage) => stage.slug === "loeyae-compliance");
  assert.ok(target >= 0);
  const skipped = graph.stages.slice(0, target).filter((stage) => stage.scopes.includes(scope)).map(instanceId);
  state.skipped_stage_instances = skipped.filter((id) => !id.startsWith("module-division") && !id.startsWith("units-generation"));
  state.skipped_stages = graph.stages.slice(0, target).filter((stage) => stage.scopes.includes(scope)).map((stage) => stage.slug);
  state.completed_stage_instances = ["module-division", "units-generation@module:orders"];
  state.completed_stages = ["module-division", "units-generation"];
  state.current_stage = "loeyae-compliance";
  state.current_phase = "construction";
  state.current_stage_instance = "loeyae-compliance@module:orders@unit:orders-unit";
  state.current_module = "orders";
  state.current_unit = "orders-unit";
  saveWorkflowState(project, state);
}

function installProvider(project: string, remote: { url: string; commit: string }, mode: "shadow" | "enforce"): void {
  write(join(project, ".aidlc", "provider-git-policy.json"), `${JSON.stringify({ version: 1, allow_file_fixtures: true, allowed_commits: [remote.commit] })}\n`);
  addProjectProvider(project, {
    source: remote.url,
    ref: "main",
    subdir: "providers/loeyae-boot",
    instance: "loeyae-boot",
    id: "framework.java-loeyae-boot",
    trust: "allowlisted-commit",
    allowFile: true,
    stages: ["loeyae-compliance"],
    capabilities: ["implementation-validation"],
  });
  write(join(project, ".aidlc", "provider-profile.json"), `${JSON.stringify({
    version: 1,
    active: "loeyae-java",
    profiles: { "loeyae-java": { facts: { languages: ["java"], frameworks: ["loeyae-boot"], profiles: ["is_loeyae_boot"] }, risk: { level: "standard", protected_gate: false } } },
  }, null, 2)}\n`);
  const status = setLoeyaeCompatibilityMode(project, mode, "loeyae-boot");
  assert.equal(status.mode, mode);
  assert.equal(status.provider_ready, true);
}

function sandbox(): RestrictedSandboxAdapter {
  return {
    probe: () => ({ supported: true, adapter: "mars-154-fixture", controls: { filesystem: true, network: true, environment: true, process: true, resources: true } }),
    execute: async (invocation: PreparedProviderInvocation) => {
      assert.equal((invocation.request.extensions?.["io.loeyae.aidlc"] as Record<string, unknown>)?.workflow_scope, "bugfix");
      assert.deepEqual(invocation.request.inputs.map((input) => input.logical_path), ["services/orders/src"]);
      const executed = spawnSync(process.execPath, [join(invocation.providerRoot, "bin", "validate.js"), "--request"], {
        cwd: invocation.sandboxRoot,
        encoding: "utf8",
        shell: false,
        env: { AIDLC_PROVIDER_REQUEST: invocation.requestPath, AIDLC_PROVIDER_OUTPUT: invocation.outputRoot },
      });
      return {
        exitCode: executed.status,
        signal: executed.signal,
        timedOut: false,
        cancelled: false,
        stdout: executed.stdout || "",
        stderr: executed.stderr || "",
      };
    },
  };
}

async function executeScenario(root: string, remote: { url: string; commit: string }, name: string, mode: "shadow" | "enforce", result: "passed" | "failed", legacy: boolean): Promise<{
  project: string;
  directive: Record<string, unknown>;
  evidenceId: string;
  gateId: string;
  report: Record<string, unknown>;
}> {
  const project = join(root, name);
  prepareWorkflow(project, "bugfix", legacy, true, result === "passed");
  installProvider(project, remote, mode);
  assert.equal(getLoeyaeCompatibilityStatus(project).authoritative, mode === "enforce" ? "provider-gate" : "legacy-framework-compliance");
  const directive = ok(project, ["orchestrate", "next"]);
  assert.equal(directive.stage, "loeyae-compliance");
  const actions = directive.provider_actions as Array<Record<string, unknown>>;
  assert.equal(actions.length, 1);
  assert.equal(actions[0].capability_id, "implementation-validation");
  assert.equal(actions[0].provider_instance_id, "loeyae-boot");
  const context = directive.provider_context as Record<string, unknown>;
  const plan = context.plan as Record<string, unknown>;
  const evidence = await runControlledProvider(project, {
    plan: String(plan.path),
    nodeId: String(actions[0].plan_node_id),
    inputs: [{ id: "source", path: "services/orders/src" }],
    sandbox: sandbox(),
  });
  const gate = evaluateProviderGate(project, { plan: String(plan.path), evidence: [evidence.evidence_id] });
  assert.equal(gate.decision.status, result === "passed" ? "passed" : "blocked");
  const report = ok(project, ["orchestrate", "report", "--stage", "loeyae-compliance", "--result", "completed", "--gate-decision", gate.decision.decision_id]);
  return { project, directive, evidenceId: evidence.evidence_id, gateId: gate.decision.decision_id, report };
}

const root = mkdtempSync(join(tmpdir(), "aidlc-mars-154-"));
try {
  const stage = graph.stages.find((candidate) => candidate.slug === "loeyae-compliance");
  assert.ok(stage);
  for (const scope of ["feature", "enterprise", "mvp", "classic", "bugfix", "refactor", "express", "workshop"]) assert.ok(stage.scopes.includes(scope), `${scope} must not skip implementation-validation`);
  assert.deepEqual(stage.provider_capabilities, ["implementation-validation"]);

  const remote = createProviderRemote(root);

  // A nested module pom is sufficient for machine routing; a non-Loeyae module is skipped before Provider resolution.
  const legacyLoeyae = join(root, "legacy-multimodule");
  prepareWorkflow(legacyLoeyae, "bugfix", true, true);
  const legacyDirective = ok(legacyLoeyae, ["orchestrate", "next"]);
  assert.equal(legacyDirective.stage, "loeyae-compliance");
  assert.equal("provider_actions" in legacyDirective, false, "legacy mode must not require an installed Provider");

  const nonLoeyae = join(root, "non-loeyae");
  prepareWorkflow(nonLoeyae, "bugfix", true, false);
  const nonLoeyaeDirective = run(nonLoeyae, ["orchestrate", "next"]);
  assert.notEqual(nonLoeyaeDirective.status, 0, "synthetic fixture intentionally lacks downstream code-review artifacts");
  assert.match(`${nonLoeyaeDirective.stdout}\n${nonLoeyaeDirective.stderr}`, /code-review@module:orders@unit:orders-unit/);
  assert.doesNotMatch(`${nonLoeyaeDirective.stdout}\n${nonLoeyaeDirective.stderr}`, /Provider resolution|implementation-validation|provider_actions/);
  const nonLoeyaeState = readFileSync(join(nonLoeyae, "aidlc", "active", "aidlc-state.md"), "utf8");
  assert.match(nonLoeyaeState, /loeyae-compliance@module:orders@unit:orders-unit/);

  // Shadow: old gate remains authoritative. A blocked Provider Gate is retained and reconciled with Rule/path diagnostics.
  const shadowMismatch = await executeScenario(root, remote, "shadow-mismatch", "shadow", "failed", true);
  const mismatch = (shadowMismatch.report.provider_reconciliation as Record<string, unknown>).result as Record<string, unknown>;
  assert.equal(mismatch.status, "mismatch");
  const ruleDiagnostics = mismatch.rule_diagnostics as Array<Record<string, unknown>>;
  assert.equal(ruleDiagnostics[0].rule_id, "loeyae.entity.table-name");
  assert.deepEqual(ruleDiagnostics[0].locations, [{ path: "services/orders/src/main/java/Order.java", line: 2 }]);
  assert.equal(((mismatch.rollback as Record<string, unknown>).action), "retain-legacy");

  // Enforce: Provider Gate is authoritative and Core projects a compatible framework-compliance Evidence when absent.
  const enforced = await executeScenario(root, remote, "enforce-pass", "enforce", "passed", false);
  const reconciliation = (enforced.report.provider_reconciliation as Record<string, unknown>).result as Record<string, unknown>;
  assert.equal(reconciliation.status, "matched");
  const legacyEvidence = join(enforced.project, ".aidlc", "evidence", "loeyae-compliance", "orders", "orders-unit", "framework-compliance.json");
  assert.equal(existsSync(legacyEvidence), true);
  const projected = JSON.parse(readFileSync(legacyEvidence, "utf8")) as Record<string, unknown>;
  assert.equal((projected.compatibility_adapter as Record<string, unknown>).provider_evidence_id, enforced.evidenceId);
  const reconciliationPath = (enforced.report.provider_reconciliation as Record<string, unknown>).path as string;
  assert.equal(existsSync(join(enforced.project, reconciliationPath)), true);

  // CR/source drift invalidates the old Plan/Gate before re-attestation.
  write(join(enforced.project, "services", "orders", "src", "main", "java", "Order.java"), "// BUG-154 changed\nclass Order {}\n");
  const stale = run(enforced.project, ["orchestrate", "report", "--stage", "loeyae-compliance", "--instance", "loeyae-compliance@module:orders@unit:orders-unit", "--result", "completed", "--gate-decision", enforced.gateId]);
  assert.notEqual(stale.status, 0);
  assert.match(`${stale.stdout}\n${stale.stderr}`, /PROVIDER_PLAN_STALE|source revision is stale/);

  // Rollback flips only the feature flag; all historical evidence, Gate and reconciliation artifacts remain.
  const providerEvidencePath = join(enforced.project, ".aidlc", "evidence", "providers", `${enforced.evidenceId}.json`);
  const gatePath = join(enforced.project, ".aidlc", "provider-gates", `${enforced.gateId}.json`);
  const rolledBack = setLoeyaeCompatibilityMode(enforced.project, "legacy");
  assert.equal(rolledBack.mode, "legacy");
  assert.equal(existsSync(legacyEvidence), true);
  assert.equal(existsSync(providerEvidencePath), true);
  assert.equal(existsSync(gatePath), true);
  assert.equal(existsSync(join(enforced.project, reconciliationPath)), true);
  const providerAudit = readFileSync(join(enforced.project, ".aidlc", "providers.audit.md"), "utf8");
  assert.match(providerAudit, /LOEYAE_COMPLIANCE_RECONCILED/);
  assert.match(providerAudit, /LOEYAE_COMPLIANCE_MODE_SET/);

  const cliHelp = ok(enforced.project, ["provider", "compatibility"]);
  assert.equal(cliHelp.mode, "legacy");
  const rootHelp = run(enforced.project, ["help"]);
  assert.equal(rootHelp.status, 0);
  assert.match(rootHelp.stdout, /provider compatibility/);

  console.log("MARS-154 Loeyae Provider migration and end-to-end tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
