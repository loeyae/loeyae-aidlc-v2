import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { replayConfigPath, captureReplaySource, parseReplayReport, replayEvidenceErrors, runHistoricalReplay } from '../core/tools/aidlc-historical-red';
import { createInitialState } from '../core/tools/aidlc-light-state';
import { readSourceRevision } from '../core/tools/aidlc-revision';
import { saveFixtureState, fixtureEnvironment } from './mars243_fixture_session';
import { createHash } from 'node:crypto';

const root = mkdtempSync(join(tmpdir(), 'aidlc-historical-red-'));
const git = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
git('remote', 'add', 'origin', 'https://example.invalid/replay-fixture.git');
writeFileSync(join(root, 'test.ts'), 'assert.equal(actual, expected)');
writeFileSync(join(root, 'package-lock.json'), '{}');
writeFileSync(join(root, 'vitest.config.ts'), 'export default {}');
git('add', '.'); git('commit', '-qm', 'tests before implementation');
const before = git('rev-parse', 'HEAD');
writeFileSync(join(root, 'impl.ts'), 'export const implementation = true');
git('add', '.'); git('commit', '-qm', 'implementation');
const implementation = git('rev-parse', 'HEAD');
const worktree = join(root, 'history');
git('worktree', 'add', '--no-checkout', '--detach', worktree, before);
const wg = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: worktree, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
};
wg('sparse-checkout', 'set', '--no-cone', '/*'); wg('checkout', '--detach', before);
mkdirSync(join(worktree, 'node_modules'), { recursive: true });
writeFileSync(join(worktree, 'node_modules', 'fixture.txt'), 'dependency bytes');
// Ignored dependencies are permitted; arbitrary untracked source is not.
writeFileSync(join(root, '.git', 'info', 'exclude'), 'history/\nnode_modules/\n');
const config: any = { repository: root, worktree, pre_implementation_commit: before, implementation_commit: implementation };
const snapshot = captureReplaySource(config);
assert.equal(snapshot.commit, before);
assert.throws(() => captureReplaySource({ ...config, pre_implementation_commit: implementation }), /HEAD|pre.implementation/);
assert.throws(() => captureReplaySource({ ...config, implementation_commit: before }), /strict ancestor/);
const greenTree = join(root, 'green-history');
git('worktree', 'add', '--no-checkout', '--detach', greenTree, implementation);
git('-C', greenTree, 'sparse-checkout', 'set', '--no-cone', '/*');
git('-C', greenTree, 'checkout', '--detach', implementation);
assert.throws(() => captureReplaySource({ ...config, worktree:greenTree, pre_implementation_commit:implementation }), /strict ancestor/);
const unrelated = git('commit-tree', '-m', 'unrelated lineage', git('rev-parse', 'HEAD^{tree}'));
assert.throws(() => captureReplaySource({ ...config, implementation_commit: unrelated }), /merge-base/);
writeFileSync(join(worktree, 'test.ts'), 'changed');
assert.throws(() => captureReplaySource(config), /dirty|modified|mismatch/);
writeFileSync(join(worktree, 'test.ts'), 'assert.equal(actual, expected)');
wg('update-index', '--assume-unchanged', 'test.ts');
writeFileSync(join(worktree, 'test.ts'), 'hidden modification');
assert.throws(() => captureReplaySource(config), /mismatch/);
writeFileSync(join(worktree, 'test.ts'), 'assert.equal(actual, expected)');
wg('update-index', '--no-assume-unchanged', 'test.ts');
writeFileSync(join(worktree, 'undeclared.ts'), 'changed');
assert.throws(() => captureReplaySource(config), /dirty|untracked/);
unlinkSync(join(worktree, 'undeclared.ts'));

