import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { loadProviderKnowledge, confirmProviderKnowledge, verifyProviderKnowledge } from "../core/tools/aidlc-provider-knowledge.js";
import { defaultResolutionPolicy, resolveProjectProviderPlan, PROVIDER_PROFILE_REGISTRY_PATH } from "../core/tools/aidlc-provider-resolver.js";
import { readCurrentProviderSourceRevision } from "../core/tools/aidlc-provider-runner.js";
import { evaluateProviderGate } from "../core/tools/aidlc-provider-gate.js";

// Explicit external integration, never substituted with a synthetic knowledge fixture.
// Usage: tsx tests/test_external_provider_knowledge.ts <Git URL> <immutable commit>
const [source, commit] = process.argv.slice(2);
assert.ok(source && commit && /^[0-9a-f]{40}$/.test(commit), "pass an actual Provider repository URL and immutable commit");
const root = mkdtempSync(join(tmpdir(), "aidlc-external-knowledge-"));
function write(path: string, value: unknown): void { writeFileSync(join(root, path), JSON.stringify(value)); }
function git(...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
}
try {
  git("init", "-b", "main"); git("config", "user.email", "integration@example.test"); git("config", "user.name", "Integration");
  writeFileSync(join(root, "README.md"), "Actual receiving package integration\n");
  git("add", "README.md"); git("commit", "-m", "baseline");
  mkdirSync(join(root, ".aidlc"));
  write(".aidlc/provider-git-policy.json", { version: 1, allowed_hosts: source.startsWith("file:") ? [] : [new URL(source).hostname], allowed_commits: [commit], allow_file_fixtures: source.startsWith("file:") });
  addProjectProvider(root, { source, ref: commit, subdir: "providers/loeyae-boot-knowledge", instance: "framework-knowledge", trust: "allowlisted-commit", allowFile: source.startsWith("file:"), stages: ["code-generation"], capabilities: ["framework.conventions"] });
  write(PROVIDER_PROFILE_REGISTRY_PATH, { version: 1, active: "framework", profiles: { framework: { facts: { languages: ["java"], frameworks: ["loeyae-boot"] }, risk: { level: "standard", protected_gate: false } } } });
  const resolved = resolveProjectProviderPlan(root, { scope: { stage: "code-generation", module_id: "app", unit_id: "unit" }, source_revision: readCurrentProviderSourceRevision(root), policy: defaultResolutionPolicy(), freeze: true });
  assert.equal(resolved.plan.nodes.length, 1);
  const input = { plan: resolved.plan, nodeId: resolved.plan.nodes[0].node_id };
  const delivery = loadProviderKnowledge(root, input);
  assert.equal(delivery.provider_instance.commit_oid, commit);
  const byId = new Map(delivery.sections.map(section => [section.id, section.content]));
  for (const id of ["loeyae-test", "loeyae-test-base", "loeyae-test-utils", "loeyae-database-design", "project-context", "compliance", "terminology"]) {
    assert.ok(byId.has(id), `actual chapter missing: ${id}`);
  }
  assert.match(byId.get("entity")!, /@InsertFillTime/);
  assert.match(byId.get("testing")!, /BaseMockitoUnitTest/);
  assert.match(byId.get("terminology")!, /团队的 Java 后端开发框架/);
  assert.match(byId.get("project-context")!, /Starter/);
  assert.match(byId.get("compliance")!, /首次合规/);
  assert.throws(() => verifyProviderKnowledge(root, input), /confirmation is missing/);
  const confirmation = confirmProviderKnowledge(root, { ...input, deliveryDigest: delivery.delivery_digest, consumer: "external-package-integration" });
  assert.deepEqual(verifyProviderKnowledge(root, input), confirmation);
  assert.equal(confirmation.receipt.gate_eligible, false);
  assert.equal(evaluateProviderGate(root, { plan: resolved.plan, evidence: [] }).decision.status, "blocked");
  // A different framework must not receive domain knowledge even with the package installed.
  write(PROVIDER_PROFILE_REGISTRY_PATH, { version: 1, active: "other", profiles: { other: { facts: { languages: ["java"], frameworks: ["other"] }, risk: { level: "standard", protected_gate: false } } } });
  const other = resolveProjectProviderPlan(root, { scope: input.plan.scope, source_revision: readCurrentProviderSourceRevision(root), policy: defaultResolutionPolicy() });
  assert.equal(other.provider_actions.length, 0);
  console.log(`Actual external knowledge install/lock/load/Core receipt passed: ${commit}; ${delivery.sections.length} chapters; validation Gate remains blocked`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
