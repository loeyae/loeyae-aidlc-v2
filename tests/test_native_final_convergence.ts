/** Captured decision tail: small real Git scope checks, no model/pilot execution. */
import assert from 'node:assert/strict';import {readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {fixture,write,git} from './mars244_fixture';
import {phaseExecutionRevision,phaseExecutionScopeForInstance,evidenceScopeForInstance} from '../core/tools/aidlc-workflow-layout';
import {readScopedSourceRevision} from '../core/tools/aidlc-revision';
import {hasBlockingReviewConclusion,reviewAxisErrors,reviewIssueErrors} from '../core/tools/aidlc-evidence-policy';
const captured=JSON.parse(readFileSync(new URL('./fixtures/native-r15-decisions.json',import.meta.url),'utf8')),instance='code-generation@module:shop@unit:api',f=fixture(instance);
const handoff=(row:any,prose='Approved delegation')=>write(f.root,'docs/aidlc/handoff.md',prose+'\n\n```aidlc-autonomy\n'+JSON.stringify({schema:'aidlc.autonomy-source/v1',records:[row]})+'\n```\n');
const digest=()=>phaseExecutionRevision(f.root,instance,[]).scope_digest,ordinary=()=>readScopedSourceRevision(f.root,evidenceScopeForInstance(f.root,instance),[]).scope_digest;
try{
 f.units[0]={...f.units[0],autonomy_version:'1'} as typeof f.units[0];write(f.root,f.base+'/unit-manifest.json',{schema_version:1,module_id:'shop',units:f.units});
 handoff(captured.before);const before=digest(),strictBefore=ordinary();
 handoff(captured.after);assert.equal(digest(),before,'captured implementation/validation publication must not invalidate executed GREEN');assert.notEqual(ordinary(),strictBefore,'ordinary evidence still binds the complete ledger');
 git(f.root,'add','.');git(f.root,'commit','-qm','candidate and completed decision');assert.equal(digest(),before,'candidate commit alone is not an execution-input change');
 for(const [field,value]of Object.entries({chosen_option:'changed behavior',action:'different action',effective_revision:99,policy_clause:'fallback:other',human_review:{status:'rejected'},unit_ref:{module_id:'different'},source_refs:[],unknown_behavior:'new'})){
  handoff({...captured.after,[field]:value});assert.notEqual(digest(),before,field+' must remain bound');
 }
 handoff(captured.after,'Changed approved delegation');assert.notEqual(digest(),before,'surrounding prose is still an input');handoff(captured.after);
 write(f.root,'src/shop/api/code.ts','changed implementation');assert.notEqual(digest(),before,'code changes cannot reuse GREEN');write(f.root,'src/shop/api/code.ts','api');assert.equal(digest(),before);
 write(f.root,f.base+'/requirements.md','changed requirements');assert.notEqual(digest(),before,'requirements remain bound');
 console.log('PASS captured r15 decision completion and candidate commit preserve execution binding; full ledger, policy/choice/human/unknown/prose/code/requirements remain guarded');
 // Legacy/non-versioned scopes receive no new projection or adoption requirement.
 delete (f.units[0] as any).autonomy_version;write(f.root,f.base+'/unit-manifest.json',{schema_version:1,module_id:'shop',units:f.units});
 assert.equal(Object.hasOwn(phaseExecutionScopeForInstance(f.root,instance).projectedInputs||{},'docs/aidlc/handoff.md'),false);
 console.log('PASS unadopted scope does not acquire the autonomous decision projection');
}finally{rmSync(f.root,{recursive:true,force:true});}
for(const text of ['无阻断修复；开放文档建议 1 项。','非阻断建议','不阻断交付','non-blocking suggestion','non blocking suggestion'])assert.equal(hasBlockingReviewConclusion(text),false,text);
for(const text of ['有阻断问题','无阻断修复；仍存在阻断问题','非阻断建议，但 Spec 未通过','blocked','并非无阻断问题','不是无阻断问题','并不是无阻断问题'])assert.equal(hasBlockingReviewConclusion(text),true,text);
assert.ok(reviewAxisErrors('Spec result: failed\nStandards result: passed').length);assert.ok(reviewIssueErrors({issues_found:1,issues_resolved:0,issues_open:1,critical_open:1,important_open:0,suggestion_open:0}).length);
console.log('PASS r15 negation accepted, mixed/real/double-negative blocking conclusions and structured severity still rejected');
