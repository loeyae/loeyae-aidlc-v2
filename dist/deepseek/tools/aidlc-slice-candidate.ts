/** Internal producer-to-consumer validation bridge; never publishes evidence. */
import { readFileSync } from "node:fs";
import { validateSliceCandidate } from "./aidlc-orchestrate";
import type { WorkflowState } from "./aidlc-light-state";

try {
  const request = JSON.parse(readFileSync(0, "utf8")) as { state: WorkflowState; candidate: Record<string, unknown> };
  const failure = validateSliceCandidate(request.state, request.candidate);
  if (failure) throw new Error(failure.message);
  process.stdout.write("passed\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
