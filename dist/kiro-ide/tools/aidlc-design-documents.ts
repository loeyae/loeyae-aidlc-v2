/** Canonical designs replace repeated subdocuments; legacy bundles remain readable. */
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { substantiveText } from "./aidlc-artifact-presence";
type Kind = "application-design" | "functional-design";
const sections: Record<Kind, RegExp[]> = {
  "application-design": [/^(?:Components|组件|组件列表)$/i, /^(?:Component methods|组件方法)$/i, /^(?:Application services|应用服务)$/i, /^(?:Component dependencies|组件依赖)$/i],
  "functional-design": [/^(?:Business logic|业务逻辑)$/i, /^(?:Business rules|业务规则)$/i, /^(?:Domain entities|领域实体)$/i, /^(?:Data source validation|数据源验证)$/i],
};
export function canonicalDesign(path: string, kind: Kind): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(`<!-- aidlc-design: ${kind}/v1 -->`);
}
export function designDocuments(path: string, kind: Kind): string[] {
  if (canonicalDesign(path, kind)) {
    const source = readFileSync(path, "utf8"), chunks = [...source.matchAll(/^## ([^\r\n]+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
    for (const pattern of sections[kind]) {
      const matches = chunks.filter(c => pattern.test(c[1].trim()));
      if (matches.length !== 1 || !substantiveText(path, matches[0][2])) throw Error(`CANONICAL_DESIGN_SECTION_REQUIRED: ${kind} ${pattern}`);
    }
    return [path];
  }
  const folder = path.replace(/\.md$/, "");
  return [...(existsSync(path) ? [path] : []), ...(existsSync(folder) ? readdirSync(folder).filter(f => f.endsWith(".md") && lstatSync(join(folder, f)).isFile()).sort().map(f => join(folder, f)) : [])];
}
/** Exit-gate compatibility: an unmarked design must still deliver the original
 * four substantive fragments. Dropping graph outputs must not weaken that gate. */
export function designBundleFailures(path: string, kind: Kind): string[] {
  if (canonicalDesign(path, kind)) {
    try { designDocuments(path, kind); return []; } catch (error) { return [String(error)]; }
  }
  const names = kind === "application-design" ? ["components", "component-methods", "application-services", "component-dependency"] : ["business-logic-model", "business-rules", "domain-entities", "data-source-validation"];
  return names.map(name => join(path.replace(/\.md$/, ""), name + ".md")).filter(file => !existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || !substantiveText(file, readFileSync(file, "utf8")));
}

/** Ignore only replaced design fragments, never test cases or unit manifests. */
export function withoutSupersededDesigns(files: string[]): string[] {
  return files.filter(file => {
    const directory = dirname(file), kind = basename(directory);
    if (kind !== "application-design" && kind !== "functional-design") return true;
    const names = kind === "application-design" ? ["components.md", "component-methods.md", "application-services.md", "component-dependency.md"] : ["business-logic-model.md", "business-rules.md", "domain-entities.md", "data-source-validation.md"];
    return !names.includes(basename(file)) || !canonicalDesign(directory + ".md", kind);
  });
}
