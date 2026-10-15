/** Core-only dispatch for explicitly authorized, reviewed host adapters.
 * This is not the restricted-v1 runner and grants it no new permissions.
 * A host adapter executes code with the operator's privileges. Locking is integrity,
 * not sandboxing: callers must explicitly authorize the selected instance.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readLockedProviderFile, verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { canonicalProviderJson, readProjectProviders, requireEnabledProviderCapability, sha256FileDigest, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { localProviderArtifactSigner } from "./aidlc-provider-evidence.js";
import { decodeMcpPng } from "./aidlc-mcp-image.js";

function fail(code: string): never { throw new Error(code); }
export function safeVisualPath(project: string, value: string): string {
  const root = realpathSync(resolve(project)), path = resolve(root, value), rel = relative(root, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail("VISUAL_PATH_DENIED: path must stay inside the project root");
  for (let p = path; ; p = dirname(p)) {
    if (existsSync(p)) { const s = lstatSync(p); if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) fail("VISUAL_PATH_DENIED"); }
    if (p === root) break;
  }
  return path;
}
export type VisualInputs = Record<string, string>;
/** Include generation provenance closure when declared; all paths remain project-local.
 * The entire sidecar is also hashed, including configuration summaries and source refs.
 */
export function bindVisualInputs(project: string, paths: string[]): VisualInputs {
  const result: VisualInputs = {};
  const add = (value: string) => {
    const p = safeVisualPath(project, value), key = relative(resolve(project), p).replace(/\\/g, "/");
    if (Object.hasOwn(result, key)) return;
    if (Object.keys(result).length >= 512) fail("VISUAL_INPUT_LIMIT");
    if (!existsSync(p) || !lstatSync(p).isFile() || lstatSync(p).size > 8 * 1024 * 1024) fail("VISUAL_INPUT_INVALID");
    result[key] = sha256FileDigest(readFileSync(p));
    if (p.endsWith(".json")) {
      const json = JSON.parse(readFileSync(p, "utf8"));
      const visit = (v: unknown, closure = false, cwd = project) => {
        if (Array.isArray(v)) { for (const item of v) visit(item, closure, cwd); return; }
        if (!v || typeof v !== "object") return;
        const declaredCwd = (v as Record<string, unknown>).cwd;
        if (closure && typeof declaredCwd === "string") cwd = safeVisualPath(project, declaredCwd);
        for (const [k, item] of Object.entries(v)) {
          if (closure && ["source_refs", "outputs"].includes(k) && Array.isArray(item)) { for (const path of item) { if (typeof path !== "string") fail("VISUAL_CLOSURE_INVALID"); add(path); } }
          else if (closure && k === "command_argv" && Array.isArray(item)) {
            for (const arg of item.slice(1)) if (typeof arg === "string" && !arg.startsWith("-")) {
              const path = safeVisualPath(project, resolve(cwd, arg));
              if (existsSync(path) && lstatSync(path).isFile()) add(path);
            }
          }
          else if (closure && ["path", "source_path", "output_path"].includes(k) && typeof item === "string") add(item);
          else visit(item, closure || /generation|provenance/i.test(k), cwd);
        }
      };
      visit(json);
    }
  };
  for (const path of paths) add(path);
  return result;
}
function same(a: unknown, b: unknown): boolean { return canonicalProviderJson(a) === canonicalProviderJson(b); }
export interface VisualDispatchOptions {
  project: string;
  /** Explicit operator authorization. Never infer from enabled manifest or a Provider request. */
  instance?: string;
  browser?: string;
  context: { project_id: string; stage: string; scope: string; module_id?: string; unit_id?: string };
  operation: "preview" | "render";
  svg: string;
  contract: unknown;
  viewports: Record<"normal" | "fit" | "zoom", { width: number; height: number }>;
  inputs: VisualInputs;
  currentContext?: () => VisualDispatchOptions["context"];
}
export function createVisualRequest(options: VisualDispatchOptions) {
  if (!options.instance) fail("NEEDS_CAPABILITY: explicit --host-provider authorization required");
  let available: ReturnType<typeof requireEnabledProviderCapability>;
  try { available = requireEnabledProviderCapability(options.project, "diagram.visual", options.context, { protectedGate: true }); }
  catch (error) {
    if (/PROVIDER_(?:CONFIG_MISSING|CAPABILITY_MISSING|LOCK_MISSING|SOURCE_UNAVAILABLE)/.test(String(error))) fail("NEEDS_CAPABILITY: selected visual Provider is absent disabled or not cached");
    throw error;
  }
  const selected = available.find(x => x.intent.instance_id === options.instance);
  if (!selected) fail("NEEDS_CAPABILITY: selected visual Provider is absent or disabled");
  const verified = verifyLockedProviderCache(options.project, selected.lock);
  const extension = verified.manifest.extensions?.["aidlc.visual"] as Record<string, unknown> | undefined;
  if (!extension || extension.schema !== "aidlc.visual-host/v1" || extension.version !== verified.manifest.version || extension.execution !== "explicit-trusted-host"
    || extension.measurement !== "svg-dom-v1" || !same(extension.views, ["normal", "fit", "zoom"]) || !same(extension.operations, ["preview", "render"])) fail("NEEDS_CAPABILITY: incompatible visual host adapter");
  const lockDigest = readProjectProviders(options.project).lock.lock_digest;
  const binding = JSON.parse(JSON.stringify({ ...options.context, invocation: randomUUID(), instance: options.instance, lock_digest: lockDigest, provider: sha256ProviderDigest(selected.lock), inputs: options.inputs }));
  const request = { schema: "aidlc.visual-request/v1", operation: options.operation, binding, svg: options.svg, contract: options.contract, viewports: options.viewports, ...(options.browser ? { browser: options.browser } : {}) };
  return { request, selected, lockDigest, entrypoint: verified.manifest.entrypoint.path };
}
export function validateVisualCandidate(request: ReturnType<typeof createVisualRequest>["request"], candidate: any, started: number) {
  if (!candidate || candidate.schema !== "aidlc.visual-candidate/v1" || !same(candidate.binding, request.binding)
    || candidate.request_digest !== sha256FileDigest(JSON.stringify(request)) || Object.keys(candidate).sort().join() !== "binding,request_digest,schema,views"
    || !candidate.views || Object.keys(candidate.views).sort().join() !== "fit,normal,zoom") fail("VISUAL_CANDIDATE_INVALID");
  const views = {} as Record<"normal" | "fit" | "zoom", { measurement: unknown; png: Buffer; snapshot: string; console: unknown[]; snapshot_digest: string; screenshot_digest: string; measurement_digest: string }>;
  for (const name of ["normal", "fit", "zoom"] as const) {
    const v = candidate.views[name];
    if (!v || v.source !== "svg-dom-v1" || !same(v.viewport, request.viewports[name]) || !v.measurement || !same(v.measurement.viewport, v.viewport)
      || typeof v.snapshot !== "string" || v.snapshot.length < 3 || v.snapshot.length > 4*1024*1024 || !Array.isArray(v.console) || v.console.length > 200
      || typeof v.captured_at !== "string" || Date.parse(v.captured_at) < started || Date.parse(v.captured_at) > Date.now() || !Number.isFinite(Date.parse(v.captured_at))) fail("VISUAL_VIEW_INVALID");
    const png = decodeMcpPng({ type: "image", mimeType: "image/png", data: v.screenshot });
    if (png.readUInt32BE(16) < v.viewport.width || png.readUInt32BE(20) < v.viewport.height
      || sha256FileDigest(png) !== v.screenshot_digest || sha256FileDigest(v.snapshot) !== v.snapshot_digest
      || sha256FileDigest(JSON.stringify(v.measurement)) !== v.measurement_digest) fail("VISUAL_VIEW_DIGEST_INVALID");
    views[name] = { measurement: v.measurement, png, snapshot: v.snapshot, console: v.console, snapshot_digest: v.snapshot_digest, screenshot_digest: v.screenshot_digest, measurement_digest: v.measurement_digest };
  }
  return views;
}

