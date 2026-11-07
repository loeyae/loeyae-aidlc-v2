/** Trusted, service-independent external UI consumer. Providers supply data, never code. */
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { createCoreMcpReadOnly, readMcpSnapshot, type McpReadContext, type McpReadOptions } from "./aidlc-mcp-readonly.js";
import { decodeMcpPng } from "./aidlc-mcp-image.js";
import { canonicalProviderJson, readProjectProviders, sha256FileDigest, sha256ProviderDigest as digest } from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";
import { readUiGenerationLock, snapshotUiSource, verifyUiGenerationLockAtBaseline } from "./aidlc-ui-governance.js";
import { loadWorkflowView } from "./aidlc-workflow-layout.js";
import { DESIGN_POLICY, designResourcePath } from "./aidlc-design-resource.js";

export const UI_READ_POLICY = ".aidlc/ui-read-policy.json";
export interface UiReadTarget { page_id: string; file_key: string; page_node_id: string; node_id: string }
export interface SignedUiReadChoice {
  payload: {
    schema: "aidlc.ui-read-choice/v1"; project_id: string; module_id: string;
    route: string; ui_applicable: boolean; approval_ref: string; page_plan_digest: string;
    generation_lock_digest: string; project_lock_digest: string; target_digest: string; expires_at: string;
  };
  signature: { algorithm: "Ed25519"; value: string };
}
export interface UiReadCandidate {
  source: "external"; external_read_only: true; file_key: string; pages: UiReadTarget[]; unresolved: string[];
}
export interface UiReadInput { module_id: string; choice: SignedUiReadChoice; candidate: UiReadCandidate }
type Role = "metadata" | "variables" | "screenshot";
const roles: Role[] = ["metadata", "variables", "screenshot"];
interface Operation { tool: string; file_argument: string; node_argument: string; arguments: Record<string, unknown> }
interface Contract {
  schema: "aidlc.ui-read-source/v1"; version: string; connection: string;
  format: "sparse-xml-inline-png/v1"; authentication: "oauth-required" | "fixture-bearer";
  operations: Record<Role, Operation>;
}
interface OperatorSelection {
  instance_id: string; contract_digest: string; target_digest: string; choice_public_key_pem: string;
  /** Independently reviewed read tools. Provider declarations/server hints grant nothing. */
  verified_read_tools: string[];
}
interface SnapshotRef { path: string; digest: string; role: Role; page_id: string }
interface Registration {
  schema: "aidlc.ui-read-registration/v1"; input: UiReadInput; policy_digest: string;
  context: McpReadContext; snapshots: SnapshotRef[]; fixture: boolean; read_generation: string;
}
function fail(code: string): never { throw new Error(code); }
function obj(v: unknown): v is Record<string, any> { return !!v && typeof v === "object" && !Array.isArray(v); }
function exact(v: unknown, keys: string[]): asserts v is Record<string, any> {
  if (!obj(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail("UI_READ_INVALID_SHAPE");
}
function same(a: unknown, b: unknown): boolean { return canonicalProviderJson(a) === canonicalProviderJson(b); }
function label(v: unknown): asserts v is string { if (typeof v !== "string" || !v.trim() || v.length > 512 || /[\u0000-\u001f]/.test(v)) fail("UI_READ_INVALID_LABEL"); }
function field(v: unknown): asserts v is string {
  if (typeof v !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(v) || ["constructor", "prototype", "__proto__"].includes(v)) fail("UI_READ_INVALID_FIELD");
}
function safe(project: string, path: string): string {
  const root = realpathSync(project), p = resolve(root, path), rel = relative(root, p);
  if (!rel || isAbsolute(path) || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("UI_READ_UNSAFE_PATH");
  for (let cursor = p; ; cursor = dirname(cursor)) {
    if (existsSync(cursor) && (lstatSync(cursor).isSymbolicLink() || lstatSync(cursor).isFile() && lstatSync(cursor).nlink !== 1)) fail("UI_READ_UNSAFE_PATH");
    if (cursor === dirname(cursor)) break;
  }
  return p;
}
function json(project: string, path: string): any {
  const p = safe(project, path);
  if (!lstatSync(p).isFile() || lstatSync(p).size > 8 * 1024 * 1024) fail("UI_READ_INVALID_FILE");
  return JSON.parse(readFileSync(p, "utf8"));
}
function selectedRoute(project: string, moduleId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(moduleId)) fail("UI_READ_INVALID_MODULE");
  const state = loadWorkflowView(project, moduleId);
  const entry = state?.history.slice().reverse().find(h => h.stage === "ui-mock" && h.module_id === moduleId && ["completed", "approved"].includes(h.result));
  return { state, route: entry?.user_input ?? "not-selected" };
}
export function readUiReadContract(project: string, instance: string): Contract {
  const state = readProjectProviders(project);
  if (!state.config.providers.some(p => p.instance_id === instance && p.enabled)) fail("UI_READ_PROVIDER_DISABLED");
  const locked = state.lock.providers.find(p => p.instance_id === instance);
  if (!locked) fail("UI_READ_PROVIDER_UNLOCKED");
  const { manifest } = verifyLockedProviderCache(project, locked);
  const c: unknown = manifest.extensions?.["aidlc.ui-read-source"];
  exact(c, ["schema", "version", "connection", "format", "authentication", "operations"]);
  if (c.schema !== "aidlc.ui-read-source/v1" || c.version !== manifest.version || c.format !== "sparse-xml-inline-png/v1"
    || !["oauth-required", "fixture-bearer"].includes(c.authentication)) fail("UI_READ_CONTRACT_UNSUPPORTED");
  label(c.connection); exact(c.operations, roles);
  for (const role of roles) {
    const op = c.operations[role]; exact(op, ["tool", "file_argument", "node_argument", "arguments"]);
    field(op.tool); field(op.file_argument); field(op.node_argument);
    if (op.file_argument === op.node_argument || !obj(op.arguments) || Object.keys(op.arguments).length > 8
      || [op.file_argument, op.node_argument].some(k => Object.hasOwn(op.arguments, k))) fail("UI_READ_CONTRACT_INVALID");
    Object.keys(op.arguments).forEach(field);
  }
  return structuredClone(c) as Contract;
}
function preflight(project: string, input: UiReadInput) {
  exact(input, ["module_id", "choice", "candidate"]);
  const { state, route } = selectedRoute(project, input.module_id);
  if (route !== "figma-existing") fail("UI_READ_SELECTION_DENIED");
  const p = json(project, UI_READ_POLICY);
  exact(p, ["schema", "project_id", "modules"]);
  if (p.schema !== "aidlc.ui-read-policy/v1" || !obj(p.modules)) fail("UI_READ_INVALID_POLICY");
  label(p.project_id);
  const op = p.modules[input.module_id] as OperatorSelection;
  exact(op, ["instance_id", "contract_digest", "target_digest", "choice_public_key_pem", "verified_read_tools"]);
  if (!Array.isArray(op.verified_read_tools) || op.verified_read_tools.length !== 3 || new Set(op.verified_read_tools).size !== 3) fail("UI_READ_INVALID_POLICY");
  op.verified_read_tools.forEach(field);
  exact(input.choice, ["payload", "signature"]);
  const s = input.choice.payload;
  exact(s, ["schema", "project_id", "module_id", "route", "ui_applicable", "approval_ref", "page_plan_digest", "generation_lock_digest", "project_lock_digest", "target_digest", "expires_at"]);
  exact(input.choice.signature, ["algorithm", "value"]);
  const key = createPublicKey(op.choice_public_key_pem);
  if (key.asymmetricKeyType !== "ed25519" || input.choice.signature.algorithm !== "Ed25519"
    || typeof input.choice.signature.value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(input.choice.signature.value)
    || !verify(null, Buffer.from(canonicalProviderJson(s)), key, Buffer.from(input.choice.signature.value, "base64"))) fail("UI_READ_CHOICE_SIGNATURE_DENIED");
  if (s.schema !== "aidlc.ui-read-choice/v1" || s.project_id !== p.project_id || s.module_id !== input.module_id
    || s.route !== route || s.ui_applicable !== true || !Number.isFinite(Date.parse(s.expires_at)) || Date.parse(s.expires_at) <= Date.now()) fail("UI_READ_CHOICE_STALE_OR_DENIED");
  label(s.approval_ref);
  if (!state?.history.some(h => h.stage === "ui-page-planning" && h.module_id === input.module_id && ["completed", "approved"].includes(h.result))) fail("UI_READ_PAGE_PLAN_NOT_APPROVED");
  const loaded = readUiGenerationLock(project, input.module_id), lock = loaded.lock;
  if (lock.route !== route || loaded.digest !== s.generation_lock_digest || !lock.design_resource) fail("UI_READ_GENERATION_STALE");
  if (!same(lock.sources, lock.sources.map(p => snapshotUiSource(project, p.kind, p.path)))) fail("UI_READ_GENERATION_STALE");
  verifyUiGenerationLockAtBaseline(project, input.module_id, "figma-existing", lock.pages.map(p => p.page_id));
  const plan = lock.sources.find(p => p.kind === "page-plan")!;
  if (plan.sha256 !== s.page_plan_digest) fail("UI_READ_PAGE_PLAN_STALE");
  const planText = readFileSync(safe(project, plan.path), "utf8");
  if (!/##\s*未决项\s*\r?\n\s*(?:无|none)[。.]?\s*(?:\r?\n##|$)/i.test(planText)) fail("UI_READ_PAGE_PLAN_UNRESOLVED");
  const candidate = input.candidate;
  exact(candidate, ["source", "external_read_only", "file_key", "pages", "unresolved"]);
  if (candidate.source !== "external" || candidate.external_read_only !== true || !/^[A-Za-z0-9]{1,128}$/.test(candidate.file_key)
    || !Array.isArray(candidate.pages) || candidate.pages.length < 1 || candidate.pages.length > 32
    || !Array.isArray(candidate.unresolved) || candidate.unresolved.length) fail("UI_READ_CANDIDATE_DENIED");
  const pageIds = new Set<string>(), nodes = new Set<string>();
  for (const t of candidate.pages) {
    exact(t, ["page_id", "file_key", "page_node_id", "node_id"]);
    if (t.file_key !== candidate.file_key || !/^\d+:\d+$/.test(t.page_node_id) || !/^\d+:\d+$/.test(t.node_id)
      || t.node_id === t.page_node_id || pageIds.has(t.page_id) || nodes.has(t.node_id)) fail("UI_READ_TARGET_DENIED");
    pageIds.add(t.page_id); nodes.add(t.node_id);
  }
  if (!same([...pageIds].sort(), lock.pages.map(p => p.page_id).sort())) fail("UI_READ_PAGE_SET_MISMATCH");
  if (digest(candidate.pages) !== s.target_digest || s.target_digest !== op.target_digest) fail("UI_READ_TARGET_DENIED");
  const c = readUiReadContract(project, op.instance_id);
  if (digest(c) !== op.contract_digest || !same(Object.values(c.operations).map(o => o.tool).sort(), [...op.verified_read_tools].sort())) fail("UI_READ_CONTRACT_DENIED");
  const { state: providers, requirements } = resolveProviderMcpRequirements(project);
  if (providers.lock.lock_digest !== s.project_lock_digest) fail("UI_READ_PROVIDER_LOCK_STALE");
  const requirement = requirements.find(r => r.source.instance_id === op.instance_id && r.connection.name === c.connection);
  if (!requirement) fail("UI_READ_CONNECTION_MISSING");
  return { op, c, loaded, plan, requirement, policy_digest: digest(p), project_id: p.project_id as string };
}
function resource(input: UiReadInput, t: UiReadTarget) { return `ui-read:${input.module_id}:${input.choice.payload.generation_lock_digest}:${digest(t)}`; }
function invocation(c: Contract, role: Role, t: UiReadTarget) {
  const op = c.operations[role];
  return { tool: op.tool, arguments: { ...op.arguments, [op.file_argument]: t.file_key, [op.node_argument]: role === "metadata" ? t.page_node_id : t.node_id } };
}
function textContent(result: any): string {
  if (!Array.isArray(result?.content) || result.content.length !== 1 || result.content[0].type !== "text" || typeof result.content[0].text !== "string" || !result.content[0].text.trim()) fail("UI_READ_TEXT_UNVERIFIED");
  return result.content[0].text;
}
/** Sparse XML identity only. It does not certify fields, behavior, layout or token usage. */
function metadata(result: unknown, target: UiReadTarget) {
  const xml = textContent(result);
  if (xml.length > 500_000 || /<!DOCTYPE|<!ENTITY|<\?/i.test(xml)) fail("UI_READ_METADATA_INVALID");
  let invalid = false;
  const doc = new DOMParser({ onError: () => { invalid = true; } }).parseFromString(xml, "text/xml");
  if (invalid || !doc.documentElement) fail("UI_READ_METADATA_INVALID");
  const all = [doc.documentElement, ...Array.from(doc.documentElement.getElementsByTagName("*"))];
  const canvases = all.filter(e => e.tagName === "canvas" && e.getAttribute("id") === target.page_node_id);
  const frames = all.filter(e => e.tagName === "frame" && e.getAttribute("id") === target.node_id);
  if (all.filter(e => e.getAttribute("id") === target.page_node_id).length !== 1 || all.filter(e => e.getAttribute("id") === target.node_id).length !== 1 || canvases.length !== 1 || frames.length !== 1) fail("UI_READ_NODE_MISSING_OR_AMBIGUOUS");
  let parent = frames[0].parentNode;
  while (parent && parent !== canvases[0]) parent = parent.parentNode;
  if (!parent) fail("UI_READ_NODE_OUTSIDE_PAGE");
  const page = canvases[0].getAttribute("name"), frame = frames[0].getAttribute("name");
  label(page); label(frame);
  return { page, frame };
}
function asset(project: string, result: any, persist: boolean) {
  if (!Array.isArray(result?.content)) fail("UI_READ_SCREENSHOT_NEEDS_CAPABILITY");
  const images = result.content.filter((c: any) => c.type === "image");
  if (images.length !== 1 || result.content.some((c: any) => !["image", "text"].includes(c.type))) fail("UI_READ_SCREENSHOT_NEEDS_CAPABILITY");
  const bytes = decodeMcpPng(images[0]), hash = sha256FileDigest(bytes);
  const path = `.aidlc/ui-readonly/assets/${hash.slice(7)}.png`, absolute = safe(project, path);
  if (persist && !existsSync(absolute)) { mkdirSync(dirname(absolute), { recursive: true }); safe(project, path); writeFileSync(absolute, bytes, { flag: "wx", mode: 0o600 }); }
  if (!existsSync(absolute) || lstatSync(absolute).size !== bytes.length || sha256FileDigest(readFileSync(absolute)) !== hash) fail("UI_READ_SCREENSHOT_TAMPERED");
  return { path, digest: hash, mime_type: "image/png", size: bytes.length };
}
function materialize(project: string, reg: Registration, persist: boolean) {
  const st = preflight(project, reg.input), input = reg.input;
  if (st.policy_digest !== reg.policy_digest || reg.context.project_id !== st.project_id || reg.context.stage !== "ui-figma-generation"
    || reg.context.scope !== `module:${input.module_id}` || reg.schema !== "aidlc.ui-read-registration/v1"
    || !/^[A-Za-z0-9_-]{1,80}$/.test(reg.read_generation) || reg.snapshots.length !== input.candidate.pages.length * 3) fail("UI_READ_REGISTRATION_STALE");
  const pages = input.candidate.pages.map(target => {
    const values = Object.fromEntries(roles.map(role => {
      const refs = reg.snapshots.filter(s => s.role === role && s.page_id === target.page_id);
      if (refs.length !== 1) fail("UI_READ_SNAPSHOT_SET_INVALID");
      const ref = refs[0], snapshot = readMcpSnapshot(safe(project, ref.path), { project, project_id: st.project_id,
        project_lock_digest: input.choice.payload.project_lock_digest, snapshot_digest: ref.digest });
      const call = invocation(st.c, role, target);
      if (snapshot.instance_id !== st.op.instance_id || snapshot.connection !== st.c.connection || snapshot.connection_digest !== digest(st.requirement.connection)
        || !same(snapshot.source, st.requirement.source) || !same(snapshot.context, reg.context) || snapshot.fixture !== reg.fixture || snapshot.read_generation !== reg.read_generation
        || snapshot.tool !== call.tool || snapshot.resource !== resource(input, target) || snapshot.input_digest !== digest(call.arguments)) fail("UI_READ_SNAPSHOT_BINDING_DENIED");
      return [role, snapshot];
    })) as Record<Role, any>;
    const names = metadata(values.metadata.result, target);
    textContent(values.variables.result); // external source, not proof of style consumption
    const image = asset(project, values.screenshot.result, persist), planned = st.loaded.lock.pages.find(p => p.page_id === target.page_id)!;
    return { ...planned, ...names, node_id: target.node_id, page_node_id: target.page_node_id,
      screenshot: image.path, screenshot_asset: image, metadata_snapshot: reg.snapshots.find(s => s.role === "metadata" && s.page_id === target.page_id)!.digest,
      variables_snapshot: reg.snapshots.find(s => s.role === "variables" && s.page_id === target.page_id)!.digest,
      screenshot_snapshot: reg.snapshots.find(s => s.role === "screenshot" && s.page_id === target.page_id)!.digest };
  });
  return { schema_version: "1", design_mode: "figma", source: "external", file_url: `https://www.figma.com/design/${input.candidate.file_key}`,
    page_plan: st.plan.path, pages,
    validation: { external_read_only: true, metadata: "observed", variables: "observed", screenshots: "verified-assets", components: "unverified", auto_layout: "unverified", behavior: "unverified", visual_review: "unverified" },
    unresolved: [], read_registration: reg };
}
export function uiReadManifestPath(moduleId: string) { return `docs/aidlc/modules/${moduleId}/inception/ui-design/figma-manifest.json`; }

/** Offline operator review only. Returned grants are still subject to explicit MCP policy. */
export function planExternalUiRead(project: string, input: UiReadInput) {
  const st = preflight(project, input);
  return input.candidate.pages.flatMap(t => roles.map(role => ({ ...invocation(st.c, role, t), resource: resource(input, t) })));
}

/** Acquisition and controlled publication. No Evidence, approval, state advancement or Provider execution. */
export async function consumeExternalUiDesign(options: McpReadOptions, value: UiReadInput) {
  const input = structuredClone(value), initial = selectedRoute(options.project, input.module_id);
  if (initial.route !== "figma-existing") return { status: "not-applicable" as const }; // zero calls/placeholders
  try {
    const st = preflight(options.project, input), policy = structuredClone(options.policy), context = structuredClone(options.currentContext());
    if (resolve(options.project) !== realpathSync(options.project) || context.project_id !== st.project_id || context.stage !== "ui-figma-generation" || context.scope !== `module:${input.module_id}`
      || policy.instance_id !== st.op.instance_id || policy.connection !== st.c.connection || policy.project_lock_digest !== input.choice.payload.project_lock_digest
      || policy.schema !== "aidlc.mcp-read-policy/v2" || policy.result_content !== "text-or-png") fail("UI_READ_OPERATION_POLICY_DENIED");
    const grants = input.candidate.pages.flatMap(t => roles.map(role => ({ ...invocation(st.c, role, t), resource: resource(input, t) })));
    if (!same(policy.grants, grants)) fail("UI_READ_OPERATION_POLICY_DENIED"); // including any write grant, even unused
    if (st.c.authentication === "oauth-required") fail("UI_READ_NEEDS_OAUTH_CAPABILITY");
    if (!policy.fixture || st.c.authentication !== "fixture-bearer") fail("UI_READ_AUTHENTICATION_UNSUPPORTED");
    // Full Git/package validation runs at acquisition/publication; the MCP broker also
    // verifies its locked packages on every exchange. Avoid re-running Git just to detect
    // changed local intent inside the synchronous currentContext callback.
    const tracked = [UI_READ_POLICY, st.loaded.path, ...st.loaded.lock.sources.map(s => s.path), DESIGN_POLICY, designResourcePath(input.module_id),
      ...(st.loaded.lock.design_resource?.snapshot ? [st.loaded.lock.design_resource.snapshot.path] : [])];
    const liveBinding = () => digest({ state: selectedRoute(options.project, input.module_id).state,
      provider_lock: readProjectProviders(options.project).lock.lock_digest,
      files: tracked.map(p => { const path = safe(options.project, p); return [p, existsSync(path) ? sha256FileDigest(readFileSync(path)) : null]; }) });
    const initialBinding = liveBinding();
    const resourceExpiry = st.loaded.lock.design_resource?.snapshot
      ? Date.parse(String(json(options.project, st.loaded.lock.design_resource.snapshot.path).expires_at)) : null;
    const check = () => {
      if (Date.parse(input.choice.payload.expires_at) <= Date.now() || resourceExpiry !== null && (!Number.isFinite(resourceExpiry) || resourceExpiry <= Date.now())) fail("UI_READ_AUTHORIZATION_OR_RESOURCE_EXPIRED");
      if (liveBinding() !== initialBinding || !same(options.currentContext(), context)) fail("UI_READ_CONTEXT_CHANGED");
      return context;
    };
    policy.read_generation = randomUUID();
    const broker = createCoreMcpReadOnly({ ...options, policy, currentContext: check });
    const snapshots: SnapshotRef[] = [];
    for (const target of input.candidate.pages) for (const role of roles) {
      check();
      const call = invocation(st.c, role, target);
      const result = await broker.call({ schema: "aidlc.mcp-read-request/v1", ...context, request_id: randomUUID(),
        expires_at: new Date(Date.now() + 30_000).toISOString(), instance_id: st.op.instance_id,
        project_lock_digest: policy.project_lock_digest, connection: st.c.connection, connection_digest: policy.connection_digest,
        resource: resource(input, target), ...call });
      snapshots.push({ role, page_id: target.page_id, path: relative(realpathSync(options.project), result.snapshot_path).replace(/\\/g, "/"), digest: result.snapshot_digest });
      // Fail early on missing identity/assets; never guess or write a partial canonical manifest.
      const verified = readMcpSnapshot(result.snapshot_path, { project: options.project, project_id: st.project_id, project_lock_digest: policy.project_lock_digest, snapshot_digest: result.snapshot_digest });
      if (role === "metadata") metadata(verified.result, target);
      if (role === "variables") textContent(verified.result);
      if (role === "screenshot") {
        const content = (verified.result as any).content, images = content.filter((c: any) => c.type === "image");
        if (images.length !== 1) fail("UI_READ_SCREENSHOT_NEEDS_CAPABILITY");
        decodeMcpPng(images[0]);
      }
    }
    check();
    const reg: Registration = { schema: "aidlc.ui-read-registration/v1", input, policy_digest: st.policy_digest, context, snapshots, fixture: policy.fixture, read_generation: policy.read_generation };
    const manifest = materialize(options.project, reg, true), path = uiReadManifestPath(input.module_id), output = safe(options.project, path);
    // Publish only after every read/asset passed and all live bindings were rechecked.
    check();
    const temporary = safe(options.project, `${path}.tmp-${randomUUID()}`);
    writeFileSync(temporary, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, output);
    return { status: "registered" as const, path, manifest, gate_eligible: false as const };
  } catch (error) {
    const code = (error as Error).message;
    const reason = /^(?:UI_READ|MCP)_[A-Z_]+$/.test(code) ? code : "UI_READ_PREFLIGHT_OR_RESULT_INVALID";
    return { status: /CAPABILITY|UNSUPPORTED/.test(reason) ? "NEEDS_CAPABILITY" as const : "UNVERIFIED" as const, reason, gate_eligible: false as const };
  }
}

/** Existing artifact/behavior/freshness callers must revalidate all external input bytes. */
export function verifyExternalUiManifest(project: string, moduleId: string, raw?: unknown): string[] {
  const manifest = raw ?? json(project, uiReadManifestPath(moduleId));
  if (!obj(manifest) || !obj(manifest.read_registration)) fail("UI_READ_REGISTRATION_REQUIRED");
  const reg = manifest.read_registration as Registration;
  if (reg.input.module_id !== moduleId || !same(materialize(project, reg, false), manifest)) fail("UI_READ_MANIFEST_TAMPERED");
  return [...reg.snapshots.map(s => s.path), ...manifest.pages.map((p: any) => p.screenshot)];
}
