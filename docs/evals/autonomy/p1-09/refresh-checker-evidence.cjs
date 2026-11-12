// EOF-only cleanup changed checker bytes: regenerate referenced receipts on the final identity.
const fs=require('fs'),cp=require('child_process'),dir='docs/evals/autonomy/p1-09';
const suites=[['observations','tests/test_observations.ts'],['runtime-observations','tests/test_runtime_observations.ts'],['batch-convergence','tests/test_batch_convergence.ts'],['typecheck',null]];
const results=[];let index=0;
async function worker(){while(index<suites.length){const [name,file]=suites[index++],args=file?['node_modules/tsx/dist/cli.mjs',file]:['node_modules/typescript/bin/tsc','--noEmit'];const log=dir+'/'+name+'-final-4.log',fd=fs.openSync(log,'w'),started_at=new Date().toISOString();
const r=await new Promise(resolve=>{const c=cp.spawn(process.execPath,args,{env:{...process.env,AIDLC_EVAL_DIR:dir},stdio:['ignore',fd,fd],windowsHide:true});c.on('error',e=>resolve({exit_code:null,error:String(e)}));c.on('exit',(exit_code,signal)=>resolve({exit_code,signal}));});fs.closeSync(fd);results.push({name,command:[process.execPath,...args],...r,started_at,finished_at:new Date().toISOString(),log,reason:'refresh after EOF-only checker identity cleanup'});fs.writeFileSync(dir+'/test-results-final-5.json',JSON.stringify(results,null,2)+'\n');console.log(name+': '+r.exit_code);}}
Promise.all([worker(),worker()]).then(()=>{process.exitCode=results.some(r=>r.exit_code!==0)?1:0;});