/** Seal the complete Core decision; the adapter never receives this signer. */
export function sealVisualEvidence<T extends Record<string, unknown>>(project: string, evidence: T) {
  const signer = localProviderArtifactSigner(project, true);
  const { visual_seal: previous, ...payload } = evidence;
  const digest = sha256ProviderDigest(payload);
  return { ...evidence, visual_seal: { schema: "aidlc.visual-seal/v1", digest, algorithm: signer.algorithm, key_id: signer.keyId, value: signer.sign(digest) } };
}
export function verifyVisualEvidence(project: string, evidence: Record<string, any>, expectedContext?: { project_id: string; stage: string; scope: string }): void {
  const { visual_seal: seal, ...payload } = evidence;
  if (!seal || seal.schema !== "aidlc.visual-seal/v1" || sha256ProviderDigest(payload) !== seal.digest || !localProviderArtifactSigner(project).verify(seal.digest, seal)) fail("VISUAL_EVIDENCE_TAMPERED");
  const results = evidence.provider_validation?.results;
  if (!Array.isArray(results) || !results.length) fail("VISUAL_EVIDENCE_INCOMPLETE");
  const invocations = new Map<string, Set<string>>();
  for (const r of results) {
    const binding = r.acquisition?.binding;
    if (expectedContext && Object.entries(expectedContext).some(([k,v]) => binding?.[k] !== v)) fail("VISUAL_CONTEXT_STALE");
    if (!binding || binding.lock_digest !== readProjectProviders(project).lock.lock_digest || !same(bindVisualInputs(project, Object.keys(binding.inputs)), binding.inputs)) fail("VISUAL_EVIDENCE_STALE");
    const selected = requireEnabledProviderCapability(project, "diagram.visual", binding, { protectedGate: true }).find(x => x.intent.instance_id === binding.instance);
    if (!selected || sha256ProviderDigest(selected.lock) !== binding.provider) fail("VISUAL_PROVIDER_DRIFT");
    verifyLockedProviderCache(project, selected.lock);
    if (r.status !== "passed" || !Array.isArray(r.errors) || r.errors.length || !["normal", "fit", "zoom"].includes(r.reading_view)) fail("VISUAL_EVIDENCE_FAILED");
    const key = `${r.diagram_id}:${binding.invocation}`, views = invocations.get(key) ?? new Set<string>();
    if (views.has(r.reading_view)) fail("VISUAL_EVIDENCE_DUPLICATE");
    views.add(r.reading_view); invocations.set(key, views);
    for (const [path, digest] of [[r.screenshot_path, r.screenshot_digest], [r.snapshot_path, r.snapshot_digest]]) {
      if (typeof path !== "string" || sha256FileDigest(readFileSync(safeVisualPath(project, path))) !== digest) fail("VISUAL_ARTIFACT_TAMPERED");
    }
    if (sha256FileDigest(JSON.stringify(r.inspection)) !== r.measurement_digest) fail("VISUAL_MEASUREMENT_TAMPERED");
  }
  if ([...invocations.values()].some(v => v.size !== 3)) fail("VISUAL_EVIDENCE_INCOMPLETE");
}
export function dispatchVisual(options: VisualDispatchOptions) {
  const { request, selected, lockDigest, entrypoint: providerEntry } = createVisualRequest(options);
  const code = readLockedProviderFile(options.project, selected.lock, providerEntry);
  if (sha256FileDigest(code) !== selected.lock.artifacts.entrypoint_digests[providerEntry]) fail("VISUAL_ENTRYPOINT_DRIFT");
  const root = mkdtempSync(join(tmpdir(), "aidlc-visual-host-"));
  const started = Date.now();
  try {
    const entrypoint = join(root, "host.mjs"); writeFileSync(entrypoint, code, { flag: "wx", mode: 0o600 });
    // No inherited tokens, NODE_OPTIONS or browser endpoint. The selected
    // executable is reviewed host code; never label it a restricted-v1 execution.
    const env: NodeJS.ProcessEnv = { TEMP: root, TMP: root };
    // Windows Chrome needs OS known-folder identity to distinguish its default
    // profile from --user-data-dir. These are path variables, never credentials.
    for (const key of ["SystemRoot", "WINDIR", "SystemDrive", "ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA", "USERPROFILE"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const p = spawnSync(process.execPath, [entrypoint], { cwd: root, env, input: JSON.stringify(request), encoding: "utf8", shell: false, windowsHide: true, timeout: 90_000, maxBuffer: 24*1024*1024 });
    if (p.error || p.status !== 0) {
      const diagnostic = p.stderr?.trim();
      const capabilityDiagnostics = ["NEEDS_CAPABILITY: installed browser executable missing", "NEEDS_CAPABILITY: isolated browser start failed", "NEEDS_CAPABILITY: isolated browser startup timeout", "NEEDS_CAPABILITY: node websocket unavailable"];
      const code = /^VISUAL_[A-Z_]+$/.test(diagnostic) || capabilityDiagnostics.includes(diagnostic) ? diagnostic : "NEEDS_CAPABILITY: visual host failed or browser unavailable";
      fail(code); // Never echo arbitrary stderr which could contain credentials.
    }
    const candidate = JSON.parse(p.stdout), views = validateVisualCandidate(request, candidate, started);
    if (options.currentContext && !same(JSON.parse(JSON.stringify(options.currentContext())), JSON.parse(JSON.stringify(options.context)))) fail("VISUAL_CONTEXT_STALE");
    if (readProjectProviders(options.project).lock.lock_digest !== lockDigest || !same(bindVisualInputs(options.project, Object.keys(options.inputs)), options.inputs)) fail("VISUAL_BINDING_DRIFT");
    requireEnabledProviderCapability(options.project, "diagram.visual", options.context, { protectedGate: true });
    verifyLockedProviderCache(options.project, selected.lock);
    const payload = { schema: "aidlc.visual-acquisition/v1", binding: request.binding, request_digest: candidate.request_digest, candidate_digest: sha256ProviderDigest(candidate), acquired_at: new Date().toISOString() };
    const signer = localProviderArtifactSigner(options.project, true);
    return { views, receipt: { ...payload, signature: { key_id: signer.keyId, value: signer.sign(canonicalProviderJson(payload)) } } };
  } finally {
    // This unique directory was created by this invocation and contains only its own data.
    rmSync(root, { recursive: true, force: true });
  }
}
