import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { qualityHash } from "../core/tools/aidlc-quality-gates";

/** Reviewed sample data, not Evidence. Real CLI producers/checkers validate it. */
export function orderQualityFixture(project: string, moduleId: string, workflowId: string, sample?: {
  source: string; rationale: string; example: string;
  field?: false;
  rule: { condition: string; action: string; effect: string; failure: string; input: string; expected: string; boundary: string };
}) {
  const base = `docs/aidlc/modules/${moduleId}/inception`;
  const source = `${base}/order-source.txt`;
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), typeof value === "string" ? value : JSON.stringify(value), "utf8");
  };
  const hash = (path: string) => qualityHash(readFileSync(join(project, path)));
  const section = (name: string, value: unknown) => {
    const path = `${base}/${name}.md`;
    if (!existsSync(join(project, path))) return;
    const prose = readFileSync(join(project, path), "utf8").replace(/\n```aidlc-quality\n[\s\S]*?\n```\n?/, "");
    write(path, `${prose}\n\`\`\`aidlc-quality\n${JSON.stringify(value)}\n\`\`\`\n`);
  };
  const common = { version: "1", delivery_scope: "order-pagination", inputs: [source] };
  const review = (kind: string, ids: string[], paths: string[]) => write(`${base}/${kind}-review.json`, {
    version: "1", workflow_id: workflowId, module_id: moduleId, delivery_scope: common.delivery_scope,
    reviewer: "order-contract-fixture-reviewer", kind,
    inputs: [...new Set(paths)].map(path => ({ path, sha256: hash(path) })),
    items: ids.map(id => ({ id, conclusion: "supported", rationale: sample?.rationale ?? "Sample review compares the order source with 120 rows -> 50/50/20 and the empty-list boundary", references: [source], examples: kind === "rule" ? ["EX-PAGES"] : [sample?.example ?? "120 rows -> 50/50/20; empty -> []"] })),
    open_findings: [],
  });
  write(source, sample?.source ?? "REQ-001 approved fixture contract: upstream fetch_orders returns the complete ordered list; export paginates by 50 without dropping rows; 120 -> 50/50/20; empty -> []; timeout propagates. Order owner confirmed version 1. No UI or persisted fields change.\n");
  write(`${base}/development-handoff.md`, sample ? `# Development handoff\n${sample.source}\n` : "# Development handoff\nREQ-001: preserve ordered rows and 50-row pagination. Characterization checks 120 rows and empty results against app/exporter.py before refactoring.\n");
  return () => {
    // A behavior-only contract may explicitly approve an empty field inventory;
    // its field review and controlled sensor still run with bound source inputs.
    const fields = sample?.field === false ? [] : ["FIELD-PAGE"];
    section("requirements", {
      ...common, inventory: { dependencies: ["DEP-ORDERS"], fields, rules: ["RULE-PAGES"] },
      dependencies: [{ id: "DEP-ORDERS", critical: true, in_scope: true, granularity: "ordered list", mode: "full response", deletion: "none; read only", default_value: "empty list", source, source_version: "1", owner: "order-owner", confirmed_by: "fixture-product-owner", status: "confirmed", consumers: ["REQ-001"], baseline_source_sha256: hash(source), product_source: source, technical_validation: source }],
      fields: fields.map(id => ({ id, applies: "unchanged", granularity: "page", plan: "preserve page size 50", capability: "existing", required_capabilities: ["query"], verified_capabilities: ["query"], evidence: [source], performance_required: false })),
      dependency_review: `${base}/dependency-review.json`, field_review: `${base}/field-review.json`,
      artifacts: [{ id: "order-source", path: source, sha256: hash(source), ids: ["REQ-001"], depends_on: [] }], changes: [],
      field_contracts: fields.map(id => ({ id, granularity: "page", definition: "up to 50 ordered rows", aliases: [] })), decision_contracts: [],
      artifact_mappings: [{ path: `${base}/requirements.md`, field_uses: fields.map(id => ({ id, granularity: "page", definition: "up to 50 ordered rows" })), decision_uses: [], depends_on: [] }],
      artifact_review: `${base}/artifact-review.json`,
    });
    const reqPaths = [`${base}/requirements.md`, source];
    review("dependency", ["inventory", "DEP-ORDERS"], reqPaths);
    review("field", fields, reqPaths);
    const rule = sample?.rule;
    section("user-stories", { ...common, rules: [{ id: "RULE-PAGES", condition: rule?.condition ?? "upstream list returned", action: rule?.action ?? "export", effect: rule?.effect ?? "ordered pages of at most 50", channel: "api-defense", ui_reachable: false, visibility: "hidden", failure_required: true, failure: rule?.failure ?? "propagate upstream timeout", examples: [{ id: "EX-PAGES", input: rule?.input ?? "120 rows", expected: rule?.expected ?? "50/50/20", boundary: rule?.boundary ?? "empty list -> []" }] }], rule_review: `${base}/rule-review.json` });
    const stories = `${base}/user-stories.md`;
    if (existsSync(join(project, stories))) review("rule", ["RULE-PAGES"], [...reqPaths, stories]);
    const packagePaths = [`${base}/requirements.md`, stories, `${base}/development-handoff.md`];
    section("cross-validation-report", { ...common, package: packagePaths.map(path => ({ path, kind: "canonical" })), pending_items: [], decisions: [], development_acceptance: `${base}/acceptance-review.json` });
    if (packagePaths.every(path => existsSync(join(project, path)))) {
      const inputs = packagePaths.map(path => ({ path, sha256: hash(path) }));
      write(`${base}/technical-review.json`, { workflow_id: workflowId, module_id: moduleId, reviewer: "fixture-developer", conclusion: "supported", inputs, findings: [] });
      write(`${base}/acceptance-review.json`, { workflow_id: workflowId, module_id: moduleId, accepted_by: "fixture-developer", technical_review: `${base}/technical-review.json`, inputs });
    }
    const walk = (path: string): string[] => readdirSync(join(project, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${path}/${entry.name}`) : /\.(md|html|json)$/.test(entry.name) && !entry.name.endsWith("-review.json") ? [`${path}/${entry.name}`] : []);
    review("artifact", [`${base}/requirements.md`], [...walk(`docs/aidlc/modules/${moduleId}`), source]);
  };
}
