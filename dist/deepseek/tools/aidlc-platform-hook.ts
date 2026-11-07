import { readFileSync, realpathSync } from "fs";
import { resolve } from "path";
import { assertSessionClaim, loadWorkflowState, sessionBinding } from "./aidlc-light-state";
import { sessionRef } from "./aidlc-session";

// Stop is a read-only turn boundary, never a report or evidence producer.
function diagnose(message: string): void {
  // Diagnostics must never demand finishing/parking a workflow merely to end a turn.
  process.stderr.write(`AI-DLC session handoff: ${message}\n`);
}
try {
  let input: {cwd?: string; session_id?: string; thread_id?: string; sessionID?: string; stop_hook_active?: boolean} = {};
  try { const raw = readFileSync(0, "utf8").trim(); if (raw) input = JSON.parse(raw); } catch { /* No host payload: explicit local binding only. */ }
  if (!input.stop_hook_active) {
    const binding = sessionBinding();
    if (binding) {
      const nativeSession = input.session_id || input.thread_id || input.sessionID;
      if (nativeSession && nativeSession !== binding.session_id) diagnose("host session conflicts with explicit binding; no workflow writes authorized");
      else {
        const root = realpathSync(resolve(input.cwd || process.cwd()));
        const state = loadWorkflowState(root, sessionRef(root, binding.stage_instance));
        if (!state) diagnose("bound workflow no longer exists");
        else {
          try { assertSessionClaim(root, state, binding.stage_instance, binding); }
          catch (error) { diagnose(error instanceof Error ? error.message : String(error)); }
        }
      }
    }
  }
} catch (error) { diagnose(error instanceof Error ? error.message : String(error)); }
// Every supported host accepts a successful, empty stdout response. No continuation dispatch.
process.exitCode = 0;
