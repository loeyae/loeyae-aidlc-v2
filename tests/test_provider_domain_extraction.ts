import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import {
  assertPlanResolvable,
  defaultResolutionPolicy,
  resolveProjectProviderPlan,
  PROVIDER_PROFILE_REGISTRY_PATH,
} from "../core/tools/aidlc-provider-resolver.js";
import { runControlledProvider, readCurrentProviderSourceRevision, type PreparedProviderInvocation, type RestrictedSandboxAdapter } from "../core/tools/aidlc-provider-runner.js";
import { evaluateProviderGate, verifyGateDecisionForReport } from "../core/tools/aidlc-provider-gate.js";
import { PROJECT_PROVIDERS_PATH, PROJECT_PROVIDERS_LOCK_PATH } from "../core/tools/aidlc-project-provider.js";
import type { ProviderScope } from "../core/tools/aidlc-provider-types.js";

// Domain-agnostic regression for the Provider domain extraction (replaces the former
// test_loeyae_provider_migration). With no reference to any Loeyae-specific stage, sensor,
// compatibility layer or is_loeyae_boot detection, it proves:
//   1. Core no longer ships the extracted domain files or domain strings.
//   2. A project that binds a Provider to the generic code-generation Hook via
//      `provider add --stage code-generation --capability implementation-validation`
//      makes the generic Resolver emit a required provider action, the generic Runner
//      produce Evidence, and the generic Gate issue a GateDecision that
//      verifyGateDecisionForReport (the orchestrate report gate) accepts.
//   3. The same code-generation scope with no Provider installed produces no provider
//      actions — behavior is unchanged.

const repository = resolve(import.meta.dirname, "..");
const CODE_GENERATION = "code-generation";
const CAPABILITY = "implementation-validation";

// Product names / protocol owner repositories use loeyae-aidlc and are intentionally
// outside this domain pattern. Migration notes and negative fixtures are not production roots.
const domainPattern = /is_loeyae_boot|loeyae-compliance|framework-compliance|aidlc-provider-compatibility|LoeyaeCompatibility|reconcileLoeyae|projectProviderEvidenceToLegacy|Loeyae\s+Boot|loeyae[-_.]?(?:boot|starter)|loeyae-(?:test|database|crud|error-handling|validation|data-access|framework-modules)\b|@InsertFill(?:Time|Data)|BaseMockitoUnitTest|BaseDbUnitTest|\bloeyae-skills\b|mcp-skills\.allbelieves\.com/i;

// These shared registrations also serve ai-context-file-guide, which has no replacement
// in the migrated domain package. Permit only their exact existing server payloads.
const sharedKnowledgeServers: Record<string, object> = {
  "harness/claude/plugin.json": { type: "http", url: "https://mcp-skills.allbelieves.com/mcp" },
  "harness/codebuddy/.mcp.json": { type: "http", url: "https://mcp-skills.allbelieves.com/mcp" },
  "harness/qoder/.mcp.json": { type: "http", url: "https://mcp-skills.allbelieves.com/mcp" },
  "harness/zcode/.mcp.json": { type: "http", url: "https://mcp-skills.allbelieves.com/mcp" },
  "harness/kiro-crew/mcp.json": { type: "http", url: "https://mcp-skills.allbelieves.com/mcp", disabled: false, autoApprove: ["get_skill_outline", "get_skill_section", "get_skill_summary", "get_skill_content", "search_skill"] },
  "harness/qoder/mcp-cn.json": { command: "npx", args: ["-y", "mcp-remote@0.8.3", "https://mcp-skills.allbelieves.com/mcp", "--transport", "http-only"] },
};

