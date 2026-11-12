/** Durable workflow facts and local execution state. The Markdown file is a view
 * after explicit migration; never a second authority. No routing or approvals here. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { WorkflowState } from "./aidlc-light-state";
import { AsyncLocalStorage } from "node:async_hooks";
const reportSources = new AsyncLocalStorage<unknown>();
export function withReportFactSources<T>(sources: unknown, commit: () => T): T { return reportSources.run(sources, commit); }

const runtimeKeys = new Set(["revision", "updated_at", "current_phase", "current_stage", "current_stage_instance", "current_module", "current_unit", "status", "active_instances", "unit_selections", "module_selections", "unit_contexts"]);
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export function workflowFactPaths(root: string, statePath: string) {
  const label = relative(resolve(root), resolve(statePath));
  if (label.startsWith("..") || !label || label.includes(":")) throw Error("WORKFLOW_FACT_PATH_INVALID");
  return { facts: join(dirname(statePath), "aidlc-facts.json"), runtime: join(root, ".aidlc", "workflow-runtime", hash(label.replaceAll(sep, "/")) + ".json") };
}
function safe(root: string, path: string): void {
  const base = resolve(root); let cursor = resolve(path);
  if (!cursor.startsWith(base + sep)) throw Error("WORKFLOW_FACT_PATH_INVALID");
  while (cursor !== base) { if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error("WORKFLOW_FACT_LINK_REFUSED"); cursor = dirname(cursor); }
}
function read(root: string, path: string): any {
  safe(root, path);
  if (!lstatSync(path).isFile()) throw Error("WORKFLOW_FACT_NOT_FILE");
  const row = JSON.parse(readFileSync(path, "utf8"));
  if (!row || row.schema !== "aidlc.workflow-facts/v1" || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.workflow_id !== "string") throw Error("WORKFLOW_FACT_INVALID");
  return row;
}
function atomic(root: string, path: string, row: unknown) {
  safe(root, path); mkdirSync(dirname(path), { recursive: true }); safe(root, path);
  const temp = path + ".tmp-" + randomUUID();
  try { const fd = openSync(temp, "wx", 0o600); try { writeFileSync(fd, JSON.stringify(row, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); } renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function readWorkflowFacts(root: string, statePath: string): any | undefined {
  const paths = workflowFactPaths(root, statePath);
  if (!existsSync(paths.facts)) return undefined;
  const row = read(root, paths.facts);
  if (!row.facts || typeof row.facts !== "object" || !Array.isArray(row.reports) || row.facts.workflow_id !== row.workflow_id || Object.keys(row.facts).some(k => runtimeKeys.has(k) || k === "history")) throw Error("WORKFLOW_FACT_INVALID");
  return row;
}
export function loadFactState(root: string, statePath: string): WorkflowState | undefined {
  const paths = workflowFactPaths(root, statePath);
  const row = readWorkflowFacts(root, statePath);
  if (!row) { if (existsSync(paths.runtime)) throw Error("WORKFLOW_FACTS_MISSING: runtime cannot restore durable approvals from the Markdown view"); return undefined; }
  // A missing lease is unknown, not an empty claim table. Facts remain readable
  // through state facts; ordinary mutation cannot acquire an abandoned authority.
  if (!existsSync(paths.runtime)) throw Error("WORKFLOW_RUNTIME_MISSING: durable facts are preserved; inspect state facts, do not infer an empty claim table");
  const runtime = read(root, paths.runtime);
  if (runtime.workflow_id !== row.workflow_id || !runtime.runtime || Object.keys(runtime.runtime).some(k => !runtimeKeys.has(k))) throw Error("WORKFLOW_RUNTIME_IDENTITY_MISMATCH");
  const state = { ...row.facts, history: row.reports, ...runtime.runtime, revision: Math.max(row.revision, runtime.revision), updated_at: row.revision > runtime.revision ? row.updated_at : runtime.updated_at } as WorkflowState;
  // A crash after fact publication can leave an old cursor, never undo the report.
  if (state.current_stage_instance && (state.completed_stage_instances.includes(state.current_stage_instance) || state.skipped_stage_instances.includes(state.current_stage_instance))) {
    state.current_stage = ""; delete state.current_stage_instance; delete state.current_unit; delete state.current_module;
  }
  return state;
}
export function persistFactState(root: string, statePath: string, state: WorkflowState, migration?: { state_sha256: string; git_commit: string }): void {
  const paths = workflowFactPaths(root, statePath), prior = readWorkflowFacts(root, statePath);
  if (!prior && !migration) throw Error("WORKFLOW_FACT_MIGRATION_REQUIRED");
  if (prior && prior.workflow_id !== state.workflow_id) throw Error("WORKFLOW_FACT_IDENTITY_MISMATCH");
  const facts = Object.fromEntries(Object.entries(state).filter(([key]) => !runtimeKeys.has(key) && key !== "history"));
  const runtime = Object.fromEntries(Object.entries(state).filter(([key]) => runtimeKeys.has(key)));
  const envelope = { schema: "aidlc.workflow-facts/v1", workflow_id: state.workflow_id, revision: state.revision, updated_at: state.updated_at };
  const changed = !prior || canonical(prior.facts) !== canonical(facts) || canonical(prior.reports) !== canonical(state.history);
  const sources = { ...prior?.report_sources };
  const known = new Set((prior?.reports || []).map((entry: unknown) => hash(canonical(entry))));
  for (const entry of state.history) if (!known.has(hash(canonical(entry))) && reportSources.getStore()) sources[hash(canonical(entry))] = reportSources.getStore();
  const record = { ...envelope, facts, reports: state.history, report_sources: sources, migration: prior?.migration || migration };
  // Migration activates facts LAST: an orphan runtime fails closed for explicit reconciliation.
  // Subsequent reports publish facts FIRST: a crash cannot silently erase a report.
  // Monotonic max(revisions) fences snapshots across either interrupted write.
  if (prior && changed) atomic(root, paths.facts, record);
  atomic(root, paths.runtime, { ...envelope, runtime });
  if (!prior) atomic(root, paths.facts, record);
}

export function factStorageActive(root: string, statePath: string): boolean { return existsSync(workflowFactPaths(root, statePath).facts); }
