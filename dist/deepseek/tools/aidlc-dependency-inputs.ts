/** Pure source-scope expansion. No workflow/session imports and no readiness claims. */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, win32 } from "node:path";
import { createRequire } from "node:module";
import { autonomyDigest, canonicalAutonomyJson as json, records, safeFile, string } from "./aidlc-autonomy-files";
import type { AutonomyBatchSnapshot } from "./aidlc-autonomy-state";
import { readModuleManifest, readUnitManifest } from "./aidlc-execution-context";

type Row = Record<string, any>;
export function dependencyPath(root: string, value: unknown): string {
  const path = string(value, "dependency path");
  if (isAbsolute(path) || win32.isAbsolute(path) || /[\\:\u0000-\u001f*?]/.test(path) || path.split("/").some(p => !p || p === "." || p === ".." || [".git", ".aidlc"].includes(pathIdentity(p))) || pathIdentity(path) === "aidlc" || pathIdentity(path).startsWith("aidlc/")) throw new Error(`DEPENDENCY_SCHEMA_INVALID: unsafe path ${path}`);
  let current = root;
  for (const part of path.split("/")) { current = join(current, part); if (existsSync(current) && (lstatSync(current).isSymbolicLink() || lstatSync(current).isFile() && lstatSync(current).nlink !== 1)) throw new Error(`DEPENDENCY_SCHEMA_INVALID: linked path ${path}`); }
  return path;
}
const pathIdentity = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
export const withinDependencyPath = (path: string, prefix: string) => pathIdentity(path) === pathIdentity(prefix) || pathIdentity(path).startsWith(pathIdentity(prefix) + "/");
export const overlappingDependencyPaths = (a: string, b: string) => withinDependencyPath(a, b) || withinDependencyPath(b, a);
export const unitDependencyKey = (ref: Row) => `${ref.module_id}/${ref.unit_id}`;
export const unitExtensionPath = (module: string) => `docs/aidlc/modules/${module}/inception/application-design/unit-of-work.md`;
export const unitDependencyPath = (module: string) => `docs/aidlc/modules/${module}/inception/application-design/unit-of-work-dependency.md`;
export function declaredDependencyWrites(root: string, unit: Row): string[] {
  if (unit.role !== "implement") return [];
  if (unit.legacy_module_scope) return readModuleManifest(root).find(m => m.module_id === unit.unit_ref.module_id)?.paths || ["src"];
  return [...unit.private_paths, ...unit.shared_writes.filter((s: Row) => s.coordination === "serialized" || json(s.owner_unit_ref) === json(unit.unit_ref)).map((s: Row) => s.path)];
}
export function dependencyClaimConflict(root: string, units: Row[], instance: string): boolean {
  const module = /@module:([^@]+)/.exec(instance)?.[1], unit = /@unit:([^@]+)/.exec(instance)?.[1];
  const selected = units.find(u => unitDependencyKey(u.unit_ref) === `${module}/${unit}`);
  const other = selected ? declaredDependencyWrites(root, selected) : readModuleManifest(root).find(m => m.module_id === module)?.paths || ["src"];
  return units.some(u => declaredDependencyWrites(root, u).some(p => other.some(q => overlappingDependencyPaths(p, q))));
}
export function dependencyRecords(root: string, path: string): Row[] {
  if (!existsSync(join(root, path))) return [];
  // Ordinary legacy Markdown has no autonomy record section.
  const text = readFileSync(safeFile(root, path), "utf8");
  return text.includes("aidlc-autonomy") ? records(root, path) : [];
}
export function autonomyNeedsContractBaseline(root: string, module: string, unit: string): boolean {
  return readModuleManifest(root).some(m => dependencyRecords(root, unitDependencyPath(m.module_id)).some(r => r.record_type === "dependency" && r.type === "contract" && unitDependencyKey(r.provider || {}) === `${module}/${unit}`));
}
/** A contract baseline follows declarations and shared inputs, not future business
 * implementation. The native declaration checker separately verifies its complete
 * current schema inventory, so newly introduced contracts cannot escape this scope. */
