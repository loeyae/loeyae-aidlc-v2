import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, setProjectProviderEnabled, updateProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { validateProviderRepositoryManifest, providerGitCachePath, verifyLockedProviderCache } from "../core/tools/aidlc-provider-git.js";
import { loadProviderKnowledge } from "../core/tools/aidlc-provider-knowledge.js";
import { createProjectProvidersLock, readProjectProviders, sha256FileDigest, sha256ProviderDigest, writeProjectProviders } from "../core/tools/aidlc-project-provider.js";
import { defaultResolutionPolicy, resolveProjectProviderPlan } from "../core/tools/aidlc-provider-resolver.js";
import { readCurrentProviderSourceRevision } from "../core/tools/aidlc-provider-runner.js";
import { fixtureEnvironment } from "./mars243_fixture_session.js";
import { consumeContextSource, readContextSourceContract, type ContextSourceOptions } from "../core/tools/aidlc-context-source.js";
import { acquireDesignResource, DESIGN_POLICY, readDesignResourceContract } from "../core/tools/aidlc-design-resource.js";
import { readUiReadContract } from "../core/tools/aidlc-ui-readonly.js";

const repository = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "aidlc-knowledge-contract-"));
const source = join(root, "source"), project = join(root, "project");
const external = ["context.read", "design.resource", "ui.read"];
const content = "Knowledge contract regression\n";
const knowledge = {
  schema: "aidlc.knowledge-package/v1", version: "0.1.0", topics: [{
    capability_id: "fixture.knowledge", topic: "fixture", sections: [{ id: "intro", path: "intro.md", digest: sha256FileDigest(content) }],
  }],
};
const sourceContracts = {
  "aidlc.context-source": { schema: "aidlc.context-source/v1", version: "0.1.0", connection: "context", tool: "read_context",
    scope_arguments: ["project"], request: { query: "query", limit: "limit", budget: "budget" },
    result: { items: "items", document: "document", revision: "revision", version: "version", fragment: "fragment", body: "body", title: "title", truncated: "truncated", degraded: "degraded", item_truncated: "item_truncated" } },
  "aidlc.design-resource": { schema: "aidlc.design-resource/v1", version: "0.1.0", style: "fixture", platform: "web", team: null,
    provenance: { repository: "https://example.test/design", revision: "a".repeat(40), path: "tokens.json", sha256: sha256FileDigest("tokens") },
    offline: { primary: "#123456" }, remote: null },
  "aidlc.ui-read-source": { schema: "aidlc.ui-read-source/v1", version: "0.1.0", connection: "ui", format: "sparse-xml-inline-png/v1", authentication: "fixture-bearer",
    operations: Object.fromEntries(["metadata", "variables", "screenshot"].map(role => [role, { tool: `read_${role}`, file_argument: "file", node_argument: "node", arguments: {} }])) },
};
const manifest = {
  schema: "aidlc.provider/v1.1", provider_id: "fixture.contract", name: "Contract fixture", version: "0.1.0",
  kind: "knowledge", capabilities: ["fixture.knowledge", ...external], entrypoint: { path: "never.js" },
  ruleset: { id: "fixture", version: "0.1.0", catalog: "rules.json" },
  artifacts: { lock: "provider.lock", sbom: "sbom.json" }, policies: { network: "none", writes: [] },
  extensions: { "aidlc.knowledge": knowledge },
};
const invalid = (value: unknown, message: RegExp = /aidlc\.knowledge/) => assert.throws(
  () => validateProviderRepositoryManifest(value), error => error instanceof Error
    && /PROVIDER_MANIFEST_INVALID/.test(error.message) && message.test(error.message),
);
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function commit(value: unknown): string {
  writeFileSync(join(source, "provider.yaml"), JSON.stringify(value));
  git(source, "add", "."); git(source, "commit", "-m", "contract fixture");
  return git(source, "rev-parse", "HEAD");
}
function plan() {
  return resolveProjectProviderPlan(project, { scope: { stage: "discovery" },
    source_revision: readCurrentProviderSourceRevision(project), policy: defaultResolutionPolicy(), freeze: true });
}
function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), ...args],
    { cwd: project, encoding: "utf8", shell: false, env: fixtureEnvironment(project, args) });
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
try {
  for (const extensions of [undefined, {}, { "aidlc.context-source": {} }, { "aidlc.design-resource": {} }, { "aidlc.ui-read-source": {} },
    { "aidlc.knowledge": null }, { "aidlc.knowledge": [] }, { "aidlc.knowledge": { ...knowledge, schema: "unsupported" } },
    { "aidlc.knowledge": { ...knowledge, version: "9.9.9" } }, { "aidlc.knowledge": { ...knowledge, topics: [] } }]) {
    invalid({ ...manifest, extensions });
  }
  for (const schema of ["aidlc.knowledge-package/v1", "aidlc.knowledge-package/v2"]) {
    assert.equal(validateProviderRepositoryManifest({ ...manifest, extensions: { "aidlc.knowledge": { ...knowledge, schema } } }).kind, "knowledge");
  }
  for (const dir of [source, project]) {
    mkdirSync(dir); git(dir, "init", "-b", "main");
    git(dir, "config", "user.name", "Fixture"); git(dir, "config", "user.email", "fixture@example.test");
  }
  for (const [path, bytes] of Object.entries({ "never.js": "throw new Error('must never run');", "rules.json": '{"rules":[]}',
    "provider.lock": "{}", "sbom.json": "{}", "intro.md": content })) writeFileSync(join(source, path), bytes);
  writeFileSync(join(project, "README.md"), "baseline\n"); git(project, "add", "."); git(project, "commit", "-m", "baseline");
  const sourceUrl = pathToFileURL(source).href;
  commit({ ...manifest, extensions: {} });
  assert.throws(() => addProjectProvider(project, { source: sourceUrl, ref: "main", instance: "fixture", allowFile: true }), /PROVIDER_MANIFEST_INVALID.*aidlc\.knowledge/);
  assert.equal(existsSync(join(project, ".aidlc/providers.lock.yaml")), false, "failed add must not publish a lock");
  commit(manifest);
  addProjectProvider(project, { source: sourceUrl, ref: "main", instance: "fixture", allowFile: true });
  const mixed = plan();
  assert.equal(mixed.plan.nodes.length, 4, "all bound capabilities remain selected and required");
  assert.equal(mixed.provider_actions.length, 1, "only the actual knowledge topic produces a confirmation action");
  assert.equal(mixed.provider_actions[0].capability_id, "fixture.knowledge");
  assert.equal(mixed.provider_actions[0].required_before, "stage-execution");
  assert.equal(loadProviderKnowledge(project, { plan: mixed.plan, nodeId: mixed.provider_actions[0].plan_node_id }).sections[0].content, content);

  const oldState = readProjectProviders(project);
  const legacyManifest = { ...manifest, extensions: sourceContracts };
  const legacyCommit = commit(legacyManifest);
  assert.throws(() => updateProjectProvider(project, "fixture", "main", { allowFile: true }), /PROVIDER_MANIFEST_INVALID.*aidlc\.knowledge/);
  assert.equal(readProjectProviders(project).lock.lock_digest, oldState.lock.lock_digest, "failed update preserves lock");
  // Model an installation made by the old engine: put the immutable old package in
  // the cache and publish its genuine digests, without weakening production install.
  const cache = providerGitCachePath(project, sourceUrl);
  git(cache, "-c", "protocol.file.allow=always", "fetch", sourceUrl, legacyCommit);
  const oldEntry = oldState.lock.providers[0];
  const entry = { ...oldEntry, source: { ...oldEntry.source, commit_oid: legacyCommit, tree_oid: git(source, "rev-parse", "HEAD^{tree}") },
    manifest: { ...oldEntry.manifest, digest: sha256FileDigest(readFileSync(join(source, "provider.yaml"))) } };
  writeProjectProviders(project, oldState.config, createProjectProvidersLock(oldState.config, [entry]));
  assert.equal(verifyLockedProviderCache(project, entry).status, "current");
  const legacy = plan();
  assert.equal(legacy.resolution.resolvable, true);
  assert.equal(legacy.plan.nodes.filter(node => node.required && node.state === "selected").length, 4);
  assert.deepEqual(legacy.provider_actions, [], "legacy sources must not gain a knowledge or quality action");
  assert.deepEqual(readContextSourceContract(project, "fixture"), sourceContracts["aidlc.context-source"]);
  assert.deepEqual(readDesignResourceContract(project, "fixture"), sourceContracts["aidlc.design-resource"]);
  assert.deepEqual(readUiReadContract(project, "fixture"), sourceContracts["aidlc.ui-read-source"]);
  assert.throws(() => loadProviderKnowledge(project, { plan: legacy.plan, nodeId: legacy.plan.nodes[0].node_id }), /PROVIDER_KNOWLEDGE_INVALID.*aidlc\.knowledge.*missing/);
  // Cache compatibility must still enforce locked bytes.
  assert.throws(() => verifyLockedProviderCache(project, { ...entry, manifest: { ...entry.manifest, digest: `sha256:${"0".repeat(64)}` } }), /PROVIDER_LOCK_MISMATCH/);

  cli("orchestrate", "next", "--scope", "express", "--work", "Legacy external sources");
  const next = cli("orchestrate", "next");
  assert.equal(next.kind, "run-stage", JSON.stringify(next));
  assert.deepEqual(next.provider_actions, []);
  const report = ["orchestrate", "report", "--stage", next.stage, "--result", next.approval === "block" ? "approved" : "completed"];
  if (next.completion_contract === "instruction_only") report.push("--instruction-ack", next.stage);
  const choices = next.choices ?? [];
  if (next.approval === "block" || choices.length) report.push("--user-input", next.approval === "block" ? "Approve" : choices[0]);
  cli(...report);

  setProjectProviderEnabled(project, "fixture", false);
  let network = 0, credentials = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { network++; throw new Error("disabled source must not call network"); };
  try {
    assert.equal(readContextSourceContract(project, "fixture"), undefined);
    assert.equal(readDesignResourceContract(project, "fixture"), undefined);
    assert.throws(() => readUiReadContract(project, "fixture"), /UI_READ_PROVIDER_DISABLED/);
    const binding = { schema: "aidlc.context-source-binding/v1" as const, project_id: "test", instance_id: "fixture", connection: "context", resource: "resource", arguments: { project: "test" } };
    const options = { project, policy: { project_id: "test", instance_id: "fixture", connection: "context" },
      currentContext: () => ({ project_id: "test" }), resolveCredential: async () => { credentials++; return "unused"; },
      sourcePolicy: { required: false, binding_digest: sha256ProviderDigest(binding), contract_digest: sha256ProviderDigest(sourceContracts["aidlc.context-source"]), max_chars: 100, max_items: 1 } } as unknown as ContextSourceOptions;
    const request = { instance_id: "fixture", resource: "resource", query: "test", limit: 1, max_chars: 100 };
    assert.equal((await consumeContextSource(options, binding, request)).status, "local");
    assert.equal((await consumeContextSource({ ...options, sourcePolicy: { ...options.sourcePolicy, required: true } }, binding, request)).status, "blocked");
    const selection = { required: false, style: "fixture", platform: "web", team: null, approval_ref: "fixture", instance_id: "fixture",
      contract_digest: sha256ProviderDigest(sourceContracts["aidlc.design-resource"]), resource: "resource", arguments: {} };
    const designPolicy = () => writeFileSync(join(project, DESIGN_POLICY), JSON.stringify({ schema: "aidlc.ui-design-policy/v1", project_id: "test", modules: { app: selection } }));
    designPolicy();
    assert.equal((await acquireDesignResource(project, "app")).status, "fallback");
    selection.required = true; designPolicy();
    await assert.rejects(() => acquireDesignResource(project, "app"), /DESIGN_REQUIRED_RESOURCE_UNAVAILABLE/);
    assert.equal(network, 0); assert.equal(credentials, 0);
  } finally { globalThis.fetch = originalFetch; }
  setProjectProviderEnabled(project, "fixture", true);

  for (const kind of ["validation", "command", "composite"]) {
    commit({ ...manifest, kind, extensions: {} });
    updateProjectProvider(project, "fixture", "main", { allowFile: true });
    const actions = plan().provider_actions;
    assert.equal(actions.length, 4);
    for (const action of actions) {
      assert.equal(action.type, kind); assert.equal(action.required_after, "stage-execution"); assert.equal(action.required_before, undefined);
    }
  }
  console.log("Provider knowledge contract: install/update fail-fast, legacy cache, mixed capabilities, next/report and other kinds passed");
} finally { rmSync(root, { recursive: true, force: true }); }
