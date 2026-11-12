/** Short real Core/Gateway boundaries with engineering grant fixtures; no model or pilot. */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {createAdmissionFixture} from './helpers/autonomy-admission-fixture';
import {nativeHostDirective} from '../core/tools/aidlc-native-host';
import {checkCurrentExecutionGrant} from '../core/tools/aidlc-execution-grant';
import {autonomyPolicyDirective,projectAutonomyDecisions,assertDecisionProposalTarget} from '../core/tools/aidlc-autonomy-policy';
import {candidateSnapshot,assertCandidate} from '../core/tools/aidlc-observation-inputs';
import {executionInputIdentity} from '../core/tools/aidlc-execution-inputs';
import {readIssuedGrant} from '../core/tools/aidlc-grant-store';
import {Gateway} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-it02-proposals-')),inherited={...process.env};let gateway:any;
try {
  const f=createAdmissionFixture(scratch,'proposal');f.record(f.decision());await f.issue();f.run();
  const binding=f.bindUnit('code-review'),state=f.current(),grant=readIssuedGrant(f.root,state.execution_grant_ref!).grant;
  const core=async(args:string[])=>{
    if(args[2]==='host')return nativeHostDirective(f.root,args.slice(3));
    if(args[2]==='grant'){const op=args[args.indexOf('--operation')+1];checkCurrentExecutionGrant(f.root,[op as any]);return {allowed:true};}
    return autonomyPolicyDirective(f.root,args.slice(2));
  };
  gateway=new Gateway({commands:[]},f.root,{binding,grant},core);gateway.finalizing=true;
  let decisions=projectAutonomyDecisions(f.root),update=(decisions.write_contract as any).updates[0];
  const proposal=update.proposal_path,completed=f.complete({...update.proposal,recorded_by:`${binding.owner}/${binding.session_id}`});
  const git=(args:string[])=>execFileSync('git',args,{cwd:f.root,encoding:'utf8'}).trim();
  git(['add','-A']);git(['-c','user.name=Engineering','-c','user.email=engineering@example.invalid','commit','-qm','before metadata']);
  const candidate=candidateSnapshot(f.root,['src/retry.txt']),before=readFileSync(join(f.root,'docs/aidlc/handoff.md'));
  const originalInputs=executionInputIdentity(f.root,{fixture:'stable'});
  await assert.rejects(()=>gateway.invoke({action:'write',path:'docs/aidlc/decision.json',operation:'design-write',content:JSON.stringify(completed)}),/PROPOSAL_NOT_ISOLATED/);
  await assert.rejects(()=>gateway.invoke({action:'write',path:'docs/aidlc/handoff.md',operation:'design-write',content:'direct metadata replacement'}),/HANDOFF_REQUIRES_CORE_RECORD/);
  await assert.rejects(()=>gateway.invoke({action:'write',path:proposal.replace('/retry-a.json','/nested/foreign.json'),operation:'design-write',content:'{}'}),/UNSAFE|proposal target/);
  assert.throws(()=>assertDecisionProposalTarget(f.root,proposal,{record_id:'foreign'}),/record_id/);
  await assert.rejects(()=>gateway.invoke({action:'write',path:proposal,operation:'code-write',content:'{}'}),/FINALIZATION_ONLY|PROPOSAL_REQUIRES/);
  const invalid={...completed,chosen_option:'a changed product decision'};
  await gateway.invoke({action:'write',path:proposal,operation:'design-write',content:JSON.stringify(invalid)});
  await assert.rejects(()=>gateway.invoke({action:'core',args:['orchestrate','autonomy','record','--input',proposal,'--expect',decisions.handoff_digest!]}),/AUTONOMY_POLICY_INVALID/);
  assert.deepEqual(readFileSync(join(f.root,'docs/aidlc/handoff.md')),before,'Rejected draft cannot merge');
  assertCandidate(f.root,candidate);assert.deepEqual(executionInputIdentity(f.root,{fixture:'stable'}),originalInputs,'Rejected draft cannot change retry or candidate input');
  await gateway.invoke({action:'write',path:proposal,operation:'design-write',content:JSON.stringify(completed)});
  const accepted:any=await gateway.invoke({action:'core',args:['orchestrate','autonomy','record','--input',proposal,'--expect',decisions.handoff_digest!]});
  assert.equal(accepted.autonomy_decisions.completion_blockers.length,0);
  assert.equal(accepted.autonomy_decisions.decisions[0].human_review.status,'pending');
  assert.throws(()=>assertCandidate(f.root,candidate),/CANDIDATE_DIRTY|CANDIDATE_CHANGED/,'Accepted metadata invalidates the old candidate');
  const acceptedInputs=executionInputIdentity(f.root,{fixture:'stable'});
  assert.equal(acceptedInputs.command_digest,originalInputs.command_digest,'Metadata publication cannot reset quality command retries');
  assert.notEqual(acceptedInputs.candidate_input_digest,originalInputs.candidate_input_digest);
  assert.throws(()=>assertDecisionProposalTarget(f.root,'delivery/proposal.json'),/proposal target/);
  git(['add','--','docs/aidlc/handoff.md']);git(['-c','user.name=Engineering','-c','user.email=engineering@example.invalid','commit','-qm','accepted metadata']);
  const final=candidateSnapshot(f.root,['src/retry.txt']);assert.notEqual(final.candidate_id,candidate.candidate_id);
  git(['add','-f','--',proposal]);
  assert.throws(()=>candidateSnapshot(f.root,['src/retry.txt'],true),/CANDIDATE_PROPOSAL_TRACKED/,'Even forced staging cannot admit a draft into a candidate');
  console.log('PASS exact-unit staged proposals, rejection isolation, accepted CAS merge, metadata invalidation and tracked-draft refusal');
} finally {
  gateway?.cancel('engineering-end');await gateway?.reconcile();
  for(const key of Object.keys(process.env))if(!(key in inherited))delete process.env[key];Object.assign(process.env,inherited);
  rmSync(scratch,{recursive:true,force:true});
}
