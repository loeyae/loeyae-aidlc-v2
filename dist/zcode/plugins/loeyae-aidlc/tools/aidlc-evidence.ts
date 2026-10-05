import { createHash, randomUUID } from "crypto";
import { createRequire } from "module";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { spawnSync } from "child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { baselineCodeRef, baselineCommitErrors, workflowBaselineForModule } from "./aidlc-baseline";
import { evidenceRelativePath, i13UcdIdsByMode as sharedI13UcdIdsByMode, readUnitManifest, stageInstanceId, unitManifestPath, unitUcdIds, type UcdExemption } from "./aidlc-execution-context";
import { GLOBAL_WORKFLOW, loadWorkflowState, type WorkflowRef, type WorkflowState } from "./aidlc-light-state";
import { evidenceSourceRevision, integrationStageSlugs, isSplitLayout, loadWorkflowParts, ownerOfInstance, stageAxis } from "./aidlc-workflow-layout";

type ProducerState = WorkflowState;

type CommandRole = "build" | "test" | "check" | "semantic" | "red" | "green" | "baseline";

/** Phases observed by the controlled tdd / code-generation producers. */
export type Phase = "RED" | "GREEN" | "BASELINE";

const PHASE_SENSORS: Record<Phase, string> = { RED: "red-test-evidence", GREEN: "green-test-evidence", BASELINE: "baseline-test-evidence" };

export const SEMANTIC_SENSORS = new Set([
  "review-evidence",
  "test-quality",
  "contract-baseline",
  "functional-design-completeness",
  "nfr-coverage",
  "infrastructure-completeness",
  "implementation-report",
  "frontend-platform-spec",
  "framework-compliance",
  "subagent-evidence",
  "template-completeness",
  "recovery-evidence",
  "prd-completeness",
  "diagram-contract",
  "design-intent-coverage",
  "ui-design-alignment",
  "ui-artifact-consistency",
  "inception-consistency",
  "traceability-matrix",
  "structural-invariants",
  "test-case-derivation",
  "red-test-evidence",
  "green-test-evidence",
  "baseline-test-evidence",
]);

interface CommandSpec {
  id: string;
  role: CommandRole;
  sensor?: string;
  argv: string[];
  cwd?: string;
  timeout_ms?: number;
}

interface ArtifactSpec {
  id: string;
  path: string;
}

interface EvidenceConfig {
  version: "1";
  stage: string;
  commands: CommandSpec[];
  artifacts?: ArtifactSpec[];
}

interface TestStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface CommandResult {
  id: string;
  role: CommandRole;
  sensor?: string;
  argv_digest: string;
  cwd: string;
  exit_code: number;
  status: "passed";
  duration_ms: number;
  stdout_tail?: string;
  stderr_tail?: string;
  test_stats?: TestStats;
}

const PROJECT_ROOT = realpathSync(process.cwd());
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = ".aidlc/evidence-commands.json";
const STAGE_CONFIG_DIR = ".aidlc/commands";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TAIL_LENGTH = 200;
const require = createRequire(import.meta.url);

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Environment for a controlled child process (semantic checker or RED/GREEN command).
 * The active module/unit are exported only when non-empty; inherited values are
 * dropped so a project-axis stage never looks like an (empty) module request.
 */
export function semanticCheckerEnv(
  state: Pick<ProducerState, "current_stage" | "current_module" | "current_unit">,
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
  delete env.AIDLC_ACTIVE_MODULE;
  delete env.AIDLC_ACTIVE_UNIT;
  env.AIDLC_ACTIVE_STAGE = state.current_stage || "";
  if (state.current_module) env.AIDLC_ACTIVE_MODULE = state.current_module;
  if (state.current_unit) env.AIDLC_ACTIVE_UNIT = state.current_unit;
  return env;
}

/**
 * Command allowlist lookup: an explicit --config wins; otherwise the stage's own
 * `.aidlc/commands/<stage>.json`; otherwise the shared `.aidlc/evidence-commands.json`.
 * Whichever file is chosen is still stage-locked and validated by parseConfig.
 */
export function resolveCommandConfigPath(projectRoot: string, stage: string, explicit?: string): string {
  if (explicit) return resolve(projectRoot, explicit);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(stage)) fail(`stage must contain only lowercase letters, digits, and hyphens: ${stage}`);
  const perStage = resolve(projectRoot, STAGE_CONFIG_DIR, `${stage}.json`);
  return existsSync(perStage) ? perStage : resolve(projectRoot, DEFAULT_CONFIG);
}

/** Comparable form of a config path: resolved, real path when it exists, no trailing separator, case-folded on Windows. */
function comparableConfigPath(path: string): string {
  let value = resolve(path);
  if (existsSync(value)) value = realpathSync.native(value);
  value = value.replace(/[\\/]+$/, "") || value;
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/**
 * RED/GREEN/BASELINE gates bind observed commands to the default allowlist lookup only
 * (`.aidlc/commands/<stage>.json` → `.aidlc/evidence-commands.json`). An explicit
 * --config naming any other file would yield evidence the gate always rejects, so the
 * producer refuses it before running a command or writing evidence.
 */
function assertPhaseConfigBinding(options: ProducerOptions, label = "RED/GREEN"): void {
  if (options.explicitConfig === undefined) return;
  const requested = resolve(PROJECT_ROOT, options.explicitConfig);
  const lookup = resolveCommandConfigPath(PROJECT_ROOT, options.stage);
  if (comparableConfigPath(requested) === comparableConfigPath(lookup)) return;
  fail(`${label} evidence binds only the default allowlist lookup (.aidlc/commands/${options.stage}.json, then ${DEFAULT_CONFIG}); --config ${options.explicitConfig} names another file. Put the ${label.toLowerCase()} command in .aidlc/commands/${options.stage}.json and omit --config`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function safeProjectPath(value: string, field: string, mustExist = false): string {
  const candidate = resolve(PROJECT_ROOT, nonEmptyString(value, field));
  if (!isInside(PROJECT_ROOT, candidate)) fail(`${field} escapes project root: ${value}`);

  const rel = relative(PROJECT_ROOT, candidate);
  let cursor = PROJECT_ROOT;
  if (rel) {
    for (const segment of rel.split(sep)) {
      cursor = join(cursor, segment);
      if (!existsSync(cursor)) break;
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink()) fail(`${field} traverses a symbolic link: ${cursor}`);
    }
  }
  if (mustExist && !existsSync(candidate)) fail(`${field} does not exist: ${candidate}`);
  if (existsSync(candidate)) {
    const real = realpathSync(candidate);
    if (!isInside(PROJECT_ROOT, real)) fail(`${field} resolves outside project root: ${candidate}`);
  }
  return candidate;
}

function requireRegularFile(path: string, field: string): string {
  const safe = safeProjectPath(path, field, true);
  const stat = lstatSync(safe);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${field} must be a regular non-symlink file: ${safe}`);
  return safe;
}

function requireDirectory(path: string, field: string): string {
  const safe = safeProjectPath(path, field, true);
  const stat = lstatSync(safe);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${field} must be a regular non-symlink directory: ${safe}`);
  return safe;
}

function evidenceOutput(stage: string, sensor: string, value: string | undefined, state: ProducerState): string {
  const safeStage = nonEmptyString(stage, "stage");
  const safeSensor = nonEmptyString(sensor, "sensor");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(safeStage) || !/^[a-z0-9][a-z0-9-]*$/.test(safeSensor)) {
    fail("stage and sensor must contain only lowercase letters, digits, and hyphens");
  }
  const axis = state.current_unit ? "unit" : state.current_module ? "module" : "project";
  const relativeOutput = evidenceRelativePath(safeStage, safeSensor, axis, { module_id: state.current_module, unit_id: state.current_unit });
  const expected = resolve(PROJECT_ROOT, relativeOutput);
  const output = value ? safeProjectPath(value, "output") : safeProjectPath(expected, "output");
  if (output !== expected) fail(`output must be ${expected}`);
  return output;
}

