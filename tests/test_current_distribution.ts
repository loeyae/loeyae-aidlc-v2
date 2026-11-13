import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root=process.cwd();
const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sourceEntry=fs.readFileSync("core/ENTRY.md","utf8");
let files=0;
for(const name of fs.readdirSync("harness")){
 const manifest=(await import(pathToFileURL(path.join(root,"harness",name,"manifest.ts")).href)).default;
 const output=path.join(root,"dist",name),base=path.join(output,manifest.harnessDir),entry=path.join(output,manifest.skillEntryPath);
 const prefix=path.relative(path.dirname(entry),base).replaceAll("\\","/");assert.equal(fs.readFileSync(entry,"utf8"),sourceEntry.replaceAll("{{root}}",prefix?prefix+"/":""));
 for(const mapping of manifest.coreDirs)for(const file of walk(path.join(root,"core",mapping.src))){const target=path.join(base,mapping.dst,path.relative(path.join(root,"core",mapping.src),file));assert.deepEqual(fs.readFileSync(target),fs.readFileSync(file),target);files++;}
 const distributed=walk(output);assert(distributed.length<75,`${name}: distribution unexpectedly expanded`);
 for(const file of distributed){
  assert(!/(?:aidlc-orchestrate|aidlc-autonomy|aidlc-light-state|stage-graph|host-worker|host-kernel|[\\/]stages[\\/]|[\\/]sensors[\\/]|[\\/]hooks[\\/]|legacy-skills)/.test(file),file);
  if(!file.endsWith(".md"))continue;
  const text=fs.readFileSync(file,"utf8");assert(!/仅.*旧受管.*读取|help legacy|orchestrate next|批准后继续下一阶段/.test(text),file);
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
   const link=match[1];if(/^(?:https?:|#)/.test(link))continue;assert(fs.existsSync(path.resolve(path.dirname(file),link.split("#")[0])),`${file}: broken ${link}`);
  }
 }
}
console.log(`PASS: ${files} shared files match across 10 hosts; one entry, no retired runtime, resolvable on-demand links`);
