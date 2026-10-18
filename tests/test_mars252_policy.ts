import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadGraph } from "../core/tools/aidlc-orchestrate";

const root=resolve(import.meta.dirname,".."), graph=loadGraph();
const read=(path:string)=>readFileSync(join(root,path),"utf8");
const files=(directory:string):string[]=>readdirSync(join(root,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]);
let notify=0;
for(const file of files("core/stages").filter(file=>file.endsWith(".md"))) {
  const text=read(file), slug=/^slug: (.+)$/m.exec(text)?.[1], stage=graph.stages.find(stage=>stage.slug===slug);
  if(stage?.approval!=="notify")continue;
  notify++;
  assert.doesNotMatch(text,/(?:在用户明确(?:审批|确认)前不得继续|等待明确审批)/,file);
}
for(const slug of ["application-design","operations-authorization"])assert.equal(graph.stages.find(stage=>stage.slug===slug)?.approval,"block");
for(const slug of ["reverse-engineering","requirements-analysis","functional-design","nfr-requirements","nfr-design"])assert.equal(graph.stages.find(stage=>stage.slug===slug)?.approval,"notify");
const requirements=read("core/stages/inception/inception-requirements-analysis.md");
assert.doesNotMatch(requirements,/✅\(3轮\)|✅\(5轮\+\)|任何维度(?:评分)?\s*<80%.*(?:触发|。)/);
assert.match(requirements,/提前结束/);assert.match(requirements,/已有或明确批准的项目量化阈值继续生效/);
assert.match(requirements,/不把全面深度专属检查扩展到标准\/最小深度/);
assert.match(requirements,/quality inventory|质量 inventory/);
assert.match(requirements,/每个需求都有验收标准/);
for(const file of ["core/stages/inception/inception-test-case-derivation.md","core/knowledge/protocols/test-case-derivation.md","core/skills/aidlc-test-case-derivation/SKILL.md","core/skills/aidlc-build-test-evidence/SKILL.md"]) {
  const text=read(file);assert.match(text,/reused_from/);assert.match(text,/observation_id/);assert.match(text,/基线世代漂移/);assert.match(text,/业务 RED\/GREEN 仍独立执行/);
}
console.log(`PASS ${notify} notify stage bodies, protected block gates, requirements depth/policy and I13 reuse reference chain`);
