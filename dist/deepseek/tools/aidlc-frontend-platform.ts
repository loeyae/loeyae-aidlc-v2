import { existsSync, readFileSync, realpathSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import { createHash } from "crypto";

type Kind = "layout_primitives" | "component_mapping" | "css_constraints";
type Row = { kind: Kind; name: string; cells: string[]; targetDeclared: boolean };
const clean = (value: string) => value.trim().replace(/^`+|`+$/g, "").replace(/^\*\*(.*)\*\*$/, "$1").trim();
const key = (value: string) => clean(value).toLowerCase();

/** Read the existing bridge tables, preserving real names/targets, never word counts. */
function rows(content: string): Row[] {
  let kind: Kind | undefined;
  let header = false;
  let targetDeclared = false;
  const result: Row[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) {
      kind = /布局原语|layout primitives?/i.test(line) ? "layout_primitives"
        : /组件映射|前端组件|component mapping|frontend components?/i.test(line) ? "component_mapping"
        : /样式约束|CSS.*约束|样式限制|style constraints?|css constraints?/i.test(line) ? "css_constraints" : undefined;
      header = false;
    }
    if (!/^\s*\|/.test(line)) { header = false; continue; }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(clean);
    if (cells.every(cell => /^:?-+:?$/.test(cell))) continue;
    if (!header) {
      if (/视觉意图|layout primitive/i.test(cells[0])) kind = "layout_primitives";
      else if (/UI 概念|组件名称|组件名|^component(?: name)?$/i.test(cells[0])) kind = "component_mapping";
      else if (/禁止写法|样式约束|style constraint|forbidden/i.test(cells[0])) kind = "css_constraints";
      targetDeclared = /目标组件|target(?: component)?/i.test(cells[1] || "");
      header = true; continue;
    }
    if (kind) result.push({ kind, name: cells[0], cells, targetDeclared });
  }
  return result;
}

