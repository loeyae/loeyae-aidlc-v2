import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";
import { frontendPlatformPayload } from "../core/tools/aidlc-frontend-platform";
import { loadGraph } from "../core/tools/aidlc-orchestrate";

const repo=resolve(import.meta.dirname,".."), tsx=join(repo,"node_modules/tsx/dist/cli.mjs");
const scratch=mkdtempSync(join(tmpdir(),"aidlc-mars251-"));
const put=(root:string,path:string,value:unknown)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==="string"?value:JSON.stringify(value));};
function git(root:string,...args:string[]) {const r=spawnSync("git",args,{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function project(name:string) {
 const root=join(scratch,name);mkdirSync(root);put(root,"README.md","Policy regression fixture\n");
 git(root,"init","-q");git(root,"add","README.md");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","baseline");
 saveFixtureState(root,createInitialState("express","4.22.3",`mars251-${name}`,[],"policy regression"));return root;
}
function run(root:string,args:string[],ok=true) {
 if(args.includes("--refresh")&&!args.includes("--instance")) {const slug=args[args.indexOf("--stage")+1],axis=loadGraph().stages.find(x=>x.slug===slug)!.axis;args=[...args,"--instance",slug+(axis!=="project"?"@module:project":"")+(axis==="unit"?"@unit:default":"")];}
 const r=spawnSync(process.execPath,[tsx,join(repo,"bin/cli.ts"),...args],{cwd:root,encoding:"utf8",env:fixtureEnvironment(root,args)});
 assert.equal(r.status===0,ok,`${args.join(" ")}\n${r.stdout}\n${r.stderr}`);return r.stdout+r.stderr;
}
function probe(root:string,path="src/",delta=false) {
 const r=spawnSync(process.execPath,[tsx,join(repo,"tests/mars251_artifact_probe.ts"),path,...delta?["--delta"]:[]],{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const specPath="docs/aidlc/modules/project/construction/default/frontend-platform-spec.md";
const platformPath="docs/aidlc/modules/project/inception/application-design.md";
const componentsPath="docs/aidlc/modules/project/inception/application-design/frontend-components.md";
const spec="# 平台规范\n运行时: React Native\n样式方案: StyleSheet\n## 布局原语\n| 视觉意图 | 目标组件 |\n|---|---|\n| 垂直排列 | View |\n## 组件映射参考\n| UI 概念 | 目标组件 |\n|---|---|\n| 标题 | Text |\n| 提交 | Button |\n## CSS/样式约束\n| 禁止写法 | 原因 | 替代方案 |\n|---|---|---|\n| display:grid | 运行时不支持 | flex |\n";
const prose="# 应用设计\n运行时: React Native\n样式方案: StyleSheet\n采用 View 垂直布局，Text 显示标题，Button 提交；不支持 grid，使用 flex。\n";
function projection(source=platformPath,text=prose) {
 return "\n```frontend-source-projection\n"+JSON.stringify({source,source_sha256:createHash("sha256").update(text).digest("hex"),complete:true,rows:[
  {kind:"layout_primitives",cells:["垂直排列","View"],quote:"View 垂直布局"},
  {kind:"component_mapping",cells:["标题","Text"],quote:"Text 显示标题"},
  {kind:"component_mapping",cells:["提交","Button"],quote:"Button 提交"},
  {kind:"css_constraints",cells:["display:grid","运行时不支持","flex"],quote:"不支持 grid，使用 flex"},
 ]})+"\n```\n";
}
function activate(root:string,slug:string) {
 const axis=loadGraph().stages.find(x=>x.slug===slug)!.axis,s=loadWorkflowState(root)!;s.current_stage=slug;s.current_phase=slug==="test-case-derivation"?"inception":"construction";s.current_module=axis!=="project"?"project":undefined;s.current_unit=axis==="unit"?"default":undefined;s.current_stage_instance=slug+(axis!=="project"?"@module:project":"")+(axis==="unit"?"@unit:default":"");saveFixtureState(root,s);
}
function uiGate(root:string) {
 const r=spawnSync(process.execPath,[tsx,join(repo,"tests/mars249_sensor_runner.ts"),"frontend-platform-spec","--select-stage"],{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).failures;
}
try {
 if (!process.argv.includes("--route-only")) {
 const root=project("source");put(root,"src/main.js","console.log(1)\n");git(root,"add","src/main.js");
 const executed=spawnSync(process.execPath,["src/main.js"],{cwd:root,encoding:"utf8"});assert.equal(executed.status,0);assert.equal(executed.stdout.trim(),"1");
 assert.deepEqual(probe(root),{produces:[],consumes:[],sensors:[]},"15-byte tracked executable passes both gates and no-todo");
 put(root,"src/main.js",";console.log(1)\n");assert.equal(probe(root).produces.length,0,"semicolon-prefixed code is not an empty comment");
 put(root,"src/main.js","");put(root,"src/flag.h","#define X 1\n");git(root,"add","src/flag.h");assert.equal(probe(root).produces.length,0,"small header declarations are substantive source");rmSync(join(root,"src/flag.h"));
 for(const content of ["", "   \n", "// placeholder padded sufficiently to exceed old threshold\n", "TODO\n"]) {
  put(root,"src/main.js",content);const p=probe(root);assert.ok(p.produces.length&&p.consumes.length,content);
 }
 put(root,"src/main.js","console.log(1)\n");put(root,"src/pending.js","// TODO: required implementation\n");
 assert.ok(probe(root).sensors.some((failure:{sensor:string})=>failure.sensor==="no-todo"),"comment-only TODO files remain scanned next to real source");rmSync(join(root,"src/pending.js"));
 put(root,"src/config.json","{}\n");git(root,"add","src/config.json");rmSync(join(root,"src/main.js"));
 assert.equal(probe(root).produces.length,0,"legal small configuration is substantive");
 assert.equal(probe(root,"src/config.json").consumes.length,0);
 put(root,"src/config.json","{");assert.ok(probe(root).produces.length,"invalid config rejected");rmSync(join(root,"src/config.json"));
 put(root,"src/untracked.js","console.log(1)\n");assert.equal(probe(root).produces.length,0,"existing tracked-plus-untracked-not-ignored policy is preserved");rmSync(join(root,"src/untracked.js"));
 put(root,".gitignore","src/ignored.js\n");put(root,"src/ignored.js","console.log(1)\n");git(root,"add","-f","src/ignored.js");assert.ok(probe(root).produces.length);
 writeFileSync(join(root,"src/binary.bin"),Buffer.from([0,1,2,3]));git(root,"add","src/binary.bin");assert.ok(probe(root).produces.length);
 put(root,"notes.md","# A long heading cannot substitute for delivery\n");assert.ok(probe(root,"notes.md").produces.length);
 put(root,"notes.md","# Notes\nConcrete documented behavior and validation results.\n");assert.equal(probe(root,"notes.md").produces.length,0);
 assert.match(probe(root,"../escape/").error,/escape|outside/i);
 const delta=project("delta");put(delta,"src/old.js","console.log(0)\n");put(delta,"src/keep.js","console.log(1)\n");git(delta,"add","src");git(delta,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","sources");
 const ds=loadWorkflowState(delta)!;ds.baseline_commit=git(delta,"rev-parse","HEAD");ds.baseline_source="created";saveFixtureState(delta,ds);
 assert.ok(probe(delta,"src/",true).produces.length,"unchanged existing source cannot satisfy unit delta");
 rmSync(join(delta,"src/old.js"));assert.ok(probe(delta,"src/",true).produces.length,"deletion without baseline/requirement/behavior ownership evidence cannot claim a delivery; verified removals are covered in MARS-252");
 put(delta,"src/keep.js","console.log(2)\n");assert.equal(probe(delta,"src/",true).produces.length,0,"deletion plus real small source delta stays valid");
 put(delta,"src/keep.js","// padded placeholder only, no actual implementation\n");assert.ok(probe(delta,"src/",true).produces.length,"comment-only changed source is not a delivery");
 console.log("PASS source/config/document positive and negative produces/consumes and no-todo");

 const ui=project("bridge");put(ui,specPath,spec);assert.equal(frontendPlatformPayload(ui,specPath,"project").coverage_basis,"legacy-spec-tables");
 put(ui,platformPath,prose);assert.throws(()=>frontendPlatformPayload(ui,specPath,"project"),/coverage cannot be derived/);
 put(ui,specPath,spec+projection());assert.equal(frontendPlatformPayload(ui,specPath,"project").coverage_basis,"approved-source-projection");
 const synonymous=prose.replace("垂直布局","按列布局").replace("显示标题","呈现标题");
 put(ui,platformPath,synonymous);put(ui,specPath,spec+projection(platformPath,synonymous).replace("View 垂直布局","View 按列布局").replace("Text 显示标题","Text 呈现标题"));
 assert.equal(frontendPlatformPayload(ui,specPath,"project").status,"passed","synonymous prose needs no upstream table rewrite");
 put(ui,platformPath,prose);put(ui,specPath,spec+projection());
 activate(ui,"ui-implementation-bridge");
 run(ui,["evidence","run","--stage","ui-implementation-bridge","--sensor","frontend-platform-spec"]);assert.equal(uiGate(ui).length,0);
 for(const content of [spec.replace("| 提交 | Button |\n","")+projection(),spec.replace("| display:grid | 运行时不支持 | flex |\n","")+projection(),spec+projection().replace('"complete":true','"complete":false')]) {
  put(ui,specPath,content);run(ui,["evidence","run","--stage","ui-implementation-bridge","--sensor","frontend-platform-spec"],false);assert.ok(uiGate(ui).length);
 }
 put(ui,specPath,spec+projection());put(ui,platformPath,prose+"必须保留搜索组件。\n");assert.ok(uiGate(ui).length,"source drift rejects old evidence");
 run(ui,["evidence","run","--stage","ui-implementation-bridge","--sensor","frontend-platform-spec"],false);
 put(ui,platformPath,prose);put(ui,specPath,spec+projection().replace("View 垂直布局","不存在的原文"));assert.throws(()=>frontendPlatformPayload(ui,specPath,"project"),/quote missing/);
 put(ui,specPath,spec+projection().replaceAll("modules/project/inception","modules/other/inception"));assert.throws(()=>frontendPlatformPayload(ui,specPath,"project"));
 put(ui,componentsPath,"# 当前页面\n"+spec.replace("# 平台规范","## 平台规范")+"\n# 其他单元\n"+spec.replace("# 平台规范","## 平台规范").replace("提交","删除"));
 put(ui,specPath,`- design_source: ${componentsPath}#当前页面\n${spec}${projection()}`);assert.equal(frontendPlatformPayload(ui,specPath,"project").status,"passed");
 rmSync(join(ui,componentsPath));put(ui,platformPath,prose.replace("React Native","Flutter"));put(ui,specPath,spec+projection(platformPath,prose.replace("React Native","Flutter")));assert.throws(()=>frontendPlatformPayload(ui,specPath,"project"),/declaration conflicts/);
 console.log("PASS bounded prose projection, legacy tables, omitted mappings/constraints, scope, declarations and source drift");
 const matrix=project("bridge-matrix");
 put(matrix,"docs/aidlc/modules/project/inception/requirements.md","# Requirements\n### REQ-1 platform declarations\n- track: [doc-only]\n");
 activate(matrix,"ui-implementation-bridge");
 const designMatrix=run(matrix,["check","--sensor","traceability-matrix","--module","project","--unit","default"]);
 assert.doesNotMatch(designMatrix,/BROKEN@code_refs/);
 activate(matrix,"code-generation");
 const codeMatrix=run(matrix,["check","--sensor","traceability-matrix","--module","project","--unit","default"]);
 assert.match(codeMatrix,/BROKEN@code_refs/);
 console.log("PASS bridge traceability remains before production code_refs enforcement");
 }

 // Actual route: all preceding work is fixture-arranged, then real next/report gates run.
 const route=project("route"), graph=loadGraph();
 put(route,"docs/aidlc/ideation/module-manifest.json",{schema_version:1,modules:[{module_id:"project",name:"UI",service_id:"svc"}]});
 put(route,"docs/aidlc/modules/project/inception/unit-manifest.json",{schema_version:1,module_id:"project",units:[{unit_id:"default",name:"Page",service_id:"svc",conditional_stages:["ui-implementation-bridge"]}]});
 put(route,platformPath,prose);
 put(route,"docs/aidlc/modules/project/inception/requirements.md","REQ-1: React Native platform configuration declarations only.\n");
 put(route,"docs/aidlc/modules/project/inception/user-stories.md","# Configuration\nREQ-1 platform configuration declarations only.\n");
 put(route,"docs/aidlc/modules/project/inception/application-design/test-cases/non-applicable.json",{schema_version:"1",status:"not_applicable",reason_code:"pure-configuration",reason:"platform configuration only",approval_ref:"approved:REQ-1",alternative_validation:"validate configuration",validation_command:"node -e 0",source_refs:["REQ-1"]});
 activate(route,"test-case-derivation");run(route,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
 put(route,".aidlc/commands/tdd.json",{version:"1",stage:"tdd",commands:[{id:"check",role:"check",argv:["node","-e","0"],evidence_inputs:{environment:[]}}]});
 activate(route,"tdd");
 for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(route,["evidence","run","--stage","tdd","--sensor",sensor]);
 let s=loadWorkflowState(route)!;s.scope="feature";
 const before=graph.stages.slice(0,graph.stages.findIndex(x=>x.slug==="ui-implementation-bridge"));
 s.completed_stages=before.map(x=>x.slug);s.completed_stage_instances=before.map(x=>x.axis==="project"?x.slug:`${x.slug}@module:project${x.axis==="unit"?"@unit:default":""}`);
 s.history.push({stage:"ui-mock",instance_id:"ui-mock@module:project",module_id:"project",result:"completed",user_input:"html-mock",timestamp:new Date().toISOString()});saveFixtureState(route,s);
 const next=JSON.parse(run(route,["orchestrate","next"]));assert.equal(next.directive?.stage??next.stage,"ui-implementation-bridge",JSON.stringify(next));
 put(route,specPath,"REQ-1: platform configuration\n"+spec+projection());put(route,platformPath,prose);
 run(route,["evidence","run","--stage","ui-implementation-bridge","--sensor","frontend-platform-spec"]);
 run(route,["orchestrate","report","--stage","ui-implementation-bridge","--result","completed"]);
 assert.ok(loadWorkflowState(route)!.completed_stage_instances.includes("ui-implementation-bridge@module:project@unit:default"));
 // This fixture deliberately has no input ownership contract: newly created files
 // invalidate conservative observations, so refresh the unchanged prerequisite checks.
 run(route,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation","--refresh"]);
 for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(route,["evidence","run","--stage","tdd","--sensor",sensor,"--refresh"]);
 const after=JSON.parse(run(route,["orchestrate","next"]));assert.equal(after.stage,"code-generation");assert.ok(after.consumes.includes(specPath));
 assert.equal(after.approval,"notify");assert.equal(after.gate,false);assert.match(after.handoff_prompt,/用户显式要求审阅时等待回复/);
 put(route,"src/config.json","{}\n");git(route,"add","src/config.json");
 put(route,"src/policy.js",'export const requirement = "REQ-1"; // @ReqId REQ-1\n');
 put(route,"docs/aidlc/modules/project/construction/default/functional-design.md","# Design\nREQ-1 platform configuration declarations.\n");
 put(route,"docs/aidlc/modules/project/construction/default/plans/code-generation-plan.md","# Plan\nREQ-1 validate the approved platform configuration.\n");
 put(route,"docs/aidlc/modules/project/construction/default/implementation-summary.md","# Summary\nREQ-1 delivered the approved platform configuration.\n");
 put(route,".aidlc/commands/code-generation.json",{version:"1",stage:"code-generation",commands:[{id:"check",role:"check",argv:["node","-e","0"],evidence_inputs:{environment:[]}}]});
 run(route,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation","--refresh"]);
 for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(route,["evidence","run","--stage","tdd","--sensor",sensor,"--refresh"]);
 run(route,["evidence","run","--stage","ui-implementation-bridge","--sensor","frontend-platform-spec","--refresh"]);
 run(route,["evidence","run","--stage","code-generation"]);
 const goodSpec=readFileSync(join(route,specPath),"utf8");put(route,specPath,goodSpec.replace("| 提交 | Button |\n",""));
 assert.match(run(route,["orchestrate","report","--stage","code-generation","--result","completed"],false),/RED gate evidence is invalid|frontend-platform-spec|canonical consumed artifacts/);
 put(route,specPath,goodSpec);
 run(route,["orchestrate","report","--stage","code-generation","--result","completed"]);
 const web=project("pure-web");put(web,platformPath,"# Platform\n运行时: React browser\n样式方案: CSS\n");
 const ws=loadWorkflowState(web)!;ws.scope="feature";ws.history.push({stage:"ui-mock",instance_id:"ui-mock@module:project",module_id:"project",result:"completed",user_input:"html-mock",timestamp:new Date().toISOString()});
 // Condition helpers use the process root; exercise Web through a CLI process below.
 put(web,"docs/aidlc/modules/project/inception/requirements.md","REQ-1: Web configuration declarations only.\n");
 saveFixtureState(web,ws);
 const webProbe=spawnSync(process.execPath,[tsx,join(repo,"tests/mars251_web_probe.ts")],{cwd:web,encoding:"utf8"});assert.equal(webProbe.status,0,webProbe.stderr);assert.equal(JSON.parse(webProbe.stdout).bridge,false);
 for(const slug of ["user-stories","units-generation","infrastructure-design"])assert.equal(graph.stages.find(x=>x.slug===slug)!.approval,"notify");
 activate(route,"operations-authorization");assert.match(run(route,["orchestrate","report","--stage","operations-authorization","--result","completed"],false),/requires explicit approval/);
 console.log("PASS real next → bridge producer/report → GREEN consumes, notify graph policy and protected approval rejection");
} finally {rmSync(scratch,{recursive:true,force:true});}
