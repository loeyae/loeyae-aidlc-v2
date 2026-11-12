import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join, dirname, resolve } from 'node:path';
import { waitForDevToolsPort } from '../core/tools/aidlc-observation-browser';
const root=mkdtempSync(join(tmpdir(),'aidlc-chrome-startup-')),file=join(root,'DevToolsActivePort');let count=0;
async function test(name:string,fn:()=>unknown){await fn();count++;console.log('PASS '+name);}
try{
  writeFileSync(file,'62123\n/devtools/browser/test');
  await test('a transient actual-file EBUSY/ENOENT race is retried inside the original deadline',async()=>{
    let reads=0;const port=await waitForDevToolsPort(file,Date.now()+1000,()=>false,()=>'',p=>{reads++;if(reads<3)throw Object.assign(new Error('transient file publication'),{code:reads===1?'EBUSY':'ENOENT'});return readFileSync(p,'utf8');});
    assert.equal(port,62123);assert.equal(reads,3);
  });
  await test('permanent file locks stop at the deadline without fabricating a port',async()=>{
    const started=Date.now();await assert.rejects(()=>waitForDevToolsPort(file,started+60,()=>false,()=> 'browser diagnostics',()=>{throw Object.assign(new Error('busy'),{code:'EBUSY'});}),/CHROME_START_FAILED: browser diagnostics.*EBUSY/);assert.ok(Date.now()-started<1000);
  });
  await test('closed browsers and expired deadlines do not perform another read',async()=>{
    let reads=0;const read=()=>{reads++;return '62123';};await assert.rejects(()=>waitForDevToolsPort(file,Date.now()+1000,()=>true,()=>'',read),/CHROME_START_FAILED/);await assert.rejects(()=>waitForDevToolsPort(file,Date.now()-1,()=>false,()=>'',read),/CHROME_START_FAILED/);assert.equal(reads,0);
  });
  await test('permissions, unknown failures and invalid port values remain failures',async()=>{
    for(const code of ['EACCES','EPERM','EIO'])await assert.rejects(()=>waitForDevToolsPort(file,Date.now()+1000,()=>false,()=>'',()=>{throw Object.assign(new Error(code),{code});}),new RegExp(code));
    for(const value of ['', 'abc','0','65536','2.5'])await assert.rejects(()=>waitForDevToolsPort(file,Date.now()+1000,()=>false,()=>'',()=>value),/CHROME_PORT_INVALID/);
  });
  console.log(`Chrome startup: ${count} engineering scenarios passed; no UI acceptance inferred`);
}finally{assert.equal(resolve(dirname(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true});}
