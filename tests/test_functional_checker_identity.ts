import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
const root=fs.mkdtempSync(join(tmpdir(),"aidlc-functional-identity-"));
try {
 fs.cpSync(resolve("core/tools"),join(root,"core/tools"),{recursive:true});fs.copyFileSync(resolve("package.json"),join(root,"package.json"));fs.symlinkSync(resolve("node_modules"),join(root,"node_modules"),"junction");
 const {semanticCheckerDigest}=await import(pathToFileURL(join(root,"core/tools/aidlc-checker-identity.ts")).href);
 const collect=(sensor?:string)=>{const original=fs.readFileSync,files=new Set<string>();let bytes=0;fs.readFileSync=((...args:any[])=>{const result=(original as any)(...args);files.add(String(args[0]));bytes+=Buffer.byteLength(result);return result;}) as any;syncBuiltinESMExports();const start=performance.now();try {const digest=semanticCheckerDigest(true,sensor);return {digest,files:files.size,bytes,duration_ms:performance.now()-start};}finally{fs.readFileSync=original;syncBuiltinESMExports();}};
 const broad=collect(),local=collect("functional-design-completeness");assert.ok(local.files<broad.files);assert.ok(local.bytes<broad.bytes);
 fs.appendFileSync(join(root,"core/tools/aidlc-native-host.ts"),"\n// unrelated worker/control change\n");assert.equal(semanticCheckerDigest(true,"functional-design-completeness"),local.digest);
 fs.appendFileSync(join(root,"core/tools/aidlc-functional-design-inputs.ts"),"\n// actual checker implementation changes\n");assert.notEqual(semanticCheckerDigest(true,"functional-design-completeness"),local.digest);
 fs.appendFileSync(join(root,"core/tools/aidlc-functional-design-inputs.ts"),'\nimport "./aidlc-native-host";\n');assert.throws(()=>semanticCheckerDigest(true,"functional-design-completeness"),/undeclared checker dependency/);
 console.log(JSON.stringify({phase:"checker-identity",broad,local,real_business_run:false}));
 console.log("PASS actual independent closure, unrelated control change stable, relevant change invalidated, undeclared dependency refused");
} finally {fs.rmSync(root,{recursive:true,force:true});}
