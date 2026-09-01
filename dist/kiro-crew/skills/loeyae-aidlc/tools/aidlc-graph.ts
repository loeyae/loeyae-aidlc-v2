import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, normalize, resolve } from "path";
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
  scope_waived_requires: string[];
  consumes: string[];
  produces: string[];
  sensors: string[];
  traceability: "required" | "not_applicable";
  completion_contract: "gated" | "instruction_only";
  condition: string;
  approval: "block" | "confirm" | "notify";
  file: string;
}

interface StageGraph {
  version: string;
  stages: StageNode[];
  stage_count: number;
  scopes: string[];
  conditions: string[];
}

const PHASES = ["ideation", "inception", "construction", "operation"];
const PHASE_ORDER = new Map(PHASES.map((phase, index) => [phase, index]));
const VALID_SCOPES = new Set(["feature", "enterprise", "mvp", "classic", "express", "workshop", "bugfix", "refactor", "poc"]);
const ALLOWED_ROOTS = new Set(["workspace-detection", "product-inception"]);

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, unknown> = {};
  const listKeys = new Set(["support_agents", "scopes", "requires", "scope_waived_requires", "consumes", "produces", "sensors"]);
  let currentListKey: string | null = null;
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") && currentListKey) {
      const current = Array.isArray(fm[currentListKey]) ? fm[currentListKey] as unknown[] : [];
      current.push(trimmed.slice(2).trim().replace(/^['\"]|['\"]$/g, ""));
      fm[currentListKey] = current;
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) {
      currentListKey = null;
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();
    currentListKey = null;
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      value = inner === "" ? [] : inner.split(",").map((item) => item.trim().replace(/^['\"]|['\"]$/g, ""));
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
  for (const phase of PHASES) {
    const phaseDirectory = join(STAGES_DIR, phase);
    if (!existsSync(phaseDirectory)) continue;
    for (const file of readdirSync(phaseDirectory).filter((entry) => entry.endsWith(".md"))) {
      const content = readFileSync(join(phaseDirectory, file), "utf8");
      const fm = parseFrontmatter(content);
      if (!fm || !fm.slug) continue;
      if (fm.lead !== undefined) throw new Error(`legacy frontmatter key lead is forbidden in ${phase}/${file}; use lead_agent`);
      if (fm.phase !== undefined && fm.phase !== phase) throw new Error(`frontmatter phase mismatch in ${phase}/${file}: ${fm.phase}`);
      const produces = (fm.produces as string[]) || [];
      const declaredSensors = (fm.sensors as string[]) || [];
      const sensors = produces.length > 0 ? [...new Set([...declaredSensors, "no-todo", "traceability"])] : declaredSensors;
      nodes.push({
        slug: fm.slug as string,
        number: (fm.number as string) || "",
        name: (fm.name as string) || fm.slug as string,
        phase,
        execution: (fm.execution as StageNode["execution"]) || "CONDITIONAL",
        lead_agent: (fm.lead_agent as string) || "(orchestrator)",
        support_agents: (fm.support_agents as string[]) || [],
        mode: (fm.mode as string) || "inline",
        scopes: (fm.scopes as string[]) || [],
        requires: (fm.requires as string[]) || [],
        scope_waived_requires: (fm.scope_waived_requires as string[]) || [],
        consumes: (fm.consumes as string[]) || [],
        produces,
        sensors,
        traceability: fm.traceability === "not_applicable" ? "not_applicable" : "required",
        completion_contract: fm.completion_contract === "instruction_only" ? "instruction_only" : "gated",
        condition: (fm.condition as string) || "",
        approval: ((fm.approval as string) || "notify") as StageNode["approval"],
        file: `stages/${phase}/${file}`,
      });
    }
  }
  return nodes.sort((left, right) => left.number.localeCompare(right.number, undefined, { numeric: true }));
}

const VALID_CONDITIONS = new Set([
  "", "has_legacy_code", "has_ui_requirements", "has_reverse_output", "multi_module", "has_nfr_needs",
  "has_infra_needs", "has_test_case_sources", "has_contract_dependencies", "has_subagent_support",
  "is_loeyae_boot", "context_compacted", "!has_legacy_code", "!has_ui_requirements", "!has_reverse_output",
  "!multi_module", "!has_nfr_needs", "!has_infra_needs", "!has_test_case_sources",
  "!has_contract_dependencies", "!has_subagent_support", "!is_loeyae_boot", "!context_compacted",
]);

const VALID_SENSORS = new Set([
  "no-todo", "build-success", "test-pass", "traceability", "doc-cascade", "reviewer-required",
  "build-test-evidence", "review-evidence", "test-quality", "contract-baseline",
  "functional-design-completeness", "nfr-coverage", "infrastructure-completeness", "implementation-report",
  "frontend-platform-spec", "framework-compliance", "subagent-evidence", "template-completeness",
  "recovery-evidence", "prd-completeness", "diagram-contract", "design-intent-coverage", "ui-design-alignment",
]);

function executableForScope(stage: StageNode, scope: string): boolean {
  return stage.execution === "ALWAYS" || stage.scopes.includes(scope);
}

function validateArtifactPath(path: string, label: string): string | null {
  if (!path || isAbsolute(path)) return `${label} must be a non-empty project-relative path: ${path}`;
  const normalized = normalize(path).replace(/\\/g, "/");
  if (normalized === ".." || normalized.startsWith("../")) return `${label} escapes project root: ${path}`;
  return null;
}

function detectCycles(stages: StageNode[]): string[] {
  const bySlug = new Map(stages.map((stage) => [stage.slug, stage]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const errors: string[] = [];
  const walk = (slug: string, path: string[]) => {
    if (visiting.has(slug)) {
      errors.push(`requires cycle: ${[...path, slug].join(" -> ")}`);
      return;
    }
    if (visited.has(slug)) return;
    visiting.add(slug);
    for (const dependency of bySlug.get(slug)?.requires || []) if (bySlug.has(dependency)) walk(dependency, [...path, slug]);
    visiting.delete(slug);
    visited.add(slug);
  };
  for (const stage of stages) walk(stage.slug, []);
  return errors;
}

export function validateGraph(graph: { stages: StageNode[]; stage_count: number; scopes?: string[] }): string[] {
  const errors: string[] = [];
  const bySlug = new Map<string, StageNode>();
  const numbers = new Set<string>();
  const producers = new Map<string, string[]>();

  if (graph.stage_count !== graph.stages.length) errors.push(`stage_count=${graph.stage_count} but actual stages=${graph.stages.length}`);
  for (const stage of graph.stages) {
    if (bySlug.has(stage.slug)) errors.push(`duplicate stage slug: ${stage.slug}`);
    bySlug.set(stage.slug, stage);
    if (numbers.has(stage.number)) errors.push(`duplicate stage number: ${stage.number}`);
    numbers.add(stage.number);
    if (!stage.number || !stage.name || !stage.file) errors.push(`missing identity metadata: ${stage.slug || "<unknown>"}`);
    if (!PHASE_ORDER.has(stage.phase)) errors.push(`invalid phase on ${stage.slug}: ${stage.phase}`);
    if (!VALID_CONDITIONS.has(stage.condition)) errors.push(`unknown condition on ${stage.slug}: ${stage.condition}`);
    if (!["ALWAYS", "CONDITIONAL"].includes(stage.execution)) errors.push(`invalid execution on ${stage.slug}: ${stage.execution}`);
    if (!["block", "confirm", "notify"].includes(stage.approval)) errors.push(`invalid approval on ${stage.slug}: ${stage.approval}`);
    if (!["required", "not_applicable"].includes(stage.traceability)) errors.push(`invalid traceability mode on ${stage.slug}: ${stage.traceability}`);
    if (!["gated", "instruction_only"].includes(stage.completion_contract)) errors.push(`invalid completion_contract on ${stage.slug}`);
    if (stage.produces.length === 0 && stage.sensors.length === 0 && stage.completion_contract !== "instruction_only") {
      errors.push(`zero-gate stage must declare completion_contract: instruction_only: ${stage.slug}`);
    }
    if (stage.completion_contract === "instruction_only" && (stage.produces.length > 0 || stage.sensors.length > 0)) {
      errors.push(`instruction_only stage cannot declare produces/sensors: ${stage.slug}`);
    }
    if (stage.produces.length > 0 && !stage.sensors.includes("no-todo")) errors.push(`missing automatic no-todo sensor on ${stage.slug}`);
    if (stage.produces.length > 0 && !stage.sensors.includes("traceability")) errors.push(`missing automatic traceability sensor on ${stage.slug}`);
    for (const scope of stage.scopes) if (!VALID_SCOPES.has(scope)) errors.push(`invalid scope on ${stage.slug}: ${scope}`);
    for (const dependency of stage.requires) if (!graph.stages.some((candidate) => candidate.slug === dependency)) errors.push(`orphan dependency on ${stage.slug}: ${dependency}`);
    for (const waived of stage.scope_waived_requires) if (!stage.requires.includes(waived)) errors.push(`scope_waived_requires on ${stage.slug} is not a requires dependency: ${waived}`);
    for (const sensor of stage.sensors) if (!VALID_SENSORS.has(sensor)) errors.push(`unknown sensor on ${stage.slug}: ${sensor}`);
    for (const path of stage.produces) {
      const pathError = validateArtifactPath(path, `produce on ${stage.slug}`);
      if (pathError) errors.push(pathError);
      producers.set(path, [...(producers.get(path) || []), stage.slug]);
    }
    for (const path of stage.consumes) {
      const pathError = validateArtifactPath(path, `consume on ${stage.slug}`);
      if (pathError) errors.push(pathError);
    }
  }

  for (const stage of graph.stages) {
    const roots = stage.requires.length === 0;
    if (roots && !ALLOWED_ROOTS.has(stage.slug)) errors.push(`unexpected structural root: ${stage.slug}`);
    for (const consume of stage.consumes) {
      const owners = producers.get(consume) || [];
      if (owners.length === 0) errors.push(`consume has no producer on ${stage.slug}: ${consume}`);
      if (owners.length > 1) errors.push(`consume has ambiguous producers on ${stage.slug}: ${consume} <- ${owners.join(", ")}`);
    }
    for (const scope of VALID_SCOPES) {
      if (!executableForScope(stage, scope)) continue;
      for (const dependency of stage.requires) {
        const producer = bySlug.get(dependency);
        if (producer && !executableForScope(producer, scope) && !stage.scope_waived_requires.includes(dependency)) {
          errors.push(`scope ${scope} executes ${stage.slug} but excludes requires ${dependency}; declare scope_waived_requires explicitly`);
        }
      }
    }
  }

  for (const [path, owners] of producers) if (owners.length > 1) errors.push(`duplicate produce path ${path}: ${owners.join(", ")}`);
  errors.push(...detectCycles(graph.stages));

  let lastPhase = -1;
  for (const stage of graph.stages) {
    const phase = stage.slug === "workspace-detection" ? -1 : PHASE_ORDER.get(stage.phase) ?? 99;
    if (phase < lastPhase) errors.push(`phase order regresses at ${stage.number} ${stage.slug}: ${stage.phase}`);
    lastPhase = Math.max(lastPhase, phase);
  }
  if (graph.scopes) {
    for (const scope of VALID_SCOPES) if (!graph.scopes.includes(scope)) errors.push(`graph.scopes missing valid scope: ${scope}`);
    for (const scope of graph.scopes) if (!VALID_SCOPES.has(scope)) errors.push(`graph.scopes contains invalid scope: ${scope}`);
  }
  return [...new Set(errors)];
}

function sourceGraph(): StageGraph {
  const stages = scanStages();
  return {
    version: "2.1.3",
    stages,
    stage_count: stages.length,
    scopes: [...VALID_SCOPES].sort(),
    conditions: [...new Set(stages.map((stage) => stage.condition))].sort(),
  };
}

export function compile(): void {
  const graph = sourceGraph();
  const errors = validateGraph(graph);
  if (errors.length > 0) throw new Error(`Stage graph validation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const output = join(DATA_DIR, "stage-graph.json");
  writeFileSync(output, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`✅ Compiled ${graph.stage_count} stages → ${output}`);
}

export function validate(): void {
  const graphPath = join(DATA_DIR, "stage-graph.json");
  if (!existsSync(graphPath)) throw new Error("No stage-graph.json found. Run `compile` first.");
  const compiled = JSON.parse(readFileSync(graphPath, "utf8")) as StageGraph;
  const compiledErrors = validateGraph(compiled);
  const source = sourceGraph();
  const sourceErrors = validateGraph(source);
  const errors = [...compiledErrors, ...sourceErrors];
  if (errors.length > 0) throw new Error(`Stage graph validation failed:\n${[...new Set(errors)].map((error) => `  - ${error}`).join("\n")}`);
  if (JSON.stringify(compiled) !== JSON.stringify(source)) throw new Error("Compiled stage-graph.json is stale; run `compile`");
  console.log(`✅ Graph valid: ${compiled.stage_count} stages`);
}

if (resolve(process.argv[1] || "") === resolve(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv[2] === "compile") compile();
    else if (process.argv[2] === "validate") validate();
    else {
      console.error("Usage: tsx aidlc-graph.ts <compile|validate>");
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
