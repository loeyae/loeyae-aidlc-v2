const fs = require('fs'), path = require('path'), cp = require('child_process');
const crypto = require('crypto'), assert = require('assert/strict');
const dir = 'docs/evals/autonomy/p1-07';
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`
  : JSON.stringify(v);
const digest = v => crypto.createHash('sha256').update(canonical(v)).digest('hex');
const tests = JSON.parse(fs.readFileSync(dir + '/test-results.json'));
assert.equal(tests.length, 21);
const finalPath = dir + '/test-results-final-3.json';
const finals = [...JSON.parse(fs.readFileSync(dir + '/test-results-final-4.json')), ...JSON.parse(fs.readFileSync(finalPath))];
for (const t of tests) {
  const final = finals.find(r => r.name === t.name);
  if (final) Object.assign(t, final);
  assert.equal(t.exit_code, 0, t.name);
  t.log_sha256 = sha(t.log);
}
const samples = [];
const finalChecker = JSON.parse(fs.readFileSync(dir + '/checker-identity-final.json'));
for (const name of ['orders-actual', 'publish-actual', 'runtime-actual', 'external-actual', 'external-preflight-actual']) {
  const base = dir + '/' + name;
  const receipt = JSON.parse(fs.readFileSync(base + '/receipt.json'));
  const {issuer_provenance: proof, ...body} = receipt;
  const key = JSON.parse(fs.readFileSync(base + '/fixture-public-key.json'));
  assert.equal(proof.key_id, key.key_id);
  assert.equal(proof.algorithm, 'ed25519');
  assert(crypto.verify(null, Buffer.from(canonical(body)), key.public_key, Buffer.from(proof.signature, 'base64')));
  assert.equal(body.schema, 'aidlc.observation-bundle/v1');
  assert.equal(body.checker_digest, finalChecker.checker_digest);
  assert.deepEqual(Object.keys(key).sort(), ['key_id','public_key']);
  assert.equal(body.status, body.coverage === 'matrix' ? 'passed' : 'partial'); assert.equal(body.business_verified, false);
  assert.equal(body.candidate_ref.candidate_id, digest({repositories:body.candidate_ref.repositories, artifacts:body.candidate_ref.artifacts}));
  assert(body.observations.every(o => o.status === 'passed' && canonical(o.candidate_ref) === canonical(body.candidate_ref)));
  const manifest = JSON.parse(fs.readFileSync(base + '/manifest.json'));
  assert.equal(manifest.kind, 'isolated-fixture-engineering-observation');
  for (const r of body.raw_refs) {
    const saved = manifest.raw_files.find(m => m.path === r.path && m.digest === r.digest);
    assert(saved); assert.equal(sha(base + '/' + saved.saved_path), r.digest);
  }
  for (const r of [...body.source_refs, ...body.candidate_ref.artifacts]) assert.equal(sha(base + '/source/' + r.path), r.digest, r.path);
  const ui = body.observations.filter(o => o.kind === 'ui');
  for (const o of ui) {
    const saved = manifest.raw_files.find(m => m.path === o.raw_output_ref.path);
    const raw = JSON.parse(fs.readFileSync(base + '/' + saved.saved_path));
    assert.equal(raw.visual.passed, true); assert(raw.visual.regions.length > 0);
    assert(raw.visual.regions.every(r => r.passed));
  }
  samples.push({name, status_at_observation:body.status, actual_checks:body.observations.length, ui_combinations:ui.length,
    candidate_ref:body.candidate_ref, signature_verified:true, source_and_raw_hashes_verified:true,
    archived_fixture_authority:true, business_verified:false, receipt_sha256:sha(base + '/receipt.json'), manifest_sha256:sha(base + '/manifest.json')});
}
const builds = JSON.parse(fs.readFileSync(dir + '/build-results-final.json','utf8').replace(/^\uFEFF/,''));
assert.equal(builds.length, 10); for (const b of builds) {assert.equal(b.exit_code, 0, b.harness); b.log_sha256 = sha(b.log);}
const parity = JSON.parse(fs.readFileSync(dir + '/parity-result.json')); assert.equal(parity.exit_code, 0); parity.log_sha256 = sha(parity.log);
const additional = JSON.parse(fs.readFileSync(dir + '/additional-check-results.json'));
for(const c of additional){assert.equal(c.exit_code,0,c.name);c.log_sha256=sha(c.log);}
const inspection=JSON.parse(fs.readFileSync(dir+'/public-inspect-final.json'));
assert.equal(inspection.autonomous_observations.status,'unverified');assert.equal(inspection.autonomous_observations.business_verified,false);
const state = 'aidlc/active/aidlc-state.md', audit = 'aidlc/active/audit.md';
assert.equal(sha(state), '5e08e34d2e434edf0ab7d2667377080dc0caf06dd8dcfa178b877211c5c93d0f');
assert.equal(sha(audit), '1fa99dba9594b7ee1e2e7ad0d8e72c9b81b87e74f9577879795937b0af998686');
const absent = ['.git/aidlc/autonomy', '.aidlc/autonomy/grants', '.aidlc/evidence/autonomous-admission', '.aidlc/evidence/native-host', '.aidlc/evidence/autonomous-observations', '.aidlc/host-runs'];
for (const p of absent) assert(!fs.existsSync(p), p);
const sources = ['core/tools/aidlc-observations.ts', 'core/tools/aidlc-observation-inputs.ts', 'core/tools/aidlc-observation-browser.ts', 'core/tools/aidlc-observation-live.ts',
  'core/tools/aidlc-autonomy.ts', 'core/tools/aidlc-autonomy-dependencies.ts', 'core/tools/aidlc-grant-store.ts', 'core/tools/aidlc-orchestrate.ts',
  'harness/codex/runtime/aidlc-codex-host.mjs', 'harness/codex/runtime/host-kernel.cjs', 'harness/codex/README.md', 'bin/cli.ts', 'package.json', 'scripts/core-test-suites.json',
  'tests/helpers/observation-fixture.ts', 'tests/test_observations.ts', 'tests/test_observation_ui.ts', 'tests/test_runtime_observations.ts', 'tests/test_native_host_driver.ts',
  'core/knowledge/protocols/common-session-handoff.md', 'core/knowledge/protocols/common-step-completion-protocol.md',
  'core/knowledge/standards/common-runtime-dependency-analysis.md', 'core/knowledge/standards/common-requirement-integrity.md',
  'core/stages/construction/construction-build-and-test.md', 'core/stages/construction/construction-code-review.md',
  'docs/aidlc-autonomous-contracts-v1.md', 'docs/aidlc-autonomous-implementation-design.md', 'docs/aidlc-autonomous-implementation-p1.md',
  'docs/loeyae-aidlc-cli-guide.md', dir + '/README.md', dir + '/code-review.md'];
fs.writeFileSync(dir + '/verification.json', JSON.stringify({task:'P1-07', kind:'engineering-and-actual-observation-verification', verified_at:new Date().toISOString(),
  source_head:cp.execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), controlled_business_evidence:false,
  source_sha256:Object.fromEntries(sources.map(p => [p, sha(p)])), checker_identity:finalChecker, tests, samples, builds, additional_checks:additional, distribution_parity:parity,
  preserved_workflow:{state_sha256:sha(state), audit_sha256:sha(audit), authority_and_host_directories_absent:absent},
  limits:['Protocol authority/reception is simulated; actual local Node/HTTP/Chrome behavior is separately observed',
    'Sample receipts are archived isolated-fixture records, not current project grants, fresh runtime leases or formal business approval',
    'No full npm test, final business batch, complete unattended pilot, P2 restart or successor recovery',
    'P1-08 final candidate/Native/decision/acceptance convergence remains separate; all observations keep business_verified=false',
    'One local Chrome browser path exercised; other hosts and native UI platforms require their own adapters',
    'Frozen trusted command footprint and isolated endpoints are reviewed contracts, not arbitrary shell or OS/network confinement']}, null, 2) + '\n');
console.log('P1-07 sealed: 21 passing checks, actual signed/hashed function/HTTP/UI snapshots, 10 builds; unrelated workflow unchanged.');