/** Legacy declaration checkers do not gain new manifest constraints without opt-in. */
export function hasAutonomyUnit(root: string, module: string, unit: string): boolean {
  const path = `docs/aidlc/modules/${module}/inception/unit-manifest.json`;
  if (!existsSync(join(root, path))) return false;
  const text = readFileSync(safeFile(root, path), "utf8");
  if (!/"autonomy_version"\s*:/.test(text)) return false;
  const row = JSON.parse(text).units?.find((u: Row) => u.unit_id === unit);
  if (row?.autonomy_version === undefined) return false;
  return readUnitManifest(root, module).find(u => u.unit_id === unit)?.autonomy_version === "1";
}
export function autonomyContractScope(root: string, module: string, unit: string) {
  if (!hasAutonomyUnit(root, module, unit)) return null;
  const units = readUnitManifest(root, module), own = units.find(u => u.unit_id === unit);
  if (own?.autonomy_version !== "1" || units.some(u => !u.evidence_inputs)) return null;
  const moduleInfo = readModuleManifest(root).find(m => m.module_id === module);
  const capabilities = dependencyRecords(root, unitExtensionPath(module)).filter(r => r.record_type === "capability" && unitDependencyKey(r.provider_ref || {}) === `${module}/${unit}`);
  const paths = [unitExtensionPath(module), `docs/aidlc/modules/${module}/inception/unit-manifest.json`, ...(own.evidence_inputs?.shared_paths || []), ...(moduleInfo?.contract_paths || []), ...capabilities.flatMap(c => (c.artifact_refs || []).map((r: Row) => r.path))].map(p => dependencyPath(root, p));
  return { label: `contract-inputs-v1:module:${module}:unit:${unit}`, exclude: (path: string) => !paths.some(p => withinDependencyPath(path, p)) };
}
/** Explicitly versioned units bind prose and non-batch records. Execution-only
 * scopes also omit decision bookkeeping; ordinary/final record validation does not. */
export function autonomyBatchProjection(root: string, path: string, phaseExecution = false): string | undefined {
  if (!existsSync(join(root, path))) return undefined;
  const text = readFileSync(safeFile(root, path), "utf8");
  const Markdown = createRequire(import.meta.url)("markdown-it"), tokens = new Markdown().parse(text, {}).filter((t: Row) => t.type === "fence" && t.info.trim() === "aidlc-autonomy");
  if (!tokens.length) return text;
  const rows = records(root, path), token = tokens[0], kept = rows.filter(r => r.record_type !== "batch").map(row => {
    // Completing a decision's references does not change executable behavior.
    // Keep every semantic/unknown field, including policy, choice and human review.
    // Normal evidence and final decision validation still bind the full record.
    if (!phaseExecution || row.record_type !== "decision") return row;
    return Object.fromEntries(Object.entries(row).filter(([key]) => !["revision", "implementation_refs", "validation_refs", "recorded_by"].includes(key)));
  });
  const replacement = kept.length ? "```aidlc-autonomy\n" + json({ schema: "aidlc.autonomy-source/v1", records: kept }) + "\n```" : "";
  const lines = text.split("\n"); return [...lines.slice(0, token.map[0]), ...replacement.split("\n"), ...lines.slice(token.map[1])].join("\n");
}

/** Only frozen, named delivery documentation is downstream of executed code.
 * Never infer this role from a directory, arbitrary extension or mutable draft. */
