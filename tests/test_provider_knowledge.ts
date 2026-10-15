import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, runProviderCli, updateProjectProvider } from "../core/tools/aidlc-provider-cli.js";
import { confirmProviderKnowledge, loadProviderKnowledge, verifyProviderKnowledge } from "../core/tools/aidlc-provider-knowledge.js";
import { defaultResolutionPolicy, freezeProviderPlan, recomputePlanDigest, recomputePlanId, resolveProjectProviderPlan } from "../core/tools/aidlc-provider-resolver.js";
import { readCurrentProviderSourceRevision, runControlledProvider } from "../core/tools/aidlc-provider-runner.js";
import { canonicalProviderJson } from "../core/tools/aidlc-project-provider.js";
import { localProviderArtifactSigner, parseProviderEvidence } from "../core/tools/aidlc-provider-evidence.js";
import { evaluateProviderGate } from "../core/tools/aidlc-provider-gate.js";

const repository = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "aidlc-knowledge-"));
const source = join(root, "source");
const project = join(root, "project");
function write(path: string, content: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}
function cli(...args: string[]): Record<string, any> {
  const result = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"), ...args], { cwd: project, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
const content = "# Framework conventions\n本章节作为参考资料，不具有 Core 写权限。\n";
const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
function manifest(path = "knowledge/conventions.md", expectedDigest = digest, version = "0.1.0"): object {
  return {
    schema: "aidlc.provider/v1.1", provider_id: "fixture.knowledge", name: "Offline knowledge", version: "0.1.0",
    kind: "knowledge", capabilities: ["fixture.conventions"], entrypoint: { path: "bin/never.js" },
    ruleset: { id: "fixture-rules", version: "0.1.0", catalog: "rules.json" },
    artifacts: { lock: "provider.lock", sbom: "sbom.json" }, policies: { network: "none", writes: [] },
    extensions: { "aidlc.knowledge": { schema: "aidlc.knowledge-package/v1", version, topics: [{
      capability_id: "fixture.conventions", topic: "framework", sections: [{ id: "conventions", path, digest: expectedDigest }],
    }] } },
  };
}
function plan() {
  return resolveProjectProviderPlan(project, {
    scope: { stage: "discovery", module_id: "app", unit_id: "unit-a" },
    source_revision: readCurrentProviderSourceRevision(project), policy: defaultResolutionPolicy(), freeze: true,
  }).plan;
}
try {
  for (const directory of [source, project]) {
    mkdirSync(directory, { recursive: true }); git(directory, "init", "-b", "main");
    git(directory, "config", "user.email", "fixture@example.test"); git(directory, "config", "user.name", "Fixture");
  }
  // Package subdirectory containment is tested too.
  const pkg = join(source, "package");
  write(join(pkg, "provider.yaml"), JSON.stringify(manifest()));
  write(join(pkg, "knowledge/conventions.md"), content);
  write(join(pkg, "bin/never.js"), `require('fs').writeFileSync(${JSON.stringify(join(project, "entrypoint-ran"))}, 'bad');`);
  write(join(source, "package.json"), JSON.stringify({ scripts: { install: "exit 1", postinstall: "exit 1" } }));
  write(join(pkg, "rules.json"), JSON.stringify({ rules: [{ id: "fixture.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] }));
  write(join(pkg, "provider.lock"), JSON.stringify({ lockfileVersion: 1, packages: {} }));
  write(join(pkg, "sbom.json"), JSON.stringify({ spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "fixture", documentNamespace: "https://example.test/fixture" }));
  git(source, "add", "."); git(source, "commit", "-m", "knowledge fixture");
  write(join(project, "README.md"), "fixture\n"); git(project, "add", "."); git(project, "commit", "-m", "baseline");
  addProjectProvider(project, { source: pathToFileURL(source).href, ref: "main", subdir: "package", instance: "knowledge", allowFile: true });
  const lockedPlan = plan();
  const nodeId = lockedPlan.nodes[0].node_id;
  const input = { plan: lockedPlan, nodeId };
  renameSync(source, `${source}-offline`);
  const delivery = loadProviderKnowledge(project, input);
  assert.equal(delivery.sections[0].content, content);
  assert.deepEqual(loadProviderKnowledge(project, input), delivery, "delivery is deterministic and offline");
  assert.throws(() => verifyProviderKnowledge(project, input), /confirmation is missing/);
  assert.throws(() => confirmProviderKnowledge(project, { ...input, deliveryDigest: `sha256:${"0".repeat(64)}`, consumer: "host-1" }), /does not match/);
  const confirmation = confirmProviderKnowledge(project, { ...input, deliveryDigest: delivery.delivery_digest, consumer: "host-1" });
  assert.deepEqual(verifyProviderKnowledge(project, input), confirmation);
  assert.equal(confirmation.receipt.gate_eligible, false);
  assert.throws(() => parseProviderEvidence(confirmation.receipt), /PROVIDER_/);
  assert.equal(evaluateProviderGate(project, { plan: lockedPlan, evidence: [] }).decision.status, "blocked", "knowledge cannot satisfy a quality Gate");
  await assert.rejects(() => runControlledProvider(project, { plan: lockedPlan, nodeId, sandbox: {
    probe: () => ({ supported: true, adapter: "fixture", controls: { filesystem: true, network: true, environment: true, process: true, resources: true } }),
    execute: async () => { throw new Error("knowledge entrypoint must never execute"); },
  } }), /knowledge-load/);
  assert.equal(existsSync(join(project, "entrypoint-ran")), false);
  const receiptPath = join(project, ".aidlc/provider-knowledge", `${confirmation.receipt.receipt_id}.json`);
  const good = readFileSync(receiptPath, "utf8");
  write(receiptPath, good.replace('"host-1"', '"forged"'));
  assert.throws(() => verifyProviderKnowledge(project, input), /forged/);
  write(receiptPath, good);
  const expired = JSON.parse(good);
  expired.expires_at = "2000-01-01T00:00:00.000Z";
  const signer = localProviderArtifactSigner(project);
  const { signature: ignored, ...expiredPayload } = expired;
  expired.signature.value = signer.sign(canonicalProviderJson(expiredPayload));
  write(receiptPath, JSON.stringify(expired));
  assert.throws(() => verifyProviderKnowledge(project, input), /expired/);
  write(receiptPath, good);
  const alteredScope = { ...lockedPlan, scope: { ...lockedPlan.scope, unit_id: "unit-b" } };
  const scoped = { ...alteredScope, plan_id: recomputePlanId(alteredScope) };
  scoped.plan_digest = recomputePlanDigest(scoped);
  assert.throws(() => verifyProviderKnowledge(project, { plan: scoped, nodeId }), /confirmation is missing/);
  assert.throws(() => loadProviderKnowledge(project, { plan: { ...lockedPlan, project_lock_digest: `sha256:${"0".repeat(64)}` }, nodeId }), /Plan identity/);
  assert.throws(() => loadProviderKnowledge(project, { plan: lockedPlan, nodeId: "missing" }), /no node/);
  assert.throws(() => loadProviderKnowledge(project, { plan: { ...lockedPlan, plan_id: `plan-${"0".repeat(32)}` }, nodeId }), /Plan identity/);
  const throughCli = runProviderCli(["knowledge-load", "--project", project, "--plan", lockedPlan.plan_id, "--node", nodeId]);
  assert.deepEqual(throughCli, delivery);
  write(join(project, "README.md"), "source drift\n");
  assert.throws(() => verifyProviderKnowledge(project, input), /source revision/);
  write(join(project, "README.md"), "fixture\n");
  renameSync(`${source}-offline`, source);

  // Each malformed declaration is committed and locked through the real lifecycle.
  for (const [path, expectedDigest, version, error] of [
    ["knowledge/missing.md", digest, "0.1.0", /missing/],
    ["knowledge/conventions.md", `sha256:${"0".repeat(64)}`, "0.1.0", /digest mismatch/],
    ["../outside.md", digest, "0.1.0", /escapes/],
    ["/absolute.md", digest, "0.1.0", /escapes/],
    ["knowledge/conventions.md", digest, "0.2.0", /version mismatch/],
  ] as const) {
    write(join(pkg, "provider.yaml"), JSON.stringify(manifest(path, expectedDigest, version)));
    git(source, "add", "."); git(source, "commit", "-m", `bad declaration ${path} ${version}`);
    updateProjectProvider(project, "knowledge", "main", { allowFile: true });
    const badPlan = plan();
    assert.throws(() => loadProviderKnowledge(project, { plan: badPlan, nodeId: badPlan.nodes[0].node_id }), error);
    assert.throws(() => verifyProviderKnowledge(project, input), /current lock/);
  }

  write(join(pkg, "provider.yaml"), JSON.stringify(manifest("knowledge/link.md")));
  write(join(pkg, "knowledge/link.md"), "../outside.md");
  git(source, "add", ".");
  const linkOid = git(source, "hash-object", join(pkg, "knowledge/link.md"));
  git(source, "update-index", "--cacheinfo", `120000,${linkOid},package/knowledge/link.md`);
  git(source, "commit", "-m", "symlink chapter fixture");
  updateProjectProvider(project, "knowledge", "main", { allowFile: true });
  const linkPlan = plan();
  assert.throws(() => loadProviderKnowledge(project, { plan: linkPlan, nodeId: linkPlan.nodes[0].node_id }), /symlink/);

  // The existing orchestrate path must stop before stage execution or state writes.
  write(join(pkg, "provider.yaml"), JSON.stringify(manifest()));
  git(source, "add", "."); git(source, "commit", "-m", "restore valid package");
  updateProjectProvider(project, "knowledge", "main", { allowFile: true });
  cli("orchestrate", "next", "--scope", "express", "--work", "Knowledge fixture");
  const pending = cli("orchestrate", "next");
  assert.equal(pending.ask_type, "provider-knowledge-confirmation");
  const statePath = join(project, "aidlc/active/aidlc-state.md");
  const before = readFileSync(statePath, "utf8");
  assert.equal(cli("orchestrate", "next").ask_type, "provider-knowledge-confirmation");
  assert.equal(readFileSync(statePath, "utf8"), before);
  const ctx = pending.provider_context;
  let currentReceiptPath = "";
  for (const action of pending.provider_actions) {
    const loaded = cli("provider", "knowledge-load", "--plan", ctx.plan.id, "--node", action.plan_node_id);
    const confirmed = cli("provider", "knowledge-confirm", "--plan", ctx.plan.id, "--node", action.plan_node_id,
      "--delivery-digest", loaded.delivery_digest, "--consumer", "fixture-host-session");
    currentReceiptPath = join(project, ".aidlc/provider-knowledge", `${confirmed.receipt.receipt_id}.json`);
    cli("provider", "knowledge-verify", "--plan", ctx.plan.id, "--node", action.plan_node_id);
  }
  const admitted = cli("orchestrate", "next");
  assert.equal(admitted.kind, "run-stage");
  const stateBeforeReport = readFileSync(statePath, "utf8");
  const confirmedBytes = readFileSync(currentReceiptPath, "utf8");
  rmSync(currentReceiptPath);
  const denied = spawnSync(process.execPath, [join(repository, "node_modules/tsx/dist/cli.mjs"), join(repository, "bin/cli.ts"),
    "orchestrate", "report", "--stage", admitted.stage, "--result", "completed", "--instruction-ack", admitted.stage],
    { cwd: project, encoding: "utf8", shell: false });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stdout + denied.stderr, /knowledge confirmation is missing/);
  assert.equal(readFileSync(statePath, "utf8"), stateBeforeReport, "report cannot bypass knowledge confirmation");
  write(currentReceiptPath, confirmedBytes);
  console.log("Provider offline knowledge / confirmation / orchestrate tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
