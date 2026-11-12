import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { acquireOwnedLock } from "../core/tools/aidlc-owned-lock";
const root=mkdtempSync(join(tmpdir(),"aidlc-lock-")),path=join(root,"lock");
try {
 const release=acquireOwnedLock(path);const before=readFileSync(path);assert.throws(()=>acquireOwnedLock(path,25),/LOCK_BUSY/);assert.deepEqual(readFileSync(path),before);release();
 writeFileSync(path,"");assert.throws(()=>acquireOwnedLock(path,0),/OWNER_UNKNOWN/);unlinkSync(path);
 const child=spawn(process.execPath,["-e",`const fs=require('fs');fs.writeFileSync(${JSON.stringify(path)},JSON.stringify({version:1,pid:process.pid,hostname:require('os').hostname(),lock_id:'dead-child'}));`],{windowsHide:true});await new Promise<void>((r,j)=>{child.once("error",j);child.once("exit",c=>c===0?r():j(Error(String(c))));});
 const recovered=acquireOwnedLock(path);recovered();
 const busy=spawn(process.execPath,["-e",`const fs=require('fs');fs.writeFileSync(${JSON.stringify(path)},JSON.stringify({version:1,pid:process.pid,hostname:require('os').hostname(),lock_id:'busy-child'}));console.log('ready');setTimeout(()=>fs.unlinkSync(${JSON.stringify(path)}),100);`],{windowsHide:true});await new Promise<void>((r,j)=>{busy.stdout.once("data",()=>r());busy.once("error",j);});const after=acquireOwnedLock(path,1000);after();await new Promise<void>(r=>busy.exitCode!==null?r():busy.once("exit",()=>r()));
 writeFileSync(path,JSON.stringify({version:1,pid:process.pid,hostname:"foreign",lock_id:"foreign"}));assert.throws(()=>acquireOwnedLock(path,0),/OWNER_UNKNOWN/);
 console.log("PASS live bounded wait, active lock preserved, dead owner recovered, legacy/foreign owner stays unknown");
} finally { rmSync(root,{recursive:true,force:true}); }
