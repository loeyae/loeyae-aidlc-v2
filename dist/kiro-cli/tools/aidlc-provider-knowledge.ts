import { captureScopeSession, publishScope } from "./aidlc-session";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalProviderJson, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { readLockedProviderFile } from "./aidlc-provider-git.js";
import { localProviderArtifactSigner } from "./aidlc-provider-evidence.js";
import { assertPlanAndNodeCurrent, loadFrozenProviderPlan } from "./aidlc-provider-runner.js";
import { recomputePlanDigest, recomputePlanId } from "./aidlc-provider-resolver.js";
import { isPortableProviderPath, PROVIDER_SCHEMA, type KnowledgeReceiptV1_1, type ProviderPlanV1_1, type Sha256Digest } from "./aidlc-provider-types.js";
import { readModuleFacts, matchKnowledgeRequirements, type ModuleFacts } from "./aidlc-module-facts.js";

/** Explicit extension protocol; the existing v1.1 Manifest/Receipt shapes are unchanged. */
export const KNOWLEDGE_PACKAGE_SCHEMA = "aidlc.knowledge-package/v1";
export const KNOWLEDGE_CONFIRMATION_SCHEMA = "aidlc.knowledge-confirmation/v1";
const STORE = ".aidlc/provider-knowledge";
const MAX_CONTENT_BYTES = 4 * 1024 * 1024;
const VALIDITY_MS = 24 * 60 * 60 * 1000;

function fail(message: string): never { throw new Error(`PROVIDER_KNOWLEDGE_INVALID: ${message}`); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key))) fail("unknown protocol field");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) fail("expected nonempty text without control characters");
  return value;
}

export interface KnowledgeDelivery {
  readonly schema: "aidlc.knowledge-delivery/v1";
  readonly plan_id: string;
  readonly plan_digest: Sha256Digest;
  readonly node_id: string;
  readonly project_lock_digest: Sha256Digest;
  readonly scope: ProviderPlanV1_1["scope"];
  readonly provider_instance: KnowledgeReceiptV1_1["provider_instance"];
  readonly topic: string;
  readonly sections: readonly { readonly id: string; readonly path: string; readonly digest: Sha256Digest; readonly content: string }[];
  readonly delivery_digest: Sha256Digest;
  readonly gate_eligible: false;
  readonly module_facts?: ModuleFacts;
}

export interface KnowledgeConfirmation {
  readonly schema: typeof KNOWLEDGE_CONFIRMATION_SCHEMA;
  readonly receipt: KnowledgeReceiptV1_1;
  readonly delivery_digest: Sha256Digest;
  readonly consumer: string;
  readonly expires_at: string;
  readonly signature: { readonly algorithm: string; readonly key_id: string; readonly value: string };
}

function checkedPlan(project: string, reference: string | ProviderPlanV1_1): ProviderPlanV1_1 {
  const plan = typeof reference === "string" ? loadFrozenProviderPlan(project, reference) : reference;
  if (recomputePlanId(plan) !== plan.plan_id || recomputePlanDigest(plan) !== plan.plan_digest) fail("Plan identity/digest mismatch");
  return plan;
}

