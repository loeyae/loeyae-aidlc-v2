import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Gateway,driveBatch} from '../harness/codex/runtime/aidlc-codex-host.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aidlc-formal-diagnostic-')),events=[],context={binding:{stage_instance:'build-and-test'},grant:{request_started_at:new Date().toISOString(),expires_at:new Date(Date.now()+60000).toISOString(),resource_limits:{wall_time_seconds:60,max_equivalent_retries:1,max_active_units:1},executor_constraints:{initial_binding:{stage_instance:'workspace-detection'}}}};
const route={kind:'error',stage_instance:'build-and-test',message:'GREEN source_revision.scope_digest changed',repair_guidance:{category:'phase-evidence-stale',action:'repair',fingerprint:'frozen-tail'},repair_diagnostics:[{action:'diagnose',sensor:'green-test-evidence',stage_instance:'code-generation@module:p@unit:u',message:'retain original observation'}],host_context:{binding:{session_id:'secret-session',generation:'secret-generation'}}};
const transport=async args=>{if(args[1]==='next')return args.includes('--preview')?{kind:'run-stage',stage_instance:'build-and-test'}:route;throw Error('unexpected transport');};
const g=new Gateway({commands:[]},root,context,transport,e=>events.push(e));
try{
 const end=await driveBatch({commands:[]},context,transport,{turn(){throw Error('Blocked route must not invoke model');}},g);assert.equal(end,'formal-route-blocked');
 const records=events.filter(e=>e.event==='formal-route-diagnostic');assert.equal(records.length,1);assert.equal(records[0].preview,false);assert.equal(records[0].decision,'stop');assert.equal(records[0].directive.message,route.message);assert.deepEqual(records[0].directive.repair_diagnostics,route.repair_diagnostics);assert.deepEqual(records[0].directive.repair_guidance,route.repair_guidance);assert.doesNotMatch(JSON.stringify(records),/secret-session|secret-generation/);
 console.log('PASS actual Gateway/driver retains exact formal refusal diagnostics before stop without private bindings or model dispatch');
}finally{g.cancel('test-end');await g.reconcile();fs.rmSync(root,{recursive:true,force:true});}
