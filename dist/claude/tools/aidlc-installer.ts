import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { createHash, randomBytes } from "crypto";
import { dirname } from "path";
import { homedir } from "os";
import path from "path";

export interface ManagedAsset {
  source: string;
  target: string;
  kind: "file" | "directory";
}

interface ManagedEntry {
  path: string;
  kind: "file" | "directory";
  sha256?: string;
}

interface AssetRecord {
  target: string;
  kind: "file" | "directory";
  entries: ManagedEntry[];
}

interface OwnershipManifest {
  schema_version: 1;
  owner: string;
  installed_at: string;
  assets: AssetRecord[];
}

const INSTALL_STATE_DIR = process.env.AIDLC_INSTALL_STATE_DIR
  ? path.resolve(process.env.AIDLC_INSTALL_STATE_DIR)
  : path.join(homedir(), ".config", "loeyae-aidlc", "installations");

function digestFile(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function collectEntries(root: string, expectedKind: "file" | "directory"): ManagedEntry[] {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error(`managed asset cannot be a symlink: ${root}`);
  if ((expectedKind === "file" && !rootStat.isFile()) || (expectedKind === "directory" && !rootStat.isDirectory())) {
    throw new Error(`managed asset type mismatch: ${root}`);
  }
  if (expectedKind === "file") return [{ path: ".", kind: "file", sha256: digestFile(root) }];
  const entries: ManagedEntry[] = [];
  function walk(directory: string, relative: string): void {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`managed asset cannot contain symlinks: ${absolute}`);
      if (stat.isDirectory()) {
        entries.push({ path: childRelative, kind: "directory" });
        walk(absolute, childRelative);
      } else if (stat.isFile()) {
        entries.push({ path: childRelative, kind: "file", sha256: digestFile(absolute) });
      } else {
        throw new Error(`managed asset contains unsupported entry: ${absolute}`);
      }
    }
  }
  walk(root, "");
  return entries;
}

function copyAsset(asset: ManagedAsset, destination: string): void {
  const sourceStat = lstatSync(asset.source);
  if (sourceStat.isSymbolicLink()) throw new Error(`install source cannot be a symlink: ${asset.source}`);
  if (asset.kind === "file") {
    if (!sourceStat.isFile()) throw new Error(`install source is not a file: ${asset.source}`);
    copyFileSync(asset.source, destination);
    return;
  }
  if (!sourceStat.isDirectory()) throw new Error(`install source is not a directory: ${asset.source}`);
  mkdirSync(destination, { recursive: false });
  function copyDirectory(source: string, target: string): void {
    for (const name of readdirSync(source).sort()) {
      const sourceChild = path.join(source, name);
      const targetChild = path.join(target, name);
      const stat = lstatSync(sourceChild);
      if (stat.isSymbolicLink()) throw new Error(`install source cannot contain symlinks: ${sourceChild}`);
      if (stat.isDirectory()) {
        mkdirSync(targetChild);
        copyDirectory(sourceChild, targetChild);
      } else if (stat.isFile()) {
        copyFileSync(sourceChild, targetChild);
      } else {
        throw new Error(`install source contains unsupported entry: ${sourceChild}`);
      }
    }
  }
  copyDirectory(asset.source, destination);
}

