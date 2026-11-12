/** Short local critical sections only. Never infer dead ownership from lock age. */
import { openSync, closeSync, writeFileSync, readFileSync, fsyncSync, unlinkSync, existsSync, lstatSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
type Owner = { version: number; pid: number; hostname: string; lock_id: string };
function read(path: string): Owner {
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) throw Error();
    const owner = JSON.parse(readFileSync(path, "utf8"));
    if (owner.version !== 1 || owner.hostname !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.lock_id !== "string" || !owner.lock_id) throw Error();
    return owner;
  } catch { throw Error(`LOCK_OWNER_UNKNOWN: ${path}; inspect the owner before explicit reconciliation`); }
}
function alive(owner: Owner): boolean {
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw Error("LOCK_OWNER_UNKNOWN: cannot verify process absence"); }
}
export function acquireOwnedLock(path: string, timeoutMs = 1000): () => void {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 3000) throw Error("LOCK_WAIT_INVALID");
  const until = performance.now() + timeoutMs;
  const owner: Owner = { version: 1, pid: process.pid, hostname: hostname(), lock_id: randomUUID() };
  const wait = () => { if (performance.now() >= until) throw Error(`LOCK_BUSY: ${path}; owner is active, retry the operation`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, until - performance.now())); };
  for (;;) {
    let fd: number;
    try { fd = openSync(path, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (!existsSync(path)) continue;
      // The owner may still be publishing its short header. Wait only within
      // the same bound; persistent empty/legacy/foreign records stay unknown.
      let previous: Owner;
      try { previous = read(path); } catch (unknown) { const remaining = until - performance.now(); if (remaining <= 0) throw unknown; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, remaining)); continue; }
      if (alive(previous)) { wait(); continue; }
      let guard: number;
      try { guard = openSync(path + ".recovery", "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; throw Error(`LOCK_RECOVERY_UNKNOWN: ${path}.recovery`); }
      try {
        if (existsSync(path)) { const current = read(path); if (current.lock_id !== previous.lock_id || alive(current)) { wait(); continue; } unlinkSync(path); }
      } finally { closeSync(guard); unlinkSync(path + ".recovery"); }
      continue;
    }
    try { writeFileSync(fd, JSON.stringify(owner)); fsyncSync(fd); }
    catch (error) { closeSync(fd); unlinkSync(path); throw error; }
    return () => {
      closeSync(fd);
      if (!existsSync(path) || read(path).lock_id !== owner.lock_id) throw Error("LOCK_OWNERSHIP_CHANGED: preserve replacement lock");
      unlinkSync(path);
    };
  }
}
