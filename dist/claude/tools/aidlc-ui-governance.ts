import { captureModulePublication, publishScope } from "./aidlc-session";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runSync } from "./aidlc-spawn";
import { resolveDesignResource, verifyDesignResource, verifyDesignResourceConsumption, applyDesignResourceStyle, type DesignResourceLock } from "./aidlc-design-resource.js";
import { verifyExternalUiManifest } from "./aidlc-ui-readonly.js";
import { verifyCreatedUiManifest } from "./aidlc-ui-create.js";

export type UiDesignRoute = "html-mock" | "figma-create" | "figma-existing";
export type UiSourceKind = "prd" | "requirements" | "user-stories" | "page-plan" | "design-decisions";

export interface UiPageRef {
  page_id: string;
  requirements: string[];
  stories: string[];
  acs: string[];
}

export interface UiChangeSet {
  requirements: string[];
  stories: string[];
  acs: string[];
  pages: string[];
}

export interface UiImpactRow {
  page_id: string;
  affected_by_requirements: string[];
  affected_by_stories: string[];
  affected_by_acs: string[];
  affected_by_page_change: boolean;
}

export interface UiImpactMatrix {
  changed_requirements: string[];
  changed_stories: string[];
  changed_acs: string[];
  changed_pages: string[];
  total_pages: number;
  affected_pages: string[];
  unaffected_pages: string[];
  rows: UiImpactRow[];
  unmapped_changes: UiChangeSet;
  all_changes_mapped: boolean;
}

export interface UiSourceSnapshot {
  kind: UiSourceKind;
  path: string;
  sha256: string;
  git_blob: string;
  identifier_digests: Record<string, string>;
}

export interface UiGenerationLock {
  version: "1";
  kind: "aidlc.ui-generation-lock";
  module_id: string;
  route: UiDesignRoute;
  baseline_mode: "generation-start" | "adoption";
  locked_at: string;
  worktree_commit: string;
  upstream: { ref: string; commit: string };
  sources: UiSourceSnapshot[];
  pages: UiPageRef[];
  design_resource?: DesignResourceLock;
  superseded_visual_reviews?: Array<{ run_id: string; section_sha256: string }>;
  adoption?: { approval_ref: string; reason: string };
}

export interface UiTargetedReverification {
  run_id: string;
  completed_at: string;
  result: "passed";
  pages: string[];
  section_sha256: string;
}

export interface UiGenerationAcceptance {
  version: "1";
  kind: "aidlc.ui-generation-acceptance";
  module_id: string;
  route: UiDesignRoute;
  freshness: {
    checked_at: string;
    upstream_ref: string;
    baseline_upstream_commit: string;
    current_upstream_commit: string;
    current_sources: UiSourceSnapshot[];
    changed_paths: string[];
    unclassified_changed_paths: string[];
    changes: UiChangeSet;
    impact_matrix: UiImpactMatrix;
    synchronized_pages: string[];
  };
  full_acceptance: {
    run_id: string;
    completed_at: string;
    result: "passed" | "issues-found";
    reviewed_pages: string[];
    issue_pages: string[];
    report_path: string;
    section_sha256: string;
  };
  targeted_reverifications: UiTargetedReverification[];
  final_status: "passed";
}

/**
 * Effective UI source state after the single full acceptance (MARS-159). The original
 * acceptance stays immutable; later freshness evidence is appended as controlled checkpoints.
 */
export interface UiFreshnessState {
  upstream_commit: string;
  sources: UiSourceSnapshot[];
  pages: UiPageRef[];
}

export interface UiCheckpointReview {
  report_path: string;
  run_id: string;
  completed_at: string;
  pages: string[];
  section_sha256: string;
}

export interface UiFreshnessCheckpoint {
  sequence: number;
  type: "freshness-refresh" | "targeted-reverification";
  created_at: string;
  previous_digest: string;
  upstream_ref: string;
  worktree_commit: string;
  baseline: UiFreshnessState;
  current: UiFreshnessState;
  changed_paths: string[];
  unclassified_changed_paths: string[];
  changes: UiChangeSet;
  impact_matrix: UiImpactMatrix;
  review: UiCheckpointReview | null;
  digest: string;
}

export interface UiGenerationCheckpoints {
  version: "1";
  kind: "aidlc.ui-generation-checkpoints";
  module_id: string;
  route: UiDesignRoute;
  acceptance_digest: string;
  checkpoints: UiFreshnessCheckpoint[];
}

const ID_PATTERN = /\b(?:REQ|FR|US|STORY|AC|PAGE)-[A-Z0-9][A-Z0-9_-]*\b/gi;
const REQUIREMENT_PATTERN = /\b(?:REQ|FR)-[A-Z0-9][A-Z0-9_-]*\b/gi;
const STORY_PATTERN = /\b(?:US|STORY)-[A-Z0-9][A-Z0-9_-]*\b/gi;
const AC_PATTERN = /\bAC-[A-Z0-9][A-Z0-9_-]*\b/gi;
const PAGE_PATTERN = /\bPAGE-[A-Z0-9][A-Z0-9_-]*\b/gi;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_OBJECT_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
const UI_ROUTES = new Set<UiDesignRoute>(["html-mock", "figma-create", "figma-existing"]);
const SOURCE_KINDS = new Set<UiSourceKind>(["prd", "requirements", "user-stories", "page-plan", "design-decisions"]);

function fail(message: string): never {
  throw new Error(message);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
}

function ids(value: string, pattern: RegExp): string[] {
  return normalizedIds(value.match(pattern) || []);
}

function sameStrings(left: string[], right: string[]): boolean {
  return JSON.stringify(normalizedIds(left)) === JSON.stringify(normalizedIds(right));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function requireIso(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) fail(`${field} must be an ISO-8601 timestamp`);
  return value.trim();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function safeProjectFile(projectRoot: string, value: string, field: string): { absolute: string; relative: string } {
  const label = normalizedPath(requireString(value, field));
  if (isAbsolute(label) || label === ".." || label.startsWith("../") || label.includes("/../") || label.includes(":")) {
    fail(`${field} must stay inside the project root: ${value}`);
  }
  const root = realpathSync(resolve(projectRoot));
  const absolute = resolve(root, label);
  const rel = relative(root, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`${field} escapes the project root: ${value}`);
  let cursor = root;
  for (const segment of rel.split(sep)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
    if (lstatSync(cursor).isSymbolicLink()) fail(`${field} traverses a symbolic link: ${label}`);
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) fail(`${field} does not reference a regular file: ${label}`);
  const real = realpathSync(absolute);
  const realRel = relative(root, real);
  if (realRel === ".." || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) fail(`${field} resolves outside the project root: ${label}`);
  return { absolute: real, relative: normalizedPath(rel) };
}

function safeOutputFile(projectRoot: string, value: string, expected: string): string {
  const label = normalizedPath(value);
  if (label !== normalizedPath(expected)) fail(`output must be ${normalizedPath(expected)}`);
  const root = realpathSync(resolve(projectRoot));
  const absolute = resolve(root, label);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`output escapes the project root: ${label}`);
  return absolute;
}

function gitOutput(projectRoot: string, args: string[], field: string, allowFailure = false): string | null {
  const result = runSync("git", args, { cwd: projectRoot, encoding: "utf8", shell: false });
  if (result.error) fail(`${field}: git is unavailable (${result.error.message})`);
  if (result.status !== 0 || typeof result.stdout !== "string") {
    if (allowFailure) return null;
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    fail(`${field}: git ${args.join(" ")} failed${detail ? ` (${detail})` : ""}`);
  }
  return result.stdout.trimEnd();
}

export function resolveGitCommit(projectRoot: string, ref: string): string {
  const value = requireString(ref, "upstream ref");
  if (!REF_PATTERN.test(value) || value.includes("..") || value.startsWith("-")) fail(`invalid upstream ref: ${ref}`);
  const commit = gitOutput(projectRoot, ["rev-parse", "--verify", `${value}^{commit}`], `resolve upstream ref ${value}`)! .trim();
  if (!GIT_OBJECT_PATTERN.test(commit)) fail(`upstream ref ${value} did not resolve to a commit id`);
  return commit;
}

function isGitAncestor(projectRoot: string, ancestor: string, descendant: string): boolean {
  if (!GIT_OBJECT_PATTERN.test(ancestor) || !GIT_OBJECT_PATTERN.test(descendant)) return false;
  const result = runSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: projectRoot, encoding: "utf8", shell: false });
  if (result.error) fail(`verify UI lock ancestry: git is unavailable (${result.error.message})`);
  return result.status === 0;
}

function gitBlobAt(projectRoot: string, commit: string, path: string): string | null {
  if (!GIT_OBJECT_PATTERN.test(commit)) fail(`invalid git commit: ${commit}`);
  const label = normalizedPath(path);
  if (label.includes(":")) fail(`source path cannot contain a colon: ${label}`);
  const blob = gitOutput(projectRoot, ["rev-parse", "--verify", "--quiet", `${commit}:${label}`], `resolve ${label} at ${commit}`, true);
  return blob && GIT_OBJECT_PATTERN.test(blob.trim()) ? blob.trim() : null;
}

