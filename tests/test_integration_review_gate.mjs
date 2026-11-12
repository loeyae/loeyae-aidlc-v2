import assert from 'node:assert/strict';import {test} from 'node:test';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const gate=await import('../docs/evals/autonomy/p1-10/integration-review-gate.mjs');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-review-gate-')),prefix='docs/evals/autonomy/p1-10',statusPath=prefix+'/integration-audit-2026-11-10/review-status.json',hash=b=>createHash('sha256').update(b).digest('hex');
const put=(root,p,value)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof value==='string'?value:JSON.stringify(value));};
function fixture(){const root=fs.mkdtempSync(path.join(scratch,'case-'));for(const p of ['core/a.ts','bin/a.ts','harness/codex/runtime/a.cjs','tests/a.mjs',...['operator-pilots.ts','operator-runner.ts','integration-review-gate.mjs','pilot-worker.ts','operator-prestart.ts','prepare-pilots.ts','pilot-assets.mjs'].map(p=>prefix+'/'+p)])put(root,p,'// authority-free source fixture');return root;}
function go(root){const snapshot={schema:'aidlc.integration-source/v1',files:gate.currentReviewSources(root)},sourceDigest=gate.reviewSourceDigest(snapshot.files);const ref=(name,value)=>{const p=prefix+'/go-fixture/'+name;put(root,p,value);return {path:p,digest:hash(fs.readFileSync(path.join(root,p)))};};const log=ref('raw.log','engineering fixture only');const source=ref('source.json',snapshot),validation=ref('validation.json',{schema:'aidlc.integration-validation/v1',source_snapshot_digest:sourceDigest,open_findings:[],levels:['L0','L1','L2','distribution'].map(level=>({level,status:'passed',evidence_refs:[log]}))}),efficiency=ref('efficiency.json',{schema:'aidlc.integration-efficiency/v1',source_snapshot_digest:sourceDigest,status:'passed',metrics:[{name:'fixture-control',actual_ms:1,budget_ms:10}],evidence_refs:[log]});const manifest=ref('manifest.json',{schema:'aidlc.integration-go/v1',source_ref:source,validation_ref:validation,efficiency_ref:efficiency});const confirmation=ref('confirmation.json',{schema:'aidlc.integration-confirmation/v1',kind:'actual-host-user-message',confirmed:true,confirmed_at:'2026-01-01T00:00:00Z',message_ref:'engineering-fixture-not-real-consent',go_manifest_digest:manifest.digest,execution_grant:false});const status={schema:'aidlc.integration-review/v1',scope:'P1-10 real pilot execution',decision:'GO',review_complete:true,optimization_complete:true,real_trials_permitted:true,open_reproduced:[],source_confirmed_pending_integration:[],go:{manifest_ref:manifest,confirmation_ref:confirmation}};put(root,statusPath,status);return {status,manifest,confirmation,source,validation,efficiency,log};}
test('missing, malformed, HOLD and unknown decisions fail closed without pilot state',()=>{
 for(const value of [undefined,'{',{}, {schema:'aidlc.integration-review/v1',scope:'P1-10 real pilot execution',decision:'HOLD_PENDING_OPTIMIZATION'},{schema:'aidlc.integration-review/v1',scope:'P1-10 real pilot execution',decision:'maybe'}]){const root=fixture();if(value!==undefined)put(root,statusPath,value);assert.equal(gate.inspectIntegrationReview(root).decision,'HOLD');assert.throws(()=>gate.requireIntegrationGo(root),/INTEGRATION_REVIEW_HOLD/);assert.equal(fs.existsSync(path.join(root,'.aidlc')),false);}
});
test('GO requires complete source-bound engineering, efficiency and confirmation records; it grants no authority',()=>{
 const root=fixture();go(root);const result=gate.inspectIntegrationReview(root);assert.equal(result.decision,'GO',JSON.stringify(result));assert.equal(result.execution_authorized,false);assert.equal(result.business_verified,false);gate.requireIntegrationGo(root);
});
test('bare GO or incomplete/open optimization cannot pass',()=>{
 for(const change of [s=>delete s.go,s=>s.optimization_complete=false,s=>s.real_trials_permitted=false,s=>s.open_reproduced=['IR-04'],s=>s.source_confirmed_pending_integration=['IR-05']]){const root=fixture(),f=go(root);change(f.status);put(root,statusPath,f.status);assert.equal(gate.inspectIntegrationReview(root).decision,'HOLD');}
});
test('changed, added or removed operative sources invalidate GO',()=>{
 for(const mutation of [root=>put(root,'core/a.ts','changed'),root=>put(root,prefix+'/operator-runner.ts','changed'),root=>put(root,'core/new.ts','new'),root=>put(root,'docs/aidlc-autonomous-contracts-v1.md','new normative rule'),root=>fs.unlinkSync(path.join(root,'core/a.ts'))]){const root=fixture();go(root);mutation(root);assert.equal(gate.inspectIntegrationReview(root).decision,'HOLD');}
});
test('regression and explanatory changes retain frozen proof without pretending new tests passed',()=>{
 for(const mutation of [root=>put(root,'tests/new.mjs','new test'),root=>put(root,'tests/a.mjs','changed test'),root=>fs.unlinkSync(path.join(root,'tests/a.mjs')),root=>put(root,'README.md','explanation')]){const root=fixture();go(root);const old=gate.inspectIntegrationReview(root);mutation(root);const now=gate.inspectIntegrationReview(root);assert.equal(now.decision,'GO');assert.equal(now.execution_authorized,false);assert.equal(now.validated_source_snapshot_digest,old.source_snapshot_digest);assert.notEqual(now.source_snapshot_digest,old.source_snapshot_digest);assert.equal(now.source_impact.execution_evidence_reusable,true);if(now.source_impact.verification.length){assert.equal(now.source_impact.current_verification_sources_validated,false);assert.deepEqual(now.source_impact.required_checks,['changed-regression-tests']);}}
});
test('unknown dependencies and acceptance assets conservatively require runtime review',()=>{
 for(const p of ['unclassified/new.input',prefix+'/pilot-assets.mjs','core/knowledge/rule.md','scripts/build.ts','package-lock.json']){const impact=gate.reviewSourceImpact({[p]:'old'},{[p]:'new'});assert.equal(impact.execution_evidence_reusable,false);assert.deepEqual(impact.execution,[p]);}
});
test('tampered raw evidence or confirmation, mismatched manifest and private/traversal refs are rejected',()=>{
 for(const mutation of [(root,f)=>put(root,f.log.path,'tampered'),(root,f)=>put(root,f.confirmation.path,'{}'),(root,f)=>{f.status.go.confirmation_ref=f.source;put(root,statusPath,f.status);},(root,f)=>{f.status.go.manifest_ref={path:'../../outside',digest:'a'.repeat(64)};put(root,statusPath,f.status);},(root,f)=>{f.status.go.manifest_ref={path:'.git/secret',digest:'a'.repeat(64)};put(root,statusPath,f.status);}]){const root=fixture(),f=go(root);mutation(root,f);assert.equal(gate.inspectIntegrationReview(root).decision,'HOLD');}
});

