import { readFileSync, statSync } from "fs";
import { extname } from "path";

/** Presence is not compilation/semantic validation; those remain stage sensors. */
export function substantiveArtifact(path: string, source = false): boolean {
  const text = readFileSync(path, "utf8");
  if (text.includes("\0")) return false;
  const extension = extname(path).toLowerCase();
  const config = [".json", ".yaml", ".yml", ".toml", ".ini", ".env"].includes(extension);
  if (extension === ".json") {
    try { JSON.parse(text); return true; } catch { return false; }
  }
  // Ignore comment-only files and explicit placeholders, without a source length quota.
  const body = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "")
    .split(/\r?\n/).filter(line => {
      if (/^\s*\/\//.test(line) || /^\s*;+\s*$/.test(line)) return false;
      if (extension === ".ini" && /^\s*;/.test(line)) return false;
      if (/^\s*#/.test(line)) return source && /^\s*#\s*(?:include|define|if|ifdef|ifndef|endif|else|elif|pragma|undef|error|warning)\b/.test(line);
      return true;
    }).join("\n").trim();
  if (!body || /^(?:TODO|FIXME|TBD|placeholder|待补充|待实现|\.\.\.|…)[\s.!。]*$/i.test(body)) return false;
  if (source || config) return true;
  // Documents retain a substantive size floor and cannot consist only of headings.
  return statSync(path).size >= 16 && !!text.split(/\r?\n/)
    .filter(line => !/^\s*(?:#{1,6}\s|<!--|$)/.test(line)).join("\n").trim();
}
