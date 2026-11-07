/**
 * Normative Core-side contract for project-level Git Providers.
 *
 * JSON protocol field names intentionally use snake_case; project YAML retains the
 * conventional apiVersion/specVersion keys. The Provider repository owns the
 * author-facing schemas listed in PROVIDER_SCHEMA_OWNERSHIP; Core owns project
 * configuration, profile, plan and gate schemas. Do not silently widen these types:
 * protocol changes require a new schema discriminator.
 */

export const PROVIDER_PROTOCOL_VERSION = "1.1" as const;
export const PROJECT_PROVIDER_CONFIG_VERSION = "1.0.0" as const;
export const RESTRICTED_RUNNER_PROFILE = "restricted-v1" as const;

export const PROVIDER_SCHEMA = {
  provider: "aidlc.provider/v1.1",
  request: "aidlc.provider-request/v1.1",
  result: "aidlc.provider-result/v1.1",
  evidence: "aidlc.provider-evidence/v1.1",
  conformance: "aidlc.provider-conformance/v1.1",
  knowledgeReceipt: "aidlc.knowledge-receipt/v1.1",
  projectProviders: "aidlc.project-providers/v1",
  projectProvidersLock: "aidlc.project-providers-lock/v1",
  profile: "aidlc.profile/v1.1",
  plan: "aidlc.provider-plan/v1.1",
  gateDecision: "aidlc.gate-decision/v1.1",
} as const;

export type ProviderSchemaKey = keyof typeof PROVIDER_SCHEMA;
export type ProviderSchemaDiscriminator = typeof PROVIDER_SCHEMA[ProviderSchemaKey];
export type SchemaOwnerRepository = "loeyae-aidlc-v2" | "loeyae-aidlc-provider";
export type SchemaProducer = "provider-author" | "provider" | "core" | "controlled-runner" | "conformance-runner";

export interface ProviderSchemaOwnershipRecord {
  readonly key: ProviderSchemaKey;
  readonly discriminator: ProviderSchemaDiscriminator;
  readonly schema_id: string;
  readonly owner_repository: SchemaOwnerRepository;
  readonly canonical_path: string;
  readonly producer: SchemaProducer;
}

export const PROVIDER_SCHEMA_OWNERSHIP = [
  {
    key: "provider",
    discriminator: PROVIDER_SCHEMA.provider,
    schema_id: "urn:loeyae:aidlc:schema:provider:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.provider.v1.1.schema.json",
    producer: "provider-author",
  },
  {
    key: "request",
    discriminator: PROVIDER_SCHEMA.request,
    schema_id: "urn:loeyae:aidlc:schema:provider-request:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.provider-request.v1.1.schema.json",
    producer: "controlled-runner",
  },
  {
    key: "result",
    discriminator: PROVIDER_SCHEMA.result,
    schema_id: "urn:loeyae:aidlc:schema:provider-result:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.provider-result.v1.1.schema.json",
    producer: "provider",
  },
  {
    key: "evidence",
    discriminator: PROVIDER_SCHEMA.evidence,
    schema_id: "urn:loeyae:aidlc:schema:provider-evidence:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.provider-evidence.v1.1.schema.json",
    producer: "controlled-runner",
  },
  {
    key: "conformance",
    discriminator: PROVIDER_SCHEMA.conformance,
    schema_id: "urn:loeyae:aidlc:schema:provider-conformance:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.provider-conformance.v1.1.schema.json",
    producer: "conformance-runner",
  },
  {
    key: "knowledgeReceipt",
    discriminator: PROVIDER_SCHEMA.knowledgeReceipt,
    schema_id: "urn:loeyae:aidlc:schema:knowledge-receipt:1.1",
    owner_repository: "loeyae-aidlc-provider",
    canonical_path: "schemas/aidlc.knowledge-receipt.v1.1.schema.json",
    producer: "core",
  },
  {
    key: "projectProviders",
    discriminator: PROVIDER_SCHEMA.projectProviders,
    schema_id: "urn:loeyae:aidlc:schema:project-providers:1",
    owner_repository: "loeyae-aidlc-v2",
    canonical_path: "core/tools/data/provider-schemas/aidlc.project-providers.v1.schema.json",
    producer: "core",
  },
  {
    key: "projectProvidersLock",
    discriminator: PROVIDER_SCHEMA.projectProvidersLock,
    schema_id: "urn:loeyae:aidlc:schema:project-providers-lock:1",
    owner_repository: "loeyae-aidlc-v2",
    canonical_path: "core/tools/data/provider-schemas/aidlc.project-providers-lock.v1.schema.json",
    producer: "core",
  },
  {
    key: "profile",
    discriminator: PROVIDER_SCHEMA.profile,
    schema_id: "urn:loeyae:aidlc:schema:profile:1.1",
    owner_repository: "loeyae-aidlc-v2",
    canonical_path: "core/tools/data/provider-schemas/aidlc.profile.v1.1.schema.json",
    producer: "core",
  },
  {
    key: "plan",
    discriminator: PROVIDER_SCHEMA.plan,
    schema_id: "urn:loeyae:aidlc:schema:provider-plan:1.1",
    owner_repository: "loeyae-aidlc-v2",
    canonical_path: "core/tools/data/provider-schemas/aidlc.provider-plan.v1.1.schema.json",
    producer: "core",
  },
  {
    key: "gateDecision",
    discriminator: PROVIDER_SCHEMA.gateDecision,
    schema_id: "urn:loeyae:aidlc:schema:gate-decision:1.1",
    owner_repository: "loeyae-aidlc-v2",
    canonical_path: "core/tools/data/provider-schemas/aidlc.gate-decision.v1.1.schema.json",
    producer: "core",
  },
] as const satisfies readonly ProviderSchemaOwnershipRecord[];

