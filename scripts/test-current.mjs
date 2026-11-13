import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {testPython} from './run-python.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.AIDLC_TEST_OUTPUT?resolve(process.env.AIDLC_TEST_OUTPUT):mkdtempSync(join(tmpdir(),'aidlc-current-tests-'));
mkdirSync(output,{recursive:true});
const suites=JSON.parse(readFileSync(join(root,'scripts/core-test-suites.json'),'utf8'));
const env={...process.env,AIDLC_TEST_PYTHON:testPython(),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',AIDLC_EXPORT_PROJECT:'',AIDLC_EXPORT_HOST_PROVIDER:'',AIDLC_DOCX_PROJECT:'',AIDLC_DOCX_HOST_PROVIDER:''};
// Each current test creates its own temporary project/home. No history clone,
// global installation, source commit or artificial managed binding is needed.
const records=[];
async function run(name,args,executable=process.execPath){
 const start=Date.now();let stdout='',stderr='';
 const exit=await new Promise(done=>{const child=spawn(executable,args,{cwd:root,env,windowsHide:true});child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>stderr+=String(e));child.on('close',code=>done(code));});
 const result={name,command:[executable,...args],exit,elapsed_ms:Date.now()-start,stdout,stderr};
 writeFileSync(join(output,`${name}.json`),JSON.stringify(result,null,2)+'\n');records.push(result);
 writeFileSync(join(output,'results.json'),JSON.stringify({records:records.map(({stdout,stderr,...r})=>r)},null,2)+'\n');
 console.log(`${exit===0?'PASS':'FAIL'} ${name} (${result.elapsed_ms} ms)`);if(exit!==0)console.error((stdout+stderr).slice(-4000));return exit;
}
const build=await run('build',['--import','tsx','scripts/build.ts','--all']);
if(build===0)for(const [engine,file,...args]of suites){
 if(!['tsx','node','python'].includes(engine))throw Error('Unexpected suite engine');
 await run(file.split('/').at(-1).replace(/\.(ts|mjs|py)$/,''),engine==='tsx'?['--import','tsx',file,...args]:[file,...args],engine==='python'?testPython():process.execPath);
}
const failed=records.filter(r=>r.exit!==0);console.log(`${records.length-failed.length}/${records.length} passed; logs: ${output}`);if(failed.length)process.exitCode=1;
