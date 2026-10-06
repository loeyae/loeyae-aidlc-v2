import { existsSync, lstatSync, readFileSync } from "fs";
import { join } from "path";
import { moduleManifestPath, readModuleManifest } from "./aidlc-execution-context";

/**
 * Canonical stage-graph token for "the project's source code". Stage frontmatter keeps
 * declaring `src/` (so producers/consumers still match by name); the orchestrator
 * resolves it to the real source roots of the project at check time.
 */
export const CANONICAL_SOURCE_PATTERN = "src/";
export const DEFAULT_SOURCE_ROOT = "src";
/** Project-level source-root configuration (used when no module-manifest `paths` apply). */
export const SOURCE_ROOTS_CONFIG = ".aidlc/source-roots.json";

export type SourceRootOrigin = "manifest" | "config" | "default";

export interface SourceRoots {
  roots: string[];
  origin: SourceRootOrigin;
}

/**
 * Normalize one source root to a project-relative POSIX directory. Accepts `\` or `/`
 * separators and trailing separators; rejects absolute paths (POSIX `/x`, Windows
 * `C:\x`, `C:x`, UNC `\\server\share`), `.`/`..` segments, and the AI-DLC control
 * plane (`aidlc/`, `.aidlc/`, `docs/aidlc/`). Symbolic links are rejected when the
 * root is resolved on disk by the orchestrator (assertProjectPath).
 */
export function normalizeSourceRoot(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label}: source root must be a non-empty string`);
  const raw = value.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) throw new Error(`${label}: source root must be project-relative, got ${JSON.stringify(value)}`);
  const path = raw.replace(/\/+$/, "");
  const segments = path.split("/");
  if (!path || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label}: source root must be a normalized project-relative directory without "." or ".." segments, got ${JSON.stringify(value)}`);
  }
  const controlPlane = ["aidlc", ".aidlc", "docs/aidlc"];
  if (controlPlane.some((root) => path === root || path.startsWith(`${root}/`))) {
    throw new Error(`${label}: source root must not point into the AI-DLC control plane, got ${JSON.stringify(value)}`);
  }
  return path;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Characters a nested repository path may use: it is also a key of `Baseline Repos`. */
const NESTED_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * One `source_roots` entry (4.9.0): a string root, or `{ "path": "<dir>", "repo": "nested" }`
 * declaring an independent nested git repository. Objects allow exactly these two keys.
 */
function sourceRootEntry(item: unknown, label: string): { path: string; nested: boolean } {
  if (!item || typeof item !== "object" || Array.isArray(item)) return { path: normalizeSourceRoot(item, label), nested: false };
  const record = item as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "path" || keys[1] !== "repo") {
    throw new Error(`${label}: an object source root must have exactly the keys "path" and "repo" ({ "path": "<dir>", "repo": "nested" }), got ${JSON.stringify(Object.keys(record))}`);
  }
  if (record.repo !== "nested") throw new Error(`${label}: repo must be "nested", got ${JSON.stringify(record.repo)}`);
  const path = normalizeSourceRoot(record.path, label);
  if (!NESTED_PATH_PATTERN.test(path)) throw new Error(`${label}: a nested repository path may only use letters, digits, ".", "_", "-" and "/", got ${JSON.stringify(record.path)}`);
  return { path, nested: true };
}

interface ConfiguredRoots {
  roots: string[];
  nested: string[];
}

function configuredRoots(projectRoot: string): string[] | null {
  return readConfiguredRoots(projectRoot)?.roots ?? null;
}

/**
 * Nested repository paths declared in `.aidlc/source-roots.json` (4.9.0), sorted. Only
 * the declaration is parsed here; nestedSourceRepos() (aidlc-nested-repos) checks the
 * repositories on disk. Nested repositories are project-level topology: they apply even
 * when module-manifest `paths` take priority for the source roots.
 */
export function declaredNestedRoots(projectRoot: string): string[] {
  return [...(readConfiguredRoots(projectRoot)?.nested ?? [])].sort();
}

function readConfiguredRoots(projectRoot: string): ConfiguredRoots | null {
  const path = join(projectRoot, SOURCE_ROOTS_CONFIG);
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${SOURCE_ROOTS_CONFIG} must be a regular non-symlink file`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${SOURCE_ROOTS_CONFIG} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${SOURCE_ROOTS_CONFIG} must be a JSON object`);
  const record = value as Record<string, unknown>;
  if (record.version !== "1") throw new Error(`${SOURCE_ROOTS_CONFIG} version must be "1"`);
  if (!Array.isArray(record.source_roots) || record.source_roots.length === 0) {
    throw new Error(`${SOURCE_ROOTS_CONFIG} source_roots must be a non-empty array of project-relative directories`);
  }
  const entries = record.source_roots.map((item, index) => sourceRootEntry(item, `${SOURCE_ROOTS_CONFIG} source_roots[${index}]`));
  const nested = unique(entries.filter((entry) => entry.nested).map((entry) => entry.path));
  const plain = entries.filter((entry) => !entry.nested).map((entry) => entry.path);
  const both = nested.filter((path) => plain.includes(path));
  if (both.length > 0) throw new Error(`${SOURCE_ROOTS_CONFIG} declares ${both.join(", ")} both as a string root and as a nested repository`);
  return { roots: unique(entries.map((entry) => entry.path)), nested };
}

/**
 * Source roots, by priority:
 *   1. module-manifest `paths` — of `moduleId`, or the union over all modules when no
 *      module is given (project-axis stages);
 *   2. `.aidlc/source-roots.json` `source_roots`;
 *   3. the default `src`.
 * An invalid configuration throws; it never silently falls back to a lower priority.
 */
export function resolveSourceRoots(projectRoot: string, moduleId?: string): SourceRoots {
  if (existsSync(moduleManifestPath(projectRoot))) {
    const modules = readModuleManifest(projectRoot);
    const selected = moduleId ? modules.filter((module) => module.module_id === moduleId) : modules;
    const paths = unique(selected.flatMap((module) => module.paths || []).map((path, index) => normalizeSourceRoot(path, `module-manifest paths[${index}]`)));
    if (paths.length > 0) return { roots: paths, origin: "manifest" };
  }
  const configured = configuredRoots(projectRoot);
  if (configured) return { roots: configured, origin: "config" };
  return { roots: [DEFAULT_SOURCE_ROOT], origin: "default" };
}
