import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, runProviderCli, setProjectProviderEnabled } from "../core/tools/aidlc-provider-cli.js";
import { MCP_REQUIREMENTS_SCHEMA, parseMcpRequirements, previewProviderMcp } from "../core/tools/aidlc-provider-mcp.js";
import { sha256FileDigest, sha256ProviderDigest } from "../core/tools/aidlc-project-provider.js";

const root = mkdtempSync(join(tmpdir(), "aidlc-mcp-preview-"));
const source = join(root, "source");
const project = join(root, "project");
const hostConfig = join(root, "host.json");
const hostDomains = join(root, "domains.json");
const repo = resolve(import.meta.dirname, "..");
function write(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value)); }
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function snapshot(path: string): string {
  if (!existsSync(path)) return "missing";
  function files(dir: string): object { return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).map((entry) => [entry.name, entry.isDirectory() ? files(join(dir, entry.name)) : sha256FileDigest(readFileSync(join(dir, entry.name)))])); }
  return sha256ProviderDigest(files(path));
}
const config = { type: "stdio", command: "npx", args: ["-y", "fixture-service@2.0.0"] };
const connection = { name: "fixture-service", credential_domain: "none", config };
const declaration = (connections: unknown[]) => ({ schema: MCP_REQUIREMENTS_SCHEMA, version: "0.1.0", connections });
function preview() {
  const before = [snapshot(project), sha256FileDigest(readFileSync(hostConfig)), sha256FileDigest(readFileSync(hostDomains))];
  try { return previewProviderMcp(project, { hostConfig, hostDomains }); }
  finally { assert.deepEqual([snapshot(project), sha256FileDigest(readFileSync(hostConfig)), sha256FileDigest(readFileSync(hostDomains))], before, "every successful or rejected preview preserves project and host bytes"); }
}
function add(instance: string, subdir = instance) { return addProjectProvider(project, { source: pathToFileURL(source).href, ref: "main", subdir, instance, allowFile: true }); }
try {
  mkdirSync(project); mkdirSync(source);
  write(hostConfig, { mcpServers: {}, userSetting: true }); write(hostDomains, {});
  const noProvidersBefore = snapshot(project);
  assert.deepEqual(preview().changes, []);
  assert.equal(preview().ready, true);
  assert.equal(snapshot(project), noProvidersBefore, "zero Provider preview creates no project metadata");
  assert.equal(previewProviderMcp(project, { hostConfig: join(root, "absent-host.json") }).host.digest, null);
  assert.equal(existsSync(join(root, "absent-host.json")), false);
  assert.throws(() => runProviderCli(["mcp-preview", "--project", project]), /requires --host-config/);
  assert.throws(() => runProviderCli(["mcp-preview", "--project", project, "--host-config", hostConfig, "--apply"]), /unknown|unsupported/);

  git(source, "init", "-b", "main"); git(source, "config", "user.email", "fixture@example.test"); git(source, "config", "user.name", "Fixture");
  const packages = {
    primary: declaration([connection]),
    duplicate: declaration([connection]),
    different: declaration([{ ...connection, config: { ...config, args: ["fixture-service@3.0.0"] } }]),
    realm: declaration([{ ...connection, credential_domain: "tenant-a" }]),
    missing: undefined,
    empty: declaration([]),
    bad: { ...declaration([]), unknown: true },
  };
  for (const [name, mcp] of Object.entries(packages)) {
    const pkg = join(source, name);
    write(join(pkg, "provider.yaml"), {
      schema: "aidlc.provider/v1.1", provider_id: `fixture.${name}`, name, version: "0.1.0", kind: "command", capabilities: ["fixture.check"],
      entrypoint: { path: "bin/never.js" }, ruleset: { id: "fixture-rules", version: "0.1.0", catalog: "rules.json" },
      artifacts: { lock: "provider.lock", sbom: "sbom.json" }, policies: { network: "none", writes: [] },
      ...(mcp === undefined ? {} : { extensions: { "aidlc.mcp": mcp } }),
    });
    write(join(pkg, "rules.json"), { rules: [{ id: "fixture.rule", title: "Fixture", severity: "error", appliesTo: ["source"] }] });
    write(join(pkg, "provider.lock"), { lockfileVersion: 1, packages: {} });
    write(join(pkg, "sbom.json"), { spdxVersion: "SPDX-2.3", SPDXID: "SPDXRef-DOCUMENT", name, documentNamespace: `https://example.test/${name}` });
    mkdirSync(join(pkg, "bin"));
    writeFileSync(join(pkg, "bin/never.js"), "throw new Error('entrypoint must never execute');");
    write(join(pkg, "package.json"), { scripts: { install: "exit 1", postinstall: "exit 1" } });
  }
  git(source, "add", "."); git(source, "commit", "-m", "MCP requirement fixtures");
  add("primary"); add("duplicate"); add("different"); add("realm"); add("missing"); add("empty"); add("bad");
  for (const id of ["different", "realm", "missing", "bad"]) setProjectProviderEnabled(project, id, false);
  renameSync(source, `${source}-offline`);
  const before = snapshot(project);
  const hostBefore = readFileSync(hostConfig);
  const domainsBefore = readFileSync(hostDomains);
  const added = preview();
  assert.equal(added.changes.length, 1, "identical requirements coalesce");
  assert.equal(added.changes[0].action, "add");
  assert.equal(added.changes[0].required.length, 2);
  assert.deepEqual(added.diagnostics, [], "explicit empty requirements are supported; disabled invalid declarations ignored");
  assert.equal(added.changes[0].required[0].source.version, "0.1.0");
  assert.equal(added.authentication, "not_checked"); assert.equal(added.authorization, "not_granted");
  assert.deepEqual(preview(), added, "preview is deterministic and offline");
  assert.equal(snapshot(project), before, "preview leaves all project and cached package bytes unchanged");
  assert.deepEqual(readFileSync(hostConfig), hostBefore);
  assert.deepEqual(readFileSync(hostDomains), domainsBefore);
  assert.deepEqual(runProviderCli(["mcp-preview", "--project", project, "--host-config", hostConfig, "--host-domains", hostDomains]), added);

  write(hostConfig, { mcpServers: { "fixture-service": config, unrelated: { url: "https://example.test/mcp", headers: { Authorization: "secret-value" } } } });
  assert.equal(preview().changes[0].action, "reuse");
  assert.equal(JSON.stringify(preview()).includes("secret-value"), false, "host credentials never enter the preview");
  const { type: _, ...untypedStdio } = config;
  write(hostConfig, { mcpServers: { "fixture-service": untypedStdio } });
  assert.equal(preview().changes[0].action, "reuse", "ordinary untyped stdio host config is supported");
  const pinned = { ...config, args: ["-y", "fixture-service@1.0.0"], userPin: true };
  write(hostConfig, { mcpServers: { "fixture-service": pinned } });
  const pinBytes = readFileSync(hostConfig);
  const conflict = preview();
  assert.equal(conflict.changes[0].action, "conflict");
  assert.ok(conflict.changes[0].differing_fields.includes("args"));
  assert.deepEqual(readFileSync(hostConfig), pinBytes, "user pin and unknown host fields preserved");
  write(hostConfig, { mcpServers: { "fixture-service": { ...config, disabled: true } } });
  assert.ok(preview().changes[0].reasons.includes("host_entry_disabled"));

  write(hostConfig, { mcpServers: { "fixture-service": config } });
  setProjectProviderEnabled(project, "different", true);
  assert.ok(preview().changes[0].reasons.includes("provider_requirements_disagree"));
  setProjectProviderEnabled(project, "different", false);
  setProjectProviderEnabled(project, "realm", true);
  assert.ok(preview().changes[0].reasons.includes("provider_requirements_disagree"), "same config, different credential domains conflict");
  setProjectProviderEnabled(project, "primary", false); setProjectProviderEnabled(project, "duplicate", false);
  assert.ok(preview().changes[0].reasons.includes("credential_domain_differs_or_unknown"));
  write(hostDomains, { "fixture-service": "tenant-b" });
  assert.equal(preview().changes[0].action, "conflict");
  write(hostDomains, { "fixture-service": "tenant-a" });
  assert.equal(preview().changes[0].action, "reuse", "explicit matching domain is configuration compatibility only");
  setProjectProviderEnabled(project, "realm", false); setProjectProviderEnabled(project, "missing", true);
  assert.equal(preview().diagnostics[0].code, "MCP_REQUIREMENTS_MISSING"); assert.equal(preview().ready, false);
  setProjectProviderEnabled(project, "missing", false); setProjectProviderEnabled(project, "bad", true);
  const invalidBefore = snapshot(project);
  assert.throws(preview, /unknown field/);
  assert.equal(snapshot(project), invalidBefore, "rejected declarations cannot mutate the project");
  setProjectProviderEnabled(project, "bad", false);
  assert.deepEqual(preview().changes, [], "all disabled plus explicit none yields zero requirements");

  for (const invalid of [
    { ...declaration([]), schema: "aidlc.mcp-requirements/v2" },
    { ...declaration([]), version: "0.2.0" },
    declaration([{ ...connection, config: { ...config, unknown: true } }]),
    declaration([{ ...connection, unknown: true }]),
    declaration([{ ...connection, config: { type: "http", url: "file:///etc/passwd" } }]),
    declaration([{ ...connection, config: { type: "http", url: "https://user:secret@example.test" } }]),
    declaration([connection, connection]),
  ]) assert.throws(() => parseMcpRequirements(invalid, "0.1.0"), /PROVIDER_MCP_INVALID/);
  assert.equal(parseMcpRequirements(declaration([{ ...connection, config: { type: "http", url: "https://example.test/mcp" } }]), "0.1.0").length, 1);
  write(hostConfig, { mcpServers: [] }); assert.throws(preview, /expected object/);
  writeFileSync(hostConfig, "not json"); assert.throws(preview, /not valid JSON/);
  write(hostConfig, { mcpServers: {} });
  const cli = spawnSync(process.execPath, ["--import", "tsx", join(repo, "bin/cli.ts"), "provider", "mcp-preview", "--project", project, "--host-config", hostConfig], { cwd: repo, encoding: "utf8", shell: false });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).read_only, true);
  console.log("Provider MCP offline preview: resolution, provenance, pins, conflicts, strict declarations, CLI and unchanged snapshots passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
