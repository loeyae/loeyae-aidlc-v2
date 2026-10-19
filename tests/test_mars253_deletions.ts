import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { sourceDeletions } from "../core/tools/aidlc-source-deletions";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { loadGraph } from "../core/tools/aidlc-orchestrate";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars253-"));
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root,path)), { recursive:true }); writeFileSync(join(root,path), typeof value === "string" ? value : JSON.stringify(value)); };
function git(root: string, ...args: string[]) { const result=spawnSync("git",args,{cwd:root,encoding:"utf8"}); assert.equal(result.status,0,result.stderr); return result.stdout.trim(); }
function run(root: string, args: string[], ok=true) {
  const result=spawnSync(process.execPath,[tsx,join(repo,"bin/cli.ts"),...args],{cwd:root,encoding:"utf8",env:fixtureEnvironment(root,args)});
  assert.equal(result.status===0,ok,`${args.join(" ")}\n${result.stdout}\n${result.stderr}`); return result.stdout+result.stderr;
}
const manifestPath=".aidlc/evidence/code-generation/project/default/source-deletions.json";
const caseRoot="docs/aidlc/modules/project/inception/application-design/test-cases";
function activate(root:string,slug:string) {
  const state=loadWorkflowState(root)!; const axis=loadGraph().stages.find(stage=>stage.slug===slug)!.axis;
  state.current_stage=slug;state.current_phase=slug==="test-case-derivation"?"inception":"construction";
  state.current_module=axis!=="project"?"project":undefined;state.current_unit=axis==="unit"?"default":undefined;
  state.current_stage_instance=slug+(axis!=="project"?"@module:project":"")+(axis==="unit"?"@unit:default":"");saveFixtureState(root,state);
}
function fixture(name:string, last=false) {
  const root=join(scratch,name);mkdirSync(root);
  put(root,".gitignore",".aidlc/\naidlc/\n");
  put(root,"src/legacy.route.cjs","module.exports = 'legacy';\n");
  if(!last)put(root,"src/health.route.cjs","module.exports = 'health';\n");
  // This router's discovery behavior changes solely by deleting a route file.
  put(root,"router.cjs","const fs=require('fs');module.exports=()=>fs.existsSync('src')?fs.readdirSync('src').filter(p=>p.endsWith('.route.cjs')).map(p=>require('./src/'+p)).sort():[];\n");
  put(root,"tests/router.test.js",`// REQ-1 UC-D-001\nconst assert=require('assert');let failed=0;try{assert.deepEqual(require('../router.cjs')(),${last?'[]':"['health']"});}catch(e){failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'legacy route still exposed'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/router.test.js']}]}));process.exit(failed);\n`);
  put(root,"docs/aidlc/ideation/module-manifest.json",{schema_version:1,modules:[{module_id:"project",name:"Routes",service_id:"svc",paths:["src"]}]});
  put(root,"docs/aidlc/modules/project/inception/unit-manifest.json",{schema_version:1,module_id:"project",units:[{unit_id:"default",name:"Remove route",service_id:"svc",req_refs:["REQ-1"],conditional_stages:[]},{unit_id:"other",name:"Other",service_id:"svc",req_refs:["REQ-2"],conditional_stages:[]}]});
  put(root,"docs/aidlc/modules/project/inception/requirements.md","REQ-1: Given a router, When routes are discovered, Then the legacy route must no longer be exposed. Approved removal requested by product owner.\n");
  put(root,`${caseRoot}/_index.md`,"# Cases\nUC-D-001 status: ready source_ref: REQ-1\n");
  put(root,`${caseRoot}/UC-D-001.md`,"---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default]\nchange_ref: REQ-1\n---\n# Remove legacy route\nGiven the router When discovery runs Then legacy is absent. REQ-1\n");
  for(const [stage,role] of [["tdd","red"],["code-generation","green"]])put(root,`.aidlc/commands/${stage}.json`,{version:"1",stage,commands:[{id:role,role,argv:["node","tests/router.test.js"]}]});
  for(const [path,heading] of [["plans/code-generation-plan.md","Plan"],["implementation-summary.md","Summary"]])put(root,`docs/aidlc/modules/project/construction/default/${path}`,`# ${heading}\nREQ-1 UC-D-001 remove the legacy route and verify discovery exposes only approved routes.\n`);
  git(root,"init","-q");git(root,"add",".");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","baseline");
  const state=createInitialState("express","4.22.4",`mars252-${name}`,[],"remove legacy behavior");state.baseline_commit=git(root,"rev-parse","HEAD");state.baseline_source="created";saveFixtureState(root,state);
  const entry={path:"src/legacy.route.cjs",baseline_blob:git(root,"rev-parse","HEAD:src/legacy.route.cjs"),req_refs:["REQ-1"],ucd_id:"UC-D-001"};
  const declare=(e:unknown=entry)=>put(root,manifestPath,{schema_version:"1",module_id:"project",unit_id:"default",deletions:[e]});
  return {root,entry,declare};
}
function probe(root:string, mode="produces", sensor?:string, instance="code-generation@module:project@unit:default") {
  const r=spawnSync(process.execPath,[tsx,join(repo,"tests/gate_probe.ts"),instance,mode,...sensor?[sensor]:[]],{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
}
const read = (root:string, path:string) => JSON.parse(readFileSync(join(root,path),"utf8"));
const i13Path=".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
const unitPath="docs/aidlc/modules/project/inception/unit-manifest.json";
function complete(root:string, refreshI13=true) {
  const state=loadWorkflowState(root)!, graph=loadGraph(), before=graph.stages.slice(0,graph.stages.findIndex(stage=>stage.slug==="code-generation"));
  state.completed_stages=before.map(stage=>stage.slug);state.completed_stage_instances=before.map(stage=>stage.slug+(stage.axis!=="project"?"@module:project":"")+(stage.axis==="unit"?"@unit:default":""));saveFixtureState(root,state);
  activate(root,"code-generation");
  if(refreshI13)run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation","--instance","test-case-derivation@module:project","--refresh"]);
  run(root,["evidence","run","--stage","code-generation"]);
  assert.match(run(root,["orchestrate","report","--stage","code-generation","--result","completed"]),/completed|完成/);
  assert.ok(loadWorkflowState(root)!.completed_stage_instances.includes("code-generation@module:project@unit:default"));
}
try {
  for(const kind of ["descriptive","aggregate","single-unit","module-wide"].filter(kind=>!process.argv[2]||process.argv[2]===kind)) {
    const {root,entry,declare}=fixture(kind);
    let content=readFileSync(join(root,caseRoot,"UC-D-001.md"),"utf8");
    if(kind==="single-unit" || kind==="module-wide") {
      content=content.replace("unit_refs: [default]\n","");
      const manifest=read(root,unitPath);
      if(kind==="single-unit")manifest.units=manifest.units.slice(0,1);
      put(root,unitPath,manifest);
    }
    const path=kind==="descriptive"?"UC-D-001-remove-legacy.md":kind==="aggregate"?"removals.md":"UC-D-001.md";
    if(kind==="descriptive")content=content.replace("source_ref: REQ-1","source_ref: US-1");
    rmSync(join(root,caseRoot,"UC-D-001.md"));
    if(kind==="aggregate")content+="\n---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\nunit_refs: [other]\nchange_ref: REQ-2\n---\nGiven health When checked Then it remains available.\n";
    put(root,`${caseRoot}/${path}`,content);
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    activate(root,"tdd");for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    rmSync(join(root,entry.path));declare();
    assert.equal(sourceDeletions(root,"project","default").length,1);
    assert.deepEqual(probe(root).missing.filter((x:string)=>x.startsWith("src/")),[]);
    // A source move, duplicate, changed requirement, outside path and cross-module entry fail closed.
    put(root,`${caseRoot}/duplicate.md`,content);assert.throws(()=>sourceDeletions(root,"project","default"),/sources|declared/);rmSync(join(root,caseRoot,"duplicate.md"));
    if(kind==="descriptive") {
      put(root,`${caseRoot}/${path}`,content+"\n"+content);
      run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation","--instance","test-case-derivation@module:project","--refresh"],false);
      assert.throws(()=>sourceDeletions(root,"project","default"),/declared/);put(root,`${caseRoot}/${path}`,content);
      rmSync(join(root,caseRoot,path));assert.throws(()=>sourceDeletions(root,"project","default"),/sources/);put(root,`${caseRoot}/${path}`,content);
    }
    put(root,`${caseRoot}/${path}`,content+"\nsource drift\n");assert.throws(()=>sourceDeletions(root,"project","default"),/source changed/);put(root,`${caseRoot}/${path}`,content);
    const saved=read(root,i13Path);put(root,i13Path,{...saved,test_case_files:["../outside.md"]});assert.throws(()=>sourceDeletions(root,"project","default"),/sources/);put(root,i13Path,saved);
    declare({...entry,ucd_id:"UC-D-999"});assert.throws(()=>sourceDeletions(root,"project","default"),/belong/);declare();
    declare({...entry,applicability:"not_applicable",ucd_id:undefined});assert.throws(()=>sourceDeletions(root,"project","default"),/conflicts/);declare();
    if(kind==="module-wide") {
      const manifest=read(root,unitPath);manifest.units[1].req_refs=["REQ-1"];put(root,unitPath,manifest);
      assert.throws(()=>sourceDeletions(root,"project","default"),/ambiguous/);manifest.units[1].req_refs=["REQ-2"];put(root,unitPath,manifest);
    }
    complete(root);
    console.log(`PASS ${kind}: real I13 → business RED → deletion GREEN → CLI completion; invalid source/ownership rejected`);
  }
  for(const kind of ["no-behavior","empty-subset"].filter(kind=>!process.argv[2]||process.argv[2]===kind)) {
    const {root,entry,declare}=fixture(kind);
    const config="src/unused-settings.json";put(root,config,'{"unused":true}\n');
    const requirement="REQ-1: Remove unused static settings. Pure configuration cleanup approved; no runtime behavior changes.\n";
    put(root,"docs/aidlc/modules/project/inception/requirements.md",requirement);
    const approval={schema_version:"1",status:"not_applicable",reason_code:"pure-configuration",reason:"Remove unused static configuration only",approval_ref:"approved:REQ-1",alternative_validation:"verify obsolete settings are absent",validation_command:"node check.cjs",source_refs:["REQ-1"]};
    if(kind==="no-behavior") {rmSync(join(root,caseRoot),{recursive:true});put(root,`${caseRoot}/non-applicable.json`,approval);}
    else {
      put(root,`${caseRoot}/UC-D-001.md`,readFileSync(join(root,caseRoot,"UC-D-001.md"),"utf8").replace("unit_refs: [default]","unit_refs: [other]").replaceAll("REQ-1","REQ-2"));
      put(root,"docs/aidlc/modules/project/inception/requirements.md",requirement+"REQ-2: Given health discovery When checked Then health remains available; this behavior belongs to the other unit.\n");
      const manifest=read(root,unitPath);manifest.units[0].ucd_exemption={reason_code:approval.reason_code,reason:approval.reason,approval_ref:approval.approval_ref,alternative_validation:approval.alternative_validation,validation_command:["node","check.cjs"]};put(root,unitPath,manifest);
    }
    put(root,"check.cjs","require('assert/strict').equal(require('fs').existsSync('src/unused-settings.json'),false);console.log('settings absent');\n");
    for(const stage of ["tdd","code-generation"])put(root,`.aidlc/commands/${stage}.json`,{version:"1",stage,commands:[{id:kind==="empty-subset"?"ucd-exemption:default":"check",role:"check",argv:["node","check.cjs"],evidence_inputs:{environment:["MARS253_CONTEXT"]}}]});
    git(root,"add",".");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","configuration baseline");
    const state=loadWorkflowState(root)!;state.baseline_commit=git(root,"rev-parse","HEAD");saveFixtureState(root,state);
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    const deletion={path:config,baseline_blob:git(root,"rev-parse",`HEAD:${config}`),req_refs:["REQ-1"],applicability:"not_applicable"};declare(deletion);
    assert.throws(()=>sourceDeletions(root,"project","default"),/not deleted/);
    activate(root,"tdd");run(root,["evidence","run","--stage","tdd","--sensor","red-test-evidence"],false);
    rmSync(join(root,config));
    for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    assert.equal(sourceDeletions(root,"project","default").length,1);
    activate(root,"code-generation");
    assert.ok(probe(root,"sensors","green-test-evidence").failures.length,"missing successful alternative observation is rejected");
    run(root,["evidence","run","--stage","code-generation","--sensor","green-test-evidence"]);
    const greenPath=".aidlc/evidence/code-generation/project/default/green-test-evidence.json",green=read(root,greenPath);
    const field=kind==="no-behavior"?"alternative_validation_execution":"exemption_validation_execution";
    assert.equal(green[field].exit_code,0);assert.ok(green[field].observation_id||green[field].reused_from);
    if(kind==="no-behavior")assert.ok(green[field].reused_from,"GREEN reuses the real successful RED check");
    assert.deepEqual(probe(root,"sensors","green-test-evidence").failures,[]);
    put(root,greenPath,{...green,[field]:{...green[field],reused_from:"missing-observation",observation_id:undefined}});assert.ok(probe(root,"sensors","green-test-evidence").failures.length);put(root,greenPath,green);
    put(root,greenPath,{...green,[field]:{...green[field],exit_code:1,status:"failed"}});assert.ok(probe(root,"sensors","green-test-evidence").failures.length);put(root,greenPath,green);
    if(kind==="no-behavior") {
      process.env.MARS253_CONTEXT="drift";assert.ok(probe(root,"sensors","green-test-evidence").failures.length);delete process.env.MARS253_CONTEXT;
      put(root,"check.cjs","console.log('changed checker');\n");assert.ok(probe(root,"sensors","green-test-evidence").failures.length);put(root,"check.cjs","require('assert/strict').equal(require('fs').existsSync('src/unused-settings.json'),false);console.log('settings absent');\n");
      put(root,`${caseRoot}/non-applicable.json`,{...approval,approval_ref:""});assert.throws(()=>sourceDeletions(root,"project","default"));put(root,`${caseRoot}/non-applicable.json`,approval);
      put(root,"docs/aidlc/modules/project/inception/requirements.md",requirement+"Changed authorization\n");assert.throws(()=>sourceDeletions(root,"project","default"),/sources changed/);put(root,"docs/aidlc/modules/project/inception/requirements.md",requirement);
      const configPath=".aidlc/commands/code-generation.json",commands=read(root,configPath);put(root,configPath,{...commands,commands:[{...commands.commands[0],argv:["node","-e","process.exit(0)"]}]});assert.ok(probe(root,"sensors","green-test-evidence").failures.length);put(root,configPath,commands);
      git(root,"add","-u");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","remove static configuration");
      const before=loadWorkflowState(root)!;saveFixtureState(root,{...before,baseline_history:[before.baseline_commit!,git(root,"rev-parse","HEAD")],baseline_commit:git(root,"rev-parse","HEAD"),baseline_source:"advanced"});
      assert.ok(probe(root,"sensors","green-test-evidence").failures.length,"baseline generation drift invalidates observation");saveFixtureState(root,before);
    }
    complete(root,false);
    console.log(`PASS ${kind}: controlled I13 → successful alternative checks → deletion-only CLI completion; invalid checks/sources rejected`);
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }
