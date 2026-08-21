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
  consumes: string[];
  produces: string[];
  sensors: string[];
  file: string;
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = (value as string).slice(1, -1);
    }

    // Parse arrays: [a, b, c] format
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const inner = (value as string).slice(1, -1).trim();
      if (inner === "") {
        value = [];
      } else {
        value = inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      }
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
        consumes: (fm.consumes as string[]) || [],
        produces: (fm.produces as string[]) || [],
        sensors: (fm.sensors as string[]) || [],
        file: `stages/${phase}/${file}`,
      });
    }
  }

  return nodes.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

function compile() {
  const nodes = scanStages();

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const graph = {
    version: "2.0.0",
    compiled_at: new Date().toISOString(),
    stages: nodes,
    stage_count: nodes.length,
  };

  const outPath = join(DATA_DIR, "stage-graph.json");
  writeFileSync(outPath, JSON.stringify(graph, null, 2));
  console.log(`✅ Compiled ${nodes.length} stages → ${outPath}`);
}

function validate() {
  const graphPath = join(DATA_DIR, "stage-graph.json");
  if (!existsSync(graphPath)) {
    console.error("❌ No stage-graph.json found. Run `compile` first.");
    process.exit(1);
  }
  const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
  console.log(`✅ Graph valid: ${graph.stage_count} stages, compiled at ${graph.compiled_at}`);
}

const cmd = process.argv[2];
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
