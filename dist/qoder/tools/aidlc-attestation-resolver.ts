import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ATTESTATION_STATUSES = [
  "verified",
  "drifted",
  "unattested",
  "unverifiable",
  "indeterminate",
] as const;

export type AttestationStatus = typeof ATTESTATION_STATUSES[number];

const STATUS_RANK: Record<AttestationStatus, number> = {
  verified: 0,
  unattested: 1,
  drifted: 2,
  indeterminate: 3,
  unverifiable: 4,
};

const OID_PATTERN = /^[a-f0-9]{40,64}$/i;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
const CONTEXT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const MAX_EVIDENCE_BYTES = 512 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_SKEW_MS = 60 * 1000;

export interface AttestationResolverOptions {
  repository_root?: string;
  base?: string;
  head?: string;
  changed_paths?: string[];
  now?: string | number | Date;
  max_evidence_age_ms?: number;
}

export interface AttestationHistory {
  repository_root: string | null;
  base_ref: string | null;
  head_ref: string | null;
  base_commit: string | null;
  head_commit: string | null;
  merge_base: string | null;
  shallow: boolean | null;
  complete: boolean;
  trust_basis: string[];
}

export interface AttestationAuthority {
  evidence_path: string;
  sensor: string;
  module_id: string;
  unit_id: string;
  stage_instance: string;
  coverage: "files_reviewed" | "changed_paths" | "artifacts" | "path_digests" | "none";
}

export interface UnitAttestation {
  attestation_id: string;
  module_id: string;
  unit_id: string;
  stage_instance: string;
  status: AttestationStatus;
  covered_paths: string[];
  authorities: AttestationAuthority[];
  trust_basis: string[];
}

export interface ChangedPathAttestation {
  path: string;
  status: AttestationStatus;
  unit_attestations: UnitAttestation[];
  trust_basis: string[];
}

export interface AttestationSummary {
  verified: number;
  drifted: number;
  unattested: number;
  unverifiable: number;
  indeterminate: number;
  total: number;
}

export interface AttestationResolution {
  schema_version: 1;
  kind: "aidlc.commit-diff-attestation";
  status: AttestationStatus;
  history: AttestationHistory;
  changed_paths: ChangedPathAttestation[];
  unit_attestations: UnitAttestation[];
  summary: AttestationSummary;
  trust_basis: string[];
  errors: string[];
}

interface GitEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  oid: string;
  path: string;
}

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
}

interface UnitContext {
  stage: string;
  module_id: string;
  unit_id: string;
  sensor: string;
  evidence_path: string;
  stage_instance: string;
}

interface CoveragePath {
  path: string;
  source: "files_reviewed" | "changed_paths" | "artifacts" | "path_digests";
  digest?: string;
}

interface EvidenceCandidate {
  context: UnitContext;
  status: AttestationStatus;
  coverage: CoveragePath[];
  authorities: AttestationAuthority[];
  trust_basis: string[];
}

