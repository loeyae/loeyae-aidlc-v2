import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
import {createNativeToolChannel,nativeToolAction} from '../harness/codex/runtime/native-tool-channel.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-channel-'));
const context={grant_ref:{version:'1',grant_id:'fixture',run_id:'fixture',digest:'a'.repeat(64)},binding:{stage_instance:'code-generation@module:project@unit:default'},grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1}}};
let gateway,channel,checks=0,qualified=true;
try{
 fs.writeFileSync(path.join(root,'input.md'),'Actual local file read by the ordinary Gateway.');
 gateway=new Gateway({commands:[]},root,context,async()=>{throw Error('public reads must not call Core');});
 // The fixture supplies a trusted qualification function only for transport testing.
 channel=createNativeToolChannel(gateway,{currentConfiguration:()=>({}),qualify:()=>{checks++;if(!qualified)throw Error('qualification changed');return {mode:'native-replacement',deadline_at:gateway.budget.deadline,grant_ref:context.grant_ref};}});
 channel.beginTurn();const result=await channel.replaceTool({name:'read_file',arguments:{path:'input.md'}});assert.equal(result.handled,true);assert.match(result.result.content,/Actual local file/);
 assert.throws(()=>nativeToolAction({name:'shell',arguments:{command:'anything'}}),/UNSUPPORTED/);
 assert.throws(()=>nativeToolAction({name:'run_command',arguments:{id:'frozen',argv:['injected']}}),/UNSUPPORTED/);
 await assert.rejects(channel.replaceTool({name:'read_file',arguments:{path:'../outside.md'}}),/PATH|path|outside|escape/i);
 qualified=false;await assert.rejects(channel.replaceTool({name:'read_file',arguments:{path:'input.md'}}),/qualification changed/);assert.ok(checks>=5);
 channel.endTurn();await channel.close();await assert.rejects(channel.replaceTool({name:'read_file',arguments:{path:'input.md'}}),/CLOSED/);
 assert.equal(channel.approvalMode,'trusted-operator-terminal');console.log('PASS native replacement transport, actual file IO, no second model loop, unsupported native tools/path escape/config change/closed channel refused');
}finally{gateway?.cancel('test-end');await gateway?.reconcile();fs.rmSync(root,{recursive:true,force:true});}
