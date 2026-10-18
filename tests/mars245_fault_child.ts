/** Fault injection runs the real orchestrator main in an isolated CLI process.
 * Success and binding tests use the public bin/cli.ts wrapper without hooks. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { loadWorkflowState, lightStatePath, saveWorkflowState } from "../core/tools/aidlc-light-state";
const [fault, ...args] = process.argv.slice(2);
const root = process.cwd();
const originalRead = fs.readFileSync, originalRename = fs.renameSync, originalOpen = fs.openSync;
let fired = false;
const normal = (p: unknown) => String(p).replace(/\\/g, "/");
fs.readFileSync = ((p: any, ...rest: any[]) => {
  if (!fired && ["handoff", "revision"].includes(fault) && normal(p).endsWith("ideation/module-manifest.json")) {
    fired = true;
    const state = loadWorkflowState(root)!;
    const instance = JSON.parse(process.env.AIDLC_SESSION_BINDING!).stage_instance;
    if (fault === "handoff") bindSession(root, { instance, owner: "maintainer", session: "split-B", expected: claimToken(state.active_instances[instance]), humanInstructionRef: "user:during-split-planning" });
    else { state.work_description = "concurrent source edit"; saveWorkflowState(root, state); }
  }
  return (originalRead as any)(p, ...rest);
}) as typeof fs.readFileSync;
fs.openSync = ((p: any, ...rest: any[]) => {
  const path = normal(p);
  if (!fired && fault === "target-race" && path.endsWith("modules/beta/aidlc-state.md.lock")) {
    fired = true;
    fs.writeFileSync(String(p).slice(0, -5), "other maintainer state");
    fs.writeFileSync(join(root, "aidlc/active/modules/beta/audit.md"), "other maintainer audit");
  }
  if (!fired && fault === "registry-race" && path.endsWith("registry.md.lock")) {
    fired = true; fs.writeFileSync(String(p).slice(0, -5), "other maintainer registry");
  }
  return (originalOpen as any)(p, ...rest);
}) as typeof fs.openSync;
fs.renameSync = ((from: any, to: any) => {
  const path = normal(to);
  const match = fault === "child" && path.endsWith("modules/beta/aidlc-state.md")
    || fault === "registry" && path.endsWith("registry.md")
    || fault === "final" && path === normal(lightStatePath(root))
    || fault === "evidence" && path.endsWith("application-design/beta/evidence.json");
  if (!fired && match) { fired = true; throw new Error(`injected ${fault} failure`); }
  if (!fired && fault === "locked-handoff" && path.endsWith("registry.md")) {
    fired = true;
    const state = loadWorkflowState(root)!, instance = JSON.parse(process.env.AIDLC_SESSION_BINDING!).stage_instance;
    assert.throws(() => bindSession(root, { instance, owner: "maintainer", session: "split-B", expected: claimToken(state.active_instances[instance]), humanInstructionRef: "user:while-publishing" }), /timed out waiting for workflow lock/);
    assert.equal(loadWorkflowState(root)!.active_instances[instance].session_id, "split-A");
  }
  return originalRename(from, to);
}) as typeof fs.renameSync;
syncBuiltinESMExports();
process.on("exit", () => { assert.equal(fired, true, `fault boundary was not reached: ${fault}`); });
const tool = resolve(import.meta.dirname, "../core/tools/aidlc-orchestrate.ts");
process.argv = [process.execPath, tool, ...args];
await import(pathToFileURL(tool).href);
