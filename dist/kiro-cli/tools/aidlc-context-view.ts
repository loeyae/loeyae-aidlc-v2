import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GLOBAL_WORKFLOW } from "./aidlc-light-state";
import { isSplitLayout, loadWorkflowPart, relativeStatePath } from "./aidlc-workflow-layout";
import { readUnitManifest, readModuleManifest } from "./aidlc-execution-context";
import { factStorageActive } from "./aidlc-workflow-facts";

const id = (value: string) => /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
const brief = (value: string, limit = 1200) => value.length <= limit ? value : value.slice(0, limit) + "… [abridged; consult referenced source]";

/** A disposable reading view. No audit scan, producer, sibling state or write. */
export function workflowContext(root: string, moduleId?: string, unitId?: string, integration = false): Record<string, unknown> {
  if (moduleId !== undefined && !id(moduleId) || unitId !== undefined && !id(unitId) || unitId && !moduleId) throw Error("CONTEXT_SCOPE: a unit requires an explicit valid module");
  if (integration && (moduleId || unitId)) throw Error("CONTEXT_SCOPE: integration and module/unit are exclusive");
  const split = isSplitLayout(root), ref = integration && split ? { kind: "integration" as const } : moduleId && split ? { kind: "module" as const, module_id: moduleId } : GLOBAL_WORKFLOW;
  const part = loadWorkflowPart(root, ref);
  if (!part) throw Error("CONTEXT_STATE_MISSING: use normal workflow discovery or recovery; do not reconstruct state from handoff text");
  const state = part.state;
  if (moduleId && !split) {
    const manifest = join(root, "docs/aidlc/ideation/module-manifest.json");
    if (existsSync(manifest) ? !readModuleManifest(root).some(m => m.module_id === moduleId) : moduleId !== "project") throw Error("CONTEXT_SCOPE: unknown module");
  }
  const unitPath = moduleId ? `docs/aidlc/modules/${moduleId}/inception/unit-manifest.json` : undefined;
  const hasUnits = unitPath !== undefined && existsSync(join(root, unitPath));
  // The existing router uses a default unit when I14 was not executed.
  const defaultUnit = unitId === "default" && !state.completed_stage_instances.includes(`units-generation@module:${moduleId}`);
  const unit = unitId ? hasUnits ? readUnitManifest(root, moduleId!).find(u => u.unit_id === unitId)
    : defaultUnit ? { unit_id: "default", req_refs: [] } : undefined : undefined;
  if (unitId && !unit) throw Error("CONTEXT_SCOPE: unknown unit");
  const matches = (instance: string) => (!moduleId || instance.split("@").includes(`module:${moduleId}`)) && (!unitId || instance.endsWith(`@unit:${unitId}`));
  const current = unitId ? state.unit_contexts?.[`${moduleId}:${unitId}`]?.stage_instance || (matches(state.current_stage_instance || "") ? state.current_stage_instance : undefined)
    : moduleId && !split && !matches(state.current_stage_instance || "") ? undefined : state.current_stage_instance;
  const claim = current ? state.active_instances?.[current] : undefined;
  const flags = `${moduleId ? ` --module ${moduleId}` : ""}${unitId ? ` --unit ${unitId}` : ""}`;
  const statePath = relativeStatePath(root, ref), facts = factStorageActive(root, join(root, statePath));
  return {
    version: "1", read_only: true, verification: "not_checked", authority: facts ? statePath.replace(/aidlc-state\.md$/, "aidlc-facts.json") : statePath,
    storage: facts ? "facts-and-local-runtime" : "legacy-state",
    workflow_id: state.workflow_id, revision: state.revision, workflow_status: state.status,
    work: brief(state.work_description), ...(moduleId ? { module_id: moduleId } : {}), ...(unitId ? { unit_id: unitId } : {}),
    current_instance: current || null,
    claim: claim ? { owner: claim.owner, expires_at: claim.expires_at, expired: Date.parse(claim.expires_at) <= Date.now(), instruction: "inspect exact instance before binding; this view grants no authority" } : null,
    completed_instances_count: state.completed_stage_instances.filter(matches).length,
    recent_reports: state.history.filter(h => matches(h.instance_id || h.stage)).slice(-5).map(h => ({ instance: h.instance_id || h.stage, result: h.result, timestamp: h.timestamp })),
    ...(unit ? { requirements_count: hasUnits ? unit.req_refs?.length || 0 : null, unit_manifest: hasUnits ? unitPath : null, unit_basis: hasUnits ? "manifest" : "default-unit-before-or-without-I14" } : {}),
    next: `loeyae-aidlc orchestrate next${flags} --preview`,
    reading: {
      source: "Use the latest formal directive's rule_load_plan and business_document_load_plan; inherited and private files together define a unit view.",
      artifact_command: "loeyae-aidlc orchestrate state artifact --path <exact public artifact>",
      exclude_by_default: ["full audit/state history", "branch-snapshots", "history", "unreferenced document-slices objects", "verification directory scans", "source hash maps"],
      routing_required: true,
    },
  };
}