function manifestPath(owner: string, targets: string[]): string {
  const identity = `${owner}\0${targets.map((target) => path.resolve(target)).sort().join("\0")}`;
  return path.join(INSTALL_STATE_DIR, `${createHash("sha256").update(identity).digest("hex")}.json`);
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireGlobalLock(): { path: string; fd: number } {
  mkdirSync(INSTALL_STATE_DIR, { recursive: true });
  const lockPath = path.join(INSTALL_STATE_DIR, ".install.lock");
  const started = Date.now();
  while (true) {
    try {
      return { path: lockPath, fd: openSync(lockPath, "wx", 0o600) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > 5000) throw new Error(`timed out waiting for installer lock: ${lockPath}`);
      sleep(25);
    }
  }
}

function releaseGlobalLock(lock: { path: string; fd: number }): void {
  closeSync(lock.fd);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeSync(fd, content, undefined, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function parseManifest(file: string): OwnershipManifest {
  const value = JSON.parse(readFileSync(file, "utf8")) as OwnershipManifest;
  if (value.schema_version !== 1 || typeof value.owner !== "string" || !Array.isArray(value.assets)) {
    throw new Error(`invalid installation ownership manifest: ${file}`);
  }
  return value;
}

function verifyRecord(record: AssetRecord): void {
  if (!existsSync(record.target)) throw new Error(`managed install asset is missing: ${record.target}`);
  const actual = collectEntries(record.target, record.kind);
  if (JSON.stringify(actual) !== JSON.stringify(record.entries)) {
    throw new Error(`managed install asset was modified; refusing to overwrite or uninstall: ${record.target}`);
  }
}

function validateAssets(assets: ManagedAsset[]): ManagedAsset[] {
  if (assets.length === 0) throw new Error("at least one managed asset is required");
  const normalized = assets.map((asset) => ({ ...asset, source: path.resolve(asset.source), target: path.resolve(asset.target) }));
  const targets = new Set<string>();
  for (const asset of normalized) {
    if (targets.has(asset.target)) throw new Error(`duplicate managed install target: ${asset.target}`);
    targets.add(asset.target);
    if (!existsSync(asset.source)) throw new Error(`install source does not exist: ${asset.source}`);
    if (asset.target === asset.source || asset.target.startsWith(`${asset.source}${path.sep}`)) {
      throw new Error(`install target cannot overlap source: ${asset.target}`);
    }
  }
  return normalized;
}

export function installManagedAssets(owner: string, inputAssets: ManagedAsset[], activate?: () => void): string {
  const assets = validateAssets(inputAssets);
  const manifestFile = manifestPath(owner, assets.map((asset) => asset.target));
  const lock = acquireGlobalLock();
  const stages: string[] = [];
  const backups = new Map<string, string>();
  const committed: string[] = [];
  const previousManifest = existsSync(manifestFile) ? readFileSync(manifestFile, "utf8") : undefined;
  let manifestChanged = false;
  try {
    if (previousManifest) {
      const previous = parseManifest(manifestFile);
      if (previous.owner !== owner) throw new Error(`installation owner mismatch: ${manifestFile}`);
      if (JSON.stringify(previous.assets.map((asset) => asset.target).sort()) !== JSON.stringify(assets.map((asset) => asset.target).sort())) {
        throw new Error(`installation target set changed unexpectedly: ${manifestFile}`);
      }
      previous.assets.forEach(verifyRecord);
    } else {
      for (const asset of assets) {
        if (!existsSync(asset.target)) continue;
        const stat = lstatSync(asset.target);
        const isEmptyDirectory = stat.isDirectory() && !stat.isSymbolicLink() && readdirSync(asset.target).length === 0;
        if (!isEmptyDirectory) throw new Error(`refusing to replace unowned install target: ${asset.target}`);
      }
    }

    for (const asset of assets) {
      mkdirSync(dirname(asset.target), { recursive: true });
      const stage = path.join(dirname(asset.target), `.${path.basename(asset.target)}.loeyae-stage-${process.pid}-${randomBytes(4).toString("hex")}`);
      copyAsset(asset, stage);
      stages.push(stage);
    }
    const records: AssetRecord[] = assets.map((asset, index) => ({
      target: asset.target,
      kind: asset.kind,
      entries: collectEntries(stages[index], asset.kind),
    }));

    assets.forEach((asset) => {
      if (!existsSync(asset.target)) return;
      const backup = path.join(dirname(asset.target), `.${path.basename(asset.target)}.loeyae-backup-${process.pid}-${randomBytes(4).toString("hex")}`);
      renameSync(asset.target, backup);
      backups.set(asset.target, backup);
    });
    if (process.env.AIDLC_INSTALL_FAILPOINT === "after-backup") throw new Error("installer failpoint after-backup");
    assets.forEach((asset, index) => {
      renameSync(stages[index], asset.target);
      committed.push(asset.target);
    });
    if (process.env.AIDLC_INSTALL_FAILPOINT === "after-assets") throw new Error("installer failpoint after-assets");
    if (activate) activate();

    const manifest: OwnershipManifest = {
      schema_version: 1,
      owner,
      installed_at: new Date().toISOString(),
      assets: records,
    };
    atomicWrite(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    manifestChanged = true;
    for (const backup of backups.values()) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        process.stderr.write(`Warning: installed successfully but could not remove backup ${backup}: ${String(error)}\n`);
      }
    }
    return manifestFile;
  } catch (error) {
    for (const target of committed.reverse()) {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    }
    for (const [target, backup] of backups) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    }
    for (const stage of stages) {
      if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    }
    if (manifestChanged) {
      if (previousManifest === undefined) {
        if (existsSync(manifestFile)) unlinkSync(manifestFile);
      } else {
        atomicWrite(manifestFile, previousManifest);
      }
    }
    throw error;
  } finally {
    releaseGlobalLock(lock);
  }
}

export function uninstallManagedAssets(owner: string, targets: string[], deactivate?: () => void): boolean {
  const normalizedTargets = targets.map((target) => path.resolve(target));
  const manifestFile = manifestPath(owner, normalizedTargets);
  const lock = acquireGlobalLock();
  const backups = new Map<string, string>();
  try {
    if (!existsSync(manifestFile)) return false;
    const manifest = parseManifest(manifestFile);
    if (manifest.owner !== owner) throw new Error(`installation owner mismatch: ${manifestFile}`);
    if (JSON.stringify(manifest.assets.map((asset) => asset.target).sort()) !== JSON.stringify(normalizedTargets.sort())) {
      throw new Error(`installation targets do not match ownership manifest: ${manifestFile}`);
    }
    manifest.assets.forEach(verifyRecord);
    for (const asset of manifest.assets) {
      const backup = path.join(dirname(asset.target), `.${path.basename(asset.target)}.loeyae-uninstall-${process.pid}-${randomBytes(4).toString("hex")}`);
      renameSync(asset.target, backup);
      backups.set(asset.target, backup);
    }
    if (process.env.AIDLC_INSTALL_FAILPOINT === "uninstall-after-backup") throw new Error("installer failpoint uninstall-after-backup");
    if (deactivate) deactivate();
    unlinkSync(manifestFile);
    for (const backup of backups.values()) {
      try {
        rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        process.stderr.write(`Warning: uninstalled successfully but could not remove backup ${backup}: ${String(error)}\n`);
      }
    }
    return true;
  } catch (error) {
    for (const [target, backup] of backups) {
      if (existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    }
    throw error;
  } finally {
    releaseGlobalLock(lock);
  }
}

export function updateSharedJson<T>(file: string, update: (current: Record<string, unknown>) => { value: Record<string, unknown>; result: T }): T {
  const resolved = path.resolve(file);
  mkdirSync(dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.loeyae-aidlc.lock`;
  const started = Date.now();
  let lockFd: number;
  while (true) {
    try {
      lockFd = openSync(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30000) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > 5000) throw new Error(`timed out waiting for JSON config lock: ${lockPath}`);
      sleep(25);
    }
  }
  try {
    const current = existsSync(resolved) ? JSON.parse(readFileSync(resolved, "utf8")) : {};
    if (typeof current !== "object" || current === null || Array.isArray(current)) throw new Error(`JSON config must be an object: ${resolved}`);
    const { value, result } = update(current as Record<string, unknown>);
    atomicWrite(resolved, `${JSON.stringify(value, null, 2)}\n`);
    return result;
  } finally {
    closeSync(lockFd!);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}
