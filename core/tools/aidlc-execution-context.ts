import { existsSync, lstatSync, readFileSync } from "fs";
import { dirname, join, win32 } from "path";

export function normalizeArtifactLabel(label: string): string {
  return label.replace(/\\/g, "/");
}

export function portableDirname(path: string): string {
  return path.includes("\\") ? win32.dirname(path) : dirname(path);
}

export function isEvidenceArtifactLabel(label: string): boolean {
  return normalizeArtifactLabel(label).startsWith(".aidlc/evidence/");
}

export type ExecutionAxis = "project" | "module" | "unit";

export interface ExecutionContext {
  module_id?: string;
  unit_id?: string;
}

export interface ModuleDescriptor {
  module_id: string;
  name: string;
  service_id: string;
  paths?: string[];
  /**
   * 4.8.1: shared contract files or directories the module validates as provider or
   * consumer (contract-baseline in a module / unit context). Project-relative; existence
   * and symlinks are checked fail-closed by the checker that reads them.
   */
  contract_paths?: string[];
}

export const UNIT_CONDITIONAL_STAGES = [
  "functional-design",
  "nfr-requirements",
  "nfr-design",
  "infrastructure-design",
  "shared-contract-baseline",
  "subagent-execution",
  "loeyae-compliance",
  "ui-implementation-bridge",
] as const;

export type UnitConditionalStage = typeof UNIT_CONDITIONAL_STAGES[number];

const UNIT_CONDITIONAL_STAGE_SET = new Set<string>(UNIT_CONDITIONAL_STAGES);

export interface UnitDescriptor {
  unit_id: string;
  name: string;
  service_id: string;
  conditional_stages?: UnitConditionalStage[];
  ucd_exemption?: UcdExemption;
}

/** Reason codes accepted for a structured exemption (shared with the I13 non-applicable record). */
export const UCD_EXEMPTION_REASON_CODES: ReadonlySet<string> = new Set(["pure-declaration", "pure-style", "pure-configuration", "approved-exception"]);

/**
 * 4.8.0: a unit whose UC-D subset (by `unit_refs`) is empty declares this in the unit
 * manifest; the controlled producer runs `validation_command` (argv, no shell) before
 * it writes RED / BASELINE / GREEN `not_required`.
 */
export interface UcdExemption {
  reason_code: string;
  reason: string;
  approval_ref: string;
  alternative_validation: string;
  validation_command: string[];
}

const UCD_EXEMPTION_FIELDS = ["reason_code", "reason", "approval_ref", "alternative_validation", "validation_command"];

function ucdExemption(value: unknown, label: string): UcdExemption {
  const exemption = record(value, label);
  const unknown = Object.keys(exemption).filter((key) => !UCD_EXEMPTION_FIELDS.includes(key));
  if (unknown.length > 0) throw new Error(`${label} has unsupported fields: ${unknown.join(", ")}`);
  const reasonCode = nonEmptyString(exemption.reason_code, `${label}.reason_code`);
  if (!UCD_EXEMPTION_REASON_CODES.has(reasonCode)) throw new Error(`${label}.reason_code must be one of ${[...UCD_EXEMPTION_REASON_CODES].join(", ")}`);
  const command = exemption.validation_command;
  if (!Array.isArray(command) || command.length === 0 || !command.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`${label}.validation_command must be a non-empty argv array of non-empty strings`);
  }
  return {
    reason_code: reasonCode,
    reason: nonEmptyString(exemption.reason, `${label}.reason`),
    approval_ref: nonEmptyString(exemption.approval_ref, `${label}.approval_ref`),
    alternative_validation: nonEmptyString(exemption.alternative_validation, `${label}.alternative_validation`),
    validation_command: [...command] as string[],
  };
}

interface ModuleManifest {
  schema_version: 1;
  modules: ModuleDescriptor[];
}

interface UnitManifest {
  schema_version: 1;
  module_id: string;
  units: UnitDescriptor[];
}

const CONTEXT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

export function contextId(value: unknown, label: string): string {
  const id = nonEmptyString(value, label);
  if (!CONTEXT_ID.test(id)) throw new Error(`${label} must match ${CONTEXT_ID.source}`);
  return id;
}

function regularJson(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file: ${path}`);
  try {
    return record(JSON.parse(readFileSync(path, "utf8")), label);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uniqueIds(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate IDs`);
}

export function moduleManifestPath(projectRoot: string): string {
  return join(projectRoot, "docs", "aidlc", "ideation", "module-manifest.json");
}

