/** Shared bounded authoring-source parsing. No workflow or grant authority. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
type Row = Record<string, unknown>;
interface AutonomyInputRef {
 repository_id: "project"; path: string; digest: string; digest_mode: "raw-file" | "json-record-v1";
 selector?: { record_type: string; record_id: string };
}
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ENVELOPE = ["schema", "record_type", "record_id", "workflow_id", "revision", "inputs", "created_at"];
const RECORD_TYPES = new Set(["batch", "unit-extension", "capability", "dependency", "policy", "decision", "grant", "host-capability", "admission", "candidate", "validation-matrix", "observation", "batch-result", "run", "attempt", "host-checkpoint"]);
const BATCH_FIELDS = [...ENVELOPE, "batch_id", "scope_revision", "goal", "scenario_refs", "acceptance_refs", "ui_refs", "units", "dependency_refs", "consumer_closure", "baseline_inputs", "policy_ref", "integration_owner", "validation_matrix_ref", "delivery_artifacts", "supersedes"];
const SOURCES = ["docs/aidlc/ideation/scenario-module-mapping.md", "docs/aidlc/handoff.md"];
const MarkdownIt = createRequire(import.meta.url)("markdown-it") as new () => { parse(text: string, env: object): { type: string; info: string; content: string; map: [number, number]; markup: string }[] };
const markdown = new MarkdownIt();
function fail(message: string, code = "AUTONOMY_SCHEMA_INVALID"): never { throw new Error(`${code}: ${message}`); }
function object(value: unknown, label: string, fields?: string[]): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const row = value as Row;
  if (fields && Object.keys(row).some(key => !fields.includes(key))) fail(`${label} contains unsupported fields`);
  return row;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f]/.test(value)) fail(`${label} must be a nonempty single-line string`);
  return value;
}
function id(value: unknown, label: string): string { const result = string(value, label); if (!ID.test(result)) fail(`${label} is not a valid id`); return result; }
function digest(value: unknown, label: string): string { const result = string(value, label); if (!DIGEST.test(result)) fail(`${label} must be SHA-256`); return result; }
function revision(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) < 1) fail(`${label} must be a positive safe integer`); return value as number; }
function array(value: unknown, label: string, nonempty = false): unknown[] { if (!Array.isArray(value) || nonempty && !value.length) fail(`${label} must be ${nonempty ? "a nonempty" : "an"} array`); return value as unknown[]; }
function unique<T>(values: T[], key: (value: T) => string, label: string): T[] { if (new Set(values.map(key)).size !== values.length) fail(`${label} contains duplicates`); return values; }
export function canonicalAutonomyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAutonomyJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalAutonomyJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function autonomyDigest(value: unknown): string { return createHash("sha256").update(canonicalAutonomyJson(value)).digest("hex"); }

/** Reject portable traversal and every symlink component, before opening any input. */
function safeFile(root: string, label: string): string {
  if (!label || isAbsolute(label) || win32.isAbsolute(label) || /[\\:\u0000-\u001f]/.test(label) || label.split("/").some(part => !part || part === "." || part === "..")) fail(`unsafe input path ${label}`);
  const project = realpathSync(root), target = resolve(project, label), rel = relative(project, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) fail(`input escapes project: ${label}`);
  let current = project;
  for (const part of label.split("/")) {
    current = join(current, part);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) fail(`missing/linked input ${label}`);
  }
  const info = lstatSync(target);
  if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 * 1024) fail(`input must be a bounded regular file: ${label}`);
  return target;
}
function records(root: string, path: string): Row[] {
  const text = readFileSync(safeFile(root, path), "utf8"), lines = text.split(/\r?\n/);
  const fences = markdown.parse(text, {}).filter(token => token.type === "fence" && token.info.trim() === "aidlc-autonomy");
  if (fences.length !== 1) fail(`${path} needs exactly one aidlc-autonomy fence`);
  const token = fences[0];
  if (!new RegExp(`^${token.markup[0]}{${token.markup.length},}\\s*$`).test(lines[token.map[1] - 1] || "")) fail(`unclosed autonomy fence in ${path}`);
  let parsed: unknown;
  try { parsed = JSON.parse(token.content); } catch { fail(`invalid autonomy JSON in ${path}`); }
  const source = object(parsed, path, ["schema", "records"]);
  if (source.schema !== "aidlc.autonomy-source/v1") fail(`unsupported source schema in ${path}`);
  const result = array(source.records, `${path}.records`, true).map(value => {
    const row = object(value, `${path}.record`);
    if (row.schema !== "aidlc.autonomy/v1" || !RECORD_TYPES.has(string(row.record_type, "record_type"))) fail(`unsupported record schema/type in ${path}`);
    id(row.record_id, "record_id"); string(row.workflow_id, "workflow_id"); revision(row.revision, "record revision");
    array(row.inputs, "record inputs", row.record_type !== "host-capability");
    if (row.created_at !== undefined && (typeof row.created_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at)))) fail("created_at must be a UTC RFC3339 time");
    return row;
  });
  return unique(result, row => `${row.record_type}:${row.record_id}`, path);
}
function inputRef(value: unknown): AutonomyInputRef {
  const row = object(value, "InputRef", ["repository_id", "path", "digest", "digest_mode", "selector"]);
  if (row.repository_id !== "project") fail("P1 supports the project repository only");
  string(row.path, "input path"); digest(row.digest, "input digest");
  if (!["raw-file", "json-record-v1"].includes(String(row.digest_mode))) fail("unsupported digest_mode");
  if (row.digest_mode === "json-record-v1") {
    const selector = object(row.selector, "selector", ["record_type", "record_id"]);
    string(selector.record_type, "selector type"); string(selector.record_id, "selector id");
  } else if (row.selector !== undefined) fail("raw-file must not have a selector");
  return row as unknown as AutonomyInputRef;
}

export { object, string, id, digest, revision, array, unique, safeFile, records, inputRef, ENVELOPE, BATCH_FIELDS, SOURCES };