const report: any = { numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0, numRuntimeErrorTestSuites: 0, testResults: [{ name: join(worktree, 'test.ts'), assertionResults: [
  { fullName: 'UC-D-001 behavior', status: 'failed', failureMessages: ['AssertionError: expected true to be false'] },
  { fullName: 'UC-D-001 other behavior', status: 'passed', failureMessages: [] },
] }] };
const parsed = parseReplayReport(report, ['UC-D-001'], worktree);
assert.equal(parsed.tests_failed, 1); assert.equal(parsed.tests_total, 2);
for (const changed of [
  { numPendingTests: 1 }, { numTotalTests: 0 }, { numRuntimeErrorTestSuites: 1 }, { numFailedTests: 0 },
  { testResults: [] },
  { testResults: [{ name: join(worktree, 'test.ts'), assertionResults: [{ fullName: 'UC-D-001 behavior', status: 'failed', failureMessages: ['Error: Cannot find module'] }] }] },
]) assert.throws(() => parseReplayReport({ ...report, ...changed }, ['UC-D-001'], worktree));
assert.throws(() => parseReplayReport(report, ['UC-D-002'], worktree), /mapping/);
assert.throws(() => parseReplayReport({ ...report, numFailedTests:0, numPassedTests:2, testResults:[{ name:join(worktree,'test.ts'), assertionResults:report.testResults[0].assertionResults.map((t:any)=>({...t,status:'passed',failureMessages:[]})) }] }, ['UC-D-001'], worktree), /GREEN/);
assert.throws(() => parseReplayReport({ ...report, testResults:[{ name:join(worktree,'test.ts'), message:'Transform failed', assertionResults:report.testResults[0].assertionResults }] }, ['UC-D-001'], worktree), /compilation/);
assert.notEqual(replayConfigPath(root, 'workflow', 'module', 'u8'), replayConfigPath(root, 'workflow', 'module', 'u9'));
assert.ok(replayEvidenceErrors(root, {}, { workflow_id: 'workflow', module_id: 'module', unit_id: 'u8' }, {}, ['UC-D-001']).length);