function section(content: string, anchor: string): string {
  if (!anchor) return content;
  const lines = content.split(/\r?\n/);
  const slug = (value: string) => key(value).replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "");
  const start = lines.findIndex(line => /^#+\s/.test(line) && slug(line.replace(/^#+\s*/, "")) === slug(decodeURIComponent(anchor)));
  if (start < 0) throw new Error(`frontend design source anchor is missing: ${anchor}`);
  const depth = /^#+/.exec(lines[start])![0].length;
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^#{1,${depth}}\\s`).test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** Explicit, content-bound projection of prose in the existing unit spec. No NLP guesses. */
function projections(content: string): Map<string, { source_sha256: string; complete: boolean; rows: (Row & { quote: string })[] }> {
  const result = new Map<string, { source_sha256: string; complete: boolean; rows: (Row & { quote: string })[] }>();
  for (const match of content.matchAll(/```frontend-source-projection\s*\n([\s\S]*?)\n```/g)) {
    const value = JSON.parse(match[1]);
    if (!value || typeof value.source !== "string" || result.has(value.source) || value.complete !== true
      || !/^[a-f0-9]{64}$/.test(value.source_sha256) || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 500) {
      throw new Error("invalid or duplicate frontend source projection");
    }
    for (const row of value.rows) {
      if (!["layout_primitives", "component_mapping", "css_constraints"].includes(row.kind)
        || !Array.isArray(row.cells) || row.cells.some((cell: unknown) => typeof cell !== "string" || !cell.trim())
        || row.cells.length < (row.kind === "css_constraints" ? 3 : 2) || typeof row.quote !== "string" || !row.quote.trim()) {
        throw new Error("invalid frontend projection row/quote");
      }
      row.name = row.cells[0]; row.targetDeclared = true;
    }
    result.set(value.source, value);
  }
  return result;
}

export function frontendPlatformPayload(root: string, specPath: string, moduleId?: string): Record<string, unknown> {
  const content = readFileSync(resolve(root, specPath), "utf8");
  if (/TODO|FIXME|待补充|待确认|\bTBD\b/i.test(content)) throw new Error("frontend platform spec has unresolved content");
  for (const field of ["运行时|runtime", "样式方案|style(?: system| approach)?"]) {
    const value = content.match(new RegExp(`(?:${field})\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim();
    if (!value || /^(?:\.{2,}|…|[-—]|\[.*\])$/.test(value)) throw new Error(`frontend platform declaration is missing: ${field}`);
  }
  const actual = rows(content);
  const projected = projections(content);
  for (const kind of ["layout_primitives", "component_mapping", "css_constraints"] as Kind[]) {
    const entries = actual.filter(row => row.kind === kind);
    if (!entries.length) throw new Error(`frontend platform spec needs real ${kind} table rows`);
    const names = new Set<string>();
    for (const row of entries) {
      if (names.has(key(row.name))) throw new Error(`duplicate frontend mapping: ${row.name}`);
      names.add(key(row.name));
      const minimum = kind === "css_constraints" ? 3 : 2;
      if (row.cells.length < minimum || row.cells.slice(0, minimum).some(cell => !cell || /^(?:\.{2,}|…|[-—]|N\/?A|待.*|documented-.*)$/i.test(cell))) {
        throw new Error(`incomplete frontend mapping: ${row.name}`);
      }
    }
  }
  const base = moduleId ? `docs/aidlc/modules/${moduleId}/inception` : "docs/aidlc/inception";
  // Optional references narrow to the unit's already approved page/section, without
  // creating another approval or requiring unrelated module component mappings.
  const references = [...content.matchAll(/^\s*-\s*(design_source|platform_source):\s*`?([^`\s]+)`?\s*$/gm)];
  const scopedSources = (kind: string, fallback: string) => {
    const refs = references.filter(match => match[1] === kind).map(match => match[2]);
    return refs.length ? refs : existsSync(resolve(root, fallback)) ? [fallback] : [];
  };
  // Narrowing the page design cannot omit the independent platform constraints.
  const sources = [...new Set([...scopedSources("design_source", `${base}/application-design/frontend-components.md`),
    ...scopedSources("platform_source", `${base}/application-design.md`)])];
  let requiredCount = 0;
  for (const source of sources) {
    const [path, anchor = ""] = source.split("#");
    const absolute = resolve(root, path), rel = relative(realpathSync(root), absolute);
    if (isAbsolute(path) || rel.startsWith(`..${sep}`) || rel === ".." || !path.startsWith(`${base}/`)
      || !existsSync(absolute) || !realpathSync(absolute).startsWith(realpathSync(root) + sep)) throw new Error(`invalid frontend design source: ${source}`);
    const sourceText = section(readFileSync(absolute, "utf8"), anchor);
    const required = rows(sourceText);
    const projection = projected.get(source);
    if (projection) {
      if (createHash("sha256").update(sourceText).digest("hex") !== projection.source_sha256) throw new Error(`frontend projection source drift: ${source}`);
      for (const row of projection.rows) {
        if (!sourceText.includes(row.quote)) throw new Error(`frontend projection quote missing: ${source}`);
      }
      required.push(...projection.rows);
    }
    // Every discovered authoritative source must be accounted for, even when another
    // source already supplies parseable rows. A projection must explicitly cover its scope.
    if (!required.length) throw new Error(`frontend design coverage cannot be derived: ${source}; add a complete content-bound frontend-source-projection in the existing spec`);
    for (const field of ["运行时|runtime", "样式方案|style(?: system| approach)?"]) {
      const declaration = (text: string) => text.match(new RegExp(`(?:${field})\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1]?.trim();
      if (declaration(sourceText) && declaration(sourceText) !== declaration(content)) throw new Error(`frontend platform declaration conflicts with approved source: ${source}`);
    }
    requiredCount += required.length;
    for (const row of required) {
      const found = actual.find(candidate => candidate.kind === row.kind && key(candidate.name) === key(row.name));
      if (!found) throw new Error(`frontend platform spec omits required ${row.kind}: ${row.name} (${source})`);
      // Approved platform targets/constraints are authoritative when already specified.
      const constraints = row.kind === "css_constraints" ? row.cells.slice(1, 3) : row.targetDeclared ? row.cells.slice(1, 2) : [];
      if (constraints.some((cell, index) => cell && !/^(?:\.{2,}|…|[-—])$/.test(cell) && clean(found.cells[index + 1] || "") !== clean(cell))) {
        throw new Error(`frontend platform mapping conflicts with approved source: ${row.name}`);
      }
    }
  }
  if ([...projected.keys()].some(source => !sources.includes(source))) throw new Error("frontend projection must reference an applicable design_source/platform_source");
  if (sources.length && !requiredCount) throw new Error("frontend design coverage cannot be derived; reference the applicable tables/sections with design_source/platform_source in the existing spec");
  return {
    status: "passed", mapping_version: 2,
    ...Object.fromEntries((["layout_primitives", "component_mapping", "css_constraints"] as Kind[]).map(kind => [kind, actual.filter(row => row.kind === kind).map(row => row.cells.join(" | "))])),
    source_refs: sources, coverage_basis: projected.size ? "approved-source-projection" : requiredCount ? "approved-source-tables" : "legacy-spec-tables",
  };
}
