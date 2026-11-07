import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseStoryDefinitions } from "./aidlc-story-index";
import { checkSlices } from "./aidlc-document-slices";
import { qualityBase, qualityChangeIssues, qualityInput, qualityLegacyResult, qualityPath, qualityResult, qualitySection, type QualityContext, type QualityDocument, type QualityInput, type QualityIssue } from "./aidlc-quality-gates";

export interface Inventory { dependencies: string[]; fields: string[]; rules: string[] }
export interface Dependency {
  id: string; critical: boolean; in_scope: boolean; exclusion_reason?: string;
  granularity: string; mode: string; deletion: string; default_value: string;
  source: string; source_version: string; owner: string; confirmed_by: string;
  status: string; consumers: string[]; baseline_source_sha256: string;
  product_source: string; technical_validation: string;
}
export interface Field {
  id: string; applies: "new" | "changed" | "high-risk" | "unchanged";
  granularity: string; plan: string; capability: "existing" | "planned";
  required_capabilities: string[]; verified_capabilities: string[];
  evidence: string[]; adaptation_plan?: string;
  performance_required: boolean; performance?: { path: string; threshold: number; measured: number; unit: string; command: string; exit_code: number };
}
export interface Rule {
  id: string; condition: string; action: string; effect: string; channel: "ui" | "api-defense";
  ui_reachable: boolean; visibility: "show" | "hidden" | "disabled";
  ui_path_kind?: "normal" | "constraint";
  failure_required: boolean; failure?: string; conflict_with?: string[]; decision?: string;
  examples: Array<{ id: string; input: string; expected: string; boundary: string }>;
}
export interface ReviewRecord {
  version: string; workflow_id: string; module_id: string | null; delivery_scope: string;
  reviewer: string; kind: string; inputs: QualityInput[];
  items: Array<{ id: string; conclusion: "supported" | "conflict" | "unverified"; rationale: string; references: string[]; examples: string[] }>;
  open_findings: Array<{ code: string; id: string; message: string }>;
}
type Section = ReturnType<typeof qualitySection>;
function issue(issues: QualityIssue[], code: string, location: string, message: string) { issues.push({ code, location, message }); }
function list<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`GATE_EVIDENCE_MISSING: ${label} array required`);
  return value as T[];
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function inventory(doc: QualityDocument): Inventory {
  const inv = doc.inventory as Inventory | undefined;
  if (!inv || ![inv.dependencies, inv.fields, inv.rules].every(v => Array.isArray(v) && v.every(nonempty))) throw new Error("GATE_EVIDENCE_MISSING: approved dependency/field/rule inventory required");
  return inv;
}
function coverage(issues: QualityIssue[], expected: string[], found: string[], code: string) {
  for (const id of expected) if (!found.includes(id)) issue(issues, code, id, "identified source item not checked");
  for (const id of new Set(found)) if (found.filter(x => x === id).length > 1) issue(issues, code, id, "duplicate registry item");
}
export function reviewIssues(ctx: QualityContext, section: Section, path: string, ids: string[], kind: string, code: string): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (!nonempty(path)) return [{ code, location: kind, message: "input-bound semantic/technical review required" }];
  const input = qualityInput(ctx, path);
  const record = JSON.parse(readFileSync(qualityPath(ctx, path), "utf8")) as ReviewRecord;
  section.inputs.push(input);
  if (record.version !== "1" || record.workflow_id !== ctx.workflow_id && record.workflow_id !== ctx.project_workflow_id || record.module_id !== (ctx.module_id || null) || record.delivery_scope !== section.value.delivery_scope || record.kind !== kind || !nonempty(record.reviewer)) issue(issues, "GATE_SCOPE_MISMATCH", path, "review identity/kind/reviewer mismatch");
  const bindings = list<QualityInput>(record.inputs, `${path}.inputs`);
  for (const actual of section.inputs.filter(i => i.path !== path)) if (!bindings.some(i => i.path === actual.path && i.sha256 === actual.sha256)) issue(issues, "GATE_EVIDENCE_STALE", path, `review does not bind ${actual.path}`);
  for (const binding of bindings) {
    const current = qualityInput(ctx, binding.path); section.inputs.push(current);
    if (current.sha256 !== binding.sha256) issue(issues, "GATE_EVIDENCE_STALE", binding.path, "review input changed");
  }
  const items = list<ReviewRecord["items"][number]>(record.items, `${path}.items`);
  coverage(issues, ids, items.map(i => i.id), code);
  for (const item of items.filter(i => ids.includes(i.id))) if (item.conclusion !== "supported" || !nonempty(item.rationale) || !Array.isArray(item.references) || item.references.length < 1 || !Array.isArray(item.examples) || item.examples.length < 1) issue(issues, code, item.id, "review must contain supported rationale, source references and concrete examples");
  const boundPaths = new Set(bindings.map(i => i.path));
  for (const item of items.filter(i => ids.includes(i.id))) {
    for (const reference of item.references || []) {
      const source = reference.split("#")[0];
      if (!boundPaths.has(source)) issue(issues, code, item.id, `review reference is not an actual bound source: ${reference}`);
    }
    if (kind === "rule") for (const example of item.examples || []) if (!(section.value.rules as Rule[] | undefined || []).find(r => r.id === item.id)?.examples.some(e => e.id === example)) issue(issues, code, item.id, `example does not belong to the reviewed rule: ${example}`);
  }
  for (const finding of list<ReviewRecord["open_findings"][number]>(record.open_findings, `${path}.open_findings`)) issue(issues, finding.code || code, finding.id, finding.message);
  return issues;
}

export function dependencyReadiness(ctx: QualityContext): Record<string, unknown> {
  const sensor = "dependency-readiness"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  const req = qualitySection(ctx, "requirements"); const issues: QualityIssue[] = [];
  const deps = list<Dependency>(req.value.dependencies, "dependencies");
  coverage(issues, inventory(req.value).dependencies, deps.map(d => d.id), "DEPENDENCY_UNCONFIRMED");
  for (const dep of deps) {
    if (typeof dep.critical !== "boolean" || typeof dep.in_scope !== "boolean" || !["confirmed", "pending", "changed"].includes(dep.status)) issue(issues, "DEPENDENCY_UNCONFIRMED", dep.id, "explicit criticality, scope and confirmation status required");
    if (!dep.in_scope) {
      if (dep.critical || !nonempty(dep.exclusion_reason)) issue(issues, "GATE_INVALID_EXEMPTION", dep.id, "critical/current dependency cannot be excluded without scope basis");
      continue;
    }
    if (dep.status !== "confirmed" || dep.critical && (!dep.confirmed_by || !dep.owner)) issue(issues, "DEPENDENCY_UNCONFIRMED", dep.id, "current-scope dependencies require confirmed facts; critical facts also bind owner/confirmation");
    for (const key of ["granularity", "mode", "deletion", "default_value", "source_version", "product_source", "technical_validation"] as const) if (!nonempty(dep[key])) issue(issues, "DEPENDENCY_SOURCE_CONFLICT", dep.id, `${key} must be explicit (including none when justified)`);
    if (!Array.isArray(dep.consumers) || !dep.consumers.length) issue(issues, "DEPENDENCY_SOURCE_CONFLICT", dep.id, "consumer scope missing");
    if (!nonempty(dep.source)) { issue(issues, "DEPENDENCY_SOURCE_CONFLICT", dep.id, "authority source missing"); continue; }
    for (const path of [dep.source, dep.product_source, dep.technical_validation].filter(nonempty)) req.inputs.push(qualityInput(ctx, path));
    if (qualityInput(ctx, dep.source).sha256 !== dep.baseline_source_sha256) issue(issues, "DEPENDENCY_BASELINE_STALE", dep.id, "external conclusion changed without baseline refresh");
  }
  issues.push(...reviewIssues(ctx, req, String(req.value.dependency_review || ""), ["inventory", ...deps.filter(d => d.in_scope).map(d => d.id)], "dependency", "DEPENDENCY_SOURCE_CONFLICT"));
  return qualityResult(ctx, sensor, [req], issues, { checked_ids: deps.map(d => d.id), expected_count: inventory(req.value).dependencies.length, checked_count: deps.length });
}

