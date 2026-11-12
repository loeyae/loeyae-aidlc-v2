/** Correct the independent local pilot's absent origin using actual HEAD, not a fabricated remote. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluation, repository, put, git } from './prepare-pilots';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';
import { bindSession, claimToken, releaseSession } from '../../../../core/tools/aidlc-session';
const dir=join(evaluation,'publish-r2'),manifest=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')),root=manifest.root;
const thread='01a1be40-8e3b-78e2-ae1d-5583c0e2fe50',instance='ui-page-planning@module:project';
assert.equal(Object.keys(loadWorkflowState(root)!.active_instances).length,0);assert.equal(loadWorkflowState(root)!.execution_grant_version,undefined);
assert.equal(existsSync(join(root,'docs/aidlc/modules/project/inception/ui-design/ui-generation-lock.json')),false,'Never overwrite a Native UI lock');
for(const key of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[key];
const binding=bindSession(root,{instance,owner:'agent',session:thread,expected:claimToken(undefined)}).binding;
process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
try{
  const argv=[join(repository,'bin/cli.js'),'ui','lock','--module','project','--route','html-mock','--upstream-ref','HEAD'];
  const r=spawnSync(process.execPath,argv,{cwd:root,env:process.env,encoding:'utf8',timeout:30000,windowsHide:true});
  put(dir,'actual-local-ui-lock.json',{kind:'actual-Core-local-ui-lock',thread_id:thread,workflow_id:manifest.workflow_id,upstream_ref:'HEAD',upstream_commit:git(root,['rev-parse','HEAD']),argv:[process.execPath,...argv],exit_code:r.status,stdout:r.stdout,stderr:r.stderr,operator_grant_issued:false,business_verified:false});
  assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({ui_lock_created:true,upstream_ref:'HEAD',business_verified:false}));
}finally{releaseSession(root,instance,claimToken(loadWorkflowState(root)!.active_instances[instance]));delete process.env.AIDLC_SESSION_BINDING;}
