import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "..");
const root = mkdtempSync(join(tmpdir(), "aidlc-mcp-process-"));
const source = join(root, "source"), home = join(root, "isolated-home");
const cliPath = join(repo, "core/tools/aidlc-provider-cli.ts");
const preload = pathToFileURL(join(repo, "tests/fixtures/mcp-process-barrier.ts")).href;
const config = { type: "stdio", command: "fixture-service", args: ["--offline"], env: { TOKEN: "${env:FIXTURE_TOKEN}" } };
const secret = "private-user-value-never-print";
const environment = { ...process.env, HOME: home, USERPROFILE: home, AIDLC_PROVIDER_ALLOW_FILE: "1", AIDLC_INSTALL_STATE_DIR: join(home, "installations") };
const commands: unknown[] = [], scenarios: unknown[] = [];
const active = new Set<ChildProcess>();
const ledger = (host: string) => `${host}.aidlc-mcp-ledger.json`;
const journal = (host: string) => `${host}.aidlc-mcp-journal.json`;
const lock = (host: string) => `${host}.aidlc-mcp-lock`;
function write(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function json(path: string) { return JSON.parse(readFileSync(path, "utf8")); }
function snapshot(host: string) { return [host, ledger(host), journal(host)].map(path => existsSync(path) ? readFileSync(path).toString("base64") : null); }
function summary(host: string) {
  const own = existsSync(ledger(host)) ? json(ledger(host)) : null;
  return { servers: Object.keys(json(host).mcpServers).length, entries: Object.keys(own?.entries ?? {}).length,
    consumers: Object.values(own?.entries ?? {}).map((entry: any) => Object.keys(entry.consumers).length), pending: !!own?.pending, journal: existsSync(journal(host)) };
}
function run(args: string[], expected = 0, bin = false) {
  const argv = ["--import", "tsx", bin ? join(repo, "bin/cli.ts") : cliPath, ...args];
  const result = spawnSync(process.execPath, argv, { cwd: repo, encoding: "utf8", env: environment, timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
  commands.push({ command: ["node", ...argv], exit_code: result.status });
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  assert(!`${result.stdout}${result.stderr}`.includes(secret), "CLI leaked a secret");
  return expected === 0 ? JSON.parse(result.stdout) : result.stderr;
}
type Fixture = { project: string; host: string; plan: string };
let sequence = 0;
function fixture(install = true): Fixture {
  const project = join(root, `project-${sequence++}`), host = join(root, `host-${sequence++}.json`);
  mkdirSync(project);
  write(host, { userSetting: secret, mcpServers: { legacyUnknown: { command: "old-pinned", env: { TOKEN: secret }, disabled: true } } });
  const f = { project, host, plan: join(project, "saved-plan.json") };
  if (install) run(["provider", "add", pathToFileURL(source).href, "--ref", "main", "--subdir", "pkg", "--instance", "fixture", "--allow-file", "--project", project], 0, true);
  return f;
}
function args(f: Fixture, command: string, extra: string[] = []) { return [command, "--project", f.project, "--host-config", f.host, ...extra]; }
function plan(f: Fixture, cleanup = false, extra: string[] = []) {
  const value = run(args(f, cleanup ? "mcp-cleanup-plan" : "mcp-plan", extra)); write(f.plan, value); return value;
}
function applyArgs(f: Fixture) { const value = plan(f); return args(f, "mcp-apply", ["--plan", f.plan, ...value.changes.flatMap((item: any) => ["--approve-config", item.config_digest])]); }
function recoverArgs(f: Fixture) { return args(f, "mcp-recover", ["--plan", f.plan]); }
function status(f: Fixture) { return run(args(f, "mcp-status")); }
function child(f: Fixture, argv: string[], point: string) {
  const marker = join(root, `barrier-${sequence++}.json`);
  const proc = spawn(process.execPath, ["--import", "tsx", "--import", preload, cliPath, ...argv], {
    cwd: repo, env: { ...environment, AIDLC_TEST_MCP_BARRIER: JSON.stringify({ host: f.host, marker, point }) }, stdio: "pipe",
  });
  active.add(proc);
  let output = "";
  proc.stdout!.on("data", data => { output += data; }); proc.stderr!.on("data", data => { output += data; });
  const closed = new Promise<{ code: number | null; signal: string | null }>((done, reject) => {
    proc.on("error", reject);
    proc.on("close", (code, signal) => { active.delete(proc); done({ code, signal }); });
  });
  return { proc, marker, closed, argv, point, output: () => output };
}
type Running = ReturnType<typeof child>;
async function barrier(running: Running) {
  const deadline = Date.now() + 30_000;
  while (!existsSync(running.marker)) {
    assert(running.proc.exitCode === null && Date.now() < deadline, `barrier not reached: ${running.output()}`);
    await new Promise(done => setTimeout(done, 15));
  }
  assert.equal(json(running.marker).pid, running.proc.pid);
}
async function kill(running: Running, f: Fixture) {
  running.proc.kill("SIGKILL");
  const result = await running.closed;
  assert(result.code !== 0 || result.signal !== null, "interrupted child unexpectedly succeeded");
  commands.push({ command: ["node", "--import", "tsx", "--import", "test-preload", cliPath, ...running.argv], barrier: running.point, ...result, interrupted: true });
  // Operator action, after collecting process exit: never remove an unknown/live lock.
  assert.equal(json(lock(f.host)).pid, running.proc.pid);
  assert.throws(() => process.kill(running.proc.pid!, 0));
  unlinkSync(lock(f.host));
}
async function resume(running: Running, expected: number) {
  write(`${running.marker}.continue`, {});
  const result = await running.closed;
  commands.push({ command: ["node", "--import", "tsx", "--import", "test-preload", cliPath, ...running.argv], barrier: running.point, ...result });
  assert.equal(result.code, expected, running.output()); assert(!running.output().includes(secret));
}
async function pending(f: Fixture, point = "after-config") {
  const running = child(f, applyArgs(f), point); await barrier(running); await kill(running, f);
  return summary(f.host);
}
function rejectUnchanged(f: Fixture, argv: string[]) { const before = snapshot(f.host); run(argv, 2); assert.deepEqual(snapshot(f.host), before); }

try {
  mkdirSync(source); mkdirSync(home);
  function git(...argv: string[]) { const result = spawnSync("git", argv, { cwd: source, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); }
  git("init", "-b", "main"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture");
  write(join(source, "pkg/provider.yaml"), {
    schema: "aidlc.provider/v1.1", provider_id: "fixture.cli", name: "Fixture", version: "0.1.0", kind: "command", capabilities: ["fixture.check"],
    entrypoint: { path: "bin/never.js" }, ruleset: { id: "fixture-rules", version: "0.1.0", catalog: "rules.json" }, artifacts: { lock: "provider.lock", sbom: "sbom.json" },
    policies: { network: "none", writes: [] }, extensions: { "aidlc.mcp": { schema: "aidlc.mcp-requirements/v1", version: "0.1.0", connections: [{ name: "fixture-service", credential_domain: "tenant-a", config }] } },
  });
  write(join(source, "pkg/rules.json"), { rules: [{ id: "fixture.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] });
  write(join(source, "pkg/provider.lock"), { lockfileVersion: 1, packages: {} });
  write(join(source, "pkg/sbom.json"), { spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name: "Fixture", documentNamespace: "https://example.test/fixture" });
  write(join(source, "pkg/bin/never.js"), "provider business must never execute");
  git("add", "."); git("commit", "-m", "isolated CLI recovery fixture");

  const empty = fixture(false), beforeFiles = readdirSync(root);
  assert.equal(status(empty).status, "no-transaction"); assert.deepEqual(readdirSync(root), beforeFiles);
  const emptyPlan = plan(empty); assert.equal(emptyPlan.changes.length, 0);
  assert.equal(run(recoverArgs(empty)).status, "unchanged");
  assert(!existsSync(ledger(empty.host)) && !existsSync(lock(empty.host)) && !existsSync(join(empty.project, ".aidlc")));
  const absent = { ...empty, host: join(root, "absent-host.json"), plan: join(empty.project, "absent-plan.json") };
  const absentFiles = readdirSync(root); assert.equal(status(absent).status, "no-transaction");
  plan(absent); assert.equal(run(recoverArgs(absent)).status, "unchanged");
  assert.deepEqual(readdirSync(root), absentFiles); assert(!existsSync(absent.host));
  run(args(empty, "mcp-recover"), 2); run(args(empty, "mcp-recover", ["--plan", empty.plan, "--force"]), 2);

  const f = fixture();
  const before = await pending(f);
  assert.equal(status(f).phase, "after-config"); assert.equal(status(f).can_recover, true);
  const recovering = child(f, recoverArgs(f), "recovery-before-ledger"); await barrier(recovering);
  assert.equal(status(f).can_recover, false); assert.equal(json(ledger(f.host)).pending !== null, true);
  await kill(recovering, f);
  assert.equal(run(recoverArgs(f)).status, "recovered");
  assert.equal(run(recoverArgs(f)).status, "unchanged");
  assert.equal(status(f).status, "completed");
  assert.deepEqual(json(f.host).mcpServers["fixture-service"], config);
  assert.equal(json(f.host).userSetting, secret); assert.equal(json(f.host).mcpServers.legacyUnknown.env.TOKEN, secret);
  assert.equal(json(ledger(f.host)).pending, null); assert(!existsSync(journal(f.host)));
  scenarios.push({ scenario: "apply-kill-recover-kill-recover-idempotent", before, after: summary(f.host), asserted: true });

  // Genuine CLI lifecycle: explicit add/plan/apply, shared host, disable/remove and cleanup.
  const second = fixture(); second.host = f.host;
  const sharing = child(second, applyArgs(second), "before-config"); await barrier(sharing); await kill(sharing, second);
  assert.equal(run(recoverArgs(second)).status, "recovered");
  assert.equal(Object.keys(json(ledger(f.host)).entries["fixture-service"].consumers).length, 2);
  run(["provider", "disable", "fixture", "--project", f.project], 0, true);
  assert(json(f.host).mcpServers["fixture-service"], "disable never implicitly cleans host");
  assert.equal(plan(f, true).changes[0].action, "release");
  const releasing = child(f, args(f, "mcp-cleanup", ["--plan", f.plan]), "before-config"); await barrier(releasing); await kill(releasing, f);
  assert.equal(run(recoverArgs(f)).status, "recovered");
  assert.equal(Object.keys(json(ledger(f.host)).entries["fixture-service"].consumers).length, 1);
  run(["provider", "remove", "fixture", "--project", second.project], 0, true);
  assert.equal(plan(second, true).changes[0].action, "delete");
  const cleanup = child(second, args(second, "mcp-cleanup", ["--plan", second.plan]), "after-config"); await barrier(cleanup); await kill(cleanup, second);
  assert.equal(run(recoverArgs(second)).status, "recovered"); assert.equal(run(recoverArgs(second)).status, "unchanged");
  assert.deepEqual(Object.keys(json(f.host).mcpServers), ["legacyUnknown"]); assert.equal(json(f.host).userSetting, secret);
  scenarios.push({ scenario: "two-project-sharing-disable-remove-cleanup-recovery", after: summary(f.host), asserted: true });

  for (const point of ["before-config", "after-ledger"]) {
    const other = fixture(); await pending(other, point);
    assert.equal(status(other).phase, point);
    assert.equal(run(recoverArgs(other)).status, point === "before-config" ? "aborted" : "recovered");
    assert.equal(run(recoverArgs(other)).status, "unchanged");
    assert.equal(!!json(other.host).mcpServers["fixture-service"], point === "after-ledger");
    assert(!existsSync(journal(other.host))); scenarios.push({ scenario: point, after: summary(other.host), asserted: true });
  }

  const rollback = fixture(); await pending(rollback, "before-config");
  const aborting = child(rollback, recoverArgs(rollback), "after-ledger"); await barrier(aborting); await kill(aborting, rollback);
  assert.equal(status(rollback).phase, "after-abort");
  assert.equal(run(recoverArgs(rollback)).status, "aborted"); assert.equal(run(recoverArgs(rollback)).status, "unchanged");
  assert(!json(rollback.host).mcpServers["fixture-service"] && !existsSync(journal(rollback.host)));
  rejectUnchanged(rollback, args(rollback, "mcp-apply", ["--plan", rollback.plan, "--approve-config", json(rollback.plan).changes[0].config_digest]));
  run(applyArgs(rollback)); assert.deepEqual(json(rollback.host).mcpServers["fixture-service"], config);
  scenarios.push({ scenario: "abort-kill-after-ledger-recover-replan-apply", after: summary(rollback.host), asserted: true });

  const edited = fixture(); await pending(edited);
  write(edited.host, { ...json(edited.host), afterCrash: secret });
  assert.equal(status(edited).status, "conflict"); rejectUnchanged(edited, recoverArgs(edited));

  const identity = fixture(); await pending(identity);
  const wrong = fixture(false); wrong.host = identity.host; wrong.plan = identity.plan;
  rejectUnchanged(identity, recoverArgs(wrong));
  rejectUnchanged(identity, args(identity, "mcp-recover", ["--plan", identity.plan, "--host-domains", join(root, "wrong-domains.json")]));
  const wrongHost = { ...identity, host: edited.host }; rejectUnchanged(edited, recoverArgs(wrongHost));
  rejectUnchanged(identity, args(identity, "mcp-recover", ["--plan", join(root, "missing-plan.json")]));
  const corruptPlan = join(identity.project, "corrupt-plan.json"); writeFileSync(corruptPlan, `{${secret}`);
  rejectUnchanged(identity, args(identity, "mcp-recover", ["--plan", corruptPlan]));
  const domains = join(root, "domain-map.json"); write(domains, { "fixture-service": "tenant-a" });
  const domain = fixture(); const domainPlan = run(args(domain, "mcp-plan", ["--host-domains", domains])); write(domain.plan, domainPlan);
  const domainArgs = args(domain, "mcp-apply", ["--host-domains", domains, "--plan", domain.plan, "--approve-config", domainPlan.changes[0].config_digest]);
  const domainChild = child(domain, domainArgs, "after-config"); await barrier(domainChild); await kill(domainChild, domain);
  write(domains, { "fixture-service": "tenant-b" }); rejectUnchanged(domain, [...recoverArgs(domain), "--host-domains", domains]);

  // Pause a real recovery process before its final comparisons, then edit each input.
  for (const field of ["host", "journal", "ledger", "lock", "source", "concurrent"]) {
    const current = fixture(); await pending(current);
    const running = child(current, recoverArgs(current), "read-target"); await barrier(running);
    if (field === "host") write(current.host, { ...json(current.host), duringRecovery: secret });
    if (field === "journal") write(journal(current.host), { ...json(journal(current.host)), extra: secret });
    if (field === "ledger") { const own = json(ledger(current.host)); own.pending.journal_digest = "tampered"; write(ledger(current.host), own); }
    if (field === "lock") write(lock(current.host), { pid: 1, operator: true });
    if (field === "source") { const path = join(current.project, ".aidlc/providers.lock.yaml"); assert(existsSync(path)); writeFileSync(path, "tampered"); }
    if (field === "concurrent") rejectUnchanged(current, recoverArgs(current));
    const preserve = snapshot(current.host);
    await resume(running, field === "concurrent" ? 0 : 2);
    if (field !== "concurrent") assert.deepEqual(snapshot(current.host), preserve);
    if (field === "lock") { assert.equal(json(lock(current.host)).operator, true); unlinkSync(lock(current.host)); }
    if (field === "concurrent") { assert.equal(json(ledger(current.host)).pending, null); assert(!existsSync(journal(current.host))); }
    scenarios.push({ scenario: `during-recovery-${field}`, asserted: true });
  }

  for (const artifact of ["ledger", "journal"]) {
    const corrupt = fixture(); await pending(corrupt);
    writeFileSync(artifact === "ledger" ? ledger(corrupt.host) : journal(corrupt.host), `{${secret}`);
    assert.equal(status(corrupt).status, "corrupt"); rejectUnchanged(corrupt, recoverArgs(corrupt));
  }
  const legacy = fixture(); await pending(legacy); const legacyJournal = json(journal(legacy.host)); legacyJournal.schema = "aidlc.mcp-transaction/v1"; write(journal(legacy.host), legacyJournal);
  assert.equal(status(legacy).status, "incompatible"); rejectUnchanged(legacy, recoverArgs(legacy));
  const missing = fixture(); await pending(missing); unlinkSync(journal(missing.host));
  assert.equal(status(missing).status, "conflict"); rejectUnchanged(missing, recoverArgs(missing));
  const unprepared = fixture(); await pending(unprepared); write(ledger(unprepared.host), json(journal(unprepared.host)).ledger_before);
  assert.equal(status(unprepared).status, "conflict"); rejectUnchanged(unprepared, recoverArgs(unprepared));
  const noAnchor = fixture(); await pending(noAnchor, "after-journal");
  assert.equal(status(noAnchor).phase, "unprepared"); rejectUnchanged(noAnchor, recoverArgs(noAnchor)); assert(!existsSync(ledger(noAnchor.host)));
  const orphan = fixture(); await pending(orphan); write(lock(orphan.host), { pid: 99999999 });
  assert.equal(status(orphan).can_recover, false); rejectUnchanged(orphan, recoverArgs(orphan)); assert(existsSync(lock(orphan.host)));

  const retained = fixture(); run(applyArgs(retained));
  const ownServer = json(retained.host); ownServer.mcpServers["fixture-service"].disabled = true; write(retained.host, ownServer);
  assert.equal(status(retained).status, "conflict");
  plan(retained, true, ["--release-all"]); const retainBytes = readFileSync(retained.host);
  run(args(retained, "mcp-cleanup", ["--plan", retained.plan, "--release-all"])); assert.deepEqual(readFileSync(retained.host), retainBytes);
  assert.equal(json(ledger(retained.host)).entries["fixture-service"].state, "retained");
  scenarios.push({ scenario: "identity-corruption-legacy-missing-anchor-user-exit-protection", asserted: true });
  const evidence = { scope: "isolated JSON mcpServers; local CLI processes, not real host/account acceptance", commands, scenarios, passed: true };
  if (process.env.AIDLC_TEST_ARTIFACT_DIR) write(join(process.env.AIDLC_TEST_ARTIFACT_DIR, "mcp-recovery-process-evidence.json"), evidence);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const proc of active) proc.kill("SIGKILL");
  if (active.size) await Promise.all([...active].map(proc => new Promise(done => proc.once("close", done))));
  rmSync(root, { recursive: true, force: true });
}
