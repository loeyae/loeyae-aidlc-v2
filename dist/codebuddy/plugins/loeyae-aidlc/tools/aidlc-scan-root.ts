import { existsSync, readdirSync, statSync } from "fs";
import * as nodePath from "path";

type PathApi = Pick<typeof nodePath, "isAbsolute" | "join">;

const SKIPPED_ENTRIES = [".git", "node_modules", "dist", "build", "target", ".aidlc/evidence"];

/**
 * Resolve the directory a file scan starts from. Relative bases are contextualized
 * and joined onto the project root; absolute bases are used as-is so a caller that
 * already resolved the path cannot get ROOT joined twice (e.g. "/r/r/x").
 */
export function resolveScanRoot(
  root: string,
  base: string,
  contextualize: (path: string) => string = (path) => path,
  pathApi: PathApi = nodePath,
): string {
  return pathApi.isAbsolute(base) ? base : pathApi.join(root, contextualize(base));
}

/** Recursively list files under `base` (relative to `root`, or absolute) matching `pattern`. */
export function scanFiles(
  root: string,
  base: string,
  pattern: RegExp,
  options: { contextualize?: (path: string) => string; allows?: (path: string) => boolean } = {},
): string[] {
  const start = resolveScanRoot(root, base, options.contextualize);
  if (!existsSync(start)) return [];
  const allows = options.allows || (() => true);
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (SKIPPED_ENTRIES.includes(entry)) continue;
      const path = nodePath.join(directory, entry);
      const info = statSync(path);
      if (info.isDirectory()) visit(path);
      else if (pattern.test(path) && allows(path)) result.push(path);
    }
  };
  visit(start);
  return result.sort();
}
