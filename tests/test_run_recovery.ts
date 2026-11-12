import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createAdmissionFixture} from './helpers/autonomy-admission-fixture';
import * as R from '../core/tools/aidlc-run-recovery';
import {checkCurrentExecutionGrant} from '../core/tools/aidlc-execution-grant';
import {loadWorkflowState,renderLightWorkflowState} from '../core/tools/aidlc-light-state';
import {autonomyDigest as digest} from '../core/tools/aidlc-autonomy-files';
import K from '../harness/codex/runtime/host-kernel.cjs';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-p2-recovery-')),env={...process.env};let count=0;
const test=(name:string,fn:()=>void)=>{fn();console.log('PASS '+name);count++;};
const limits=K.supervisionLimits(),present=(birth:string)=>(pid:number)=>({status:'present',pid,birth_token:birth});
async function fixture(name:string,enabled=true){const f=createAdmissionFixture(scratch,name);if(enabled)f.request.successor_policy={version:'1',mode:'same-host-session',max_restarts:3};await f.issue();return f;}
async function main(){try{
 const legacy=await fixture('disabled',false);test('legacy disabled grants cannot acquire a successor',()=>assert.throws(()=>R.beginRecovery(legacy.root,0,present('one'),limits),/DISABLED/));
 const f=await fixture('recovery'),initial=JSON.parse(process.env.AIDLC_SESSION_BINDING!),lease=R.beginRecovery(f.root,0,present('one'),limits),oldToken=lease.token;
 test('new approved run renews generation but retains native session and deadline',()=>{assert.notEqual(lease.coordinator.generation,initial.generation);assert.equal(lease.coordinator.session_id,initial.session_id);assert.equal(lease.state.generation,1);checkCurrentExecutionGrant(f.root,['workflow-write']);});
 test('stale expected head and live old owner cannot take over',()=>{assert.throws(()=>R.beginRecovery(f.root,0,present('two'),limits),/CAS/);assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('one'),limits),/NOT_ABSENT/);});
 R.persistSupervisor(f.root,{steps:12,turns:2,withoutProgress:4,seen:['work-change:abc'],repeats:[['repeat',3]],failures:[['input',1]],idle_elapsed_ms:100,saved_at:Date.now(),stopped:null});
 test('budget rollback and foreign HostRef are rejected',()=>{assert.throws(()=>R.persistSupervisor(f.root,{steps:11,turns:2}),/ROLLBACK/);const saved=process.env.AIDLC_AUTONOMY_HOST;process.env.AIDLC_AUTONOMY_HOST='{}';assert.throws(()=>R.reserveOperation(f.root,{kind:'read'}),/HOST/);process.env.AIDLC_AUTONOMY_HOST=saved;});
 const operation=R.reserveOperation(f.root,{kind:'core',args:['orchestrate','report','--stage',initial.stage_instance,'--result','completed']});process.env.AIDLC_OPERATION_ID=operation;
 const receipt=R.operationReceipt(f.root,['--stage',initial.stage_instance,'--result','completed'])!;
 test('same operation ID with different report input is rejected',()=>assert.throws(()=>R.operationReceipt(f.root,['--stage','different','--result','completed']),/IDENTITY/));
 delete process.env.AIDLC_OPERATION_ID;
 // Seed only the exact atomic commit boundary; no approval or business pass is inferred.
 const state=loadWorkflowState(f.root)!;state.history.push({stage:initial.stage_instance,instance_id:initial.stage_instance,result:'completed',timestamp:new Date().toISOString(),operation_ref:receipt});writeFileSync(join(f.root,'aidlc/active/aidlc-state.md'),renderLightWorkflowState(state));
 const read=R.reserveOperation(f.root,{kind:'core',args:['orchestrate','autonomy','host','context']});
 const second=R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('two'),limits);
 test('lost report response reconciles atomic history without another report',()=>{assert.equal(second.state.operations[operation].status,'committed');assert.equal(second.state.operations[read].status,'not-replayed');assert.equal(loadWorkflowState(f.root)!.history.filter(h=>h.operation_ref===receipt).length,1);});
 test('successor retains counters and fences old executor token',()=>{assert.equal(second.state.supervisor.steps,12);assert.equal(second.state.supervisor.turns,2);process.env.AIDLC_ATTEMPT_TOKEN=oldToken;assert.throws(()=>checkCurrentExecutionGrant(f.root,['workflow-write']),/FENCED/);process.env.AIDLC_ATTEMPT_TOKEN=second.token;checkCurrentExecutionGrant(f.root,['workflow-write']);});
 const command=R.reserveOperation(f.root,{kind:'command',id:'external'});
 test('unknown external effects stop; no implicit replay',()=>assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('three'),limits),/EXTERNAL_OPERATION_UNKNOWN/));
 test('unknown/live child and spawn gap stop before fencing',()=>{const resource=R.resourceIntent(f.root,'service');assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('three'),limits),/SPAWN_UNRECONCILED/);R.resourceStarted(f.root,resource,{pid:999,birth_token:'three',status:'present'});assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('three'),limits),/NOT_ABSENT/);R.resourceClosed(f.root,resource);});
 const rawPath='.aidlc/host-runs/'+f.current().execution_grant_ref!.run_id+'/reconciliation/query.json';mkdirSync(join(f.root,rawPath,'..'),{recursive:true});
 const third=R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('three'),limits,op=>{const body={schema:'aidlc.external-reconciliation/v1',operation_id:op.id,input_digest:op.input_digest,status:'succeeded'},raw=JSON.stringify(body);writeFileSync(join(f.root,rawPath),raw,{flag:'wx'});return {...body,raw_digest:createHash('sha256').update(raw).digest('hex'),raw_ref:rawPath};});
 test('external query reconciles only the exact operation, never batch acceptance',()=>{assert.equal(third.state.operations[command].status,'committed');assert.equal(third.state.business_verified,undefined);});
 const budget=new K.Budget({wall_time_seconds:600,max_equivalent_retries:2,max_active_units:1},Date.now()+600000),progress=new K.ProgressBudget(limits,budget);progress.restore(third.state.supervisor);
 test('Supervisor restores semantic dedupe, equivalent retries and no-progress steps',()=>{assert.equal(progress.steps,12);assert.equal(progress.withoutProgress,4);assert.equal(progress.checkpoint('work-change','abc'),false);assert.equal(budget.failures.get('input'),1);assert.equal(progress.repeats.get('repeat'),3);});
 R.finishRecovery(f.root,'user-cancelled');test('terminal/cancelled run cannot restart',()=>assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,present('four'),limits),/ENDED/));
 const g=await fixture('unknown-report');R.beginRecovery(g.root,0,present('a'),limits);R.reserveOperation(g.root,{kind:'core',args:['orchestrate','report','--stage','workspace-detection','--result','completed']});test('uncommitted report cannot be declared committed',()=>assert.throws(()=>R.beginRecovery(g.root,R.inspectRecovery(g.root).revision,present('b'),limits),/REPORT_UNCOMMITTED/));
 const t=await fixture('tamper');R.beginRecovery(t.root,0,present('a'),limits);const directory=join(t.root,'.git/aidlc/autonomy/recovery'),run=join(directory,readdirSync(directory)[0]);writeFileSync(join(run,'999999.json'),'{}');test('torn append blocks head reuse',()=>assert.throws(()=>R.inspectRecovery(t.root),/TORN/));
 const e=await fixture('revoked');R.beginRecovery(e.root,0,present('a'),limits);await e.revoke();test('revocation forbids successor and new reservations',()=>assert.throws(()=>R.beginRecovery(e.root,R.inspectRecovery(e.root).revision,present('b'),limits),/INACTIVE/));
 test('business children cannot inherit recovery credentials',()=>{assert.equal(K.businessEnv({AIDLC_ATTEMPT_TOKEN:'secret',AIDLC_OPERATION_ID:'private',PATH:'x'}).AIDLC_ATTEMPT_TOKEN,undefined);});
 console.log(JSON.stringify({cases:count,scratch,business_verified:false,fixture_only:true}));
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