function requireCommitObject(projectRoot: string, commit: string, field: string): string {
  if (!GIT_OBJECT_PATTERN.test(commit)) fail(`${field} must be a git commit id`);
  const resolved = gitOutput(projectRoot, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`], field, true);
  if (!resolved || resolved.trim() !== commit) fail(`${field} ${commit} is not available locally; fetch the upstream history before verifying UI freshness`);
  return commit;
}

function gitContentAt(projectRoot: string, commit: string, path: string): string | null {
  if (!GIT_OBJECT_PATTERN.test(commit)) fail(`invalid git commit: ${commit}`);
  const label = normalizedPath(path);
  if (label.includes(":")) fail(`source path cannot contain a colon: ${label}`);
  return gitOutput(projectRoot, ["show", `${commit}:${label}`], `read ${label} at ${commit}`, true);
}

function identifierDigests(content: string): Record<string, string> {
  const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const chunks = new Map<string, Set<string>>();
  const add = (id: string, chunk: string): void => {
    const key = id.toUpperCase();
    if (!chunks.has(key)) chunks.set(key, new Set());
    chunks.get(key)!.add(chunk.trim());
  };
  for (let index = 0; index < lines.length; index++) {
    const lineIds = ids(lines[index], ID_PATTERN);
    if (lineIds.length === 0) continue;
    const heading = lines[index].match(/^(#{1,6})\s+/);
    let chunk = lines[index].trim();
    if (heading) {
      const level = heading[1].length;
      let end = index + 1;
      while (end < lines.length) {
        const next = lines[end].match(/^(#{1,6})\s+/);
        if (next && next[1].length <= level) break;
        end++;
      }
      chunk = lines.slice(index, end).join("\n").trim();
    }
    for (const id of lineIds) add(id, chunk);
  }
  return Object.fromEntries([...chunks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, values]) => [id, sha256([...values].sort().join("\n---\n"))]));
}

function snapshotFromContent(kind: UiSourceKind, path: string, content: string, gitBlob = ""): UiSourceSnapshot {
  return {
    kind,
    path: normalizedPath(path),
    sha256: sha256(Buffer.from(content, "utf8")),
    git_blob: gitBlob,
    identifier_digests: identifierDigests(content),
  };
}

export function snapshotUiSource(projectRoot: string, kind: UiSourceKind, path: string): UiSourceSnapshot {
  const file = safeProjectFile(projectRoot, path, `${kind} source`);
  const content = readFileSync(file.absolute, "utf8").replace(/^\uFEFF/, "");
  const blob = gitOutput(projectRoot, ["hash-object", "--", file.relative], `hash ${file.relative}`)! .trim();
  if (!GIT_OBJECT_PATTERN.test(blob)) fail(`git hash-object returned an invalid id for ${file.relative}`);
  return snapshotFromContent(kind, file.relative, content, blob);
}

function validateSourceSnapshot(raw: unknown, field: string): UiSourceSnapshot {
  const value = requireObject(raw, field);
  const kind = requireString(value.kind, `${field}.kind`) as UiSourceKind;
  if (!SOURCE_KINDS.has(kind)) fail(`${field}.kind is unsupported: ${kind}`);
  const path = normalizedPath(requireString(value.path, `${field}.path`));
  const sourceSha = requireString(value.sha256, `${field}.sha256`);
  const blob = requireString(value.git_blob, `${field}.git_blob`);
  if (!SHA256_PATTERN.test(sourceSha)) fail(`${field}.sha256 must be SHA-256`);
  if (!GIT_OBJECT_PATTERN.test(blob)) fail(`${field}.git_blob must be a git object id`);
  const rawDigests = requireObject(value.identifier_digests, `${field}.identifier_digests`);
  const identifier_digests: Record<string, string> = {};
  for (const [id, digest] of Object.entries(rawDigests)) {
    const normalized = ids(id, ID_PATTERN);
    if (normalized.length !== 1 || normalized[0] !== id.toUpperCase()) fail(`${field}.identifier_digests contains invalid id ${id}`);
    if (typeof digest !== "string" || !SHA256_PATTERN.test(digest)) fail(`${field}.identifier_digests.${id} must be SHA-256`);
    identifier_digests[id.toUpperCase()] = digest;
  }
  return { kind, path, sha256: sourceSha, git_blob: blob, identifier_digests };
}

function pageRefsFromUnknown(value: unknown, field: string): UiPageRef[] {
  const pages = requireArray(value, field).map((raw, index) => {
    const page = requireObject(raw, `${field}[${index}]`);
    const page_id = requireString(page.page_id, `${field}[${index}].page_id`).toUpperCase();
    if (!PAGE_PATTERN.test(page_id)) fail(`${field}[${index}].page_id must be PAGE-*`);
    PAGE_PATTERN.lastIndex = 0;
    const list = (name: string, pattern: RegExp): string[] => {
      const rawList = requireArray(page[name], `${field}[${index}].${name}`);
      const values = normalizedIds(rawList.map((item, itemIndex) => requireString(item, `${field}[${index}].${name}[${itemIndex}]`)));
      for (const id of values) {
        pattern.lastIndex = 0;
        if (!pattern.test(id)) fail(`${field}[${index}].${name} contains invalid id ${id}`);
      }
      pattern.lastIndex = 0;
      return values;
    };
    return { page_id, requirements: list("requirements", REQUIREMENT_PATTERN), stories: list("stories", STORY_PATTERN), acs: list("acs", AC_PATTERN) };
  });
  const duplicate = pages.find((page, index) => pages.findIndex((candidate) => candidate.page_id === page.page_id) !== index);
  if (duplicate) fail(`${field} contains duplicate page ${duplicate.page_id}`);
  return pages.sort((a, b) => a.page_id.localeCompare(b.page_id));
}

export function parseUiPagePlanContent(content: string): UiPageRef[] {
  const pages = new Map<string, UiPageRef>();
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const pageIds = ids(line, PAGE_PATTERN);
    if (pageIds.length === 0) continue;
    const requirements = ids(line, REQUIREMENT_PATTERN);
    const stories = ids(line, STORY_PATTERN);
    const acs = ids(line, AC_PATTERN);
    for (const pageId of pageIds) {
      const existing = pages.get(pageId) || { page_id: pageId, requirements: [], stories: [], acs: [] };
      existing.requirements = normalizedIds([...existing.requirements, ...requirements]);
      existing.stories = normalizedIds([...existing.stories, ...stories]);
      existing.acs = normalizedIds([...existing.acs, ...acs]);
      pages.set(pageId, existing);
    }
  }
  return [...pages.values()].sort((a, b) => a.page_id.localeCompare(b.page_id));
}

export function readUiPagePlan(projectRoot: string, path: string): UiPageRef[] {
  const file = safeProjectFile(projectRoot, path, "page plan");
  const pages = parseUiPagePlanContent(readFileSync(file.absolute, "utf8"));
  if (pages.length === 0) fail(`page plan contains no PAGE identifiers: ${file.relative}`);
  return pages;
}

function mergePageRefs(...sets: UiPageRef[][]): UiPageRef[] {
  const merged = new Map<string, UiPageRef>();
  for (const pages of sets) {
    for (const page of pages) {
      const existing = merged.get(page.page_id) || { page_id: page.page_id, requirements: [], stories: [], acs: [] };
      existing.requirements = normalizedIds([...existing.requirements, ...page.requirements]);
      existing.stories = normalizedIds([...existing.stories, ...page.stories]);
      existing.acs = normalizedIds([...existing.acs, ...page.acs]);
      merged.set(page.page_id, existing);
    }
  }
  return [...merged.values()].sort((a, b) => a.page_id.localeCompare(b.page_id));
}

function emptyChanges(): UiChangeSet {
  return { requirements: [], stories: [], acs: [], pages: [] };
}

function normalizeChanges(changes: Partial<UiChangeSet>): UiChangeSet {
  return {
    requirements: normalizedIds(changes.requirements || []),
    stories: normalizedIds(changes.stories || []),
    acs: normalizedIds(changes.acs || []),
    pages: normalizedIds(changes.pages || []),
  };
}

export function buildUiImpactMatrix(pages: UiPageRef[], rawChanges: Partial<UiChangeSet>): UiImpactMatrix {
  const changes = normalizeChanges(rawChanges);
  const normalizedPages = mergePageRefs(pages);
  const requirementSet = new Set(changes.requirements);
  const storySet = new Set(changes.stories);
  const acSet = new Set(changes.acs);
  const pageSet = new Set(changes.pages);
  const rows: UiImpactRow[] = [];
  for (const page of normalizedPages) {
    const affectedByRequirements = page.requirements.filter((id) => requirementSet.has(id));
    const affectedByStories = page.stories.filter((id) => storySet.has(id));
    const affectedByAcs = page.acs.filter((id) => acSet.has(id));
    const affectedByPage = pageSet.has(page.page_id);
    if (affectedByRequirements.length || affectedByStories.length || affectedByAcs.length || affectedByPage) {
      rows.push({
        page_id: page.page_id,
        affected_by_requirements: affectedByRequirements,
        affected_by_stories: affectedByStories,
        affected_by_acs: affectedByAcs,
        affected_by_page_change: affectedByPage,
      });
    }
  }
  const affectedPages = rows.map((row) => row.page_id);
  const referenced = {
    requirements: new Set(normalizedPages.flatMap((page) => page.requirements)),
    stories: new Set(normalizedPages.flatMap((page) => page.stories)),
    acs: new Set(normalizedPages.flatMap((page) => page.acs)),
    pages: new Set(normalizedPages.map((page) => page.page_id)),
  };
  const unmapped = {
    requirements: changes.requirements.filter((id) => !referenced.requirements.has(id)),
    stories: changes.stories.filter((id) => !referenced.stories.has(id)),
    acs: changes.acs.filter((id) => !referenced.acs.has(id)),
    pages: changes.pages.filter((id) => !referenced.pages.has(id)),
  };
  const allMapped = Object.values(unmapped).every((values) => values.length === 0);
  return {
    changed_requirements: changes.requirements,
    changed_stories: changes.stories,
    changed_acs: changes.acs,
    changed_pages: changes.pages,
    total_pages: normalizedPages.length,
    affected_pages: affectedPages,
    unaffected_pages: normalizedPages.map((page) => page.page_id).filter((id) => !affectedPages.includes(id)),
    rows,
    unmapped_changes: unmapped,
    all_changes_mapped: allMapped,
  };
}

function canonicalModulePath(moduleId: string, file: "lock" | "acceptance" | "page-plan" | "requirements" | "user-stories"): string {
  if (!MODULE_PATTERN.test(moduleId)) fail(`invalid module id: ${moduleId}`);
  const root = `docs/aidlc/modules/${moduleId}/inception`;
  if (file === "requirements") return `${root}/requirements.md`;
  if (file === "user-stories") return `${root}/user-stories.md`;
  if (file === "page-plan") return `${root}/ui-design/page-plan.md`;
  if (file === "lock") return `${root}/ui-design/ui-generation-lock.json`;
  return `${root}/ui-design/ui-generation-acceptance.json`;
}

export function uiGenerationLockPath(moduleId: string): string {
  return canonicalModulePath(moduleId, "lock");
}

export function uiGenerationAcceptancePath(moduleId: string): string {
  return canonicalModulePath(moduleId, "acceptance");
}

function validateRoute(value: unknown, field = "route"): UiDesignRoute {
  const route = requireString(value, field) as UiDesignRoute;
  if (!UI_ROUTES.has(route)) fail(`${field} must be html-mock, figma-create, or figma-existing`);
  return route;
}

function parseLock(raw: unknown): UiGenerationLock {
  const value = requireObject(raw, "UI generation lock");
  if (value.version !== "1" || value.kind !== "aidlc.ui-generation-lock") fail("UI generation lock has an unsupported version or kind");
  const moduleId = requireString(value.module_id, "UI generation lock.module_id");
  if (!MODULE_PATTERN.test(moduleId)) fail("UI generation lock.module_id is invalid");
  const route = validateRoute(value.route, "UI generation lock.route");
  const baselineMode = requireString(value.baseline_mode, "UI generation lock.baseline_mode") as "generation-start" | "adoption";
  if (baselineMode !== "generation-start" && baselineMode !== "adoption") fail("UI generation lock.baseline_mode is invalid");
  const lockedAt = requireIso(value.locked_at, "UI generation lock.locked_at");
  const worktreeCommit = requireString(value.worktree_commit, "UI generation lock.worktree_commit");
  if (!GIT_OBJECT_PATTERN.test(worktreeCommit)) fail("UI generation lock.worktree_commit must be a git commit id");
  const upstreamRaw = requireObject(value.upstream, "UI generation lock.upstream");
  const upstreamRef = requireString(upstreamRaw.ref, "UI generation lock.upstream.ref");
  if (!REF_PATTERN.test(upstreamRef) || upstreamRef.includes("..") || upstreamRef.startsWith("-")) fail("UI generation lock.upstream.ref is invalid");
  const upstreamCommit = requireString(upstreamRaw.commit, "UI generation lock.upstream.commit");
  if (!GIT_OBJECT_PATTERN.test(upstreamCommit)) fail("UI generation lock.upstream.commit must be a git commit id");
  const sources = requireArray(value.sources, "UI generation lock.sources").map((source, index) => validateSourceSnapshot(source, `UI generation lock.sources[${index}]`));
  const duplicatePath = sources.find((source, index) => sources.findIndex((candidate) => candidate.path === source.path) !== index);
  if (duplicatePath) fail(`UI generation lock.sources contains duplicate path ${duplicatePath.path}`);
  for (const required of ["requirements", "user-stories", "page-plan"] as UiSourceKind[]) {
    if (sources.filter((source) => source.kind === required).length !== 1) fail(`UI generation lock.sources must contain exactly one ${required}`);
  }
  const pages = pageRefsFromUnknown(value.pages, "UI generation lock.pages");
  if (pages.length === 0) fail("UI generation lock.pages must not be empty");
  let adoption: UiGenerationLock["adoption"];
  if (baselineMode === "adoption") {
    const rawAdoption = requireObject(value.adoption, "UI generation lock.adoption");
    adoption = {
      approval_ref: requireString(rawAdoption.approval_ref, "UI generation lock.adoption.approval_ref"),
      reason: requireString(rawAdoption.reason, "UI generation lock.adoption.reason"),
    };
  } else if (value.adoption !== undefined) {
    fail("generation-start locks must not contain adoption metadata");
  }
  const superseded = value.superseded_visual_reviews === undefined ? [] : requireArray(value.superseded_visual_reviews, "superseded_visual_reviews").map(raw => {
    const item = requireObject(raw, "superseded visual review");
    const run_id = requireString(item.run_id, "superseded review.run_id");
    const section_sha256 = requireString(item.section_sha256, "superseded review.section_sha256");
    if (!/^[a-f0-9]{64}$/.test(section_sha256)) fail("DESIGN_INVALID_REVIEW_HISTORY");
    return { run_id, section_sha256 };
  });
  return {
    version: "1",
    kind: "aidlc.ui-generation-lock",
    module_id: moduleId,
    route,
    baseline_mode: baselineMode,
    locked_at: lockedAt,
    worktree_commit: worktreeCommit,
    upstream: { ref: upstreamRef, commit: upstreamCommit },
    sources,
    pages,
    ...(value.design_resource !== undefined ? { design_resource: value.design_resource as DesignResourceLock } : {}),
    ...(superseded.length ? { superseded_visual_reviews: superseded } : {}),
    ...(adoption ? { adoption } : {}),
  };
}

export function readUiGenerationLock(projectRoot: string, moduleId: string): { lock: UiGenerationLock; path: string; digest: string } {
  const path = uiGenerationLockPath(moduleId);
  const file = safeProjectFile(projectRoot, path, "UI generation lock");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file.absolute, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`UI generation lock is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const lock = parseLock(raw);
  verifyDesignResource(projectRoot, moduleId, lock.design_resource);
  if (lock.module_id !== moduleId) fail(`UI generation lock.module_id must be ${moduleId}`);
  return { lock, path: file.relative, digest: sha256(canonicalJson(lock)) };
}

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export interface CreateUiLockOptions {
  moduleId: string;
  route: UiDesignRoute;
  upstreamRef?: string;
  prdPath?: string;
  designDecisionsPath?: string;
  adoption?: { approvalRef: string; reason: string };
  now?: string;
  supersededVisualReviews?: UiGenerationLock["superseded_visual_reviews"];
}

export function createUiGenerationLock(projectRoot: string, options: CreateUiLockOptions): UiGenerationLock {
  const publication = captureModulePublication(projectRoot, options.moduleId);
  const root = realpathSync(resolve(projectRoot));
  const moduleId = options.moduleId;
  if (!MODULE_PATTERN.test(moduleId)) fail(`invalid module id: ${moduleId}`);
  const route = validateRoute(options.route);
  const outputLabel = uiGenerationLockPath(moduleId);
  const output = safeOutputFile(root, outputLabel, outputLabel);
  if (existsSync(output)) fail(`UI generation lock already exists and is immutable: ${outputLabel}`);
  const upstreamRef = options.upstreamRef || "origin/main";
  const upstreamCommit = resolveGitCommit(root, upstreamRef);
  const worktreeCommit = resolveGitCommit(root, "HEAD");
  const specs: Array<{ kind: UiSourceKind; path: string }> = [
    { kind: "requirements", path: canonicalModulePath(moduleId, "requirements") },
    { kind: "user-stories", path: canonicalModulePath(moduleId, "user-stories") },
    { kind: "page-plan", path: canonicalModulePath(moduleId, "page-plan") },
  ];
  const defaultPrd = "docs/aidlc/ideation/prd.md";
  const prd = options.prdPath || (existsSync(resolve(root, defaultPrd)) ? defaultPrd : undefined);
  if (prd) specs.unshift({ kind: "prd", path: prd });
  const defaultDecisions = `docs/aidlc/modules/${moduleId}/inception/ui-design/design-decisions.md`;
  const decisions = options.designDecisionsPath || (existsSync(resolve(root, defaultDecisions)) ? defaultDecisions : undefined);
  if (decisions) specs.push({ kind: "design-decisions", path: decisions });
  const sources = specs.map(({ kind, path }) => snapshotUiSource(root, kind, path));
  const pages = readUiPagePlan(root, canonicalModulePath(moduleId, "page-plan"));
  const lockedAt = options.now || new Date().toISOString();
  requireIso(lockedAt, "locked_at");
  let adoption: UiGenerationLock["adoption"];
  if (options.adoption) {
    adoption = {
      approval_ref: requireString(options.adoption.approvalRef, "adoption approval_ref"),
      reason: requireString(options.adoption.reason, "adoption reason"),
    };
  }
  const lock: UiGenerationLock = {
    version: "1",
    kind: "aidlc.ui-generation-lock",
    module_id: moduleId,
    route,
    baseline_mode: adoption ? "adoption" : "generation-start",
    locked_at: lockedAt,
    worktree_commit: worktreeCommit,
    upstream: { ref: upstreamRef, commit: upstreamCommit },
    sources,
    pages,
    design_resource: resolveDesignResource(root, moduleId),
    ...(options.supersededVisualReviews?.length ? { superseded_visual_reviews: options.supersededVisualReviews } : {}),
    ...(adoption ? { adoption } : {}),
  };
  publishScope(projectRoot, publication, () => atomicJson(output, lock));
  return lock;
}

/** Explicit style adoption starts a new visual review, retaining the exact old baseline
 * and acceptance bytes. Ordinary refresh/reverify never replaces resource selections. */
export function rebaselineUiDesignResource(projectRoot: string, moduleId: string): UiGenerationLock {
  const publication = captureModulePublication(projectRoot, moduleId);
  const label = uiGenerationLockPath(moduleId);
  const previous = safeProjectFile(projectRoot, label, label);
  const oldBytes = readFileSync(previous.absolute, "utf8");
  const old = parseLock(JSON.parse(oldBytes));
  if (old.module_id !== moduleId || old.route !== "html-mock") fail("DESIGN_HTML_ROUTE_REQUIRED");
  const next = resolveDesignResource(projectRoot, moduleId);
  if (!next.approval_ref || next.approval_ref === old.design_resource?.approval_ref || next.selection_digest === old.design_resource?.selection_digest) fail("DESIGN_NEW_APPROVAL_REQUIRED");
  // Validate all inputs before moving anything. Keep original source selection semantics.
  const sources = old.sources.map(source => snapshotUiSource(projectRoot, source.kind, source.path));
  if (!sameValue(sources, old.sources)) fail("DESIGN_REBASELINE_REQUIRES_UNCHANGED_BUSINESS_INPUTS");
  readUiPagePlan(projectRoot, canonicalModulePath(moduleId, "page-plan"));
  const observed = resolveGitCommit(projectRoot, old.upstream.ref);
  if (upstreamDrift(projectRoot, old.sources, old.upstream.commit, observed, sources).paths.length > 0) fail("DESIGN_REBASELINE_REQUIRES_UNCHANGED_BUSINESS_INPUTS");
  resolveGitCommit(projectRoot, "HEAD");
  const suffix = `.archived-${sha256(oldBytes)}`;
  const superseded = [...(old.superseded_visual_reviews || [])];
  const acceptanceLabel = uiGenerationAcceptancePath(moduleId);
  if (existsSync(resolve(projectRoot, acceptanceLabel))) {
    const acceptanceFile = safeProjectFile(projectRoot, acceptanceLabel, acceptanceLabel);
    const prior = requireObject(JSON.parse(readFileSync(acceptanceFile.absolute, "utf8")), "prior acceptance");
    const full = requireObject(prior.full_acceptance, "prior full acceptance");
    superseded.push({ run_id: requireString(full.run_id, "prior review run_id"), section_sha256: requireString(full.section_sha256, "prior review digest") });
  }
  const labels = [label, uiGenerationAcceptancePath(moduleId), uiGenerationCheckpointsPath(moduleId)];
  const moves = labels.filter(p => existsSync(resolve(projectRoot, p))).map(p => ({
    from: safeProjectFile(projectRoot, p, p).absolute,
    to: safeOutputFile(projectRoot, p + suffix, p + suffix),
  }));
  if (moves.some(m => existsSync(m.to))) fail("DESIGN_BASELINE_ARCHIVE_EXISTS");
  return publishScope(projectRoot, publication, () => {
    const moved: typeof moves = [];
    try {
      for (const move of moves) { renameSync(move.from, move.to); moved.push(move); }
      return createUiGenerationLock(projectRoot, {
        moduleId, route: old.route, upstreamRef: old.upstream.ref,
        prdPath: old.sources.find(s => s.kind === "prd")?.path,
        designDecisionsPath: old.sources.find(s => s.kind === "design-decisions")?.path,
        supersededVisualReviews: superseded,
      });
    } catch (e) {
      for (const move of moved.reverse()) renameSync(move.to, move.from);
      throw e;
    }
  });
}

export function verifyUiGenerationLockAtBaseline(projectRoot: string, moduleId: string, route: UiDesignRoute, expectedPageIds: string[]): { path: string; digest: string; upstream_ref: string; upstream_commit: string; baseline_mode: string; observed_upstream_commit: string; superseded_by_acceptance: boolean } {
  const root = realpathSync(resolve(projectRoot));
  const loaded = readUiGenerationLock(root, moduleId);
  if (loaded.lock.route !== route) fail(`UI generation lock.route must match selected route ${route}`);
  const currentCommit = resolveGitCommit(root, "HEAD");
  if (!isGitAncestor(root, loaded.lock.worktree_commit, currentCommit)) fail(`UI generation lock.worktree_commit ${loaded.lock.worktree_commit} is not an ancestor of current HEAD ${currentCommit}`);
  const base = { path: loaded.path, digest: loaded.digest, upstream_ref: loaded.lock.upstream.ref, upstream_commit: loaded.lock.upstream.commit, baseline_mode: loaded.lock.baseline_mode };
  const currentSources = loaded.lock.sources.map((source) => snapshotUiSource(root, source.kind, source.path));
  const plan = loaded.lock.sources.find((source) => source.kind === "page-plan")!;
  const currentPages = readUiPagePlan(root, plan.path);
  if (!sameValue(currentSources, loaded.lock.sources) || !sameValue(currentPages, loaded.lock.pages)) {
    // After the single full acceptance, legitimate source changes are carried by the controlled
    // freshness/reverification chain. Without an acceptance record the lock baseline is authoritative.
    if (!existsSync(resolve(root, uiGenerationAcceptancePath(moduleId)))) {
      if (!sameValue(currentSources, loaded.lock.sources)) fail("UI generation lock source hashes do not match the current PRD/requirements/stories/page-plan/design decisions");
      fail("UI generation lock page mapping does not match the current page-plan");
    }
    const accepted = verifyUiGenerationAcceptance(root, moduleId, route, expectedPageIds);
    return { ...base, observed_upstream_commit: accepted.observed_upstream_commit, superseded_by_acceptance: true };
  }
  if (!sameStrings(expectedPageIds, currentPages.map((page) => page.page_id))) fail("UI generation lock pages do not match the page-plan sensor result");
  // The repository-level upstream pointer is an audit observation only: unrelated modules
  // advancing origin/main must not invalidate the lock. Only real upstream content drift of
  // the locked sources (that differs from the locked local content) is stale.
  const observedUpstream = resolveGitCommit(root, loaded.lock.upstream.ref);
  requireCommitObject(root, loaded.lock.upstream.commit, "UI generation lock.upstream.commit");
  const drift = upstreamDrift(root, loaded.lock.sources, loaded.lock.upstream.commit, observedUpstream, currentSources);
  if (drift.paths.length > 0) {
    fail(`UI generation lock is stale before generation: ${loaded.lock.upstream.ref} changed locked UI sources (${drift.paths.join(", ")}) between ${loaded.lock.upstream.commit} and ${observedUpstream}; resolve the upstream change before generating UI`);
  }
  return { ...base, observed_upstream_commit: observedUpstream, superseded_by_acceptance: false };
}

function aggregateIdentifierDigests(sources: UiSourceSnapshot[]): Record<string, string> {
  const rows = new Map<string, string[]>();
  for (const source of sources) {
    for (const [id, digest] of Object.entries(source.identifier_digests)) {
      if (!rows.has(id)) rows.set(id, []);
      rows.get(id)!.push(`${source.path}:${digest}`);
    }
  }
  return Object.fromEntries([...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, values]) => [id, sha256(values.sort().join("\n"))]));
}

