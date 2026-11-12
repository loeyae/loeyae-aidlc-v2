/** Actual CodexClient wire + Gateway + owned Node command. Scripted RPC, no model/H5. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {CodexClient,Gateway,supervisedTurn,driveBatch} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-progress-rpc-')),server=path.join(scratch,'rpc.js');
fs.writeFileSync(server,`const rl=require('node:readline').createInterface({input:process.stdin});let serial=1000,active=false,mode,turn;
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n'),complete=status=>{active=false;send({method:'turn/completed',params:{threadId:'engineering-thread',turn:{id:turn,status}}});};
const tool=()=>{if(active)send({id:++serial,method:'item/tool/call',params:{threadId:'engineering-thread',tool:'aidlc_action',arguments:mode==='long'||mode==='early-long'?{action:'command',id:'known-long'}:{action:'read',path:'input.md'}}});};
rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{userAgent:'scripted-engineering-wire'}});if(m.method==='initialized')return;if(m.method==='config/read')return send({id:m.id,result:{config:{}}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'engineering-thread'}}});
if(m.method==='turn/start'){mode=m.params.input[0].text.startsWith('Execute only')?'loop':m.params.input[0].text;active=true;turn='turn-'+serial;send({id:m.id,result:{turn:{id:turn}}});if(mode==='loop'||mode==='long')setImmediate(tool);if(mode==='early-long')setImmediate(()=>{tool();complete('completed');});return;}
if(m.method==='turn/interrupt'){send({id:m.id,result:{}});if(mode!=='unknown')complete('interrupted');return;}
if(m.id>1000&&active){if(mode==='long')complete('completed');else if(mode==='loop')setImmediate(tool);}});`);
let cases=0;
try {
 for(const mode of ['loop','idle','long','unknown','driver-loop','early-long','insufficient-budget']){
  const root=path.join(scratch,mode);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'input.md'),'PROGRESS_SECRET_CONTENT');
  const limits={idle_timeout_ms:300,turn_timeout_ms:1000,interrupt_grace_ms:150,max_repeated_actions:3};
  const config={codex_entrypoint:server,supervision_limits:limits,commands:[{id:'known-long',operation:'validation-execute',timeout_ms:2000,input_paths:['input.md'],write_paths:[],argv:[process.execPath,'-e','setTimeout(()=>console.log("real command completed"),600)']}]};
  const client=new CodexClient(config,root);let gateway;
  try{
   await client.initialize();await client.start();
   // The original 20s fixture is below the two publication margins and must
   // be rejected. Keep that negative case; legal long-command cases need a
   // feasible fixture grant from the start, never an extension during a turn.
   const start=Date.now(),grantSeconds=mode==='long'||mode==='early-long'?60:20,context={binding:{stage_instance:'code-generation@module:project@unit:default',generation:'PRIVATE_GENERATION'},grant:{executor_constraints:{initial_binding:{stage_instance:'workspace-detection'}},request_started_at:new Date().toISOString(),expires_at:new Date(start+grantSeconds*1000).toISOString(),resource_limits:{wall_time_seconds:grantSeconds,max_equivalent_retries:1,max_active_units:1}}};
   const events=[],core=async args=>{
    if(args[1]==='next')return {kind:'run-stage',stage_instance:context.binding.stage_instance,approval:'notify'};
    if(args[2]==='admission')return {autonomous_admission:{admission_result:'ready',valid_until:new Date(Date.now()+900000).toISOString()}};
    if(args[2]==='host')return {host_context:{binding:context.binding,progress_digest:'static-authoritative-state',implementation_units:[],execution_inputs:{schema:'aidlc.execution-input-identity/v1',command_digest:'a'.repeat(64)}}};
    return {allowed:true};
   };
   const toolResults=[];
   gateway=new Gateway(config,root,context,core,e=>events.push(e));gateway.requireAdmissionWindow=async()=>{gateway.admissionDeadline=Date.now()+900000;};client.tools=async a=>{try{const result=await gateway.invoke(a);toolResults.push(result);return result;}catch(error){toolResults.push({error:String(error)});throw error;}};const deadline=gateway.budget.deadline;
   if(mode==='driver-loop'){
    assert.equal(await driveBatch(config,context,core,client,gateway),'repeated-action');assert.equal(client.lastTurnStatus,'interrupted');assert.equal(gateway.progress.turns,1);
   }else if(mode==='insufficient-budget'){
    const turn=await supervisedTurn(client,gateway,'long',gateway.abort.signal,20000);assert.equal(turn.status,'completed');assert.deepEqual(toolResults,[{error:'Error: HOST_BUDGET_INSUFFICIENT_FOR_PUBLICATION'}]);assert(!events.some(e=>e.status==='dispatched'));
   }else if(mode==='long'||mode==='early-long'){
    const turn=await supervisedTurn(client,gateway,mode,gateway.abort.signal,20000);assert.equal(turn.status,'completed');assert.equal(gateway.budget.stopped,null);assert.equal(toolResults.length,1);assert.equal(toolResults[0].status,'succeeded',JSON.stringify(toolResults));assert.ok(Date.now()-start>=600);assert.equal(gateway.progress.steps,1);
   }else{
    await assert.rejects(()=>supervisedTurn(client,gateway,mode,gateway.abort.signal,20000),error=>error.host_stop_reason===(mode==='loop'?'repeated-action':'no-semantic-progress'));
    assert.equal(client.lastTurnStatus,mode==='unknown'?'unknown':'interrupted','Only actual turn/completed reconciles interruption');
    if(mode==='loop'){assert.equal(gateway.budget.failures.size,0);assert.ok(gateway.progress.steps<=4);}
   }
   assert.equal(gateway.budget.deadline,deadline);assert.equal(gateway.pending.size,0);assert.equal(gateway.unknown.length,0);
   const trace=events.filter(e=>e.kind==='execution-trace').map(e=>e.trace),serialized=JSON.stringify(trace);assert.doesNotMatch(serialized,/PROGRESS_SECRET_CONTENT|PRIVATE_GENERATION|"(?:generation|argv)"\s*:/);
   const summary=gateway.trace.summary();assert.equal(summary.active_spans,0);assert.ok(Math.abs(Object.values(summary.phases_ms).reduce((a,b)=>a+b,0)-summary.wall_duration_ms)<0.01);
   if(mode==='long'||mode==='early-long')assert.ok(summary.phases_ms.producer>=600);
   if(process.env.AIDLC_EVAL_DIR){fs.mkdirSync(process.env.AIDLC_EVAL_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.AIDLC_EVAL_DIR,mode+'.json'),JSON.stringify({kind:'scripted-wire-engineering',mode,business_verified:false,steps:gateway.progress.steps,stop_reason:gateway.budget.stopped,native_turn_status:client.lastTurnStatus,original_deadline_unchanged:gateway.budget.deadline===deadline,timing:summary,trace},null,2)+'\n');}
   console.log('PASS actual wire '+mode);cases++;
  }finally{gateway?.cancel('engineering-end');await gateway?.reconcile();await client.close();assert.equal(client.nativeClosed,true);}
 }
 console.log('Host progress transport: '+cases+' engineering scenarios passed');
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
