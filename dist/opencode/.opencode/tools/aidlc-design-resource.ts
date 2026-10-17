/** Trusted Core data consumer. No Provider entrypoint is ever loaded or executed. */
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createCoreMcpReadOnly, readMcpSnapshot, type McpReadOptions } from "./aidlc-mcp-readonly.js";
import { readProjectProviders, sha256ProviderDigest as digest } from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { captureModulePublication, publishScope } from "./aidlc-session";

export const DESIGN_POLICY = ".aidlc/ui-design-policy.json";
export const DEFAULT_TOKENS = Object.freeze({ background: "#ffffff", foreground: "#202124", primary: "#2457d6", on_primary: "#ffffff", font_family: "system-ui", font_size: "16px", spacing: "16px", radius: "4px" });
export type DesignTokens = { -readonly [K in keyof typeof DEFAULT_TOKENS]: string };
const keys = Object.keys(DEFAULT_TOKENS) as (keyof DesignTokens)[];
const requiredKeys: (keyof DesignTokens)[] = keys.filter(k => k !== "radius");
type TokenPaths = Partial<Record<keyof DesignTokens, (string | number)[]>>;
interface Selection {
  required: boolean;
  style: string;
  platform: "web";
  team: string | null;
  approval_ref: string;
  instance_id: string | null;
  contract_digest: string | null;
  resource: string;
  arguments: Record<string, unknown>;
}
interface Contract {
  schema: "aidlc.design-resource/v1";
  version: string;
  style: string;
  platform: "web";
  team: string | null;
  provenance: { repository: string; revision: string; path: string; sha256: string };
  offline: Partial<DesignTokens> | null;
  remote: { connection: string; tool: string; arguments: Record<string, unknown>; mapping: TokenPaths } | null;
}
export interface DesignResourceLock {
  schema: "aidlc.design-resource-lock/v1";
  selection_digest: string;
  approval_ref: string | null;
  status: "available" | "fallback";
  reason: string;
  source: null | { instance_id: string; commit: string; version: string; contract_digest: string; project_lock_digest: string };
  snapshot: null | { path: string; digest: string; project_id: string };
  tokens: DesignTokens;
  token_digest: string;
  defaults: (keyof DesignTokens)[];
  default_source: "aidlc.offline-default/v1";
}
function fail(code: string): never { throw new Error(code); }
function obj(v: unknown): v is Record<string, any> { return !!v && typeof v === "object" && !Array.isArray(v); }
function exact(v: unknown, fields: string[]): asserts v is Record<string, any> {
  if (!obj(v) || Object.keys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k))) fail("DESIGN_INVALID_SHAPE");
}
function label(v: unknown): asserts v is string { if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/ -]{0,255}$/.test(v)) fail("DESIGN_INVALID_LABEL"); }
/** Same local operator boundary as project Provider policy. Reject links and escapes. */
function safe(project: string, path: string): string {
  const root = realpathSync(project), absolute = resolve(root, path), rel = relative(root, absolute);
  if (!rel || rel.startsWith("..") || /^[A-Za-z]:/.test(rel)) fail("DESIGN_UNSAFE_PATH");
  for (let p = absolute; p !== dirname(p); p = dirname(p)) if (existsSync(p) && (lstatSync(p).isSymbolicLink() || (lstatSync(p).isFile() && lstatSync(p).nlink !== 1))) fail("DESIGN_UNSAFE_PATH");
  return absolute;
}
function json(project: string, path: string): any {
  const file = safe(project, path);
  if (!lstatSync(file).isFile() || lstatSync(file).size > 1024 * 1024) fail("DESIGN_INVALID_FILE");
  return JSON.parse(readFileSync(file, "utf8"));
}
function policy(project: string, moduleId: string): { project_id: string; selection: Selection | null; digest: string } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(moduleId)) fail("DESIGN_INVALID_MODULE");
  if (!existsSync(safe(project, DESIGN_POLICY))) return { project_id: "offline", selection: null, digest: digest(null) };
  const p = json(project, DESIGN_POLICY);
  exact(p, ["schema", "project_id", "modules"]);
  if (p.schema !== "aidlc.ui-design-policy/v1" || !obj(p.modules)) fail("DESIGN_INVALID_POLICY");
  label(p.project_id);
  const s = p.modules[moduleId];
  if (s === undefined) return { project_id: p.project_id, selection: null, digest: digest({ project_id: p.project_id, selection: null }) };
  exact(s, ["required", "style", "platform", "team", "approval_ref", "instance_id", "contract_digest", "resource", "arguments"]);
  if (typeof s.required !== "boolean" || s.platform !== "web" || !obj(s.arguments)) fail("DESIGN_INVALID_POLICY");
  for (const v of [s.style, s.approval_ref, s.resource]) label(v);
  if (s.team !== null) label(s.team);
  if (s.instance_id !== null) label(s.instance_id);
  if (s.contract_digest !== null && !/^sha256:[a-f0-9]{64}$/.test(s.contract_digest)) fail("DESIGN_INVALID_POLICY");
  return { project_id: p.project_id, selection: s as Selection, digest: digest({ project_id: p.project_id, selection: s }) };
}
/** Closed token vocabulary: CSS/HTML, expressions, URLs and unknown token names are rejected. */
export function validateDesignTokens(raw: unknown, required: boolean): { tokens: DesignTokens; defaults: (keyof DesignTokens)[] } {
  if (!obj(raw) || Object.keys(raw).some(k => !keys.includes(k as any))) fail("DESIGN_INVALID_TOKENS");
  const tokens: DesignTokens = { ...DEFAULT_TOKENS }, defaults: (keyof DesignTokens)[] = [];
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined) {
      if (required && requiredKeys.includes(k)) fail("DESIGN_REQUIRED_TOKEN_MISSING");
      defaults.push(k); continue;
    }
    if (typeof v !== "string") fail("DESIGN_INVALID_TOKEN_VALUE");
    if (["background", "foreground", "primary", "on_primary"].includes(k)) {
      if (!/^#[a-fA-F0-9]{6}$/.test(v)) fail("DESIGN_INVALID_TOKEN_VALUE");
    } else if (k === "font_family") {
      if (!/^[A-Za-z][A-Za-z0-9 -]{0,63}$/.test(v)) fail("DESIGN_INVALID_TOKEN_VALUE");
    } else {
      if (!/^(?:0|[1-9][0-9]{0,2})px$/.test(v)) fail("DESIGN_INVALID_TOKEN_VALUE");
      const n = Number(v.slice(0, -2));
      if (n > (k === "font_size" ? 64 : 128) || (k === "font_size" && n < 10)) fail("DESIGN_INVALID_TOKEN_VALUE");
    }
    tokens[k] = v;
  }
  return { tokens, defaults };
}
export function readDesignResourceContract(project: string, instance: string): Contract | undefined {
  const state = readProjectProviders(project);
  if (!state.config.providers.some(p => p.instance_id === instance && p.enabled)) return undefined;
  const lock = state.lock.providers.find(p => p.instance_id === instance);
  if (!lock) fail("DESIGN_PROVIDER_LOCK_MISSING");
  const { manifest } = verifyLockedProviderCache(project, lock);
  const c: unknown = manifest.extensions?.["aidlc.design-resource"];
  if (c === undefined) return undefined;
  exact(c, ["schema", "version", "style", "platform", "team", "provenance", "offline", "remote"]);
  if (c.schema !== "aidlc.design-resource/v1" || c.version !== manifest.version || c.platform !== "web") fail("DESIGN_INVALID_CONTRACT");
  label(c.style); if (c.team !== null) label(c.team);
  exact(c.provenance, ["repository", "revision", "path", "sha256"]);
  if (typeof c.provenance.repository !== "string" || !/^[a-f0-9]{40}$/.test(c.provenance.revision) || typeof c.provenance.path !== "string" || !/^sha256:[a-f0-9]{64}$/.test(c.provenance.sha256)) fail("DESIGN_INVALID_PROVENANCE");
  if ((c.offline === null) === (c.remote === null)) fail("DESIGN_INVALID_CONTRACT");
  if (c.offline !== null) validateDesignTokens(c.offline, false);
  if (c.remote !== null) {
    exact(c.remote, ["connection", "tool", "arguments", "mapping"]);
    label(c.remote.connection); label(c.remote.tool);
    if (!obj(c.remote.arguments) || !obj(c.remote.mapping) || Object.keys(c.remote.mapping).some(k => !keys.includes(k as any))) fail("DESIGN_INVALID_MAPPING");
    for (const path of Object.values(c.remote.mapping)) {
      if (!Array.isArray(path) || path.length < 1 || path.length > 5 || path.some(k => !(Number.isSafeInteger(k) && Number(k) >= 0 && Number(k) < 50) && !(typeof k === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k) && !["constructor", "prototype", "__proto__"].includes(k)))) fail("DESIGN_INVALID_MAPPING");
    }
  }
  return structuredClone(c) as Contract;
}
function selectionState(project: string, moduleId: string) {
  const p = policy(project, moduleId), s = p.selection;
  if (!s?.instance_id) return { p, c: null, source: null };
  const c = readDesignResourceContract(project, s.instance_id);
  if (!c) return { p, c: null, source: null };
  if (digest(c) !== s.contract_digest || c.style !== s.style || c.platform !== s.platform || c.team !== s.team) fail("DESIGN_SELECTION_DENIED");
  if (c.remote && digest(c.remote.arguments) !== digest(s.arguments)) fail("DESIGN_BINDING_DENIED");
  const state = readProjectProviders(project), entry = state.lock.providers.find(x => x.instance_id === s.instance_id)!;
  return { p, c, source: { instance_id: s.instance_id, commit: entry.source.commit_oid, version: c.version, contract_digest: digest(c), project_lock_digest: state.lock.lock_digest } };
}
function delivery(st: ReturnType<typeof selectionState>, raw: unknown, reason = "OFFLINE_PACKAGE", snapshot: DesignResourceLock["snapshot"] = null): DesignResourceLock {
  const validated = validateDesignTokens(raw, st.p.selection?.required ?? false);
  return { schema: "aidlc.design-resource-lock/v1", selection_digest: st.p.digest, approval_ref: st.p.selection?.approval_ref ?? null, status: "available", reason, source: st.source, snapshot, ...validated, default_source: "aidlc.offline-default/v1", token_digest: digest(validated.tokens) };
}
function fallback(st: ReturnType<typeof selectionState>, reason: string): DesignResourceLock {
  if (st.p.selection?.required) fail("DESIGN_REQUIRED_RESOURCE_UNAVAILABLE");
  return { ...delivery(st, {}, reason), status: "fallback" };
}
function mapped(c: Contract, result: any): unknown {
  let data: any;
  if (obj(result.structuredContent)) data = result.structuredContent;
  else {
    if (!Array.isArray(result.content) || result.content.length !== 1 || result.content[0].type !== "text") fail("DESIGN_INVALID_RESULT");
    try { data = JSON.parse(result.content[0].text); } catch { fail("DESIGN_INVALID_RESULT"); }
  }
  if (!obj(data)) fail("DESIGN_INVALID_RESULT");
  const tokens: Record<string, unknown> = {};
  for (const [k, path] of Object.entries(c.remote!.mapping)) {
    let value: any = data;
    for (const part of path!) value = value != null && Object.hasOwn(value, part) ? value[part] : undefined;
    if (value !== undefined) tokens[k] = value;
  }
  return tokens;
}
export function designResourcePath(moduleId: string): string { return `docs/aidlc/modules/${moduleId}/inception/ui-design/design-resource.json`; }
/** Fetch once before ui lock. Policy comes only from the reviewed local project file.
 * MCP options are operator capabilities, never supplied by Provider code or generation requests. */
