import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readProjectProviders, sha256FileDigest, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";
import type { JsonObject } from "./aidlc-provider-types.js";

/** Optional, versioned Manifest extension; does not widen the Provider v1.1 schema. */
export const MCP_REQUIREMENTS_SCHEMA = "aidlc.mcp-requirements/v1";

interface ConnectionRequirement {
  readonly name: string;
  readonly credential_domain: string;
  readonly config: JsonObject;
}

function fail(message: string): never { throw new Error(`PROVIDER_MCP_INVALID: ${message}`); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  for (const key of Object.keys(value)) if (!fields.includes(key)) fail(`unknown field ${key}`);
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail("expected nonempty text without control characters");
  return value;
}
function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [text(key), text(item)]));
}

/** Small declarative transport subset. No command, URL, environment or credential is evaluated. */
export function parseMcpRequirements(value: unknown, providerVersion: string): readonly ConnectionRequirement[] {
  const declaration = record(value);
  exact(declaration, ["schema", "version", "connections"]);
  if (declaration.schema !== MCP_REQUIREMENTS_SCHEMA) fail("incompatible requirement schema");
  if (declaration.version !== providerVersion) fail("requirement version differs from locked Provider version");
  if (!Array.isArray(declaration.connections) || declaration.connections.length > 128) fail("expected 0..128 connections");
  const names = new Set<string>();
  return declaration.connections.map((candidate) => {
    const item = record(candidate);
    exact(item, ["name", "credential_domain", "config"]);
    const name = text(item.name);
    if (!/^[a-z][a-z0-9._-]*$/.test(name) || names.has(name)) fail("invalid or duplicate connection name");
    names.add(name);
    const credential_domain = text(item.credential_domain);
    const config = record(item.config);
    if (config.type === "stdio") {
      exact(config, ["type", "command", "args", "env"]);
      text(config.command);
      if (!Array.isArray(config.args)) fail("stdio args must be an array");
      for (const arg of config.args) { if (typeof arg !== "string" || /[\u0000-\u001f\u007f]/.test(arg)) fail("invalid stdio argument"); }
      if (config.env !== undefined) stringMap(config.env);
    } else if (config.type === "http" || config.type === "sse") {
      exact(config, ["type", "url", "headers"]);
      let url: URL;
      try { url = new URL(text(config.url)); } catch { fail("invalid transport URL"); }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) fail("unsupported transport URL");
      if (config.headers !== undefined) stringMap(config.headers);
    } else fail("unsupported transport type");
    return { name, credential_domain, config: config as JsonObject };
  }).sort((a, b) => compare(a.name, b.name));
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Existing untyped stdio entries are equivalent; approval/disabled/unknown fields remain significant. */
function comparable(value: unknown): Record<string, unknown> {
  const config = record(value);
  return { ...config, ...(config.type === undefined && typeof config.command === "string" ? { type: "stdio" } : {}) };
}
function summary(value: unknown) {
  const config = comparable(value);
  return { config_digest: sha256ProviderDigest(config), fields: Object.keys(config).sort(), disabled: config.disabled === true };
}
function readSnapshot(path: string, allowMissing = false) {
  if (!existsSync(path)) {
    if (allowMissing) return { value: {}, digest: null };
    fail(`configuration file is missing: ${path}`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail("configuration must be a regular JSON file of at most 4 MiB");
  const bytes = readFileSync(path);
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("configuration is not valid JSON"); }
  return { value: record(value), digest: sha256FileDigest(bytes) };
}

/** Offline only: reads project intent/lock, cached immutable manifests and explicit JSON host snapshots.
 * This is a review artifact, never proof of authentication, authorization, ownership or permission to apply.
 * Config values are omitted from output so host secrets do not enter reports.
 */
export function resolveProviderMcpRequirements(project: string) {
  const state = readProjectProviders(project);
  const requirements: { connection: ConnectionRequirement; source: {
    instance_id: string; provider_id: string; version: string; commit_oid: string;
    manifest_digest: string; project_config_digest: string; declaration: string;
  } }[] = [];
  const diagnostics: { code: string; instance_id: string; message: string }[] = [];
  for (const intent of [...state.config.providers].sort((a, b) => compare(a.instance_id, b.instance_id))) {
    if (!intent.enabled) continue;
    const lock = state.lock.providers.find((entry) => entry.instance_id === intent.instance_id);
    if (!lock) fail(`missing lock for ${intent.instance_id}`);
    const { manifest } = verifyLockedProviderCache(project, lock);
    const declaration = manifest.extensions?.["aidlc.mcp"];
    if (declaration === undefined) {
      diagnostics.push({ code: "MCP_REQUIREMENTS_MISSING", instance_id: intent.instance_id, message: "Locked Manifest has no aidlc.mcp declaration; connection needs are unknown (declare an empty connections array for none)." });
      continue;
    }
    for (const connection of parseMcpRequirements(declaration, manifest.version)) {
      requirements.push({ connection, source: {
        instance_id: intent.instance_id, provider_id: lock.id, version: manifest.version,
        commit_oid: lock.source.commit_oid, manifest_digest: lock.manifest.digest,
        project_config_digest: lock.project_config_digest, declaration: "provider.yaml#extensions/aidlc.mcp",
      } });
    }
  }
  return { state, requirements, diagnostics };
}

export function previewProviderMcp(projectRoot: string, input: { hostConfig: string; hostDomains?: string }) {
  const project = resolve(projectRoot);
  const hostPath = resolve(project, input.hostConfig);
  const host = readSnapshot(hostPath, true);
  const hostValue = record(host.value);
  const servers = hostValue.mcpServers === undefined ? {} : record(hostValue.mcpServers);
  const domainsPath = input.hostDomains === undefined ? null : resolve(project, input.hostDomains);
  const domains = domainsPath === null ? null : readSnapshot(domainsPath);
  const domainMap = domains === null ? {} : stringMap(domains.value);
  const { state, requirements, diagnostics } = resolveProviderMcpRequirements(project);
  const names = [...new Set(requirements.map((item) => item.connection.name))].sort();
  const changes = names.map((name) => {
    const required = requirements.filter((item) => item.connection.name === name);
    const variants = new Set(required.map((item) => sha256ProviderDigest(item.connection)));
    const expected = required[0].connection;
    const present = Object.hasOwn(servers, name);
    const current = present ? comparable(servers[name]) : null;
    const reasons: string[] = [];
    if (variants.size > 1) reasons.push("provider_requirements_disagree");
    if (current) {
      if (sha256ProviderDigest(current) !== sha256ProviderDigest(expected.config)) reasons.push("host_config_differs");
      if (current.disabled === true) reasons.push("host_entry_disabled");
      // 'none' explicitly declares no credential realm; all other realms require host attribution.
      const hostDomain = Object.hasOwn(domainMap, name) ? domainMap[name] : "none";
      if (hostDomain !== expected.credential_domain) reasons.push("credential_domain_differs_or_unknown");
    }
    const fields = [...new Set([...Object.keys(expected.config), ...Object.keys(current ?? {})])].sort();
    return {
      name, action: reasons.length ? "conflict" as const : present ? "reuse" as const : "add" as const,
      reasons, current: current === null ? null : { ...summary(current), credential_domain: Object.hasOwn(domainMap, name) ? domainMap[name] : null },
      required: required.map((item) => ({ credential_domain: item.connection.credential_domain, ...summary(item.connection.config), source: item.source })),
      differing_fields: current === null ? fields : fields.filter((field) => sha256ProviderDigest(current[field] ?? null) !== sha256ProviderDigest(expected.config[field] ?? null)),
    };
  });
  const payload = {
    schema: "aidlc.mcp-preview/v1" as const, read_only: true as const,
    authentication: "not_checked" as const, authorization: "not_granted" as const,
    project_lock_digest: state.lock.lock_digest,
    host: { path: hostPath, digest: host.digest, domains_path: domainsPath, domains_digest: domains?.digest ?? null,
      entries: Object.keys(servers).sort().map((name) => ({ name, ...summary(servers[name]) })) },
    diagnostics, changes, ready: diagnostics.length === 0 && changes.every((change) => change.action !== "conflict"),
  };
  return { ...payload, preview_digest: sha256ProviderDigest(payload) };
}
