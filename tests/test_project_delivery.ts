/** Real local consumers and HTTP checks, followed by non-authoritative completion
 * projections. This is not an end-to-end model/production CR timing benchmark. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateCompletion, type CompletionInput, type CompletionFact } from "../core/tools/aidlc-completion.js";

const project = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc-project-delivery-"));
const repo = process.cwd();
const write = (name: string, text: string) => fs.writeFileSync(path.join(project, name), text);
const met = (id: string, evidence: string): CompletionFact => ({ id, status: "met", evidence });
function check(name: string, expected: number): CompletionFact {
  const result = spawnSync(process.execPath, [name], { cwd: project, encoding: "utf8", windowsHide: true, timeout: 20000 });
  write(`${name}.log`, `node ${name}\nexit=${result.status}\n${result.stdout}${result.stderr}`);
  assert.equal(result.status, expected, result.stderr);
  return { id: name, status: result.status === 0 ? "met" : "unmet", evidence: `${name}.log` };
}
try {
  write("requirements.md", "Cart quantities must be positive integers; inventory may be zero. Only authorized users may order; reject unavailable stock. Verify both consumers and the HTTP order flow.\n");
  write("shared.cjs", "module.exports = n => Number.isInteger(n) && n > 0;\n");
  write("cart.cjs", "const valid=require('./shared.cjs'); module.exports=(role,n)=>{if(role!=='buyer')throw Error('forbidden');if(!valid(n))throw Error('quantity');return n;};\n");
  write("inventory.cjs", "const valid=require('./shared.cjs'); module.exports=n=>{if(!valid(n,{allowZero:true}))throw Error('stock');return n;};\n");
  write("cart.test.cjs", "const a=require('node:assert/strict'),cart=require('./cart.cjs');a.equal(cart('buyer',1),1);for(const n of [0,-1,1.5,NaN,Infinity])a.throws(()=>cart('buyer',n),/quantity/);a.throws(()=>cart('guest',1),/forbidden/);\n");
  write("inventory.test.cjs", "const a=require('node:assert/strict'),stock=require('./inventory.cjs');a.equal(stock(0),0);a.equal(stock(2),2);for(const n of [-1,1.5,NaN,Infinity])a.throws(()=>stock(n),/stock/);\n");
  write("integration.test.cjs", `const a=require('node:assert/strict'),http=require('node:http'),cart=require('./cart.cjs'),stock=require('./inventory.cjs');
let available=stock(1);
const server=http.createServer((req,res)=>{try{const u=new URL(req.url,'http://localhost');const n=cart(req.headers['x-role'],Number(u.searchParams.get('quantity')));if(n>available)throw Error('unavailable');available=stock(available-n);res.end(String(available));}catch(e){res.statusCode=e.message==='forbidden'?403:400;res.end(e.message);}});
(async()=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;
try{const call=(n,role='buyer')=>fetch(base+'/?quantity='+n,{headers:{'x-role':role}});
a.equal((await call(1,'guest')).status,403);a.equal((await call(0)).status,400);
const accepted=await call(1);a.equal(accepted.status,200);a.equal(await accepted.text(),'0');a.equal((await call(1)).status,400);
}finally{await new Promise(ok=>server.close(ok));}})().catch(e=>{console.error(e);process.exitCode=1;});\n`);
  const partial: CompletionInput = {
    scope: "Local cart and inventory project acceptance", coverage: "partial",
    implementation: [met("cart", "cart.cjs")],
    verification: [check("cart.test.cjs", 0)],
    acceptance: [met("cart-fields", "cart.test.cjs.log")],
  };
  assert.equal(evaluateCompletion(partial).overall, "not_evaluated", "a passed module is not the project");
  const broken: CompletionInput = {
    ...partial, coverage: "complete", implementation: [met("cart", "cart.cjs"), met("inventory", "inventory.cjs")],
    verification: [...partial.verification, check("inventory.test.cjs", 1), { id: "HTTP-flow", status: "unknown" }],
    acceptance: [{ id: "all-agreed-behavior", status: "unknown" }],
  };
  assert.equal(evaluateCompletion(broken).overall, "incomplete", "shared changes must cover other consumers");
  write("shared.cjs", "module.exports=(n,{allowZero=false}={})=>Number.isInteger(n)&&n>=(allowZero?0:1);\n");
  const fixed: CompletionInput = {
    ...broken,
    verification: [check("cart.test.cjs", 0), check("inventory.test.cjs", 0), check("integration.test.cjs", 0)],
    acceptance: [met("cart-behavior-and-auth", "cart.test.cjs.log"), met("inventory-boundaries", "inventory.test.cjs.log"), met("local-HTTP-flow", "integration.test.cjs.log")],
  };
  assert.equal(evaluateCompletion(fixed).overall, "complete");
  for (const missing of ["security-CI", "migration-rollback", "performance-target"]) {
    assert.notEqual(evaluateCompletion({ ...fixed, verification: [...fixed.verification, { id: missing, status: "unknown" }] }).overall, "complete", `required ${missing} cannot be omitted`);
  }
  const external = { ...fixed, acceptance: [...fixed.acceptance, { id: "required-production-acceptance", status: "unknown" }] };
  assert.equal(evaluateCompletion(external).verification, "complete");
  assert.notEqual(evaluateCompletion(external).overall, "complete");
  const pendingDelivery = { ...fixed, delivery: [{ id: "authorized-deployment", status: "unknown" }], closure: [met("closeout", "requirements.md")] };
  assert.notEqual(evaluateCompletion(pendingDelivery).closure, "complete");
  assert.equal(evaluateCompletion(pendingDelivery).permissions_granted, false);
  assert.notEqual(evaluateCompletion({ ...fixed, unresolved: ["unresolved acceptance defect"] }).overall, "complete");
  assert.notEqual(evaluateCompletion({ ...fixed, verification: [{ ...fixed.verification[2], status: "stale" }] }).overall, "complete");
  write("result.json", JSON.stringify(fixed));
  const assess = () => spawnSync(process.execPath, [path.join(repo, "bin/cli.js"), "assess", "--input", "result.json"], { cwd: project, encoding: "utf8", windowsHide: true });
  const first = assess(); assert.equal(first.status, 0, first.stderr);
  const snapshots = fixed.verification.map(f => fs.readFileSync(path.join(project, f.evidence!)));
  write("delivery-note.md", "Reference the existing test logs. No implementation, acceptance or authorization change.\n");
  const second = assess(); assert.equal(second.status, 0, second.stderr); assert.equal(second.stdout, first.stdout);
  fixed.verification.forEach((f, i) => assert.deepEqual(fs.readFileSync(path.join(project, f.evidence!)), snapshots[i]));
  assert(!fs.existsSync(path.join(project, ".aidlc"))); assert(!fs.existsSync(path.join(project, "aidlc")));
  console.log("PASS project coverage: module-only success, shared-consumer failure/repair, actual HTTP authorization and stock flow, missing required checks, external acceptance, stale results, delivery/closure boundaries and read-only evidence reuse");
} finally {
  assert(path.relative(os.tmpdir(), project).startsWith("aidlc-project-delivery-"));
  fs.rmSync(project, { recursive: true, force: true });
}
