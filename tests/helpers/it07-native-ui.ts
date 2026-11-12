/** Explicit engineering design/reviewer fixture. Evidence is produced by Core,
 * never prewritten as passed; no real operator approval is represented here. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {put,ref,design} from './observation-fixture';
import {bindSession,claimToken,releaseSession} from '../../core/tools/aidlc-session';
import {renderLightWorkflowState} from '../../core/tools/aidlc-light-state';
import {createUiGenerationLock,createUiGenerationAcceptance,verifyUiGenerationAcceptance} from '../../core/tools/aidlc-ui-governance';
import {designResourceStyle,resolveDesignResource} from '../../core/tools/aidlc-design-resource';

export const nativeUiSensors=['ui-artifact-consistency','ui-behavior-consistency','no-todo','traceability'];
export function prepareNativeUi(f:any,plan:any) {
 const root=f.root,base='docs/aidlc/modules/orders/inception',unit='docs/aidlc/modules/orders/construction/publish',now=new Date().toISOString();
 put(root,base+'/user-stories.md','# US-001 Publish and inspect ordered data\nSource: REQ-001\nAs an editor I publish ready items, see recoverable failures, retry and follow the actual result.\n\n## AC-001\nPreserve ordered pagination and the approved PAGE-001 behavior at both sizes.\n');
 put(root,base+'/ui-design/page-plan.md',`# Engineering UI preparation\n\n## 页面清单\n| ID | 来源 | 目标代码文件 | 角色 | 状态 |\n| --- | --- | --- | --- | --- |\n| PAGE-001 | REQ-001 US-001 AC-001 | src/web.js | editor | ready, draft, published, error, retry |\n\n## 页面内容契约\nPAGE-001 REQ-001 US-001 AC-001: Publish item heading, publish button, result feedback and result link. Preserve the independent HTML/PNG design at widths 800 and 390.\n\n## 操作闭环\nPAGE-001 US-001 AC-001: ready POST /publish succeeds; draft is disabled; failure shows Retry; retry succeeds; result link reads GET /result.\n\n## 未决项\n无\n`);
 put(root,base+'/ui-mock/page-specs.md','# PAGE-001 REQ-001 US-001 AC-001\nThe independent design directory defines ready/draft/published/error at 800 and 390; retry ends published. Use real API and result navigation.\n');
 const mock=design('ready').replace('<head>','<head>'+designResourceStyle(resolveDesignResource(root,'orders'))).replace('<main ','<main id="mock-PAGE-001" ');
 put(root,base+'/ui-mock/page-001.html',mock+'<!-- REQ-001 US-001 AC-001 PAGE-001 -->');
 put(root,base+'/ui-mock/ui-mock-manifest.json',{schema_version:'1',design_mode:'html-mock',page_plan:base+'/ui-design/page-plan.md',phases:Object.fromEntries(['skeleton','content'].map(k=>[k,{status:'validated',page_ids:['PAGE-001'],reviewed_at:now}])),pages:[{page_id:'PAGE-001',page_specs:base+'/ui-mock/page-specs.md',html:base+'/ui-mock/page-001.html',mock_box_id:'mock-PAGE-001',requirements:['REQ-001'],stories:['US-001']}],unresolved:[]});
 // The mapped JS module is the page actually served, with an equivalent design
 // token used by button/link CSS. Independent PNG bytes and tolerances stay fixed.
 const html=readFileSync(join(root,'src/web.html'),'utf8').replace('<style>','<style>:root{--publish-primary:#2159c5}').replace('background:#2159c5','background:var(--publish-primary)').replace('a{color:#2159c5}','a{color:var(--publish-primary)}');
 put(root,'src/web.js','// PAGE-001 REQ-001 US-001 AC-001 UC-D-001\nexports.html='+JSON.stringify(html)+';\n');
 const old="fs.readFileSync('src/web.html')",server=readFileSync(join(root,'src/server.cjs'),'utf8');assert.ok(server.includes(old));put(root,'src/server.cjs',server.replace(old,"require(require('node:path').resolve('src/web.js')).html"));
 if(!plan.candidate_artifact_paths.includes('src/web.js'))plan.candidate_artifact_paths.push('src/web.js');
 const codePlan=unit+'/plans/code-generation-plan.md';
 put(root,codePlan,readFileSync(join(root,codePlan),'utf8')+'\n## 页面对照表\nPAGE-001 -> src/web.js; render the approved heading, button and result using the real POST /publish and GET /result. US-001 AC-001.\n');
 const review=unit+'/code-review.md';if(existsSync(join(root,review)))put(root,review,readFileSync(join(root,review),'utf8').replace('"src/web.html"','"src/web.html","src/web.js"'));
 const report=base+'/ui-design/engineering-acceptance.md';
 put(root,report,`# Seeded engineering design review; no human/business approval\nREQ-001 US-001 AC-001 PAGE-001\n\n## Machine consistency summary\n- status: passed\n- unresolved_conflicts: 0\n- prd_route: not-selected\n- ui_route: html-mock\n\n## UI requirement freshness\n- checked_at: ${now}\n- synchronized_pages: none\n\n## UI full acceptance\n- run_id: ENGINEERING-UIA-001\n- completed_at: ${now}\n- result: passed\n- reviewed_pages: PAGE-001\n- issue_pages: none\n`);
 const state=f.current();state.history.push({timestamp:now,stage:'ui-mock',instance_id:'ui-mock@module:orders',module_id:'orders',result:'completed',user_input:'html-mock'});
 put(root,'aidlc/active/aidlc-state.md',renderLightWorkflowState(state));
 const saved=process.env.AIDLC_SESSION_BINDING,instance='ui-page-planning@module:orders';
 const binding=bindSession(root,{instance,owner:'agent',session:'test-session',expected:claimToken(undefined)}).binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
 try {
  for(const args of [['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','engineering Native UI design inputs']]){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  createUiGenerationLock(root,{moduleId:'orders',route:'html-mock',upstreamRef:'HEAD'});
  createUiGenerationAcceptance(root,{moduleId:'orders',route:'html-mock',reportPath:report});
  verifyUiGenerationAcceptance(root,'orders','html-mock',['PAGE-001']);
  for(const p of ['user-stories.md','ui-design/page-plan.md','ui-design/ui-generation-lock.json','ui-design/ui-generation-acceptance.json','ui-mock/ui-mock-manifest.json','ui-mock/page-specs.md','ui-mock/page-001.html','ui-design/engineering-acceptance.md'])f.batch.baseline_inputs.push(ref(root,base+'/'+p));
 } finally {releaseSession(root,instance,claimToken(f.current().active_instances[instance]));if(saved===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=saved;}
}