function changedIds(left: UiSourceSnapshot[], right: UiSourceSnapshot[]): string[] {
  const before = aggregateIdentifierDigests(left);
  const after = aggregateIdentifierDigests(right);
  return normalizedIds([...new Set([...Object.keys(before), ...Object.keys(after)])].filter((id) => before[id] !== after[id]));
}

function classifyIds(values: string[]): UiChangeSet {
  const result = emptyChanges();
  for (const id of normalizedIds(values)) {
    if (id.startsWith("REQ-") || id.startsWith("FR-")) result.requirements.push(id);
    else if (id.startsWith("US-") || id.startsWith("STORY-")) result.stories.push(id);
    else if (id.startsWith("AC-")) result.acs.push(id);
    else if (id.startsWith("PAGE-")) result.pages.push(id);
  }
  return normalizeChanges(result);
}

function mergeChanges(...sets: UiChangeSet[]): UiChangeSet {
  return normalizeChanges({
    requirements: sets.flatMap((set) => set.requirements),
    stories: sets.flatMap((set) => set.stories),
    acs: sets.flatMap((set) => set.acs),
    pages: sets.flatMap((set) => set.pages),
  });
}

function sourceChanges(left: UiSourceSnapshot[], right: UiSourceSnapshot[]): { paths: string[]; ids: string[]; unclassified: string[] } {
  const leftByPath = new Map(left.map((source) => [source.path, source]));
  const rightByPath = new Map(right.map((source) => [source.path, source]));
  const paths: string[] = [];
  const changed: string[] = [];
  const unclassified: string[] = [];
  for (const path of [...new Set([...leftByPath.keys(), ...rightByPath.keys()])].sort()) {
    const before = leftByPath.get(path);
    const after = rightByPath.get(path);
    if (before?.sha256 === after?.sha256) continue;
    paths.push(path);
    const pathIds = changedIds(before ? [before] : [], after ? [after] : []);
    changed.push(...pathIds);
    if (pathIds.length === 0) unclassified.push(path);
  }
  return { paths, ids: normalizedIds(changed), unclassified };
}

