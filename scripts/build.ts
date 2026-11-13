#!/usr/bin/env bun
/**
 * build.ts — Unified packager that compiles core/ + harness/<name>/ into dist/<name>/
 *
 * Usage:
 *   node --import tsx scripts/build.ts --harness kiro-crew
 *   node --import tsx scripts/build.ts --all
 *
 * Steps per harness:
 *   1. Load harness/<name>/manifest.ts
 *   2. Clean dist/<name>/
 *   3. Copy coreDirs from core/ into dist/<name>/<harnessDir>/
 *   4. Copy harnessFiles from harness/<name>/ into dist/<name>/
 *   5. Apply rulesRename if configured
 *   6. Generate the entry from core/ENTRY.md and report the result
 * dist is disposable build output, included in release tarballs, never in Git.
 */

import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname, relative, isAbsolute } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { HarnessManifest } from "./manifest-types.ts";
import { generateMethods } from "./generate-methods.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CORE_DIR = join(ROOT, "core");
const HARNESS_DIR = join(ROOT, "harness");
const DIST_DIR = join(ROOT, "dist");

const ALL_HARNESSES = readdirSync(HARNESS_DIR).filter((d) =>
  existsSync(join(HARNESS_DIR, d, "manifest.ts"))
);

function parseArgs(): { harnesses: string[]; all: boolean } {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--all") {
    return { harnesses: ALL_HARNESSES, all: true };
  }
  const idx = args.indexOf("--harness");
  if (args.length === 2 && idx === 0 && ALL_HARNESSES.includes(args[1])) {
    return { harnesses: [args[1]], all: false };
  }
  console.error("Usage: node --import tsx scripts/build.ts --harness <known name> | --all");
  process.exit(1);
}

async function buildHarness(name: string) {
  const manifestPath = join(HARNESS_DIR, name, "manifest.ts");
  if (!existsSync(manifestPath)) {
    console.error(`❌ No manifest found at ${manifestPath}`);
    process.exit(1);
  }

  // Windows: dynamic import() requires a file:// URL, not a bare Windows
  // path (e.g. "E:\...\manifest.ts" → ERR_UNSUPPORTED_ESM_URL_SCHEME).
  // pathToFileURL handles drive letters and backslashes portably.
  const mod = await import(pathToFileURL(manifestPath).href);
  const manifest: HarnessManifest = mod.default;
  const outDir = join(DIST_DIR, name);

  console.log(`\n🔨 Building harness: ${name}`);
  console.log(`   Output: ${outDir}`);

  const rel = relative(DIST_DIR, outDir);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw Error("Unsafe distribution output");
  // Clean
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  mkdirSync(outDir, { recursive: true });

  const harnessOutDir = join(outDir, manifest.harnessDir);
  mkdirSync(harnessOutDir, { recursive: true });

  // Copy core dirs
  let coreCount = 0;
  for (const mapping of manifest.coreDirs) {
    const src = join(CORE_DIR, mapping.src);
    const dst = join(harnessOutDir, mapping.dst);
    if (existsSync(src)) {
      cpSync(src, dst, { recursive: true });
      coreCount++;
    } else {
      throw new Error(`Core dir not found: ${mapping.src}`);
    }
  }

  // Copy harness-authored files
  let harnessCount = 0;
  for (const file of manifest.harnessFiles) {
    const src = join(HARNESS_DIR, name, file.src);
    const dstBase = file.projectRoot ? outDir : harnessOutDir;
    const dst = join(dstBase, file.dst);
    if (existsSync(src)) {
      const dstDir = join(dst, "..");
      mkdirSync(dstDir, { recursive: true });
      cpSync(src, dst);
      harnessCount++;
    } else {
      throw new Error(`Harness file not found: ${file.src}`);
    }
  }

  const entryPath = join(outDir, manifest.skillEntryPath);
  const prefix = relative(dirname(entryPath), harnessOutDir).replaceAll("\\", "/");
  const entry = readFileSync(join(CORE_DIR, "ENTRY.md"), "utf8").replaceAll("{{root}}", prefix ? prefix + "/" : "");
  mkdirSync(dirname(entryPath), { recursive: true });
  writeFileSync(entryPath, entry);
  console.log(`   ✅ Done: ${coreCount} core dirs, ${harnessCount} harness files`);
}

async function main() {
  const { harnesses, all } = parseArgs();
  // Validate the exact generated root before removing stale hosts or orphan files.
  // A release must not accidentally package output left over from an older version.
  if (all) {
    if (relative(ROOT, DIST_DIR) !== "dist") throw Error("Unsafe distribution root");
    rmSync(DIST_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  generateMethods(ROOT);
  console.log(`🏗️  Loeyae AI-DLC Builder`);
  console.log(`   Harnesses: ${harnesses.join(", ")}`);

  for (const h of harnesses) {
    await buildHarness(h);
  }

  console.log(`\n✨ Build complete.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
