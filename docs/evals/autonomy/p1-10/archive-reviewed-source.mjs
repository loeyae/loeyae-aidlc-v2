// Immutable public tool bytes before genuine H5; never archives private controls.
import fs from 'node:fs';import p from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const evaluation=import.meta.dirname,repo=p.resolve(evaluation,'../../../..'),round=process.argv[2];assert.match(round,/^engineering-[0-9]+$/);
const result=JSON.parse(fs.readFileSync(p.join(evaluation,round,'results.json'))),stable=JSON.parse(fs.readFileSync(p.join(evaluation,round,'source-stability.json')));
assert.equal(result.results.length,40);assert.ok(result.results.every(r=>r.reconciled&&r.status==='succeeded'&&r.exit_code===0));assert.equal(stable.unchanged,true);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(sha(JSON.stringify(result.source_snapshot)),stable.source_snapshot_sha256);
assert.equal(stable.verification_inputs_unchanged,true);assert.equal(sha(JSON.stringify(result.verification_input_snapshot)),stable.verification_inputs_sha256);
for(const [name,digest]of Object.entries(result.verification_input_snapshot))assert.equal(sha(fs.readFileSync(p.join(repo,name))),digest,name);
const output=p.join(evaluation,'h5-tool-source-'+round.slice('engineering-'.length));assert.ok(!fs.existsSync(output));
const files=[];for(const [name,digest]of Object.entries(result.source_snapshot)){
 assert.match(name,/^(core|bin|harness\/codex\/runtime)\//);assert.ok(!name.split('/').includes('..'));assert.equal(fs.lstatSync(p.join(repo,name)).isSymbolicLink(),false);
 const bytes=fs.readFileSync(p.join(repo,name));assert.equal(sha(bytes),digest,name);files.push({path:name,sha256:digest,bytes:bytes.length});
}
fs.mkdirSync(output);for(const file of files){const target=p.join(output,file.path);fs.mkdirSync(p.dirname(target),{recursive:true});fs.writeFileSync(target,fs.readFileSync(p.join(repo,file.path)),{flag:'wx'});assert.equal(sha(fs.readFileSync(target)),file.sha256);}
fs.writeFileSync(p.join(output,'manifest.json'),JSON.stringify({kind:'reviewed-tool-source-before-new-H5',at:new Date().toISOString(),engineering_round:round,source_snapshot_sha256:stable.source_snapshot_sha256,files,grant_issued_at_capture:false,business_verified:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,files:files.length,source_snapshot_sha256:stable.source_snapshot_sha256,business_verified:false}));
