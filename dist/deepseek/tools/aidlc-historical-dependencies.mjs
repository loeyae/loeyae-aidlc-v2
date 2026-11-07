/** Byte hashing with bounded concurrent reads; stdout is one deterministic summary. */
import { createHash } from 'node:crypto';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Node creates its I/O pool before ESM evaluation. Start the byte reader with an
// explicit bounded pool; otherwise 24 promises still share four filesystem threads.
if (process.env.AIDLC_DEPENDENCY_HASH_WORKER !== '1') {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), process.argv[2]], {
    stdio: 'inherit', env: { ...process.env, UV_THREADPOOL_SIZE: '24', AIDLC_DEPENDENCY_HASH_WORKER: '1' },
  });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const root = realpathSync.native(process.argv[2]);
const visited = new Set();
const events = [];
const files = [];
function visit(path, label, kind) {
  let actual = path;
  if (kind === 'link') {
    actual = realpathSync.native(path);
    events.push(`link:${label}:${actual}\n`);
    const stat = statSync(actual);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported dependency: ${path}`);
    kind = stat.isDirectory() ? 'directory' : 'file';
  }
  if (kind === 'directory') {
    if (visited.has(actual)) { events.push(`cycle:${label}:${actual}\n`); return; }
    visited.add(actual);
    for (const child of readdirSync(actual, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isFile() && !child.isDirectory() && !child.isSymbolicLink()) throw new Error(`Unsupported dependency: ${child.name}`);
      visit(join(actual, child.name), `${label}/${child.name}`, child.isSymbolicLink() ? 'link' : child.isDirectory() ? 'directory' : 'file');
    }
  } else {
    const record = { path: actual, label, hash: '' };
    events.push(record); files.push(record);
    if (process.env.AIDLC_PROGRESS === '1' && files.length % 10000 === 0) process.stderr.write(`[aidlc] historical_replay: enumerated ${files.length} dependency files\n`);
  }
}
visit(root, 'node_modules', 'directory');
if (!files.length) throw new Error('Empty dependency environment');
let next = 0, completed = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  for (;;) {
    const index = next++;
    if (index >= files.length) return;
    const entry = files[index];
    entry.hash = createHash('sha256').update(await readFile(entry.path)).digest('hex');
    completed++;
    if (process.env.AIDLC_PROGRESS === '1' && completed % 10000 === 0) process.stderr.write(`[aidlc] historical_replay: hashed ${completed}/${files.length} actual dependency files\n`);
  }
}));
const hash = createHash('sha256');
for (const event of events) hash.update(typeof event === 'string' ? event : `${event.label}\0${event.hash}\n`);
process.stdout.write(JSON.stringify({ realpath: root, digest: hash.digest('hex'), files: files.length }));
