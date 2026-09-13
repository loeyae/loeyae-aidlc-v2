import { createHash } from "crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";
import { TextDecoder } from "util";
import { statePath } from "./aidlc-state";
import {
  createRegeneratedWorkflowStateV3,
  MAX_V1_REGENERATION_SOURCE_BYTES,
  validateV1RegenerationOptions,
  type V1RegenerationSource,
  type V2MigrationIdentity,
} from "./aidlc-state-v3";
import {
  initializeWorkflowStateV3,
  validateWorkflowStateV3Target,
} from "./aidlc-state-v3-store";
import { readEnrollment, type EnrollmentRecord } from "./aidlc-trust";

const DEFAULT_SOURCE = "docs/aidlc/state.md";
const VALID_SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const PRD_ELIGIBLE_SCOPES = new Set(["feature", "enterprise", "mvp", "classic"]);

interface Options {
  apply: boolean;
  withPrd: boolean;
  scope: string;
  source: string;
  sourceVersion: string | null;
  identity: V2MigrationIdentity;
}

interface LegacySourceSnapshot {
  raw: Buffer;
  source: V1RegenerationSource;
}

function parse(args: string[]): Options {
  const values: Record<string, string> = {};
  let apply = false;
  let withPrd = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      if (apply) throw new Error("duplicate --apply");
      apply = true;
      continue;
    }
    if (argument === "--with-prd") {
      if (withPrd) throw new Error("duplicate --with-prd");
      withPrd = true;
      continue;
    }
    if (!["--scope", "--source", "--source-version", "--actor-id", "--device-id", "--client-id"].includes(argument)) {
      throw new Error(`unknown regeneration option: ${argument}`);
    }
    if (values[argument]) throw new Error(`duplicate regeneration option: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values[argument] = value;
  }
  for (const flag of ["--scope", "--actor-id", "--device-id", "--client-id"]) {
    if (!values[flag]) throw new Error(`state regenerate-v3 requires ${flag} <value>`);
  }
  if (values["--source-version"] && values["--source-version"].length > 128) {
    throw new Error("--source-version must be at most 128 characters");
  }
  const scope = values["--scope"];
  if (!VALID_SCOPES.has(scope)) throw new Error(`invalid workflow scope: ${scope}`);
  if (withPrd && !PRD_ELIGIBLE_SCOPES.has(scope)) {
    throw new Error(`optional PRD stage is not available for scope ${scope}`);
  }
  return {
    apply,
    withPrd,
    scope,
    source: values["--source"] || DEFAULT_SOURCE,
    sourceVersion: values["--source-version"] || null,
    identity: {
      actor_id: values["--actor-id"],
      device_id: values["--device-id"],
      client_id: values["--client-id"],
    },
  };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function sourcePath(projectRoot: string, value: string): {
  absolute: string;
  relative: string;
  device: bigint;
  inode: bigint;
} {
  const candidate = resolve(projectRoot, value);
  if (!inside(projectRoot, candidate)) throw new Error(`legacy state source escapes project root: ${value}`);
  const relativePath = relative(projectRoot, candidate);
  let cursor = projectRoot;
  for (const segment of relativePath.split(sep)) {
    cursor = join(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`legacy state source traverses a symbolic link: ${cursor}`);
  }
  const stat = lstatSync(candidate, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`legacy state source must be a regular non-symlink file: ${candidate}`);
  }
  if (stat.size > BigInt(MAX_V1_REGENERATION_SOURCE_BYTES)) {
    throw new Error(`legacy state source exceeds ${MAX_V1_REGENERATION_SOURCE_BYTES} bytes: ${candidate}`);
  }
  const real = realpathSync(candidate);
  if (!inside(projectRoot, real)) throw new Error(`legacy state source resolves outside project root: ${value}`);
  return {
    absolute: candidate,
    relative: relativePath.split(sep).join("/"),
    device: stat.dev,
    inode: stat.ino,
  };
}

function readSourceBytes(path: ReturnType<typeof sourcePath>): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.dev !== path.device || before.ino !== path.inode) {
      throw new Error("legacy state source changed while opening it");
    }
    if (before.size > BigInt(MAX_V1_REGENERATION_SOURCE_BYTES)) {
      throw new Error(`legacy state source exceeds ${MAX_V1_REGENERATION_SOURCE_BYTES} bytes: ${path.absolute}`);
    }
    const capacity = Math.min(MAX_V1_REGENERATION_SOURCE_BYTES + 1, Number(before.size) + 1);
    const buffer = Buffer.allocUnsafe(capacity);
    let total = 0;
    while (total < buffer.length) {
      const count = readSync(fd, buffer, total, buffer.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > MAX_V1_REGENERATION_SOURCE_BYTES) {
      throw new Error(`legacy state source exceeds ${MAX_V1_REGENERATION_SOURCE_BYTES} bytes: ${path.absolute}`);
    }
    const raw = buffer.subarray(0, total);
    const after = fstatSync(fd, { bigint: true });
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || BigInt(raw.length) !== before.size
    ) {
      throw new Error("legacy state source changed while reading it");
    }
    return raw;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function field(markdown: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^-\\s*\\*\\*${escaped}\\*\\*[：:]\\s*(.+?)\\s*$`, "m").exec(markdown);
  if (!match) return null;
  const value = match[1].trim();
  return value ? value.slice(0, 512) : null;
}

