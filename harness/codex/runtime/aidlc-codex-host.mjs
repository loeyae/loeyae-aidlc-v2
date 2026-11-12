#!/usr/bin/env node
// Harness-owned transport and bounded routing glue. Codex remains the model/tool Supervisor.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import K from './host-kernel.cjs';
import {modelRoute,ModelReadCache} from './host-model-input.mjs';
import {openRecovery,supervise,recoverableTransport} from './host-recovery.mjs';
const {hash,safe,config,identity,Budget,command}=K, here=path.dirname(fileURLToPath(import.meta.url));
export class CodexClient {
  constructor(c,cwd,event=()=>{}) {
    const resourceLimits=K.resources.resourceLimits(c.resource_limits);this.c=c;this.cwd=cwd;this.event=event;this.serial=0;this.pending=new Map();this.listeners=new Set();this.tools=async()=>{throw Error('HOST_GATEWAY_NOT_READY');};
    const argv=c.codex_entrypoint.endsWith('.js')?[process.execPath,c.codex_entrypoint]:[c.codex_entrypoint];
    this.child=spawn(argv[0],[...argv.slice(1),'app-server','--stdio'],{cwd,windowsHide:true,shell:false,detached:process.platform!=='win32',env:K.businessEnv(process.env),stdio:['pipe','pipe','pipe']});
    this.resource=K.resources.ownChild(this.child,{kind:'native',owner:process.env.AIDLC_RESOURCE_OWNER||'native-client-'+randomUUID(),tree:true,limits:resourceLimits,requestClose:()=>this.child.stdin.end()});
    this.child.stdin.on('error',()=>{});
    this.stderr='';this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b).slice(-4000);});
    this.child.once('spawn',()=>{this.nativeIdentity=K.processIdentity(this.child.pid);this.event({method:'aidlc/native-process-start',params:{pid:this.child.pid,ppid:process.pid,process_start:this.nativeIdentity}});});
    this.closed=new Promise(resolve=>this.child.once('close',(code,signal)=>{this.nativeClosed=true;this.event({method:'aidlc/native-process-exit',params:{pid:this.child.pid,code,signal}});for(const p of this.pending.values())p.reject(Error('HOST_DISCONNECTED'));this.pending.clear();for(const listener of this.listeners)listener({method:'host/disconnected'});resolve({code,signal});}));
    this.child.on('error',e=>{for(const p of this.pending.values())p.reject(e);});
    createInterface({input:this.child.stdout}).on('line',line=>{try {if(line.length>2097152)throw Error('HOST_RPC_LIMIT');this.receive(JSON.parse(line));}catch{this.child.kill();}});
  }
  send(value){if(this.child.stdin.destroyed)return;this.child.stdin.write(JSON.stringify(value)+'\n');}
  async queuedTool(p){
    if((this.queuedTools||0)>=32)throw Error('HOST_TOOL_QUEUE_LIMIT');
    this.queuedTools=(this.queuedTools||0)+1;
    const queued=this.executionTrace?.start('queue',{family:'tool-queue'},this.executionTurnSpan);
    const task=(this.toolTail||Promise.resolve()).then(()=>{if(queued)this.executionTrace.end(queued);if(p.threadId!==this.thread)throw Error('HOST_WRONG_TOOL_OR_THREAD');return this.tools(p.arguments);});
    this.toolTail=task.then(()=>{},()=>{});
    try{return await task;}finally{if(queued)this.executionTrace.end(queued);this.queuedTools--;}
  }
  async receive(m){
    if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}return;}
    this.event(m);
    if(m.id!==undefined){
      if(m.method==='item/tool/call'){
        try{const p=m.params;if(p.threadId!==this.thread||p.tool!=='aidlc_action')throw Error('HOST_WRONG_TOOL_OR_THREAD');const result=modelProjection(await this.queuedTool(p));this.event({method:'aidlc/tool/result',params:{threadId:this.thread,callId:m.id,result,success:true}});this.send({id:m.id,result:{contentItems:[{type:'inputText',text:JSON.stringify(result)}],success:true}});}
        catch(e){this.event({method:'aidlc/tool/result',params:{threadId:this.thread,callId:m.id,error:String(e),success:false}});this.send({id:m.id,result:{contentItems:[{type:'inputText',text:String(e)}],success:false}});}return;
      }
      // Never auto-approve native command, filesystem, MCP or permission escalation.
      this.send({id:m.id,error:{code:-32000,message:'AI-DLC requires the structured gateway; no native escalation granted'}});return;
    }
    for(const listener of this.listeners)listener(m);
  }
  request(method,params,timeout=30000){return new Promise((resolve,reject)=>{const id=++this.serial,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('HOST_RPC_TIMEOUT: '+method));},timeout);this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});this.send({id,method,params});});}
  async initialize(){
    const initialized=await this.request('initialize',{clientInfo:{name:'loeyae-aidlc-p1',version:'1'},capabilities:{experimentalApi:true}});this.nativeUserAgent=initialized.userAgent;this.send({method:'initialized'});
    const settings=await this.request('config/read',{includeLayers:false});
    this.nativeDigest=hash(K.canonical(settings.config));
    if(this.c.native_config_digest&&this.c.native_config_digest!==this.nativeDigest)throw Error('HOST_NATIVE_CONFIG_CHANGED');
    this.overrides={features:{shell_tool:false,apply_patch_freeform:false,multi_agent:false,apps:false,hooks:true},hooks:{PreToolUse:[{matcher:'.*',hooks:[{type:'command',command:`node "${path.join(here,'deny-native.cjs')}"`,timeout:10}]}]},mcp_servers:Object.fromEntries(Object.keys(settings.config?.mcp_servers||{}).map(k=>[k,{enabled:false}]))};
  }
  async start(cwd=this.cwd,ephemeral=false){
    const result=await this.request('thread/start',{cwd,ephemeral,sandbox:'read-only',approvalPolicy:'on-request',config:this.overrides,environments:[],developerInstructions:'Use only aidlc_action for project reads, writes, commands and Core routing. Core forms are orchestrate next/report, orchestrate state context/artifact, evidence run, and orchestrate autonomy inspect/policy/decisions/dependencies/record/observe/batch/repair (repair inspect/request only; the host owns start/apply). Do not call bare orchestrate, gate, session commands or report --help; the host owns binding and routing. Await each tool result; parallel requests are serialized within the original budget. Do not spawn/delegate, use native shell/patch/MCP, approve stages, change authorization or mark delivery from your final message. Continue tool work until the formal Core route blocks or needs finalization.',dynamicTools:[{name:'aidlc_action',description:'Bound AI-DLC project gateway. Actions: read(path), rule(path) for installed Core instructions, write(path,content,operation) requires explicit operation=code-write|test-write|design-write, command(id), core(args). read/rule/core accept detail="full"; rule also accepts section=<heading id>. Default rules and evidence may be summarized; unchanged content may be referenced. Fetch necessary detailed sections or full content before acting. If a result says return_control_to_host, return immediately. Never supply session or grant data.',inputSchema:K.modelActionSchema()}]});
    this.thread=result.thread.id;return result;
  }
  async resume(thread){const r=await this.request('thread/resume',{threadId:thread,cwd:this.cwd,sandbox:'read-only',approvalPolicy:'on-request',config:this.overrides});if(r.thread.id!==thread)throw Error('HOST_SESSION_MISMATCH');this.thread=thread;return r;}
  async prepare(){const result=await this.start();const turn=await this.turn('Session preparation only. Reply READY. Do not use tools, read project files, implement anything or change authorization.',undefined,60000);if(turn.status!=='completed')throw Error('HOST_SESSION_PREPARATION_FAILED');return result;}
  async turn(text,signal,timeout=60000){
    if(signal?.aborted)throw Error('HOST_CANCELLED');
    const dispatchId=randomUUID();this.event({method:'aidlc/turn-dispatch',params:{dispatch_id:dispatchId}});
    let turnId;let listener;let timer;let abort;let interruptTimer;
    const done=new Promise((resolve,reject)=>{
      listener=m=>{if(m.method==='host/disconnected'||m.method==='host/resource-unreconciled')reject(Error('HOST_DISCONNECTED_OR_UNRECONCILED'));if(m.method==='turn/completed'&&m.params.threadId===this.thread&&(!turnId||m.params.turn.id===turnId))resolve(m.params.turn);};this.listeners.add(listener);
      abort=()=>{if(turnId)this.request('turn/interrupt',{threadId:this.thread,turnId},5000).catch(()=>{});if(!interruptTimer)interruptTimer=setTimeout(()=>reject(Error('HOST_TURN_CANCEL_UNRECONCILED')),K.supervisionLimits(this.c.supervision_limits).interrupt_grace_ms);};signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{abort();reject(Error('HOST_TURN_TIMEOUT'));},timeout);
    });
    // A disconnect can reject both RPC and completion before the RPC await finishes.
    done.catch(()=>{});
    try{const failure=done.then(()=>new Promise(()=>{}));const r=await Promise.race([this.request('turn/start',{threadId:this.thread,input:[{type:'text',text}],environments:[]}),failure]);turnId=r.turn.id;this.activeTurn=turnId;this.event({method:'aidlc/turn-bound',params:{dispatch_id:dispatchId,turn_id:turnId}});if(signal?.aborted)abort();const result=await done;this.lastTurnStatus=result.status;this.event({method:'aidlc/turn-result',params:{dispatch_id:dispatchId,turn_id:turnId,status:result.status}});return result;}
    catch(error){this.lastTurnStatus='unknown';this.event({method:'aidlc/turn-result',params:{dispatch_id:dispatchId,turn_id:turnId||null,status:'unknown'}});throw error;}
    finally{this.activeTurn=null;clearTimeout(timer);clearTimeout(interruptTimer);this.listeners.delete(listener);signal?.removeEventListener('abort',abort);}
  }
  async close(){
    if(this.closing)return this.closing;
    this.closing=(async()=>{
      const result=await this.resource.close();this.closeResult=result;
      if(!result.reconciled){for(const p of this.pending.values())p.reject(Error('HOST_NATIVE_CLOSE_UNRECONCILED'));this.pending.clear();for(const listener of this.listeners)listener({method:'host/resource-unreconciled'});this.event({method:'aidlc/native-resource-unknown',params:{resource_id:result.resource_id,pid:result.pid}});}
      return result;
    })();return this.closing;
  }
}
/** Lightweight actual config/read only: no thread, model turn, tool or browser probe. */
export async function nativeConfiguration(c,root){
  const started_at=new Date().toISOString(),client=new CodexClient(c,root);let result;
  try{await client.initialize();result={started_at,native_config_digest:client.nativeDigest};}
  finally{const closed=await client.close();if(!closed.reconciled){K.resources.announceResourceFailure({reconciled:false,resources:[closed]});throw K.resources.resourceError(closed);}if(result)result.resource_reconciliation={reconciled:true,resources:[closed]};}
  return result;
}
export async function nativeProbe(c,root,challenge){
  const nonce=challenge.nonce, tools=[],ac=new AbortController(),budget=new Budget(challenge.limits,Math.min(Date.now()+Math.min(challenge.limits.wall_time_seconds*1000,120000),challenge.deadline_at??Infinity));
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-native-p106-')),events=[],client=new CodexClient(c,root,m=>{if(['turn/completed','item/started','item/completed'].includes(m.method))events.push(m);}),resourceIssues=[];let pendingCancellation;
  client.tools=async a=>{budget.enter(JSON.stringify(a));try{if(a.action!=='read'||a.path!=='nonce.txt')throw Error('PROBE_TOOL_DENIED');tools.push(a);return fs.readFileSync(path.join(scratch,'nonce.txt'),'utf8');}finally{budget.leave(JSON.stringify(a),true);}};
  const wallTimer=setTimeout(()=>ac.abort(),Math.max(1,budget.deadline-Date.now()));
  fs.writeFileSync(path.join(scratch,'nonce.txt'),nonce);
  try{
    await client.initialize();const start=await client.start(scratch,true);
    const first=await client.turn('Call aidlc_action with action read and path nonce.txt. Return the exact returned text. No other tool.',ac.signal,Math.max(1,budget.deadline-Date.now()));
    const second=await client.turn('In this same session call aidlc_action again to read nonce.txt, then return the exact nonce again.',ac.signal,120000);
    const output=JSON.stringify(events);
    if(first.status!=='completed'||second.status!=='completed'||tools.length<2||!output.includes(nonce))throw Error('HOST_NATIVE_MODEL_PROBE_FAILED');
    // Cancellation is observed on the real owned command path; no generated passed flag.
    const cancel=new AbortController();ac.signal.addEventListener('abort',()=>cancel.abort(),{once:true});let cancellation;client.tools=async a=>{if(a.action!=='command'||a.id!=='hold')throw Error('PROBE_TOOL_DENIED');pendingCancellation=command([process.execPath,'-e','setInterval(()=>{},1000)'],{cwd:scratch,env:K.businessEnv(process.env),signal:cancel.signal,onStart:()=>cancel.abort()});cancellation=await pendingCancellation;return cancellation;};
    const interrupted=await client.turn('Call aidlc_action with action command and id hold exactly once. Wait for the result.',cancel.signal,Math.max(1,budget.deadline-Date.now()));
    if(pendingCancellation)cancellation=await pendingCancellation;
    const exhausted=new Budget({...challenge.limits,wall_time_seconds:1},Date.now()-1);let denied=false;try{exhausted.enter('late');}catch{denied=true;}
    if(!denied||interrupted.status!=='interrupted'||!cancellation||cancellation.status!=='cancelled'||!cancellation.reconciled)throw Error('HOST_NATIVE_BUDGET_CANCEL_FAILED: '+JSON.stringify({denied,turn:interrupted.status,command:cancellation?.status,reconciled:cancellation?.reconciled}));
    let browser;
    if(challenge.required_capabilities?.some(k=>k.startsWith('browser-'))&&c.browser_entrypoint){
      const page=path.join(scratch,'probe.html'),screenshot=path.join(scratch,'probe.png'),profile=path.join(scratch,'browser-profile');
      fs.writeFileSync(page,`<!doctype html><html><body><button id="b">Probe</button><script>document.getElementById('b').onclick=()=>document.body.setAttribute('data-interaction','${nonce}');document.getElementById('b').click();</script></body></html>`);
      const observation=await command([c.browser_entrypoint,'--headless=new','--disable-gpu',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--virtual-time-budget=1000','--window-size=800,600',`--screenshot=${screenshot}`,'--dump-dom',pathToFileURL(page).href],{cwd:scratch,env:K.businessEnv(process.env),signal:ac.signal,timeout_ms:Math.max(1,Math.min(20000,budget.deadline-Date.now()))});
      if(!observation.reconciled||observation.resource_reconciliation?.reconciled===false){resourceIssues.push(observation.resource_reconciliation||{reconciled:false,resources:[observation.resource]});throw Error('HOST_BROWSER_RESOURCE_UNRECONCILED');}
      const png=fs.existsSync(screenshot)?fs.readFileSync(screenshot):Buffer.alloc(0);
      browser={status:observation.status,exit_code:observation.exit_code,dom:observation.stdout,interaction:observation.stdout.includes(`data-interaction="${nonce}"`),screenshot_sha256:hash(png),screenshot_base64:png.toString('base64'),png_valid:png.length>100&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),viewport:[800,600]};
      if(browser.status!=='succeeded'||!browser.interaction||!browser.png_valid)throw Error('HOST_BROWSER_PROBE_FAILED');
    }
    return {thread_id:client.thread,native_user_agent:client.nativeUserAgent,model:start.model,native_config_digest:client.nativeDigest,nonce,tools,turns:[first,second,interrupted],cancellation,budget_denied:denied,browser,events};
  }finally{clearTimeout(wallTimer);ac.abort();if(pendingCancellation){try{const result=await K.resources.bounded(pendingCancellation,K.resources.deadlineAfter(8000),'PROBE_COMMAND_CLOSE_TIMEOUT');if(!result.reconciled||result.resource_reconciliation?.reconciled===false)resourceIssues.push(result.resource_reconciliation||{reconciled:false,resources:[result.resource]});}catch{resourceIssues.push({reconciled:false,resources:[{kind:'command',status:'unknown'}]});}}const closed=await client.close();if(!closed.reconciled)resourceIssues.push({reconciled:false,resources:[closed]});if(resourceIssues.length){const facts={reconciled:false,resources:resourceIssues.flatMap(r=>r.resources),retained_paths:[scratch]};K.resources.announceResourceFailure(facts);throw Object.assign(Error('HOST_PROBE_RESOURCES_UNRECONCILED'),{resource_reconciliation:facts});}fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
export function modelProjection(value){if(Array.isArray(value))return value.map(modelProjection);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['binding','session_binding','coordinator_binding','host_context','generation','token','token_digest','attempt_token','operation_ref'].includes(k)).map(([k,v])=>[k,modelProjection(v)]));return value;}
export function commandCatalog(c){return (c.commands||[]).map(({id,operation,input_paths,write_paths})=>({id,operation,input_paths,write_paths}));}
export function completionOnly(result){const pending=(result.checks||[]).filter(c=>!['passed','not-required','not-applicable'].includes(c.status));return pending.length>0&&pending.every(c=>c.check_id==='delegated-completeness'&&c.status==='incomplete'||c.check_id==='decision-evidence'&&['blocked','incomplete'].includes(c.status)||c.check_id.startsWith('artifact:')&&c.status==='incomplete');}
export function decisionCompletionGuidance(decisions,observed,rawDigest,author,unit){
  const contract=decisions.write_contract;
  if(contract?.schema!=='aidlc.decision-write-contract/v1'||observed?.status!=='passed'||!observed.receipt_ref?.path||!observed.producer?.stage_instance||!/^[a-f0-9]{64}$/.test(rawDigest))throw Error('HOST_DECISION_WRITE_CONTRACT_UNAVAILABLE');
  return {template_only:true,execution_authorized:false,handoff_path:contract.handoff_path,expected_handoff_digest:contract.expected_handoff_digest,record_command:contract.record_command,implementation_ref_fields:contract.implementation_ref_fields,digest_rule:contract.digest_rule,
    updates:contract.updates.filter(update=>!unit||update.proposal.unit_ref.module_id===unit.module_id&&update.proposal.unit_ref.unit_id===unit.unit_id).map(update=>({decision_id:update.decision_id,proposal_path:update.proposal_path,required_check_ids:update.required_check_ids,proposal:{...update.proposal,recorded_by:author,
      validation_refs:update.runtime_validation_templates.map(ref=>({...ref,stage_instance:observed.producer.stage_instance,path:observed.receipt_ref.path,digest:rawDigest}))}}))};
}
export function coreCommandTimeout(args,deadline,now=Date.now()){return Math.max(1,Math.min(K.describeAction({action:'core',args},{commands:[]},{origin:'host'}).timeout_ms,deadline===undefined?Infinity:deadline-now));}
export const coreAction=K.coreAction;
export const PUBLICATION_MARGIN_MS=K.actionPolicy.publication_margin_ms;
export function needsAdmissionWindow(action){return K.describeAction(action,{commands:action.action==='command'?[{id:action.id,operation:'validation-execute',timeout_ms:1}]:[]},{origin:'host'}).needs_window;}
export function requiredAdmissionWindow(action,c,deadline,now=Date.now()){
  const descriptor=K.describeAction(action,c,{origin:'host'});return K.requiredActionWindow(descriptor.timeout_ms,deadline-now);
}
/** Same temporal states as Core capability selection; authority remains live. */
export function admissionContinuation(value,gateway,minimumMs=0,allowCurrent=false,{phase='admission',refresh_attempts=0}={}){
  const now=Date.now(),remaining=gateway.budget.deadline-now,known=['ready','ready-with-delegated-decisions','not-ready'].includes(value?.admission_result);
  return K.decideExecutionContinuation({now,deadline_at:gateway.budget.deadline,required_ms:Math.max(0,Math.min(minimumMs,remaining-PUBLICATION_MARGIN_MS)),available_until:Date.parse(value?.valid_until||''),status:known&&value.admission_result!=='not-ready'?'current':known?'refresh-required':'blocked',pending:(gateway.pending?.size||0)>(allowCurrent?1:0),unknown:!!gateway.unknown?.length,stop_reason:!known?'admission-inspect-invalid':minimumMs&&remaining<=PUBLICATION_MARGIN_MS*2?'original-budget-insufficient':undefined,refresh_attempts,phase});
}
export function protectedCoreTimeout(args,deadline,admissionDeadline,now=Date.now()){
  const ordinary=coreCommandTimeout(args,deadline,now);if(!needsAdmissionWindow({action:'core',args})||!Number.isFinite(admissionDeadline))return ordinary;
  const available=admissionDeadline-now-PUBLICATION_MARGIN_MS;if(available<1)throw Error('HOST_ADMISSION_WINDOW_EXPIRED');return Math.min(ordinary,available);
}
export function protectedCommandTimeout(timeout,deadline,admissionDeadline,now=Date.now()){
  if(!Number.isFinite(admissionDeadline))throw Error('HOST_ADMISSION_WINDOW_REQUIRED');
  const available=Math.min(deadline-now,admissionDeadline-now-PUBLICATION_MARGIN_MS);
  if(available<1)throw Error('HOST_ADMISSION_WINDOW_EXPIRED');return Math.min(timeout,available);
}
/** The same predispatch guard handles model requests and trusted host convergence. */
export async function prepareDispatchAction(action,c,{origin='model',mode='implementation',budget,requireWindow}={}){
  budget?.check();const descriptor=K.describeAction(action,c,{origin,mode});
  if(descriptor.needs_window){if(!requireWindow)throw Error('HOST_ADMISSION_WINDOW_REQUIRED');await requireWindow(action);}
  budget?.check();return descriptor;
}
/** Cleanup uses held credentials and the ordinary inspect/release CAS; it never rebuilds a binding. */
export async function releaseOwnedBindings(core,bindings){
  const inherited=process.env.AIDLC_SESSION_BINDING,released=[],failures=[];
  try{
    const unique=new Map(bindings.filter(Boolean).map(b=>[b.stage_instance,b]));
    for(const binding of unique.values()){
      process.env.AIDLC_SESSION_BINDING=JSON.stringify(binding);
      try{
        const current=await core(['module','inspect','--stage-instance',binding.stage_instance]);
        if(!current.claim)continue;
        if(current.workflow_id!==binding.workflow_id||current.claim.generation!==binding.generation||current.claim.session_id!==binding.session_id||current.claim.owner!==binding.owner)throw Error('HOST_RELEASE_CLAIM_CHANGED');
        await core(['module','release','--stage-instance',binding.stage_instance,'--expect',current.expected]);released.push(binding.stage_instance);
      }catch(e){failures.push({stage_instance:binding.stage_instance,error:String(e)});}
    }
  }finally{if(inherited===undefined)delete process.env.AIDLC_SESSION_BINDING;else process.env.AIDLC_SESSION_BINDING=inherited;}
  return {released,failures,reconciled:failures.length===0};
}
/** Keep trusted routing diagnostics intact; process failures never become repair permission. */
export function coreResponse(result,args){
  let value;try{value=JSON.parse(result.stdout);}catch{}
  const resourceFacts=result.resource_reconciliation?.reconciled===false?result.resource_reconciliation:value?.autonomous_observations?.resource_reconciliation||value?.resource_reconciliation;
  if(resourceFacts?.reconciled===false)throw Object.assign(Error('CORE_RESOURCES_UNRECONCILED'),{host_stop_reason:'resource-unreconciled',resource_reconciliation:resourceFacts,core_reconciled:result.reconciled});
  if(result.reconciled&&result.status==='succeeded'&&value&&value.kind!=='error'){
    if(args[0]==='orchestrate'&&args[1]==='next'&&args.includes('--preview')&&value.kind==='print'&&value.preview===true&&value.next_stage?.stage_instance===value.stage_instance)return {...value,...value.next_stage,kind:'run-stage',preview:true};
    return value;
  }
  // The existing single phase producer writes its evidence under a lock and
  // intentionally emits no stdout. Exit 0 completes this command, not a gate.
  const sensor=args[args.indexOf('--sensor')+1];
  if(result.reconciled&&result.status==='succeeded'&&result.exit_code===0&&!result.stdout?.trim()&&args[0]==='evidence'&&args[1]==='run'&&args.includes('--sensor')&&['red-test-evidence','green-test-evidence','baseline-test-evidence'].includes(sensor))return {kind:'print',execution_status:'command-completed',evidence_verified:false,message:'Controlled phase command completed without stdout; inspect the output evidence and formal Core gates.'};
  if(result.reconciled&&result.status==='failed'&&result.exit_code===2&&args[0]==='orchestrate'&&args[1]==='next'&&value?.kind==='error')return value;
  throw Object.assign(Error(value?.message||result.stderr||result.stdout||result.status),{core_reconciled:result.reconciled,core_status:result.status});
}
/** A local preview has no execution status on the actual public CLI. Never a project verdict. */
export function emptyLocalPreview(route){
  return route.execution_status==='scope-exhausted'||(route.kind==='print'&&route.preview===true&&route.stage_instance===null&&route.next_stage===null&&route.next_stage_status==='none');
}
// Canonicalize command meaning for retry accounting; this never changes dispatched arguments.
export function normalizedCoreArgs(args){
  const prefix=[],options={};let invalid=false;
  for(let i=0;i<args.length;i++){
    const token=args[i];if(!token.startsWith('--')){prefix.push(token);continue;}
    const equal=token.indexOf('='),name=(equal<0?token:token.slice(0,equal)).replace(/^--stage-instance$/,'--instance');
    const value=equal<0?(args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true):token.slice(equal+1);
    if(Object.hasOwn(options,name))invalid=true;options[name]=value;
  }
  if(['evidence','orchestrate'].includes(prefix[0])&&(prefix[0]==='evidence'||prefix[1]==='report')){
    const instance=options['--instance']||(typeof options['--stage']==='string'?options['--stage']+(options['--module']?'@module:'+options['--module']:'')+(options['--unit']?'@unit:'+options['--unit']:''):null);
    if(instance){options['--instance']=instance;for(const name of ['--stage','--module','--unit'])delete options[name];}
  }
  return {prefix,options,invalid};
}
/** Select an advisory repair without overriding Core's repeated-cause diagnosis. */
export function nativeEvidenceRepair(diagnostics,guidance){
  if(guidance?.action==='diagnose')return null;
  const repair=diagnostics?.find(d=>!d.requires_human_approval&&['refresh-evidence','run-phase-observation'].includes(d.action)&&d.stage_instance&&Array.isArray(d.command)&&d.command[1]==='evidence'&&d.command[2]==='run');
  if(!repair)return null;
  const command=normalizedCoreArgs(repair.command.slice(1));
  if(command.invalid)return null;
  if(typeof command.options['--sensors']==='string')command.options['--sensors']=command.options['--sensors'].split(',').sort().join(',');
  // Budget the actual command, not whichever sensor happened to be listed first.
  const key=K.canonical([repair.stage_instance,command,guidance?.fingerprint||null]);
  return {repair,key};
}
export function stageRouteDecision(route,instance){
  if(route?.approval==='block'||route?.kind==='ask'||route?.choices?.length||route?.preview===true||route?.stage_instance&&route.stage_instance!==instance)return 'stop';
  if(route?.kind==='run-stage'&&route.stage_instance===instance)return 'continue';
  if(route?.kind==='error'&&route.repair_guidance?.action!=='diagnose'&&route.repair_diagnostics?.length&&route.repair_diagnostics.every(d=>nativeEvidenceRepair([d],route.repair_guidance)))return 'repair';
  return 'stop';
}
const reentryNotice=route=>({kind:'host-reentry-repair',operation_dispatched:false,return_control_to_host:true,message:'Return immediately. The host will process this Core repair through its existing bounded driver before another action.',directive:modelRoute(modelProjection(route))});
/** Stable observations only: new receipt IDs, timestamps and PIDs are not progress. */
export function coreProgressProjection(value){
  if(!value||typeof value!=='object')return null;
  const context=value.host_context,observation=value.autonomous_observations,decision=value.autonomy_decisions;
  return {kind:value.kind,status:value.status,exit_code:value.exit_code,sha256:value.sha256,entries:value.entries,written:value.written,changed:value.changed,stdout:value.stdout,stderr:value.stderr,
    execution_status:value.execution_status,stage_instance:value.stage_instance,next_stage_status:value.next_stage_status,
    context:context?{progress_digest:context.progress_digest,source_digest:context.source_digest,c8_completed:context.c8_completed,command_digest:context.execution_inputs?.command_digest,candidate_input_digest:context.execution_inputs?.candidate_input_digest}:undefined,
    observation:observation?{status:observation.status,coverage:observation.coverage,candidate:observation.candidate_ref?.candidate_id,checks:observation.observations?.map(o=>[o.check_id,o.status])}:undefined,
    decisions:decision?{handoff_digest:decision.handoff_digest,completion_blockers:decision.completion_blockers}:undefined,
    result:value.autonomous_batch_result?{engineering_result:value.autonomous_batch_result.engineering_result,checks:value.autonomous_batch_result.checks}:undefined,
    repair:value.attempt_repair?{status:value.attempt_repair.status,plan_digest:value.attempt_repair.plan_digest,sequence:value.attempt_repair.sequence}:undefined};
}
/** Wrap every implementation/metadata/diagnosis turn in the same original session. */
export async function supervisedTurn(client,gateway,text,signal,timeout){
  if(!gateway.progress)return client.turn(text,signal,timeout); // Explicit structural engineering fixtures only.
  const progress=gateway.progress,mode=gateway.diagnosing?'repair-diagnosis':gateway.finalizing?'metadata':'implementation';
  progress.beginTurn(mode,gateway.context.binding.stage_instance);client.executionTrace=gateway.trace;client.executionTurnSpan=progress.turn.span;
  const timer=setInterval(()=>{try{progress.check();}catch{gateway.cancel(gateway.budget.stopped||'supervision-stop');}},Math.max(1,Math.min(50,progress.limits.idle_timeout_ms/4)));
  let status='unknown';try{const result=await client.turn(text,signal,timeout);status=result.status;if(client.toolTail)await client.toolTail;if(gateway.pending.size)await gateway.reconcile();progress.check();return result;}
  catch(error){if(gateway.budget.stopped)error.host_stop_reason=gateway.budget.stopped;throw error;}
  finally{clearInterval(timer);progress.endTurn(status);client.executionTurnSpan=null;}
}
/** Private cleanup-only transfer to the original owning worker, never a resume binding. */
export async function delegateOwnedCleanup(context,ipc=process,timeout=K.actionPolicy.resource_limits.ipc_ms){
  if(!ipc.connected||typeof ipc.send!=='function')throw Error('CLEANUP_OWNER_DISCONNECTED');
  const run=context.grant.run_id,digest=context.grant_ref.digest,thread=context.binding.session_id;
  let onMessage,onDisconnect;
  const acknowledgement=new Promise((resolve,reject)=>{
    onMessage=m=>{if(m?.kind==='cleanup-accepted'&&m.run_id===run&&m.grant_digest===digest)resolve(true);};
    onDisconnect=()=>reject(Error('CLEANUP_OWNER_DISCONNECTED'));ipc.on('message',onMessage);ipc.once('disconnect',onDisconnect);
  });acknowledgement.catch(()=>{});
  try{
    const end=K.resources.deadlineAfter(timeout);
    await K.resources.bounded(new Promise((resolve,reject)=>ipc.send({kind:'cleanup-delegation',schema:'aidlc.cleanup-delegation/v1',run_id:run,grant_digest:digest,thread_id:thread,private_bindings:[context.binding,context.coordinator_binding].filter(Boolean)},error=>error?reject(error):resolve())),end,'CLEANUP_SEND_TIMEOUT');
    await K.resources.bounded(acknowledgement,end,'CLEANUP_ACK_TIMEOUT');
    return {delegated:true,reconciled:false,released:[],failures:[],resource_owner:run};
  }finally{ipc.off('message',onMessage);ipc.off('disconnect',onDisconnect);}
}
export class Gateway {
  constructor(c,root,context,core,log=()=>{}){
    this.c=c;this.root=root;this.context=context;this.log=log;this.abort=new AbortController();this.pending=new Set();this.unknown=[];
    this.budget=new Budget(context.grant.resource_limits,Math.min(Date.parse(context.grant.expires_at),Date.parse(context.grant.request_started_at)+context.grant.resource_limits.wall_time_seconds*1000));
    this.trace=new K.ExecutionTrace(event=>log({kind:'execution-trace',trace:event}));
    this.progress=new K.ProgressBudget(K.supervisionLimits(c.supervision_limits),this.budget,{trace:this.trace,onStop:reason=>this.cancel(reason)});
    if(context.progress_digest)this.progress.seen.add('core-state:'+context.progress_digest);
    this.core=args=>this.runCore(args,core);
  }
  async runCore(args,transport){
    const descriptor=K.describeAction({action:'core',args},this.c,{origin:'host'}),own=!this.progress.step;
    const request=hash(K.canonical(normalizedCoreArgs(args))),stage=this.context.binding.stage_instance;
    if(own)this.progress.beginStep(descriptor.family,stage,request);
    let span,lease,result,status='failed';
    try{
      const phase=args[2]==='admission'&&args[3]==='run'?'admission-refresh':descriptor.core.evidence||descriptor.core.observation&&args[3]==='run'?'producer':descriptor.core.report||descriptor.core.decision||descriptor.core.batch&&args[3]==='finalize'?'evidence-publication':'host-control';
      span=this.trace.start(phase,{family:descriptor.family,stage_instance:stage,input_digest:request},this.progress.step?.span);
      lease=this.progress.beginBounded(protectedCoreTimeout(args,this.budget.deadline,this.admissionDeadline));
      result=await transport(args);if(result.autonomous_observations?.resource_reconciliation?.reconciled===false)throw Object.assign(Error('CORE_RESOURCES_UNRECONCILED'),{host_stop_reason:'resource-unreconciled',resource_reconciliation:result.autonomous_observations.resource_reconciliation});status='succeeded';
      if(descriptor.core.next&&(result.kind==='error'||result.kind==='ask'||result.approval==='block'))this.log({event:'formal-route-diagnostic',at:new Date().toISOString(),stage_instance:stage,preview:args.includes('--preview'),decision:stageRouteDecision(result,stage),directive:modelProjection(result)});
      if(result.host_context?.progress_digest)this.progress.checkpoint('core-state',result.host_context.progress_digest);
      if(descriptor.core.evidence&&result.status==='passed'){
        const options=normalizedCoreArgs(args).options;
        if(options['--refresh']===true)for(const row of result.actions||[result]){
          const p=row.evidence_progress,requested=options['--sensor']?[options['--sensor']]:typeof options['--sensors']==='string'?options['--sensors'].split(','):null;
          // Only the trusted Core transport can issue this transition. Do not
          // turn reused receipts, command success or timestamps into progress.
          if(row.action==='regenerated'&&p?.version==='1'&&p.transition==='invalid-to-current'&&p.workflow_id===this.context.binding.workflow_id&&p.stage_instance===options['--instance']&&p.sensor===row.sensor&&(!requested||requested.includes(p.sensor))&&/^[a-f0-9]{64}$/.test(p.identity))this.progress.checkpoint('evidence-refresh',p.identity);
        }
      }
      if(descriptor.core.report&&normalizedCoreArgs(args).options['--result']==='completed'&&result.kind==='print')this.progress.checkpoint('stage-report',hash(K.canonical([stage,normalizedCoreArgs(args),this.lastInputDigest])));
      if(descriptor.core.decision&&result.autonomy_decisions?.handoff_digest)this.progress.checkpoint('decision-publication',result.autonomy_decisions.handoff_digest);
      const observation=result.autonomous_observations;
      if(descriptor.core.observation&&args[3]==='run'){
        this.trace.importObservation(observation,span);
        if(observation?.status==='passed'&&observation.coverage==='matrix')this.progress.checkpoint('observation',hash(K.canonical([observation.candidate_ref?.candidate_id,observation.observations?.map(o=>[o.check_id,o.status])])));
      }
      if(descriptor.core.repair&&['request','apply'].includes(args[3])&&['planned','applied'].includes(result.attempt_repair?.status))this.progress.checkpoint('repair',hash(K.canonical([result.attempt_repair.plan_digest,result.attempt_repair.status,result.attempt_repair.sequence])));
      return result;
    }catch(error){if(error.resource_reconciliation?.reconciled===false){this.unknown.push({status:'resource-unreconciled',...error.resource_reconciliation});this.cancel('resource-unreconciled');}throw error;}finally{
      if(lease)this.progress.endBounded(lease);if(span)this.trace.end(span,status);
      if(own){this.progress.endStep(status);if(status==='succeeded')this.progress.observation(request,hash(K.canonical(coreProgressProjection(result))));}
    }
  }
  cancel(reason){this.budget.stop(reason);this.abort.abort();}
  async dispatchWindow(action,recheck){
    if(!this.requireAdmissionWindow)return;
    try{
    const decide=attempts=>admissionContinuation({admission_result:'ready',valid_until:Number.isFinite(this.admissionDeadline)?new Date(this.admissionDeadline).toISOString():undefined},this,requiredAdmissionWindow(action,this.c,this.budget.deadline),true,{phase:'dispatch',refresh_attempts:attempts});
    let decision=decide(0);
    if(decision.decision==='reprobe'){await this.requireAdmissionWindow(action,true);await recheck();decision=decide(1);}
    if(decision.decision!=='continue')throw Object.assign(Error('HOST_ADMISSION_WINDOW_INSUFFICIENT'),{host_stop_reason:'admission-window-insufficient',continuation:decision});
    }catch(error){throw Object.assign(error,{operation_not_dispatched:true});}
  }
  async retryKey(a,preparedContext){
    const stage=this.context.binding.stage_instance;
    if(a.action==='core'&&Array.isArray(a.args)&&a.args.every(s=>typeof s==='string')){
      const normalized=normalizedCoreArgs(a.args),record=normalized.prefix.join(' ')==='orchestrate autonomy record';
      if(record){
        const flags=normalized.options;let input='invalid-input';
        if(!normalized.invalid&&Object.keys(flags).every(k=>['--input','--expect','--preview'].includes(k))&&typeof flags['--input']==='string'){
          try{const file=safe(this.root,flags['--input'],false,false,K.proposalPath(flags['--input']));if(fs.statSync(file).size>1048576)throw Error('limit');input=hash(K.canonical(JSON.parse(fs.readFileSync(file,'utf8'))));}catch{}
        }
        // Proposal location, formatting and a guessed CAS digest cannot reset failures.
        return hash(K.canonical(['core-record',stage,flags['--preview']===true?'preview':'publish',input]));
      }
      let source=null;
      if(a.args[0]==='evidence'&&a.args[1]==='run'||a.args[0]==='orchestrate'&&a.args[1]==='report'){
        const current=preparedContext||(await this.core(['orchestrate','autonomy','host','context'])).host_context;
        source=current?.input_digest||current?.source_digest;if(typeof source!=='string'||!source)throw Error('HOST_RETRY_INPUTS_UNAVAILABLE');
      }
      return hash(K.canonical(['core',stage,normalized,source]));
    }
    if(a.action==='command'){
      const command=this.c.commands.find(c=>c.id===a.id);if(!command)throw Error('HOST_COMMAND_NOT_FROZEN');
      const current=preparedContext||(await this.core(['orchestrate','autonomy','host','context'])).host_context;
      const inputs=current?.execution_inputs;
      if(inputs?.schema!=='aidlc.execution-input-identity/v1'||!/^[a-f0-9]{64}$/.test(inputs.command_digest||''))throw Error('HOST_RETRY_INPUTS_UNAVAILABLE');
      const declared=[...new Set(command.input_paths||[])].sort().map(p=>[p,hash(fs.readFileSync(safe(this.root,p,false,true)))]);
      const executable=command.argv?.[0];if(typeof executable!=='string'||!path.isAbsolute(executable)||!fs.statSync(executable).isFile())throw Error('HOST_RETRY_INPUTS_UNAVAILABLE');
      return hash(K.canonical(['command',stage,command.operation,command.argv,hash(fs.readFileSync(executable)),declared,inputs.command_digest]));
    }
    return hash(K.canonical([a,stage]));
  }
  validateCheck(operation,p){this.budget.check();if(this.finalizing&&!['validation-execute','design-write','decision-record'].includes(operation))throw Error('HOST_FINALIZATION_ONLY');if(operation==='design-write'&&(!p||!['.md','.txt','.json','.svg','.html'].includes(path.posix.extname(p).toLowerCase())||!(this.c.design_write_paths||['docs/aidlc','delivery']).some(prefix=>p===prefix||p.startsWith(prefix+'/'))))throw Error('HOST_DESIGN_PATH_REQUIRES_CODE_OR_TEST_CLASS');if(['code-write','test-write'].includes(operation)&&this.readyInstance!==this.context.binding.stage_instance)throw Error('HOST_NATIVE_STAGE_NOT_ENTERED');}
  async check(operation,p){this.validateCheck(operation,p);return this.core(['orchestrate','autonomy','grant','check','--operation',operation,...(p?['--path',p]:[])]);}
  async prepareOperation(a,descriptor){
    // Public context reads carry no business side effect or publication authority.
    // Path isolation and the host's original budget still apply locally.
    if(a.action==='read'||a.action==='rule')return null;
    if(this.context.control_prepare?.schema!=='aidlc.host-preparation/v1'||this.context.control_prepare.supported!==true)return null;
    let checks=[{operation:descriptor.operation}],needsContext=a.action==='command'||a.action==='core'&&(descriptor.core.evidence||descriptor.core.report);
    if(a.action==='write')checks=[K.proposalPath(a.path)?{operation:'decision-record'}:{operation:a.operation,path:a.path}];
    if(a.action==='command'){const command=this.c.commands.find(c=>c.id===a.id);checks=[...command.write_paths.map(r=>({operation:r.operation,path:r.path})),{operation:command.operation}];for(const row of command.write_paths)safe(this.root,row.path,true);}
    for(const row of checks)this.validateCheck(row.operation,row.path);
    const startedAt=Date.now(),result=await this.core(['orchestrate','autonomy','host','prepare','--checks',JSON.stringify(checks),...(needsContext?['--context']:[])]),prepared=result.host_preparation;
    if(prepared?.schema!=='aidlc.host-preparation/v1'||!Number.isFinite(Date.parse(prepared.checked_at))||Date.parse(prepared.checked_at)<startedAt||Date.parse(prepared.checked_at)>Date.now()||prepared.binding_digest!==hash(K.canonical(this.context.binding))||!this.context.grant_ref||K.canonical(prepared.grant_ref)!==K.canonical(this.context.grant_ref)||K.canonical(prepared.checks)!==K.canonical(checks)||!Number.isFinite(prepared.deadline_at)||prepared.deadline_at>this.budget.deadline||Date.now()>=prepared.deadline_at||needsContext&&!prepared.input_context)throw Error('HOST_PREPARATION_CHANGED');
    if(prepared.progress_digest)this.progress.checkpoint('core-state',prepared.progress_digest);this.budget.check();return prepared;
  }

  invoke(a){
    if(this.pending.size||this.unknown.length)return Promise.reject(Error('HOST_OPERATIONS_UNRECONCILED'));
    const task=(async()=>{
      let descriptor;
      try{descriptor=K.describeAction(a,this.c,{mode:this.diagnosing?'repair-diagnosis':this.finalizing?'metadata':'implementation'});}
      catch(error){
        // Rejected input is still an attempted step. Changing content or path cannot
        // evade the retry budget for the same missing/invalid argument.
        const key=hash(K.canonical(['tool-input',this.context.binding.stage_instance,String(error.message)]));
        this.progress.beginStep('tool-input',this.context.binding.stage_instance,key);
        try{if(error.action_input_invalid){this.budget.enter(key);this.budget.leave(key,false);}this.progress.observation(key,key);throw error;}
        finally{this.progress.endStep('failed');}
      }
      const request=hash(K.canonical(a.action==='write'?[a.action,a.path,a.operation]:a));this.progress.beginStep(descriptor.family,this.context.binding.stage_instance,request);
      let status='failed',result;try{result=this.reentryRoute?reentryNotice(this.reentryRoute):await this.execute(a);status='succeeded';
        if(['read','rule'].includes(a.action)&&!result.error&&typeof result.content==='string'&&/^[a-f0-9]{64}$/.test(result.sha256||''))this.progress.inputAcquired(hash(K.canonical([this.context.binding.stage_instance,a.action,a.path,a.section||null,a.detail||null,result.sha256])));
        return result;}
      catch(error){if(error?.reentry_route){result=reentryNotice(error.reentry_route);status='succeeded';return result;}throw error;}
      finally{this.progress.endStep(status);if(status==='succeeded')this.progress.observation(request,hash(K.canonical(coreProgressProjection(result))));}
    })();
    this.pending.add(task);return task.finally(()=>this.pending.delete(task));
  }
  async execute(a,durableOperation,preparedExecution){
    const descriptor=preparedExecution?.descriptor||await prepareDispatchAction(a,this.c,{mode:this.diagnosing?'repair-diagnosis':this.finalizing?'metadata':'implementation',budget:this.budget,requireWindow:this.requireAdmissionWindow? action=>this.requireAdmissionWindow(action,true):undefined});
    const prepared=preparedExecution?preparedExecution.prepared:await this.prepareOperation(a,descriptor),check=(operation,p)=>prepared?(this.validateCheck(operation,p),Promise.resolve()):this.check(operation,p);
    const key=preparedExecution?.key||await this.retryKey(a,prepared?.input_context);this.lastInputDigest=key;
    if(this.recovery&&!durableOperation&&['write','command'].includes(a.action))return this.recovery.operation(a.action==='write'?{kind:'write',path:a.path,content_digest:hash(K.canonical(a.content)),input_identity:key}:{kind:'command',id:a.id,input_identity:key},id=>this.execute(a,id,{descriptor,prepared,key}));
    this.budget.enter(key);
    let success=false,notDispatched=false;const operation_id=randomUUID();this.log({operation_id,status:'prepared',kind:a.action,binding_digest:hash(JSON.stringify(this.context.binding)),input_digest:key});
    try{
      if(a.action==='rule'){this.budget.check();const r=K.rule(path.resolve(path.dirname(this.c.core_cli),'..','core'),a.path);success=!r.error;return (this.modelReads??=new ModelReadCache()).view('rule',r,a);}
      if(a.action==='read'){
        this.budget.check();const p=safe(this.root,a.path,false,true),stat=fs.statSync(p);
        if(stat.isDirectory()){const entries=fs.readdirSync(p,{withFileTypes:true}).filter(e=>!['.git','.aidlc'].includes(e.name.toLowerCase())).map(e=>({path:a.path+'/'+e.name,kind:e.isDirectory()?'directory':e.isFile()?'file':'linked'}));if(entries.length>1024)throw Error('HOST_READ_LIMIT');success=true;return {entries};}
        if(stat.size>1048576)throw Error('HOST_READ_LIMIT');const bytes=fs.readFileSync(p);let content=bytes.toString('utf8');if(a.path.startsWith('.aidlc/')){try{content=JSON.stringify(modelProjection(JSON.parse(content)),null,2);}catch{throw Error('HOST_PUBLIC_INPUT_NOT_JSON');}}success=true;return (this.modelReads??=new ModelReadCache()).view('read',{path:a.path,content,sha256:hash(bytes)},a);
      }
      if(a.action==='write'){
        if(!['code-write','test-write','design-write'].includes(a.operation)||typeof a.content!=='string'||Buffer.byteLength(a.content)>1048576)throw Error('HOST_WRITE_SCHEMA');
        const staged=K.proposalPath(a.path);
        if(a.path==='docs/aidlc/handoff.md')throw Error('HOST_HANDOFF_REQUIRES_CORE_RECORD');
        let decisionDraft=false;try{const value=JSON.parse(a.content);decisionDraft=value?.record_type==='decision';}catch{}
        if(decisionDraft&&!staged)throw Error('HOST_DECISION_PROPOSAL_NOT_ISOLATED');
        if(staged&&a.operation!=='design-write')throw Error('HOST_PROPOSAL_REQUIRES_DESIGN_WRITE');
        const p=safe(this.root,a.path,true,false,staged);
        if(staged){await check('decision-record');await this.core(['orchestrate','autonomy','host','proposal','--path',a.path]);}
        else await check(a.operation,a.path);
        this.budget.check();safe(this.root,a.path,true,false,staged);const changed=!fs.existsSync(p)||!fs.readFileSync(p).equals(Buffer.from(a.content));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,a.content);
        if(changed&&!staged)this.progress.checkpoint('work-change',hash(K.canonical([a.path,hash(a.content)])));
        success=true;return {written:a.path,staged,changed};
      }
      if(a.action==='command'){
        const c=this.c.commands.find(c=>c.id===a.id);if(!c)throw Error('HOST_COMMAND_NOT_FROZEN');for(const row of c.write_paths){safe(this.root,row.path,true);await check(row.operation,row.path);}await check(c.operation);this.budget.check();
        await this.dispatchWindow(a,async()=>{for(const row of c.write_paths)await this.check(row.operation,row.path);await this.check(c.operation);});
        const timeout=protectedCommandTimeout(c.timeout_ms,this.budget.deadline,this.admissionDeadline);
        this.log({operation_id,status:'dispatched',kind:'command',command_id:c.id});
        const span=this.trace.start('producer',{family:'command',input_digest:key,timeout_ms:timeout},this.progress.step?.span),lease=this.progress.beginBounded(timeout);
        const commandResource=this.recovery?.intent('command');
        const running=command(c.argv,{onStart:pid=>this.recovery?.started(commandResource,pid),cwd:this.root,env:{...K.businessEnv(process.env),...(durableOperation?{AIDLC_OPERATION_KEY:durableOperation}:{})},signal:this.abort.signal,timeout_ms:timeout});this.pending.add(running);let r;try{r=await running;}finally{this.pending.delete(running);this.progress.endBounded(lease);this.trace.end(span,r?.reconciled?(r.status==='succeeded'?'succeeded':'failed'):'unknown');}if(this.recovery&&r?.reconciled)this.recovery.closed(commandResource);this.log({operation_id,...r,status:r.reconciled?(r.status==='succeeded'?'succeeded':'failed'):'unknown',termination_reason:r.status,stdout:undefined,stderr:undefined});if(!r.reconciled){this.unknown.push(r);this.cancel('unreconciled-operation');}
        // Revalidate after execution: expired/revoked/transferred results cannot publish as success.
        await this.check(c.operation);success=r.status==='succeeded';return r;
      }
      if(a.action==='core'){
        const args=a.args,{decision,report,next,evidence}=descriptor.core;await check(descriptor.operation);
        if(decision){const index=args.indexOf('--input');if(index<0||!args[index+1])throw Error('HOST_DECISION_INPUT_REQUIRED');if(!K.proposalPath(args[index+1]))throw Error('HOST_DECISION_PROPOSAL_NOT_ISOLATED');const p=safe(this.root,args[index+1],false,false,true);if(fs.statSync(p).size>1048576)throw Error('HOST_READ_LIMIT');if(JSON.parse(fs.readFileSync(p,'utf8')).human_review?.status!=='pending')throw Error('HOST_MODEL_CANNOT_ATTEST_HUMAN_REVIEW');}
        if(descriptor.needs_window)await this.dispatchWindow(a,()=>this.check(descriptor.operation));
        this.budget.check();let r;try{r=await this.core(args);}catch(error){if(evidence&&this.context.binding.stage_instance.startsWith('code-generation@'))this.failedImplementationStage=this.context.binding.stage_instance;throw error;}
        if(evidence&&(args.includes('--all-sensors')||args.includes('green-test-evidence')))this.failedImplementationStage=null;
        if(report&&args[args.indexOf('--result')+1]==='completed'&&this.context.coordinator_binding){
          this.readyInstance=null;this.context.binding=this.context.coordinator_binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(this.context.binding);
          const coordinator=await this.core(['orchestrate','autonomy','host','select','--instance',this.context.binding.stage_instance]);
          this.context.binding=this.context.coordinator_binding=coordinator.host_context.binding;process.env.AIDLC_SESSION_BINDING=process.env.AIDLC_COORDINATOR_BINDING=JSON.stringify(this.context.binding);await this.check('validation-execute');
        }
        if(next&&!args.includes('--preview'))this.readyInstance=r.kind==='run-stage'&&r.preview!==true&&r.stage_instance===this.context.binding.stage_instance&&r.approval!=='block'&&!r.choices?.length?r.stage_instance:null;
        success=true;return a.detail==='full'?modelProjection(r):modelRoute(modelProjection(r));
      }
      throw Error('HOST_TOOL_UNKNOWN');
    }catch(error){notDispatched=error?.operation_not_dispatched===true;throw error;}
    finally{this.budget.leave(key,success||notDispatched);this.log({operation_id,status:notDispatched?'rejected-before-dispatch':success?'succeeded':this.abort.signal.aborted?'unknown':'failed',kind:a.action});}
  }
  async reconcile(){return await Promise.allSettled([...this.pending]);}
}
/** Existing host admission scheduling, shared by runtime and focused integration.
 * No Supervisor, authority, retry budget or persistent state is added. */