interface SourceCheck {
  status: AttestationStatus;
  trust_basis: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function safeRevision(value: unknown, field: string): string {
  const revision = nonEmpty(value, field);
  if (
    revision.startsWith("-")
    || revision.includes("\\")
    || revision.includes("..")
    || revision.includes("@{")
    || /[\s\u0000-\u001f\u007f]/.test(revision)
    || !/^[A-Za-z0-9._/@-]+$/.test(revision)
  ) {
    throw new Error(`${field} is not a safe Git revision`);
  }
  return revision;
}

export function normalizeAttestationPath(value: unknown, field = "path"): string {
  const path = nonEmpty(value, field).replace(/^\.\//, "");
  if (
    path.startsWith("/")
    || path.includes("\\")
    || path.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error(`${field} is not a safe repository-relative path`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${field} contains an invalid path segment`);
  }
  return path;
}

function contextId(value: unknown, field: string): string {
  const id = nonEmpty(value, field);
  if (!CONTEXT_ID_PATTERN.test(id)) throw new Error(`${field} is not a valid context ID`);
  return id;
}

function digest(value: unknown, field: string): string {
  const result = nonEmpty(value, field);
  if (!DIGEST_PATTERN.test(result)) throw new Error(`${field} must be a SHA-256 digest`);
  return result.toLowerCase();
}

function compareStatus(left: AttestationStatus, right: AttestationStatus): AttestationStatus {
  return STATUS_RANK[left] >= STATUS_RANK[right] ? left : right;
}

function worstStatus(values: readonly AttestationStatus[], fallback: AttestationStatus): AttestationStatus {
  return values.reduce(compareStatus, fallback);
}

function excludedFromWorktreeDigest(path: string): boolean {
  return path === ".aidlc" || path.startsWith(".aidlc/") || path === "aidlc" || path.startsWith("aidlc/");
}

function isGeneratedAttestationPath(path: string): boolean {
  return path === ".aidlc" || path.startsWith(".aidlc/") || path === "aidlc" || path.startsWith("aidlc/") || path === "docs/aidlc/aidlc-state.json";
}

function stringArray(value: unknown, field: string, required = false): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${field} must be a${required ? " non-empty" : ""} string array`);
  }
  return value.map((item, index) => normalizeAttestationPath(item, `${field}[${index}]`));
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`);
  }
  return value;
}

function stageInstance(context: Pick<UnitContext, "stage" | "module_id" | "unit_id">): string {
  return `${context.stage}@module:${context.module_id}@unit:${context.unit_id}`;
}

function parseUnitEvidencePath(path: string): UnitContext | null {
  const normalized = normalizeAttestationPath(path, "evidence path");
  if (!normalized.startsWith(".aidlc/evidence/")) return null;
  const parts = normalized.split("/");
  if (parts.length < 4 || !parts.at(-1)?.endsWith(".json")) return null;
  if (parts.length !== 6) return null;
  const stage = contextId(parts[2], "evidence stage");
  const moduleId = contextId(parts[3], "evidence module_id");
  const unitId = contextId(parts[4], "evidence unit_id");
  const filename = parts[5];
  const sensor = contextId(filename.slice(0, -5), "evidence sensor");
  return {
    stage,
    module_id: moduleId,
    unit_id: unitId,
    sensor,
    evidence_path: normalized,
    stage_instance: stageInstance({ stage, module_id: moduleId, unit_id: unitId }),
  };
}

function coverageField(record: Record<string, unknown>, field: string, source: CoveragePath["source"]): CoveragePath[] {
  return stringArray(record[field], field).map((path) => ({ path, source }));
}

function parsePathDigests(record: Record<string, unknown>): CoveragePath[] {
  if (record.path_digests === undefined && record.file_digests === undefined) return [];
  const value = record.path_digests ?? record.file_digests;
  const paths = objectField(value, "path_digests");
  return Object.entries(paths).map(([pathValue, hash]) => ({
    path: normalizeAttestationPath(pathValue, "path_digests path"),
    source: "path_digests",
    digest: digest(hash, `path_digests.${pathValue}`),
  }));
}

function parseArtifacts(record: Record<string, unknown>): CoveragePath[] {
  if (record.artifacts === undefined) return [];
  if (!Array.isArray(record.artifacts)) throw new Error("artifacts must be an array");
  return record.artifacts.map((item, index) => {
    const artifact = objectField(item, `artifacts[${index}]`);
    return {
      path: normalizeAttestationPath(artifact.path, `artifacts[${index}].path`),
      source: "artifacts" as const,
      digest: digest(artifact.sha256, `artifacts[${index}].sha256`),
    };
  });
}

function parseCoverage(record: Record<string, unknown>, reviewLike: boolean): CoveragePath[] {
  const coverage = reviewLike
    ? coverageField(record, "files_reviewed", "files_reviewed")
    : [
      ...coverageField(record, "changed_paths", "changed_paths"),
      ...coverageField(record, "files_reviewed", "files_reviewed"),
      ...coverageField(record, "paths", "changed_paths"),
      ...parseArtifacts(record),
      ...parsePathDigests(record),
    ];
  const unique = new Map<string, CoveragePath>();
  for (const item of coverage) {
    const existing = unique.get(item.path);
    if (!existing || (!existing.digest && item.digest)) unique.set(item.path, item);
  }
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function validateReview(record: Record<string, unknown>): CoveragePath[] {
  if (record.evidence_version !== "1") throw new Error('evidence_version must be "1"');
  if (record.status !== "passed") throw new Error('review status must be "passed"');
  if (record.spec_axis !== "passed") throw new Error('review spec_axis must be "passed"');
  if (record.standards_axis !== "passed") throw new Error('review standards_axis must be "passed"');
  nonEmpty(record.reviewer, "reviewer");
  const coverage = parseCoverage(record, true);
  if (coverage.length === 0) throw new Error("review files_reviewed must be non-empty");
  const found = integer(record.issues_found, "issues_found");
  const resolved = integer(record.issues_resolved, "issues_resolved");
  const open = integer(record.issues_open, "issues_open");
  if (resolved < found) throw new Error("review issues_resolved must be >= issues_found");
  if (open !== 0) throw new Error("review issues_open must be 0");
  return coverage;
}

function validateControlledEvidence(record: Record<string, unknown>): CoveragePath[] {
  if (record.evidence_version !== "1") throw new Error('evidence_version must be "1"');
  const producer = objectField(record.producer, "producer");
  if (producer.name !== "loeyae-aidlc-evidence") throw new Error('producer.name must be "loeyae-aidlc-evidence"');
  if (producer.mode !== "controlled") throw new Error('producer.mode must be "controlled"');
  nonEmpty(producer.execution_id, "producer.execution_id");
  if (record.status !== "passed" && record.status !== "verified") {
    throw new Error('controlled evidence status must be "passed" or "verified"');
  }
  if (record.checks !== undefined) {
    const checks = objectField(record.checks, "checks");
    if (checks.status !== "passed") throw new Error('controlled evidence checks.status must be "passed"');
  }
  if (record.tests !== undefined) {
    const tests = objectField(record.tests, "tests");
    const total = integer(tests.total, "tests.total", 1);
    const passed = integer(tests.passed, "tests.passed", 1);
    const failed = integer(tests.failed, "tests.failed");
    if (passed > total || failed !== 0) throw new Error("controlled evidence tests are not passing");
  }
  if (record.checker !== undefined) {
    const checker = objectField(record.checker, "checker");
    if (checker.status !== "passed" || checker.exit_code !== 0) throw new Error("controlled evidence checker did not pass");
    digest(checker.argv_digest, "checker.argv_digest");
  }
  return parseCoverage(record, false);
}

function validateContextBinding(record: Record<string, unknown>, context: UnitContext): void {
  if (record.module_id !== undefined && contextId(record.module_id, "evidence.module_id") !== context.module_id) {
    throw new Error("evidence.module_id does not match its unit evidence path");
  }
  if (record.unit_id !== undefined && contextId(record.unit_id, "evidence.unit_id") !== context.unit_id) {
    throw new Error("evidence.unit_id does not match its unit evidence path");
  }
  if (record.stage_instance !== undefined && nonEmpty(record.stage_instance, "evidence.stage_instance") !== context.stage_instance) {
    throw new Error("evidence.stage_instance does not match its unit evidence path");
  }
}

function sourceRevisionCheck(
  record: Record<string, unknown>,
  reader: GitObjectReader,
  headCommit: string,
  now: number,
  maxAgeMs: number,
  treeDigest: () => { value?: string; error?: string },
): SourceCheck {
  const basis: string[] = [];
  const source = objectField(record.source_revision, "source_revision");
  const commit = nonEmpty(source.commit, "source_revision.commit").toLowerCase();
  if (!OID_PATTERN.test(commit)) return { status: "unverifiable", trust_basis: ["source_revision.commit is not a valid Git object ID"] };
  if (!reader.isCommitAncestor(commit, headCommit)) {
    return {
      status: "drifted",
      trust_basis: [`source_revision.commit ${commit} is not an ancestor of inspected head ${headCommit}`],
    };
  }
  const changedAfterSource = reader.changedPaths(commit, headCommit).filter((path) => !isGeneratedAttestationPath(path));
  if (changedAfterSource.length > 0) {
    return {
      status: "drifted",
      trust_basis: [`non-generated paths changed after source_revision.commit: ${changedAfterSource.join(", ")}`],
    };
  }
  if (source.dirty !== false) {
    return {
      status: source.dirty === true ? "drifted" : "unverifiable",
      trust_basis: [source.dirty === true
        ? "attestation was produced from a dirty worktree and cannot bind to the inspected commit"
        : "source_revision.dirty is not a verified boolean false"],
    };
  }
  const worktreeDigest = digest(source.worktree_digest, "source_revision.worktree_digest");
  const currentTreeDigest = treeDigest();
  if (currentTreeDigest.error) return { status: "unverifiable", trust_basis: [currentTreeDigest.error] };
  if (worktreeDigest !== currentTreeDigest.value) {
    return {
      status: "drifted",
      trust_basis: [`source_revision.worktree_digest ${worktreeDigest} does not match inspected tree digest ${currentTreeDigest.value}`],
    };
  }
  basis.push(commit === headCommit.toLowerCase()
    ? `source_revision.commit matches inspected head ${headCommit}`
    : `source_revision.commit ${commit} is an ancestor of inspected head with no later non-generated path changes`);
  basis.push("source_revision.dirty is false");
  basis.push("source_revision.worktree_digest matches the inspected commit tree");

  const timestamp = nonEmpty(record.timestamp, "timestamp");
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return { status: "unverifiable", trust_basis: ["attestation timestamp is not a valid ISO date"] };
  if (time - now > FUTURE_CLOCK_SKEW_MS) return { status: "unverifiable", trust_basis: ["attestation timestamp is in the future"] };
  if (now - time > maxAgeMs) return { status: "drifted", trust_basis: [`attestation is older than the configured freshness window of ${maxAgeMs}ms`] };
  basis.push("attestation timestamp is valid and within the freshness window");
  return { status: "verified", trust_basis: basis };
}

function contentDigestCheck(
  reader: GitObjectReader,
  treeByPath: ReadonlyMap<string, GitEntry>,
  coverage: readonly CoveragePath[],
): SourceCheck {
  const basis: string[] = [];
  for (const item of coverage) {
    if (!item.digest) continue;
    const entry = treeByPath.get(item.path);
    if (!entry || entry.type !== "blob") {
      return { status: "drifted", trust_basis: [`attested content path ${item.path} is absent from the inspected head tree`] };
    }
    const actual = createHash("sha256").update(reader.readBlob(entry.oid)).digest("hex");
    if (actual !== item.digest) {
      return {
        status: "drifted",
        trust_basis: [`content digest for ${item.path} is ${actual}, but the attestation declares ${item.digest}`],
      };
    }
    basis.push(`content digest matches for ${item.path}`);
  }
  return { status: "verified", trust_basis: basis };
}

function inspectCandidate(
  reader: GitObjectReader,
  entry: GitEntry,
  treeByPath: ReadonlyMap<string, GitEntry>,
  context: UnitContext,
  headCommit: string,
  now: number,
  maxAgeMs: number,
  treeDigest: () => { value?: string; error?: string },
): EvidenceCandidate {
  const basis: string[] = [`evidence was read from head commit tree at ${context.evidence_path}`];
  let record: Record<string, unknown> | undefined;
  let coverage: CoveragePath[] = [];
  const errors: string[] = [];
  try {
    const bytes = reader.readBlob(entry.oid);
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    record = objectField(parsed, context.evidence_path);
    validateContextBinding(record, context);
    const reviewLike = context.sensor === "review-evidence"
      || record.files_reviewed !== undefined
      || record.spec_axis !== undefined
      || record.standards_axis !== undefined;
    coverage = reviewLike ? validateReview(record) : validateControlledEvidence(record);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    if (record && coverage.length === 0) {
      try {
        const reviewLike = context.sensor === "review-evidence"
          || record.files_reviewed !== undefined
          || record.spec_axis !== undefined
          || record.standards_axis !== undefined;
        coverage = parseCoverage(record, reviewLike);
      } catch {
        coverage = [];
      }
    }
  }

  const authority: AttestationAuthority | undefined = record ? {
    evidence_path: context.evidence_path,
    sensor: context.sensor,
    module_id: context.module_id,
    unit_id: context.unit_id,
    stage_instance: context.stage_instance,
    coverage: coverage[0]?.source || "none",
  } : undefined;
  if (record) basis.push("controlled evidence format and context binding were validated");

  let source: SourceCheck | undefined;
  if (record && errors.length === 0) {
    try {
      source = sourceRevisionCheck(record, reader, headCommit, now, maxAgeMs, treeDigest);
      basis.push(...source.trust_basis);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let content: SourceCheck | undefined;
  if (record && errors.length === 0 && source?.status === "verified") {
    try {
      content = contentDigestCheck(reader, treeByPath, coverage);
      basis.push(...content.trust_basis);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let status: AttestationStatus;
  if (errors.length > 0) status = "unverifiable";
  else status = worstStatus([source?.status || "unverifiable", content?.status || "verified"], "verified");
  if (status === "verified") {
    basis.push(coverage.length > 0
      ? `unit attestation declares exact coverage for ${coverage.length} repository path(s)`
      : "unit evidence has no changed-path coverage declaration");
  }
  if (errors.length > 0) basis.push(`trust is withheld because ${errors.join("; ")}`);
  return {
    context,
    status,
    coverage,
    authorities: authority ? [authority] : [],
    trust_basis: basis,
  };
}

class GitObjectReader {
  readonly repositoryRoot: string;

  constructor(repositoryRoot: string) {
    const candidate = resolve(repositoryRoot);
    if (!existsSync(candidate)) throw new Error(`repository root does not exist: ${candidate}`);
    const stat = lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`repository root must be a regular directory: ${candidate}`);
    this.repositoryRoot = realpathSync(candidate);
    const topResult = this.execute(["rev-parse", "--show-toplevel"]);
    if (topResult.status !== 0) throw new Error(`not a Git worktree: ${this.errorText(topResult)}`);
    const top = realpathSync(topResult.stdout.toString("utf8").trim());
    if (top !== this.repositoryRoot) throw new Error("repository root must be the Git worktree root");
    const inside = this.execute(["rev-parse", "--is-inside-work-tree"]);
    if (inside.status !== 0 || inside.stdout.toString("utf8").trim() !== "true") {
      throw new Error("Git worktree boundary could not be verified");
    }
  }

  private execute(args: string[], input?: string): GitResult {
    const result = spawnSync("git", ["--no-optional-locks", ...args], {
      cwd: this.repositoryRoot,
      input,
      shell: false,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return {
      status: result.status ?? 1,
      stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ""),
      stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || ""),
      error: result.error,
    };
  }

  private errorText(result: GitResult): string {
    return result.error?.message || result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "unknown Git error";
  }

  private required(args: string[], label: string): Buffer {
    const result = this.execute(args);
    if (result.status !== 0 || result.error) throw new Error(`${label}: ${this.errorText(result)}`);
    return result.stdout;
  }

  private objectType(oid: string): string {
    return this.required(["cat-file", "-t", oid], `Git object ${oid}`).toString("utf8").trim();
  }

  resolveCommit(refValue: string, field: string): string {
    const ref = safeRevision(refValue, field);
    const output = this.required(
      ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
      `${field} could not be resolved`,
    ).toString("utf8").trim();
    if (!OID_PATTERN.test(output) || this.objectType(output) !== "commit") {
      throw new Error(`${field} did not resolve to a valid commit object`);
    }
    return output.toLowerCase();
  }

  mergeBases(base: string, head: string): string[] {
    const output = this.required(["merge-base", "--all", base, head], "merge base could not be resolved").toString("utf8").trim();
    if (!output) throw new Error("no merge base exists for the supplied commits");
    const bases = output.split(/\s+/).filter(Boolean).map((value) => value.toLowerCase());
    if (bases.some((value) => !OID_PATTERN.test(value))) throw new Error("Git returned an invalid merge-base object ID");
    return bases;
  }

  isCommitAncestor(ancestor: string, descendant: string): boolean {
    const result = this.execute(["merge-base", "--is-ancestor", ancestor, descendant]);
    if (result.error || (result.status !== 0 && result.status !== 1)) {
      throw new Error(`Git ancestry could not be verified: ${this.errorText(result)}`);
    }
    return result.status === 0;
  }

  isShallow(): boolean {
    const result = this.execute(["rev-parse", "--is-shallow-repository"]);
    if (result.status !== 0 || result.error) throw new Error(`history completeness could not be checked: ${this.errorText(result)}`);
    const value = result.stdout.toString("utf8").trim();
    if (value !== "true" && value !== "false") throw new Error("Git returned an invalid shallow-repository marker");
    return value === "true";
  }

  readTreeForCommit(commit: string): GitEntry[] {
    const tree = this.required(
      ["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{tree}`],
      `tree for commit ${commit} could not be resolved`,
    ).toString("utf8").trim();
    if (!OID_PATTERN.test(tree) || this.objectType(tree) !== "tree") throw new Error(`commit ${commit} has an invalid tree object`);
    return this.readTree(tree);
  }

  readTree(tree: string): GitEntry[] {
    const output = this.required(["ls-tree", "--full-tree", "-r", "-z", tree, "--"], `tree ${tree} could not be read`);
    const chunks = output.toString("utf8").split("\0").filter(Boolean);
    const entries: GitEntry[] = [];
    for (const chunk of chunks) {
      const separator = chunk.indexOf("\t");
      if (separator < 0) throw new Error("Git tree contained a malformed entry");
      const header = chunk.slice(0, separator).split(" ");
      const path = normalizeAttestationPath(chunk.slice(separator + 1), "Git tree path");
      if (header.length !== 3 || !/^[0-7]{6}$/.test(header[0]) || !["blob", "tree", "commit"].includes(header[1]) || !OID_PATTERN.test(header[2])) {
        throw new Error(`Git tree entry is invalid for path ${path}`);
      }
      entries.push({ mode: header[0], type: header[1] as GitEntry["type"], oid: header[2].toLowerCase(), path });
    }
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  readBlob(oid: string): Buffer {
    if (!OID_PATTERN.test(oid)) throw new Error("attempted to read an invalid Git blob object ID");
    const type = this.objectType(oid);
    if (type !== "blob") throw new Error(`Git object ${oid} is ${type}, not a blob`);
    const output = this.required(["cat-file", "blob", oid], `Git blob ${oid} could not be read`);
    if (output.byteLength > MAX_GIT_OUTPUT_BYTES) throw new Error(`Git blob ${oid} exceeds the read limit`);
    return output;
  }

  changedPaths(base: string, head: string): string[] {
    const output = this.required(
      ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", base, head, "--"],
      "commit diff could not be read",
    );
    const paths = output.toString("utf8").split("\0").filter(Boolean).map((path) => normalizeAttestationPath(path, "changed path"));
    return [...new Set(paths)].sort();
  }
}

