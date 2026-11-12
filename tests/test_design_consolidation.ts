import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { designDocuments } from "../core/tools/aidlc-design-documents";
import { functionalDesignPayload } from "../core/tools/aidlc-functional-design-inputs";
import { semanticCheckerDigest, withSemanticCheckerIdentityMemoization } from "../core/tools/aidlc-checker-identity";
import { semanticCommandArgv } from "../core/tools/aidlc-evidence";
const root = mkdtempSync(join(tmpdir(), "aidlc-design-single-"));
const write = (path: string, value: string) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), value); };
const base = "docs/aidlc/modules/shop", file = `${base}/construction/default/functional-design.md`;
const design = "<!-- aidlc-design: functional-design/v1 -->\n## 业务逻辑\nUC-D-1 API saves the order and handles timeout errors.\n## 业务规则\nOnly confirmed orders are accepted, negatives are rejected.\n## 领域实体\nOrder has an identity and a confirmed state.\n## 数据源验证\nThe repository is written by the existing order API.\n";
try {
 write(file, design); write(`${base}/inception/application-design/test-cases/order.md`, "UC-D-1-order\nUC-D-2-another-unit");

 // First check with no ownership filter: the missing case must fail.
 assert.throws(() => functionalDesignPayload(root,"shop","default"), /UC-D-2|scope|UC-D/);
 write(".aidlc/evidence/test-case-derivation/shop/test-case-derivation.json", JSON.stringify({status:"required",use_cases:["UC-D-1","UC-D-2"],ucd_units:{"UC-D-1":["default"],"UC-D-2":["other"]}}));
 assert.equal(functionalDesignPayload(root,"shop","default").status,"passed","other unit UC-D is not imposed");
 write(`${base}/inception/application-design/test-cases/order.md`, "UC-D-1-order");
 const expected = functionalDesignPayload(root,"shop","default"); assert.equal(expected.status,"passed");
 write(file.replace(/\.md$/,"/business-rules.md"),"TODO stale duplicate must not replace canonical source");
 assert.deepEqual(designDocuments(join(root,file),"functional-design"),[join(root,file)]);
 assert.equal(functionalDesignPayload(root,"shop","default").status,"passed");
 write(file,design.replace("Only confirmed orders are accepted, negatives are rejected.","TODO"));
 assert.throws(()=>functionalDesignPayload(root,"shop","default"),/CANONICAL_DESIGN_SECTION_REQUIRED/);
 write(file,design.replace("UC-D-1 API", "TODO UC-D-1 API"));assert.throws(()=>functionalDesignPayload(root,"shop","default"),/unresolved marker/);
 write(file,design);
 const probe = spawnSync(process.execPath,["--import",import.meta.resolve("tsx"),"--input-type=module","-e",`import {checkProduces} from ${JSON.stringify(pathToFileURL(resolve("core/tools/aidlc-orchestrate.ts")).href)}; import fs from 'node:fs'; const file=${JSON.stringify(file)};const instance={axis:'unit',module_id:'shop',unit_id:'default',instance_id:'functional-design@module:shop@unit:default',stage:{slug:'functional-design',produces:[file]}};const canonical=checkProduces(instance);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('<!-- aidlc-design: functional-design/v1 -->',''));console.log(JSON.stringify({canonical,legacy:checkProduces(instance)}));`],{cwd:root,encoding:"utf8",timeout:15000,windowsHide:true});
 assert.equal(probe.status,0,probe.stderr);const exitGate=JSON.parse(probe.stdout);assert.deepEqual(exitGate.canonical,[]);assert.equal(exitGate.legacy.length,3,"unmarked design still owes the three absent legacy fragments; existing pending fragment fails semantic checks");write(file,design);
 const argv=semanticCommandArgv("functional-design-completeness",{current_module:"shop",current_unit:"default"},root);
 assert.ok(argv.some(a=>a.endsWith("aidlc-functional-design-checker.ts")));
 const result=spawnSync(argv[0],argv.slice(1),{cwd:root,encoding:"utf8",timeout:15000,windowsHide:true});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),expected);
 const app=join(root,"application-design.md");writeFileSync(app,"<!-- aidlc-design: application-design/v1 -->\n"+["组件列表","组件方法","应用服务","组件依赖"].map(h=>`## ${h}\nOrder service calls the repository with a stable public API.\n`).join(""));assert.deepEqual(designDocuments(app,"application-design"),[app]);
 for(const kind of ["application","functional"]) {const stage=readFileSync(resolve(`core/stages/${kind==="application"?"inception/inception":"construction/construction"}-${kind}-design.md`),"utf8").split("---")[1];assert.equal((stage.split("produces:")[1].match(/  - docs\//g)||[]).length,1);}
 withSemanticCheckerIdentityMemoization(()=>{const a=semanticCheckerDigest(false,"template-completeness"),b=semanticCheckerDigest(false,"functional-design-completeness");assert.notEqual(a,b);assert.equal(semanticCheckerDigest(false,"template-completeness"),a);assert.equal(semanticCheckerDigest(false,"functional-design-completeness"),b);});
 console.log("PASS canonical documents, missing sections, unresolved decisions, UC-D coverage, isolated CLI and per-sensor identity");
} finally { rmSync(root,{recursive:true,force:true}); }
