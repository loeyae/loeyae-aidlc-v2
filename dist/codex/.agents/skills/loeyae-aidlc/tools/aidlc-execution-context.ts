import { existsSync, lstatSync, readFileSync } from "fs";
import { join } from "path";

export type ExecutionAxis = "project" | "module" | "unit";

export interface ExecutionContext {
  module_id?: string;
  unit_id?: string;
}

export interface ModuleDescriptor {
  module_id: string;
  name: string;
  service_id: string;
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

export function readModuleManifest(projectRoot: string): ModuleDescriptor[] {
  const value = regularJson(moduleManifestPath(projectRoot), "module manifest");
  if (value.schema_version !== 1) throw new Error("module manifest schema_version must be 1");
  if (!Array.isArray(value.modules) || value.modules.length === 0) throw new Error("module manifest modules must be a non-empty array");
  const modules = value.modules.map((item, index) => {
    const module = record(item, `modules[${index}]`);
    return {
      module_id: contextId(module.module_id, `modules[${index}].module_id`),
      name: nonEmptyString(module.name, `modules[${index}].name`),
      service_id: nonEmptyString(module.service_id, `modules[${index}].service_id`),
    };
  });
  uniqueIds(modules.map((module) => module.module_id), "module manifest");
  return modules;
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
