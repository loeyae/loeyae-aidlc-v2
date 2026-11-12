/** Shared ownership/deadline facts. This is neither an execution grant nor a recovery manager. */
const {performance}=require('node:perf_hooks'),{randomUUID}=require('node:crypto'),{spawn,ChildProcess}=require('node:child_process');
const policy=require('./data/native-host-action-policy.json').resource_limits,children=new WeakMap();
function resourceLimits(overrides={}){
 if(!overrides||typeof overrides!=='object'||Array.isArray(overrides)||Object.keys(overrides).some(k=>!Object.hasOwn(policy,k)))throw Error('RESOURCE_LIMITS_INVALID');
 const value={...policy,...overrides};for(const [key,n]of Object.entries(value))if(!Number.isSafeInteger(n)||n<1||n>policy[key])throw Error('RESOURCE_LIMITS_INVALID');return Object.freeze(value);
}
function deadlineAfter(ms){if(!Number.isFinite(ms)||ms<0)throw Error('RESOURCE_DEADLINE_INVALID');return performance.now()+ms;}
function remaining(deadline){if(!Number.isFinite(deadline))throw Error('RESOURCE_DEADLINE_INVALID');return Math.max(0,deadline-performance.now());}
async function bounded(promise,deadline,code='RESOURCE_WAIT_TIMEOUT'){
 let timer;try{return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(code),{code})),remaining(deadline));})]);}finally{clearTimeout(timer);}
}
function resourceError(resource,cause){return Object.assign(Error('RESOURCE_CLOSE_UNRECONCILED: '+resource.kind),{code:'RESOURCE_CLOSE_UNRECONCILED',resource_reconciliation:{reconciled:false,resources:[resource]},cause});}
class OwnedResource {
 constructor(handle,{kind,owner,deadline_at=null,tree=false,requestClose,force,detach,log=()=>{},limits={}}){
  if(!handle||!['browser','socket','service','native','worker','command','helper'].includes(kind)||typeof owner!=='string'||!owner||owner.length>180)throw Error('RESOURCE_OWNER_INVALID');
  this.handle=handle;this.kind=kind;this.owner=owner;this.id=randomUUID();this.created_at=new Date().toISOString();this.deadline_at=deadline_at;this.tree=tree;this.requestClose=requestClose;this.force=force;this.detach=detach;this.log=log;this.limits=resourceLimits(limits);this.signals=[];this.helpers=[];
  this.closed=new Promise(resolve=>this.resolveClosed=resolve);this.started=Number.isSafeInteger(handle.pid);this.process_exited=false;this.close_observed=false;
  const on=(name,fn)=>typeof handle.once==='function'?handle.once(name,fn):handle.addEventListener(name,fn,{once:true});
  on('error',error=>{this.error_code=String(error?.code||'RESOURCE_ERROR');this.emit('error');});
  if(kind!=='socket'){
   on('spawn',()=>{this.started=true;this.emit('spawn');});
   on('exit',(code,signal)=>{this.process_exited=true;this.exit_code=code;this.exit_signal=signal;this.emit('exit-observed');});
  }
  on('close',(code,signal)=>{this.close_observed=true;if(kind!=='socket'&&this.started){this.process_exited=true;this.exit_code=typeof code==='number'?code:this.exit_code;this.exit_signal=typeof signal==='string'?signal:this.exit_signal;}this.emit('close-observed');this.resolveClosed(this.snapshot());});
  this.emit('owned');
 }
 emit(event){this.log({event:'resource-'+event,resource_id:this.id,kind:this.kind,owner:this.owner,pid:this.handle.pid||null,at:new Date().toISOString(),process_exited:this.process_exited,close_observed:this.close_observed});}
 snapshot(){return {schema:'aidlc.owned-resource/v1',resource_id:this.id,kind:this.kind,owner:this.owner,pid:this.handle.pid||null,created_at:this.created_at,deadline_at:this.deadline_at,started:this.started,process_exited:this.process_exited,close_observed:this.close_observed,exit_code:this.exit_code??null,exit_signal:this.exit_signal||null,error_code:this.error_code||null,termination_requests:[...this.signals],helpers:this.helpers.map(h=>h.closeResult||h.snapshot()),eventloop_detached:this.detached===true};}
 async wait(deadline){try{await bounded(this.closed,deadline);return true;}catch{return this.close_observed;}}
 canSignal(){return !this.close_observed&&!this.process_exited&&this.handle.exitCode==null&&this.handle.signalCode==null;}
 signal(signal){
  if(!this.canSignal())return false;
  let sent=false,error=null;try{sent=this.handle.kill(signal)!==false;}catch(e){error=String(e.code||'SIGNAL_FAILED');}
  this.signals.push({signal,requested:sent,error_code:error,at:new Date().toISOString()});this.emit('termination-request');return sent;
 }
 async forceTree(deadline){
  if(!this.canSignal())return;
  if(this.force){try{await bounded(this.force(),deadline);}catch{this.error_code='RESOURCE_FORCE_FAILED';}return;}
  if(this.tree&&process.platform==='win32'&&this.handle instanceof ChildProcess&&this.handle._handle&&Number.isSafeInteger(this.handle.pid)){
   // Only this still-live ChildProcess's tree. A missing close or PID is not permission to target another process.
   const child=spawn('taskkill',['/PID',String(this.handle.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
   const helper=ownChild(child,{kind:'helper',owner:this.id,limits:this.limits});this.helpers.push(helper);
   this.signals.push({signal:'taskkill-tree',requested:true,at:new Date().toISOString()});
   if(!await helper.wait(deadline))await helper.close({deadline});
  }else if(this.tree&&process.platform!=='win32'&&this.handle instanceof ChildProcess&&this.handle._handle&&Number.isSafeInteger(this.handle.pid)){
   try{process.kill(-this.handle.pid,'SIGKILL');this.signals.push({signal:'SIGKILL-group',requested:true,at:new Date().toISOString()});}catch{this.signal('SIGKILL');}
  }else this.signal('SIGKILL');
 }
 releaseEventLoop(){
  try{this.detach?.();}catch{}
  for(const stream of [this.handle.stdin,this.handle.stdout,this.handle.stderr])try{stream?.destroy();}catch{}
  try{if(this.handle.connected)this.handle.disconnect();}catch{}
  try{this.handle.channel?.unref?.();this.handle.unref?.();this.detached=typeof this.handle.unref==='function';}catch{}
  this.emit('unknown-detached');
 }
 async close({deadline=deadlineAfter(this.limits.close_grace_ms+this.limits.terminate_ms+this.limits.force_ms)}={}){
  if(this.closing)return this.closing;
  remaining(deadline);deadline=Math.min(deadline,deadlineAfter(this.limits.close_grace_ms+this.limits.terminate_ms+this.limits.force_ms));
  this.closing=(async()=>{
   if(!this.close_observed&&this.requestClose){try{await bounded(this.requestClose(),Math.min(deadline,deadlineAfter(this.limits.close_grace_ms)));}catch{}}
   if(!this.close_observed&&!await this.wait(Math.min(deadline,deadlineAfter(this.limits.close_grace_ms)))){
    if(this.kind==='socket'){try{if(this.force)await bounded(this.force(),Math.min(deadline,deadlineAfter(this.limits.terminate_ms)));}catch{this.error_code='RESOURCE_FORCE_FAILED';}}
    else this.signal('SIGTERM');
    if(!await this.wait(Math.min(deadline,deadlineAfter(this.limits.terminate_ms)))){
     if(this.kind!=='socket')await this.forceTree(Math.min(deadline,deadlineAfter(this.limits.force_ms)));
     await this.wait(deadline);
    }
   }
   const reconciled=this.close_observed&&this.helpers.every(h=>h.closeResult?h.closeResult.reconciled:h.close_observed);
   const facts=this.snapshot();if(!reconciled)this.releaseEventLoop();
   this.closeResult={...facts,status:reconciled?'closed':'unknown',reconciled,eventloop_detached:this.detached===true};this.emit(reconciled?'reconciled':'unknown');return this.closeResult;
  })();return this.closing;
 }
}
function ownChild(child,options){if(children.has(child)){const resource=children.get(child);if(resource.owner!==options.owner)throw Error('RESOURCE_OWNER_MISMATCH');return resource;}const resource=new OwnedResource(child,options);children.set(child,resource);return resource;}
function ownedChild(child){const resource=children.get(child);if(!resource)throw Error('RESOURCE_NOT_OWNED');return resource;}
function ownSocket(socket,options){return new OwnedResource(socket,{...options,kind:'socket'});}
function assertReconciled(result,cause){if(!result.reconciled)throw resourceError(result,cause);return result;}
const FAILURE_MARKER='AIDLC_RESOURCE_UNRECONCILED ';
function announceResourceFailure(facts){process.stderr.write(FAILURE_MARKER+JSON.stringify(facts)+'\n');}
function parseResourceFailure(output,final=false){
 const text=String(output||''),lines=text.split(/\r?\n/);if(!final)lines.pop();
 const line=lines.find(value=>value.startsWith(FAILURE_MARKER));if(!line)return null;
 try{const facts=JSON.parse(line.slice(FAILURE_MARKER.length));if(facts.reconciled===false&&Array.isArray(facts.resources))return facts;}catch{}
 return {reconciled:false,resources:[{kind:'native',status:'unknown',reconciled:false,error_code:'INVALID_RESOURCE_DIAGNOSTIC'}]};
}
async function runCommand(argv, options = {}) {
  const {cwd,env,signal,timeout_ms=30000,onStart=()=>{}}=options;
  const limits=resourceLimits(options.resource_limits);
  if(!Array.isArray(argv)||!argv.length||!Number.isSafeInteger(timeout_ms)||timeout_ms<1||timeout_ms>2147483647)throw Error('RESOURCE_COMMAND_DEADLINE_INVALID');
  if(signal?.aborted)return {status:'cancelled',exit_code:null,started:false,reconciled:true,stdout:'',stderr:''};
  return await new Promise(resolve=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,env,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const resource=ownChild(child,{kind:'command',owner:options.owner||'host-command',tree:true,deadline_at:Date.now()+timeout_ms,limits,log:options.resourceLog});
    let stdout='',stderr='',bytes=0,cause=null,error=null,settled=false,closing,nestedUnknown;
    const finish=(reconciliation,code=child.exitCode,sig=child.signalCode)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      nestedUnknown ||=parseResourceFailure(stderr,true);
      resolve({status:!reconciliation.reconciled?'unknown':cause||(code===0&&!error?'succeeded':'failed'),termination_reason:cause,exit_code:code??null,signal:sig||null,error:error||cause||null,started:resource.started,pid:child.pid,reconciled:reconciliation.reconciled,resource:reconciliation,resource_reconciliation:nestedUnknown||{reconciled:reconciliation.reconciled,resources:[reconciliation]},stdout,stderr});
    };
    const stop=reason=>{
      if(settled||cause)return;cause=reason;const end=deadlineAfter(resource.limits.close_grace_ms+resource.limits.terminate_ms+resource.limits.force_ms);
      closing=(async()=>{await resource.forceTree(Math.min(end,deadlineAfter(resource.limits.force_ms)));const result=await resource.close({deadline:end});finish(result);return result;})();closing.catch(()=>finish({...resource.snapshot(),status:'unknown',reconciled:false}));
    };
    const abort=()=>stop('cancelled'),timer=setTimeout(()=>stop('timeout'),timeout_ms);signal?.addEventListener('abort',abort,{once:true});
    const collect=(chunk,out)=>{
      bytes+=Buffer.byteLength(chunk);if(bytes>1048576){stop('output-limit');return;}if(out)stdout+=chunk;else stderr+=chunk;
      const diagnostic=parseResourceFailure(stderr);if(diagnostic){nestedUnknown=diagnostic;stop('resource-unreconciled');}
      if(out&&options.observeResourceFailure&&stdout.includes('resource_reconciliation')){
        try{const data=JSON.parse(stdout),facts=data.autonomous_observations?.resource_reconciliation||data.resource_reconciliation;if(facts?.reconciled===false){nestedUnknown=facts;stop('resource-unreconciled');}}catch{}
      }
    };
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',b=>collect(b,true));child.stderr.on('data',b=>collect(b,false));
    child.once('spawn',()=>{onStart(child.pid);if(signal?.aborted)abort();});child.once('error',e=>{error=String(e);stop('failed');});
    child.once('close',async(code,sig)=>{const result=closing?await closing:await resource.close();finish(result,code,sig);});
  });
}
module.exports={runCommand,resourceLimits,deadlineAfter,remaining,bounded,OwnedResource,ownChild,ownedChild,ownSocket,resourceError,assertReconciled,announceResourceFailure,parseResourceFailure};
