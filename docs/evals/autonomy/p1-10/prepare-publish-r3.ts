/** A fresh pre-authorization design revision, preserving the rejected immutable prior version. */
import assert from 'node:assert/strict';import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, existsSync } from 'node:fs';import { join, dirname } from 'node:path';
import { prepare, repository, evaluation, hash, put } from './prepare-pilots';
const sourceKey=process.argv[3]||'publish-r2';assert.ok(['publish-r2','publish-r4','publish-r5','publish-r6'].includes(sourceKey));
const source=join(repository,'.worktrees/aidlc-p1-10-'+sourceKey),sourcePreparation=JSON.parse(readFileSync(join(evaluation,sourceKey,'preparation.json'),'utf8')),comparison=JSON.parse(readFileSync(join(evaluation,'publish-r2/ui-lock-drift-1794195526714.json'),'utf8'));
const corrected=comparison.changes[0];assert.equal(corrected.path,'docs/aidlc/modules/project/inception/ui-design/page-plan.md');assert.equal(hash(corrected.current_content),corrected.current_sha256);
const manifest=await prepare('publish',process.argv[2]||'publish-r4',(target,workflowId)=>{
  const copied:any[]=[];
  const walk=(label:string)=>{for(const e of readdirSync(join(source,label),{withFileTypes:true})){const p=label+'/'+e.name,s=lstatSync(join(source,p));assert.equal(s.isSymbolicLink(),false);if(e.isDirectory())walk(p);else if(!/^ui-generation-(lock|acceptance|checkpoints)\.json$/.test(e.name)&&!(sourceKey==='publish-r6'&&e.name==='acceptance-review.json')){const bytes=readFileSync(join(source,p));mkdirSync(dirname(join(target,p)),{recursive:true});writeFileSync(join(target,p),bytes);copied.push({path:p,source_sha256:hash(bytes)});}}};
  walk('docs/aidlc');
  const adjustments:any[]=[];
  if(sourceKey==='publish-r6'){
    for(const path of ['docs/aidlc/modules/project/inception/development-handoff.md','docs/aidlc/modules/project/inception/cross-validation-report.md','docs/aidlc/modules/project/inception/technical-review.json','docs/aidlc/modules/project/inception/application-design/unit-of-work.md','docs/aidlc/ideation/scenario-module-mapping.md']){const original=join(evaluation,sourceKey,'h4-prior',path);assert.ok(existsSync(original),'Actual pre-H4 Native source required: '+path);writeFileSync(join(target,path),readFileSync(original));}
    const path='docs/aidlc/ideation/module-manifest.json',modules=JSON.parse(readFileSync(join(target,path),'utf8')),own=modules.modules.find((m:any)=>m.module_id==='project');const oldPaths=[...own.paths];own.paths=[...new Set([...own.paths,'src','tests'])];writeFileSync(join(target,path),JSON.stringify(modules,null,2)+'\n');adjustments.push({path,previous_paths:oldPaths,receiving_paths:own.paths,reason:'The same sole project/default unit owns its actual test root as well as source; required before scoped evidence inputs and adoption.'});
    const unitsPath='docs/aidlc/modules/project/inception/unit-manifest.json',units=JSON.parse(readFileSync(join(target,unitsPath),'utf8'));for(const unit of units.units){delete unit.autonomy_version;delete unit.evidence_inputs;}writeFileSync(join(target,unitsPath),JSON.stringify(units,null,2)+'\n');
    const planPath='docs/aidlc/modules/project/inception/plans/unit-of-work-plan.md';writeFileSync(join(target,planPath),readFileSync(join(target,planPath),'utf8').replace('The module manifest owns src/;','The module manifest owns src/ and tests/;'));
  }
  writeFileSync(join(target,corrected.path),corrected.current_content);
  const reviews=['requirements/dependency-review.json','requirements/field-review.json','user-stories/artifact-review.json','user-stories/rule-review.json','ui-design/ui-review.json',...(['publish-r5','publish-r6'].includes(sourceKey)?['technical-review.json']:[])];
  const reviewed=[];
  for(const label of reviews){const path='docs/aidlc/modules/project/inception/'+label,old=JSON.parse(readFileSync(join(target,path),'utf8')),current={...old,workflow_id:workflowId,reviewer:'Codex desktop preparation agent; fresh technical reception of unchanged Native-authored product design'};
    const deferredInputs=Array.isArray(current.inputs)?current.inputs.filter((input:any)=>!existsSync(join(target,input.path))):[];
    if(Array.isArray(current.inputs))current.inputs=current.inputs.filter((input:any)=>existsSync(join(target,input.path))).map((input:any)=>({...input,sha256:hash(readFileSync(join(target,input.path)))}));
    if(deferredInputs.length)current.receiving_workflow_checks_pending=deferredInputs.map((i:any)=>i.path);
    writeFileSync(join(target,path),JSON.stringify(current,null,2)+'\n');reviewed.push({path,old_workflow_id:old.workflow_id,new_workflow_id:workflowId,inputs:current.inputs});
  }
  put(target,'pilot/design-provenance.json',{kind:'pre-authorization-design-revision',source_workflow:sourcePreparation.workflow_id,native_author_thread:sourceKey==='publish-r6'?'01a1becc-c068-7c93-b65d-9c3ff7e21f96':sourceKey==='publish-r5'?'01a1bea6-ce42-7010-abf6-48a4e1a66c7b':sourceKey==='publish-r4'?'01a1be6f-bbd1-7362-a411-e92b18380b3d':'01a1be40-8e3b-78e2-ae1d-5583c0e2fe50',copied_authoring_sources:copied,receiving_ownership_adjustments:adjustments,fresh_technical_reviews:reviewed,corrected_page_plan_sha256:corrected.current_sha256,prior_immutable_lock_retained_in_source:true,controlled_evidence_copied:false,workflow_completion_rows_copied:false,implementation_copied:false,grant_copied:false,business_verified:false});
});
console.log(JSON.stringify({root:manifest.root,workflow_id:manifest.workflow_id,scope:manifest.scope,completed_rows_copied:false,grant_issued:false,business_verified:false}));
