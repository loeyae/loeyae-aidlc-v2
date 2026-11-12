/** P1-10 engineering entry gate. Read-only; never an execution grant or workflow gate. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const prefix='docs/evals/autonomy/p1-10',statusPath=prefix+'/integration-audit-2026-11-10/review-status.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
function localFile(root,name){
  if(typeof name!=='string'||!name||path.isAbsolute(name)||path.win32.isAbsolute(name)||/[\\:\x00-\x1f]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'||/[ .]$/.test(p)||['.git','.aidlc','aidlc'].includes(p.toLowerCase())))fail('unsafe-reference');
  let target=fs.realpathSync(root);
  for(const part of name.split('/')){target=path.join(target,part);const s=fs.lstatSync(target);if(s.isSymbolicLink()||s.isFile()&&s.nlink!==1)fail('linked-reference');}
  const stat=fs.statSync(target);if(!stat.isFile()||stat.size>32*1024*1024)fail('reference-limit');return target;
}
function jsonFile(root,name){return JSON.parse(fs.readFileSync(localFile(root,name),'utf8'));}
function readRef(root,ref,json=true){
  if(!ref||Object.keys(ref).sort().join(',')!=='digest,path'||!ref.path?.startsWith(prefix+'/')||!/^[a-f0-9]{64}$/.test(ref.digest))fail('invalid-reference');
  const bytes=fs.readFileSync(localFile(root,ref.path));if(hash(bytes)!==ref.digest)fail('evidence-digest-changed');return json?JSON.parse(bytes):bytes;
}
export function reviewSourceDigest(files){return hash(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))));}
/** Full snapshot remains provenance. Only non-executable repository notes and
 * regression sources are independent of the already reviewed runtime. Normative
 * Core rules, contracts, build/config and pilot acceptance assets stay operative.
 * Unknown paths fail conservatively into the execution dependency set. */
export function reviewSourceImpact(before,after){
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]).sort();
  const verification=changed.filter(p=>p.startsWith('tests/'));
  const documentation=changed.filter(p=>p==='README.md');
  const execution=changed.filter(p=>!verification.includes(p)&&!documentation.includes(p));
  return {changed,execution,verification,documentation,execution_evidence_reusable:execution.length===0,current_verification_sources_validated:verification.length===0,required_checks:execution.length?['affected-runtime-and-integration']:verification.length?['changed-regression-tests']:[],execution_authorized:false};
}
export function currentReviewSources(root){
  const files={};
  const visit=name=>{const target=path.join(root,name),stat=fs.lstatSync(target);if(stat.isSymbolicLink())fail('linked-source');if(stat.isDirectory()){for(const entry of fs.readdirSync(target).sort())visit(name+'/'+entry);}else if(stat.isFile()){files[name]=hash(fs.readFileSync(localFile(root,name)));}};
  for(const name of ['core','bin','harness','tests'])visit(name);
  for(const name of fs.readdirSync(path.join(root,prefix)).sort())if(/\.(?:ts|mjs|cjs|ps1)$/.test(name)||name==='tsconfig.supervision.json')visit(prefix+'/'+name);
  for(const name of ['scripts','package.json','package-lock.json','tsconfig.json','README.md','docs/aidlc-autonomous-implementation-design.md','docs/aidlc-autonomous-contracts-v1.md','docs/aidlc-autonomous-p1-10-integration-review.md'])if(fs.existsSync(path.join(root,name)))visit(name);
  for(const name of ['operator-pilots.ts','operator-runner.ts','integration-review-gate.mjs','pilot-worker.ts','operator-prestart.ts','prepare-pilots.ts','pilot-assets.mjs'])if(!Object.hasOwn(files,prefix+'/'+name))fail('source-incomplete');
  return files;
}
const empty=value=>Array.isArray(value)&&value.length===0;
export function inspectIntegrationReview(root){
  const result={schema:'aidlc.integration-entry/v1',decision:'HOLD',reason:'review-unavailable',execution_authorized:false,business_verified:false};
  try{
    const s=jsonFile(root,statusPath);
    if(s.schema!=='aidlc.integration-review/v1'||s.scope!=='P1-10 real pilot execution')fail('review-invalid');
    if(s.decision!=='GO')fail(s.decision==='HOLD_PENDING_OPTIMIZATION'?'optimization-incomplete':'review-not-go');
    if(s.review_complete!==true||s.optimization_complete!==true||s.real_trials_permitted!==true||!empty(s.open_reproduced)||!empty(s.source_confirmed_pending_integration))fail('review-incomplete');
    const manifest=readRef(root,s.go?.manifest_ref),confirmation=readRef(root,s.go?.confirmation_ref);
    if(manifest.schema!=='aidlc.integration-go/v1')fail('manifest-invalid');
    const source=readRef(root,manifest.source_ref),validation=readRef(root,manifest.validation_ref),efficiency=readRef(root,manifest.efficiency_ref);
    const files=currentReviewSources(root),sourceDigest=reviewSourceDigest(files);
    if(source.schema!=='aidlc.integration-source/v1'||!source.files)fail('source-changed');
    const impact=reviewSourceImpact(source.files,files),validatedDigest=reviewSourceDigest(source.files);
    if(!impact.execution_evidence_reusable)fail('source-changed');
    if(validation.schema!=='aidlc.integration-validation/v1'||validation.source_snapshot_digest!==validatedDigest||!empty(validation.open_findings)||!Array.isArray(validation.levels))fail('validation-incomplete');
    for(const level of ['L0','L1','L2','distribution']){
      const rows=validation.levels.filter(r=>r.level===level);if(rows.length!==1||rows[0].status!=='passed'||!rows[0].evidence_refs?.length)fail('validation-incomplete');
      for(const ref of rows[0].evidence_refs)readRef(root,ref,false);
    }
    if(efficiency.schema!=='aidlc.integration-efficiency/v1'||efficiency.source_snapshot_digest!==validatedDigest||efficiency.status!=='passed'||!efficiency.metrics?.length||!efficiency.evidence_refs?.length||efficiency.metrics.some(m=>typeof m.name!=='string'||!m.name||!Number.isFinite(m.actual_ms)||m.actual_ms<0||!Number.isFinite(m.budget_ms)||m.budget_ms<=0||m.actual_ms>m.budget_ms))fail('efficiency-incomplete');
    for(const ref of efficiency.evidence_refs)readRef(root,ref,false);
    const at=Date.parse(confirmation.confirmed_at);
    if(confirmation.schema!=='aidlc.integration-confirmation/v1'||confirmation.kind!=='actual-host-user-message'||confirmation.confirmed!==true||!Number.isFinite(at)||at>Date.now()||typeof confirmation.message_ref!=='string'||!confirmation.message_ref.trim()||confirmation.go_manifest_digest!==s.go.manifest_ref.digest||confirmation.execution_grant!==false)fail('confirmation-incomplete');
    return {...result,decision:'GO',reason:'source-bound-review-confirmed',source_snapshot_digest:sourceDigest,validated_source_snapshot_digest:validatedDigest,source_impact:impact};
  }catch(error){return {...result,reason:/^[a-z-]+$/.test(error.message)?error.message:'review-unavailable'};}
}
export function requireIntegrationGo(root){const result=inspectIntegrationReview(root);if(result.decision!=='GO')throw Error('INTEGRATION_REVIEW_HOLD: '+result.reason);return result;}
