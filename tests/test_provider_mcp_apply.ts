import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, runProviderCli, setProjectProviderEnabled } from "../core/tools/aidlc-provider-cli.js";
import { applyProviderMcp, planProviderMcp, cleanupProviderMcp, planProviderMcpCleanup } from "../core/tools/aidlc-provider-mcp-apply.js";
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
      assert.ok(json(ledger(crash.host)).pending, "prepared authorization remains until recovery completes");
  assert.deepEqual(json(ledger(crash.host)).entries, {});
      assert.throws(() => apply(crash, value, stop("recovery-before-ledger")), /injected/);
      assert.equal(existsSync(journal(crash.host)), true, "interrupted recovery remains recoverable");
    }
    if (point === "before-config") {
      assert.throws(() => apply(crash, value), /aborted before config/);
      assert.equal(apply(crash).status, "applied");
    } else {
      assert.equal(apply(crash, value).status, "recovered");
      assert.equal(apply(crash, value).status, "unchanged");
    }
    assert.equal(existsSync(journal(crash.host)), false);
  }
  const manual = fixture();
  const pending = plan(manual);
  assert.throws(() => apply(manual, pending, stop("after-config")), /injected/);
  write(manual.host, { ...json(manual.host), userLater: "preserve" });
  unchanged(manual, () => assert.throws(() => apply(manual, pending), /recovery conflict/));
  assert.ok(json(ledger(manual.host)).pending, "prepared authorization remains until recovery completes");
  assert.deepEqual(json(ledger(manual.host)).entries, {});

  const ledgerEdit = fixture(); const ledgerEditPlan = plan(ledgerEdit);
  assert.throws(() => apply(ledgerEdit, ledgerEditPlan, stop("after-config")), /injected/);
  write(ledger(ledgerEdit.host), { schema: "aidlc.mcp-ownership/v999", target: ledgerEdit.host, entries: {}, transactions: {} });
  unchanged(ledgerEdit, () => assert.throws(() => apply(ledgerEdit, ledgerEditPlan), /unknown or missing fields|ledger version/));

  const publicationEdit = fixture(); const publicationPlan = plan(publicationEdit);
  assert.throws(() => apply(publicationEdit, publicationPlan, (point) => {
    if (point === "after-config") write(publicationEdit.host, { ...json(publicationEdit.host), userEdit: true });
  }), /changed after publication/);
  assert.equal(json(publicationEdit.host).userEdit, true);
  assert.ok(json(ledger(publicationEdit.host)).pending, "prepared authorization remains until recovery completes");
  assert.deepEqual(json(ledger(publicationEdit.host)).entries, {});
  unchanged(publicationEdit, () => assert.throws(() => apply(publicationEdit, publicationPlan), /recovery conflict/));

  const recoveryEdit = fixture(); const recoveryEditPlan = plan(recoveryEdit);
  assert.throws(() => apply(recoveryEdit, recoveryEditPlan, stop("after-config")), /injected/);
  assert.throws(() => apply(recoveryEdit, recoveryEditPlan, (point) => {
    if (point === "recovery-before-ledger") write(recoveryEdit.host, { ...json(recoveryEdit.host), recoveryEdit: true });
  }), /recovery conflict/);
  assert.equal(json(recoveryEdit.host).recoveryEdit, true);
  assert.ok(json(ledger(recoveryEdit.host)).pending, "prepared authorization remains until recovery completes");
  assert.deepEqual(json(ledger(recoveryEdit.host)).entries, {});

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
  for (const patch of [{ schema: "aidlc.mcp-plan/v999" }, { extra: true }, { target: join(root, "tampered.json") }, { changes: [] }]) {
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
  function cleanupPlan(f: typeof a, releaseAll = false, hostDomains?: string) {
    return planProviderMcpCleanup(f.project, { hostConfig: f.host, releaseAll, hostDomains });
  }
  function cleanup(f: typeof a, value = cleanupPlan(f), releaseAll = false, fault?: Parameters<typeof cleanupProviderMcp>[2], hostDomains?: string) {
    return cleanupProviderMcp(f.project, { hostConfig: f.host, releaseAll, plan: value, hostDomains }, fault);
  }
  const sharedA = fixture(); const sharedB = fixture(); sharedB.host = sharedA.host;
  const oldAdd = plan(sharedA); apply(sharedA, oldAdd); apply(sharedB);
  const beforeRelease = readFileSync(sharedA.host);
  const releaseA = cleanupPlan(sharedA, true);
  unchanged(sharedA, () => assert.equal(cleanupPlan(sharedA, true).changes[0].action, "release"));
  assert.equal(cleanup(sharedA, releaseA, true).status, "cleaned");
  assert.deepEqual(readFileSync(sharedA.host), beforeRelease);
  assert.equal(Object.keys(json(ledger(sharedA.host)).entries["fixture-service"].consumers).length, 1);
  assert.equal(cleanup(sharedA, releaseA, true).status, "unchanged");
  unchanged(sharedA, () => assert.throws(() => apply(sharedA, oldAdd), /stale/));
  const releaseB = cleanupPlan(sharedB, true);
  assert.equal(releaseB.changes[0].action, "delete");
  assert.equal(cleanup(sharedB, releaseB, true).status, "cleaned");
  assert.deepEqual(json(sharedA.host), { mcpServers: {}, setting: "keep" });
  assert.deepEqual(json(ledger(sharedA.host)).entries, {});
  unchanged(sharedA, () => assert.throws(() => apply(sharedA, oldAdd), /stale/));
  apply(sharedA);
  unchanged(sharedA, () => assert.throws(() => cleanup(sharedA, releaseA, true), /stale/));

  const two = fixture(); apply(two);
  addProjectProvider(two.project, { source: pathToFileURL(source).href, ref: "main", subdir: "primary", instance: "alias", allowFile: true });
  apply(two);
  setProjectProviderEnabled(two.project, "primary", false);
  const keep = cleanupPlan(two);
  assert.equal(keep.changes[0].action, "refresh");
  assert.equal(cleanup(two, keep).status, "cleaned");
  assert.equal(json(two.host).mcpServers["fixture-service"].command, config.command);
  assert.deepEqual(json(ledger(two.host)).entries["fixture-service"].consumers[keep.consumer].sources.map((item: { instance_id: string }) => item.instance_id), ["alias"]);
  runProviderCli(["remove", "alias", "--project", two.project]);
  assert.equal(cleanupPlan(two).changes[0].action, "delete"); cleanup(two);
  for (const extra of [{ userPin: true }, { disabled: true }, { autoApprove: ["*"] }, { env: { TOKEN: "user-secret" } }, { args: ["pin@1"] }]) {
    const edited = fixture(); apply(edited);
    write(edited.host, { ...json(edited.host), mcpServers: { "fixture-service": { ...config, ...extra }, unrelated: { user: true } } });
    const preserve = readFileSync(edited.host); const value = cleanupPlan(edited, true);
    assert.equal(value.changes[0].reason, "user_modified");
    assert.equal(JSON.stringify(value).includes("user-secret"), false);
    cleanup(edited, value, true); assert.deepEqual(readFileSync(edited.host), preserve);
    assert.equal(json(ledger(edited.host)).entries["fixture-service"].state, "retained");
    write(edited.host, { mcpServers: { "fixture-service": config } });
    assert.equal(cleanupPlan(edited, true).changes.length, 0);
    unchanged(edited, () => assert.throws(() => apply(edited), /retained/));
  }
  const absentEntry = fixture(); apply(absentEntry); write(absentEntry.host, { mcpServers: {}, keep: true });
  assert.equal(cleanupPlan(absentEntry, true).changes[0].reason, "entry_missing");
  cleanup(absentEntry, cleanupPlan(absentEntry, true), true);
  assert.equal(json(ledger(absentEntry.host)).entries["fixture-service"].state, "retained");
  const unknownDomain = fixture("realm"); apply(unknownDomain);
  const unknownMap = join(root, "unknown-map.json"); write(unknownMap, {});
  const unknownPlan = cleanupPlan(unknownDomain, true, unknownMap);
  assert.equal(unknownPlan.changes[0].reason, "credential_domain_unknown_or_changed");
  cleanup(unknownDomain, unknownPlan, true, undefined, unknownMap);
  assert.ok(json(unknownDomain.host).mcpServers["fixture-service"]);
  unchanged(externalRealm, () => assert.equal(cleanup(externalRealm, cleanupPlan(externalRealm, true), true).status, "unchanged"));
  unchanged(empty, () => assert.equal(cleanup(empty, cleanupPlan(empty, true), true).status, "unchanged"));
  for (const metadataOnly of [false, true]) for (const point of ["before-config", "after-config", "after-ledger"]) {
    const crash = fixture(); apply(crash);
    if (metadataOnly) { const other = fixture(); other.host = crash.host; apply(other); }
    const value = cleanupPlan(crash, true);
    assert.throws(() => cleanup(crash, value, true, stop(point)), /injected/);
    if (point === "before-config" && !metadataOnly) {
      assert.throws(() => cleanup(crash, value, true), /aborted before config/);
      cleanup(crash, cleanupPlan(crash, true), true);
    } else {
      if (point !== "after-ledger") assert.throws(() => cleanup(crash, value, true, stop("recovery-before-ledger")), /injected/);
      assert.equal(cleanup(crash, value, true).status, "recovered");
      assert.equal(cleanup(crash, value, true).status, "unchanged");
    }
    assert.equal(existsSync(journal(crash.host)), false);
    assert.equal(!!json(crash.host).mcpServers["fixture-service"], metadataOnly);
  }
  for (const metadataOnly of [false, true]) {
    const edited = fixture(); apply(edited);
    if (metadataOnly) { const other = fixture(); other.host = edited.host; apply(other); }
    const value = cleanupPlan(edited, true);
    assert.throws(() => cleanup(edited, value, true, stop("after-config")), /injected/);
    write(edited.host, { ...json(edited.host), userAfterCrash: true });
    unchanged(edited, () => assert.throws(() => cleanup(edited, value, true), /recovery conflict/));
  }
  const forged = fixture(); apply(forged); const forgedPlan = cleanupPlan(forged, true);
  assert.throws(() => cleanup(forged, forgedPlan, true, stop("after-config")), /injected/);
  const forgedJournal = json(journal(forged.host)); forgedJournal.ledger_after.entries.evil = { fabricated: true };
  write(journal(forged.host), forgedJournal);
  unchanged(forged, () => assert.throws(() => cleanup(forged, forgedPlan, true), /invalid transaction ledger/));
  const forgedApply = fixture(); const forgedApplyPlan = plan(forgedApply);
  assert.throws(() => apply(forgedApply, forgedApplyPlan, stop("after-config")), /injected/);
  const forgedAddJournal = json(journal(forgedApply.host)); forgedAddJournal.ledger_before.entries.evil = { fabricated: true };
  write(journal(forgedApply.host), forgedAddJournal);
  unchanged(forgedApply, () => assert.throws(() => apply(forgedApply, forgedApplyPlan), /invalid transaction baseline/));
  const drift = fixture(); apply(drift); const driftPlan = cleanupPlan(drift, true); const otherProject = fixture();
  assert.throws(() => cleanupProviderMcp(otherProject.project, { hostConfig: drift.host, releaseAll: true, plan: driftPlan }), /project/);
  write(drift.host, { ...json(drift.host), later: true });
  unchanged(drift, () => assert.throws(() => cleanup(drift, driftPlan, true), /stale/));
  const currentDriftPlan = cleanupPlan(drift, true); const ownEdit = json(ledger(drift.host)); ownEdit.entries["fixture-service"].consumers = {};
  write(ledger(drift.host), ownEdit);
  unchanged(drift, () => assert.throws(() => cleanup(drift, currentDriftPlan, true), /stale/));
  assert.deepEqual(runProviderCli(["mcp-cleanup-plan", "--project", drift.project, "--host-config", drift.host, "--release-all"]), cleanupPlan(drift, true));
  assert.throws(() => runProviderCli(["mcp-cleanup", "--project", drift.project, "--host-config", drift.host]), /requires --plan/);
  const legacy = fixture(); apply(legacy);
  const legacyLedger = json(ledger(legacy.host)); delete legacyLedger.pending; legacyLedger.schema = "aidlc.mcp-ownership/v1";
  write(ledger(legacy.host), legacyLedger);
  cleanup(legacy, cleanupPlan(legacy, true), true);
  assert.equal(json(ledger(legacy.host)).schema, "aidlc.mcp-ownership/v2");
  const resurrect = fixture(); const resurrectPlan = plan(resurrect);
  assert.throws(() => apply(resurrect, resurrectPlan, stop("after-ledger")), /injected/);
  const obsoleteJournal = readFileSync(journal(resurrect.host));
  apply(resurrect, resurrectPlan);
  cleanup(resurrect, cleanupPlan(resurrect, true), true);
  writeFileSync(journal(resurrect.host), obsoleteJournal);
  unchanged(resurrect, () => assert.throws(() => apply(resurrect, resurrectPlan), /recovery conflict/));
  const raceA = fixture(); const raceB = fixture(); raceB.host = raceA.host; apply(raceA);
  const cleanupFile = join(root, "race-cleanup.json"); const applyFile = join(root, "race-apply.json");
  write(cleanupFile, cleanupPlan(raceA, true)); write(applyFile, plan(raceB));
  const cleanupChild = new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(repo, "bin/cli.ts"), "provider", "mcp-cleanup", "--project", raceA.project, "--host-config", raceA.host, "--plan", cleanupFile, "--release-all"], { cwd: repo, stdio: "pipe" });
    child.stdout.resume(); child.stderr.resume(); child.on("error", reject); child.on("close", done);
  });
  const raceStatuses = await Promise.all([cleanupChild, child(raceB, applyFile)]);
  assert.ok(raceStatuses.includes(0), JSON.stringify(raceStatuses));
  apply(raceB); cleanup(raceA, cleanupPlan(raceA, true), true);
  assert.deepEqual(json(raceA.host).mcpServers["fixture-service"], config);
  assert.deepEqual(Object.keys(json(ledger(raceA.host)).entries["fixture-service"].consumers), [plan(raceB).consumer]);
  console.log("Managed MCP cleanup: shared consumers/provider references/retention/stale replay/authority/fault recovery passed");
  console.log("Managed MCP apply: add/idempotence/external reuse/pins/drift/domains/safe references/path guards/concurrent processes/transaction fault recovery passed");
} finally { rmSync(root, { recursive: true, force: true }); }
