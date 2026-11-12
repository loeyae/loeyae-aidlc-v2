/** Scripted RPC counterpart. No filesystem, shell, Core API or credential access.
 * Derives proposals from public prompts/tool results; production host owns scheduling. */
function scriptedNative() {
  const readline = require('node:readline');
  const pending = new Map(); let serial = 10000, turn = 0;
  const thread = 'test-session', send = value => process.stdout.write(JSON.stringify(value) + '\n');
  const call = action => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, {resolve, reject});
    send({id, method:'item/tool/call', params:{threadId:thread,tool:'aidlc_action',arguments:action}});
  });
  const core = args => call({action:'core',args});
  async function execute(text) {
    const data = JSON.parse(text.slice(text.lastIndexOf('\n') + 1));
    if (text.startsWith('Complete only the planned delegated decisions')) {
      // Exercise a critical denial on the actual metadata wire, then continue lawfully.
      try { await call({action:'write',operation:'code-write',path:'src/forbidden.cjs',content:'forbidden'}); throw Error('Metadata code write was allowed'); }
      catch (error) { if (!String(error).includes('HOST_FINALIZATION_ONLY')) throw error; }
      if (!data.write_contract?.template_only || !data.write_contract.updates?.length) throw Error('Missing public proposal contract');
      for (const update of data.write_contract.updates) {
        const proposal = {...update.proposal, implementation_refs:[]};
        for (const file of ['src/orders.cjs','tests/orders-native.cjs']) {
          const input = await call({action:'read',path:file});
          proposal.implementation_refs.push({repository_id:'project',path:file,digest_mode:'raw-file',digest:input.sha256});
        }
        for (const ref of proposal.validation_refs) {
          const raw = await call({action:'read',path:ref.path});
          if (raw.sha256 !== ref.digest) throw Error('Public validation reference mismatch');
        }
        const handoff = await call({action:'read',path:'docs/aidlc/handoff.md'});
        await call({action:'write',operation:'design-write',path:update.proposal_path,content:JSON.stringify(proposal,null,2)+'\n'});
        const recorded = await core(['orchestrate','autonomy','record','--input',update.proposal_path,'--expect',handoff.sha256]);
        if (recorded.autonomy_decisions?.completion_blockers?.length) throw Error('Decision remained incomplete');
      }
    } else {
      if (data.kind !== 'run-stage' || data.stage !== 'build-and-test' || data.stage_instance !== 'build-and-test') throw Error('Unexpected formal stage');
      await core(['evidence','run','--stage',data.stage,'--all-sensors']);
      await core(['orchestrate','report','--stage',data.stage,'--result','completed','--instruction-ack',data.stage]);
    }
  }
  readline.createInterface({input:process.stdin}).on('line', line => {
    const message = JSON.parse(line);
    if (message.id !== undefined && !message.method) {
      const p = pending.get(message.id); if (!p) return; pending.delete(message.id);
      if (message.result?.success === true) p.resolve(JSON.parse(message.result.contentItems[0].text));
      else p.reject(Error(message.error?.message || message.result?.contentItems?.[0]?.text || 'RPC tool rejected'));
      return;
    }
    if (message.method === 'initialize') return send({id:message.id,result:{userAgent:'IT07 scripted engineering RPC; no model'}});
    if (message.method === 'config/read') return send({id:message.id,result:{config:{}}});
    if (message.method === 'initialized') return;
    if (['thread/start','thread/resume'].includes(message.method)) return send({id:message.id,result:{thread:{id:thread}}});
    if (message.method === 'turn/interrupt') { send({id:message.id,result:{}}); return send({method:'turn/completed',params:{threadId:thread,turn:{id:'turn-'+turn,status:'interrupted'}}}); }
    if (message.method === 'turn/start') {
      const id = 'turn-'+(++turn); send({id:message.id,result:{turn:{id}}});
      setImmediate(() => execute(message.params.input[0].text).then(() => send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'completed'}}})).catch(error => {process.stderr.write(String(error)+'\n');send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'failed'}}});}));
    }
  });
}
function engineeringWorkerEntry(moduleUrl, repository, evaluation) {
  // The production launcher adds --worker. Remove it before importing the CLI module,
  // whose real entry must otherwise enforce HOLD before any library override runs.
  return `process.argv=process.argv.filter(a=>a!=='--worker');const {workerMain}=await import(${JSON.stringify(moduleUrl)});await workerMain({repository:${JSON.stringify(repository)},evaluation:${JSON.stringify(evaluation)},requireGo:()=>{}});`;
}
function workerServiceSource(source) {
  if (!source.includes('console.log(server.address().port)') || !source.includes('server.listen(0,')) throw Error('Unknown engineering service template');
  return source.replace('console.log(server.address().port)','console.log(JSON.stringify({port:server.address().port,candidate_commit:commit}))').replace('server.listen(0,','server.listen(Number(process.env.PILOT_PORT||0),');
}
function engineeringHostConfiguration({rpc, core, browser, node, nativeDigest}) {
  return {schema:'aidlc.codex-host/v1',codex_entrypoint:rpc,core_cli:core,native_config_digest:nativeDigest,browser_entrypoint:browser,admission_plan:'fixtures/admission-plan.json',observation_plan:'fixtures/observation-plan.json',candidate_command:'candidate',commands:[{id:'candidate',operation:'candidate-commit',argv:[node,'pilot/candidate.cjs'],timeout_ms:30000,input_paths:['pilot/candidate.cjs','src/orders.cjs','src/server.cjs','tests/orders-native.cjs','docs/aidlc/handoff.md','delivery/candidate.txt'],write_paths:[{path:'.runtime',operation:'environment-write'}]}]};
}
module.exports = {scriptedNativeSource:'('+scriptedNative.toString()+')();\n',engineeringWorkerEntry,workerServiceSource,engineeringHostConfiguration};
