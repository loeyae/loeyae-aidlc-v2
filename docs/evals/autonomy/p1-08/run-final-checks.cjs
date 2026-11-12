const fs=require('fs'),cp=require('child_process');
const dir='docs/evals/autonomy/p1-08';
const checks=[
  ['distribution-parity',process.execPath,['node_modules/tsx/dist/cli.mjs','tests/test_distribution_parity.ts'],'distribution-parity.log'],
  ['checker-identity',process.execPath,['node_modules/tsx/dist/cli.mjs',dir+'/checker-final.ts'],'checker-identity-final.json'],
  ['public-inspect',process.execPath,['bin/cli.js','orchestrate','autonomy','batch','inspect'],'public-inspect-final.json'],
  ['whitespace','git',['-c','core.whitespace=cr-at-eol','diff','--check'],'whitespace-final.log']
];
Promise.all(checks.map(async([name,exe,args,file])=>{
  const log=dir+'/'+file,fd=fs.openSync(log,'w'),started_at=new Date().toISOString();
  const r=await new Promise(resolve=>{const c=cp.spawn(exe,args,{stdio:['ignore',fd,fd],windowsHide:true});c.on('error',error=>resolve({exit_code:null,error:String(error)}));c.on('exit',(exit_code,signal)=>resolve({exit_code,signal}));});fs.closeSync(fd);
  const result={name,command:[exe,...args],...r,started_at,finished_at:new Date().toISOString(),log};
  if(name==='distribution-parity')fs.writeFileSync(dir+'/parity-result.json',JSON.stringify(result,null,2)+'\n');
  console.log(name+': '+r.exit_code);return result;
})).then(results=>{fs.writeFileSync(dir+'/additional-check-results.json',JSON.stringify(results,null,2)+'\n');process.exitCode=results.some(r=>r.exit_code!==0)?1:0;});

