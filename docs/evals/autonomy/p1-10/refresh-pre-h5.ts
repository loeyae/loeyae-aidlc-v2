/** Refresh actual completed H3 producers at the final frozen scope and tool identity. */
import assert from 'node:assert/strict';import {readFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import {repository,evaluation,put} from './prepare-pilots';import {loadWorkflowState} from '../../../../core/tools/aidlc-light-state';import {bindSession,releaseSession,claimToken} from '../../../../core/tools/aidlc-session';import {modelProjection} from '../../../../harness/codex/runtime/aidlc-codex-host.mjs';
const key=process.argv[2];assert.ok(['orders-r4','orders-r5','orders-r6','orders-r7','orders-r8','orders-r9','publish-r7','publish-r8','publish-r9','publish-r10','publish-r11','publish-r12','publish-r13','orders-r10','publish-r14'].includes(key));const directory=join(evaluation,key),root=JSON.parse(readFileSync(join(directory,'preparation.json'),'utf8')).root,h4=JSON.parse(readFileSync(join(directory,'h4-sealed.json'),'utf8')),out=join(directory,'final-h3-'+Date.now());
const state=loadWorkflowState(root)!;assert.equal(state.execution_grant_version,undefined);assert.equal(Object.keys(state.active_instances).length,0);mkdirSync(out);
for(const k of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[k];
const graph=JSON.parse(readFileSync(join(repository,'core/tools/data/stage-graph.json'),'utf8'));
const results=[];
for(const stage of graph.stages.filter((s:any)=>s.phase==='inception'&&s.produces.some((p:string)=>p.startsWith('.aidlc/evidence/')))){
 const instance=stage.slug+'@module:project';if(!state.completed_stage_instances.includes(instance))continue;
 const held=bindSession(root,{instance,owner:'agent',session:h4.thread_id,expected:claimToken(undefined)}).binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(held);
 try{const args=['evidence','run','--stage',stage.slug,'--module','project','--refresh'],r=spawnSync(process.execPath,[join(repository,'node_modules/tsx/dist/cli.mjs'),join(repository,'bin/cli.ts'),...args],{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});const row={args,exit_code:r.status,stdout:r.stdout,stderr:r.stderr};put(out,stage.slug+'.json',modelProjection(row));assert.equal(r.status,0,r.stderr);results.push({stage:stage.slug,exit_code:r.status});console.log(JSON.stringify({key,refreshed:stage.slug}));}
 finally{const current=loadWorkflowState(root)!.active_instances[instance];if(current?.generation===held.generation)releaseSession(root,instance,claimToken(current));delete process.env.AIDLC_SESSION_BINDING;}
}
put(out,'result.json',{kind:'actual-completed-H3-producer-refresh',workflow_id:state.workflow_id,thread_id:h4.thread_id,results,frozen_authoring_sources_changed:false,stages_reported:false,grant_issued:false,business_verified:false});
