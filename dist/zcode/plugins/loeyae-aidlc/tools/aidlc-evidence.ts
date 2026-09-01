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
import { signRecord } from "./aidlc-trust";
import { readSourceRevision } from "./aidlc-revision";

type CommandRole = "build" | "test" | "check" | "semantic";

const SEMANTIC_SENSORS = new Set([
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
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TAIL_LENGTH = 200;
const require = createRequire(import.meta.url);

function fail(message: string): never {
  throw new Error(message);
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

function evidenceOutput(stage: string, sensor: string, value?: string): string {
  const safeStage = nonEmptyString(stage, "stage");
  const safeSensor = nonEmptyString(sensor, "sensor");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(safeStage) || !/^[a-z0-9][a-z0-9-]*$/.test(safeSensor)) {
    fail("stage and sensor must contain only lowercase letters, digits, and hyphens");
  }
  const expected = resolve(PROJECT_ROOT, ".aidlc", "evidence", safeStage, `${safeSensor}.json`);
  const output = value ? safeProjectPath(value, "output") : safeProjectPath(expected, "output");
  if (output !== expected) fail(`output must be ${expected}`);
  return output;
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

function argvDigest(argv: string[]): string {
  return createHash("sha256").update(JSON.stringify(argv)).digest("hex");
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

function parseConfig(path: string, stage: string): EvidenceConfig {
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
  if (config.stage !== stage) fail(`command allowlist stage must be "${stage}"`);
  if (!Array.isArray(config.commands) || config.commands.length === 0) fail("command allowlist commands must be non-empty");

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
    if (!["build", "test", "check", "semantic"].includes(role)) fail(`commands[${i}].role must be build, test, check, or semantic`);
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

function signedEvidence(unsigned: Record<string, unknown>): Record<string, unknown> {
  return { ...unsigned, integrity: signRecord(unsigned, false) };
}

function runSemanticCommand(sensor: string, timeoutMs: number): { payload: Record<string, unknown>; execution: Record<string, unknown> } {
  const tsx = require.resolve("tsx/cli");
  const checker = resolve(TOOL_DIR, "aidlc-semantic-checks.ts");
  const argv = [process.execPath, tsx, checker, "--sensor", sensor];
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: PROJECT_ROOT,
    env: process.env,
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
    fail(`built-in semantic checker ${sensor} failed: ${detail}; ${tail(stderr) || tail(stdout) || "no output"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    fail(`built-in semantic checker ${sensor} must return one JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`built-in semantic checker ${sensor} must return a JSON object`);
  const payload = parsed as Record<string, unknown>;
  for (const field of ["evidence_version", "timestamp", "producer", "source_revision", "checker", "integrity"]) {
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

function runSemanticProducer(options: ProducerOptions, config: EvidenceConfig): void {
  const sensor = options.sensor;
  if (!sensor || sensor === "build-test-evidence") fail("semantic producer requires --sensor with a semantic sensor name");
  if (options.commandIds.length > 0) fail("--command-id is only supported for build/test evidence");
  const declarations = config.commands.filter((command) => command.role === "semantic" && command.sensor === sensor);
  if (declarations.length !== 1) fail(`allowlist must declare exactly one built-in semantic checker for ${sensor}`);
  const result = runSemanticCommand(sensor, declarations[0].timeout_ms || 10 * 60 * 1000);
  const output = options.output || evidenceOutput(options.stage, sensor);
  const unsigned = {
    ...result.payload,
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
    source_revision: readSourceRevision(PROJECT_ROOT),
    checker: result.execution,
  };
  writeAtomic(output, `${JSON.stringify(signedEvidence(unsigned), null, 2)}\n`);
  console.log(JSON.stringify({ status: "passed", output, sensor, checker: `builtin:${sensor}` }, null, 2));
}

interface ProducerOptions {
  stage: string;
  sensor?: string;
  config: string;
  output?: string;
  commandIds: string[];
}

function parseArgs(args: string[]): ProducerOptions {
  if (args[0] !== "run") fail("usage: aidlc-evidence.ts run --stage <stage> [--sensor <sensor>] [--config <path>] [--output <path>] [--command-id <id> ...]");
  let stage = "";
  let sensor: string | undefined;
  let config = DEFAULT_CONFIG;
  let output: string | undefined;
  const commandIds: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (["--stage", "--sensor", "--config", "--output", "--command-id"].includes(arg)) {
      const value = args[++i];
      if (!value) fail(`${arg} requires a value`);
      if (arg === "--stage") stage = value;
      if (arg === "--sensor") sensor = value;
      if (arg === "--config") config = value;
      if (arg === "--output") output = value;
      if (arg === "--command-id") commandIds.push(value);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aidlc-evidence.ts run --stage <stage> [--sensor <sensor>] [--config <path>] [--output <path>] [--command-id <id> ...]");
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (!stage) fail("--stage is required");
  if (sensor && sensor !== "build-test-evidence" && !SEMANTIC_SENSORS.has(sensor)) fail(`unsupported semantic sensor: ${sensor}`);
  const outputSensor = sensor || "build-test-evidence";
  return {
    stage,
    sensor,
    config: safeProjectPath(config, "config", true),
    output: output ? evidenceOutput(stage, outputSensor, output) : undefined,
    commandIds,
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

function runProducer(args: string[]): void {
  const secret = process.env.AIDLC_TRUST_SECRET;
  if (secret === undefined || Buffer.byteLength(secret, "utf8") < 32) {
    fail("AIDLC_TRUST_SECRET must contain at least 32 bytes for evidence production");
  }
  const options = parseArgs(args);
  const outputSensor = options.sensor || "build-test-evidence";
  const output = options.output || evidenceOutput(options.stage, outputSensor);
  withProducerLock(output, () => {
    const lockedOptions = { ...options, output };
    const config = parseConfig(lockedOptions.config, lockedOptions.stage);
    if (lockedOptions.sensor && lockedOptions.sensor !== "build-test-evidence") {
      runSemanticProducer(lockedOptions, config);
      return;
    }
    if (lockedOptions.stage !== "build-and-test") fail('controlled producer currently supports only stage "build-and-test"');
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
      evidence_version: "1",
      timestamp: new Date().toISOString(),
      status: "passed",
      producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
      source_revision: readSourceRevision(PROJECT_ROOT),
      commands,
      tests,
      checks: { status: "passed", command_ids: commands.filter((command) => command.role === "check").map((command) => command.id) },
      artifacts,
    };
    writeAtomic(output, `${JSON.stringify(signedEvidence(unsigned), null, 2)}\n`);
    console.log(JSON.stringify({ status: "passed", output, tests, commands: commands.length, artifacts: artifacts.length }, null, 2));
  });
}

try {
  runProducer(process.argv.slice(2));
} catch (error) {
  console.error(`Evidence producer blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
