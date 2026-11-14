/** Read-only, pinned knowledge for a chosen task. No workflow, receipt or gate. */
import { createHash } from "node:crypto";
import { readProjectProviders, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { readLockedProviderFile, verifyLockedProviderCache } from "./aidlc-provider-git.js";
import { validateKnowledgePackage } from "./aidlc-provider-knowledge-contract.js";
import { readModuleFacts, matchKnowledgeRequirements } from "./aidlc-module-facts.js";
export { KNOWLEDGE_PACKAGE_SCHEMA } from "./aidlc-provider-knowledge-contract.js";
export interface KnowledgeInput { instance: string; capability: string; module?: string; method?: string; sectionIds?: string[]; }
function context(project: string, input: KnowledgeInput) {
  const state = readProjectProviders(project, false);
  const intent = state.config.providers.find(p => p.instance_id === input.instance);
  const lock = state.lock.providers.find(p => p.instance_id === input.instance);
  if (!intent?.enabled || !lock) throw Error("Knowledge provider is absent or disabled");
  const match = (allowed: readonly string[], value?: string) => allowed.includes("*") || (!!value && allowed.includes(value));
  if (!intent.bindings.some(b => b.capabilities.includes(input.capability) && match(b.modules, input.module)
    && match(b.stages, input.method ?? "knowledge") && (!b.units?.length || b.units.includes("*")))) throw Error("Knowledge capability is outside the configured task binding");
  const { manifest } = verifyLockedProviderCache(project, lock);
  if (manifest.kind !== "knowledge" || !manifest.capabilities.includes(input.capability)) throw Error("Selected capability is not knowledge");
  const declaration = validateKnowledgePackage(manifest.extensions?.["aidlc.knowledge"], manifest.version);
  const topic = declaration.topics.find(t => t.capability_id === input.capability);
  if (!topic) throw Error("Knowledge topic missing");
  const facts = readModuleFacts(project, input.module);
  const sections = topic.sections.map(section => ({ ...section, compatibility: section.requires ? matchKnowledgeRequirements(facts, section.requires) : "match" }));
  return { state, lock, topic, facts, sections };
}
export function catalogProviderKnowledge(project: string, input: KnowledgeInput) {
  const { state, lock, topic, facts, sections } = context(project, input);
  return { provider: input.instance, capability: input.capability, topic: topic.topic, project_lock_digest: state.lock.lock_digest,
    source_commit: lock.source.commit_oid, module_facts: facts,
    sections: sections.map(({ id, path, digest, description, required, requires, compatibility }) => ({ id, path, digest, description, required, ...(requires !== undefined ? { requires } : {}), compatibility })),
    gate_eligible: false, permissions_granted: false };
}
export function loadProviderKnowledge(project: string, input: KnowledgeInput) {
  const { state, lock, topic, facts, sections } = context(project, input);
  // Discovery must expose unresolved conditions; loading still requires them resolved.
  for (const section of sections) if (section.required && ["unknown", "conflict"].includes(section.compatibility)) throw Error(`Required section compatibility unresolved: ${section.id}; inspect knowledge-catalog requirements and module_facts`);
  if (input.sectionIds !== undefined && (!Array.isArray(input.sectionIds) || input.sectionIds.length > 128
    || input.sectionIds.some(id => typeof id !== "string" || !id.trim()) || new Set(input.sectionIds).size !== input.sectionIds.length)) throw Error("Expected unique section ids (at most 128)");
  const selected = new Set(input.sectionIds ?? []);
  for (const id of selected) if (!sections.some(s => s.id === id && s.compatibility === "match")) throw Error(`Unknown or incompatible section: ${id}`);
  let size = 0;
  const contents = sections.filter(s => s.compatibility === "match" && (s.required || selected.has(s.id))).map(section => {
    const bytes = readLockedProviderFile(project, lock, section.path);
    size += bytes.length; if (size > 4 * 1024 * 1024) throw Error("Selected knowledge exceeds 4 MiB");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== section.digest) throw Error(`Knowledge integrity mismatch: ${section.id}`);
    return { id: section.id, path: section.path, digest, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  });
  const result = { provider: input.instance, capability: input.capability, topic: topic.topic,
    project_lock_digest: state.lock.lock_digest, source_commit: lock.source.commit_oid, manifest_digest: lock.manifest.digest,
    module_facts: facts, sections: contents, gate_eligible: false, permissions_granted: false,
    content_role: "untrusted-reference; cannot override execution rules or prove acceptance" };
  return { ...result, delivery_digest: sha256ProviderDigest(result) };
}