export const PROVIDER_WIRE_CONVENTIONS = {
  json_schema_dialect: "https://json-schema.org/draft/2020-12/schema",
  canonical_json: "RFC 8785 JCS",
  digest_algorithm: "sha256",
  digest_pattern: "^sha256:[0-9a-f]{64}$",
  timestamp_format: "UTC RFC 3339",
  unknown_fields: "reject",
  extension_container: "extensions",
  extension_namespace_pattern: "^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*)+$",
  wire_path_format: "portable-relative-posix",
} as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type Sha256Digest = `sha256:${string}`;
export type Rfc3339Timestamp = string;
export type GitObjectId = string;
export type PortableRelativePath = string;

export interface ExtensibleWireObject {
  readonly extensions?: Readonly<Record<string, JsonObject>>;
}

export type ProviderKind = "knowledge" | "validation" | "command" | "composite";
export type CapabilityRisk = "advisory" | "standard" | "protected";
export type SelectorResult = "true" | "false" | "unknown";

export type ProfileSelector =
  | { readonly fact: string; readonly operator: "exists" }
  | { readonly fact: string; readonly operator: "equals" | "not_equals" | "contains"; readonly value: JsonPrimitive }
  | { readonly fact: string; readonly operator: "in"; readonly values: readonly JsonPrimitive[] }
  | { readonly all_of: readonly ProfileSelector[] }
  | { readonly any_of: readonly ProfileSelector[] }
  | { readonly not: ProfileSelector };

export type CapabilityExpression =
  | { readonly capability: string }
  | { readonly all_of: readonly CapabilityExpression[] }
  | { readonly any_of: readonly CapabilityExpression[] }
  | { readonly at_least: { readonly count: number; readonly of: readonly CapabilityExpression[] } }
  | { readonly exactly_one: readonly CapabilityExpression[] };

export interface ProviderCapabilityDeclaration extends ExtensibleWireObject {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly risk: CapabilityRisk;
  readonly selector?: ProfileSelector;
  readonly stages: readonly string[];
  readonly rule_ids?: readonly string[];
  readonly fallback_group?: string;
}

export interface ProviderEntrypoint {
  readonly id: string;
  readonly capability_ids: readonly string[];
  readonly executable: PortableRelativePath;
  readonly args: readonly string[];
  readonly sandbox: typeof RESTRICTED_RUNNER_PROFILE;
  readonly digest: Sha256Digest;
}

export interface ProviderManifestV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.provider;
  readonly id: string;
  readonly version: string;
  readonly protocol: {
    readonly minimum: typeof PROVIDER_PROTOCOL_VERSION;
    readonly maximum_exclusive: "2.0";
  };
  readonly capabilities: readonly ProviderCapabilityDeclaration[];
  readonly entrypoints: readonly ProviderEntrypoint[];
  readonly rulesets: readonly {
    readonly id: string;
    readonly version: string;
    readonly path: PortableRelativePath;
    readonly digest: Sha256Digest;
  }[];
  /** Requested permissions are an upper bound request; Core may only reduce them. */
  readonly requested_permissions: {
    readonly network: "denied";
    readonly environment: readonly string[];
    readonly input_kinds: readonly ("file" | "directory")[];
  };
  /** Provider declarations only narrow eligibility; Core and stage policies remain authoritative. */
  readonly exception_policy: {
    readonly fallback: {
      readonly default: "deny";
      readonly groups: readonly { readonly id: string; readonly capability_id: string; readonly provider_ids: readonly string[] }[];
    };
    readonly waiver: {
      readonly default: "deny";
      readonly waivable_rule_ids: readonly string[];
      readonly maximum_duration_seconds: number;
    };
    readonly deferred: {
      readonly default: "deny";
      readonly capability_ids: readonly string[];
      readonly maximum_duration_seconds: number;
    };
  };
}

export interface EffectiveProviderProfileV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.profile;
  readonly profile_id: string;
  readonly profile_digest: Sha256Digest;
  readonly lineage: readonly { readonly profile_id: string; readonly digest: Sha256Digest }[];
  readonly facts: JsonObject;
  readonly risk: {
    readonly level: "development" | "standard" | "protected";
    readonly protected_gate: boolean;
    readonly facts_digest: Sha256Digest;
  };
}

export interface ProviderScope {
  readonly project_id?: string;
  readonly module_id?: string;
  readonly unit_id?: string;
  readonly stage: string;
}

export interface ProviderSourceRevision {
  readonly commit: string;
  readonly worktree_digest: Sha256Digest;
  readonly repos?: Readonly<Record<string, { readonly commit: string; readonly worktree_digest: Sha256Digest }>>;
}

export interface ProjectProviderIntent extends ExtensibleWireObject {
  readonly instance_id: string;
  readonly id: string;
  readonly source: {
    readonly git: string;
    readonly ref: string;
    readonly subdir?: PortableRelativePath;
  };
  readonly enabled: boolean;
  readonly config: JsonObject;
  readonly bindings: readonly {
    readonly modules: readonly string[];
    readonly units?: readonly string[];
    readonly stages: readonly string[];
    readonly capabilities: readonly string[];
  }[];
  readonly trust: {
    readonly mode: "untrusted-development" | "signed-commit-or-tag" | "allowlisted-commit";
    readonly required_for_protected_gates: boolean;
  };
}

