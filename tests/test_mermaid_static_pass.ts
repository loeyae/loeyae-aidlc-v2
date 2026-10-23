import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInitialState, saveWorkflowState } from "../core/tools/aidlc-light-state";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const checker = join(repository, "core", "tools", "aidlc-semantic-checks.ts");
const root = mkdtempSync(join(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir(), "aidlc-mermaid-static-pass-"));
const moduleId = "m01-orders";
const flows = `docs/aidlc/modules/${moduleId}/inception/requirements/business-flows.md`;

function write(relative: string, content: string): void {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function run(): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, checker, "--sensor", "diagram-contract"], { cwd: root, encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function flow(declaration: string): string {
  return `# Order retry flow\n\n${declaration}\n\`\`\`mermaid\nflowchart LR\n  Retry[Retry order] --> Return[Return result]\n\`\`\`\n`;
}

const declaration = "<!-- aidlc-mermaid-validation: {\"diagram_id\":\"order-retry\",\"module\":\"m01-orders\",\"validation_tier\":\"STATIC_PASS\",\"diagram_type\":\"module-internal-simple-flow\",\"all_elements_within_module\":true,\"no_contract_semantics\":true,\"not_architecture_or_delivery_evidence\":true} -->";

try {
  const state = createInitialState("feature", "4.5.1", "mermaid-static-pass-fixture", [], "Validate Mermaid STATIC_PASS admission");
  state.current_stage = "requirements-methods";
  state.current_module = moduleId;
  state.diagram_format = "mermaid";
  saveWorkflowState(root, state);

  write(flows, flow(declaration));
  const admitted = run();
  assert.equal(admitted.status, 0, admitted.stderr);
  const payload = JSON.parse(admitted.stdout) as Record<string, unknown>;
  assert.equal(payload.status, "passed");
  assert.equal(payload.final_status, "STATIC_PASS");
  assert.equal(payload.validation_tier, "STATIC_PASS");
  assert.equal(payload.admission_status, "passed");
  const diagrams = (payload.diagrams as Array<Record<string, unknown>>).map((diagram) => ({
    ...diagram,
    file: String(diagram.file).replace(/\\/g, "/"),
  }));
  assert.deepEqual(diagrams, [{
    file: flows,
    line: 4,
    type: "flowchart",
    diagram_id: "order-retry",
    module: moduleId,
    validation_tier: "STATIC_PASS",
    diagram_type: "module-internal-simple-flow",
    admission_conditions: {
      module_internal_simple_flow: true,
      all_elements_within_module: true,
      no_contract_semantics: true,
      not_architecture_or_delivery_evidence: true,
      explicit_source_declaration: true,
    },
  }]);

  write(flows, flow(""));
  const undeclared = run();
  assert.notEqual(undeclared.status, 0);
  assert.match(undeclared.stderr, /cannot implicitly claim STATIC_PASS/);

  write(flows, flow(declaration.replace('"no_contract_semantics":true', '"no_contract_semantics":false')));
  const contractBearing = run();
  assert.notEqual(contractBearing.status, 0);
  assert.match(contractBearing.stderr, /declaration\.no_contract_semantics must be true/);

  state.diagram_format = "svg";
  saveWorkflowState(root, state);
  write(flows, flow(declaration));
  const explicitSvg = run();
  assert.notEqual(explicitSvg.status, 0);
  assert.match(explicitSvg.stderr, /the user selected svg/);

  console.log("Mermaid STATIC_PASS admission tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
