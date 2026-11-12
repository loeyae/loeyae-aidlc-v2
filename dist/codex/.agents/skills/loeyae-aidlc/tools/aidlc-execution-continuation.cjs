/** Shared temporal decision only. Callers must first validate live authority,
 * identity, input provenance and known resource state. Never an execution grant. */
function decideExecutionContinuation({now=Date.now(),deadline_at,required_ms=0,available_until,status='current',refreshable=true,refresh_attempts=0,max_refreshes=1,pending=false,unknown=false,stop_reason,phase='selection'}={}){
  const result=(decision,reason)=>({schema:'aidlc.execution-continuation/v1',decision,reason,phase,required_ms,available_ms:Number.isFinite(available_until)?Math.max(0,available_until-now):null,original_remaining_ms:Number.isFinite(deadline_at)?Math.max(0,deadline_at-now):null,refresh_attempts,execution_authorized:false});
  if(unknown||pending)return result('stop','operations-unreconciled');
  if(stop_reason)return result('stop',stop_reason);
  if(!Number.isFinite(now)||!Number.isFinite(deadline_at)||!Number.isFinite(required_ms)||required_ms<0||!Number.isSafeInteger(refresh_attempts)||refresh_attempts<0||!Number.isSafeInteger(max_refreshes)||max_refreshes<0||!['current','refresh-required','blocked'].includes(status))return result('stop','continuation-input-invalid');
  if(deadline_at<=now)return result('stop','original-deadline-expired');
  if(deadline_at-now<required_ms)return result('stop','original-budget-insufficient');
  if(status==='blocked')return result('stop','current-context-blocked');
  if(status==='current'&&!Number.isFinite(available_until))return result('stop','current-window-unknown');
  if(status==='current'&&Number.isFinite(available_until)&&available_until>now&&available_until-now>=required_ms)return result('continue','current-window-sufficient');
  const reason=status!=='current'?'current-receipt-unavailable':!Number.isFinite(available_until)?'current-window-unknown':available_until<=now?'current-window-expired':'current-window-insufficient';
  if(!refreshable||phase==='publication'||refresh_attempts>=max_refreshes)return result('stop',phase==='publication'?'publication-window-insufficient':refresh_attempts>=max_refreshes?'refresh-window-insufficient':'refresh-not-permitted');
  return result('reprobe',reason);
}
module.exports={decideExecutionContinuation};
