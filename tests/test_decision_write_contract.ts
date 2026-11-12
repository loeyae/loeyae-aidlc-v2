/** Read-only contract generation and existing semantic gates; fixture evidence is not business proof. */
import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {createAutonomyFixture} from './helpers/autonomy-fixture';import {projectAutonomyDecisions} from '../core/tools/aidlc-autonomy-policy';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-decision-contract-')),old=process.env.AIDLC_SESSION_BINDING;
try{
 const f=createAutonomyFixture(scratch,'contract');f.freeze();f.record(f.decision());const handoff=readFileSync(join(f.root,'docs/aidlc/handoff.md'));
 const projection=projectAutonomyDecisions(f.root),contract=projection.write_contract as any;
 assert.equal(contract?.schema,'aidlc.decision-write-contract/v1','The model must receive the actual Core write contract');assert.equal(projection.execution_authorized,false);assert.equal(contract.handoff_path,'docs/aidlc/handoff.md');assert.equal(contract.expected_handoff_digest,projection.handoff_digest);
 const update=contract.updates[0];assert.deepEqual(update.required_check_ids,['recoverable']);assert.equal(update.proposal.revision,2);assert.equal(update.proposal.effective_revision,1);assert.deepEqual(update.proposal.human_review,{status:'pending'});
 assert.deepEqual(Object.keys(update.runtime_validation_templates[0]).sort(),['batch_id','check_id','digest','path','sensor','stage_instance','workflow_id']);assert.equal(update.runtime_validation_templates[0].check_id,'recoverable');assert.equal(update.runtime_validation_templates[0].batch_id,'publish');assert.equal(update.runtime_validation_templates[0].workflow_id,f.current().workflow_id);
 const completed=f.complete(structuredClone(update.proposal));const recorded=f.record(completed);assert.equal(recorded.completion_blockers.length,0);assert.equal(recorded.decisions[0].human_review.status,'pending');assert.notEqual(recorded.decisions[0].record_status,'verified');
 const next=projectAutonomyDecisions(f.root).write_contract as any;const bad=structuredClone(next.updates[0].proposal);bad.validation_refs=[{check_id:'recoverable',evidence_ref:{}}];assert.throws(()=>f.record(bad),/unsupported fields/);
 const badCheck=structuredClone(next.updates[0].proposal);badCheck.validation_refs[0].check_id='invented';assert.throws(()=>f.record(badCheck),/real batch check/);
 const before=readFileSync(join(f.root,'docs/aidlc/handoff.md'));projectAutonomyDecisions(f.root);assert.deepEqual(readFileSync(join(f.root,'docs/aidlc/handoff.md')),before);assert.notDeepEqual(before,handoff);
 console.log('PASS Core-derived decision contract preserves immutable fields, real checks, raw evidence rules and pending review without granting execution');
}finally{if(old===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=old;assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});}