function upstreamSnapshots(projectRoot: string, sources: UiSourceSnapshot[], commit: string): UiSourceSnapshot[] {
  const snapshots: UiSourceSnapshot[] = [];
  for (const source of sources) {
    const content = gitContentAt(projectRoot, commit, source.path);
    if (content !== null) snapshots.push(snapshotFromContent(source.kind, source.path, content, sha256(content)));
  }
  return snapshots;
}

/**
 * Upstream content drift of locked UI sources between two upstream commits. Paths whose
 * upstream blob converged onto the current local content (e.g. this module's own branch was
 * merged) are not drift: they carry nothing the local snapshot does not already contain.
 */
function upstreamDrift(projectRoot: string, reference: UiSourceSnapshot[], fromCommit: string, toCommit: string, local: UiSourceSnapshot[]): { paths: string[]; ids: string[]; unclassified: string[] } {
  if (fromCommit === toCommit) return { paths: [], ids: [], unclassified: [] };
  const before = upstreamSnapshots(projectRoot, reference, fromCommit);
  const after = upstreamSnapshots(projectRoot, reference, toCommit);
  const raw = sourceChanges(before, after);
  const localByPath = new Map(local.map((source) => [source.path, source]));
  const drifted = new Set(raw.paths.filter((path) => {
    const upstreamBlob = gitBlobAt(projectRoot, toCommit, path);
    const localSource = localByPath.get(path);
    return !(upstreamBlob && localSource && upstreamBlob === localSource.git_blob);
  }));
  if (drifted.size === 0) return { paths: [], ids: [], unclassified: [] };
  return sourceChanges(before.filter((source) => drifted.has(source.path)), after.filter((source) => drifted.has(source.path)));
}

function freshnessDiff(projectRoot: string, lock: UiGenerationLock, currentSources: UiSourceSnapshot[], currentUpstreamCommit: string): { changedPaths: string[]; unclassifiedPaths: string[]; changes: UiChangeSet } {
  const local = sourceChanges(lock.sources, currentSources);
  const oldUpstream = upstreamSnapshots(projectRoot, lock.sources, lock.upstream.commit);
  const newUpstream = upstreamSnapshots(projectRoot, lock.sources, currentUpstreamCommit);
  const upstream = sourceChanges(oldUpstream, newUpstream);
  return {
    changedPaths: [...new Set([...local.paths, ...upstream.paths])].sort(),
    unclassifiedPaths: [...new Set([...local.unclassified, ...upstream.unclassified])].sort(),
    changes: mergeChanges(classifyIds(local.ids), classifyIds(upstream.ids)),
  };
}

function markdownSections(content: string, heading: RegExp): string[] {
  const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const sections: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match || !heading.test(match[2])) continue;
    const level = match[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end].match(/^(#{1,6})\s+/);
      if (next && next[1].length <= level) break;
      end++;
    }
    sections.push(lines.slice(index, end).join("\n").trim());
  }
  return sections;
}

function sectionField(section: string, name: string, required = true): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = section.match(new RegExp(`^\\s*[-*]\\s*${escaped}\\s*[:：]\\s*(.+?)\\s*$`, "im"))?.[1]?.trim();
  if (required && !value) fail(`UI acceptance report section is missing ${name}`);
  return value;
}

function listField(section: string, name: string): string[] {
  const value = sectionField(section, name)!;
  if (/^(?:none|无|n\/a|—|-)[。.]?$/i.test(value)) return [];
  return normalizedIds(value.split(/[，,\s]+/).filter(Boolean));
}

function parseReviewReport(projectRoot: string, reportPath: string, expectedPages: string[]): {
  reportPath: string;
  freshnessCheckedAt: string;
  synchronizedPages: string[];
  full: UiGenerationAcceptance["full_acceptance"];
  targeted: UiTargetedReverification[];
} {
  const reportFile = safeProjectFile(projectRoot, reportPath, "UI acceptance report");
  const content = readFileSync(reportFile.absolute, "utf8");
  const freshnessSections = markdownSections(content, /^UI requirement freshness$/i);
  if (freshnessSections.length !== 1) fail("cross-validation report must contain exactly one '## UI requirement freshness' section");
  const fullSections = markdownSections(content, /^UI full acceptance$/i);
  if (fullSections.length !== 1) fail("cross-validation report must contain exactly one '## UI full acceptance' section");
  const freshness = freshnessSections[0];
  const fullSection = fullSections[0];
  const runId = requireString(sectionField(fullSection, "run_id"), "UI full acceptance.run_id");
  const completedAt = requireIso(sectionField(fullSection, "completed_at"), "UI full acceptance.completed_at");
  const result = requireString(sectionField(fullSection, "result"), "UI full acceptance.result") as "passed" | "issues-found";
  if (result !== "passed" && result !== "issues-found") fail("UI full acceptance.result must be passed or issues-found");
  const reviewedPages = listField(fullSection, "reviewed_pages");
  if (!sameStrings(reviewedPages, expectedPages)) fail(`UI full acceptance.reviewed_pages must exactly match page plan: ${normalizedIds(expectedPages).join(", ")}`);
  const issuePages = listField(fullSection, "issue_pages");
  if (issuePages.some((page) => !reviewedPages.includes(page))) fail("UI full acceptance.issue_pages must be a subset of reviewed_pages");
  if (result === "passed" && issuePages.length > 0) fail("a passed full acceptance must not list issue_pages");
  if (result === "issues-found" && issuePages.length === 0) fail("issues-found full acceptance must list issue_pages");
  const targeted = markdownSections(content, /^UI targeted reverification(?:\s+.+)?$/i).map((section, index) => {
    const targetedResult = requireString(sectionField(section, "result"), `UI targeted reverification[${index}].result`);
    if (targetedResult !== "passed") fail(`UI targeted reverification[${index}].result must be passed`);
    const pages = listField(section, "pages");
    if (pages.length === 0) fail(`UI targeted reverification[${index}].pages must not be empty`);
    if (pages.some((page) => !issuePages.includes(page))) fail(`UI targeted reverification[${index}] may only cover full-acceptance issue_pages`);
    return {
      run_id: requireString(sectionField(section, "run_id"), `UI targeted reverification[${index}].run_id`),
      completed_at: requireIso(sectionField(section, "completed_at"), `UI targeted reverification[${index}].completed_at`),
      result: "passed" as const,
      pages,
      section_sha256: sha256(section),
    };
  });
  const targetedIds = targeted.map((entry) => entry.run_id);
  if (new Set(targetedIds).size !== targetedIds.length) fail("UI targeted reverification run_id values must be unique");
  const reverifiedPages = normalizedIds(targeted.flatMap((entry) => entry.pages));
  if (result === "issues-found" && !sameStrings(reverifiedPages, issuePages)) fail("targeted reverifications must cover every and only full-acceptance issue_page");
  if (result === "passed" && targeted.length > 0) fail("a passed full acceptance must not add targeted reverification runs");
  return {
    reportPath: reportFile.relative,
    freshnessCheckedAt: requireIso(sectionField(freshness, "checked_at"), "UI requirement freshness.checked_at"),
    synchronizedPages: listField(freshness, "synchronized_pages"),
    full: {
      run_id: runId,
      completed_at: completedAt,
      result,
      reviewed_pages: reviewedPages,
      issue_pages: issuePages,
      report_path: reportFile.relative,
      section_sha256: sha256(fullSection),
    },
    targeted,
  };
}