export function fieldCapability(ctx: QualityContext): Record<string, unknown> {
  const sensor = "field-capability"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  const req = qualitySection(ctx, "requirements"); const issues: QualityIssue[] = [];
  const fields = list<Field>(req.value.fields, "fields");
  coverage(issues, inventory(req.value).fields, fields.map(f => f.id), "FIELD_UNCOVERED");
  for (const field of fields) {
    if (typeof field.performance_required !== "boolean") issue(issues, "FIELD_PERFORMANCE_UNVERIFIED", field.id, "performance applicability must be explicit");
    if (!nonempty(field.granularity) || !nonempty(field.plan) || !["existing", "planned"].includes(field.capability)) issue(issues, "FIELD_PLAN_CONFLICT", field.id, "granularity/plan/capability origin required");
    if (!["new", "changed", "high-risk", "unchanged"].includes(field.applies)) issue(issues, "FIELD_UNCOVERED", field.id, "applicability basis required");
    if (!Array.isArray(field.required_capabilities) || !field.required_capabilities.length || !Array.isArray(field.verified_capabilities)) { issue(issues, "FIELD_CAPABILITY_UNVERIFIED", field.id, "applicable capability inventory required"); continue; }
    coverage(issues, field.required_capabilities, field.verified_capabilities, "FIELD_CAPABILITY_UNVERIFIED");
    if (field.capability === "planned" && !nonempty(field.adaptation_plan)) issue(issues, "FIELD_PLAN_CONFLICT", field.id, "validated new capability requires consumer adaptation plan");
    if (!Array.isArray(field.evidence) || !field.evidence.length) issue(issues, "FIELD_CAPABILITY_UNVERIFIED", field.id, "base code or executable prototype/contract evidence missing");
    else for (const path of field.evidence) req.inputs.push(qualityInput(ctx, path));
    if (field.performance_required) {
      const perf = field.performance;
      if (!perf || !Number.isFinite(perf.threshold) || !Number.isFinite(perf.measured) || perf.measured > perf.threshold || perf.exit_code !== 0 || !perf.unit || !perf.command || !perf.path) issue(issues, "FIELD_PERFORMANCE_UNVERIFIED", field.id, "reproducible measurement must satisfy business threshold");
      else {
        req.inputs.push(qualityInput(ctx, perf.path));
        try {
          const observed = JSON.parse(readFileSync(qualityPath(ctx, perf.path), "utf8"));
          for (const key of ["command", "exit_code", "measured", "unit"] as const) if (observed[key] !== perf[key]) issue(issues, "FIELD_PERFORMANCE_UNVERIFIED", field.id, `observed performance log differs at ${key}`);
        } catch { issue(issues, "FIELD_PERFORMANCE_UNVERIFIED", field.id, "machine-readable actual performance log required"); }
      }
    }
  }
  issues.push(...reviewIssues(ctx, req, String(req.value.field_review || ""), fields.map(f => f.id), "field", "FIELD_PLAN_CONFLICT"));
  return qualityResult(ctx, sensor, [req], issues, { checked_ids: fields.map(f => f.id), expected_count: inventory(req.value).fields.length, checked_count: fields.length });
}

