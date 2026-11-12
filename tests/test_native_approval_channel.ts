/** Authenticated-event protocol fixture only; no real user or host approval. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";import { tmpdir } from "node:os";import { join } from "node:path";
import { createAdmissionFixture } from "./helpers/autonomy-admission-fixture";
import { prepareExecutionGrant, issueExecutionGrant } from "../core/tools/aidlc-execution-grant";
import { captureNativeOperatorApproval, readIssuedGrant, storeIssuedGrant, withGrantControl, type NativeApprovalChannel } from "../core/tools/aidlc-grant-store";
const root=mkdtempSync(join(tmpdir(),"aidlc-native-approval-")),env={...process.env};
try {
 const f=createAdmissionFixture(root,"approval"),payload=prepareExecutionGrant(f.root,f.request);
 const channel: NativeApprovalChannel={inspect:()=>({host:payload.executor_constraints.host,user_channel_verified:true}),async request(p){return {origin:"user",event_id:"fixture-user-event",actor:"fixture-only-user",nonce:p.nonce,request_digest:p.request_digest,response:p.challenge};}};
 await assert.rejects(captureNativeOperatorApproval(f.root,payload,{...channel,inspect:()=>({host:{},user_channel_verified:true})}),/HostRef/);
 for(const patch of [{origin:"model"},{nonce:"old"},{request_digest:"b".repeat(64)},{response:"Approve"},{actor:""}])await assert.rejects(captureNativeOperatorApproval(f.root,payload,{...channel,async request(p,s){return {...await channel.request(p,s),...patch} as any;}}),/authenticated user event/);
 let reads=0;await assert.rejects(captureNativeOperatorApproval(f.root,payload,{...channel,inspect:()=>({host:++reads===1?payload.executor_constraints.host:{},user_channel_verified:true})}),/HostRef/);
 await assert.rejects(captureNativeOperatorApproval(f.root,{...payload,expires_at:new Date(Date.now()-1).toISOString()},channel),/expired/);
 withGrantControl(f.root,()=>assert.throws(()=>storeIssuedGrant(f.root,payload,{} as any),/trusted host approval/),true,true);
 const token=await captureNativeOperatorApproval(f.root,payload,channel),ref=issueExecutionGrant(f.root,payload,token),grant=readIssuedGrant(f.root,ref).grant;
 assert.match(String(grant.authority_ref.source_locator),/^native-host:unit-test-fixture-adapter:fixture-user-event$/);assert.equal(grant.expires_at,payload.expires_at);
 withGrantControl(f.root,()=>assert.throws(()=>storeIssuedGrant(f.root,payload,token),/trusted host approval/),true);
 console.log("PASS native UI adapter contract: exact user event, nonce, request digest, HostRef/config, deadline, opaque one-use token; fixture only");
} finally {for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);rmSync(root,{recursive:true,force:true});}