/** Public process artifacts only. JSON is a result projection, not a validity claim. */
export function artifactView(root: string, label: string, offset = 0, limit = 8000): Record<string, unknown> {
  if (!label || !/^(?:docs\/aidlc\/|\.aidlc\/(?:evidence|reports)\/)/.test(label) || /[\\:]/.test(label) || label.split("/").some(p => !p || p === "." || p === "..") || !/\.(md|json)$/.test(label) || /(?:^|\/)(?:audit|aidlc-state|aidlc-facts)\.(md|json)$/.test(label)) throw Error("ARTIFACT_PATH: use an exact public document/evidence path; use state context for runtime state");
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw Error("ARTIFACT_RANGE: offset >= 0 and limit 1..16000 characters required");
  let file = resolve(root);
  for (const component of label.split("/")) {
    file = join(file, component);
    if (lstatSync(file).isSymbolicLink()) throw Error("ARTIFACT_PATH: linked paths are not supported");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error("ARTIFACT_SIZE: use a targeted native file reader for artifacts over 16 MiB; this does not fail a workflow gate");
  const bytes = readFileSync(file), text = bytes.toString("utf8"), sha256 = createHash("sha256").update(bytes).digest("hex");
  const base = { path: label, sha256, bytes: bytes.length, verification: "not_checked", read_only: true };
  if (label.endsWith(".json")) {
    if (offset) throw Error("ARTIFACT_RANGE: JSON returns a summary; offsets apply to Markdown only");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...base, format: "json-summary", type: Array.isArray(value) ? "array" : typeof value, entries: Array.isArray(value) ? value.length : null };
    const fields: Record<string, unknown> = {};
    for (const key of ["schema", "schema_version", "sensor", "stage", "stage_instance", "status", "result", "kind", "applicable", "exitCode", "exit_code", "durationMs", "started_at", "completed_at"]) {
      const item = value[key];
      if (["string", "number", "boolean"].includes(typeof item) || item === null) fields[key] = typeof item === "string" ? brief(item, 400) : item;
    }
    const omitted = Object.keys(value).filter(key => !Object.hasOwn(fields, key));
    return { ...base, format: "json-summary", fields, omitted_fields: omitted.slice(0, 40).map(k => brief(k, 100)), omitted_fields_count: omitted.length,
      detail: "Original bytes remain authoritative. Inspect the named failure fields or original log with a targeted native reader when needed; source maps, environment and raw command payloads are not model context by default." };
  }
  if (offset > text.length) throw Error("ARTIFACT_RANGE: offset beyond document end");
  const end = Math.min(text.length, offset + limit);
  return { ...base, format: "markdown-page", offset, end, total_characters: text.length, content: text.slice(offset, end), next_offset: end < text.length ? end : null,
    offset_unit: "UTF-16 code units; retain the sha256 while paging" };
}
