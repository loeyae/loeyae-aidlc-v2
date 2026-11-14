// Stateless projections for native hosts. No traversal, writes, approval or completion decisions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ids = text => [...new Set(text.match(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g) ?? [])];
const shape = value => Array.isArray(value)
  ? { type: "array", length: value.length, itemTypes: [...new Set(value.map(v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v))], itemKeys: [...new Set(value.flatMap(v => v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : []))] }
  : value && typeof value === "object" ? { type: "object", keys: Object.keys(value) }
  : { type: value === null ? "null" : typeof value, ...(typeof value === "string" ? { length: value.length } : {}) };

function source(project, file) {
  const root = fs.realpathSync(project), target = fs.realpathSync(path.resolve(root, file));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw Error("Select a file inside the current project; outside paths and escaping links are not read.");
  if (!fs.statSync(target).isFile()) throw Error("Select one explicit file, not a directory.");
  return { file: relative.replaceAll("\\", "/"), text: fs.readFileSync(target, "utf8").replace(/^\uFEFF/, "").replaceAll("\r\n", "\n") };
}

function headings(lines) {
  const result = []; let fence = null;
  lines.forEach((text, index) => {
    const delimiter = text.match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      return;
    }
    const heading = !fence && text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) result.push({ line: index + 1, level: heading[1].length, title: heading[2] });
  });
  return result;
}

function cells(line) {
  const result = []; let cell = "", escaped = false;
  for (const char of line.trim()) {
    if (escaped) { cell += /[\\|`*_{}\[\]()#+.!<>-]/.test(char) ? char : "\\" + char; escaped = false; }
    else if (char === "\\") escaped = true;
    else if (char === "|") { result.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  if (escaped) cell += "\\";
  result.push(cell.trim());
  return result.slice(1, line.trim().endsWith("|") ? -1 : undefined);
}

function recordsIn(lines) {
  const records = [], consumed = new Set(); let titleColumn = 1, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const delimiter = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const begin = lines[i].match(/^\s*<!--\s*([\w-]+) BEGIN:\s*([A-Z][A-Z0-9-]+)\s*-->\s*$/);
    if (begin) {
      let end = i + 1;
      const terminator = new RegExp(`^\\s*<!--\\s*${begin[1]} END:\\s*${begin[2]}\\s*-->\\s*$`);
      while (end < lines.length && !terminator.test(lines[end])) end++;
      if (end === lines.length) throw Error(`Unclosed case marker at line ${i + 1}; inspect the source boundary.`);
      const body = lines.slice(i, end + 1).join("\n");
      const heading = headings(lines.slice(i, end + 1))[0];
      records.push({ id: begin[2], line: i + 1, end: end + 1, title: heading?.title.replace(begin[2], "").trim() ?? begin[2], refs: ids(body).filter(id => id !== begin[2]) });
      for (let n = i; n <= end; n++) consumed.add(n);
      i = end; continue;
    }
    if (!/^\s*\|/.test(lines[i])) continue;
    const row = cells(lines[i]);
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(row[0] ?? "")) {
      const title = row.findIndex(c => /用例标题|用例名称|场景名称|^标题$|^title$|^name$/i.test(c));
      if (title >= 0) titleColumn = title;
      continue;
    }
    records.push({ id: row[0], line: i + 1, end: i + 1, title: row[titleColumn] ?? row[1] ?? row[0], refs: ids(lines[i]).filter(id => id !== row[0]) });
    consumed.add(i);
  }
  return { records, consumed };
}

function cases(lines, refs, { records, consumed }) {
  if (!refs.length) throw Error("cases requires the existing STORY/AC/reference IDs to locate.");
  const wanted = new Set(refs);
  return {
    recognizedRecords: records.length,
    candidates: records.filter(r => wanted.has(r.id) || r.refs.some(id => wanted.has(id))),
    unparsedReferenceLines: lines.flatMap((line, i) => !consumed.has(i) && ids(line).some(id => wanted.has(id)) ? [i + 1] : []),
    meaning: "Literal reference candidates only. Review actual impact, unresolved references and dependencies; this is not an acceptance or completeness decision.",
  };
}

export function query(project, [mode, file, ...args]) {
  if (!file) throw Error("locate <file> <literal> | section <file> [heading or line] | json <file> [field.path ...] | cases <file> <reference-ID ...>");
  if (!["locate", "section", "json", "cases"].includes(mode)) throw Error("Unknown query mode.");
  const input = source(project, file), lines = input.text.split("\n");
  const outline = mode === "json" ? [] : headings(lines);
  const parsed = mode === "json" ? null : recordsIn(lines);
  const base = { file: input.file, mode };
  if (mode === "locate") {
    if (args.length !== 1 || !args[0]) throw Error("locate requires one literal ID or term.");
    return { ...base, matches: lines.flatMap((line, i) => {
      if (!line.includes(args[0])) return [];
      const record = parsed.records.find(r => r.line <= i + 1 && r.end >= i + 1);
      return [{ line: i + 1, heading: record && record.end > record.line ? record.title : outline.filter(h => h.line <= i + 1).at(-1)?.title ?? null,
        record: record ? { id: record.id, start: record.line, end: record.end } : null,
        ids: ids(line), links: [...line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(m => ({ label: m[1], target: m[2] })),
      }];
    }) };
  }
  if (mode === "section") {
    if (args.length > 1) throw Error("Select one exact heading or line number.");
    if (!args.length) return { ...base, headings: outline.filter(h => h.level === Math.min(...outline.map(h => h.level))) };
    const number = /^\d+$/.test(args[0]) ? Number(args[0]) : null;
    if (number !== null && (number < 1 || number > lines.length)) throw Error("Line outside the selected file.");
    const record = number !== null && parsed.records.find(r => r.line <= number && r.end >= number);
    if (record) return { ...base, id: record.id, start: record.line, end: record.end, content: lines.slice(record.line - 1, record.end).join("\n"), meaning: "Complete selected structured record, including its own metadata." };
    const matches = number !== null ? outline.filter(h => h.line <= number).slice(-1) : outline.filter(h => h.title === args[0]);
    if (matches.length !== 1) throw Error("Heading missing or ambiguous; locate an exact line first.");
    const selected = matches[0], end = outline.find(h => h.line > selected.line && h.level <= selected.level)?.line ?? lines.length + 1;
    const children = outline.filter(h => h.line > selected.line && h.line < end);
    const contentEnd = children[0]?.line ?? end;
    return { ...base, start: selected.line, end: end - 1, contentEnd: contentEnd - 1,
      content: lines.slice(selected.line - 1, contentEnd - 1).join("\n"),
      subsections: children.filter(h => h.level === Math.min(...children.map(h => h.level))),
      meaning: children.length ? "Opening text and direct subsections only; select a subsection to read its body." : "Complete selected leaf section.",
    };
  }
  if (mode === "json") {
    const value = JSON.parse(input.text);
    if (!args.length) return { ...base, schema: shape(value) };
    const select = (value, keys) => {
      if (!keys.length) return [value];
      const [key, ...rest] = keys;
      if (key === "*") return Array.isArray(value) ? value.flatMap(v => select(v, rest)) : [];
      return value && typeof value === "object" && Object.hasOwn(value, key) ? select(value[key], rest) : [];
    };
    return { ...base, fields: args.map(selector => {
      const values = select(value, selector.split("."));
      return { selector, matches: values.length, values: values.map(v => v && typeof v === "object" ? shape(v) : v) };
    }) };
  }
  return { ...base, ...cases(lines, args, parsed) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(query(process.cwd(), process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