function readLegacySource(projectRoot: string, value: string, sourceVersion: string | null): LegacySourceSnapshot {
  const path = sourcePath(projectRoot, value);
  const raw = readSourceBytes(path);
  let markdown: string;
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new Error("legacy state source must be valid UTF-8 Markdown");
  }
  if (!/^#\s+AI-DLC\s+状态跟踪\s*$/m.test(markdown)) {
    throw new Error("legacy state source is not a recognized V1 AI-DLC state.md: missing title");
  }
  if (!/^##\s+项目信息\s*$/m.test(markdown)) {
    throw new Error("legacy state source is not a recognized V1 AI-DLC state.md: missing project information");
  }
  if (!/^##\s+(阶段进度|产品级进度)\s*$/m.test(markdown)) {
    throw new Error("legacy state source is not a recognized V1 AI-DLC state.md: missing progress section");
  }
  const projectType = field(markdown, "项目类型");
  if (!projectType || /[{}]/.test(projectType)) {
    throw new Error("legacy state source has no concrete project type");
  }
  const stateModeText = field(markdown, "状态模式版本");
  const stateModeVersion = stateModeText && /^\d+$/.test(stateModeText) ? Number(stateModeText) : null;
  return {
    raw,
    source: {
      path: path.relative,
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: raw.length,
      state_mode_version: stateModeVersion,
      package_version: sourceVersion,
      project_type: projectType,
      execution_path: field(markdown, "执行路径"),
      current_phase: field(markdown, "当前阶段"),
      current_step: field(markdown, "当前步骤"),
    },
  };
}

function deterministicWorkflowId(
  projectRoot: string,
  options: Options,
  source: V1RegenerationSource,
): string {
  const digest = createHash("sha256")
    .update([
      "loeyae-aidlc-v1-regeneration-v1",
      projectRoot,
      source.path,
      source.sha256,
      options.scope,
      options.withPrd ? "with-prd" : "without-prd",
      options.sourceVersion || "",
    ].join("\n"))
    .digest("hex");
  return `v1-${digest.slice(0, 32)}`;
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function main(): void {
  const options = parse(process.argv.slice(2));
  const projectRoot = realpathSync(process.cwd());
  validateWorkflowStateV3Target(projectRoot);
  const machineStatePath = statePath(projectRoot);
  const machineStateExists = pathEntryExists(machineStatePath);
  if (machineStateExists) {
    let enrollment: EnrollmentRecord | null;
    try {
      enrollment = readEnrollment(projectRoot);
    } catch {
      throw new Error(
        `workflow state already exists: ${machineStatePath}; use state migrate-v3 for signed schema v2 or aidlc-continuity for schema v3`,
      );
    }
    const resumableRegeneration = options.apply
      && enrollment?.status === "pending"
      && enrollment.initialization_kind === "workflow_regenerated";
    if (!resumableRegeneration) {
      throw new Error(
        `workflow state already exists: ${machineStatePath}; use state migrate-v3 for signed schema v2 or aidlc-continuity for schema v3`,
      );
    }
  }
  const snapshot = readLegacySource(projectRoot, options.source, options.sourceVersion);
  const workflowId = deterministicWorkflowId(projectRoot, options, snapshot.source);
  const occurredAt = new Date().toISOString();
  const regeneration = {
    identity: options.identity,
    source: snapshot.source,
    source_bytes: snapshot.raw,
    scope: options.scope,
    version: "3.0.0",
    workflow_id: workflowId,
    selected_optional_stages: options.withPrd ? ["prd-generation"] : [],
    occurred_at: occurredAt,
  };
  validateV1RegenerationOptions(regeneration);
  let revision = 1;
  let eventCount = 1;
  if (options.apply) {
    const currentSnapshot = readLegacySource(projectRoot, options.source, options.sourceVersion);
    if (!currentSnapshot.raw.equals(snapshot.raw)) {
      throw new Error("legacy state source changed while preparing schema v3 regeneration");
    }
    const generated = createRegeneratedWorkflowStateV3(regeneration);
    const persisted = initializeWorkflowStateV3(projectRoot, generated);
    revision = persisted.revision;
    eventCount = persisted.events.length;
  }
  process.stdout.write(`${JSON.stringify({
    kind: options.apply ? "state-v3-regeneration-applied" : "state-v3-regeneration-plan",
    applied: options.apply,
    source_generation: "v1",
    source_format: "aidlc-state-markdown",
    source_path: snapshot.source.path,
    source_sha256: snapshot.source.sha256,
    source_bytes: snapshot.source.bytes,
    source_state_mode_version: snapshot.source.state_mode_version,
    source_package_version: snapshot.source.package_version,
    legacy_hints: {
      project_type: snapshot.source.project_type,
      execution_path: snapshot.source.execution_path,
      current_phase: snapshot.source.current_phase,
      current_step: snapshot.source.current_step,
    },
    workflow_id: workflowId,
    target_schema_version: 3,
    target_revision: revision,
    scope: options.scope,
    selected_optional_stages: options.withPrd ? ["prd-generation"] : [],
    signature_algorithm: "ed25519",
    progress_imported: false,
    event_count: eventCount,
    regenerated_by: options.identity,
    message: options.apply
      ? "Schema v3 regenerated atomically. Legacy progress was not trusted or imported; continue through current gates."
      : "Dry run only; rerun with --apply after reviewing the source fingerprint and explicit scope.",
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exit(2);
}
