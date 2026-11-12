const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict');
const dir='docs/evals/autonomy/p1-08';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`:JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const signed=(p,key,schema)=>{const {issuer_provenance:proof,...body}=read(p);assert.equal(proof.key_id,key.key_id);assert.equal(proof.algorithm,'ed25519');assert(crypto.verify(null,Buffer.from(canonical(body)),key.public_key,Buffer.from(proof.signature,'base64')),p);assert.equal(body.schema,schema);return body;};
const tests=new Map();
for(const file of ['test-results-final.json','test-results-final-2.json','test-results-final-3.json'])if(fs.existsSync(dir+'/'+file))for(const t of read(dir+'/'+file))tests.set(t.name,t);
assert.equal(tests.size,23);
for(const t of tests.values()){assert.equal(t.exit_code,0,t.name);t.log_sha256=sha(t.log);}
const checker=read(dir+'/checker-identity-final.json'),samples=[];
for(const name of ['orders-actual','publish-actual','runtime-actual','external-actual','external-preflight-actual','orders-converged']){
 const base=dir+'/'+name,key=read(base+'/fixture-public-key.json');assert.deepEqual(Object.keys(key).sort(),['key_id','public_key']);
 const body=signed(base+'/receipt.json',key,'aidlc.observation-bundle/v1'),manifest=read(base+'/manifest.json');
 assert.equal(body.checker_digest,checker.checker_digest);assert.equal(body.status,body.coverage==='matrix'?'passed':'partial');assert.equal(body.business_verified,false);
 assert.equal(body.candidate_ref.candidate_id,hash({repositories:body.candidate_ref.repositories,artifacts:body.candidate_ref.artifacts}));
 for(const r of body.raw_refs){const saved=manifest.raw_files.find(m=>m.path===r.path&&m.digest===r.digest);assert(saved);assert.equal(sha(base+'/'+saved.saved_path),r.digest);}
 for(const r of [...body.source_refs,...body.candidate_ref.artifacts])assert.equal(sha(base+'/source/'+r.path),r.digest,r.path);
 for(const o of body.observations){assert.equal(o.status,'passed');assert.equal(canonical(o.candidate_ref),canonical(body.candidate_ref));if(o.kind==='ui'){const raw=read(base+'/'+manifest.raw_files.find(m=>m.path===o.raw_output_ref.path).saved_path);assert.equal(raw.visual.passed,true);assert(raw.visual.regions.length&&raw.visual.regions.every(r=>r.passed));}}
 const sample={name,coverage:body.coverage,checks:body.observations.length,ui_combinations:body.observations.filter(o=>o.kind==='ui').length,signature_verified:true,raw_and_source_hashes_verified:true,receipt_sha256:sha(base+'/receipt.json'),archived_fixture_authority:true};
 if(name==='orders-converged'){
   const result=signed(base+'/batch-result.json',key,'aidlc.batch-result/v1');
   assert.equal(result.checker_digest,checker.checker_digest);assert.equal(result.engineering_result,'verified');assert.equal(result.batch_completed,true);assert.equal(result.business_verified,true);assert.equal(result.workflow_completed,false);
   assert.equal(result.native.status,'passed');assert.equal(result.human_review_summary.status,'pending');assert.equal(result.decision_refs.length,1);
   assert.equal(canonical(result.candidate_ref),canonical(body.candidate_ref));
   const state=fs.readFileSync(base+'/batch-state.md','utf8'),match=/## Autonomy Batch Result\s+```json\s+([\s\S]*?)```/.exec(state);assert(match);const ref=JSON.parse(match[1]);assert.equal(ref.digest,sha(base+'/batch-result.json'));assert.equal(ref.result_id,result.result_id);
   for(const r of result.native.refs)assert.equal(sha(base+'/native/'+r.path.replace('.aidlc/evidence/','')),r.digest,r.path);
   for(const r of result.source_refs)assert.equal(sha(base+'/batch-inputs/'+r.path),r.digest,r.path);
   const prior=signed(base+'/decision-declared-observation.json',key,'aidlc.observation-bundle/v1');assert.equal(prior.coverage,'matrix');assert.equal(sha(base+'/decision-declared-observation.json'),result.decision_refs[0].validation_refs[0].digest);
   assert.equal(result.decision_refs[0].record_status,'verified');assert.notEqual(result.decision_refs[0].validation_refs[0].path,result.decision_refs[0].current_validation[0].receipt_ref.path);
   Object.assign(sample,{engineering_result:'verified',human_review:'pending',native_refs_verified:result.native.refs.length,batch_source_refs_verified:result.source_refs.length,batch_signature_verified:true,batch_result_sha256:sha(base+'/batch-result.json'),workflow_completed:false});
 }
 samples.push(sample);
}
const builds=read(dir+'/build-results-final.json');assert.equal(builds.length,10);for(const b of builds){assert.equal(b.exit_code,0,b.harness);b.log_sha256=sha(b.log);}
const additional=read(dir+'/additional-check-results.json');for(const c of additional){assert.equal(c.exit_code,0,c.name);c.log_sha256=sha(c.log);}
const inspect=read(dir+'/public-inspect-final.json');assert.equal(inspect.autonomous_batch_result.enabled,false);assert.equal(inspect.autonomous_batch_result.batch_completed,false);
const state='aidlc/active/aidlc-state.md',audit='aidlc/active/audit.md';assert.equal(sha(state),'5e08e34d2e434edf0ab7d2667377080dc0caf06dd8dcfa178b877211c5c93d0f');assert.equal(sha(audit),'1fa99dba9594b7ee1e2e7ad0d8e72c9b81b87e74f9577879795937b0af998686');
const absent=['.git/aidlc/autonomy','.aidlc/autonomy/grants','.aidlc/evidence/autonomous-admission','.aidlc/evidence/native-host','.aidlc/evidence/autonomous-observations','.aidlc/evidence/autonomous-results','.aidlc/host-runs'];for(const p of absent)assert(!fs.existsSync(p),p);
const sources=['core/tools/aidlc-batch-result.ts','core/tools/aidlc-batch-native.ts','core/tools/aidlc-batch-scope.ts','core/tools/aidlc-autonomy-state.ts','core/tools/aidlc-light-state.ts','core/tools/aidlc-grant-store.ts','core/tools/aidlc-execution-context.ts','core/tools/aidlc-orchestrate.ts','core/tools/aidlc-semantic-checks.ts','core/tools/aidlc-evidence.ts','core/tools/aidlc-autonomy-policy.ts','core/tools/aidlc-delivery-summary.ts','core/tools/aidlc-native-host.ts','harness/codex/runtime/aidlc-codex-host.mjs','harness/codex/runtime/host-kernel.cjs','harness/codex/README.md','bin/cli.ts','package.json','scripts/core-test-suites.json','tests/helpers/batch-fixture.ts','tests/test_batch_convergence.ts','tests/test_batch_result.ts','tests/test_native_host.ts','tests/test_native_host_driver.ts','tests/test_observations.ts','tests/test_runtime_observations.ts','tests/test_observation_ui.ts','core/knowledge/protocols/common-session-handoff.md','core/knowledge/protocols/common-step-completion-protocol.md','core/stages/construction/construction-build-and-test.md','docs/aidlc-autonomous-contracts-v1.md','docs/aidlc-autonomous-implementation-design.md','docs/aidlc-autonomous-implementation-p1.md','docs/loeyae-aidlc-cli-guide.md',dir+'/README.md',dir+'/code-review.md'];
fs.writeFileSync(dir+'/verification.json',JSON.stringify({task:'P1-08',kind:'engineering-native-and-batch-convergence-verification',verified_at:new Date().toISOString(),source_head:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_sha256:Object.fromEntries(sources.map(p=>[p,sha(p)])),checker_identity:checker,tests:[...tests.values()],samples,builds,additional_checks:additional,preserved_workflow:{state_sha256:sha(state),audit_sha256:sha(audit),authority_and_host_directories_absent:absent},limits:['H3/operator/reviewer and stage completion rows are explicitly prepared protocol fixtures; real Native producers and local Node/HTTP/Chrome observations are separately recorded','Archived signed verified is an isolated engineering result, not current business authority or a fresh observation lease','No complete native model autonomous business pilot or full UI Native positive batch; P1-10 remains required','No full npm test, protected branch write, push, deploy, P2 restart or successor recovery','Codex routing/configuration tested here; actual native model probe remains historical P1-06 evidence']},null,2)+'\n');
console.log('P1-08 sealed: 23 passing checks, signed Native/matrix/decision convergence and actual UI observations, 10 builds; unrelated workflow unchanged.');
