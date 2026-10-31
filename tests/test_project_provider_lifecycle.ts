import { fixtureEnvironment } from "./mars243_fixture_session";
import { createInitialState, renderLightWorkflowState } from "../core/tools/aidlc-light-state";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addProjectProvider,
  getProjectProviderStatus,
  listProjectProviders,
  removeProjectProvider,
  setProjectProviderEnabled,
  updateProjectProvider,
} from "../core/tools/aidlc-provider-cli.js";
import {
  PROJECT_PROVIDER_AUDIT_PATH,
  PROJECT_PROVIDER_HISTORY_PATH,
  PROJECT_PROVIDER_INVALIDATIONS_PATH,
  PROJECT_PROVIDERS_LOCK_PATH,
  PROJECT_PROVIDERS_PATH,
  projectProviderConfigDigest,
  readProjectProviders,
  requireEnabledProviderCapability,
} from "../core/tools/aidlc-project-provider.js";
import {
  providerGitCachePath,
  providerSshCommand,
  validateProviderGitSource,
} from "../core/tools/aidlc-provider-git.js";

const repository = resolve(import.meta.dirname, "..");
const tsx = resolve(repository, "node_modules", "tsx", "dist", "cli.mjs");
const cli = resolve(repository, "bin", "cli.ts");

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function providerManifest(): string {
  return `schema: aidlc.provider/v1.1
provider_id: framework.test-provider
name: Local Security Fixture Provider
version: 0.1.0
kind: validation
capabilities:
  - framework.test.validation
  - framework.test.knowledge
selectors:
  languages: [typescript]
  frameworks: [fixture]
entrypoint:
  path: bin/validate.js
  args: [--request]
ruleset:
  id: fixture-baseline
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

function createProviderRemote(root: string, markerRoot: string): { source: string; remote: string; sourceUrl: string; firstCommit: string } {
  const source = join(root, "provider-source");
  const remote = join(root, "provider-remote.git");
  const providerRoot = join(source, "providers", "fixture");
  mkdirSync(source, { recursive: true });
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "fixture@example.test");
  git(source, "config", "user.name", "Provider Fixture");
  write(join(providerRoot, "provider.yaml"), providerManifest());
  write(join(providerRoot, "rules", "catalog.json"), JSON.stringify({ rules: [
    { id: "fixture.rule", title: "Fixture", severity: "error", appliesTo: ["source"] },
  ] }, null, 2) + "\n");
  write(join(providerRoot, "provider.lock"), JSON.stringify({ lockfileVersion: 1, packages: {} }) + "\n");
  write(join(providerRoot, "sbom.spdx.json"), JSON.stringify({
    spdxVersion: "SPDX-2.3",
    SPDXID: "SPDXRef-DOCUMENT",
    name: "fixture-provider",
    documentNamespace: "https://example.test/sbom/fixture-provider/0.1.0",
  }) + "\n");
  write(join(providerRoot, "bin", "validate.js"), `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(join(markerRoot, "entrypoint-ran"))}, "unexpected");\n`);
  write(join(source, "package.json"), JSON.stringify({ scripts: {
    install: `node -e "require('fs').writeFileSync('${join(markerRoot, "install-ran").replace(/\\/g, "/")}', 'unexpected')"`,
    postinstall: `node -e "require('fs').writeFileSync('${join(markerRoot, "postinstall-ran").replace(/\\/g, "/")}', 'unexpected')"`,
    build: `node -e "require('fs').writeFileSync('${join(markerRoot, "build-ran").replace(/\\/g, "/")}', 'unexpected')"`,
  } }, null, 2) + "\n");
  write(join(source, ".gitattributes"), "providers/fixture/payload.txt filter=evil\n");
  write(join(providerRoot, "payload.txt"), "LFS/custom-filter payload\n");
  write(join(source, ".gitmodules"), `[submodule "evil"]\n\tpath = providers/fixture/vendor/evil\n\turl = file:///definitely-not-resolved\n`);
  git(source, "add", ".");
  // A gitlink with an arbitrary commit OID is enough to prove installation never initializes it.
  git(source, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},providers/fixture/vendor/evil`);
  git(source, "commit", "-m", "fixture v1");
  const firstCommit = git(source, "rev-parse", "HEAD");
  git(source, "tag", "v0.1.0");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "--bare");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");
  git(source, "push", "origin", "v0.1.0");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  return { source, remote, sourceUrl: pathToFileURL(remote).href, firstCommit };
}

function pushNextCommit(source: string, version: string): string {
  const catalog = join(source, "providers", "fixture", "rules", "catalog.json");
  const parsed = JSON.parse(readFileSync(catalog, "utf8")) as { rules: Array<Record<string, unknown>> };
  parsed.rules.push({ id: `fixture.rule-${version}`, title: version, severity: "warning", appliesTo: ["source"] });
  writeFileSync(catalog, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  git(source, "add", catalog);
  git(source, "commit", "-m", `fixture ${version}`);
  git(source, "push", "origin", "main");
  return git(source, "rev-parse", "HEAD");
}

function runCli(cwd: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [tsx, cli, ...args], { cwd, encoding: "utf8", shell: false , env: fixtureEnvironment(cwd, [...args]) });
}

const root = mkdtempSync(join(tmpdir(), "aidlc-project-provider-test-"));
const project = join(root, "project");
const markers = join(root, "markers");
const hostileHome = join(root, "hostile-home");
const hostileHooks = join(root, "hostile-hooks");
mkdirSync(project, { recursive: true });
mkdirSync(markers, { recursive: true });
mkdirSync(hostileHome, { recursive: true });
mkdirSync(hostileHooks, { recursive: true });
write(join(hostileHome, ".gitconfig"), `[core]\n\thooksPath = ${hostileHooks.replace(/\\/g, "/")}\n[filter "evil"]\n\tsmudge = node -e "require('fs').writeFileSync('${join(markers, "filter-ran").replace(/\\/g, "/")}', 'unexpected')"\n\trequired = true\n`);
const maliciousHook = join(hostileHooks, "post-checkout");
write(maliciousHook, `#!/bin/sh\nprintf unexpected > ${JSON.stringify(join(markers, "hook-ran").replace(/\\/g, "/"))}\n`);
try { chmodSync(maliciousHook, 0o755); } catch { /* Windows mode support is optional. */ }
mkdirSync(join(project, ".aidlc"), { recursive: true });
write(join(project, ".aidlc", "provider-git-policy.json"), JSON.stringify({ version: 1, allow_file_fixtures: true }) + "\n");
mkdirSync(join(project, "aidlc", "active"), { recursive: true });
write(join(project, "aidlc", "active", "aidlc-state.md"), renderLightWorkflowState(createInitialState("feature", undefined, undefined, [], "provider lifecycle fixture")));

