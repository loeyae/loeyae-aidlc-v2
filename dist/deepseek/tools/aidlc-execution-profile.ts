/**
 * Execution-profile classification and monotonic upgrade rules.
 *
 * This module is intentionally independent of WorkflowState persistence.  The
 * caller owns parsing/rendering the optional `execution_profile` state field.
 */

export type ExecutionProfileLevel = "lightweight" | "standard" | "complex";

/** The origin of the initial profile.  It is immutable after initialization. */
export type ExecutionProfileSource =
  | "scope_default"
  | "user_selected"
  | "engine_classified"
  | "legacy_conservative";

export type ExecutionProfileEventKind =
  | "initialized"
  /** Historical engine-originated escalation; retained for persisted-state compatibility. */
  | "engine_escalation"
  /** Actor-neutral escalation, used for an explicit user/profile command. */
  | "profile_escalation"
  | "risk_recorded";

export type ExecutionProfileEventActor = "engine" | "user" | "migration";

export type ProfileScope =
  | "bugfix"
  | "refactor"
  | "express"
  | "workshop"
  | "feature"
  | "mvp"
  | "classic"
  | "enterprise";

export type ProfileSignal =
  | "impact_boundary_unknown"
  | "cross_module_dependency"
  | "external_contract_changed"
  | "compatibility_or_rollback_risk"
  | "provider_or_mandatory_gate"
  | "security_or_sensitive_data"
  | "data_schema_or_migration"
  | "irreversible_change"
  | "architecture_or_cross_service_change"
  | "user_requested_full_flow";

export type ExecutionRiskFlag =
  | "unknown_impact_boundary"
  | "cross_module_dependency"
  | "external_contract_changed"
  | "compatibility_or_rollback_risk"
  | "provider_or_mandatory_gate"
  | "security_or_sensitive_data"
  | "data_schema_or_migration"
  | "irreversible_change"
  | "architecture_or_cross_service_change";

export type ExecutionProfileReasonCode =
  | "scope_default"
  | "legacy_conservative"
  | "user_requested_level"
  | ProfileSignal;

export interface ExecutionProfileEvent {
  readonly kind: ExecutionProfileEventKind;
  readonly at: string;
  readonly actor: ExecutionProfileEventActor;
  readonly reason_code: ExecutionProfileReasonCode;
  readonly from?: ExecutionProfileLevel;
  readonly to?: ExecutionProfileLevel;
  readonly detail?: string;
}

export interface ExecutionProfile {
  readonly level: ExecutionProfileLevel;
  readonly source: ExecutionProfileSource;
  readonly primary_reason: ExecutionProfileReasonCode;
  readonly active_risks: readonly ExecutionRiskFlag[];
  readonly events: readonly ExecutionProfileEvent[];
}

export interface ClassifiedExecutionProfile {
  readonly level: ExecutionProfileLevel;
  readonly source: ExecutionProfileSource;
  readonly primary_reason: ExecutionProfileReasonCode;
  readonly active_risks: readonly ExecutionRiskFlag[];
}

export interface ClassifyExecutionProfileInput {
  readonly scope: ProfileScope;
  readonly signals?: ReadonlySet<ProfileSignal>;
  readonly requested_level?: ExecutionProfileLevel;
  readonly current?: ExecutionProfile;
  /** True only while interpreting a WorkflowState without execution_profile. */
  readonly legacy?: boolean;
}

export interface CreateExecutionProfileEventInput {
  readonly kind: ExecutionProfileEventKind;
  readonly at: string;
  readonly actor: ExecutionProfileEventActor;
  readonly reason_code: ExecutionProfileReasonCode;
  readonly from?: ExecutionProfileLevel;
  readonly to?: ExecutionProfileLevel;
  readonly detail?: string;
}

export interface ApplyExecutionProfileInput {
  readonly current?: ExecutionProfile;
  readonly classified: ClassifiedExecutionProfile;
  readonly at: string;
  readonly actor?: ExecutionProfileEventActor;
  readonly detail?: string;
}

interface Candidate {
  readonly level: ExecutionProfileLevel;
  readonly source: ExecutionProfileSource;
  readonly reason: ExecutionProfileReasonCode;
  readonly priority: number;
}

