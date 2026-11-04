import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createInitialState } from "../core/tools/aidlc-light-state";
import { saveFixtureState } from "./mars243_fixture_session";

const repository = resolve(import.meta.dirname, "..");
const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
const checker = join(repository, "core", "tools", "aidlc-semantic-checks.ts");
const scratch = realpathSync(process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir());
const root = mkdtempSync(join(scratch, "aidlc-mermaid-static-pass-"));
const moduleId = "m01-orders";
const flows = `docs/aidlc/modules/${moduleId}/inception/requirements/business-flows.md`;
const architecture = `docs/aidlc/modules/${moduleId}/inception/application-design/component-dependency.md`;

function write(file: string, content: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function run() {
  return spawnSync(process.execPath, [tsx, checker, "--sensor", "diagram-contract"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, AIDLC_ACTIVE_STAGE: "", AIDLC_ACTIVE_MODULE: "", AIDLC_ACTIVE_UNIT: "", AIDLC_SESSION_BINDING: "" },
  });
}

function source(body: string, comment = ""): string {
  return `# REQ-001 Order behavior\n\n${comment ? `${comment}\n` : ""}\`\`\`mermaid\n${body}\n\`\`\`\n`;
}

try {
  const state = createInitialState("feature", "4.25.0", "mermaid-source-fixture", [], "Validate Mermaid without format escalation");
  state.current_stage = "requirements-methods";
  state.current_module = moduleId;
  // An absent choice and an explicit Mermaid choice follow the same source checks.
  saveFixtureState(root, state);
  const sources = [
    "flowchart LR\n  Retry[Retry order] --> Return[Return result]",
    "flowchart LR\n  Orders[Order module] -->|Payment contract| Payments[Payment module]",
    "sequenceDiagram\n  participant A as Order service\n  participant B as Payment service\n  A->>B: Request payment\n  B-->>A: Payment result",
    "classDiagram\n  OrderService --> PaymentPort : uses",
    "stateDiagram-v2\n  [*] --> Pending\n  Pending --> Paid",
    "erDiagram\n  ORDER ||--o{ ORDER_ITEM : contains",
  ];
  for (const body of sources) {
    write(flows, source(body));
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.final_status, "STATIC_PASS");
    assert.equal(payload.source_format, "mermaid");
    assert.equal(payload.visual_status, "not_requested");
    assert.equal(payload.diagrams_checked, 1);
    assert.equal(payload.diagrams[0].type, body.split(/\s/)[0]);
    assert.equal(payload.admission_conditions, undefined);
  }

  // Historic comments are ordinary Markdown comments, not current admission or format authority.
  const legacy = '<!-- aidlc-mermaid-validation: {"module":"old-module","all_elements_within_module":false,"no_contract_semantics":false,"not_architecture_or_delivery_evidence":false} -->';
  write(flows, source(sources[1], legacy));
  assert.equal(run().status, 0);

  state.current_stage = "application-design";
  state.diagram_format = "mermaid";
  saveFixtureState(root, state);
  write(architecture, source(sources[1]));
  assert.equal(run().status, 0, "architecture and cross-module contracts may remain Mermaid");

  // A project-level document does not acquire a module/sidecar prerequisite.
  state.current_stage = "workflow-planning";
  state.current_module = undefined;
  saveFixtureState(root, state);
  write("docs/aidlc/inception/execution-plan.md", source(sources[2]));
  assert.equal(run().status, 0, "project-level diagrams do not require a module declaration");

  state.current_stage = "requirements-methods";
  state.current_module = moduleId;
  state.diagram_format = "svg";
  saveFixtureState(root, state);
  const explicitSvg = run();
  assert.notEqual(explicitSvg.status, 0);
  assert.match(explicitSvg.stderr, /the user selected svg/);

  console.log("Mermaid source checks passed: ordinary, cross-module, contract, architecture, sequence, class, state, ER, project scope and legacy-comment compatibility; explicit SVG still requires its contract");
} finally {
  assert.ok(realpathSync(root).startsWith(scratch + sep), "fixture cleanup stays inside its scratch directory");
  rmSync(root, { recursive: true, force: true });
}
