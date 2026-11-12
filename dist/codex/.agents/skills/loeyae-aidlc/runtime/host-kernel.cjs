const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const P = require('./host-progress.cjs');
const supervisionLimits = overrides => P.supervisionLimits(overrides, actionPolicy.supervision_limits);
const canonical = value => JSON.stringify(value, function(k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v;});
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
// The same immutable policy bytes are shipped with Core and included in HostRef.
const policyFile=[path.join(__dirname,'../tools/data/native-host-action-policy.json'),path.join(__dirname,'../../../core/tools/data/native-host-action-policy.json')].find(p=>fs.existsSync(p));
if(!policyFile)throw Error('HOST_ACTION_POLICY_UNAVAILABLE');
const actionPolicy=Object.freeze(JSON.parse(fs.readFileSync(policyFile,'utf8')));
const resourceFile=path.join(path.dirname(policyFile),'..','aidlc-owned-resource.cjs'),R=require(resourceFile);
const continuationFile=path.join(path.dirname(policyFile),'..','aidlc-execution-continuation.cjs'),continuation=require(continuationFile);
if(actionPolicy.schema!=='aidlc.native-host-action-policy/v1'||['capability_window_ms','publication_margin_ms','core_timeout_ms','phase_timeout_ms'].some(k=>!Number.isSafeInteger(actionPolicy[k])||actionPolicy[k]<1)||actionPolicy.phase_timeout_ms+actionPolicy.publication_margin_ms>=actionPolicy.capability_window_ms)throw Error('HOST_ACTION_POLICY_INVALID');
function feasibleWindow(timeout){if(!Number.isSafeInteger(timeout)||timeout<1||timeout+actionPolicy.publication_margin_ms>=actionPolicy.capability_window_ms)throw Error('HOST_WINDOW_INFEASIBLE');return timeout+actionPolicy.publication_margin_ms;}
function requiredActionWindow(timeout,remaining){if(!Number.isFinite(remaining)||remaining<=actionPolicy.publication_margin_ms*2)throw Error('HOST_BUDGET_INSUFFICIENT_FOR_PUBLICATION');return Math.min(feasibleWindow(timeout),remaining-actionPolicy.publication_margin_ms);}
/** Static handoff envelope; never a grant, capability observation or cached permission. */
function executionWindowCompatibility(c,{plan_lifetime_seconds,grant_window_ms,capability_window_ms=actionPolicy.capability_window_ms,allowed_operations}){
  if(!Number.isSafeInteger(plan_lifetime_seconds)||plan_lifetime_seconds<1||plan_lifetime_seconds>900||!Number.isFinite(capability_window_ms)||capability_window_ms<=0)throw Error('HOST_HANDOFF_WINDOW_INVALID');
  const permitted=op=>!allowed_operations||allowed_operations.includes(op),actions=[];
  if(permitted('evidence-publish'))actions.push({family:'native-evidence',timeout_ms:actionPolicy.phase_timeout_ms});
  if(permitted('stage-report'))actions.push({family:'stage-report',timeout_ms:actionPolicy.core_timeout_ms});
  if(c.observation_plan&&permitted('validation-execute'))actions.push({family:'complete-observation',timeout_ms:actionPolicy.core_timeout_ms});
  for(const row of c.commands||[])if(permitted(row.operation))actions.push({family:'command:'+row.id,timeout_ms:row.timeout_ms});
  const remaining=grant_window_ms===undefined?Infinity:grant_window_ms;
  const requirements=actions.map(a=>({...a,required_ms:remaining===Infinity?feasibleWindow(a.timeout_ms):requiredActionWindow(a.timeout_ms,remaining)})),required_ms=Math.max(0,...requirements.map(a=>a.required_ms)),available_ms=Math.min(plan_lifetime_seconds*1000,capability_window_ms);
  if(available_ms<required_ms)throw Error(`HOST_HANDOFF_WINDOW_INFEASIBLE: required=${required_ms} available=${available_ms}`);
  return {schema:'aidlc.execution-window-compatibility/v1',status:'compatible',required_ms,available_ms,grant_window_ms:grant_window_ms??null,requirements,execution_authorized:false};
}
function coreAction(args,origin='model'){
  if(!Array.isArray(args)||args.some(s=>typeof s!=='string'||/[\x00\r\n]/.test(s))||args.some(s=>['--user-input','--human-instruction-ref','--scope','--work','--maintenance','approved','Approve','transfer','issue','revoke','recover','adopt','rebuild','resume'].includes(s.split('=')[0])))throw Error('HOST_CORE_COMMAND_DENIED');
  const autonomy=args[0]==='orchestrate'&&args[1]==='autonomy',decision=autonomy&&args[2]==='record',inspect=autonomy&&['inspect','decisions','policy','dependencies'].includes(args[2])||args[0]==='orchestrate'&&args[1]==='state'&&['context','artifact'].includes(args[2]),observation=autonomy&&args[2]==='observe'&&['inspect','run'].includes(args[3]),batch=autonomy&&args[2]==='batch'&&['inspect','finalize'].includes(args[3]),evidence=args[0]==='evidence'&&args[1]==='run',report=args[0]==='orchestrate'&&args[1]==='report',next=args[0]==='orchestrate'&&args[1]==='next';
  const repair=autonomy&&args[2]==='repair'&&(['inspect','request'].includes(args[3])||origin==='host'&&['start','apply'].includes(args[3]));
  const host=origin==='host'&&(autonomy&&(args[2]==='host'&&['context','select','proposal','prepare'].includes(args[3])||args[2]==='admission'&&['inspect','run'].includes(args[3])||args[2]==='grant'&&args[3]==='check'||args[2]==='run'&&['inspect','checkpoint'].includes(args[3]))||args[0]==='module'&&['inspect','release'].includes(args[1]));
  if(!evidence&&!report&&!next&&!decision&&!inspect&&!observation&&!batch&&!host&&!repair)throw Error('HOST_CORE_COMMAND_DENIED');
  return {decision,inspect,observation,batch,evidence,report,next,host,repair};
}
const actionFields={read:['action','path','detail'],rule:['action','path','detail','section'],write:['action','path','content','operation'],command:['action','id'],core:['action','args','detail']};
const actionRequired={read:['path'],rule:['path'],write:['path','content','operation'],command:['id'],core:['args']};
const writeOperations=['code-write','test-write','design-write'];
const actionProperties={action:{type:'string',enum:Object.keys(actionFields)},path:{type:'string'},detail:{type:'string',enum:['full']},section:{type:'string',pattern:'^[0-9]+$'},content:{type:'string'},operation:{type:'string',enum:writeOperations,description:'Required for write. Explicit permission class; never inferred from the path.'},id:{type:'string'},args:{type:'array',items:{type:'string'}}};
function modelActionSchema(){return {type:'object',properties:actionProperties,required:['action'],additionalProperties:false,anyOf:Object.entries(actionFields).map(([action,fields])=>({type:'object',properties:{...Object.fromEntries(fields.map(k=>[k,actionProperties[k]])),action:{enum:[action]}},required:['action',...actionRequired[action]],additionalProperties:false,...(action==='rule'?{not:{required:['detail','section']}}:{})}))};}
function actionInputError(code,field,expected){return Object.assign(Error(`${code}: ${field} ${expected}. Operation not dispatched; correct the arguments and retry within the original budget.`),{action_input_invalid:true});}
/** Shared model/host classification. Origin and mode come only from trusted callers. */
function describeAction(a,c,{origin='model',mode='implementation'}={}){
  const fields=actionFields;
  if(!a||typeof a!=='object'||Array.isArray(a))throw Error('HOST_TOOL_SCHEMA');
  if(!Object.hasOwn(fields,a.action))throw Error('HOST_TOOL_UNKNOWN');
  if(Object.keys(a).some(k=>!fields[a.action].includes(k)))throw Error('HOST_TOOL_SCHEMA');
  for(const field of actionRequired[a.action])if(!Object.hasOwn(a,field))throw actionInputError(a.action==='write'?'HOST_WRITE_SCHEMA':'HOST_TOOL_SCHEMA',a.action+'.'+field,field==='operation'?'is required; choose code-write, test-write or design-write':'is required');
  if(a.detail!==undefined&&a.detail!=='full')throw Error('HOST_TOOL_SCHEMA');
  if(a.section!==undefined&&(typeof a.section!=='string'||!/^\d+$/.test(a.section)||a.detail))throw Error('HOST_TOOL_SCHEMA');
  let family=a.action,operation='validation-execute',timeout_ms=0,needs_window=false,core;
  if(a.action==='read'||a.action==='rule'){if(typeof a.path!=='string')throw Error('HOST_TOOL_SCHEMA');}
  if(a.action==='write'){
    if(!writeOperations.includes(a.operation))throw actionInputError('HOST_WRITE_SCHEMA','write.operation','must be code-write, test-write or design-write');
    if(typeof a.path!=='string'||typeof a.content!=='string'||Buffer.byteLength(a.content)>1048576)throw actionInputError('HOST_WRITE_SCHEMA','write.path/content','must be strings with content at most 1048576 UTF-8 bytes');
    operation=a.operation;family='write.'+operation;
    if(operation==='design-write'&&proposalPath(a.path)){operation='decision-record';family='write.decision-proposal';}
  }
  if(a.action==='command'){
    const command=c.commands.find(row=>row.id===a.id);if(!command)throw Error('HOST_COMMAND_NOT_FROZEN');operation=command.operation;timeout_ms=command.timeout_ms;needs_window=true;
  }
  if(a.action==='core'){
    core=coreAction(a.args,origin);const args=a.args;family='core.'+(core.evidence?'evidence.run':args[0]==='module'?'module.'+args[1]:args[1]==='autonomy'?args.slice(2,core.observation||core.batch||core.host||core.repair?4:3).join('.'):args[1]);
    operation=core.decision?'decision-record':core.evidence?'evidence-publish':core.report?'stage-report':core.next||core.repair&&['request','apply','start'].includes(args[3])||core.host&&args[2]==='run'&&args[3]==='checkpoint'?'workflow-write':'validation-execute';
    needs_window=core.evidence||core.report||core.observation&&args[3]==='run'&&!args.includes('--dependency-preflight')||core.batch&&args[3]==='finalize'||core.repair&&args[3]==='apply';
    timeout_ms=core.evidence?actionPolicy.phase_timeout_ms:actionPolicy.core_timeout_ms;
  }
  if(mode==='metadata'&&!(a.action==='read'||a.action==='rule'||a.action==='write'&&(operation==='design-write'||family==='write.decision-proposal')||a.action==='core'&&(core.decision||core.inspect||core.observation&&a.args[3]==='inspect'||core.batch&&a.args[3]==='inspect')))throw Error('HOST_FINALIZATION_ONLY');
  if(mode==='repair-diagnosis'&&!(a.action==='read'||a.action==='rule'||a.action==='core'&&(core.inspect||core.repair&&['inspect','request'].includes(a.args[3])||core.observation&&a.args[3]==='inspect')))throw Error('HOST_REPAIR_DIAGNOSIS_ONLY');
  if(needs_window)feasibleWindow(timeout_ms);
  return {family,operation,timeout_ms,needs_window,core};
}
function proposalPath(name){return typeof name==='string'&&/^\.aidlc\/proposals\/decisions\/[A-Za-z0-9_-]{1,128}\/[a-z0-9][a-z0-9-]*\.json$/.test(name);}
function safe(root, name, missing = false, publicRead = false, proposal = false) {
  const publicInput=proposal&&proposalPath(name)||publicRead&&typeof name==='string'&&(proposalPath(name)||name==='.aidlc/evidence'||name.startsWith('.aidlc/evidence/')||name==='.aidlc/commands'||name.startsWith('.aidlc/commands/')||['.aidlc/evidence-commands.json','.aidlc/source-roots.json'].includes(name));
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || path.win32.isAbsolute(name) || /[\\:\x00-\x1f]/.test(name) || name.split('/').some((s,i) => !s || s === '.' || s === '..' || /[ .]$/.test(s) || s.toLowerCase()==='.git'||s.toLowerCase()==='.aidlc'&&!(publicInput&&i===0))) throw Error('HOST_UNSAFE_PATH');
  if(name.split('/')[0].toLowerCase()==='aidlc')throw Error('HOST_UNSAFE_PATH');
  let target = fs.realpathSync(root);
  for (const part of name.split('/')) { target = path.join(target, part); if (fs.existsSync(target)) { const s = fs.lstatSync(target); if (s.isSymbolicLink() || s.isFile() && s.nlink !== 1) throw Error('HOST_LINKED_PATH'); } else if (!missing) throw Error('HOST_MISSING_PATH'); }
  return target;
}
function businessEnv(base) { return Object.fromEntries(Object.entries(base).filter(([key])=>!/^AIDLC_(SESSION_BINDING|COORDINATOR_BINDING|EXECUTION_GRANT|AUTONOMY_HOST|RESOURCE_OWNER|ATTEMPT_TOKEN|OPERATION_ID)$/.test(key.toUpperCase()))); }
function config(file) {
  const raw = fs.readFileSync(file); if (raw.length > 1048576) throw Error('HOST_CONFIG_LIMIT');
  const c = JSON.parse(raw); if (c.schema !== 'aidlc.codex-host/v1' || Object.keys(c).some(k => !['schema','codex_entrypoint','core_cli','commands','native_config_digest','admission_plan','browser_entrypoint','observation_plan','candidate_command','design_write_paths','supervision_limits','resource_limits','worker_entrypoint'].includes(k)) || !Array.isArray(c.commands)) throw Error('HOST_CONFIG_INVALID');
  if(c.design_write_paths!==undefined&&(!Array.isArray(c.design_write_paths)||c.design_write_paths.length>64||c.design_write_paths.some(p=>typeof p!=='string'||!p||path.isAbsolute(p)||path.win32.isAbsolute(p)||/[\\:\x00-\x1f]/.test(p)||p.split('/').some((s,i)=>!s||s==='.'||s==='..'||/[ .]$/.test(s)||['.git','.aidlc'].includes(s.toLowerCase())||i===0&&s.toLowerCase()==='aidlc'))))throw Error('HOST_DESIGN_SCOPE_INVALID');
  for (const p of [c.codex_entrypoint,c.core_cli,...(c.browser_entrypoint?[c.browser_entrypoint]:[]),...(c.worker_entrypoint?[c.worker_entrypoint]:[])]) { if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.lstatSync(p).isFile() || fs.lstatSync(p).isSymbolicLink()) throw Error('HOST_ENTRYPOINT_INVALID'); }
  if(c.native_config_digest!==undefined&&!/^[a-f0-9]{64}$/.test(c.native_config_digest))throw Error("HOST_NATIVE_CONFIG_INVALID");
  const ids = new Set();
  for (const cmd of c.commands) {
    if (!cmd || !/^[a-z0-9-]+$/.test(cmd.id) || ids.has(cmd.id) || !Array.isArray(cmd.argv) || !cmd.argv.length || cmd.argv.some(a => typeof a !== 'string' || /[\x00\r\n]/.test(a)) || !['validation-execute','provider-execute','candidate-commit','candidate-integrate','push','deploy'].includes(cmd.operation) || !Number.isSafeInteger(cmd.timeout_ms) || cmd.timeout_ms < 1 || cmd.timeout_ms > 900000 || !Array.isArray(cmd.input_paths) || !cmd.input_paths.length || !Array.isArray(cmd.write_paths) || Object.keys(cmd).some(k => !['id','argv','operation','timeout_ms','input_paths','write_paths','recovery_query'].includes(k))) throw Error('HOST_COMMAND_INVALID');
    if(!path.isAbsolute(cmd.argv[0])||!fs.lstatSync(cmd.argv[0]).isFile())throw Error('HOST_COMMAND_ENTRYPOINT');
    for(const row of cmd.write_paths)if(!row||typeof row.path!=='string'||!['code-write','test-write','design-write','environment-write'].includes(row.operation)||Object.keys(row).some(k=>!['path','operation'].includes(k)))throw Error('HOST_COMMAND_WRITE_SCOPE');
    if(cmd.recovery_query!==undefined){const q=cmd.recovery_query;if(!q||Object.keys(q).some(k=>!['argv','timeout_ms'].includes(k))||!Array.isArray(q.argv)||!q.argv.length||q.argv.some(a=>typeof a!=='string'||/[\x00\r\n]/.test(a))||!path.isAbsolute(q.argv[0])||!fs.lstatSync(q.argv[0]).isFile()||!Number.isSafeInteger(q.timeout_ms)||q.timeout_ms<1||q.timeout_ms>15000)throw Error('HOST_RECOVERY_QUERY_INVALID');}
    feasibleWindow(cmd.timeout_ms);ids.add(cmd.id);
  }
  if(c.candidate_command!==undefined&&(!c.commands.some(cmd=>cmd.id===c.candidate_command&&['candidate-commit','candidate-integrate'].includes(cmd.operation))))throw Error('HOST_CANDIDATE_COMMAND_INVALID');
  c.supervision_limits=supervisionLimits(c.supervision_limits);c.resource_limits=R.resourceLimits(c.resource_limits);
  return c;
}
function identity(file) {
  const c = config(file);
  return { host_id:'codex-app-server', version:'1', entrypoint:path.join(__dirname,'aidlc-codex-host.mjs'), config_digest:hash(JSON.stringify([hash(fs.readFileSync(file)), ...['aidlc-codex-host.mjs','host-kernel.cjs','host-model-input.mjs','native-tool-channel.mjs','host-progress.cjs','host-recovery.mjs','host-worker-recovery.mjs','deny-native.cjs'].map(p=>hash(fs.readFileSync(path.join(__dirname,p)))), hash(fs.readFileSync(policyFile)),hash(fs.readFileSync(resourceFile)),hash(fs.readFileSync(continuationFile)),hash(fs.readFileSync(c.codex_entrypoint)), hash(fs.readFileSync(c.core_cli)),...(c.worker_entrypoint?[hash(fs.readFileSync(c.worker_entrypoint))]:[]),...(c.browser_entrypoint?[hash(fs.readFileSync(c.browser_entrypoint))]:[])])) };
}
// Rule discovery stays inside the shipped instruction roots, with the same link/path checks as reads.
function rule(root, input) {
  if(typeof input!=='string')throw Error('HOST_RULE_PATH_DENIED');
  const name=input.replace(/^core\//,'').replace(/\/$/,'');
  if(!/^(stages|knowledge|skills)(?:\/|$)/.test(name))throw Error('HOST_RULE_PATH_DENIED');
  const target=safe(root,name,true),files=[];
  const list=(directory,depth=0)=>{
    if(depth>8||files.length>2048)throw Error('HOST_RULE_INDEX_LIMIT');
    for(const e of fs.readdirSync(safe(root,directory),{withFileTypes:true})){
      const label=directory+'/'+e.name;safe(root,label);
      if(e.isDirectory())list(label,depth+1);
      else if(e.isFile()&&e.name.endsWith('.md')){files.push(label);if(files.length>2048)throw Error('HOST_RULE_INDEX_LIMIT');}
    }
  };
  if(!fs.existsSync(target)){
    if(!name.endsWith('.md'))throw Error('HOST_RULE_PATH_DENIED');
    for(const base of ['stages','knowledge','skills'])if(fs.existsSync(path.join(root,base)))list(base);
    return {error:'HOST_RULE_NOT_FOUND',path:input,candidates:files.filter(p=>path.posix.basename(p)===path.posix.basename(name)).sort()};
  }
  if(fs.statSync(target).isDirectory()){list(name);return {path:input,files:files.sort()};}
  if(!name.endsWith('.md'))throw Error('HOST_RULE_PATH_DENIED');
  if(fs.statSync(target).size>1048576)throw Error('HOST_READ_LIMIT');
  const content=fs.readFileSync(target,'utf8');return {path:input,content,sha256:hash(content)};
}
class Budget {
  constructor(limits, deadline, now = Date.now) {
    if (!Number.isSafeInteger(limits.wall_time_seconds) || limits.wall_time_seconds < 1 || !Number.isSafeInteger(limits.max_equivalent_retries) || limits.max_equivalent_retries < 0 || limits.max_active_units !== 1 || !Number.isFinite(deadline)) throw Error('HOST_BUDGET_INVALID');
    this.limits=limits; this.deadline=deadline; this.now=now; this.busy=false; this.failures=new Map(); this.stopped=null;
  }
  check() { if (this.stopped) throw Error('HOST_STOPPED: '+this.stopped); if (this.now() >= this.deadline) { this.stopped='wall-time'; throw Error('HOST_BUDGET_EXHAUSTED'); } }
  enter(key) { this.check(); if (this.busy) throw Error('HOST_SERIAL_ONLY'); if ((this.failures.get(key)||0)>this.limits.max_equivalent_retries) throw Error('HOST_EQUIVALENT_RETRIES_EXHAUSTED'); this.busy=true; }
  leave(key, success) { this.busy=false; if (!success) this.failures.set(key,(this.failures.get(key)||0)+1); }
  stop(reason) { this.stopped ||= reason; }
}
// Track only children created here; never infer cancellation from sending a signal.
async function command(argv, options = {}) { return await R.runCommand(argv,options); }
// OS identity is evidence of liveness only; it is never a session credential.
function processIdentity(pid) {
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('HOST_PROCESS_ID_INVALID');
  try {
    if(process.platform==='win32'){
      const script=`try {$p=Get-Process -Id ${pid} -ErrorAction Stop;[pscustomobject]@{pid=$p.Id;status='present';birth_token=('win32:'+ $p.StartTime.ToUniversalTime().Ticks.ToString())}|ConvertTo-Json -Compress}catch{if($_.FullyQualifiedErrorId -match 'NoProcessFound'){[pscustomobject]@{pid=${pid};status='absent'}|ConvertTo-Json -Compress}else{[pscustomobject]@{pid=${pid};status='unknown'}|ConvertTo-Json -Compress}}`;
      const result=cp.spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-Command',script],{env:businessEnv(process.env),windowsHide:true,encoding:'utf8',timeout:5000});
      if(result.status!==0||result.error)return {pid,status:'unknown'};return JSON.parse(result.stdout);
    }
    const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
    return {pid,status:'present',birth_token:'proc:'+fields[19]};
  }catch(error){return {pid,status:['ENOENT','ESRCH'].includes(error.code)?'absent':'unknown'};}
}
const JOURNAL_EVENTS=new Set(['host-start','heartbeat','native-start','native-exit','core-start','core-exit','tool-start','tool-end','turn-dispatch','turn-bound','turn-end','host-stop-request','host-error','host-exit','resource-unknown']);
const JOURNAL_FIELDS=new Set(['pid','ppid','role','process_start','turn_id','dispatch_id','status','code','signal','operation_id','binding_digest','command_digest','stage_instance','reason_code','started_at','resource_id']);
class RunJournal {
  constructor(directory,identity){
    if(!path.isAbsolute(directory)||!identity||!/^[a-f0-9-]{36}$/.test(identity.run_id)||typeof identity.thread_id!=='string'||!/^[a-f0-9]{64}$/.test(identity.grant_digest))throw Error('HOST_LIFECYCLE_IDENTITY_INVALID');
    for(let current=directory;current!==path.dirname(current);current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('HOST_LINKED_CONTROL_DIRECTORY');
    fs.mkdirSync(directory,{recursive:true});this.identity={run_id:identity.run_id,thread_id:identity.thread_id,grant_digest:identity.grant_digest};this.file=path.join(directory,'lifecycle.jsonl');this.fd=fs.openSync(this.file,'wx',0o600);this.closed=false;
  }
  append(event,data={}){
    if(this.closed)throw Error('HOST_LIFECYCLE_CLOSED');if(!JOURNAL_EVENTS.has(event)||Object.keys(data).some(k=>!JOURNAL_FIELDS.has(k)))throw Error('HOST_LIFECYCLE_FIELD_INVALID');
    const privateFields=new Set(['binding','session_binding','coordinator_binding','generation','private_key','env','environment']);
    const scan=v=>{if(Array.isArray(v))return v.forEach(scan);if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(privateFields.has(k))throw Error('HOST_LIFECYCLE_PRIVATE_FIELD');scan(x);}};scan(data);
    const row={schema:'aidlc.host-lifecycle/v1',...this.identity,event,at:new Date().toISOString(),...data};fs.writeSync(this.fd,JSON.stringify(row)+'\n');fs.fsyncSync(this.fd);return row;
  }
  heartbeat(snapshot=()=>({}),milliseconds=5000){if(this.timer)throw Error('HOST_LIFECYCLE_HEARTBEAT_EXISTS');this.timer=setInterval(()=>this.append('heartbeat',snapshot()),milliseconds);this.timer.unref();}
  close(){if(this.closed)return;clearInterval(this.timer);fs.closeSync(this.fd);this.closed=true;}
}
function inspectRun(root,runId,probe=processIdentity,attemptId){
  if(!/^[a-f0-9-]{36}$/.test(runId))throw Error('HOST_RUN_ID_INVALID');if(attemptId!==undefined&&!/^[a-f0-9-]{36}$/.test(attemptId))throw Error('HOST_ATTEMPT_ID_INVALID');const directory=path.join(fs.realpathSync(root),'.aidlc/host-runs',runId,...(attemptId?['attempts',attemptId]:[]));
  for(let current=directory;current!==path.dirname(current);current=path.dirname(current))if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('HOST_LINKED_CONTROL_DIRECTORY');
  const file=path.join(directory,'lifecycle.jsonl');if(!fs.existsSync(file))return {classification:'lifecycle-unavailable',execution_authorized:false,business_verified:false,automatic_recovery_allowed:false,native_turn_reconciled:false,native_process_reconciled:false};
  const rows=[];let complete=true;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean)){try{const row=JSON.parse(line);if(row.run_id!==runId||row.schema!=='aidlc.host-lifecycle/v1'||!JOURNAL_EVENTS.has(row.event)||typeof row.thread_id!=='string'||!/^[a-f0-9]{64}$/.test(row.grant_digest)||rows.length&&(row.thread_id!==rows[0].thread_id||row.grant_digest!==rows[0].grant_digest))throw Error('identity');rows.push(row);}catch{complete=false;}}
  const start=rows.find(r=>r.event==='host-start'),stamp=start?.process_start,live=stamp?probe(stamp.pid):{status:'unknown'},turns=new Map(),operations=new Map(),nativeProcesses=new Map();
  for(const row of rows){if(row.event==='native-start')nativeProcesses.set(row.pid,row);if(row.event==='native-exit')nativeProcesses.delete(row.pid);if(row.event.startsWith('turn-'))turns.set(row.dispatch_id,row);if(['tool-start','tool-end','core-start','core-exit'].includes(row.event))operations.set(row.operation_id,row);}
  const pendingTurns=[...turns.values()].filter(r=>r.event!=='turn-end'||!['completed','interrupted'].includes(r.status)),pendingOperations=[...operations.values()].filter(r=>!['tool-end','core-exit'].includes(r.event)||!['succeeded','failed'].includes(r.status));
  const exit=rows.findLast(r=>r.event==='host-exit');let classification;
  if(exit)classification='host-exit-recorded';else if(live.status==='absent')classification='interrupted-unreconciled';else if(live.status==='present'&&stamp?.birth_token&&live.birth_token!==stamp.birth_token)classification='pid-reused-unreconciled';else if(live.status==='present'&&stamp?.birth_token&&live.birth_token===stamp.birth_token)classification='running';else classification='liveness-unknown';
  return {classification,run_id:runId,host_identity:stamp||null,observed_process:live,last_event_at:rows.at(-1)?.at||null,journal_complete:complete,owned_resources_reconciled:complete&&!rows.some(r=>r.event==='resource-unknown'),native_process_reconciled:complete&&nativeProcesses.size===0&&!rows.some(r=>r.event==='resource-unknown'),pending_native_processes:[...nativeProcesses.values()].map(row=>({pid:row.pid,process_start:row.process_start,observed_process:Number.isSafeInteger(row.pid)?probe(row.pid):{status:'unknown'}})),native_turn_reconciled:complete&&pendingTurns.length===0,pending_native_turns:pendingTurns.map(r=>({dispatch_id:r.dispatch_id,turn_id:r.turn_id||null})),recorded_operations_reconciled:complete&&pendingOperations.length===0&&!rows.some(r=>r.event==='resource-unknown'),pending_operation_ids:pendingOperations.map(r=>r.operation_id),core_exit_present:fs.existsSync(path.join(directory,'exit.json')),automatic_recovery_allowed:false,execution_authorized:false,business_verified:false};
}
module.exports={...P,...continuation,resources:R,supervisionLimits,canonical,hash,safe,proposalPath,businessEnv,config,identity,rule,Budget,command,RunJournal,processIdentity,inspectRun,actionPolicy,feasibleWindow,requiredActionWindow,executionWindowCompatibility,coreAction,describeAction,modelActionSchema};
