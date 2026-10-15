import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, runProviderCli, setProjectProviderEnabled } from "../core/tools/aidlc-provider-cli.js";
import { applyProviderMcp, planProviderMcp } from "../core/tools/aidlc-provider-mcp-apply.js";
import { MCP_REQUIREMENTS_SCHEMA } from "../core/tools/aidlc-provider-mcp.js";
import { sha256ProviderDigest } from "../core/tools/aidlc-project-provider.js";

const root = mkdtempSync(join(tmpdir(), "aidlc-mcp-apply-"));
const source = join(root, "source");
const repo = resolve(import.meta.dirname, "..");
function write(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function json(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const config = { type: "stdio", command: "fixture-service", args: ["--offline"] };
const digest = sha256ProviderDigest(config);
const ledger = (host: string) => `${host}.aidlc-mcp-ledger.json`;
const journal = (host: string) => `${host}.aidlc-mcp-journal.json`;
let sequence = 0;
function fixture(pkg = "primary") {
  const project = join(root, `project-${sequence++}`);
  const host = join(root, `host-${sequence++}.json`);
  mkdirSync(project);
  addProjectProvider(project, { source: pathToFileURL(source).href, ref: "main", subdir: pkg, instance: pkg, allowFile: true });
  write(host, { mcpServers: {}, setting: "keep" });
  return { project, host };
}
function plan(f: { project: string; host: string }) { return planProviderMcp(f.project, { hostConfig: f.host }); }
function apply(f: { project: string; host: string }, value = plan(f), fault?: Parameters<typeof applyProviderMcp>[2]) {
  return applyProviderMcp(f.project, { hostConfig: f.host, plan: value, approvedConfigs: [digest] }, fault);
}
function stop(point: string) { return (actual: string) => { if (actual === point) throw new Error(`injected ${point}`); }; }
function unchanged(f: { host: string }, fn: () => void) {
  const paths = [f.host, ledger(f.host), journal(f.host)];
  const before = paths.map((path) => existsSync(path) ? readFileSync(path).toString("base64") : null);
  fn();
  assert.deepEqual(paths.map((path) => existsSync(path) ? readFileSync(path).toString("base64") : null), before);
}
try {
  mkdirSync(source);
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture");
  const packages = {
    primary: [{ name: "fixture-service", credential_domain: "none", config }],
    second: [{ name: "second-service", credential_domain: "none", config }],
    realm: [{ name: "fixture-service", credential_domain: "tenant-a", config }],
    "realm-other": [{ name: "fixture-service", credential_domain: "tenant-b", config }],
    secret: [{ name: "secret-service", credential_domain: "tenant-a", config: { ...config, env: { TOKEN: "actual-secret-value" } } }],
    reference: [{ name: "reference-service", credential_domain: "tenant-a", config: { ...config, env: { TOKEN: "${env:FIXTURE_TOKEN}" } } }],
  };
  for (const [name, connections] of Object.entries(packages)) {
    const pkg = join(source, name);
    write(join(pkg, "provider.yaml"), {
      schema: "aidlc.provider/v1.1", provider_id: `fixture.${name.toLowerCase()}`, name, version: "0.1.0", kind: "command", capabilities: ["fixture.check"],
      entrypoint: { path: "bin/never.js" }, ruleset: { id: "fixture-rules", version: "0.1.0", catalog: "rules.json" },
      artifacts: { lock: "provider.lock", sbom: "sbom.json" }, policies: { network: "none", writes: [] },
      extensions: { "aidlc.mcp": { schema: MCP_REQUIREMENTS_SCHEMA, version: "0.1.0", connections } },
    });
    write(join(pkg, "rules.json"), { rules: [{ id: "fixture.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] });
    write(join(pkg, "provider.lock"), { lockfileVersion: 1, packages: {} });
    write(join(pkg, "sbom.json"), { spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name, documentNamespace: `https://example.test/${name}` });
    write(join(pkg, "bin/never.js"), "must never execute");
  }
  git("add", "."); git("commit", "-m", "offline MCP apply fixtures");

  const f = fixture();
  const original = plan(f);
  assert.equal(original.changes[0].action, "add");
  assert.equal(JSON.stringify(original).includes("--offline"), false, "plan contains digests, never config values");
  unchanged(f, () => assert.throws(() => applyProviderMcp(f.project, { hostConfig: f.host, plan: original, approvedConfigs: [] }), /approve-config/));
  assert.equal(apply(f, original).status, "applied");
  const first = readFileSync(f.host);
  assert.deepEqual(json(f.host), { mcpServers: { "fixture-service": config }, setting: "keep" });
  assert.equal(json(ledger(f.host)).entries["fixture-service"].state, "committed");
  assert.equal(json(ledger(f.host)).entries["fixture-service"].consumer, original.consumer);
  assert.equal(apply(f, original).status, "unchanged", "same plan is idempotent");
  assert.equal(apply(f).status, "unchanged", "new reuse plan is idempotent");
  assert.deepEqual(readFileSync(f.host), first);
  assert.equal(existsSync(journal(f.host)), false);

  const consumer = fixture(); consumer.host = f.host;
  const beforeConsumer = readFileSync(f.host);
  assert.equal(apply(consumer).status, "applied");
  assert.equal(Object.keys(json(ledger(f.host)).entries["fixture-service"].consumers).length, 2);
  assert.deepEqual(readFileSync(f.host), beforeConsumer, "managed reuse records a consumer without rewriting host bytes");
  assert.equal(apply(consumer).status, "unchanged");

  const external = fixture();
  const { type: _, ...untyped } = config;
  write(external.host, { mcpServers: { "fixture-service": untyped } });
  const externalBytes = readFileSync(external.host);
  assert.equal(plan(external).changes[0].ownership, "external");
  assert.equal(apply(external).status, "unchanged");
  assert.equal(existsSync(ledger(external.host)), false, "compatible external entry never claimed");
  assert.deepEqual(readFileSync(external.host), externalBytes);
  // Even a mixed add/reuse transaction preserves the exact external entry representation.
  addProjectProvider(external.project, { source: pathToFileURL(source).href, ref: "main", subdir: "second", instance: "second", allowFile: true });
  apply(external);
  assert.deepEqual(json(external.host).mcpServers["fixture-service"], untyped);
  assert.deepEqual(Object.keys(json(ledger(external.host)).entries), ["second-service"]);

  for (const extra of [{ userPin: true }, { disabled: true }, { autoApprove: ["*"] }, { args: ["pinned@1.0.0"] }]) {
    const conflict = fixture();
    write(conflict.host, { mcpServers: { "fixture-service": { ...config, ...extra } } });
    unchanged(conflict, () => assert.throws(() => plan(conflict), /conflict/));
  }
  for (const point of ["before-config", "after-config", "after-ledger"]) {
    const crash = fixture();
    const value = plan(crash);
    assert.throws(() => apply(crash, value, stop(point)), /injected/);
    assert.equal(existsSync(journal(crash.host)), true);
    if (point === "after-config") {
      assert.equal(existsSync(ledger(crash.host)), false);
      assert.throws(() => apply(crash, value, stop("recovery-before-ledger")), /injected/);
      assert.equal(existsSync(journal(crash.host)), true, "interrupted recovery remains recoverable");
    }
    assert.ok(["applied", "recovered"].includes(apply(crash, value).status));
    assert.equal(apply(crash, value).status, "unchanged");
    assert.equal(existsSync(journal(crash.host)), false);
  }
  const manual = fixture();
  const pending = plan(manual);
  assert.throws(() => apply(manual, pending, stop("after-config")), /injected/);
  write(manual.host, { ...json(manual.host), userLater: "preserve" });
  unchanged(manual, () => assert.throws(() => apply(manual, pending), /recovery conflict/));
  assert.equal(existsSync(ledger(manual.host)), false);

  const ledgerEdit = fixture(); const ledgerEditPlan = plan(ledgerEdit);
  assert.throws(() => apply(ledgerEdit, ledgerEditPlan, stop("after-config")), /injected/);
  write(ledger(ledgerEdit.host), { schema: "aidlc.mcp-ownership/v2", target: ledgerEdit.host, entries: {}, transactions: {} });
  unchanged(ledgerEdit, () => assert.throws(() => apply(ledgerEdit, ledgerEditPlan), /ledger version/));

  const publicationEdit = fixture(); const publicationPlan = plan(publicationEdit);
  assert.throws(() => apply(publicationEdit, publicationPlan, (point) => {
    if (point === "after-config") write(publicationEdit.host, { ...json(publicationEdit.host), userEdit: true });
  }), /changed after publication/);
  assert.equal(json(publicationEdit.host).userEdit, true);
  assert.equal(existsSync(ledger(publicationEdit.host)), false);
  unchanged(publicationEdit, () => assert.throws(() => apply(publicationEdit, publicationPlan), /recovery conflict/));

  const recoveryEdit = fixture(); const recoveryEditPlan = plan(recoveryEdit);
  assert.throws(() => apply(recoveryEdit, recoveryEditPlan, stop("after-config")), /injected/);
  assert.throws(() => apply(recoveryEdit, recoveryEditPlan, (point) => {
    if (point === "recovery-before-ledger") write(recoveryEdit.host, { ...json(recoveryEdit.host), recoveryEdit: true });
  }), /recovery conflict/);
  assert.equal(json(recoveryEdit.host).recoveryEdit, true);
  assert.equal(existsSync(ledger(recoveryEdit.host)), false);

  const stale = fixture();
  const stalePlan = plan(stale);
  write(stale.host, { mcpServers: {}, other: { command: "keep" } });
  unchanged(stale, () => assert.throws(() => apply(stale, stalePlan), /stale/));
  const fresh = plan(stale);
  setProjectProviderEnabled(stale.project, "primary", false);
  unchanged(stale, () => assert.throws(() => apply(stale, fresh), /stale/));
  assert.equal(apply(stale).status, "unchanged");
  assert.equal(existsSync(ledger(stale.host)), false);
  const emptyProject = join(root, "empty"); mkdirSync(emptyProject);
  const empty = { project: emptyProject, host: join(root, "absent.json") };
  assert.equal(apply(empty).status, "unchanged");
  assert.equal(existsSync(empty.host), false); assert.equal(existsSync(join(emptyProject, ".aidlc")), false);
  for (const patch of [{ schema: "aidlc.mcp-plan/v2" }, { extra: true }, { target: join(root, "tampered.json") }, { changes: [] }]) {
    unchanged(f, () => assert.throws(() => apply(f, { ...original, ...patch }), /REJECTED/));
  }
  assert.throws(() => applyProviderMcp(f.project, { hostConfig: join(root, "other.json"), plan: original, approvedConfigs: [digest] }), /target mismatch/);
  assert.throws(() => planProviderMcp(f.project, { hostConfig: "../escape.json" }), /traversal/);
  assert.throws(() => planProviderMcp(f.project, { hostConfig: join(f.project, ".aidlc", "host.json") }), /unsupported target/);
  assert.throws(() => planProviderMcp(f.project, { hostConfig: `${f.host}.AIDLC-MCP-ledger.json` }), /unsupported target/);
  const directory = join(root, "real-dir"); mkdirSync(directory);
  const junction = join(root, "junction"); symlinkSync(directory, junction, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => planProviderMcp(f.project, { hostConfig: join(junction, "host.json") }), /symlink/);
  const hardlink = join(root, "hardlink.json"); linkSync(f.host, hardlink);
  assert.throws(() => planProviderMcp(f.project, { hostConfig: hardlink }), /hardlink/); unlinkSync(hardlink);

  const realm = fixture("realm");
  const realmPlan = plan(realm);
  assert.equal(apply(realm, realmPlan).status, "applied");
  assert.equal(apply(realm, realmPlan).status, "unchanged");
  assert.equal(apply(realm).status, "unchanged", "managed attribution supplies credential domain");
  const otherRealm = fixture("realm-other");
  otherRealm.host = realm.host;
  unchanged(realm, () => assert.throws(() => plan(otherRealm), /credential domain conflict/));
  const recoveryRealm = fixture("realm");
  const recoveryRealmPlan = plan(recoveryRealm);
  assert.throws(() => apply(recoveryRealm, recoveryRealmPlan, stop("after-config")), /injected/);
  assert.equal(apply(recoveryRealm, recoveryRealmPlan).status, "recovered");
  const externalRealm = fixture("realm");
  write(externalRealm.host, { mcpServers: { "fixture-service": config } });
  assert.throws(() => plan(externalRealm), /domain differs/);
  const domains = join(root, "domains.json"); write(domains, { "fixture-service": "tenant-a" });
  const input = { hostConfig: externalRealm.host, hostDomains: domains };
  const domainPlan = planProviderMcp(externalRealm.project, input);
  assert.equal(applyProviderMcp(externalRealm.project, { ...input, plan: domainPlan, approvedConfigs: [digest] }).status, "unchanged");
  write(domains, { "fixture-service": "tenant-b" });
  assert.throws(() => applyProviderMcp(externalRealm.project, { ...input, plan: domainPlan, approvedConfigs: [digest] }), /domain/);
  const secret = fixture("secret");
  assert.throws(() => plan(secret), (error) => !String(error).includes("actual-secret-value") && /controlled env/.test(String(error)));
  const reference = fixture("reference");
  const referencePlan = plan(reference);
  assert.equal(JSON.stringify(referencePlan).includes("FIXTURE_TOKEN"), false);
  assert.equal(applyProviderMcp(reference.project, { hostConfig: reference.host, plan: referencePlan, approvedConfigs: [referencePlan.changes[0].config_digest] }).status, "applied");
  assert.equal(JSON.stringify(json(ledger(reference.host))).includes("FIXTURE_TOKEN"), false);

  const lockTest = fixture();
  const lockPlan = plan(lockTest);
  write(`${lockTest.host}.aidlc-mcp-lock`, { pid: process.pid });
  unchanged(lockTest, () => assert.throws(() => apply(lockTest, lockPlan), /target busy/));
  unlinkSync(`${lockTest.host}.aidlc-mcp-lock`);

  // Actual concurrent processes, separate projects, shared target: loser must re-plan;
  // serialization/CAS may reject it, but neither writer can discard the winner's entry.
  const a = fixture(); const b = fixture("second"); b.host = a.host;
  const planFiles = [join(root, "a-plan.json"), join(root, "b-plan.json")];
  write(planFiles[0], plan(a)); write(planFiles[1], plan(b));
  function child(fixture: typeof a, file: string): Promise<number | null> {
    return new Promise((done, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", join(repo, "bin/cli.ts"), "provider", "mcp-apply", "--project", fixture.project, "--host-config", fixture.host, "--plan", file, "--approve-config", digest], { cwd: repo, stdio: "pipe" });
      child.stdout.resume(); child.stderr.resume(); child.on("error", reject); child.on("close", done);
    });
  }
  const statuses = await Promise.all([child(a, planFiles[0]), child(b, planFiles[1])]);
  assert.ok(statuses.includes(0), JSON.stringify(statuses));
  for (const fixture of [a, b]) apply(fixture);
  assert.deepEqual(Object.keys(json(a.host).mcpServers).sort(), ["fixture-service", "second-service"]);
  assert.equal(Object.keys(json(ledger(a.host)).entries).length, 2);
  assert.deepEqual(runProviderCli(["mcp-plan", "--project", a.project, "--host-config", a.host]), plan(a));
  assert.throws(() => runProviderCli(["mcp-apply", "--project", a.project, "--host-config", a.host]), /requires --plan/);
  console.log("Managed MCP apply: add/idempotence/external reuse/pins/drift/domains/safe references/path guards/concurrent processes/transaction fault recovery passed");
} finally { rmSync(root, { recursive: true, force: true }); }