function validateTreeObjects(reader: GitObjectReader, entries: readonly GitEntry[]): void {
  for (const entry of entries) {
    if (entry.type !== "blob") throw new Error(`tree contains unsupported non-blob entry ${entry.path}`);
    reader.readBlob(entry.oid);
  }
}

function makeTreeDigest(reader: GitObjectReader, entries: readonly GitEntry[]): () => { value?: string; error?: string } {
  let result: { value?: string; error?: string } | undefined;
  return () => {
    if (result) return result;
    try {
      const hash = createHash("sha256");
      for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
        if (excludedFromWorktreeDigest(entry.path)) continue;
        if (entry.type !== "blob") throw new Error(`cannot compute worktree digest for non-blob path ${entry.path}`);
        const content = reader.readBlob(entry.oid);
        hash.update(entry.path).update("\0");
        if (entry.mode === "120000") {
          hash.update("symlink\0").update(content.toString("utf8")).update("\0");
        } else {
          hash.update("file\0").update(createHash("sha256").update(content).digest()).update("\0");
        }
      }
      result = { value: hash.digest("hex") };
    } catch (error) {
      result = { error: `inspected tree digest could not be established: ${error instanceof Error ? error.message : String(error)}` };
    }
    return result;
  };
}

function summarize(paths: readonly ChangedPathAttestation[]): AttestationSummary {
  const summary: AttestationSummary = {
    verified: 0,
    drifted: 0,
    unattested: 0,
    unverifiable: 0,
    indeterminate: 0,
    total: paths.length,
  };
  for (const item of paths) summary[item.status] += 1;
  return summary;
}

