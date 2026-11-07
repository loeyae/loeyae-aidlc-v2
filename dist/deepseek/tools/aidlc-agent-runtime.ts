/** Retired compatibility entry point. Host tools own execution and delegation. */
export function retiredAgentRuntime(): never {
  throw new Error("AI-DLC agent execution was retired (MARS-244). Use orchestrate next and its top-level execution_policy; the host owns delegation. Historical logs are preserved and are not gate inputs.");
}
retiredAgentRuntime();
