// Byte-preserving public archive after an actual native run ends; private authority stays in place.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import cp from 'node:child_process';
const key=process.argv[2];if(!['orders-r4','orders-r5','orders-r6','orders-r7','orders-r8','orders-r9','publish-r7','publish-r8','publish-r9','publish-r10','publish-r11','publish-r12','publish-r13','orders-r10','publish-r14'].includes(key))throw Error('Explicit current pilot required');
const interrupted=process.argv[3]==='--interrupted';if(interrupted&&key!=='publish-r13')throw Error('Only the observed publisher host loss supports this archive mode');
const evaluation=import.meta.dirname,repo=path.resolve(evaluation,'../../../..'),dir=path.join(evaluation,key),root=JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'))).root,request=JSON.parse(fs.readFileSync(path.join(root,'pilot/grant-request.json'))),run=request.run_id;
const host=path.join(root,'.aidlc/host-runs',run),operator=fs.readdirSync(dir).filter(n=>n.startsWith('operator-'+run+'-')).sort().at(-1);
const exit=fs.existsSync(path.join(host,'exit.json'))?JSON.parse(fs.readFileSync(path.join(host,'exit.json'))):null,controller=fs.existsSync(path.join(dir,operator,'result.json'))?JSON.parse(fs.readFileSync(path.join(dir,operator,'result.json'))):null;
const verified=exit?.business_verified===true,engineeringResult=exit?.engineering_result??'unresolved-interruption';let interruption;
if(interrupted){
 if(exit||controller)throw Error('A real exit/controller must retain its normal semantics');
 const label=process.argv[4];if(!/^interruption-investigation-[0-9]+$/.test(label))throw Error('Explicit actual interruption investigation required');
 const bytes=fs.readFileSync(path.join(dir,label,'result.json')),proof=JSON.parse(bytes);if(proof.run_id!==run||proof.normal_exit_record_present!==false||proof.claims_reconciled!==false||proof.business_verified!==false||proof.live_aidlc_hosts.length||!proof.services.every(s=>s.status==='ECONNREFUSED'))throw Error('Interruption proof is insufficient');
 const digest=b=>crypto.createHash('sha256').update(b).digest('hex');if(digest(fs.readFileSync(path.join(host,'native-events.jsonl')))!==proof.original_native_events_sha256||digest(fs.readFileSync(path.join(host,'operations.jsonl')))!==proof.original_operations_sha256)throw Error('Host logs changed after interruption observation');
 interruption={directory:label,sha256:digest(bytes),proof};
}else{
 if(!exit||!controller||exit.business_verified!==controller.business_verified)throw Error('Actual exit/controller mismatch or missing');
 if(verified&&engineeringResult!=='verified')throw Error('No actual verified result');
}
// Complete process-dependent reads before creating an exclusive raw archive.
const git=args=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),headCommit=git(['rev-parse','HEAD']),gitStatus=git(['status','--porcelain']);
const output=path.join(dir,interrupted?'interrupted-run':'actual-run');if(fs.existsSync(output))throw Error('Never overwrite raw evidence');fs.mkdirSync(output);
const files=[],protectedOriginals=[],sha=b=>crypto.createHash('sha256').update(b).digest('hex'),privateFields=new Set(['binding','initial_binding','session_binding','coordinator_binding','generation','private_key']);
function scan(value){if(Array.isArray(value))return value.forEach(scan);if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(privateFields.has(k))throw Error('private-field:'+k);scan(v);}}
function copy(from,label){const stat=fs.lstatSync(from);if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1)throw Error('Linked/non-file source');const bytes=fs.readFileSync(from),original=path.relative(root,from).replaceAll('\\','/');
 try{if(label.endsWith('.json'))scan(JSON.parse(bytes));if(label.endsWith('.jsonl'))for(const line of bytes.toString().split(/\r?\n/).filter(Boolean))scan(JSON.parse(line));}catch(e){protectedOriginals.push({original_path:original,sha256:sha(bytes),reason:String(e),raw_original_retained:true});return;}
 const target=path.join(output,label);if(path.relative(output,target).startsWith('..'))throw Error('Archive escape');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});files.push({original_path:original,saved_path:label,sha256:sha(bytes),bytes:bytes.length});}
function walk(from,label){if(!fs.existsSync(from))return;for(const entry of fs.readdirSync(from,{withFileTypes:true})){const file=path.join(from,entry.name),saved=label+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Linked archive directory');if(entry.isDirectory())walk(file,saved);else copy(file,saved);}}
walk(host,'host');walk(path.join(dir,operator),'operator/'+operator);
if(interruption)walk(path.join(dir,interruption.directory),'interruption-investigation');
for(const label of ['.aidlc/evidence','.aidlc/commands','pilot','design','src','tests','delivery','docs/aidlc','.runtime/native-ui'])walk(path.join(root,label),label);
for(const name of fs.readdirSync(path.join(root,'.runtime')).filter(n=>/^h5-request-[a-f0-9]{64}(?:-[0-9]+)?\.json$|^reload-(request|ack)\.json$/.test(n)))copy(path.join(root,'.runtime',name),'.runtime/'+name);
for(const label of ['README.md','.gitignore'])copy(path.join(root,label),label);
const issuer=JSON.parse(fs.readFileSync(path.join(root,'.git/aidlc/autonomy/issuer.json')));fs.writeFileSync(path.join(output,'issuer-public.json'),JSON.stringify({key_id:issuer.key_id,public_key:issuer.public_key},null,2)+'\n',{flag:'wx'});
const events=fs.readFileSync(path.join(dir,operator,'controller.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse),reuse=events.find(e=>e.event==='existing-real-terminal-grant-used-for-first-start');
let approval=events.find(e=>e.event==='real-terminal-grant-issued');
if(!approval&&reuse){const prior=reuse.original_approval;if(!/^operator-[a-f0-9-]{36}-[0-9]+$/.test(prior.operator_directory))throw Error('Invalid prior operator path');const original=fs.readFileSync(path.join(dir,prior.operator_directory,'controller.jsonl'));if(sha(original)!==prior.controller_sha256)throw Error('Original issuance log changed');const priorEvents=original.toString().trim().split(/\r?\n/).map(JSON.parse);approval=priorEvents.find(e=>e.event==='real-terminal-grant-issued');if(JSON.stringify(approval)!==JSON.stringify(prior.event))throw Error('Original approval provenance differs');walk(path.join(dir,prior.operator_directory),'prior-operator/'+prior.operator_directory);}
if(!approval)throw Error('Actual terminal grant event missing');
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({kind:interrupted?'actual-real-codex-interrupted-run':'actual-real-codex-ended-run',key,workflow_id:JSON.parse(fs.readFileSync(path.join(dir,'preparation.json'))).workflow_id,run_id:run,operator_approval:approval,engineering_result:engineeringResult,business_verified:verified,end_reason:exit?.end_reason??'no-exit-record-after-host-disappearance',actual_exit:exit,interruption_investigation:interruption?{directory:interruption.directory,sha256:interruption.sha256,native_final_status:'unknown',claims_reconciled:false}:null,head_commit:headCommit,git_status:gitStatus,original_root:root,files,protected_originals:protectedOriginals,protected_authority_directories_retained:['.git/aidlc/autonomy','.aidlc/autonomy/grants'],private_authority_copied:false,archived_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,files:files.length,protected_originals:protectedOriginals.length,business_verified:verified,engineering_result:engineeringResult}));
