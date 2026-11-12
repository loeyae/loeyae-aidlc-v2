/** An owned service replacement inside the same active run. Never recovery or a new attempt. */
import {existsSync,lstatSync,readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('../../../../core/tools/aidlc-owned-resource.cjs');
export class OwnedReload {
  private active?:Promise<void>;private controller=new AbortController();private closed=false;private last='';
  constructor(private c:any,private runtime:any){
    const file=join(c.root,'.runtime/reload-ack.json');if(c.recovery&&existsSync(file)&&!lstatSync(file).isSymbolicLink()){try{const ack=JSON.parse(readFileSync(file,'utf8'));if(!ack.error&&ack.candidate===c.service?.candidate_commit&&/^[a-f0-9-]{36}$/.test(ack.id))this.last=ack.id;}catch{}}
  }
  tick():Promise<void>{
    if(this.closed||this.active)return this.active||Promise.resolve();
    const file=join(this.c.root,'.runtime/reload-request.json');if(!existsSync(file))return Promise.resolve();
    if(lstatSync(file).isSymbolicLink())return Promise.reject(Error('RELOAD_LINKED_REQUEST'));
    let request:any;try{request=JSON.parse(readFileSync(file,'utf8'));}catch{return Promise.resolve();}
    if(request.id===this.last)return Promise.resolve();this.last=request.id;
    this.active=this.replace(request).finally(()=>{this.active=undefined;});return this.active;
  }
  private async replace(request:any){
    const c=this.c,r=this.runtime,end=R.deadlineAfter(Math.min(r.limits.reload_ms,Math.max(0,c.deadline-Date.now())));
    const receipt=r.reloadStarted?.();let reconciled=true;
    c.log({event:'reload-start',request_id:request.id,owner:c.request.run_id,deadline_at:new Date(Date.now()+R.remaining(end)).toISOString()});
    try{
      if(!/^[a-f0-9-]{36}$/.test(request.id)||request.candidate!==r.git(c.root,['rev-parse','HEAD']))throw Error('RELOAD_INPUT_CHANGED');
      await r.stopService(c.service.child,{deadline:end});
      if(this.closed||this.controller.signal.aborted||Date.now()>=c.deadline)throw Error('RELOAD_CANCELLED_OR_EXPIRED');
      const service=await r.startService(c.root,r.businessEnv(c.env),{owner:c.request.run_id,limits:r.limits,deadline_at:Math.min(c.deadline,Date.now()+R.remaining(end)),signal:this.controller.signal,log:c.log});
      c.service=service;
      if(this.closed||this.controller.signal.aborted){await r.stopService(service.child);throw Error('RELOAD_CANCELLED');}
      if(service.candidate_commit!==request.candidate)throw Error('RELOAD_SERVING_CANDIDATE_CHANGED');
      writeFileSync(join(c.root,'.runtime/reload-ack.json'),JSON.stringify({id:request.id,candidate:request.candidate,resource_reconciliation:{reconciled:true}}));
      c.log({event:'reload-completed',request_id:request.id,owner:c.request.run_id,pid:service.child.pid,candidate_commit:request.candidate});
    }catch(error:any){
      if(error.resource_reconciliation?.reconciled===false){reconciled=false;c.resourceIssues.push(error.resource_reconciliation);}
      writeFileSync(join(c.root,'.runtime/reload-ack.json'),JSON.stringify({id:request.id,error:String(error),resource_reconciliation:error.resource_reconciliation||{reconciled:true}}));
      c.log({event:'reload-failed',request_id:request.id,reason_code:error.resource_reconciliation?'RESOURCE_UNRECONCILED':'RELOAD_FAILED'});
    }finally{if(receipt&&reconciled)r.reloadClosed?.(receipt);}
  }
  async close(){
    this.closed=true;this.controller.abort();
    if(this.active){try{await R.bounded(this.active,R.deadlineAfter(this.runtime.limits.reload_ms+this.runtime.limits.close_grace_ms+this.runtime.limits.terminate_ms+this.runtime.limits.force_ms),'RELOAD_CLOSE_TIMEOUT');}
      catch{const result={reconciled:false,resources:[{kind:'reload',owner:this.c.request.run_id,request_id:this.last,status:'unknown',reconciled:false}]};this.c.resourceIssues.push(result);return result;}}
    return {reconciled:this.c.resourceIssues.length===0,resources:this.c.resourceIssues};
  }
}
