/** Actual public-CLI pipe refusal in the selected real pilot; no fake TTY or approval. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { evaluation, repository, put, hash } from './prepare-pilots';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';
import { bindSession, releaseSession, claimToken } from '../../../../core/tools/aidlc-session';
const dir=join(evaluation,'orders-r2'),h4=JSON.parse(readFileSync(join(dir,'h4-sealed.json'),'utf8'));
const root=JSON.parse(readFileSync(join(dir,'preparation.json'),'utf8')).root;
assert.equal(loadWorkflowState(root)!.execution_grant_version,undefined);assert.equal(Object.keys(loadWorkflowState(root)!.active_instances).length,0);
for(const key of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[key];
const K=createRequire(import.meta.url)(join(repository,'harness/codex/runtime/host-kernel.cjs'));
const request={...JSON.parse(readFileSync(join(root,'pilot/grant-request.json'),'utf8')),host:K.identity(join(root,'pilot/host.json'))};
const path='pilot/pipe-refusal-request.json';put(root,path,request);
const original=hash(readFileSync(join(root,'src/orders.cjs')));
const binding=bindSession(root,{instance:'workspace-detection',owner:'agent',session:h4.thread_id,expected:claimToken(undefined)}).binding;
process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);process.env.AIDLC_AUTONOMY_HOST=JSON.stringify(request.host);
try{
  const argv=[join(repository,'bin/cli.js'),'orchestrate','autonomy','grant','issue','--input',path];
  const r=spawnSync(process.execPath,argv,{cwd:root,env:process.env,stdio:['pipe','pipe','pipe'],encoding:'utf8',windowsHide:true,timeout:30000});
  assert.notEqual(r.status,0);assert.match(r.stderr,/interactive operator terminal|operator terminal|interactive.*terminal/i);
  assert.equal(loadWorkflowState(root)!.execution_grant_version,undefined);assert.equal(hash(readFileSync(join(root,'src/orders.cjs'))),original);
  put(dir,'actual-pipe-refusal.json',{kind:'actual-public-cli-authorization-refusal',workflow_id:h4.workflow_id,argv:[process.execPath,...argv],exit_code:r.status,stdout:r.stdout,stderr:r.stderr,stdin:'actual pipe; no approval text supplied',tty_simulation:false,grant_issued:false,implementation_started:false,source_unchanged:true,at:new Date().toISOString()});
  console.log(JSON.stringify({actual_public_cli_pipe_refused:true,grant_issued:false,source_unchanged:true}));
}finally{releaseSession(root,binding.stage_instance,claimToken(loadWorkflowState(root)!.active_instances[binding.stage_instance]));delete process.env.AIDLC_SESSION_BINDING;delete process.env.AIDLC_AUTONOMY_HOST;}