export function storyRuleConsistency(ctx: QualityContext): Record<string, unknown> {
  const sensor = "story-rule-consistency"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  const req = qualitySection(ctx, "requirements"), stories = qualitySection(ctx, "user-stories");
  const issues: QualityIssue[] = []; stories.inputs.push(...req.inputs);
  issues.push(...storyDefinitionIssues(ctx, stories));
  const rules = list<Rule>(stories.value.rules, "rules");
  coverage(issues, inventory(req.value).rules, rules.map(r => r.id), "RULE_CONFLICT_OPEN");
  for (const rule of rules) {
    if (typeof rule.ui_reachable !== "boolean" || typeof rule.failure_required !== "boolean") issue(issues, "RULE_FAILURE_UNDEFINED", rule.id, "reachability/failure applicability must be explicit");
    if (rule.decision) {
      const decision = (req.value.decision_contracts as Array<{ id: string; status: string; source: string }> | undefined)?.find(d => d.id === rule.decision && d.status === "effective");
      if (!decision) issue(issues, "RULE_CONFLICT_OPEN", rule.id, "adjudication must reference an effective decision");
      else stories.inputs.push(qualityInput(ctx, decision.source));
    }
    if (!rule.condition || !rule.action || !rule.effect || !["ui", "api-defense"].includes(rule.channel)) issue(issues, "RULE_CONFLICT_OPEN", rule.id, "structured condition/action/effect/channel required");
    if (rule.ui_path_kind && !["normal", "constraint"].includes(rule.ui_path_kind)) issue(issues, "RULE_CONFLICT_OPEN", rule.id, "UI path classification unknown");
    if (rule.channel === "ui" && rule.ui_path_kind !== "constraint" && (!rule.ui_reachable || rule.visibility !== "show")) issue(issues, "UI_PATH_UNREACHABLE", rule.id, "normal UI path cannot trigger hidden/disabled/unreachable action");
    for (const other of rules.filter(r => r.id !== rule.id && r.channel === rule.channel && r.condition === rule.condition && r.action === rule.action && r.effect !== rule.effect)) if (!rule.decision || rule.decision !== other.decision) issue(issues, "RULE_CONFLICT_OPEN", rule.id, `same-condition effect conflicts with ${other.id}`);
    if (rule.conflict_with?.length && !rule.decision) issue(issues, "RULE_CONFLICT_OPEN", rule.id, "semantic conflict requires effective decision");
    if (rule.failure_required && !nonempty(rule.failure)) issue(issues, "RULE_FAILURE_UNDEFINED", rule.id, "applicable failure branch missing");
    if (!Array.isArray(rule.examples) || !rule.examples.length || rule.examples.some(e => !e.input || !e.expected || !e.boundary)) issue(issues, "RULE_EXAMPLE_MISMATCH", rule.id, "concrete rule/boundary examples required");
  }
  issues.push(...reviewIssues(ctx, stories, String(stories.value.rule_review || ""), rules.map(r => r.id), "rule", "RULE_EXAMPLE_MISMATCH"));
  return qualityResult(ctx, sensor, [req, stories], issues, { checked_ids: rules.map(r => r.id), expected_count: inventory(req.value).rules.length, checked_count: rules.length });
}

