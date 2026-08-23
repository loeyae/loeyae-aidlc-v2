#!/usr/bin/env bun
/**
 * build.ts — Unified packager that compiles core/ + harness/<name>/ into dist/<name>/
 *
 * Usage:
 *   bun scripts/build.ts --harness kiro-crew    # build one harness
 *   bun scripts/build.ts --all                  # build all harnesses
 *
 * Steps per harness:
 *   1. Load harness/<name>/manifest.ts
 *   2. Clean dist/<name>/
 *   3. Copy coreDirs from core/ into dist/<name>/<harnessDir>/
 *   4. Copy harnessFiles from harness/<name>/ into dist/<name>/
 *   5. Apply rulesRename if configured
 *   6. Compile stage graph (core/tools/aidlc-graph.ts compile)
 *   7. Report summary
 */

import { existsSync, mkdirSync, cpSync, rmSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { compile as compileGraph } from "../core/tools/aidlc-graph";
import type { HarnessManifest } from "./manifest-types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CORE_DIR = join(ROOT, "core");
const HARNESS_DIR = join(ROOT, "harness");
const DIST_DIR = join(ROOT, "dist");

const ALL_HARNESSES = readdirSync(HARNESS_DIR).filter((d) =>
  existsSync(join(HARNESS_DIR, d, "manifest.ts"))
);

function parseArgs(): { harnesses: string[] } {
  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    return { harnesses: ALL_HARNESSES };
  }
  const idx = args.indexOf("--harness");
  if (idx >= 0 && args[idx + 1]) {
    return { harnesses: [args[idx + 1]] };
  }
  console.error("Usage: bun scripts/build.ts --harness <name> | --all");
  process.exit(1);
}

async function buildHarness(name: string) {
  const manifestPath = join(HARNESS_DIR, name, "manifest.ts");
  if (!existsSync(manifestPath)) {
    console.error(`❌ No manifest found at ${manifestPath}`);
    process.exit(1);
  }

  const mod = await import(manifestPath);
  const manifest: HarnessManifest = mod.default;
  const outDir = join(DIST_DIR, name);

  console.log(`\n🔨 Building harness: ${name}`);
  console.log(`   Output: ${outDir}`);

  // Clean
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true });
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

  // Apply rulesRename (if any stage files use "rules/" paths)
  if (manifest.rulesRename) {
    const rulesDir = join(harnessOutDir, "rules");
    const renamedDir = join(harnessOutDir, manifest.rulesRename);
    if (existsSync(rulesDir)) {
      cpSync(rulesDir, renamedDir, { recursive: true });
      rmSync(rulesDir, { recursive: true });
    }
  }

  console.log(`   ✅ Done: ${coreCount} core dirs, ${harnessCount} harness files`);
}

async function main() {
  compileGraph();
  const { harnesses } = parseArgs();
  console.log(`🏗️  Loeyae AI-DLC v2 Builder`);
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