const LEVEL_RANK: Readonly<Record<ExecutionProfileLevel, number>> = {
  lightweight: 1,
  standard: 2,
  complex: 3,
};

const SCOPES = new Set<ProfileScope>([
  "bugfix", "refactor", "express", "workshop", "feature", "mvp", "classic", "enterprise",
]);

const LIGHTWEIGHT_SCOPES = new Set<ProfileScope>([
  "bugfix", "refactor", "express", "workshop",
]);

const SIGNALS = new Set<ProfileSignal>([
  "impact_boundary_unknown",
  "cross_module_dependency",
  "external_contract_changed",
  "compatibility_or_rollback_risk",
  "provider_or_mandatory_gate",
  "security_or_sensitive_data",
  "data_schema_or_migration",
  "irreversible_change",
  "architecture_or_cross_service_change",
  "user_requested_full_flow",
]);

const RISK_FLAGS = new Set<ExecutionRiskFlag>([
  "unknown_impact_boundary",
  "cross_module_dependency",
  "external_contract_changed",
  "compatibility_or_rollback_risk",
  "provider_or_mandatory_gate",
  "security_or_sensitive_data",
  "data_schema_or_migration",
  "irreversible_change",
  "architecture_or_cross_service_change",
]);

const SIGNAL_MINIMUM_LEVEL: Readonly<Record<ProfileSignal, ExecutionProfileLevel>> = {
  impact_boundary_unknown: "standard",
  cross_module_dependency: "standard",
  external_contract_changed: "standard",
  compatibility_or_rollback_risk: "standard",
  provider_or_mandatory_gate: "standard",
  security_or_sensitive_data: "complex",
  data_schema_or_migration: "complex",
  irreversible_change: "complex",
  architecture_or_cross_service_change: "complex",
  user_requested_full_flow: "complex",
};

const SIGNAL_TO_RISK: Readonly<Partial<Record<ProfileSignal, ExecutionRiskFlag>>> = {
  impact_boundary_unknown: "unknown_impact_boundary",
  cross_module_dependency: "cross_module_dependency",
  external_contract_changed: "external_contract_changed",
  compatibility_or_rollback_risk: "compatibility_or_rollback_risk",
  provider_or_mandatory_gate: "provider_or_mandatory_gate",
  security_or_sensitive_data: "security_or_sensitive_data",
  data_schema_or_migration: "data_schema_or_migration",
  irreversible_change: "irreversible_change",
  architecture_or_cross_service_change: "architecture_or_cross_service_change",
};