function verifyLockedHtmlResources(projectRoot: string, moduleId: string, lock: UiGenerationLock): void {
  if (!lock.design_resource || lock.route !== "html-mock") return;
  const prefix = `docs/aidlc/modules/${moduleId}/inception/ui-mock/`;
  const manifest = safeProjectFile(projectRoot, prefix + "ui-mock-manifest.json", "UI mock manifest");
  const pages = requireArray(requireObject(JSON.parse(readFileSync(manifest.absolute, "utf8")), "UI manifest").pages, "UI manifest.pages");
  if (pages.length === 0) fail("DESIGN_TOKENS_NOT_CONSUMED");
  for (const raw of pages) {
    const page = requireObject(raw, "UI page"), path = requireString(page.html, "UI page.html");
    if (!path.startsWith(prefix) || !path.endsWith(".html")) fail("DESIGN_INVALID_HTML_TARGET");
    const html = safeProjectFile(projectRoot, path, "UI HTML");
    verifyDesignResourceConsumption(projectRoot, moduleId, lock.design_resource, readFileSync(html.absolute, "utf8"));
  }
}

function buildExpectedAcceptance(projectRoot: string, moduleId: string, route: UiDesignRoute, reportPath: string, recordedUpstreamCommit?: string): UiGenerationAcceptance {
  const root = realpathSync(resolve(projectRoot));
  if (route === "figma-existing") verifyExternalUiReview(root, moduleId, reportPath);
  if (route === "figma-create") verifyCreatedUiReview(root, moduleId, reportPath);
  const loaded = readUiGenerationLock(root, moduleId);
  verifyLockedHtmlResources(root, moduleId, loaded.lock);
  if (loaded.lock.route !== route) fail(`UI generation lock.route must match selected route ${route}`);
  // At `ui accept` the live upstream is recorded. Verification recomputes against the recorded
  // commit so a repository-level pointer advance alone never invalidates the acceptance.
  const currentUpstream = recordedUpstreamCommit
    ? requireCommitObject(root, recordedUpstreamCommit, "UI generation acceptance.freshness.current_upstream_commit")
    : resolveGitCommit(root, loaded.lock.upstream.ref);
  const currentSources = loaded.lock.sources.map((source) => snapshotUiSource(root, source.kind, source.path));
  const diff = freshnessDiff(root, loaded.lock, currentSources, currentUpstream);
  if (diff.unclassifiedPaths.length > 0) {
    fail(`UI freshness found changed source text with no machine ID classification: ${diff.unclassifiedPaths.join(", ")}; add REQ/FR, US/STORY, AC, or PAGE identifiers before acceptance`);
  }
  const pageSource = currentSources.find((source) => source.kind === "page-plan");
  if (!pageSource) fail("UI generation lock has no page-plan source");
  const currentPages = readUiPagePlan(root, pageSource.path);
  const pages = mergePageRefs(loaded.lock.pages, currentPages);
  const impact = buildUiImpactMatrix(pages, diff.changes);
  if (!impact.all_changes_mapped) {
    const labels = Object.entries(impact.unmapped_changes).filter(([, values]) => values.length > 0).map(([kind, values]) => `${kind}: ${(values as string[]).join(", ")}`);
    fail(`UI impact matrix has unmapped requirement changes (${labels.join("; ")}); update page-plan or explicitly mark non-UI stories before acceptance`);
  }
  const review = parseReviewReport(root, reportPath, currentPages.map((page) => page.page_id));
  if (loaded.lock.superseded_visual_reviews?.some(prior => prior.run_id === review.full.run_id || prior.section_sha256 === review.full.section_sha256)) fail("DESIGN_NEW_VISUAL_REVIEW_REQUIRED");
  if (!sameStrings(review.synchronizedPages, impact.affected_pages)) {
    fail(`UI requirement freshness.synchronized_pages must exactly match affected pages: ${impact.affected_pages.join(", ") || "none"}`);
  }
  return {
    version: "1",
    kind: "aidlc.ui-generation-acceptance",
    module_id: moduleId,
    route,
    freshness: {
      checked_at: review.freshnessCheckedAt,
      upstream_ref: loaded.lock.upstream.ref,
      baseline_upstream_commit: loaded.lock.upstream.commit,
      current_upstream_commit: currentUpstream,
      current_sources: currentSources,
      changed_paths: diff.changedPaths,
      unclassified_changed_paths: [],
      changes: diff.changes,
      impact_matrix: impact,
      synchronized_pages: review.synchronizedPages,
    },
    full_acceptance: review.full,
    targeted_reverifications: review.targeted,
    final_status: "passed",
  };
}

/** A changed remote read generation needs a review of those exact registered bytes. */
function verifyExternalUiReview(root: string, moduleId: string, reportPath: string): void {
  verifyExternalUiManifest(root, moduleId);
  const manifest = safeProjectFile(root, `docs/aidlc/modules/${moduleId}/inception/ui-design/figma-manifest.json`, "Figma manifest");
  const report = safeProjectFile(root, reportPath, "UI review report");
  const sections = markdownSections(readFileSync(report.absolute, "utf8"), /^UI full acceptance$/i);
  if (sections.length !== 1 || sectionField(sections[0], "figma_manifest_sha256") !== sha256(readFileSync(manifest.absolute))) fail("UI_READ_NEW_VISUAL_REVIEW_REQUIRED");
}

function verifyCreatedUiReview(root: string, moduleId: string, reportPath: string): void {
  verifyCreatedUiManifest(root, moduleId);
  const manifest = safeProjectFile(root, `docs/aidlc/modules/${moduleId}/inception/ui-design/figma-manifest.json`, "Figma manifest");
  const report = safeProjectFile(root, reportPath, "UI review report");
  const sections = markdownSections(readFileSync(report.absolute, "utf8"), /^UI full acceptance$/i);
  if (sections.length !== 1 || sectionField(sections[0], "figma_manifest_sha256") !== sha256(readFileSync(manifest.absolute))) fail("UI_WRITE_NEW_VISUAL_REVIEW_REQUIRED");
}

export interface CreateUiAcceptanceOptions {
  moduleId: string;
  route: UiDesignRoute;
  reportPath?: string;
}

export function createUiGenerationAcceptance(projectRoot: string, options: CreateUiAcceptanceOptions): UiGenerationAcceptance {
  const publication = captureModulePublication(projectRoot, options.moduleId);
  const root = realpathSync(resolve(projectRoot));
  if (options.route === "figma-existing") verifyExternalUiManifest(root, options.moduleId);
  if (options.route === "figma-create") verifyCreatedUiManifest(root, options.moduleId);
  const outputLabel = uiGenerationAcceptancePath(options.moduleId);
  const output = safeOutputFile(root, outputLabel, outputLabel);
  if (existsSync(output)) fail(`UI full acceptance is already recorded; a second full acceptance is forbidden: ${outputLabel}`);
  const reportPath = options.reportPath || `docs/aidlc/modules/${options.moduleId}/inception/cross-validation-report.md`;
  const acceptance = buildExpectedAcceptance(root, options.moduleId, validateRoute(options.route), reportPath);
  publishScope(projectRoot, publication, () => atomicJson(output, acceptance));
  return acceptance;
}

function parseAcceptance(raw: unknown): UiGenerationAcceptance {
  const value = requireObject(raw, "UI generation acceptance");
  if (value.version !== "1" || value.kind !== "aidlc.ui-generation-acceptance") fail("UI generation acceptance has an unsupported version or kind");
  const moduleId = requireString(value.module_id, "UI generation acceptance.module_id");
  const route = validateRoute(value.route, "UI generation acceptance.route");
  const freshness = requireObject(value.freshness, "UI generation acceptance.freshness");
  const full = requireObject(value.full_acceptance, "UI generation acceptance.full_acceptance");
  const targeted = requireArray(value.targeted_reverifications, "UI generation acceptance.targeted_reverifications");
  if (value.final_status !== "passed") fail("UI generation acceptance.final_status must be passed");
  // Full semantic validation is performed by deterministic recomputation below. This shape
  // check intentionally rejects the former array form: the schema can contain only one full run.
  if (Array.isArray(value.full_acceptance)) fail("UI generation acceptance may contain only one full acceptance run");
  requireIso(freshness.checked_at, "UI generation acceptance.freshness.checked_at");
  requireString(full.report_path, "UI generation acceptance.full_acceptance.report_path");
  for (const [index, entry] of targeted.entries()) requireObject(entry, `UI generation acceptance.targeted_reverifications[${index}]`);
  return value as unknown as UiGenerationAcceptance;
}

export function uiGenerationCheckpointsPath(moduleId: string): string {
  return uiGenerationAcceptancePath(moduleId).replace(/ui-generation-acceptance\.json$/, "ui-generation-checkpoints.json");
}

