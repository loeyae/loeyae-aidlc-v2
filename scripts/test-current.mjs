import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { testPython } from './run-python.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suiteName = file => basename(file).replace(/\.(ts|mjs|py)$/, '');

export function selectSuites(suites, argv) {
  const names = [], known = new Set(suites.map(([, file]) => suiteName(file)));
  let failFast = false, list = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fail-fast') failFast = true;
    else if (argv[i] === '--list') list = true;
    else if (argv[i] === '--suite' && argv[i + 1] && !argv[i + 1].startsWith('--')) names.push(argv[++i]);
    else throw Error('Usage: npm test -- [--list] [--suite <exact-name>]... [--fail-fast]');
  }
  for (const name of names) if (!known.has(name)) throw Error(`Unknown suite: ${name}. Use --list.`);
  const selected = suites.filter(([, file]) => !names.length || names.includes(suiteName(file)));
  if (!selected.length) throw Error('No test suites selected; an empty run is not a pass.');
  return { selected, failFast, list, scope: names.length ? 'selected' : 'full', available: suites.length };
}

// The same runner handles short regressions and the full suite. Results stay in
// the existing logs; there is no evidence cache, project state or completion gate.
export async function runTests({ tasks, cwd, output, env = process.env, failFast = false, selection, log = console.log, error = console.error }) {
  if (!tasks.length || new Set(tasks.map(t => t.name)).size !== tasks.length || tasks.some(t => !/^[\w-]+$/.test(t.name))) throw Error('Select nonempty, uniquely named test tasks.');
  mkdirSync(output, { recursive: true });
  const records = [];
  const summary = () => ({ selection, records: records.map(({ stdout, stderr, ...r }) => r), not_run: tasks.slice(records.length).map(t => t.name) });
  // An explicit output directory must not erase a previous failed or passed run.
  writeFileSync(join(output, 'results.json'), JSON.stringify(summary(), null, 2) + '\n', { flag: 'wx' });
  for (const task of tasks) {
    const start = Date.now(); let stdout = '', stderr = '', signal = null;
    const exit = await new Promise(done => {
      const child = spawn(task.command[0], task.command.slice(1), { cwd, env, windowsHide: true });
      child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
      child.on('error', e => stderr += String(e));
      child.on('close', (code, stoppedBy) => { signal = stoppedBy; done(code); });
    });
    const result = { name: task.name, command: task.command, exit, signal, elapsed_ms: Date.now() - start, stdout, stderr };
    writeFileSync(join(output, `${task.name}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    records.push(result);
    writeFileSync(join(output, 'results.json'), JSON.stringify(summary(), null, 2) + '\n');
    log(`${exit === 0 ? 'PASS' : 'FAIL'} ${task.name} (${result.elapsed_ms} ms)`);
    if (exit !== 0) {
      error((stdout + stderr).slice(-4000));
      if (failFast || task.stopOnFailure) break;
    }
  }
  const failed = records.filter(r => r.exit !== 0).length;
  const result = { ...summary(), exit: failed || records.length !== tasks.length ? 1 : 0 };
  writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  log(`${records.length - failed}/${tasks.length} passed; ${result.not_run.length} not run; logs: ${output}`);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const suites = JSON.parse(readFileSync(join(root, 'scripts/core-test-suites.json'), 'utf8'));
  const options = selectSuites(suites, argv);
  if (options.list) { for (const [, file] of options.selected) console.log(`${suiteName(file)}\t${file}`); return 0; }
  const env = { ...process.env, AIDLC_TEST_PYTHON: testPython(), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', AIDLC_EXPORT_PROJECT: '', AIDLC_EXPORT_HOST_PROVIDER: '', AIDLC_DOCX_PROJECT: '', AIDLC_DOCX_HOST_PROVIDER: '' };
  const tasks = [{ name: 'build', command: [process.execPath, '--import', 'tsx', 'scripts/build.ts', '--all'], stopOnFailure: true }];
  for (const [engine, file, ...args] of options.selected) {
    if (!['tsx', 'node', 'python'].includes(engine)) throw Error('Unexpected suite engine');
    tasks.push({ name: suiteName(file), command: engine === 'python' ? [env.AIDLC_TEST_PYTHON, file, ...args] : [process.execPath, ...(engine === 'tsx' ? ['--import', 'tsx'] : []), file, ...args] });
  }
  const selection = { scope: options.scope, suites: options.selected.map(([, file]) => suiteName(file)), available: options.available };
  console.log(`${options.scope === 'full' ? 'Full suite' : 'Selected suites only'}: ${selection.suites.length}/${options.available}; fail-fast: ${options.failFast}`);
  const output = process.env.AIDLC_TEST_OUTPUT ? resolve(process.env.AIDLC_TEST_OUTPUT) : mkdtempSync(join(tmpdir(), 'aidlc-current-tests-'));
  return (await runTests({ tasks, cwd: root, output, env, failFast: options.failFast, selection })).exit;
}

export async function cli() {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
