import { Worker } from "node:worker_threads";

// A worker can report while the main thread is blocked in a synchronous Git
// or checker subprocess. The shared clock records actual progress, not liveness.
let clock: BigInt64Array | undefined;
let phase = 0;
export function markProgress(nextPhase?: number): void {
  if (nextPhase !== undefined) phase = nextPhase;
  if (clock) { Atomics.store(clock, 0, BigInt(Date.now())); Atomics.store(clock, 1, BigInt(phase)); }
}
export function startProgressHeartbeat(intervalMs = 10000): () => void {
  if (process.env.AIDLC_PROGRESS === "0") return () => {};
  const shared = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT * 2);
  clock = new BigInt64Array(shared); markProgress(1);
  let worker: Worker;
  try { worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { writeSync } = require('node:fs');
    const clock = new BigInt64Array(workerData.shared);
    const labels = {1:'checking inputs', 2:'waiting for checker subprocess', 3:'validating candidate', 4:'publishing', 5:'scanning main repository', 6:'scanning nested repository'};
    const start = Date.now();
    setInterval(() => {
      const now = Date.now(), last = Number(Atomics.load(clock, 0)), phase = Number(Atomics.load(clock, 1));
      writeSync(2, '[aidlc] heartbeat: ' + (labels[phase] || 'processing') + '; elapsed=' + ((now-start)/1000).toFixed(1) + 's; last_progress=' + new Date(last).toISOString() + '; no_progress=' + ((now-last)/1000).toFixed(1) + 's\\n');
    }, workerData.intervalMs);
  `, { eval: true, workerData: { shared, intervalMs } }); }
  catch (error) {
    clock = undefined;
    process.stderr.write(`[aidlc] heartbeat unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    return () => {};
  }
  worker.on("error", error => process.stderr.write(`[aidlc] heartbeat unavailable: ${error.message}\n`));
  worker.unref();
  return () => { clock = undefined; void worker.terminate(); };
}
