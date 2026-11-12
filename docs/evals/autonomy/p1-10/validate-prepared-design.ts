/** Fresh normal Core validation of received design sources. Never seeds completion/evidence or grants. */
import assert from 'node:assert/strict';import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';import { join } from 'node:path';import { spawnSync } from 'node:child_process';
import { evaluation, repository, put } from './prepare-pilots';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';import { bindSession, releaseSession, claimToken } from '../../../../core/tools/aidlc-session';
import { CodexClient, modelProjection } from '../../../../harness/codex/runtime/aidlc-codex-host.mjs';
import { preworkRoute } from './run-prework';
import { hasNoPendingPagePlanItems } from './pilot-assets.mjs';
const key=process.argv[2];assert.match(key,/^(orders|publish)-r(?:[4-9]|[1-9][0-9]+)$/);
const dir=join(evaluation,key),manifest=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')),root=manifest.root;
const output=join(dir,'prework-'+Date.now());mkdirSync(output);
for(const k of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[k];
const received=process.argv.includes('--received');
const resumeFrom=process.argv.slice(3).find(s=>!s.startsWith('--'));if(resumeFrom)assert.match(resumeFrom,new RegExp(`^${key}/prework-[0-9]+$`));
const prior=resumeFrom?JSON.parse(readFileSync(join(evaluation,resumeFrom,'session.json'),'utf8')):undefined;
const c={...JSON.parse(readFileSync(join(root,'pilot/host-seed.json'),'utf8')),...(prior?{native_config_digest:prior.native_config_digest}:{})};
const log=(file:string,value:unknown)=>appendFileSync(join(output,file),JSON.stringify(modelProjection(value))+'\n');
const client=new CodexClient(c,root,(m:unknown)=>log('native-events.jsonl',m));
const cli=(args:string[])=>{const r=spawnSync(process.execPath,[join(repository,'bin/cli.js'),...args],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024*1024});let result:any;try{result=JSON.parse(r.stdout);}catch{result={stdout:r.stdout};}log('core.jsonl',{argv:args,exit_code:r.status,stderr:r.stderr,result});return {exit_code:r.status,...result};};
const choiceSource=JSON.parse(readFileSync(join(evaluation,'human-design-choices.json'),'utf8'));
let binding:any,reason='prework-incomplete',last:any;
const repairs=new Map<string,number>();
try{
  await client.initialize();const ready=prior?await client.resume(prior.thread_id):await client.prepare();
  put(output,'session.json',{thread_id:client.thread,model:ready.model??prior?.model,native_user_agent:client.nativeUserAgent,native_config_digest:client.nativeDigest,kind:'real-native-session-and-actual-Core-prework',prework_reporter:'Codex desktop preparation agent',not_implementation_grant:true,continues_from:resumeFrom??null});
  if(!prior)put(root,'pilot/host-prepared-'+client.thread+'.json',{...c,native_config_digest:client.nativeDigest});
  for(let step=0;step<64;step++){
    let route=preworkRoute(cli(['orchestrate','next','--preview'])).route;
    if(route.kind==='module-selection'&&route.modules?.length===1)route={...route,...route.modules[0]};last=route;
    if(['tdd','functional-design','code-generation'].includes(route.stage)||!received&&['ui-mock-generation','application-design'].includes(route.stage)){reason='native-design-generation-handoff';break;}
    assert.ok(route.stage_instance,'Exact formal preview required');
    binding=bindSession(root,{instance:route.stage_instance,owner:'agent',session:client.thread,expected:claimToken(loadWorkflowState(root)!.active_instances[route.stage_instance])}).binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
    route=cli(['orchestrate','next']);last=route;
    if(route.kind==='error'){
      const diagnostic=route.repair_diagnostics?.find((d:any)=>d.action==='refresh-evidence'&&!d.requires_human_approval&&d.stage_instance&&d.command?.[1]==='evidence'&&d.command?.[2]==='run');
      assert.ok(diagnostic,'No automatic source/approval/scope repair is authorized: '+route.message);
      const fingerprint=JSON.stringify([diagnostic.stage_instance,diagnostic.sensor,route.repair_guidance?.fingerprint]);const attempts=(repairs.get(fingerprint)||0)+1;repairs.set(fingerprint,attempts);assert.ok(attempts<=2,'No progress in the same receiving-stage diagnostic');
      releaseSession(root,binding.stage_instance,claimToken(loadWorkflowState(root)!.active_instances[binding.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;binding=undefined;
      binding=bindSession(root,{instance:diagnostic.stage_instance,owner:'agent',session:client.thread,expected:claimToken(loadWorkflowState(root)!.active_instances[diagnostic.stage_instance])}).binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
      const result=cli(diagnostic.command.slice(1));assert.equal(result.exit_code,0,'Exact receiving-stage evidence refresh must pass');
      releaseSession(root,binding.stage_instance,claimToken(loadWorkflowState(root)!.active_instances[binding.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;binding=undefined;
      continue;
    }
    assert.ok(route.approval!=='block'||received&&route.stage==='application-design');
    console.log(JSON.stringify({key,stage:route.stage,reporter:'Codex desktop agent',native_evidence:'actual Core producers'}));
    if(route.stage==='ui-page-planning'){
      const plan=readFileSync(join(root,'docs/aidlc/modules/project/inception/ui-design/page-plan.md'),'utf8');
      assert.ok(hasNoPendingPagePlanItems(plan),'Complete the unresolved section before creating an immutable lock');
      if(!existsSync(join(root,'docs/aidlc/modules/project/inception/ui-design/ui-generation-lock.json'))){const lock=cli(['ui','lock','--module','project','--route','html-mock','--upstream-ref','HEAD']);assert.equal(lock.exit_code,0);}
    }
    if(route.stage==='cross-validation'&&received&&!existsSync(join(root,'docs/aidlc/modules/project/inception/ui-design/ui-generation-acceptance.json'))){const acceptance=cli(['ui','accept','--module','project','--route','html-mock','--review-report','docs/aidlc/modules/project/inception/cross-validation-report.md']);assert.equal(acceptance.exit_code,0);}
    if(route.produces?.some((path:string)=>path.replaceAll('\\','/').includes('.aidlc/evidence/'))){const evidence=cli(['evidence','run','--stage',route.stage,...(route.module_id?['--module',route.module_id]:[])]);assert.equal(evidence.exit_code,0,'Current Native producers must pass');}
    if(route.approval==='block'){reason='human-application-review-required';break;}
    const args=['orchestrate','report','--stage',route.stage,'--result','completed',...(route.module_id?['--module',route.module_id]:[])];
    if(route.completion_contract==='instruction_only')args.push('--instruction-ack',route.stage);
    if(route.choices?.length){const selected=choiceSource.choices[route.stage];assert.ok(route.choices.includes(selected));args.push('--user-input',selected);log('human-choices.jsonl',{source_locator:choiceSource.source_locator,stage:route.stage,choice:selected,model_input:false});}
    const report=cli(args);assert.equal(report.exit_code,0,report.message);delete process.env.AIDLC_SESSION_BINDING;binding=undefined;
  }
  put(output,'result.json',{kind:'actual-Core-prepared-design-validation',workflow_id:manifest.workflow_id,thread_id:client.thread,prework_reporter:'Codex desktop preparation agent',native_author_provenance:'pilot/design-provenance.json',end_reason:reason,next_stage:last?.stage,completed_stage_instances:loadWorkflowState(root)!.completed_stage_instances,operator_grant_issued:false,business_verified:false});
  console.log(JSON.stringify({key,output,reason,next_stage:last?.stage,grant_issued:false}));
}catch(e){put(output,'failure.json',{error:String(e),last_stage:last?.stage,thread_id:client.thread,business_verified:false});throw e;}
finally{await client.close();if(binding&&loadWorkflowState(root)!.active_instances[binding.stage_instance])releaseSession(root,binding.stage_instance,claimToken(loadWorkflowState(root)!.active_instances[binding.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;}
