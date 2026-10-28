/** Controlled, post-hoc RED replay. Diagnostic reports are never imported as observations. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync as resolveRealPath, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync } from './aidlc-spawn';
import { markProgress } from './aidlc-progress';

// Native Windows resolution avoids walking every ancestor of each pnpm junction.
const realpathSync = resolveRealPath.native;

export const REPLAY_LIMITATION = 'historical_replay proves the current execution against historical source only. The original controlled RED is missing; this is post-hoc replay, not recovery of its original execution or timestamp, cross-domain integration, or business acceptance.';
export interface ReplayIdentity { workflow_id: string; module_id: string; unit_id: string }
export interface ReplayConfig extends ReplayIdentity {
  version: '1'; mode: 'historical_replay'; repository: string; worktree: string;
  pre_implementation_commit: string; implementation_commit: string;
  argv: string[]; config_file: string; timeout_ms?: number;
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const objectDigest = (value: unknown) => digest(JSON.stringify(value));
function progress(message: string): void { markProgress(1); if (process.env.AIDLC_PROGRESS === '1') process.stderr.write(`[aidlc] historical_replay: ${message}\n`); }
const ensure = (condition: unknown, message: string): void => { if (!condition) throw new Error(`historical_replay: ${message}`); };
function inside(root: string, path: string): boolean {
  const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
function git(cwd: string, args: string[], input?: string): string {
  const r = runSync('git', ['--no-optional-locks', '-c', 'core.quotepath=false', ...args], { cwd, input, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  ensure(!r.error && r.status === 0, `git ${args[0]} failed: ${r.error?.message || r.stderr}`);
  return String(r.stdout).trim();
}
function file(path: string): Buffer {
  ensure(existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), `missing or non-regular file ${path}`);
  return readFileSync(path);
}
export function replayConfigPath(root: string, workflow: string, module: string, unit: string): string {
  for (const id of [workflow, module, unit]) ensure(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id), 'invalid exact workflow/module/unit');
  return join(root, '.aidlc', 'commands', 'historical-red', workflow, module, unit + '.json');
}
export function readReplayConfig(root: string, identity: ReplayIdentity): { config: ReplayConfig; digest: string; path: string } {
  const path = replayConfigPath(root, identity.workflow_id, identity.module_id, identity.unit_id);
  ensure(inside(realpathSync(root), realpathSync(path)), 'config must belong to the workflow project');
  const bytes = file(path); const config = JSON.parse(bytes.toString()) as ReplayConfig;
  ensure(config.version === '1' && config.mode === 'historical_replay', 'unsupported replay configuration');
  for (const key of ['workflow_id', 'module_id', 'unit_id'] as const) ensure(config[key] === identity[key], `wrong ${key} in scoped command/source configuration`);
  for (const key of ['repository', 'worktree'] as const) ensure(typeof config[key] === 'string' && isAbsolute(config[key]), `${key} must be absolute`);
  ensure(Array.isArray(config.argv) && config.argv.every(x => typeof x === 'string'), 'argv is required');
  ensure(typeof config.config_file === 'string' && inside(config.worktree, resolve(config.worktree, config.config_file)), 'config_file must be in historical source');
  // The initial adapter deliberately supports Vitest only. No arbitrary observer may self-report RED.
  ensure(config.argv[0] === process.execPath && config.argv[1] === 'node_modules/vitest/vitest.mjs' && config.argv[2] === 'run', 'command must invoke the controlled Vitest adapter');
  ensure(config.argv.length === 7 && config.argv[3] === '--config' && config.argv[4] === config.config_file && config.argv[5] === '--maxWorkers=1' && config.argv[6] === '--no-cache', 'Vitest argv must declare config, single worker and no cache; reporters are producer-owned');
  ensure(config.timeout_ms === undefined || Number.isInteger(config.timeout_ms) && config.timeout_ms > 0 && config.timeout_ms <= 1800000, 'invalid timeout');
  return { config, digest: digest(bytes), path };
}

/** Hash actual installed bytes, following package-manager links and recording their targets. */
function dependencySnapshot(root: string): { realpath: string; digest: string; files: number } {
  ensure(existsSync(root), 'installed dependency environment is missing');
  const result = runSync(process.execPath, [fileURLToPath(new URL('./aidlc-historical-dependencies.mjs', import.meta.url)), root], {
    encoding: 'utf8', shell: false, timeout: 600000, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  ensure(!result.error && result.status === 0, `cannot hash actual dependencies: ${result.error?.message || result.status}`);
  const summary = JSON.parse(String(result.stdout));
  ensure(summary.realpath === realpathSync(root) && /^[a-f0-9]{64}$/.test(summary.digest) && Number.isSafeInteger(summary.files) && summary.files > 0, 'invalid dependency byte summary');
  progress(`verified ${summary.files} actual dependency files`);
  return summary;
}

export function captureReplaySource(config: Pick<ReplayConfig, 'repository' | 'worktree' | 'pre_implementation_commit' | 'implementation_commit'>): any {
  progress('verifying Git identity, ancestry, sparse checkout and historical file blobs');
  const repository = realpathSync(config.repository); const worktree = realpathSync(config.worktree);
  const common = (cwd: string) => realpathSync(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])));
  ensure(realpathSync(git(worktree, ['rev-parse', '--show-toplevel'])) === worktree, 'worktree must be a repository root');
  ensure(common(repository) === common(worktree), 'worktree belongs to a different repository');
  for (const sha of [config.pre_implementation_commit, config.implementation_commit]) ensure(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha), 'full commit IDs required');
  const commit = git(worktree, ['rev-parse', 'HEAD']);
  ensure(commit === config.pre_implementation_commit, 'HEAD does not match pre-implementation commit');
  ensure(commit !== config.implementation_commit, 'pre-implementation commit must be a strict ancestor of implementation');
  try { git(repository, ['merge-base', '--is-ancestor', commit, config.implementation_commit]); }
  catch (error) { throw new Error(`historical_replay: pre-implementation ${commit} is not an ancestor of production ${config.implementation_commit}: ${error}`); }
  // The declared production implementation must itself be in this repository's current lineage.
  try { git(repository, ['merge-base', '--is-ancestor', config.implementation_commit, 'HEAD']); }
  catch (error) { throw new Error(`historical_replay: production ${config.implementation_commit} is not an ancestor of the declared repository HEAD: ${error}`); }
  ensure(git(worktree, ['config', '--bool', 'core.sparseCheckout']) === 'true', 'historical worktree must use verified sparse-checkout');
  const status = git(worktree, ['status', '--porcelain', '--untracked-files=all']);
  ensure(!status, `dirty or untracked historical worktree: ${status}`);
  const tracked = git(worktree, ['ls-tree', '-r', '--full-tree', commit]).split('\n').filter(Boolean).map(line => {
    const m = /^(\d+) blob ([a-f0-9]+)\t(.+)$/.exec(line); ensure(m, 'submodules or unsupported tracked paths');
    ensure(!/[\r\n"\t]/.test(m![3]), 'unsupported tracked filename quoting');
    return { mode: m![1], blob: m![2], path: m![3] };
  });
  const materialized = tracked.filter(x => existsSync(join(worktree, x.path)));
  ensure(materialized.length > 0, 'historical checkout is empty');
  for (const entry of materialized) ensure(entry.mode !== '120000' && inside(worktree, realpathSync(join(worktree, entry.path))), `source symlink is not supported: ${entry.path}`);
  // Hash-object reads bytes even when assume-unchanged/skip-worktree would hide edits from status.
  const blobs = git(worktree, ['hash-object', '--stdin-paths'], materialized.map(x => x.path).join('\n') + '\n').split(/\r?\n/);
  ensure(blobs.length === materialized.length && materialized.every((x, i) => x.blob === blobs[i]), 'source/test blob mismatch against declared commit');
  const ignored = git(worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']).split('\n').filter(Boolean);
  ensure(ignored.every(path => path.startsWith('node_modules/')), 'undeclared ignored inputs outside node_modules');
  const inputs = materialized.map(x => ({ ...x, sha256: digest(file(join(worktree, x.path))) }));
  const locks = inputs.filter(x => /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$/.test(x.path));
  ensure(locks.length, 'historical dependency lockfile is missing');
  progress(`verified ${inputs.length} source/test/config files; hashing actual installed dependencies`);
  return { repository, worktree, common_git_dir: common(repository), remote: git(repository, ['config', '--get', 'remote.origin.url']), commit,
    tree: git(worktree, ['rev-parse', 'HEAD^{tree}']), implementation_commit: config.implementation_commit,
    implementation_parents: git(repository, ['show', '-s', '--format=%P', config.implementation_commit]).split(' '),
    strict_ancestor: true, dirty: false, sparse_patterns: git(worktree, ['sparse-checkout', 'list']),
    inputs_digest: objectDigest(inputs), inputs, lockfiles: locks, dependencies: dependencySnapshot(join(worktree, 'node_modules')),
    runtime: { node: process.version, executable: realpathSync(process.execPath), executable_sha256: digest(file(process.execPath)), platform: process.platform, arch: process.arch } };
}

export function parseReplayReport(report: any, ids: string[], worktree: string, compact = false): any {
  ensure(ids.length && new Set(ids).size === ids.length, 'nonempty unique current I13 UC-D set required');
  ensure(Array.isArray(report.testResults) && report.testResults.length, 'missing test suites');
  ensure((report.numRuntimeErrorTestSuites ?? 0) === 0 && (report.unhandledErrors?.length ?? 0) === 0, 'environment or compilation suite failure');
  ensure(report.numPendingTests === 0 && (report.numTodoTests ?? 0) === 0, 'skipped/pending/todo tests cannot establish RED');
  const tests: any[] = [];
  for (const suite of report.testResults) {
    ensure(!suite.message, 'environment or compilation suite error');
    const path = resolve(suite.name || '');
    ensure(inside(worktree, path), 'test report references a different source repository');
    file(path);
    ensure(Array.isArray(suite.assertionResults) && suite.assertionResults.length, 'missing tests or environment/compilation failure');
    for (const test of suite.assertionResults) {
      ensure(['failed', 'passed'].includes(test.status) && typeof test.fullName === 'string', 'skipped or malformed test');
      if (test.status === 'failed') ensure(Array.isArray(test.failureMessages) && test.failureMessages.length && test.failureMessages.every((m: unknown) => typeof m === 'string' && /^AssertionError\b/.test(m.trim())), 'failure is not a business AssertionError (environment/compilation failure)');
      tests.push({ file: relative(worktree, path).replace(/\\/g, '/'), method: test.fullName, status: test.status, failures: test.failureMessages || [] });
    }
  }
  const failed = tests.filter(t => t.status === 'failed').length;
  ensure(tests.length > 0 && failed > 0, 'all GREEN or empty tests cannot establish RED');
  ensure(report.numTotalTests === tests.length && report.numFailedTests === failed && report.numPassedTests === tests.length - failed, 'test report counts do not match executed assertions');
  const uc_mapping = ids.map(id => ({ use_case: id, test_methods: tests.filter(t => (t.method.match(/UC-D-[a-zA-Z0-9]+/g) || []).includes(id)).map(t => `${t.file}#${t.method}`) }));
  ensure(uc_mapping.every(m => m.test_methods.length), 'current I13 UC-D mapping gap');
  return { phase: 'RED', status: 'failed', failure_class: 'behavior', failure_signature: objectDigest(tests.filter(t => t.status === 'failed')),
    compile_status: 'passed', environment_status: 'passed', tests_total: tests.length, tests_failed: failed,
    tests_passed: tests.length - failed, tests_skipped: 0, traceability_complete: true, ucd_ids: ids, uc_mapping,
    executed_tests: compact ? tests.map(({ failures, ...test }) => ({ ...test, failure_sha256: objectDigest(failures) })) : tests };
}

/** Current business documents are separate from immutable historical source and the I13 envelope. */
function currentRequirementDigest(root: string, module: string): string {
  const base = join(root, 'docs', 'aidlc', 'modules', module, 'inception');
  const entries: [string, string][] = [];
  const visit = (path: string): void => {
    ensure(inside(realpathSync(root), realpathSync(path)), 'requirement source escapes project');
    if (statSync(path).isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child));
    else if (/\.(?:md|json|ya?ml)$/.test(path)) entries.push([relative(base, path), digest(file(path))]);
  };
  visit(base); ensure(entries.length, 'current requirement sources missing');
  return objectDigest(entries);
}

const REPORT_NAMES = ['vitest.json', 'stdout.log', 'stderr.log', 'runtime-errors.json', 'runtime-reporter.mjs'];
function sourceSummary(source: any): any { const { inputs, ...summary } = source; return { ...summary, input_count: inputs.length }; }
export interface ReplayPrior { path: string; sha256: string; reason: 'controlled_historical_refresh' }
/** Retain a prior controlled replay verbatim; an original RED or diagnostic file is never replaced. */
export function historicalReplayPrior(root: string, identity: ReplayIdentity, output: string): ReplayPrior | undefined {
  if (!existsSync(output)) return undefined;
  const bytes = file(output);
  ensure(bytes.length <= 16 * 1024 * 1024, 'prior replay is too large to audit safely');
  const old = JSON.parse(bytes.toString());
  ensure(old.evidence_mode === 'historical_replay' && old.phase === 'RED' && old.producer?.name === 'loeyae-aidlc-evidence' && old.producer?.mode === 'controlled'
    && /^[a-f0-9-]{36}$/.test(old.producer.execution_id) && old.module_id === identity.module_id && old.unit_id === identity.unit_id,
    'existing original RED or diagnostic evidence cannot be overwritten');
  for (const key of ['workflow_id', 'module_id', 'unit_id'] as const) ensure(old.historical_replay?.[key] === identity[key], `prior replay belongs to a different ${key}`);
  ensure(Buffer.from(bytes.toString()).equals(bytes), 'prior replay must be valid UTF-8 for verbatim preservation');
  return { path: join(root, '.aidlc', 'evidence', 'historical-red-history', identity.workflow_id, identity.module_id, identity.unit_id, old.producer.execution_id + '.json'), sha256: digest(bytes), reason: 'controlled_historical_refresh' };
}
function runtimeReporter(path: string): string {
  return `import { writeFileSync } from 'node:fs';\nexport default class { onFinished(files = [], errors = []) { writeFileSync(${JSON.stringify(path)}, JSON.stringify({ completed: true, unhandled_errors: errors.map(e => ({ name: e.name, message: e.message })), suite_errors: files.flatMap(f => f.result?.errors || []).map(e => ({ name: e.name, message: e.message })) })); } }\n`;
}
function runtimeErrors(path: string): void {
  const runtime = JSON.parse(file(path).toString());
  ensure(runtime.completed === true && Array.isArray(runtime.unhandled_errors) && runtime.unhandled_errors.length === 0 && Array.isArray(runtime.suite_errors) && runtime.suite_errors.length === 0, 'environment, unhandled runtime or compilation errors');
}

function replayExecutionEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  env.CI = '1'; env.NO_COLOR = '1';
  return env;
}

