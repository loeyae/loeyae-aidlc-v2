/** Selective native capability reuse. Every call still checks the live grant and configuration. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {canonicalAutonomyJson as json,autonomyDigest as digest,safeFile} from './aidlc-autonomy-files';
import {readHostCapabilityReport,readIssuedGrant,validateGrantInputs,checkExecutionGrant} from './aidlc-grant-store';
import {loadWorkflowState,sessionBinding,type WorkflowState} from './aidlc-light-state';
import {createRequire} from 'node:module';
const {decideExecutionContinuation}=createRequire(import.meta.url)('./aidlc-execution-continuation.cjs');
import type {AdmissionHostAdapter} from './aidlc-autonomous-admission';
const same=(a:unknown,b:unknown)=>json(a)===json(b),hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');type Row=Record<string,any>;
const windowMs=JSON.parse(readFileSync(new URL('./data/native-host-action-policy.json',import.meta.url),'utf8')).capability_window_ms;
export function hostCapabilityCheckerDigest():string {
  // Qualification depends on its producer, validator, authority and resources.
  // Admission routing/window changes require a new admission, not a model probe.
  return digest(['aidlc-host-capabilities.ts','aidlc-native-host.ts','aidlc-native-tool-channel.ts','aidlc-owned-lock.ts','aidlc-grant-store.ts','aidlc-owned-resource.cjs','data/native-host-action-policy.json'].map(p=>hash(readFileSync(new URL(p,import.meta.url)))));
}
export function validateHostObservation(observation:Row,host:Row,limits:Row,required:string[],deadline:number,now=Date.now()):void {
  const observed=Date.parse(observation?.observed_at),until=Date.parse(observation?.valid_until);
  if(!same(observation?.host,host)||!same(observation?.limits,limits)||!Number.isFinite(observed)||!Number.isFinite(until)||observed>now||until<=now||until<=observed||until>Math.min(observed+windowMs,deadline))throw Error('HOST_CAPABILITY_OBSERVATION_INVALID');
  for(const key of required)if(observation.capabilities?.[key]?.status!=='supported'||!Array.isArray(observation.capabilities[key].probe_refs)||!observation.capabilities[key].probe_refs.length)throw Error('HOST_CAPABILITY_REQUIRED_MISSING: '+key);
}
/** Pure eligibility rules, also rechecked under the publication lock. No adapter invocation here. */
export function capabilityReuseReason(receipt:Row,global:WorkflowState,grant:Row,required:string[],now=Date.now(),minimumWindowMs=0):string|null {
  if(receipt.checker_digest!==hostCapabilityCheckerDigest())return 'checker-changed';
  if(!same(receipt.grant_ref,global.execution_grant_ref)||!same(receipt.batch_ref,global.autonomy_batch)||receipt.grant_constraints_digest!==digest(grant))return 'grant-context-changed';
  if(!same(receipt.observation?.host,grant.executor_constraints.host))return 'host-changed';
  if(!/^[a-f0-9]{64}$/.test(receipt.observation?.configuration_digest||''))return 'configuration-unbound';
  const deadline=Math.min(Date.parse(grant.expires_at),Date.parse(grant.request_started_at)+grant.resource_limits.wall_time_seconds*1000);
  if(receipt.qualification_scope==='run-config'){
    const observed=Date.parse(receipt.observation?.observed_at);
    if(!Number.isFinite(observed)||observed>now||deadline<=now)throw Error('HOST_CAPABILITY_QUALIFICATION_INVALID');
    if(required.some(k=>receipt.observation?.capabilities?.[k]?.status!=='supported'))return 'capability-set-insufficient';
    // Historical capability proof is immutable. Current configuration and live
    // grant are checked separately; its old TTL does not trigger model probes.
    validateHostObservation(receipt.observation,grant.executor_constraints.host,grant.resource_limits,required,deadline,observed);
    return null;
  }
  if(Date.parse(receipt.observation?.valid_until)<=now)return 'expired';
  if(required.some(k=>receipt.observation?.capabilities?.[k]?.status!=='supported'))return 'capability-set-insufficient';
  validateHostObservation(receipt.observation,grant.executor_constraints.host,grant.resource_limits,required,deadline,now);
  if(!Number.isFinite(minimumWindowMs)||minimumWindowMs<0)throw Error('HOST_CAPABILITY_WINDOW_INVALID');
  return Date.parse(receipt.observation.valid_until)-now<minimumWindowMs?'window-insufficient':null;
}
export function reusableHostCapability(root:string,global:WorkflowState,grant:Row,required:string[],adapter?:AdmissionHostAdapter,requiredWindow:(grant:Row)=>number=()=>0):Row {
  const live=loadWorkflowState(root)!;checkExecutionGrant(root,live,sessionBinding(),['validation-execute']);
  if(!same(live.execution_grant_ref,global.execution_grant_ref)||!same(live.autonomy_batch,global.autonomy_batch))throw Error('HOST_CAPABILITY_LIVE_CONTEXT_CHANGED');
  const decision=(current:Row,receipt?:Row)=>decideExecutionContinuation({deadline_at:Math.min(Date.parse(current.expires_at),Date.parse(current.request_started_at)+current.resource_limits.wall_time_seconds*1000),required_ms:requiredWindow(current),available_until:receipt?Date.parse(receipt.observation.valid_until):undefined,status:receipt?'current':'refresh-required'});
  const fresh=(reason:string,current=grant,receipt?:Row)=>{const continuation=decision(current,receipt);if(continuation.decision==='stop')throw Object.assign(Error('HOST_CAPABILITY_CONTINUATION_STOP: '+continuation.reason),{continuation});return {mode:'fresh',reason,continuation:{...continuation,decision:'reprobe',reason}};};
  const receipt=readHostCapabilityReport(root,global);if(!receipt)return fresh('no-controlled-capability');
  const qualified=receipt.qualification_scope==='run-config'&&adapter?.qualification_scope==='run-config';
  if(receipt.qualification_scope==='run-config'&&!qualified)return fresh('adapter-qualification-changed');
  const reason=capabilityReuseReason(receipt,global,grant,required,Date.now(),requiredWindow(grant));
  if(reason&&!['expired','window-insufficient'].includes(reason))return fresh(reason);
  if(!adapter?.revalidate)return fresh('configuration-revalidation-unavailable',grant,receipt);
  validateGrantInputs(root,receipt.probe_inputs);const started=Date.now();
  const configuration=adapter.revalidate({host:grant.executor_constraints.host,limits:grant.resource_limits});
  if(!same(configuration.host,grant.executor_constraints.host)||configuration.configuration_digest!==receipt.observation.configuration_digest||!Number.isFinite(Date.parse(configuration.observed_at))||Date.parse(configuration.observed_at)<started||Date.parse(configuration.observed_at)>Date.now()||configuration.resource_reconciliation?.reconciled!==true)throw Error('HOST_CAPABILITY_CONFIGURATION_CHANGED_OR_UNKNOWN');
  checkExecutionGrant(root,loadWorkflowState(root)!,sessionBinding(),['validation-execute']);
  const current=readIssuedGrant(root,global.execution_grant_ref!).grant;const changed=capabilityReuseReason(receipt,global,current,required,Date.now(),requiredWindow(current));if(changed&&!['expired','window-insufficient'].includes(changed))throw Error('HOST_CAPABILITY_CHANGED_DURING_REVALIDATION: '+changed);
  validateGrantInputs(root,receipt.probe_inputs);
  if(qualified){
    const deadline=Math.min(Date.parse(current.expires_at),Date.parse(current.request_started_at)+current.resource_limits.wall_time_seconds*1000);
    const freshness={observed_at:configuration.observed_at,valid_until:new Date(Math.min(Date.parse(configuration.observed_at)+windowMs,deadline)).toISOString(),basis:'current-configuration-and-live-grant',capability_receipt_ref:receipt.receipt_ref};
    const continuation=decideExecutionContinuation({deadline_at:deadline,required_ms:requiredWindow(current),available_until:Date.parse(freshness.valid_until),refreshable:false});
    if(continuation.decision!=='continue')throw Object.assign(Error('HOST_CAPABILITY_CONTINUATION_STOP: '+continuation.reason),{continuation});
    return {mode:'reused',reason:'run-capability-current-configuration-verified',observation:receipt.observation,receipt_ref:receipt.receipt_ref,configuration_check:configuration,freshness,continuation};
  }
  const continuation=decision(current,receipt);if(continuation.decision==='stop')throw Object.assign(Error('HOST_CAPABILITY_CONTINUATION_STOP: '+continuation.reason),{continuation});
  if(changed||continuation.decision==='reprobe')return {...fresh(changed||continuation.reason,current,receipt),configuration_check:configuration};
  return {mode:'reused',reason:'current-configuration-and-original-provenance-verified',observation:receipt.observation,receipt_ref:receipt.receipt_ref,configuration_check:configuration,continuation};
}
