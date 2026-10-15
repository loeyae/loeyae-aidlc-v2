import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendProviderLifecycleAudit,
  archiveProjectProviderLock,
  createProjectProviders,
  createProjectProvidersLock,
  parseProviderYaml,
  projectProviderConfigDigest,
  readProjectProviders,
  recordProviderInvalidation,
  sha256ProviderDigest,
  writeProjectProviders,
  type ProjectProviderState,
  type ProviderInvalidationRecord,
} from "./aidlc-project-provider";
import {
  fetchProviderGitBundle,
  verifyLockedProviderCache,
  type ProviderGitBundle,
} from "./aidlc-provider-git";
import type {
  JsonObject,
  ProjectProviderIntent,
  ProjectProviderLockEntry,
  ProjectProvidersLockV1,
  ProviderFallbackRecord,
  ProviderWaiver,
  Sha256Digest,
} from "./aidlc-provider-types";
import {
  probeRestrictedV1Sandbox,
  runControlledProvider,
  type ProviderRunInput,
} from "./aidlc-provider-runner";
import { evaluateProviderGate } from "./aidlc-provider-gate";
import { loadProviderKnowledge, confirmProviderKnowledge, verifyProviderKnowledge } from "./aidlc-provider-knowledge.js";
import { previewProviderMcp } from "./aidlc-provider-mcp.js";
import { applyProviderMcp, planProviderMcp } from "./aidlc-provider-mcp-apply.js";

export interface ProviderLifecycleResult {
  readonly status: "added" | "updated" | "enabled" | "disabled" | "removed" | "unchanged";
  readonly instance_id: string;
  readonly provider_id: string;
  readonly commit_oid?: string;
  readonly previous_commit_oid?: string;
  readonly lock_digest: Sha256Digest;
  readonly previous_lock_digest: Sha256Digest | null;
  readonly trust?: ProjectProviderLockEntry["trust"];
  readonly history?: string;
  readonly invalidation?: { readonly path: string; readonly affected_artifacts: readonly string[] };
  readonly install_safety?: ProviderGitBundle["install_safety"];
}

export interface ProviderStatusResult {
  readonly instance_id: string;
  readonly provider_id: string;
  readonly enabled: boolean;
  readonly status: "current" | "disabled" | "blocked";
  readonly lock_consistent: boolean;
  readonly source: ProjectProviderLockEntry["source"];
  readonly manifest: ProjectProviderLockEntry["manifest"];
  readonly trust: ProjectProviderLockEntry["trust"];
  readonly bindings: ProjectProviderIntent["bindings"];
  readonly config_digest: Sha256Digest;
  readonly lock_digest: Sha256Digest;
  readonly cache?: string;
  readonly diagnostic?: string;
}

function instanceId(value: string): string {
  const parsed = value.trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(parsed)) throw new Error(`instance_id must be a Provider identifier: ${JSON.stringify(value)}`);
  return parsed;
}

function providerId(value: string): string {
  const parsed = value.trim();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(parsed)) throw new Error(`provider id must be a Provider identifier: ${JSON.stringify(value)}`);
  return parsed;
}

function defaultInstance(provider: string): string {
  const tail = provider.split(".").at(-1) || provider;
  return instanceId(tail.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase());
}

function sourceInstanceHint(source: string): string {
  const withoutSuffix = source.replace(/[\\/]+$/, "").split(/[\\/:]/).at(-1)?.replace(/\.git$/i, "") || "provider";
  const normalized = withoutSuffix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `provider-${normalized || "source"}`;
}

