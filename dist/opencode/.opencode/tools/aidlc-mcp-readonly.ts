/** Core/operator API only. Never pass this capability or its options to a Provider runner. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";
import { canonicalProviderJson, readProjectProviders, sha256FileDigest, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { decodeMcpPng } from "./aidlc-mcp-image.js";

export interface McpReadContext {
  project_id: string;
  stage: string;
  scope: string;
  /** Both are null when Core has no Plan; otherwise bind the current Plan digest and node. */
  plan_digest: string | null;
  node_id: string | null;
}
export interface McpReadRequest extends McpReadContext {
  schema: "aidlc.mcp-read-request/v1";
  request_id: string;
  expires_at: string;
  instance_id: string;
  project_lock_digest: string;
  connection: string;
  connection_digest: string;
  tool: string;
  resource: string;
  arguments: Record<string, unknown>;
}
export interface McpReadPolicy extends McpReadContext {
  schema: "aidlc.mcp-read-policy/v1" | "aidlc.mcp-read-policy/v2";
  /** v2 only. Inline PNG data; never resource reads, downloads, or URL fetching. */
  result_content?: "text-or-png";
  /** Trusted v2 acquisition group; never a remote tool argument. */
  read_generation?: string;
  operator: string;
  instance_id: string;
  project_lock_digest: string;
  connection: string;
  connection_digest: string;
  endpoint: string;
  credential_domain: string;
  credential_ref: string | null;
  /** Exact arguments per tool/resource. No wildcards, regexes or server hints. */
  grants: { tool: string; resource: string; arguments: Record<string, unknown> }[];
  timeout_ms: number;
  max_request_bytes: number;
  max_response_bytes: number;
  ttl_ms: number;
  /** Explicitly marks every artifact as a local fixture; never defaults on. */
  fixture: boolean;
}
export interface McpReadOptions {
  project: string;
  hostConfig: string;
  /** Supplied by the trusted Core caller, never from a Provider request. */
  policy: McpReadPolicy;
  currentContext: () => McpReadContext;
  /** An explicit secret store callback; no environment lookup or OAuth fallback. */
  resolveCredential?: (reference: string, signal: AbortSignal) => Promise<string>;
}
function fail(code: string): never { throw new Error(code); }
function same(a: unknown, b: unknown): boolean { return a !== undefined && b !== undefined && canonicalProviderJson(a) === canonicalProviderJson(b); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, fields: string[]): void {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k))) fail("MCP_INVALID_SHAPE");
}
function bounded(value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail("MCP_INVALID_LIMIT");
}
function text(value: unknown, maximum = 2048): void {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail("MCP_INVALID_TEXT");
}
/** Same local-user boundary as managed apply: reject links, including ancestor junctions.
 * Does not defend against a hostile local user concurrently replacing parent directories. */
function safe(path: string): void {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (existsSync(p)) {
      const st = lstatSync(p);
      if (st.isSymbolicLink() || (st.isFile() && st.nlink !== 1)) fail("MCP_UNSAFE_PATH");
    }
    if (dirname(p) === p) break;
  }
}
function readJson(path: string, maximum = 4 * 1024 * 1024): unknown {
  safe(path);
  if (!lstatSync(path).isFile() || lstatSync(path).size > maximum) fail("MCP_INVALID_FILE");
  return JSON.parse(readFileSync(path, "utf8"));
}
const contextKeys = ["project_id", "stage", "scope", "plan_digest", "node_id"];
const bindingKeys = [...contextKeys, "instance_id", "project_lock_digest", "connection", "connection_digest"];
function context(value: McpReadContext): void {
  for (const item of [value.project_id, value.stage, value.scope]) text(item);
  if (!(value.plan_digest === null && value.node_id === null)
    && !(typeof value.plan_digest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.plan_digest) && typeof value.node_id === "string" && !!value.node_id)) fail("MCP_INVALID_PLAN_BINDING");
}

