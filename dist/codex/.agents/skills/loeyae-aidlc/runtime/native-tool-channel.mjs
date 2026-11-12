/** An installed host may use its own conversation/Supervisor. No model loop here.
 * The trusted installer supplies Core nativeToolChannelContext and intercepts ALL
 * tools with replacement semantics. Never allow the original tool to run as well.
 * No CLI/model JSON can install a channel or attest mandatory interception.
 */
export function nativeToolAction(request) {
  if(!request || Object.keys(request).some(k=>!['name','arguments'].includes(k)) || !request.arguments || typeof request.arguments!=='object' || Array.isArray(request.arguments))throw Error('NATIVE_TOOL_REQUEST_INVALID');
  const a=request.arguments;
  const spec={read_file:['path'],write_file:['path','content','operation'],run_command:['id'],aidlc_core:['args']}[request.name];
  const optional=['read_file','aidlc_core'].includes(request.name)?['detail']:[];
  // Required action arguments are checked by Gateway, so malformed calls receive
  // the same field-level feedback and spend the same bounded retry/step budget.
  if(!spec || Object.keys(a).some(k=>!spec.includes(k)&&!optional.includes(k)) || a.detail!==undefined&&a.detail!=='full')throw Error('NATIVE_TOOL_UNSUPPORTED');
  return {action:{read_file:'read',write_file:'write',run_command:'command',aidlc_core:'core'}[request.name],...a};
}
export function createNativeToolChannel(gateway,{qualify,currentConfiguration}) {
  if(typeof qualify!=='function'||typeof currentConfiguration!=='function')throw Error('NATIVE_CHANNEL_TRUSTED_ADAPTER_REQUIRED');
  let closed=false,tail=Promise.resolve();
  const check=()=>{
    if(closed)throw Error('NATIVE_CHANNEL_CLOSED');
    const value=qualify(currentConfiguration());
    if(value?.mode!=='native-replacement'||value.deadline_at>gateway.budget.deadline||Date.now()>=value.deadline_at||JSON.stringify(value.grant_ref)!==JSON.stringify(gateway.context.grant_ref))throw Error('NATIVE_CHANNEL_CONTEXT_CHANGED');
    gateway.progress.check();return value;
  };
  check();
  return Object.freeze({
    beginTurn(){check();gateway.progress.beginTurn('implementation',gateway.context.binding.stage_instance);},
    endTurn(){gateway.progress.endTurn('completed');},
    replaceTool(request){
      // Copy before queueing; later mutation cannot change the authorized action.
      const action=structuredClone(nativeToolAction(request));
      const task=tail.then(async()=>{check();const result=await gateway.invoke(action);check();return {handled:true,result};});
      tail=task.catch(()=>{});return task;
    },
    async close(reason='native-host-closed'){closed=true;gateway.cancel(reason);return gateway.reconcile();},
    approvalMode:'trusted-operator-terminal',
  });
}
