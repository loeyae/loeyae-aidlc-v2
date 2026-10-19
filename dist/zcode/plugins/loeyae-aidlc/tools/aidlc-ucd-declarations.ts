import { readFileSync } from "node:fs";
import { basename } from "node:path";

function fail(message: string): never { throw new Error(message); }

function declaredValue(content: string, key: string): string | undefined {
  const expression = new RegExp(`^[\\s>*-]*\\**\`?${key}\`?\\**\\s*[:：]\\s*\`?([^\`\\s|]+)`, "im");
  return content.match(expression)?.[1]?.trim();
}

export type FrontmatterValue = string | string[];

export interface UcdDeclaration {
  id: string;
  file: string;
  /** This declaration's own block and body, excluding other aggregate declarations. */
  content: string;
  status?: string;
  /** Frontmatter fields; absent for a body-only case file (identified by its file name). */
  fields?: Map<string, FrontmatterValue>;
  /** A body-only case file that declares `tdd_mode:` (only frontmatter may declare it). */
  bodyTddMode?: boolean;
  /** A body-only case file that declares `unit_refs:` (4.8.0; only frontmatter may declare it). */
  bodyUnitRefs?: boolean;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^"(.*)"$|^'(.*)'$/.exec(trimmed);
  if (quoted) return quoted[1] ?? quoted[2] ?? "";
  return trimmed.replace(/\s+#.*$/, "").trim();
}

const FRONTMATTER_LINE = /^\s*$|^\s*#|^[A-Za-z_][\w-]*\s*:|^\s*-\s/;

/** Parse a YAML frontmatter subset: `key: value`, `key: [a, b]`, and `key:` followed by `- item` lines. */
function parseFrontmatter(lines: string[], label: string): Map<string, FrontmatterValue> {
  const fields = new Map<string, FrontmatterValue>();
  let listKey: string | undefined;
  for (const line of lines) {
    if (/^\s*$|^\s*#/.test(line)) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      const list = listKey === undefined ? undefined : fields.get(listKey);
      if (!Array.isArray(list)) fail(`${label}: list item ${JSON.stringify(line.trim())} does not belong to a key`);
      list.push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) fail(`${label}: unsupported frontmatter line ${JSON.stringify(line)}`);
    const [, key, rawValue] = pair;
    if (fields.has(key)) fail(`${label}: frontmatter key ${key} is declared twice`);
    const value = unquote(rawValue);
    const inline = /^\[(.*)\]$/.exec(value);
    if (value === "") {
      fields.set(key, []);
      listKey = key;
    } else {
      fields.set(key, inline ? inline[1].split(",").map(unquote).filter(Boolean) : value);
      listKey = undefined;
    }
  }
  return fields;
}

/** Frontmatter-style blocks (`---` … `---`) of a case file that declare an `id`. */
function frontmatterBlocks(content: string, label: string): Array<{ fields: Map<string, FrontmatterValue>; content: string }> {
  const lines = content.split(/\r?\n/);
  const blocks: Array<{ fields: Map<string, FrontmatterValue>; start: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trimEnd() !== "---") continue;
    let close = index + 1;
    while (close < lines.length && lines[close].trimEnd() !== "---") close++;
    if (close >= lines.length) break;
    const body = lines.slice(index + 1, close);
    if (body.every((line) => FRONTMATTER_LINE.test(line)) && body.some((line) => /^id\s*:/.test(line))) {
      blocks.push({ fields: parseFrontmatter(body, label), start: index });
      index = close;
    }
  }
  return blocks.map((block, index) => ({ fields: block.fields, content: lines.slice(block.start, blocks[index + 1]?.start ?? lines.length).join("\n") }));
}

/**
 * The declaration of every UC-D, from its own case file: each frontmatter block whose
 * `id` is a UC-D, or, for a case file without such a block, the UC-D named by the file
 * name with its `status:` line. A UC-D declared twice is ambiguous and rejected.
 */
export function ucdDeclarations(files: string[], read: (file: string) => string = file => readFileSync(file, "utf8")): Map<string, UcdDeclaration> {
  const declarations = new Map<string, UcdDeclaration>();
  const add = (declaration: UcdDeclaration) => {
    const existing = declarations.get(declaration.id);
    if (existing) fail(`${declaration.id} is declared in more than one case file: ${existing.file}, ${declaration.file}`);
    declarations.set(declaration.id, declaration);
  };
  for (const file of files) {
    const content = read(file);
    const label = file;
    const blocks = frontmatterBlocks(content, label).filter((block) => /^UC-D-\d+$/.test(String(block.fields.get("id"))));
    if (blocks.length > 0) {
      for (const block of blocks) {
        const fields = block.fields;
        const status = fields.get("status");
        add({ id: String(fields.get("id")), file, content: block.content, status: typeof status === "string" ? status.toLowerCase() : undefined, fields });
      }
      continue;
    }
    const named = /^(UC-D-\d+)(?!\d)/.exec(basename(file))?.[1];
    if (named) add({ id: named, file, content, status: declaredValue(content, "status")?.toLowerCase(), bodyTddMode: declaredValue(content, "tdd_mode") !== undefined, bodyUnitRefs: declaredValue(content, "unit_refs") !== undefined });
  }
  return declarations;
}