const RISK_PRIORITY: Readonly<Record<ExecutionRiskFlag, number>> = {
  security_or_sensitive_data: 100,
  data_schema_or_migration: 90,
  irreversible_change: 80,
  architecture_or_cross_service_change: 70,
  external_contract_changed: 60,
  compatibility_or_rollback_risk: 50,
  cross_module_dependency: 40,
  unknown_impact_boundary: 30,
  provider_or_mandatory_gate: 20,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isExecutionProfileLevel(value: unknown): value is ExecutionProfileLevel {
  return value === "lightweight" || value === "standard" || value === "complex";
}

function isExecutionProfileSource(value: unknown): value is ExecutionProfileSource {
  return value === "scope_default" || value === "user_selected" ||
    value === "engine_classified" || value === "legacy_conservative";
}

function isEventKind(value: unknown): value is ExecutionProfileEventKind {
  return value === "initialized" || value === "engine_escalation" ||
    value === "profile_escalation" || value === "risk_recorded";
}

function isEventActor(value: unknown): value is ExecutionProfileEventActor {
  return value === "engine" || value === "user" || value === "migration";
}

function isScope(value: unknown): value is ProfileScope {
  return typeof value === "string" && SCOPES.has(value as ProfileScope);
}

export function isProfileSignal(value: unknown): value is ProfileSignal {
  return typeof value === "string" && SIGNALS.has(value as ProfileSignal);
}

function isRiskFlag(value: unknown): value is ExecutionRiskFlag {
  return typeof value === "string" && RISK_FLAGS.has(value as ExecutionRiskFlag);
}

function isReasonCode(value: unknown): value is ExecutionProfileReasonCode {
  return value === "scope_default" || value === "legacy_conservative" ||
    value === "user_requested_level" || isProfileSignal(value);
}

function isValidIsoTimestamp(value: string): boolean {
  const expression = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
  return expression.test(value) && Number.isFinite(Date.parse(value));
}

function rank(level: ExecutionProfileLevel): number {
  return LEVEL_RANK[level];
}

function isHigherLevel(candidate: ExecutionProfileLevel, current: ExecutionProfileLevel): boolean {
  return rank(candidate) > rank(current);
}

function defaultLevel(scope: ProfileScope): ExecutionProfileLevel {
  return LIGHTWEIGHT_SCOPES.has(scope) ? "lightweight" : "standard";
}

function signalPriority(signal: ProfileSignal): number {
  switch (signal) {
    case "security_or_sensitive_data": return 100;
    case "data_schema_or_migration": return 90;
    case "irreversible_change": return 80;
    case "architecture_or_cross_service_change": return 70;
    case "user_requested_full_flow": return 65;
    case "external_contract_changed": return 60;
    case "compatibility_or_rollback_risk": return 50;
    case "cross_module_dependency": return 40;
    case "impact_boundary_unknown": return 30;
    case "provider_or_mandatory_gate": return 20;
  }
}

function candidateForSignal(signal: ProfileSignal): Candidate {
  return {
    level: SIGNAL_MINIMUM_LEVEL[signal],
    source: signal === "user_requested_full_flow" ? "user_selected" : "engine_classified",
    reason: signal,
    priority: signalPriority(signal),
  };
}

function chooseCandidate(candidates: readonly Candidate[]): Candidate {
  const ordered = [...candidates].sort((left, right) => {
    const byLevel = rank(right.level) - rank(left.level);
    return byLevel !== 0 ? byLevel : right.priority - left.priority;
  });
  const winner = ordered[0];
  if (winner === undefined) {
    throw new Error("At least one execution-profile candidate is required");
  }
  return winner;
}

/** Validate event fields and the semantic contract shared by parsing and creation. */
export function assertExecutionProfileEvent(event: unknown): asserts event is ExecutionProfileEvent {
  if (!isRecord(event) || !isEventKind(event.kind) || !isEventActor(event.actor) ||
    typeof event.at !== "string" || !isValidIsoTimestamp(event.at) ||
    !isReasonCode(event.reason_code)) {
    throw new TypeError("Invalid execution profile event");
  }
  if (event.from !== undefined && !isExecutionProfileLevel(event.from)) {
    throw new TypeError("Invalid execution profile event from level");
  }
  if (event.to !== undefined && !isExecutionProfileLevel(event.to)) {
    throw new TypeError("Invalid execution profile event to level");
  }
  if (event.detail !== undefined && typeof event.detail !== "string") {
    throw new TypeError("Invalid execution profile event detail");
  }
  if (event.kind === "initialized") {
    if (event.from !== undefined || event.to === undefined) {
      throw new TypeError("initialized event requires to and forbids from");
    }
  } else if (event.kind === "engine_escalation" || event.kind === "profile_escalation") {
    if (event.from === undefined || event.to === undefined || !isHigherLevel(event.to, event.from)) {
      throw new TypeError(`${event.kind} requires increasing from and to levels`);
    }
  } else if (event.from !== undefined || event.to !== undefined) {
    throw new TypeError("risk_recorded event forbids from and to levels");
  }
}

/** Validate a persisted execution profile before it enters WorkflowState. */
export function assertExecutionProfile(profile: unknown): asserts profile is ExecutionProfile {
  if (!isRecord(profile) || !isExecutionProfileLevel(profile.level) ||
    !isExecutionProfileSource(profile.source) || !isReasonCode(profile.primary_reason) ||
    !Array.isArray(profile.active_risks) || !Array.isArray(profile.events) ||
    profile.events.length === 0) {
    throw new TypeError("Invalid execution profile");
  }
  const risks = profile.active_risks as ExecutionRiskFlag[];
  for (const risk of risks) {
    if (!isRiskFlag(risk)) throw new TypeError("Invalid execution profile risk");
  }
  const canonicalRisks = sortExecutionRiskFlags(risks);
  if (canonicalRisks.length !== risks.length ||
    canonicalRisks.some((risk, index) => risk !== risks[index])) {
    throw new TypeError("Execution profile risks must be unique and sorted by severity");
  }
  for (const event of profile.events) assertExecutionProfileEvent(event);
}

/** Validate a classifier result before it is materialized as persisted state. */
export function assertClassifiedExecutionProfile(
  profile: unknown,
): asserts profile is ClassifiedExecutionProfile {
  if (!isRecord(profile) || !isExecutionProfileLevel(profile.level) ||
    !isExecutionProfileSource(profile.source) || !isReasonCode(profile.primary_reason) ||
    !Array.isArray(profile.active_risks)) {
    throw new TypeError("Invalid classified execution profile");
  }
  const risks = profile.active_risks as ExecutionRiskFlag[];
  const canonicalRisks = sortExecutionRiskFlags(risks);
  if (canonicalRisks.length !== risks.length ||
    canonicalRisks.some((risk, index) => risk !== risks[index])) {
    throw new TypeError("Classified execution profile risks must be unique and sorted by severity");
  }
}

function assertClassifyInput(input: ClassifyExecutionProfileInput): void {
  if (!isScope(input.scope)) throw new TypeError(`Unknown scope: ${String(input.scope)}`);
  if (input.requested_level !== undefined && !isExecutionProfileLevel(input.requested_level)) {
    throw new TypeError(`Invalid requested level: ${String(input.requested_level)}`);
  }
  if (input.signals !== undefined && !(input.signals instanceof Set)) {
    throw new TypeError("signals must be a Set<ProfileSignal>");
  }
  for (const signal of input.signals ?? []) {
  if (!isProfileSignal(signal)) throw new TypeError(`Unknown profile signal: ${String(signal)}`);
  }
  if (input.current !== undefined) assertExecutionProfile(input.current);
}

/** Deduplicate and sort risks by descending safety significance. */
export function sortExecutionRiskFlags(risks: Iterable<ExecutionRiskFlag>): ExecutionRiskFlag[] {
  const unique = new Set<ExecutionRiskFlag>();
  for (const risk of risks) {
    if (!isRiskFlag(risk)) throw new TypeError(`Unknown execution risk: ${String(risk)}`);
    unique.add(risk);
  }
  return [...unique].sort((left, right) => {
    const byPriority = RISK_PRIORITY[right] - RISK_PRIORITY[left];
    return byPriority !== 0 ? byPriority : left.localeCompare(right);
  });
}

/** Merge signal-derived, legacy, and persisted risks, then return sorted flags. */
export function sortRisks(
  signals: Iterable<ProfileSignal>,
  legacy: boolean,
  existingRisks: Iterable<ExecutionRiskFlag> = [],
): ExecutionRiskFlag[] {
  const risks: ExecutionRiskFlag[] = [...existingRisks];
  if (legacy) risks.push("unknown_impact_boundary");
  for (const signal of signals) {
    if (!isProfileSignal(signal)) throw new TypeError(`Unknown profile signal: ${String(signal)}`);
    const risk = SIGNAL_TO_RISK[signal];
    if (risk !== undefined) risks.push(risk);
  }
  return sortExecutionRiskFlags(risks);
}

/**
 * Classify a profile without persisting it. Existing profiles are a level floor:
 * this function never returns a lower level than `current.level`.
 */
export function classifyExecutionProfile(
  input: ClassifyExecutionProfileInput,
): ClassifiedExecutionProfile {
  assertClassifyInput(input);
  const signals = input.signals ?? new Set<ProfileSignal>();
  const candidates: Candidate[] = [input.legacy === true
    ? { level: "standard", source: "legacy_conservative", reason: "legacy_conservative", priority: 10 }
    : { level: defaultLevel(input.scope), source: "scope_default", reason: "scope_default", priority: 10 }];

  for (const signal of signals) candidates.push(candidateForSignal(signal));

  if (input.requested_level !== undefined) {
    if (input.requested_level === "complex" && !signals.has("user_requested_full_flow")) {
      throw new TypeError(
        'requested_level "complex" requires signal "user_requested_full_flow"',
      );
    }
    candidates.push({
      level: input.requested_level,
      source: "user_selected",
      reason: "user_requested_level",
      priority: 66,
    });
  }

  const winner = chooseCandidate(candidates);
  const current = input.current;
  const escalated = current !== undefined && isHigherLevel(winner.level, current.level);
  const level = current === undefined || escalated ? winner.level : current.level;

  return {
    level,
    // Source names the initial origin and is immutable after initialization.
    source: current === undefined ? winner.source : current.source,
    // Match applyExecutionProfile: only an actual upgrade replaces the main reason.
    primary_reason: current === undefined || escalated ? winner.reason : current.primary_reason,
    active_risks: sortRisks(signals, input.legacy === true, current?.active_risks ?? []),
  };
}

/** Create a validated event without writing undefined optional fields. */
export function createExecutionProfileEvent(
  input: CreateExecutionProfileEventInput,
): ExecutionProfileEvent {
  if (!isEventKind(input.kind)) throw new TypeError(`Invalid event kind: ${String(input.kind)}`);
  if (!isEventActor(input.actor)) throw new TypeError(`Invalid event actor: ${String(input.actor)}`);
  if (!isValidIsoTimestamp(input.at)) throw new TypeError("Event timestamp must be ISO-8601 with timezone");
  if (!isReasonCode(input.reason_code)) throw new TypeError(`Invalid reason code: ${String(input.reason_code)}`);
  if (input.from !== undefined && !isExecutionProfileLevel(input.from)) throw new TypeError("Invalid event from level");
  if (input.to !== undefined && !isExecutionProfileLevel(input.to)) throw new TypeError("Invalid event to level");
  if (input.detail !== undefined && typeof input.detail !== "string") throw new TypeError("Event detail must be a string");

  const event: ExecutionProfileEvent = {
    kind: input.kind,
    at: input.at,
    actor: input.actor,
    reason_code: input.reason_code,
    ...(input.from !== undefined ? { from: input.from } : {}),
    ...(input.to !== undefined ? { to: input.to } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
  assertExecutionProfileEvent(event);
  return event;
}

/**
 * Apply a classification to a persisted profile.
 *
 * Levels are monotonic; source records initial origin; risks and event history
 * are merged and never overwritten.
 */
export function applyExecutionProfile(
  input: ApplyExecutionProfileInput,
): ExecutionProfile {
  const actor = input.actor ?? "engine";
  const { current, classified } = input;
  assertClassifiedExecutionProfile(classified);
  if (!isValidIsoTimestamp(input.at)) {
    throw new TypeError("Apply timestamp must be ISO-8601 with timezone");
  }
  if (!isEventActor(actor)) {
    throw new TypeError(`Invalid event actor: ${String(actor)}`);
  }
  if (input.detail !== undefined && typeof input.detail !== "string") {
    throw new TypeError("Apply detail must be a string");
  }
  if (current !== undefined) assertExecutionProfile(current);

  if (current === undefined) {
    return {
      level: classified.level,
      source: classified.source,
      primary_reason: classified.primary_reason,
      active_risks: sortExecutionRiskFlags(classified.active_risks),
      events: [createExecutionProfileEvent({
        kind: "initialized",
        at: input.at,
        actor,
        to: classified.level,
        reason_code: classified.primary_reason,
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
      })],
    };
  }

  const escalated = isHigherLevel(classified.level, current.level);
  const level = escalated ? classified.level : current.level;
  const activeRisks = sortExecutionRiskFlags([
    ...current.active_risks,
    ...classified.active_risks,
  ]);
  const priorRisks = new Set(current.active_risks);
  const addedRisks = activeRisks.filter((risk) => !priorRisks.has(risk));
  const events: ExecutionProfileEvent[] = [...current.events];

  if (escalated) {
    events.push(createExecutionProfileEvent({
      // Existing automatic callers retain the historical engine event. An
      // explicit actor is recorded as an actor-neutral profile escalation so
      // a user request is never mislabeled as engine-originated.
      kind: actor === "engine" ? "engine_escalation" : "profile_escalation",
      at: input.at,
      actor,
      from: current.level,
      to: level,
      reason_code: classified.primary_reason,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    }));
  } else if (addedRisks.length > 0) {
    events.push(createExecutionProfileEvent({
      kind: "risk_recorded",
      at: input.at,
      actor,
      reason_code: classified.primary_reason,
      detail: input.detail ?? `Added execution risks: ${addedRisks.join(", ")}`,
    }));
  }

  return {
    level,
    source: current.source,
    primary_reason: escalated ? classified.primary_reason : current.primary_reason,
    active_risks: activeRisks,
    events,
  };
}
