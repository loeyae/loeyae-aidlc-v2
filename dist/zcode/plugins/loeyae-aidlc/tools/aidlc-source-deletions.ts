import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { baselineCodeRef, epochRepos, parseCodeRef, workflowBaselineForModule } from "./aidlc-baseline";
import { moduleManifestPath, readModuleManifest, readUnitManifest, unitManifestPath, unitUcdIds } from "./aidlc-execution-context";
import { codeRefRepo } from "./aidlc-nested-repos";
import { declaredNestedRoots, resolveSourceRoots } from "./aidlc-source-roots";
import { substantiveText } from "./aidlc-artifact-presence";

export interface SourceDeletion {
  path: string;
  baseline_blob: string;
  req_refs: string[];
  /** A module-local UC-D covering the removed behavior. */
  ucd_id: string;
}
export interface VerifiedDeletion extends SourceDeletion { baseline: string; repo: string; content: string }

/** Only regular project-local evidence is trusted, including when a parent is a symlink. */
function readLocal(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute).replace(/\\/g, "/");
  if (rel.startsWith("../") || rel === "..") throw new Error(`deletion evidence escapes project: ${path}`);
  let current = absolute;
  while (current !== resolve(root)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`deletion evidence symbolic link: ${path}`);
    current = dirname(current);
  }
  return readFileSync(absolute, "utf8");
}

/** Validate explicit removal ownership against the real baseline and the unit's I13 behavior.
 * No deleted blob is made to look like a current file; callers keep the two sets separate.
 */
export function sourceDeletions(root: string, moduleId?: string, unitId?: string): VerifiedDeletion[] {
  if (!moduleId) return (existsSync(moduleManifestPath(root)) ? readModuleManifest(root).map(module => module.module_id) : ["project"]).flatMap(id => sourceDeletions(root, id));
  if (!unitId) return (existsSync(unitManifestPath(root, moduleId)) ? readUnitManifest(root, moduleId).map(unit => unit.unit_id) : ["default"]).flatMap(id => sourceDeletions(root, moduleId, id));
  const file = `.aidlc/evidence/code-generation/${moduleId}/${unitId}/source-deletions.json`;
  if (!existsSync(join(root, file))) return [];
  const fail = (message: string): never => { throw new Error(`${file}: ${message}`); };
  const declaration = JSON.parse(readLocal(root, file));
  if (declaration.schema_version !== "1" || declaration.module_id !== moduleId || declaration.unit_id !== unitId || !Array.isArray(declaration.deletions) || !declaration.deletions.length) fail("invalid deletion ownership declaration");
  const unit = readUnitManifest(root, moduleId).find(unit => unit.unit_id === unitId);
  const baseline = workflowBaselineForModule(root, moduleId);
  if (!baseline.registered) return fail("a registered baseline is required");
  // A completed unit retains its original delivery range after baseline advance.
  const greenFile = `.aidlc/evidence/code-generation/${moduleId}/${unitId}/green-test-evidence.json`;
  const green = existsSync(join(root, greenFile)) ? JSON.parse(readLocal(root, greenFile)) : undefined;
  const anchor = baseline.epochs.lastIndexOf(green?.source_revision?.commit);
  const epoch = anchor > 0 ? anchor - 1 : baseline.epochs.length - 1;
  const bases: Record<string, string> = { ".": baseline.epochs[epoch], ...epochRepos(baseline, epoch) };
  const heads: Record<string, string> | undefined = anchor > 0 ? { ".": baseline.epochs[anchor], ...epochRepos(baseline, anchor) } : undefined;
  const roots = resolveSourceRoots(root, moduleId).roots;
  const nested = declaredNestedRoots(root);
  const i13 = JSON.parse(readLocal(root, `.aidlc/evidence/test-case-derivation/${moduleId}/test-case-derivation.json`));
  const scope = unitUcdIds(i13, unitId);
  if (i13.status !== "required" || !scope.scoped) fail("deletion requires required I13 with explicit UC-D unit ownership");
  const seen = new Set<string>();
  return declaration.deletions.map((entry: SourceDeletion) => {
    const ref = parseCodeRef(entry.path, roots, file);
    if (ref.path !== entry.path || ref.symbol || ref.path.split("/").some(segment => segment.startsWith(".")) || seen.has(ref.path)) fail("invalid or duplicate deletion path");
    seen.add(ref.path);
    if (!Array.isArray(entry.req_refs) || !entry.req_refs.length || entry.req_refs.some(req => typeof req !== "string" || !unit?.req_refs?.includes(req))) fail(`${ref.path}: req_refs must belong to this unit`);
    if (!/^UC-D-\d+$/.test(entry.ucd_id) || !scope.all.includes(entry.ucd_id)) fail(`${ref.path}: affected UC-D does not belong to this unit`);
    const casePath = `docs/aidlc/modules/${moduleId}/inception/application-design/test-cases/${entry.ucd_id}.md`;
    const behavior = readLocal(root, casePath);
    const requirements = readLocal(root, `docs/aidlc/modules/${moduleId}/inception/requirements.md`);
    const mentions = (text: string, token: string) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
    if (entry.req_refs.some(req => !mentions(behavior, req) || !mentions(requirements, req))) fail(`${ref.path}: requirement/affected behavior source missing`);
    const owner = codeRefRepo(root, ref.path, nested);
    const base = bases[owner.repoKey];
    if (!base) fail(`${ref.path}: repository baseline missing`);
    const blob = baselineCodeRef(root, base, ref, file, owner);
    if ("error" in blob) fail(blob.error);
    if (!("blob" in blob) || blob.blob !== entry.baseline_blob) fail(`${ref.path}: baseline_blob mismatch`);
    const git = (args: string[]) => spawnSync("git", args, { cwd: owner.repoRoot, encoding: "utf8", shell: false });
    const ignored = git(["check-ignore", "--no-index", "--", owner.relativePath]);
    if (ignored.status !== 1) fail(`${ref.path}: ignored path or ignore check failed`);
    const changes = git(["diff", "--no-renames", "--diff-filter=D", "--name-only", "-z", base, ...(heads?.[owner.repoKey] ? [heads[owner.repoKey]] : []), "--", owner.relativePath]);
    if (changes.status !== 0 || !changes.stdout.split("\0").includes(owner.relativePath)) fail(`${ref.path}: not deleted in the delivery range`);
    const shown = git(["show", `${base}:${owner.relativePath}`]);
    if (shown.status !== 0 || shown.stdout.includes("\0") || !substantiveText(ref.path, shown.stdout, true)) fail(`${ref.path}: baseline is binary, empty or placeholder`);
    return { ...entry, baseline: base, repo: owner.repoKey, content: shown.stdout };
  });
}

/** Explicit removal trace, rather than old implementation text, covers the new removal requirement. */
export function deletionTraceText(root: string, moduleId?: string, unitId?: string): string {
  return sourceDeletions(root, moduleId, unitId).map(entry => `${entry.path}: ${entry.req_refs.join(" ")} ${entry.ucd_id}`).join("\n");
}
