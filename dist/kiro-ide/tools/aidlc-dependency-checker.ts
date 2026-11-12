/** Read-only reuse of the native unit gates in the target checkout's context. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { checkSensors, loadGraph, makeInstance } from "./aidlc-orchestrate";
import { evidenceScopeForInstance, loadWorkflowView } from "./aidlc-workflow-layout";
import { loadWorkflowState } from "./aidlc-light-state";
import { evidenceFreshnessBindingErrors, semanticCommandArgv, argvDigest } from "./aidlc-evidence";
import { autonomyContractScope } from "./aidlc-dependency-inputs";
import { readSourceRevision } from "./aidlc-revision";
import { nestedSourceRepos } from "./aidlc-nested-repos";

export async function dependencyNativeCheck(module: string, unit: string, stage: string, sensor: string): Promise<unknown[]> {
  const allowed: Record<string, string> = { "contract-baseline": "shared-contract-baseline", "green-test-evidence": "code-generation", "review-evidence": "code-review", "test-case-derivation": "test-case-derivation" };
  if (allowed[sensor] !== stage) throw new Error("unsupported dependency checker");
  const root = process.cwd(), state = loadWorkflowView(root, module) || loadWorkflowState(root);
  if (!state) throw new Error("provider workflow unavailable");
  if (sensor === "contract-baseline") {
    // Recompute exactly the existing declaration checker. An unrelated provider
    // implementation edit must not make a verified, unchanged contract unavailable.
    const proof = JSON.parse(readFileSync(`.aidlc/evidence/${stage}/${module}/${unit}/${sensor}.json`, "utf8"));
    const scope = autonomyContractScope(root, module, unit) || evidenceScopeForInstance(root, `${stage}@module:${module}@unit:${unit}`);
    if (proof.source_revision?.scope !== scope.label || proof.source_revision?.scope_digest !== readSourceRevision(root, scope, nestedSourceRepos(root)).scope_digest) return [{ sensor, message: "contract declarations/shared inputs changed" }];
    const checker = fileURLToPath(new URL("./aidlc-semantic-checks.ts", import.meta.url));
    const current = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), checker, "--sensor", sensor, "--module", module, "--unit", unit], { cwd: root, encoding: "utf8", timeout: 25000, maxBuffer: 1024 * 1024, shell: false, windowsHide: true });
    if (current.error || current.status !== 0) return [{ sensor, message: String(current.stderr || current.stdout || current.error) }];
    const value = JSON.parse(current.stdout), payload = value.payload || value;
    const errors = ["status", "contract_id", "contract_type", "owner", "consumers", "schema_hash", "validation_status"].filter(field => JSON.stringify(payload[field]) !== JSON.stringify(proof[field])).map(field => ({ sensor, message: `current declaration differs: ${field}` }));
    errors.push(...evidenceFreshnessBindingErrors(stage, proof, root).map(message => ({ sensor, message })));
    if (proof.checker.command_version !== undefined && (proof.checker.command_version !== 2 || proof.checker.argv_digest !== argvDigest(semanticCommandArgv(sensor, { current_module: module, current_unit: unit }, root)))) errors.push({ sensor, message: "contract checker command changed" });
    return errors;
  }
  const node = loadGraph().stages.find(s => s.slug === stage)!;
  const context = { module_id: module, ...(stage === "test-case-derivation" ? {} : { unit_id: unit }) };
  return checkSensors(makeInstance(node, stage === "test-case-derivation" ? "module" : "unit", context), { ...state, current_stage: stage, current_module: module, current_unit: context.unit_id, current_stage_instance: `${stage}@module:${module}${context.unit_id ? `@unit:${unit}` : ""}` }, { onlySensors: [sensor], tolerateRevisionDrift: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2); if (args.length !== 4 || args.some(s => !/^[a-z0-9][a-z0-9-]*$/.test(s))) throw new Error("expected module unit stage sensor");
    const failures = await dependencyNativeCheck(args[0], args[1], args[2], args[3]);
    console.log(JSON.stringify({ failures })); if (failures.length) process.exitCode = 2;
  } catch (e) { console.error(String(e)); process.exitCode = 2; }
}
