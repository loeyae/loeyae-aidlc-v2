import { existsSync, readdirSync, statSync } from "fs";
import * as nodePath from "path";

type PathApi = Pick<typeof nodePath, "isAbsolute" | "join">;

const SKIPPED_ENTRIES = [".git", "node_modules", "dist", "build", "target", ".aidlc/evidence"];

/**
 * Source languages whose files carry REQ / UC-D trace markers. Shared by the
 * traceability-matrix code/test layers and the test-quality test-file scan so the
 * two gates never disagree about which languages count.
 */
export const SOURCE_EXTENSIONS: readonly string[] = ["java", "kt", "ts", "tsx", "js", "jsx", "vue", "py", "go", "rs", "cs"];
const EXTENSION_GROUP = "(?:" + SOURCE_EXTENSIONS.join("|") + ")";
/** Any source file in a supported language. */
export const SOURCE_FILE_PATTERN = new RegExp("\\." + EXTENSION_GROUP + "$", "i");
/**
 * A test source file: the file name (not a parent directory) contains test/spec.
 * Both separators are excluded so a Windows absolute path such as
 * C:\tmp\aidlc-tests\app\x.py is not mistaken for a test file.
 */
export const TEST_FILE_PATTERN = new RegExp("(?:test|spec)[^/\\\\]*\\." + EXTENSION_GROUP + "$", "i");

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
