/** Validate release bytes from Git, never from ignored local runtime data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const ref = process.argv[2]; // Optional historical commit for a negative reproduction.
const git = args => execFileSync('git', args, { windowsHide: true, timeout: 10000 });
const files = git(ref ? ['ls-tree', '-r', '--name-only', ref, '--', 'core/tools/data'] : ['ls-files', '--cached', '--', 'core/tools/data'])
  .toString().trim().split(/\r?\n/);
for (const name of ['native-host-action-policy.json', 'functional-checker-tsconfig.json']) {
  assert(files.includes('core/tools/data/' + name), `Git release omits required runtime data: ${name}`);
}
// Every JSON shipped from the local runtime data tree must have a release source.
function checkTracked(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = dir + '/' + e.name;
    if (e.isDirectory()) checkTracked(file);
    else if (e.name.endsWith('.json')) assert(files.includes(file), `Local-only runtime data masks release omission: ${file}`);
  }
}
checkTracked('core/tools/data');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-git-runtime-'));
try {
  for (const file of [...files, 'core/tools/aidlc-owned-resource.cjs']) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git(['show', (ref || '') + ':' + file]));
  }
  const child = spawnSync(process.execPath, ['-e', "const r=require('./core/tools/aidlc-owned-resource.cjs'); if(typeof r.ownChild!=='function') process.exit(1);"], {
    cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true, env: { ...process.env, NODE_PATH: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'core/tools/data/functional-checker-tsconfig.json')));
  assert.equal(config.compilerOptions.moduleResolution, 'bundler');
  console.log(`PASS: ${files.length} runtime data files in Git; isolated resource module loads without checkout files`);
} finally {
  // Only the exact mkdtemp directory created by this test is removed.
  fs.rmSync(root, { recursive: true, force: true });
}