function applyHistoryStatus(
  item: ChangedPathAttestation,
  historyStatus: AttestationStatus | null,
  historyBasis: string[],
): ChangedPathAttestation {
  if (!historyStatus || historyStatus === "verified") return item;
  if (item.status !== "verified" && item.status !== "unattested") return item;
  return {
    ...item,
    status: historyStatus,
    trust_basis: [...item.trust_basis, ...historyBasis, "a definitive path conclusion was withheld because history completeness was not established"],
    unit_attestations: item.unit_attestations.map((attestation) => attestation.status === "verified" || attestation.status === "unattested"
      ? {
        ...attestation,
        status: historyStatus,
        trust_basis: [...attestation.trust_basis, ...historyBasis, "a definitive unit attestation was withheld because history completeness was not established"],
      }
      : attestation),
  };
}

function invalidPathResult(path: string, reason: string): ChangedPathAttestation {
  return {
    path,
    status: "unverifiable",
    unit_attestations: [],
    trust_basis: ["changed path validation failed", reason, "no authority was inferred from an invalid path"],
  };
}

function buildUnitClaim(
  candidate: EvidenceCandidate,
  changedPath: string,
): UnitAttestation {
  const covered = candidate.coverage.filter((item) => item.path === changedPath);
  const authority = candidate.authorities.map((item) => ({ ...item, coverage: covered[0]?.source || item.coverage }));
  return {
    attestation_id: `${candidate.context.stage_instance}:${candidate.context.sensor}:${candidate.context.evidence_path}`,
    module_id: candidate.context.module_id,
    unit_id: candidate.context.unit_id,
    stage_instance: candidate.context.stage_instance,
    status: candidate.status,
    covered_paths: covered.map((item) => item.path),
    authorities: authority,
    trust_basis: candidate.trust_basis,
  };
}

