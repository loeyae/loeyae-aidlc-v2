import { isPortableProviderPath } from "./aidlc-provider-types.js";

export const KNOWLEDGE_PACKAGE_SCHEMA = "aidlc.knowledge-package/v3";

export interface KnowledgePackage {
  readonly schema: typeof KNOWLEDGE_PACKAGE_SCHEMA;
  readonly version: string;
  readonly topics: readonly {
    readonly capability_id: string;
    readonly topic: string;
    readonly sections: readonly {
      readonly id: string;
      readonly path: string;
      readonly digest: string;
      readonly requires?: unknown;
      readonly required: boolean;
      readonly description: string;
    }[];
  }[];
}

/** Pure metadata validation shared by installation and offline knowledge delivery. */
export function validateKnowledgePackage(value: unknown, version: string): KnowledgePackage {
  const fail = (message: string): never => { throw new Error(`extensions["aidlc.knowledge"]: ${message}`); };
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
    return value as Record<string, unknown>;
  };
  const exact = (value: Record<string, unknown>, fields: string[]) => {
    if (Object.keys(value).some(key => !fields.includes(key))) fail("unknown protocol field");
  };
  const text = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail("expected nonempty text without control characters");
    return value as string;
  };
  if (value === undefined) fail("missing required extension for knowledge manifest");
  const declaration = record(value);
  exact(declaration, ["schema", "version", "topics"]);
  if (declaration.schema !== KNOWLEDGE_PACKAGE_SCHEMA) fail(`knowledge package schema must be ${KNOWLEDGE_PACKAGE_SCHEMA}; rebuild the package and update its pinned lock before loading`);
  if (declaration.version !== version) fail("knowledge package version mismatch");
  if (!Array.isArray(declaration.topics) || !declaration.topics.length) fail("missing topics");
  const capabilities = new Set<string>();
  for (const value of declaration.topics as unknown[]) {
    const topic = record(value);
    exact(topic, ["capability_id", "topic", "sections"]);
    const capability = text(topic.capability_id);
    text(topic.topic);
    if (capabilities.has(capability)) fail("duplicate capability topic");
    capabilities.add(capability);
    if (!Array.isArray(topic.sections) || !topic.sections.length || topic.sections.length > 128) fail("expected 1..128 declared sections");
    const ids = new Set<string>();
    for (const value of topic.sections as unknown[]) {
      const section = record(value);
      exact(section, ["id", "path", "digest", "requires", "required", "description"]);
      if (typeof section.required !== "boolean") fail("sections must explicitly declare required");
      text(section.description);
      const id = text(section.id);
      if (ids.has(id)) fail("duplicate section id");
      ids.add(id);
      const path = text(section.path);
      if (!isPortableProviderPath(path) || path.includes(":")) fail("section path escapes package");
      text(section.digest);
    }
    if (!(topic.sections as Record<string, unknown>[]).some(section => section.required === true)) fail("topics must declare required base constraints");
  }
  return declaration as unknown as KnowledgePackage;
}