/** Construct only in Core, from an explicitly reviewed operator policy. Construction grants
 * nothing to sandboxed code; each invocation rechecks current intent, lock, manifest and context. */
export function createCoreMcpReadOnly(options: McpReadOptions) {
  // Freeze by value so caller mutation during async credential/transport work cannot widen grants.
  const policy: McpReadPolicy = JSON.parse(JSON.stringify(options.policy));
  exact(policy, ["schema", ...bindingKeys, "operator", "endpoint", "credential_domain", "credential_ref", "grants", "timeout_ms", "max_request_bytes", "max_response_bytes", "ttl_ms", "fixture", ...(policy.schema === "aidlc.mcp-read-policy/v2" ? ["result_content", ...(Object.hasOwn(policy, "read_generation") ? ["read_generation"] : [])] : [])]);
  if (!["aidlc.mcp-read-policy/v1", "aidlc.mcp-read-policy/v2"].includes(policy.schema) || (policy.schema === "aidlc.mcp-read-policy/v2" && policy.result_content !== "text-or-png") || !policy.operator || typeof policy.fixture !== "boolean") fail("MCP_INVALID_POLICY");
  context(policy);
  if (policy.read_generation !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(policy.read_generation)) fail("MCP_INVALID_POLICY");
  for (const item of [policy.operator, policy.instance_id, policy.connection, policy.credential_domain]) text(item, 256);
  for (const item of [policy.project_lock_digest, policy.connection_digest]) if (!/^sha256:[a-f0-9]{64}$/.test(item)) fail("MCP_INVALID_DIGEST");
  bounded(policy.timeout_ms, 50, 60_000); bounded(policy.max_request_bytes, 1, 1024 * 1024);
  bounded(policy.max_response_bytes, 256, 4 * 1024 * 1024); bounded(policy.ttl_ms, 1, 86_400_000);
  if (!Array.isArray(policy.grants) || policy.grants.length > 128) fail("MCP_INVALID_POLICY");
  for (const grant of policy.grants) {
    exact(grant, ["tool", "resource", "arguments"]);
    text(grant.tool, 256); text(grant.resource);
    if (!grant.tool || !grant.resource || !object(grant.arguments)) fail("MCP_INVALID_POLICY");
  }
  const endpoint = new URL(policy.endpoint);
  if (endpoint.href !== policy.endpoint || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !(endpoint.protocol === "https:" || (policy.fixture && endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1"))) fail("MCP_ENDPOINT_DENIED");
  if (policy.credential_ref !== null && (typeof policy.credential_ref !== "string" || !/^secret:[a-zA-Z0-9/_-]{1,128}$/.test(policy.credential_ref))) fail("MCP_CREDENTIAL_REFERENCE_DENIED");
  if ((policy.credential_domain === "none") !== (policy.credential_ref === null)) fail("MCP_CREDENTIAL_DOMAIN_MISMATCH");
  safe(options.project);
  const project = realpathSync(resolve(options.project));
  const hostPath = resolve(project, options.hostConfig);
  const store = join(project, ".aidlc", "mcp-readonly");
  function check(request: McpReadRequest) {
    context(request);
    const current = options.currentContext(); context(current);
    for (const key of contextKeys as (keyof McpReadContext)[]) if (request[key] !== current[key]) fail("MCP_CONTEXT_STALE");
    for (const key of bindingKeys as (keyof McpReadRequest & keyof McpReadPolicy)[]) if (request[key] !== policy[key]) fail("MCP_BINDING_DENIED");
    const { state, requirements } = resolveProviderMcpRequirements(project);
    if (state.lock.lock_digest !== policy.project_lock_digest) fail("MCP_LOCK_STALE");
    const requirement = requirements.find(r => r.source.instance_id === policy.instance_id && r.connection.name === policy.connection);
    if (!requirement) fail("MCP_PROVIDER_UNAVAILABLE");
    const { connection } = requirement;
    if (sha256ProviderDigest(connection) !== policy.connection_digest || connection.credential_domain !== policy.credential_domain) fail("MCP_CONNECTION_STALE");
    if (requirements.some(r => r.connection.name === connection.name && !same(r.connection, connection))) fail("MCP_CONNECTION_CONFLICT");
    // Initial HTTP subset deliberately rejects inline headers, env interpolation, SSE and stdio.
    if (connection.config.type !== "http" || connection.config.url !== policy.endpoint
      || (connection.config.headers !== undefined && !same(connection.config.headers, {}))) fail("MCP_TRANSPORT_UNSUPPORTED");
    const host = readJson(hostPath);
    if (!object(host) || !object(host.mcpServers) || !same(host.mcpServers[connection.name], connection.config)) fail("MCP_NOT_INSTALLED");
    if (!policy.grants.some(g => g.tool === request.tool && g.resource === request.resource && same(g.arguments, request.arguments))) fail("MCP_TOOL_DENIED");
    const expiry = Date.parse(request.expires_at);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 60_000) fail("MCP_REQUEST_EXPIRED");
    return requirement.source;
  }
  return Object.freeze({
    async call(input: McpReadRequest) {
      const request: McpReadRequest = JSON.parse(JSON.stringify(input));
      exact(request, ["schema", ...bindingKeys, "request_id", "expires_at", "tool", "resource", "arguments"]);
      if (request.schema !== "aidlc.mcp-read-request/v1" || typeof request.request_id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.request_id) || !object(request.arguments)) fail("MCP_INVALID_REQUEST");
      if (Buffer.byteLength(canonicalProviderJson(request)) > policy.max_request_bytes) fail("MCP_REQUEST_TOO_LARGE");
      let source: ReturnType<typeof check>;
      try { source = check(request); } // All denials above happen before credentials or network.
      catch (error) {
        const message = (error as Error).message;
        const code = /^MCP_[A-Z_]+$/.test(message) ? message : "MCP_PREFLIGHT_DENIED";
        safe(store); mkdirSync(store, { recursive: true, mode: 0o700 }); safe(store);
        writeFileSync(join(store, `${randomUUID()}.denied.json`), JSON.stringify({
          schema: "aidlc.mcp-read-call/v1", request_id: request.request_id,
          project, request_digest: sha256ProviderDigest(request), policy_digest: sha256ProviderDigest(policy),
          fixture: policy.fixture, installed: "not_confirmed", authentication: "not_checked", authorization: "denied",
          status: "rejected", error: code, recorded_at: new Date().toISOString(), snapshot_digest: null,
        }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        throw new Error(code);
      }
      safe(store); mkdirSync(store, { recursive: true, mode: 0o700 }); safe(store);
      const claim = join(store, `${request.request_id}.claim`);
      try { writeFileSync(claim, "consumed\n", { flag: "wx", mode: 0o600 }); }
      catch { return fail("MCP_REQUEST_REPLAY"); }
      const record = {
        schema: "aidlc.mcp-read-call/v1", request_id: request.request_id, project: project,
        context: Object.fromEntries(contextKeys.map(k => [k, request[k as keyof McpReadRequest]])),
        project_lock_digest: policy.project_lock_digest, connection_digest: policy.connection_digest,
        connection: policy.connection, source, operator: policy.operator, policy_digest: sha256ProviderDigest(policy),
        tool: request.tool, resource: request.resource, input_digest: sha256ProviderDigest(request.arguments),
        protocol_version: null as string | null,
        fixture: policy.fixture, installed: true, authorization: "granted", authentication: "not_checked",
        status: "error", error: null as string | null, snapshot_digest: null as string | null,
      };
      const controller = new AbortController();
      const deadline = Date.now() + policy.timeout_ms;
      const timer = setTimeout(() => controller.abort(), policy.timeout_ms);
      let secret: string | undefined;
      let remoteEtag: string | null = null;
      let failure = "MCP_TRANSPORT_ERROR";
      const recheck = () => {
        try { check(request); }
        catch (error) {
          const message = (error as Error).message;
          failure = /^MCP_[A-Z_]+$/.test(message) ? message : "MCP_BINDING_DENIED";
          throw new Error(failure);
        }
      };
      const client = new Client({ name: "aidlc-core-readonly", version: "1.0.0" }, { capabilities: {} });
      const guardedFetch: typeof fetch = async (url, init) => {
        if (new URL(String(url)).href !== policy.endpoint) fail("MCP_ENDPOINT_DENIED");
        if (!["POST", "GET", "DELETE"].includes(init?.method ?? "GET")) fail("MCP_METHOD_DENIED");
        recheck(); // Recheck after async secret resolution and on every protocol exchange.
        if (Date.now() >= deadline || controller.signal.aborted) { controller.abort(); fail("MCP_TIMEOUT"); }
        const headers = new Headers(init?.headers);
        if (secret) headers.set("Authorization", `Bearer ${secret}`);
        const response = await fetch(url, { ...init, headers, redirect: "manual", credentials: "omit", signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) });
        if (response.status >= 300 && response.status < 400) { failure = "MCP_REDIRECT_DENIED"; await response.body?.cancel(); fail(failure); }
        if (response.status === 401 || response.status === 403) { failure = "MCP_AUTHENTICATION_FAILED"; record.authentication = "rejected"; await response.body?.cancel(); fail(failure); }
        if (!response.ok && !(init?.method === "GET" && response.status === 405)) { failure = "MCP_HTTP_ERROR"; await response.body?.cancel(); fail(failure); }
        if (typeof init?.body === "string" && JSON.parse(init.body).method === "tools/call") remoteEtag = response.headers.get("etag");
        let count = 0;
        const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, output) {
          count += chunk.byteLength;
          if (count > policy.max_response_bytes) { failure = "MCP_RESPONSE_TOO_LARGE"; controller.abort(); throw new Error(failure); }
          output.enqueue(chunk);
        } }));
        return new Response(body ?? null, { status: response.status, headers: response.headers });
      };
      const transport = new StreamableHTTPClientTransport(endpoint, { fetch: guardedFetch, reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 1, initialReconnectionDelay: 1, reconnectionDelayGrowFactor: 1 } });
      try {
        if (policy.credential_ref !== null) {
          failure = "MCP_CREDENTIAL_UNAVAILABLE";
          if (!options.resolveCredential) fail(failure);
          secret = await Promise.race([options.resolveCredential(policy.credential_ref, controller.signal), new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }))]);
          if (typeof secret !== "string" || secret.length < 8 || secret.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(secret)) fail(failure);
        }
        failure = "MCP_PROTOCOL_ERROR";
        await client.connect(transport, { timeout: policy.timeout_ms, signal: controller.signal });
        if (!["2025-03-26", "2025-06-18", "2025-11-25"].includes(transport.protocolVersion ?? "")) fail(failure);
        record.protocol_version = transport.protocolVersion!;
        record.authentication = secret ? "accepted" : "not_required";
        failure = "MCP_TOOL_ERROR";
        const result = await client.callTool({ name: request.tool, arguments: request.arguments }, undefined, { timeout: policy.timeout_ms, signal: controller.signal });
        if (result.isError) fail(failure);
        failure = "MCP_RESULT_UNSUPPORTED";
        if (!Array.isArray(result.content)) fail(failure);
        for (const c of result.content) {
          if (object(c) && c.type === "text" && typeof c.text === "string") continue;
          if (policy.schema === "aidlc.mcp-read-policy/v2" && object(c) && c.type === "image") { decodeMcpPng(c); continue; }
          fail(failure);
        }
        const content = JSON.stringify(result);
        if (Buffer.byteLength(content) > policy.max_response_bytes) { failure = "MCP_RESPONSE_TOO_LARGE"; fail(failure); }
        if (secret && (content.includes(secret) || (remoteEtag ?? "").includes(secret))) { failure = "MCP_SECRET_IN_RESULT"; fail(failure); }
        recheck();
        const now = Date.now();
        if (now >= deadline || controller.signal.aborted) { controller.abort(); fail("MCP_TIMEOUT"); }
        const snapshot = {
          schema: "aidlc.mcp-read-snapshot/v1", request_id: request.request_id, project, project_id: policy.project_id,
          instance_id: policy.instance_id, project_lock_digest: policy.project_lock_digest, source,
          context: record.context, policy_digest: record.policy_digest,
          connection: policy.connection, connection_digest: policy.connection_digest,
          tool: request.tool, resource: request.resource, input_digest: record.input_digest,
          content_digest: sha256FileDigest(content), fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + policy.ttl_ms).toISOString(), ttl_ms: policy.ttl_ms,
          remote_version: remoteEtag === null ? { status: "unknown" } : { status: "provided", etag: remoteEtag },
          fixture: policy.fixture, trust: "external-data", result,
          ...(policy.schema === "aidlc.mcp-read-policy/v2" ? { read_generation: policy.read_generation ?? null } : {}),
        };
        const digest = sha256ProviderDigest(snapshot);
        failure = "MCP_STORAGE_ERROR";
        const path = join(store, `${request.request_id}.snapshot.json`); safe(path);
        writeFileSync(path, JSON.stringify({ ...snapshot, snapshot_digest: digest }) + "\n", { flag: "wx", mode: 0o600 });
        record.status = "succeeded"; record.snapshot_digest = digest;
        return { snapshot_digest: digest, snapshot_path: path, record_path: join(store, `${request.request_id}.call.json`) };
      } catch {
        record.error = controller.signal.aborted && failure !== "MCP_RESPONSE_TOO_LARGE" ? "MCP_TIMEOUT" : failure;
        throw new Error(record.error); // Never surface SDK/HTTP/secret-store error text.
      } finally {
        clearTimeout(timer);
        await client.close().catch(() => {});
        secret = undefined;
        const path = join(store, `${request.request_id}.call.json`); safe(path);
        writeFileSync(path, JSON.stringify({ ...record, recorded_at: new Date().toISOString() }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      }
    },
  });
}

