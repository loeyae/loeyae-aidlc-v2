import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root=process.cwd();
const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sourceEntry=fs.readFileSync("core/ENTRY.md","utf8");
const sourceRules=fs.readFileSync("core/knowledge/protocols/host-execution.md","utf8").trim().replace(/^# /gm,"## ");
const resolveLinks=(text:string,from:string)=>text.replace(/\]\(([^)]+)\)/g,(link,target:string)=>/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)?link:`](${path.resolve(from,target)})`);
const slug=(heading:string)=>heading.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu,"").replace(/\s/g,"-");
if(fs.existsSync(path.join(root,".git"))){
 const tracked=spawnSync("git",["ls-files","--","dist"],{cwd:root,encoding:"utf8",windowsHide:true});
 assert.equal(tracked.status,0,tracked.stderr);assert.equal(tracked.stdout.trim(),"","generated host copies must not be tracked in Git");
}
let files=0;
for(const name of fs.readdirSync("harness")){
 const manifest=(await import(pathToFileURL(path.join(root,"harness",name,"manifest.ts")).href)).default;
 const output=path.join(root,"dist",name),base=path.join(output,manifest.harnessDir),entry=path.join(output,manifest.skillEntryPath);
 const prefix=path.relative(path.dirname(entry),base).replaceAll("\\","/");
 const parts=sourceEntry.replaceAll("{{root}}",prefix?prefix+"/":"").split("{{execution}}");assert.equal(parts.length,2);
 const rendered=fs.readFileSync(entry,"utf8");assert(rendered.startsWith(parts[0])&&rendered.endsWith(parts[1]));
 const embedded=rendered.slice(parts[0].length,-parts[1].length);
 assert.equal(resolveLinks(embedded,path.dirname(entry)),resolveLinks(sourceRules,path.join(base,"knowledge/protocols")),`${name}: entry must inline the standalone rules with equivalent links`);
 assert(!rendered.includes("{{"),`${name}: unresolved entry template`);
 for(const mapping of manifest.coreDirs)for(const file of walk(path.join(root,"core",mapping.src))){const target=path.join(base,mapping.dst,path.relative(path.join(root,"core",mapping.src),file));assert.deepEqual(fs.readFileSync(target),fs.readFileSync(file),target);files++;}
 const distributed=walk(output);assert(distributed.length<75,`${name}: distribution unexpectedly expanded`);
 for(const file of distributed){
  assert(!/(?:aidlc-orchestrate|aidlc-autonomy|aidlc-light-state|stage-graph|host-worker|host-kernel|[\\/]stages[\\/]|[\\/]sensors[\\/]|[\\/]hooks[\\/]|legacy-skills)/.test(file),file);
  if(!file.endsWith(".md"))continue;
  const text=fs.readFileSync(file,"utf8");assert(!/仅.*旧受管.*读取|help legacy|orchestrate next|批准后继续下一阶段/.test(text),file);
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
   const link=match[1];if(/^(?:https?:|#)/.test(link))continue;
   const [location,anchor]=link.split("#"),target=path.resolve(path.dirname(file),location);
   assert(fs.existsSync(target),`${file}: broken ${link}`);
   if(anchor&&target.endsWith(".md")){
    const headings=[...fs.readFileSync(target,"utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>slug(m[1].trim()));
    assert(headings.includes(decodeURIComponent(anchor)),`${file}: missing anchor ${link}`);
   }
  }
 }
}
console.log(`PASS: ${files} shared files match across 10 hosts; one entry, no retired runtime, resolvable on-demand links`);
