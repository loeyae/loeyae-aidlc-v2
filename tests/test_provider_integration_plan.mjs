import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadIntegrationProviders } from "../scripts/provider-integration-plan.mjs";
const root = mkdtempSync(join(tmpdir(), "aidlc-integration-plan-"));
try {
  const git = (...args) => { const r=spawnSync("git", args, {cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);return r.stdout.trim(); };
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root,"input"),"approved\n"); git("add","input");git("commit","-qm","fixture");
  const revision=git("rev-parse","HEAD"),file=join(root,"registry.json");
  const write=(entry)=>writeFileSync(file,JSON.stringify({schema:"aidlc.integration-providers/v1",providers:entry}));
  const entry={source:root,revision,checkout:root};
  write({"design-resource":entry,"figma-existing":entry});
  assert.equal(Object.keys(loadIntegrationProviders(file)).length,2);
  write({"design-resource":{...entry,revision:"a".repeat(40)}});assert.throws(()=>loadIntegrationProviders(file),/revision differs/);
  write({unknown:entry});assert.throws(()=>loadIntegrationProviders(file),/unknown/);
  write({"design-resource":entry});writeFileSync(join(root,"input"),"unpublished\n");assert.throws(()=>loadIntegrationProviders(file),/dirty/);
  console.log("PASS per-Provider pinned checkout registry: independent routing, wrong revision, unknown capability and dirty input rejected");
} finally { rmSync(root,{recursive:true,force:true}); }