export function unitManifestPath(projectRoot: string, moduleId: string): string {
  return join(projectRoot, "docs", "aidlc", "modules", contextId(moduleId, "module_id"), "inception", "unit-manifest.json");
}

function modulePaths(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of project-relative directories`);
  const paths = value.map((item, index) => {
    if (item && typeof item === "object") {
      throw new Error(`${label}[${index}] must be a string: nested git repositories are declared only in .aidlc/source-roots.json as { "path": "<dir>", "repo": "nested" } (module-manifest paths assign source to modules; source-roots.json declares the repository topology)`);
    }
    const path = nonEmptyString(item, `${label}[${index}]`).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
      throw new Error(`${label}[${index}] must be a normalized project-relative directory`);
    }
    if (path === "aidlc" || path.startsWith("aidlc/") || path === ".aidlc" || path.startsWith(".aidlc/") || path === "docs/aidlc" || path.startsWith("docs/aidlc/")) {
      throw new Error(`${label}[${index}] must not point into the AI-DLC control plane or docs/aidlc`);
    }
    return path;
  });
  uniqueIds(paths, label);
  return paths;
}

/**
 * `contract_paths` (4.8.1): normalized project-relative files or directories. Unlike
 * `paths` they may point into docs/aidlc (e.g. docs/aidlc/ideation/product-contracts.md),
 * but never into the control plane (aidlc/, .aidlc/) or another module tree
 * (docs/aidlc/modules/), whose files are scoped by the module context itself.
 */
function moduleContractPaths(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of project-relative paths`);
  const paths = value.map((item, index) => {
    const path = nonEmptyString(item, `${label}[${index}]`).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
      throw new Error(`${label}[${index}] must be a normalized project-relative path`);
    }
    if (path === "aidlc" || path.startsWith("aidlc/") || path === ".aidlc" || path.startsWith(".aidlc/")) {
      throw new Error(`${label}[${index}] must not point into the AI-DLC control plane`);
    }
    if (path === "docs/aidlc" || path === "docs/aidlc/modules" || path.startsWith("docs/aidlc/modules/")) {
      throw new Error(`${label}[${index}] must not point at docs/aidlc or a module tree under docs/aidlc/modules`);
    }
    return path;
  });
  uniqueIds(paths, label);
  return paths;
}

export function readModuleManifest(projectRoot: string): ModuleDescriptor[] {
  const value = regularJson(moduleManifestPath(projectRoot), "module manifest");
  if (value.schema_version !== 1) throw new Error("module manifest schema_version must be 1");
  if (!Array.isArray(value.modules) || value.modules.length === 0) throw new Error("module manifest modules must be a non-empty array");
  const modules = value.modules.map((item, index) => {
    const module = record(item, `modules[${index}]`);
    const paths = modulePaths(module.paths, `modules[${index}].paths`);
    const contractPaths = moduleContractPaths(module.contract_paths, `modules[${index}].contract_paths`);
    return {
      module_id: contextId(module.module_id, `modules[${index}].module_id`),
      name: nonEmptyString(module.name, `modules[${index}].name`),
      service_id: nonEmptyString(module.service_id, `modules[${index}].service_id`),
      ...(paths ? { paths } : {}),
      ...(contractPaths ? { contract_paths: contractPaths } : {}),
    };
  });
  uniqueIds(modules.map((module) => module.module_id), "module manifest");
  return modules;
}

/** Module id used by workflows that never ran module-division (no module-manifest). */
export const DEFAULT_MODULE_ID = "project";
/** Scopes that run ideation/module-division and therefore always have a module manifest. */
export const FULL_WORKFLOW_SCOPES: ReadonlySet<string> = new Set(["feature", "enterprise", "mvp", "classic"]);

/**
 * Modules that participate in final implementation-report verification. Shared by
 * the implementation-report checker and the orchestrator gate so both always agree:
 * the manifest modules when a manifest exists (required for full-workflow scopes),
 * otherwise the single default module of a manifest-less workflow.
 */
export function verifiedModuleIds(projectRoot: string, scope: string): string[] {
  if (existsSync(moduleManifestPath(projectRoot)) || FULL_WORKFLOW_SCOPES.has(scope)) {
    return readModuleManifest(projectRoot).map((module) => module.module_id).sort();
  }
  return [DEFAULT_MODULE_ID];
}

