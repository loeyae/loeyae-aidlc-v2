/** Explicit inventories take precedence: malformed declarations never fall back to prose. */
export function reviewedFiles(content: string): string[] {
  const declared = [...content.matchAll(/^[ \t]*files_reviewed[ \t]*[:：][ \t]*(.*)$/gm)];
  if (declared.length) {
    if (declared.length !== 1) throw new Error("files_reviewed must be declared once");
    let value: unknown;
    try {
      value = JSON.parse(declared[0][1]);
    } catch {
      throw new Error("files_reviewed must be a valid JSON string array");
    }
    if (!Array.isArray(value) || !value.length || !value.every((path) => typeof path === "string" && path.trim()))
      throw new Error("files_reviewed must be a non-empty JSON string array");
    if (new Set(value).size !== value.length) throw new Error("files_reviewed contains duplicate paths");
    return value;
  }
  const paths = new Set<string>();
  // Quotes delimit entire paths, including spaces and non-ASCII file names.
  const quoted = /`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'/g;
  const add = (path: string) => {
    if (!/^[a-z]+:\/\//i.test(path) && /\.[\p{L}\p{N}]+$/u.test(path)) paths.add(path);
  };
  for (const match of content.matchAll(quoted)) {
    const path = match[1] ?? match[2] ?? match[3];
    if (path.includes("/") || path.includes("\\")) add(path);
  }
  // Keep historical unquoted inventories, using Unicode-aware path components.
  const plain = content.replace(quoted, " ");
  for (const match of plain.matchAll(
    /(?<![\p{L}\p{N}_:/])(?:[\p{L}\p{N}_.@+()-]+\/)+[\p{L}\p{N}_.@+()-]+\.[\p{L}\p{N}]+/gu,
  ))
    add(match[0]);
  return [...paths];
}
