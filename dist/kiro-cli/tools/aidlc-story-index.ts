/** Definitions start a Markdown heading/list item; prose references never define IDs. */
export interface StoryDefinition { id: string; owner?: string; body: string; line: number; kind: "story" | "ac" }
export function parseStoryDefinitions(markdown: string): StoryDefinition[] {
  const lines = markdown.replace(/```[\s\S]*?```/g, "").split(/\r?\n/);
  const definitions: StoryDefinition[] = []; let owner: string | undefined;
  let current: StoryDefinition | undefined;
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*(?:#{1,6}\s+|[-*]\s+)(?:\*\*|`)?(US-[A-Z0-9_-]+|AC-[A-Z0-9_-]+)\b(.*)$/i);
    if (match) {
      const id = match[1].toUpperCase(); const kind = id.startsWith("US-") ? "story" : "ac";
      if (kind === "story") owner = id;
      current = { id, kind, ...(kind === "ac" ? { owner } : {}), body: match[2], line: index + 1 }; definitions.push(current);
    } else if (current) current.body += `\n${line}`;
  }
  return definitions;
}