export function autonomyDeliveryReportPaths(root: string, workflowId: string, snapshot?: AutonomyBatchSnapshot): string[] {
  if (!snapshot) return [];
  const batches = dependencyRecords(root, snapshot.source_path).filter(row => row.record_type === "batch");
  const batch = batches[0];
  if (batches.length !== 1 || batch.workflow_id !== workflowId || batch.batch_id !== snapshot.batch_id
    || batch.record_id !== snapshot.batch_id || batch.scope_revision !== snapshot.scope_revision
    || autonomyDigest(batch) !== snapshot.record_digest) throw new Error("GREEN_EXECUTION_INPUT_BINDING_INVALID: adopted delivery declaration changed");
  if (!Array.isArray(batch.delivery_artifacts)) throw new Error("GREEN_EXECUTION_INPUT_BINDING_INVALID: invalid delivery artifacts");
  const inputs = new Set<string>();
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (typeof (value as Row).path === "string") inputs.add((value as Row).path);
    for (const child of Object.values(value)) collect(child);
  };
  for (const [key, value] of Object.entries(batch)) if (key !== "delivery_artifacts") collect(value);
  return batch.delivery_artifacts.flatMap((artifact: Row) => {
    if (!["run-instructions", "evidence-index", "decision-index"].includes(artifact.kind)
      || artifact.source_ref !== undefined || typeof artifact.target_path !== "string"
      || !artifact.target_path.endsWith(".md")) return [];
    const path = dependencyPath(root, artifact.target_path);
    return [...inputs].some(input => overlappingDependencyPaths(path, input)) ? [] : [path];
  });
}

/** Native evidence scopes call this only for explicitly adopted autonomous workflows.
 * Contract edges add contract bytes; implementation edges also add transitive source.
 * Unknown ownership retains the provider's entire module instead of narrowing it. */
export function autonomyDependencyInputs(root: string, module: string, unit: string): string[] {
  const modules = readModuleManifest(root), result = new Set<string>(), visited = new Set<string>();
  const edges = modules.flatMap(m => dependencyRecords(root, unitDependencyPath(m.module_id))).filter(r => r.record_type === "dependency");
  const capabilities = modules.flatMap(m => dependencyRecords(root, unitExtensionPath(m.module_id))).filter(r => r.record_type === "capability");
  const add = (path: unknown) => result.add(dependencyPath(root, path));
  const visit = (moduleId: string, unitId: string, includeSource: boolean) => {
    const key = `${moduleId}/${unitId}:${includeSource}`; if (visited.has(key)) return; visited.add(key);
    const descriptor = modules.find(m => m.module_id === moduleId); if (!descriptor) throw new Error(`DEPENDENCY_SCHEMA_INVALID: missing input module ${moduleId}`);
    const units = readUnitManifest(root, moduleId), own = units.find(u => u.unit_id === unitId); if (!own) throw new Error(`DEPENDENCY_SCHEMA_INVALID: missing input unit ${moduleId}/${unitId}`);
    if (includeSource) {
      (own.evidence_inputs?.paths || descriptor.paths || ["src"]).forEach(add);
      (own.evidence_inputs?.shared_paths || []).forEach(add);
      add(`docs/aidlc/modules/${moduleId}/construction/${unitId}`);
      add(`docs/aidlc/modules/${moduleId}/inception/unit-manifest.json`);
      add(unitExtensionPath(moduleId));
    }
    for (const dependency of own.evidence_inputs?.depends_on_units || []) visit(moduleId, dependency, true);
    for (const edge of edges.filter(e => unitDependencyKey(e.consumer || {}) === `${moduleId}/${unitId}`)) {
      const ref = edge.capability_ref as Row;
      const cap = capabilities.find(c => c.capability_id === ref?.capability_id && c.version_digest === ref?.version_digest && json(c.provider_ref) === json(ref.provider_ref));
      if (cap) for (const input of cap.artifact_refs || []) add(input.path);
      if (edge.provider?.external_id) { for (const ref of [edge.provider.contract_ref, edge.provider.version_ref]) if (ref?.path) add(ref.path); }
      else if (edge.type === "implementation") visit(edge.provider.module_id, edge.provider.unit_id, true);
    }
  };
  visit(module, unit, false);
  return [...result].sort();
}
