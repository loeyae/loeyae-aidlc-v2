/** Core-owned finite UI creation. External packages declare data, never executable scripts. */
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { canonicalProviderJson, readProjectProviders, sha256FileDigest, sha256ProviderDigest as digest } from "./aidlc-project-provider.js";
import { verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";
import { readUiGenerationLock, snapshotUiSource, verifyUiGenerationLockAtBaseline } from "./aidlc-ui-governance.js";
import { loadWorkflowView } from "./aidlc-workflow-layout.js";
import { createCoreMcpReadOnly, readMcpSnapshot, type McpReadOptions, type McpReadContext } from "./aidlc-mcp-readonly.js";
import { dispatchCoreMcpWrite, type McpWriteOptions } from "./aidlc-mcp-write.js";
import { decodeMcpPng } from "./aidlc-mcp-image.js";
import { openOperationJournal, operationPath as safe, durableExclusive } from "./aidlc-operation-journal.js";
import { uiReadManifestPath } from "./aidlc-ui-readonly.js";
import { DESIGN_POLICY, designResourcePath } from "./aidlc-design-resource.js";

export const UI_WRITE_POLICY = ".aidlc/ui-write-policy.json";
export interface UiFramePlan { page_id: string; page_node_id: string; name: string; width: number; height: number; texts: string[] }
export interface UiCreateCandidate { file_key: string; frames: UiFramePlan[] }
export interface UiWritePayload {
  schema: "aidlc.ui-write-authorization/v1"; project_id: string; module_id: string; route: "figma-create"; ui_applicable: true;
  approval_ref: string; page_plan_digest: string; generation_lock_digest: string; project_lock_digest: string;
  stage: "ui-figma-generation"; scope: string; operation_id: string; operation: "create-frames";
  input_digest: string; target_digest: string; expires_at: string;
}
export interface UiCreateInput { module_id: string; candidate: UiCreateCandidate; choice: { payload: UiWritePayload; signature: { algorithm: "Ed25519"; value: string } } }
interface Contract {
  schema: "aidlc.ui-create-source/v1"; version: string; connection: string;
  authentication: "oauth-required" | "fixture-bearer";
  protocol: "unsupported" | "fixture-owned-frames/v1";
  operations: null | { create: string; reconcile: string; screenshot: string };
}
interface Selection {
  instance_id: string; contract_digest: string; target_digest: string; choice_public_key_pem: string;
  journal_public_key_pem: string; shared_file_key: string; verified_operations: Contract["operations"];
}
interface SnapshotRef { path: string; digest: string; role: "reconcile" | "screenshot"; page_id: string | null }
interface Registration {
  schema: "aidlc.ui-create-registration/v1"; input: UiCreateInput; policy_digest: string;
  context: McpReadContext; snapshots: SnapshotRef[]; read_generation: string; fixture: true;
}
function fail(code: string): never { throw new Error(code); }
const same = (a: unknown, b: unknown) => canonicalProviderJson(a) === canonicalProviderJson(b);
function exact(v: any, keys: string[]) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail("UI_WRITE_INVALID_SHAPE");
}
function json(project: string, path: string) { const bytes = readFileSync(safe(project, path)); if (bytes.length > 8 * 1024 * 1024) fail("UI_WRITE_FILE_TOO_LARGE"); return JSON.parse(bytes.toString("utf8")); }
function route(project: string, moduleId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(moduleId)) fail("UI_WRITE_INVALID_MODULE");
  const state = loadWorkflowView(project, moduleId);
  return { state, route: state?.history.slice().reverse().find(h => h.stage === "ui-mock" && h.module_id === moduleId && ["completed", "approved"].includes(h.result))?.user_input };
}
export function uiCreateTargets(candidate: UiCreateCandidate) {
  return { file_key: candidate.file_key, pages: candidate.frames.map(f => ({ page_id: f.page_id, page_node_id: f.page_node_id })) };
}
export function readUiCreateContract(project: string, instance: string): Contract {
  const providers = readProjectProviders(project), locked = providers.lock.providers.find(p => p.instance_id === instance);
  if (!locked || !providers.config.providers.some(p => p.instance_id === instance && p.enabled)) fail("UI_WRITE_PROVIDER_UNAVAILABLE");
  const { manifest } = verifyLockedProviderCache(project, locked), c = manifest.extensions?.["aidlc.ui-create-source"] as unknown as Contract;
  exact(c, ["schema", "version", "connection", "authentication", "protocol", "operations"]);
  if (c.schema !== "aidlc.ui-create-source/v1" || c.version !== manifest.version || !["oauth-required", "fixture-bearer"].includes(c.authentication)
    || !["unsupported", "fixture-owned-frames/v1"].includes(c.protocol) || typeof c.connection !== "string") fail("UI_WRITE_CONTRACT_UNSUPPORTED");
  if (c.protocol === "unsupported") { if (c.operations !== null) fail("UI_WRITE_CONTRACT_UNSUPPORTED"); }
  else {
    exact(c.operations, ["create", "reconcile", "screenshot"]);
    if (new Set(Object.values(c.operations!)).size !== 3 || Object.values(c.operations!).some(t => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(t))) fail("UI_WRITE_CONTRACT_UNSUPPORTED");
  }
  return structuredClone(c);
}
function preflight(project: string, input: UiCreateInput) {
  exact(input, ["module_id", "candidate", "choice"]);
  const selected = route(project, input.module_id);
  if (selected.route !== "figma-create") fail("UI_WRITE_SELECTION_DENIED");
  const policy = json(project, UI_WRITE_POLICY);
  exact(policy, ["schema", "project_id", "modules"]);
  if (policy.schema !== "aidlc.ui-write-policy/v1" || typeof policy.project_id !== "string" || !policy.project_id.trim()) fail("UI_WRITE_POLICY_DENIED");
  const selection: Selection = policy.modules?.[input.module_id];
  exact(selection, ["instance_id", "contract_digest", "target_digest", "choice_public_key_pem", "journal_public_key_pem", "shared_file_key", "verified_operations"]);
  if (Object.values(policy.modules).some((m: any) => m.shared_file_key !== selection.shared_file_key)) fail("UI_WRITE_SHARED_FILE_CONFLICT");
  exact(input.choice, ["payload", "signature"]); exact(input.choice.signature, ["algorithm", "value"]);
  const s = input.choice.payload;
  exact(s, ["schema", "project_id", "module_id", "route", "ui_applicable", "approval_ref", "page_plan_digest", "generation_lock_digest", "project_lock_digest", "stage", "scope", "operation_id", "operation", "input_digest", "target_digest", "expires_at"]);
  const key = createPublicKey(selection.choice_public_key_pem);
  if (key.asymmetricKeyType !== "ed25519" || input.choice.signature.algorithm !== "Ed25519" || typeof input.choice.signature.value !== "string"
    || !verify(null, Buffer.from(canonicalProviderJson(s)), key, Buffer.from(input.choice.signature.value, "base64"))) fail("UI_WRITE_SIGNATURE_DENIED");
  if (s.schema !== "aidlc.ui-write-authorization/v1" || s.project_id !== policy.project_id || s.module_id !== input.module_id || s.route !== "figma-create"
    || s.ui_applicable !== true || s.stage !== "ui-figma-generation" || s.scope !== `module:${input.module_id}` || s.operation !== "create-frames"
    || !/^[A-Za-z0-9_-]{1,80}$/.test(s.operation_id) || typeof s.approval_ref !== "string" || !s.approval_ref.trim()
    || !Number.isFinite(Date.parse(s.expires_at)) || Date.parse(s.expires_at) <= Date.now()) fail("UI_WRITE_AUTHORIZATION_STALE_OR_DENIED");
  if (!selected.state?.history.some(h => h.stage === "ui-page-planning" && h.module_id === input.module_id && ["completed", "approved"].includes(h.result))) fail("UI_WRITE_PAGE_PLAN_NOT_APPROVED");
  const loaded = readUiGenerationLock(project, input.module_id), lock = loaded.lock;
  if (lock.route !== "figma-create" || loaded.digest !== s.generation_lock_digest || !lock.design_resource
    || !same(lock.sources, lock.sources.map(p => snapshotUiSource(project, p.kind, p.path)))) fail("UI_WRITE_GENERATION_STALE");
  verifyUiGenerationLockAtBaseline(project, input.module_id, "figma-create", lock.pages.map(p => p.page_id));
  const plan = lock.sources.find(p => p.kind === "page-plan")!;
  if (plan.sha256 !== s.page_plan_digest || !/##\s*未决项\s*\r?\n\s*(?:无|none)[。.]?\s*(?:\r?\n##|$)/i.test(readFileSync(safe(project, plan.path), "utf8"))) fail("UI_WRITE_PAGE_PLAN_STALE_OR_UNRESOLVED");
  const candidate = input.candidate;
  exact(candidate, ["file_key", "frames"]);
  if (typeof candidate.file_key !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(candidate.file_key) || candidate.file_key !== selection.shared_file_key || !Array.isArray(candidate.frames)
    || candidate.frames.length < 1 || candidate.frames.length > 32) fail("UI_WRITE_TARGET_DENIED");
  const pages = new Set<string>();
  for (const f of candidate.frames) {
    exact(f, ["page_id", "page_node_id", "name", "width", "height", "texts"]);
    if (typeof f.page_id !== "string" || pages.has(f.page_id) || typeof f.page_node_id !== "string" || !/^\d+:\d+$/.test(f.page_node_id) || typeof f.name !== "string" || !f.name.trim() || f.name.length > 256
      || ![f.width, f.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 8192)
      || !Array.isArray(f.texts) || !f.texts.length || f.texts.length > 64 || f.texts.some(t => typeof t !== "string" || !t.trim() || t.length > 2048)) fail("UI_WRITE_INPUT_DENIED");
    pages.add(f.page_id);
  }
  if (!same([...pages].sort(), lock.pages.map(p => p.page_id).sort()) || digest(candidate) !== s.input_digest
    || digest(uiCreateTargets(candidate)) !== s.target_digest || selection.target_digest !== s.target_digest) fail("UI_WRITE_TARGET_OR_INPUT_DENIED");
  const contract = readUiCreateContract(project, selection.instance_id);
  if (digest(contract) !== selection.contract_digest || !same(selection.verified_operations, contract.operations)) fail("UI_WRITE_CONTRACT_DENIED");
  const { state, requirements } = resolveProviderMcpRequirements(project);
  if (state.lock.lock_digest !== s.project_lock_digest) fail("UI_WRITE_PROVIDER_LOCK_STALE");
  const requirement = requirements.find(r => r.source.instance_id === selection.instance_id && r.connection.name === contract.connection);
  if (!requirement) fail("UI_WRITE_CONNECTION_MISSING");
  return { selection, contract, loaded, plan, requirement, policy_digest: digest(policy), context: {
    project_id: s.project_id, stage: s.stage, scope: s.scope,
  } };
}
function capability(c: Contract, fixture: boolean) {
  if (c.authentication === "oauth-required") fail("UI_WRITE_NEEDS_OAUTH_CAPABILITY");
  if (!fixture || c.protocol !== "fixture-owned-frames/v1" || !c.operations) fail("UI_WRITE_NEEDS_STRUCTURED_WRITE_AND_READBACK_CAPABILITY");
}
function binding(input: UiCreateInput, st: ReturnType<typeof preflight>) {
  return { input, policy_digest: st.policy_digest, contract: st.contract, source: st.requirement.source, connection: st.requirement.connection };
}
export function planUiCreate(project: string, input: UiCreateInput) {
  const st = preflight(project, input);
  if (!st.contract.operations) fail("UI_WRITE_NEEDS_STRUCTURED_WRITE_AND_READBACK_CAPABILITY");
  return { tool: st.contract.operations.create, resource: `ui-create:${input.module_id}:${input.choice.payload.operation_id}`,
    arguments: { ...input.candidate, operation_id: input.choice.payload.operation_id, input_digest: input.choice.payload.input_digest } };
}
function reconcileCall(input: UiCreateInput, st: ReturnType<typeof preflight>) {
  return { tool: st.contract.operations!.reconcile, resource: `ui-reconcile:${input.module_id}:${input.choice.payload.operation_id}`,
    arguments: { ...uiCreateTargets(input.candidate), operation_id: input.choice.payload.operation_id, input_digest: input.choice.payload.input_digest } };
}
function screenshotCall(input: UiCreateInput, st: ReturnType<typeof preflight>, page: any) {
  return { tool: st.contract.operations!.screenshot, resource: `ui-created-node:${input.module_id}:${input.choice.payload.operation_id}:${page.node_id}`,
    arguments: { fileKey: input.candidate.file_key, nodeId: page.node_id, enableBase64Response: true } };
}
function readback(result: any, input: UiCreateInput) {
  if (!Array.isArray(result?.content) || result.content.length !== 1 || result.content[0].type !== "text") fail("UI_WRITE_READBACK_UNVERIFIED");
  const value = JSON.parse(result.content[0].text);
  exact(value, ["operation_id", "input_digest", "file_key", "pages"]);
  if (value.operation_id !== input.choice.payload.operation_id || value.input_digest !== input.choice.payload.input_digest || value.file_key !== input.candidate.file_key
    || !Array.isArray(value.pages) || value.pages.length !== input.candidate.frames.length) fail("UI_WRITE_MANUAL_RECONCILIATION_REQUIRED");
  const ids = new Set<string>();
  for (const [index, page] of value.pages.entries()) {
    exact(page, ["page_id", "page_node_id", "node_id", "name", "width", "height", "texts"]);
    const { node_id, ...plan } = page;
    if (!same(plan, input.candidate.frames[index]) || !/^\d+:\d+$/.test(node_id) || node_id === page.page_node_id || ids.has(node_id)) fail("UI_WRITE_MANUAL_RECONCILIATION_REQUIRED");
    ids.add(node_id);
  }
  return value.pages as Array<UiFramePlan & { node_id: string }>;
}
function checkContext(st: ReturnType<typeof preflight>, context: McpReadContext) {
  if (context.project_id !== st.context.project_id || context.stage !== st.context.stage || context.scope !== st.context.scope) fail("UI_WRITE_CONTEXT_DENIED");
}
/** Full Git/package preflight runs at entry/publication. Between async exchanges,
 * compare all local intent bytes and expiration without repeatedly spawning Git. */
function liveGuard(options: Pick<McpReadOptions, "project" | "currentContext">, input: UiCreateInput, st: ReturnType<typeof preflight>, context: McpReadContext) {
  const tracked = [UI_WRITE_POLICY, st.loaded.path, ...st.loaded.lock.sources.map(s => s.path), DESIGN_POLICY, designResourcePath(input.module_id),
    ...(st.loaded.lock.design_resource?.snapshot ? [st.loaded.lock.design_resource.snapshot.path] : [])];
  const live = () => digest({ state: route(options.project, input.module_id).state, provider_lock: readProjectProviders(options.project).lock.lock_digest,
    files: tracked.map(path => { const file = safe(options.project, path); return [path, existsSync(file) ? sha256FileDigest(readFileSync(file)) : null]; }) });
  const initial = live(), resourceExpiry = st.loaded.lock.design_resource?.snapshot
    ? Date.parse(String(json(options.project, st.loaded.lock.design_resource.snapshot.path).expires_at)) : null;
  return () => {
    if (Date.parse(input.choice.payload.expires_at) <= Date.now() || resourceExpiry !== null && (!Number.isFinite(resourceExpiry) || resourceExpiry <= Date.now())) fail("UI_WRITE_AUTHORIZATION_OR_RESOURCE_EXPIRED");
    if (!same(context, options.currentContext()) || live() !== initial) fail("UI_WRITE_CONTEXT_CHANGED");
    return context;
  };
}
function materialize(project: string, reg: Registration, persist: boolean) {
  const st = preflight(project, reg.input); capability(st.contract, reg.fixture); checkContext(st, reg.context);
  if (reg.schema !== "aidlc.ui-create-registration/v1" || st.policy_digest !== reg.policy_digest || reg.snapshots.length !== reg.input.candidate.frames.length + 1) fail("UI_WRITE_REGISTRATION_DENIED");
  function snapshot(ref: SnapshotRef, invocation: ReturnType<typeof reconcileCall>) {
    const value = readMcpSnapshot(safe(project, ref.path), { project, project_id: reg.context.project_id,
      project_lock_digest: reg.input.choice.payload.project_lock_digest, snapshot_digest: ref.digest });
    if (value.instance_id !== st.selection.instance_id || value.connection !== st.contract.connection || value.connection_digest !== digest(st.requirement.connection)
      || !same(value.source, st.requirement.source) || !same(value.context, reg.context) || value.fixture !== true || value.read_generation !== reg.read_generation
      || value.tool !== invocation.tool || value.resource !== invocation.resource || value.input_digest !== digest(invocation.arguments)) fail("UI_WRITE_SNAPSHOT_BINDING_DENIED");
    return value.result;
  }
  const reconcile = reg.snapshots.filter(s => s.role === "reconcile" && s.page_id === null);
  if (reconcile.length !== 1) fail("UI_WRITE_READBACK_UNVERIFIED");
  const observed = readback(snapshot(reconcile[0], reconcileCall(reg.input, st)), reg.input);
  const pages = observed.map(page => {
    const refs = reg.snapshots.filter(s => s.role === "screenshot" && s.page_id === page.page_id);
    if (refs.length !== 1) fail("UI_WRITE_SCREENSHOT_REQUIRED");
    const result: any = snapshot(refs[0], screenshotCall(reg.input, st, page) as any);
    if (!Array.isArray(result?.content) || result.content.length !== 1 || result.content[0].type !== "image") fail("UI_WRITE_SCREENSHOT_REQUIRED");
    const bytes = decodeMcpPng(result.content[0]), hash = sha256FileDigest(bytes), path = `.aidlc/ui-created/assets/${hash.slice(7)}.png`;
    const absolute = safe(project, path);
    if (persist && !existsSync(absolute)) { mkdirSync(dirname(absolute), { recursive: true }); safe(project, path); writeFileSync(absolute, bytes, { flag: "wx", mode: 0o600 }); }
    if (!existsSync(absolute) || sha256FileDigest(readFileSync(absolute)) !== hash) fail("UI_WRITE_SCREENSHOT_TAMPERED");
    return { ...st.loaded.lock.pages.find(p => p.page_id === page.page_id)!, page: page.page_node_id, frame: page.name,
      node_id: page.node_id, page_node_id: page.page_node_id, screenshot: path, screenshot_asset: { path, digest: hash, mime_type: "image/png", size: bytes.length } };
  });
  return { schema_version: "1", design_mode: "figma", source: "created", file_url: `https://www.figma.com/design/${reg.input.candidate.file_key}`,
    page_plan: st.plan.path, pages, validation: { external_read_only: false, creation: "reconciled", metadata: "observed", screenshots: "verified-assets", components: "unverified", auto_layout: "unverified", behavior: "unverified", visual_review: "unverified" }, unresolved: [], create_registration: reg };
}
function rejection(error: unknown) {
  const message = (error as Error).message, reason = /^(?:UI_WRITE|MCP|OPERATION)_[A-Z_]+$/.test(message) ? message : "UI_WRITE_INPUT_OR_RESULT_INVALID";
  return { status: /CAPABILITY/.test(reason) ? "NEEDS_CAPABILITY" as const : "blocked" as const, reason, gate_eligible: false as const };
}

/** Create only; publication always requires the explicit independent recovery/readback path. */
export async function createUiDesign(options: McpWriteOptions, value: UiCreateInput) {
  const input = structuredClone(value);
  if (route(options.project, input.module_id).route !== "figma-create") return { status: "not-applicable" as const };
  try {
    const st = preflight(options.project, input); capability(st.contract, options.policy.fixture); checkContext(st, options.currentContext());
    if (options.policy.instance_id !== st.selection.instance_id || options.policy.connection !== st.contract.connection
      || options.policy.project_lock_digest !== input.choice.payload.project_lock_digest || options.policy.authentication !== st.contract.authentication) fail("UI_WRITE_POLICY_DENIED");
    const check = liveGuard(options, input, st, structuredClone(options.currentContext()));
    return await dispatchCoreMcpWrite(options, planUiCreate(options.project, input), input.choice.payload.operation_id, binding(input, st), st.selection.journal_public_key_pem, check);
  } catch (error) { return rejection(error); }
}

/** Reads only. Never retries creation, deletes or edits nodes, including on empty readback. */
export async function recoverUiDesign(options: Omit<McpReadOptions, "policy"> & { policy: Omit<McpReadOptions["policy"], "grants">; journalPrivateKeyPem: string; refresh?: boolean }, value: UiCreateInput) {
  const input = structuredClone(value);
  if (route(options.project, input.module_id).route !== "figma-create") return { status: "not-applicable" as const };
  try {
    const st = preflight(options.project, input), context = structuredClone(options.currentContext()); capability(st.contract, options.policy.fixture); checkContext(st, context);
    if (options.policy.schema !== "aidlc.mcp-read-policy/v2" || options.policy.result_content !== "text-or-png"
      || options.policy.instance_id !== st.selection.instance_id || options.policy.connection !== st.contract.connection
      || options.policy.project_lock_digest !== input.choice.payload.project_lock_digest) fail("UI_WRITE_READ_POLICY_DENIED");
    const journal = openOperationJournal(options.project, input.choice.payload.operation_id, binding(input, st), st.selection.journal_public_key_pem, options.journalPrivateKeyPem);
    const events = journal.read(), last = events.at(-1);
    if (!last || !["dispatched", "unknown", "succeeded"].includes(last.status)) fail("UI_WRITE_MANUAL_RECONCILIATION_REQUIRED");
    if (last.status === "succeeded" && !options.refresh) {
      // Publication may have been interrupted after the success receipt was flushed.
      // Republish only the exact signed acquisition; never change nodes or refresh evidence.
      const saved = (last.evidence as any).registration as Registration;
      if (!saved || digest(saved) !== (last.evidence as any).registration_digest) fail("UI_WRITE_MANUAL_RECONCILIATION_REQUIRED");
      const manifest = materialize(options.project, saved, false), path = uiReadManifestPath(input.module_id);
      if (!same(saved.input, input) || !same(saved.context, context)) fail("UI_WRITE_CONTEXT_DENIED");
      const temp = safe(options.project, `${path}.tmp-${randomUUID()}`);
      durableExclusive(temp, manifest); renameSync(temp, safe(options.project, path));
      return { status: "registered" as const, path, manifest, gate_eligible: false as const };
    }
    const check = liveGuard(options, input, st, context);
    const readGeneration = randomUUID(), snapshots: SnapshotRef[] = [];
    async function acquire(invocation: ReturnType<typeof reconcileCall>, role: SnapshotRef["role"], pageId: string | null) {
      check(); const policy = { ...structuredClone(options.policy), grants: [invocation], read_generation: readGeneration };
      const broker = createCoreMcpReadOnly({ ...options, policy, currentContext: check });
      const result = await broker.call({ schema: "aidlc.mcp-read-request/v1", ...context, ...invocation, request_id: randomUUID(), expires_at: new Date(Date.now() + 60_000).toISOString(),
        instance_id: policy.instance_id, project_lock_digest: policy.project_lock_digest, connection: policy.connection, connection_digest: policy.connection_digest });
      snapshots.push({ role, page_id: pageId, path: relative(options.project, result.snapshot_path).replace(/\\/g, "/"), digest: result.snapshot_digest });
      return readMcpSnapshot(result.snapshot_path, { project: options.project, project_id: context.project_id, project_lock_digest: policy.project_lock_digest, snapshot_digest: result.snapshot_digest }).result;
    }
    const pages = readback(await acquire(reconcileCall(input, st), "reconcile", null), input);
    for (const page of pages) await acquire(screenshotCall(input, st, page) as any, "screenshot", page.page_id);
    const reg: Registration = { schema: "aidlc.ui-create-registration/v1", input, policy_digest: st.policy_digest, context, snapshots, read_generation: readGeneration, fixture: true };
    const manifest = materialize(options.project, reg, true); check();
    if (last.status === "succeeded" && !same((last.evidence as any).pages, pages)) fail("UI_WRITE_OWNERSHIP_CHANGED");
    journal.append(events, "succeeded", { registration_digest: digest(reg), registration: reg, pages });
    const path = uiReadManifestPath(input.module_id), output = safe(options.project, path), temp = safe(options.project, `${path}.tmp-${randomUUID()}`);
    check(); durableExclusive(temp, manifest); renameSync(temp, output);
    return { status: "registered" as const, path, manifest, gate_eligible: false as const };
  } catch (error) { return rejection(error); }
}

export function verifyCreatedUiManifest(project: string, moduleId: string, raw?: unknown): string[] {
  const manifest = (raw ?? json(project, uiReadManifestPath(moduleId))) as any, reg = manifest?.create_registration as Registration;
  if (!reg || reg.input.module_id !== moduleId) fail("UI_WRITE_REGISTRATION_REQUIRED");
  const st = preflight(project, reg.input), events = openOperationJournal(project, reg.input.choice.payload.operation_id, binding(reg.input, st), st.selection.journal_public_key_pem).read();
  const last = events.at(-1);
  if (last?.status !== "succeeded" || (last.evidence as any)?.registration_digest !== digest(reg)
    || !same(materialize(project, reg, false), manifest)) fail("UI_WRITE_MANIFEST_TAMPERED");
  return [...events.map(e => `.aidlc/operations/${e.operation_id}/${String(e.sequence).padStart(6, "0")}.json`), ...reg.snapshots.map(s => s.path), ...manifest.pages.map((p: any) => p.screenshot)];
}
