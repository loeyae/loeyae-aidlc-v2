/** Actual entry refusals under the repository HOLD; no fake consent and no pilot writes. */
import assert from 'node:assert/strict';import {readFileSync,readdirSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),base='docs/evals/autonomy/p1-10',hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const beforeFiles=['aidlc/active/aidlc-state.md','aidlc/active/audit.md',...['orders-r10','publish-r14'].flatMap(n=>[base+'/'+n+'/preparation.json','.worktrees/aidlc-p1-10-'+n+'/aidlc/active/aidlc-state.md'])];
const before=Object.fromEntries(beforeFiles.filter(p=>existsSync(join(root,p))).map(p=>[p,hash(join(root,p))])),directories=readdirSync(join(root,base)).sort();
const absent=['.aidlc/host-runs','.aidlc/autonomy/grants','.git/aidlc/autonomy'];for(const p of absent)assert.equal(existsSync(join(root,p)),false);
const run=(file:string,args:string[],expected:number)=>{const r=spawnSync(process.execPath,['--import','tsx',base+'/'+file,...args],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(r.status,expected,r.stdout+r.stderr);return r;};
for(const args of [['--check'],['--check','--retry-unstarted'],['orders-r999999','--check']]){const r=run('operator-pilots.ts',args,0),value=JSON.parse(r.stdout);assert.equal(value.integration_review.decision,'HOLD');assert.equal(value.ready_for_actual_terminal_review,false);assert.equal(value.execution_authorized,false);assert.deepEqual(value.pilots,[]);}
for(const args of [[],['--retry-unstarted']])assert.equal(JSON.parse(run('operator-pilots.ts',args,2).stdout).integration_review.decision,'HOLD');
for(const args of [['--gate','somewhere'],['--worker'],['--go']])assert.match(run('operator-pilots.ts',args,2).stderr,/ARGUMENT_DENIED/);
assert.equal(JSON.parse(run('verify-before-operator.ts',[],2).stdout).ready_for_actual_terminal_review,false);
assert.match(run('pilot-worker.ts',['--worker'],1).stderr,/INTEGRATION_REVIEW_HOLD/);
assert.match(run('operator-runner.ts',[],1).stderr,/INTEGRATION_REVIEW_HOLD/);
assert.match(run('operator-orders.ts',[],1).stderr,/INTEGRATION_REVIEW_HOLD|LEGACY_ENTRY_RETIRED/);
if(process.platform==='win32'){const ps=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,base,'operator-pilots.ps1'),'-RetryUnstarted'],{cwd:root,windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(ps.status,2,ps.stdout+ps.stderr);assert.equal(JSON.parse(ps.stdout).integration_review.decision,'HOLD');}
for(const [p,digest]of Object.entries(before))assert.equal(hash(join(root,p)),digest,p);for(const p of absent)assert.equal(existsSync(join(root,p)),false);assert.deepEqual(readdirSync(join(root,base)).sort(),directories);
console.log('Integration entry: 13 actual HOLD/refusal checks passed; no pilot state, service, grant or Native start');
