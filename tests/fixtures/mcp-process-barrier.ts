/** Test-only Node preload. Production CLI has no fault/environment/script execution hook. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const spec = JSON.parse(process.env.AIDLC_TEST_MCP_BARRIER!);
const rename = fs.renameSync;
const read = fs.readFileSync;
let used = false;
function pause() {
  if (used) return;
  used = true;
  fs.writeFileSync(spec.marker, JSON.stringify({ pid: process.pid, point: spec.point }));
  const deadline = Date.now() + 45_000;
  while (!fs.existsSync(`${spec.marker}.continue`)) {
    if (Date.now() > deadline) throw new Error("test barrier timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
fs.renameSync = (from, to) => {
  const destination = String(to);
  const isLedger = destination === `${spec.host}.aidlc-mcp-ledger.json`;
  const pending = isLedger ? JSON.parse(read(from, "utf8")).pending !== null : false;
  if (isLedger && !pending && spec.point === "recovery-before-ledger") pause();
  rename(from, to);
  if ((destination === spec.host && spec.point === "after-config")
    || (destination === `${spec.host}.aidlc-mcp-journal.json` && spec.point === "after-journal")
    || (isLedger && pending && spec.point === "before-config")
    || (isLedger && !pending && spec.point === "after-ledger")) pause();
};
fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
  const value = read(...args);
  if (String(args[0]) === spec.host && spec.point === "read-target") pause();
  return value;
}) as typeof fs.readFileSync;
syncBuiltinESMExports();
