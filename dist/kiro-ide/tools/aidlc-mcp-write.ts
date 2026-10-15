/** Independent trusted write transport. Never exposed to restricted-v1/Provider execution. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, realpathSync } from "node:fs";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";
import { canonicalProviderJson, sha256ProviderDigest as digest } from "./aidlc-project-provider.js";
import { openOperationJournal, operationPath, type OperationEvent } from "./aidlc-operation-journal.js";
import type { McpReadOptions, McpReadPolicy } from "./aidlc-mcp-readonly.js";

export interface McpWritePolicy extends Omit<McpReadPolicy, "schema" | "result_content" | "read_generation"> {
  schema: "aidlc.mcp-write-policy/v1";
  authentication: "oauth-required" | "fixture-bearer";
}
export interface McpWriteOptions extends Omit<McpReadOptions, "policy"> {
  policy: McpWritePolicy;
  /** Trusted signer, never included in a request, Provider input or journal. */
  journalPrivateKeyPem: string;
}
export interface WriteInvocation { tool: string; resource: string; arguments: Record<string, unknown> }
function fail(code: string): never { throw new Error(code); }
const same = (a: unknown, b: unknown) => canonicalProviderJson(a) === canonicalProviderJson(b);

/** One operation gets one tools/call HTTP dispatch. SDK retry/reconnect cannot resend it. */
export async function dispatchCoreMcpWrite(options: McpWriteOptions, invocation: WriteInvocation, operationId: string,
  binding: unknown, journalPublicKeyPem: string, revalidate: () => void) {
  const policy = structuredClone(options.policy), call = structuredClone(invocation), current = structuredClone(options.currentContext());
  const keys = ["schema", "project_id", "stage", "scope", "plan_digest", "node_id", "instance_id", "project_lock_digest", "connection", "connection_digest",
    "operator", "endpoint", "credential_domain", "credential_ref", "grants", "timeout_ms", "max_request_bytes", "max_response_bytes", "ttl_ms", "fixture", "authentication"];
  if (Object.keys(policy).length !== keys.length || keys.some(k => !Object.hasOwn(policy, k)) || typeof policy.fixture !== "boolean"
    || !Array.isArray(policy.grants) || Object.keys(call).sort().join() !== "arguments,resource,tool" || !call.arguments || Array.isArray(call.arguments)
    || typeof call.arguments !== "object") fail("MCP_WRITE_INVALID_POLICY");
  const check = () => {
    revalidate();
    if (!same(current, options.currentContext()) || !["project_id", "stage", "scope", "plan_digest", "node_id"].every(k => same((current as any)[k], (policy as any)[k]))) fail("MCP_WRITE_CONTEXT_STALE");
    if (policy.schema !== "aidlc.mcp-write-policy/v1" || !policy.operator || !policy.fixture || policy.authentication !== "fixture-bearer") {
      if (policy.authentication === "oauth-required") fail("UI_WRITE_NEEDS_OAUTH_CAPABILITY");
      fail("MCP_WRITE_CAPABILITY_UNSUPPORTED");
    }
    const { state, requirements } = resolveProviderMcpRequirements(options.project);
    if (state.lock.lock_digest !== policy.project_lock_digest) fail("MCP_WRITE_LOCK_STALE");
    const req = requirements.find(r => r.source.instance_id === policy.instance_id && r.connection.name === policy.connection);
    if (!req || digest(req.connection) !== policy.connection_digest || req.connection.credential_domain !== policy.credential_domain
      || requirements.some(r => r.connection.name === policy.connection && !same(r.connection, req.connection))) fail("MCP_WRITE_CONNECTION_DENIED");
    const endpoint = new URL(policy.endpoint);
    if (endpoint.href !== policy.endpoint || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || req.connection.config.type !== "http" || req.connection.config.url !== policy.endpoint
      || req.connection.config.headers !== undefined && !same(req.connection.config.headers, {})) fail("MCP_WRITE_TRANSPORT_UNSUPPORTED");
    const host = JSON.parse(readFileSync(operationPath(options.project, options.hostConfig), "utf8"));
    if (!same(host.mcpServers?.[policy.connection], req.connection.config)) fail("MCP_WRITE_NOT_INSTALLED");
    if (policy.grants.length !== 1 || !same(policy.grants[0], call)) fail("MCP_WRITE_TOOL_DENIED");
    if (!/^secret:[A-Za-z0-9/_-]{1,128}$/.test(policy.credential_ref ?? "") || policy.credential_domain === "none") fail("MCP_WRITE_CREDENTIAL_DENIED");
    for (const [value, min, max] of [[policy.timeout_ms, 50, 60_000], [policy.max_request_bytes, 1, 1024 * 1024], [policy.max_response_bytes, 256, 4 * 1024 * 1024]]) {
      if (!Number.isSafeInteger(value) || value < min || value > max) fail("MCP_WRITE_INVALID_LIMIT");
    }
    if (Buffer.byteLength(canonicalProviderJson(call)) > policy.max_request_bytes) fail("MCP_WRITE_REQUEST_TOO_LARGE");
  };
  check();
  if (realpathSync(options.project) !== options.project) fail("MCP_WRITE_UNSAFE_PATH");
  const journal = openOperationJournal(options.project, operationId, binding, journalPublicKeyPem, options.journalPrivateKeyPem);
  if (journal.read().length) fail("OPERATION_REPLAY_REQUIRES_RECOVERY");
  let events: OperationEvent[] = [journal.append([], "prepared", { input_digest: digest(call.arguments), target: call.resource, binding })];
  const controller = new AbortController(), deadline = Date.now() + policy.timeout_ms;
  const timer = setTimeout(() => controller.abort(), policy.timeout_ms);
  let secret: string | undefined, dispatched = false, reason = "MCP_WRITE_TRANSPORT_ERROR";
  const client = new Client({ name: "aidlc-core-write", version: "1.0.0" }, { capabilities: {} });
  const guardedFetch: typeof fetch = async (url, init) => {
    check();
    if (String(url) !== policy.endpoint || !["POST", "GET", "DELETE"].includes(init?.method ?? "GET")) fail("MCP_WRITE_ENDPOINT_DENIED");
    if (controller.signal.aborted || Date.now() >= deadline) fail("MCP_WRITE_TIMEOUT");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (body?.method === "tools/call") {
      if (dispatched || body.params?.name !== call.tool || !same(body.params?.arguments, call.arguments)) fail("MCP_WRITE_REDISPATCH_DENIED");
      // Durable CAS precedes the first byte of the mutating HTTP exchange.
      events.push(journal.append(events, "dispatched", { input_digest: digest(call.arguments) })); dispatched = true;
    } else if (body && !["initialize", "notifications/initialized", "notifications/cancelled"].includes(body.method)) fail("MCP_WRITE_METHOD_DENIED");
    const headers = new Headers(init?.headers); if (secret) headers.set("Authorization", `Bearer ${secret}`);
    const response = await fetch(url, { ...init, headers, redirect: "manual", credentials: "omit", signal: AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]) });
    if (!response.ok && !(init?.method === "GET" && response.status === 405)) { await response.body?.cancel(); fail("MCP_WRITE_HTTP_ERROR"); }
    let size = 0;
    const stream = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, output) {
      size += chunk.byteLength; if (size > policy.max_response_bytes) { controller.abort(); fail("MCP_WRITE_RESPONSE_TOO_LARGE"); } output.enqueue(chunk);
    } }));
    return new Response(stream ?? null, { status: response.status, headers: response.headers });
  };
  const transport = new StreamableHTTPClientTransport(new URL(policy.endpoint), { fetch: guardedFetch,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1, maxReconnectionDelay: 1, reconnectionDelayGrowFactor: 1 } });
  try {
    if (!options.resolveCredential) fail("MCP_WRITE_CREDENTIAL_UNAVAILABLE");
    secret = await Promise.race([options.resolveCredential(policy.credential_ref!, controller.signal), new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("MCP_WRITE_TIMEOUT")), { once: true }))]);
    if (typeof secret !== "string" || secret.length < 8 || secret.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(secret)) fail("MCP_WRITE_CREDENTIAL_UNAVAILABLE");
    check();
    await client.connect(transport, { timeout: policy.timeout_ms, signal: controller.signal });
    if (!["2025-03-26", "2025-06-18", "2025-11-25"].includes(transport.protocolVersion ?? "")) fail("MCP_WRITE_PROTOCOL_UNSUPPORTED");
    const result = await client.callTool({ name: call.tool, arguments: call.arguments }, undefined, { timeout: policy.timeout_ms, signal: controller.signal });
    if (result.isError || !Array.isArray(result.content) || result.content.length !== 1 || result.content[0].type !== "text") fail("MCP_WRITE_RESULT_UNVERIFIED");
    const encoded = canonicalProviderJson(result);
    if (encoded.includes(secret) || Buffer.byteLength(encoded) > policy.max_response_bytes) fail("MCP_WRITE_RESULT_UNVERIFIED");
    check(); if (controller.signal.aborted || Date.now() >= deadline) fail("MCP_WRITE_TIMEOUT");
    // A tool response alone is not creation success. Only independently reconciled readback
    // may transition dispatched/unknown to succeeded and publish a created manifest.
    events.push(journal.append(events, "unknown", { reason: "READBACK_REQUIRED", response_digest: digest(result) }));
    return { status: "unknown" as const, operation_id: operationId };
  } catch (error) {
    const message = (error as Error).message;
    reason = /^(?:MCP_WRITE|UI_WRITE|OPERATION)_[A-Z_]+$/.test(message) ? message : reason;
    if (controller.signal.aborted) reason = "MCP_WRITE_TIMEOUT";
    // Journal failure itself must remain visible. Never mask a corrupt/incomplete record.
    if (events.at(-1)?.status === (dispatched ? "dispatched" : "prepared")) journal.append(events, dispatched ? "unknown" : "failed", { reason });
    return { status: dispatched ? "unknown" as const : "failed" as const, operation_id: operationId, reason };
  } finally {
    clearTimeout(timer); secret = undefined; await client.close().catch(() => {});
  }
}