export function createAdmissionContinuation(c,context,core,gateway){
    let probeTimeoutRetries=0,lastAdmission;
    const select=async instance=>{const selected=await core(['orchestrate','autonomy','host','select','--instance',instance]);context.binding=selected.host_context.binding;process.env.AIDLC_SESSION_BINDING=JSON.stringify(context.binding);if(instance===context.grant.executor_constraints.initial_binding.stage_instance){context.coordinator_binding=context.binding;process.env.AIDLC_COORDINATOR_BINDING=JSON.stringify(context.binding);}};
    const refreshAdmission=async(allowCurrent=false,dependenciesCurrent=false)=>{
      if(!c.admission_plan)return 'admission-plan-required';
      if((gateway.pending?.size||0)>(allowCurrent?1:0)||gateway.unknown?.length)return 'operations-unreconciled';
      let dependencyObserved=false;
      while(true){
        gateway.budget.check();if(context.binding.stage_instance!==context.grant.executor_constraints.initial_binding.stage_instance)await select(context.grant.executor_constraints.initial_binding.stage_instance);gateway.readyInstance=null;
        if(c.observation_plan&&!dependenciesCurrent&&!dependencyObserved){await core(['orchestrate','autonomy','observe','run','--dependency-preflight','--input',c.observation_plan]);dependencyObserved=true;}
        const admission=(await core(['orchestrate','autonomy','admission','run','--input',c.admission_plan])).autonomous_admission;
        lastAdmission=admission;gateway.admissionDeadline=Date.parse(admission?.valid_until||'');
        if(['ready','ready-with-delegated-decisions'].includes(admission?.admission_result))return null;
        const failed=(admission?.checks||[]).filter(c=>!['passed','not-applicable'].includes(c.status));
        // A valid inspected receipt already checked dependencies. If they changed
        // meanwhile, Core rejects; observe once, then reevaluate all hard checks.
        if(dependenciesCurrent&&!dependencyObserved&&c.observation_plan&&failed.some(c=>c.check_id==='dependency-readiness')&&!failed.some(c=>['scope-policy','execution-grant','design-reception'].includes(c.check_id))){dependenciesCurrent=false;continue;}
        const retryable=admission?.admission_result==='not-ready'&&failed.length===1&&failed[0].check_id==='host-capabilities'&&/HOST_NATIVE_PROBE_FAILED:[\s\S]*HOST_TURN_TIMEOUT/.test(failed[0].reason||'');
        if(retryable&&probeTimeoutRetries++<context.grant.resource_limits.max_equivalent_retries)continue;
        return 'admission-not-ready';
      }
    };
    const ensureAdmission=async(minimumMs=0,allowCurrent=false)=>{
      if((gateway.pending?.size||0)>(allowCurrent?1:0)||gateway.unknown?.length)return 'operations-unreconciled';
      const inspect=async()=>{const value=(await core(['orchestrate','autonomy','admission','inspect'])).autonomous_admission;gateway.admissionDeadline=Date.parse(value?.valid_until||'');return value;};
      const decide=(value,attempts)=>admissionContinuation(value,gateway,minimumMs,allowCurrent,{refresh_attempts:attempts});
      const inspected=await inspect(),decision=decide(inspected,0);if(decision.decision==='continue')return null;
      if(decision.reason==='admission-inspect-invalid')throw Error('HOST_ADMISSION_INSPECT_INVALID');
      if(decision.decision==='stop')return decision.reason;
      const failure=await refreshAdmission(allowCurrent,['ready','ready-with-delegated-decisions'].includes(inspected?.admission_result));if(failure)return failure;
      // run returned the just-published controlled receipt. Final dispatch still
      // checks live authority; an immediate second inspect adds no new fact.
      return decide(lastAdmission,1).decision==='continue'?null:'admission-window-insufficient';
    };
    gateway.requireAdmissionWindow=async(action,allowCurrent=false)=>{
      gateway.budget.check();const original=context.binding.stage_instance,entered=gateway.readyInstance===original;
      const failure=await ensureAdmission(requiredAdmissionWindow(action,c,gateway.budget.deadline),allowCurrent);
      if(failure){gateway.cancel?.(failure);throw Object.assign(Error('HOST_'+failure.toUpperCase().replaceAll('-','_')),{host_stop_reason:failure});}
      if(context.binding.stage_instance!==original){
        await select(original);gateway.readyInstance=null;
        if(entered){const route=await core(['orchestrate','next']),decision=stageRouteDecision(route,original);
          gateway.log?.({event:'admission-reentry',at:new Date().toISOString(),stage_instance:original,decision,directive:modelProjection(route)});
          if(decision==='repair'){gateway.reentryRoute=route;throw Object.assign(Error('HOST_ADMISSION_REENTRY_REPAIR'),{reentry_route:route,operation_not_dispatched:true});}
          if(decision==='stop'){gateway.cancel?.('admission-reentry-blocked');throw Object.assign(Error('HOST_ADMISSION_REENTRY_BLOCKED'),{host_stop_reason:'admission-reentry-blocked'});}gateway.readyInstance=original;}
        const continuation=admissionContinuation({admission_result:'ready',valid_until:Number.isFinite(gateway.admissionDeadline)?new Date(gateway.admissionDeadline).toISOString():undefined},gateway,requiredAdmissionWindow(action,c,gateway.budget.deadline),allowCurrent,{phase:'stage-reentry',refresh_attempts:1});
        if(continuation.decision!=='continue'){gateway.cancel?.('admission-window-insufficient');throw Object.assign(Error('HOST_ADMISSION_WINDOW_INSUFFICIENT'),{host_stop_reason:'admission-window-insufficient',continuation});}
      }
    };
    return {select,refreshAdmission,ensureAdmission};
}
export async function driveBatch(c,context,transport,client,gateway){
    const core=async args=>{
      await prepareDispatchAction({action:'core',args},c,{origin:'host',budget:gateway.budget,requireWindow:action=>gateway.requireAdmissionWindow(action)});
      try{return await (gateway.runCore?gateway.runCore(args,transport):transport(args));}catch(error){if(/ATTEMPT_REPAIR_PARTIAL_TRANSITION_UNRECONCILED/.test(String(error))){gateway.unknown.push({status:'repair-transition-unreconciled'});gateway.cancel('repair-transition-unreconciled');}throw error;}
    };
    const restored=gateway.progress?.routing||{};
    let reason='incomplete',noProgress=restored.noProgress||0,last=restored.last||'',preparedSource,completionTurns=restored.completionTurns||0,admissionRaces=restored.admissionRaces||0;
    const repairTurns=new Map(restored.repairTurns||[]),delegatedTurns=new Map(restored.delegatedTurns||[]);
    const persistRouting=()=>{if(gateway.progress){gateway.progress.routing={noProgress,last,completionTurns,admissionRaces,repairTurns:[...repairTurns],delegatedTurns:[...delegatedTurns]};gateway.progress.persist();}};
    const {select,refreshAdmission}=createAdmissionContinuation(c,context,core,gateway);
    if(gateway.recovery?.lease.state.restarts>0){const failure=await refreshAdmission();if(failure)return failure;}
    const repairImplementation=async(now,fromNative=false)=>{
      if(!now.same_attempt_repair?.supported)return false;
      if(gateway.pending?.size||gateway.unknown?.length)throw Object.assign(Error('HOST_REPAIR_OPERATIONS_UNRECONCILED'),{host_stop_reason:'operations-unreconciled'});
      let repair=(await core(['orchestrate','autonomy','repair','inspect'])).attempt_repair;
      if(repair.status==='exhausted')throw Object.assign(Error('HOST_REPAIR_BUDGET_EXHAUSTED'),{host_stop_reason:'same-attempt-repair-exhausted'});
      if(fromNative&&repair.status==='blocked')throw Object.assign(Error('HOST_REPAIR_CLASSIFICATION_BLOCKED'),{host_stop_reason:'same-attempt-repair-'+(repair.reason||'blocked')});
      if(!['diagnosis-required','planned'].includes(repair.status))return false;
      if(context.binding.stage_instance!==context.grant.executor_constraints.initial_binding.stage_instance)await select(context.grant.executor_constraints.initial_binding.stage_instance);gateway.readyInstance=null;
      if(repair.status==='diagnosis-required'){
      gateway.diagnosing=true;let turn;
      try{turn=await supervisedTurn(client,gateway,'Diagnose the actual controlled candidate failure below. Read its raw output and approved requirements/tests. Do not write files, run commands, publish evidence or advance stages. Submit exactly one Core request: orchestrate autonomy repair request --kind code-defect|test-correction|scope-change|unknown --unit <module/unit> --failure <failure_ref.digest> --reason <concise evidence-based diagnosis>. Code defects retain the original RED; a proven test defect requires a new controlled TDD cycle. Changing requirements, scope, acceptance, permissions or unresolved environment is not an implementation repair. Core alone decides the legal rollback. Return immediately after its response.\n'+JSON.stringify(modelProjection(repair)),gateway.abort.signal,Math.max(1,gateway.budget.deadline-Date.now()));}
      finally{gateway.diagnosing=false;gateway.readyInstance=null;}
      if(turn.status!=='completed')throw Object.assign(Error('HOST_REPAIR_DIAGNOSIS_INTERRUPTED'),{host_stop_reason:gateway.budget.stopped||'native-turn-'+turn.status});
      repair=(await core(['orchestrate','autonomy','repair','inspect'])).attempt_repair;
      }
      if(repair.status!=='planned'){if(fromNative&&repair.status==='blocked')throw Object.assign(Error('HOST_REPAIR_CLASSIFICATION_BLOCKED'),{host_stop_reason:'same-attempt-repair-'+(repair.reason||'blocked')});return false;}
      const plan=repair.plan,identity=plan.plan_digest;
      // Bind only through the existing private Core protocol. Each step is a Core-derived exact target.
      for(const step of plan.steps){if(step.status==='applied')continue;await select(step.instance);gateway.readyInstance=null;
        const applied=(await core(['orchestrate','autonomy','repair','apply','--expect',identity])).attempt_repair;
        if(!['planned','applied'].includes(applied.status))throw Error('HOST_REPAIR_TRANSITION_REJECTED');
      }
      preparedSource=undefined;await select(plan.steps.at(-1).instance);gateway.readyInstance=null;
      client.event?.({method:'aidlc/same-attempt-repair',params:modelProjection({sequence:plan.sequence,classification:plan.classification,failure_ref:plan.failure_ref,unit_ref:plan.unit_ref})});
      return true;
    };
    const repairNative=async (diagnostics,guidance)=>{
      const selected=nativeEvidenceRepair(diagnostics,guidance);
      if(!selected)return null;
      const {repair,key}=selected,attempts=(repairTurns.get(key)||0)+1;repairTurns.set(key,attempts);persistRouting();
      if(attempts>context.grant.resource_limits.max_equivalent_retries+1)return 'exhausted';
      await select(repair.stage_instance);gateway.readyInstance=null;
      const args=repair.command.slice(1),result=await gateway.invoke({action:'core',args});
      client.event?.({method:'aidlc/host-evidence-repair',params:{args,result:modelProjection(result)}});
      return 'repaired';
    };
      while(true){
       try{
        if(gateway.reentryRoute){const pending=gateway.reentryRoute;gateway.reentryRoute=null;const repaired=await repairNative(pending.repair_diagnostics,pending.repair_guidance);if(repaired==='exhausted'){reason='native-repair-exhausted';break;}if(repaired!=='repaired'){reason='admission-reentry-blocked';break;}continue;}
        gateway.budget.check();let route=await core(['orchestrate','next','--preview']);
        if(route.autonomous_admission?.admission_result==='not-ready'||route.kind==='error'&&/ADMISSION_INPUT_CHANGED:/.test(route.message||'')){const failure=await refreshAdmission();if(failure){reason=failure;break;}route=await core(['orchestrate','next','--preview']);}
        if(route.kind==='ask'&&route.ask_type==='module-selection'){
          const now=(await core(['orchestrate','autonomy','host','context'])).host_context;
          const target=now.implementation_units.filter(u=>!u.review_completed).flatMap(u=>(route.modules||[]).filter(m=>m.module_id===u.unit_ref.module_id&&/@module:([^@]+)/.exec(m.stage_instance||'')?.[1]===u.unit_ref.module_id&&(!m.stage_instance.includes('@unit:')||m.stage_instance.endsWith('@unit:'+u.unit_ref.unit_id)))).at(0);
          if(!target){reason='batch-module-selection-unavailable';break;}
          await select(target.stage_instance);continue;
        }
        if(route.binding_required&&route.workflow?.startsWith('module:')){
          const module=route.workflow.slice('module:'.length),now=(await core(['orchestrate','autonomy','host','context'])).host_context;
          const units=now.implementation_units.filter(u=>!u.review_completed&&u.unit_ref.module_id===module);
          if(!units.length){reason='batch-module-selection-unavailable';break;}
          route=await core(['orchestrate','next','--module',module,'--preview']);
          const target=route.stage_instance||route.next_stage?.stage_instance;
          if(target&&/@module:([^@]+)/.exec(target)?.[1]===module&&(!target.includes('@unit:')||units.some(u=>target.endsWith('@unit:'+u.unit_ref.unit_id)))){await select(target);continue;}
          if(route.kind!=='error'){reason='batch-module-selection-unavailable';break;}
        }
        if(c.observation_plan){
          const now=(await core(['orchestrate','autonomy','host','context'])).host_context;
          if(c.candidate_command&&now.implementation_units.every(u=>u.review_completed)&&(preparedSource===undefined||preparedSource!==(now.execution_inputs?.candidate_input_digest||now.source_digest))){
            await select(context.grant.executor_constraints.initial_binding.stage_instance);const r=await gateway.invoke({action:'command',id:c.candidate_command});
            if(r.status!=='succeeded'){reason='candidate-preparation-failed';break;}
            const prepared=(await core(['orchestrate','autonomy','host','context'])).host_context;
            preparedSource=prepared.execution_inputs?.candidate_input_digest||prepared.source_digest;
            route=await core(['orchestrate','next','--preview']);
          }
          // Candidate preparation returns to the coordinator. Bind C8 afterwards,
          // including the real public empty-preview envelope; formal next still
          // evaluates every prerequisite and never treats local exhaustion as done.
          if(!now.c8_completed&&emptyLocalPreview(route)&&now.implementation_units.length&&now.implementation_units.every(u=>u.review_completed)){await select('build-and-test');route=await core(['orchestrate','next','--preview']);}
          if(now.c8_completed&&now.implementation_units.every(u=>u.review_completed)&&route.kind!=='error'){
            if(gateway.pending?.size||gateway.unknown?.length){reason='operations-unreconciled';break;}
            await select(context.grant.executor_constraints.initial_binding.stage_instance);
            const observed=await core(['orchestrate','autonomy','observe','inspect']);
            if(observed.autonomous_observations?.status!=='passed')await core(['orchestrate','autonomy','observe','run','--input',c.observation_plan]);
            const finalized=await core(['orchestrate','autonomy','batch','finalize']),result=finalized.autonomous_batch_result;
            if(result.engineering_result==='failed'&&await repairImplementation(now))continue;
            const otherChecks=(result.checks||[]).filter(c=>!c.check_id.startsWith('native:')&&!['passed','not-required','not-applicable'].includes(c.status));
            if(result.engineering_result==='blocked'&&(!otherChecks.length||completionOnly({checks:otherChecks}))){
              const repaired=await repairNative(finalized.repair_diagnostics,finalized.repair_guidance);
              if(repaired==='repaired')continue;
              if(repaired==='exhausted'){reason='native-repair-exhausted';break;}
            }
            if(completionOnly(result)&&completionTurns++<=context.grant.resource_limits.max_equivalent_retries){persistRouting();
              const decision=result.decision_refs?.find(d=>d.completion_blockers?.length),unit=now.implementation_units.find(u=>decision&&u.unit_ref.module_id===decision.unit_ref.module_id&&u.unit_ref.unit_id===decision.unit_ref.unit_id)||now.implementation_units[0];
              await select('code-review@module:'+unit.unit_ref.module_id+'@unit:'+unit.unit_ref.unit_id);gateway.readyInstance=null;gateway.finalizing=true;
              let turn;try{turn=await supervisedTurn(client,gateway,'Complete only the missing delivery artifacts and lawful delegated decision implementation/validation references shown by Core. Public record author: '+context.binding.owner+'/'+context.binding.session_id+'. Read README.md and project guidance; use the actual Native evidence and observation inspect results, keeping human review pending. No code/test changes, workflow reports, approval, source/policy changes or repeated quality commands are allowed in this completion turn. Core alone decides completion.\n'+JSON.stringify(modelProjection(result)),gateway.abort.signal,Math.max(1,gateway.budget.deadline-Date.now()));}finally{gateway.finalizing=false;gateway.readyInstance=null;}
              if(turn.status!=='completed'){reason=gateway.budget.stopped||'native-turn-'+turn.status;break;}await select(context.grant.executor_constraints.initial_binding.stage_instance);continue;
            }
            reason='batch-'+result.engineering_result;break;
          }
        }
        if(c.observation_plan&&(route.stage==='build-and-test'||emptyLocalPreview(route))){
          const current=(await core(['orchestrate','autonomy','host','context'])).host_context;
          if(current.implementation_units.every(u=>u.review_completed)){
            const observed=await core(['orchestrate','autonomy','observe','inspect']);
            if(observed.autonomous_observations?.status!=='passed'){
              await select(context.grant.executor_constraints.initial_binding.stage_instance);
              const result=await core(['orchestrate','autonomy','observe','run','--input',c.observation_plan]);
              if(result.autonomous_observations?.status!=='passed'){const final=(await core(['orchestrate','autonomy','batch','finalize'])).autonomous_batch_result;if(final.engineering_result==='failed'&&route.approval!=='block'&&route.kind!=='ask'&&!route.choices?.length&&await repairImplementation(current))continue;reason='batch-'+final.engineering_result;break;}
              route=await core(['orchestrate','next','--preview']);
            }
            // Planned H4 decisions are a prerequisite of the first C8 report.
            // Project C8 cannot write business delivery files. Rebind the exact
            // reviewed implement unit for metadata only, then prepare/observe
            // the resulting candidate again before formal C8 execution.
            if(!current.c8_completed&&route.approval!=='block'&&route.kind!=='ask'&&!route.choices?.length){
              if(gateway.pending?.size||gateway.unknown?.length){reason='operations-unreconciled';break;}
              const decisions=(await core(['orchestrate','autonomy','decisions'])).autonomy_decisions;
              if(decisions.completion_blockers?.some(b=>b.includes('human-review-requires-incremental-rework'))){reason='delegated-human-rework-required';break;}
              const pending=decisions.decisions?.filter(d=>d.completion_blockers?.length)||[],decision=pending[0];
              if(decision){
                const units=current.implementation_units.filter(u=>pending.some(d=>u.unit_ref.module_id===d.unit_ref.module_id&&u.unit_ref.unit_id===d.unit_ref.unit_id));
                if(pending.some(d=>!units.some(u=>u.unit_ref.module_id===d.unit_ref.module_id&&u.unit_ref.unit_id===d.unit_ref.unit_id))){reason='delegated-unit-unavailable';break;}
                // All units use the same successful pre-metadata observation. Each
                // publication rereads Core's CAS, then one final candidate/matrix
                // binds all accepted metadata. Rejected drafts remain control data.
                const currentObservation=(await core(['orchestrate','autonomy','observe','inspect'])).autonomous_observations;
                const receipt=await gateway.invoke({action:'read',path:currentObservation?.receipt_ref?.path});
                let completionStopped=false;
                for(const unit of units){
                const key=unit.unit_ref.module_id+'/'+unit.unit_ref.unit_id,attempts=(delegatedTurns.get(key)||0)+1;delegatedTurns.set(key,attempts);persistRouting();
                if(attempts>context.grant.resource_limits.max_equivalent_retries+1){reason='delegated-completion-exhausted';completionStopped=true;break;}
                await select('code-review@module:'+unit.unit_ref.module_id+'@unit:'+unit.unit_ref.unit_id);gateway.readyInstance=null;
                const fresh=(await core(['orchestrate','autonomy','decisions'])).autonomy_decisions;
                const guidance=decisionCompletionGuidance(fresh,currentObservation,receipt.sha256,context.binding.owner+'/'+context.binding.session_id,unit.unit_ref);gateway.finalizing=true;
                let turn;try{turn=await supervisedTurn(client,gateway,'Complete only the planned delegated decisions for this exact reviewed unit before C8. Public record author: '+context.binding.owner+'/'+context.binding.session_id+'. Read README.md, project guidance and Core decisions. Use real stable src/tests InputRefs and the successful controlled observation inspect receipt. Read each receipt file to obtain its raw SHA-256 for validation_refs; do not substitute a signed body digest for a file digest. Write the proposal only at its Core-derived proposal_path under .aidlc/proposals/decisions using operation design-write; never put drafts in delivery/ or docs/. Then Core autonomy record with the current handoff digest. Preserve identity, governing scope/policy and human_review pending. No code/test changes, workflow reports, approval, source/policy changes or repeated quality commands. Return control to the host after recording; it must create and observe the final candidate again.\n'+JSON.stringify(modelProjection({decisions:pending.filter(d=>d.unit_ref.module_id===unit.unit_ref.module_id&&d.unit_ref.unit_id===unit.unit_ref.unit_id),write_contract:guidance})),gateway.abort.signal,Math.max(1,gateway.budget.deadline-Date.now()));}finally{gateway.finalizing=false;gateway.readyInstance=null;}
                if(turn.status!=='completed'){reason=gateway.budget.stopped||'native-turn-'+turn.status;completionStopped=true;break;}
                }
                if(completionStopped)break;
                await select(context.grant.executor_constraints.initial_binding.stage_instance);continue;
              }
            }
            // An observation also returns to the coordinator. Its local empty
            // preview must not be delivered as an executable C8 model turn.
            if(!current.c8_completed&&emptyLocalPreview(route)){await select('build-and-test');route=await core(['orchestrate','next','--preview']);}
          }
        }
        const ownFront=route.autonomy_dependencies?.dependency_frontier?.find(f=>f.checkpoint===route.stage&&route.stage_instance?.endsWith('@module:'+f.unit_ref.module_id+'@unit:'+f.unit_ref.unit_id));
        if(ownFront&&!ownFront.dependencies_ready){const provider=route.autonomy_dependencies.dependency_frontier.find(f=>f.dependencies_ready&&(f.unit_ref.unit_id!==ownFront.unit_ref.unit_id||f.unit_ref.module_id!==ownFront.unit_ref.module_id));if(!provider){reason='dependency-blocked';break;}await select(provider.checkpoint+'@module:'+provider.unit_ref.module_id+'@unit:'+provider.unit_ref.unit_id);route=await core(['orchestrate','next','--preview']);}
        if(route.execution_status==='scope-exhausted'){const now=(await core(['orchestrate','autonomy','host','context'])).host_context;const other=now.implementation_units.find(u=>!u.review_completed&&!context.binding.stage_instance.endsWith('@module:'+u.unit_ref.module_id+'@unit:'+u.unit_ref.unit_id));if(other){await select('code-generation@module:'+other.unit_ref.module_id+'@unit:'+other.unit_ref.unit_id);continue;}}
        if(route.stage_instance&&route.stage_instance!==context.binding.stage_instance){await select(route.stage_instance);route=await core(['orchestrate','next','--preview']);}
        if(route.kind==='run-stage'){route=await core(['orchestrate','next']);if(route.kind==='run-stage'&&route.stage_instance===context.binding.stage_instance)gateway.readyInstance=route.stage_instance;else gateway.readyInstance=null;}
        if(route.approval==='block'){gateway.readyInstance=null;reason='approval-required';break;}
        if(route.kind==='ask'||route.choices?.length){gateway.readyInstance=null;reason='human-decision-required';break;}
        if(stageRouteDecision(route,context.binding.stage_instance)==='repair'){
          const repaired=await repairNative(route.repair_diagnostics,route.repair_guidance);
          if(repaired==='repaired')continue;
          if(repaired==='exhausted'){reason='native-repair-exhausted';break;}
        }
        if(['scope-exhausted','isolated-work-exit-blocked'].includes(route.execution_status)||route.kind==='error'||route.kind==='done'){reason=route.execution_status||'formal-route-blocked';break;}
        const freshContext=(await core(['orchestrate','autonomy','host','context'])).host_context;const signature=hash(JSON.stringify([route.stage_instance,freshContext.progress_digest]));noProgress=signature===last?noProgress+1:0;last=signature;persistRouting();if(noProgress>context.grant.resource_limits.max_equivalent_retries){reason='no-progress';break;}
        const turn=await supervisedTurn(client,gateway,'Execute only the exact formal stage below using aidlc_action. After a repair request returns planned/blocked or its completed report succeeds, return control to the host immediately; the host selects the next exact instance and performs final convergence. Do not advance another stage or write delivery metadata after that report. Before accepting RED, check that each assertion can pass for conforming behavior and prefer existing supplied assertion helpers. Once RED is accepted, preserve its named test inputs through GREEN; a real test defect needs a new controlled TDD cycle, never silent input replacement or fabricated historical evidence. Read README.md and the canonical development-handoff once, reuse unchanged contents, and request detail="full" if the original text is no longer available. Read the current stage rule execution summary and applicable detailed sections, not every ancestor stage. Read full evidence only for required omitted fields. A return_control_to_host result ends this turn immediately. The public record author is '+JSON.stringify({recorded_by:context.binding.owner+'/'+context.binding.session_id})+'; this identity is not a credential. rule(path) can list Markdown paths under core/stages, core/knowledge and core/skills. read(path) can list project directories and read public Native evidence/command JSON with actual raw SHA-256; private controls stay inaccessible. Only these frozen command IDs are available; this catalog grants no extra operations:\n'+JSON.stringify(commandCatalog(c))+'\nCurrent Core repair guidance, when present: '+JSON.stringify(modelProjection(freshContext.same_attempt_repair?.active_plan||null))+'\nA test-correction plan authorizes only its listed test inputs at the reopened TDD stage; refresh its existing module I13 derivation through the given controlled command after correcting the tests, then obtain new RED/BASELINE before reporting TDD. Code repairs preserve the original RED and never change its tests.\nFollow this fresh formal Core route; completion messages do not complete the batch:\n'+JSON.stringify(modelRoute(modelProjection(route))),gateway.abort.signal,Math.max(1,gateway.budget.deadline-Date.now()));
        if(turn.status!=='completed'){reason=gateway.budget.stopped||'native-turn-'+turn.status;break;}
        // Exact claim transitions stay with the existing Core bind protocol. A final alone never advances state.
        const after=(await core(['orchestrate','autonomy','host','context'])).host_context;context.binding=after.binding;
        if((gateway.failedImplementationStage===context.binding.stage_instance||after.same_attempt_repair?.active_plan?.steps?.some(s=>s.status!=='applied'))){gateway.failedImplementationStage=null;if(await repairImplementation(after,true))continue;}
       }catch(error){
        if(error?.reentry_route){gateway.reentryRoute=error.reentry_route;continue;}
        if(error?.host_stop_reason){reason=error.host_stop_reason;break;}
        // Only a reconciled Core admission guard can trigger this bounded retry.
        // Keep preparedSource and all original budgets: completed commits are not replayed.
        if(c.admission_plan&&error?.core_reconciled===true&&/ADMISSION_INPUT_CHANGED:/.test(String(error))&&admissionRaces++<context.grant.resource_limits.max_equivalent_retries){persistRouting();const failure=await refreshAdmission();if(failure){reason=failure;break;}continue;}
        throw error;
       }
      }

    return reason;
}
async function main(){
  const [mode,file,...rest]=process.argv.slice(2),root=process.cwd();
  // Offline diagnosis needs no available model binary/configuration and creates no client.
  if(mode==='inspect-run'){const runId=rest.length===0?file:rest.length===1?rest[0]:null;if(!runId)throw Error('inspect-run requires one run ID');console.log(JSON.stringify(K.inspectRun(root,runId)));return;}
  const c=config(path.resolve(file));
  if(mode==='supervise'){if(rest.length!==1)throw Error('supervise requires the original thread');console.log(JSON.stringify(await supervise(c,root,path.resolve(file),rest[0])));return;}
  if(mode==='identity'){console.log(JSON.stringify(identity(path.resolve(file))));return;}
  if(mode==='check-config'){if(rest.length)throw Error('check-config takes only the frozen host config');const observed=await nativeConfiguration(c,root);console.log(JSON.stringify({...observed,host:identity(path.resolve(file))}));return;}
  if(mode==='probe'){
    const text=await K.resources.bounded((async()=>{let text='';for await(const b of process.stdin){text+=b;if(text.length>1048576)throw Error('PROBE_INPUT_LIMIT');}return text;})(),K.resources.deadlineAfter(30000),'PROBE_INPUT_TIMEOUT').catch(error=>{process.stdin.destroy();throw error;});const challenge=JSON.parse(text),started_at=new Date().toISOString();const result=await nativeProbe(c,root,challenge);
    console.log(JSON.stringify({started_at,finished_at:new Date().toISOString(),...result}));return;
  }
  const recovery=mode==='run'?await openRecovery(c,root,path.resolve(file)):null;
  const nativeIntent=recovery?.intent('native');
  let journal;const bufferedNative=[];let recordNative=event=>bufferedNative.push(event);const client=new CodexClient(c,root,m=>recordNative(m));
  try{
    if(recovery)recovery.started(nativeIntent,client.child.pid);
    if(recovery)await K.resources.bounded(client.initialize(),K.resources.deadlineAfter(Math.max(1,Math.min(30000,recovery.deadline-Date.now()))),'HOST_RECOVERY_NATIVE_TIMEOUT');else await client.initialize();
    if(mode==='prepare'){if(rest.length!==1)throw Error('prepare requires a new output config path');const out=path.resolve(rest[0]);fs.writeFileSync(out,JSON.stringify({...c,native_config_digest:client.nativeDigest},null,2)+'\n',{flag:'wx'});const r=await client.prepare();console.log(JSON.stringify({thread_id:r.thread.id,host:identity(out),config:out}));return;}
    if(mode==='run'&&!c.native_config_digest)throw Error('HOST_CONFIG_NOT_PREPARED');
    if(mode!=='run'||rest.length!==1)throw Error('use identity|probe|prepare|run <config> [thread-id|new-output-config]; inspect-run <run-id>');
    let activeSignal,coreDeadline,activeGateway;const unknownCore=[];const rawCore=async (args,operationId)=>{const timeout=protectedCoreTimeout(args,activeSignal?coreDeadline:recovery?.deadline,activeGateway?.admissionDeadline),resourceIntent=recovery?.intent('core');journal?.append('core-start',{operation_id:operationId,command_digest:hash(K.canonical(args)),status:'prepared'});const r=await command([process.execPath,...(c.core_cli.endsWith('.ts')?[createRequire(c.core_cli).resolve('tsx/cli')]:[]),c.core_cli,...args],{cwd:root,env:{...process.env,...(recovery?{AIDLC_OPERATION_ID:operationId}:{})},signal:activeSignal,timeout_ms:timeout,observeResourceFailure:true,onStart:pid=>{if(recovery)recovery.started(resourceIntent,pid);journal?.append('core-start',{operation_id:operationId,pid,started_at:new Date().toISOString(),command_digest:hash(K.canonical(args))});}});if(recovery&&r.reconciled)recovery.closed(resourceIntent);journal?.append('core-exit',{operation_id:operationId,pid:r.pid||null,status:r.reconciled?(r.status==='succeeded'?'succeeded':'failed'):'unknown',code:r.exit_code??null,signal:r.signal||null});if(!r.reconciled)unknownCore.push({pid:r.pid,status:'unknown'});try{return coreResponse(r,args);}catch(error){if(error.resource_reconciliation?.reconciled===false){unknownCore.push({status:'resource-unreconciled',...error.resource_reconciliation});K.resources.announceResourceFailure(error.resource_reconciliation);}throw error;}};
    const core=args=>recovery?recovery.operation({kind:'core',args},id=>rawCore(args,id)):rawCore(args,randomUUID());
    const context=(await core(['orchestrate','autonomy','host','context'])).host_context;
    if(context.binding.stage_instance.includes('@')||context.binding.stage_instance!==context.grant.executor_constraints.initial_binding.stage_instance||!context.coordinator_completed)throw Error('HOST_START_REQUIRES_COMPLETED_GLOBAL_COORDINATOR');
    const externalOwner=process.env.AIDLC_RESOURCE_OWNER;if(externalOwner&&(externalOwner!==context.grant.run_id||typeof process.send!=='function'))throw Error('HOST_RESOURCE_OWNER_MISMATCH');
    if(c.admission_plan){const plan=JSON.parse(fs.readFileSync(safe(root,c.admission_plan),'utf8')),grant=context.grant;K.executionWindowCompatibility(c,{plan_lifetime_seconds:plan.lifetime_seconds,grant_window_ms:Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000)-Date.now(),allowed_operations:grant.allowed_operations});}
    context.coordinator_binding=context.binding;process.env.AIDLC_COORDINATOR_BINDING=JSON.stringify(context.binding);
    if(context.binding.session_id!==rest[0]||!isDeepStrictEqual(context.grant.executor_constraints.host,identity(path.resolve(file))))throw Error('HOST_GRANT_SESSION_OR_CONFIG_MISMATCH');
    if(recovery)await K.resources.bounded(client.resume(rest[0]),K.resources.deadlineAfter(Math.max(1,Math.min(30000,recovery.deadline-Date.now()))),'HOST_RECOVERY_RESUME_TIMEOUT');else await client.resume(rest[0]);
    const logDir=path.join(root,'.aidlc','host-runs',context.grant.run_id,...(recovery?['attempts',recovery.lease.state.attempt_id]:[]));for(let p=logDir;p!==root;p=path.dirname(p))if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('HOST_LINKED_CONTROL_DIRECTORY');fs.mkdirSync(logDir,{recursive:true});if(fs.readdirSync(logDir).length)throw Error('HOST_EXISTING_ATTEMPT_REQUIRES_P2_RECONCILIATION');fs.writeFileSync(path.join(logDir,'attempt.json'),JSON.stringify({thread_id:rest[0],grant_digest:context.grant_ref.digest,started_at:new Date().toISOString(),successor_policy:context.grant.successor_policy})+'\n',{flag:'wx'});
    journal=new K.RunJournal(logDir,{run_id:context.grant.run_id,thread_id:rest[0],grant_digest:context.grant_ref.digest});
    journal.append('host-start',{pid:process.pid,ppid:process.ppid,process_start:K.processIdentity(process.pid)});
    process.once('exit',code=>{try{journal.append('host-exit',{pid:process.pid,code});}finally{journal.close();}});
    process.on('uncaughtExceptionMonitor',()=>{try{journal.append('host-error',{reason_code:'UNCAUGHT_EXCEPTION'});}catch{}});
    recordNative=event=>{
      fs.appendFileSync(path.join(logDir,'native-events.jsonl'),JSON.stringify({at:new Date().toISOString(),event:modelProjection(event)})+'\n');
      const mapping={'aidlc/native-process-start':'native-start','aidlc/native-process-exit':'native-exit','aidlc/turn-dispatch':'turn-dispatch','aidlc/turn-bound':'turn-bound','aidlc/turn-result':'turn-end','aidlc/native-resource-unknown':'resource-unknown'};
      if(mapping[event.method])journal.append(mapping[event.method],event.params);
    };
    for(const event of bufferedNative)recordNative(event);
    journal.heartbeat(()=>({pid:process.pid,stage_instance:context.binding.stage_instance,turn_id:client.activeTurn||null}));
    recordNative({method:'aidlc/native-session',params:{thread_id:client.thread,native_user_agent:client.nativeUserAgent,native_config_digest:client.nativeDigest,redaction:'private binding fields removed; model/tool events and tool results retained'}});
    const log=event=>{if(event.kind==='execution-trace'){fs.appendFileSync(path.join(logDir,'execution-trace.jsonl'),JSON.stringify(event.trace)+'\n');return;}fs.appendFileSync(path.join(logDir,'operations.jsonl'),JSON.stringify({...event,at:new Date().toISOString()})+'\n');if(event.status==='prepared')journal.append('tool-start',{operation_id:event.operation_id,binding_digest:event.binding_digest});else if(['succeeded','failed','unknown'].includes(event.status))journal.append('tool-end',{operation_id:event.operation_id,status:event.status});},gateway=new Gateway(c,root,context,core,log);recovery?.attach(gateway);const supervisionStartedAt=Date.now();gateway.trace.emit('host-start',{remaining_wall_ms:gateway.progress.remaining(),origin:'original-grant'});client.tools=a=>gateway.invoke(a);activeGateway=gateway;activeSignal=gateway.abort.signal;coreDeadline=gateway.budget.deadline;
    const stop=signal=>{if(recovery&&signal!=='SIGHUP'){try{recovery.api.cancelRecovery(root);}catch{}}journal.append('host-stop-request',{reason_code:signal});gateway.cancel(signal==='SIGHUP'?'host-disconnected':'user-cancelled');};const onInt=()=>stop('SIGINT'),onTerm=()=>stop('SIGTERM'),onHangup=()=>stop('SIGHUP');process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);process.on('SIGHUP',onHangup);
    const deadline=setTimeout(()=>{journal.append('host-stop-request',{reason_code:'WALL_TIME'});gateway.cancel('wall-time');},Math.max(1,gateway.budget.deadline-Date.now()));
    let reason,batch;
    try{if(context.same_attempt_repair?.supported){const action={action:'core',args:['orchestrate','autonomy','repair','start','--pid',String(process.pid)]};await prepareDispatchAction(action,c,{origin:'host',budget:gateway.budget});await core(action.args);}reason=await driveBatch(c,context,core,client,gateway);if(reason?.startsWith('batch-'))batch=(await core(['orchestrate','autonomy','batch','inspect'])).autonomous_batch_result;
    }catch(e){reason=String(e);}finally{clearTimeout(deadline);gateway.cancel(reason);await gateway.reconcile();process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);process.off('SIGHUP',onHangup);}
    activeSignal=undefined;
    const closeSpan=gateway.trace.start('cleanup',{family:'native-close'});await client.close();gateway.trace.end(closeSpan,client.nativeClosed?'succeeded':'unknown');const nativeProcessReconciled=client.nativeClosed===true&&client.closeResult?.reconciled===true,nativeTurnReconciled=client.lastTurnStatus!=='unknown';
    if(recovery&&nativeProcessReconciled)recovery.closed(nativeIntent);
    const canRecover=Boolean(recovery&&recoverableTransport(reason,gateway.budget.stopped,nativeProcessReconciled&&gateway.pending.size===0&&gateway.unknown.length===0&&unknownCore.length===0));
    const claimsSpan=gateway.trace.start('cleanup',{family:'claim-cleanup'});const claims=!canRecover&&gateway.pending.size===0&&gateway.unknown.length===0&&unknownCore.length===0&&nativeProcessReconciled&&nativeTurnReconciled?(externalOwner?await delegateOwnedCleanup(context).catch(()=>({delegated:false,released:[],failures:[{error:'CLEANUP_DELEGATION_UNRECONCILED'}],reconciled:false})):await releaseOwnedBindings(core,[context.binding,context.coordinator_binding])):{released:[],failures:[{error:'HOST_UNRECONCILED_OPERATIONS_RETAIN_CLAIMS'}],reconciled:false};gateway.trace.end(claimsSpan,claims.reconciled?'succeeded':'unknown');recordNative({method:'aidlc/claim-cleanup',params:claims});
    const candidateVerified=reason==='batch-verified'&&batch?.batch_completed===true&&nativeProcessReconciled&&nativeTurnReconciled&&gateway.unknown.length===0&&unknownCore.length===0;const verified=reason==='batch-verified'&&batch?.batch_completed===true&&nativeProcessReconciled&&nativeTurnReconciled&&gateway.unknown.length===0&&unknownCore.length===0&&claims.reconciled;const result={run_id:context.grant.run_id,thread_id:client.thread,engineering_result:verified?'verified':['batch-failed','batch-blocked','batch-incomplete'].includes(reason)?reason.slice(6):'incomplete',business_verified:verified,candidate_business_verified:candidateVerified,cleanup_delegated:claims.delegated===true,batch_result_ref:batch?.result_ref||null,workflow_completed:false,end_reason:reason,cancelled:gateway.budget.stopped==='user-cancelled',stop_reason:gateway.budget.stopped,operations_reconciled:gateway.pending.size===0&&gateway.unknown.length===0&&unknownCore.length===0,claims_reconciled:claims.reconciled,native_process_reconciled:nativeProcessReconciled,native_turn_reconciled:nativeTurnReconciled,resource_reconciliation:{reconciled:nativeProcessReconciled&&gateway.unknown.length===0&&unknownCore.length===0,resources:[client.closeResult,...gateway.unknown,...unknownCore]},execution_timing:{...gateway.trace.summary(),grant_request_to_supervision_ms:Math.max(0,supervisionStartedAt-Date.parse(context.grant.request_started_at)),before_supervision_attribution:'unattributed'},supervision:{steps:gateway.progress.steps,turns:gateway.progress.turns,steps_without_progress:gateway.progress.withoutProgress,limits:gateway.progress.limits,original_deadline:gateway.budget.deadline},execution_trace_ref:path.relative(root,path.join(logDir,'execution-trace.jsonl')).replaceAll(path.sep,'/'),lifecycle_ref:path.relative(root,journal.file).replaceAll(path.sep,'/'),claim_cleanup:claims,pending_unknown:[...gateway.unknown.map(r=>({pid:r.pid,status:r.status})),...unknownCore]};fs.writeFileSync(path.join(logDir,'exit.json'),JSON.stringify(result)+'\n',{flag:'wx'});if(recovery){if(canRecover)recovery.api.interruptRecovery(root,gateway.progress.snapshot());else if(!externalOwner)recovery.end(reason||'incomplete');}console.log(JSON.stringify(result));if(externalOwner&&process.connected)process.disconnect();
  }finally{const closed=await client.close();if(!closed.reconciled){K.resources.announceResourceFailure({reconciled:false,resources:[closed]});throw K.resources.resourceError(closed);}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(String(e));process.exitCode=2;});
