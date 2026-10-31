import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { markProgress, startProgressHeartbeat } from "../core/tools/aidlc-progress";

if (process.argv.includes("--child")) {
  const stop = startProgressHeartbeat(100);
  markProgress(2);
  // A synchronous subprocess blocks the main event loop in production.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  stop();
} else {
  const result = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("tests/test_evidence_progress.ts"), "--child"], { encoding: "utf8", env: { ...process.env, AIDLC_PROGRESS: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /heartbeat: waiting for checker subprocess; elapsed=.*last_progress=.*no_progress=/);
  console.log("PASS heartbeat remains visible while main thread is blocked");
}
