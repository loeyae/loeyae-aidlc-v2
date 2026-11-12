import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdmissionFixture } from "./helpers/autonomy-admission-fixture";
import { nativeToolChannelContext } from "../core/tools/aidlc-native-tool-channel";
const root=mkdtempSync(join(tmpdir(),"aidlc-channel-qualification-")),env={...process.env};
try {
 const f=createAdmissionFixture(root,"channel");await f.issue();
 const actual={host:f.request.host,configuration_digest:"a".repeat(64)};
 assert.throws(()=>nativeToolChannelContext(f.root,actual),/UNQUALIFIED/);
 // Signed engineering receipt tests Core boundaries; it is not a real host qualification.
 const observe=(challenge:any)=>{const o=f.adapter.observe(challenge);return {...o,configuration_digest:actual.configuration_digest};};
 assert.equal(f.run({observe}).admission_result,"ready");assert.throws(()=>nativeToolChannelContext(f.root,actual),/UNQUALIFIED/);
 assert.equal(f.run({observe(c){const o=observe(c),ref=Object.values(o.capabilities)[0].probe_refs;for(const k of ["mandatory-tool-replacement","unknown-tool-denial","resource-reconciliation"])o.capabilities[k]={status:"supported",probe_refs:ref};return o;}}).admission_result,"ready");
 assert.equal(nativeToolChannelContext(f.root,actual).mode,"native-replacement");
 assert.throws(()=>nativeToolChannelContext(f.root,{...actual,configuration_digest:"b".repeat(64)}),/UNQUALIFIED/);
 assert.throws(()=>nativeToolChannelContext(f.root,{...actual,host:{...actual.host,version:"different"}}),/UNQUALIFIED/);
 await f.revoke();assert.throws(()=>nativeToolChannelContext(f.root,actual),/revoked|INACTIVE|grant/i);
 console.log("PASS signed capability requirements, exact HostRef/config and revocation; fixture evidence only");
} finally {for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);rmSync(root,{recursive:true,force:true});}