export interface ProjectProvidersV1 extends ExtensibleWireObject {
  readonly apiVersion: typeof PROVIDER_SCHEMA.projectProviders;
  readonly specVersion: typeof PROJECT_PROVIDER_CONFIG_VERSION;
  readonly providers: readonly ProjectProviderIntent[];
}

export interface ProjectProviderLockEntry extends ExtensibleWireObject {
  readonly instance_id: string;
  readonly id: string;
  readonly source: {
    readonly git: string;
    readonly requested_ref: string;
    readonly commit_oid: GitObjectId;
    readonly object_format: "sha1" | "sha256";
    readonly tree_oid: GitObjectId;
    /** null means the repository root; a lock never omits this normalization. */
    readonly subdir: PortableRelativePath | null;
  };
  readonly manifest: {
    readonly version: string;
    readonly digest: Sha256Digest;
    readonly rulesets: readonly { readonly id: string; readonly version: string; readonly digest: Sha256Digest }[];
  };
  readonly artifacts: {
    readonly provider_lock_digest: Sha256Digest;
    readonly sbom_digest: Sha256Digest;
    readonly entrypoint_digests: Readonly<Record<string, Sha256Digest>>;
  };
  readonly project_config_digest: Sha256Digest;
  readonly trust: {
    readonly status: "untrusted" | "verified" | "revoked";
    readonly verification_digest?: Sha256Digest;
  };
}

export interface ProjectProvidersLockV1 extends ExtensibleWireObject {
  readonly apiVersion: typeof PROVIDER_SCHEMA.projectProvidersLock;
  readonly specVersion: typeof PROJECT_PROVIDER_CONFIG_VERSION;
  readonly lock_digest: Sha256Digest;
  readonly providers: readonly ProjectProviderLockEntry[];
}

export type PlanNodeStatus = "selected" | "not_selected" | "unknown" | "blocked";
export type InvocationResultStatus = "passed" | "failed" | "deferred" | "error" | "cancelled";
export type ProviderRuleResultStatus = "passed" | "failed" | "not_applicable";
export type RuleCheckStatus = ProviderRuleResultStatus | "waived";
export type EvidenceStatus = "accepted" | "stale" | "expired" | "revoked";
export type GateDecisionStatus = "passed" | "passed_with_waiver" | "blocked";

export interface ProviderPlanNode extends ExtensibleWireObject {
  readonly node_id: string;
  readonly provider_instance_id: string;
  readonly capability_id: string;
  readonly state: PlanNodeStatus;
  readonly required: boolean;
  readonly selector_result: SelectorResult;
  readonly dependencies: readonly string[];
  readonly fallback_node_ids: readonly string[];
  readonly entrypoint_id?: string;
  readonly diagnostics: readonly ProviderDiagnostic[];
}

export interface ProviderPlanV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.plan;
  readonly plan_id: string;
  readonly plan_digest: Sha256Digest;
  readonly project_lock_digest: Sha256Digest;
  readonly profile_digest: Sha256Digest;
  readonly policy_digest: Sha256Digest;
  readonly source_revision: ProviderSourceRevision;
  readonly scope: ProviderScope;
  readonly capability_expression: CapabilityExpression;
  readonly nodes: readonly ProviderPlanNode[];
  readonly approval?: {
    readonly status: "not_required" | "pending" | "approved";
    readonly approval_ref?: string;
  };
}

export interface ProviderRequestInput {
  readonly id: string;
  readonly kind: "file" | "directory";
  readonly logical_path: PortableRelativePath;
  readonly sandbox_path: PortableRelativePath;
  readonly digest: Sha256Digest;
  readonly access: "read_only";
}

export interface ProviderRequestV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.request;
  readonly invocation_id: string;
  readonly plan: {
    readonly plan_id: string;
    readonly plan_digest: Sha256Digest;
    readonly node_id: string;
  };
  readonly provider_instance: {
    readonly instance_id: string;
    readonly provider_id: string;
    readonly project_lock_digest: Sha256Digest;
    readonly commit_oid: GitObjectId;
    readonly tree_oid: GitObjectId;
    readonly manifest_digest: Sha256Digest;
    readonly config_digest: Sha256Digest;
  };
  readonly scope: ProviderScope;
  readonly source_revision: ProviderSourceRevision;
  readonly inputs: readonly ProviderRequestInput[];
  readonly permissions: {
    readonly profile: typeof RESTRICTED_RUNNER_PROFILE;
    readonly network: "denied";
    readonly environment: readonly string[];
    readonly command: {
      readonly executable: PortableRelativePath;
      readonly args: readonly string[];
      readonly shell: false;
    };
  };
  readonly output: {
    readonly root: "output";
    readonly result_path: "output/result.json";
    readonly reports_root: "output/reports";
  };
  readonly limits: {
    readonly wall_time_ms: number;
    readonly memory_bytes: number;
    readonly process_count: number;
    readonly output_bytes: number;
    readonly temporary_storage_bytes: number;
  };
}

export interface ProviderDiagnostic {
  readonly code: ProviderDiagnosticCode;
  readonly message: string;
  readonly details?: JsonObject;
}

export type ProviderEmittedDiagnosticCode =
  | "INPUT_MISSING"
  | "INPUT_INVALID"
  | "CHECK_FAILED"
  | "CHECK_DEFERRED"
  | "PROVIDER_INTERNAL_ERROR";

