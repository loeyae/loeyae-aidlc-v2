import { assertSessionClaim, withSessionPublication, sessionBinding, type SessionBinding } from "./aidlc-light-state";
import { createHash, randomUUID } from "crypto";
import { QUALITY_SENSORS, qualityAdoption, recordQualityCheckpoint, type QualitySnapshot } from "./aidlc-quality-gates";
import { SLICE_SENSOR, sliceEvidenceErrors, type SliceContext } from "./aidlc-document-slices";
import { markProgress, startProgressHeartbeat } from "./aidlc-progress";
import { runHistoricalReplay, replayEvidenceErrors, historicalReplayPrior } from "./aidlc-historical-red";
import { createRequire } from "module";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { runSync } from "./aidlc-spawn";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { baselineCodeRef, baselineCommitErrors, baselineKindErrors, epochRepos, extraRepoKeyErrors, workflowBaselineForModule } from "./aidlc-baseline";
import { codeRefRepo, nestedSourceRepos, pendingNestedError, WORKFLOW_REPO_KEY } from "./aidlc-nested-repos";
import { evidenceRelativePath, i13UcdIdsByMode as sharedI13UcdIdsByMode, readUnitManifest, stageInstanceId, unitManifestPath, unitUcdIds, verifiedModuleIds, type UcdExemption } from "./aidlc-execution-context";
import { assertControlledI13 } from "./aidlc-i13-applicability";
import { normalizeUcdSources } from "./aidlc-ucd-declarations";
import { evidenceTimeError } from "./aidlc-evidence-policy";
import { parseTestStats, validTestStats, type TestStats } from "./aidlc-test-stats";
import { nativeNodeCheckTooling } from "./aidlc-node-check-tooling";
import { readSourceRevision, commitAncestryErrors, invalidateRevisionCache, withRevisionMemoization } from "./aidlc-revision";
import { GLOBAL_WORKFLOW, loadWorkflowState, type WorkflowRef, type WorkflowState } from "./aidlc-light-state";
import { evidenceScopeForInstance, evidenceSourceRevision, integrationStageSlugs, isSplitLayout, loadWorkflowParts, ownerOfInstance, stageAxis } from "./aidlc-workflow-layout";

type ProducerState = WorkflowState;

type CommandRole = "build" | "test" | "check" | "semantic" | "red" | "green" | "baseline";

/** Phases observed by the controlled tdd / code-generation producers. */
export type Phase = "RED" | "GREEN" | "BASELINE";

const PHASE_SENSORS: Record<Phase, string> = { RED: "red-test-evidence", GREEN: "green-test-evidence", BASELINE: "baseline-test-evidence" };

