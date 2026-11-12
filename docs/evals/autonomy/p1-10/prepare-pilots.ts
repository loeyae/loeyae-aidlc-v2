/** Real isolated pilot preparation. No test fixture imports, simulated approvals or completed-row seeding. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createInitialState, saveWorkflowState } from '../../../../core/tools/aidlc-light-state';
import { observeBrowser } from '../../../../core/tools/aidlc-observation-browser';
import { requirements, referenceHtml, ordersSeed, publishSeed, webSeed, server, ordersOracle, publishOracle } from './pilot-assets.mjs';

export const repository = resolve(import.meta.dirname, '../../../..');
export const evaluation = resolve(import.meta.dirname);
export const codex = 'E:/Work/repo/node/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
export const browser = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function put(root: string, p: string, value: unknown) {
  mkdirSync(dirname(join(root,p)),{recursive:true});
  writeFileSync(join(root,p),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}
export function git(root: string, args: string[]) {
  const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
export async function startService(root: string, environment: NodeJS.ProcessEnv = process.env, options: any = {}) {
  const R=createRequire(import.meta.url)(join(repository,'core/tools/aidlc-owned-resource.cjs'));
  const limits=R.resourceLimits(options.limits),businessEnv=Object.fromEntries(Object.entries(environment).filter(([key])=>!/^AIDLC_(SESSION_BINDING|COORDINATOR_BINDING|EXECUTION_GRANT|AUTONOMY_HOST|RESOURCE_OWNER|ATTEMPT_TOKEN|OPERATION_ID)$/.test(key.toUpperCase()))),child=spawn(process.execPath,['pilot/server.cjs'],{cwd:root,env:businessEnv,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  const resource=R.ownChild(child,{kind:'service',owner:options.owner||'service-'+randomUUID(),deadline_at:options.deadline_at||null,tree:true,limits,log:options.log});
  let err='';child.stderr.on('data',b=>{err=(err+b).slice(-4000);});
  const end=R.deadlineAfter(Math.min(limits.startup_ms,options.deadline_at?Math.max(0,options.deadline_at-Date.now()):limits.startup_ms));
  let abort: (()=>void)|undefined,startupDone=false;
  try{
    options.onSpawn?.(child);
    if(options.signal?.aborted)throw Error('SERVICE_START_CANCELLED');
    const info=await R.bounded(new Promise<any>((res,rej)=>{
      let data='';child.stdout.on('data',b=>{if(startupDone)return;data+=String(b);if(data.length>4096)return rej(Error('SERVICE_START_OUTPUT_LIMIT'));if(!data.includes('\n'))return;try{res(JSON.parse(data.split('\n')[0]));}catch(e){rej(e);}finally{startupDone=true;data='';}});
      child.once('error',rej);child.once('close',()=>rej(Error('SERVICE_EXIT_BEFORE_READY')));
      abort=()=>rej(Error('SERVICE_START_CANCELLED'));options.signal?.addEventListener('abort',abort,{once:true});
    }),end,'SERVICE_START_TIMEOUT');
    if(!Number.isInteger(info.port)||info.port<1||info.port>65535)throw Error('SERVICE_PORT_INVALID');
    return {...info,child,resource,origin:'http://127.0.0.1:'+info.port};
  }catch(error){const result=await resource.close();R.assertReconciled(result,error);options.onClosed?.();throw Object.assign(Error('Pilot service start failed: '+err),{cause:error});}
  finally{startupDone=true;if(abort)options.signal?.removeEventListener('abort',abort);}
}
export async function stopService(child: ReturnType<typeof spawn>, options: any = {}) {
  const R=createRequire(import.meta.url)(join(repository,'core/tools/aidlc-owned-resource.cjs'));
  return R.assertReconciled(await R.ownedChild(child).close(options));
}

export async function prepare(name: 'orders'|'publish', key: string = name, beforeInitialize?: (root:string,workflowId:string)=>void) {
  assert.ok(new RegExp(`^${name}(?:-r(?:[2-9]|[1-9][0-9]+))?$`).test(key),'An explicit isolated preparation-round key is required');
  const root=join(repository,'.worktrees','aidlc-p1-10-'+key);
  assert.ok(!existsSync(root),'Refusing to overwrite or resume an existing pilot: '+root);
  mkdirSync(root,{recursive:true});
  const module='project',base=`docs/aidlc/modules/${module}/inception`;
  put(root,'.gitignore','/.aidlc/\n/aidlc/\n/.runtime/\n');
  put(root,'README.md',`# P1-10 ${name} internal pilot\n\nIndependent local-only project. Deliberately defective starter. Frozen acceptance lives under pilot/ and design/. Native implementation writes src/, tests/ and delivery/. This baseline is not a passed delivery.\n\nRun a candidate: node pilot/server.cjs; use its printed loopback port as PILOT_ORIGIN for node pilot/oracle.cjs.\n`);
  put(root,'pilot/spec.md',requirements[name]);
  put(root,`${base}/requirements.md`,requirements[name]);
  if(name==='orders')put(root,`${base}/user-stories.md`,'# US-001 Ordered export\n\nAs an internal order consumer, I export the complete ordered list as pages of 50. REQ-001 and AC-001 govern all boundaries, exact values, a single fetch, original failure identity and independent calls. No UI is applicable.\n');
  put(root,'pilot/server.cjs',server);
  put(root,'pilot/oracle.cjs',name==='orders'?ordersOracle:publishOracle);
  put(root,'pilot/environment.json',{isolated:true,owner:'internal-pilot',purpose:'P1-10 actual local service; not a simulated remote dependency'});
  put(root,'pilot/data.json',{counts:[0,1,49,50,51,100,101,120],page_size:50,roles:name==='publish'?['editor']:[],viewports:name==='publish'?[[800,600],[390,844]]:[]});
  put(root,'src/'+(name==='orders'?'orders.cjs':'publish.cjs'),name==='orders'?ordersSeed:publishSeed);
  if(name==='publish')put(root,'src/web.html',webSeed);
  put(root,'tests/README.md','# REQ-001 Native test ownership\n\nAgent must author RED/GREEN tests and UC-D mappings. The independent frozen oracle does not replace the Native I13/TDD gates.\n');
  put(root,'delivery/candidate.md','Unimplemented baseline. Not a delivery result.\n');
  put(root,'docs/aidlc/ideation/module-manifest.json',{schema_version:1,modules:[{module_id:module,name:name==='orders'?'Order export':'Publish page',service_id:module,paths:['src','tests']}]});
  put(root,`${base}/unit-manifest.json`,{schema_version:1,module_id:module,units:[{unit_id:'default',name:name,service_id:module,conditional_stages:[],req_refs:['REQ-001']}]});
  put(root,'pilot/prework.md',`# H1-H3 preparation boundary\n\nRead pilot/spec.md as the already selected internal trial scope. Existing architecture is a single local Node service with the frozen transport in pilot/server.cjs and existing exported implementation in src/. Keep that architecture; no new public API, module, service or data model is needed. Use one cohesive project/default unit: API/UI share one service owner and are verified together, so splitting this tiny pilot would add a delivery boundary without independent ownership. This explicitly refines P0's illustrative publish-api/publish-page split. No cross-project dependency is invented.\n\n${name==='publish'?'Use the frozen independent design HTML/PNG, HTML Mock route, and full native page-plan/Mock reception/alignment gates. The production starter is intentionally visually wrong.':'The scope is express: a bounded existing exported function fix with no UI. Use project/default, matching express routing.'}\n\nThe preparatory Agent may author and validate design/reception documents through normal Core next/report/producers. It must stop at a real approval block or before implementation. It must never seed completed state, approve stages, fabricate operator messages or change src/, tests/, pilot/ or design/. After H3, freeze scope/policy/matrix/preflight and obtain the exact real operator H5 grant; only then run the actual native implementation adapter.\n`);
  if(name==='publish'){
    for(const state of ['ready','draft','published','error'])for(const viewport of [{width:800,height:600},{width:390,height:844}]){
      const p=`design/${state}-${viewport.width}.html`;put(root,p,referenceHtml(state));
      const raw=await observeBrowser(browser,pathToFileURL(join(root,p)).href,{viewport,initial_expectations:[{selector:'h1',property:'text',expected:'Publish item'}],steps:[],expectations:[{selector:'body',property:'attribute',name:'data-state',expected:state}]});
      assert.equal(raw.passed,true);put(root,p.replace('.html','.png'),raw.image);
      const {image,...observation}=raw;put(root,p.replace('.html','.observation.json'),{kind:'independent-design-reference',baseline_not_candidate:true,...observation,image_digest:hash(image)});
    }
  }
  put(root,'pilot/host-seed.json',{schema:'aidlc.codex-host/v1',codex_entrypoint:codex,core_cli:join(repository,'bin/cli.ts'),commands:[{id:'frozen-oracle',argv:[process.execPath,'pilot/oracle.cjs'],operation:'validation-execute',timeout_ms:10000,input_paths:['pilot/oracle.cjs'],write_paths:[]}],...(name==='publish'?{browser_entrypoint:browser}:{})});
  const workflowId=randomUUID();beforeInitialize?.(root,workflowId);
  git(root,['init','-q','-b','codex/p1-10-'+name]);git(root,['add','.']);
  git(root,['-c','user.name=AI-DLC Internal Pilot','-c','user.email=aidlc-pilot@example.invalid','commit','-qm','Frozen independent pilot inputs and defective baseline']);
  const state=createInitialState(name==='orders'?'express':'feature',undefined,workflowId,[],`P1-10 real Codex ${name}: ${requirements[name]}`);
  saveWorkflowState(root,state);
  const actual=await startService(root);
  try{
    const r=spawnSync(process.execPath,['pilot/oracle.cjs'],{cwd:root,env:{...process.env,PILOT_ORIGIN:actual.origin},encoding:'utf8',timeout:10000,windowsHide:true});
    put(evaluation,`${key}/baseline-oracle.json`,{kind:'actual-defective-baseline',workflow_id:state.workflow_id,commit:actual.candidate_commit,argv:[process.execPath,'pilot/oracle.cjs'],exit_code:r.status,stdout:r.stdout,stderr:r.stderr,signal:r.signal,error:r.error?.message??null,business_verified:false});
    assert.equal(r.status,1,'Defective starter must fail the frozen real oracle');
  }finally{await stopService(actual.child);}
  const manifest={schema:'aidlc.pilot-preparation/v1',name,root,workflow_id:state.workflow_id,baseline_commit:git(root,['rev-parse','HEAD']),scope:state.scope,module_id:module,unit_id:'default',created_at:new Date().toISOString(),native_h3_completed:false,operator_grant_issued:false,business_verified:false,inputs:Object.fromEntries(git(root,['ls-files']).split(/\r?\n/).map(p=>[p,hash(readFileSync(join(root,p)))]))};
  put(evaluation,`${key}/preparation.json`,manifest);
  return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  for(const k of ['AIDLC_SESSION_BINDING','AIDLC_EXECUTION_GRANT','AIDLC_AUTONOMY_HOST','AIDLC_COORDINATOR_BINDING'])delete process.env[k];
  const names=process.argv[2]?[process.argv[2]]:['orders','publish'];
  for(const name of names){assert.ok(name==='orders'||name==='publish');const m=await prepare(name,process.argv[3]||name);console.log(JSON.stringify({name,root:m.root,workflow_id:m.workflow_id,business_verified:false}));}
}