/** Content is untrusted data for the host context, never instructions to the Core. */
export function loadProviderKnowledge(project: string, input: { plan: string | ProviderPlanV1_1; nodeId: string }): KnowledgeDelivery {
  const plan = checkedPlan(project, input.plan);
  const { node, lock, manifest } = assertPlanAndNodeCurrent(project, plan, input.nodeId);
  if (manifest.kind !== "knowledge") fail("node is not a knowledge capability");
  const declaration = record(manifest.extensions?.["aidlc.knowledge"]);
  exact(declaration, ["schema", "version", "topics"]);
  const scoped = declaration.schema === "aidlc.knowledge-package/v2";
  if ((!scoped && declaration.schema !== KNOWLEDGE_PACKAGE_SCHEMA) || declaration.version !== manifest.version) fail("knowledge package schema/version mismatch");
  const facts = scoped ? readModuleFacts(project, plan.scope.module_id) : undefined;
  if (!Array.isArray(declaration.topics) || !declaration.topics.length) fail("missing topics");
  const topics = declaration.topics.map((value) => {
    const topic = record(value);
    exact(topic, ["capability_id", "topic", "sections"]);
    text(topic.capability_id); text(topic.topic);
    return topic;
  });
  const matching = topics.filter((topic) => topic.capability_id === node.capability_id);
  if (matching.length !== 1) fail("missing or duplicate capability topic");
  const topic = matching[0];
  if (!Array.isArray(topic.sections) || !topic.sections.length || topic.sections.length > 128) fail("expected 1..128 declared sections");
  const ids = new Set<string>();
  let totalBytes = 0;
  const sections = topic.sections.flatMap((value) => {
    const section = record(value);
    exact(section, scoped ? ["id", "path", "digest", "requires"] : ["id", "path", "digest"]);
    const id = text(section.id);
    if (ids.has(id)) fail("duplicate section id");
    ids.add(id);
    const path = text(section.path);
    if (!isPortableProviderPath(path) || path.includes(":")) fail("section path escapes package");
    if (facts && matchKnowledgeRequirements(facts, section.requires) !== "match") return [];
    const bytes = readLockedProviderFile(project, lock, path);
    totalBytes += bytes.length;
    if (totalBytes > MAX_CONTENT_BYTES) fail("knowledge content exceeds 4 MiB");
    const digest: Sha256Digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (section.digest !== digest) fail(`section ${id} digest mismatch`);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return [{ id, path, digest, content }];
  });
  const payload = {
    schema: "aidlc.knowledge-delivery/v1" as const,
    plan_id: plan.plan_id, plan_digest: plan.plan_digest, node_id: node.node_id,
    project_lock_digest: plan.project_lock_digest, scope: plan.scope,
    provider_instance: {
      instance_id: lock.instance_id, provider_id: lock.id, project_lock_digest: plan.project_lock_digest,
      commit_oid: lock.source.commit_oid, manifest_digest: lock.manifest.digest,
      ruleset_digests: lock.manifest.rulesets.map((ruleset) => ruleset.digest),
    },
    topic: text(topic.topic), sections, gate_eligible: false as const,
    ...(facts ? { module_facts: facts } : {}),
  };
  return { ...payload, delivery_digest: sha256ProviderDigest(payload) };
}

function receiptId(delivery: KnowledgeDelivery): string { return `knowledge-${delivery.delivery_digest.slice(7, 39)}`; }

/** Reject symlinks at every store ancestor, including .aidlc. */
function confirmationPath(project: string, delivery: KnowledgeDelivery, create: boolean): string {
  let cursor = resolve(project);
  for (const segment of STORE.split("/")) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) {
      if (!create) fail("knowledge confirmation is missing; host must load and confirm content");
      mkdirSync(cursor, { mode: 0o700 });
    }
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("unsafe knowledge store");
  }
  return join(cursor, `${receiptId(delivery)}.json`);
}

/** Trusted host calls only AFTER placing every returned section in its active context.
 * Echoing a digest is an explicit host attestation, not automatic proof of model attention.
 */
