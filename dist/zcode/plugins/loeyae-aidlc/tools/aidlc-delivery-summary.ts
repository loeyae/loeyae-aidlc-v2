import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceRelativePath, type ExecutionAxis } from "./aidlc-execution-context";
import type { WorkflowState } from "./aidlc-light-state";

export interface DeliverySummaryVerification {
  /** Only the caller's successful controlled-evidence checks may populate this field. */
  verifiedEvidence?: readonly string[];
  blockers?: readonly string[];
}

export interface DeliverySummary {
  summary_version: "1";
  workflow_id: string;
  project_workflow_id: string;
  module_id?: string;
  scope: string;
  current_stage_instance: string;
  workflow_status: WorkflowState["status"];
  stages_completed: number;
  completed_stage_instances: string[];
  verification: "not_checked" | "passed" | "blocked";
  all_gates_passed: boolean | null;
  evidence_references: string[];
  narrative_references: string[];
  blockers: string[];
}

function localFile(root: string, label: string): boolean {
  if (!label || label.includes("\\") || label.split("/").some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/.test(label)) return false;
  let path = root;
  for (const part of label.split("/")) {
    path = join(path, part);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return false;
  }
  return lstatSync(path).isFile();
}

/** No producer, gate recursion or write: file presence here means recorded, never verified. */
export function projectDeliverySummary(root: string, state: WorkflowState, checks: DeliverySummaryVerification = {}): DeliverySummary {
  const moduleId = state.workflow_kind === "module" ? state.module_id : undefined;
  const completed = [...new Set(state.completed_stage_instances)].filter(id => !moduleId || id.split("@").includes(`module:${moduleId}`));
  const graph = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "data/stage-graph.json"), "utf8")) as {
    stages: Array<{ slug: string; axis: ExecutionAxis; sensors: string[] }>;
  };
  const recorded: string[] = [];
  const narratives = moduleId ? [] : ["docs/aidlc/construction/implementation-report.md", "docs/aidlc/handoff.md"];
  for (const id of completed) {
    const match = /^([a-z0-9-]+)(?:@module:([a-z0-9-]+))?(?:@unit:([a-z0-9-]+))?$/.exec(id);
    if (!match) continue;
    const stage = graph.stages.find(candidate => candidate.slug === match[1]);
    if (!stage || stage.axis !== "project" && !match[2] || stage.axis === "unit" && !match[3]) continue;
    const context = { module_id: match[2], unit_id: match[3] };
    for (const sensor of stage.sensors) {
      const label = evidenceRelativePath(stage.slug, sensor, stage.axis, context).replace(/\\/g, "/");
      if (localFile(root, label)) recorded.push(label);
    }
    if (context.module_id && context.unit_id) {
      const unitRoot = `docs/aidlc/modules/${context.module_id}/construction/${context.unit_id}`;
      narratives.push(`${unitRoot}/code-review.md`, `${unitRoot}/implementation-summary.md`);
    }
  }
  const blockers = [...new Set(checks.blockers || [])];
  const checked = checks.verifiedEvidence !== undefined;
  const references = [...new Set(checked ? checks.verifiedEvidence : recorded)]
    .filter(label => !moduleId || label.split("/")[3] === moduleId).sort();
  if (checked && references.length === 0) blockers.push("No controlled delivery evidence was verified.");
  const verification = blockers.length ? "blocked" : checked ? "passed" : "not_checked";
  return {
    summary_version: "1", workflow_id: state.workflow_id, project_workflow_id: state.parent_workflow_id || state.workflow_id,
    ...(moduleId ? { module_id: moduleId } : {}), scope: state.scope,
    current_stage_instance: state.current_stage_instance || state.current_stage,
    workflow_status: state.status, stages_completed: completed.length, completed_stage_instances: completed,
    verification, all_gates_passed: verification === "not_checked" ? null : verification === "passed",
    evidence_references: references,
    narrative_references: [...new Set(narratives.filter(label => localFile(root, label)))].sort(),
    blockers,
  };
}

/** A disposable display/export view. Never read this Markdown back as gate authority. */
export function renderDeliverySummaryMarkdown(summary: DeliverySummary): string {
  const escape = (value: string): string => value.replace(/[\r\n]/g, " ").replace(/[\\`*_{}\[\]<>]/g, "\\$&");
  const verification = summary.verification === "not_checked" ? "not_checked (recorded references; gates were not re-run)" : summary.verification;
  const lines = ["# AI-DLC delivery summary", "", `- Workflow: ${escape(summary.workflow_id)}`, `- Scope: ${escape(summary.scope)}`,
    `- Current stage: ${escape(summary.current_stage_instance)}`, `- Completed stage instances: ${summary.stages_completed}`,
    `- Evidence verification: ${verification}`, "", "## Evidence references", "",
    ...(summary.evidence_references.length ? summary.evidence_references.map(label => `- ${escape(label)}`) : ["No evidence references recorded."])];
  if (summary.narrative_references.length) lines.push("", "## Decisions and limitations", "", ...summary.narrative_references.map(label => `- ${escape(label)}`));
  if (summary.blockers.length) lines.push("", "## Blocking findings", "", ...summary.blockers.map(message => `- ${escape(message)}`));
  return `${lines.join("\n")}\n`;
}
