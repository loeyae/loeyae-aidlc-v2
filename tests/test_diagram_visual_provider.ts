import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addProjectProvider, setProjectProviderEnabled } from "../core/tools/aidlc-provider-cli.js";
import { bindVisualInputs, createVisualRequest, validateVisualCandidate, verifyVisualEvidence, safeVisualPath } from "../core/tools/aidlc-visual-provider.js";
import { sha256FileDigest } from "../core/tools/aidlc-project-provider.js";

const [sourceArg, commit, python] = process.argv.slice(2);
assert(sourceArg && commit && python, "usage: test <external Git repo> <immutable SHA> <python executable>");
const source = sourceArg.includes("://") ? sourceArg : pathToFileURL(resolve(sourceArg)).href;
const fixture = source.startsWith("file:"), root=mkdtempSync(join(tmpdir(),"v-"));
const repo=process.cwd(), cli=join(repo,"core/tools/aidlc-diagram-provider.ts"), tsx=join(repo,"node_modules/tsx/dist/cli.mjs");
function run(command:string, args:string[], cwd:string, expected=0) {
  const r=spawnSync(command,args,{cwd,encoding:"utf8",timeout:120000,maxBuffer:24*1024*1024});
  assert.equal(r.status,expected,`${command}: ${r.error ?? ""}\n${r.stdout}\n${r.stderr}`); return r;
}
function json(path:string) { return JSON.parse(readFileSync(path,"utf8")); }
let scenarios=0;
const variants=["valid","node-collision","edge-collision","group-overlap","global-decoration","sequence-lifeline","label-edge-collision","arrow-label-occlusion","target-port-approach","vertical-scroll","viewport-overflow"];
for(const variant of variants.filter(x=>!process.env.VISUAL_SCENARIOS||process.env.VISUAL_SCENARIOS.split(",").includes(x))) {
  const project=join(root,String(scenarios)); mkdirSync(project);
  const setup=`import sys; sys.path.insert(0,${JSON.stringify(join(repo,"tests"))}); from test_provider_adapter import geometry_fixture; geometry_fixture(sys.argv[1],sys.argv[2],(320,240) if sys.argv[2] in ('vertical-scroll','viewport-overflow') else (800,600))`;
  run(python,["-c",setup,project,variant],repo);
  run("git",["init"],project);
  writeFileSync(join(project,".aidlc/provider-git-policy.json"),JSON.stringify({version:1,allowed_hosts:fixture?[]:[new URL(source).hostname],allowed_commits:[commit],allow_file_fixtures:fixture}));
  addProjectProvider(project,{source,ref:commit,subdir:"providers/diagram-visual",instance:"visual",allowFile:fixture,trust:"allowlisted-commit"});
  const evidencePath=join(project,".aidlc/evidence/requirements-methods/test-module/diagram-contract.json");
  const good=variant==="valid"||variant==="vertical-scroll";
  const result=run(process.execPath,[tsx,cli,"run","--request","request.json","--host-provider","visual"],project,good?0:1);
  const evidence=json(evidencePath);
  assert.equal(evidence.final_status,good?"PASS":"FAIL",result.stderr);
  if(good) {
    verifyVisualEvidence(project,evidence);
    assert.equal(evidence.provider_validation.results.length,3);
    for(const r of evidence.provider_validation.results) assert(existsSync(join(project,r.screenshot_path)));
  } else assert.match(result.stderr,/overlap|collid|geometry|lifeline|style|approach|viewport|horizontal|gap/i);
  scenarios++;
  console.log(`real browser ${variant}: ${evidence.final_status}`);
  if(variant!=="valid") continue;
  // Tampering is checked after acquisition and again at consumption.
  const original=readFileSync(evidencePath,"utf8"), e=JSON.parse(original);
  e.provider_validation.results[0].inspection.title="forged";
  assert.throws(()=>verifyVisualEvidence(project,e),/TAMPERED/);
  const screenshot=join(project,evidence.provider_validation.results[0].screenshot_path), bytes=readFileSync(screenshot);
  writeFileSync(screenshot,Buffer.from("forged")); assert.throws(()=>verifyVisualEvidence(project,evidence),/TAMPERED/); writeFileSync(screenshot,bytes);
  for(const path of ["assets/geometry.svg","assets/geometry.expected.json","assets/geometry.diagram.json"]) {
    const p=join(project,path), content=readFileSync(p); writeFileSync(p,Buffer.concat([content,Buffer.from(" ")]));
    assert.throws(()=>verifyVisualEvidence(project,evidence),/STALE/); writeFileSync(p,content);
  }
  assert.throws(()=>verifyVisualEvidence(project,evidence,{project_id:"other-project",stage:"requirements-methods",scope:"wrong-scope"}),/CONTEXT_STALE/);
  assert.throws(()=>safeVisualPath(project,"../escape.png"),/DENIED/);
  mkdirSync(join(project,"generator-tools"));writeFileSync(join(project,"generator-tools/make.py"),"# version one\n");
  writeFileSync(join(project,"closure.json"),JSON.stringify({generation:{cwd:"generator-tools",command_argv:[python,"make.py"],source_refs:["assets/geometry.svg"],outputs:["assets/geometry.expected.json"]}}));
  const closure=bindVisualInputs(project,["closure.json"]);assert(closure["generator-tools/make.py"]);
  writeFileSync(join(project,"generator-tools/make.py"),"# version two\n");assert.notDeepEqual(bindVisualInputs(project,["closure.json"]),closure);
  writeFileSync(join(project,"bad-closure.json"),JSON.stringify({generation:{source_refs:["../outside"]}}));assert.throws(()=>bindVisualInputs(project,["bad-closure.json"]),/PATH_DENIED/);
  const request=json(join(project,"request.json")), paths=["request.json","assets/geometry.svg","assets/geometry.expected.json","assets/geometry.diagram.json"];
  const options={project,instance:"visual",context:{project_id:"diagram-provider-fixture",stage:"requirements-methods",scope:"requirements-methods@module:test-module",module_id:"test-module"},operation:"preview" as const,svg:readFileSync(join(project,"assets/geometry.svg"),"utf8"),contract:{},viewports:request.target_reading_environment.viewports,inputs:bindVisualInputs(project,paths)};
  const frozen=createVisualRequest(options).request;
  const packet:any={schema:"aidlc.visual-candidate/v1",binding:frozen.binding,request_digest:sha256FileDigest(JSON.stringify(frozen)),views:{}};
  assert.throws(()=>validateVisualCandidate(frozen,packet,Date.now()),/INVALID/);
  packet.binding={...frozen.binding,invocation:"old-invocation"}; assert.throws(()=>validateVisualCandidate(frozen,packet,Date.now()),/INVALID/);
  setProjectProviderEnabled(project,"visual",false); assert.throws(()=>createVisualRequest(options),/NEEDS_CAPABILITY/); assert.throws(()=>verifyVisualEvidence(project,evidence),/STALE|DRIFT|CAPABILITY/);
  setProjectProviderEnabled(project,"visual",true);
  assert.throws(()=>createVisualRequest({...options,instance:undefined}),/authorization required/);
  run(process.execPath,[tsx,cli,"run","--request","request.json"],project,1); assert.equal(json(evidencePath).final_status,"NEEDS_CAPABILITY");
  writeFileSync(evidencePath,original);
  const missing=run(process.execPath,[tsx,cli,"run","--request","request.json","--host-provider","visual","--browser",join(root,"missing-browser")],project,1);
  assert.match(missing.stderr,/NEEDS_CAPABILITY: installed browser executable missing/); assert.equal(json(evidencePath).final_status,"NEEDS_CAPABILITY");
  const requestBytes=readFileSync(join(project,"request.json"));
  for(const change of [(r:any)=>r.browser=process.execPath,(r:any)=>r.diagrams[0].screenshot_path="../escape.png",(r:any)=>delete r.target_reading_environment.viewports.zoom,(r:any)=>r.target_operation="export"]) {
    const altered=JSON.parse(requestBytes.toString());change(altered);writeFileSync(join(project,"request.json"),JSON.stringify(altered));
    run(process.execPath,[tsx,cli,"run","--request","request.json","--host-provider","visual"],project,1);
  }
  writeFileSync(join(project,"request.json"),requestBytes);
  const empty=join(root,"absent");mkdirSync(empty);assert.throws(()=>createVisualRequest({...options,project:empty}),/CONFIG|CAPABILITY|LOCK/);assert(!existsSync(join(empty,".aidlc")),"absent package must not trigger installation");
  // Capture raw candidate from the same actual external package for protocol rejection tests.
  const entry=resolve(sourceArg,"providers/diagram-visual/bin/inspect.mjs");
  if(fixture) {
    const raw=spawnSync(process.execPath,[entry],{input:JSON.stringify(frozen),encoding:"utf8",timeout:90000,maxBuffer:24*1024*1024}); assert.equal(raw.status,0,raw.stderr);
    const candidate=JSON.parse(raw.stdout), started=Date.now()-90000;
    validateVisualCandidate(frozen,candidate,started);
    for(const change of [(x:any)=>delete x.views.zoom,(x:any)=>x.views.normal.captured_at="2000-01-01T00:00:00Z",(x:any)=>x.views.normal.screenshot="forged",(x:any)=>x.views.normal.measurement.title="changed",(x:any)=>x.binding.inputs={}]) {
      const copy=structuredClone(candidate); change(copy); assert.throws(()=>validateVisualCandidate(frozen,copy,started));
    }
  }
}
console.log(JSON.stringify({real_browser_scenarios:scenarios,production_package:"providers/diagram-visual",transport:fixture?"local Git immutable package":"remote Git immutable package",artifacts:root,adversarial_checks:"passed"}));
