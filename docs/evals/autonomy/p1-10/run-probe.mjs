// Fresh real-model/tool/browser/cancellation observation; not an admission or business result.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nativeProbe} from '../../../../harness/codex/runtime/aidlc-codex-host.mjs';
const name=process.argv[2];if(!/^(orders|publish)(?:-r(?:[2-9]|[1-9][0-9]+))?$/.test(name))throw Error('Explicit pilot key required');
const directory=path.join(import.meta.dirname,name),manifest=JSON.parse(fs.readFileSync(path.join(directory,'preparation.json'),'utf8'));
const c=JSON.parse(fs.readFileSync(path.join(manifest.root,'pilot/host-seed.json'),'utf8'));
const nonce=randomUUID(),file=path.join(directory,'native-probe-'+nonce+'.json');
const challenge={nonce,limits:{wall_time_seconds:120,max_equivalent_retries:1,max_active_units:1},required_capabilities:['model-turn','continuous-session','budget-enforcement',...(manifest.name==='publish'?['browser-dom','browser-screenshot','browser-interaction']:[])]};
const started_at=new Date().toISOString();
try{
  const result=await nativeProbe(c,manifest.root,challenge);
  fs.writeFileSync(file,JSON.stringify({kind:'actual-native-capability-observation',started_at,finished_at:new Date().toISOString(),workflow_id:manifest.workflow_id,challenge,result,admission_evaluated:false,business_verified:false},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({file,thread_id:result.thread_id,model:result.model,turns:result.turns.map(t=>t.status),cancel_reconciled:result.cancellation.reconciled,browser:result.browser?.png_valid,business_verified:false}));
}catch(e){fs.writeFileSync(file,JSON.stringify({started_at,finished_at:new Date().toISOString(),error:String(e),workflow_id:manifest.workflow_id,business_verified:false},null,2)+'\n',{flag:'wx'});throw e;}
