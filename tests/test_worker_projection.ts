/** The detached worker's synchronous Core projection must use its own pilot
 * environment, restore all ambient authority and retain per-project isolation. */
import assert from 'node:assert/strict';
import {withWorkerProjectionEnvironment as project} from '../docs/evals/autonomy/p1-10/pilot-worker';
const keys=['PILOT_ORIGIN','AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'],old={...process.env};
try {
 for(const key of keys)process.env[key]='ambient-'+key;
 const before=Object.fromEntries(keys.map(key=>[key,process.env[key]])),one={PILOT_ORIGIN:'http://127.0.0.1:10001',AIDLC_SESSION_BINDING:'project-one'},two={PILOT_ORIGIN:'http://127.0.0.1:10002',AIDLC_SESSION_BINDING:'project-two'};
 project(one,()=>{assert.equal(process.env.PILOT_ORIGIN,one.PILOT_ORIGIN);assert.equal(process.env.AIDLC_SESSION_BINDING,'project-one');assert.equal(process.env.AIDLC_EXECUTION_GRANT,undefined);project(two,()=>assert.equal(process.env.PILOT_ORIGIN,two.PILOT_ORIGIN));assert.equal(process.env.PILOT_ORIGIN,one.PILOT_ORIGIN);});
 assert.deepEqual(Object.fromEntries(keys.map(key=>[key,process.env[key]])),before);
 assert.throws(()=>project(two,()=>{assert.equal(process.env.PILOT_ORIGIN,two.PILOT_ORIGIN);throw Error('Core refuses stale evidence');}),/Core refuses/);assert.deepEqual(Object.fromEntries(keys.map(key=>[key,process.env[key]])),before);
 project({},()=>{for(const key of keys)assert.equal(process.env[key],undefined);});assert.deepEqual(Object.fromEntries(keys.map(key=>[key,process.env[key]])),before);
 console.log('PASS worker projection selects each project origin and authority; nested, missing and throwing reads restore ambient context; no cached allow or global environment carryover');
}finally{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}