function readAcceptanceFile(root: string, moduleId: string, route: UiDesignRoute): { acceptance: UiGenerationAcceptance; path: string; digest: string } {
  const file = safeProjectFile(root, uiGenerationAcceptancePath(moduleId), "UI generation acceptance");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file.absolute, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`UI generation acceptance is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const acceptance = parseAcceptance(raw);
  if (acceptance.module_id !== moduleId) fail(`UI generation acceptance.module_id must be ${moduleId}`);
  if (acceptance.route !== route) fail(`UI generation acceptance.route must match selected route ${route}`);
  const freshness = acceptance.freshness as unknown as Record<string, unknown>;
  requireString(freshness.current_upstream_commit, "UI generation acceptance.freshness.current_upstream_commit");
  requireArray(freshness.current_sources, "UI generation acceptance.freshness.current_sources");
  return { acceptance, path: file.relative, digest: sha256(canonicalJson(acceptance)) };
}

function checkpointDigest(checkpoint: Omit<UiFreshnessCheckpoint, "digest"> | UiFreshnessCheckpoint): string {
  const { digest: _digest, ...body } = checkpoint as UiFreshnessCheckpoint;
  return sha256(canonicalJson(body));
}

function parseFreshnessState(raw: unknown, field: string): UiFreshnessState {
  const value = requireObject(raw, field);
  const upstream = requireString(value.upstream_commit, `${field}.upstream_commit`);
  if (!GIT_OBJECT_PATTERN.test(upstream)) fail(`${field}.upstream_commit must be a git commit id`);
  const sources = requireArray(value.sources, `${field}.sources`).map((source, index) => validateSourceSnapshot(source, `${field}.sources[${index}]`));
  const pages = pageRefsFromUnknown(value.pages, `${field}.pages`);
  return { upstream_commit: upstream, sources, pages };
}

function parseCheckpoints(raw: unknown, moduleId: string, route: UiDesignRoute): UiGenerationCheckpoints {
  const value = requireObject(raw, "UI generation checkpoints");
  if (value.version !== "1" || value.kind !== "aidlc.ui-generation-checkpoints") fail("UI generation checkpoints has an unsupported version or kind");
  if (value.module_id !== moduleId) fail(`UI generation checkpoints.module_id must be ${moduleId}`);
  if (validateRoute(value.route, "UI generation checkpoints.route") !== route) fail(`UI generation checkpoints.route must match selected route ${route}`);
  const acceptanceDigest = requireString(value.acceptance_digest, "UI generation checkpoints.acceptance_digest");
  if (!SHA256_PATTERN.test(acceptanceDigest)) fail("UI generation checkpoints.acceptance_digest must be SHA-256");
  const checkpoints = requireArray(value.checkpoints, "UI generation checkpoints.checkpoints").map((entry, index) => {
    const field = `UI generation checkpoints.checkpoints[${index}]`;
    const cp = requireObject(entry, field);
    const type = requireString(cp.type, `${field}.type`);
    if (type !== "freshness-refresh" && type !== "targeted-reverification") fail(`${field}.type is unsupported: ${type}`);
    for (const name of ["previous_digest", "digest"]) {
      if (!SHA256_PATTERN.test(requireString(cp[name], `${field}.${name}`))) fail(`${field}.${name} must be SHA-256`);
    }
    if (cp.sequence !== index + 1) fail(`${field}.sequence must be ${index + 1}`);
    requireIso(cp.created_at, `${field}.created_at`);
    requireString(cp.upstream_ref, `${field}.upstream_ref`);
    if (!GIT_OBJECT_PATTERN.test(requireString(cp.worktree_commit, `${field}.worktree_commit`))) fail(`${field}.worktree_commit must be a git commit id`);
    parseFreshnessState(cp.baseline, `${field}.baseline`);
    parseFreshnessState(cp.current, `${field}.current`);
    requireArray(cp.changed_paths, `${field}.changed_paths`);
    requireArray(cp.unclassified_changed_paths, `${field}.unclassified_changed_paths`);
    requireObject(cp.changes, `${field}.changes`);
    requireObject(cp.impact_matrix, `${field}.impact_matrix`);
    if (type === "targeted-reverification") {
      const review = requireObject(cp.review, `${field}.review`);
      requireString(review.report_path, `${field}.review.report_path`);
      requireString(review.run_id, `${field}.review.run_id`);
      requireIso(review.completed_at, `${field}.review.completed_at`);
      requireArray(review.pages, `${field}.review.pages`);
      if (!SHA256_PATTERN.test(requireString(review.section_sha256, `${field}.review.section_sha256`))) fail(`${field}.review.section_sha256 must be SHA-256`);
    } else if (cp.review !== null) {
      fail(`${field}.review must be null for a freshness-refresh checkpoint`);
    }
    return cp as unknown as UiFreshnessCheckpoint;
  });
  return { version: "1", kind: "aidlc.ui-generation-checkpoints", module_id: moduleId, route, acceptance_digest: acceptanceDigest, checkpoints };
}

function readCheckpointsFile(root: string, moduleId: string, route: UiDesignRoute): UiGenerationCheckpoints | null {
  const label = uiGenerationCheckpointsPath(moduleId);
  if (!existsSync(resolve(root, label))) return null;
  const file = safeProjectFile(root, label, "UI generation checkpoints");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file.absolute, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`UI generation checkpoints is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseCheckpoints(raw, moduleId, route);
}

/** Section `## UI freshness reverification <run_id>` of a review report; distinct from the full-acceptance targeted runs. */
function freshnessReverificationSections(root: string, reportPath: string): Array<{ report_path: string; run_id: string; completed_at: string; result: string; pages: string[]; section_sha256: string }> {
  const reportFile = safeProjectFile(root, reportPath, "UI freshness reverification report");
  const content = readFileSync(reportFile.absolute, "utf8");
  return markdownSections(content, /^UI freshness reverification(?:\s+.+)?$/i).map((section, index) => ({
    report_path: reportFile.relative,
    run_id: requireString(sectionField(section, "run_id"), `UI freshness reverification[${index}].run_id`),
    completed_at: requireIso(sectionField(section, "completed_at"), `UI freshness reverification[${index}].completed_at`),
    result: requireString(sectionField(section, "result"), `UI freshness reverification[${index}].result`),
    pages: listField(section, "pages"),
    section_sha256: sha256(section),
  }));
}

function acceptanceState(acceptance: UiGenerationAcceptance, pages: UiPageRef[]): UiFreshnessState {
  return { upstream_commit: acceptance.freshness.current_upstream_commit, sources: acceptance.freshness.current_sources, pages };
}

/** Deterministic freshness delta between a recorded state and a newer state. */
function computeFreshnessDelta(root: string, lock: UiGenerationLock, baseline: UiFreshnessState, current: UiFreshnessState): {
  changed_paths: string[];
  unclassified_changed_paths: string[];
  changes: UiChangeSet;
  impact_matrix: UiImpactMatrix;
} {
  requireCommitObject(root, baseline.upstream_commit, "UI freshness baseline upstream commit");
  requireCommitObject(root, current.upstream_commit, "UI freshness current upstream commit");
  const local = sourceChanges(baseline.sources, current.sources);
  const upstream = upstreamDrift(root, lock.sources, baseline.upstream_commit, current.upstream_commit, current.sources);
  const changes = mergeChanges(classifyIds(local.ids), classifyIds(upstream.ids));
  return {
    changed_paths: [...new Set([...local.paths, ...upstream.paths])].sort(),
    unclassified_changed_paths: [...new Set([...local.unclassified, ...upstream.unclassified])].sort(),
    changes,
    impact_matrix: buildUiImpactMatrix(mergePageRefs(baseline.pages, current.pages), changes),
  };
}

function liveFreshnessState(root: string, lock: UiGenerationLock): { state: UiFreshnessState; observed: string } {
  const observed = resolveGitCommit(root, lock.upstream.ref);
  const sources = lock.sources.map((source) => snapshotUiSource(root, source.kind, source.path));
  const plan = sources.find((source) => source.kind === "page-plan")!;
  return { state: { upstream_commit: observed, sources, pages: readUiPagePlan(root, plan.path) }, observed };
}

interface VerifiedChain {
  lock: UiGenerationLock;
  acceptance: UiGenerationAcceptance;
  acceptancePath: string;
  acceptanceDigest: string;
  checkpoints: UiGenerationCheckpoints | null;
  effective: UiFreshnessState;
  headDigest: string;
  runIds: Set<string>;
}

/**
 * Verifies the immutable full acceptance plus the append-only checkpoint chain. Every recorded
 * delta is recomputed from recorded snapshots and git objects; review sections are re-hashed.
 */
function verifyAcceptanceChain(root: string, moduleId: string, route: UiDesignRoute): VerifiedChain {
  const loadedLock = readUiGenerationLock(root, moduleId);
  if (loadedLock.lock.route !== route) fail(`UI generation lock.route must match selected route ${route}`);
  const lock = loadedLock.lock;
  const { acceptance, path, digest } = readAcceptanceFile(root, moduleId, route);
  const checkpoints = readCheckpointsFile(root, moduleId, route);
  const runIds = new Set<string>([acceptance.full_acceptance.run_id, ...(acceptance.targeted_reverifications || []).map((entry) => entry.run_id)]);
  if (!checkpoints || checkpoints.checkpoints.length === 0) {
    if (checkpoints && checkpoints.acceptance_digest !== digest) fail("UI generation checkpoints do not belong to the recorded full acceptance");
    const expected = buildExpectedAcceptance(root, moduleId, route, acceptance.full_acceptance.report_path, acceptance.freshness.current_upstream_commit);
    if (!sameValue(acceptance, expected)) {
      fail("UI generation acceptance does not match current source revisions, impact matrix, or review report; a second full acceptance is forbidden — record the change with the controlled 'ui reverify' (sources changed) or 'ui refresh' (pointer only) command");
    }
    return { lock, acceptance, acceptancePath: path, acceptanceDigest: digest, checkpoints, effective: acceptanceState(acceptance, readUiPagePlan(root, acceptance.freshness.current_sources.find((source) => source.kind === "page-plan")!.path)), headDigest: digest, runIds };
  }
  if (checkpoints.acceptance_digest !== digest) fail("UI generation checkpoints do not belong to the recorded full acceptance (acceptance digest mismatch)");
  // The original acceptance cannot be recomputed against live inputs once sources legitimately
  // moved on; verify its recorded deltas and its still-present full acceptance review section.
  const original = freshnessDiff(root, lock, acceptance.freshness.current_sources, requireCommitObject(root, acceptance.freshness.current_upstream_commit, "UI generation acceptance.freshness.current_upstream_commit"));
  if (!sameValue(original.changedPaths, [...acceptance.freshness.changed_paths].sort()) || !sameValue(original.changes, acceptance.freshness.changes)) {
    fail("UI generation acceptance freshness record does not match its recorded source snapshots");
  }
  const reportFile = safeProjectFile(root, acceptance.full_acceptance.report_path, "UI acceptance report");
  const fullSections = markdownSections(readFileSync(reportFile.absolute, "utf8"), /^UI full acceptance$/i);
  if (fullSections.length !== 1 || sha256(fullSections[0]) !== acceptance.full_acceptance.section_sha256) fail("UI full acceptance review section changed after acceptance");
  // The acceptance-time page mapping is bound by the page-plan snapshot (verified live when the
  // chain was first extended) and by the checkpoint digest chain.
  let previous = acceptanceState(acceptance, parseFreshnessState(checkpoints.checkpoints[0].baseline, "UI generation checkpoint #1.baseline").pages);
  let previousDigest = digest;
  for (const [index, checkpoint] of checkpoints.checkpoints.entries()) {
    const label = `UI generation checkpoint #${index + 1}`;
    if (checkpoint.previous_digest !== previousDigest) fail(`${label} does not chain to the previous record`);
    if (checkpointDigest(checkpoint) !== checkpoint.digest) fail(`${label} digest does not match its content (controlled record was modified)`);
    if (checkpoint.upstream_ref !== lock.upstream.ref) fail(`${label}.upstream_ref must be ${lock.upstream.ref}`);
    const baseline = parseFreshnessState(checkpoint.baseline, `${label}.baseline`);
    const current = parseFreshnessState(checkpoint.current, `${label}.current`);
    if (!sameValue(baseline, previous)) fail(`${label}.baseline does not equal the previous effective state`);
    const delta = computeFreshnessDelta(root, lock, baseline, current);
    if (!sameValue(delta.changed_paths, checkpoint.changed_paths) || !sameValue(delta.unclassified_changed_paths, checkpoint.unclassified_changed_paths) || !sameValue(delta.changes, checkpoint.changes) || !sameValue(delta.impact_matrix, checkpoint.impact_matrix)) {
      fail(`${label} freshness delta does not match its recorded snapshots`);
    }
    if (checkpoint.type === "freshness-refresh") {
      if (delta.changed_paths.length > 0) fail(`${label} is a freshness-refresh but locked UI sources changed`);
    } else {
      if (delta.changed_paths.length === 0) fail(`${label} is a targeted-reverification without source changes`);
      if (delta.unclassified_changed_paths.length > 0 || !delta.impact_matrix.all_changes_mapped) fail(`${label} contains unclassified or unmapped changes`);
      const review = checkpoint.review!;
      if (!sameStrings(review.pages, delta.impact_matrix.affected_pages)) fail(`${label}.review.pages must exactly match affected pages`);
      if (runIds.has(review.run_id)) fail(`${label}.review.run_id ${review.run_id} is reused`);
      runIds.add(review.run_id);
      const section = freshnessReverificationSections(root, review.report_path).filter((entry) => entry.run_id === review.run_id);
      if (section.length !== 1) fail(`${label} review section ${review.run_id} is missing or duplicated in ${review.report_path}`);
      if (section[0].section_sha256 !== review.section_sha256 || section[0].result !== "passed" || !sameStrings(section[0].pages, review.pages)) {
        fail(`${label} review section ${review.run_id} changed after the checkpoint was recorded`);
      }
    }
    previous = current;
    previousDigest = checkpoint.digest;
  }
  return { lock, acceptance, acceptancePath: path, acceptanceDigest: digest, checkpoints, effective: previous, headDigest: previousDigest, runIds };
}

