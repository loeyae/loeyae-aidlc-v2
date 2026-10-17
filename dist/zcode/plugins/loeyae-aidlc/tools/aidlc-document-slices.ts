import { captureModulePublication, publishScope } from "./aidlc-session";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, fsyncSync, linkSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { hostname } from "os";
import { parseDocument } from "./aidlc-document-parser";
import { readUnitManifest } from "./aidlc-execution-context";
import { qualityBase, qualityPath, qualityInput, qualityHash, type QualityContext, type QualityInput } from "./aidlc-quality-gates";
import { loadWorkflowView } from "./aidlc-workflow-layout";

export const SLICE_SENSOR = "document-slice-consistency";
export interface SliceContext extends QualityContext { slices_version?: string; units_executed?: boolean }
interface View {
  unit_id: string | null; unit_descriptor_sha256?: string;
  requirements: string[]; stories: string[]; acs: string[]; files: QualityInput[];
  inherited?: QualityInput[];
  inherited_membership?: { requirements: string[]; stories: string[]; acs: string[] };
}
interface SliceManifest {
  schema_version: 1; generator_version: "1"; workflow_id: string; module_id: string | null; scope: string;
  inputs: QualityInput[]; coverage: { requirements: string[]; stories: string[]; acs: { id: string; owner: string }[] };
  views: View[]; index: QualityInput;
}
const sorted = (values: string[]) => [...new Set(values)].sort();
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const identity = (ctx: SliceContext) => ({ schema_version: 1, generator_version: "1", workflow_id: ctx.workflow_id, module_id: ctx.module_id || null, scope: ctx.scope });
export function sliceBase(ctx: SliceContext): string { return `${qualityBase(ctx)}/document-slices`; }
function read(ctx: SliceContext, path: string): string {
  qualityInput(ctx, path); const bytes = readFileSync(qualityPath(ctx, path)), body = bytes.toString("utf8");
  if (!Buffer.from(body, "utf8").equals(bytes)) throw new Error(`SLICE_ENCODING: UTF-8 required ${path}`);
  return body;
}
function present(ctx: SliceContext, path: string): boolean { return existsSync(qualityPath(ctx, path)); }
function decode(ctx: SliceContext, path: string): Record<string, unknown> { return JSON.parse(read(ctx, path)); }
export function sliceAdoption(ctx: SliceContext): { enabled: boolean; basis: string } {
  const base = sliceBase(ctx), adoption = `${base}/adoption.json`, manifest = `${base}/manifest.json`;
  if (ctx.slices_version && ctx.slices_version !== "1") throw new Error("SLICE_INVALID_ADOPTION: version");
  const hasAdoption = present(ctx, adoption), hasManifest = present(ctx, manifest);
  if (hasAdoption) {
    const record = decode(ctx, adoption);
    if (Object.entries(identity(ctx)).some(([k, v]) => record[k] !== v) || record.status !== "adopted") throw new Error("SLICE_INVALID_ADOPTION: identity/status");
  }
  // Existing artifacts cannot be demoted to not-applicable by changing scope/count.
  if (hasManifest || hasAdoption) return { enabled: true, basis: "explicit-adoption" };
  if (!ctx.slices_version || !["feature", "enterprise", "mvp", "classic"].includes(ctx.scope) || !ctx.units_executed) return { enabled: false, basis: "legacy-or-no-unit-generation" };
  if (!ctx.module_id) throw new Error("SLICE_SCOPE: module required");
  const units = readUnitManifest(ctx.root, ctx.module_id);
  if (units.length < 2) return { enabled: false, basis: "single-unit" };
  return { enabled: true, basis: "multi-unit-v1" };
}
function projection(ctx: SliceContext): { manifest: SliceManifest; objects: Map<string, string> } {
  if (!ctx.module_id) throw new Error("SLICE_SCOPE: module required");
  const base = qualityBase(ctx), own = sliceBase(ctx);
  const paths = [`${base}/requirements.md`, `${base}/user-stories.md`, `${base}/unit-manifest.json`, `${base}/application-design/unit-of-work-story-map.md`];
  const inputs = paths.map(p => qualityInput(ctx, p));
  const reqs = parseDocument(read(ctx, paths[0]), "requirements"), stories = parseDocument(read(ctx, paths[1]), "stories");
  const requirements = reqs.entries, storyEntries = stories.entries.filter(e => e.kind === "story"), acs = stories.entries.filter(e => e.kind === "ac");
  if (!requirements.length || !storyEntries.length) throw new Error("SLICE_COVERAGE: canonical definitions missing");
  const units = readUnitManifest(ctx.root, ctx.module_id);
  if (!units.length) throw new Error("SLICE_COVERAGE: units missing");
  const blocks = [...read(ctx, paths[3]).matchAll(/^```aidlc-story-map\s*\r?\n([\s\S]*?)\r?\n```\s*$/gm)];
  if (blocks.length !== 1) throw new Error("SLICE_MAPPING: one approved aidlc-story-map block required");
  const map = JSON.parse(blocks[0][1]) as { schema_version: number; status: string; approved_by: string; mappings: { story_id: string; unit_ids: string[] }[]; shared_req_refs: string[] };
  if (map.schema_version !== 1 || map.status !== "approved" || typeof map.approved_by !== "string" || !map.approved_by.trim() || !Array.isArray(map.mappings) || !Array.isArray(map.shared_req_refs)) throw new Error("SLICE_MAPPING: invalid approval contract");
  const reqIds = requirements.map(e => e.id), storyIds = storyEntries.map(e => e.id), unitIds = units.map(u => u.unit_id);
  const owners = new Map<string, string[]>();
  for (const mapping of map.mappings) {
    if (!storyIds.includes(mapping.story_id) || owners.has(mapping.story_id) || !Array.isArray(mapping.unit_ids) || !mapping.unit_ids.length || mapping.unit_ids.some(u => !unitIds.includes(u)) || sorted(mapping.unit_ids).length !== mapping.unit_ids.length) throw new Error(`SLICE_MAPPING: ambiguous/dangling ${mapping.story_id}`);
    owners.set(mapping.story_id, sorted(mapping.unit_ids));
  }
  if (storyIds.some(id => !owners.has(id)) || map.shared_req_refs.some(id => !reqIds.includes(id)) || sorted(map.shared_req_refs).length !== map.shared_req_refs.length) throw new Error("SLICE_COVERAGE: unmapped story/shared requirement");
  for (const story of storyEntries) if (!story.req_refs.length || story.req_refs.some(id => !reqIds.includes(id))) throw new Error(`SLICE_SOURCE: ${story.id}`);
  const consumers = new Map(reqIds.map(id => [id, map.shared_req_refs.includes(id) ? [...unitIds] : sorted(storyEntries.filter(s => s.req_refs.includes(id)).flatMap(s => owners.get(s.id)!))]));
  if (reqIds.some(id => !consumers.get(id)!.length)) throw new Error("SLICE_COVERAGE: requirement has no consumer or shared declaration");
  for (const unit of units) {
    const expected = sorted(reqIds.filter(id => consumers.get(id)!.includes(unit.unit_id)));
    if (JSON.stringify(sorted(unit.req_refs || [])) !== JSON.stringify(expected)) throw new Error(`SLICE_REQ_RECONCILIATION: ${unit.unit_id}`);
  }
  const objects = new Map<string, string>();
  const object = (body: string): QualityInput => {
    const sha256 = qualityHash(body), path = `${own}/objects/${sha256}.md`;
    objects.set(path, body); return { path, sha256 };
  };
  const sharedReqs = reqIds.filter(id => consumers.get(id)!.length > 1 || map.shared_req_refs.includes(id));
  const sharedStories = storyIds.filter(id => owners.get(id)!.length > 1);
  const view = (unit: string | null): View => {
    const r = unit === null ? sharedReqs : reqIds.filter(id => consumers.get(id)!.includes(unit) && !sharedReqs.includes(id));
    const s = unit === null ? sharedStories : storyIds.filter(id => owners.get(id)!.includes(unit) && !sharedStories.includes(id));
    const a = acs.filter(ac => s.includes(ac.owner!)).map(ac => ac.id);
    const reqText = (unit === null ? reqs.preamble : "") + requirements.filter(e => r.includes(e.id)).map(e => e.text).join("");
    const storyText = (unit === null ? stories.preamble : "") + storyEntries.filter(e => s.includes(e.id)).map(e => e.text).join("");
    const inherited = unit === null ? undefined : [
      object(reqs.preamble + requirements.filter(e => sharedReqs.includes(e.id) && consumers.get(e.id)!.includes(unit)).map(e => e.text).join("")),
      object(stories.preamble + storyEntries.filter(e => sharedStories.includes(e.id) && owners.get(e.id)!.includes(unit)).map(e => e.text).join("")),
    ];
    return { unit_id: unit, requirements: sorted(r), stories: sorted(s), acs: sorted(a), files: [object(reqText), object(storyText)], ...(inherited ? {
      inherited,
      unit_descriptor_sha256: qualityHash(JSON.stringify(units.find(u => u.unit_id === unit))),
      inherited_membership: {
        requirements: sorted(sharedReqs.filter(id => consumers.get(id)!.includes(unit!))),
        stories: sorted(sharedStories.filter(id => owners.get(id)!.includes(unit!))),
        acs: sorted(acs.filter(ac => sharedStories.includes(ac.owner!) && owners.get(ac.owner!)!.includes(unit!)).map(ac => ac.id)),
      },
    } : {}) };
  };
  const views = [view(null), ...sorted(unitIds).map(view)];
  const index = object(`# Derived document views\n\nCanonical: ${paths[0]}, ${paths[1]}\n\n` + views.map(v => `- ${v.unit_id || "shared"}: ${v.files.map(f => f.path).join(", ")}\n`).join(""));
  return { manifest: { ...identity(ctx), schema_version: 1, generator_version: "1", inputs, coverage: { requirements: sorted(reqIds), stories: sorted(storyIds), acs: acs.map(a => ({ id: a.id, owner: a.owner! })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }, views, index }, objects };
}
function atomic(ctx: SliceContext, path: string, body: string | Buffer, exclusive = false): void {
  const target = qualityPath(ctx, path); mkdirSync(dirname(target), { recursive: true });
  const temp = qualityPath(ctx, `${path}.${randomUUID()}.tmp`); let fd: number | undefined, created = false;
  try {
    fd = openSync(temp, "wx"); created = true; writeFileSync(fd, body, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined;
    // A hard link publishes all bytes atomically and cannot overwrite an authority.
    if (exclusive) linkSync(temp, target); else renameSync(temp, target);
  }
  finally { if (fd !== undefined) closeSync(fd); if (created && existsSync(temp)) unlinkSync(temp); }
}
export function generateSlices(ctx: SliceContext): Record<string, unknown> {
  const publication = captureModulePublication(ctx.root, ctx.module_id!);
  if (publication && publication.binding.workflow_id !== ctx.workflow_id) throw new Error("slice workflow identity conflicts with session binding");
  const base = sliceBase(ctx), lock = qualityPath(ctx, `${base}/writer.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  const fd = openSync(lock, "wx");
  try {
    writeFileSync(fd, json({ schema_version: 1, pid: process.pid, hostname: hostname() }));
    // Validate every source and target before publishing any adoption/manifest.
    const { manifest, objects } = projection(ctx);
    const adoption = `${base}/adoption.json`, manifestPath = `${base}/manifest.json`;
    if (present(ctx, adoption)) sliceAdoption(ctx);
    let old: SliceManifest | undefined;
    if (present(ctx, manifestPath)) {
      old = decode(ctx, manifestPath) as unknown as SliceManifest;
      if (Object.entries(identity(ctx)).some(([k, v]) => (old as unknown as Record<string, unknown>)[k] !== v) || !Array.isArray(old.views)) throw new Error("SLICE_MANIFEST_INVALID: recover explicitly");
    }
    return publishScope(ctx.root, publication, () => {
      atomic(ctx, adoption, json({ ...identity(ctx), status: "adopted" }));
      for (const [path, body] of objects) {
        if (present(ctx, path)) { if (read(ctx, path) !== body) throw new Error(`SLICE_OBJECT_TAMPERED: ${path}`); }
        else atomic(ctx, path, body);
      }
      const affected = sorted([...(old?.views || []).map(v => v.unit_id), ...manifest.views.map(v => v.unit_id)].filter((id): id is string => id !== null).filter(id => JSON.stringify(old?.views.find(v => v.unit_id === id)) !== JSON.stringify(manifest.views.find(v => v.unit_id === id))));
      for (const input of manifest.inputs) if (qualityInput(ctx, input.path).sha256 !== input.sha256) throw new Error(`SLICE_SOURCE_CHANGED_DURING_GENERATION: ${input.path}`);
      atomic(ctx, manifestPath, json(manifest));
      return { status: "generated", affected_units: affected, invalidation_reasons: !old ? ["initial-generation"] : manifest.inputs.filter(i => !old!.inputs.some(o => o.path === i.path && o.sha256 === i.sha256)).map(i => i.path), manifest: manifestPath };
    });
  } finally { closeSync(fd); unlinkSync(lock); }
}
export function checkSlices(ctx: SliceContext): Record<string, unknown> {
  const adoption = sliceAdoption(ctx);
  if (!adoption.enabled) {
    // A legacy rename must never be mistaken for an empty/unselected document.
    for (const [canonical, legacy] of [["requirements.md", "requirements.full.md"], ["user-stories.md", "stories.full.md"], ["user-stories.md", "user-stories.full.md"]]) if (!present(ctx, `${qualityBase(ctx)}/${canonical}`) && present(ctx, `${qualityBase(ctx)}/${legacy}`)) throw new Error(`SLICE_CANONICAL_MISSING: restore ${canonical} explicitly`);
    return { sensor: SLICE_SENSOR, status: "not_applicable", applicable: false, applicability_basis: adoption.basis, inputs: [] };
  }
  const { manifest, objects } = projection(ctx), path = `${sliceBase(ctx)}/manifest.json`;
  if (json(decode(ctx, path)) !== json(manifest)) throw new Error("SLICE_MANIFEST_STALE: regenerate from canonical sources and approved mapping");
  for (const [path, body] of objects) if (read(ctx, path) !== body) throw new Error(`SLICE_PROJECTION_DRIFT: ${path}`);
  const inputs = [...manifest.inputs, qualityInput(ctx, `${sliceBase(ctx)}/adoption.json`), qualityInput(ctx, path), ...[...objects.keys()].map(p => qualityInput(ctx, p))];
  return { sensor: SLICE_SENSOR, status: "passed", applicable: true, ...identity(ctx), inputs, coverage: manifest.coverage };
}
export function sliceEvidenceErrors(ctx: SliceContext, evidence: Record<string, unknown>): string[] {
  try {
    const expected = checkSlices(ctx);
    return ["sensor", "status", "applicable", "workflow_id", "module_id", "scope", "schema_version", "generator_version", "inputs", "coverage", "applicability_basis"].filter(k => JSON.stringify(expected[k]) !== JSON.stringify(evidence[k])).map(k => `SLICE_EVIDENCE_STALE: ${k}`);
  } catch (error) { return [String(error)]; }
}
export interface BusinessDocumentLoadPlan { mode: "derived" | "canonical"; files: QualityInput[]; bytes: number; estimated_tokens: number; measurement: "utf8-bytes-and-ceil-bytes-divided-by-four" }
export function buildBusinessDocumentLoadPlan(ctx: SliceContext, unitId: string): BusinessDocumentLoadPlan {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(unitId)) throw new Error("SLICE_SCOPE: invalid unit");
  const adopted = sliceAdoption(ctx).enabled;
  let files: QualityInput[];
  if (adopted) {
    checkSlices(ctx);
    const manifest = decode(ctx, `${sliceBase(ctx)}/manifest.json`) as unknown as SliceManifest;
    const unit = manifest.views.find(v => v.unit_id === unitId);
    if (!unit) throw new Error(`SLICE_SCOPE: unknown unit ${unitId}`);
    files = [...unit.inherited!, ...unit.files];
  } else {
    checkSlices(ctx);
    files = ["requirements.md", "user-stories.md"].map(n => qualityInput(ctx, `${qualityBase(ctx)}/${n}`));
  }
  for (const path of ["docs/aidlc/product/contracts.md", "docs/aidlc/ideation/product-contracts.md", `${qualityBase(ctx)}/application-design/shared-interfaces.md`]) if (present(ctx, path)) files.push(qualityInput(ctx, path));
  files = [...new Map(files.map(f => [f.path, f])).values()];
  const bytes = files.reduce((sum, f) => sum + readFileSync(qualityPath(ctx, f.path)).byteLength, 0);
  return { mode: adopted ? "derived" : "canonical", files, bytes, estimated_tokens: Math.ceil(bytes / 4), measurement: "utf8-bytes-and-ceil-bytes-divided-by-four" };
}
function recoverCanonicalUnlocked(ctx: SliceContext, apply: boolean): Record<string, unknown> {
  const base = qualityBase(ctx), actions: { source: string; target: string }[] = [], conflicts: string[] = [];
  const lockPath = `${sliceBase(ctx)}/writer.lock`;
  let staleLock = false;
  if (present(ctx, lockPath)) {
    try {
      const lock = decode(ctx, lockPath);
      if (lock.schema_version !== 1 || lock.hostname !== hostname() || !Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0) throw new Error("unknown lock owner");
      try { process.kill(Number(lock.pid), 0); conflicts.push(lockPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") staleLock = true; else conflicts.push(lockPath); }
    } catch { conflicts.push(lockPath); }
  }
  for (const [canonical, legacy] of [["requirements.md", "requirements.full.md"], ["user-stories.md", "user-stories.full.md"], ["user-stories.md", "stories.full.md"], ["user-stories.md", "stories.md"]]) {
    const source = `${base}/${legacy}`, target = `${base}/${canonical}`;
    if (!present(ctx, source)) continue;
    const current = present(ctx, target) ? read(ctx, target) : undefined;
    const previous = actions.find(a => a.target === target);
    if (current !== undefined && current !== read(ctx, source) || previous && read(ctx, previous.source) !== read(ctx, source)) conflicts.push(target);
    else if (current === undefined && !previous) actions.push({ source, target });
  }
  if (apply && conflicts.length) throw new Error(`SLICE_RECOVERY_CONFLICT: ${sorted(conflicts).join(", ")}`);
  if (apply && staleLock) unlinkSync(qualityPath(ctx, lockPath));
  if (apply) {
    const prepared = actions.map(action => ({ ...action, bytes: readFileSync(qualityPath(ctx, action.source)) }));
    for (const action of prepared) atomic(ctx, action.target, action.bytes, true);
  }
  return { status: conflicts.length ? "conflict" : apply ? "restored-revalidation-required" : "dry-run", actions, stale_writer_lock: staleLock ? lockPath : null, conflicts: sorted(conflicts), revalidate: ["canonical input locks", "upstream evidence", "UI freshness", "traceability", "delivery/development admission"] };
}
export function recoverCanonical(ctx: SliceContext, apply = false): Record<string, unknown> {
  const recoveryPath = `${sliceBase(ctx)}/recovery.lock`;
  const recoveryOwner = (): Record<string, unknown> | null => {
    if (!present(ctx, recoveryPath)) return null;
    let record: Record<string, unknown> = {}, status = "unknown";
    try {
      record = decode(ctx, recoveryPath);
      if (record.schema_version === 1 && record.hostname === hostname() && Number.isSafeInteger(record.pid) && Number(record.pid) > 0) {
        try { process.kill(Number(record.pid), 0); status = "live"; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") status = "dead"; }
      }
    } catch { /* Preserve fail-closed diagnostics for an interrupted metadata write. */ }
    return { path: recoveryPath, status, owner: record, remediation: "Stop all document-slices generate/recover processes on this host; verify the recorded owner is no longer running; then remove exactly this recovery.lock and retry. Never remove a live or unknown owner's lock without resolving ownership." };
  };
  if (!apply) return { ...recoverCanonicalUnlocked(ctx, false), recovery_lock: recoveryOwner() };
  const publication = captureModulePublication(ctx.root, ctx.module_id!);
  if (publication && publication.binding.workflow_id !== ctx.workflow_id) throw new Error("slice workflow identity conflicts with session binding");
  return publishScope(ctx.root, publication, () => {
    // Serialize the entire stale-owner observation and removal across recoverers.
    // A generator may acquire writer.lock after removal; the next recovery then
    // observes that live owner and can never unlink its replacement lock.
    const lock = qualityPath(ctx, recoveryPath);
    mkdirSync(dirname(lock), { recursive: true });
    let fd: number;
    try { fd = openSync(lock, "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`SLICE_RECOVERY_LOCK_HELD: ${JSON.stringify(recoveryOwner())}`);
      throw error;
    }
    try {
      writeFileSync(fd, json({ schema_version: 1, pid: process.pid, hostname: hostname(), lock_id: randomUUID() })); fsyncSync(fd);
      return recoverCanonicalUnlocked(ctx, true);
    }
    finally { closeSync(fd); unlinkSync(lock); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), module = args[args.indexOf("--module") + 1];
    if (!args.includes("--module") || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(module)) throw new Error("usage: aidlc-document-slices.ts generate|check|plan|recover --module <id> [--unit <id>] [--apply]");
    const state = loadWorkflowView(process.cwd(), module);
    if (!state) throw new Error("workflow state required");
    const ctx: SliceContext = { root: process.cwd(), workflow_id: state.workflow_id, module_id: module, scope: state.scope, stage: state.current_stage || "units-generation", ui_route: "not-selected", slices_version: state.document_slices_version, units_executed: true };
    const result = args[0] === "generate" ? generateSlices(ctx) : args[0] === "check" ? checkSlices(ctx) : args[0] === "plan" ? buildBusinessDocumentLoadPlan(ctx, args[args.indexOf("--unit") + 1]) : args[0] === "recover" ? recoverCanonical(ctx, args.includes("--apply")) : (() => { throw new Error("unknown slices command"); })();
    console.log(json(result));
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
