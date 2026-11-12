// Compact read-only snapshots of the two actual runs. No authority files are read.
import fs from 'node:fs';import path from 'node:path';
const evaluation=import.meta.dirname;
for(const key of (process.argv.length>2?process.argv.slice(2):['orders-r10','publish-r14'])){
 const dir=path.join(evaluation,key),root=JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'))).root,run=JSON.parse(fs.readFileSync(path.join(root,'pilot/grant-request.json'))).run_id,host=path.join(root,'.aidlc/host-runs',run);
 const read=(file)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):undefined;
 const operator=fs.readdirSync(dir).filter(p=>p.startsWith('operator-'+run+'-')).sort().at(-1);
 const controller=operator?fs.readFileSync(path.join(dir,operator,'controller.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse):[];
 const state=fs.readFileSync(path.join(root,'aidlc/active/aidlc-state.md'),'utf8');
 const result={key,at:new Date().toISOString(),operator_event:controller.at(-1),current_stage:state.match(/^- Current Stage: (.*)$/m)?.[1],current_instance:state.match(/^- Current Instance: (.*)$/m)?.[1],updated:state.match(/^- Updated At: (.*)$/m)?.[1],exit:read(path.join(host,'exit.json'))};
 const events=path.join(host,'native-events.jsonl');if(fs.existsSync(events)){const stat=fs.statSync(events),fd=fs.openSync(events,'r');try{const b=Buffer.alloc(Math.min(100000,stat.size));fs.readSync(fd,b,0,b.length,stat.size-b.length);const rows=b.toString().split(/\r?\n/).slice(1).filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean).map(e=>e.event||e),last=rows.findLast(e=>e.method==='aidlc/tool/result');result.native_log_bytes=stat.size;result.native_log_updated=stat.mtime.toISOString();if(last){const r=last.params?.result;result.last_tool={success:last.params?.success,error:last.params?.error,kind:r?.kind,stage:r?.stage,message:r?.message?.slice(0,700),status:r?.status,exit_code:r?.exit_code,stderr:r?.stderr?.slice(-800)};}}finally{fs.closeSync(fd);}}
 console.log(JSON.stringify(result));
}
