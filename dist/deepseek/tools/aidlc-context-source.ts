/** Trusted Core entry point. Provider mappings are data, never executable adapters. */
import { randomUUID } from "node:crypto";
import { createCoreMcpReadOnly, readMcpSnapshot, type McpReadOptions } from "./aidlc-mcp-readonly.js";
import { readProjectProviders, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";

export interface ContextSourceBinding {
  schema: "aidlc.context-source-binding/v1";
  project_id: string;
  instance_id: string;
  connection: string;
  resource: string;
  /** Non-secret remote scope; only these fixed arguments may identify resources. */
  arguments: Record<string, unknown>;
}
export interface ContextSourceContract {
  schema: "aidlc.context-source/v1";
  version: string;
  connection: string;
  tool: string;
  scope_arguments: string[];
  request: { query: string; limit: string; budget: string };
  result: { items: string; document: string; revision: string; version: string; fragment: string; body: string; title: string; truncated: string; degraded: string; item_truncated: string };
}
export interface ContextSourceOptions extends McpReadOptions {
  /** Trusted project policy. Never copied from a request or Provider declaration. */
  sourcePolicy: {
    required: boolean;
    binding_digest: string;
    contract_digest: string;
    max_chars: number;
    max_items: number;
  };
}
export interface ContextSourceRequest {
  instance_id: string;
  resource: string;
  query: string;
  limit: number;
  max_chars: number;
}
function fail(code: string): never { throw new Error(code); }
function object(v: unknown): v is Record<string, any> { return !!v && typeof v === "object" && !Array.isArray(v); }
function exact(v: unknown, keys: string[]): asserts v is Record<string, any> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail("CONTEXT_INVALID_SHAPE");
}
function field(v: unknown): asserts v is string {
  if (typeof v !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(v) || ["constructor", "prototype", "__proto__"].includes(v)) fail("CONTEXT_INVALID_FIELD");
}
function limit(v: number, max: number): void { if (!Number.isSafeInteger(v) || v < 1 || v > max) fail("CONTEXT_INVALID_LIMIT"); }

export function readContextSourceContract(project: string, instance: string): ContextSourceContract | undefined {
  const state = readProjectProviders(project);
  if (!state.config.providers.some(p => p.instance_id === instance && p.enabled)) return undefined;
  const lock = state.lock.providers.find(p => p.instance_id === instance);
  if (!lock) fail("CONTEXT_LOCK_MISSING");
  const { manifest } = verifyLockedProviderCache(project, lock);
  const c: unknown = manifest.extensions?.["aidlc.context-source"];
  if (c === undefined) return undefined;
  exact(c, ["schema", "version", "connection", "tool", "scope_arguments", "request", "result"]);
  if (c.schema !== "aidlc.context-source/v1" || c.version !== manifest.version || typeof c.connection !== "string" || typeof c.tool !== "string" || !c.tool) fail("CONTEXT_CONTRACT_INVALID");
  if (!Array.isArray(c.scope_arguments) || !c.scope_arguments.length || c.scope_arguments.length > 16) fail("CONTEXT_CONTRACT_INVALID");
  c.scope_arguments.forEach(field);
  exact(c.request, ["query", "limit", "budget"]);
  Object.values(c.request).forEach(field);
  const args = [...c.scope_arguments, ...Object.values(c.request)];
  if (new Set(args).size !== args.length) fail("CONTEXT_ARGUMENT_COLLISION");
  exact(c.result, ["items", "document", "revision", "version", "fragment", "body", "title", "truncated", "degraded", "item_truncated"]);
  Object.values(c.result).forEach(field);
  return JSON.parse(JSON.stringify(c)) as ContextSourceContract;
}

/** Missing/disabled sources make no network calls and create no placeholder artifacts.
 * required is owned by trusted policy; callers cannot lower it in the request. */
