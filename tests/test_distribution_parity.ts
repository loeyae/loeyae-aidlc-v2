#!/usr/bin/env tsx
/**
 * test_distribution_parity.ts — Regression test for parity between sources
 * (core/ + harness/<name>/) and every built harness in dist/<name>/.
 *
 * Unlike the previous hand-maintained mapping table, this test loads each
 * harness manifest.ts directly — the manifest is the single source of truth
 * for what ships, so the test cannot silently drift from the build.
 *
 * Coverage (E14/E28):
 *   1. coreDirs  — every file under core/<src> is present in dist and byte-identical
 *   2. harnessFiles — every harness-authored file is present in dist and byte-identical
 *   3. extras    — no unexpected files in dist/<name> (drift / stale-build detection)
 *   4. stage-graph.json — present in each dist, matches core compiled graph, no compiled_at
 *
 * Run: tsx tests/test_distribution_parity.ts   (or `bun test` via package.json `test`)
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname, relative, basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { HarnessManifest } from "../scripts/manifest-types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CORE = join(ROOT, "core");
const HARNESS = join(ROOT, "harness");
const DIST = join(ROOT, "dist");

const ALL_HARNESSES = readdirSync(HARNESS).filter((d) =>
  existsSync(join(HARNESS, d, "manifest.ts")),
);

/** Recursively collect files under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Byte-compare two files. */
function sameBytes(a: string, b: string): boolean {
  if (!existsSync(b)) return false;
  return readFileSync(a).equals(readFileSync(b));
}

interface CheckResult {
  harness: string;
  checked: number;
  failures: string[];
}

async function checkHarness(name: string): Promise<CheckResult> {
  const failures: string[] = [];
  let checked = 0;

  const manifestPath = join(HARNESS, name, "manifest.ts");
  // manifest.ts is ESM; load via file:// URL (Windows-safe, avoids
  // ERR_UNSUPPORTED_ESM_URL_SCHEME on bare drive-letter paths).
  const mod = (await import(pathToFileURL(manifestPath).href)) as { default: HarnessManifest };
  const manifest = mod.default;
  const outDir = join(DIST, name);
  const harnessOutDir = join(outDir, manifest.harnessDir);

  if (!existsSync(outDir)) {
    failures.push(`${name}: dist/${name} missing — run \`tsx scripts/build.ts --all\``);
    return { harness: name, checked: 0, failures };
  }

  // 1. coreDirs — every core source file must land in dist, byte-identical.
  for (const mapping of manifest.coreDirs) {
    const srcRoot = join(CORE, mapping.src);
    const dstRoot = join(harnessOutDir, mapping.dst);
    if (!existsSync(srcRoot)) {
      failures.push(`${name}: core source missing core/${mapping.src}`);
      continue;
    }
    if (!existsSync(dstRoot)) {
      failures.push(`${name}: dist destination missing ${manifest.harnessDir}/${mapping.dst}`);
      continue;
    }
    for (const srcFile of walk(srcRoot)) {
      const rel = relative(srcRoot, srcFile);
      const dstFile = join(dstRoot, rel);
      checked++;
      if (!sameBytes(srcFile, dstFile)) {
        failures.push(`${name}: mismatch core/${mapping.src}/${rel} ↔ ${manifest.harnessDir}/${mapping.dst}/${rel}`);
      }
    }
  }

  // 2. harnessFiles — every harness-authored file must land in dist, byte-identical.
  for (const file of manifest.harnessFiles) {
    const src = join(HARNESS, name, file.src);
    const dstBase = file.projectRoot ? outDir : harnessOutDir;
    const dst = join(dstBase, file.dst);
    checked++;
    if (!existsSync(src)) {
      failures.push(`${name}: harness source missing harness/${name}/${file.src}`);
      continue;
    }
    if (!sameBytes(src, dst)) {
      failures.push(`${name}: mismatch harness/${name}/${file.src} ↔ ${relative(outDir, dst) || file.dst}`);
    }
  }

  // 3. extras — files present in dist/<name> that no mapping accounts for.
  //    stage-graph.json is compiled in at build time (not a 1:1 source copy), so
  //    it is the only allowed non-source artifact.
  const expected = new Set<string>();
  for (const mapping of manifest.coreDirs) {
    const srcRoot = join(CORE, mapping.src);
    const dstRoot = join(harnessOutDir, mapping.dst);
    for (const srcFile of walk(srcRoot)) {
      expected.add(join(dstRoot, relative(srcRoot, srcFile)));
    }
  }
  for (const file of manifest.harnessFiles) {
    const dstBase = file.projectRoot ? outDir : harnessOutDir;
    expected.add(join(dstBase, file.dst));
  }
  for (const dstFile of walk(outDir)) {
    if (basename(dstFile) === "stage-graph.json") continue; // compiled artifact
    if (!expected.has(dstFile)) {
      failures.push(`${name}: unexpected extra file ${relative(outDir, dstFile)}`);
    }
  }

  // 4. stage-graph.json — present, matches core compiled graph, no compiled_at leak.
  const coreGraph = join(CORE, "tools", "data", "stage-graph.json");
  const distGraph = join(harnessOutDir, "tools", "data", "stage-graph.json");
  checked++;
  if (existsSync(coreGraph)) {
    const coreData = JSON.parse(readFileSync(coreGraph, "utf-8"));
    if ("compiled_at" in coreData) {
      failures.push(`core: stage-graph.json must not contain compiled_at`);
    }
    if (!existsSync(distGraph)) {
      failures.push(`${name}: stage-graph.json missing in dist`);
    } else if (!sameBytes(coreGraph, distGraph)) {
      failures.push(`${name}: stage-graph.json in dist differs from core compiled graph`);
    }
  }

  return { harness: name, checked, failures };
}

async function main(): Promise<void> {
  let totalChecked = 0;
  const allFailures: string[] = [];

  for (const name of ALL_HARNESSES) {
    const { checked, failures } = await checkHarness(name);
    totalChecked += checked;
    if (failures.length) {
      allFailures.push(`\n[${name}]`);
      allFailures.push(...failures.map((f) => `  ${f}`));
    }
  }

  if (allFailures.length) {
    throw new Error(
      `Distribution parity FAILED (${totalChecked} files checked across ${ALL_HARNESSES.length} harnesses):\n${allFailures.join("\n")}`,
    );
  }
  console.log(
    `Distribution parity passed (${totalChecked} files across ${ALL_HARNESSES.length} harnesses; core + harness-authored + drift check)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
