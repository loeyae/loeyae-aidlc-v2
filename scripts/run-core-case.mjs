import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const coreCases = {
  "tests/test_v4_7_0_baseline_advance.ts": ["e2e: split", "e2e (4.7.1):", "4.7.1: a done", "state:", "single unit, never advanced:"],
  "tests/test_v4_8_0_unit_ucd_scope.ts": ["e2e: split", "reconciliation:", "empty subset:", "characterization subset:", "compat: two units"],
  "tests/test_v4_9_0_nested_repo.ts": ["RED→GREEN:", "compat: nested", "GREEN: next", "negative:", "dirty:", "A: advanced", "B/C/C2/B2:", "E: a project", "B1: worktree"],
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, selected] = process.argv.slice(2);
  if (process.argv.length !== 4 || !coreCases[file]?.includes(selected)) {
    console.error("Usage: node scripts/run-core-case.mjs <registered test file> <registered case filter>");
    process.exit(2);
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, file)], {
    cwd: root, env: { ...process.env, AIDLC_ONLY: selected }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
  if (result.error) console.error(result.error.message);
  const selectedPasses = (result.stdout || "").split(/\r?\n/).filter(line => line.startsWith("  ok ") && line.includes(selected));
  if (result.status === 0 && selectedPasses.length !== 1) {
    console.error(`Expected exactly one executed case for ${selected}; observed ${selectedPasses.length}`);
    process.exitCode = 1;
  } else process.exitCode = result.status ?? 1;
}
