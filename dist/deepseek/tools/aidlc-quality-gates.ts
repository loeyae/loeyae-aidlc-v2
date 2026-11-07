import { createHash } from "crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, mkdirSync, openSync, closeSync, writeFileSync, renameSync, unlinkSync } from "fs";
import { runSync } from "./aidlc-spawn";
import { resolveSourceRoots } from "./aidlc-source-roots";
import { workflowBaselineForModule } from "./aidlc-baseline";
import { codeRefRepo, nestedSourceRepos } from "./aidlc-nested-repos";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

export const QUALITY_VERSION = "1";
export const QUALITY_SENSORS = new Set([
  "quality-change-impact", "dependency-readiness", "field-capability",
  "story-rule-consistency", "ui-behavior-consistency", "artifact-consistency", "delivery-readiness",
]);
export interface QualityContext {
  root: string; workflow_id: string; module_id?: string; scope: string; stage: string;
  ui_route: string; quality_version?: string; code_baseline?: boolean;
  prd_selected?: boolean; project_workflow_id?: string;
}
export interface QualityInput { path: string; sha256: string }
export interface QualityIssue { code: string; location: string; message: string }
export class QualityBlocked extends Error {
  constructor(public issues: QualityIssue[]) { super(issues.map(i => `${i.code} @ ${i.location}: ${i.message}`).join("; ")); }
}
export function qualityHash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function qualityBase(ctx: QualityContext): string {
  if (ctx.module_id && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(ctx.module_id)) throw new Error("GATE_SCOPE_MISMATCH: invalid module");
  return ctx.module_id ? `docs/aidlc/modules/${ctx.module_id}/inception` : "docs/aidlc/inception";
}
export function qualityPath(ctx: QualityContext, path: string): string {
  const target = resolve(ctx.root, path);
  const rel = relative(resolve(ctx.root), target);
  if (!path || isAbsolute(path) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`GATE_SCOPE_MISMATCH: unsafe input ${path}`);
  const normalized = rel.replace(/\\/g, "/");
  const module = normalized.match(/^docs\/aidlc\/modules\/([^/]+)\//)?.[1];
  if (ctx.module_id && (module && module !== ctx.module_id || /^docs\/aidlc\/(inception|construction)\//.test(normalized))) throw new Error(`GATE_SCOPE_MISMATCH: ${path}`);
  let current = resolve(ctx.root);
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`GATE_SCOPE_MISMATCH: linked input ${path}`);
  }
  if (existsSync(target) && !realpathSync(target).startsWith(realpathSync(ctx.root) + sep)) throw new Error(`GATE_SCOPE_MISMATCH: resolved input ${path}`);
  return target;
}
export function qualityInput(ctx: QualityContext, path: string): QualityInput {
  const target = qualityPath(ctx, path);
  if (!existsSync(target) || !lstatSync(target).isFile()) throw new Error(`GATE_EVIDENCE_MISSING: ${path}`);
  return { path, sha256: qualityHash(readFileSync(target)) };
}
export function qualityAdoption(ctx: QualityContext): { enabled: boolean; basis: string; inputs: QualityInput[] } {
  if (ctx.quality_version) {
    if (ctx.quality_version !== QUALITY_VERSION) throw new Error("GATE_INVALID_EXEMPTION: unsupported quality version");
    return { enabled: true, basis: "new-workflow-v1", inputs: [] };
  }
  const path = `${qualityBase(ctx)}/quality-adoption.json`;
  if (!existsSync(qualityPath(ctx, path))) return { enabled: false, basis: "legacy-not-adopted", inputs: [] };
  const record = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8"));
  if (record.version !== QUALITY_VERSION || record.workflow_id !== ctx.workflow_id && record.workflow_id !== ctx.project_workflow_id || record.module_id !== (ctx.module_id || null) || record.scope !== ctx.scope) throw new Error("GATE_SCOPE_MISMATCH: adoption identity");
  if (record.status !== "adopted" || typeof record.rationale !== "string" || !record.rationale.trim() || !Array.isArray(record.migration_differences) || !Array.isArray(record.evidence_plan) || !record.evidence_plan.length || !record.adopted_by) throw new Error("GATE_INVALID_EXEMPTION: incomplete adoption/migration record");
  return { enabled: true, basis: "explicit-legacy-adoption", inputs: [qualityInput(ctx, path)] };
}
export function qualityIdentity(ctx: QualityContext): Record<string, unknown> {
  const adopted = Boolean(ctx.quality_version || existsSync(qualityPath(ctx, `${qualityBase(ctx)}/quality-adoption.json`)));
  return { quality_version: QUALITY_VERSION, workflow_id: ctx.workflow_id, module_id: ctx.module_id || null, scope: ctx.scope, stage: ctx.stage, ui_route: ctx.ui_route, checker_version: QUALITY_VERSION, configuration_digest: qualityHash("quality-v1:approved-inventory:input-bound-review:24h"), source_roots_digest: adopted ? qualityHash(JSON.stringify(resolveSourceRoots(ctx.root, ctx.module_id).roots)) : "legacy-not-adopted" };
}
export function qualityEvidenceErrors(ctx: QualityContext, sensor: string, evidence: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const adoption = qualityAdoption(ctx);
  if (!adoption.enabled) return evidence.applicable === false && evidence.applicability_basis === adoption.basis ? [] : ["GATE_INVALID_EXEMPTION: legacy adoption diagnostic required"];
  for (const [key, expected] of Object.entries(qualityIdentity(ctx))) if (evidence[key] !== expected) errors.push(`GATE_SCOPE_MISMATCH: ${key}`);
  if (evidence.sensor !== sensor || evidence.status !== "passed" || evidence.applicable !== true) errors.push("GATE_INVALID_EXEMPTION: adopted applicable sensor must pass");
  const inputs = evidence.inputs as QualityInput[] | undefined;
  if (!Array.isArray(inputs) || inputs.length === 0) errors.push("GATE_EVIDENCE_MISSING: input bindings");
  else for (const input of inputs) {
    try { if (qualityInput(ctx, input.path).sha256 !== input.sha256) errors.push(`GATE_EVIDENCE_STALE: ${input.path}${sensor === "ui-behavior-consistency" && /\.html$/.test(input.path) ? " (HTML_REPORT_STALE)" : ""}`); }
    catch (error) { errors.push(String(error)); }
  }
  let req: ReturnType<typeof qualitySection>;
  try { req = qualitySection(ctx, "requirements"); } catch (error) { errors.push(String(error)); return errors; }
  const mandatory = [...req.inputs.map(i => i.path)];
  if (["story-rule-consistency", "artifact-consistency", "delivery-readiness"].includes(sensor)) mandatory.push(`${qualityBase(ctx)}/user-stories.md`);
  if (sensor === "delivery-readiness") mandatory.push(`${qualityBase(ctx)}/cross-validation-report.md`);
  if (sensor === "ui-behavior-consistency" && ["html-mock", "figma-create", "figma-existing"].includes(ctx.ui_route)) mandatory.push(`${qualityBase(ctx)}/ui-design/page-plan.md`, `${qualityBase(ctx)}/user-stories.md`);
  for (const path of mandatory) if (!inputs?.some(i => i.path === path)) errors.push(`GATE_EVIDENCE_MISSING: mandatory binding ${path}`);
  if (evidence.delivery_scope !== req.value.delivery_scope) errors.push("GATE_SCOPE_MISMATCH: delivery scope");
  if (evidence.evidence_version && evidence.stage_instance !== (ctx.module_id ? `${ctx.stage}@module:${ctx.module_id}` : ctx.stage)) errors.push("GATE_SCOPE_MISMATCH: stage instance");
  if (sensor === "quality-change-impact" && evidence.evidence_version) {
    try {
      const checkpoint = checkpointDocument(ctx)?.checkpoints.find(c => c.digest === evidence.quality_checkpoint_digest);
      if (!checkpoint || checkpoint.execution_id !== (evidence.producer as { execution_id?: string } | undefined)?.execution_id || JSON.stringify(checkpoint.snapshots) !== JSON.stringify(evidence.quality_snapshots)) errors.push("CHANGE_EVIDENCE_STALE: producer checkpoint receipt invalid");
      errors.push(...qualityChangeIssues(ctx, req.value).map(i => `${i.code}: ${i.message}`));
    } catch (error) { errors.push(String(error)); }
  }
  if (!Array.isArray(evidence.issues) || evidence.issues.length) errors.push("DELIVERY_GATE_NOT_READY: unresolved findings");
  return errors;
}

export function qualityLegacyResult(ctx: QualityContext, sensor: string): Record<string, unknown> | null {
  const adoption = qualityAdoption(ctx);
  return adoption.enabled ? null : { ...qualityIdentity(ctx), sensor, status: "passed", applicable: false, applicability_basis: adoption.basis, inputs: [], issues: [] };
}

export interface QualitySnapshot {
  id: string; path: string; sha256: string; ids: string[]; depends_on: string[];
  semantic_sha256?: string;
  content_path?: string;
  rules?: Record<string, string>; fields?: Record<string, string>;
}
export interface QualityChange {
  id: string; kind: "semantic" | "formatting" | "external-fact"; before: QualitySnapshot[];
  after: QualitySnapshot[]; affected: string[]; synchronized: string[]; reverified: string[];
  route: "in-flight" | "cr"; cr_path?: string; cr_id?: string; reverification_review?: string;
}
export interface QualityDocument {
  version: string; delivery_scope: string; inputs: string[];
  artifacts?: QualitySnapshot[]; changes?: QualityChange[];
  [key: string]: unknown;
}
export function qualitySection(ctx: QualityContext, name: string): { value: QualityDocument; inputs: QualityInput[] } {
  const path = `${qualityBase(ctx)}/${name}.md`;
  const input = qualityInput(ctx, path);
  const body = readFileSync(qualityPath(ctx, path), "utf8");
  const blocks = [...body.matchAll(/```aidlc-quality\s*\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) throw new Error(`GATE_EVIDENCE_MISSING: ${path} needs exactly one authoritative aidlc-quality section`);
  const value = JSON.parse(blocks[0][1]) as QualityDocument;
  if (value.version !== QUALITY_VERSION || !value.delivery_scope || !Array.isArray(value.inputs) || value.inputs.some(p => typeof p !== "string")) throw new Error(`GATE_SCOPE_MISMATCH: ${path} contract`);
  return { value, inputs: [input, ...value.inputs.map(p => qualityInput(ctx, p))] };
}
export function qualityChangeIssues(ctx: QualityContext, document: QualityDocument): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const issue = (code: string, location: string, message: string) => issues.push({ code, location, message });
  if (!Array.isArray(document.artifacts) || !Array.isArray(document.changes)) return [{ code: "CHANGE_IMPACT_UNMAPPED", location: "requirements", message: "artifact inventory and explicit changes array required" }];
  for (const artifact of document.artifacts) {
    if (!artifact.id || !artifact.path || !Array.isArray(artifact.ids) || !Array.isArray(artifact.depends_on)) { issue("CHANGE_IMPACT_UNMAPPED", artifact.id, "invalid artifact graph"); continue; }
    try { if (artifact.semantic_sha256 ? qualitySemanticHash(readFileSync(qualityPath(ctx, artifact.path), "utf8")) !== artifact.semantic_sha256 : qualityInput(ctx, artifact.path).sha256 !== artifact.sha256) issue("CHANGE_EVIDENCE_STALE", artifact.id, "current artifact differs from recorded snapshot"); }
    catch (error) { issue("CHANGE_EVIDENCE_STALE", artifact.id, String(error)); }
  }
  for (const change of document.changes) {
    if (!change.id || !["semantic", "formatting", "external-fact"].includes(change.kind) || !Array.isArray(change.before) || !Array.isArray(change.after) || !Array.isArray(change.affected)) { issue("CHANGE_IMPACT_UNMAPPED", change.id, "change must bind before/after IDs and content"); continue; }
    if (ctx.code_baseline && change.kind !== "formatting") {
      if (change.route !== "cr" || !change.cr_path || !change.cr_id) issue("CHANGE_ROUTE_INVALID", change.id, "product semantics on a code baseline require existing CR");
      else try {
        const body = readFileSync(qualityPath(ctx, change.cr_path), "utf8");
        const block = body.match(/```aidlc-cr\s*\r?\n([\s\S]*?)\r?\n```/);
        const cr = block ? JSON.parse(block[1]) : null;
        if (!cr || cr.id !== change.cr_id || cr.status !== "approved" || !cr.approved_by || !cr.approved_at || !["L1", "L2", "L3", "L4", "L5"].includes(cr.risk) || !Array.isArray(cr.consumers) || !Array.isArray(cr.verification) || !cr.verification.length || change.affected.some(id => !cr.consumers.includes(id))) issue("CHANGE_ROUTE_INVALID", change.id, "CR must bind approved risk, actual affected consumers and validation plan");
        if (cr && ["L1", "L2"].includes(cr.risk) && /change-requests\//.test(change.cr_path)) issue("CHANGE_ROUTE_INVALID", change.id, "L1/L2 use active handoff row, not an independent CR file");
      } catch (error) { issue("CHANGE_ROUTE_INVALID", change.id, String(error)); }
    }
    for (const id of change.affected) if (!change.synchronized?.includes(id) || change.kind !== "formatting" && !change.reverified?.includes(id)) issue("CHANGE_REVERIFY_MISSING", id, `sync/revalidation missing for ${change.id}`);
    if (change.kind !== "formatting" && change.affected.length) {
      if (!change.reverification_review) issue("CHANGE_REVERIFY_MISSING", change.id, "affected IDs alone do not prove revalidation; input-bound change review required");
      else try {
        const review = JSON.parse(readFileSync(qualityPath(ctx, change.reverification_review), "utf8"));
        const current = qualitySnapshots(ctx, document);
        if (!review.reviewer || review.workflow_id !== ctx.workflow_id && review.workflow_id !== ctx.project_workflow_id || review.module_id !== (ctx.module_id || null) || review.kind !== "change" || !Array.isArray(review.open_findings) || review.open_findings.length) issue("CHANGE_REVERIFY_MISSING", change.id, "revalidation identity/findings invalid");
        for (const id of change.affected) {
          if (!review.items?.some((i: { id: string; conclusion: string; rationale: string }) => i.id === id && i.conclusion === "supported" && i.rationale)) issue("CHANGE_REVERIFY_MISSING", id, "affected consumer not reviewed");
          const snapshot = current.find(s => s.id === id);
          if (snapshot && !review.inputs?.some((i: QualityInput) => i.path === snapshot.path && i.sha256 === snapshot.sha256)) issue("CHANGE_REVERIFY_MISSING", id, "revalidation does not bind current consumer bytes");
        }
        for (const before of change.before) {
          const historical = checkpointDocument(ctx)?.checkpoints.flatMap(c => c.snapshots).find(s => s.path === before.path && s.sha256 === before.sha256);
          const contentPath = historical?.content_path || before.content_path;
          if (!contentPath || qualityInput(ctx, contentPath).sha256 !== before.sha256 || !review.inputs?.some((i: QualityInput) => i.path === contentPath && i.sha256 === before.sha256)) issue("CHANGE_REVERIFY_MISSING", change.id, "semantic review must bind the actual before text, not only a claimed digest");
        }
      } catch (error) { issue("CHANGE_REVERIFY_MISSING", change.id, String(error)); }
    }
    for (const snapshot of change.after) {
      try { if (snapshot.semantic_sha256 ? qualitySemanticHash(readFileSync(qualityPath(ctx, snapshot.path), "utf8")) !== snapshot.semantic_sha256 : qualityInput(ctx, snapshot.path).sha256 !== snapshot.sha256) issue("CHANGE_EVIDENCE_STALE", snapshot.id, "change after snapshot differs"); }
      catch (error) { issue("CHANGE_EVIDENCE_STALE", snapshot.id, String(error)); }
    }
  }
  issues.push(...qualityHistoryIssues(ctx, document));
  return issues;
}

/** A repository HEAD alone is not implemented behavior: inspect registered source roots at its baseline. */
export function qualityCodeBaseline(root: string, moduleId: string | undefined, baseline: string | undefined, built: boolean): boolean {
  if (built) return true;
  const registered = workflowBaselineForModule(root, moduleId);
  const commit = registered.registered ? registered.commit : baseline;
  if (!commit || !/^[a-f0-9]{40,64}$/.test(commit)) return false;
  const nested = nestedSourceRepos(root);
  for (const sourceRoot of resolveSourceRoots(root, moduleId).roots) {
    const repo = codeRefRepo(root, sourceRoot, nested);
    const revision = repo.repoKey === "." ? commit : registered.registered ? registered.repos[repo.repoKey]?.commits.at(-1) : undefined;
    if (!revision) throw new Error(`CHANGE_ROUTE_INVALID: nested code baseline ${repo.repoKey} unregistered`);
    const result = runSync("git", ["ls-tree", "-r", "--name-only", revision, "--", repo.relativePath || "."], { cwd: repo.repoRoot, encoding: "utf8" });
    if (result.status !== 0) throw new Error("CHANGE_ROUTE_INVALID: code baseline cannot be verified");
    if (/\.(?:[cm]?[jt]sx?|py|java|kt|go|rs|c|cc|cpp|cs|php|rb|swift|vue|svelte)$/im.test(String(result.stdout))) return true;
  }
  return false;
}
export function qualityResult(ctx: QualityContext, sensor: string, documents: ReturnType<typeof qualitySection>[], issues: QualityIssue[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  if (issues.length) throw new QualityBlocked(issues);
  const scopes = new Set(documents.map(d => d.value.delivery_scope));
  if (scopes.size !== 1) throw new Error("GATE_SCOPE_MISMATCH: delivery scopes differ");
  const adoption = qualityAdoption(ctx);
  const inputs = [...new Map([...adoption.inputs, ...documents.flatMap(d => d.inputs)].map(i => [i.path, i])).values()];
  return { ...qualityIdentity(ctx), sensor, status: "passed", applicable: true, applicability_basis: adoption.basis, delivery_scope: [...scopes][0], inputs, issues: [], ...extra };
}
export function qualityChangeCheck(ctx: QualityContext): Record<string, unknown> {
  const legacy = qualityLegacyResult(ctx, "quality-change-impact");
  if (legacy) return legacy;
  const document = qualitySection(ctx, "requirements");
  const issues = qualityChangeIssues(ctx, document.value);
  for (const artifact of document.value.artifacts || []) document.inputs.push(qualityInput(ctx, artifact.path));
  for (const change of document.value.changes || []) if (change.cr_path) document.inputs.push(qualityInput(ctx, change.cr_path));
  for (const change of document.value.changes || []) if (change.reverification_review) document.inputs.push(qualityInput(ctx, change.reverification_review));
  for (const change of document.value.changes || []) for (const before of change.before || []) {
    const historical = checkpointDocument(ctx)?.checkpoints.flatMap(c => c.snapshots).find(s => s.path === before.path && s.sha256 === before.sha256);
    const contentPath = historical?.content_path || before.content_path;
    if (contentPath) document.inputs.push(qualityInput(ctx, contentPath));
  }
  const snapshots = qualitySnapshots(ctx, document.value);
  document.inputs.push(...snapshots.map(s => qualityInput(ctx, s.path)));
  return qualityResult(ctx, "quality-change-impact", [document], issues, { quality_snapshots: snapshots });
}

export function qualitySemanticHash(body: string): string {
  const semantic = body.replace(/```aidlc-quality\s*\r?\n([\s\S]*?)\r?\n```/g, (_all, data) => {
    const value = JSON.parse(data); delete value.changes; delete value.artifacts;
    return JSON.stringify(value);
  }).replace(/\s+/g, " ").trim();
  return qualityHash(semantic);
}
export function qualitySnapshots(ctx: QualityContext, document: QualityDocument): QualitySnapshot[] {
  const paths = new Set([`${qualityBase(ctx)}/requirements.md`, ...document.inputs, ...(document.artifacts || []).map(a => a.path)]);
  for (const canonical of ["user-stories.md", "ui-design/page-plan.md", "cross-validation-report.md", "development-handoff.md"]) {
    const path = `${qualityBase(ctx)}/${canonical}`; if (existsSync(qualityPath(ctx, path))) paths.add(path);
  }
  return [...paths].sort().map(path => {
    const bytes = readFileSync(qualityPath(ctx, path)); const body = bytes.toString("utf8");
    const declared = document.artifacts?.find(a => a.path === path);
    return { id: declared?.id || path, path, sha256: qualityHash(bytes), semantic_sha256: qualitySemanticHash(body), content_path: `${qualityLineageRoot(ctx)}/snapshots/${qualityHash(bytes)}`,
      ids: declared?.ids || [...new Set(body.match(/\b(?:REQ|FR|US|AC|FIELD|RULE|DEP|PAGE)-[A-Z0-9_-]+\b/g) || [])], depends_on: declared?.depends_on || [] };
  });
}
interface QualityCheckpoint {
  version: string; workflow_id: string; module_id: string | null; scope: string;
  checkpoints: Array<{ execution_id: string; previous_digest: string | null; snapshots: QualitySnapshot[]; digest: string }>;
}
export function qualityLineageRoot(ctx: QualityContext): string { return `.aidlc/quality/${qualityHash(ctx.project_workflow_id || ctx.workflow_id).slice(0, 20)}/${ctx.module_id || "project"}`; }
export function qualityCheckpointPath(ctx: QualityContext): string { return `${qualityLineageRoot(ctx)}/change-checkpoints.json`; }
function checkpointDocument(ctx: QualityContext): QualityCheckpoint | null {
  const path = qualityCheckpointPath(ctx);
  if (!existsSync(qualityPath(ctx, path))) {
    const old = `.aidlc/evidence/requirements-analysis/${ctx.module_id ? `${ctx.module_id}/` : ""}quality-change-impact.json`;
    if (existsSync(qualityPath(ctx, old))) throw new Error("CHANGE_EVIDENCE_STALE: controlled change history was removed");
    return null;
  }
  const record = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8")) as QualityCheckpoint;
  if (record.version !== "1" || record.workflow_id !== (ctx.project_workflow_id || ctx.workflow_id) || record.module_id !== (ctx.module_id || null) || record.scope !== ctx.scope || !Array.isArray(record.checkpoints) || !record.checkpoints.length) throw new Error("GATE_SCOPE_MISMATCH: change checkpoint identity");
  let previous: string | null = null;
  for (const checkpoint of record.checkpoints) {
    const { digest, ...unsigned } = checkpoint;
    if (!checkpoint.execution_id || checkpoint.previous_digest !== previous || digest !== qualityHash(JSON.stringify(unsigned))) throw new Error("CHANGE_EVIDENCE_STALE: change checkpoint chain tampered");
    previous = digest;
  }
  return record;
}
export function qualityHistoryIssues(ctx: QualityContext, document: QualityDocument): QualityIssue[] {
  const baseline = checkpointDocument(ctx)?.checkpoints.at(-1)?.snapshots;
  if (!baseline) return [];
  const current = qualitySnapshots(ctx, document);
  const issues: QualityIssue[] = [];
  for (const old of baseline) {
    const now = current.find(s => s.path === old.path);
    if (now?.semantic_sha256 === old.semantic_sha256) continue;
    const change = document.changes?.find(c => c.before?.some(s => s.path === old.path && s.sha256 === old.sha256) && (!now || c.after?.some(s => s.path === now.path && (s.semantic_sha256 ? s.semantic_sha256 === now.semantic_sha256 : s.sha256 === now.sha256))));
    if (!change) { issues.push({ code: "CHANGE_IMPACT_UNMAPPED", location: old.path, message: "changed/deleted semantics lack a bound prior/current change record" }); continue; }
    const roots = new Set([old.id, ...(old.ids || []), ...(now?.ids || [])]);
    const affected = new Set<string>([old.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of [...baseline, ...current]) if (!affected.has(node.id) && (node.depends_on.some(id => roots.has(id) || affected.has(id)) || node.ids.some(id => roots.has(id)))) { affected.add(node.id); node.ids.forEach(id => roots.add(id)); grew = true; }
    }
    for (const id of affected) if (!change.affected?.includes(id)) issues.push({ code: "CHANGE_ARTIFACT_OMITTED", location: id, message: `old/new consumer graph requires ${change.id} impact registration` });
    if (change.kind === "formatting") issues.push({ code: "CHANGE_IMPACT_UNMAPPED", location: change.id, message: "semantic bytes changed under a formatting-only declaration" });
  }
  return issues;
}
/** Producer-only checkpoint append. Shared per-module lock, hash-linked history, atomic publication. */
export function recordQualityCheckpoint(ctx: QualityContext, snapshots: QualitySnapshot[], executionId: string): string {
  const path = qualityPath(ctx, qualityCheckpointPath(ctx)); mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`; const fd = openSync(lock, "wx");
  const temporary = `${path}.${executionId}.tmp`;
  try {
    const record = checkpointDocument(ctx) || { version: "1", workflow_id: ctx.project_workflow_id || ctx.workflow_id, module_id: ctx.module_id || null, scope: ctx.scope, checkpoints: [] };
    for (const snapshot of snapshots) {
      const bytes = readFileSync(qualityPath(ctx, snapshot.path));
      if (qualityHash(bytes) !== snapshot.sha256) throw new Error("CHANGE_EVIDENCE_STALE: source changed during controlled snapshot capture");
      const expected = `${qualityLineageRoot(ctx)}/snapshots/${snapshot.sha256}`;
      if (snapshot.content_path !== expected) throw new Error("GATE_SCOPE_MISMATCH: snapshot storage path");
      const stored = qualityPath(ctx, expected); mkdirSync(dirname(stored), { recursive: true });
      if (!existsSync(stored)) writeFileSync(stored, bytes, { flag: "wx" });
      if (qualityHash(readFileSync(stored)) !== snapshot.sha256) throw new Error("CHANGE_EVIDENCE_STALE: historical source bytes tampered");
    }
    const unsigned = { execution_id: executionId, previous_digest: record.checkpoints.at(-1)?.digest || null, snapshots };
    const digest = qualityHash(JSON.stringify(unsigned)); record.checkpoints.push({ ...unsigned, digest });
    writeFileSync(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx" }); renameSync(temporary, path); return digest;
  } finally { closeSync(fd); unlinkSync(lock); if (existsSync(temporary)) unlinkSync(temporary); }
}
