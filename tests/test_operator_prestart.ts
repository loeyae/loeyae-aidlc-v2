/** Engineering fixtures only. No genuine operator approval, model run or business success. */
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';import { tmpdir } from 'node:os';
import { createAdmissionFixture } from './helpers/autonomy-admission-fixture';
import { readIssuedGrant } from '../core/tools/aidlc-grant-store';
import { releaseSession,bindSession,claimToken } from '../core/tools/aidlc-session';
import { inspectUnstartedGrant } from '../docs/evals/autonomy/p1-10/operator-prestart';
import { bindExecutionGrant } from '../core/tools/aidlc-execution-grant';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-operator-prestart-')),env={...process.env};let count=0;
function test(name:string,fn:()=>void){fn();count++;console.log('PASS '+name);}
try{
 const f=createAdmissionFixture(scratch,'unstarted');await f.issue();
 const grant=readIssuedGrant(f.root,f.current().execution_grant_ref!).grant,held=JSON.parse(process.env.AIDLC_SESSION_BINDING!);
 releaseSession(f.root,held.stage_instance,claimToken(f.current().active_instances[held.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;
 const dir=join(scratch,'operator-records');mkdirSync(dir);const prior=join(dir,'operator-'+grant.run_id+'-1');mkdirSync(prior);
 const request={run_id:grant.run_id,lifetime_seconds:(Date.parse(grant.expires_at)-Date.parse(grant.request_started_at))/1000,host:grant.executor_constraints.host,allowed_operations:grant.allowed_operations,resource_limits:grant.resource_limits,integration_permissions:grant.integration_permissions,write_paths:grant.executor_constraints.write_paths};
 const log=join(prior,'controller.jsonl'),original=[{at:grant.issued_at,event:'real-terminal-grant-issued',run_id:grant.run_id,scope_digest:grant.baseline_digest,host:request.host},{at:new Date().toISOString(),event:'owned-service-close'}].map(v=>JSON.stringify(v)+'\n').join('');writeFileSync(log,original);
 const check=(r:any=request,t=held.session_id,d=grant.baseline_digest)=>inspectUnstartedGrant(f.root,dir,r,t,d);
 test('unused grant retains its exact ref, original session and unchanged deadline',()=>{const r=check();assert.deepEqual(r.ref,f.current().execution_grant_ref);assert.equal(r.expires_at,grant.expires_at);assert.equal('binding' in r,false);assert.equal('generation' in r,false);});
 for(const [name,r,t,d] of [['changed host',{...request,host:{...request.host,config_digest:'b'.repeat(64)}},held.session_id,grant.baseline_digest],['changed run',{...request,run_id:'different'},held.session_id,grant.baseline_digest],['changed session',request,'other-thread',grant.baseline_digest],['changed scope',request,held.session_id,'c'.repeat(64)],['extended budget',{...request,resource_limits:{...request.resource_limits,wall_time_seconds:9999}},held.session_id,grant.baseline_digest]] as any[])test(name+' is refused',()=>assert.throws(()=>check(r,t,d)));
 test('an existing Native attempt is refused',()=>{const p=join(f.root,'.aidlc/host-runs');mkdirSync(p,{recursive:true});mkdirSync(join(p,grant.run_id));assert.throws(()=>check(),/existing Native attempt/);rmSync(join(p,grant.run_id),{recursive:true});});
 test('even dispatch before attempt publication prevents another first start',()=>{writeFileSync(log,original+JSON.stringify({event:'native-run-starting'})+'\n');assert.throws(()=>check(),/already dispatched/);writeFileSync(log,original);});
 test('an existing claim is never reconstructed or taken over',()=>{const b=bindSession(f.root,{instance:'workspace-detection',owner:'agent',session:held.session_id,expected:claimToken(undefined)}).binding;assert.throws(()=>check(),/reconstruct/);process.env.AIDLC_SESSION_BINDING=JSON.stringify(b);releaseSession(f.root,b.stage_instance,claimToken(f.current().active_instances[b.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;});
 test('expired original grant is refused without resetting time',()=>{const clock=Date.now;try{Date.now=()=>Date.parse(grant.expires_at)+1;assert.throws(()=>check(),/expired/);}finally{Date.now=clock;}});
 test('fresh normal same-session binding can bind the unchanged grant before its first attempt',()=>{const b=bindSession(f.root,{instance:'workspace-detection',owner:'agent',session:held.session_id,expected:claimToken(undefined)}).binding;assert.notEqual(b.generation,held.generation);process.env.AIDLC_SESSION_BINDING=JSON.stringify(b);assert.deepEqual(bindExecutionGrant(f.root).ref,f.current().execution_grant_ref);assert.equal(readIssuedGrant(f.root,f.current().execution_grant_ref!).grant.expires_at,grant.expires_at);releaseSession(f.root,b.stage_instance,claimToken(f.current().active_instances[b.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;});
 test('changed frozen inputs remain refused',()=>{const input=grant.inputs.find(i=>i.path.endsWith('/requirements.md')&&!i.selector)!;const p=join(f.root,input.path),b=readFileSync(p);try{writeFileSync(p,Buffer.concat([b,Buffer.from('\nchanged')]));assert.throws(()=>check(),/baseline changed/);}finally{writeFileSync(p,b);}});
 console.log(`Operator first-start: ${count} engineering scenarios passed; no approval or business proof`);
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});}
