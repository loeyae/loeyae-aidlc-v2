/** Isolated signed Core worker boundaries; no model or pilot execution. */
import assert from 'node:assert/strict';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createAdmissionFixture} from './helpers/autonomy-admission-fixture';import * as W from '../core/tools/aidlc-worker-recovery';import * as R from '../core/tools/aidlc-run-recovery';import K from '../harness/codex/runtime/host-kernel.cjs';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-worker-core-')),before={...process.env};let cases=0;
const test=(name:string,fn:()=>void)=>{fn();cases++;console.log('PASS '+name);};
const adapter={entrypoint:'trusted-worker',digest:'a'.repeat(64)};let birth='one';const present=new Map<number,string>();
const identity=(pid:number)=>pid===process.pid?{pid,status:'present',birth_token:birth}:present.has(pid)?{pid,status:'present',birth_token:present.get(pid)}:{pid,status:'absent'};
async function fixture(name:string,enabled=true){const f=createAdmissionFixture(scratch,name);if(enabled)f.request.successor_policy={version:'1',mode:'same-host-session',max_restarts:1};await f.issue();return f;}
try{
 const disabled=await fixture('disabled',false);test('disabled grants cannot register outer worker',()=>assert.throws(()=>W.registerWorker(disabled.root,0,identity,adapter),/DISABLED/));
 const f=await fixture('worker'),first=W.registerWorker(f.root,0,identity,adapter);const revision=()=>R.inspectRecovery(f.root).revision;
 test('registration changes no stage and consumes no attempt',()=>{assert.equal(first.state.generation,0);assert.equal(first.state.status,'awaiting-worker');assert.equal(first.state.business_verified,undefined);});
 test('CAS conflict and duplicate live worker are refused',()=>{assert.throws(()=>W.registerWorker(f.root,0,identity,adapter),/CAS/);assert.throws(()=>W.registerWorker(f.root,revision(),identity,adapter),/NOT_ABSENT/);});
 test('fenced token cannot create resources',()=>assert.throws(()=>W.workerResource(f.root,'bad',identity,'intent',randomUUID(),'service'),/FENCED/));
 test('worker cannot become ready without actual service',()=>assert.throws(()=>W.workerReady(f.root,first.token,identity),/RESOURCE/));
 const service=randomUUID();W.workerResource(f.root,first.token,identity,'intent',service,'service');
 test('spawn gap cannot be silently closed or replaced',()=>{assert.throws(()=>W.workerResource(f.root,first.token,identity,'closed',service),/SPAWN/);birth='two';assert.throws(()=>W.registerWorker(f.root,revision(),identity,adapter),/SPAWN/);birth='one';});
 present.set(80001,'service');W.workerResource(f.root,first.token,identity,'started',service,undefined,identity(80001));W.workerReady(f.root,first.token,identity);
 test('live resource cannot be closed',()=>assert.throws(()=>W.workerResource(f.root,first.token,identity,'closed',service),/NOT_ABSENT/));
 present.set(80002,'child');const permit=W.issueWorkerPermit(f.root,first.token,identity,80002,randomUUID());
 test('one child-bound permit per ready epoch',()=>{assert.equal(permit.expected,revision());assert.equal(R.inspectRecovery(f.root).outer_worker.permit.child.pid,80002);assert.throws(()=>W.issueWorkerPermit(f.root,first.token,identity,80002,randomUUID()),/PENDING/);});
 test('wrong child or missing private permit cannot begin execution',()=>{assert.throws(()=>R.beginRecovery(f.root,revision(),identity,K.supervisionLimits()),/OWNER_UNKNOWN|PERMIT/);});
 test('adapter change and live service block dead-worker replacement',()=>{birth='two';assert.throws(()=>W.registerWorker(f.root,revision(),identity,{...adapter,digest:'b'.repeat(64)}),/ADAPTER/);assert.throws(()=>W.registerWorker(f.root,revision(),identity,adapter),/NOT_ABSENT/);birth='one';});
 present.delete(80001);W.workerResource(f.root,first.token,identity,'closed',service);test('permit child must also exit before quiescence',()=>assert.throws(()=>W.workerQuiesced(f.root,first.token,identity),/NOT_ABSENT/));present.delete(80002);W.workerQuiesced(f.root,first.token,identity);
 test('quiescence clears permit, not restart or attempt counters',()=>{const s=R.inspectRecovery(f.root);assert.equal(s.outer_worker.permit,null);assert.equal(s.restarts,0);assert.equal(s.generation,0);});
 birth='two';const successor=W.registerWorker(f.root,revision(),identity,adapter);
 test('dead old worker replacement fences old worker and retains grant',()=>{assert.equal(successor.state.outer_worker.replacements,1);assert.throws(()=>W.workerReady(f.root,first.token,identity),/FENCED/);});
 test('worker replacement budget is bounded',()=>{birth='three';assert.throws(()=>W.registerWorker(f.root,revision(),identity,adapter),/RESTART_LIMIT/);birth='two';});
 const reload=randomUUID();W.workerResource(f.root,successor.token,identity,'intent',reload,'reload');
 test('pending reload prevents normal finish',()=>assert.throws(()=>W.finishWorker(f.root,successor.token,identity),/RESOURCE/));
 await f.revoke();test('revocation stops new effects but permits proven cleanup',()=>{assert.throws(()=>W.workerResource(f.root,successor.token,identity,'intent',randomUUID(),'reload'),/INACTIVE/);W.workerResource(f.root,successor.token,identity,'closed',reload);W.finishWorker(f.root,successor.token,identity);assert.equal(R.inspectRecovery(f.root).status,'ended');});
 console.log(JSON.stringify({cases,scratch,business_verified:false}));
}finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
