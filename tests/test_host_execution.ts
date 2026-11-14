import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { hostWorkContext } from "../core/tools/aidlc-host-work";

const repo = process.cwd();
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc-host-work-"));
const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc-host-nogit-"));
const records: { check: string; passed: boolean }[] = [];
function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}
function run(command: string, args: string[], cwd = root) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20000, windowsHide: true,
    env: { ...process.env, AIDLC_SESSION_BINDING: "expired-invalid-binding", AIDLC_GRANT_BINDING: "invalid" } });
}
function git(...args: string[]) {
  const result = run("git", args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function cli(...args: string[]) {
  const result = run(process.execPath, [path.join(repo, "bin/cli.js"), "work", ...args]);
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function pass(check: string) { records.push({ check, passed: true }); }
try {
  git("init", "-q");
  write(".gitignore", ".aidlc/\n");
  write("src/orders.cjs", "module.exports=(rows,page,size)=>[];\n");
  write("tests/orders.cjs", "const assert=require('node:assert/strict'); const page=require('../src/orders.cjs'); assert.deepEqual(page([1,2,3,4,5],2,2),[3,4]); assert.deepEqual(page([],1,2),[]); assert.deepEqual(page([1,2],3,2),[]); assert.throws(()=>page([1],0,2));\n");
  git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline");
  const head = git("rev-parse", "HEAD");
  write("aidlc/active/aidlc-state.md", "broken legacy state, expired claim\n");
  write("aidlc/active/audit.md", "HISTORICAL_SENTINEL\n".repeat(10000));
  const state = fs.readFileSync(path.join(root, "aidlc/active/aidlc-state.md"));
  const audit = fs.readFileSync(path.join(root, "aidlc/active/audit.md"));
  const before = git("status", "--porcelain");
  const initial = cli("--work", "order pagination", "--paths", '["src","tests"]', "--from", head);
  assert.equal(initial.mode, "host"); assert.equal(initial.execution.ai_dlc_execution_gate, false);
  assert.equal(initial.acceptance.business, "not_evaluated");
  assert.equal(initial.legacy_records_present, true);
  assert(!JSON.stringify(initial).includes("HISTORICAL_SENTINEL"));
  assert.equal(git("status", "--porcelain"), before);
  pass("CLI remains read-only with corrupt state and invalid expired binding; no history loaded");

  const red = run(process.execPath, ["tests/orders.cjs"]); assert.equal(red.status, 1);
  write("src/orders.cjs", "module.exports=(rows,page,size)=>{if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1)throw Error('invalid page');return rows.slice((page-1)*size,page*size)};\n");
  const green = run(process.execPath, ["tests/orders.cjs"]); assert.equal(green.status, 0, green.stderr);
  const originalCode = fs.readFileSync(path.join(root, "src/orders.cjs"));
  // The host owns actual results. Adding delivery notes neither creates a new
  // authorization cycle nor rewrites the original RED/GREEN result.
  write("delivery/run.md", "Run node tests/orders.cjs\n");
  write("delivery/evidence.md", "Original test exit 0; RED exit 1 preserved by host.\n");
  write("delivery/decisions.md", "Reject invalid page numbers.\n");
  const resumed = cli("--paths", '["src","tests"]');
  assert.equal(resumed.execution.ai_dlc_execution_gate, false);
  assert.equal(resumed.acceptance.verification, "not_evaluated", "view must never invent acceptance");
  assert.deepEqual(fs.readFileSync(path.join(root, "src/orders.cjs")), originalCode);
  assert.deepEqual(fs.readFileSync(path.join(root, "aidlc/active/aidlc-state.md")), state);
  assert.deepEqual(fs.readFileSync(path.join(root, "aidlc/active/audit.md")), audit);
  assert(!fs.existsSync(path.join(root, ".aidlc")), "no grant/probe/receipt/worker state created");
  pass("native RED -> repair -> GREEN -> late delivery documents -> continuation, no AI-DLC execution gate");

  // A real legacy CR is task input, not an instruction to enter managed mode.
  const crPath = "docs/aidlc/change-requests/CR-existing.md";
  write(crPath, "# Existing CR\n- [ ] refresh / re-attest / ui reverify\nLocal verification passed; QA pending. Only uncommitted record.\n");
  const crBefore = fs.readFileSync(path.join(root, crPath));
  const pending = cli("--input", crPath);
  assert.equal(pending.mode, "host");
  assert.equal(pending.execution.ai_dlc_execution_gate, false);
  assert.equal(pending.acceptance.business, "not_evaluated");
  assert.deepEqual(pending.inputs[0].retired_workflow_lines, [2]);
  assert(fs.existsSync(pending.execution.continuity_guide));
  assert.deepEqual(fs.readFileSync(path.join(root, crPath)), crBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, "aidlc/active/aidlc-state.md")), state);
  assert.deepEqual(fs.readFileSync(path.join(root, "aidlc/active/audit.md")), audit);
  assert(!fs.existsSync(path.join(root, ".aidlc")));
  pass("legacy CR input neither selects managed execution, closes pending acceptance nor deletes the only record");

  write("design.md", "design\n".repeat(2000));
  const docs = hostWorkContext(root, { inputs: ["design.md", "missing.md"] });
  assert(docs.inputs[0].truncated); assert(docs.inputs[0].text!.length <= 4096);
  assert(docs.notes.some(note => note.includes("truncated")), "a bounded preview must not imply complete source coverage");
  assert.equal(docs.inputs[1].status, "missing");
  assert.throws(() => hostWorkContext(root, { inputs: ["../secret"] }));
  assert.throws(() => hostWorkContext(root, { paths: ["C:outside"] }));
  assert.throws(() => hostWorkContext(root, { from: "--output=secret" }));
  const unavailable = hostWorkContext(nonGit);
  assert(unavailable.notes.length); assert.equal(unavailable.execution.ai_dlc_execution_gate, false);
  pass("bounded optional document reads, missing inputs/no Git remain diagnostic, traversal rejected");

  // A project can have obsolete entry instructions without any machine state.
  // Detection is limited to chosen inputs; a missing signal is not a clean bill.
  const legacyEntry = path.join(nonGit, "handoff.md");
  fs.writeFileSync(legacyEntry, "# Next\nloeyae-aidlc orchestrate next\nnode scripts/aidlc/cr-engine-4.27.2.mjs inspect\nKeep required CI and the real deployment approval.\n");
  const entryBytes = fs.readFileSync(legacyEntry);
  const withoutInputs = hostWorkContext(nonGit);
  assert(!("continuity_guide" in withoutInputs.execution), "ordinary views do not load the legacy-project guide");
  const selected = hostWorkContext(nonGit, { inputs: ["handoff.md"] });
  assert.equal(selected.legacy_records_present, false);
  assert.deepEqual(selected.inputs[0].retired_workflow_lines, [2, 3]);
  assert(fs.existsSync(selected.execution.continuity_guide!));
  assert.equal(selected.completion.overall, "not_evaluated");
  assert.equal(selected.completion.permissions_granted, false);
  assert.equal(selected.execution.ai_dlc_execution_gate, false);
  assert.deepEqual(fs.readFileSync(legacyEntry), entryBytes);
  assert.deepEqual(fs.readdirSync(nonGit), ["handoff.md"], "context must not create a migration ledger or edit project rules");
  fs.writeFileSync(legacyEntry, "Approved release needs CI, security review and deployment permission.\n");
  const projectPolicy = hostWorkContext(nonGit, { inputs: ["handoff.md"] });
  assert(!projectPolicy.inputs[0].retired_workflow_lines, "ordinary approval/CI requirements are not obsolete AIDLC commands");
  fs.writeFileSync(legacyEntry, "x".repeat(5000) + "\nloeyae-aidlc orchestrate next\n");
  const hidden = hostWorkContext(nonGit, { inputs: ["handoff.md"] });
  assert(hidden.inputs[0].truncated); assert(!hidden.inputs[0].retired_workflow_lines);
  pass("selected legacy references are diagnostic only; current policy and unseen content never become waived requirements");

  for (let i = 0; i < 200; i++) write(`change-${String(i).padStart(3, "0")}-${"x".repeat(70)}.txt`, "changed\n");
  const compact = cli();
  const detail = cli("--details");
  assert(Buffer.byteLength(JSON.stringify(compact, null, 2)) < 8192);
  assert(compact.git.status_summary.entries >= 200);
  assert.equal(compact.git.status_summary.truncated, true);
  assert(Buffer.byteLength(compact.git.status) <= 2048);
  assert.equal(detail.git.status_summary.truncated, false);
  assert(detail.git.status.includes("change-199-"));
  assert(!compact.git.changes.includes("src/orders.cjs"), "default diff only reports totals");
  assert.equal(cli("--paths", '["src"]').git.status_summary.entries, 1);
  const help = run(process.execPath, [path.join(repo, "bin/cli.js"), "--help"]);
  const legacyHelp = run(process.execPath, [path.join(repo, "bin/cli.js"), "help", "legacy"]);
  assert.equal(help.status, 0); assert.notEqual(legacyHelp.status, 0);
  assert(Buffer.byteLength(help.stdout) < 4096);
  assert(help.stdout.includes("work") && legacyHelp.stderr.includes("Unknown help topic"));
  const beforeHelp = git("status", "--porcelain");
  assert(help.stdout.includes("help [tools"));
  const toolHelp = run(process.execPath, [path.join(repo, "bin/cli.js"), "help", "tools"]);
  assert.equal(toolHelp.status, 0, toolHelp.stderr);
  assert(toolHelp.stdout.includes("docx --help") && toolHelp.stdout.includes("export --help"));
  assert(!toolHelp.stdout.includes("orchestrate"));
  for (const tool of ["docx", "export"]) {
    const topic = run(process.execPath, [path.join(repo, "bin/cli.js"), "help", tool]);
    const direct = run(process.execPath, [path.join(repo, "bin/cli.js"), tool, "--help"]);
    assert.equal(topic.status, 0, topic.stderr); assert.equal(direct.status, 0, direct.stderr);
    assert.equal(topic.stdout, direct.stdout, `${tool}: topic help uses the actual command's usage`);
    assert(topic.stdout.includes(tool) && topic.stdout.includes("--"));
  }
  assert.equal(git("status", "--porcelain"), beforeHelp, "discovering capabilities must not write project files");
  assert(!fs.existsSync(path.join(root, ".aidlc")));
  pass("large dirty tree returns bounded default context, explicit details and scoped view; short help separates legacy");

  console.log(JSON.stringify({ passed: true, records, real_host_model: false, new_pilot: false }, null, 2));
} finally {
  // Both roots are created above by mkdtemp under the OS temporary directory.
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(nonGit, { recursive: true, force: true });
}