export function runHistoricalReplay(root: string, identity: ReplayIdentity, i13: Record<string, unknown>, ids: string[], output: string, prior?: ReplayPrior): any {
  ensure(prior ? existsSync(output) && digest(file(output)) === prior.sha256 : !existsSync(output), 'original evidence must be missing; existing controlled evidence cannot be overwritten without audited historical refresh');
  const declared = readReplayConfig(root, identity); const config = declared.config;
  const before = captureReplaySource(config);
  const requirements_sha256 = currentRequirementDigest(root, identity.module_id);
  ensure(before.inputs.some((x: any) => x.path === config.config_file), 'Vitest config must be tracked at the declared historical commit');
  const reportDir = join(root, '.aidlc', 'evidence', 'historical-red-runs', identity.workflow_id, identity.module_id, identity.unit_id, randomUUID());
  mkdirSync(reportDir, { recursive: true });
  ensure(inside(realpathSync(root), realpathSync(reportDir)), 'report output escapes workflow project');
  const reportPath = join(reportDir, 'vitest.json');
  const runtimePath = join(reportDir, 'runtime-errors.json');
  const reporterPath = join(reportDir, 'runtime-reporter.mjs');
  writeFileSync(reporterPath, runtimeReporter(runtimePath));
  writeFileSync(join(reportDir, 'source-inputs.json'), JSON.stringify(before.inputs));
  const argv = [...config.argv, '--reporter=json', `--reporter=${reporterPath}`, `--outputFile=${reportPath}`];
  // Exclude loader/test-filter/session injection. Dependencies and source are measured separately.
  const env = replayExecutionEnvironment();
  const started_at = new Date().toISOString(); const start = Date.now();
  progress(`executing Vitest at ${config.pre_implementation_commit}; cwd=${config.worktree}`);
  const result = runSync(argv[0], argv.slice(1), { cwd: config.worktree, env, shell: false, encoding: 'utf8', timeout: config.timeout_ms || 600000, maxBuffer: 32 * 1024 * 1024 });
  const finished_at = new Date().toISOString();
  const executionDuration = Date.now() - start;
  writeFileSync(join(reportDir, 'stdout.log'), String(result.stdout || '')); writeFileSync(join(reportDir, 'stderr.log'), String(result.stderr || ''));
  ensure(!result.error && result.status === 1 && !result.signal, `test process must exit 1 without execution errors; got ${result.status}: ${result.error?.message || result.stderr}`);
  const after = captureReplaySource(config);
  ensure(objectDigest(before) === objectDigest(after), 'source/test/config/dependency environment changed during execution');
  ensure(readReplayConfig(root, identity).digest === declared.digest, 'scoped command configuration changed during execution');
  ensure(currentRequirementDigest(root, identity.module_id) === requirements_sha256, 'current requirements changed during execution');
  runtimeErrors(runtimePath);
  const bytes = file(reportPath); const observation = parseReplayReport(JSON.parse(bytes.toString()), ids, config.worktree, true);
  ensure(observation.executed_tests.every((t: any) => before.inputs.some((input: any) => input.path === t.file)), 'executed test source is not tracked at the historical commit');
  const argv_digest = objectDigest(argv);
  return { ...observation, evidence_mode: 'historical_replay', historical_replay: { version: '2', ...identity, original_evidence_missing: true, post_hoc: true,
    limitation: REPLAY_LIMITATION, source: sourceSummary(before), config_sha256: declared.digest, i13_sha256: objectDigest(i13), requirements_sha256,
    ...(prior ? { supersedes: prior } : {}),
    execution: { started_at, finished_at, argv, cwd: config.worktree, exit_code: result.status, signal: result.signal, duration_ms: executionDuration, environment: env },
    reports: [...REPORT_NAMES, 'source-inputs.json'].map(name => ({ path: join(reportDir, name), sha256: digest(file(join(reportDir, name))) })) },
    observed_command: { id: 'historical-replay:vitest', phase: 'RED', argv_digest, cwd: config.worktree, exit_code: 1, expected_exit_code: 1, duration_ms: executionDuration } };
}

