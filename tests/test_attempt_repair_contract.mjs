/** Pure policy boundaries; no workflow, authorization, model or trial. */
import assert from 'node:assert/strict';import {test} from 'node:test';
const {repairRoute,repairCycleLimit,repairableObservedFailure}=await import('../core/tools/aidlc-attempt-repair.ts');
test('code defects preserve TDD while test correction requires a new controlled cycle',()=>{
 assert.equal(repairRoute('code-defect'),'code-generation');assert.equal(repairRoute('test-correction'),'tdd');
 for(const kind of ['scope-change','expected-red','unknown','permission-change','approve'])assert.equal(repairRoute(kind),null);
});
test('same-attempt cycles never exceed the original retry allowance and stop after two',()=>{
 for(const [allowance,expected]of [[0,0],[1,1],[2,2],[5,2]])assert.equal(repairCycleLimit(allowance),expected);
 for(const value of [-1,1.5,NaN,undefined])assert.throws(()=>repairCycleLimit(value));
});
test('functional/UI failures require known candidate serving facts; environment, external and unknown output stay blocked',()=>{
 const version={status:200,body:{candidate_commit:'current'}},ui={version_before:version,version_after:version,visual:{passed:false}};
 assert.equal(repairableObservedFailure({kind:'ui'},ui),true);assert.equal(repairableObservedFailure({kind:'ui'},{...ui,visual:{passed:true},passed:false}),true);
 for(const raw of [{...ui,error:'browser closed'},{...ui,version_after:{status:503}},{...ui,version_after:{status:200,body:{candidate_commit:'other'}}}])assert.equal(repairableObservedFailure({kind:'ui'},raw),false);
 assert.equal(repairableObservedFailure({kind:'command'},{exit_code:0,assertion_results:[{passed:false}]}),true);
 assert.equal(repairableObservedFailure({kind:'command'},{exit_code:1,error:'compile'}),false);
 assert.equal(repairableObservedFailure({kind:'http'},{version_verified:true,actual:{status:500}}),true);
 assert.equal(repairableObservedFailure({kind:'http'},{version_verified:false,actual:{status:500}}),false);
 assert.equal(repairableObservedFailure({kind:'http',dependency_binding:{provider:{external_id:'other-team'}}},{version_verified:true,actual:{status:500}}),false);
});
