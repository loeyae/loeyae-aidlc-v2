/** Trusted host entry point, deliberately absent from the model-facing CLI. */
import { loadWorkflowState } from "./aidlc-light-state";
import { checkCurrentExecutionGrant } from "./aidlc-execution-grant";
import { readHostCapabilityReport, readIssuedGrant, validateGrantInputs } from "./aidlc-grant-store";
import { capabilityReuseReason } from "./aidlc-host-capabilities";
import { canonicalAutonomyJson as json } from "./aidlc-autonomy-files";
const required = ["mandatory-tool-replacement", "unknown-tool-denial", "resource-reconciliation"];
/** Check the existing signed capability receipt; a host name or callback is not a qualification. */
export function nativeToolChannelContext(root: string, actual: { host: Record<string, unknown>; configuration_digest: string }) {
  checkCurrentExecutionGrant(root, ["workflow-write"]);
  const state = loadWorkflowState(root)!;
  const grant = readIssuedGrant(root, state.execution_grant_ref!).grant;
  const receipt = readHostCapabilityReport(root, state);
  if (!receipt) throw Error("NATIVE_CHANNEL_UNQUALIFIED: retain restricted gateway");
  const reason = capabilityReuseReason(receipt, state, grant, required);
  if (reason || json(actual.host) !== json(grant.executor_constraints.host) || actual.configuration_digest !== receipt.observation.configuration_digest) throw Error(`NATIVE_CHANNEL_UNQUALIFIED: ${reason || "configuration-changed"}`);
  validateGrantInputs(root, receipt.probe_inputs);
  for (const key of required) if (!receipt.observation.capabilities[key]?.probe_refs?.length) throw Error("NATIVE_CHANNEL_PROBE_MISSING");
  return { mode: "native-replacement" as const, host: actual.host, configuration_digest: actual.configuration_digest, grant_ref: state.execution_grant_ref, deadline_at: Math.min(Date.parse(grant.expires_at), Date.parse(grant.request_started_at) + grant.resource_limits.wall_time_seconds * 1000) };
}
