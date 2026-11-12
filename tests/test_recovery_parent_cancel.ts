import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {createRequire} from 'node:module';
import {createAdmissionFixture} from './helpers/autonomy-admission-fixture';import * as R from '../core/tools/aidlc-run-recovery';import K from '../harness/codex/runtime/host-kernel.cjs';
const env={...process.env},scratch=mkdtempSync(join(tmpdir(),'aidlc-p2-parent-cancel-'));
try{
 const f=createAdmissionFixture(scratch,'cancel');f.request.successor_policy={version:'1',mode:'same-host-session',max_restarts:2};await f.issue();
 const entry=join(f.root,'child.cjs');writeFileSync(entry,`const {require:load}=require(${JSON.stringify(createRequire(import.meta.url).resolve('tsx/cjs/api'))});const R=load(${JSON.stringify(resolve('core/tools/aidlc-run-recovery.ts'))},__filename),K=require(${JSON.stringify(resolve('harness/codex/runtime/host-kernel.cjs'))});R.beginRecovery(process.cwd(),0,K.processIdentity,K.supervisionLimits());`);
 const code=await new Promise((done,reject)=>{const child=spawn(process.execPath,[entry],{cwd:f.root,env:process.env,windowsHide:true,stdio:'inherit',timeout:10000});child.once('error',reject);child.once('close',done);});assert.equal(code,0);
 const prior=R.inspectRecovery(f.root);assert.equal(prior.supervisor_process.pid,process.pid);R.cancelRunFromSupervisor(f.root,K.processIdentity);assert.equal(R.inspectRecovery(f.root).cancel_requested,true);assert.throws(()=>R.beginRecovery(f.root,R.inspectRecovery(f.root).revision,K.processIdentity,K.supervisionLimits()),/ENDED/);
 console.log('PASS real parent persists cancellation after child exit; no child token required and subsequent successor refused');
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
