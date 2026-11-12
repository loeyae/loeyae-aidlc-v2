/** Read-only audit of ended real attempts, including incomplete outcomes. Never produces verification.json. */
import assert from 'node:assert/strict';import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {readIssuedGrant} from '../../../../core/tools/aidlc-grant-store';import {loadWorkflowState} from '../../../../core/tools/aidlc-light-state';import {loadWorkflowParts} from '../../../../core/tools/aidlc-workflow-layout';
const evaluation=import.meta.dirname,repository=resolve(evaluation,'../../../..'),hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),sourceRound=args[0]||'engineering-1794218305792',keys=args.length?args.slice(1):['orders-r7','publish-r11'];assert.match(sourceRound,/^engineering-[0-9]+$/);assert.equal(keys.length,2);for(const key of keys)assert.match(key,/^(orders|publish)-r[0-9]+$/);
const engineering=JSON.parse(readFileSync(join(evaluation,sourceRound,'results.json'),'utf8'));
for(const [p,d] of Object.entries(engineering.source_snapshot))assert.equal(hash(readFileSync(join(repository,p))),d,'Running source changed: '+p);
const rootHashes={'aidlc/active/aidlc-state.md':'5e08e34d2e434edf0ab7d2667377080dc0caf06dd8dcfa178b877211c5c93d0f','aidlc/active/audit.md':'1fa99dba9594b7ee1e2e7ad0d8e72c9b81b87e74f9577879795937b0af998686'};
for(const [p,d] of Object.entries(rootHashes))assert.equal(hash(readFileSync(join(repository,p))),d);
const absent=['.git/aidlc/autonomy','.aidlc/autonomy/grants','.aidlc/evidence/autonomous-admission','.aidlc/evidence/native-host','.aidlc/evidence/autonomous-observations','.aidlc/evidence/autonomous-results','.aidlc/host-runs'];for(const p of absent)assert.equal(existsSync(join(repository,p)),false,p);
const pilots:any[]=[];
for(const key of keys){
 const dir=join(evaluation,key),root=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')).root,archive=join(dir,'actual-run'),manifest=JSON.parse(readFileSync(join(archive,'manifest.json'),'utf8'));
 for(const f of manifest.files)assert.equal(hash(readFileSync(join(archive,f.saved_path))),f.sha256,'Archive changed: '+f.saved_path);
 const state=loadWorkflowState(root)!,grant=readIssuedGrant(root,state.execution_grant_ref!).grant,exit=manifest.actual_exit;
 assert.equal(grant.run_id,exit.run_id);assert.equal(grant.executor_constraints.session_id,exit.thread_id);assert.equal(manifest.workflow_id,state.workflow_id);
 assert.equal(exit.business_verified,false,'This audit is for these observed incomplete attempts');assert.equal(exit.batch_result_ref,null);assert.equal(exit.operations_reconciled,true);assert.equal(exit.claims_reconciled,true);assert.deepEqual(exit.pending_unknown,[]);
 for(const part of loadWorkflowParts(root).parts.values())assert.deepEqual(Object.keys(part.state.active_instances),[],'No unreconciled claim may be silently adopted');
 const op=manifest.files.find((f:any)=>f.saved_path.startsWith('operator/')&&f.saved_path.endsWith('/controller.jsonl'));
 const current=readFileSync(join(archive,op.saved_path),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.equal(current.at(-1).event,'owned-service-close');
 const approvals=manifest.files.filter((f:any)=>/^(?:prior-)?operator\//.test(f.saved_path)&&f.saved_path.endsWith('/controller.jsonl')).flatMap((f:any)=>readFileSync(join(archive,f.saved_path),'utf8').trim().split(/\r?\n/).map(JSON.parse)).filter((e:any)=>e.event==='real-terminal-grant-issued');assert.equal(approvals.length,1);
 const bytes=readFileSync(join(archive,'host/native-events.jsonl'),'utf8'),rows=bytes.trim().split(/\r?\n/).map(JSON.parse),success=new Set(rows.filter(r=>r.event.method==='aidlc/tool/result'&&r.event.params.success).map(r=>r.event.params.callId));
 const acceptedHumanInputs=rows.filter(r=>r.event.method==='item/tool/call'&&success.has(r.event.id)&&r.event.params.arguments.action==='core'&&r.event.params.arguments.args.includes('--user-input'));assert.equal(acceptedHumanInputs.length,0);
 const preservedRedInputs:any[]=[];
 const phases:any[]=[];for(const [stage,sensor] of [['tdd','red-test-evidence'],['code-generation','green-test-evidence'],['code-review','review-evidence'],['build-and-test','build-test-evidence']]){
  const p=stage==='build-and-test'?`.aidlc/evidence/${stage}/${sensor}.json`:`.aidlc/evidence/${stage}/project/default/${sensor}.json`;if(!existsSync(join(archive,p)))continue;
  const raw=readFileSync(join(archive,p)),v=JSON.parse(raw.toString());assert.equal(v.workflow_id,state.workflow_id);assert.equal(v.producer.mode,'controlled');
  if(stage==='build-and-test'){assert.ok(v.commands.length);assert.ok(v.commands.every((c:any)=>c.exit_code===0&&c.status==='passed'));assert.equal(v.tests.failed,0);}else assert.equal(v.checker.status,'passed');
  if(stage==='tdd')for(const f of v.phase_input_binding.files){assert.equal(hash(readFileSync(join(archive,f.path))),f.sha256,'Historical RED input changed: '+f.path);preservedRedInputs.push({path:f.path,sha256:f.sha256});}
  phases.push({stage,sensor,timestamp:v.timestamp,status:v.status,tests_total:v.tests_total,tests_failed:v.tests_failed,sha256:hash(raw),path:join(key,'actual-run',p).replaceAll('\\','/')});
 }
 const pixelChecks:any[]=[];const ui=join(archive,'.runtime/native-ui');if(existsSync(ui))for(const id of readdirSync(ui)){
  const file=join(ui,id,'observation.json');if(!existsSync(file))continue;const v=JSON.parse(readFileSync(file,'utf8'));if(v.observed?.passed&&v.visual?.passed)pixelChecks.push({id,viewport:v.observed.viewport,changed_pixels:v.visual.changed_pixels,regions:v.visual.regions});
 }
 pilots.push({key,workflow_id:state.workflow_id,thread_id:exit.thread_id,run_id:exit.run_id,actual_terminal_grants:approvals.length,grant_signature_verified:true,original_expires_at:grant.expires_at,actual_exit:exit,raw_archive_files_verified:manifest.files.length,accepted_model_human_inputs:acceptedHumanInputs.length,claims_remaining:0,owned_services_close_record:true,preserved_red_inputs:preservedRedInputs,phases,passed_browser_pixel_observations:pixelChecks,limitation:'Native and browser success fragments do not establish a final candidate or full signed batch acceptance'});
}
const output=join(evaluation,'ended-attempt-audit-'+Date.now());mkdirSync(output);
writeFileSync(join(output,'result.json'),JSON.stringify({kind:'actual-ended-attempt-audit',source_round:sourceRound,checked_at:new Date().toISOString(),business_verified:false,p1_10_exit:false,tool_sources_unchanged:true,tool_source_files:Object.keys(engineering.source_snapshot).length,root_preserved:rootHashes,root_authority_paths_absent:absent,pilots},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,business_verified:false,p1_10_exit:false,pilots:pilots.map(p=>({key:p.key,engineering_result:p.actual_exit.engineering_result,raw_files:p.raw_archive_files_verified,phases:p.phases.length,pixel_observations:p.passed_browser_pixel_observations.length}))}));
