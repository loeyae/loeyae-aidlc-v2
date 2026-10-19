import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { baselineCodeRef, epochRepos, parseCodeRef, workflowBaselineForModule } from "./aidlc-baseline";
import { moduleManifestPath, readModuleManifest, readUnitManifest, unitManifestPath, unitUcdIds } from "./aidlc-execution-context";
import { codeRefRepo } from "./aidlc-nested-repos";
import { declaredNestedRoots, resolveSourceRoots } from "./aidlc-source-roots";
import { substantiveText } from "./aidlc-artifact-presence";
import { ucdDeclarations } from "./aidlc-ucd-declarations";
import { assertControlledI13, i13NonApplicable } from "./aidlc-i13-applicability";

export interface SourceDeletion {
  path: string;
  baseline_blob: string;
  req_refs: string[];
  /** A module-local UC-D covering the removed behavior. */
  ucd_id?: string;
  /** Omitted means business behavior (the version 1 declaration contract). */
  applicability?: "required" | "not_applicable";
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
  const units = readUnitManifest(root, moduleId);
  const caseRoot = `docs/aidlc/modules/${moduleId}/inception/application-design/test-cases`;
  const requirements = readLocal(root, `docs/aidlc/modules/${moduleId}/inception/requirements.md`);
  const mentions = (text: string, token: string) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
  // Read the real inventory, including aggregate declarations, through the same parser as I13.
  // A recorded inventory must still match: missing, extra and moved declarations are drift.
  const scan = (dir: string): string[] => {
    readLocalDirectory(dir);
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
      const path = `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) return fail(`symbolic link in UC-D sources: ${path}`);
      return entry.isDirectory() ? scan(path) : entry.name.endsWith(".md") ? [path] : [];
    });
  };
  const readLocalDirectory = (dir: string) => {
    // readLocal's parent walk also checks the directory itself, without reading its bytes.
    const absolute = resolve(root, dir);
    const rel = relative(root, absolute).replace(/\\/g, "/");
    if (rel === ".." || rel.startsWith("../")) fail(`UC-D sources escape project: ${dir}`);
    let cursor = absolute;
    while (cursor !== resolve(root)) {
      if (lstatSync(cursor).isSymbolicLink()) fail(`symbolic link in UC-D sources: ${dir}`);
      cursor = dirname(cursor);
    }
  };
  const caseFiles = existsSync(join(root, caseRoot)) ? scan(caseRoot).sort() : [];
  const portable = (path: string) => path.replace(/\\/g, "/");
  if (i13.status === "required" && i13.test_case_files !== undefined && (!Array.isArray(i13.test_case_files)
    || i13.test_case_files.some((path: unknown) => typeof path !== "string")
    || JSON.stringify(i13.test_case_files.map(portable).sort()) !== JSON.stringify(caseFiles))) fail("I13 test_case_files no longer matches module sources");
  const declarations = ucdDeclarations(caseFiles.filter(path => !path.endsWith("/_index.md")), path => readLocal(root, path));
  const noBehavior = i13.status === "not_applicable" || i13.status === "required" && scope.scoped && scope.all.length === 0;
  const checkNoBehavior = () => {
    assertControlledI13(root, i13, moduleId);
    if (i13.status === "not_applicable") {
      const current = i13NonApplicable(root, moduleId, path => readLocal(root, path));
      for (const key of ["status", "applicability_inputs_digest", "reason_code", "reason", "approval_ref", "alternative_validation", "validation_command", "source_refs", "source_files"]) {
        if (JSON.stringify(i13[key]) !== JSON.stringify(current[key])) fail(`I13 applicability sources changed: ${key}`);
      }
    } else {
      if (!unit?.ucd_exemption) fail("empty UC-D subset requires an approved unit ucd_exemption");
      if (JSON.stringify([...declarations.keys()].sort()) !== JSON.stringify([...i13.ucd_ids].sort())) fail("I13 UC-D declarations changed");
      for (const [id, useCase] of declarations) {
        const owners = useCase.fields?.get("unit_refs");
        if (useCase.status !== "ready" || !Array.isArray(owners) || !Array.isArray(i13.ucd_units?.[id])
          || JSON.stringify([...owners].sort()) !== JSON.stringify([...i13.ucd_units[id]].sort())) fail("I13 unit ownership sources changed");
        const recorded = i13.ucd_sources?.[id];
        if (i13.ucd_sources !== undefined && (!recorded || typeof recorded.file !== "string" || portable(recorded.file) !== useCase.file
          || recorded.sha256 !== createHash("sha256").update(readLocal(root, useCase.file)).digest("hex"))) fail("I13 affected UC-D source changed");
      }
    }
  };
  const seen = new Set<string>();
  return declaration.deletions.map((entry: SourceDeletion) => {
    const ref = parseCodeRef(entry.path, roots, file);
    if (ref.path !== entry.path || ref.symbol || ref.path.split("/").some(segment => segment.startsWith(".")) || seen.has(ref.path)) fail("invalid or duplicate deletion path");
    seen.add(ref.path);
    if (!Array.isArray(entry.req_refs) || !entry.req_refs.length || entry.req_refs.some(req => typeof req !== "string" || !unit?.req_refs?.includes(req))) fail(`${ref.path}: req_refs must belong to this unit`);
    if (entry.req_refs.some(req => !mentions(requirements, req))) fail(`${ref.path}: authorized requirement source missing`);
    if (entry.applicability === "not_applicable") {
      if (!noBehavior || entry.ucd_id !== undefined) fail(`${ref.path}: no-behavior deletion conflicts with I13 UC-D scope`);
      checkNoBehavior();
      if (i13.status === "not_applicable" && entry.req_refs.some(req => !i13.source_refs.includes(req))) fail(`${ref.path}: no-behavior approval does not cover requirement`);
    } else {
      if (entry.applicability !== undefined && entry.applicability !== "required") fail(`${ref.path}: invalid applicability`);
      if (i13.status !== "required" || !entry.ucd_id || !/^UC-D-\d+$/.test(entry.ucd_id) || !scope.all.includes(entry.ucd_id)) fail(`${ref.path}: affected UC-D does not belong to this unit`);
      const useCase = declarations.get(entry.ucd_id!) ?? fail(`${ref.path}: affected UC-D source missing`);
      if (useCase.status !== "ready") fail(`${ref.path}: affected UC-D source not ready`);
      const recorded = i13.ucd_sources?.[entry.ucd_id!];
      if (i13.ucd_sources !== undefined && (!recorded || typeof recorded.file !== "string" || portable(recorded.file) !== useCase.file
        || recorded.sha256 !== createHash("sha256").update(readLocal(root, useCase.file)).digest("hex"))) fail(`${ref.path}: I13 affected UC-D source changed`);
      const source = useCase.fields?.get("source_ref");
      if (useCase.fields && !(Array.isArray(source) ? source.length : source?.trim())) fail(`${ref.path}: affected UC-D source_ref missing`);
      const behavior = useCase.content;
      if (entry.req_refs.some(req => !mentions(behavior, req))) fail(`${ref.path}: requirement/affected behavior source missing`);
      const owners = useCase.fields?.get("unit_refs");
      if (scope.scoped && (!Array.isArray(owners) || !owners.includes(unitId!) || JSON.stringify([...owners].sort()) !== JSON.stringify([...i13.ucd_units[entry.ucd_id!]].sort()))) fail(`${ref.path}: I13 unit ownership source changed`);
      if (!scope.scoped) {
        if (owners !== undefined) fail(`${ref.path}: I13 unit ownership source changed`);
        const candidates = units.filter(unit => entry.req_refs.every(req => unit.req_refs?.includes(req)));
        if (candidates.length !== 1 || candidates[0].unit_id !== unitId) fail(`${ref.path}: ambiguous deletion unit ownership; declare unit_refs`);
      }
    }
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
  return sourceDeletions(root, moduleId, unitId).map(entry => `${entry.path}: ${entry.req_refs.join(" ")} ${entry.ucd_id ?? "not_applicable"}`).join("\n");
}