export function replayEvidenceErrors(root: string, evidence: any, identity: ReplayIdentity, i13: Record<string, unknown>, ids: string[]): string[] {
  try {
    ensure(evidence.evidence_mode === 'historical_replay' && evidence.phase === 'RED', 'mode is not controlled historical RED');
    const replay = evidence.historical_replay;
    ensure(['1', '2'].includes(replay?.version) && replay.original_evidence_missing === true && replay.post_hoc === true && replay.limitation === REPLAY_LIMITATION, 'missing post-hoc/original-loss declaration');
    const compact = replay.version === '2';
    const reportNames = compact ? [...REPORT_NAMES, 'source-inputs.json'] : REPORT_NAMES;
    for (const key of ['workflow_id', 'module_id', 'unit_id'] as const) ensure(replay[key] === identity[key], `wrong ${key} in replay evidence`);
    const claim = replay.publication_claim;
    ensure(claim?.workflow_id === identity.workflow_id && claim.project_root === realpathSync(root)
      && [`tdd@module:${identity.module_id}@unit:${identity.unit_id}`, `code-generation@module:${identity.module_id}@unit:${identity.unit_id}`].includes(claim.stage_instance)
      && ['owner', 'session_id', 'generation'].every(key => typeof claim[key] === 'string' && claim[key]), 'missing exact authorized publication session');
    const declared = readReplayConfig(root, identity);
    ensure(replay.config_sha256 === declared.digest, 'command/source configuration digest mismatch');
    ensure(replay.i13_sha256 === objectDigest(i13), 'I13 changed since replay; revalidate current requirements and mapping');
    ensure(replay.requirements_sha256 === currentRequirementDigest(root, identity.module_id), 'current requirements changed since replay');
    const currentSource = captureReplaySource(declared.config);
    ensure(objectDigest(compact ? sourceSummary(currentSource) : currentSource) === objectDigest(replay.source), 'source/test/config/lock/dependency/runtime digest mismatch');
    const execution = replay.execution;
    ensure(objectDigest(execution.environment) === objectDigest(replayExecutionEnvironment()), 'actual execution environment changed or contains undeclared inputs');
    ensure(Number.isFinite(Date.parse(execution.started_at)) && Date.parse(execution.finished_at) >= Date.parse(execution.started_at) && Date.parse(execution.finished_at) <= Date.parse(evidence.timestamp), 'invalid actual execution timestamps');
    ensure(execution.exit_code === 1 && execution.signal === null && execution.cwd === declared.config.worktree && execution.duration_ms >= 0, 'invalid execution result or working directory');
    ensure(Array.isArray(replay.reports) && replay.reports.length === reportNames.length, 'raw reports required');
    const expectedBase = join(root, '.aidlc', 'evidence', 'historical-red-runs', identity.workflow_id, identity.module_id, identity.unit_id);
    for (const r of replay.reports) ensure(inside(realpathSync(expectedBase), realpathSync(r.path)) && digest(file(r.path)) === r.sha256, 'raw report path/digest mismatch');
    const report = replay.reports.find((r: any) => r.path.endsWith('vitest.json')); ensure(report, 'Vitest raw report is missing');
    const reportDir = resolve(report.path, '..');
    ensure(reportNames.every(name => replay.reports.some((r: any) => r.path === join(reportDir, name))), 'report identities must be unique producer-owned files');
    if (compact) ensure(objectDigest(JSON.parse(file(join(reportDir, 'source-inputs.json')).toString())) === objectDigest(currentSource.inputs), 'source inventory sidecar mismatch');
    if (replay.supersedes) {
      const prior = replay.supersedes;
      const historyRoot = join(root, '.aidlc', 'evidence', 'historical-red-history', identity.workflow_id, identity.module_id, identity.unit_id);
      ensure(prior.reason === 'controlled_historical_refresh' && inside(realpathSync(historyRoot), realpathSync(prior.path)) && digest(file(prior.path)) === prior.sha256, 'prior historical replay archive path/digest mismatch');
      const old = JSON.parse(file(prior.path).toString());
      ensure(old.evidence_mode === 'historical_replay' && old.producer?.mode === 'controlled' && old.historical_replay?.workflow_id === identity.workflow_id && old.module_id === identity.module_id && old.unit_id === identity.unit_id, 'prior archive must be the same controlled historical scope');
    }
    ensure(file(join(reportDir, 'runtime-reporter.mjs')).toString() === runtimeReporter(join(reportDir, 'runtime-errors.json')), 'runtime reporter does not match controlled adapter');
    runtimeErrors(join(reportDir, 'runtime-errors.json'));
    const argv = [...declared.config.argv, '--reporter=json', `--reporter=${join(reportDir, 'runtime-reporter.mjs')}`, `--outputFile=${report.path}`];
    ensure(objectDigest(argv) === objectDigest(execution.argv), 'executed command identity mismatch');
    const observation = parseReplayReport(JSON.parse(file(report.path).toString()), ids, declared.config.worktree, compact);
    ensure(observation.executed_tests.every((t: any) => currentSource.inputs.some((input: any) => input.path === t.file)), 'executed test source is not tracked at the historical commit');
    for (const key of Object.keys(observation)) ensure(objectDigest(evidence[key]) === objectDigest(observation[key]), `report observation mismatch: ${key}`);
    const observed = evidence.observed_command;
    ensure(observed?.id === 'historical-replay:vitest' && observed.argv_digest === objectDigest(argv) && observed.cwd === execution.cwd && observed.phase === 'RED' && observed.exit_code === 1, 'observed command mismatch');
    ensure(evidence.producer?.mode === 'controlled' && evidence.producer?.name === 'loeyae-aidlc-evidence' && evidence.checker?.argv_digest === objectDigest(['RED-observation', objectDigest(argv)]), 'controlled producer/checker binding mismatch');
    return [];
  } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
