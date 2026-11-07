/** Lossless source ranges. Fences are opaque to recognition, never removed from text. */
import { createRequire } from "module";
type MarkdownToken = { type: string; map: [number, number] | null; markup?: string };
const MarkdownIt = createRequire(import.meta.url)("markdown-it") as new (options: { html: boolean }) => { parse(text: string, env: object): MarkdownToken[] };
const markdownParser = new MarkdownIt({ html: true });
export interface DocumentEntry {
  id: string; kind: "requirement" | "story" | "ac"; start: number; end: number;
  line: number; level: number; owner?: string; text: string; req_refs: string[];
}
export interface DocumentIndex { preamble: string; entries: DocumentEntry[] }
/** Shared lexical pass; index consumers may omit fenced text while slices retain ranges. */
export function markdownSourceLines(markdown: string): { lines: { text: string; start: number; line: number; opaque: boolean; fenced: boolean }[]; unclosedFence: boolean } {
  const lines: { text: string; start: number; line: number; opaque: boolean; fenced: boolean }[] = [];
  // Markdown block maps distinguish nested lists from real indented/fenced code.
  // Only recognition uses tokens; emitted text always uses original source offsets.
  const blocked = new Set<number>(), fencedLines = new Set<number>();
  const originalLines = markdown.split(/\r?\n/);
  let unclosedFence = false;
  for (const token of markdownParser.parse(markdown, {})) {
    if (!token.map || !["fence", "code_block", "html_block"].includes(token.type)) continue;
    if (token.type === "fence") {
      const marker = token.markup!;
      const closing = originalLines[token.map[1] - 1]?.trimStart() || "";
      if (token.map[1] - token.map[0] < 2 || !new RegExp(`^${marker[0]}{${marker.length},}\\s*$`).test(closing)) unclosedFence = true;
    }
    for (let i = token.map[0]; i < token.map[1]; i++) {
      blocked.add(i); if (token.type === "fence") fencedLines.add(i);
    }
  }
  let offset = 0, lineNumber = 0;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) || []) {
    lineNumber++;
    const fenced = fencedLines.has(lineNumber - 1), opaque = blocked.has(lineNumber - 1);
    lines.push({ text: line, start: offset, line: lineNumber, opaque, fenced });
    offset += line.length;
  }
  return { lines, unclosedFence };
}
export function documentLineDefinition(line: string): { id: string; kind: DocumentEntry["kind"]; level: number; tail: string } | undefined {
  const match = line.match(/^\s*(?:(#{1,6})\s+|(?:[-*+] |\d+[.)]\s+))(?:\*\*|`)?(REQ-[A-Z0-9_-]+|STORY-[A-Z0-9_-]+|US-[A-Z0-9_-]+|AC-[A-Z0-9_-]+)\b(.*)/i);
  if (!match) return undefined;
  const id = match[2].toUpperCase();
  return { id, kind: id.startsWith("REQ-") ? "requirement" : id.startsWith("AC-") ? "ac" : "story", level: match[1]?.length || 7, tail: match[3] };
}
export function parseDocument(markdown: string, domain: "requirements" | "stories"): DocumentIndex {
  const starts: Omit<DocumentEntry, "end" | "text" | "req_refs">[] = [];
  const scanned = markdownSourceLines(markdown);
  let owner: string | undefined, ownerLevel = 7;
  for (const source of scanned.lines) {
    const { text: line, start: offset, line: lineNumber } = source;
    if (!source.opaque) {
      const heading = line.match(/^\s*(#{1,6})\s+/);
      if (heading && heading[1].length <= ownerLevel) owner = undefined;
      const match = documentLineDefinition(line);
      if (match) {
        const { id, kind, level } = match;
        if (domain === "requirements" ? kind !== "requirement" : kind === "requirement") throw new Error(`SLICE_DEFINITION_DOMAIN: ${id}:${lineNumber}`);
        if (starts.some(s => s.id === id)) throw new Error(`SLICE_DUPLICATE_DEFINITION: ${id}:${lineNumber}`);
        if (kind === "story") { owner = id; ownerLevel = level; }
        if (kind === "ac" && !owner) throw new Error(`SLICE_ORPHAN_AC: ${id}:${lineNumber}`);
        starts.push({ id, kind, start: offset, line: lineNumber, level, ...(kind === "ac" ? { owner } : {}) });
      }
    }
  }
  if (scanned.unclosedFence) throw new Error("SLICE_UNCLOSED_FENCE");
  const entries = starts.map((entry, i) => {
    // A story owns its complete interval, including every AC and Gherkin body.
    const next = starts.slice(i + 1).find(s => entry.kind !== "story" || s.kind === "story");
    const end = next?.start ?? markdown.length;
    const text = markdown.slice(entry.start, end);
    // Source declarations alone define provenance; incidental REQ mentions do not.
    const sources: string[] = [];
    // Keep original Markdown nesting context; slicing a nested story first would
    // make its valid list continuation look like a standalone indented code block.
    for (const line of scanned.lines.filter(line => line.start >= entry.start && line.start < end)) {
      if (!line.opaque && /^\s*(?:[-*]\s*)?(?:\*\*)?(?:来源|需求来源|Sources?|Requirements?)\s*(?:\*\*)?\s*[:：](?:\*\*)?/i.test(line.text)) sources.push(...(line.text.match(/\bREQ-[A-Z0-9_-]+\b/gi) || []));
    }
    return { ...entry, end, text, req_refs: [...new Set(sources.map(s => s.toUpperCase()))].sort() };
  });
  return { preamble: markdown.slice(0, starts[0]?.start ?? markdown.length), entries };
}