export function confirmProviderKnowledge(project: string, input: {
  plan: string | ProviderPlanV1_1; nodeId: string; deliveryDigest: string; consumer: string;
}): KnowledgeConfirmation {
  const delivery = loadProviderKnowledge(project, input);
  const session = captureScopeSession(project, delivery.scope);
  return publishScope(project, session, () => {
  if (!delivery.sections.length) fail("no compatible knowledge sections for current module facts; nothing to confirm");
  if (input.deliveryDigest !== delivery.delivery_digest) fail("host confirmation does not match delivered content/context");
  const consumer = text(input.consumer);
  const now = new Date();
  const receiptBody = {
    schema: PROVIDER_SCHEMA.knowledgeReceipt, receipt_id: receiptId(delivery),
    provider_instance: delivery.provider_instance,
    plan: { plan_id: delivery.plan_id, plan_digest: delivery.plan_digest, node_id: delivery.node_id },
    scope: delivery.scope, topic: delivery.topic,
    sections: delivery.sections.map(({ id, digest }) => ({ id, digest })),
    loaded_at: now.toISOString(), issuer: "aidlc-core" as const, gate_eligible: false as const,
  };
  const payload = {
    schema: KNOWLEDGE_CONFIRMATION_SCHEMA as typeof KNOWLEDGE_CONFIRMATION_SCHEMA,
    receipt: { ...receiptBody, receipt_digest: sha256ProviderDigest(receiptBody) },
    delivery_digest: delivery.delivery_digest, consumer,
    expires_at: new Date(now.getTime() + VALIDITY_MS).toISOString(),
  };
  const signer = localProviderArtifactSigner(project, true);
  const confirmation: KnowledgeConfirmation = { ...payload, signature: {
    algorithm: signer.algorithm, key_id: signer.keyId, value: signer.sign(canonicalProviderJson(payload)),
  } };
  const path = confirmationPath(project, delivery, true);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(confirmation, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) rmSync(temporary); }
  return confirmation;
  });
}

/** Re-read locked bytes and validate signed confirmation against the CURRENT Plan/node. */
export function verifyProviderKnowledge(project: string, input: {
  plan: string | ProviderPlanV1_1; nodeId: string;
}): KnowledgeConfirmation {
  const delivery = loadProviderKnowledge(project, input);
  const path = confirmationPath(project, delivery, false);
  if (!existsSync(path)) fail("knowledge confirmation is missing; host must load and confirm content");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) fail("unsafe knowledge confirmation");
  const value = record(JSON.parse(readFileSync(path, "utf8")));
  exact(value, ["schema", "receipt", "delivery_digest", "consumer", "expires_at", "signature"]);
  const { signature, ...payload } = value;
  const signed = record(signature);
  exact(signed, ["algorithm", "key_id", "value"]);
  const signer = localProviderArtifactSigner(project);
  if (!signer.verify(canonicalProviderJson(payload), {
    algorithm: text(signed.algorithm), key_id: text(signed.key_id), value: text(signed.value),
  })) fail("forged knowledge confirmation");
  const receipt = record(value.receipt);
  const { receipt_digest, ...body } = receipt;
  const expected = {
    schema: PROVIDER_SCHEMA.knowledgeReceipt, receipt_id: receiptId(delivery),
    provider_instance: delivery.provider_instance,
    plan: { plan_id: delivery.plan_id, plan_digest: delivery.plan_digest, node_id: delivery.node_id },
    scope: delivery.scope, topic: delivery.topic,
    sections: delivery.sections.map(({ id, digest }) => ({ id, digest })),
    loaded_at: receipt.loaded_at, issuer: "aidlc-core", gate_eligible: false,
  };
  if (value.schema !== KNOWLEDGE_CONFIRMATION_SCHEMA || value.delivery_digest !== delivery.delivery_digest
    || canonicalProviderJson(body) !== canonicalProviderJson(expected) || receipt_digest !== sha256ProviderDigest(body)) fail("knowledge receipt binding mismatch");
  text(value.consumer);
  const loadedAt = Date.parse(text(receipt.loaded_at));
  const expiresAt = Date.parse(text(value.expires_at));
  if (!Number.isFinite(loadedAt) || !Number.isFinite(expiresAt) || loadedAt > Date.now()
    || expiresAt <= Date.now() || expiresAt - loadedAt !== VALIDITY_MS) fail("expired or invalid knowledge confirmation");
  return value as unknown as KnowledgeConfirmation;
}
