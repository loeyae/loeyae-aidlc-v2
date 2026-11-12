/** Short within-turn regression. No model, business grant, workflow or pilot. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-progress-read-'));
const context={binding:{stage_instance:'code-generation@module:project@unit:default'},grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}}};
let gateway,reads=0,reason;
try{
 fs.writeFileSync(path.join(root,'same.md'),'unchanged requirement');
 gateway=new Gateway({commands:[]},root,context,async()=>({allowed:true}));
 for(let i=0;i<25;i++){try{await gateway.invoke({action:'read',path:'same.md'});reads++;}catch(error){reason=String(error);break;}}
 assert.ok(reads<25,'Identical successful reads must stop inside one turn, before all 25 actions dispatch');
 assert.match(reason,/HOST_SUPERVISION_/);assert.equal(gateway.budget.failures.size,0,'Successful reads are not failed equivalent retries');
 console.log('PASS repeated successful reads stop within a turn without spending failed-command retries');
}finally{gateway?.cancel('test-end');await gateway?.reconcile();fs.rmSync(root,{recursive:true,force:true});}
