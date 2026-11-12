import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';import {recoverableTransport} from '../harness/codex/runtime/host-recovery.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-p2-gateway-'));fs.mkdirSync(path.join(root,'src'));const events=[];
const c={commands:[]},context={binding:{stage_instance:'code-generation@module:project@unit:default'},grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}}};
const gateway=new Gateway(c,root,context,async()=>({allowed:true}));
gateway.readyInstance=context.binding.stage_instance;
gateway.recovery={operation:async(action,execute)=>{events.push({action,before:fs.existsSync(path.join(root,'src/main.js'))});return execute('stable-key');}};
try{
 await gateway.invoke({action:'write',operation:'code-write',path:'src/main.js',content:'export const value=1;'});
 assert.equal(events.length,1);assert.equal(events[0].before,false);assert.match(events[0].action.input_identity,/^[a-f0-9]{64}$/);assert.match(events[0].action.content_digest,/^[a-f0-9]{64}$/);assert.equal(fs.readFileSync(path.join(root,'src/main.js'),'utf8'),'export const value=1;');
 gateway.recovery.operation=async()=>{throw Error('DURABLE_STORE_UNAVAILABLE');};await assert.rejects(()=>gateway.invoke({action:'write',operation:'code-write',path:'src/main.js',content:'changed'}),/DURABLE_STORE_UNAVAILABLE/);assert.equal(fs.readFileSync(path.join(root,'src/main.js'),'utf8'),'export const value=1;');
 console.log('PASS write reservation binds current input and content before mutation; failed persistence has zero write effect');
 assert.equal(recoverableTransport('Error: HOST_DISCONNECTED',null,true),true);for(const reason of ['user-cancelled','wall-time','step-limit','turn-limit','no-semantic-progress','repeated-action'])assert.equal(recoverableTransport('Error: HOST_DISCONNECTED',reason,true),false);assert.equal(recoverableTransport('Error: HOST_DISCONNECTED',null,false),false);assert.equal(recoverableTransport('failed assertion',null,true),false);
 console.log('PASS only reconciled transport interruption can retry; cancellation, budgets, business defects and unknown resources stop');
}finally{gateway.cancel('test-end');await gateway.reconcile();}
