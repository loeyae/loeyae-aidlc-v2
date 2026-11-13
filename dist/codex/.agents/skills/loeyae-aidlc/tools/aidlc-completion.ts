/** Pure, non-authoritative projection of supplied host facts. No I/O or permissions. */
export type FactStatus = "met" | "unmet" | "unknown" | "stale";
export interface CompletionFact { id: string; status: FactStatus; evidence?: string; }
export interface CompletionInput {
  scope: string;
  coverage: "complete" | "partial" | "unknown";
  implementation: CompletionFact[];
  verification: CompletionFact[];
  acceptance: CompletionFact[];
  delivery?: CompletionFact[];
  closure?: CompletionFact[];
  unresolved?: string[];
}
type Status = "complete" | "incomplete" | "not_evaluated";
type CompletionPart = "implementation" | "verification" | "acceptance" | "delivery" | "closure";
export type CompletionAssessment = Record<CompletionPart | "overall", Status> & {
  basis: "supplied-host-facts"; authoritative: false; permissions_granted: false; scope: string | null; gaps: string[];
};
export function evaluateCompletion(value?: unknown): CompletionAssessment {
  const empty = { implementation: "not_evaluated", verification: "not_evaluated", acceptance: "not_evaluated", delivery: "not_evaluated", closure: "not_evaluated", overall: "not_evaluated" } as const;
  const base = { basis: "supplied-host-facts" as const, authoritative: false as const, permissions_granted: false as const, scope: null as string | null };
  if (value === undefined) return { ...base, ...empty, gaps: ["No acceptance facts supplied"] };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Expected completion facts object");
  const input = value as CompletionInput;
  const allowed = ["scope", "coverage", "implementation", "verification", "acceptance", "delivery", "closure", "unresolved"];
  if (Object.keys(input).some(k => !allowed.includes(k))) throw Error("Unknown completion field");
  if (typeof input.scope !== "string" || !input.scope.trim() || input.scope.length > 2000) throw Error("Explicit bounded scope is required");
  if (!["complete", "partial", "unknown"].includes(input.coverage)) throw Error("Explicit coverage is required");
  if (input.unresolved !== undefined && (!Array.isArray(input.unresolved) || input.unresolved.some(s => typeof s !== "string" || !s.trim()))) throw Error("Invalid unresolved items");
  const gaps: string[] = [];
  const statuses = {} as Record<CompletionPart, Status>;
  for (const key of ["implementation", "verification", "acceptance", "delivery", "closure"] as const) {
    const facts = input[key];
    if (facts === undefined && ["delivery", "closure"].includes(key)) { statuses[key] = "not_evaluated"; continue; }
    if (!Array.isArray(facts) || facts.length > 1000) throw Error(`${key} must be a bounded fact array`);
    const ids = new Set<string>();
    for (const fact of facts) {
      if (!fact || typeof fact !== "object" || Object.keys(fact).some(k => !["id", "status", "evidence"].includes(k))
        || typeof fact.id !== "string" || !fact.id.trim() || ids.has(fact.id)
        || !["met", "unmet", "unknown", "stale"].includes(fact.status)
        || (fact.evidence !== undefined && typeof fact.evidence !== "string")) throw Error(`Invalid or duplicate ${key} fact`);
      ids.add(fact.id);
      if (fact.status !== "met" || !fact.evidence?.trim()) gaps.push(`${key}:${fact.id}:${fact.status === "met" ? "missing-evidence" : fact.status}`);
    }
    statuses[key] = facts.some(f => f.status === "unmet" || f.status === "stale") ? "incomplete"
      : facts.length === 0 || facts.some(f => f.status === "unknown" || !f.evidence?.trim()) ? "not_evaluated" : "complete";
    if (!facts.length) gaps.push(`${key}:no-criteria`);
  }
  if (input.coverage !== "complete") gaps.push(`coverage:${input.coverage}`);
  for (const gap of input.unresolved ?? []) gaps.push(`unresolved:${gap}`);
  // An unmet implementation requirement cannot be hidden by passed test subsets.
  const combine = (values: Status[]): Status => values.includes("incomplete") ? "incomplete" : values.includes("not_evaluated") ? "not_evaluated" : "complete";
  statuses.verification = combine([statuses.implementation, statuses.verification]);
  statuses.acceptance = combine([statuses.verification, statuses.acceptance]);
  if (input.closure !== undefined) statuses.closure = combine([statuses.acceptance, statuses.closure,
    ...(input.delivery !== undefined ? [statuses.delivery] : [])]);
  let overall = combine([statuses.acceptance, ...(input.delivery !== undefined ? [statuses.delivery] : []), ...(input.closure !== undefined ? [statuses.closure] : [])]);
  if (input.unresolved?.length) { overall = "incomplete"; statuses.acceptance = "incomplete"; if (input.closure !== undefined) statuses.closure = "incomplete"; }
  if (input.coverage !== "complete") {
    overall = overall === "incomplete" ? overall : "not_evaluated";
    for (const key of Object.keys(statuses) as CompletionPart[]) if (statuses[key] === "complete") statuses[key] = "not_evaluated";
  }
  return { ...base, scope: input.scope, ...statuses, overall, gaps };
}