function domainOffenders(root: string): string[] {
  const offenders: string[] = [];
  for (const dir of ["core", "bin", "scripts", "harness"]) {
    for (const file of listFilesRecursive(join(root, dir))) {
      const path = relative(root, file).replace(/\\/g, "/");
      let content = readFileSync(file, "utf8");
      if (Object.hasOwn(sharedKnowledgeServers, path)) {
        const config = JSON.parse(content);
        assert.deepEqual(config.mcpServers["loeyae-skills"], sharedKnowledgeServers[path], `shared service exception changed: ${path}`);
        delete config.mcpServers["loeyae-skills"];
        content = JSON.stringify(config);
      }
      if (domainPattern.test(path) || domainPattern.test(content)) offenders.push(path);
    }
  }
  return offenders;
}

function assertDomainScannerRejectsProductionRegressions(): void {
  const root = mkdtempSync(join(tmpdir(), "aidlc-domain-scan-"));
  try {
    for (const [path, token] of [
      ["core/knowledge/testing.md", "loeyae-test-utils"],
      ["core/knowledge/database.md", "@InsertFillData"],
      ["core/stages/state.md", "Loeyae Boot 版本与 Starter"],
      ["core/tools/data/profile.json", '{"framework":"loeyae-boot"}'],
      ["core/tools/data/fields.json", '{"loeyaeBootVersion":"1.0","loeyaeStarter":"web"}'],
      ["harness/new/mcp.json", '{"mcpServers":{"loeyae-skills":{}}}'],
      ["harness/new/prompt.md", "loeyae-database-design"],
      ["scripts/check.ts", "is_loeyae_boot"],
    ]) {
      write(join(root, path), token);
      assert.deepEqual(domainOffenders(root), [path], `scanner must reject production ${path}`);
      rmSync(join(root, path));
    }
    write(join(root, "core/tools/data/owner.json"), '{"owner":"loeyae-aidlc-provider","schema":"urn:loeyae:aidlc:schema:provider:1.1"}');
    write(join(root, "harness/new/product.md"), "Loeyae AI-DLC / loeyae-aidlc");
    assert.deepEqual(domainOffenders(root), [], "product and protocol names remain valid");
    const path = "harness/claude/plugin.json";
    write(join(root, path), JSON.stringify({ mcpServers: { "loeyae-skills": sharedKnowledgeServers[path] }, extra: "loeyae-test" }));
    assert.deepEqual(domainOffenders(root), [path], "an allowed service must not hide other production domain content");
    write(join(root, path), JSON.stringify({ mcpServers: { "loeyae-skills": { ...sharedKnowledgeServers[path], domain: "loeyae-boot" } } }));
    assert.throws(() => domainOffenders(root), /shared service exception changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const graph = JSON.parse(readFileSync(join(repository, "core", "tools", "data", "stage-graph.json"), "utf8")) as {
  stage_count: number;
  conditions: string[];
  stages: Array<{ slug: string; provider_capabilities?: string[] }>;
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

// ── 1) Core no longer ships the extracted domain ──────────────────────────────
function assertDomainExtractedFromCore(): void {
  for (const relative of [
    "core/stages/construction/construction-loeyae-compliance.md",
    "core/sensors/framework-compliance.md",
    "core/tools/aidlc-provider-compatibility.ts",
  ]) {
    assert.equal(existsSync(join(repository, relative)), false, `Core must not ship ${relative}`);
  }

  assert.equal(graph.stages.some((stage) => stage.slug === "loeyae-compliance"), false, "stage graph must not contain loeyae-compliance");
  assert.equal(graph.conditions.includes("is_loeyae_boot"), false, "stage graph must not list is_loeyae_boot condition");
  assert.equal(/framework-compliance/.test(JSON.stringify(graph)), false, "stage graph must not reference the framework-compliance sensor");

  // No Core source file carries the extracted domain identifiers. dist/ is build output
  // rebuilt from these sources and is covered by build:all / distribution-parity.
  const offenders = domainOffenders(repository);
  assert.deepEqual(offenders, [], `Core source must not reference the extracted Loeyae domain:\n${offenders.join("\n")}`);

  // The generic Provider lifecycle Hook survives: a generic resolution policy and the
  // untouched provider_capabilities mechanism remain in orchestrate.
  const orchestrate = readFileSync(join(repository, "core", "tools", "aidlc-orchestrate.ts"), "utf8");
  assert.match(orchestrate, /stageResolutionPolicyId/, "generic stage resolution policy must remain");
  assert.match(orchestrate, /provider_capabilities/, "generic provider_capabilities support must remain");
}

// ── Generic Provider fixture bound to code-generation ─────────────────────────
function providerManifest(): string {
  return `schema: aidlc.provider/v1.1
provider_id: framework.generic-impl-validation
name: Generic Implementation Validation Fixture
version: 0.1.0
kind: validation
capabilities:
  - ${CAPABILITY}
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: generic-impl-baseline
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
  const provider = join(source, "providers", "fixture");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "fixture@example.test");
  git(source, "config", "user.name", "Generic Fixture");
  write(join(provider, "provider.yaml"), providerManifest());
  write(join(provider, "rules", "catalog.json"), `${JSON.stringify({ rules: [{ id: "generic.impl.rule", title: "Impl rule", severity: "error", appliesTo: ["source"] }] })}\n`);
  write(join(provider, "provider.lock"), `${JSON.stringify({ lockfileVersion: 1, packages: {} })}\n`);
  write(join(provider, "sbom.spdx.json"), `${JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "generic-impl-fixture", documentNamespace: "https://example.test/sbom/generic-impl/0.1.0" })}\n`);
  write(join(provider, "bin", "validate.js"), "#!/usr/bin/env node\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "generic provider fixture");
  const commit = git(source, "rev-parse", "HEAD");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");
  return { url: pathToFileURL(remote).href, commit };
}

function initProject(project: string): string {
  mkdirSync(project, { recursive: true });
  git(project, "init", "-b", "main");
  git(project, "config", "user.email", "project@example.test");
  git(project, "config", "user.name", "Generic Project");
  write(join(project, ".gitignore"), ".aidlc/\naidlc/\n");
  write(join(project, "pom.xml"), "<project></project>\n");
  write(join(project, "services", "orders", "src", "main", "java", "Order.java"), "class Order {}\n");
  git(project, "add", ".");
  git(project, "commit", "-m", "project baseline");
  const commit = git(project, "rev-parse", "HEAD");
  return commit;
}

function codeGenerationScope(): ProviderScope {
  return { stage: CODE_GENERATION, module_id: "orders", unit_id: "orders-unit" };
}

function sandbox(): RestrictedSandboxAdapter {
  return {
    probe: () => ({ supported: true, adapter: "generic-fixture", controls: { filesystem: true, network: true, environment: true, process: true, resources: true } }),
    execute: async (invocation: PreparedProviderInvocation) => {
      writeFileSync(join(invocation.outputRoot, "result.json"), `${JSON.stringify({
        schema: "aidlc.provider-result/v1.1",
        invocation_id: invocation.invocationId,
        status: "passed",
        checks: [{ rule_id: "generic.impl.rule", status: "passed", severity: "error", message: "ok" }],
        diagnostics: [],
        reports: [],
      })}\n`, "utf8");
      return { exitCode: 0, signal: null, timedOut: false, cancelled: false, stdout: "", stderr: "" };
    },
  };
}

async function main(): Promise<void> {
  assertDomainScannerRejectsProductionRegressions();
  assertDomainExtractedFromCore();

  const root = mkdtempSync(join(tmpdir(), "aidlc-provider-extraction-"));
  try {
    const remote = createProviderRemote(root);

    // ── 2) code-generation binding → generic Resolver emits a required action, and the
    //       generic Runner + Gate produce a GateDecision the report path accepts ────────
    const withProvider = join(root, "with-provider");
    initProject(withProvider);
    write(join(withProvider, ".aidlc", "provider-git-policy.json"), `${JSON.stringify({ version: 1, allow_file_fixtures: true, allowed_commits: [remote.commit] })}\n`);
    addProjectProvider(withProvider, {
      source: remote.url,
      ref: "main",
      subdir: "providers/fixture",
      instance: "impl-validation",
      id: "framework.generic-impl-validation",
      trust: "allowlisted-commit",
      allowFile: true,
      stages: [CODE_GENERATION],
      capabilities: [CAPABILITY],
    });
    write(join(withProvider, PROVIDER_PROFILE_REGISTRY_PATH), `${JSON.stringify({
      version: 1,
      active: "generic",
      profiles: { generic: { facts: { languages: ["java"] }, risk: { level: "standard", protected_gate: false } } },
    }, null, 2)}\n`);

    const revision = readCurrentProviderSourceRevision(withProvider);
    const resolved = resolveProjectProviderPlan(withProvider, {
      scope: codeGenerationScope(),
      source_revision: revision,
      policy: defaultResolutionPolicy({ policy_id: `aidlc.orchestrate-stage/${CODE_GENERATION}` }),
      freeze: true,
    });
    assertPlanResolvable(resolved.resolution);
    assert.equal(resolved.provider_actions.length, 1, "code-generation binding must resolve exactly one provider action");
    const action = resolved.provider_actions[0];
    assert.equal(action.capability_id, CAPABILITY);
    assert.equal(action.provider_instance_id, "impl-validation");
    assert.equal(action.required, true, "a bound implementation-validation action is required → gate is enforced");
    assert.ok(resolved.provider_context.plan.path && existsSync(join(withProvider, String(resolved.provider_context.plan.path))));

    // Generic Runner + Gate over the resolved plan.
    const evidence = await runControlledProvider(withProvider, {
      plan: String(resolved.provider_context.plan.path),
      nodeId: String(action.plan_node_id),
      sandbox: sandbox(),
    });
    const gate = evaluateProviderGate(withProvider, { plan: String(resolved.provider_context.plan.path), evidence: [evidence.evidence_id] });
    assert.equal(gate.decision.status, "passed", "a passing Evidence must yield a passing generic GateDecision");

    // The report gate accepts a current passing GateDecision for this scope (no exception).
    const verified = verifyGateDecisionForReport(withProvider, gate.decision.decision_id, {
      scope: codeGenerationScope(),
      sourceRevision: revision,
      resolutionPolicy: defaultResolutionPolicy({ policy_id: `aidlc.orchestrate-stage/${CODE_GENERATION}` }),
    });
    assert.equal(verified.decision_id, gate.decision.decision_id, "report gate must accept the current passing GateDecision");

    // A forged GateDecision id must be refused by the report gate.
    assert.throws(() => verifyGateDecisionForReport(withProvider, `gate-${"0".repeat(32)}`, {
      scope: codeGenerationScope(),
      sourceRevision: revision,
      resolutionPolicy: defaultResolutionPolicy({ policy_id: `aidlc.orchestrate-stage/${CODE_GENERATION}` }),
    }), "forged GateDecision must be refused");

    // ── 3) no Provider installed → the generic Hook short-circuits (no provider actions) ─
    // Core's prepareProviderDirective returns null when neither the project provider config
    // nor its lock exists, so no provider_actions are ever emitted and behavior is unchanged.
    const withoutProvider = join(root, "without-provider");
    initProject(withoutProvider);
    const configPath = join(withoutProvider, PROJECT_PROVIDERS_PATH);
    const lockPath = join(withoutProvider, PROJECT_PROVIDERS_LOCK_PATH);
    assert.equal(existsSync(configPath), false, "a project with no Provider must have no provider config");
    assert.equal(existsSync(lockPath), false, "a project with no Provider must have no provider lock");
    const next = spawnSync(process.execPath, [
      join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"),
      "orchestrate", "next", "--scope", "feature", "--work", "Implement order export",
    ], { cwd: withoutProvider, encoding: "utf8", shell: false });
    assert.equal(next.status, 0, `${next.stdout}\n${next.stderr}`);
    const directive = JSON.parse(next.stdout);
    assert.equal((directive.provider_actions ?? []).length, 0, "no Provider project emits no Provider actions");
    assert.equal(domainPattern.test(next.stdout), false, "no Provider directive must not contain domain placeholders");

    console.log("Provider domain extraction + generic hook regression passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