export function verifyUiGenerationAcceptance(projectRoot: string, moduleId: string, route: UiDesignRoute, expectedPageIds: string[]): {
  lock_path: string;
  lock_digest: string;
  acceptance_path: string;
  acceptance_digest: string;
  upstream_ref: string;
  baseline_upstream_commit: string;
  current_upstream_commit: string;
  observed_upstream_commit: string;
  changed_paths: string[];
  affected_pages: string[];
  full_acceptance_runs: 1;
  targeted_reverification_runs: number;
  freshness_checkpoints: number;
  checkpoint_head_digest: string;
} {
  const root = realpathSync(resolve(projectRoot));
  const loadedLock = readUiGenerationLock(root, moduleId);
  if (route === "figma-existing") verifyExternalUiManifest(root, moduleId);
  if (route === "figma-create") verifyCreatedUiManifest(root, moduleId);
  verifyLockedHtmlResources(root, moduleId, loadedLock.lock);
  const chain = verifyAcceptanceChain(root, moduleId, route);
  if (route === "figma-existing") verifyExternalUiReview(root, moduleId, chain.acceptance.full_acceptance.report_path);
  if (route === "figma-create") verifyCreatedUiReview(root, moduleId, chain.acceptance.full_acceptance.report_path);
  const live = liveFreshnessState(root, chain.lock);
  if (!sameValue(live.state.sources, chain.effective.sources) || !sameValue(live.state.pages, chain.effective.pages)) {
    fail("UI generation acceptance does not match current source revisions; record mapped changes with the controlled 'ui reverify' command (a second full acceptance is forbidden)");
  }
  // Repository-level pointer advance is audit-only; only content drift of locked sources counts.
  const drift = upstreamDrift(root, chain.lock.sources, chain.effective.upstream_commit, live.observed, live.state.sources);
  if (drift.paths.length > 0) {
    fail(`UI generation acceptance does not match current source revisions: ${chain.lock.upstream.ref} changed locked UI sources (${drift.paths.join(", ")}); run the controlled 'ui reverify' command`);
  }
  if (!sameStrings(live.state.pages.map((page) => page.page_id), expectedPageIds)) fail("UI acceptance pages do not match the selected design manifest/page plan");
  const checkpoints = chain.checkpoints?.checkpoints || [];
  return {
    lock_path: loadedLock.path,
    lock_digest: loadedLock.digest,
    acceptance_path: chain.acceptancePath,
    acceptance_digest: chain.acceptanceDigest,
    upstream_ref: chain.acceptance.freshness.upstream_ref,
    baseline_upstream_commit: chain.acceptance.freshness.baseline_upstream_commit,
    current_upstream_commit: chain.effective.upstream_commit,
    observed_upstream_commit: live.observed,
    changed_paths: [...new Set([...chain.acceptance.freshness.changed_paths, ...checkpoints.flatMap((entry) => entry.changed_paths)])].sort(),
    affected_pages: normalizedIds([...chain.acceptance.freshness.impact_matrix.affected_pages, ...checkpoints.flatMap((entry) => entry.impact_matrix.affected_pages)]),
    full_acceptance_runs: 1,
    targeted_reverification_runs: chain.acceptance.targeted_reverifications.length + checkpoints.filter((entry) => entry.type === "targeted-reverification").length,
    freshness_checkpoints: checkpoints.length,
    checkpoint_head_digest: chain.headDigest,
  };
}

export interface UiCheckpointOptions {
  moduleId: string;
  route: UiDesignRoute;
  reportPath?: string;
  now?: string;
}

function appendCheckpoint(root: string, chain: VerifiedChain, moduleId: string, route: UiDesignRoute, body: Omit<UiFreshnessCheckpoint, "digest" | "sequence" | "previous_digest">): UiFreshnessCheckpoint {
  const existing = chain.checkpoints?.checkpoints || [];
  const withLinks = { ...body, sequence: existing.length + 1, previous_digest: chain.headDigest };
  const checkpoint: UiFreshnessCheckpoint = { ...withLinks, digest: checkpointDigest(withLinks as UiFreshnessCheckpoint) } as UiFreshnessCheckpoint;
  const file: UiGenerationCheckpoints = {
    version: "1",
    kind: "aidlc.ui-generation-checkpoints",
    module_id: moduleId,
    route,
    acceptance_digest: chain.acceptanceDigest,
    checkpoints: [...existing, checkpoint],
  };
  const label = uiGenerationCheckpointsPath(moduleId);
  atomicJson(safeOutputFile(root, label, label), file);
  return checkpoint;
}

/** `ui refresh`: records an upstream pointer advance when the locked UI sources did not change. */
export function refreshUiGenerationFreshness(projectRoot: string, options: UiCheckpointOptions): { status: "refreshed" | "unchanged"; checkpoint: UiFreshnessCheckpoint | null } {
  const publication = captureModulePublication(projectRoot, options.moduleId);
  const root = realpathSync(resolve(projectRoot));
  const route = validateRoute(options.route);
  const chain = verifyAcceptanceChain(root, options.moduleId, route);
  const live = liveFreshnessState(root, chain.lock);
  const current: UiFreshnessState = { ...live.state };
  const delta = computeFreshnessDelta(root, chain.lock, chain.effective, current);
  if (delta.changed_paths.length > 0 || !sameValue(chain.effective.pages, current.pages)) {
    fail(`locked UI sources changed (${delta.changed_paths.join(", ") || "page mapping"}); 'ui refresh' only records pointer-only drift — use 'ui reverify' with a targeted review of the affected pages`);
  }
  if (current.upstream_commit === chain.effective.upstream_commit) return { status: "unchanged", checkpoint: null };
  const checkpoint = publishScope(root, publication, () => appendCheckpoint(root, chain, options.moduleId, route, {
    type: "freshness-refresh",
    created_at: requireIso(options.now || new Date().toISOString(), "created_at"),
    upstream_ref: chain.lock.upstream.ref,
    worktree_commit: resolveGitCommit(root, "HEAD"),
    baseline: chain.effective,
    current,
    ...delta,
    review: null,
  }));
  return { status: "refreshed", checkpoint };
}

