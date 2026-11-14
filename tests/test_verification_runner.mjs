import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { selectSuites, runTests } from '../scripts/test-current.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc verification '));
const catalog = [['node', 'tests/first.mjs'], ['node', 'tests/second.mjs']];
const task = (name, code, extra = {}) => ({ name, command: [process.execPath, '-e', code], ...extra });
const quiet = { log() {}, error() {} };
try {
  assert.deepEqual(selectSuites(catalog, []).selected, catalog, 'default still includes every suite');
  assert.equal(selectSuites(catalog, []).failFast, false, 'independent full-suite checks still run by default');
  const selected = selectSuites(catalog, ['--suite', 'second', '--suite', 'second', '--fail-fast']);
  assert.deepEqual(selected.selected, [catalog[1]]); assert.equal(selected.scope, 'selected'); assert.equal(selected.available, 2); assert(selected.failFast);
  for (const args of [['--suite', 'missing'], ['--suite'], ['--suite', '--fail-fast'], ['--unknown']]) assert.throws(() => selectSuites(catalog, args));
  assert.throws(() => selectSuites([], []), /empty run/);

  const failing = task('first', 'process.stdout.write("ORIGINAL_FAILURE:" + "x".repeat(5000));process.exitCode=7');
  const subsequent = task('second', 'require("node:fs").writeFileSync("second-ran", "yes")');
  const fastOutput = path.join(root, 'fast');
  const fast = await runTests({ tasks: [failing, subsequent], cwd: root, output: fastOutput, failFast: true, selection: { scope: 'selected', available: 9, suites: ['first', 'second'] }, ...quiet });
  assert.equal(fast.exit, 1); assert.equal(fast.records[0].exit, 7);
  assert.deepEqual(fast.not_run, ['second']); assert(!fs.existsSync(path.join(root, 'second-ran')));
  const raw = fs.readFileSync(path.join(fastOutput, 'first.json'));
  assert(JSON.parse(raw).stdout.startsWith('ORIGINAL_FAILURE:')); assert(JSON.parse(raw).stdout.length > 5000, 'full failure output survives console tail');
  const fastSummary = JSON.parse(fs.readFileSync(path.join(fastOutput, 'results.json')));
  assert.equal(fastSummary.exit, 1); assert.equal(fastSummary.selection.scope, 'selected'); assert.deepEqual(fastSummary.not_run, ['second']);
  await assert.rejects(runTests({ tasks: [subsequent], cwd: root, output: fastOutput, ...quiet }), /EEXIST/);
  assert.deepEqual(fs.readFileSync(path.join(fastOutput, 'first.json')), raw, 'retry must preserve original evidence');
  assert(!fs.existsSync(path.join(root, 'second-ran')), 'output reuse must fail before executing tasks');

  const normal = await runTests({ tasks: [failing, subsequent], cwd: root, output: path.join(root, 'normal'), ...quiet });
  assert.equal(normal.exit, 1); assert.equal(normal.records.length, 2); assert.deepEqual(normal.not_run, []);
  assert(fs.existsSync(path.join(root, 'second-ran')), 'an independent check still runs without fail-fast');
  const buildFail = await runTests({ tasks: [{ ...failing, name: 'build', stopOnFailure: true }, task('blocked', 'throw Error("must not run")')], cwd: root, output: path.join(root, 'build-fail'), ...quiet });
  assert.deepEqual(buildFail.not_run, ['blocked']); assert.equal(buildFail.exit, 1);
  const missing = await runTests({ tasks: [{ name: 'missing', command: [path.join(root, 'no-such-executable')] }, subsequent], cwd: root, output: path.join(root, 'missing'), failFast: true, ...quiet });
  assert.equal(missing.exit, 1); assert.notEqual(missing.records[0].exit, 0); assert.deepEqual(missing.not_run, ['second']);
  const pass = await runTests({ tasks: [task('one', 'console.log("actual pass")')], cwd: root, output: path.join(root, 'pass'), selection: { scope: 'selected', available: 9, suites: ['one'] }, ...quiet });
  assert.equal(pass.exit, 0); assert.equal(pass.selection.scope, 'selected'); assert.equal(pass.selection.available, 9);
  await assert.rejects(runTests({ tasks: [], cwd: root, output: path.join(root, 'empty'), ...quiet }), /nonempty/);
  assert(!fs.existsSync(path.join(root, 'empty')));

  const listed = spawnSync(process.execPath, ['scripts/test-core.mjs', '--list'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_TEST_PYTHON: path.join(root, 'missing-python') } });
  assert.equal(listed.status, 0, listed.stderr); assert(listed.stdout.includes('test_verification_runner'));
  const bad = spawnSync(process.execPath, ['scripts/test-core.mjs', '--suite', 'not-a-suite'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 1); assert(bad.stderr.includes('Unknown suite')); assert(!bad.stdout.includes('PASS'));
  console.log('PASS verification runner: exact selection, owned short-run stop, independent checks, truthful not-run results, original evidence preservation and empty/invalid-run rejection');
} finally {
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true, force: true });
}
