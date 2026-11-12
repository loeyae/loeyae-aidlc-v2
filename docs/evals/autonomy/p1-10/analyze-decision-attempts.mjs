// Read-only diagnosis of an ENDED attempt. Never retries a command or writes the trial workflow.
import fs from 'node:fs';import p from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const evaluation=import.meta.dirname,key=process.argv[2];assert.match(key,/^(orders|publish)-r[0-9]+$/);
const directory=p.join(evaluation,key),root=JSON.parse(fs.readFileSync(p.join(directory,'preparation.json'))).root;
const run=JSON.parse(fs.readFileSync(p.join(root,'pilot/grant-request.json'))).run_id,host=p.join(root,'.aidlc/host-runs',run);
const exit=JSON.parse(fs.readFileSync(p.join(host,'exit.json')));assert.equal(exit.business_verified,false);assert.equal(exit.operations_reconciled,true);
const raw=fs.readFileSync(p.join(host,'native-events.jsonl')),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rows=raw.toString().trim().split(/\r?\n/).map(JSON.parse),calls=new Map(),inputs=new Map(),priorFailures=new Map(),attempts=[];
for(const row of rows){const event=row.event;
 if(event.method==='item/tool/call'){calls.set(event.id,{at:row.at,args:event.params.arguments,input:inputs.get(event.params.arguments.args?.[event.params.arguments.args.indexOf('--input')+1])});continue;}
 if(event.method!=='aidlc/tool/result')continue;
 const call=calls.get(event.params.callId);if(!call)continue;const a=call.args;
 if(a.action==='write'&&event.params.success){let value;try{value=JSON.parse(a.content);}catch{}
  inputs.set(a.path,{sha256:sha(a.content),written_at:row.at,revision:value?.revision,validation_refs:(value?.validation_refs||[]).map(v=>({fields:Object.keys(v).sort(),check_id:v.check_id,sensor:v.sensor}))});
 }
 if(a.action!=='core'||a.args[0]!=='orchestrate'||a.args[1]!=='autonomy'||a.args[2]!=='record'||!a.args.includes('--input'))continue;
 const commandKey=JSON.stringify(a.args),prior=priorFailures.get(commandKey),error=event.params.error||null;
 const attempt={at:call.at,result_at:row.at,args:a.args,success:event.params.success,error,input:call.input??null,
  same_arguments_as_prior_failure:!!prior,input_changed_since_prior_failure:!!(prior?.input&&call.input&&prior.input.sha256!==call.input.sha256),
  changed_input_refused_by_equivalent_limit:!!(/HOST_EQUIVALENT_RETRIES_EXHAUSTED/.test(error||'')&&prior?.input&&call.input&&prior.input.sha256!==call.input.sha256)};
 attempts.push(attempt);if(!attempt.success)priorFailures.set(commandKey,attempt);
}
assert.ok(attempts.length);const output=p.join(directory,'decision-diagnostic-'+Date.now());fs.mkdirSync(output);
const report={kind:'actual-ended-decision-tool-diagnosis',key,run_id:run,actual_end_reason:exit.end_reason,business_verified:false,
 original_native_events_sha256:sha(raw),attempts,successful_records:attempts.filter(a=>a.success).length,
 changed_inputs_refused_by_equivalent_limit:attempts.filter(a=>a.changed_input_refused_by_equivalent_limit).length,
 interpretation:'Changed inputs are identified from successful actual writes before each call. This does not assert those proposals were valid or authorize retrying an ended attempt.',trial_workflow_mutated:false};
fs.writeFileSync(p.join(output,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,attempts:attempts.length,successful_records:report.successful_records,changed_inputs_refused_by_equivalent_limit:report.changed_inputs_refused_by_equivalent_limit,business_verified:false}));
