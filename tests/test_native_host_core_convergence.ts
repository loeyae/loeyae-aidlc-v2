/** Engineering integration: seeded reviewer/model, actual public CLI, Native commands and observations.
 * This is never a real Codex pilot, human approval or business-delivery result. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { batchFixture } from './helpers/batch-fixture';
import { coreResponse, driveBatch, Gateway, modelProjection } from '../harness/codex/runtime/aidlc-codex-host.mjs';
const K = createRequire(import.meta.url)('../harness/codex/runtime/host-kernel.cjs');
const repository = resolve(import.meta.dirname, '..'), inherited = { ...process.env };
const scratch = mkdtempSync(join(tmpdir(), 'aidlc-host-core-convergence-'));
let f: any, gateway: any;
try {
  f = await batchFixture(scratch, 'actual-public-cli', {
    beforeC8: true,
    // Match the real pilot envelope and the existing IT-07 pipeline. A 300s
    // fixture admission cannot cover the Native 610s command window.
    configure(_plan: any, _fixture: any, admission: any) { admission.lifetime_seconds = 900; },
    configureRequest(fixture: any) {
      fixture.request.lifetime_seconds = 3600; fixture.request.resource_limits.wall_time_seconds = 3600;
      const observe = fixture.adapter.observe;
      fixture.adapter.observe = (challenge: any) => {
        const observation = observe(challenge);
        return { ...observation, valid_until: new Date(Date.parse(observation.observed_at) + 900000).toISOString() };
      };
    },
  });
  assert.equal(existsSync(join(f.root, '.aidlc/evidence/code-review/orders/publish/ui-design-alignment.json')), false,
    'non-UI convergence must exercise the real absence of UI evidence');
  process.env.AIDLC_COORDINATOR_BINDING = f.coordinator;
  // The helper retains this original claim in memory after producing C7.
  // Enter with that held binding; never reconstruct it from state/context.
  f.bind('code-review@module:orders@unit:publish');
  const packets: any[] = [];
  const core = async (args: string[]) => {
    const result = await K.command([process.execPath, join(repository, 'node_modules/tsx/dist/cli.mjs'), join(repository, 'bin/cli.ts'), ...args], {
      cwd: f.root, env: process.env, timeout_ms: 120000,
    });
    const response = coreResponse(result, args);
    packets.push({ args, response: modelProjection(response) });
    return response;
  };
  const selected = await core(['orchestrate', 'autonomy', 'host', 'select', '--instance', 'code-review@module:orders@unit:publish']);
  process.env.AIDLC_SESSION_BINDING = JSON.stringify(selected.host_context.binding);
  const empty = await core(['orchestrate', 'next', '--preview']);
  assert.equal(empty.kind, 'print');
  assert.equal(empty.preview, true);
  assert.equal(empty.next_stage_status, 'none');
  assert.equal(empty.stage_instance, null);
  console.log('PASS actual public CLI emits an empty local preview after C7, without scope-exhausted');

  // Review completion is a downstream artifact, not an executed code/test input.
  // A real delivery-input change remains a stop, exercised by --changed-input.
  const changedInput = process.argv.includes('--changed-input');
  const changedPath = changedInput ? 'delivery/candidate.txt' : 'docs/aidlc/modules/orders/construction/publish/code-review.md';
  writeFileSync(join(f.root, changedPath), readFileSync(join(f.root, changedPath), 'utf8') + '\nEngineering downstream note.\n');
  f.commit();
  await f.restart();
  process.env.AIDLC_SESSION_BINDING = f.coordinator;
  assert.notEqual(f.run().admission_result, 'not-ready');
  f.bind('code-review@module:orders@unit:publish');
  const context = (await core(['orchestrate', 'autonomy', 'host', 'context'])).host_context;
  context.coordinator_binding = JSON.parse(f.coordinator);
  const config = { core_cli: join(repository, 'bin/cli.ts'), commands: [], observation_plan: 'fixtures/observation-plan.json', admission_plan: f.planPath };
  gateway = new Gateway(config, f.root, context, core);
  const red = readFileSync(join(f.root, '.aidlc/evidence/tdd/orders/publish/red-test-evidence.json'));
  const green = readFileSync(join(f.root, '.aidlc/evidence/code-generation/orders/publish/green-test-evidence.json'));
  const tests = readFileSync(join(f.root, 'tests/orders-native.cjs'));
  let turns = 0;
  const client = {
    event() {},
    async turn(_text: string) {
      turns++;
      assert.ok(turns <= 1, 'host must resolve deterministic metadata through Core, without model repair loops');
      assert.equal(gateway.readyInstance, 'build-and-test');
      await gateway.invoke({ action: 'core', args: ['evidence', 'run', '--stage', 'build-and-test', '--all-sensors'] });
      await gateway.invoke({ action: 'core', args: ['orchestrate', 'report', '--stage', 'build-and-test', '--result', 'completed', '--instruction-ack', 'build-and-test'] });
      return { status: 'completed' };
    },
  };
  const verdict = await driveBatch(config, context, core, client, gateway);
  assert.equal(verdict, changedInput ? 'formal-route-blocked' : 'batch-verified', JSON.stringify(packets.slice(-3).map(p => ({ args: p.args, kind: p.response.kind, stage: p.response.stage, message: p.response.message, repair: p.response.repair_diagnostics, checks: p.response.autonomous_batch_result?.checks?.filter((c: any) => !['passed', 'not-required', 'not-applicable'].includes(c.status)), native: p.response.autonomous_batch_result?.native?.failures }))));
  assert.equal(turns, changedInput ? 0 : 1);
  assert.ok(packets.every(p => !(p.response.repair_diagnostics || []).some((d: any) =>
    d.sensor === 'ui-design-alignment' || d.sensor === 'reviewer-required' && /ui-design-alignment/.test(d.message))),
  'C8 must retain the report runtime contract and never invent UI work for this non-UI unit');
  const repairs = packets.filter(p => p.args[0] === 'evidence' && p.args.includes('code-generation'));
  if (changedInput) assert.equal(repairs.length, 0, 'changed phase input cannot be masked by repairing semantics');
  else assert.ok(repairs.some(p => p.args.includes('--sensors')), 'only failed derivations are batched');
  assert.ok(repairs.every(p => !p.args.includes('--all-sensors')));
  assert.deepEqual(readFileSync(join(f.root, '.aidlc/evidence/code-generation/orders/publish/green-test-evidence.json')), green, 'metadata repair never reruns successful GREEN');
  assert.deepEqual(readFileSync(join(f.root, '.aidlc/evidence/tdd/orders/publish/red-test-evidence.json')), red);
  assert.deepEqual(readFileSync(join(f.root, 'tests/orders-native.cjs')), tests);
  assert.equal(f.current().completed_stage_instances.includes('build-and-test'), !changedInput);
  if (process.env.AIDLC_EVAL_DIR) writeFileSync(join(process.env.AIDLC_EVAL_DIR, 'native-host-public-core-packets.json'), JSON.stringify({ kind: 'engineering-public-cli-integration', business_verified: false, model: 'seeded-engineering-callback', packets }, null, 2) + '\n');
  console.log(changedInput ? 'PASS changed execution input stops without model/phase retries' : 'PASS non-UI real CLI C7 to C8 and signed convergence; targeted repair preserves RED/GREEN/tests; engineering only');
} finally {
  gateway?.cancel('engineering-complete');
  await gateway?.reconcile();
  if (f?.child?.exitCode === null) { const closed = new Promise(r => f.child.once('close', r)); f.child.kill(); await closed; }
  for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
  Object.assign(process.env, inherited);
  assert.equal(resolve(dirname(scratch)), resolve(tmpdir()));
  rmSync(scratch, { recursive: true, force: true });
}
