/** Engineering checks for P1-10 evaluators. These are never native model/business acceptance. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ordersOracle, ordersSeed, publishSeed, referenceHtml, hasNoPendingPagePlanItems } from '../docs/evals/autonomy/p1-10/pilot-assets.mjs';
import { safePreworkPath, allowPreworkCore, preworkRoute } from '../docs/evals/autonomy/p1-10/run-prework';
import { CodexClient, commandCatalog, releaseOwnedBindings } from '../harness/codex/runtime/aidlc-codex-host.mjs';
import { createInitialState, saveWorkflowState, loadWorkflowState } from '../core/tools/aidlc-light-state';
import { bindSession, claimToken } from '../core/tools/aidlc-session';
import { usesOperatorConsole } from '../bin/cli';
import { ScopeReader } from '../core/tools/aidlc-autonomy';
import { createHash } from 'node:crypto';
import { publishContract } from '../docs/evals/autonomy/p1-10/publish-contract';
import { evidenceFreshnessBindingErrors } from '../core/tools/aidlc-evidence';
const require=createRequire(import.meta.url),K=require('../harness/codex/runtime/host-kernel.cjs');
const scratch=mkdtempSync(join(tmpdir(),'aidlc-p110-integrity-'));let count=0;
async function test(name: string,fn:()=>unknown){await fn();count++;console.log('PASS '+name);}
try{
  mkdirSync(join(scratch,'knowledge/protocols'),{recursive:true});mkdirSync(join(scratch,'stages'));
  writeFileSync(join(scratch,'knowledge/protocols/common-session-handoff.md'),'exact operator boundary');
  writeFileSync(join(scratch,'knowledge/protocols/private.json'),'not an instruction');
  await test('native rule discovery returns owned Markdown paths and a digest-bound read',()=>{
    assert.deepEqual(K.rule(scratch,'core/knowledge/').files,['knowledge/protocols/common-session-handoff.md']);
    assert.deepEqual(K.rule(scratch,'knowledge/common-session-handoff.md').candidates,['knowledge/protocols/common-session-handoff.md']);
    assert.equal(K.rule(scratch,'knowledge/protocols/common-session-handoff.md').content,'exact operator boundary');
    assert.match(K.rule(scratch,'knowledge/protocols/common-session-handoff.md').sha256,/^[a-f0-9]{64}$/);
  });
  await test('the public CLI preserves the real terminal only for actual operator grant capture',()=>{
    const script='core/tools/aidlc-orchestrate.ts';
    for(const action of ['issue','revoke']){assert.equal(usesOperatorConsole(script,['autonomy','grant',action]),true);assert.equal(usesOperatorConsole(script,['autonomy','grant',action,'--preview']),false);}
    for(const args of [['next'],['report','--result','completed'],['autonomy','grant','check'],['autonomy','grant','bind'],['autonomy','grant','inspect']])assert.equal(usesOperatorConsole(script,args),false);
    assert.equal(usesOperatorConsole('core/tools/aidlc-platform-hook.ts',['autonomy','grant','issue'],'{}'),false);
    assert.equal(usesOperatorConsole(script,['autonomy','grant','issue'],'agent-supplied-input'),false);
  });
  await test('native tool replies retain raw results and refusals while removing private binding fields',async()=>{
    const events:any[]=[],sent:any[]=[],client=Object.create(CodexClient.prototype);
    client.thread='real-thread-shaped-test';client.event=(v:any)=>events.push(v);client.send=(v:any)=>sent.push(v);
    client.tools=async()=>({stdout:'actual process output',binding:{generation:'private-token'},nested:{coordinator_binding:{generation:'private-token'},value:1}});
    await client.receive({id:1,method:'item/tool/call',params:{threadId:client.thread,tool:'aidlc_action',arguments:{action:'command',id:'frozen'}}});
    const first=events.find(v=>v.method==='aidlc/tool/result');assert.equal(first.params.result.stdout,'actual process output');assert.equal(first.params.success,true);assert.equal(JSON.stringify([...events,...sent]).includes('private-token'),false);
    client.tools=async()=>{throw Error('HOST_COMMAND_NOT_FROZEN');};
    await client.receive({id:2,method:'item/tool/call',params:{threadId:client.thread,tool:'aidlc_action',arguments:{action:'command',id:'unknown'}}});
    const last=events.filter(v=>v.method==='aidlc/tool/result').at(-1);assert.equal(last.params.success,false);assert.match(last.params.error,/HOST_COMMAND_NOT_FROZEN/);assert.equal(sent[1].result.success,false);
  });
  await test('the model can discover frozen command IDs without receiving executable arguments or authority',()=>{
    const catalog=commandCatalog({commands:[{id:'oracle',operation:'validation-execute',input_paths:['pilot/oracle.cjs'],write_paths:[],argv:['node','secret-example'],binding:{generation:'private'},grant:'private'}]});
    assert.deepEqual(catalog,[{id:'oracle',operation:'validation-execute',input_paths:['pilot/oracle.cjs'],write_paths:[]}]);
    assert.doesNotMatch(JSON.stringify(catalog),/secret-example|generation|grant/);
  });
  await test('host exit releases only held exact claims through the actual Core CLI and rejects a transferred claim',async()=>{
    const root=join(scratch,'claims');mkdirSync(root);saveWorkflowState(root,createInitialState('express',undefined,'p110-claim-engineering-test',[],'Engineering claim cleanup only'));
    const previous=process.env.AIDLC_SESSION_BINDING;delete process.env.AIDLC_SESSION_BINDING;
    const core=async(args:string[])=>{const r=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('bin/cli.ts'),...args],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
    try{
      const b=bindSession(root,{instance:'workspace-detection',owner:'test',session:'test-cleanup',expected:claimToken(undefined)}).binding;
      process.env.AIDLC_SESSION_BINDING=JSON.stringify(b);
      const clean=await releaseOwnedBindings(core,[b,b]);assert.equal(clean.reconciled,true);assert.deepEqual(clean.released,['workspace-detection']);assert.equal(loadWorkflowState(root)!.active_instances['workspace-detection'],undefined);
      const held=bindSession(root,{instance:'workspace-detection',owner:'test',session:'test-cleanup',expected:claimToken(undefined)}).binding;
      process.env.AIDLC_SESSION_BINDING=JSON.stringify(held);
      const transfer=bindSession(root,{instance:'workspace-detection',owner:'test-other',session:'test-other',expected:claimToken(loadWorkflowState(root)!.active_instances['workspace-detection']),humanInstructionRef:'explicit-simulated-operator-for-engineering-test-only'}).binding;
      const refusal=await releaseOwnedBindings(core,[held]);assert.equal(refusal.reconciled,false);assert.match(refusal.failures[0].error,/CLAIM_CHANGED/);assert.equal(loadWorkflowState(root)!.active_instances['workspace-detection'].generation,transfer.generation);
    }finally{if(previous===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=previous;}
  });
  await test('rule discovery denies traversal, noninstructions and linked files',()=>{
    for(const p of ['../knowledge','core/../knowledge','knowledge/../stages','C:/knowledge','.git/config','knowledge/protocols/private.json'])assert.throws(()=>K.rule(scratch,p));
    linkSync(join(scratch,'knowledge/protocols/private.json'),join(scratch,'knowledge/protocols/linked.md'));
    assert.throws(()=>K.rule(scratch,'knowledge'),/LINKED/);
  });
  await test('prework cannot write implementation, reference designs or control state',()=>{
    for(const p of ['src/any.cjs','tests/any.cjs','design/ready.html','pilot/spec.md','aidlc/active/aidlc-state.md','.aidlc/evidence/fake.json','../outside','.git/config','C:/outside'])assert.throws(()=>safePreworkPath(scratch,p,true));
    assert.equal(safePreworkPath(scratch,'docs/aidlc/inception/requirements.md',true),join(scratch,'docs/aidlc/inception/requirements.md'));
    assert.throws(()=>safePreworkPath(scratch,'docs/aidlc/modules/project/inception/ui-mock/render-reception-1794200759488.json',true),/TOOL_OUTPUT_READ_ONLY/);
    for(const p of ['aidlc/active/aidlc-state.md','.aidlc/private/key','.git/config'])assert.throws(()=>safePreworkPath(scratch,p));
  });
  await test('prework denies approvals, grants, choices, code commands and state recovery',()=>{
    for(const args of [
      ['orchestrate','report','--stage','application-design','--result','approved','--user-input','Approve'],
      ['orchestrate','report','--stage','workspace-detection','--result','completed','--user-input','single-module'],
      ['orchestrate','autonomy','grant','issue'],['orchestrate','state','recover'],['ui','accept','--review-report','../outside.md'],['evidence','run','--command','node evil.cjs'],['orchestrate','next','--scope','express'],['command','anything'],
    ])assert.throws(()=>allowPreworkCore(args));
    allowPreworkCore(['orchestrate','report','--stage','state-template','--result','completed','--instruction-ack','state-template']);
    allowPreworkCore(['evidence','run','--stage','test-case-derivation','--sensor','test-case-derivation','--module','project']);
    allowPreworkCore(['evidence','run','--stage','requirements-analysis','--sensor','traceability-matrix','--module','project','--refresh']);
    allowPreworkCore(['ui','accept','--module','project','--route','html-mock','--review-report','docs/aidlc/modules/project/inception/cross-validation-report.md']);
    allowPreworkCore(['ui','resource-css','--module','project','--html','docs/aidlc/modules/project/inception/ui-mock/content/publish.html']);
    assert.throws(()=>allowPreworkCore(['ui','resource-css','--module','project','--html','src/web.html']));
    assert.throws(()=>allowPreworkCore(['check','--sensor','--unexpected','anything']));
  });
  await test('the real Core print/preview envelope stops preparation before binding an implementation stage',()=>{
    const value={kind:'print',preview:true,stage_instance:'tdd@module:project@unit:default',next_stage:{stage:'tdd',stage_instance:'tdd@module:project@unit:default',approval:'notify'}};
    assert.equal(preworkRoute(value).implementation,true);assert.equal(preworkRoute(value).route.stage,'tdd');
    assert.equal(preworkRoute({...value,next_stage:{...value.next_stage,stage:'test-case-derivation'}}).implementation,false);
    assert.equal(preworkRoute({kind:'run-stage',stage:'code-generation'}).implementation,true);
  });
  const oracleFile=join(scratch,'oracle.cjs');writeFileSync(oracleFile,ordersOracle);const oracle=require(oracleFile);
  const load=(label: string,code: string)=>{const p=join(scratch,label+'.cjs');writeFileSync(p,code);return require(p);};
  await test('frozen order oracle rejects defective seed, reversed rows and swallowed errors',async()=>{
    await assert.rejects(()=>oracle.check(load('seed',ordersSeed).exportOrders,'http://127.0.0.1:1'),assert.AssertionError);
    const reversed=async(up:()=>Promise<any[]>)=>{const rows=(await up()).slice().reverse(),out=[];for(let i=0;i<rows.length;i+=50)out.push(rows.slice(i,i+50));return out;};
    await assert.rejects(()=>oracle.check(reversed,'http://127.0.0.1:1'),assert.AssertionError);
    const mutated=async(up:()=>Promise<any[]>)=>{const rows=(await up()).reverse(),out=[];for(let i=0;i<rows.length;i+=50)out.push(rows.slice(i,i+50));return out;};
    await assert.rejects(()=>oracle.check(mutated,'http://127.0.0.1:1'),assert.AssertionError);
    const swallowed=async(up:()=>Promise<any[]>)=>{try{const rows=await up(),out=[];for(let i=0;i<rows.length;i+=50)out.push(rows.slice(i,i+50));return out;}catch{return [];}};
    await assert.rejects(()=>oracle.check(swallowed,'http://127.0.0.1:1'),assert.AssertionError);
  });
  await test('order oracle cannot pass by printing JSON or omitting the actual upstream',async()=>{
    await assert.rejects(()=>oracle.check(async()=>({status:'passed'}),'http://127.0.0.1:1'));
    const correct=async(up:()=>Promise<any[]>)=>{const rows=await up(),out=[];for(let i=0;i<rows.length;i+=50)out.push(rows.slice(i,i+50));return out;};
    await assert.rejects(()=>oracle.check(correct,undefined),/PILOT_ORIGIN/);
    await assert.rejects(()=>oracle.check(correct,'http://127.0.0.1:1'));
  });
  await test('publish starter is an actual draft defect and reference HTML is independent',()=>{
    assert.equal(load('publish-seed',publishSeed).publish({state:'draft'}).status,200);
    const draft=referenceHtml('draft'),ready=referenceHtml('ready');assert.match(draft,/id="publish" disabled/);assert.match(draft,/Draft cannot publish/);assert.match(ready,/Ready to publish/);assert.doesNotMatch(ready,/<script/);assert.throws(()=>referenceHtml('invented'));
  });
  await test('preparation cannot lock a page plan whose unresolved section contains trailing prose',()=>{
    assert.equal(hasNoPendingPagePlanItems('# Plan\n\n## 未决项\n无\n\nNo hidden decisions.\n\n## Structured source\n{}'),false);
    assert.equal(hasNoPendingPagePlanItems('# Plan\n\n## 未决项\n无\n\n## Review boundaries\nNo hidden decisions.\n\n## Structured source\n{}'),true);
    assert.equal(hasNoPendingPagePlanItems('## 未决项\n无\n\n## 未决项\nnone'),false);
  });
  await test('publish acceptance references resolve all thirteen definitions through the actual Core reader',()=>{
    const root=join(scratch,'publish-refs'),base='docs/aidlc/modules/project/inception';
    mkdirSync(join(root,base,'ui-design'),{recursive:true});mkdirSync(join(root,'pilot'));
    writeFileSync(join(root,base,'requirements.md'),'# REQ-001 Publish\n\nSources: AC-001 / GAP-001\n');
    writeFileSync(join(root,base,'user-stories.md'),Array.from({length:12},(_,i)=>'## AC-'+String(i+1).padStart(3,'0')+' Story acceptance').join('\n'));
    writeFileSync(join(root,base,'ui-design/page-plan.md'),'# PAGE-001 Publish page\n');
    writeFileSync(join(root,'pilot/spec.md'),'# AC-001 Aggregate acceptance\n\n## GAP-001 Diagnostic detail\n');
    const ref=(path:string)=>({repository_id:'project',path,digest_mode:'raw-file',digest:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')});
    // Only source refs are read here; independent image inputs keep their own identity.
    const contract=publishContract(path=>path.startsWith('design/')?{repository_id:'project',path,digest_mode:'raw-file',digest:'a'.repeat(64)}:ref(path),base);
    const reader=new ScopeReader(root,createInitialState('feature',undefined,'publish-source-reference-regression',[],'No business run'));
    assert.equal(reader.items(contract.acceptance,'complete publish acceptance',true).length,13);reader.item(contract.pageRef);
    assert.throws(()=>reader.item({...ref(base+'/requirements.md'),item_id:'AC-001'}),/item is not defined/);
    reader.item({...ref('pilot/spec.md'),item_id:'GAP-001'});
    for(const check of contract.checks)for(const covered of check.covers)reader.item(covered);
    assert.equal(contract.checks.length,10);
    for(const check of contract.checks)assert.ok(check.covers.every((covered:any)=>contract.acceptance.some((a:any)=>JSON.stringify(a)===JSON.stringify(covered))));
  });
  await test('the actual Native allowlist parser rejects absolute executables before an operator grant',()=>{
    const root=join(scratch,'native-plan');mkdirSync(join(root,'.aidlc/commands'),{recursive:true});
    const file=join(root,'.aidlc/commands/tdd.json');
    writeFileSync(file,JSON.stringify({version:'1',stage:'tdd',commands:[{id:'red',role:'red',argv:[process.execPath,'pilot/native-phase.cjs']}]}));
    assert.match(evidenceFreshnessBindingErrors('tdd',{},root).join('\n'),/PATH executable or project-relative/);
    writeFileSync(file,JSON.stringify({version:'1',stage:'tdd',commands:[{id:'red',role:'red',argv:['node','pilot/native-phase.cjs']}]}));
    assert.deepEqual(evidenceFreshnessBindingErrors('tdd',{},root),[]);
  });
  await test('parallel native RPC requests execute serially and a failed request does not poison the queue',async()=>{
    const client:any=Object.create(CodexClient.prototype),sent:any[]=[],order:number[]=[];let active=0,peak=0;
    client.thread='queue-engineering';client.event=()=>{};client.send=(v:any)=>sent.push(v);
    client.tools=async(a:any)=>{active++;peak=Math.max(peak,active);order.push(a.n);try{await new Promise(r=>setTimeout(r,2));if(a.n===2)throw Error('REAL_TEST_REFUSAL');return {n:a.n};}finally{active--;}};
    await Promise.all([1,2,3].map(n=>client.receive({id:n,method:'item/tool/call',params:{threadId:client.thread,tool:'aidlc_action',arguments:{n}}})));
    assert.deepEqual(order,[1,2,3]);assert.equal(peak,1);assert.equal(client.queuedTools,0);assert.deepEqual(sent.map(v=>v.result.success),[true,false,true]);
  });
  await test('native RPC queues are bounded and reject overflow before dispatch',async()=>{
    const client:any=Object.create(CodexClient.prototype),sent:any[]=[];let calls=0;
    client.thread='queue-bound';client.event=()=>{};client.send=(v:any)=>sent.push(v);client.tools=async()=>{calls++;return {ran:true};};
    await Promise.all(Array.from({length:33},(_,id)=>client.receive({id,method:'item/tool/call',params:{threadId:client.thread,tool:'aidlc_action',arguments:{id}}})));
    assert.equal(calls,32);assert.equal(sent.filter(v=>v.result.success===false).length,1);assert.match(JSON.stringify(sent),/HOST_TOOL_QUEUE_LIMIT/);assert.equal(client.queuedTools,0);
  });
  console.log(`Pilot integrity: ${count} engineering scenarios passed; business_verified remains false`);
}finally{assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});}
