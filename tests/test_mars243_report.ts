import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createInitialState,saveWorkflowState,loadWorkflowState,lightStatePath} from '../core/tools/aidlc-light-state';
import {saveRegistry} from '../core/tools/aidlc-workflow-layout';
import {bindSession,claimToken} from '../core/tools/aidlc-session';
const project=mkdtempSync(join(tmpdir(),'aidlc-mars243-report-'));
const cli=resolve('bin/cli.ts'),tsx=resolve('node_modules/tsx/dist/cli.mjs');
try {
 const manifest=join(project,'docs/aidlc/ideation/module-manifest.json');mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify({schema_version:1,modules:[{module_id:'m11-recommend',name:'Recommend',service_id:'recommend'}]}));
 const global=createInitialState('feature','4.20.0',undefined,[],'checkpoint fixture');global.workflow_kind='global';global.completed_stages=['module-division'];global.completed_stage_instances=['module-division'];saveWorkflowState(project,global);
 const ref={kind:'module',module_id:'m11-recommend'} as const;
 const state=createInitialState('feature','4.20.0',undefined,[],'module report fixture');state.workflow_kind='module';state.module_id=ref.module_id;state.parent_workflow_id=global.workflow_id;state.current_stage='ui-mock';state.current_stage_instance='ui-mock@module:m11-recommend';state.current_module=ref.module_id;state.completed_stage_instances=['user-stories@module:m11-recommend'];saveWorkflowState(project,state,ref);
 const integration=createInitialState('feature','4.20.0',undefined,[],'integration');integration.workflow_kind='integration';integration.parent_workflow_id=global.workflow_id;saveWorkflowState(project,integration,{kind:'integration'});
 saveRegistry(project,{version:'1',global_workflow_id:global.workflow_id,split_from_workflow_id:global.workflow_id,split_at:new Date().toISOString(),updated_at:new Date().toISOString(),modules:[{module_id:ref.module_id,workflow_id:state.workflow_id,state_path:'aidlc/active/modules/m11-recommend/aidlc-state.md',status:'running',current_stage:state.current_stage_instance,inception_done:false,construction_done:false,owner:'-'}],integration:{workflow_id:integration.workflow_id,state_path:'aidlc/active/integration/aidlc-state.md',status:'running',current_stage:'-',barrier_ready:false,blocking:[]},shared_contracts:[],cross_module_requires:[]});
 const git=(args:string[])=>{const result=spawnSync('git',args,{cwd:project,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;};
 git(['init','-q']);writeFileSync(join(project,'README.md'),'fixture');git(['add','README.md']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
 const binding=bindSession(project,{instance:state.current_stage_instance,owner:'alice',session:'A',expected:claimToken(undefined)}).binding;
 const result=spawnSync(process.execPath,[tsx,cli,'orchestrate','report','--module',ref.module_id,'--stage','ui-mock','--instruction-ack','ui-mock','--result','completed','--user-input','skip'],{cwd:project,encoding:'utf8',env:{...process.env,AIDLC_SESSION_BINDING:JSON.stringify(binding),GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}});
 assert.equal(result.status,0,result.stdout+result.stderr);const response=JSON.parse(result.stdout);
 assert.equal(response.module_checkpoint.status,'created',result.stdout);assert.ok(loadWorkflowState(project,ref)!.completed_stage_instances.includes(state.current_stage_instance));
 assert.ok(git(['show-ref','--verify','refs/heads/aidlc/modules/m11-recommend']).trim());
 console.log('MARS-243 module report/checkpoint finalization passed');
} finally {rmSync(project,{recursive:true,force:true});}