/** `ui reverify`: records a targeted reverification that covers exactly the impact-matrix affected pages. */
export function reverifyUiGenerationFreshness(projectRoot: string, options: UiCheckpointOptions): UiFreshnessCheckpoint {
  const publication = captureModulePublication(projectRoot, options.moduleId);
  const root = realpathSync(resolve(projectRoot));
  const route = validateRoute(options.route);
  const chain = verifyAcceptanceChain(root, options.moduleId, route);
  const live = liveFreshnessState(root, chain.lock);
  const delta = computeFreshnessDelta(root, chain.lock, chain.effective, live.state);
  if (delta.changed_paths.length === 0) fail("locked UI sources did not change; use 'ui refresh' for pointer-only drift");
  if (delta.unclassified_changed_paths.length > 0) {
    fail(`UI freshness found changed source text with no machine ID classification: ${delta.unclassified_changed_paths.join(", ")}; add REQ/FR, US/STORY, AC, or PAGE identifiers before reverification`);
  }
  if (!delta.impact_matrix.all_changes_mapped) {
    const labels = Object.entries(delta.impact_matrix.unmapped_changes).filter(([, values]) => values.length > 0).map(([kind, values]) => `${kind}: ${(values as string[]).join(", ")}`);
    fail(`UI impact matrix has unmapped requirement changes (${labels.join("; ")}); update page-plan before reverification`);
  }
  const reportPath = options.reportPath || chain.acceptance.full_acceptance.report_path;
  const candidates = freshnessReverificationSections(root, reportPath).filter((entry) => !chain.runIds.has(entry.run_id));
  if (candidates.length !== 1) fail(`review report must contain exactly one new '## UI freshness reverification <run_id>' section (found ${candidates.length})`);
  const review = candidates[0];
  if (review.result !== "passed") fail("UI freshness reverification.result must be passed");
  if (!sameStrings(review.pages, delta.impact_matrix.affected_pages)) {
    fail(`UI freshness reverification.pages must exactly match affected pages: ${delta.impact_matrix.affected_pages.join(", ")}`);
  }
  return publishScope(root, publication, () => appendCheckpoint(root, chain, options.moduleId, route, {
    type: "targeted-reverification",
    created_at: requireIso(options.now || new Date().toISOString(), "created_at"),
    upstream_ref: chain.lock.upstream.ref,
    worktree_commit: resolveGitCommit(root, "HEAD"),
    baseline: chain.effective,
    current: live.state,
    ...delta,
    review: { report_path: review.report_path, run_id: review.run_id, completed_at: review.completed_at, pages: normalizedIds(review.pages), section_sha256: review.section_sha256 },
  }));
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function argList(args: string[], flag: string): string[] {
  return normalizedIds((argValue(args, flag) || "").split(",").map((value) => value.trim()).filter(Boolean));
}

function requiredArg(args: string[], flag: string): string {
  const value = argValue(args, flag);
  if (!value) fail(`${flag} is required`);
  return value;
}

function pagesFromJson(projectRoot: string, path: string): UiPageRef[] {
  const file = safeProjectFile(projectRoot, path, "pages JSON");
  const raw = JSON.parse(readFileSync(file.absolute, "utf8").replace(/^\uFEFF/, ""));
  const value = Array.isArray(raw) ? raw : requireObject(raw, "pages JSON").pages;
  return pageRefsFromUnknown(value, "pages");
}

function matrixMarkdown(matrix: UiImpactMatrix): string {
  const lines = [
    "# STORY/AC → 页面影响矩阵",
    "",
    `- 变化需求：${matrix.changed_requirements.join(", ") || "（无）"}`,
    `- 变化 STORY：${matrix.changed_stories.join(", ") || "（无）"}`,
    `- 变化 AC：${matrix.changed_acs.join(", ") || "（无）"}`,
    `- 变化 PAGE：${matrix.changed_pages.join(", ") || "（无）"}`,
    `- 页面总数：${matrix.total_pages}；受影响：${matrix.affected_pages.length}；未受影响：${matrix.unaffected_pages.length}`,
    "",
    "| 受影响页面 | 需求 | STORY | AC | 页面自身变化 |",
    "|------------|------|-------|----|--------------|",
  ];
  for (const row of matrix.rows) lines.push(`| ${row.page_id} | ${row.affected_by_requirements.join(", ") || "—"} | ${row.affected_by_stories.join(", ") || "—"} | ${row.affected_by_acs.join(", ") || "—"} | ${row.affected_by_page_change ? "是" : "否"} |`);
  if (matrix.rows.length === 0) lines.push("| （无受影响页面） | — | — | — | 否 |");
  lines.push("");
  if (!matrix.all_changes_mapped) {
    const labels = Object.entries(matrix.unmapped_changes).filter(([, values]) => values.length).map(([kind, values]) => `${kind}: ${values.join(", ")}`);
    lines.push(`> BLOCKED：存在未映射变化（${labels.join("；")}）。必须先更新 page-plan，禁止把它们判为“无需同步”。`);
  } else {
    lines.push(`> 只同步受影响页面 [${matrix.affected_pages.join(", ") || "无"}]，不重生未受影响页面 [${matrix.unaffected_pages.join(", ") || "无"}]。`);
  }
  return lines.join("\n");
}

function syntheticPages(count: number): UiPageRef[] {
  if (!Number.isInteger(count) || count < 1 || count > 1000) fail("--pages must be an integer between 1 and 1000");
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return { page_id: `PAGE-${number}`, requirements: [`REQ-${number}`], stories: [`US-${number}`], acs: [`AC-${number}`] };
  });
}

function writeOptionalOutput(projectRoot: string, path: string | undefined, content: string): void {
  if (!path) {
    process.stdout.write(`${content}\n`);
    return;
  }
  const root = realpathSync(resolve(projectRoot));
  const label = normalizedPath(path);
  if (label.startsWith("docs/aidlc/") || label.startsWith("aidlc/active/") || label.startsWith(".aidlc/evidence/")) {
    fail("--out is for temporary reports only and must not target production AI-DLC artifacts");
  }
  if (isAbsolute(label) || label === ".." || label.startsWith("../") || label.includes("/../")) fail("--out must stay inside the project root");
  writeFileSync(resolve(root, label), `${content}\n`, "utf8");
  process.stdout.write(`output written to ${label}\n`);
}

export async function runUiGovernanceCli(args: string[], projectRoot = process.cwd()): Promise<void> {
  const command = args[0];
  if (command === "resource-rebaseline") {
    const lock = rebaselineUiDesignResource(projectRoot, requiredArg(args, "--module"));
    process.stdout.write(`${JSON.stringify({ status: "visual-review-required", token_digest: lock.design_resource!.token_digest })}\n`);
    return;
  }
  if (command === "resource-css") {
    const moduleId = requiredArg(args, "--module");
    const publication = captureModulePublication(projectRoot, moduleId);
    const loaded = readUiGenerationLock(projectRoot, moduleId);
    if (!loaded.lock.design_resource) fail("DESIGN_LEGACY_ADOPTION_REQUIRED");
    if (loaded.lock.route !== "html-mock") fail("DESIGN_HTML_ROUTE_REQUIRED");
    publishScope(projectRoot, publication, () => applyDesignResourceStyle(projectRoot, moduleId, loaded.lock.design_resource!, requiredArg(args, "--html")));
    process.stdout.write("Locked design tokens applied.\n");
    return;
  }
  if (command === "lock") {
    const moduleId = requiredArg(args, "--module");
    const adoption = args.includes("--adopt") ? { approvalRef: requiredArg(args, "--approval-ref"), reason: requiredArg(args, "--reason") } : undefined;
    const lock = createUiGenerationLock(projectRoot, {
      moduleId,
      route: validateRoute(requiredArg(args, "--route")),
      upstreamRef: argValue(args, "--upstream-ref"),
      prdPath: argValue(args, "--prd"),
      designDecisionsPath: argValue(args, "--design-decisions"),
      adoption,
    });
    process.stdout.write(`${JSON.stringify({ status: "locked", path: uiGenerationLockPath(moduleId), module_id: moduleId, route: lock.route, upstream: lock.upstream, sources: lock.sources.map((source) => source.path), pages: lock.pages.map((page) => page.page_id) }, null, 2)}\n`);
    return;
  }
  if (command === "accept") {
    const moduleId = requiredArg(args, "--module");
    const acceptance = createUiGenerationAcceptance(projectRoot, {
      moduleId,
      route: validateRoute(requiredArg(args, "--route")),
      reportPath: argValue(args, "--review-report"),
    });
    process.stdout.write(`${JSON.stringify({ status: "passed", path: uiGenerationAcceptancePath(moduleId), upstream: acceptance.freshness.current_upstream_commit, changed_paths: acceptance.freshness.changed_paths, affected_pages: acceptance.freshness.impact_matrix.affected_pages, full_acceptance_runs: 1, targeted_reverification_runs: acceptance.targeted_reverifications.length }, null, 2)}\n`);
    return;
  }
  if (command === "refresh") {
    const moduleId = requiredArg(args, "--module");
    const result = refreshUiGenerationFreshness(projectRoot, { moduleId, route: validateRoute(requiredArg(args, "--route")) });
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      path: uiGenerationCheckpointsPath(moduleId),
      sequence: result.checkpoint?.sequence ?? null,
      baseline_upstream_commit: result.checkpoint?.baseline.upstream_commit ?? null,
      current_upstream_commit: result.checkpoint?.current.upstream_commit ?? null,
      digest: result.checkpoint?.digest ?? null,
      full_acceptance_runs: 1,
    }, null, 2)}\n`);
    return;
  }
  if (command === "reverify") {
    const moduleId = requiredArg(args, "--module");
    const checkpoint = reverifyUiGenerationFreshness(projectRoot, {
      moduleId,
      route: validateRoute(requiredArg(args, "--route")),
      reportPath: requiredArg(args, "--review-report"),
    });
    process.stdout.write(`${JSON.stringify({
      status: "reverified",
      path: uiGenerationCheckpointsPath(moduleId),
      sequence: checkpoint.sequence,
      changed_paths: checkpoint.changed_paths,
      affected_pages: checkpoint.impact_matrix.affected_pages,
      unaffected_pages: checkpoint.impact_matrix.unaffected_pages,
      review_run_id: checkpoint.review?.run_id,
      digest: checkpoint.digest,
      full_acceptance_runs: 1,
    }, null, 2)}\n`);
    return;
  }
  if (command === "check") {
    const moduleId = requiredArg(args, "--module");
    const loaded = readUiGenerationLock(projectRoot, moduleId);
    const result = verifyUiGenerationAcceptance(projectRoot, moduleId, argValue(args, "--route") ? validateRoute(argValue(args, "--route")) : loaded.lock.route, loaded.lock.pages.map((page) => page.page_id));
    process.stdout.write(`${JSON.stringify({ status: "passed", ...result }, null, 2)}\n`);
    return;
  }
  if (command === "impact-matrix") {
    const pages = argValue(args, "--pages-json")
      ? pagesFromJson(projectRoot, argValue(args, "--pages-json")!)
      : readUiPagePlan(projectRoot, requiredArg(args, "--page-plan"));
    const matrix = buildUiImpactMatrix(pages, {
      requirements: argList(args, "--changed-requirements"),
      stories: argList(args, "--changed-stories"),
      acs: argList(args, "--changed-acs"),
      pages: argList(args, "--changed-pages"),
    });
    writeOptionalOutput(projectRoot, argValue(args, "--out"), matrixMarkdown(matrix));
    if (!matrix.all_changes_mapped) fail("impact matrix contains unmapped changes");
    return;
  }
  if (command === "dry-run") {
    const count = Number(argValue(args, "--pages") || "6");
    const pages = syntheticPages(count);
    const changes = {
      requirements: argList(args, "--changed-requirements"),
      stories: argList(args, "--changed-stories"),
      acs: argList(args, "--changed-acs"),
      pages: argList(args, "--changed-pages"),
    };
    if (!Object.values(changes).some((values) => values.length)) changes.stories = [pages[Math.min(1, pages.length - 1)].stories[0]];
    const impact = buildUiImpactMatrix(pages, changes);
    const report = {
      mode: "dry-run",
      wrote_production_data: false,
      stages: ["version-lock", "representative-calibration", "continuous-generation", "technical-readback", "freshness-check", "single-full-acceptance", "targeted-reverification"],
      impact_matrix: impact,
      properties: {
        impact_all_changes_mapped: impact.all_changes_mapped,
        only_affected_pages_selected: impact.rows.every((row) => impact.affected_pages.includes(row.page_id)),
        unmapped_changes_fail_closed: impact.all_changes_mapped,
        no_production_write: true,
      },
    };
    writeOptionalOutput(projectRoot, argValue(args, "--out"), JSON.stringify(report, null, 2));
    if (!impact.all_changes_mapped) fail("dry-run blocked because one or more changed IDs have no page mapping");
    process.stdout.write("UI governance dry-run passed; all changes are mapped and no production data was written.\n");
    return;
  }
  fail("usage: loeyae-aidlc ui <lock|accept|refresh|reverify|check|impact-matrix|dry-run> [options]");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  runUiGovernanceCli(process.argv.slice(2)).catch((error) => {
    console.error(`UI governance blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
