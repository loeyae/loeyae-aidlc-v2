/** Opt-in dependencies. Unknown sensors retain the complete stage/source binding. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readModuleManifest, readUnitManifest } from "./aidlc-execution-context";

export interface SensorInputs {
  version: 1;
  sensor: string;
  digest: string;
  artifacts: string[];
  files: Array<{ path: string; sha256: string }>;
}
export const TEMPLATE_SENSOR = "template-completeness";
export function templatePaths(moduleId?: string, unitId?: string): string[] {
  for (const id of [moduleId, unitId]) if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("invalid template context");
  if (unitId && !moduleId) throw new Error("template unit requires module");
  const base = moduleId && unitId ? `docs/aidlc/modules/${moduleId}/construction/${unitId}/build-and-test` : "docs/aidlc/construction/build-and-test";
  return ["build-instructions.md", "unit-test-instructions.md"].map(name => `${base}/${name}`);
}

/** Shared by direct checks and the isolated controlled-producer entrypoint. */
export function templateCompletenessPayload(root: string, moduleId?: string, unitId?: string): Record<string, unknown> {
  const templates = templatePaths(moduleId, unitId);
  for (const path of templates) {
    let content: string;
    try { content = readFileSync(join(root, path), "utf8"); }
    catch { throw new Error("build/test template files are incomplete"); }
    if (content.trim().length < 40 || /\[[^\]]+\]|TODO|TBD/i.test(content)) throw new Error(`${path} contains unresolved template placeholders`);
  }
  return { status: "passed", templates, unresolved: 0 };
}

/** Byte hashes also cover ignored inputs and missing declarations; never truncate. */
export function sensorInputs(root: string, sensor: string, moduleId?: string, unitId?: string): SensorInputs | null {
  if (sensor !== TEMPLATE_SENSOR) return null;
  const paths = templatePaths(moduleId, unitId);
  const moduleManifest = "docs/aidlc/ideation/module-manifest.json";
  paths.push(moduleManifest);
  if (existsSync(join(root, moduleManifest))) {
    for (const module of readModuleManifest(root)) {
      paths.push(...module.contract_paths || []);
      const unitManifest = `docs/aidlc/modules/${module.module_id}/inception/unit-manifest.json`;
      paths.push(unitManifest);
      if (existsSync(join(root, unitManifest))) for (const unit of readUnitManifest(root, module.module_id)) paths.push(...unit.evidence_inputs?.shared_paths || []);
    }
  }
  const files = new Map<string, string>();
  let bytes = 0;
  const visit = (label: string): void => {
    const path = resolve(root, label), rel = relative(resolve(root), path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`invalid sensor input path: ${label}`);
    let cursor = resolve(root);
    for (const part of rel.split(sep)) {
      cursor = join(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error(`sensor input symlink: ${label}`);
    }
    const key = rel.replace(/\\/g, "/");
    if (files.has(key)) return;
    if (files.size >= 2000) throw new Error("sensor input inventory exceeds limit");
    if (!existsSync(path)) { files.set(key, "missing"); return; }
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      files.set(key, "directory");
      for (const entry of readdirSync(path).sort()) visit(`${key}/${entry}`);
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (bytes > 64 * 1024 * 1024) throw new Error("sensor input bytes exceed limit");
      files.set(key, createHash("sha256").update(readFileSync(path)).digest("hex"));
    } else throw new Error(`unsupported sensor input: ${label}`);
    if (files.size > 2000) throw new Error("sensor input inventory exceeds limit");
  };
  for (const path of [...new Set(paths)].sort()) visit(path);
  const inventory = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 }));
  return { version: 1, sensor, digest: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"), artifacts: inventory.map(file => file.path), files: inventory };
}

export function sensorInputScope(root: string, sensor: string, instanceId: string) {
  const moduleId = /@module:([^@]+)/.exec(instanceId)?.[1], unitId = /@unit:([^@]+)/.exec(instanceId)?.[1];
  if (instanceId.split("@", 1)[0] !== "build-and-test-templates") return null;
  const inputs = sensorInputs(root, sensor, moduleId, unitId);
  return inputs ? { label: `sensor-inputs-v1:${sensor}:${instanceId}`, exclude: () => true, projectedInputs: { "@sensor-inputs-v1": JSON.stringify(inputs) } } : null;
}