export function readUnitManifest(projectRoot: string, moduleId: string): UnitDescriptor[] {
  const safeModuleId = contextId(moduleId, "module_id");
  const value = regularJson(unitManifestPath(projectRoot, safeModuleId), `unit manifest for ${safeModuleId}`);
  if (value.schema_version !== 1) throw new Error(`unit manifest for ${safeModuleId} schema_version must be 1`);
  if (contextId(value.module_id, "unit manifest module_id") !== safeModuleId) {
    throw new Error(`unit manifest module_id does not match active module ${safeModuleId}`);
  }
  if (!Array.isArray(value.units) || value.units.length === 0) throw new Error(`unit manifest for ${safeModuleId} units must be a non-empty array`);
  const units = value.units.map((item, index) => {
    const unit = record(item, `units[${index}]`);
    let conditionalStages: UnitConditionalStage[] | undefined;
    if (unit.conditional_stages !== undefined) {
      if (!Array.isArray(unit.conditional_stages)) throw new Error(`units[${index}].conditional_stages must be an array`);
      conditionalStages = unit.conditional_stages.map((item, stageIndex) => {
        const stage = nonEmptyString(item, `units[${index}].conditional_stages[${stageIndex}]`);
        if (!UNIT_CONDITIONAL_STAGE_SET.has(stage)) {
          throw new Error(`units[${index}].conditional_stages contains unsupported stage "${stage}"`);
        }
        return stage as UnitConditionalStage;
      });
      uniqueIds(conditionalStages, `units[${index}].conditional_stages`);
      const hasNfrRequirements = conditionalStages.includes("nfr-requirements");
      const hasNfrDesign = conditionalStages.includes("nfr-design");
      if (hasNfrRequirements !== hasNfrDesign) {
        throw new Error(`units[${index}].conditional_stages must select nfr-requirements and nfr-design together`);
      }
      if ((hasNfrRequirements || conditionalStages.includes("infrastructure-design"))
        && !conditionalStages.includes("functional-design")) {
        throw new Error(`units[${index}].conditional_stages requires functional-design for NFR or infrastructure design`);
      }
    }
    return {
      unit_id: contextId(unit.unit_id, `units[${index}].unit_id`),
      name: nonEmptyString(unit.name, `units[${index}].name`),
      service_id: nonEmptyString(unit.service_id, `units[${index}].service_id`),
      ...(conditionalStages !== undefined ? { conditional_stages: conditionalStages } : {}),
      ...(unit.ucd_exemption !== undefined ? { ucd_exemption: ucdExemption(unit.ucd_exemption, `units[${index}].ucd_exemption`) } : {}),
    };
  });
  uniqueIds(units.map((unit) => unit.unit_id), `unit manifest for ${safeModuleId}`);
  if (units.length < 2 && units.some((unit) => unit.conditional_stages?.includes("shared-contract-baseline"))) {
    throw new Error(`unit manifest for ${safeModuleId} cannot select shared-contract-baseline with fewer than two units`);
  }
  return units;
}

export function stageInstanceId(slug: string, axis: ExecutionAxis, context: ExecutionContext): string {
  const safeSlug = contextId(slug, "stage slug");
  if (axis === "project") return safeSlug;
  const moduleId = contextId(context.module_id, "module_id");
  if (axis === "module") return `${safeSlug}@module:${moduleId}`;
  const unitId = contextId(context.unit_id, "unit_id");
  return `${safeSlug}@module:${moduleId}@unit:${unitId}`;
}

export function substituteArtifactPattern(pattern: string, context: ExecutionContext): string {
  let resolved = pattern;
  if (context.module_id) resolved = resolved.replaceAll("{module-id}", contextId(context.module_id, "module_id"));
  if (context.unit_id) {
    const unitId = contextId(context.unit_id, "unit_id");
    resolved = resolved.replaceAll("{unit-id}", unitId).replaceAll("{unit-name}", unitId);
  }
  return resolved;
}

export function evidenceRelativePath(stage: string, sensor: string, axis: ExecutionAxis, context: ExecutionContext): string {
  const safeStage = contextId(stage, "stage slug");
  const safeSensor = contextId(sensor, "sensor");
  if (axis === "project") return join(".aidlc", "evidence", safeStage, `${safeSensor}.json`);
  const moduleId = contextId(context.module_id, "module_id");
  if (axis === "module") return join(".aidlc", "evidence", safeStage, moduleId, `${safeSensor}.json`);
  return join(".aidlc", "evidence", safeStage, moduleId, contextId(context.unit_id, "unit_id"), `${safeSensor}.json`);
}

