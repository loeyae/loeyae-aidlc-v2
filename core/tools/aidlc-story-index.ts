/** Definitions start a Markdown heading/list item; prose references never define IDs. */
import { documentLineDefinition, markdownSourceLines } from "./aidlc-document-parser";
export interface StoryDefinition { id: string; owner?: string; body: string; line: number; kind: "story" | "ac" }
export function parseStoryDefinitions(markdown: string): StoryDefinition[] {
  // This compact comparison index retains its legacy fence-free body semantics.
  // Generation uses parseDocument() lossless ranges with this same lexical pass.
  const lines = markdownSourceLines(markdown).lines;
  const definitions: StoryDefinition[] = []; let owner: string | undefined;
  let current: StoryDefinition | undefined;
  for (const source of lines) {
    if (source.fenced) continue;
    const line = source.text.replace(/\r?\n$/, "");
    const match = source.opaque ? undefined : documentLineDefinition(line);
    if (match && match.kind !== "requirement") {
      const { id, kind } = match;
      if (kind === "story") owner = id;
      current = { id, kind, ...(kind === "ac" ? { owner } : {}), body: match.tail, line: source.line }; definitions.push(current);
    } else if (current) current.body += `\n${line}`;
  }
  return definitions;
}
