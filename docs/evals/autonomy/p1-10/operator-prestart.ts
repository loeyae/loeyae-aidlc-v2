/** Read-only first-start guard for an explicitly requested operator retry.
 * Never recovers an attempt, old binding or budget; Core must create a fresh claim. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadWorkflowState } from '../../../../core/tools/aidlc-light-state';
import { readIssuedGrant, validateGrantInputs } from '../../../../core/tools/aidlc-grant-store';
export function inspectUnstartedGrant(root:string,directory:string,request:any,thread:string,scopeDigest:string){
  const state=loadWorkflowState(root)!;assert.equal(state.execution_grant_version,'1');assert.ok(state.execution_grant_ref);
  assert.equal(Object.keys(state.active_instances).length,0,'Never take over or reconstruct a claim');
  const attempts=join(root,'.aidlc/host-runs');assert.ok(!existsSync(attempts)||readdirSync(attempts).length===0,'P1 cannot restart an existing Native attempt');
  assert.equal(existsSync(join(root,'tests/ucd.cjs')),false,'Implementation must never have started');
  const issued=readIssuedGrant(root,state.execution_grant_ref!),grant=issued.grant;
  assert.equal(issued.revoked,false);assert.ok(Date.now()>=Date.parse(grant.issued_at)&&Date.now()<Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000),'Original grant expired');
  assert.equal(grant.run_id,request.run_id);assert.equal(grant.baseline_digest,scopeDigest);assert.equal(grant.successor_policy,'disabled');
  assert.equal(grant.executor_constraints.owner,'agent');assert.equal(grant.executor_constraints.session_id,thread);
  assert.equal(grant.executor_constraints.initial_binding.stage_instance,'workspace-detection');assert.equal(grant.executor_constraints.initial_binding.workflow_id,state.workflow_id);
  for(const [actual,expected] of [[grant.executor_constraints.host,request.host],[grant.allowed_operations,request.allowed_operations],[grant.resource_limits,request.resource_limits],[grant.integration_permissions,request.integration_permissions],[grant.executor_constraints.write_paths,request.write_paths]])assert.deepEqual(actual,expected,'Retry cannot change the signed request');
  assert.equal((Date.parse(grant.expires_at)-Date.parse(grant.request_started_at))/1000,request.lifetime_seconds);
  validateGrantInputs(root,grant.inputs);
  const approvals:any[]=[];
  for(const name of readdirSync(directory).filter(n=>n.startsWith('operator-'+grant.run_id+'-'))){
    const file=join(directory,name,'controller.jsonl');if(!existsSync(file))continue;
    assert.equal(lstatSync(file).isSymbolicLink(),false);
    const bytes=readFileSync(file),events=bytes.toString().trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    assert.ok(!events.some(e=>['native-run-starting','native-run-ended','existing-real-terminal-grant-used-for-first-start'].includes(e.event)),'First start was already dispatched');
    assert.equal(existsSync(join(directory,name,'result.json')),false,'A recorded attempt cannot be retried');
    for(const event of events.filter(e=>e.event==='real-terminal-grant-issued')){assert.equal(event.run_id,grant.run_id);assert.equal(event.scope_digest,scopeDigest);assert.deepEqual(event.host,request.host);assert.equal(events.at(-1)?.event,'owned-service-close');approvals.push({event,operator_directory:name,controller_sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
  assert.equal(approvals.length,1,'Exactly one original actual terminal issuance is required');
  return {ref:state.execution_grant_ref!,expires_at:grant.expires_at,request_started_at:grant.request_started_at,original_approval:approvals[0]};
}
