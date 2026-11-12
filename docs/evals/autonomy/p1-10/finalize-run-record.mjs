// Combine unchanged-source engineering rechecks with the ended real attempts.
// This is an engineering/negative-result record, never verification.json or a new authorization.
import fs from 'node:fs';import p from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const evaluation=import.meta.dirname,repo=p.resolve(evaluation,'../../../..'),[engineeringName,supplementName,distributionName]=process.argv.slice(2),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.match(engineeringName,/^engineering-[0-9]+$/);assert.match(supplementName,/^delegated-supplement-[0-9]+$/);assert.match(distributionName,/^distribution-[0-9]+$/);
const json=(dir,file)=>JSON.parse(fs.readFileSync(p.join(evaluation,dir,file),'utf8'));
const main=json(engineeringName,'results.json'),stability=json(engineeringName,'source-stability.json'),supplement=json(supplementName,'result.json'),distribution=json(distributionName,'results.json');
assert.equal(main.results.length,30);assert.equal(new Set(main.results.map(r=>r.name)).size,30);assert.ok(stability.unchanged);assert.equal(stability.source_snapshot_sha256,sha(JSON.stringify(main.source_snapshot)));
assert.equal(supplement.source_snapshot_sha256,stability.source_snapshot_sha256);assert.equal(supplement.original_round,engineeringName);assert.equal(supplement.tool_sources_unchanged,true);
for(const [file,digest]of Object.entries(main.source_snapshot))assert.equal(sha(fs.readFileSync(p.join(repo,file))),digest,'Current tool source changed: '+file);
for(const [file,digest]of Object.entries(supplement.test_hashes))assert.equal(sha(fs.readFileSync(p.join(repo,file))),digest,'Rechecked test changed: '+file);
const passed=r=>r.exit_code===0&&r.status==='succeeded'&&r.reconciled;
const rows=[];for(const row of main.results){
 assert.equal(sha(fs.readFileSync(p.join(evaluation,engineeringName,row.name+'.log'))),row.log_sha256);
 let accepted=row,directory=engineeringName;
 if(!passed(row)){
  assert.ok(['native_host_driver','native_host_delegated_convergence'].includes(row.name),'An additional failure needs investigation');
  const recheck=supplement.results.find(r=>r.name===row.name);assert.ok(recheck&&passed(recheck));assert.deepEqual(recheck.argv,row.argv);accepted=recheck;directory=supplementName;
 }
 assert.ok(passed(accepted));rows.push({name:row.name,directory,log_sha256:accepted.log_sha256,original_failed:!passed(row)});
}
for(const row of supplement.results){assert.ok(passed(row));assert.equal(sha(fs.readFileSync(p.join(evaluation,supplementName,row.log))),row.log_sha256);}
assert.equal(distribution.results.length,3);for(const row of distribution.results){assert.equal(row.exit_code,0);assert.equal(sha(fs.readFileSync(p.join(evaluation,distributionName,row.log))),row.log_sha256);}
const rootHashes={'aidlc/active/aidlc-state.md':'5e08e34d2e434edf0ab7d2667377080dc0caf06dd8dcfa178b877211c5c93d0f','aidlc/active/audit.md':'1fa99dba9594b7ee1e2e7ad0d8e72c9b81b87e74f9577879795937b0af998686'};for(const [file,digest]of Object.entries(rootHashes))assert.equal(sha(fs.readFileSync(p.join(repo,file))),digest);
const absent=['.git/aidlc/autonomy','.aidlc/autonomy/grants','.aidlc/evidence/autonomous-admission','.aidlc/evidence/native-host','.aidlc/evidence/autonomous-observations','.aidlc/evidence/autonomous-results','.aidlc/host-runs'];for(const file of absent)assert.equal(fs.existsSync(p.join(repo,file)),false,file);assert.equal(fs.existsSync(p.join(evaluation,'verification.json')),false);
const attempts=[];for(const key of ['orders-r7','publish-r11']){
 const manifest=json(key+'/actual-run','manifest.json');assert.equal(manifest.business_verified,false);assert.equal(manifest.actual_exit.operations_reconciled,true);assert.equal(manifest.actual_exit.claims_reconciled,true);assert.deepEqual(manifest.actual_exit.pending_unknown,[]);
 for(const file of manifest.files)assert.equal(sha(fs.readFileSync(p.join(evaluation,key,'actual-run',file.saved_path))),file.sha256);
 attempts.push({key,manifest:key+'/actual-run/manifest.json',manifest_sha256:sha(fs.readFileSync(p.join(evaluation,key,'actual-run/manifest.json'))),engineering_result:manifest.engineering_result,business_verified:false,raw_files:manifest.files.length});
}
const actualSourceDirectory='actual-tool-source-1794218305792',actualSources=json(actualSourceDirectory,'manifest.json');assert.equal(actualSources.files.length,297);for(const file of actualSources.files)assert.equal(sha(fs.readFileSync(p.join(evaluation,actualSourceDirectory,file.path))),file.sha256);
const output=p.join(evaluation,'post-run-validation-'+Date.now());fs.mkdirSync(output);fs.writeFileSync(p.join(output,'result.json'),JSON.stringify({kind:'post-run-engineering-and-ended-attempt-record',checked_at:new Date().toISOString(),business_verified:false,p1_10_exit:false,engineering_directory:engineeringName,full_round_all_passed:main.results.every(passed),effective_checks_passed:rows.length,original_failures_preserved:main.results.filter(r=>!passed(r)).map(r=>r.name),supplement_directory:supplementName,source_snapshot_sha256:stability.source_snapshot_sha256,tool_source_files:Object.keys(main.source_snapshot).length,tool_sources_unchanged:true,checks:rows,distribution_directory:distributionName,distribution_checks:3,actual_attempts:attempts,actual_tool_source_archive:actualSourceDirectory+'/manifest.json',actual_runtime_audit:'ended-attempt-audit-1794224298126/result.json',root_preserved:rootHashes,root_authority_paths_absent:absent,remaining_exit_blocker:'New real Codex attempts on the fixed source must independently reach final same-candidate Native/matrix/decision convergence; old attempts and grants cannot restart'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,effective_engineering_checks:rows.length,full_round_all_passed:main.results.every(passed),business_verified:false,p1_10_exit:false}));
