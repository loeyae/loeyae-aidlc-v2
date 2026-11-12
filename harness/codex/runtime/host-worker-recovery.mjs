/** Private parent/child lifecycle bridge. No public CLI or model recovery API. */
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
import K from './host-kernel.cjs';
export function workerApi(c){const require=createRequire(c.core_cli),{require:load}=require('tsx/cjs/api');const file=[path.resolve(path.dirname(c.core_cli),'../core/tools/aidlc-worker-recovery.ts'),path.resolve(path.dirname(c.core_cli),'../tools/aidlc-worker-recovery.ts'),path.resolve(path.dirname(c.core_cli),'aidlc-worker-recovery.ts')].find(fs.existsSync);if(!file)throw Error('WORKER_CORE_UNAVAILABLE');return load(file,c.core_cli);}
export async function requestWorkerPermit(root,grant,grantRef,c,ipc=process){
 if(!c.worker_entrypoint||!ipc.connected||typeof ipc.send!=='function'||process.env.AIDLC_RESOURCE_OWNER!==grant.run_id)throw Error('HOST_WORKER_CHANNEL_REQUIRED');
 const nonce=randomUUID(),deadline=K.resources.deadlineAfter(Math.max(1,Math.min(10000,Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000)-Date.now())));let onMessage,onDisconnect;
 const response=new Promise((resolve,reject)=>{onMessage=m=>{if(m?.kind!=='worker-permit'||m.nonce!==nonce)return;if(m.run_id!==grant.run_id||m.grant_digest!==grantRef.digest||typeof m.permit!=='string'||!Number.isSafeInteger(m.expected))return reject(Error('HOST_WORKER_PERMIT_CHANGED'));resolve(m);};onDisconnect=()=>reject(Error('HOST_WORKER_DISCONNECTED'));ipc.on('message',onMessage);ipc.once('disconnect',onDisconnect);});response.catch(()=>{});
 try{await K.resources.bounded(new Promise((res,rej)=>ipc.send({kind:'worker-permit-request',nonce,run_id:grant.run_id,grant_digest:grantRef.digest,thread_id:grant.executor_constraints.session_id,pid:process.pid},e=>e?rej(e):res())),deadline,'HOST_WORKER_SEND_TIMEOUT');return await K.resources.bounded(response,deadline,'HOST_WORKER_PERMIT_TIMEOUT');}
 finally{ipc.off('message',onMessage);ipc.off('disconnect',onDisconnect);}
}
export async function acknowledgeWorker(lease,grantRef,deadlineAt,ipc=process){
 let onMessage,onDisconnect;const nonce=randomUUID(),deadline=K.resources.deadlineAfter(Math.max(1,Math.min(10000,deadlineAt-Date.now())));
 const ack=new Promise((res,rej)=>{onMessage=m=>{if(m?.kind==='worker-attempt-accepted'&&m.nonce===nonce&&m.attempt_id===lease.state.attempt_id)res();};onDisconnect=()=>rej(Error('HOST_WORKER_DISCONNECTED'));ipc.on('message',onMessage);ipc.once('disconnect',onDisconnect);});ack.catch(()=>{});
 try{await K.resources.bounded(new Promise((res,rej)=>ipc.send({kind:'worker-attempt-ready',nonce,run_id:grantRef.run_id,grant_digest:grantRef.digest,attempt_id:lease.state.attempt_id,private_token:lease.token,private_binding:lease.coordinator},e=>e?rej(e):res())),deadline,'HOST_WORKER_READY_TIMEOUT');await K.resources.bounded(ack,deadline,'HOST_WORKER_ACK_TIMEOUT');}
 finally{ipc.off('message',onMessage);ipc.off('disconnect',onDisconnect);}
}
const authorityKeys=['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING','AIDLC_ATTEMPT_TOKEN'];
export function inWorkerAuthority(env,fn){const before=Object.fromEntries(authorityKeys.map(k=>[k,process.env[k]]));try{for(const k of authorityKeys)if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];return fn();}finally{for(const k of authorityKeys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}
export function createWorkerRecovery(c,config,runApi,identity=K.processIdentity){
 if(!config.worker_entrypoint||path.resolve(config.worker_entrypoint)!==path.resolve(process.argv[1]))throw Error('WORKER_ENTRYPOINT_CHANGED');
 if(K.canonical(K.identity(path.join(c.root,'pilot/host.json')))!==K.canonical(c.grant.executor_constraints.host))throw Error('WORKER_HOST_CHANGED');
 const api=workerApi(config),call=fn=>inWorkerAuthority(c.env,fn),prior=runApi.inspectRecovery(c.root),registered=call(()=>api.registerWorker(c.root,prior?.revision||0,identity,{entrypoint:config.worker_entrypoint,digest:K.hash(fs.readFileSync(config.worker_entrypoint))}));
 const token=registered.token;
 const send=(child,message)=>child.send(message,error=>{if(error){c.resourceIssues.push({reconciled:false,resources:[{kind:'worker-ipc',status:'unknown'}]});c.closeNative?.();}});
 return {
  state:()=>runApi.inspectRecovery(c.root),
  intent(kind){const id=randomUUID();call(()=>api.workerResource(c.root,token,identity,'intent',id,kind));return id;},
  started(id,pid){call(()=>api.workerResource(c.root,token,identity,'started',id,undefined,identity(pid)));},
  closed(id){call(()=>api.workerResource(c.root,token,identity,'closed',id));},
  ready(){call(()=>api.workerReady(c.root,token,identity));},
  quiesced(){call(()=>api.workerQuiesced(c.root,token,identity));c.recoveryReady=false;},
  finish(cancel=false){call(()=>api.finishWorker(c.root,token,identity,cancel));},
  handle(child,m){
   if(!['worker-permit-request','worker-attempt-ready'].includes(m?.kind))return false;
   if(m.run_id!==c.request.run_id||m.grant_digest!==c.grantRef.digest)throw Error('WORKER_CHILD_SCOPE_CHANGED');
   if(m.kind==='worker-permit-request'){
     if(m.pid!==child.pid||m.thread_id!==c.h4.thread_id)throw Error('WORKER_CHILD_IDENTITY_CHANGED');
     const permit=call(()=>api.issueWorkerPermit(c.root,token,identity,child.pid,m.nonce));send(child,{kind:'worker-permit',nonce:m.nonce,run_id:m.run_id,grant_digest:m.grant_digest,...permit});
   }else{
     const s=runApi.inspectRecovery(c.root);
     if(s.status!=='active'||s.attempt_id!==m.attempt_id||s.host_process.pid!==child.pid||s.token_digest!==K.hash(K.canonical(m.private_token))||K.canonical(s.coordinator)!==K.canonical(m.private_binding))throw Error('WORKER_CHILD_CREDENTIAL_CHANGED');
     c.env.AIDLC_ATTEMPT_TOKEN=m.private_token;c.env.AIDLC_SESSION_BINDING=c.env.AIDLC_COORDINATOR_BINDING=JSON.stringify(m.private_binding);c.recoveryReady=true;
     send(child,{kind:'worker-attempt-accepted',nonce:m.nonce,attempt_id:s.attempt_id});
   }return true;
  }
 };
}