export interface ProviderResultDiagnostic extends Omit<ProviderDiagnostic, "code"> {
  readonly code: ProviderEmittedDiagnosticCode;
}

interface ProviderResultCheckBase extends ExtensibleWireObject {
  readonly rule_id: string;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly message: string;
  readonly locations?: readonly {
    readonly path: PortableRelativePath;
    readonly line?: number;
    readonly column?: number;
  }[];
  readonly artifact_refs?: readonly PortableRelativePath[];
}

export type ProviderResultCheck =
  | (ProviderResultCheckBase & {
    readonly status: "passed" | "failed";
    readonly applicability_reason?: never;
  })
  | (ProviderResultCheckBase & {
    readonly status: "not_applicable";
    readonly applicability_reason: string;
  });

export interface ProviderResultV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.result;
  readonly invocation_id: string;
  readonly status: InvocationResultStatus;
  readonly checks: readonly ProviderResultCheck[];
  readonly diagnostics: readonly ProviderResultDiagnostic[];
  /** Required by schema exactly when status is deferred; it never authorizes direct passage. */
  readonly deferred?: {
    readonly reason: string;
    readonly retry_after: Rfc3339Timestamp;
    readonly deadline: Rfc3339Timestamp;
    readonly required_inputs?: readonly string[];
  };
  readonly reports: readonly {
    readonly path: PortableRelativePath;
    readonly media_type: string;
    readonly digest: Sha256Digest;
  }[];
}

export interface KnowledgeReceiptV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.knowledgeReceipt;
  readonly receipt_id: string;
  readonly provider_instance: {
    readonly instance_id: string;
    readonly provider_id: string;
    readonly project_lock_digest: Sha256Digest;
    readonly commit_oid: GitObjectId;
    readonly manifest_digest: Sha256Digest;
    readonly ruleset_digests: readonly Sha256Digest[];
  };
  readonly plan: {
    readonly plan_id: string;
    readonly plan_digest: Sha256Digest;
    readonly node_id: string;
  };
  readonly scope: ProviderScope;
  readonly topic: string;
  readonly sections: readonly {
    readonly id: string;
    readonly digest: Sha256Digest;
  }[];
  readonly loaded_at: Rfc3339Timestamp;
  readonly receipt_digest: Sha256Digest;
  readonly issuer: "aidlc-core";
  /** A receipt proves versioned loading only and is never accepted as gate Evidence. */
  readonly gate_eligible: false;
}

export interface ProviderEvidenceV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.evidence;
  readonly evidence_id: string;
  readonly state: EvidenceStatus;
  readonly invocation: {
    readonly invocation_id: string;
    readonly request_digest: Sha256Digest;
    readonly result_digest: Sha256Digest;
    readonly result_status: InvocationResultStatus;
  };
  readonly plan: {
    readonly plan_id: string;
    readonly plan_digest: Sha256Digest;
    readonly node_id: string;
  };
  readonly provider_instance: {
    readonly instance_id: string;
    readonly provider_id: string;
    readonly project_lock_digest: Sha256Digest;
    readonly commit_oid: GitObjectId;
    readonly manifest_digest: Sha256Digest;
    readonly config_digest: Sha256Digest;
  };
  readonly scope: ProviderScope;
  readonly source_revision: ProviderSourceRevision;
  readonly checks: readonly ProviderResultCheck[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly not_applicable: number;
  };
  readonly diagnostics: readonly ProviderDiagnostic[];
  readonly validity: {
    readonly issued_at: Rfc3339Timestamp;
    readonly expires_at: Rfc3339Timestamp;
    readonly invalidation_key: Sha256Digest;
  };
  readonly runner: {
    readonly id: string;
    readonly version: string;
    readonly sandbox: typeof RESTRICTED_RUNNER_PROFILE;
    readonly policy_digest: Sha256Digest;
  };
  readonly signature: {
    readonly algorithm: string;
    readonly key_id: string;
    readonly value: string;
  };
}

export interface ProviderWaiver {
  readonly waiver_id: string;
  readonly approval_ref: string;
  readonly reason: string;
  readonly scope: ProviderScope;
  readonly evidence_id: string;
  readonly rule_ids: readonly string[];
  readonly issued_at: Rfc3339Timestamp;
  readonly expires_at: Rfc3339Timestamp;
  readonly rerun_required_by: Rfc3339Timestamp;
}

export interface ProviderFallbackRecord {
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly trigger_diagnostic: ProviderDiagnosticCode;
  readonly policy_ref: string;
  readonly approval_ref?: string;
}

export interface GateDecisionV1_1 extends ExtensibleWireObject {
  readonly schema: typeof PROVIDER_SCHEMA.gateDecision;
  readonly decision_id: string;
  readonly status: GateDecisionStatus;
  readonly plan_id: string;
  readonly plan_digest: Sha256Digest;
  readonly project_lock_digest: Sha256Digest;
  readonly policy_digest: Sha256Digest;
  readonly scope: ProviderScope;
  readonly source_revision: ProviderSourceRevision;
  readonly evidence: readonly {
    readonly evidence_id: string;
    readonly digest: Sha256Digest;
    readonly state: EvidenceStatus;
  }[];
  readonly rule_evaluations: readonly {
    readonly evidence_id: string;
    readonly rule_id: string;
    readonly original_status: ProviderRuleResultStatus;
    readonly status: RuleCheckStatus;
    readonly waiver_id?: string;
  }[];
  readonly fallbacks: readonly ProviderFallbackRecord[];
  readonly waivers: readonly ProviderWaiver[];
  readonly issued_at: Rfc3339Timestamp;
  readonly issuer: "aidlc-core";
  readonly signature: {
    readonly algorithm: string;
    readonly key_id: string;
    readonly value: string;
  };
}

