/** Selected delivery ownership; original I13 records remain the validation authority. */
import { projectAutonomyScope, type AutonomyUnitRef } from "./aidlc-autonomy";
import { loadWorkflowState } from "./aidlc-light-state";
import { verifiedModuleIds, unitUcdIds, ucdCoverageGaps } from "./aidlc-execution-context";
export function batchImplementationUnits(root: string): AutonomyUnitRef[] | undefined {
  if (!loadWorkflowState(root)?.autonomy_contract_version) return undefined;
  return projectAutonomyScope(root)
    .units!.filter((u) => u.role === "implement")
    .map((u) => u.unit_ref);
}
export function batchModuleIds(root: string, scope: string): string[] {
  const units = batchImplementationUnits(root);
  return units ? [...new Set(units.map((u) => u.module_id))].sort() : verifiedModuleIds(root, scope);
}
export function batchI13Modes(root: string, module: string, i13: Record<string, unknown>) {
  const units = batchImplementationUnits(root);
  if (!units) return unitUcdIds(i13);
  const scopes = units.filter((u) => u.module_id === module).map((u) => unitUcdIds(i13, u.unit_id));
  const union = (key: "new" | "characterization" | "all") => [...new Set(scopes.flatMap((s) => s[key]))];
  return { new: union("new"), characterization: union("characterization"), all: union("all"), scoped: true };
}
export function batchUcdCoverageGaps(
  root: string,
  module: string,
  i13: Record<string, unknown>,
  green: Map<string, string[]>,
): string[] {
  const units = batchImplementationUnits(root);
  return ucdCoverageGaps(
    i13,
    green,
    units?.filter((u) => u.module_id === module).map((u) => u.unit_id),
  );
}
