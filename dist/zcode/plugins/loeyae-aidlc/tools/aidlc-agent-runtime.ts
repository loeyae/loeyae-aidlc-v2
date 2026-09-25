import { existsSync, lstatSync, readFileSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(TOOL_DIR, "..", "agents");
const EXECUTION_MODES = new Set(["inline", "delegate", "pipeline", "mob", "review"] as const);
const RESULT_STATUSES = new Set(["DONE", "DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED", "READY", "NOT_READY"]);

export type AgentExecutionMode = "inline" | "delegate" | "pipeline" | "mob" | "review";
export type AgentKind = "domain" | "reviewer";

export interface AgentPersona {
  id: string;
  title: string;
  kind: AgentKind;
  allowed_modes: AgentExecutionMode[];
  skills: string[];
  knowledge_focus: string;
  may_delegate: false;
  state_authority: "conductor-only";
  path: string;
}

export interface AgentDescriptor {
  id: string;
  title: string;
  kind: AgentKind;
  allowed_modes: AgentExecutionMode[];
  skills: string[];
  knowledge_focus: string;
  may_delegate: false;
  state_authority: "conductor-only";
}

export interface AgentStageDescriptor {
  slug: string;
  name?: string;
  phase?: string;
  lead_agent: string;
  support_agents?: string[];
  mode?: string;
  reviewer_agent?: string;
}

export interface AgentDispatchStep {
  agent: string;
  dispatch: "inline" | "delegate" | "review";
  purpose: string;
  isolated_context: boolean;
}

export interface AgentExecutionPlan {
  version: "1";
  stage: string;
  mode: AgentExecutionMode;
  primary: AgentDescriptor;
  supports: AgentDescriptor[];
  reviewer?: AgentDescriptor;
  dispatch_steps: AgentDispatchStep[];
  state_authority: "conductor-only";
  nested_delegation: "forbidden";
  fallback: {
    mode: "inline";
    reason: string;
  };
  result_contract: {
    allowed_statuses: string[];
    required_fields: string[];
    forbidden_fields: string[];
  };
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function list(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(`${field} must be a string array`);
  }
  return value.map((item) => item.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFrontmatter(markdown: string, path: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error(`agent persona has no frontmatter: ${path}`);
  const result: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value: unknown = line.slice(index + 1).trim();
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const items = value.slice(1, -1).trim();
      value = items ? items.split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")) : [];
    } else if (value === "false") value = false;
    else if (value === "true") value = true;
    else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function parsePersona(path: string): AgentPersona {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`agent persona must be a regular file: ${path}`);
  const frontmatter = parseFrontmatter(readFileSync(path, "utf8"), path);
  const id = text(frontmatter.id, "agent.id");
  if (!/^aidlc-[a-z0-9-]+-agent$/.test(id)) throw new Error(`agent.id is invalid: ${id}`);
  const kind = text(frontmatter.kind, "agent.kind") as AgentKind;
  if (kind !== "domain" && kind !== "reviewer") throw new Error(`agent.kind must be domain or reviewer: ${id}`);
  const allowedModes = list(frontmatter.allowed_modes, "agent.allowed_modes") as AgentExecutionMode[];
  if (allowedModes.some((mode) => !EXECUTION_MODES.has(mode))) throw new Error(`agent.allowed_modes contains an unsupported mode: ${id}`);
  if (frontmatter.may_delegate !== false) throw new Error(`agent.may_delegate must be false: ${id}`);
  if (frontmatter.state_authority !== "conductor-only") throw new Error(`agent.state_authority must be conductor-only: ${id}`);
  return {
    id,
    title: text(frontmatter.title, "agent.title"),
    kind,
    allowed_modes: allowedModes,
    skills: list(frontmatter.skills, "agent.skills"),
    knowledge_focus: text(frontmatter.knowledge_focus, "agent.knowledge_focus"),
    may_delegate: false,
    state_authority: "conductor-only",
    path,
  };
}

export function loadAgentCatalog(): Map<string, AgentPersona> {
  if (!existsSync(AGENT_DIR)) throw new Error(`agent directory is missing: ${AGENT_DIR}`);
  const catalog = new Map<string, AgentPersona>();
  for (const entry of readdirSync(AGENT_DIR).filter((name) => name.endsWith(".md")).sort()) {
    const persona = parsePersona(resolve(AGENT_DIR, entry));
    if (catalog.has(persona.id)) throw new Error(`duplicate agent persona: ${persona.id}`);
    catalog.set(persona.id, persona);
  }
  if (catalog.size === 0) throw new Error("agent catalog is empty");
  return catalog;
}

function mode(value: string | undefined): AgentExecutionMode {
  const selected = value || "inline";
  if (!EXECUTION_MODES.has(selected as AgentExecutionMode)) throw new Error(`unsupported agent execution mode: ${selected}`);
  return selected as AgentExecutionMode;
}

function publicDescriptor(persona: AgentPersona): AgentDescriptor {
  const { path: _path, ...descriptor } = persona;
  return descriptor;
}

function resolveAgent(catalog: Map<string, AgentPersona>, id: string, label: string): AgentPersona {
  const persona = catalog.get(id);
  if (!persona) throw new Error(`${label} agent is not registered: ${id}`);
  return persona;
}

function purpose(stage: AgentStageDescriptor, persona: AgentPersona): string {
  return `${persona.title} executes ${stage.name || stage.slug}`;
}

export function planAgentExecution(stage: AgentStageDescriptor): AgentExecutionPlan {
  const catalog = loadAgentCatalog();
  const selectedMode = mode(stage.mode);
  const primary = resolveAgent(catalog, text(stage.lead_agent, "stage.lead_agent"), "lead");
  const supports = (stage.support_agents || []).map((id) => resolveAgent(catalog, id, "support"));
  const reviewer = selectedMode === "review"
    ? resolveAgent(catalog, stage.reviewer_agent || primary.id, "reviewer")
    : undefined;

  if (!primary.allowed_modes.includes(selectedMode)) {
    throw new Error(`agent ${primary.id} does not support ${selectedMode} execution for ${stage.slug}`);
  }
  for (const support of supports) {
    if (!support.allowed_modes.includes(selectedMode)) {
      throw new Error(`support agent ${support.id} does not support ${selectedMode} execution for ${stage.slug}`);
    }
  }
  if (reviewer && reviewer.kind !== "reviewer") throw new Error(`review stage ${stage.slug} requires a reviewer persona`);

  const dispatchSteps: AgentDispatchStep[] = [];
  if (selectedMode === "inline") {
    dispatchSteps.push({ agent: primary.id, dispatch: "inline", purpose: purpose(stage, primary), isolated_context: false });
  } else if (selectedMode === "delegate") {
    dispatchSteps.push({ agent: primary.id, dispatch: "delegate", purpose: purpose(stage, primary), isolated_context: true });
  } else if (selectedMode === "review") {
    dispatchSteps.push({ agent: reviewer!.id, dispatch: "review", purpose: `Independently review ${stage.name || stage.slug}`, isolated_context: true });
  } else if (selectedMode === "pipeline") {
    dispatchSteps.push({ agent: primary.id, dispatch: "delegate", purpose: `${purpose(stage, primary)} — scan or implementation pass`, isolated_context: true });
    for (const support of supports) dispatchSteps.push({ agent: support.id, dispatch: "delegate", purpose: `${support.title} synthesizes the prior structured result`, isolated_context: true });
  } else {
    dispatchSteps.push({ agent: primary.id, dispatch: "delegate", purpose: `${purpose(stage, primary)} — lead contribution`, isolated_context: true });
    for (const support of supports) dispatchSteps.push({ agent: support.id, dispatch: "delegate", purpose: `${support.title} contributes an independent perspective`, isolated_context: true });
  }

  return {
    version: "1",
    stage: stage.slug,
    mode: selectedMode,
    primary: publicDescriptor(primary),
    supports: supports.map(publicDescriptor),
    ...(reviewer ? { reviewer: publicDescriptor(reviewer) } : {}),
    dispatch_steps: dispatchSteps,
    state_authority: "conductor-only",
    nested_delegation: "forbidden",
    fallback: {
      mode: "inline",
      reason: "The current harness has no compatible subagent primitive; conductor loads the same persona and preserves the result contract.",
    },
    result_contract: {
      allowed_statuses: [...RESULT_STATUSES],
      required_fields: ["agent", "stage", "status", "summary", "artifacts", "risks"],
      forbidden_fields: ["state", "audit", "approval", "merge", "push", "delegations"],
    },
  };
}

export function validateAgentResult(value: unknown): { valid: true; agent: string; stage: string; status: string } {
  if (!isRecord(value)) throw new Error("agent result must be an object");
  for (const field of ["state", "audit", "approval", "merge", "push", "delegations"]) {
    if (field in value) throw new Error(`agent result cannot include conductor-owned field: ${field}`);
  }
  const agent = text(value.agent, "agent result.agent");
  if (!loadAgentCatalog().has(agent)) throw new Error(`agent result references an unknown persona: ${agent}`);
  const stage = text(value.stage, "agent result.stage");
  const status = text(value.status, "agent result.status");
  if (!RESULT_STATUSES.has(status)) throw new Error(`agent result.status is invalid: ${status}`);
  text(value.summary, "agent result.summary");
  list(value.artifacts, "agent result.artifacts");
  list(value.risks, "agent result.risks");
  return { valid: true, agent, stage, status };
}

function readGraphStage(slug: string): AgentStageDescriptor {
  const graphPath = resolve(TOOL_DIR, "data", "stage-graph.json");
  const graph = JSON.parse(readFileSync(graphPath, "utf8")) as { stages?: AgentStageDescriptor[] };
  const stage = graph.stages?.find((candidate) => candidate.slug === slug);
  if (!stage) throw new Error(`unknown stage: ${slug}`);
  return stage;
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === "describe") {
    const id = args[0];
    if (!id) throw new Error("usage: loeyae-aidlc agent describe <agent-id>");
    const agent = resolveAgent(loadAgentCatalog(), id, "requested");
    process.stdout.write(`${JSON.stringify(agent, null, 2)}\n`);
    return;
  }
  if (command === "plan") {
    const index = args.indexOf("--stage");
    if (index < 0 || !args[index + 1]) throw new Error("usage: loeyae-aidlc agent plan --stage <slug>");
    process.stdout.write(`${JSON.stringify(planAgentExecution(readGraphStage(args[index + 1])), null, 2)}\n`);
    return;
  }
  if (command === "validate-result") {
    const path = args[0];
    if (!path) throw new Error("usage: loeyae-aidlc agent validate-result <json-file>");
    process.stdout.write(`${JSON.stringify(validateAgentResult(JSON.parse(readFileSync(resolve(path), "utf8"))), null, 2)}\n`);
    return;
  }
  throw new Error("usage: loeyae-aidlc agent <describe|plan|validate-result> [args]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Agent runtime blocked: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