const fixture = createProviderRemote(root, markers);
const previousHome = process.env.HOME;
const previousUserProfile = process.env.USERPROFILE;
const previousTemplate = process.env.GIT_TEMPLATE_DIR;
process.env.HOME = hostileHome;
process.env.USERPROFILE = hostileHome;
process.env.GIT_TEMPLATE_DIR = hostileHooks;

try {
  assert.throws(() => validateProviderGitSource("http://example.test/org/provider.git", project), /PROVIDER_SOURCE_DISALLOWED/);
  assert.throws(() => validateProviderGitSource("https://token@example.test/org/provider.git", project, {
    policy: { version: 1, allowed_hosts: ["example.test"], allowed_organizations: [], allowed_commits: [], allow_file_fixtures: false },
  }), /embed credentials/);
  const noFixtureProject = join(root, "no-fixture-policy");
  mkdirSync(noFixtureProject);
  assert.throws(() => validateProviderGitSource(fixture.sourceUrl, noFixtureProject), /test fixtures/);

  const added = addProjectProvider(project, {
    source: fixture.sourceUrl,
    ref: "main",
    subdir: "providers/fixture",
    instance: "fixture-provider",
    id: "framework.test-provider",
    config: { strict: true },
    allowFile: true,
  });
  assert.equal(added.status, "added");
  assert.equal(added.commit_oid, fixture.firstCommit);
  assert.equal(added.trust?.status, "untrusted");
  assert.equal(added.install_safety?.checkout, "none-object-database-only");
  assert.equal(added.install_safety?.provider_entrypoint, "not-executed");
  assert.equal(existsSync(join(project, PROJECT_PROVIDERS_PATH)), true);
  assert.equal(existsSync(join(project, PROJECT_PROVIDERS_LOCK_PATH)), true);
  for (const marker of ["entrypoint-ran", "install-ran", "postinstall-ran", "build-ran", "filter-ran", "hook-ran"]) {
    assert.equal(existsSync(join(markers, marker)), false, `${marker} must not be created during installation`);
  }

  const installed = readProjectProviders(project, false);
  assert.equal(installed.config.providers[0].source.subdir, "providers/fixture");
  assert.equal(installed.lock.providers[0].source.commit_oid, fixture.firstCommit);
  assert.equal(installed.lock.providers[0].source.subdir, "providers/fixture");
  assert.equal(installed.lock.providers[0].manifest.rulesets.length, 1);
  assert.match(installed.lock.providers[0].manifest.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(installed.lock.providers[0].artifacts.provider_lock_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(installed.lock.providers[0].artifacts.sbom_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(installed.lock.providers[0].project_config_digest, projectProviderConfigDigest(installed.config.providers[0]));
  assert.equal(listProjectProviders(project)[0].status, "current");
  assert.equal(getProjectProviderStatus(project, "fixture-provider").source.commit_oid, fixture.firstCommit);
  assert.equal(existsSync(providerGitCachePath(project, fixture.sourceUrl)), true);

  for (const [label, ref] of [["tag-provider", "v0.1.0"], ["commit-provider", fixture.firstCommit]] as const) {
    const refProject = join(root, label);
    mkdirSync(join(refProject, ".aidlc"), { recursive: true });
    write(join(refProject, ".aidlc", "provider-git-policy.json"), JSON.stringify({ allow_file_fixtures: true }) + "\n");
    const resolved = addProjectProvider(refProject, {
      source: fixture.sourceUrl,
      ref,
      subdir: "providers/fixture",
      instance: label,
      allowFile: true,
    });
    assert.equal(resolved.commit_oid, fixture.firstCommit, `${ref} must resolve once to the immutable commit`);
  }

  const cliList = runCli(project, "provider", "list", "--project", project, "--output", "json");
  assert.equal(cliList.status, 0, String(cliList.stderr));
  assert.equal(JSON.parse(String(cliList.stdout)).providers[0].instance_id, "fixture-provider");
  const cliHelp = runCli(project, "help");
  assert.equal(cliHelp.status, 0, String(cliHelp.stderr));
  assert.match(String(cliHelp.stdout), /provider add\|list\|status\|update\|enable\|disable\|remove/);
  const missingRef = runCli(project, "provider", "update", "fixture-provider", "--project", project);
  assert.equal(missingRef.status, 2);
  assert.match(String(missingRef.stderr), /requires --ref/);

  const configPath = join(project, PROJECT_PROVIDERS_PATH);
  const lockPath = join(project, PROJECT_PROVIDERS_LOCK_PATH);
  const configBeforeTamper = readFileSync(configPath, "utf8");
  writeFileSync(configPath, `${configBeforeTamper}unexpected: true\n`, "utf8");
  assert.throws(() => readProjectProviders(project, false), /unknown field unexpected/);
  writeFileSync(configPath, configBeforeTamper, "utf8");
  const lockBeforeTamper = readFileSync(lockPath, "utf8");
  writeFileSync(lockPath, lockBeforeTamper.replace(/lock_digest: sha256:[0-9a-f]{64}/, `lock_digest: sha256:${"0".repeat(64)}`), "utf8");
  assert.throws(() => readProjectProviders(project, false), /PROVIDER_LOCK_MISMATCH/);
  writeFileSync(lockPath, lockBeforeTamper, "utf8");

  const secondCommit = pushNextCommit(fixture.source, "v2");
  const offlineRemote = `${fixture.remote}.offline`;
  renameSync(fixture.remote, offlineRemote);
  // status is cache-only: branch movement and temporary remote unavailability do not change the locked instance.
  assert.equal(getProjectProviderStatus(project, "fixture-provider").source.commit_oid, fixture.firstCommit);
  renameSync(offlineRemote, fixture.remote);

  mkdirSync(join(project, ".aidlc", "provider-plans"), { recursive: true });
  mkdirSync(join(project, ".aidlc", "evidence", "providers"), { recursive: true });
  mkdirSync(join(project, ".aidlc", "provider-gates"), { recursive: true });
  write(join(project, ".aidlc", "provider-plans", "old-plan.json"), JSON.stringify({
    schema: "aidlc.provider-plan/v1.1",
    provider_instance_id: "fixture-provider",
    project_lock_digest: installed.lock.lock_digest,
  }) + "\n");
  write(join(project, ".aidlc", "evidence", "providers", "old-evidence.json"), JSON.stringify({
    schema: "aidlc.provider-evidence/v1.1",
    provider_instance: { instance_id: "fixture-provider", project_lock_digest: installed.lock.lock_digest },
  }) + "\n");
  write(join(project, ".aidlc", "provider-gates", "other-instance-gate.json"), JSON.stringify({
    schema: "aidlc.gate-decision/v1.1",
    provider_instance_id: "other-provider",
    project_lock_digest: installed.lock.lock_digest,
  }) + "\n");

  const updated = updateProjectProvider(project, "fixture-provider", "main", { allowFile: true });
  assert.equal(updated.status, "updated");
  assert.equal(updated.previous_commit_oid, fixture.firstCommit);
  assert.equal(updated.commit_oid, secondCommit);
  assert.notEqual(updated.lock_digest, installed.lock.lock_digest);
  assert.deepEqual(updated.invalidation?.affected_artifacts, [
    ".aidlc/evidence/providers/old-evidence.json",
    ".aidlc/provider-gates/other-instance-gate.json",
    ".aidlc/provider-plans/old-plan.json",
  ]);
  assert.equal(existsSync(join(project, updated.history!)), true);
  assert.throws(() => updateProjectProvider(project, "fixture-provider", "", { allowFile: true }), /explicit --ref/);

  const thirdCommit = pushNextCommit(fixture.source, "v3");
  assert.notEqual(thirdCommit, secondCommit);
  assert.equal(getProjectProviderStatus(project, "fixture-provider").source.commit_oid, secondCommit, "a moving branch must not change an existing lock");

  const disabled = setProjectProviderEnabled(project, "fixture-provider", false);
  assert.equal(disabled.status, "disabled");
  assert.throws(() => requireEnabledProviderCapability(project, "framework.test.validation", { stage: "code-generation" }), /disabled instances/);
  assert.equal(existsSync(join(project, ".aidlc", "evidence", "providers", "old-evidence.json")), true, "disable must preserve historical Evidence");

  renameSync(fixture.remote, offlineRemote);
  const enabled = setProjectProviderEnabled(project, "fixture-provider", true);
  assert.equal(enabled.status, "enabled", "enable must use the locked cache and not refresh the remote");
  assert.equal(requireEnabledProviderCapability(project, "framework.test.validation", { stage: "code-generation" })[0].lock.source.commit_oid, secondCommit);
  assert.throws(() => requireEnabledProviderCapability(project, "framework.test.validation", { stage: "code-generation" }, { protectedGate: true }), /PROVIDER_COMMIT_UNTRUSTED/);
  const currentCache = providerGitCachePath(project, fixture.sourceUrl);
  const cacheBackup = `${currentCache}.offline`;
  renameSync(currentCache, cacheBackup);
  assert.equal(getProjectProviderStatus(project, "fixture-provider").status, "blocked");
  assert.match(getProjectProviderStatus(project, "fixture-provider").diagnostic || "", /PROVIDER_SOURCE_UNAVAILABLE/);
  assert.throws(() => requireEnabledProviderCapability(project, "framework.test.validation", { stage: "code-generation" }), /PROVIDER_SOURCE_UNAVAILABLE/);
  renameSync(cacheBackup, currentCache);
  renameSync(offlineRemote, fixture.remote);

  const removed = removeProjectProvider(project, "fixture-provider");
  assert.equal(removed.status, "removed");
  assert.equal(readProjectProviders(project, false).config.providers.length, 0);
  assert.equal(readProjectProviders(project, false).lock.providers.length, 0);
  assert.equal(existsSync(currentCache), true, "remove keeps detached cache for history/recovery");
  assert.equal(existsSync(join(project, ".aidlc", "evidence", "providers", "old-evidence.json")), true, "remove must not delete historical Evidence");
  assert.equal(existsSync(join(project, PROJECT_PROVIDER_HISTORY_PATH, "fixture-provider")), true);
  assert.equal(existsSync(join(project, PROJECT_PROVIDER_INVALIDATIONS_PATH)), true);
  const audit = readFileSync(join(project, PROJECT_PROVIDER_AUDIT_PATH), "utf8");
  for (const event of ["PROVIDER_ADDED", "PROVIDER_UPDATED", "PROVIDER_DISABLED", "PROVIDER_ENABLED", "PROVIDER_REMOVED"]) assert.match(audit, new RegExp(event));
  const workflowAudit = readFileSync(join(project, "aidlc", "active", "audit.md"), "utf8");
  assert.match(workflowAudit, /PROVIDER_ADDED/);
  assert.match(workflowAudit, /PROVIDER_REMOVED/);

  const unavailableProject = join(root, "unavailable-project");
  mkdirSync(join(unavailableProject, ".aidlc"), { recursive: true });
  write(join(unavailableProject, ".aidlc", "provider-git-policy.json"), JSON.stringify({ version: 1, allow_file_fixtures: true }) + "\n");
  const missingRemote = pathToFileURL(join(root, "missing-provider.git")).href;
  assert.throws(() => addProjectProvider(unavailableProject, {
    source: missingRemote,
    ref: "main",
    subdir: "providers/fixture",
    instance: "missing-provider",
    allowFile: true,
  }), /PROVIDER_SOURCE_UNAVAILABLE/);
  assert.equal(existsSync(join(unavailableProject, PROJECT_PROVIDERS_PATH)), false, "failed install must not publish providers.yaml");
  assert.equal(existsSync(join(unavailableProject, PROJECT_PROVIDERS_LOCK_PATH)), false, "failed install must not publish providers.lock.yaml");

  for (const marker of ["entrypoint-ran", "install-ran", "postinstall-ran", "build-ran", "filter-ran", "hook-ran"]) {
    assert.equal(existsSync(join(markers, marker)), false, `${marker} must never be created by lifecycle operations`);
  }

  // Real Git fetch/index-pack must work past MAX_PATH without user Git settings.
  // This fails on Windows at the pack-*.keep file when core.longpaths is absent.
  const longBase = join(root, "project 中文 with spaces");
  const longProject = join(longBase, "p".repeat(Math.max(1, 220 - providerGitCachePath(longBase, fixture.sourceUrl).length - 1)));
  mkdirSync(longProject, { recursive: true });
  write(join(longProject, ".aidlc/provider-git-policy.json"), JSON.stringify({ version: 1, allow_file_fixtures: true }));
  assert(providerGitCachePath(longProject, fixture.sourceUrl).length + "/objects/pack/pack-".length + 40 + ".keep".length > 260);
  addProjectProvider(longProject, { source: fixture.sourceUrl, ref: "main", subdir: "providers/fixture", instance: "long-path-provider", allowFile: true });
  assert.equal(getProjectProviderStatus(longProject, "long-path-provider").status, "current");

  // Windows ssh sources must see the real user's known_hosts/keys despite the isolated HOME.
  assert.equal(providerSshCommand("linux", "/home/u", () => true), undefined, "POSIX ssh needs no override");
  const winSsh = providerSshCommand("win32", "C:\\Users\\o'neil", (path) => path.endsWith("/id_ed25519"));
  assert.ok(winSsh);
  assert.match(winSsh, /^ssh -F none -o BatchMode=yes -o StrictHostKeyChecking=yes /);
  assert.ok(winSsh.includes("UserKnownHostsFile='C:/Users/o'\\''neil/.ssh/known_hosts'"), winSsh);
  assert.ok(winSsh.includes("-i 'C:/Users/o'\\''neil/.ssh/id_ed25519'"), winSsh);
  assert.ok(!winSsh.includes("id_rsa"), "only existing identities are passed");
  console.log("Project Provider Git lifecycle and fail-closed tests passed");
} finally {
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
  if (previousTemplate === undefined) delete process.env.GIT_TEMPLATE_DIR; else process.env.GIT_TEMPLATE_DIR = previousTemplate;
  rmSync(root, { recursive: true, force: true });
}
