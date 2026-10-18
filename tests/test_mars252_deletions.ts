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
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars252-"));
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
try {
  for(const last of [false,true]) {
    const {root,entry,declare}=fixture(last?"last":"router",last);
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    activate(root,"tdd");for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    assert.ok(probe(root).missing.some((x:string)=>x.includes("no source change")),"no modification rejected");
    declare();assert.throws(()=>sourceDeletions(root,"project","default"),/not deleted/);
    rmSync(join(root,"src/legacy.route.cjs"));if(last)rmSync(join(root,"src"),{recursive:true});
    assert.match(git(root,"diff","--name-status"),/D\s+src\/legacy.route.cjs/);
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    assert.equal(sourceDeletions(root).length,1,"project consumers aggregate removals");
    for(const bad of [{...entry,baseline_blob:"0".repeat(40)},{...entry,path:"../escape.cjs"},{...entry,req_refs:["REQ-2"]},{...entry,ucd_id:"UC-D-999"}]){declare(bad);assert.throws(()=>sourceDeletions(root,"project","default"));}
    declare();
    put(root,".aidlc/evidence/code-generation/project/other/source-deletions.json",{schema_version:"1",module_id:"project",unit_id:"other",deletions:[entry]});
    assert.throws(()=>sourceDeletions(root,"project","other"),/belong/);rmSync(join(root,".aidlc/evidence/code-generation/project/other"),{recursive:true});
    const missing=probe(root).missing.filter((path:string)=>path.startsWith("src/"));assert.deepEqual(missing,[]);
    assert.deepEqual(probe(root,"sensors","no-todo").failures,[]);
    assert.deepEqual(probe(root,"sensors","traceability").failures,[]);
    // Arrange predecessor completion, then exercise the real next/producer/report path.
    const state=loadWorkflowState(root)!;const graph=loadGraph();const before=graph.stages.slice(0,graph.stages.findIndex(stage=>stage.slug==="code-generation"));
    state.completed_stages=before.map(stage=>stage.slug);state.completed_stage_instances=before.map(stage=>stage.slug+(stage.axis!=="project"?"@module:project":"")+(stage.axis==="unit"?"@unit:default":""));saveFixtureState(root,state);
    activate(root,"code-generation");
    run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation","--instance","test-case-derivation@module:project","--refresh"]);
    run(root,["evidence","run","--stage","code-generation"]);
    const completed=run(root,["orchestrate","report","--stage","code-generation","--result","completed"]);
    assert.match(completed,/completed|完成/);
    assert.ok(loadWorkflowState(root)!.completed_stage_instances.includes("code-generation@module:project@unit:default"));
    const green=JSON.parse(readFileSync(join(root,".aidlc/evidence/code-generation/project/default/green-test-evidence.json"),"utf8"));assert.equal(green.status,"passed");assert.equal(green.tests_total,1);
    assert.deepEqual(probe(root,"consumes",undefined,"code-review@module:project@unit:default").failures.filter((x:string)=>x.startsWith("src/")),[],"consumer verifies deletion-only source delivery");
    // Bind completion to a committed range, then advance the baseline and recheck.
    git(root,"add","-u");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","remove legacy route");
    green.source_revision.commit=git(root,"rev-parse","HEAD");put(root,".aidlc/evidence/code-generation/project/default/green-test-evidence.json",green);
    const advanced=loadWorkflowState(root)!;advanced.baseline_history=[advanced.baseline_commit!,green.source_revision.commit];advanced.baseline_commit=green.source_revision.commit;advanced.baseline_source="advanced";saveFixtureState(root,advanced);
    assert.equal(sourceDeletions(root,"project","default")[0].baseline_blob,entry.baseline_blob,"advanced baseline retains original deletion blob");
    assert.deepEqual(probe(root).missing.filter((x:string)=>x.startsWith("src/")),[],"completed removal rechecks its own committed range");
    console.log(`PASS actual behavior RED → deletion-only GREEN → CLI completion (${last?'last source removed':'health route survives'})`);
  }
  {
    const {root,entry,declare}=fixture("invalid-blobs");
    put(root,"src/empty.js","// placeholder only\n");put(root,"src/binary.bin",Buffer.from([0,1,2]).toString("binary"));
    put(root,".gitignore",".aidlc/\naidlc/\nsrc/ignored.js\n");put(root,"src/ignored.js","module.exports=1;\n");
    git(root,"add",".");git(root,"add","-f","src/ignored.js");
    const linkBlob=git(root,"hash-object","-w","src/legacy.route.cjs");git(root,"update-index","--add","--cacheinfo",`120000,${linkBlob},src/link.js`);
    git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","invalid deletion candidates");
    const state=loadWorkflowState(root)!;state.baseline_commit=git(root,"rev-parse","HEAD");saveFixtureState(root,state);
    put(root,".aidlc/evidence/test-case-derivation/project/test-case-derivation.json",{status:"required",ucd_ids:["UC-D-001"],ucd_units:{"UC-D-001":["default"]}});
    for(const path of ["src/empty.js","src/binary.bin","src/ignored.js","src/link.js"]) {
      const blob=git(root,"rev-parse",`HEAD:${path}`);rmSync(join(root,path),{force:true});declare({...entry,path,baseline_blob:blob});
      assert.throws(()=>sourceDeletions(root,"project","default"),/binary|placeholder|ignored|symbolic link/);
    }
    console.log("PASS ignored, binary, placeholder and symlink baseline deletions rejected");
  }
  {
    const {root,entry,declare}=fixture("nested");const app=join(root,"app");mkdirSync(app);git(app,"init","-q");put(root,"app/src/legacy.route.cjs","module.exports='legacy';\n");git(app,"add",".");git(app,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","nested baseline");
    put(root,".aidlc/source-roots.json",{version:"1",source_roots:[{path:"app",repo:"nested"}]});
    put(root,"docs/aidlc/ideation/module-manifest.json",{schema_version:1,modules:[{module_id:"project",name:"Routes",service_id:"svc",paths:["app/src"]}]});
    put(root,".aidlc/evidence/test-case-derivation/project/test-case-derivation.json",{status:"required",ucd_ids:["UC-D-001"],ucd_units:{"UC-D-001":["default"]}});
    const state=loadWorkflowState(root)!;state.baseline_repos={app:git(app,"rev-parse","HEAD")};saveFixtureState(root,state);
    declare({...entry,path:"app/src/legacy.route.cjs",baseline_blob:git(app,"rev-parse","HEAD:src/legacy.route.cjs")});rmSync(join(app,"src"),{recursive:true});
    assert.equal(sourceDeletions(root,"project","default")[0].repo,"app");
    assert.deepEqual(probe(root).missing.filter((x:string)=>x.startsWith("app/src/")),[]);
    console.log("PASS nested repository deletion uses its own baseline and supports removed source root");
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }
