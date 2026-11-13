export const PROJECT_PROVIDER_CONFIG_VERSION = "1.0.0" as const;
export const RESTRICTED_RUNNER_PROFILE = "restricted-v1" as const;

export const PROVIDER_SCHEMA = {
  provider: "aidlc.provider/v1.1",
  projectProviders: "aidlc.project-providers/v1",
  projectProvidersLock: "aidlc.project-providers-lock/v1",
} as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };
export type Sha256Digest = `sha256:${string}`;
export type GitObjectId = string;
export type PortableRelativePath = string;

export interface ExtensibleWireObject {
  readonly extensions?: Readonly<Record<string, JsonObject>>;
}

export interface ProviderScope {
  readonly project_id?: string;
  readonly module_id?: string;
  readonly unit_id?: string;
  readonly stage: string;
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

export function isPortableProviderPath(value: unknown): value is PortableRelativePath {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..");
}