export function moduleInceptionRoot(moduleId: string): string {
  return join("docs", "aidlc", "modules", contextId(moduleId, "module_id"), "inception");
}

export function unitConstructionRoot(moduleId: string, unitId: string): string {
  return join("docs", "aidlc", "modules", contextId(moduleId, "module_id"), "construction", contextId(unitId, "unit_id"));
}


// ---------------------------------------------------------------------------
// UC-D unit scope (4.8.0): I13 `ucd_units` and the per-unit UC-D subset
// ---------------------------------------------------------------------------

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** UC-D ids of a `required` I13 record. */
export function i13UcdIds(i13: Record<string, unknown>): string[] {
  return stringList(i13.ucd_ids);
}

/**
 * UC-D ids of a `required` I13 record grouped by tdd_mode (4.6.0 S2 `ucd_modes`).
 * I13 evidence without `ucd_modes` predates 4.6 and means every UC-D is new.
 */
export function i13UcdIdsByMode(i13: Record<string, unknown>): { new: string[]; characterization: string[] } {
  const ids = i13UcdIds(i13);
  const modes = i13.ucd_modes && typeof i13.ucd_modes === "object" && !Array.isArray(i13.ucd_modes) ? i13.ucd_modes as Record<string, unknown> : undefined;
  if (!modes) return { new: ids, characterization: [] };
  return {
    new: ids.filter((id) => modes[id] === "new"),
    characterization: ids.filter((id) => modes[id] === "characterization"),
  };
}

/** I13 `ucd_units` (UC-D → unit ids); undefined when no UC-D declared `unit_refs`. */
export function i13UcdUnits(i13: Record<string, unknown>): Record<string, string[]> | undefined {
  const value = i13.ucd_units;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([id, units]) => [id, stringList(units)]));
}

export interface UnitUcdScope {
  new: string[];
  characterization: string[];
  all: string[];
  /** True when the subset was taken by `ucd_units` for a unit (false = the module set). */
  scoped: boolean;
}

/**
 * The UC-Ds a unit's tdd / code-generation must cover. With I13 `ucd_units` and a unit
 * id: the UC-Ds whose `unit_refs` name the unit. Otherwise (no `unit_refs` anywhere in
 * the module, or no unit context) the whole module set, i.e. the 4.7.1 behaviour.
 */
export function unitUcdIds(i13: Record<string, unknown>, unitId?: string): UnitUcdScope {
  const ids = i13UcdIds(i13);
  const modes = i13UcdIdsByMode(i13);
  const units = i13UcdUnits(i13);
  if (!units || !unitId) return { new: modes.new, characterization: modes.characterization, all: ids, scoped: false };
  const owned = (id: string) => (units[id] || []).includes(unitId);
  return { new: modes.new.filter(owned), characterization: modes.characterization.filter(owned), all: ids.filter(owned), scoped: true };
}

/**
 * Module close-out reconciliation (4.8.0): every UC-D of an I13 with `ucd_units` must be
 * in the GREEN `uc_mapping` of every unit its `unit_refs` name (so the union of the
 * units' GREEN covers the module). `green` maps unit id → the UC-Ds its passed GREEN
 * covers; a unit without a GREEN record is absent. Returns one message per gap.
 */
export function ucdCoverageGaps(i13: Record<string, unknown>, green: Map<string, string[]>): string[] {
  const units = i13UcdUnits(i13);
  if (!units) return [];
  const gaps: string[] = [];
  for (const id of i13UcdIds(i13)) {
    const owners = units[id] || [];
    if (owners.length === 0) gaps.push(`${id} names no unit in ucd_units`);
    for (const unit of owners) {
      const covered = green.get(unit);
      if (covered === undefined) gaps.push(`${id} has no passed GREEN evidence of unit ${unit}`);
      else if (!covered.includes(id)) gaps.push(`${id} is not covered by the GREEN uc_mapping of unit ${unit}`);
    }
  }
  return gaps;
}

/** UC-Ds a GREEN evidence record covers: its `uc_mapping` use cases when it passed, otherwise none. */
export function greenCoveredUcds(record: Record<string, unknown>): string[] {
  if (record.status !== "passed" || !Array.isArray(record.uc_mapping)) return [];
  return record.uc_mapping.flatMap((entry) => {
    const useCase = entry && typeof entry === "object" ? (entry as Record<string, unknown>).use_case : undefined;
    return typeof useCase === "string" && useCase ? [useCase] : [];
  });
}
