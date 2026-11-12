/** Engineering protocol checks: plan preparation is read-only and is never business acceptance. */
import assert from 'node:assert/strict';import {mkdtempSync,readdirSync,readFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';import {join,dirname,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {observationFixture,prepareDesign} from './helpers/observation-fixture';import {previewObservationPlan} from '../core/tools/aidlc-observations';
const scratch=mkdtempSync(join(tmpdir(),'aidlc-plan-preview-')),env={...process.env};
const snapshot=(root:string,prefix=''):any=>Object.fromEntries(readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(e=>{const p=prefix?prefix+'/'+e.name:e.name;return e.isDirectory()?Object.entries(snapshot(root,p)):[[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]];}));
try{
 const designRoot=join(scratch,'design');mkdirSync(designRoot);const baselines=await prepareDesign(designRoot);let count=0;
 for(const [name,mutate,expected] of [
  ['complete',undefined,undefined],
  ['flag-only',(plan:any)=>{plan.checks.find((c:any)=>c.kind!=='ui').assertions=[{assertion_id:'flag',pointer:'/passed',op:'equal',expected:true}];},/SUBSTANTIVE_FUNCTION_ASSERTION_REQUIRED/],
  ['page-as-acceptance',(plan:any)=>{const ui=plan.checks.find((c:any)=>c.kind==='ui');ui.covers.push(ui.page_ref);},/OBSERVATION_UNKNOWN_ACCEPTANCE/],
 ] as const){
  const f=observationFixture(scratch,name,{ui:true,designRoot,baselines,mutate});process.env.OBS_ORIGIN='http://127.0.0.1:9';const before=snapshot(f.root);
  if(expected)assert.throws(()=>previewObservationPlan(f.root,'fixtures/observation-plan.json'),expected);
  else{const result=previewObservationPlan(f.root,'fixtures/observation-plan.json');assert.equal(result.check_ids.length,13);assert.equal(result.ui_combination_ids.length,10);assert.equal(result.execution_authorized,false);assert.equal(result.observations_executed,false);assert.equal(result.business_verified,false);}
  assert.deepEqual(snapshot(f.root),before);for(const path of ['.git/aidlc/autonomy','.aidlc/autonomy/grants','.aidlc/evidence/autonomous-observations'])assert.equal(existsSync(join(f.root,path)),false);count++;console.log('PASS pre-grant read-only plan '+name);
 }
 console.log('Observation plan preview: '+count+' engineering scenarios; no grant or business observation');
}finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);assert.equal(resolve(dirname(scratch)),resolve(tmpdir()));rmSync(scratch,{recursive:true,force:true});}