function resolveChangedPath(
  path: string,
  candidates: readonly EvidenceCandidate[],
  historyStatus: AttestationStatus | null,
  historyBasis: string[],
): ChangedPathAttestation {
  const matching = candidates.filter((candidate) => candidate.coverage.some((item) => item.path === path));
  if (matching.length === 0) {
    const result: ChangedPathAttestation = {
      path,
      status: "unattested",
      unit_attestations: [],
      trust_basis: [
        "path is present in the inspected commit diff",
        "no unit-scoped signed review or controlled Evidence declares exact coverage for this path",
        "absence of a matching attestation is reported as unattested, not verified",
      ],
    };
    return applyHistoryStatus(result, historyStatus, historyBasis);
  }

  const attestations = matching.map((candidate) => buildUnitClaim(candidate, path));
  const distinctUnits = new Set(attestations.map((attestation) => `${attestation.module_id}/${attestation.unit_id}`));
  let status = worstStatus(attestations.map((attestation) => attestation.status), "verified");
  const basis = ["path is present in the inspected commit diff"];
  if (distinctUnits.size > 1 && status === "verified") {
    status = "indeterminate";
    basis.push("multiple independently scoped unit attestations cover the same path; ownership is ambiguous");
  }
  if (status === "verified") basis.push("all matching unit attestations passed signature, schema, source revision, and exact path checks");
  else basis.push(`at least one matching authority yielded ${status}; the resolver does not elevate weaker checks`);
  return applyHistoryStatus({ path, status, unit_attestations: attestations, trust_basis: basis }, historyStatus, historyBasis);
}

