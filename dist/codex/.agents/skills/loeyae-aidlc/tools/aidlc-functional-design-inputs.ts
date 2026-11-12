/** Shared by the ordinary checker and its isolated controlled executable. */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { designDocuments } from "./aidlc-design-documents";
import { noUnresolved } from "./aidlc-unresolved-markers";
import { scanFiles } from "./aidlc-scan-root";
import { unitUcdIds } from "./aidlc-execution-context";
export function functionalDesignPayload(root: string, module?: string, unit?: string): Record<string, unknown> {
  for (const id of [module, unit]) if (id && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || id === "." || id === "..")) throw Error("invalid functional design scope");
  if (unit && !module) throw Error("active module is required for functional design unit");
  const base = module ? `docs/aidlc/modules/${module}` : "docs/aidlc";
  const construction = module && unit ? `${base}/construction/${unit}` : "docs/aidlc/construction";
  const files = designDocuments(join(root, construction, "functional-design.md"), "functional-design");
  if (!files.length) throw Error("functional design artifacts are missing");
  const text = (file: string) => readFileSync(file, "utf8");
  const content = files.map(file => { const body = text(file); noUnresolved(body, relative(root, file)); return body; }).join("\n");
  const evidence = module && unit ? join(root, ".aidlc/evidence/test-case-derivation", module, "test-case-derivation.json") : undefined;
  const i13 = evidence && existsSync(evidence) ? JSON.parse(text(evidence)) : null;
  const scope = i13?.status === "required" ? unitUcdIds(i13, unit) : null;
  const source = scanFiles(root, `${base}/inception/application-design/test-cases`, /\.md$/).map(text).join("\n");
  const cases = [...new Set([...source.matchAll(/UC-D-\d+/g)].map(m => m[0]))].sort().filter(id => !scope?.scoped || scope.all.includes(id));
  const covered = cases.filter(id => new RegExp(`\\b${id}\\b`).test(content));
  if (covered.length !== cases.length) throw Error(`functional design does not cover every UC-D case; missing: ${cases.filter(id => !covered.includes(id)).join(", ")}`);
  const interfaces = [...content.matchAll(/(?:API|接口|endpoint|event handler|事件处理|public method|公共方法)/gi)].length;
  if (!interfaces) throw Error("functional design contains no interface specification");
  if (!/数据源|data source|repository|database|数据库|表结构/i.test(content)) throw Error("functional design contains no data source validation");
  if (!/错误|异常|error|exception|失败|timeout|超时/i.test(content)) throw Error("functional design contains no error handling definition");
  return { status: "passed", data_source_validation: "passed", ambiguities_resolved: true, unresolved_blockers: 0, use_cases_covered: covered.length ? covered : ["documented functional cases"], interfaces_specified: interfaces, error_handling_defined: true };
}