/** Explicit input reader: validates integrity, project/lock binding and freshness. No Gate or Receipt. */
export function readMcpSnapshot(path: string, expected: { project: string; project_id: string; project_lock_digest: string; snapshot_digest: string }) {
  const value = readJson(path, 8 * 1024 * 1024);
  if (!object(value)) fail("MCP_SNAPSHOT_INVALID");
  const { snapshot_digest, ...payload } = value;
  if (value.schema !== "aidlc.mcp-read-snapshot/v1" || snapshot_digest !== expected.snapshot_digest || sha256ProviderDigest(payload) !== snapshot_digest
    || value.project !== realpathSync(resolve(expected.project)) || value.project_id !== expected.project_id || value.project_lock_digest !== expected.project_lock_digest
    || readProjectProviders(expected.project).lock.lock_digest !== expected.project_lock_digest
    || !Number.isFinite(Date.parse(String(value.expires_at))) || Date.parse(String(value.expires_at)) <= Date.now()
    || !Number.isFinite(Date.parse(String(value.fetched_at))) || Date.parse(String(value.fetched_at)) > Date.now()
    || !Number.isSafeInteger(value.ttl_ms) || Number(value.ttl_ms) < 1 || Number(value.ttl_ms) > 86_400_000
    || Date.parse(String(value.expires_at)) - Date.parse(String(value.fetched_at)) !== value.ttl_ms
    || sha256FileDigest(JSON.stringify(value.result)) !== value.content_digest) fail("MCP_SNAPSHOT_STALE_OR_INVALID");
  return value;
}
