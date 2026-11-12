/** Read-only selected-host window validation. Core validates; the host retains its Supervisor. */
import {readFileSync,existsSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {safeFile,canonicalAutonomyJson as json} from './aidlc-autonomy-files';
type Row=Record<string,any>;
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function inspectExecutionWindow(root:string,planPath:string,budget?:Row,capability?:Row){
 const plan=JSON.parse(readFileSync(safeFile(root,planPath),'utf8'));
 if(!plan.native_host_ref)return {status:'not-applicable',reason:'No selected native host plan',execution_authorized:false};
 const ref=plan.native_host_ref,file=safeFile(root,ref.path);if(ref.repository_id!=='project'||ref.digest_mode!=='raw-file'||sha(readFileSync(file))!==ref.digest)throw Error('HOST_CONFIG_REFERENCE_CHANGED');
 const url=[new URL('../runtime/host-kernel.cjs',import.meta.url),new URL('../../harness/codex/runtime/host-kernel.cjs',import.meta.url)].find(u=>existsSync(u));if(!url)throw Error('HOST_RUNTIME_UNAVAILABLE');
 const K=createRequire(import.meta.url)(fileURLToPath(url)),config=K.config(file),host=K.identity(file);
 if(config.admission_plan!==undefined&&config.admission_plan!==planPath)throw Error('HOST_ADMISSION_PLAN_CHANGED');
 if(budget?.host&&json(budget.host)!==json(host)||budget?.executor_constraints?.host&&json(budget.executor_constraints.host)!==json(host))throw Error('HOST_IDENTITY_DIFFERS_FROM_GRANT');
 const now=Date.now();let grant_window_ms:number|undefined;
 if(budget){if(budget.request_started_at){const end=Math.min(Date.parse(budget.expires_at),Date.parse(budget.request_started_at)+budget.resource_limits.wall_time_seconds*1000);grant_window_ms=end-now;}
 else {const lifetime=budget.lifetime_seconds,wall=budget.resource_limits?.wall_time_seconds;if(!Number.isSafeInteger(lifetime)||lifetime<1||!Number.isSafeInteger(wall)||wall<lifetime)throw Error('HOST_GRANT_WINDOW_INVALID');grant_window_ms=Math.min(lifetime,wall)*1000;}}
 const result=K.executionWindowCompatibility(config,{plan_lifetime_seconds:plan.lifetime_seconds,grant_window_ms,allowed_operations:budget?.allowed_operations,capability_window_ms:capability?Math.min(K.actionPolicy.capability_window_ms,Date.parse(capability.valid_until)-now):undefined});
 return {...result,plan_path:planPath,host,inputs:[{path:planPath,digest:sha(readFileSync(safeFile(root,planPath)))},{path:ref.path,digest:ref.digest}],original_deadline_extended:false};
}
/** A grant only checks selected native plans in its frozen scope; legacy unselected modes stay compatible. */
export function assertScopeExecutionWindows(root:string,refs:Row[],request:Row){
 const checked=[];for(const ref of refs){if(ref.digest_mode!=='raw-file')continue;let plan:Row;try{plan=JSON.parse(readFileSync(safeFile(root,ref.path),'utf8'));}catch{continue;}if(plan?.schema==='aidlc.admission-plan/v1'&&plan.native_host_ref)checked.push(inspectExecutionWindow(root,ref.path,request));}return checked;
}