function storyDefinitionIssues(ctx: QualityContext, stories: Section): QualityIssue[] {
  const path = `${qualityBase(ctx)}/user-stories.md`;
  const main = parseStoryDefinitions(readFileSync(qualityPath(ctx, path), "utf8"));
  const issues: QualityIssue[] = [];
  if (!main.some(d => d.kind === "story")) issue(issues, "AC_OWNER_MISSING", path, "story definition index missing");
  for (const definition of main) {
    if (main.filter(d => d.id === definition.id).length > 1) issue(issues, "STORY_DEFINITION_DUPLICATE", `${path}:${definition.line}`, `${definition.id} defined more than once`);
    if (definition.kind === "ac" && (!definition.owner || !main.some(d => d.kind === "story" && d.id === definition.owner))) issue(issues, "AC_OWNER_MISSING", `${path}:${definition.line}`, `${definition.id} owner undefined`);
  }
  const candidates = new Set<string>((stories.value.story_copies as string[] | undefined) || []);
  const walk = (dir: string) => {
    if (!existsSync(qualityPath(ctx, dir))) return;
    for (const file of readdirSync(qualityPath(ctx, dir), { withFileTypes: true })) {
      const rel = `${dir}/${file.name}`; qualityPath(ctx, rel);
      if (file.isDirectory()) walk(rel); else if (file.isFile() && /\.md$/i.test(file.name)) candidates.add(rel);
    }
  };
  for (const dir of ["epics", "user-stories", "stories"]) walk(`${qualityBase(ctx)}/${dir}`);
  const normalized = (body: string) => body.replace(/\s+/g, " ").trim();
  for (const copyPath of candidates) {
    stories.inputs.push(qualityInput(ctx, copyPath));
    const copy = parseStoryDefinitions(readFileSync(qualityPath(ctx, copyPath), "utf8"));
    for (const definition of copy) {
      if (copy.filter(d => d.id === definition.id).length > 1) issue(issues, "STORY_DEFINITION_DUPLICATE", copyPath, `duplicate ${definition.id}`);
      const authority = main.find(d => d.id === definition.id);
      if (!authority || authority.owner !== definition.owner || normalized(authority.body) !== normalized(definition.body)) issue(issues, "STORY_COPY_DIVERGED", `${copyPath}:${definition.line}`, `${definition.id} differs from canonical definition`);
    }
  }
  return issues;
}

