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

function headingRange(lines, outline, selector) {
  const number = /^\d+$/.test(selector) ? Number(selector) : null;
  if (number !== null && (number < 1 || number > lines.length)) throw Error("Line outside the selected file.");
  const matches = number !== null ? outline.filter(h => h.line <= number).slice(-1) : outline.filter(h => h.title === selector);
  if (matches.length !== 1) throw Error("Heading missing or ambiguous; locate an exact line first.");
  const selected = matches[0];
  return { ...selected, end: (outline.find(h => h.line > selected.line && h.level <= selected.level)?.line ?? lines.length + 1) - 1 };
}

// Reuse supplied cases results; do not reread case files or fabricate a located set.
export function reconcile(project, file, selector, results) {
  if (!selector || !Array.isArray(results) || !results.length) throw Error("reconcile requires a record section and nonempty cases query results.");
  const wanted = new Set(), sources = [];
  for (const result of results) {
    if (result?.mode !== "cases" || typeof result.file !== "string" || !Array.isArray(result.candidates) || !Array.isArray(result.unparsedReferenceLines)) throw Error("Supply complete cases results, not a hand-written ID list.");
    for (const candidate of result.candidates) {
      if (typeof candidate?.id !== "string" || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(candidate.id)) throw Error("Invalid candidate ID.");
      wanted.add(candidate.id);
    }
    sources.push({ file: result.file, candidates: result.candidates.length, unresolvedLines: result.unparsedReferenceLines });
  }
  const input = source(project, file), lines = input.text.split("\n"), selected = headingRange(lines, headings(lines), selector);
  const families = [...new Set([...wanted].map(id => id.match(/^(.*-)(\d+)$/)?.[1]).filter(Boolean))].sort((a, b) => b.length - a.length);
  const prefix = [...families.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*?-"].join("|");
  const notation = new RegExp(`(?<![\\dA-Za-z])(?:(${prefix}))?(\\d+)(?:\\s*[～~–-]\\s*(?:(${prefix}))?(\\d+))?(?!\\d)`, "g");
  const represented = new Set(), unresolvedNotation = []; let fence = null;
  for (let i = selected.line - 1; i < selected.end; i++) {
    const delimiter = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    // Abbreviated IDs inherit a prefix only within a list in the same table cell/line.
    for (const cell of /^\s*\|/.test(lines[i]) ? cells(lines[i]) : [lines[i]]) {
      const text = cell.replace(/(?<![\w-])L\d+(?:[～~–-]\d+)?/g, "");
      for (const id of ids(text)) if (wanted.has(id)) represented.add(id);
      let family = null, previousEnd = 0;
      for (const m of text.matchAll(notation)) {
        if (m[1]) family = m[1];
        else if (!/^[\s,，、/;；:：`()[\]]*$/.test(text.slice(previousEnd, m.index))) family = null;
        previousEnd = m.index + m[0].length;
        if (!family) continue;
        const first = Number(m[2]), last = Number(m[4] ?? m[2]);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first || (m[3] && m[3] !== family)) {
          unresolvedNotation.push({ line: i + 1, notation: m[0] }); continue;
        }
        for (const id of wanted) {
          const suffix = id.startsWith(family) ? id.slice(family.length) : "";
          if (/^\d+$/.test(suffix) && suffix.length === m[2].length && Number(suffix) >= first && Number(suffix) <= last) represented.add(id);
        }
      }
    }
  }
  return { file: input.file, mode: "reconcile", section: { start: selected.line, end: selected.end }, sources,
    candidates: wanted.size, represented: represented.size, unrecorded: [...wanted].filter(id => !represented.has(id)), unresolvedNotation,
    meaning: "Literal mentions in the selected record only. Review dispositions, input applicability and unqueried references; no acceptance, authorization or completeness decision, including when candidates or unrecorded are empty." };
}

export function query(project, [mode, file, ...args]) {
  if (!file) throw Error("locate <file> <literal> | section <file> [heading or line] | json <file> [field.path ...] | references <story-file> <STORY/AC-ID ...> | cases <file> <reference-ID ...>");
  if (!["locate", "section", "json", "references", "cases"].includes(mode)) throw Error("Unknown query mode.");
  const input = source(project, file), lines = input.text.split("\n");
  const outline = mode === "json" ? [] : headings(lines);
  const parsed = ["json", "references"].includes(mode) ? null : recordsIn(lines);
  const base = { file: input.file, mode };
  if (mode === "references") {
    if (!args.length || args.some(id => !/^(STORY|AC)-[A-Z0-9-]+$/.test(id))) throw Error("Select existing STORY/AC IDs from one explicit story source.");
    const references = new Set(), selections = [];
    for (const id of new Set(args)) {
      const matches = outline.filter(h => ids(h.title).includes(id));
      if (matches.length !== 1) throw Error(`Missing or ambiguous STORY/AC heading: ${id}`);
      const selected = headingRange(lines, outline, String(matches[0].line));
      selections.push({ id, start: selected.line, end: selected.end });
      for (const h of outline.filter(h => h.line >= selected.line && h.line <= selected.end)) for (const ref of ids(h.title)) if (/^(STORY|AC)-/.test(ref)) references.add(ref);
    }
    return { ...base, selections, references: [...references], meaning: "Selected headings and all descendant STORY/AC headings, excluding code examples. Review other consumers, aliases and dependencies; not a semantic impact decision." };
  }
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
    const selected = headingRange(lines, outline, args[0]), end = selected.end + 1;
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
  try {
    const [mode, file, selector, ...extra] = process.argv.slice(2);
    if (mode === "reconcile") {
      if (!file || !selector || extra.length || process.stdin.isTTY) throw Error("Pipe cases JSON/JSONL into reconcile <record-file> <exact heading or line>.");
      const text = fs.readFileSync(0, "utf8").trim();
      if (!text) throw Error("No cases results supplied; an empty input is not evidence.");
      let values;
      try { values = JSON.parse(text); } catch { values = text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)); }
      console.log(JSON.stringify(reconcile(process.cwd(), file, selector, Array.isArray(values) ? values : [values])));
    } else console.log(JSON.stringify(query(process.cwd(), process.argv.slice(2))));
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
