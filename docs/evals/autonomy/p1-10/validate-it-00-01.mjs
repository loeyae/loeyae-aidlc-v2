/** Bounded local engineering checks only: no pilot creation, model, browser or H5. */
import fs from 'node:fs';import path from 'node:path';import K from '../../../../harness/codex/runtime/host-kernel.cjs';import {createHash} from 'node:crypto';import {currentReviewSources,reviewSourceDigest} from './integration-review-gate.mjs';
const root=path.resolve(import.meta.dirname,'../../../..'),output=path.join(import.meta.dirname,'it-00-01-'+Date.now());fs.mkdirSync(output);
const names=process.argv.slice(2),defaults=['native_action_policy.mjs','integration_review_gate.mjs','integration_review_entry.ts','native_host_driver.ts','native_host_pre_c8.ts','native_host_admission_barriers.ts','native_host_window.ts','native_host_phase_transport.ts','native_host_readiness.ts','native_host_completion.ts','native_host_retries.ts','native_host.ts','native_host_lifecycle.ts','native_host_delegated_scope.ts','autonomous_rules.ts','operator_worker.ts','operator_prestart.ts'];
const tests=(names.length?names:defaults).map(n=>'tests/test_'+n);if(tests.some(p=>!/^tests\/test_[a-z0-9_]+\.(?:ts|mjs)$/.test(p)||!fs.existsSync(path.join(root,p))))throw Error('UNKNOWN_LOCAL_TEST');
const source=currentReviewSources(root),results=[];let index=0;
const worker=async()=>{while(index<tests.length){
  const file=tests[index++],start=Date.now(),args=file.endsWith('.mjs')?['--test',file]:['--import','tsx',file],log=path.basename(file)+'.log';
  const r=await K.command([process.execPath,...args],{cwd:root,env:{...K.businessEnv(process.env),AIDLC_EVAL_DIR:path.join(output,'case-'+path.basename(file))},timeout_ms:180000});
  fs.writeFileSync(path.join(output,log),r.stdout+'\n'+r.stderr,{flag:'wx'});
  const row={file,exit_code:r.exit_code,status:r.status,reconciled:r.reconciled,duration_ms:Date.now()-start,timeout:r.status==='timeout',log,log_sha256:createHash('sha256').update(fs.readFileSync(path.join(output,log))).digest('hex')};results.push(row);console.log(JSON.stringify(row));
}};
await Promise.all([worker(),worker()]);
const unchanged=reviewSourceDigest(source)===reviewSourceDigest(currentReviewSources(root));
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({kind:'it-00-01-local-engineering',source_snapshot_digest:reviewSourceDigest(source),source_snapshot:source,source_unchanged:unchanged,results,real_trials_started:0,pilots_created:0,grants_issued:0,business_verified:false,p2_recovery_implemented:false},null,2)+'\n');
console.log(JSON.stringify({output,passed:results.filter(r=>r.exit_code===0&&r.reconciled&&r.status==='succeeded').length,total:results.length,source_unchanged:unchanged}));if(!unchanged||results.some(r=>r.exit_code!==0||!r.reconciled||r.status!=='succeeded'))process.exitCode=1;