interface FieldContract { id: string; granularity: string; definition: string; aliases: string[] }
interface DecisionContract { id: string; status: "effective" | "superseded"; source: string; replaced_by?: string }
interface ArtifactMapping {
  path: string; field_uses: Array<{ id: string; granularity: string; definition: string }>;
  decision_uses: Array<{ id: string; usage: "active" | "history" | "migration"; rationale?: string }>;
  depends_on: string[];
}
export function artifactConsistency(ctx: QualityContext): Record<string, unknown> {
  const sensor = "artifact-consistency"; const legacy = qualityLegacyResult(ctx, sensor); if (legacy) return legacy;
  const req = qualitySection(ctx, "requirements"), stories = qualitySection(ctx, "user-stories");
  const issues = qualityChangeIssues(ctx, req.value);
  const fields = list<FieldContract>(req.value.field_contracts, "field_contracts");
  const decisions = list<DecisionContract>(req.value.decision_contracts, "decision_contracts");
  const mappings = list<ArtifactMapping>(req.value.artifact_mappings, "artifact_mappings");
  const knownFields = new Map<string, FieldContract>();
  for (const field of fields) for (const id of [field.id, ...field.aliases]) {
    if (knownFields.has(id) && knownFields.get(id) !== field) issue(issues, "ARTIFACT_FIELD_CONFLICT", id, "alias maps to different field/granularity");
    knownFields.set(id, field);
  }
  for (const decision of decisions) req.inputs.push(qualityInput(ctx, decision.source));
  // Scan all actually generated scoped Markdown/HTML/JSON: I13/UC-D and future
  // consumers are included when present, never forced before their stages.
  const paths: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(qualityPath(ctx, dir))) return;
    for (const file of readdirSync(qualityPath(ctx, dir), { withFileTypes: true })) {
      const rel = `${dir}/${file.name}`; qualityPath(ctx, rel);
      if (file.isDirectory()) walk(rel);
      else if (file.isFile() && /\.(md|html|json)$/.test(file.name) && !/(?:-review\.json|quality-adoption\.json|ui-generation-|change-checkpoints)/.test(file.name)) paths.push(rel);
    }
  };
  walk(ctx.module_id ? `docs/aidlc/modules/${ctx.module_id}` : "docs/aidlc/inception");
  // Verified slice objects are byte-exact projections of canonical documents,
  // whose authority mappings are checked below. They are not new authorities.
  // Bind the complete verification inputs; unknown objects still take the normal
  // mapping path and stale/tampered projections fail before any exemption.
  const derived = new Set<string>();
  const objectPrefix = `${qualityBase(ctx)}/document-slices/objects/`;
  if (paths.some(path => path.startsWith(objectPrefix))) {
    const slices = checkSlices(ctx);
    if (slices.status === "passed") {
      const inputs = slices.inputs as QualityInput[];
      req.inputs.push(...inputs);
      for (const input of inputs) if (input.path.startsWith(objectPrefix)) derived.add(input.path);
    }
  }
  for (const path of paths) {
    req.inputs.push(qualityInput(ctx, path));
    if (derived.has(path)) continue;
    const body = readFileSync(qualityPath(ctx, path), "utf8");
    const referenced = [...new Set(body.match(/\b(?:FIELD|DEC|VC|CL)-[A-Z0-9_-]+\b/g) || [])];
    const mapping = mappings.find(m => m.path === path);
    if (referenced.length && !mapping) { issue(issues, "ARTIFACT_MAPPING_MISSING", path, "actual field/decision mentions require classified authority mappings"); continue; }
    if (!mapping) continue;
    for (const id of referenced) if (!knownFields.has(id) && !decisions.some(d => d.id === id)) issue(issues, "ARTIFACT_MAPPING_MISSING", path, `undefined field/decision ${id}`);
    for (const use of mapping.field_uses) {
      const field = knownFields.get(use.id);
      if (!field) issue(issues, "ARTIFACT_MAPPING_MISSING", path, `undefined ${use.id}`);
      else if (field.granularity !== use.granularity || field.definition !== use.definition) issue(issues, "ARTIFACT_FIELD_CONFLICT", path, `${use.id} granularity/definition differs`);
    }
    for (const use of mapping.decision_uses) {
      const decision = decisions.find(d => d.id === use.id);
      if (!decision) issue(issues, "ARTIFACT_MAPPING_MISSING", path, `undefined ${use.id}`);
      else if (use.usage === "active" && decision.status === "superseded") issue(issues, "ARTIFACT_SUPERSEDED_RULE_USED", path, `active use of ${use.id}`);
      else if (!["active", "history", "migration"].includes(use.usage) || use.usage !== "active" && !use.rationale) issue(issues, "ARTIFACT_MAPPING_MISSING", path, "audit/migration reference needs explicit rationale");
    }
    for (const id of referenced) if (!(mapping.field_uses.some(u => u.id === id) || mapping.decision_uses.some(u => u.id === id))) issue(issues, "ARTIFACT_MAPPING_MISSING", path, `unclassified mention ${id}`);
  }
  for (const mapping of mappings) {
    if (!paths.includes(mapping.path)) issue(issues, "ARTIFACT_MAPPING_MISSING", mapping.path, "mapping target absent from actual scoped artifacts");
    const declared = req.value.artifacts?.find(a => a.path === mapping.path);
    for (const dependency of mapping.depends_on) if (!declared?.depends_on.includes(dependency)) issue(issues, "CHANGE_DEPENDENCY_MISSING", mapping.path, `new consumer dependency ${dependency} missing from impact graph`);
  }
  for (const change of req.value.changes || []) {
    const oldRules = new Map(change.before.flatMap(s => Object.entries(s.rules || {})));
    for (const snapshot of change.after) {
      for (const [id, value] of Object.entries(snapshot.rules || {})) if (oldRules.has(id) && oldRules.get(id) === value && decisions.some(d => d.id === id && d.status === "superseded")) issue(issues, "CHANGE_SYNC_INCOMPLETE", snapshot.path, `claimed synchronization retains old ${id} semantics`);
    }
  }
  req.inputs.push(...stories.inputs);
  issues.push(...reviewIssues(ctx, req, String(req.value.artifact_review || ""), mappings.map(m => m.path), "artifact", "ARTIFACT_FIELD_CONFLICT"));
  return qualityResult(ctx, sensor, [req, stories], issues, { artifacts_checked: paths, checked_count: mappings.length });
}
