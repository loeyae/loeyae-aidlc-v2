/** Real OS host/main/Core restart; the Native RPC peer is scripted, not a model. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';
import {createAdmissionFixture} from './helpers/autonomy-admission-fixture';
import {renderLightWorkflowState} from '../core/tools/aidlc-light-state';
import {inspectRecovery} from '../core/tools/aidlc-run-recovery';
import K from '../harness/codex/runtime/host-kernel.cjs';
const env={...process.env},scratch=mkdtempSync(join(tmpdir(),'aidlc-p2-host-process-'));
async function main(){try{
 const f=createAdmissionFixture(scratch,'process'),native=join(f.root,'native.js'),file=join(f.root,'host.json');
 writeFileSync(native,`const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;if(m.method==='thread/resume'&&!fs.existsSync('interrupted-once.json')){fs.writeFileSync('interrupted-once.json',JSON.stringify({host:process.ppid,native:process.pid,thread:m.params.threadId}));process.kill(process.ppid,'SIGKILL');process.exit(7);}console.log(JSON.stringify({id:m.id,result:m.method==='initialize'?{userAgent:'p2-engineering-rpc'}:m.method==='config/read'?{config:{}}:{thread:{id:m.params?.threadId||'test-session'}}}));});`);
 writeFileSync(file,JSON.stringify({schema:'aidlc.codex-host/v1',core_cli:resolve('bin/cli.ts'),codex_entrypoint:native,native_config_digest:K.hash(K.canonical({})),commands:[]}));
 f.request.host=K.identity(file);f.request.successor_policy={version:'1',mode:'same-host-session',max_restarts:2};
 const state=f.current(),binding=JSON.parse(process.env.AIDLC_SESSION_BINDING!);state.completed_stage_instances.push(binding.stage_instance);writeFileSync(join(f.root,'aidlc/active/aidlc-state.md'),renderLightWorkflowState(state));await f.issue();
 const started=Date.now();const result=await new Promise<{code:number|null,out:string,err:string}>((done,reject)=>{
   const child=spawn(process.execPath,[resolve('harness/codex/runtime/aidlc-codex-host.mjs'),'supervise',file,binding.session_id],{cwd:f.root,env:process.env,windowsHide:true,timeout:90000});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>done({code,out,err}));
 });
 writeFileSync(join(f.root,'supervisor-result.json'),JSON.stringify({...result,elapsed_ms:Date.now()-started}));
 assert.equal(result.code,0,JSON.stringify(result));const observed=JSON.parse(result.out.trim().split(/\r?\n/).at(-1)!);assert.equal(observed.attempts.length,2,JSON.stringify(observed));
 const durable=inspectRecovery(f.root);assert.equal(durable.restarts,1);assert.equal(durable.generation,2);assert.equal(durable.coordinator.session_id,binding.session_id);assert.equal(durable.status,'ended',JSON.stringify(durable));
 const attempts=join(f.root,'.aidlc/host-runs',f.current().execution_grant_ref!.run_id,'attempts'),dirs=readdirSync(attempts);assert.equal(dirs.length,1,'first host died before journal initialization; its signed ledger is retained');
 const exit=JSON.parse(readFileSync(join(attempts,dirs[0],'exit.json'),'utf8'));assert.equal(exit.business_verified,false);assert.equal(exit.end_reason,'admission-plan-required');assert.equal(exit.operations_reconciled,true);assert.equal(exit.native_process_reconciled,true);
 console.log('PASS actual supervise -> main -> Native RPC -> Core -> forced process exit -> successor -> environment recheck -> safe stop');
 console.log(JSON.stringify({scratch,elapsed_ms:Date.now()-started,attempts:observed.attempts,generation:durable.generation,original_deadline:observed.original_deadline,real_model:false,business_verified:false}));
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