function executionContext(state: ProducerState): Record<string, unknown> {
  return {
    stage_instance: state.current_stage_instance || null,
    module_id: state.current_module || null,
    unit_id: state.current_unit || null,
  };
}

function redact(value: string): string {
  return value.replace(
    /((?:authorization|token|secret|password|api[_-]?key)(?:\s*[:=]\s*|\s+))(?:bearer\s+)?[^\s,;"']+/gi,
    "$1[REDACTED]",
  );
}

function tail(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  return redact(text.slice(-TAIL_LENGTH));
}

export function argvDigest(argv: string[]): string {
  return createHash("sha256").update(JSON.stringify(argv)).digest("hex");
}

/** checker.argv_digest of controlled RED/GREEN/BASELINE evidence: derived from the observed command digest. */
export function phaseObservationDigest(phase: Phase, commandDigest: string): string {
  return argvDigest([`${phase}-observation`, commandDigest]);
}

/** checker.argv_digest of a `not_required` RED/BASELINE record (no command was observed). */
export function phaseNotRequiredDigest(phase: Phase): string {
  return argvDigest([`${phase}-not-required`]);
}

/** checker.argv_digest of a `not_required` record of a unit with an empty UC-D subset (4.8.0): bound to the executed validation_command. */
export function ucdExemptionDigest(phase: Phase, commandDigest: string): string {
  return argvDigest([`${phase}-ucd-exemption`, commandDigest]);
}

/**
 * The `ucd_exemption` of a unit in its module's unit manifest (4.8.0), shared by the
 * producer and the gate. Throws when the manifest cannot be read or is malformed.
 */
export function unitUcdExemption(projectRoot: string, moduleId: string, unitId: string): UcdExemption | undefined {
  const unit = readUnitManifest(projectRoot, moduleId).find((candidate) => candidate.unit_id === unitId);
  if (!unit) throw new Error(`unit ${unitId} is not declared in the unit manifest of module ${moduleId}`);
  return unit.ucd_exemption;
}

/** The single allowlisted red/green/baseline command of a stage; fails unless exactly one is declared. */
function phaseCommand(config: EvidenceConfig, stage: string, phase: Phase): CommandSpec {
  const role = phase.toLowerCase() as "red" | "green" | "baseline";
  const declarations = config.commands.filter((command) => command.role === role);
  if (declarations.length !== 1) fail(`allowlist must declare exactly one ${role} command for ${stage}`);
  return declarations[0];
}

/**
 * Gate-side lookup of the command a controlled RED/GREEN/BASELINE observation must have run:
 * the same allowlist resolution (`resolveCommandConfigPath`, no explicit --config) and
 * the same stage-locked parser the producer uses. Throws when the allowlist is missing,
 * unreadable, locked to another stage, or does not declare exactly one command.
 */
export function allowlistedPhaseCommand(stage: string, phase: Phase): { id: string; argv_digest: string; config: string } {
  const config = resolveCommandConfigPath(PROJECT_ROOT, stage);
  const command = phaseCommand(requireCommandConfig(config, stage), stage, phase);
  return { id: command.id, argv_digest: argvDigest(command.argv), config };
}

function validateArgv(argv: unknown, field: string): string[] {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((item) => typeof item === "string" && item.length > 0)) {
    fail(`${field} must be a non-empty string array`);
  }
  const values = argv as string[];
  const executable = values[0];
  if (isAbsolute(executable) || executable.includes("..")) {
    fail(`${field}[0] must be a PATH executable or project-relative executable, not an absolute/traversal path`);
  }
  if (/[;&|<>`$]/.test(executable)) fail(`${field}[0] contains shell syntax`);
  return values;
}

function validateSemanticDeclaration(spec: CommandSpec): void {
  const expected = ["loeyae-aidlc", "check", "--sensor", spec.sensor || ""];
  if (JSON.stringify(spec.argv) !== JSON.stringify(expected)) {
    fail(`semantic checker ${spec.id} must declare the built-in command: ${expected.join(" ")}`);
  }
}

function configExample(stage: string): string {
  return JSON.stringify({ version: "1", stage, commands: [{ id: "unit-tests", role: "test", argv: ["npm", "test"] }] });
}

/** Command allowlist for build/test/check/red/green commands (and the tdd baseline command): required, stage-locked, non-empty. */
function requireCommandConfig(path: string, stage: string): EvidenceConfig {
  if (!existsSync(path)) {
    fail(`command allowlist ${path} is required for build/test/check/red/green commands of stage ${stage}; minimal example: ${configExample(stage)}`);
  }
  return parseConfig(path, stage);
}

/**
 * Built-in semantic checkers need no external command, so the allowlist is optional for them.
 * A missing allowlist or one written for another stage is ignored; a matching one is still validated.
 */
function optionalSemanticConfig(path: string, stage: string): EvidenceConfig | null {
  if (!existsSync(path)) return null;
  let declaredStage: unknown;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> | null;
    declaredStage = value && typeof value === "object" ? value.stage : undefined;
  } catch {
    return parseConfig(path, stage, true);
  }
  if (declaredStage !== stage) return null;
  return parseConfig(path, stage, true);
}

function parseConfig(path: string, stage: string, allowEmptyCommands = false): EvidenceConfig {
  const configPath = requireRegularFile(path, "config");
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    fail(`cannot read command allowlist ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("command allowlist must be a JSON object");
  const config = value as Record<string, unknown>;
  if (config.version !== "1") fail('command allowlist version must be "1"');
  if (config.stage !== stage) {
    fail(`command allowlist stage must be "${stage}"; use ${STAGE_CONFIG_DIR}/${stage}.json (or update ${DEFAULT_CONFIG}) for the active stage, minimal example: ${configExample(stage)}`);
  }
  if (!Array.isArray(config.commands) || (!allowEmptyCommands && config.commands.length === 0)) fail("command allowlist commands must be non-empty");

  const ids = new Set<string>();
  const commands: CommandSpec[] = [];
  for (let i = 0; i < config.commands.length; i++) {
    const item = config.commands[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`commands[${i}] must be an object`);
    const record = item as Record<string, unknown>;
    const id = nonEmptyString(record.id, `commands[${i}].id`);
    if (ids.has(id)) fail(`duplicate command id: ${id}`);
    ids.add(id);
    const role = nonEmptyString(record.role, `commands[${i}].role`) as CommandRole;
    if (!["build", "test", "check", "semantic", "red", "green", "baseline"].includes(role)) fail(`commands[${i}].role must be build, test, check, semantic, red, green, or baseline`);
    const sensor = role === "semantic" ? nonEmptyString(record.sensor, `commands[${i}].sensor`) : undefined;
    if (sensor && !SEMANTIC_SENSORS.has(sensor)) fail(`commands[${i}].sensor is not a supported semantic sensor: ${sensor}`);
    const argv = validateArgv(record.argv, `commands[${i}].argv`);
    const cwd = record.cwd === undefined ? PROJECT_ROOT : requireDirectory(String(record.cwd), `commands[${i}].cwd`);
    const timeout = record.timeout_ms === undefined ? 10 * 60 * 1000 : Number(record.timeout_ms);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
      fail(`commands[${i}].timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
    }
    const spec = { id, role, sensor, argv, cwd, timeout_ms: timeout };
    if (role === "semantic") validateSemanticDeclaration(spec);
    commands.push(spec);
  }

  const artifacts: ArtifactSpec[] = [];
  if (config.artifacts !== undefined) {
    if (!Array.isArray(config.artifacts)) fail("artifacts must be an array");
    const artifactIds = new Set<string>();
    for (let i = 0; i < config.artifacts.length; i++) {
      const item = config.artifacts[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) fail(`artifacts[${i}] must be an object`);
      const record = item as Record<string, unknown>;
      const id = nonEmptyString(record.id, `artifacts[${i}].id`);
      if (artifactIds.has(id)) fail(`duplicate artifact id: ${id}`);
      artifactIds.add(id);
      artifacts.push({ id, path: requireRegularFile(String(record.path), `artifacts[${i}].path`) });
    }
  }

  return { version: "1", stage, commands, artifacts };
}

function parseTestStats(output: string): TestStats | null {
  const passed = [...output.matchAll(/(?:^|[^\d])(\d+)\s+(?:tests?\s+)?passed\b/gi)].reduce((sum, match) => sum + Number(match[1]), 0);
  const failed = [...output.matchAll(/(?:^|[^\d])(\d+)\s+(?:tests?\s+)?failed\b/gi)].reduce((sum, match) => sum + Number(match[1]), 0);
  const skipped = [...output.matchAll(/(?:^|[^\d])(\d+)\s+(?:tests?\s+)?skipped\b/gi)].reduce((sum, match) => sum + Number(match[1]), 0);
  if (passed === 0 && failed === 0 && skipped === 0) return null;
  const explicitTotal = output.match(/(?:tests?\s*[:=]|total\s*[:=])\s*(\d+)/i);
  const total = explicitTotal ? Number(explicitTotal[1]) : passed + failed + skipped;
  if (!Number.isInteger(total) || total < 1) return null;
  return { total, passed, failed, skipped };
}

function safeCwdLabel(cwd: string): string {
  return relative(PROJECT_ROOT, cwd) || ".";
}

function runCommand(spec: CommandSpec): CommandResult {
  const cwd = requireDirectory(spec.cwd || PROJECT_ROOT, `command ${spec.id} cwd`);
  const started = Date.now();
  const result = spawnSync(spec.argv[0], spec.argv.slice(1), {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: spec.timeout_ms,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const duration = Date.now() - started;
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout ? String(result.stdout) : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr ? String(result.stderr) : "";
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error || exitCode !== 0) {
    const detail = result.error ? result.error.message : `exit code ${exitCode}`;
    fail(`command ${spec.id} failed: ${detail}; ${tail(stderr) || tail(stdout) || "no output"}`);
  }
  const command: CommandResult = {
    id: spec.id,
    role: spec.role,
    argv_digest: argvDigest(spec.argv),
    cwd: safeCwdLabel(cwd),
    exit_code: exitCode,
    status: "passed",
    duration_ms: duration,
  };
  const stdoutTail = tail(stdout);
  const stderrTail = tail(stderr);
  if (stdoutTail) command.stdout_tail = stdoutTail;
  if (stderrTail) command.stderr_tail = stderrTail;
  if (spec.role === "test") {
    const stats = parseTestStats(`${stdout}\n${stderr}`);
    if (!stats) fail(`test command ${spec.id} completed but no test counts were parsed from its output`);
    command.test_stats = stats;
  }
  return command;
}

function hashArtifact(spec: ArtifactSpec): Record<string, unknown> {
  const path = requireRegularFile(spec.path, `artifact ${spec.id}`);
  const content = readFileSync(path);
  return {
    id: spec.id,
    path: relative(PROJECT_ROOT, path) || ".",
    sha256: createHash("sha256").update(content).digest("hex"),
    size_bytes: content.byteLength,
  };
}

function writeAtomic(path: string, value: string): void {
  const safePath = safeProjectPath(path, "output");
  mkdirSync(dirname(safePath), { recursive: true, mode: 0o700 });
  safeProjectPath(dirname(safePath), "output directory", true);
  const lockPath = `${safePath}.lock`;
  let lockFd: number | undefined;
  let fd: number | undefined;
  const temporary = `${safePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, value, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, safePath);
    requireRegularFile(safePath, "output");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && lockFd === undefined) {
      fail(`another evidence producer is writing ${safePath}`);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (lockFd !== undefined) closeSync(lockFd);
    if (existsSync(temporary)) unlinkSync(temporary);
    if (lockFd !== undefined && existsSync(lockPath)) unlinkSync(lockPath);
  }
}

function producedEvidence(unsigned: Record<string, unknown>): Record<string, unknown> {
  return unsigned;
}

function blockedReport(stdout: string): Record<string, unknown> | null {
  if (!stdout) return null;
  try {
    const value = JSON.parse(stdout.split(/\r?\n/)[0]) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).status === "blocked"
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Diagnostics for a fail-closed checker: .aidlc/reports/<stage>/[<module>/[<unit>/]]<sensor>.blocked.json. */
function writeBlockedReport(sensor: string, state: ProducerState, report: Record<string, unknown>): string {
  const axis = state.current_unit ? "unit" : state.current_module ? "module" : "project";
  const evidenceRelative = evidenceRelativePath(state.current_stage || "unknown", sensor, axis, { module_id: state.current_module, unit_id: state.current_unit });
  const reportRelative = evidenceRelative.replace(/\\/g, "/").replace(/^\.aidlc\/evidence\//, ".aidlc/reports/").replace(/\.json$/, ".blocked.json");
  if (!reportRelative.startsWith(".aidlc/reports/")) fail(`cannot derive blocked report path from ${evidenceRelative}`);
  const body = {
    ...report,
    report_kind: "semantic-checker-blocked",
    sensor,
    stage: state.current_stage || null,
    module_id: state.current_module || null,
    unit_id: state.current_unit || null,
    timestamp: new Date().toISOString(),
    note: "diagnostic only; not gate evidence — fix the violations and rerun the controlled producer",
  };
  writeAtomic(resolve(PROJECT_ROOT, reportRelative), `${JSON.stringify(body, null, 2)}\n`);
  return reportRelative;
}

function runSemanticCommand(sensor: string, timeoutMs: number, state: ProducerState): { payload: Record<string, unknown>; execution: Record<string, unknown> } {
  const tsx = require.resolve("tsx/cli");
  const checker = resolve(TOOL_DIR, "aidlc-semantic-checks.ts");
  // Split layout: pass the module scope explicitly so module-owned checkers (diagram-contract)
  // only inspect the module's own artifacts.
  const scopeArgs = isSplitLayout(PROJECT_ROOT) && state.current_module
    ? ["--module", state.current_module, ...(state.current_unit ? ["--unit", state.current_unit] : [])]
    : [];
  const argv = [process.execPath, tsx, checker, "--sensor", sensor, ...scopeArgs];
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: PROJECT_ROOT,
    env: semanticCheckerEnv(state),
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const duration = Date.now() - started;
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : result.stdout ? String(result.stdout).trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr ? String(result.stderr) : "";
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error || exitCode !== 0) {
    const detail = result.error ? result.error.message : `exit code ${exitCode}`;
    // A checker that fails closed may print a structured blocked report ({status:"blocked", ...}) on
    // stdout. Persist it outside .aidlc/evidence (it is diagnostics, never gate-accepted evidence).
    const report = blockedReport(stdout);
    const reportNote = report ? `; blocked report: ${writeBlockedReport(sensor, state, report)}` : "";
    fail(`built-in semantic checker ${sensor} failed: ${detail}; ${tail(stderr) || tail(stdout) || "no output"}${reportNote}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    fail(`built-in semantic checker ${sensor} must return one JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`built-in semantic checker ${sensor} must return a JSON object`);
  const payload = parsed as Record<string, unknown>;
  for (const field of ["evidence_version", "timestamp", "producer", "source_revision", "checker"]) {
    if (field in payload) fail(`semantic checker must not provide producer-controlled field ${field}`);
  }
  if (typeof payload.status !== "string" || payload.status.trim().length === 0) fail(`semantic checker ${sensor} must provide a non-empty status`);
  return {
    payload,
    execution: {
      id: `builtin:${sensor}`,
      sensor,
      argv_digest: argvDigest(argv),
      exit_code: exitCode,
      status: "passed",
      duration_ms: duration,
    },
  };
}

function phaseRecord(state: ProducerState): Record<string, unknown> {
  if (!state.current_module) fail("RED/GREEN/BASELINE evidence requires an active module");
  const path = resolve(PROJECT_ROOT, evidenceRelativePath("test-case-derivation", "test-case-derivation", "module", { module_id: state.current_module }));
  if (!existsSync(path)) fail(`I13 evidence is missing: ${path}`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch (error) { fail(`I13 evidence is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("I13 evidence must be a JSON object");
  return value as Record<string, unknown>;
}

/**
 * UC-D ids of a `required` I13 record grouped by tdd_mode (4.6.0 S2 `ucd_modes`).
 * I13 evidence without `ucd_modes` predates 4.6 and means every UC-D is new.
 * (Defined with the 4.8.0 unit scope in aidlc-execution-context; re-exported here.)
 */
export const i13UcdIdsByMode = sharedI13UcdIdsByMode;

/**
 * Distinct code ref paths of the I13 `characterization[]` with the blob each had at the
 * workflow baseline. `ucdIds` (4.8.0 unit scope) keeps only the entries of those UC-Ds.
 */
export function i13CodeRefBlobs(i13: Record<string, unknown>, ucdIds?: string[]): Array<{ path: string; baseline_blob: string }> {
  const all = Array.isArray(i13.characterization) ? i13.characterization : fail("I13 characterization must list the code_refs of every characterization UC-D");
  const entries = ucdIds === undefined ? all : all.filter((entry) => entry && typeof entry === "object" && ucdIds.includes(String((entry as Record<string, unknown>).ucd)));
  const blobs = new Map<string, string>();
  for (const entry of entries) {
    const refs = entry && typeof entry === "object" && Array.isArray((entry as Record<string, unknown>).code_refs) ? (entry as Record<string, unknown>).code_refs as unknown[] : [];
    for (const ref of refs) {
      const record = ref && typeof ref === "object" ? ref as Record<string, unknown> : {};
      const path = typeof record.path === "string" ? record.path : "";
      const blob = typeof record.baseline_blob === "string" ? record.baseline_blob : "";
      if (!path || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(blob)) fail("I13 characterization code_refs entries need path and baseline_blob");
      const known = blobs.get(path);
      if (known !== undefined && known !== blob) fail(`I13 characterization records two baseline blobs for ${path}`);
      blobs.set(path, blob);
    }
  }
  if (blobs.size === 0) fail("I13 characterization declares no code_refs");
  return [...blobs].map(([path, baseline_blob]) => ({ path, baseline_blob }));
}

/**
 * BASELINE precondition, checked before the baseline command runs: every code ref of
 * the I13 characterization is still byte-identical (as a git blob) to the current
 * epoch of the workflow baseline chain (4.7.0; the single baseline when it was never
 * advanced). I13 stays bound to epoch 0, so its own baseline_commit must be the first
 * epoch. A changed, missing or unhashable file fails without writing evidence.
 * `ucdIds` (4.8.0) limits the code refs to the characterization UC-Ds of the unit.
 */
function baselineCodeRefDigests(i13: Record<string, unknown>, state: ProducerState, ucdIds?: string[]): Record<string, unknown> {
  const recorded = typeof i13.baseline_commit === "string" ? i13.baseline_commit : "";
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(recorded)) fail("I13 evidence must record the workflow baseline_commit of its characterization UC-Ds");
  let baseline: ReturnType<typeof workflowBaselineForModule>;
  try {
    baseline = workflowBaselineForModule(PROJECT_ROOT, state.current_module);
  } catch (error) {
    fail(`BASELINE cannot resolve the workflow baseline: ${error instanceof Error ? error.message : String(error)}`);
  }
  const commitErrors = baselineCommitErrors(PROJECT_ROOT, baseline.registered ? { baseline_commit: baseline.commit, baseline_source: baseline.source } : {});
  if (commitErrors.length > 0 || !baseline.registered) fail(`BASELINE requires a usable workflow baseline: ${commitErrors.join("; ")}`);
  if (recorded !== baseline.epochs[0]) fail(`I13 baseline_commit ${recorded} does not match epoch 0 of the workflow baseline (${baseline.epochs[0]})`);
  const commit = baseline.commit;
  const digests = i13CodeRefBlobs(i13, ucdIds).map(({ path }) => {
    const resolved = baselineCodeRef(PROJECT_ROOT, commit, { path }, `code ref ${path}`);
    if ("error" in resolved) fail(`BASELINE refuses to run: ${resolved.error}`);
    const baseline_blob = resolved.blob;
    requireRegularFile(path, `code ref ${path}`);
    const result = spawnSync("git", ["hash-object", "--", path], { cwd: PROJECT_ROOT, encoding: "utf8", shell: false });
    const worktree = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (result.error || result.status !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(worktree)) {
      fail(`cannot hash code ref ${path} with git hash-object: ${result.error ? result.error.message : (result.stderr || "").trim() || `exit ${result.status}`}`);
    }
    if (worktree !== baseline_blob) {
      fail(`BASELINE refuses to run: code ref ${path} changed since the workflow baseline ${commit} (worktree blob ${worktree}, baseline blob ${baseline_blob}); characterization tests must observe the unmodified baseline code`);
    }
    return { path, baseline_blob, worktree_blob: worktree };
  });
  return { baseline_commit: commit, code_ref_digests: digests };
}

function phaseObservation(stdout: string, phase: Phase): Record<string, unknown> {
  for (const line of stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).phase === phase) return value as Record<string, unknown>;
    } catch { }
  }
  fail(`controlled ${phase} command must emit one JSON observation with phase=${phase}`);
}

function validatePhaseObservation(value: Record<string, unknown>, phase: Phase): void {
  if (value.phase !== phase) fail(`controlled evidence phase must be ${phase}`);
  if (value.compile_status !== "passed") fail(`${phase} evidence compile_status must be passed`);
  if (value.environment_status !== "passed") fail(`${phase} evidence environment_status must be passed`);
  if (typeof value.tests_total !== "number" || !Number.isInteger(value.tests_total) || value.tests_total < 1) fail(`${phase} evidence tests_total must be >= 1`);
  if (typeof value.tests_failed !== "number" || !Number.isInteger(value.tests_failed) || value.tests_failed < 0) fail(`${phase} evidence tests_failed must be a non-negative integer`);
  if (value.traceability_complete !== true) fail(`${phase} evidence traceability_complete must be true`);
  if (!Array.isArray(value.uc_mapping) || value.uc_mapping.length === 0) fail(`${phase} evidence uc_mapping must be non-empty`);
  if (phase === "RED") {
    if (value.status !== "failed" || value.failure_class !== "behavior" || typeof value.failure_signature !== "string" || value.failure_signature.trim().length === 0) fail("RED evidence must be a behavior assertion failure with a non-empty failure_signature");
    if (value.tests_failed < 1) fail("RED evidence tests_failed must be >= 1");
  } else {
    if (value.status !== "passed" || value.tests_failed !== 0) fail(`${phase} evidence must be passed with tests_failed=0`);
  }
}

function runPhaseProducer(options: ProducerOptions, state: ProducerState, phase: Phase): void {
  assertPhaseConfigBinding(options, phase === "BASELINE" ? "BASELINE" : "RED/GREEN");
  const sensor = PHASE_SENSORS[phase];
  const i13 = phaseRecord(state);
  const output = options.output || evidenceOutput(options.stage, sensor, undefined, state);
  let payload: Record<string, unknown>;
  let execution: Record<string, unknown>;
  const notRequired = (reason: string): void => {
    // No UC-D of this phase's tdd_mode: nothing to observe, so no command runs and the
    // allowlist need not declare one. The gate re-derives the verdict from I13.
    payload = { status: "not_required", phase, ucd_ids: [], not_required_reason: reason };
    execution = { id: `builtin:${sensor}`, sensor, argv_digest: phaseNotRequiredDigest(phase), exit_code: 0, status: "passed" };
  };
  const modes = i13.status === "required" ? i13UcdIdsByMode(i13) : { new: [], characterization: [] };
  // 4.8.0: with I13 ucd_units a unit observes only the UC-Ds its unit_refs name.
  const scope = i13.status === "required" ? unitUcdIds(i13, state.current_unit) : null;
  const unitLabel = `unit ${state.current_unit}`;
  if (i13.status === "not_applicable" && phase === "BASELINE") {
    notRequired("I13 declared no executable business behavior, so no UC-D uses tdd_mode characterization");
  } else if (i13.status === "not_applicable") {
    const config = requireCommandConfig(options.config, options.stage);
    const reason = typeof i13.reason === "string" ? i13.reason : typeof i13.not_applicable_reason === "string" ? i13.not_applicable_reason : "I13 declared no executable business behavior";
    const alternative = typeof i13.alternative_validation === "string" ? i13.alternative_validation : "controlled alternative validation";
    const checks = config.commands.filter((command) => command.role === "check");
    if (checks.length !== 1) fail(`I13 not_applicable requires exactly one controlled check command for ${options.stage}`);
    const check = runCommand(checks[0]);
    const alternativeValidationExecution = {
      id: check.id,
      argv_digest: check.argv_digest,
      cwd: check.cwd,
      exit_code: check.exit_code,
      status: check.status,
      duration_ms: check.duration_ms,
    };
    payload = {
      status: "not_applicable",
      phase,
      not_applicable_reason: reason,
      alternative_validation: alternative,
      alternative_validation_execution: alternativeValidationExecution,
      red_exemption: phase === "RED" ? reason : undefined,
    };
    execution = { id: `builtin:${options.sensor}`, sensor: options.sensor, argv_digest: argvDigest(["I13-not-applicable", phase, check.argv_digest]), exit_code: 0, status: "passed" };
  } else if (i13.status !== "required") {
    fail(`I13 evidence status must be required or not_applicable, got ${String(i13.status)}`);
  } else if (scope!.scoped && scope!.all.length === 0) {
    // A unit that owns no UC-D (e.g. a contract unit): its structured exemption is
    // validated by really running validation_command before anything is written.
    const moduleId = state.current_module!;
    const unitId = state.current_unit!;
    let exemption: UcdExemption | undefined;
    try {
      exemption = unitUcdExemption(PROJECT_ROOT, moduleId, unitId);
    } catch (error) {
      fail(`${unitLabel} owns no UC-D of module ${moduleId} (unit_refs) and its ucd_exemption cannot be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!exemption) {
      fail(`${unitLabel} owns no UC-D of module ${moduleId} (unit_refs); declare ucd_exemption for it in ${relative(PROJECT_ROOT, unitManifestPath(PROJECT_ROOT, moduleId)).replace(/\\/g, "/")} (reason_code, reason, approval_ref, alternative_validation, validation_command) before ${phase} can be not_required`);
    }
    const check = runCommand({ id: `ucd-exemption:${unitId}`, role: "check", argv: validateArgv(exemption.validation_command, `${unitLabel} ucd_exemption.validation_command`) });
    payload = {
      status: "not_required",
      phase,
      ucd_ids: [],
      not_required_reason: `${unitLabel} owns no UC-D of module ${moduleId}; ucd_exemption ${exemption.reason_code}: ${exemption.reason}`,
      ucd_exemption: { reason_code: exemption.reason_code, reason: exemption.reason, approval_ref: exemption.approval_ref, alternative_validation: exemption.alternative_validation },
      exemption_validation_execution: { id: check.id, argv_digest: check.argv_digest, cwd: check.cwd, exit_code: check.exit_code, status: check.status, duration_ms: check.duration_ms },
    };
    execution = { id: `builtin:${sensor}`, sensor, argv_digest: ucdExemptionDigest(phase, check.argv_digest), exit_code: 0, status: "passed" };
  } else if (phase === "RED" && scope!.new.length === 0) {
    notRequired(scope!.scoped ? `${unitLabel} owns no tdd_mode new UC-D` : "I13 declares no tdd_mode new UC-D");
  } else if (phase === "BASELINE" && scope!.characterization.length === 0) {
    notRequired(scope!.scoped ? `${unitLabel} owns no tdd_mode characterization UC-D` : "I13 declares no tdd_mode characterization UC-D");
  } else {
    const config = requireCommandConfig(options.config, options.stage);
    const command = phaseCommand(config, options.stage, phase);
    // BASELINE observes the unmodified baseline code: verified before the command runs.
    const baselineFields = phase === "BASELINE" ? baselineCodeRefDigests(i13, state, scope!.scoped ? scope!.characterization : undefined) : {};
    const started = Date.now();
    const result = spawnSync(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd || PROJECT_ROOT,
      env: semanticCheckerEnv(state, process.env, { AIDLC_PHASE: phase }),
      encoding: "utf8",
      shell: false,
      timeout: command.timeout_ms,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const duration = Date.now() - started;
    const exitCode = typeof result.status === "number" ? result.status : 1;
    const expectedExit = phase === "RED" ? 1 : 0;
    if (result.error || exitCode !== expectedExit) fail(`controlled ${phase} command ${command.id} must exit ${expectedExit}; got ${exitCode}${result.error ? ` (${result.error.message})` : ""}`);
    const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout ? String(result.stdout) : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr ? String(result.stderr) : "";
    payload = phaseObservation(`${stdout}\n${stderr}`, phase);
    validatePhaseObservation(payload, phase);
    // The observed test command legitimately exits 1 for RED, so it is recorded as
    // observed_command; `checker` describes the built-in producer check that validated
    // the observation (same contract as every other semantic sensor).
    const commandDigest = argvDigest(command.argv);
    // A unit-scoped observation (4.8.0) records the UC-D subset it had to cover.
    const scopedIds = scope!.scoped ? { ucd_ids: phase === "RED" ? scope!.new : phase === "BASELINE" ? scope!.characterization : scope!.all } : {};
    payload = {
      ...payload,
      ...scopedIds,
      ...baselineFields,
      observed_command: { id: command.id, phase, argv_digest: commandDigest, cwd: safeCwdLabel(command.cwd || PROJECT_ROOT), exit_code: exitCode, expected_exit_code: expectedExit, duration_ms: duration },
    };
    execution = { id: `builtin:${sensor}`, sensor, argv_digest: phaseObservationDigest(phase, commandDigest), exit_code: 0, status: "passed", duration_ms: duration };
  }
  writeAtomic(output, `${JSON.stringify({ ...payload!, ...executionContext(state), evidence_version: "1", timestamp: new Date().toISOString(), producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() }, source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance), checker: execution! }, null, 2)}\n`);
  if (!options.output) console.log(JSON.stringify({ status: "passed", output, sensor, phase }, null, 2));
}

function runSemanticProducer(options: ProducerOptions, config: EvidenceConfig | null, state: ProducerState, quiet = false): void {
  const sensor = options.sensor;
  if (!sensor || sensor === "build-test-evidence") fail("semantic producer requires --sensor with a semantic sensor name");
  if (options.commandIds.length > 0) fail("--command-id is only supported for build/test evidence");
  if (sensor === "red-test-evidence" || sensor === "green-test-evidence" || sensor === "baseline-test-evidence") {
    runPhaseProducer(options, state, sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : "BASELINE");
    return;
  }
  const declarations = (config?.commands || []).filter((command) => command.role === "semantic" && command.sensor === sensor);
  if (declarations.length > 1) fail(`allowlist must declare at most one built-in semantic checker for ${sensor}`);
  const result = runSemanticCommand(sensor, declarations[0]?.timeout_ms || DEFAULT_TIMEOUT_MS, state);
  const output = options.output || evidenceOutput(options.stage, sensor, undefined, state);
  const unsigned = {
    ...result.payload,
    ...executionContext(state),
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
    source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance),
    checker: result.execution,
  };
  writeAtomic(output, `${JSON.stringify(producedEvidence(unsigned), null, 2)}\n`);
  if (!quiet) console.log(JSON.stringify({ status: "passed", output, sensor, checker: `builtin:${sensor}` }, null, 2));
}

interface ProducerOptions {
  stage: string;
  instance?: string;
  module?: string;
  unit?: string;
  refresh: boolean;
  sensor?: string;
  config: string;
  /** Raw --config value as given by the user; unset when the default lookup is used. */
  explicitConfig?: string;
  output?: string;
  commandIds: string[];
  allSensors: boolean;
}

const USAGE = "usage: aidlc-evidence.ts run --stage <stage> [--instance <stage-instance> | --module <module-id> [--unit <unit-id>]] [--refresh] [--sensor <sensor>] [--all-sensors] [--config <path>] [--output <path>] [--command-id <id> ...]";

function parseArgs(args: string[]): ProducerOptions {
  if (args[0] !== "run") fail(USAGE);
  let stage = "";
  let instance: string | undefined;
  let moduleId: string | undefined;
  let unitId: string | undefined;
  let refresh = false;
  let sensor: string | undefined;
  let config: string | undefined;
  let output: string | undefined;
  const commandIds: string[] = [];
  let allSensors = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (["--stage", "--instance", "--module", "--unit", "--sensor", "--config", "--output", "--command-id"].includes(arg)) {
      const value = args[++i];
      if (!value) fail(`${arg} requires a value`);
      if (arg === "--stage") stage = value;
      if (arg === "--instance") instance = value;
      if (arg === "--module") moduleId = value;
      if (arg === "--unit") unitId = value;
      if (arg === "--sensor") sensor = value;
      if (arg === "--config") config = value;
      if (arg === "--output") output = value;
      if (arg === "--command-id") commandIds.push(value);
    } else if (arg === "--all-sensors") {
      allSensors = true;
    } else if (arg === "--refresh") {
      refresh = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE.replace(/^usage: /, "Usage: "));
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!stage) fail("--stage is required");
  if (instance && moduleId) fail("--instance and --module are mutually exclusive");
  if (unitId && !moduleId) fail("--unit requires --module");
  if (sensor && sensor !== "build-test-evidence" && !SEMANTIC_SENSORS.has(sensor)) fail(`unsupported semantic sensor: ${sensor}`);
  if (allSensors && sensor) fail("--all-sensors cannot be combined with --sensor; it uses the sensors declared by the active stage");
  if (allSensors && output && stage !== "build-and-test") fail("--output cannot be used with --all-sensors because each sensor has its own canonical evidence path");
  if (allSensors && commandIds.length > 0) fail("--command-id cannot be used with --all-sensors");
  return {
    stage,
    ...(instance ? { instance } : {}),
    ...(moduleId ? { module: moduleId } : {}),
    ...(unitId ? { unit: unitId } : {}),
    refresh,
    sensor,
    config: safeProjectPath(resolveCommandConfigPath(PROJECT_ROOT, stage, config), "config"),
    ...(config !== undefined ? { explicitConfig: config } : {}),
    output,
    commandIds,
    allSensors,
  };
}

function withProducerLock(output: string, action: () => void): void {
  const safeOutput = safeProjectPath(output, "output");
  mkdirSync(dirname(safeOutput), { recursive: true, mode: 0o700 });
  safeProjectPath(dirname(safeOutput), "output directory", true);
  const lockPath = `${safeOutput}.producer.lock`;
  let lockFd: number | undefined;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    action();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && lockFd === undefined) {
      fail(`another evidence producer is already running for ${safeOutput}`);
    }
    throw error;
  } finally {
    if (lockFd !== undefined) closeSync(lockFd);
    if (lockFd !== undefined && existsSync(lockPath)) unlinkSync(lockPath);
  }
}

/** Which workflow owns this evidence run: the single workflow, or the split owner of the instance. */
function producerOwner(options: ProducerOptions, instance: string | undefined): WorkflowRef {
  if (!isSplitLayout(PROJECT_ROOT)) return GLOBAL_WORKFLOW;
  if (instance) return ownerOfInstance(instance);
  const axis = stageAxis(options.stage);
  if (axis === "project") return integrationStageSlugs().has(options.stage) ? { kind: "integration" } : GLOBAL_WORKFLOW;
  const active = [...loadWorkflowParts(PROJECT_ROOT).parts.values()].filter((part) => part.ref.kind === "module" && part.state.current_stage === options.stage);
  if (active.length === 1) return active[0].ref;
  fail(`split workflow layout: evidence run --stage ${options.stage} needs --module <module-id>${active.length > 1 ? ` (active in ${active.map((part) => (part.ref as { module_id: string }).module_id).join(", ")})` : ""}`);
}

function targetInstance(options: ProducerOptions): string | undefined {
  if (options.instance) return options.instance;
  if (!options.module) return undefined;
  const axis = stageAxis(options.stage);
  if (axis === "module") return stageInstanceId(options.stage, "module", { module_id: options.module });
  if (axis === "unit") {
    if (!options.unit) fail(`stage ${options.stage} is unit-axis; pass --unit <unit-id> with --module`);
    return stageInstanceId(options.stage, "unit", { module_id: options.module, unit_id: options.unit });
  }
  fail(`stage ${options.stage} is project-axis and does not take --module`);
}

function loadProducerState(options: ProducerOptions): ProducerState | null {
  const instance = targetInstance(options);
  const state = loadWorkflowState(PROJECT_ROOT, producerOwner(options, instance));
  if (!state) return null;
  if (!instance || instance === state.current_stage_instance) {
    if (options.refresh) fail("--refresh regenerates evidence for a completed stage instance; the active instance uses a normal evidence run");
    return state;
  }
  const claim = state.active_instances?.[instance];
  const completed = state.completed_stage_instances.includes(instance);
  if (!claim && !(options.refresh && completed)) {
    fail(`stage instance ${instance} is not active${completed ? "; it is completed, pass --refresh to regenerate its evidence" : ""}`);
  }
  const moduleMatch = /@module:([a-z0-9][a-z0-9-]*)/.exec(instance);
  const unitMatch = /@unit:([a-z0-9][a-z0-9-]*)$/.exec(instance);
  const context: ProducerState = {
    ...state,
    current_stage: instance.split("@", 1)[0],
    current_stage_instance: instance,
  };
  if (moduleMatch || claim) context.current_module = moduleMatch?.[1] || claim!.module_id;
  else delete context.current_module;
  if (unitMatch) context.current_unit = unitMatch[1];
  else delete context.current_unit;
  return context;
}

function declaredSemanticSensors(stage: string): string[] {
  const graphPath = resolve(TOOL_DIR, "data", "stage-graph.json");
  if (!existsSync(graphPath)) fail(`stage graph is missing at ${graphPath}; run loeyae-aidlc graph compile first`);
  let graph: unknown;
  try {
    graph = JSON.parse(readFileSync(graphPath, "utf8"));
  } catch (error) {
    fail(`cannot read stage graph ${graphPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stages = graph && typeof graph === "object" && !Array.isArray(graph) && Array.isArray((graph as Record<string, unknown>).stages)
    ? (graph as Record<string, unknown>).stages as unknown[]
    : [];
  const node = stages.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).slug === stage) as Record<string, unknown> | undefined;
  if (!node) fail(`stage ${stage} is not declared in the compiled stage graph`);
  const sensors = Array.isArray(node.sensors) ? node.sensors.filter((sensor): sensor is string => typeof sensor === "string") : [];
  return sensors.filter((sensor) => SEMANTIC_SENSORS.has(sensor));
}

function produceAllSemantic(options: ProducerOptions, state: ProducerState, config: EvidenceConfig | null): void {
  const sensors = declaredSemanticSensors(options.stage);
  if (sensors.length === 0) fail(`stage ${options.stage} declares no semantic sensors; use the stage's ordinary report gates instead`);
  // Checked up front so no other sensor's evidence is written before a RED/GREEN/BASELINE refusal.
  if (sensors.includes("red-test-evidence") || sensors.includes("green-test-evidence")) assertPhaseConfigBinding(options);
  else if (sensors.includes("baseline-test-evidence")) assertPhaseConfigBinding(options, "BASELINE");
  const outputs: string[] = [];
  for (const sensor of sensors) {
    const output = evidenceOutput(options.stage, sensor, undefined, state);
    withProducerLock(output, () => {
      runSemanticProducer({ ...options, sensor, output }, config, state, true);
    });
    outputs.push(output);
  }
  console.log(JSON.stringify({ status: "passed", stage: options.stage, sensors, outputs }, null, 2));
}

function runProducer(args: string[]): void {
  const options = parseArgs(args);
  const state = loadProducerState(options);
  const statusAllowed = state && (state.status === "running" || options.refresh);
  if (!state || !statusAllowed) fail("evidence production requires an active lightweight workflow");
  if (state.current_stage !== options.stage) {
    fail(`stage ${options.stage} is not active; current stage is ${state.current_stage || "(none)"}`);
  }

  if ((options.stage !== "build-and-test" && !options.sensor) || (options.allSensors && options.stage !== "build-and-test")) {
    produceAllSemantic(options, state, optionalSemanticConfig(options.config, options.stage));
    return;
  }

  const outputSensor = options.sensor || "build-test-evidence";
  const output = evidenceOutput(options.stage, outputSensor, options.output, state);
  withProducerLock(output, () => {
    const lockedOptions = { ...options, output };
    if (lockedOptions.sensor && lockedOptions.sensor !== "build-test-evidence") {
      runSemanticProducer(lockedOptions, optionalSemanticConfig(options.config, options.stage), state);
      return;
    }
    if (lockedOptions.stage !== "build-and-test") fail(`stage ${lockedOptions.stage} does not use the build/test producer; pass --sensor <semantic-sensor> or --all-sensors`);
    const config = requireCommandConfig(options.config, options.stage);
    const selected = lockedOptions.commandIds.length === 0
      ? config.commands.filter((command) => command.role !== "semantic")
      : lockedOptions.commandIds.map((id) => {
        const command = config.commands.find((item) => item.id === id && item.role !== "semantic");
        if (!command) fail(`command id is not in the allowlist for build/test evidence: ${id}`);
        return command;
      });
    const roles = new Set(selected.map((command) => command.role));
    if (!roles.has("build") || !roles.has("test") || !roles.has("check")) fail("selected allowlist commands must include build, test, and check roles");

    const commands = selected.map(runCommand);
    const testResults = commands.filter((command) => command.role === "test").map((command) => command.test_stats as TestStats);
    const tests = testResults.reduce((sum, current) => ({
      total: sum.total + current.total,
      passed: sum.passed + current.passed,
      failed: sum.failed + current.failed,
      skipped: sum.skipped + current.skipped,
    }), { total: 0, passed: 0, failed: 0, skipped: 0 });
    if (tests.total < 1 || tests.passed < 1 || tests.failed !== 0) fail(`test summary is not eligible for evidence: ${JSON.stringify(tests)}`);

    const artifacts = (config.artifacts || []).map(hashArtifact);
    const unsigned = {
      ...executionContext(state),
      evidence_version: "1",
      timestamp: new Date().toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
      source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance),
      commands,
      tests,
      checks: { status: "passed", command_ids: commands.filter((command) => command.role === "check").map((command) => command.id) },
      artifacts,
    };
    writeAtomic(output, `${JSON.stringify(producedEvidence(unsigned), null, 2)}\n`);
    console.log(JSON.stringify({ status: "passed", output, tests, commands: commands.length, artifacts: artifacts.length }, null, 2));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runProducer(process.argv.slice(2));
  } catch (error) {
    console.error(`Evidence producer blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
