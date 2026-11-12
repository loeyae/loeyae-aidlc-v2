// Harness-owned limits/measurement inside the existing Supervisor, not a scheduler.
const {performance}=require('node:perf_hooks'),{createHash,randomUUID}=require('node:crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PHASES=['host-control','model-rpc','queue','producer','browser-visual','evidence-publication','admission-refresh','cleanup'];
function supervisionLimits(overrides,defaults){
  if(overrides!==undefined&&(!overrides||typeof overrides!=='object'||Array.isArray(overrides)))throw Error('HOST_SUPERVISION_CONFIG_INVALID');
  if(Object.keys(overrides||{}).some(k=>!Object.hasOwn(defaults,k)))throw Error('HOST_SUPERVISION_CONFIG_INVALID');
  const result={...defaults,...overrides};
  for(const [key,value]of Object.entries(result))if(!Number.isSafeInteger(value)||value<1||value>defaults[key])throw Error('HOST_SUPERVISION_CONFIG_INVALID');
  return Object.freeze(result);
}
class ExecutionTrace {
  constructor(write=()=>{},now=()=>performance.now(),utc=()=>new Date().toISOString()){
    this.write=write;this.now=now;this.utc=utc;this.origin=now();this.active=new Map();this.closed=[];
  }
  emit(event,data={}){
    const allowed=new Set(['span_id','parent_span_id','phase','family','stage_instance','input_digest','candidate_digest','turn_sequence','step_sequence','status','reason_code','progress_kind','remaining_wall_ms','count','limit','timeout_ms','duration_ms','exclusive_ms','origin','mode']);
    if(Object.keys(data).some(k=>!allowed.has(k)))throw Error('HOST_TRACE_FIELD_INVALID');
    for(const [key,value]of Object.entries(data)){
      if(value===undefined||value===null)continue;
      if(['input_digest','candidate_digest'].includes(key)&&!/^[a-f0-9]{64}$/.test(value))throw Error('HOST_TRACE_DIGEST_INVALID');
      if(typeof value==='string'&&(!/^[A-Za-z0-9_:@.-]{1,180}$/.test(value)))throw Error('HOST_TRACE_VALUE_INVALID');
      if(typeof value==='number'&&(!Number.isFinite(value)||value<0))throw Error('HOST_TRACE_VALUE_INVALID');
      if(!['string','number'].includes(typeof value))throw Error('HOST_TRACE_VALUE_INVALID');
    }
    this.write({schema:'aidlc.execution-trace/v1',event,at:this.utc(),monotonic_ms:Math.max(0,this.now()-this.origin),...data});
  }
  start(phase,data={},parent=null){
    if(!PHASES.includes(phase))throw Error('HOST_TRACE_PHASE_INVALID');
    if(this.closed.length+this.active.size>=16384)throw Error('HOST_TRACE_LIMIT');
    const row={id:randomUUID(),parent:parent?.id||null,depth:(parent?.depth??-1)+1,phase,start:this.now(),data};this.active.set(row.id,row);
    this.emit('span-start',{span_id:row.id,parent_span_id:row.parent,phase,...data});return row;
  }
  end(row,status='succeeded'){
    if(!row||!this.active.delete(row.id))return;
    row.end=this.now();const intervals=[...this.closed,...[...this.active.values()].map(c=>({...c,end:row.end}))].filter(c=>c.parent===row.id).map(c=>[Math.max(row.start,c.start),Math.min(row.end,c.end)]).sort((a,b)=>a[0]-b[0]);
    let covered=0,end=row.start;for(const [s,e]of intervals){covered+=Math.max(0,e-Math.max(s,end));end=Math.max(end,e);}
    this.closed.push(row);this.emit('span-end',{span_id:row.id,parent_span_id:row.parent,phase:row.phase,status,duration_ms:Math.max(0,row.end-row.start),exclusive_ms:Math.max(0,row.end-row.start-covered)});
  }
  importObservation(report,parent){
    if(!parent||!report?.producer?.execution_id||!Number.isFinite(report.timing?.duration_ms))return;
    const end=this.now(),base=Math.max(parent.start,end-report.timing.duration_ms);
    for(const item of report.observations||[]){
      if(!Number.isFinite(item.timing?.offset_ms)||!Number.isFinite(item.timing?.duration_ms)||item.timing.offset_ms<0||item.timing.duration_ms<0)continue;
      const phase=item.kind==='ui'?'browser-visual':'producer',start=Math.min(end,base+item.timing.offset_ms),finish=Math.min(end,start+item.timing.duration_ms);
      const child={id:randomUUID(),parent:parent.id,depth:parent.depth+1,phase,start,end:finish};this.closed.push(child);
      this.emit('reported-span',{span_id:child.id,parent_span_id:parent.id,phase,origin:'core-monotonic',duration_ms:finish-start});
    }
  }
  summary(){
    const end=this.now(),rows=[...this.closed,...[...this.active.values()].map(r=>({...r,end}))];
    const events=[{time:this.origin},{time:end},...rows.flatMap(row=>[{time:row.start,row,add:true},{time:row.end,row,add:false}])].sort((a,b)=>a.time-b.time),phases={},active=new Map();
    const priority={'model-rpc':0,queue:1,'host-control':2,producer:3,'admission-refresh':3,'evidence-publication':4,'browser-visual':5,cleanup:6};
    for(let i=0;i<events.length;){
      const start=events[i].time;while(i<events.length&&events[i].time===start){const event=events[i++];if(event.row&&event.row.end>event.row.start){if(event.add)active.set(event.row.id,event.row);else active.delete(event.row.id);}}
      if(i===events.length)break;
      let top;for(const row of active.values())if(!top||row.depth>top.depth||row.depth===top.depth&&priority[row.phase]>priority[top.phase])top=row;
      const phase=top?.phase||'unattributed';phases[phase]=(phases[phase]||0)+events[i].time-start;
    }
    return {schema:'aidlc.execution-timing-summary/v1',wall_duration_ms:Math.max(0,end-this.origin),phases_ms:phases,active_spans:this.active.size,intervals_double_counted:false,model_time_meaning:'model-rpc includes native/RPC wait; never inferred model thinking'};
  }
}
class ProgressBudget {
  constructor(limits,budget,{now=()=>performance.now(),trace=new ExecutionTrace(),onStop=()=>{}}={}){
    this.limits=limits;this.budget=budget;this.now=now;this.trace=trace;this.onStop=onStop;this.steps=0;this.turns=0;this.withoutProgress=0;this.paused=0;this.leases=new Map();this.repeats=new Map();this.seen=new Set();this.lastProgress=this.clock();this.wallDeadline=now()+Math.max(0,budget.deadline-(budget.now?.()??Date.now()));
  }
  clock(){return this.now()-this.paused-(this.leases.size?this.now()-this.pauseStarted:0);}
  remaining(){return Math.max(0,Math.min(this.wallDeadline-this.now(),this.budget.deadline-(this.budget.now?.()??Date.now())));}
  snapshot(){return {steps:this.steps,turns:this.turns,withoutProgress:this.withoutProgress,seen:[...this.seen],acquiredInputs:[...(this.acquiredInputs||[])],repeats:[...this.repeats],failures:[...this.budget.failures],idle_elapsed_ms:Math.max(0,this.clock()-this.lastProgress),saved_at:Date.now(),stopped:this.stopped||this.budget.stopped||null,routing:this.routing||null};}
  restore(s){
    if(!s)return;
    for(const key of ['steps','turns','withoutProgress'])if(!Number.isSafeInteger(s[key])||s[key]<0)throw Error('HOST_DURABLE_BUDGET_INVALID');
    if(!Number.isFinite(s.saved_at)||Date.now()<s.saved_at||!Number.isFinite(s.idle_elapsed_ms)||s.idle_elapsed_ms<0)throw Error('HOST_DURABLE_CLOCK_INVALID');
    if(s.acquiredInputs!==undefined&&(!Array.isArray(s.acquiredInputs)||s.acquiredInputs.length>this.limits.max_steps||s.acquiredInputs.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k))))throw Error('HOST_DURABLE_BUDGET_INVALID');
    this.routing=s.routing;this.steps=s.steps;this.turns=s.turns;this.withoutProgress=s.withoutProgress;this.seen=new Set(s.seen);this.acquiredInputs=new Set(s.acquiredInputs||[]);this.repeats=new Map(s.repeats);this.budget.failures=new Map(s.failures);
    this.lastProgress=this.clock()-s.idle_elapsed_ms-(Date.now()-s.saved_at);if(s.stopped){this.stopped=s.stopped;this.budget.stop(s.stopped);}
  }
  persist(){
    if(!this.onPersist)return;
    const snapshot=this.snapshot(),{saved_at,idle_elapsed_ms,...semantic}=snapshot;
    // An unchanged checkpoint does not reset idle time. On restart the previous
    // saved_at includes the elapsed interval, conservatively including bounded waits.
    const key=JSON.stringify(semantic);
    if(key===this.lastPersisted)return;
    this.onPersist(snapshot);this.lastPersisted=key;
  }
  stop(reason){
    if(!this.stopped){this.stopped=reason;this.budget.stop(reason);this.trace.emit('stop',{reason_code:reason,remaining_wall_ms:this.remaining()});this.onStop(reason);}
    return Object.assign(Error('HOST_SUPERVISION_'+reason.toUpperCase().replaceAll('-','_')),{host_stop_reason:reason});
  }
  check(){
    try{this.budget.check();}catch(error){error.host_stop_reason=this.budget.stopped;throw error;}
    if(this.remaining()<=0)throw this.stop('wall-time');if(this.stopped)throw this.stop(this.stopped);
    for(const lease of this.leases.values())if(this.now()>=lease.deadline)throw this.stop('step-time');
    if(this.clock()-this.lastProgress>=this.limits.idle_timeout_ms)throw this.stop('no-semantic-progress');
    if(this.turn&&this.clock()-this.turn.started>=this.limits.turn_timeout_ms)throw this.stop('turn-time');
    if(this.step&&this.clock()-this.step.started>=this.limits.step_timeout_ms)throw this.stop('step-time');
  }
  beginTurn(mode,stage){
    this.check();if(this.turn)throw Error('HOST_TURN_OVERLAP');
    if(this.turns>=this.limits.max_turns)throw this.stop('turn-limit');
    this.turn={sequence:++this.turns,steps:0,started:this.clock(),span:this.trace.start('model-rpc',{mode,stage_instance:stage,turn_sequence:this.turns})};this.persist();return this.turn;
  }
  endTurn(status){if(!this.turn)return;this.trace.end(this.turn.span,status);this.turn=null;}
  beginStep(family,stage,input){
    this.check();if(this.step)throw Error('HOST_STEP_OVERLAP');
    if(this.steps>=this.limits.max_steps)throw this.stop('step-limit');
    if(this.turn&&this.turn.steps>=this.limits.max_steps_per_turn)throw this.stop('turn-step-limit');
    if(this.withoutProgress>=this.limits.max_steps_without_progress)throw this.stop('no-progress-step-limit');
    this.steps++;this.withoutProgress++;if(this.turn)this.turn.steps++;
    this.step={started:this.clock(),span:this.trace.start('host-control',{family,stage_instance:stage,input_digest:input,step_sequence:this.steps},this.turn?.span)};this.persist();return this.step;
  }
  endStep(status){if(!this.step)return;this.trace.end(this.step.span,status);this.step=null;this.persist();}
  beginBounded(timeout){
    this.check();if(!Number.isFinite(timeout)||timeout<1)throw Error('HOST_STEP_BOUND_INVALID');
    const token=randomUUID();if(!this.leases.size)this.pauseStarted=this.now();
    this.leases.set(token,{deadline:this.now()+Math.min(timeout,this.remaining())});return token;
  }
  endBounded(token){if(!this.leases.delete(token))return;if(!this.leases.size)this.paused+=this.now()-this.pauseStarted;}
  inputAcquired(key){
    // New validated file/section content is bounded preparation, not a semantic
    // checkpoint: never reset unproductive steps, repeated actions or retries.
    this.check();this.acquiredInputs??=new Set();
    if(this.acquiredInputs.has(key))return false;
    if(!/^[a-f0-9]{64}$/.test(key)||this.acquiredInputs.size>=this.limits.max_steps)throw Error('HOST_INPUT_ACTIVITY_INVALID');
    this.acquiredInputs.add(key);this.lastProgress=this.clock();
    this.trace.emit('input-acquired',{input_digest:key,remaining_wall_ms:this.remaining()});this.persist();return true;
  }
  checkpoint(kind,key){
    const identity=kind+':'+key;if(this.seen.has(identity))return false;
    this.seen.add(identity);this.lastProgress=this.clock();this.withoutProgress=0;this.repeats.clear();
    this.trace.emit('progress',{progress_kind:kind,input_digest:digest(identity),remaining_wall_ms:this.remaining()});this.persist();return true;
  }
  observation(request,outcome){
    this.check();const key=digest([request,outcome]),count=(this.repeats.get(key)||0)+1;this.repeats.set(key,count);
    this.persist();if(count>this.limits.max_repeated_actions)throw this.stop('repeated-action');
  }
}
module.exports={supervisionLimits,ExecutionTrace,ProgressBudget};
