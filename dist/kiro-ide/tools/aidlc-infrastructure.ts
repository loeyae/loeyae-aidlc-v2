/** Structured infrastructure declarations. Design approval never asserts runtime readiness. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

type RecordValue = Record<string, unknown>;
type Document = { path: string; content: string };
const record = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(nonempty);

function input(root: string, path: string): { path: string; sha256: string } {
  if (!nonempty(path) || isAbsolute(path) || /[\\:#?]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error("infrastructure evidence reference must be a project-relative file path");
  }
  let current = resolve(root);
  for (const segment of path.split("/")) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error("infrastructure evidence reference must not use symlinks");
  }
  const rel = relative(realpathSync(root), realpathSync(current));
  if (isAbsolute(rel) || rel.startsWith("..") || !lstatSync(current).isFile()) throw new Error("infrastructure evidence reference escapes project or is not a file");
  const content = readFileSync(current);
  if (!content.toString("utf8").trim()) throw new Error("infrastructure evidence reference is empty");
  return { path, sha256: createHash("sha256").update(content).digest("hex") };
}

/** No paragraph matching: only explicitly tagged JSON fences are resource inventories. */
export function infrastructureResources(root: string, documents: Document[], stage: string): RecordValue {
  const resources: RecordValue[] = [];
  const names = new Set<string>();
  for (const document of documents) {
    for (const match of document.content.matchAll(/^```infrastructure-resources\s*\r?\n([\s\S]*?)^```\s*$/gm)) {
      const inventory: unknown = JSON.parse(match[1]);
      if (!record(inventory) || inventory.schema_version !== 1 || !Array.isArray(inventory.resources) || !inventory.resources.length) {
        throw new Error("infrastructure inventory needs schema_version=1 and non-empty resources");
      }
      for (const value of inventory.resources) {
        if (!record(value) || !nonempty(value.name) || !nonempty(value.type)) throw new Error("infrastructure resource needs name and type");
        const name = value.name.trim();
        if (names.has(name)) throw new Error(`duplicate infrastructure resource: ${name}`);
        names.add(name);
        if (!["declared", "before-deploy", "provisioned"].includes(String(value.provisioning_status))) throw new Error(`invalid provisioning_status: ${name}`);
        if (!strings(value.source_refs)) throw new Error(`infrastructure resource source_refs required: ${name}`);
        const sourceInputs = value.source_refs.map(ref => input(root, ref));
        const provisioned = value.provisioning_status === "provisioned";
        const resource: RecordValue = { ...value, name, provisioned, source_inputs: sourceInputs, declared_in: document.path };
        if (provisioned) {
          if (!nonempty(value.target_environment) || !strings(value.provisioning_evidence)) throw new Error(`provisioned resource needs target_environment and provisioning_evidence: ${name}`);
          resource.provisioning_inputs = value.provisioning_evidence.map(ref => input(root, ref));
        }
        resources.push(resource);
      }
    }
  }
  const evidence = { resource_schema_version: 2, assessment_scope: stage === "infrastructure-design" ? "design" : "provisioning", resources_enumerated: resources };
  const errors = infrastructureResourceErrors(evidence, stage);
  if (errors.length) throw new Error(errors.join("; "));
  return evidence;
}

/** Shared by producer and orchestrator. Scope is derived from the evaluated stage. */
export function infrastructureResourceErrors(evidence: RecordValue, stage: string, root?: string): string[] {
  const errors: string[] = [];
  const resources = evidence.resources_enumerated;
  if (!Array.isArray(resources) || !resources.length) return ["resources_enumerated must list at least one infrastructure resource (explicit infrastructure-resources inventory required)"];
  const modern = evidence.resource_schema_version !== undefined || evidence.assessment_scope !== undefined;
  const design = stage === "infrastructure-design";
  if (modern) {
    if (evidence.resource_schema_version !== 2) errors.push("resource_schema_version must be 2");
    if (evidence.assessment_scope !== (design ? "design" : "provisioning")) errors.push("assessment_scope does not match evaluated stage");
  }
  const names = new Set<string>();
  for (const [i, item] of resources.entries()) {
    const key = `resources_enumerated[${i}]`;
    if (!record(item)) { errors.push(`${key} must be an object`); continue; }
    for (const field of ["name", "type"]) if (!nonempty(item[field])) errors.push(`${key}.${field} is required`);
    if (nonempty(item.name)) {
      if (names.has(item.name.trim())) errors.push(`${key}.name is duplicated`);
      names.add(item.name.trim());
    }
    // Previously controlled evidence remains valid only under its original strict meaning.
    if (!modern) {
      if (item.provisioned !== true) errors.push(`${key}.provisioned must be true`);
      continue;
    }
    const status = item.provisioning_status;
    if (!["declared", "before-deploy", "provisioned"].includes(String(status))) errors.push(`${key}.provisioning_status is invalid`);
    if (item.provisioned !== (status === "provisioned")) errors.push(`${key}.provisioned contradicts provisioning_status`);
    const validInputs = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(v => record(v) && nonempty(v.path) && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256));
    if (!validInputs(item.source_inputs)) errors.push(`${key}.source_inputs required`);
    if (status === "provisioned") {
      if (!nonempty(item.target_environment) || !validInputs(item.provisioning_inputs)) errors.push(`${key} needs target_environment and provisioning_inputs`);
    } else {
      if (!design) errors.push(`${key}.provisioned must be true outside infrastructure-design`);
      if (status !== "before-deploy" || !nonempty(item.owner) || !nonempty(item.verification) || item.required_before !== "deploy") {
        errors.push(`${key} needs before-deploy status, owner, verification and required_before=deploy`);
      }
    }
    // References can live outside module document scope. Recheck their bytes at
    // the gate as well; module source_revision alone cannot bind those inputs.
    if (root) for (const field of ["source_inputs", "provisioning_inputs"]) {
      if (!validInputs(item[field])) continue;
      for (const ref of item[field] as Array<{ path: string; sha256: string }>) {
        try {
          if (input(root, ref.path).sha256 !== ref.sha256) errors.push(`${key}.${field} changed: ${ref.path}`);
        } catch { errors.push(`${key}.${field} unavailable or unsafe: ${ref.path}`); }
      }
    }
  }
  return errors;
}
