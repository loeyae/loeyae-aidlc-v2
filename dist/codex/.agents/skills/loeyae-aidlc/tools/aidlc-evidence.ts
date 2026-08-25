#!/usr/bin/env node
import { createHash, randomUUID } from "crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { spawnSync } from "child_process";
import { dirname, isAbsolute, join, relative, resolve } from "path";

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
  argv: string[];
  cmd: string;
  cwd: string;
  exit_code: number;
  status: "passed";
  duration_ms: number;
  stdout_tail?: string;
  stderr_tail?: string;
  test_stats?: TestStats;
}

const PROJECT_ROOT = process.cwd();
const DEFAULT_CONFIG = ".aidlc/evidence-commands.json";
const MAX_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const TAIL_LENGTH = 200;

function fail(message: string): never {
  throw new Error(message);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${field} must be a non-empty string`);
  return value.trim();
}

function within(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    fail(`path escapes project root: ${candidate}`);
  }
  return resolvedCandidate;
}

function projectPath(value: string, field: string): string {
  return within(PROJECT_ROOT, resolve(PROJECT_ROOT, nonEmptyString(value, field)));
}

function evidenceOutput(stage: string, sensor: string, value?: string): string {
  const safeStage = nonEmptyString(stage, "stage");
  const safeSensor = nonEmptyString(sensor, "sensor");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(safeStage) || !/^[a-z0-9][a-z0-9-]*$/.test(safeSensor)) fail("stage and sensor must contain only lowercase letters, digits, and hyphens");
  const evidenceRoot = resolve(PROJECT_ROOT, ".aidlc", "evidence", safeStage);
  const expected = join(evidenceRoot, `${safeSensor}.json`);
  const output = value ? projectPath(value, "output") : expected;
  if (output !== expected) fail(`output must be ${expected}`);
  return output;
}

function tail(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  return redact(text.slice(-TAIL_LENGTH));
}

function redact(value: string): string {
  return value.replace(/(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function commandText(argv: string[]): string {
  return argv.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ");
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

function parseConfig(path: string, stage: string): EvidenceConfig {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read command allowlist ${path}: ${error instanceof Error ? error.message : String(error)}`);
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
    const cwd = record.cwd === undefined ? PROJECT_ROOT : projectPath(String(record.cwd), `commands[${i}].cwd`);
    const timeout = record.timeout_ms === undefined ? 10 * 60 * 1000 : Number(record.timeout_ms);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) fail(`commands[${i}].timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
    commands.push({ id, role, sensor, argv, cwd, timeout_ms: timeout });
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
      artifacts.push({ id, path: projectPath(String(record.path), `artifacts[${i}].path`) });
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

function runCommand(spec: CommandSpec): CommandResult {
  const cwd = spec.cwd || PROJECT_ROOT;
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
    argv: spec.argv,
    cmd: commandText(spec.argv),
    cwd,
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

function readSourceRevision(): { commit: string; dirty: boolean | null } {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8", shell: false });
  if (revision.status !== 0 || typeof revision.stdout !== "string") return { commit: "unavailable", dirty: null };
  const dirty = spawnSync("git", ["diff", "--quiet"], { cwd: PROJECT_ROOT, encoding: "utf8", shell: false });
  return { commit: revision.stdout.trim(), dirty: dirty.status === 0 };
}

function hashArtifact(spec: ArtifactSpec): Record<string, unknown> {
  if (!existsSync(spec.path) || !statSync(spec.path).isFile()) fail(`artifact not found or not a regular file: ${spec.path}`);
  const content = readFileSync(spec.path);
  return {
    id: spec.id,
    path: relative(PROJECT_ROOT, spec.path) || ".",
    sha256: createHash("sha256").update(content).digest("hex"),
    size_bytes: content.byteLength,
  };
}

function writeAtomic(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, value, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function runSemanticCommand(spec: CommandSpec): { payload: Record<string, unknown>; execution: Record<string, unknown> } {
  const started = Date.now();
  const result = spawnSync(spec.argv[0], spec.argv.slice(1), {
    cwd: spec.cwd || PROJECT_ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    timeout: spec.timeout_ms,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const duration = Date.now() - started;
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : result.stdout ? String(result.stdout).trim() : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr ? String(result.stderr) : "";
  const exitCode = typeof result.status === "number" ? result.status : 1;
  if (result.error || exitCode !== 0) {
    const detail = result.error ? result.error.message : `exit code ${exitCode}`;
    fail(`semantic checker ${spec.id} failed: ${detail}; ${tail(stderr) || tail(stdout) || "no output"}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    fail(`semantic checker ${spec.id} must return one JSON object on stdout: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`semantic checker ${spec.id} must return a JSON object`);
  const payload = parsed as Record<string, unknown>;
  for (const field of ["evidence_version", "timestamp", "producer", "source_revision", "checker"]) {
    if (field in payload) fail(`semantic checker ${spec.id} must not provide producer-controlled field ${field}`);
  }
  if (typeof payload.status !== "string" || payload.status.trim().length === 0) fail(`semantic checker ${spec.id} must provide a non-empty status`);
  return {
    payload,
    execution: {
      id: spec.id,
      sensor: spec.sensor,
      argv: spec.argv,
      cmd: commandText(spec.argv),
      cwd: spec.cwd || PROJECT_ROOT,
      exit_code: exitCode,
      status: "passed",
      duration_ms: duration,
    },
  };
}

function runSemanticProducer(options: { stage: string; sensor?: string; config: string; output?: string; commandIds: string[] }, config: EvidenceConfig): void {
  const sensor = options.sensor;
  if (!sensor || sensor === "build-test-evidence") fail("semantic producer requires --sensor with a semantic sensor name");
  if (options.commandIds.length > 0) fail("--command-id is only supported for build/test evidence");
  const checkers = config.commands.filter((command) => command.role === "semantic" && command.sensor === sensor);
  if (checkers.length !== 1) fail(`allowlist must contain exactly one semantic checker for ${sensor}`);
  const result = runSemanticCommand(checkers[0]);
  const output = options.output || evidenceOutput(options.stage, sensor);
  const evidence = {
    ...result.payload,
    evidence_version: "1",
    timestamp: new Date().toISOString(),
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
    source_revision: readSourceRevision(),
    checker: result.execution,
  };
  writeAtomic(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ status: "passed", output, sensor, checker: checkers[0].id }, null, 2));
}

function parseArgs(args: string[]): { stage: string; sensor?: string; config: string; output?: string; commandIds: string[] } {
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
  return { stage, sensor, config: projectPath(config, "config"), output: output ? evidenceOutput(stage, outputSensor, output) : undefined, commandIds };
}

function runProducer(args: string[]): void {
  const options = parseArgs(args);
  const config = parseConfig(options.config, options.stage);
  const isSemantic = Boolean(options.sensor && options.sensor !== "build-test-evidence");
  if (isSemantic) {
    runSemanticProducer(options, config);
    return;
  }
  if (options.stage !== "build-and-test") fail('controlled producer currently supports only stage "build-and-test"');
  const selected = (options.commandIds.length === 0
    ? config.commands.filter((command) => command.role !== "semantic")
    : options.commandIds.map((id) => {
      const command = config.commands.find((item) => item.id === id && item.role !== "semantic");
      if (!command) fail(`command id is not in the allowlist for build/test evidence: ${id}`);
      return command;
    }));
  const roles = new Set(selected.map((command) => command.role));
  if (!roles.has("build") || !roles.has("test") || !roles.has("check")) fail("selected allowlist commands must include build, test, and check roles");

  const commands: CommandResult[] = [];
  for (const command of selected) commands.push(runCommand(command));
  const testResults = commands.filter((command) => command.role === "test").map((command) => command.test_stats as TestStats);
  const tests = testResults.reduce((sum, current) => ({
    total: sum.total + current.total,
    passed: sum.passed + current.passed,
    failed: sum.failed + current.failed,
    skipped: sum.skipped + current.skipped,
  }), { total: 0, passed: 0, failed: 0, skipped: 0 });
  if (tests.total < 1 || tests.passed < 1 || tests.failed !== 0) fail(`test summary is not eligible for evidence: ${JSON.stringify(tests)}`);

  const output = options.output || evidenceOutput(options.stage, "build-test-evidence");
  const artifacts = (config.artifacts || []).map(hashArtifact);
  const timestamp = new Date().toISOString();
  const evidence = {
    evidence_version: "1",
    timestamp,
    status: "passed",
    producer: { name: "loeyae-aidlc-evidence", mode: "controlled", execution_id: randomUUID() },
    source_revision: readSourceRevision(),
    commands,
    tests,
    checks: { status: "passed", command_ids: commands.filter((command) => command.role === "check").map((command) => command.id) },
    artifacts,
  };
  writeAtomic(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ status: "passed", output, tests, commands: commands.length, artifacts: artifacts.length }, null, 2));
}

try {
  runProducer(process.argv.slice(2));
} catch (error) {
  console.error(`Evidence producer blocked: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
