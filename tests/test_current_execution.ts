import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateCompletion, type CompletionInput } from "../core/tools/aidlc-completion.js";
import { methodCatalog, readMethod } from "../core/tools/aidlc-methods.js";
const met = (id: string) => ({id, status: "met" as const, evidence: `actual-output:${id}`});
const complete = (): CompletionInput => ({scope:"CR:form-validation",coverage:"complete",implementation:[met("field")],verification:[met("valid-invalid-boundary")],acceptance:[met("behavior")]});
assert.equal(evaluateCompletion().overall,"not_evaluated");
assert.equal(evaluateCompletion({...complete(),implementation:[],verification:[],acceptance:[]}).overall,"not_evaluated");
assert.equal(evaluateCompletion(complete()).overall,"complete");
for(const group of ["implementation","verification","acceptance"] as const)for(const status of ["unknown","unmet","stale"] as const){
 const input=complete();input[group][0].status=status;assert.notEqual(evaluateCompletion(input).overall,"complete",`${group}:${status}`);
}
for(const coverage of ["partial","unknown"] as const){const result=evaluateCompletion({...complete(),coverage,closure:[met("close")]});assert.notEqual(result.overall,"complete");assert.notEqual(result.closure,"complete");}
const missing=complete();delete missing.verification[0].evidence;assert.equal(evaluateCompletion(missing).verification,"not_evaluated");
const external=complete();external.acceptance=[{id:"real-environment",status:"unknown"}];const waiting=evaluateCompletion(external);assert.equal(waiting.verification,"complete");assert.equal(waiting.acceptance,"not_evaluated");
const delivery={...complete(),delivery:[{id:"push",status:"unknown" as const}]};assert.notEqual(evaluateCompletion(delivery).overall,"complete");
assert.equal(evaluateCompletion({...delivery,closure:[met("close")] }).closure,"not_evaluated","required delivery pending prevents CR closure even when local acceptance passed");
assert.equal(evaluateCompletion({...complete(),unresolved:["known defect"],closure:[met("archive")]}).closure,"incomplete");
assert.equal(evaluateCompletion(complete()).permissions_granted,false);
assert.throws(()=>evaluateCompletion({...complete(),approved:true}),/Unknown/);
assert.throws(()=>evaluateCompletion({...complete(),verification:[met("dup"),met("dup")]}),/duplicate/);
const catalog=methodCatalog();assert.equal(catalog.length,21);assert(catalog.every(m=>!Object.hasOwn(m,"content")));
const method=readMethod("aidlc-application-design");assert(method.includes("组件"));assert(!method.includes("aidlc-figma-design"));
assert.throws(()=>readMethod("../../package.json"),/Unknown/);
const project=fs.mkdtempSync(path.join(os.tmpdir(),"aidlc-current-")),repo=process.cwd();
function cli(args:string[]){return spawnSync(process.execPath,[path.join(repo,"bin/cli.js"),...args],{cwd:project,encoding:"utf8",timeout:20000,windowsHide:true,env:{...process.env,AIDLC_SESSION_BINDING:"obsolete",AIDLC_EXECUTION_GRANT:"invalid"}});}
try{
 fs.mkdirSync(path.join(project,"aidlc/active"),{recursive:true});fs.writeFileSync(path.join(project,"aidlc/active/aidlc-state.md"),"historical completed stage; keep unchanged");
 const before=fs.readFileSync(path.join(project,"aidlc/active/aidlc-state.md"));
 for(const command of ["orchestrate","module","autonomy","runtime","agent","evidence","worktree","attest","approve","cr","check","graph","hook"]){const result=cli([command]);assert.notEqual(result.status,0,command);assert(result.stderr.includes("Unsupported command"),result.stderr);}
 const help=cli(["help"]);assert.equal(help.status,0,help.stderr);assert(help.stdout.includes("methods"));assert(!help.stdout.includes("orchestrate next"));
 assert.notEqual(cli(["help","legacy"]).status,0);
 const work=cli(["work"]);assert.equal(work.status,0,work.stderr);assert.equal(JSON.parse(work.stdout).completion.overall,"not_evaluated");
 // Actual local form change: failed input boundary, repair, then real assertions.
 fs.writeFileSync(path.join(project,"form.cjs"),"module.exports=n=>n>=0;\n");
 fs.writeFileSync(path.join(project,"form.test.cjs"),"const assert=require('node:assert/strict');const valid=require('./form.cjs');assert.equal(valid(0),false);assert.equal(valid(-1),false);assert.equal(valid(1),true);\n");
 const run=()=>spawnSync(process.execPath,["form.test.cjs"],{cwd:project,encoding:"utf8",windowsHide:true});
 assert.notEqual(run().status,0);fs.writeFileSync(path.join(project,"form.cjs"),"module.exports=n=>Number.isFinite(n)&&n>0;\n");const check=run();assert.equal(check.status,0,check.stderr);
 fs.writeFileSync(path.join(project,"validation.log"),`node form.test.cjs\nexit=${check.status}\n${check.stdout}${check.stderr}`);
 const input=complete();input.verification[0].evidence="validation.log";fs.writeFileSync(path.join(project,"result.json"),JSON.stringify(input));
 const result=cli(["assess","--input","result.json"]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).overall,"complete");
 fs.writeFileSync(path.join(project,"handoff.md"),"actual verification: validation.log; existing authorization reused");
 assert.equal(cli(["assess","--input","result.json"]).stdout,result.stdout,"a pure delivery record does not change the supplied validation facts");
 input.verification[0].status="stale";fs.writeFileSync(path.join(project,"result.json"),JSON.stringify(input));assert.equal(JSON.parse(cli(["assess","--input","result.json"]).stdout).overall,"incomplete");
 assert.notEqual(cli(["assess","--input","../outside.json"]).status,0);
 assert.deepEqual(fs.readFileSync(path.join(project,"aidlc/active/aidlc-state.md")),before);assert(!fs.existsSync(path.join(project,".aidlc")),"read-only helpers do not create workflow, grants or receipts");
 console.log("PASS: completion boundaries, scoped methods, retired commands, actual form repair, record reuse, preserved history and no permission grants");
}finally{fs.rmSync(project,{recursive:true,force:true});}