export async function acquireDesignResource(project: string, moduleId: string, options?: McpReadOptions): Promise<DesignResourceLock> {
  const st = selectionState(project, moduleId), { p, c } = st;
  if (!c) return fallback(st, "NOT_BOUND_OR_DISABLED");
  if (c.offline !== null) return delivery(st, c.offline);
  if (!options || resolve(options.project) !== resolve(project)) return fallback(st, "MCP_NOT_CONFIGURED");
  const s = p.selection!, r = c.remote!, op = structuredClone(options.policy), current = structuredClone(options.currentContext());
  if (op.project_id !== p.project_id || current.project_id !== p.project_id || current.scope !== `module:${moduleId}` || !["ui-mock", "ui-page-planning", "ui-mock-generation"].includes(current.stage) || op.instance_id !== s.instance_id || op.connection !== r.connection || digest(s.arguments) !== digest(r.arguments)) fail("DESIGN_BINDING_DENIED");
  try {
    const response = await createCoreMcpReadOnly({ ...options, policy: op }).call({ schema: "aidlc.mcp-read-request/v1", ...current,
      request_id: randomUUID(), expires_at: new Date(Date.now() + 30_000).toISOString(), instance_id: s.instance_id!, project_lock_digest: op.project_lock_digest,
      connection: r.connection, connection_digest: op.connection_digest, resource: s.resource, tool: r.tool, arguments: structuredClone(s.arguments) });
    const snapshot = { path: relative(realpathSync(project), response.snapshot_path).replace(/\\/g, "/"), digest: response.snapshot_digest, project_id: p.project_id };
    const verified = readMcpSnapshot(safe(project, snapshot.path), { project, project_id: p.project_id, project_lock_digest: op.project_lock_digest, snapshot_digest: snapshot.digest });
    // Recheck policy and package after async I/O; no widening or stale selection.
    if (digest(selectionState(project, moduleId)) !== digest(st)) fail("DESIGN_SELECTION_CHANGED");
    return delivery(st, mapped(c, verified.result), "MCP_SNAPSHOT", snapshot);
  } catch (e) {
    const code = (e as Error).message;
    if (["MCP_TIMEOUT", "MCP_AUTHENTICATION_FAILED", "MCP_HTTP_ERROR", "MCP_PROVIDER_UNAVAILABLE", "MCP_NOT_INSTALLED"].includes(code)) return fallback(st, code);
    throw e;
  }
}
/** Explicit staging is immutable. A new selection needs a new reviewed generation baseline. */
export function stageDesignResource(project: string, moduleId: string, value: DesignResourceLock): void {
  const publication = captureModulePublication(project, moduleId);
  verifyDesignResource(project, moduleId, value);
  publishScope(project, publication, () => writeFileSync(safe(project, designResourcePath(moduleId)), JSON.stringify(value, null, 2) + "\n", { flag: "wx", encoding: "utf8" }));
}
export function resolveDesignResource(project: string, moduleId: string): DesignResourceLock {
  if (existsSync(safe(project, designResourcePath(moduleId)))) {
    const v = json(project, designResourcePath(moduleId)); verifyDesignResource(project, moduleId, v); return v;
  }
  const st = selectionState(project, moduleId);
  if (!st.c) return fallback(st, "NOT_BOUND_OR_DISABLED");
  if (st.c.offline !== null) return delivery(st, st.c.offline);
  fail("DESIGN_ACQUISITION_REQUIRED");
}
export function verifyDesignResource(project: string, moduleId: string, lock: DesignResourceLock | undefined): void {
  if (lock === undefined) {
    // Legacy locks remain usable only without an explicit resource selection/staging.
    if (policy(project, moduleId).selection || existsSync(safe(project, designResourcePath(moduleId)))) fail("DESIGN_LEGACY_ADOPTION_REQUIRED");
    return;
  }
  const st = selectionState(project, moduleId);
  if (lock.schema !== "aidlc.design-resource-lock/v1" || lock.selection_digest !== st.p.digest || digest(lock.source) !== digest(st.source)) fail("DESIGN_RESOURCE_STALE_REVIEW_REQUIRED");
  let expected: DesignResourceLock;
  if (lock.status === "fallback") {
    if (!["NOT_BOUND_OR_DISABLED", "MCP_NOT_CONFIGURED", "MCP_TIMEOUT", "MCP_AUTHENTICATION_FAILED", "MCP_HTTP_ERROR", "MCP_PROVIDER_UNAVAILABLE", "MCP_NOT_INSTALLED"].includes(lock.reason)) fail("DESIGN_INVALID_FALLBACK");
    if (lock.reason === "NOT_BOUND_OR_DISABLED" && st.c) fail("DESIGN_RESOURCE_STALE_REVIEW_REQUIRED");
    expected = fallback(st, lock.reason);
  } else if (st.c?.offline !== null && st.c) expected = delivery(st, st.c.offline);
  else {
    if (!st.c?.remote || !lock.snapshot || lock.snapshot.project_id !== st.p.project_id) fail("DESIGN_INVALID_SNAPSHOT");
    const verified = readMcpSnapshot(safe(project, lock.snapshot.path), { project, project_id: st.p.project_id, project_lock_digest: st.source!.project_lock_digest, snapshot_digest: lock.snapshot.digest });
    if (!obj(verified.context) || verified.context.scope !== `module:${moduleId}` || !["ui-mock", "ui-page-planning", "ui-mock-generation"].includes(verified.context.stage) || verified.instance_id !== st.source!.instance_id || verified.connection !== st.c.remote.connection || verified.tool !== st.c.remote.tool || verified.resource !== st.p.selection!.resource || verified.input_digest !== digest(st.p.selection!.arguments)) fail("DESIGN_SNAPSHOT_BINDING_DENIED");
    expected = delivery(st, mapped(st.c, verified.result), "MCP_SNAPSHOT", lock.snapshot);
  }
  if (digest(expected) !== digest(lock)) fail("DESIGN_RESOURCE_STALE_REVIEW_REQUIRED");
  if (existsSync(safe(project, designResourcePath(moduleId))) && digest(json(project, designResourcePath(moduleId))) !== digest(lock)) fail("DESIGN_RESOURCE_STALE_REVIEW_REQUIRED");
}
/** Finite, deterministic stylesheet consumes all supported tokens without remote CSS. */
export function designResourceStyle(lock: DesignResourceLock): string {
  const t = validateDesignTokens(lock.tokens, true).tokens;
  if (digest(t) !== lock.token_digest) fail("DESIGN_RESOURCE_STALE_REVIEW_REQUIRED");
  const vars = keys.map(k => `--aidlc-${k.replace(/_/g, "-")}:${k === "font_family" ? `'${t[k]}',system-ui` : t[k]}`).join(";");
  return `<style data-aidlc-resource="${lock.token_digest}">:root{${vars}}body{background:var(--aidlc-background);color:var(--aidlc-foreground);font-family:var(--aidlc-font-family);font-size:var(--aidlc-font-size);padding:var(--aidlc-spacing)}button{background:var(--aidlc-primary);color:var(--aidlc-on-primary);padding:var(--aidlc-spacing);border-radius:var(--aidlc-radius)}input,select,textarea{font:inherit;border-radius:var(--aidlc-radius)}</style>`;
}
export function verifyDesignResourceConsumption(project: string, moduleId: string, lock: DesignResourceLock | undefined, html: string): void {
  verifyDesignResource(project, moduleId, lock);
  if (lock && (!html.includes(designResourceStyle(lock)) || (html.match(/data-aidlc-resource=/g) || []).length !== 1)) fail("DESIGN_TOKENS_NOT_CONSUMED");
}
export function applyDesignResourceStyle(project: string, moduleId: string, lock: DesignResourceLock, htmlPath: string): void {
  const publication = captureModulePublication(project, moduleId);
  verifyDesignResource(project, moduleId, lock);
  const file = safe(project, htmlPath), html = readFileSync(file, "utf8");
  if (!htmlPath.startsWith(`docs/aidlc/modules/${moduleId}/inception/ui-mock/`) || !htmlPath.endsWith(".html") || !html.includes("</head>")) fail("DESIGN_INVALID_HTML_TARGET");
  if (html.includes(designResourceStyle(lock))) { verifyDesignResourceConsumption(project, moduleId, lock, html); return; }
  if (html.includes("data-aidlc-resource=")) fail("DESIGN_EXISTING_STYLE_REVIEW_REQUIRED");
  publishScope(project, publication, () => writeFileSync(file, html.replace("</head>", designResourceStyle(lock) + "\n</head>"), "utf8"));
}
