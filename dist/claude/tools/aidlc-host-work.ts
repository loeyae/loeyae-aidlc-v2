/** Optional, read-only context for native host execution. No workflow authority. */
import { existsSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, relative, isAbsolute, sep, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface HostWorkOptions {
  work?: string;
  from?: string;
  paths?: string[];
  inputs?: string[];
  details?: boolean;
}

function preview(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  return bytes.length <= maxBytes ? value : new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true });
}

function localPath(root: string, value: string): string {
  if (!value.trim() || isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes("\0")) throw Error("Expected a repository-relative path");
  const full = resolve(root, value), rel = relative(root, full);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw Error("Path leaves the project");
  // Do not silently read another project through a linked document/directory.
  for (let cursor = full; cursor !== root; cursor = dirname(cursor)) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error("Linked input requires an explicit host read");
  }
  return rel.replaceAll(sep, "/") || ".";
}

export function hostWorkContext(project: string, options: HostWorkOptions = {}) {
  const root = resolve(project);
  const paths = (options.paths || []).map(p => localPath(root, p));
  if (options.from && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(options.from)) throw Error("--from requires a full Git commit ID");
  if ((options.inputs?.length || 0) > 8) throw Error("Read at most 8 selected inputs per request");
  const notes: string[] = [];
  function git(args: string[]) {
    try {
      return execFileSync("git", ["--no-optional-locks", "--literal-pathspecs", ...args], {
        cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 256 * 1024,
        windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      }).trimEnd();
    } catch {
      notes.push(`Git view unavailable: ${args[0]}; inspect with host tools. This is not an execution refusal.`);
      return null;
    }
  }
  const inputs = (options.inputs || []).map(value => {
    const path = localPath(root, value), full = resolve(root, path);
    if (!existsSync(full)) return { path, status: "missing", text: null, truncated: false };
    if (!lstatSync(full).isFile()) throw Error("Input must be a file");
    const buffer = Buffer.alloc(4097), fd = openSync(full, "r");
    let size: number;
    try { size = readSync(fd, buffer, 0, buffer.length, 0); } finally { closeSync(fd); }
    return { path, status: "read", text: buffer.subarray(0, Math.min(size, 4096)).toString("utf8"), truncated: size > 4096 };
  });
  const status = git(["status", "--short", "--untracked-files=normal", "--", ...paths]);
  const statusLines = status ? status.split(/\r?\n/) : [];
  const statusPreview = status === null ? null : options.details ? status : preview(statusLines.slice(0, 20).join("\n"), 2048);
  const changes = git(["diff", "--no-ext-diff", "--no-textconv", options.details ? "--stat" : "--shortstat", options.from || "HEAD", "--", ...paths]);
  return {
    mode: "host", work: options.work || null, paths, inputs,
    git: {
      head: git(["rev-parse", "HEAD"]),
      status: statusPreview,
      status_summary: { entries: status === null ? null : statusLines.length, truncated: statusPreview !== status },
      changes: options.details || changes === null ? changes : preview(changes, 1024),
      detail_hint: options.details ? null : "Use --details with --paths for full bounded Git output; no new session or state is required.",
    },
    legacy_records_present: ["aidlc/active/aidlc-state.md", ".aidlc/workflow-registry.json"]
      .some(p => existsSync(resolve(root, p))),
    notes,
    execution: {
      owner: "native-host", permission_source: "user-and-host", ai_dlc_execution_gate: false,
      next: "Use the agreed goal and acceptance criteria; implement, test, review and repair with native tools. This optional view neither grants permission nor requires a stage report.",
      continuity: "Use current code, Git and actual test results. Preserve legacy records and other workers; do not restart or take over an unknown live process.",
    },
    acceptance: {
      business: "not_evaluated", verification: "not_evaluated", performance: "not_measured",
      required: "Check every agreed feature and applicable UI state/size against real behavior. Record actual commands/results and unresolved gaps. Failed tests require repair; missing process records do not forbid work.",
    },
  };
}

export function runHostWorkCli(args: string[]) {
  if (args.includes("--help")) {
    console.log('work [--work <goal>] [--paths <JSON array>] [--from <commit>] [--input <relative-file>] [--details]\nDefault: at most 20 status entries / 2 KiB plus diff totals. --details requests full bounded Git output.\nOptional read-only context; native host executes. No state, claim, grant, probe or timer is created.');
    return;
  }
  const options: HostWorkOptions = { inputs: [] };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--details") { options.details = true; continue; }
    if (!["--work", "--paths", "--from", "--input"].includes(key)) throw Error(`Unknown work argument: ${key}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw Error(`Missing value for ${key}`);
    if (key === "--input") options.inputs!.push(value);
    else if (key === "--paths") {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.some(p => typeof p !== "string")) throw Error("--paths requires a JSON string array");
      options.paths = parsed;
    } else if (key === "--from") options.from = value;
    else options.work = value;
  }
  console.log(JSON.stringify(hostWorkContext(process.cwd(), options), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runHostWorkCli(process.argv.slice(2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