export type DiagnosticEmitter = "core" | "controlled-runner" | "provider";
export type DiagnosticCategory = "configuration" | "source" | "resolution" | "sandbox" | "result" | "evidence" | "gate" | "rule";
export type DiagnosticEffect = "blocked" | "failed" | "deferred" | "cancelled";

export interface ProviderDiagnosticDefinition {
  readonly code: string;
  readonly emitter: DiagnosticEmitter;
  readonly category: DiagnosticCategory;
  readonly default_effect: DiagnosticEffect;
  readonly retryable: boolean;
}

export const P0_PROVIDER_DIAGNOSTICS = [
  { code: "PROVIDER_CONFIG_INVALID", emitter: "core", category: "configuration", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_LOCK_MISSING", emitter: "core", category: "configuration", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_LOCK_MISMATCH", emitter: "core", category: "configuration", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_SOURCE_DISALLOWED", emitter: "core", category: "source", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_REF_UNRESOLVED", emitter: "core", category: "source", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_SOURCE_UNAVAILABLE", emitter: "core", category: "source", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_COMMIT_UNTRUSTED", emitter: "core", category: "source", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_COMMIT_REVOKED", emitter: "core", category: "source", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_SCHEMA_INCOMPATIBLE", emitter: "core", category: "configuration", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_MANIFEST_INVALID", emitter: "core", category: "configuration", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_CAPABILITY_MISSING", emitter: "core", category: "resolution", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_SELECTOR_UNKNOWN", emitter: "core", category: "resolution", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_DEPENDENCY_CYCLE", emitter: "core", category: "resolution", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_PLAN_CONFLICT", emitter: "core", category: "resolution", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_PLAN_STALE", emitter: "core", category: "resolution", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_SANDBOX_UNAVAILABLE", emitter: "controlled-runner", category: "sandbox", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_PERMISSION_DENIED", emitter: "controlled-runner", category: "sandbox", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_PATH_ESCAPE", emitter: "controlled-runner", category: "sandbox", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_NETWORK_DENIED", emitter: "controlled-runner", category: "sandbox", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_SHELL_DENIED", emitter: "controlled-runner", category: "sandbox", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_TIMEOUT", emitter: "controlled-runner", category: "sandbox", default_effect: "deferred", retryable: true },
  { code: "PROVIDER_CANCELLED", emitter: "controlled-runner", category: "sandbox", default_effect: "cancelled", retryable: true },
  { code: "PROVIDER_PROCESS_ERROR", emitter: "controlled-runner", category: "sandbox", default_effect: "failed", retryable: true },
  { code: "PROVIDER_RESULT_MISSING", emitter: "controlled-runner", category: "result", default_effect: "failed", retryable: true },
  { code: "PROVIDER_RESULT_INVALID", emitter: "controlled-runner", category: "result", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_RESULT_BINDING_MISMATCH", emitter: "controlled-runner", category: "result", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_EVIDENCE_STALE", emitter: "core", category: "evidence", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_EVIDENCE_EXPIRED", emitter: "core", category: "evidence", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_EVIDENCE_REVOKED", emitter: "core", category: "evidence", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_GATE_EVIDENCE_MISSING", emitter: "core", category: "gate", default_effect: "blocked", retryable: true },
  { code: "PROVIDER_WAIVER_INVALID", emitter: "core", category: "gate", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_FALLBACK_NOT_ALLOWED", emitter: "core", category: "gate", default_effect: "blocked", retryable: false },
  { code: "PROVIDER_DEFERRED_NOT_ALLOWED", emitter: "core", category: "gate", default_effect: "blocked", retryable: false },
  { code: "INPUT_MISSING", emitter: "provider", category: "rule", default_effect: "failed", retryable: false },
  { code: "INPUT_INVALID", emitter: "provider", category: "rule", default_effect: "failed", retryable: false },
  { code: "CHECK_FAILED", emitter: "provider", category: "rule", default_effect: "failed", retryable: false },
  { code: "CHECK_DEFERRED", emitter: "provider", category: "rule", default_effect: "deferred", retryable: true },
  { code: "PROVIDER_INTERNAL_ERROR", emitter: "provider", category: "rule", default_effect: "failed", retryable: true },
] as const satisfies readonly ProviderDiagnosticDefinition[];

export type ProviderDiagnosticCode = typeof P0_PROVIDER_DIAGNOSTICS[number]["code"];

export const PROVIDER_FALLBACK_POLICY_V1 = {
  id: "aidlc.provider-fallback-policy/v1",
  default: "deny",
  requires_manifest_declaration: true,
  requires_core_policy: true,
  requires_stage_policy: true,
  alternate_must_be_locked_in_same_plan: true,
  alternate_must_satisfy_same_capability_and_trust: true,
  eligible_diagnostics: [
    "PROVIDER_SOURCE_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_CANCELLED",
    "PROVIDER_PROCESS_ERROR",
    "PROVIDER_RESULT_MISSING",
    "CHECK_DEFERRED",
    "PROVIDER_INTERNAL_ERROR",
  ] as readonly ProviderDiagnosticCode[],
  never_for_diagnostics: [
    "CHECK_FAILED",
    "PROVIDER_CONFIG_INVALID",
    "PROVIDER_LOCK_MISSING",
    "PROVIDER_LOCK_MISMATCH",
    "PROVIDER_SOURCE_DISALLOWED",
    "PROVIDER_REF_UNRESOLVED",
    "PROVIDER_COMMIT_UNTRUSTED",
    "PROVIDER_COMMIT_REVOKED",
    "PROVIDER_SCHEMA_INCOMPATIBLE",
    "PROVIDER_MANIFEST_INVALID",
    "PROVIDER_PERMISSION_DENIED",
    "PROVIDER_PATH_ESCAPE",
    "PROVIDER_NETWORK_DENIED",
    "PROVIDER_SHELL_DENIED",
    "PROVIDER_RESULT_INVALID",
    "PROVIDER_RESULT_BINDING_MISMATCH",
    "PROVIDER_EVIDENCE_STALE",
    "PROVIDER_EVIDENCE_EXPIRED",
    "PROVIDER_EVIDENCE_REVOKED",
  ] as readonly ProviderDiagnosticCode[],
  failure_result_may_fallback: false,
  deferred_may_pass_directly: false,
} as const;

export const PROVIDER_WAIVER_POLICY_V1 = {
  id: "aidlc.provider-waiver-policy/v1",
  default: "deny",
  issuer: "aidlc-core",
  approval_actor: "human",
  allowed_original_rule_status: "failed",
  requires_manifest_rule_waivable: true,
  requires_core_policy: true,
  requires_stage_policy: true,
  requires_rule_ids: true,
  requires_evidence_binding: true,
  requires_scope_binding: true,
  requires_expiry: true,
  requires_rerun_deadline: true,
  cannot_waive: [
    "control-plane ownership",
    "schema or digest validity",
    "lock or source integrity",
    "trust or revocation",
    "sandbox or permission violations",
    "missing, stale, expired or revoked evidence",
    "invocation error, cancellation or deferred execution",
  ],
  passing_status_with_any_waiver: "passed_with_waiver",
} as const;

export const GIT_SOURCE_POLICY_V1 = {
  id: "aidlc.git-source-policy/v1",
  production_protocols: ["https", "ssh"] as const,
  test_fixture_protocols: ["file"] as const,
  denied_protocols: ["http", "git", "ftp"] as const,
  embedded_credentials: "deny",
  host_and_organization_allowlist: "required-by-project-policy",
  ref_resolution: "resolve-on-add-or-explicit-update",
  execution_source: "locked-commit-oid-only",
  checkout_mode: "detached",
  implicit_remote_refresh: false,
  install_executes_provider_code: false,
  hooks: "disabled-with-isolated-git-config",
  submodules: "never-init-or-recurse",
  lfs_and_custom_filters: "disabled-with-isolated-git-config",
  package_managers_and_build_scripts: "never-run-during-install",
  required_lock_fields: [
    "commit_oid",
    "object_format",
    "tree_oid",
    "source.subdir (null for repository root)",
    "manifest.digest",
    "manifest.rulesets[].digest",
    "artifacts.provider_lock_digest",
    "artifacts.sbom_digest",
    "artifacts.entrypoint_digests",
    "project_config_digest",
  ],
  development_untrusted: {
    allowed: true,
    only_non_protected_gates: true,
    explicit_approval_bound_to_lock_digest: true,
    sandbox_required: RESTRICTED_RUNNER_PROFILE,
  },
  protected_gate_trust: {
    untrusted_allowed: false,
    require_verified_signature_or_allowlisted_commit: true,
    require_current_conformance: true,
    revoked_always_blocked: true,
  },
} as const;

export const RESTRICTED_RUNNER_POLICY_V1 = {
  id: "aidlc.runner-policy/restricted-v1",
  fail_if_os_isolation_unavailable: true,
  identity: "non-privileged",
  filesystem: {
    provider_bundle: "read-only-locked-commit",
    authorized_inputs: "read-only-request-mounts",
    project_root_visibility: "none-except-authorized-inputs",
    writable_roots: ["output", "tmp"] as const,
    final_evidence_path_writable: false,
    state_and_audit_paths_writable: false,
    symlink_junction_reparse_escape: "deny",
    output_publication: "runner-validates-then-atomic-publish",
  },
  process: {
    shell: false,
    argv: "structured",
    executable_must_match_locked_entrypoint: true,
    child_processes_share_sandbox_and_limits: true,
  },
  network: {
    default: "deny",
    undeclared_or_unenforceable: "block-invocation",
  },
  environment: {
    inheritance: "deny",
    allowlist_only: true,
    secrets: "deny",
    git_credentials: "fetch-only-never-provider",
    home: "runner-temporary-directory",
  },
  limits: {
    finite_plan_values_required: true,
    default_wall_time_ms: 300_000,
    default_memory_bytes: 536_870_912,
    default_process_count: 32,
    default_output_bytes: 33_554_432,
    default_temporary_storage_bytes: 536_870_912,
    project_policy_may_lower_or_explicitly_approve_higher: true,
  },
  logs: {
    bounded: true,
    redact_credentials_and_secrets: true,
  },
} as const;

export const PROVIDER_CONTROL_PLANE_PATHS = [
  "aidlc/active/aidlc-state.md",
  "aidlc/active/audit.md",
  ".aidlc/evidence/**",
  ".aidlc/provider-gates/**",
] as const;

export const PROVIDER_RESULT_FORBIDDEN_FIELDS = [
  "plan_digest",
  "project_lock_digest",
  "source_revision",
  "runner",
  "evidence",
  "evidence_id",
  "evidence_state",
  "gate",
  "gate_decision",
  "approval",
  "approval_ref",
  "waiver",
  "signature",
  "attestation",
] as const;

export const EXTENSION_PROVIDER_PERMISSION_MATRIX = [
  { capability: "execute_code", restricted_extension: false, provider: true, core: true, provider_condition: RESTRICTED_RUNNER_PROFILE },
  { capability: "read_project", restricted_extension: false, provider: true, core: true, provider_condition: "request-authorized read-only inputs only" },
  { capability: "write_invocation_result", restricted_extension: false, provider: true, core: true, provider_condition: "invocation output only" },
  { capability: "write_advisory_markdown", restricted_extension: true, provider: true, core: true, provider_condition: "declared report in invocation output only" },
  { capability: "activate_canonical_stage", restricted_extension: false, provider: false, core: true, provider_condition: "never" },
  { capability: "write_state_or_audit", restricted_extension: false, provider: false, core: true, provider_condition: "never" },
  { capability: "issue_accepted_evidence", restricted_extension: false, provider: false, core: true, provider_condition: "controlled runner on behalf of Core" },
  { capability: "issue_gate_decision", restricted_extension: false, provider: false, core: true, provider_condition: "never" },
  { capability: "report_or_approve", restricted_extension: false, provider: false, core: true, provider_condition: "owning conductor or human policy only" },
  { capability: "merge_or_push", restricted_extension: false, provider: false, core: false, provider_condition: "human delivery boundary" },
] as const;

export const PROVIDER_CORE_INVARIANTS = [
  { id: "PCORE-001", statement: "Only Core and the owning conductor may mutate workflow state, audit, approval or report." },
  { id: "PCORE-002", statement: "A Provider may write only its untrusted Result and declared reports inside the invocation output." },
  { id: "PCORE-003", statement: "Only the Controlled Runner may issue accepted Provider Evidence; Core alone evaluates its validity." },
  { id: "PCORE-004", statement: "Only Core may issue GateDecision, and report must bind the current stage, scope, Plan and GateDecision." },
  { id: "PCORE-005", statement: "Execution uses the immutable commit OID and digests in the project lock, never a live branch or tag." },
  { id: "PCORE-006", statement: "Provider installation performs fetch, object verification and manifest reads without executing repository code." },
  { id: "PCORE-007", statement: "restricted-v1 fails closed when filesystem, process, environment or network isolation cannot be enforced." },
  { id: "PCORE-008", statement: "Provider-level not_applicable is a Core selector outcome; an invoked Provider may use it only per rule." },
  { id: "PCORE-009", statement: "Fallback never masks a failed rule, invalid Result, integrity failure, revocation or sandbox violation." },
  { id: "PCORE-010", statement: "Only a human-approved, scoped and expiring Core waiver may turn a failed rule into waived." },
  { id: "PCORE-011", statement: "Unknown schema fields and unsupported schema discriminators fail closed except namespaced extensions." },
  { id: "PCORE-012", statement: "Lock, config, Profile, policy, ruleset or source revision changes invalidate dependent Evidence and GateDecision." },
  { id: "PCORE-013", statement: "Restricted Extensions remain advisory-only and gain no Provider, Evidence, Gate or control-plane authority." },
  { id: "PCORE-014", statement: "A deferred Result never passes directly; it must be rerun, use an approved fallback, or remain blocked." },
  { id: "PCORE-015", statement: "A Knowledge Receipt proves locked content loading only and can never satisfy a quality Gate." },
] as const;

export const PROVIDER_STATE_MACHINES = {
  plan_node: {
    initial: "unresolved",
    terminal: ["selected", "not_selected", "blocked"],
    transitions: {
      unresolved: ["selected", "not_selected", "unknown", "blocked"],
      unknown: ["selected", "not_selected", "blocked"],
      selected: ["blocked"],
      not_selected: [],
      blocked: [],
    },
    transition_mode: "unknown resolution or selected-to-blocked requires a newly digested Plan",
  },
  invocation_result: {
    initial: "scheduled",
    terminal: ["passed", "failed", "deferred", "error", "cancelled"],
    transitions: {
      scheduled: ["running", "cancelled"],
      running: ["passed", "failed", "deferred", "error", "cancelled"],
      passed: [],
      failed: [],
      deferred: [],
      error: [],
      cancelled: [],
    },
    transition_mode: "terminal Result is immutable; retry creates a new invocation_id",
  },
  rule_check: {
    initial: "pending",
    terminal: ["passed", "failed", "not_applicable", "waived"],
    transitions: {
      pending: ["passed", "failed", "not_applicable"],
      failed: ["waived"],
      passed: [],
      not_applicable: [],
      waived: [],
    },
    transition_mode: "failed-to-waived is a Core Gate evaluation, never a Provider Result mutation",
  },
  evidence: {
    initial: "pending_validation",
    terminal: ["stale", "expired", "revoked"],
    transitions: {
      pending_validation: ["accepted"],
      accepted: ["stale", "expired", "revoked"],
      stale: ["revoked"],
      expired: ["revoked"],
      revoked: [],
    },
    transition_mode: "status changes are Core-issued validity events; the signed envelope remains immutable",
  },
  gate_decision: {
    initial: "evaluating",
    terminal: ["passed", "passed_with_waiver", "blocked"],
    transitions: {
      evaluating: ["passed", "passed_with_waiver", "blocked"],
      passed: [],
      passed_with_waiver: [],
      blocked: [],
    },
    transition_mode: "decision is immutable; changed inputs require a new decision_id",
  },
} as const;

export type ProviderStateMachineLayer = keyof typeof PROVIDER_STATE_MACHINES;

export function canProviderStateTransition(layer: ProviderStateMachineLayer, from: string, to: string): boolean {
  const transitions = PROVIDER_STATE_MACHINES[layer].transitions as Readonly<Record<string, readonly string[]>>;
  return transitions[from]?.includes(to) === true;
}

export function providerSchemaMajor(discriminator: string): number | undefined {
  const match = /\/v([1-9][0-9]*)(?:\.[0-9]+)?$/.exec(discriminator);
  return match ? Number(match[1]) : undefined;
}

export function isSupportedProviderSchema(discriminator: string): discriminator is ProviderSchemaDiscriminator {
  return (Object.values(PROVIDER_SCHEMA) as readonly string[]).includes(discriminator);
}

export function schemaOwnership(discriminator: string): ProviderSchemaOwnershipRecord | undefined {
  return PROVIDER_SCHEMA_OWNERSHIP.find((entry) => entry.discriminator === discriminator);
}

export function isPortableProviderPath(value: unknown): value is PortableRelativePath {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks the cross-authority and status-coupling rules that P0 freezes. Full required
 * field and unknown-field validation still belongs to the owner-published JSON Schema
 * and the Core schema reader introduced by P1-05.
 */
export function providerResultAuthorityViolations(value: unknown): string[] {
  if (!isRecord(value)) return ["Provider Result must be an object"];
  const violations: string[] = [];
  for (const field of PROVIDER_RESULT_FORBIDDEN_FIELDS) {
    if (field in value) violations.push(`Provider Result cannot declare Core-owned field ${field}`);
  }
  if (value.schema !== PROVIDER_SCHEMA.result) violations.push(`Provider Result schema must be ${PROVIDER_SCHEMA.result}`);
  if (value.status === "not_applicable") violations.push("Provider Result cannot use provider-level not_applicable; Core owns selector outcomes");
  const deferred = value.deferred;
  if (value.status === "deferred") {
    if (!isRecord(deferred)) {
      violations.push("Deferred Provider Result must declare deferred reason, retry_after and deadline");
    } else {
      if (typeof deferred.reason !== "string" || deferred.reason.trim().length === 0) violations.push("Deferred Provider Result deferred.reason must be non-empty");
      const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
      if (typeof deferred.retry_after !== "string" || !utc.test(deferred.retry_after)) violations.push("Deferred Provider Result deferred.retry_after must be UTC RFC 3339");
      if (typeof deferred.deadline !== "string" || !utc.test(deferred.deadline)) violations.push("Deferred Provider Result deferred.deadline must be UTC RFC 3339");
      if (typeof deferred.retry_after === "string" && typeof deferred.deadline === "string"
        && utc.test(deferred.retry_after) && utc.test(deferred.deadline)
        && Date.parse(deferred.retry_after) > Date.parse(deferred.deadline)) {
        violations.push("Deferred Provider Result retry_after must not be after deadline");
      }
    }
  } else if (deferred !== undefined) {
    violations.push("Only a deferred Provider Result may declare deferred metadata");
  }
  if (Array.isArray(value.checks)) {
    value.checks.forEach((candidate, index) => {
      if (!isRecord(candidate)) return;
      if (candidate.status === "waived") violations.push(`Provider Result checks[${index}] cannot self-declare waived`);
      if (candidate.status === "not_applicable" && (typeof candidate.applicability_reason !== "string" || candidate.applicability_reason.trim().length === 0)) {
        violations.push(`Provider Result checks[${index}] not_applicable requires applicability_reason`);
      }
      if (value.status === "passed" && candidate.status === "failed") {
        violations.push(`Passed Provider Result cannot contain failed checks[${index}]`);
      }
      for (const field of ["waiver", "waiver_id", "approval", "approval_ref", "gate", "evidence"]) {
        if (field in candidate) violations.push(`Provider Result checks[${index}] cannot declare Core-owned field ${field}`);
      }
    });
  }
  if (Array.isArray(value.diagnostics)) {
    value.diagnostics.forEach((candidate, index) => {
      if (!isRecord(candidate)) return;
      const definition = P0_PROVIDER_DIAGNOSTICS.find((entry) => entry.code === candidate.code);
      if (!definition || definition.emitter !== "provider") {
        violations.push(`Provider Result diagnostics[${index}].code must be a Provider-emitted diagnostic`);
      }
      if ("retryable" in candidate) violations.push(`Provider Result diagnostics[${index}] cannot override catalog retryable policy`);
    });
  }
  if (Array.isArray(value.reports)) {
    value.reports.forEach((candidate, index) => {
      if (!isRecord(candidate) || !isPortableProviderPath(candidate.path) || !(candidate.path as string).startsWith("reports/")) {
        violations.push(`Provider Result reports[${index}].path must be portable and under reports/`);
      }
      if (!isRecord(candidate) || typeof candidate.media_type !== "string" || candidate.media_type.trim().length === 0) {
        violations.push(`Provider Result reports[${index}].media_type must be non-empty`);
      }
      if (!isRecord(candidate) || typeof candidate.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(candidate.digest)) {
        violations.push(`Provider Result reports[${index}].digest must be sha256:<64 lowercase hex>`);
      }
    });
  }
  return violations;
}