test('the actual bootstrap imports its runner only for a current complete GO, never for HOLD or drift',()=>{
 const root=fixture();put(root,'package.json',{type:'module'});for(const name of ['operator-pilots.ts','integration-review-gate.mjs'])put(root,prefix+'/'+name,fs.readFileSync(new URL('../docs/evals/autonomy/p1-10/'+name,import.meta.url),'utf8'));
 put(root,prefix+'/operator-runner.ts',"console.log(JSON.stringify({kind:'engineering-runner-only',execution_authorized:false,business_verified:false}));");
 const run=()=>spawnSync(process.execPath,['--import','tsx',path.join(root,prefix,'operator-pilots.ts'),'--check'],{cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',windowsHide:true,timeout:15000});
 let r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).integration_review.decision,'HOLD');
 go(root);r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).kind,'engineering-runner-only');
 put(root,'core/a.ts','source drift');r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).integration_review.decision,'HOLD');
});

test('linked status or evidence cannot pass as ordinary review inputs',()=>{
 const root=fixture(),f=go(root),original=path.join(root,f.log.path),alias=original+'.saved';fs.renameSync(original,alias);fs.linkSync(alias,original);assert.equal(gate.inspectIntegrationReview(root).decision,'HOLD');
 const root2=fixture();go(root2);const status=path.join(root2,statusPath);fs.linkSync(status,status+'.alias');assert.equal(gate.inspectIntegrationReview(root2).decision,'HOLD');
});
test.after(()=>{assert.equal(path.dirname(path.resolve(scratch)),path.resolve(os.tmpdir()));fs.rmSync(scratch,{recursive:true,force:true});});