function jsonConfig(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${field} must be a JSON/YAML object`);
  return value as JsonObject;
}

function loadConfigArgument(projectRoot: string, value?: string): JsonObject {
  if (!value) return {};
  const candidate = resolve(projectRoot, value);
  if (existsSync(candidate)) {
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`--config must be a regular non-symlink file: ${candidate}`);
    return jsonConfig(parseProviderYaml(readFileSync(candidate, "utf8"), "Provider project config"), "Provider project config");
  }
  return jsonConfig(parseProviderYaml(value, "Provider project config"), "Provider project config");
}

function trustMode(value?: string): ProjectProviderIntent["trust"]["mode"] {
  const mode = value || "untrusted-development";
  if (mode !== "untrusted-development" && mode !== "signed-commit-or-tag" && mode !== "allowlisted-commit") {
    throw new Error(`--trust must be untrusted-development, signed-commit-or-tag, or allowlisted-commit`);
  }
  return mode;
}

function replaceIntent(state: ProjectProviderState, intent: ProjectProviderIntent): ProjectProviderIntent[] {
  return state.config.providers.map((candidate) => candidate.instance_id === intent.instance_id ? intent : candidate);
}

function replaceLock(state: ProjectProviderState, entry: ProjectProviderLockEntry): ProjectProviderLockEntry[] {
  return state.lock.providers.map((candidate) => candidate.instance_id === entry.instance_id ? entry : candidate);
}

function lifecycleInvalidation(
  projectRoot: string,
  action: ProviderInvalidationRecord["action"],
  instance: string,
  reason: string,
  previousLockDigest: Sha256Digest | null,
  lock: ProjectProvidersLockV1,
): ProviderLifecycleResult["invalidation"] {
  if (previousLockDigest === lock.lock_digest) return undefined;
  const invalidation = recordProviderInvalidation(projectRoot, {
    instance_id: instance,
    action,
    reason,
    old_lock_digest: previousLockDigest,
    new_lock_digest: lock.lock_digest,
  });
  return { path: invalidation.path, affected_artifacts: invalidation.record.affected_artifacts };
}

function auditLifecycle(projectRoot: string, event: string, result: ProviderLifecycleResult): void {
  appendProviderLifecycleAudit(projectRoot, event, {
    "Provider Instance": result.instance_id,
    "Provider ID": result.provider_id,
    "Previous Commit": result.previous_commit_oid || "-",
    "Commit": result.commit_oid || "-",
    "Previous Lock Digest": result.previous_lock_digest || "-",
    "Lock Digest": result.lock_digest,
    "Lock History": result.history || "-",
    "Invalidation": result.invalidation?.path || "none",
    "Invalidated Artifacts": result.invalidation?.affected_artifacts.length ?? 0,
    Status: result.status,
  });
}

export function addProjectProvider(
  projectRoot: string,
  input: {
    readonly source: string;
    readonly ref?: string;
    readonly subdir?: string;
    readonly id?: string;
    readonly instance?: string;
    readonly config?: JsonObject;
    readonly trust?: ProjectProviderIntent["trust"]["mode"];
    readonly requiredForProtectedGates?: boolean;
    readonly allowFile?: boolean;
    readonly modules?: readonly string[];
    readonly units?: readonly string[];
    readonly stages?: readonly string[];
    readonly capabilities?: readonly string[];
  },
): ProviderLifecycleResult {
  const state = readProjectProviders(projectRoot, true);
  const explicitInstance = input.instance ? instanceId(input.instance) : undefined;
  if (explicitInstance && state.config.providers.some((provider) => provider.instance_id === explicitInstance)) {
    throw new Error(`Provider instance already exists: ${explicitInstance}`);
  }
  const expectedId = input.id ? providerId(input.id) : undefined;
  const provisionalInstance = explicitInstance || sourceInstanceHint(input.source);
  const mode = input.trust || "untrusted-development";
  const bundle = fetchProviderGitBundle(projectRoot, {
    source: input.source,
    ref: input.ref || "HEAD",
    subdir: input.subdir,
    instance_id: provisionalInstance,
    expected_provider_id: expectedId,
    project_config_digest: sha256ProviderDigest({}),
    trust_mode: mode,
  }, { allowFile: input.allowFile });
  const instance = explicitInstance || defaultInstance(bundle.manifest.provider_id);
  if (state.config.providers.some((provider) => provider.instance_id === instance)) throw new Error(`Provider instance already exists: ${instance}`);
  const requestedCapabilities = input.capabilities?.length ? [...new Set(input.capabilities)] : [...bundle.manifest.capabilities];
  const unknownCapabilities = requestedCapabilities.filter((capability) => !bundle.manifest.capabilities.includes(capability));
  if (unknownCapabilities.length > 0) throw new Error(`Provider manifest does not declare requested capabilities: ${unknownCapabilities.join(", ")}`);
  const bindingValues = (values: readonly string[] | undefined, fallback: string[], label: string, allowStar: boolean): string[] => {
    const selected = values?.length ? [...new Set(values)] : fallback;
    if (selected.some((value) => !(allowStar && value === "*") && !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value))) {
      throw new Error(`${label} values must be Provider identifiers${allowStar ? " or *" : ""}`);
    }
    return selected;
  };
  const modules = bindingValues(input.modules, ["*"], "--module", true);
  const stages = bindingValues(input.stages, ["*"], "--stage", true);
  const units = input.units?.length ? bindingValues(input.units, [], "--unit", true) : undefined;
  const intent: ProjectProviderIntent = {
    instance_id: instance,
    id: bundle.manifest.provider_id,
    source: {
      git: bundle.source.source,
      ref: bundle.requested_ref,
      ...(bundle.subdir ? { subdir: bundle.subdir } : {}),
    },
    enabled: true,
    config: input.config || {},
    bindings: [{ modules, ...(units ? { units } : {}), stages, capabilities: requestedCapabilities }],
    trust: {
      mode,
      required_for_protected_gates: input.requiredForProtectedGates === true,
    },
  };
  const config = createProjectProviders([...state.config.providers, intent]);
  const entry: ProjectProviderLockEntry = {
    ...bundle.lock_entry,
    instance_id: instance,
    id: intent.id,
    source: { ...bundle.lock_entry.source, git: intent.source.git, requested_ref: intent.source.ref, subdir: intent.source.subdir ?? null },
    project_config_digest: projectProviderConfigDigest(intent),
  };
  const lock = createProjectProvidersLock(config, [...state.lock.providers, entry]);
  writeProjectProviders(projectRoot, config, lock, { expectedLockDigest: state.persisted ? state.lock.lock_digest : null });
  const invalidation = lifecycleInvalidation(projectRoot, "add", instance, `Provider ${instance} was added`, state.persisted ? state.lock.lock_digest : null, lock);
  const result: ProviderLifecycleResult = {
    status: "added",
    instance_id: instance,
    provider_id: intent.id,
    commit_oid: entry.source.commit_oid,
    lock_digest: lock.lock_digest,
    previous_lock_digest: state.persisted ? state.lock.lock_digest : null,
    trust: entry.trust,
    invalidation,
    install_safety: bundle.install_safety,
  };
  auditLifecycle(projectRoot, "PROVIDER_ADDED", result);
  return result;
}

export function updateProjectProvider(
  projectRoot: string,
  instanceValue: string,
  refValue: string,
  options: { allowFile?: boolean } = {},
): ProviderLifecycleResult {
  const instance = instanceId(instanceValue);
  if (!refValue?.trim()) throw new Error("provider update requires an explicit --ref <tag|branch|commit>");
  const state = readProjectProviders(projectRoot, false);
  const current = state.config.providers.find((provider) => provider.instance_id === instance);
  const currentLock = state.lock.providers.find((provider) => provider.instance_id === instance);
  if (!current || !currentLock) throw new Error(`Provider instance is not installed: ${instance}`);
  const updatedIntent: ProjectProviderIntent = { ...current, source: { ...current.source, ref: refValue.trim() } };
  const config = createProjectProviders(replaceIntent(state, updatedIntent));
  const bundle = fetchProviderGitBundle(projectRoot, {
    source: current.source.git,
    ref: refValue,
    subdir: current.source.subdir,
    instance_id: instance,
    expected_provider_id: current.id,
    project_config_digest: projectProviderConfigDigest(updatedIntent),
    trust_mode: current.trust.mode,
  }, { allowFile: options.allowFile });
  const nextEntry = { ...bundle.lock_entry, instance_id: instance, project_config_digest: projectProviderConfigDigest(updatedIntent) };
  const lock = createProjectProvidersLock(config, replaceLock(state, nextEntry));
  if (lock.lock_digest === state.lock.lock_digest) {
    const result: ProviderLifecycleResult = {
      status: "unchanged",
      instance_id: instance,
      provider_id: current.id,
      commit_oid: currentLock.source.commit_oid,
      previous_commit_oid: currentLock.source.commit_oid,
      lock_digest: lock.lock_digest,
      previous_lock_digest: state.lock.lock_digest,
      trust: currentLock.trust,
      install_safety: bundle.install_safety,
    };
    auditLifecycle(projectRoot, "PROVIDER_UPDATE_UNCHANGED", result);
    return result;
  }
  writeProjectProviders(projectRoot, config, lock, { expectedLockDigest: state.lock.lock_digest });
  const history = archiveProjectProviderLock(projectRoot, state.lock.lock_digest, currentLock, "update");
  const invalidation = lifecycleInvalidation(projectRoot, "update", instance, `Provider ${instance} ref changed to ${refValue.trim()}`, state.lock.lock_digest, lock);
  const result: ProviderLifecycleResult = {
    status: "updated",
    instance_id: instance,
    provider_id: current.id,
    commit_oid: nextEntry.source.commit_oid,
    previous_commit_oid: currentLock.source.commit_oid,
    lock_digest: lock.lock_digest,
    previous_lock_digest: state.lock.lock_digest,
    trust: nextEntry.trust,
    history,
    invalidation,
    install_safety: bundle.install_safety,
  };
  auditLifecycle(projectRoot, "PROVIDER_UPDATED", result);
  return result;
}

export function setProjectProviderEnabled(projectRoot: string, instanceValue: string, enabled: boolean): ProviderLifecycleResult {
  const instance = instanceId(instanceValue);
  const state = readProjectProviders(projectRoot, false);
  const current = state.config.providers.find((provider) => provider.instance_id === instance);
  const currentLock = state.lock.providers.find((provider) => provider.instance_id === instance);
  if (!current || !currentLock) throw new Error(`Provider instance is not installed: ${instance}`);
  if (current.enabled === enabled) {
    const result: ProviderLifecycleResult = {
      status: "unchanged",
      instance_id: instance,
      provider_id: current.id,
      commit_oid: currentLock.source.commit_oid,
      previous_commit_oid: currentLock.source.commit_oid,
      lock_digest: state.lock.lock_digest,
      previous_lock_digest: state.lock.lock_digest,
      trust: currentLock.trust,
    };
    auditLifecycle(projectRoot, enabled ? "PROVIDER_ENABLE_UNCHANGED" : "PROVIDER_DISABLE_UNCHANGED", result);
    return result;
  }
  if (enabled) verifyLockedProviderCache(projectRoot, currentLock);
  const updated: ProjectProviderIntent = { ...current, enabled };
  const config = createProjectProviders(replaceIntent(state, updated));
  const lock = createProjectProvidersLock(config, state.lock.providers);
  writeProjectProviders(projectRoot, config, lock, { expectedLockDigest: state.lock.lock_digest });
  const action = enabled ? "enable" : "disable";
  const history = archiveProjectProviderLock(projectRoot, state.lock.lock_digest, currentLock, action);
  const invalidation = lifecycleInvalidation(projectRoot, action, instance, `Provider ${instance} was ${enabled ? "enabled" : "disabled"}`, state.lock.lock_digest, lock);
  const result: ProviderLifecycleResult = {
    status: enabled ? "enabled" : "disabled",
    instance_id: instance,
    provider_id: current.id,
    commit_oid: currentLock.source.commit_oid,
    previous_commit_oid: currentLock.source.commit_oid,
    lock_digest: lock.lock_digest,
    previous_lock_digest: state.lock.lock_digest,
    trust: currentLock.trust,
    history,
    invalidation,
  };
  auditLifecycle(projectRoot, enabled ? "PROVIDER_ENABLED" : "PROVIDER_DISABLED", result);
  return result;
}

export function removeProjectProvider(projectRoot: string, instanceValue: string): ProviderLifecycleResult {
  const instance = instanceId(instanceValue);
  const state = readProjectProviders(projectRoot, false);
  const current = state.config.providers.find((provider) => provider.instance_id === instance);
  const currentLock = state.lock.providers.find((provider) => provider.instance_id === instance);
  if (!current || !currentLock) throw new Error(`Provider instance is not installed: ${instance}`);
  const config = createProjectProviders(state.config.providers.filter((provider) => provider.instance_id !== instance));
  const lock = createProjectProvidersLock(config, state.lock.providers.filter((provider) => provider.instance_id !== instance));
  writeProjectProviders(projectRoot, config, lock, { expectedLockDigest: state.lock.lock_digest });
  const history = archiveProjectProviderLock(projectRoot, state.lock.lock_digest, currentLock, "remove");
  const invalidation = lifecycleInvalidation(projectRoot, "remove", instance, `Provider ${instance} was removed`, state.lock.lock_digest, lock);
  const result: ProviderLifecycleResult = {
    status: "removed",
    instance_id: instance,
    provider_id: current.id,
    previous_commit_oid: currentLock.source.commit_oid,
    lock_digest: lock.lock_digest,
    previous_lock_digest: state.lock.lock_digest,
    history,
    invalidation,
  };
  auditLifecycle(projectRoot, "PROVIDER_REMOVED", result);
  return result;
}

function statusFromState(state: ProjectProviderState, projectRoot: string, intent: ProjectProviderIntent): ProviderStatusResult {
  const entry = state.lock.providers.find((candidate) => candidate.instance_id === intent.instance_id)!;
  try {
    const cache = verifyLockedProviderCache(projectRoot, entry);
    return {
      instance_id: intent.instance_id,
      provider_id: intent.id,
      enabled: intent.enabled,
      status: intent.enabled ? "current" : "disabled",
      lock_consistent: true,
      source: entry.source,
      manifest: entry.manifest,
      trust: entry.trust,
      bindings: intent.bindings,
      config_digest: entry.project_config_digest,
      lock_digest: state.lock.lock_digest,
      cache: cache.cache_path,
    };
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    return {
      instance_id: intent.instance_id,
      provider_id: intent.id,
      enabled: intent.enabled,
      status: "blocked",
      lock_consistent: !/PROVIDER_LOCK_MISMATCH|PROVIDER_COMMIT_REVOKED/.test(diagnostic),
      source: entry.source,
      manifest: entry.manifest,
      trust: entry.trust,
      bindings: intent.bindings,
      config_digest: entry.project_config_digest,
      lock_digest: state.lock.lock_digest,
      diagnostic,
    };
  }
}

export function listProjectProviders(projectRoot = process.cwd()): ProviderStatusResult[] {
  const state = readProjectProviders(projectRoot, true);
  return state.config.providers.map((intent) => statusFromState(state, projectRoot, intent));
}

export function getProjectProviderStatus(projectRoot: string, instanceValue: string): ProviderStatusResult {
  const instance = instanceId(instanceValue);
  const state = readProjectProviders(projectRoot, false);
  const intent = state.config.providers.find((provider) => provider.instance_id === instance);
  if (!intent) throw new Error(`Provider instance is not installed: ${instance}`);
  return statusFromState(state, projectRoot, intent);
}

interface ParsedCli {
  readonly positionals: string[];
  readonly options: Readonly<Record<string, string | readonly string[] | boolean>>;
}

const BOOLEAN_OPTIONS = new Set(["allow-file", "required-for-protected-gates"]);
const REPEATABLE_OPTIONS = new Set(["input", "evidence", "waiver", "fallback", "module", "unit", "stage", "capability", "approve-config"]);
const VALUE_OPTIONS = new Set(["ref", "subdir", "id", "instance", "project", "config", "trust", "output", "plan", "node", "timeout", "mode", "delivery-digest", "consumer", "host-config", "host-domains", ...REPEATABLE_OPTIONS]);

function parseCli(args: readonly string[]): ParsedCli {
  const positionals: string[] = [];
  const options: Record<string, string | string[] | boolean> = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equal = argument.indexOf("=");
    const key = argument.slice(2, equal < 0 ? undefined : equal);
    if (!BOOLEAN_OPTIONS.has(key) && !VALUE_OPTIONS.has(key)) throw new Error(`unknown provider option: --${key}`);
    if (key in options && !REPEATABLE_OPTIONS.has(key)) throw new Error(`duplicate provider option: --${key}`);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (equal >= 0) throw new Error(`--${key} does not take a value`);
      options[key] = true;
      continue;
    }
    const setValue = (value: string): void => {
      if (!REPEATABLE_OPTIONS.has(key)) {
        options[key] = value;
        return;
      }
      const previous = options[key];
      options[key] = [...(Array.isArray(previous) ? previous : []), value];
    };
    if (equal >= 0) {
      const value = argument.slice(equal + 1);
      if (!value) throw new Error(`--${key} requires a value`);
      setValue(value);
      continue;
    }
    if (key === "project" && (!args[index + 1] || args[index + 1].startsWith("--"))) {
      options[key] = process.cwd();
      continue;
    }
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`--${key} requires a value`);
    setValue(args[++index]);
  }
  return { positionals, options };
}

function option(parsed: ParsedCli, key: string): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function optionValues(parsed: ParsedCli, key: string): string[] {
  const value = parsed.options[key];
  if (Array.isArray(value)) return [...value];
  return typeof value === "string" ? [value] : [];
}

function project(parsed: ParsedCli): string {
  return resolve(option(parsed, "project") || process.cwd());
}

function assertOptions(parsed: ParsedCli, allowed: readonly string[]): void {
  const known = new Set(allowed);
  for (const key of Object.keys(parsed.options)) if (!known.has(key)) throw new Error(`--${key} is not valid for this provider command`);
  const output = option(parsed, "output");
  if (output && output !== "json") throw new Error("--output currently accepts only json");
}

export function providerCliUsage(): string {
  return [
    "Usage: loeyae-aidlc provider <command> [options]",
    "",
    "  add <git-url> [--ref <ref>] [--subdir <path>] [--id <provider-id>] [--instance <id>]",
    "      [--module <id|*>]... [--unit <id|*>]... [--stage <slug|*>]... [--capability <id>]...",
    "      [--config <file-or-inline-yaml>] [--trust <mode>] [--required-for-protected-gates] [--project <path>]",
    "  list [--project [path]]",
    "  status <instance-id> [--project <path>]",
    "  update <instance-id> --ref <ref> [--project <path>]",
    "  enable <instance-id> [--project <path>]",
    "  disable <instance-id> [--project <path>]",
    "  remove <instance-id> [--project <path>]",
    "  probe [--project <path>]",
    "  mcp-preview --host-config <json-path> [--host-domains <json-path>] [--project <path>]",
    "  mcp-plan --host-config <json-path> [--host-domains <json-path>] [--project <path>]",
    "  mcp-apply --host-config <json-path> --plan <json-file> [--approve-config <digest>]... [--host-domains <json-path>] [--project <path>]",
    "  knowledge-load --plan <plan-id|path> --node <node-id> [--project <path>]",
    "  knowledge-confirm --plan <plan-id|path> --node <node-id> --delivery-digest <digest> --consumer <host-session> [--project <path>]",
    "  knowledge-verify --plan <plan-id|path> --node <node-id> [--project <path>]",
    "  run --plan <plan-id|path> --node <node-id> [--input <id>=<project-relative-path>]... [--timeout <ms>] [--project <path>]",
    "  gate --plan <plan-id|path> [--evidence <evidence-id|path>]... [--waiver <json-file>]... [--fallback <json-file>]... [--project <path>]",
    "",
    "file:// and absolute-path sources are test-fixture-only and require --allow-file or AIDLC_PROVIDER_ALLOW_FILE=1.",
    `Production https/ssh sources require host allowlisting in .aidlc/provider-git-policy.json.`,
  ].join("\n");
}

export function runProviderCli(args = process.argv.slice(2)): unknown {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") return { usage: providerCliUsage() };
  const parsed = parseCli(rest);
  const root = project(parsed);
  if (command === "mcp-plan" || command === "mcp-apply") {
    assertOptions(parsed, ["host-config", "host-domains", "project", "output", ...(command === "mcp-apply" ? ["plan", "approve-config"] : [])]);
    const hostConfig = option(parsed, "host-config");
    if (!hostConfig || parsed.positionals.length) throw new Error(`${command} requires --host-config and no positional arguments`);
    const input = { hostConfig, hostDomains: option(parsed, "host-domains") };
    if (command === "mcp-plan") return planProviderMcp(root, input);
    const planPath = option(parsed, "plan");
    if (!planPath) throw new Error("mcp-apply requires --plan");
    return applyProviderMcp(root, { ...input, plan: JSON.parse(readFileSync(resolve(root, planPath), "utf8")), approvedConfigs: optionValues(parsed, "approve-config") });
  }
  if (command === "mcp-preview") {
    assertOptions(parsed, ["host-config", "host-domains", "project", "output"]);
    const hostConfig = option(parsed, "host-config");
    if (!hostConfig || parsed.positionals.length) throw new Error("mcp-preview requires --host-config and no positional arguments");
    return previewProviderMcp(root, { hostConfig, hostDomains: option(parsed, "host-domains") });
  }
  if (["knowledge-load", "knowledge-confirm", "knowledge-verify"].includes(command)) {
    assertOptions(parsed, ["plan", "node", "project", "output", ...(command === "knowledge-confirm" ? ["delivery-digest", "consumer"] : [])]);
    const plan = option(parsed, "plan");
    const nodeId = option(parsed, "node");
    if (!plan || !nodeId || parsed.positionals.length) throw new Error(`${command} requires --plan and --node, without positional arguments`);
    if (command === "knowledge-load") return loadProviderKnowledge(root, { plan, nodeId });
    if (command === "knowledge-verify") return verifyProviderKnowledge(root, { plan, nodeId });
    const deliveryDigest = option(parsed, "delivery-digest");
    const consumer = option(parsed, "consumer");
    if (!deliveryDigest || !consumer) throw new Error("knowledge-confirm requires --delivery-digest and --consumer after host context loading");
    return confirmProviderKnowledge(root, { plan, nodeId, deliveryDigest, consumer });
  }
  if (command === "add") {
    assertOptions(parsed, ["ref", "subdir", "id", "instance", "project", "config", "trust", "required-for-protected-gates", "allow-file", "module", "unit", "stage", "capability", "output"]);
    if (parsed.positionals.length !== 1) throw new Error("provider add requires exactly one <git-url>");
    return addProjectProvider(root, {
      source: parsed.positionals[0],
      ref: option(parsed, "ref"),
      subdir: option(parsed, "subdir"),
      id: option(parsed, "id"),
      instance: option(parsed, "instance"),
      config: loadConfigArgument(root, option(parsed, "config")),
      trust: trustMode(option(parsed, "trust")),
      requiredForProtectedGates: parsed.options["required-for-protected-gates"] === true,
      allowFile: parsed.options["allow-file"] === true,
      modules: optionValues(parsed, "module"),
      units: optionValues(parsed, "unit"),
      stages: optionValues(parsed, "stage"),
      capabilities: optionValues(parsed, "capability"),
    });
  }
  if (command === "list") {
    assertOptions(parsed, ["project", "output"]);
    if (parsed.positionals.length !== 0) throw new Error("provider list does not accept a positional argument");
    return { providers: listProjectProviders(root) };
  }
  if (command === "status") {
    assertOptions(parsed, ["project", "output"]);
    if (parsed.positionals.length !== 1) throw new Error("provider status requires exactly one <instance-id>");
    return getProjectProviderStatus(root, parsed.positionals[0]);
  }
  if (command === "update") {
    assertOptions(parsed, ["ref", "project", "allow-file", "output"]);
    if (parsed.positionals.length !== 1) throw new Error("provider update requires exactly one <instance-id>");
    const ref = option(parsed, "ref");
    if (!ref) throw new Error("provider update requires --ref <tag|branch|commit>");
    return updateProjectProvider(root, parsed.positionals[0], ref, { allowFile: parsed.options["allow-file"] === true });
  }
  if (command === "enable" || command === "disable") {
    assertOptions(parsed, ["project", "output"]);
    if (parsed.positionals.length !== 1) throw new Error(`provider ${command} requires exactly one <instance-id>`);
    return setProjectProviderEnabled(root, parsed.positionals[0], command === "enable");
  }
  if (command === "remove") {
    assertOptions(parsed, ["project", "output"]);
    if (parsed.positionals.length !== 1) throw new Error("provider remove requires exactly one <instance-id>");
    return removeProjectProvider(root, parsed.positionals[0]);
  }
  throw new Error(`unknown provider command: ${command}`);
}

function parsePositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseRunInput(value: string): ProviderRunInput {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`--input must use <id>=<project-relative-path>: ${value}`);
  return { id: value.slice(0, separator), path: value.slice(separator + 1) };
}

function readJsonRecords<T>(root: string, references: readonly string[], label: string): T[] {
  const result: T[] = [];
  for (const reference of references) {
    const path = resolve(root, reference);
    if (!existsSync(path)) throw new Error(`${label} file does not exist: ${reference}`);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error(`${label} must be a small regular non-symlink file: ${reference}`);
    let value: unknown;
    try { value = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch (error) { throw new Error(`${label} is invalid JSON (${reference}): ${error instanceof Error ? error.message : String(error)}`); }
    if (Array.isArray(value)) result.push(...value as T[]);
    else result.push(value as T);
  }
  return result;
}

/** Async execution commands are separated so existing lifecycle API calls remain synchronous. */
export async function runProviderCliAsync(args = process.argv.slice(2)): Promise<unknown> {
  const [command, ...rest] = args;
  if (command !== "probe" && command !== "run" && command !== "gate") return runProviderCli(args);
  const parsed = parseCli(rest);
  const root = project(parsed);
  if (command === "probe") {
    assertOptions(parsed, ["project", "output"]);
    if (parsed.positionals.length !== 0) throw new Error("provider probe does not accept positional arguments");
    return probeRestrictedV1Sandbox();
  }
  const plan = option(parsed, "plan");
  if (!plan) throw new Error(`provider ${command} requires --plan <plan-id|path>`);
  if (command === "run") {
    assertOptions(parsed, ["plan", "node", "input", "timeout", "project", "output"]);
    if (parsed.positionals.length !== 0) throw new Error("provider run does not accept positional arguments");
    const node = option(parsed, "node");
    if (!node) throw new Error("provider run requires --node <node-id>");
    const timeout = parsePositiveInteger(option(parsed, "timeout"), "--timeout");
    return runControlledProvider(root, {
      plan,
      nodeId: node,
      inputs: optionValues(parsed, "input").map(parseRunInput),
      ...(timeout ? { limits: { wall_time_ms: timeout } } : {}),
    });
  }
  assertOptions(parsed, ["plan", "evidence", "waiver", "fallback", "project", "output"]);
  if (parsed.positionals.length !== 0) throw new Error("provider gate does not accept positional arguments");
  return evaluateProviderGate(root, {
    plan,
    evidence: optionValues(parsed, "evidence"),
    waivers: readJsonRecords<ProviderWaiver>(root, optionValues(parsed, "waiver"), "waiver"),
    fallbacks: readJsonRecords<ProviderFallbackRecord>(root, optionValues(parsed, "fallback"), "fallback"),
  });
}

async function main(): Promise<void> {
  const result = await runProviderCliAsync();
  if (typeof result === "object" && result !== null && "usage" in result) {
    process.stdout.write(`${(result as { usage: string }).usage}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Provider command blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