export async function consumeContextSource(options: ContextSourceOptions, binding: ContextSourceBinding | null, input: ContextSourceRequest) {
  // Freeze all asynchronous inputs, including policy and binding.
  const policy = structuredClone(options.policy), sp = structuredClone(options.sourcePolicy);
  const b = structuredClone(binding), request = structuredClone(input);
  const unavailable = (reason: string) => ({ schema: "aidlc.context-source-delivery/v1" as const,
    status: sp.required ? "blocked" as const : "unavailable" as const, reason, trust: "external-data" as const, gate_eligible: false as const });
  try {
    exact(sp, ["required", "binding_digest", "contract_digest", "max_chars", "max_items"]);
    if (typeof sp.required !== "boolean") fail("CONTEXT_INVALID_POLICY");
    limit(sp.max_chars, 100_000); limit(sp.max_items, 50);
    exact(request, ["instance_id", "resource", "query", "limit", "max_chars"]);
    if (!b) return sp.required ? unavailable("CONTEXT_NOT_BOUND") : { schema: "aidlc.context-source-delivery/v1" as const, status: "local" as const };
    exact(b, ["schema", "project_id", "instance_id", "connection", "resource", "arguments"]);
    const current = options.currentContext();
    if (b.schema !== "aidlc.context-source-binding/v1" || sha256ProviderDigest(b) !== sp.binding_digest
      || b.project_id !== current.project_id || b.project_id !== policy.project_id
      || b.instance_id !== request.instance_id || b.instance_id !== policy.instance_id
      || b.resource !== request.resource || b.connection !== policy.connection) fail("CONTEXT_BINDING_DENIED");
    const contract = readContextSourceContract(options.project, b.instance_id);
    if (!contract) return sp.required ? unavailable("CONTEXT_SOURCE_DISABLED") : { schema: "aidlc.context-source-delivery/v1" as const, status: "local" as const };
    if (sha256ProviderDigest(contract) !== sp.contract_digest || contract.connection !== b.connection) fail("CONTEXT_CONTRACT_DENIED");
    exact(b.arguments, contract.scope_arguments);
    if (typeof request.query !== "string" || !request.query.trim() || request.query.length > 4096) fail("CONTEXT_INVALID_QUERY");
    limit(request.limit, sp.max_items); limit(request.max_chars, sp.max_chars);
    const args = { ...b.arguments, [contract.request.query]: request.query,
      [contract.request.limit]: request.limit, [contract.request.budget]: request.max_chars };
    const broker = createCoreMcpReadOnly({ ...options, policy });
    const snapshot = await broker.call({ schema: "aidlc.mcp-read-request/v1", ...current,
      request_id: randomUUID(), expires_at: new Date(Date.now() + 30_000).toISOString(),
      instance_id: b.instance_id, project_lock_digest: policy.project_lock_digest,
      connection: b.connection, connection_digest: policy.connection_digest,
      resource: b.resource, tool: contract.tool, arguments: args });
    const value = readMcpSnapshot(snapshot.snapshot_path, { project: options.project, project_id: b.project_id,
      project_lock_digest: policy.project_lock_digest, snapshot_digest: snapshot.snapshot_digest });
    // Only a single JSON object from the verified snapshot; no pagination or remote actions.
    const result = value.result as any;
    let data: any;
    if (object(result.structuredContent)) data = result.structuredContent;
    else {
      if (result.content.length !== 1) fail("CONTEXT_RESULT_INVALID");
      try { data = JSON.parse(result.content[0].text); } catch { fail("CONTEXT_RESULT_INVALID"); }
    }
    const m = contract.result;
    if (!object(data) || !Array.isArray(data[m.items])) fail("CONTEXT_RESULT_INVALID");
    for (const flag of [m.truncated, m.degraded]) if (data[flag] !== undefined && typeof data[flag] !== "boolean") fail("CONTEXT_RESULT_INVALID");
    let remaining = request.max_chars, truncated = data[m.truncated] === true;
    const revisions = new Map<string, string>();
    const items = [];
    for (const hit of data[m.items]) {
      if (!object(hit) || typeof hit[m.body] !== "string") fail("CONTEXT_RESULT_INVALID");
      const id = (v: unknown): string | null => typeof v === "string" && v.trim() && v.length <= 1024 ? v : Number.isSafeInteger(v) && Number(v) >= 0 ? String(v) : null;
      const document = id(hit[m.document]), fragment = id(hit[m.fragment]);
      if (document === null || fragment === null) fail("CONTEXT_RESULT_INVALID");
      const revision = id(hit[m.revision]), version = id(hit[m.version]);
      const key = JSON.stringify([revision, version]);
      if (revisions.has(document) && revisions.get(document) !== key) fail("CONTEXT_MIXED_REVISIONS");
      revisions.set(document, key);
      if (items.length >= request.limit || remaining <= 0) { truncated = true; continue; }
      const body = hit[m.body].slice(0, remaining);
      if (body.length < hit[m.body].length || hit[m.item_truncated] === true) truncated = true;
      if (!body.trim()) continue;
      remaining -= body.length;
      items.push({ document, fragment, revision: revision ?? "unknown", version: version ?? "unknown",
        title: typeof hit[m.title] === "string" ? hit[m.title].slice(0, 512) : "", body,
        reference: { instance_id: b.instance_id, resource: b.resource, document, fragment, revision: revision ?? "unknown", snapshot_digest: snapshot.snapshot_digest } });
    }
    if (!items.length) return { ...unavailable("CONTEXT_EMPTY"), empty: true, snapshot, expires_at: value.expires_at };
    return { schema: "aidlc.context-source-delivery/v1" as const, status: "available" as const,
      trust: "external-data" as const, gate_eligible: false as const, consumption: "not_confirmed" as const,
      fixture: value.fixture, source: value.source, binding_digest: sp.binding_digest, contract_digest: sp.contract_digest,
      input_digest: value.input_digest, snapshot, fetched_at: value.fetched_at, expires_at: value.expires_at,
      remote_version: value.remote_version,
      truncated: truncated ? true : data[m.truncated] === false ? false : "unknown",
      degraded: typeof data[m.degraded] === "boolean" ? data[m.degraded] : "unknown", items };
  } catch (error) {
    const code = (error as Error).message;
    return unavailable(/^(?:CONTEXT|MCP)_[A-Z_]+$/.test(code) ? code : "CONTEXT_PREFLIGHT_OR_RESULT_INVALID");
  }
}
