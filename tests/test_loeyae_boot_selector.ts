import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { addProjectProvider } from "../core/tools/aidlc-provider-cli";
import { defaultResolutionPolicy, resolveProjectProviderPlan, PROVIDER_PROFILE_REGISTRY_PATH } from "../core/tools/aidlc-provider-resolver";
import { readCurrentProviderSourceRevision } from "../core/tools/aidlc-provider-runner";
const [source,revision]=process.argv.slice(2);
assert(source && /^[a-f0-9]{40}$/.test(revision ?? ""), "provide actual Boot repository and immutable commit");
const root=mkdtempSync(join(tmpdir(),"aidlc-boot-selector-"));
const write=(p:string,v:unknown)=>writeFileSync(join(root,p),JSON.stringify(v));
try {
  const git=(...args:string[])=>{const r=spawnSync("git",args,{cwd:root,encoding:"utf8"});assert.equal(r.status,0,r.stderr);};
  git("init","-q");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(root,"README.md"),"selector fixture\n");git("add","README.md");git("commit","-qm","baseline");
  mkdirSync(join(root,".aidlc"));
  write(".aidlc/provider-git-policy.json",{version:1,allowed_hosts:source.startsWith("file:")?[]:[new URL(source).hostname],allowed_commits:[revision],allow_file_fixtures:source.startsWith("file:")});
  addProjectProvider(root,{source,ref:revision,subdir:"providers/loeyae-boot",instance:"boot",trust:"allowlisted-commit",allowFile:source.startsWith("file:"),stages:["code-generation"],capabilities:["implementation-validation"]});
  const plan=(framework:string)=>{
    write(PROVIDER_PROFILE_REGISTRY_PATH,{version:1,active:"approved",profiles:{approved:{facts:{languages:["java"],frameworks:[framework]},risk:{level:"standard",protected_gate:false}}}});
    return resolveProjectProviderPlan(root,{scope:{stage:"code-generation",module_id:"app",unit_id:"u1"},source_revision:readCurrentProviderSourceRevision(root),policy:defaultResolutionPolicy()});
  };
  assert.equal(plan("loeyae-boot").provider_actions.length,1,"documented Java/framework facts select actual validation Provider without a retired profile tag");
  assert.equal(plan("other").provider_actions.length,0,"other Java frameworks must not receive Loeyae validation");
  console.log("PASS actual Boot manifest: approved Java/framework selection and non-Loeyae exclusion");
} finally {rmSync(root,{recursive:true,force:true});}
