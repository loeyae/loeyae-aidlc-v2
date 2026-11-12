/** Fixed HOLD/Go bootstrap: do not import pilot state, Core or launchers before the gate. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectIntegrationReview} from './integration-review-gate.mjs';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const args=process.argv.slice(2);
if(args.some(s=>s.startsWith('--')?!['--check','--retry-unstarted'].includes(s):!/^(orders|publish)-r(?:[3-9]|[1-9][0-9]+)$/.test(s))){
  console.error('PILOT_ENTRY_ARGUMENT_DENIED');process.exitCode=2;
}else{
  const gate=inspectIntegrationReview(repository);
  if(gate.decision!=='GO'){
    console.log(JSON.stringify({kind:'pilot-entry-check',integration_review:gate,ready_for_actual_terminal_review:false,execution_authorized:false,business_verified:false,pilots:[]}));
    if(!args.includes('--check'))process.exitCode=2;
  }else await import('./operator-runner');
}
