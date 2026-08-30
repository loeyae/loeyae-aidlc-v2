#!/usr/bin/env bun
/**
 * aidlc-graph.ts — Compile stage definitions into the runtime stage graph.
 *
 * Subcommands:
 *   compile   — Read all core/stages/**\/*.md frontmatter, produce data/stage-graph.json
 *   validate  — Check graph integrity (no orphans, valid scopes, etc.)
 *
 * Each stage .md file declares frontmatter:
 *   ---
 *   slug: requirements-analysis
 *   number: "2.3"
 *   name: Requirements Analysis
 *   phase: inception
 *   execution: ALWAYS | CONDITIONAL
 *   lead_agent: aidlc-product-agent
 *   support_agents: []
 *   mode: inline | subagent | pipeline | mob
 *   scopes: [feature, enterprise, mvp]  # which scopes EXECUTE this stage
 *   consumes: [intent-capture.intent.md]
 *   produces: [requirements.md]
 *   sensors: [traceability]
 *   ---
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STAGES_DIR = join(ROOT, "core/stages");
const DATA_DIR = join(ROOT, "core/tools/data");

interface StageNode {
  slug: string;
  number: string;
  name: string;
  phase: string;
  execution: "ALWAYS" | "CONDITIONAL";
  lead_agent: string;
  support_agents: string[];
  mode: string;
  scopes: string[];
  requires: string[];
  consumes: string[];
  produces: string[];
  sensors: string[];
  traceability: "required" | "not_applicable";
  condition: string;
  approval: "block" | "confirm" | "notify";
  file: string;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: Record<string, unknown> = {};
  const listKeys = new Set(["support_agents", "scopes", "requires", "consumes", "produces", "sensors"]);
  let currentListKey: string | null = null;
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") && currentListKey) {
      const current = Array.isArray(fm[currentListKey]) ? fm[currentListKey] as unknown[] : [];
      current.push(trimmed.slice(2).trim().replace(/^['\"]|['\"]$/g, ""));
      fm[currentListKey] = current;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) {
      currentListKey = null;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();
    currentListKey = null;

    // Remove surrounding quotes
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = (value as string).slice(1, -1);
    }

    // Parse arrays: [a, b, c] format
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const inner = (value as string).slice(1, -1).trim();
      value = inner === "" ? [] : inner.split(",").map((s) => s.trim().replace(/^['\"]|['\"]$/g, ""));
    } else if (value === "" && listKeys.has(key)) {
      value = [];
      currentListKey = key;
    }
    fm[key] = value;
  }
  return fm;
}

function scanStages(): StageNode[] {
  const nodes: StageNode[] = [];
  const phases = ["ideation", "inception", "construction", "operation"];

  for (const phase of phases) {
    const phaseDir = join(STAGES_DIR, phase);
    if (!existsSync(phaseDir)) continue;

    for (const file of readdirSync(phaseDir).filter((f) => f.endsWith(".md"))) {
      const content = readFileSync(join(phaseDir, file), "utf-8");
      const fm = parseFrontmatter(content);
      if (!fm || !fm.slug) continue;

      const produces = (fm.produces as string[]) || [];
      const declaredSensors = (fm.sensors as string[]) || [];
      const sensors = produces.length > 0
        ? [...new Set([...declaredSensors, "no-todo", "traceability"])]
        : declaredSensors;

      nodes.push({
        slug: fm.slug as string,
        number: (fm.number as string) || "",
        name: (fm.name as string) || fm.slug as string,
        phase,
        execution: (fm.execution as "ALWAYS" | "CONDITIONAL") || "CONDITIONAL",
        lead_agent: (fm.lead_agent as string) || "(orchestrator)",
        support_agents: (fm.support_agents as string[]) || [],
        mode: (fm.mode as string) || "inline",
        scopes: (fm.scopes as string[]) || [],
        requires: (fm.requires as string[]) || [],
        consumes: (fm.consumes as string[]) || [],
        produces,
        sensors,
        traceability: fm.traceability === "not_applicable" ? "not_applicable" : "required",
        condition: (fm.condition as string) || '',
        approval: ((fm.approval as string) || "notify") as "block" | "confirm" | "notify",
        file: `stages/${phase}/${file}`,
      });
    }
  }

  return nodes.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

const VALID_CONDITIONS = new Set([
  "",
  "has_legacy_code",
  "has_ui_requirements",
  "has_reverse_output",
  "multi_module",
  "has_nfr_needs",
  "has_infra_needs",
  "has_test_case_sources",
  "has_contract_dependencies",
  "has_subagent_support",
  "is_loeyae_boot",
  "context_compacted",
  "!has_legacy_code",
  "!has_ui_requirements",
  "!has_reverse_output",
  "!multi_module",
  "!has_nfr_needs",
  "!has_infra_needs",
  "!has_test_case_sources",
  "!has_contract_dependencies",
  "!has_subagent_support",
  "!is_loeyae_boot",
  "!context_compacted",
]);

const VALID_SENSORS = new Set([
  "no-todo",
  "build-success",
  "test-pass",
  "traceability",
  "doc-cascade",
  "reviewer-required",
  "build-test-evidence",
  "review-evidence",
  "test-quality",
  "contract-baseline",
  "functional-design-completeness",
  "nfr-coverage",
  "infrastructure-completeness",
  "implementation-report",
  "frontend-platform-spec",
  "framework-compliance",
  "subagent-evidence",
  "template-completeness",
  "recovery-evidence",
  "prd-completeness",
  "diagram-contract",
  "design-intent-coverage",
  "ui-design-alignment",
]);

function validateGraph(graph: { stages: StageNode[]; stage_count: number }): string[] {
  const errors: string[] = [];
  const slugs = new Set<string>();

  if (graph.stage_count !== graph.stages.length) {
    errors.push(`stage_count=${graph.stage_count} but actual stages=${graph.stages.length}`);
  }

  for (const stage of graph.stages) {
    if (slugs.has(stage.slug)) errors.push(`duplicate stage slug: ${stage.slug}`);
    slugs.add(stage.slug);
    if (!stage.number || !stage.name || !stage.file) errors.push(`missing identity metadata: ${stage.slug || "<unknown>"}`);
    if (!VALID_CONDITIONS.has(stage.condition)) errors.push(`unknown condition on ${stage.slug}: ${stage.condition}`);
    if (!["ALWAYS", "CONDITIONAL"].includes(stage.execution)) errors.push(`invalid execution on ${stage.slug}: ${stage.execution}`);
    if (!["block", "confirm", "notify"].includes(stage.approval)) errors.push(`invalid approval on ${stage.slug}: ${stage.approval}`);
    if (!["required", "not_applicable"].includes(stage.traceability)) errors.push(`invalid traceability mode on ${stage.slug}: ${stage.traceability}`);
    if (stage.produces.length > 0 && !stage.sensors.includes("no-todo")) errors.push(`missing automatic no-todo sensor on ${stage.slug}`);
    if (stage.produces.length > 0 && !stage.sensors.includes("traceability")) errors.push(`missing automatic traceability sensor on ${stage.slug}`);
    for (const dependency of stage.requires || []) {
      if (!graph.stages.some((candidate) => candidate.slug === dependency)) {
        errors.push(`orphan dependency on ${stage.slug}: ${dependency}`);
      }
    }
    for (const sensor of stage.sensors || []) {
      if (!VALID_SENSORS.has(sensor)) errors.push(`unknown sensor on ${stage.slug}: ${sensor}`);
    }
  }

  return errors;
}

export function compile() {
  const nodes = scanStages();
  const graph = {
    version: "2.0.1",
    stages: nodes,
    stage_count: nodes.length,
    scopes: [...new Set(nodes.flatMap((stage) => stage.scopes))].sort(),
    conditions: [...new Set(nodes.map((stage) => stage.condition))].sort(),
  };
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    throw new Error(`Stage graph validation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const outPath = join(DATA_DIR, "stage-graph.json");
  writeFileSync(outPath, JSON.stringify(graph, null, 2));
  console.log(`✅ Compiled ${nodes.length} stages → ${outPath}`);
}

export function validate() {
  const graphPath = join(DATA_DIR, "stage-graph.json");
  if (!existsSync(graphPath)) {
    throw new Error("No stage-graph.json found. Run `compile` first.");
  }
  const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    throw new Error(`Stage graph validation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  console.log(`✅ Graph valid: ${graph.stage_count} stages`);
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  const cmd = process.argv[2];
  try {
    switch (cmd) {
      case "compile":
        compile();
        break;
      case "validate":
        validate();
        break;
      default:
        console.error("Usage: bun aidlc-graph.ts <compile|validate>");
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