// Adapter fixture executes a real node assertion in the controlled child process.
// Production U8 validation uses installed Vitest, independently of this protocol fixture.
mkdirSync(join(worktree, 'node_modules', 'vitest'), { recursive: true });
writeFileSync(join(worktree, 'node_modules', 'vitest', 'vitest.mjs'), `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
let failure; try { assert.equal(true, false); } catch(e) { failure = e; }
const output = process.argv.find(x => x.startsWith('--outputFile=')).slice('--outputFile='.length);
const reporter = process.argv.find(x => x.startsWith('--reporter=') && x !== '--reporter=json').slice('--reporter='.length);
const Reporter = (await import(pathToFileURL(reporter).href)).default;
new Reporter().onFinished([], []);
writeFileSync(output, JSON.stringify({ numTotalTests:1, numPassedTests:0, numFailedTests:1, numPendingTests:0, numTodoTests:0,
testResults:[{ name:resolve('test.ts'), assertionResults:[{ fullName:'UC-D-001 behavior', status:'failed', failureMessages:[String(failure)] }] }] }));
process.exitCode=1;
`);
const control = join(root, 'control'); mkdirSync(control);
const cg = (...args: string[]) => { const r = spawnSync('git', args, { cwd: control, encoding:'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
cg('init','-q'); cg('config','user.name','fixture'); cg('config','user.email','fixture@example.invalid');
writeFileSync(join(control, 'README.md'), 'controlled workflow'); cg('add','.'); cg('commit','-qm','workflow');
const requirements = join(control, 'docs/aidlc/modules/project/inception'); mkdirSync(requirements, { recursive:true });
writeFileSync(join(requirements, 'requirements.md'), 'REQ-1 new behavior');
const identity = { workflow_id:'workflow-replay', module_id:'project', unit_id:'default' };
const configPath = replayConfigPath(control, identity.workflow_id, identity.module_id, identity.unit_id);
mkdirSync(dirname(configPath), { recursive:true });
const scopedConfig = { version:'1', mode:'historical_replay', ...identity, ...config, config_file:'vitest.config.ts',
  argv:[process.execPath,'node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','--maxWorkers=1','--no-cache'] };
writeFileSync(configPath, JSON.stringify(scopedConfig));
const i13: any = { status:'required', ucd_ids:['UC-D-001'], ucd_units:{ 'UC-D-001':['default'] },
  evidence_version:'1', timestamp:new Date().toISOString(), stage_instance:'test-case-derivation@module:project', module_id:'project', unit_id:null,
  producer:{name:'loeyae-aidlc-evidence', mode:'controlled', execution_id:'fixture-i13'}, source_revision:readSourceRevision(control),
  checker:{ id:'builtin:test-case-derivation', sensor:'test-case-derivation', argv_digest:'a'.repeat(64), status:'passed', exit_code:0 } };
const i13Path = join(control,'.aidlc/evidence/test-case-derivation/project/test-case-derivation.json'); mkdirSync(dirname(i13Path),{recursive:true}); writeFileSync(i13Path,JSON.stringify(i13));
const output = join(control,'.aidlc/evidence/tdd/project/default/red-test-evidence.json');
const state = createInitialState('express', '4.22.17', identity.workflow_id, [], 'recover RED');
state.current_stage='code-generation'; state.current_stage_instance='code-generation@module:project@unit:default'; state.current_module='project'; state.current_unit='default';
state.completed_stages=['test-case-derivation','tdd']; state.completed_stage_instances=['test-case-derivation@module:project','tdd@module:project@unit:default'];
saveFixtureState(control,state);
const cliArgs=['evidence','run','--stage','tdd','--module','project','--unit','default','--sensor','red-test-evidence','--refresh','--historical-replay'];
// Bind only the current implementation instance; replay cannot take upstream/sibling claims.
const env=fixtureEnvironment(control,['evidence','run','--stage','code-generation']);
const repo=resolve(import.meta.dirname,'..'); const tsx=join(repo,'node_modules/tsx/dist/cli.mjs'); const cli=join(repo,'bin/cli.ts');
const invoke=(args=cliArgs, childEnv=env) => spawnSync(process.execPath,[tsx,cli,...args],{cwd:control,encoding:'utf8',env:childEnv});
const noSession=invoke(cliArgs,{...env,AIDLC_SESSION_BINDING:''}); assert.notEqual(noSession.status,0);
const wrongSession=invoke(cliArgs,{...env,AIDLC_SESSION_BINDING:JSON.stringify({...JSON.parse(env.AIDLC_SESSION_BINDING!),session_id:'other'})}); assert.notEqual(wrongSession.status,0);
const result=invoke(); assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
const evidence=JSON.parse(readFileSync(output,'utf8'));
assert.equal(evidence.evidence_mode,'historical_replay');
assert.equal(evidence.historical_replay.source.inputs,undefined,'large source inventories belong in digest-bound sidecars');
assert.ok(readFileSync(output).length < 524288,'canonical evidence fits the unchanged normal gate limit');
assert.deepEqual(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']),[]);
const runtimeEntry = evidence.historical_replay.reports.find((r:any)=>r.path.endsWith('runtime-errors.json'));
const runtimeOriginal = readFileSync(runtimeEntry.path);
writeFileSync(runtimeEntry.path,JSON.stringify({completed:true,unhandled_errors:[{message:'Cannot find module'}],suite_errors:[]}));
const withRuntimeError=structuredClone(evidence);
withRuntimeError.historical_replay.reports.find((r:any)=>r.path===runtimeEntry.path).sha256=createHash('sha256').update(readFileSync(runtimeEntry.path)).digest('hex');
assert.match(replayEvidenceErrors(control,withRuntimeError,identity,i13,['UC-D-001']).join(),/unhandled runtime/);
writeFileSync(runtimeEntry.path,runtimeOriginal);
const gate = spawnSync(process.execPath,[tsx,join(repo,'tests/gate_probe.ts'),'tdd@module:project@unit:default','sensors','red-test-evidence','--drift'],{cwd:control,encoding:'utf8',env});
assert.equal(gate.status,0,`${gate.stdout}\n${gate.stderr}`);
assert.deepEqual(JSON.parse(gate.stdout.trim()).failures,[],gate.stdout);
const originalEvidence=readFileSync(output);
writeFileSync(output,JSON.stringify({...evidence,evidence_mode:'diagnostic'}));
const diagnosticGate=spawnSync(process.execPath,[tsx,join(repo,'tests/gate_probe.ts'),'tdd@module:project@unit:default','sensors','red-test-evidence','--drift'],{cwd:control,encoding:'utf8',env});
assert.match(diagnosticGate.stdout,/diagnostics are not controlled phase evidence/);
writeFileSync(output,originalEvidence);
assert.throws(()=>captureReplaySource({...config,repository:control}),/different repository/);
writeFileSync(join(worktree,'vitest.config.ts'),'export default { changed:true }');
assert.match(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']).join(),/dirty|mismatch/);
writeFileSync(join(worktree,'vitest.config.ts'),'export default {}');
assert.throws(()=>runHistoricalReplay(control,identity,i13,['UC-D-001'],output),/must be missing/);
assert.ok(replayEvidenceErrors(control,evidence,{...identity,unit_id:'other'},i13,['UC-D-001']).length);
assert.ok(replayEvidenceErrors(control,evidence,identity,{...i13,ucd_ids:['UC-D-002']},['UC-D-002']).length);
for(const [key,value] of [['config_sha256','f'.repeat(64)],['source',{...evidence.historical_replay.source,inputs_digest:'f'.repeat(64)}]] as const) {
  const altered=structuredClone(evidence); altered.historical_replay[key]=value;
  assert.ok(replayEvidenceErrors(control,altered,identity,i13,['UC-D-001']).length);
}
writeFileSync(join(requirements,'requirements.md'),'REQ-1 changed behavior');
assert.match(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']).join(),/requirements changed/);
writeFileSync(join(requirements,'requirements.md'),'REQ-1 new behavior');
writeFileSync(join(worktree,'node_modules/fixture.txt'),'dependency drift');
assert.match(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']).join(),/digest mismatch/);
writeFileSync(join(worktree,'node_modules/fixture.txt'),'dependency bytes');
const configBytes=readFileSync(configPath); writeFileSync(configPath,JSON.stringify({...scopedConfig,module_id:'wrong'}));
assert.match(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']).join(),/wrong module_id/); writeFileSync(configPath,configBytes);
// Scoped replay declarations never rewrite the stage-level allowlist or sibling evidence.
const globalPath=join(control,'.aidlc/commands/tdd.json'); writeFileSync(globalPath,JSON.stringify({version:'1',stage:'tdd',commands:[{id:'other-red',role:'red',argv:['node','other.js']}]}));
const globalHash=createHash('sha256').update(readFileSync(globalPath)).digest('hex');
assert.deepEqual(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']),[]);
assert.equal(createHash('sha256').update(readFileSync(globalPath)).digest('hex'),globalHash);
const sibling = join(control,'.aidlc/evidence/tdd/project/other/red-test-evidence.json'); mkdirSync(dirname(sibling),{recursive:true}); writeFileSync(sibling,'unchanged sibling evidence');
const siblingBytes=readFileSync(sibling);
assert.deepEqual(replayEvidenceErrors(control,evidence,identity,i13,['UC-D-001']),[]);
assert.deepEqual(readFileSync(sibling),siblingBytes);
const previousBytes=readFileSync(output);
const refreshedRun=invoke(); assert.equal(refreshedRun.status,0,`${refreshedRun.stdout}\n${refreshedRun.stderr}`);
const refreshed=JSON.parse(readFileSync(output,'utf8'));
assert.equal(refreshed.historical_replay.version,'2');
assert.deepEqual(readFileSync(refreshed.historical_replay.supersedes.path),previousBytes,'formal refresh retains previous replay verbatim');
assert.deepEqual(replayEvidenceErrors(control,refreshed,identity,i13,['UC-D-001']),[]);
const refreshedBytes=readFileSync(output);
writeFileSync(output,JSON.stringify({...refreshed,evidence_mode:'original'}));
const originalRefusal=invoke(); assert.notEqual(originalRefusal.status,0); assert.match(originalRefusal.stderr,/original RED or diagnostic/);
writeFileSync(output,refreshedBytes);
console.log('historical RED producer/session, source, assertions, mapping, drift and isolation regressions passed');