export const SEMANTIC_SENSORS = new Set([
  "global-review-evidence", "deployment-validation",
  "document-slice-consistency",
  ...QUALITY_SENSORS,
  "review-evidence",
  "test-quality",
  "contract-baseline",
  "functional-design-completeness",
  "nfr-coverage",
  "infrastructure-completeness",
  "implementation-report",
  "frontend-platform-spec",
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
  evidence_inputs?: { environment: string[] };
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
  freshness?: Record<string, unknown>;
  role_applicability?: { module_id: string; package_json: string; roles: ("build" | "check")[] }[];
  risk_validation?: unknown;
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
  input_binding?: string;
}

const PROJECT_ROOT = realpathSync(process.cwd());
const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = ".aidlc/evidence-commands.json";
const STAGE_CONFIG_DIR = ".aidlc/commands";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
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

/** Current alternative allowlist binding, shared with the no-behavior phase gate. */
export function allowlistedAlternativeCommand(stage: string): { id: string; argv_digest: string; cwd: string } {
  const config = requireCommandConfig(resolveCommandConfigPath(PROJECT_ROOT, stage), stage);
  const checks = config.commands.filter(command => command.role === "check");
  if (checks.length !== 1) fail(`I13 not_applicable requires exactly one controlled check command for ${stage}`);
  return { id: checks[0].id, argv_digest: argvDigest(checks[0].argv), cwd: safeCwdLabel(checks[0].cwd || PROJECT_ROOT) };
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

/** A configured external window cannot be omitted or weakened in an envelope. */
export function evidenceFreshnessBindingErrors(stage: string, evidence: Record<string, unknown>): string[] {
  try {
    const config = optionalSemanticConfig(resolveCommandConfigPath(PROJECT_ROOT, stage), stage);
    return config?.freshness && JSON.stringify(config.freshness) !== JSON.stringify(evidence.freshness)
      ? ["evidence freshness no longer matches the stage command configuration"] : [];
  } catch (error) { return [String(error)]; }
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
    let evidenceInputs: CommandSpec["evidence_inputs"];
    if (record.evidence_inputs !== undefined) {
      const inputs = record.evidence_inputs as Record<string, unknown> | null;
      if (!inputs || Array.isArray(inputs) || Object.keys(inputs).some(key => key !== "environment")
        || !Array.isArray(inputs.environment) || !inputs.environment.every(key => typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
        fail(`commands[${i}].evidence_inputs must declare environment variable names; source ownership belongs in module/unit manifests`);
      }
      evidenceInputs = { environment: [...new Set(inputs.environment as string[])].sort() };
    }
    const spec = { id, role, sensor, argv, cwd, timeout_ms: timeout, ...(evidenceInputs ? { evidence_inputs: evidenceInputs } : {}) };
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

  if (config.freshness !== undefined) {
    const error = evidenceTimeError({ timestamp: "1970-01-01T00:00:00Z", freshness: config.freshness }, "build-test-evidence", 0);
    if (error) fail(error);
  }
  let roleApplicability: EvidenceConfig["role_applicability"];
  if (config.role_applicability !== undefined) {
    if (stage !== "build-and-test" || !Array.isArray(config.role_applicability) || !config.role_applicability.length) fail("role_applicability requires a non-empty C8 module declaration array");
    const modules = new Set<string>();
    roleApplicability = config.role_applicability.map((entry: unknown) => {
      const item = entry as Record<string, unknown> | null;
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["module_id", "package_json", "roles"].includes(key))) fail("invalid role_applicability declaration");
      const moduleId = nonEmptyString(item.module_id, "role_applicability.module_id");
      if (modules.has(moduleId)) fail(`duplicate role applicability module: ${moduleId}`);
      modules.add(moduleId);
      if (!Array.isArray(item.roles) || !item.roles.length || new Set(item.roles).size !== item.roles.length || item.roles.some(role => role !== "build" && role !== "check")) fail("only build/check roles can be explicitly not applicable");
      return { module_id: moduleId, package_json: nonEmptyString(item.package_json, "role_applicability.package_json"), roles: item.roles as ("build" | "check")[] };
    });
  }
  return { version: "1", stage, commands, artifacts, ...(roleApplicability ? { role_applicability: roleApplicability } : {}), ...(config.risk_validation !== undefined ? { risk_validation: config.risk_validation } : {}), ...(config.freshness !== undefined ? { freshness: config.freshness as Record<string, unknown> } : {}) };
}

/** Each declared deployment artifact maps to a real allowlisted check with the same id. */
export function deploymentValidationPayload(): Record<string, unknown> {
  const path = resolveCommandConfigPath(PROJECT_ROOT, "operations-authorization");
  const config = requireCommandConfig(path, "operations-authorization");
  if (!config.artifacts?.length) fail("deployment validation requires actual configuration artifacts");
  const checks = config.commands.filter(command => command.role === "check");
  for (const artifact of config.artifacts) if (!checks.some(command => command.id === artifact.id)) fail(`deployment artifact ${artifact.id} requires a check command with the same id`);
  const files = config.artifacts.map(artifact => ({ id: artifact.id, path: safeCwdLabel(artifact.path).replace(/\\/g, "/"), sha256: createHash("sha256").update(readFileSync(artifact.path)).digest("hex") }));
  const configSha = createHash("sha256").update(readFileSync(path)).digest("hex");
  const commands = checks.map(runCommand);
  const payload = { status: "passed", config_sha256: configSha, files, commands };
  const errors = deploymentValidationErrors(payload);
  if (errors.length) fail(errors.join("; "));
  return payload;
}

export function deploymentValidationErrors(evidence: Record<string, unknown>): string[] {
  try {
    const path = resolveCommandConfigPath(PROJECT_ROOT, "operations-authorization");
    const config = requireCommandConfig(path, "operations-authorization");
    const files = config.artifacts?.map(artifact => ({ id: artifact.id, path: safeCwdLabel(artifact.path).replace(/\\/g, "/"), sha256: createHash("sha256").update(readFileSync(artifact.path)).digest("hex") }));
    const commands = Array.isArray(evidence.commands) ? evidence.commands as CommandResult[] : [];
    const checks = config.commands.filter(command => command.role === "check"), errors: string[] = [];
    if (evidence.status !== "passed" || !files?.length || JSON.stringify(evidence.files) !== JSON.stringify(files)) errors.push("deployment configuration is missing or changed");
    if (evidence.config_sha256 !== createHash("sha256").update(readFileSync(path)).digest("hex")) errors.push("deployment command configuration changed");
    if (commands.length !== checks.length) errors.push("deployment checks must cover every configured check");
    for (const spec of checks) {
      const command = commands.find(item => item.id === spec.id);
      if (!command || command.role !== "check" || command.exit_code !== 0 || command.status !== "passed" || command.argv_digest !== argvDigest(spec.argv) || command.cwd !== safeCwdLabel(spec.cwd || PROJECT_ROOT)) errors.push(`deployment check ${spec.id} is missing, failed or changed`);
    }
    for (const artifact of config.artifacts || []) if (!checks.some(command => command.id === artifact.id)) errors.push(`deployment artifact ${artifact.id} has no validation`);
    return errors;
  } catch (error) { return [String(error)]; }
}

function safeCwdLabel(cwd: string): string {
  return relative(PROJECT_ROOT, cwd) || ".";
}

function runCommand(spec: CommandSpec): CommandResult {
  const cwd = requireDirectory(spec.cwd || PROJECT_ROOT, `command ${spec.id} cwd`);
  const started = Date.now();
  const result = runSync(spec.argv[0], spec.argv.slice(1), {
    cwd,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: spec.timeout_ms,
  });
  const duration = Date.now() - started;
  // A project command may change any tree content the revision digests cover; the
  // in-process memoization (MARS-277) must not serve pre-command digests after it.
  invalidateRevisionCache();
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
    // TAP is a stdout report; separate stderr warnings are not part of its footer.
    const stats = parseTestStats(/^TAP version /m.test(stdout) ? stdout : `${stdout}\n${stderr}`);
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

let publicationContext: {ref: WorkflowRef; instance: string; binding: SessionBinding} | undefined;
function publishAuthorized<T>(publish: () => T): T {
  if (!publicationContext) fail("evidence publication requires session context");
  return withSessionPublication(PROJECT_ROOT, publicationContext.ref, publicationContext.instance, publish, publicationContext.binding);
}
function writeAtomic(path: string, value: string): void {
  publishAuthorized(() => writeAtomicLocked(path, value));
}
function writeAtomicLocked(path: string, value: string): void {
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

export function semanticCommandArgv(sensor: string, state: { current_module?: string; current_unit?: string }): string[] {
  const tsx = require.resolve("tsx/cli");
  const checker = resolve(TOOL_DIR, "aidlc-semantic-checks.ts");
  // Split layout: pass the module scope explicitly so module-owned checkers (diagram-contract)
  // only inspect the module's own artifacts.
  const scopeArgs = isSplitLayout(PROJECT_ROOT) && state.current_module
    ? ["--module", state.current_module, ...(state.current_unit ? ["--unit", state.current_unit] : [])]
    : [];
  return [process.execPath, tsx, checker, "--sensor", sensor, ...scopeArgs];
}

function runSemanticCommand(sensor: string, timeoutMs: number, state: ProducerState, behaviour: { blockedReports?: boolean } = {}): { payload: Record<string, unknown>; execution: Record<string, unknown> } {
  const argv = semanticCommandArgv(sensor, state);
  const started = Date.now();
  const result = runSync(argv[0], argv.slice(1), {
    cwd: PROJECT_ROOT,
    env: semanticCheckerEnv(state),
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
  });
  const duration = Date.now() - started;
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : result.stdout ? String(result.stdout).trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr ? String(result.stderr) : "";
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error || exitCode !== 0) {
    const detail = result.error ? result.error.message : `exit code ${exitCode}`;
    // A checker that fails closed may print a structured blocked report ({status:"blocked", ...}) on
    // stdout. Persist it outside .aidlc/evidence (it is diagnostics, never gate-accepted evidence).
    // MARS-271 lint mode writes nothing anywhere, not even diagnostics.
    const report = behaviour.blockedReports === false ? null : blockedReport(stdout);
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
      command_version: 2,
      exit_code: exitCode,
      status: "passed",
      duration_ms: duration,
      ...(QUALITY_SENSORS.has(sensor) ? { argv, stdout_digest: createHash("sha256").update(stdout).digest("hex"), stderr_digest: createHash("sha256").update(stderr).digest("hex") } : {}),
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

/** Re-derive a no-behavior claim from the real I13 sources, never from a C8 flag. */
export function noBehaviorBasis(state: ProducerState): Record<string, unknown> | null {
  if (!state.current_module) {
    const modules = verifiedModuleIds(PROJECT_ROOT, state.scope);
    const bases = modules.map(moduleId => noBehaviorBasis({ ...state, current_module: moduleId, current_unit: undefined }));
    return bases.length && bases.every(Boolean) ? { kind: "project_no_behavior", modules: bases } : null;
  }
  if (!existsSync(resolve(PROJECT_ROOT, evidenceRelativePath("test-case-derivation", "test-case-derivation", "module", { module_id: state.current_module })))) return null;
  const i13 = phaseRecord(state);
  const scope = i13.status === "required" ? unitUcdIds(i13, state.current_unit) : null;
  if (i13.status !== "not_applicable" && !(scope?.scoped && scope.all.length === 0)) return null;
  assertControlledI13(PROJECT_ROOT, i13, state.current_module);
  const current = runSemanticCommand("test-case-derivation", DEFAULT_TIMEOUT_MS, { ...state, current_stage: "test-case-derivation", current_unit: undefined }).payload;
  const keys = i13.status === "not_applicable"
    ? ["status", "applicability_inputs_digest", "reason_code", "reason", "approval_ref", "alternative_validation", "validation_command", "source_refs", "source_files"]
    : ["status", "ucd_ids", "ucd_units", ...(i13.ucd_sources !== undefined ? ["ucd_sources"] : [])];
  for (const key of keys) {
    if (key === "ucd_sources") {
      // MARS-273: dual-form ucd_sources (legacy per-UC-D map vs file-level files list)
      // compares through its normalized file-level shape; identical sources compare equal.
      if (JSON.stringify(normalizeUcdSources(i13[key])) !== JSON.stringify(normalizeUcdSources(current[key]))) {
        fail(`I13 applicability no longer matches its sources: ${key}`);
      }
      continue;
    }
    if (JSON.stringify(i13[key]) !== JSON.stringify(current[key])) fail(`I13 applicability no longer matches its sources: ${key}`);
  }
  const exemption = scope?.scoped ? unitUcdExemption(PROJECT_ROOT, state.current_module, state.current_unit!) : undefined;
  if (scope?.scoped && !exemption) fail("empty UC-D subset requires an approved unit ucd_exemption");
  return { kind: exemption ? "unit_exemption" : "i13_not_applicable", module_id: state.current_module, unit_id: state.current_unit ?? null,
    i13_digest: argvDigest([JSON.stringify(i13)]), declaration: exemption ?? Object.fromEntries(keys.map(key => [key, current[key]])) };
}

/** Opt-in, source-backed role policy. Absence retains the legacy requirements.
 * A package declaration is an approved project policy, not inferred from I13 or
 * from missing commands. Each module must independently qualify for an exemption.
 */
function c8RoleBasis(config: EvidenceConfig, state: ProducerState): Record<string, unknown> | undefined {
  if (!config.role_applicability) return undefined;
  const moduleIds = state.current_module ? [state.current_module] : verifiedModuleIds(PROJECT_ROOT, state.scope);
  const known = verifiedModuleIds(PROJECT_ROOT, state.scope);
  for (const entry of config.role_applicability) if (!known.includes(entry.module_id)) fail(`unknown role applicability module: ${entry.module_id}`);
  const modules = moduleIds.map(moduleId => {
    const entry = config.role_applicability!.find(item => item.module_id === moduleId);
    if (!entry) return { module_id: moduleId, required: ["build", "check"] };
    const path = requireRegularFile(entry.package_json, "role applicability package_json");
    if (!path.endsWith(`${sep}package.json`)) fail("native-node role applicability requires package.json");
    const bytes = readFileSync(path, "utf8");
    const pkg = JSON.parse(bytes);
    const policy = pkg.aidlc_validation;
    if (!policy || policy.module_id !== moduleId || policy.runtime !== "native-node" || typeof policy.approval_ref !== "string" || !policy.approval_ref.trim()) fail(`module ${moduleId} needs an explicit approved native-node aidlc_validation policy`);
    const checkTooling = entry.roles.includes("build") ? nativeNodeCheckTooling(path, pkg, config.commands, PROJECT_ROOT, requireRegularFile) : undefined;
    for (const role of entry.roles) {
      const claim = policy[role];
      if (!claim || claim.status !== "not_applicable" || typeof claim.reason !== "string" || !claim.reason.trim()) fail(`module ${moduleId} needs a sourced ${role} not_applicable reason`);
      const scripts = pkg.scripts ?? {};
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
      // The explicit approval supplies intent; contradictory tools/scripts block it.
      const tool = role === "build" ? new RegExp(`(?:^|[/@-])(?:${checkTooling === undefined ? "typescript|" : ""}ts-node|tsx|esbuild|webpack|rollup|vite|parcel|babel|swc|gulp|grunt|node-gyp)(?:$|[/@-])`, "i") : /(?:eslint|biome|standard|jshint|typescript)/i;
      const script = role === "build" ? /build|compile|bundle|transpile|prepare|prepublish|generate/i : /check|lint|typecheck/i;
      if (Object.keys(scripts).some(key => script.test(key)) || Object.values(scripts).some(value => tool.test(String(value))) || Object.keys(dependencies).some(key => tool.test(key))) fail(`module ${moduleId} ${role} exemption contradicts configured tooling; use its real commands`);
    }
    return { module_id: moduleId, required: ["build", "check"].filter(role => !entry.roles.includes(role as "build" | "check")), package_json: relative(PROJECT_ROOT, path), sha256: createHash("sha256").update(bytes).digest("hex"), policy, ...(checkTooling === undefined ? {} : { check_tooling: checkTooling }) };
  });
  return { kind: "native-node-role-policy-v1", config_digest: argvDigest([JSON.stringify(config)]), modules };
}

function c8RoleErrors(commands: { id: unknown; role: unknown }[], config: EvidenceConfig, roleBasis: Record<string, unknown> | undefined, noBehavior: boolean): string[] {
  const roles = new Set(commands.map(command => command.role));
  if (noBehavior) return roles.has("check") ? [] : ["no-behavior validation requires a controlled check"];
  const modules = roleBasis?.modules as { required: string[] }[] | undefined;
  const required = ["test", ...(modules ? ["build", "check"].filter(role => modules.some(module => module.required.includes(role))) : ["build", "check"])];
  const errors = required.filter(role => !roles.has(role)).map(role => `selected allowlist commands must include required ${role} role`);
  // With a role policy, this config is the minimum matrix for all participating
  // modules. A selected subset cannot hide a required build, check or test.
  if (roleBasis) for (const spec of config.commands.filter(spec => ["build", "test", "check"].includes(spec.role))) {
    if (!commands.some(command => command.id === spec.id && command.role === spec.role)) errors.push(`required configured command ${spec.id} was not executed`);
  }
  return errors;
}

/** Build/test verification shared by producer, scheduler and completion gate. */
function securityValidationBasis(config: EvidenceConfig, state: ProducerState): Record<string, unknown> | undefined {
  const profiles = [state.execution_profile, ...[...loadWorkflowParts(PROJECT_ROOT).parts.values()].map(part => part.state.execution_profile)];
  if (!profiles.some(profile => profile?.active_risks.includes("security_or_sensitive_data"))) return undefined;
  const records = config.risk_validation;
  if (!Array.isArray(records)) fail("security risk is unverified: C8 risk_validation must bind acceptance sources and real test/check command_ids");
  const matches = records.filter(record => record?.risk === "security_or_sensitive_data");
  if (matches.length !== 1) fail("security risk requires exactly one risk_validation declaration");
  const record = matches[0];
  if (!Array.isArray(record.sources) || !record.sources.length || !record.sources.every((path: unknown) => typeof path === "string" && path.trim())
    || !Array.isArray(record.command_ids) || !record.command_ids.length || new Set(record.command_ids).size !== record.command_ids.length
    || !record.command_ids.every((id: unknown) => config.commands.some(command => command.id === id && ["test", "check"].includes(command.role)))) fail("security risk_validation requires non-empty local sources and unique allowlisted test/check command_ids");
  return { risk: record.risk, sources: record.sources.map((path: string) => ({ path, sha256: createHash("sha256").update(readFileSync(requireRegularFile(safeProjectPath(path, "security acceptance source"), "security acceptance source"))).digest("hex") })), command_ids: record.command_ids };
}

export function buildTestEvidenceErrors(evidence: Record<string, unknown>, state: ProducerState): string[] {
  const errors: string[] = [];
  if (evidence.status !== "passed") errors.push("build/test status must be passed");
  const commands = Array.isArray(evidence.commands) ? evidence.commands as Record<string, unknown>[] : [];
  const tests = evidence.tests as TestStats | undefined;
  const zeroTests = tests?.total === 0 && tests.passed === 0 && tests.failed === 0 && tests.skipped === 0;
  try {
    const config = requireCommandConfig(resolveCommandConfigPath(PROJECT_ROOT, "build-and-test"), "build-and-test");
    const security = securityValidationBasis(config, state);
    if (JSON.stringify(evidence.risk_validation) !== JSON.stringify(security)) errors.push("security acceptance sources or validation policy changed; rerun actual security verification");
    if (security && (security.command_ids as string[]).some(id => !commands.some(command => command.id === id && command.status === "passed" && command.exit_code === 0))) errors.push("security validation commands were not successfully executed");
    const roleBasis = c8RoleBasis(config, state);
    if (JSON.stringify(evidence.role_applicability) !== JSON.stringify(roleBasis)) errors.push("C8 role applicability no longer matches project policy/configuration sources");
    const roles = new Set(commands.map(command => command.role));
    let basis: Record<string, unknown> | null = null;
    if (evidence.applicability !== undefined || zeroTests || !roles.has("test") || !roles.has("build")) basis = noBehaviorBasis(state);
    if (basis) {
      if (JSON.stringify(evidence.applicability) !== JSON.stringify(basis)) errors.push("build/test applicability no longer matches trusted I13/unit sources");
    } else {
      if (evidence.applicability !== undefined) errors.push("applicability claim has no trusted no-behavior basis");
    }
    errors.push(...c8RoleErrors(commands.map(command => ({ id: command.id, role: command.role })), config, roleBasis, !!basis));
    if (!commands.length || new Set(commands.map(command => command.id)).size !== commands.length) errors.push("commands must be non-empty and unique");
    for (const command of commands) {
      const spec = config.commands.find(spec => spec.id === command.id && spec.role === command.role);
      if (!spec || command.argv_digest !== argvDigest(spec.argv) || command.cwd !== safeCwdLabel(spec.cwd || PROJECT_ROOT)) errors.push(`command ${command.id} no longer matches its allowlist`);
      if (command.status !== "passed" || command.exit_code !== 0 || typeof command.duration_ms !== "number" || command.duration_ms < 0) errors.push(`command ${command.id} must have a successful execution`);
      if (basis && command.role === "check") errors.push(...alternativeCheckBindingErrors(command, "build-and-test", state));
    }
    if (!tests || !Object.values(tests).every(value => Number.isSafeInteger(value) && value >= 0) || tests.total !== tests.passed + tests.failed + tests.skipped
      || tests.failed !== 0 || ((!basis || roles.has("test")) && (tests.total < 1 || tests.passed < 1)) || (!roles.has("test") && !zeroTests)) errors.push("test summary must count real successful tests, or exactly zero for approved no-behavior validation");
    const observed = commands.filter(command => command.role === "test").map(command => command.test_stats as TestStats | undefined);
    if (observed.some(stats => !validTestStats(stats) || stats.failed !== 0 || stats.passed < 1) || tests && (["total", "passed", "failed", "skipped"] as const).some(key => observed.reduce((sum, stats) => sum + (stats?.[key] ?? NaN), 0) !== tests[key])) errors.push("tests summary must equal executed successful test command counts");
    const checks = evidence.checks as Record<string, unknown> | undefined;
    if (checks?.status !== "passed" || JSON.stringify(checks.command_ids) !== JSON.stringify(commands.filter(command => command.role === "check").map(command => command.id))) errors.push("checks must identify successful check commands");
  } catch (error) { errors.push(String(error)); }
  return errors;
}

function alternativeBinding(spec: CommandSpec, state: ProducerState, basis: Record<string, unknown>, freshness?: Record<string, unknown>) {
  const instance = stageInstanceId("code-generation", state.current_unit ? "unit" : state.current_module ? "module" : "project", { module_id: state.current_module, unit_id: state.current_unit });
  const declaredScope = state.current_module && existsSync(join(PROJECT_ROOT, "docs/aidlc/ideation/module-manifest.json"))
    ? evidenceScopeForInstance(PROJECT_ROOT, instance) : undefined;
  const revision = readSourceRevision(PROJECT_ROOT, declaredScope, nestedSourceRepos(PROJECT_ROOT));
  const inputs = declaredScope
    ? { mode: "declared-ownership", scope: revision.scope, digest: revision.scope_digest }
    : { mode: "conservative-worktree", revision };
  // PATH and platform/runtime discovery always affect execution. An absent declaration
  // binds the complete environment; an explicit list is the command owner's dependency contract.
  const environmentKeys = spec.evidence_inputs
    ? [...new Set([...spec.evidence_inputs.environment, "PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "NODE_OPTIONS", "NODE_PATH"])]
    : Object.keys(process.env).filter(key => key !== "AIDLC_SESSION_BINDING");
  const environment = { mode: spec.evidence_inputs ? "declared" : "conservative-all", keys: environmentKeys.sort().map(key => [key, process.env[key] ?? null]) };
  const baseline = workflowBaselineForModule(PROJECT_ROOT, state.current_module);
  const binding = { workflow_id: state.workflow_id, module_id: state.current_module, unit_id: state.current_unit, basis, inputs, baseline, freshness,
    argv_digest: argvDigest(spec.argv), cwd: safeCwdLabel(spec.cwd || PROJECT_ROOT), runtime: { executable: process.execPath, version: process.version },
    environment: { mode: environment.mode, keys: environmentKeys, digest: argvDigest([JSON.stringify(environment)]) } };
  return { binding, revision, declaredScope };
}

/** Resolve successful observation provenance; a matching input hash alone is insufficient. */
function alternativeObservationErrors(execution: Record<string, unknown>, binding: Record<string, unknown>, freshness?: Record<string, unknown>): string[] {
  const key = argvDigest([JSON.stringify(binding)]);
  if (execution.input_binding !== key) return ["alternative observation inputs/environment/declaration changed; rerun check"];
  try {
    const path = requireRegularFile(join(PROJECT_ROOT, ".aidlc", "alternative-observations", `${key}.json`), "alternative observation");
    const saved = JSON.parse(readFileSync(path, "utf8"));
    const observation = execution.reused_from ?? execution.observation_id;
    if (typeof observation !== "string" || saved.observation_id !== observation || saved.producer !== "loeyae-aidlc-evidence"
      || JSON.stringify(saved.binding) !== JSON.stringify(binding) || evidenceTimeError({ ...saved, ...(freshness ? { freshness } : {}) }, "build-test-evidence")
      || saved.result?.status !== "passed" || saved.result?.exit_code !== 0
      || ["argv_digest", "cwd", "exit_code", "status", "duration_ms"].some(field => execution[field] !== saved.result[field])) return ["alternative observation has no matching successful provenance"];
    return [];
  } catch (error) { return [`alternative observation provenance cannot be verified: ${String(error)}`]; }
}

/** Current-input verification used by phase/C8 gates, including declared environment/config. */
export function alternativeCheckBindingErrors(execution: Record<string, unknown>, stage: string, state: ProducerState): string[] {
  try {
    const config = requireCommandConfig(resolveCommandConfigPath(PROJECT_ROOT, stage), stage);
    const spec = config.commands.find(command => command.id === execution.id && command.role === "check");
    if (!spec) return ["alternative check command is no longer declared"];
    // Legacy observations retain their existing conservative provenance gate.
    if (execution.input_binding === undefined && !spec.evidence_inputs && !execution.reused_from) return [];
    const basis = noBehaviorBasis(state);
    if (!basis) return ["alternative observation no longer has a trusted applicability basis"];
    const { binding } = alternativeBinding(spec, state, basis, config.freshness);
    return alternativeObservationErrors(execution.input_binding === undefined ? { ...execution, input_binding: argvDigest([JSON.stringify(binding)]) } : execution, binding, config.freshness);
  } catch (error) { return [String(error)]; }
}

/** Empty-subset observations are owned by the unit manifest, rather than a stage allowlist. */
export function exemptionCheckBindingErrors(execution: Record<string, unknown>, state: ProducerState): string[] {
  try {
    if (execution.input_binding === undefined && !execution.reused_from) return [];
    const exemption = unitUcdExemption(PROJECT_ROOT, state.current_module!, state.current_unit!);
    const basis = noBehaviorBasis(state);
    if (!exemption || !basis) return ["exemption observation no longer has a trusted applicability basis"];
    const config = optionalSemanticConfig(resolveCommandConfigPath(PROJECT_ROOT, state.current_stage!), state.current_stage!);
    const { binding } = alternativeBinding({ id: `ucd-exemption:${state.current_unit}`, role: "check", argv: exemption.validation_command }, state, basis, config?.freshness);
    return alternativeObservationErrors(execution.input_binding === undefined ? { ...execution, input_binding: argvDigest([JSON.stringify(binding)]) } : execution, binding, config?.freshness);
  } catch (error) { return [String(error)]; }
}

/** Cache successful alternative checks using validated ownership; unknown inputs stay bound. */
function alternativeCheck(spec: CommandSpec, state: ProducerState, freshness?: Record<string, unknown>): CommandResult & { observation_id?: string; reused_from?: string } {
  let basis: Record<string, unknown> | null;
  try { basis = noBehaviorBasis(state); } catch { basis = null; }
  // Legacy declarations still run; they do not acquire reuse authority.
  if (!basis) return runCommand(spec);
  const { binding, revision, declaredScope } = alternativeBinding(spec, state, basis, freshness);
  if (!revision.worktree_digest || declaredScope && !revision.scope_digest) return runCommand(spec);
  const key = argvDigest([JSON.stringify(binding)]);
  const path = safeProjectPath(resolve(PROJECT_ROOT, ".aidlc", "alternative-observations", `${key}.json`), "alternative observation");
  if (existsSync(path)) {
    try {
      const saved = JSON.parse(readFileSync(requireRegularFile(path, "alternative observation"), "utf8"));
      if (JSON.stringify(saved.binding) === JSON.stringify(binding) && saved.producer === "loeyae-aidlc-evidence" && !evidenceTimeError({ ...saved, ...(freshness ? { freshness } : {}) }, "build-test-evidence")
        && typeof saved.observation_id === "string" && saved.result.status === "passed" && saved.result.exit_code === 0 && saved.result.argv_digest === binding.argv_digest
        && typeof saved.result.duration_ms === "number") return { ...saved.result, id: spec.id, input_binding: key, reused_from: saved.observation_id };
    } catch { /* Invalid cache is re-executed, never accepted. */ }
  }
  const result = runCommand(spec);
  // Commands that mutate their inputs cannot seed a reusable observation.
  const after = readSourceRevision(PROJECT_ROOT, declaredScope, nestedSourceRepos(PROJECT_ROOT));
  const observation_id = randomUUID();
  if (JSON.stringify(after) === JSON.stringify(revision)) writeAtomic(path, JSON.stringify({ binding, result, observation_id, producer: "loeyae-aidlc-evidence", timestamp: new Date().toISOString() }));
  return { ...result, input_binding: key, observation_id };
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
  // 4.10.0: I13 and BASELINE must be produced against the same kind of baseline (adoption or workflow).
  const kindErrors = baselineKindErrors(i13.baseline_kind, baseline, "I13");
  if (kindErrors.length > 0) fail(`BASELINE refuses to run: ${kindErrors.join("; ")}`);
  const commit = baseline.commit;
  // 4.9.0: code refs of a nested repository resolve in that repository at its commit of the current epoch.
  let nested: string[] = [];
  try {
    nested = nestedSourceRepos(PROJECT_ROOT);
  } catch (error) {
    fail(`BASELINE refuses to run: ${error instanceof Error ? error.message : String(error)}`);
  }
  const extra = extraRepoKeyErrors(baseline, nested);
  if (extra.length > 0) fail(`BASELINE refuses to run: ${extra.join("; ")}`);
  const currentEpoch = baseline.epochs.length - 1;
  const repos = epochRepos(baseline, currentEpoch);
  const registered = Object.keys(baseline.repos).length > 0;
  const entries = i13CodeRefBlobs(i13, ucdIds);
  const pending = [...new Set(entries.map(({ path }) => codeRefRepo(PROJECT_ROOT, path, nested).repoKey).filter((key) => key !== WORKFLOW_REPO_KEY && !(key in repos)))].sort();
  if (pending.length > 0) fail(`BASELINE refuses to run: ${pendingNestedError(PROJECT_ROOT, commit, pending)}`);
  const digests = entries.map(({ path }) => {
    const repo = codeRefRepo(PROJECT_ROOT, path, nested);
    const repoCommit = repo.repoKey === WORKFLOW_REPO_KEY ? commit : repos[repo.repoKey];
    const resolved = baselineCodeRef(PROJECT_ROOT, repoCommit, { path }, `code ref ${path}`, repo);
    if ("error" in resolved) fail(`BASELINE refuses to run: ${resolved.error}`);
    const baseline_blob = resolved.blob;
    requireRegularFile(path, `code ref ${path}`);
    const result = runSync("git", ["hash-object", "--", repo.relativePath], { cwd: repo.repoKey === WORKFLOW_REPO_KEY ? PROJECT_ROOT : repo.repoRoot, encoding: "utf8", shell: false });
    const worktree = typeof result.stdout === "string" ? result.stdout.trim() : "";
    if (result.error || result.status !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(worktree)) {
      fail(`cannot hash code ref ${path} with git hash-object: ${result.error ? result.error.message : (result.stderr || "").trim() || `exit ${result.status}`}`);
    }
    if (worktree !== baseline_blob) {
      const where = repo.repoKey === WORKFLOW_REPO_KEY ? `the workflow baseline ${commit}` : `the baseline ${repoCommit} of the nested repository ${repo.repoKey}/`;
      fail(`BASELINE refuses to run: code ref ${path} changed since ${where} (worktree blob ${worktree}, baseline blob ${baseline_blob}); characterization tests must observe the unmodified baseline code`);
    }
    return registered ? { path, repo: repo.repoKey, baseline_blob, worktree_blob: worktree } : { path, baseline_blob, worktree_blob: worktree };
  });
  const kind = baseline.kind === "adoption" ? { baseline_kind: "adoption" } : {};
  return registered ? { baseline_commit: commit, baseline_repos: repos, code_ref_digests: digests, ...kind } : { baseline_commit: commit, code_ref_digests: digests, ...kind };
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

/** MARS-271: ids of the I13 `mapping_deferred` entries. */
function i13MappingDeferredIds(i13: Record<string, unknown>): string[] {
  return (Array.isArray(i13.mapping_deferred) ? i13.mapping_deferred : [])
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** MARS-271: GREEN mapping_debt payload — the deferred UC-Ds of the unit (scoped) or module. */
function mappingDebtFor(i13: Record<string, unknown>, scope: ReturnType<typeof unitUcdIds> | null): Record<string, unknown> {
  const entries = (Array.isArray(i13.mapping_deferred) ? i13.mapping_deferred : []).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as { id?: unknown; reason?: unknown };
    return typeof candidate.id === "string" && typeof candidate.reason === "string" ? [{ id: candidate.id, reason: candidate.reason }] : [];
  }).filter((entry) => !scope?.scoped || scope.all.includes(entry.id));
  return entries.length > 0 ? { mapping_debt: entries } : {};
}

function runPhaseProducer(options: ProducerOptions, state: ProducerState, phase: Phase): void {
  if (options.historicalReplay) {
    if (phase !== "RED" || options.testFilter || options.explicitConfig || !state.current_module || !state.current_unit) fail("historical_replay requires exact RED module/unit, no --config or test filter");
    const i13 = phaseRecord(state);
    const currentHead = runSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8", shell: false });
    if (currentHead.status !== 0) fail("historical_replay requires the workflow's current Git commit");
    // I13's provenance needs ancestry here; historical/source and current requirements
    // get separate byte summaries below, without hashing unrelated workflow media twice.
    assertControlledI13(PROJECT_ROOT, i13, state.current_module, String(currentHead.stdout).trim());
    if (i13.status !== "required") fail("historical_replay requires executable current I13");
    const scope = unitUcdIds(i13, state.current_unit);
    if (!scope.scoped || !scope.new.length || i13MappingDeferredIds(i13).some(id => scope.all.includes(id))) fail("historical_replay requires complete, explicit current unit UC-D mapping without mapping debt");
    const output = options.output || evidenceOutput(options.stage, PHASE_SENSORS.RED, undefined, state);
    const identity = { workflow_id: state.workflow_id, module_id: state.current_module, unit_id: state.current_unit };
    const prior = historicalReplayPrior(PROJECT_ROOT, identity, output);
    const payload = runHistoricalReplay(PROJECT_ROOT, identity, i13, scope.new, output, prior);
    if (JSON.stringify(phaseRecord(state)) !== JSON.stringify(i13)) fail("historical_replay: I13 changed during execution");
    payload.historical_replay.publication_claim = publicationContext?.binding;
    invalidateRevisionCache();
    const record = { ...payload, ...executionContext(state), evidence_version: "1", timestamp: new Date().toISOString(), producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() }, source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance), checker: { id: "builtin:red-test-evidence", sensor: PHASE_SENSORS.RED, argv_digest: phaseObservationDigest("RED", payload.observed_command.argv_digest), exit_code: 0, status: "passed" } };
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > 512 * 1024) fail("historical_replay canonical evidence exceeds the unchanged 512 KiB gate limit");
    publishAuthorized(() => {
      if (prior) {
        const bytes = readFileSync(output);
        if (createHash("sha256").update(bytes).digest("hex") !== prior.sha256) fail("historical_replay: prior evidence changed during execution");
        if (existsSync(prior.path)) {
          if (createHash("sha256").update(readFileSync(prior.path)).digest("hex") !== prior.sha256) fail("historical_replay: archive conflicts with prior evidence");
        } else writeAtomicLocked(prior.path, bytes.toString("utf8"));
      } else if (existsSync(output)) fail("historical_replay: original evidence is no longer missing");
      const errors = replayEvidenceErrors(PROJECT_ROOT, record, { workflow_id: state.workflow_id, module_id: state.current_module!, unit_id: state.current_unit! }, phaseRecord(state), scope.new);
      if (errors.length) fail(errors.join("; "));
      writeAtomicLocked(output, serialized);
    });
    console.log(JSON.stringify({ status: "passed", evidence_mode: "historical_replay", output, limitation: payload.historical_replay.limitation }, null, 2));
    return;
  }
  assertPhaseConfigBinding(options, phase === "BASELINE" ? "BASELINE" : "RED/GREEN");
  // MARS-271: 受影响方法过滤只服务 RED 收敛迭代;GREEN/BASELINE 最终证据强制全量。
  if (options.testFilter && phase !== "RED") fail("--test-filter is only supported for RED evidence; GREEN and BASELINE must run the full test suite");
  const sensor = PHASE_SENSORS[phase];
  const i13 = phaseRecord(state);
  const output = options.output || evidenceOutput(options.stage, sensor, undefined, state);
  const freshness = optionalSemanticConfig(options.config, options.stage)?.freshness;
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
  // MARS-271 分级映射准入:mapping_deferred UC-D 暂无测试映射,不进入观测 universe。
  const deferredIds = i13.status === "required" ? i13MappingDeferredIds(i13) : [];
  const rawScope = i13.status === "required" ? unitUcdIds(i13, state.current_unit) : null;
  const scope = rawScope && deferredIds.length > 0
    ? {
      ...rawScope,
      all: rawScope.all.filter((id) => !deferredIds.includes(id)),
      new: rawScope.new.filter((id) => !deferredIds.includes(id)),
      characterization: rawScope.characterization.filter((id) => !deferredIds.includes(id)),
    }
    : rawScope;
  const unitLabel = `unit ${state.current_unit}`;
  if (i13.status === "not_applicable" && phase === "BASELINE") {
    notRequired("I13 declared no executable business behavior, so no UC-D uses tdd_mode characterization");
  } else if (i13.status === "not_applicable") {
    const config = requireCommandConfig(options.config, options.stage);
    const reason = typeof i13.reason === "string" ? i13.reason : typeof i13.not_applicable_reason === "string" ? i13.not_applicable_reason : "I13 declared no executable business behavior";
    const alternative = typeof i13.alternative_validation === "string" ? i13.alternative_validation : "controlled alternative validation";
    const checks = config.commands.filter((command) => command.role === "check");
    if (checks.length !== 1) fail(`I13 not_applicable requires exactly one controlled check command for ${options.stage}`);
    const check = alternativeCheck(checks[0], state, freshness);
    const alternativeValidationExecution = {
      id: check.id,
      argv_digest: check.argv_digest,
      cwd: check.cwd,
      exit_code: check.exit_code,
      status: check.status,
      duration_ms: check.duration_ms,
      ...(check.reused_from ? { reused_from: check.reused_from } : {}),
      ...(check.observation_id ? { observation_id: check.observation_id } : {}),
      ...(check.input_binding ? { input_binding: check.input_binding } : {}),
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
    const check = alternativeCheck({ id: `ucd-exemption:${unitId}`, role: "check", argv: validateArgv(exemption.validation_command, `${unitLabel} ucd_exemption.validation_command`) }, state, freshness);
    payload = {
      status: "not_required",
      phase,
      ucd_ids: [],
      not_required_reason: `${unitLabel} owns no UC-D of module ${moduleId}; ucd_exemption ${exemption.reason_code}: ${exemption.reason}`,
      ucd_exemption: { reason_code: exemption.reason_code, reason: exemption.reason, approval_ref: exemption.approval_ref, alternative_validation: exemption.alternative_validation },
      exemption_validation_execution: { id: check.id, argv_digest: check.argv_digest, cwd: check.cwd, exit_code: check.exit_code, status: check.status, duration_ms: check.duration_ms, ...(check.reused_from ? { reused_from: check.reused_from } : {}), ...(check.observation_id ? { observation_id: check.observation_id } : {}), ...(check.input_binding ? { input_binding: check.input_binding } : {}) },
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
    const result = runSync(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd || PROJECT_ROOT,
      env: semanticCheckerEnv(state, process.env, { AIDLC_PHASE: phase, ...(options.testFilter ? { AIDLC_TEST_FILTER: options.testFilter } : {}) }),
      encoding: "utf8",
      shell: false,
      timeout: command.timeout_ms,
    });
    const duration = Date.now() - started;
    // A phase command runs real project tests; tree content it may produce must not
    // be served from memoized pre-command digests (MARS-277).
    invalidateRevisionCache();
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
      // MARS-271: 收敛迭代允许受影响方法过滤;该字段让门禁与报告可分辨过滤运行与全量运行。
      ...(options.testFilter ? { test_filter: options.testFilter } : {}),
      // MARS-271 分级映射准入:GREEN 证据携带 mapping_debt——本单元/模块 mapping_deferred
      // 的 UC-D 清单;门禁据此要求映射债显式申报,不随时间静默消失。
      ...(phase === "GREEN" ? mappingDebtFor(i13, rawScope) : {}),
      observed_command: { id: command.id, phase, argv_digest: commandDigest, cwd: safeCwdLabel(command.cwd || PROJECT_ROOT), exit_code: exitCode, expected_exit_code: expectedExit, duration_ms: duration },
    };
    execution = { id: `builtin:${sensor}`, sensor, argv_digest: phaseObservationDigest(phase, commandDigest), exit_code: 0, status: "passed", duration_ms: duration };
  }
  writeAtomic(output, `${JSON.stringify({ ...payload!, ...(freshness ? { freshness } : {}), ...executionContext(state), evidence_version: "1", timestamp: new Date().toISOString(), producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() }, source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance), checker: execution! }, null, 2)}\n`);
  if (!options.output) console.log(JSON.stringify({ status: "passed", output, sensor, phase }, null, 2));
}

function runSemanticProducer(options: ProducerOptions, config: EvidenceConfig | null, state: ProducerState, quiet = false): { action: "reused" | "regenerated"; inputs_digest?: string; inputs_changed?: string[] } | undefined {
  const sensor = options.sensor;
  if (!sensor || sensor === "build-test-evidence") fail("semantic producer requires --sensor with a semantic sensor name");
  if (options.commandIds.length > 0) fail("--command-id is only supported for build/test evidence");
  if (sensor === "red-test-evidence" || sensor === "green-test-evidence" || sensor === "baseline-test-evidence") {
    runPhaseProducer(options, state, sensor === "red-test-evidence" ? "RED" : sensor === "green-test-evidence" ? "GREEN" : "BASELINE");
    return;
  }
  const output = options.output || evidenceOutput(options.stage, sensor, undefined, state);
  const started = Date.now();
  const progress = (phase: string): void => {
    markProgress(phase.startsWith("waiting") ? 2 : phase.startsWith("validating") ? 3 : phase.startsWith("publishing") ? 4 : 1);
    if (options.refresh && process.env.AIDLC_PROGRESS !== "0") process.stderr.write(`[aidlc] evidence ${sensor}: ${phase}; elapsed=${((Date.now() - started) / 1000).toFixed(1)}s; last_progress=${new Date().toISOString()}\n`);
  };
  progress("checking inputs and prior evidence");
  // MARS-271 选择性失效:刷新已完成实例时,输入指纹未变的受控证据直接复用,
  // 只有 diff 触及的 artifact 的直接依赖证据才重跑。
  const inputs = stageInputs(options.stage, state);
  const prior = priorEvidenceRecord(output);
  if (options.refresh && inputs && prior && !["global-review-evidence", "deployment-validation"].includes(sensor) && reusableSemanticEvidence(prior, inputs, state, sensor)
    && (sensor !== SLICE_SENSOR || (!sliceEvidenceErrors(producerSliceContext(state), prior).length && !sliceCandidateError(state, prior)))) {
    const summary = { action: "reused" as const, inputs_digest: inputs.digest };
    if (!quiet) console.log(JSON.stringify({ status: "passed", output, sensor, checker: `builtin:${sensor}`, ...summary }, null, 2));
    return summary;
  }
  const declarations = (config?.commands || []).filter((command) => command.role === "semantic" && command.sensor === sensor);
  if (declarations.length > 1) fail(`allowlist must declare at most one built-in semantic checker for ${sensor}`);
  progress("waiting for semantic checker subprocess");
  const result = runSemanticCommand(sensor, declarations[0]?.timeout_ms || DEFAULT_TIMEOUT_MS, state);
  const executionId = randomUUID();
  if (sensor === "quality-change-impact" && result.payload.applicable === true) {
    result.payload.quality_checkpoint_digest = publishAuthorized(() => recordQualityCheckpoint({ root: PROJECT_ROOT, workflow_id: state.workflow_id, project_workflow_id: state.parent_workflow_id || state.workflow_id, module_id: state.current_module, scope: state.scope, stage: options.stage, ui_route: String(result.payload.ui_route), quality_version: state.quality_gates_version }, result.payload.quality_snapshots as QualitySnapshot[], executionId));
  }
  const unsigned = {
    ...result.payload,
    ...(config?.freshness ? { freshness: config.freshness } : {}),
    ...(inputs ? sensor === SLICE_SENSOR || Array.isArray(result.payload.inputs) ? { stage_inputs: inputs } : { inputs } : {}),
    ...executionContext(state),
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", workflow_id: state.workflow_id, execution_id: executionId },
    source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance),
    checker: result.execution,
  };
  const candidate = producedEvidence(unsigned);
  if (sensor === SLICE_SENSOR) {
    progress("validating candidate against stage-entry checks");
    const error = sliceCandidateError(state, candidate);
    if (error) fail(`document slice evidence candidate rejected before publication: ${error}`);
  }
  progress("publishing evidence");
  writeAtomic(output, `${JSON.stringify(candidate, null, 2)}\n`);
  progress("publication complete");
  // 失效范围说明:与上一份证据相比,artifact 集合的增删即为本次重刷的直接起因。
  let inputsChanged: string[] | undefined;
  if (inputs && prior) {
    const priorInputs = semanticStageInputs(prior);
    const priorArtifacts = Array.isArray(priorInputs?.artifacts)
      ? (priorInputs!.artifacts as unknown[]).filter((item): item is string => typeof item === "string")
      : [];
    inputsChanged = [...new Set([...priorArtifacts.filter((item) => !inputs.artifacts.includes(item)), ...inputs.artifacts.filter((item) => !priorArtifacts.includes(item))])];
  }
  const summary = { action: "regenerated" as const, ...(inputs ? { inputs_digest: inputs.digest } : {}), ...(inputsChanged ? { inputs_changed: inputsChanged } : {}) };
  if (!quiet) console.log(JSON.stringify({ status: "passed", output, sensor, checker: `builtin:${sensor}`, ...summary }, null, 2));
  return summary;
}

function sliceCandidateError(state: ProducerState, candidate: Record<string, unknown>): string | undefined {
  const checked = runSync(process.execPath, [require.resolve("tsx/cli"), join(TOOL_DIR, "aidlc-slice-candidate.ts")], {
    cwd: PROJECT_ROOT, encoding: "utf8", input: JSON.stringify({ state, candidate }), shell: false, timeout: DEFAULT_TIMEOUT_MS,
  });
  return checked.error?.message || (checked.status !== 0 ? String(checked.stderr || "validator failed").trim() : undefined);
}

function producerSliceContext(state: ProducerState): SliceContext {
  return { root: PROJECT_ROOT, workflow_id: state.workflow_id, project_workflow_id: state.parent_workflow_id || state.workflow_id,
    module_id: state.current_module, scope: state.scope, stage: state.current_stage, ui_route: "not-selected",
    quality_version: state.quality_gates_version, slices_version: state.document_slices_version,
    units_executed: state.current_stage === "units-generation" || state.completed_stage_instances.includes(`units-generation@module:${state.current_module}`) };
}

function semanticStageInputs(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = record.stage_inputs ?? record.inputs;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

interface ProducerOptions {
  historicalReplay?: boolean;
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
  /** MARS-271: lightweight validation only — no evidence written, no engine state touched. */
  lint: boolean;
  /** MARS-271: AIDLC_TEST_FILTER selector for a RED phase command (convergence iterations). */
  testFilter?: string;
}

const USAGE = "usage: aidlc-evidence.ts run --stage <stage> [--instance <stage-instance> | --module <module-id> [--unit <unit-id>]] [--refresh] [--sensor <sensor>] [--all-sensors] [--config <path>] [--output <path>] [--command-id <id> ...] [--lint] [--test-filter <expr>] [--historical-replay]";

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
  let lint = false;
  let testFilter: string | undefined;
  let historicalReplay = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (["--stage", "--instance", "--module", "--unit", "--sensor", "--config", "--output", "--command-id", "--test-filter"].includes(arg)) {
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
      if (arg === "--test-filter") testFilter = value;
    } else if (arg === "--historical-replay") {
      historicalReplay = true;
    } else if (arg === "--all-sensors") {
      allSensors = true;
    } else if (arg === "--lint") {
      lint = true;
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
  if (historicalReplay && (stage !== "tdd" || sensor !== "red-test-evidence" || !refresh || allSensors || lint || output || testFilter || config)) fail("--historical-replay requires --stage tdd --sensor red-test-evidence --refresh; no output/config/filter override");
  if (instance && moduleId) fail("--instance and --module are mutually exclusive");
  if (unitId && !moduleId) fail("--unit requires --module");
  if (sensor && sensor !== "build-test-evidence" && !SEMANTIC_SENSORS.has(sensor)) fail(`unsupported semantic sensor: ${sensor}`);
  if (allSensors && sensor) fail("--all-sensors cannot be combined with --sensor; it uses the sensors declared by the active stage");
  if (allSensors && output && stage !== "build-and-test") fail("--output cannot be used with --all-sensors because each sensor has its own canonical evidence path");
  if (allSensors && commandIds.length > 0) fail("--command-id cannot be used with --all-sensors");
  if (lint && refresh) fail("--lint cannot be combined with --refresh; lint writes no evidence and never regenerates any");
  if (lint && output) fail("--lint writes no evidence and takes no --output");
  if (lint && commandIds.length > 0) fail("--lint cannot be combined with --command-id");
  if (lint && testFilter !== undefined) fail("--lint runs no commands and takes no --test-filter");
  if (testFilter !== undefined && !testFilter.trim()) fail("--test-filter requires a non-empty selector expression");
  return {
    stage,
    historicalReplay,
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
    lint,
    ...(testFilter !== undefined ? { testFilter } : {}),
  };
}

function withProducerLock<T>(output: string, action: () => T): T {
  const safeOutput = safeProjectPath(output, "output");
  mkdirSync(dirname(safeOutput), { recursive: true, mode: 0o700 });
  safeProjectPath(dirname(safeOutput), "output directory", true);
  const lockPath = `${safeOutput}.producer.lock`;
  let lockFd: number | undefined;
  let result: T;
  try {
    lockFd = openSync(lockPath, "wx", 0o600);
    result = action();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && lockFd === undefined) {
      fail(`another evidence producer is already running for ${safeOutput}`);
    }
    throw error;
  } finally {
    if (lockFd !== undefined) closeSync(lockFd);
    if (lockFd !== undefined && existsSync(lockPath)) unlinkSync(lockPath);
  }
  return result!;
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
  if (moduleMatch) context.current_module = moduleMatch[1];
  else delete context.current_module;
  if (unitMatch) context.current_unit = unitMatch[1];
  else delete context.current_unit;
  return context;
}

function declaredSemanticSensors(stage: string): string[] {
  const node = stageGraphNode(stage);
  const sensors = Array.isArray(node.sensors) ? node.sensors.filter((sensor): sensor is string => typeof sensor === "string") : [];
  return sensors.filter((sensor) => SEMANTIC_SENSORS.has(sensor));
}

function stageGraphNode(stage: string): Record<string, unknown> {
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
  return node;
}

/** MARS-271 选择性失效:单阶段输入指纹的文件数上限,防止退化为全仓扫描。 */
const INPUTS_FINGERPRINT_CAP = 2000;

/**
 * MARS-271 选择性失效:指纹化该阶段 consumes 声明的输入工件。digest 由每个文件的
 * (相对路径, mtime, size) 串接哈希得到——diff 只触及某 artifact 时,只有直接依赖
 * 它的证据的指纹变化,刷新轮次只重跑这些证据,其余复用。
 */
function stageInputs(stage: string, state: ProducerState): { digest: string; artifacts: string[] } | null {
  const node = stageGraphNode(stage);
  const consumes = Array.isArray(node.consumes) ? node.consumes.filter((pattern): pattern is string => typeof pattern === "string") : [];
  const patterns = [...new Set(consumes
    .map((pattern) => pattern
      .replaceAll("{module-id}", state.current_module || "")
      .replaceAll("{unit-id}", state.current_unit || ""))
    .filter((pattern) => pattern && !/\{[a-z][a-z-]*\}/.test(pattern))
    .map((pattern) => pattern.replace(/\/+$/, "")))];
  const artifacts: string[] = [];
  const entries: string[] = [];
  let truncated = false;
  for (const pattern of patterns) {
    const base = resolve(PROJECT_ROOT, pattern);
    if (!existsSync(base)) continue;
    const files: string[] = [];
    if (statSync(base).isFile()) {
      files.push(base);
    } else {
      for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        files.push(resolve(entry.parentPath, entry.name));
        if (files.length >= INPUTS_FINGERPRINT_CAP) { truncated = true; break; }
      }
    }
    for (const file of files) {
      const info = statSync(file);
      artifacts.push(relative(PROJECT_ROOT, file).replace(/\\/g, "/"));
      entries.push(`${relative(PROJECT_ROOT, file).replace(/\\/g, "/")}:${Math.floor(info.mtimeMs)}:${info.size}`);
    }
    if (truncated) break;
  }
  const digest = createHash("sha256").update([...entries.sort(), truncated ? "#truncated" : ""].join("\n")).digest("hex");
  return { digest, artifacts };
}

/** Previously written evidence record of `output`, when it parses. */
function priorEvidenceRecord(output: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(output, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * MARS-271 选择性失效:已受控、checker 通过、输入指纹与执行上下文都不变的证据
 * 可以在 --refresh 时复用,不必重跑。RED/GREEN/BASELINE 相位传感器不走该路径。
 */
function reusableSemanticEvidence(prior: Record<string, unknown>, inputs: { digest: string }, state: ProducerState, sensor: string): boolean {
  const producer = typeof prior.producer === "object" && prior.producer !== null ? prior.producer as Record<string, unknown> : undefined;
  const checker = typeof prior.checker === "object" && prior.checker !== null ? prior.checker as Record<string, unknown> : undefined;
  const priorInputs = semanticStageInputs(prior);
  const priorScope = typeof prior.source_revision === "object" && prior.source_revision !== null ? (prior.source_revision as Record<string, unknown>).scope : undefined;
  const priorScopeDigest = typeof prior.source_revision === "object" && prior.source_revision !== null ? (prior.source_revision as Record<string, unknown>).scope_digest : undefined;
  // MARS-277: a record under a different scope label (e.g. the pre-baseline wide module
  // scope) is never reused as-is, and a scoped record whose digest no longer matches the
  // current tree must regenerate even when the consumes fingerprint cannot see the change
  // (stages with an empty consumes list track no artifacts at all).
  const scope = evidenceScopeForInstance(PROJECT_ROOT, String(state.current_stage_instance));
  const currentRevision = readSourceRevision(PROJECT_ROOT, scope, nestedSourceRepos(PROJECT_ROOT));
  const priorRevision = prior.source_revision as Record<string, unknown> | undefined;
  const scopeStillValid = scope.label === "worktree"
    ? (priorScope === undefined || priorScope === "worktree")
      && priorRevision?.commit === currentRevision.commit
      && priorRevision?.dirty === currentRevision.dirty
      && priorRevision?.worktree_digest === currentRevision.worktree_digest
      && JSON.stringify(priorRevision?.repos || {}) === JSON.stringify(currentRevision.repos || {})
    : priorScope === scope.label && priorScopeDigest === currentRevision.scope_digest;
  return producer?.mode === "controlled"
    && producer.workflow_id === state.workflow_id
    && checker?.argv_digest === argvDigest(semanticCommandArgv(sensor, state))
    && !evidenceTimeError(prior, sensor)
    && checker?.exit_code === 0
    && checker.status === "passed"
    && prior.evidence_version === "1"
    && priorInputs?.digest === inputs.digest
    && scopeStillValid
    && prior.stage_instance === (state.current_stage_instance || null)
    && prior.module_id === (state.current_module || null)
    && prior.unit_id === (state.current_unit || null);
}

function produceAllSemantic(options: ProducerOptions, state: ProducerState, config: EvidenceConfig | null): void {
  const adopted = qualityAdoption({ root: PROJECT_ROOT, workflow_id: state.workflow_id, project_workflow_id: state.parent_workflow_id || state.workflow_id, module_id: state.current_module, scope: state.scope, stage: options.stage, ui_route: "not-selected", quality_version: state.quality_gates_version }).enabled;
  const sensors = declaredSemanticSensors(options.stage).filter(sensor => !QUALITY_SENSORS.has(sensor) || adopted);
  if (sensors.length === 0) fail(`stage ${options.stage} declares no semantic sensors; use the stage's ordinary report gates instead`);
  // Checked up front so no other sensor's evidence is written before a RED/GREEN/BASELINE refusal.
  if (sensors.includes("red-test-evidence") || sensors.includes("green-test-evidence")) assertPhaseConfigBinding(options);
  else if (sensors.includes("baseline-test-evidence")) assertPhaseConfigBinding(options, "BASELINE");
  const outputs: string[] = [];
  const actions: Array<{ sensor: string; action: "reused" | "regenerated"; inputs_digest?: string; inputs_changed?: string[] }> = [];
  for (const sensor of sensors) {
    const output = evidenceOutput(options.stage, sensor, undefined, state);
    const summary = withProducerLock(output, () =>
      runSemanticProducer({ ...options, sensor, output }, config, state, true));
    outputs.push(output);
    actions.push({ sensor, ...(summary || { action: "regenerated" as const }) });
  }
  // MARS-271:汇总每个传感器的动作(reused/regenerated)与失效范围,刷新轮次可见
  // 哪些证据因输入变化被重刷,哪些被复用。
  console.log(JSON.stringify({ status: "passed", stage: options.stage, sensors, outputs, actions }, null, 2));
}

/**
 * MARS-271 门禁前置 lint:在设计输入提交前轻量校验该阶段的语义传感器——契约完整性、
 * 字段对齐、签名与现状接口一致性等。不产生正式证据、不写引擎状态、不要求活动工作流
 * 实例;每个传感器单独运行并捕获失败,报告带结论与错误明细。与正式门禁使用完全相同
 * 的 checker,仅省略证据发布与状态推进。
 */
function lintState(options: ProducerOptions): ProducerState {
  try {
    const state = loadProducerState(options);
    if (state) return state;
  } catch { /* lint 不要求活动实例;checker 自行读取真实工作流状态 */ }
  return {
    workflow_id: "lint",
    status: "running",
    current_stage: options.stage,
    current_stage_instance: null,
    current_module: options.module,
    current_unit: options.unit,
  } as unknown as ProducerState;
}

function runLintProducer(options: ProducerOptions): void {
  const sensors = options.sensor ? [options.sensor] : declaredSemanticSensors(options.stage);
  if (sensors.length === 0) fail(`stage ${options.stage} declares no semantic sensors to lint`);
  const state = lintState(options);
  const results = sensors.map((sensor) => {
    const started = Date.now();
    try {
      const { payload } = runSemanticCommand(sensor, DEFAULT_TIMEOUT_MS, state, { blockedReports: false });
      return { sensor, status: "passed" as const, duration_ms: Date.now() - started, checker_status: String(payload.status) };
    } catch (error) {
      return { sensor, status: "failed" as const, duration_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const failed = results.filter((result) => result.status === "failed");
  console.log(JSON.stringify({
    mode: "lint",
    stage: options.stage,
    status: failed.length > 0 ? "failed" : "passed",
    note: "lint report only; no evidence written and no engine state changed",
    results,
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

function runProducer(args: string[]): void {
  // MARS-277: the producer checks several sensors per invocation against shared
  // digest scopes; project commands run inside invalidate the memoized digests.
  const stopHeartbeat = args.includes("--refresh") ? startProgressHeartbeat() : () => {};
  try { withRevisionMemoization(() => runProducerInner(args)); }
  finally { stopHeartbeat(); }
}

function runProducerInner(args: string[]): void {
  const options = parseArgs(args);
  if (options.refresh && process.env.AIDLC_PROGRESS === undefined) process.env.AIDLC_PROGRESS = "1";
  if (options.lint) {
    runLintProducer(options);
    return;
  }
  const state = loadProducerState(options);
  const statusAllowed = state && (state.status === "running" || options.refresh);
  if (!state || !statusAllowed) fail("evidence production requires an active lightweight workflow");
  if (!state.current_stage_instance) fail("evidence requires an exact stage instance");
  const binding = sessionBinding()!;
  const ref = producerOwner(options, state.current_stage_instance);
  // MARS-277 (4.22.13): `--refresh` of a completed module-axis instance may be run by
  // a downstream session of the same workflow under its own claim — refreshing a
  // planning baseline must not require taking over the upstream instance's claim.
  // Unit-axis and active-instance targets keep requiring the exact claim, as before.
  const rawState = loadWorkflowState(PROJECT_ROOT, ref);
  const downstreamRefresh = Boolean(
    options.refresh
    && binding
    && rawState
    && rawState.current_stage_instance !== state.current_stage_instance
    && rawState.completed_stage_instances.includes(state.current_stage_instance)
    && (!state.current_stage_instance.includes("@unit:") || options.historicalReplay && binding.stage_instance === `code-generation@module:${state.current_module}@unit:${state.current_unit}`)
    && binding.workflow_id === state.workflow_id
  );
  if (downstreamRefresh) {
    assertSessionClaim(PROJECT_ROOT, rawState!, binding.stage_instance, binding);
    publicationContext = { ref, instance: binding.stage_instance, binding };
  } else {
    assertSessionClaim(PROJECT_ROOT, state, state.current_stage_instance);
    publicationContext = { ref, instance: state.current_stage_instance, binding };
  }
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
    assertPhaseConfigBinding(options, "build/test");
    const config = requireCommandConfig(options.config, options.stage);
    const selected = lockedOptions.commandIds.length === 0
      ? config.commands.filter((command) => command.role !== "semantic")
      : lockedOptions.commandIds.map((id) => {
        const command = config.commands.find((item) => item.id === id && item.role !== "semantic");
        if (!command) fail(`command id is not in the allowlist for build/test evidence: ${id}`);
        return command;
      });
    const roles = new Set(selected.map((command) => command.role));
    const applicability = noBehaviorBasis(state);
    const roleBasis = c8RoleBasis(config, state);
    const roleErrors = c8RoleErrors(selected, config, roleBasis, !!applicability);
    const security = securityValidationBasis(config, state);
    if (security && (security.command_ids as string[]).some(id => !selected.some(command => command.id === id))) fail("selected commands omit required security validation");
    if (roleErrors.length) fail(roleErrors.join("; "));

    const commands = selected.map(spec => applicability && spec.role === "check" ? alternativeCheck(spec, state, config.freshness) : runCommand(spec));
    const testResults = commands.filter((command) => command.role === "test").map((command) => command.test_stats as TestStats);
    const tests = testResults.reduce((sum, current) => ({
      total: sum.total + current.total,
      passed: sum.passed + current.passed,
      failed: sum.failed + current.failed,
      skipped: sum.skipped + current.skipped,
    }), { total: 0, passed: 0, failed: 0, skipped: 0 });
    if (tests.failed !== 0 || (roles.has("test") || !applicability) && (tests.total < 1 || tests.passed < 1)) fail(`test summary is not eligible for evidence: ${JSON.stringify(tests)}`);

    const artifacts = (config.artifacts || []).map(hashArtifact);
    const unsigned = {
      ...executionContext(state),
      evidence_version: "1",
      timestamp: new Date().toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
      source_revision: evidenceSourceRevision(PROJECT_ROOT, state.current_stage_instance),
      commands,
      ...(applicability ? { applicability } : {}),
      ...(roleBasis ? { role_applicability: roleBasis } : {}),
      ...(security ? { risk_validation: security } : {}),
      ...(config.freshness ? { freshness: config.freshness } : {}),
      tests,
      checks: { status: "passed", command_ids: commands.filter((command) => command.role === "check").map((command) => command.id) },
      artifacts,
    };
    const errors = buildTestEvidenceErrors(unsigned, state);
    if (errors.length) fail(errors.join("; "));
    writeAtomic(output, `${JSON.stringify(producedEvidence(unsigned), null, 2)}\n`);
    if (!options.allSensors) console.log(JSON.stringify({ status: "passed", output, tests, commands: commands.length, artifacts: artifacts.length }, null, 2));
  });
  if (options.allSensors && options.stage === "build-and-test") {
    produceAllSemantic(options, state, optionalSemanticConfig(options.config, options.stage));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runProducer(process.argv.slice(2));
  } catch (error) {
    console.error(`Evidence producer blocked: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
