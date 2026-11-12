/** Validate and adopt the prepared finite scope; leave the real terminal H5 unsigned. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { repository, evaluation, put, hash, git } from './prepare-pilots';
import { bindSession, releaseSession, claimToken } from '../../../../core/tools/aidlc-session';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';
import { adoptAutonomyBatch, projectAutonomyScope } from '../../../../core/tools/aidlc-autonomy';
import { autonomyDigest } from '../../../../core/tools/aidlc-autonomy-files';
import { projectAutonomyDecisions } from '../../../../core/tools/aidlc-autonomy-policy';
import { projectAutonomyDependencies } from '../../../../core/tools/aidlc-autonomy-dependencies';
import { prepareExecutionGrant } from '../../../../core/tools/aidlc-execution-grant';
import { developmentAcceptanceErrors } from '../../../../core/tools/aidlc-quality-delivery';
const key='orders-r2',dir=join(evaluation,key),root=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')).root;
const state=loadWorkflowState(root)!;assert.equal(state.autonomy_contract_version,undefined);assert.equal(Object.keys(state.active_instances).length,0);
const h4=JSON.parse(readFileSync(join(dir,'h4-package.json'),'utf8'));
for(const k of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[k];
const binding=bindSession(root,{instance:'workspace-detection',owner:'agent',session:h4.thread_id,expected:claimToken(undefined)}).binding;
process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
try{
  const base='docs/aidlc/modules/project/inception',handoff=base+'/development-handoff.md',batchPath='docs/aidlc/ideation/scenario-module-mapping.md';
  const readRecords=(path:string)=>JSON.parse(readFileSync(join(root,path),'utf8').match(/```aidlc-autonomy\s*\n([\s\S]*?)\n```/)![1]);
  const replaceRecords=(path:string,records:any)=>writeFileSync(join(root,path),readFileSync(join(root,path),'utf8').replace(/```aidlc-autonomy\s*\n[\s\S]*?\n```/,'```aidlc-autonomy\n'+JSON.stringify(records,null,2)+'\n```'));
  put(dir,'h4-package-original.json',h4);
  const records=readRecords(handoff),policy=records.records.find((r:any)=>r.record_type==='policy');policy.authority_ref.scope_summary='orders/1';replaceRecords(handoff,records);
  const inputs=['requirements.md','user-stories.md','development-handoff.md'].map(p=>({path:base+'/'+p,sha256:hash(readFileSync(join(root,base,p)))}));
  for(const p of ['technical-review.json','acceptance-review.json']){const value=JSON.parse(readFileSync(join(root,base,p),'utf8'));value.inputs=inputs;writeFileSync(join(root,base,p),JSON.stringify(value,null,2)+'\n');}
  assert.deepEqual(developmentAcceptanceErrors({root,workflow_id:state.workflow_id,project_workflow_id:state.workflow_id,module_id:'project',stage:'cross-validation',scope:'express',ui_route:'not-selected'} as any),[]);
  writeFileSync(join(root,'README.md'),readFileSync(join(root,'README.md'),'utf8')+'\nAuthorized native implementation must first read pilot/native-run-guide.md. Frozen phase commands execute tests/ucd.cjs with the exact UC-D keys from pilot/ucds.json. No implementation or test file has been supplied as a solved baseline.\n');
  const kernel=createRequire(import.meta.url)(join(repository,'harness/codex/runtime/host-kernel.cjs')),host=kernel.identity(join(root,'pilot/host.json'));
  const request=JSON.parse(readFileSync(join(root,'pilot/grant-request.json'),'utf8'));request.host=host;writeFileSync(join(root,'pilot/grant-request.json'),JSON.stringify(request,null,2)+'\n');
  const batchSource=readRecords(batchPath),batch=batchSource.records[0];batch.policy_ref.digest=autonomyDigest(policy);
  const paths=new Set<string>([...batch.baseline_inputs.map((r:any)=>r.path),'README.md','docs/aidlc/ideation/module-manifest.json',...git(root,['ls-files','--','pilot']).split(/\r?\n/).filter(Boolean)]);
  for(const p of ['pilot/native-run-guide.md','pilot/grant-request.json'])paths.add(p);
  for(const file of readdirSync(join(root,base,'application-design/test-cases')))if(file.endsWith('.md'))paths.add(base+'/application-design/test-cases/'+file);
  batch.baseline_inputs=[...paths].sort().map(path=>({repository_id:'project',path,digest_mode:'raw-file',digest:hash(readFileSync(join(root,path)))}));replaceRecords(batchPath,batchSource);
  git(root,['add','.']);git(root,['-c','user.name=AI-DLC Internal Pilot','-c','user.email=aidlc-pilot@example.invalid','commit','-qm','Validate complete frozen H4 inputs before explicit adoption']);
  adoptAutonomyBatch(root,'orders',loadWorkflowState(root)!.revision);
  const scope=projectAutonomyScope(root),decisions=projectAutonomyDecisions(root),dependencies=projectAutonomyDependencies(root);
  const proposed=prepareExecutionGrant(root,request);
  assert.equal(decisions.policy!.authority_ref.scope_summary,'orders/1');assert.equal(dependencies.admission_ready,true);
  put(dir,'h4-sealed.json',{kind:'actual-h4-sealed',workflow_id:state.workflow_id,thread_id:h4.thread_id,host,scope,decisions,dependencies,baseline_commit:git(root,['rev-parse','HEAD']),request:request,proposal_digest:autonomyDigest(proposed),native_h3_completed:true,operator_grant_issued:false,business_verified:false,at:new Date().toISOString(),note:'The final exact payload and challenge are generated again on the real operator terminal; this file contains no session binding and grants no execution.'});
  console.log(JSON.stringify({h4:'docs/evals/autonomy/p1-10/'+key+'/h4-sealed.json',batch_id:'orders',scope_digest:scope.snapshot!.scope_digest,grant_issued:false}));
}finally{releaseSession(root,binding.stage_instance,claimToken(loadWorkflowState(root)!.active_instances[binding.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;}
