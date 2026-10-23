import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { sourceDeletions } from "../core/tools/aidlc-source-deletions";
import { createInitialState, loadWorkflowState } from "../core/tools/aidlc-light-state";
import { loadGraph } from "../core/tools/aidlc-orchestrate";
import { fixtureEnvironment, saveFixtureState } from "./mars243_fixture_session";

// MARS-273 S3: deletion delivery reconciliation accepts both `ucd_sources` forms — the legacy
// per-UC-D file+SHA-256 records and the per-file digest + UC-D ID list — and still rejects drift.
const repo = resolve(import.meta.dirname, ".."), tsx = join(repo, "node_modules/tsx/dist/cli.mjs");
const scratch = mkdtempSync(join(tmpdir(), "aidlc-mars273-"));
const put = (root: string, path: string, value: unknown) => { mkdirSync(dirname(join(root,path)), { recursive:true }); writeFileSync(join(root,path), typeof value === "string" ? value : JSON.stringify(value)); };
function git(root: string, ...args: string[]) { const result=spawnSync("git",args,{cwd:root,encoding:"utf8"}); assert.equal(result.status,0,result.stderr); return result.stdout.trim(); }
function run(root: string, args: string[]) {
  const result=spawnSync(process.execPath,[tsx,join(repo,"bin/cli.ts"),...args],{cwd:root,encoding:"utf8",env:fixtureEnvironment(root,args)});
  assert.equal(result.status,0,`${args.join(" ")}\n${result.stdout}\n${result.stderr}`); return result.stdout+result.stderr;
}
const manifestPath=".aidlc/evidence/code-generation/project/default/source-deletions.json";
const caseRoot="docs/aidlc/modules/project/inception/application-design/test-cases";
const i13Path=".aidlc/evidence/test-case-derivation/project/test-case-derivation.json";
function activate(root:string,slug:string) {
  const state=loadWorkflowState(root)!; const axis=loadGraph().stages.find(stage=>stage.slug===slug)!.axis;
  state.current_stage=slug;state.current_phase=slug==="test-case-derivation"?"inception":"construction";
  state.current_module=axis!=="project"?"project":undefined;state.current_unit=axis==="unit"?"default":undefined;
  state.current_stage_instance=slug+(axis!=="project"?"@module:project":"")+(axis==="unit"?"@unit:default":"");saveFixtureState(root,state);
}
function fixture(name:string, aggregate=false) {
  const root=join(scratch,name);mkdirSync(root);
  put(root,".gitignore",".aidlc/\naidlc/\n");
  put(root,"src/legacy.route.cjs","module.exports = 'legacy';\n");
  put(root,"src/health.route.cjs","module.exports = 'health';\n");
  put(root,"router.cjs","const fs=require('fs');module.exports=()=>fs.existsSync('src')?fs.readdirSync('src').filter(p=>p.endsWith('.route.cjs')).map(p=>require('./src/'+p)).sort():[];\n");
  put(root,"tests/router.test.js",`// REQ-1 UC-D-001\nconst assert=require('assert');let failed=0;try{assert.deepEqual(require('../router.cjs')(),['health']);}catch(e){failed=1;}console.log(JSON.stringify({phase:process.env.AIDLC_PHASE,status:failed?'failed':'passed',compile_status:'passed',environment_status:'passed',tests_total:1,tests_failed:failed,traceability_complete:true,...failed?{failure_class:'behavior',failure_signature:'legacy route still exposed'}:{},uc_mapping:[{use_case:'UC-D-001',test_methods:['tests/router.test.js']}]}));process.exit(failed);\n`);
  put(root,"docs/aidlc/ideation/module-manifest.json",{schema_version:1,modules:[{module_id:"project",name:"Routes",service_id:"svc",paths:["src"]}]});
  put(root,"docs/aidlc/modules/project/inception/unit-manifest.json",{schema_version:1,module_id:"project",units:[{unit_id:"default",name:"Remove route",service_id:"svc",req_refs:["REQ-1"],conditional_stages:[]},{unit_id:"other",name:"Other",service_id:"svc",req_refs:["REQ-2"],conditional_stages:[]}]});
  put(root,"docs/aidlc/modules/project/inception/requirements.md","REQ-1: Given a router, When routes are discovered, Then the legacy route must no longer be exposed. Approved removal requested by product owner.\n");
  put(root,`${caseRoot}/_index.md`,"# Cases\nUC-D-001 status: ready source_ref: REQ-1\n");
  let content="---\nid: UC-D-001\nstatus: ready\nsource_ref: REQ-1\nunit_refs: [default]\nchange_ref: REQ-1\n---\n# Remove legacy route\nGiven the router When discovery runs Then legacy is absent. REQ-1\n";
  if(aggregate) {
    content+="\n---\nid: UC-D-002\nstatus: ready\nsource_ref: REQ-2\nunit_refs: [other]\nchange_ref: REQ-2\n---\nGiven health When checked Then it remains available.\n";
    put(root,`${caseRoot}/removals.md`,content);
  } else put(root,`${caseRoot}/UC-D-001.md`,content);
  for(const [stage,role] of [["tdd","red"],["code-generation","green"]])put(root,`.aidlc/commands/${stage}.json`,{version:"1",stage,commands:[{id:role,role,argv:["node","tests/router.test.js"]}]});
  put(root,"docs/aidlc/modules/project/construction/default/plans/code-generation-plan.md","# Plan\nREQ-1 UC-D-001 remove the legacy route and verify discovery exposes only approved routes.\n");
  put(root,"docs/aidlc/modules/project/construction/default/implementation-summary.md","# Summary\nREQ-1 UC-D-001 remove the legacy route and verify discovery exposes only approved routes.\n");
  git(root,"init","-q");git(root,"add",".");git(root,"-c","user.name=Test","-c","user.email=test@example.invalid","commit","-qm","baseline");
  const state=createInitialState("express","4.22.4",`mars273-${name}`,[],"remove legacy behavior");state.baseline_commit=git(root,"rev-parse","HEAD");state.baseline_source="created";saveFixtureState(root,state);
  const entry={path:"src/legacy.route.cjs",baseline_blob:git(root,"rev-parse","HEAD:src/legacy.route.cjs"),req_refs:["REQ-1"],ucd_id:"UC-D-001"};
  const declare=()=>put(root,manifestPath,{schema_version:"1",module_id:"project",unit_id:"default",deletions:[entry]});
  return {root,entry,declare};
}
const read = (root:string, path:string) => JSON.parse(readFileSync(join(root,path),"utf8"));
/** Convert producer legacy records into the per-file form (digest + the file's UC-D ID list). */
const perFileForm = (i13: Record<string, unknown>) => {
  const sources: Record<string, { sha256: string; ucd_ids: string[] }> = {};
  const byFile = new Map<string, string[]>();
  for(const [id, record] of Object.entries(i13.ucd_sources as Record<string, { file: string }>)) {
    const file = record.file.replace(/\\/g, "/");
    const ids = byFile.get(file) ?? [];
    ids.push(id); byFile.set(file, ids);
  }
  for(const [file, ids] of byFile) sources[file] = { sha256: (i13.ucd_sources as Record<string, { sha256: string }>)[ids[0]].sha256, ucd_ids: ids.sort() };
  return sources;
};
try {
  {
    // Legacy per-UC-D records (the current producer output) reconcile without migration.
    const {root,entry,declare}=fixture("legacy");
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    activate(root,"tdd");for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    rmSync(join(root,entry.path));declare();
    const i13=read(root,i13Path);
    assert.match(Object.keys(i13.ucd_sources)[0],/^UC-D-\d+$/,"producer writes the legacy per-UC-D form");
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    console.log("PASS legacy per-UC-D ucd_sources reconciles unchanged");
  }
  {
    // Per-file form: equivalent pass, drift and ID mismatch reject.
    const {root,entry,declare}=fixture("per-file");
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    activate(root,"tdd");for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    rmSync(join(root,entry.path));declare();
    const saved=read(root,i13Path), legacy=saved.ucd_sources as Record<string, { file: string; sha256: string }>;
    put(root,i13Path,{...saved,ucd_sources:perFileForm(saved)});
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    // Content drift and a moved/renamed source record are rejected in both forms.
    const file=legacy["UC-D-001"].file, original=readFileSync(join(root,file),"utf8");
    put(root,file,original+"\nsource drift\n");
    assert.throws(()=>sourceDeletions(root,"project","default"),/source changed/);
    put(root,file,original);
    const perFile=read(root,i13Path).ucd_sources as Record<string, { sha256: string; ucd_ids: string[] }>;
    for(const ids of [[],[`UC-D-999`],[`UC-D-001`,`UC-D-001`]]) {
      put(root,i13Path,{...saved,ucd_sources:{[file]:{...perFile[file],ucd_ids:ids}}});
      assert.throws(()=>sourceDeletions(root,"project","default"),/declaration/);
    }
    put(root,i13Path,{...saved,ucd_sources:{["docs/aidlc/modules/project/inception/application-design/test-cases/moved.md"]:perFile[file]}});
    assert.throws(()=>sourceDeletions(root,"project","default"),/source changed/);
    // Mixing per-case and per-file records in one declaration is rejected.
    put(root,i13Path,{...saved,ucd_sources:{...perFile,[`UC-D-001`]:legacy[`UC-D-001`]}});
    assert.throws(()=>sourceDeletions(root,"project","default"),/mixes/);
    put(root,i13Path,{...saved,ucd_sources:perFile});
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    // The legacy form still drift-rejects against the same live sources.
    put(root,file,original+"\nsource drift\n");
    put(root,i13Path,{...saved,ucd_sources:legacy});
    assert.throws(()=>sourceDeletions(root,"project","default"),/source changed/);
    put(root,file,original);
    console.log("PASS per-file ucd_sources reconciles; drift, moved record, ID mismatch and mixed forms rejected");
  }
  {
    // An aggregate file's record must list every UC-D the file declares.
    const {root,entry,declare}=fixture("aggregate",true);
    activate(root,"test-case-derivation");run(root,["evidence","run","--stage","test-case-derivation","--sensor","test-case-derivation"]);
    activate(root,"tdd");for(const sensor of ["red-test-evidence","baseline-test-evidence"])run(root,["evidence","run","--stage","tdd","--sensor",sensor]);
    rmSync(join(root,entry.path));declare();
    const saved=read(root,i13Path), file=`${caseRoot}/removals.md`, perFile=perFileForm(saved);
    assert.deepEqual(perFile[file].ucd_ids,[`UC-D-001`,`UC-D-002`]);
    put(root,i13Path,{...saved,ucd_sources:perFile});
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    put(root,i13Path,{...saved,ucd_sources:{[file]:{...perFile[file],ucd_ids:[`UC-D-001`]}}});
    assert.throws(()=>sourceDeletions(root,"project","default"),/declaration/);
    put(root,i13Path,{...saved,ucd_sources:perFile});
    assert.deepEqual(sourceDeletions(root,"project","default").map(e=>e.path),[entry.path]);
    console.log("PASS aggregate file ucd_ids must match every declared UC-D");
  }
} finally { rmSync(scratch,{recursive:true,force:true}); }