function emptyHistory(): AttestationHistory {
  return {
    repository_root: null,
    base_ref: null,
    head_ref: null,
    base_commit: null,
    head_commit: null,
    merge_base: null,
    shallow: null,
    complete: false,
    trust_basis: ["Git repository history was not established"],
  };
}

function failureResolution(status: AttestationStatus, history: AttestationHistory, error: string): AttestationResolution {
  return {
    schema_version: 1,
    kind: "aidlc.commit-diff-attestation",
    status,
    history,
    changed_paths: [],
    unit_attestations: [],
    summary: summarize([]),
    trust_basis: [
      "resolver is read-only and did not write workflow state, controlled Evidence, or approval state",
      "no attestation conclusion was upgraded after Git resolution failed",
    ],
    errors: [error],
  };
}

export function resolveCommitDiffAttestations(options: AttestationResolverOptions): AttestationResolution {
  let history = emptyHistory();
  try {
    const repositoryRoot = realpathSync(resolve(options.repository_root || process.cwd()));
    const baseRef = safeRevision(options.base, "base");
    const headRef = safeRevision(options.head || "HEAD", "head");
    const reader = new GitObjectReader(repositoryRoot);
    history = {
      ...history,
      repository_root: repositoryRoot,
      base_ref: baseRef,
      head_ref: headRef,
      trust_basis: ["repository root is the verified Git worktree boundary"],
    };
    const baseCommit = reader.resolveCommit(baseRef, "base");
    const headCommit = reader.resolveCommit(headRef, "head");
    history.base_commit = baseCommit;
    history.head_commit = headCommit;
    const bases = reader.mergeBases(baseCommit, headCommit);
    if (bases.length !== 1) {
      return failureResolution("indeterminate", {
        ...history,
        merge_base: bases[0] || null,
        complete: false,
        trust_basis: [...history.trust_basis, "multiple merge bases exist; no single diff baseline was selected"],
      }, "Git history has multiple merge bases and is indeterminate");
    }
    const mergeBase = bases[0];
    history.merge_base = mergeBase;
    const shallow = reader.isShallow();
    history.shallow = shallow;
    const baseTree = reader.readTreeForCommit(mergeBase);
    validateTreeObjects(reader, baseTree);
    const headTree = reader.readTreeForCommit(headCommit);
    const treeByPath = new Map(headTree.map((entry) => [entry.path, entry]));
    const actualChangedPaths = reader.changedPaths(mergeBase, headCommit).filter((path) => !isGeneratedAttestationPath(path));
    const explicitPaths: ChangedPathAttestation[] = [];
    let requestedPaths: string[] = actualChangedPaths;
    if (options.changed_paths !== undefined) {
      const seen = new Set<string>();
      for (const rawPath of options.changed_paths) {
        try {
          const path = normalizeAttestationPath(rawPath, "changed_paths entry");
          if (seen.has(path)) continue;
          seen.add(path);
          if (!actualChangedPaths.includes(path)) {
            explicitPaths.push({
              path,
              status: "indeterminate",
              unit_attestations: [],
              trust_basis: [
                "explicit path is not present in the Git diff from merge base to head",
                "the resolver will not treat an unobserved path as changed or verified",
              ],
            });
          }
        } catch (error) {
          explicitPaths.push(invalidPathResult(String(rawPath), error instanceof Error ? error.message : String(error)));
        }
      }
      requestedPaths = options.changed_paths
        .filter((rawPath): rawPath is string => {
          try {
            const path = normalizeAttestationPath(rawPath, "changed_paths entry");
            return actualChangedPaths.includes(path);
          } catch {
            return false;
          }
        })
        .filter((path, index, values) => values.indexOf(path) === index)
        .sort();
    }
    void baseTree;
    const treeDigest = makeTreeDigest(reader, headTree);
    const now = options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : options.now
          ? Date.parse(options.now)
          : Date.now();
    if (!Number.isFinite(now)) throw new Error("resolver evaluation time is invalid");
    const maxAgeMs = options.max_evidence_age_ms ?? DEFAULT_MAX_EVIDENCE_AGE_MS;
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 0) throw new Error("max_evidence_age_ms must be a non-negative integer");
    const candidates: EvidenceCandidate[] = [];
    for (const entry of headTree) {
      if (!entry.path.startsWith(".aidlc/evidence/") || !entry.path.endsWith(".json")) continue;
      let context: UnitContext | null = null;
      try {
        context = parseUnitEvidencePath(entry.path);
      } catch (error) {
        return failureResolution("unverifiable", {
          ...history,
          complete: false,
          trust_basis: [...history.trust_basis, "an Evidence path in the inspected tree failed safe path/context validation"],
        }, error instanceof Error ? error.message : String(error));
      }
      if (!context) continue;
      candidates.push(inspectCandidate(
        reader,
        entry,
        treeByPath,
        context,
        headCommit,
        now,
        maxAgeMs,
        treeDigest,
      ));
    }

    const treeDigestResult = treeDigest();
    const historyStatus: AttestationStatus | null = shallow
      ? "indeterminate"
      : treeDigestResult.error
        ? "unverifiable"
        : null;
    const historyBasis = shallow
      ? ["repository is shallow; available commits do not prove complete history"]
      : treeDigestResult.error
        ? [treeDigestResult.error]
        : ["single merge base, commit objects, and both baseline/head trees were read successfully"];
    const resolved = [
      ...explicitPaths,
      ...requestedPaths.map((path) => resolveChangedPath(path, candidates, historyStatus, historyBasis)),
    ].sort((left, right) => left.path.localeCompare(right.path));
    const unitClaims = new Map<string, UnitAttestation>();
    for (const item of resolved) {
      for (const attestation of item.unit_attestations) {
        const existing = unitClaims.get(attestation.attestation_id);
        if (!existing) {
          unitClaims.set(attestation.attestation_id, { ...attestation, covered_paths: [...attestation.covered_paths] });
          continue;
        }
        existing.status = worstStatus([existing.status, attestation.status], "verified");
        existing.covered_paths = [...new Set([...existing.covered_paths, ...attestation.covered_paths])].sort();
        existing.authorities = [...existing.authorities, ...attestation.authorities]
          .filter((authority, index, authorities) => authorities.findIndex((candidate) => candidate.evidence_path === authority.evidence_path) === index);
        existing.trust_basis = [...new Set([...existing.trust_basis, ...attestation.trust_basis])];
      }
    }
    const summary = summarize(resolved);
    const globalStatus = historyStatus === "unverifiable"
      ? "unverifiable"
      : resolved.length === 0
        ? "indeterminate"
        : worstStatus(resolved.map((item) => item.status), "verified");
    history = {
      ...history,
      complete: !shallow && !treeDigestResult.error,
      trust_basis: [...history.trust_basis, ...historyBasis],
    };
    return {
      schema_version: 1,
      kind: "aidlc.commit-diff-attestation",
      status: globalStatus,
      history,
      changed_paths: resolved,
      unit_attestations: [...unitClaims.values()].sort((left, right) => left.attestation_id.localeCompare(right.attestation_id)),
      summary,
      trust_basis: [
        "changed paths were derived from a read-only merge-base-to-head Git diff",
        "attestation files were read only from the inspected head commit tree",
        "Ed25519/HMAC integrity was checked with the existing trust verifier; no new authority was created",
        "aggregate status is the weakest path-level result and never exceeds an individual check",
        ...historyBasis,
      ],
      errors: candidates.flatMap((candidate) => candidate.status === "unverifiable"
        ? candidate.trust_basis.filter((basis) => basis.startsWith("trust is withheld"))
        : []),
    };
  } catch (error) {
    return failureResolution("unverifiable", history, error instanceof Error ? error.message : String(error));
  }
}

export const resolveCommitDiffAttestation = resolveCommitDiffAttestations;
export const resolveAttestation = resolveCommitDiffAttestations;

function usage(): void {
  process.stdout.write("Usage: loeyae-aidlc attest resolve --base <ref> [--head <ref>] [--repo <path>] [--path <path> ...]\n\nRead-only commit/diff attestation resolution. Output is always one JSON object.\n");
}

function parseArgs(args: string[]): AttestationResolverOptions | null {
  if (args[0] === "--help" || args[0] === "-h") {
    usage();
    return null;
  }
  const values: AttestationResolverOptions = {};
  const changedPaths: string[] = [];
  for (let index = args[0] === "resolve" ? 1 : 0; index < args.length; index++) {
    const arg = args[index];
    const value = (): string => {
      const next = args[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "--base") values.base = value();
    else if (arg === "--head") values.head = value();
    else if (arg === "--repo") values.repository_root = value();
    else if (arg === "--path" || arg === "--changed-path") changedPaths.push(value());
    else if (arg === "--as-of") values.now = value();
    else if (arg === "--max-age-ms") {
      const parsed = Number(value());
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("--max-age-ms must be a non-negative integer");
      values.max_evidence_age_ms = parsed;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      return null;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!values.base) throw new Error("--base is required");
  if (changedPaths.length > 0) values.changed_paths = changedPaths;
  return values;
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) return;
    process.stdout.write(`${JSON.stringify(resolveCommitDiffAttestations(options), null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(failureResolution("unverifiable", emptyHistory(), error instanceof Error ? error.message : String(error)), null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
