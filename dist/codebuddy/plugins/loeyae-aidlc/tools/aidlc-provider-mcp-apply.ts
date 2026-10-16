import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonicalProviderJson, sha256FileDigest, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";

type ObjectValue = Record<string, unknown>;
type Input = { hostConfig: string; hostDomains?: string };
const PLAN = "aidlc.mcp-plan/v2";
const LEDGER = "aidlc.mcp-ownership/v2";
const JOURNAL = "aidlc.mcp-transaction/v2";
function fail(reason: string): never { throw new Error(`MCP_APPLY_REJECTED: ${reason}`); }
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as ObjectValue;
}
function exact(value: unknown, keys: string[]): ObjectValue {
  const result = object(value);
  if (Object.keys(result).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(result, key))) fail("unknown or missing fields");
  return result;
}
/** All existing ancestors are checked, including Windows junctions. Parents must already exist.
 * Cooperating writers serialize on the canonical target. Hostile directory replacement is outside this local-user boundary. */
function safePath(path: string): string {
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (current === absolute && (!stat.isFile() || stat.nlink !== 1))) fail("symlink, hardlink or non-file target");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = realpathSync(dirname(absolute));
  return join(parent, absolute.slice(dirname(absolute).length + 1));
}
function read(path: string): { value: ObjectValue; digest: string | null } {
  safePath(path);
  if (!existsSync(path)) return { value: {}, digest: null };
  if (lstatSync(path).size > 4 * 1024 * 1024) fail("JSON file exceeds 4 MiB");
  const bytes = readFileSync(path);
  try { return { value: object(JSON.parse(bytes.toString("utf8"))), digest: sha256FileDigest(bytes) }; }
  catch { return fail("invalid JSON object"); }
}
function bytes(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function atomic(path: string, value: unknown): void {
  safePath(path);
  const temp = `${path}.tmp-${randomUUID()}`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    try { writeFileSync(fd, bytes(value)); fsyncSync(fd); } finally { closeSync(fd); }
    safePath(path); renameSync(temp, path);
  }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
function paths(projectRoot: string, input: Input) {
  const project = realpathSync(resolve(projectRoot));
  if (!input.hostConfig || /(^|[\\/])\.\.([\\/]|$)/.test(input.hostConfig)) fail("explicit target without traversal required");
  const target = safePath(resolve(project, input.hostConfig));
  // Do not turn source state, cache or transaction metadata into host configuration.
  if (!target.endsWith(".json") || /(^|[\\/])\.aidlc([\\/]|$)/i.test(target) || /\.aidlc-mcp-/i.test(target)) fail("unsupported target path");
  const domains = input.hostDomains === undefined ? null : safePath(resolve(project, input.hostDomains));
  if (domains === target) fail("domain file cannot be target");
  return { project, target, domains, ledger: `${target}.aidlc-mcp-ledger.json`, journal: `${target}.aidlc-mcp-journal.json`, lock: `${target}.aidlc-mcp-lock` };
}
type Paths = ReturnType<typeof paths>;
function emptyLedger(p: Paths) { return { schema: LEDGER, target: p.target, entries: {} as ObjectValue, transactions: {} as ObjectValue, pending: null as ObjectValue | null }; }
function ledger(p: Paths) {
  const current = read(p.ledger);
  if (current.digest === null) return { value: emptyLedger(p), digest: null };
  const legacy = current.value.schema === "aidlc.mcp-ownership/v1";
  const value = exact(current.value, ["schema", "target", "entries", "transactions", ...(legacy ? [] : ["pending"])]);
  if ((!legacy && value.schema !== LEDGER) || value.target !== p.target) fail("ledger version or target mismatch");
  const entries = object(value.entries);
  for (const entry of Object.values(entries)) {
    const item = exact(entry, ["consumer", "sources", "consumers", "before", "after", "credential_domain", "transaction", "state"]);
    if (!["committed", "retained"].includes(String(item.state)) || item.before !== null || !Array.isArray(item.sources) || typeof item.after !== "string" || typeof item.credential_domain !== "string" || !item.credential_domain) fail("invalid ownership record");
    for (const consumer of Object.values(object(item.consumers))) exact(consumer, ["sources", "source_digest"]);
  }
  const transactions = object(value.transactions);
  for (const receipt of Object.values(transactions)) exact(receipt, ["consumer", "source_digest", "after"]);
  return { value: { schema: LEDGER, target: p.target, entries, transactions, pending: legacy ? null : value.pending === null ? null : exact(value.pending, ["plan_digest", "journal_digest"]) }, digest: current.digest };
}
/** A restrictive initial transport policy. Values stay in memory; only digests enter artifacts.
 * Exact digest approval at apply is additional to this policy, never inherited from the plan. */
function safeConfig(config: ObjectValue): void {
  const reference = (value: unknown) => typeof value === "string" && /^\$\{env:[A-Z][A-Z0-9_]*\}$/.test(value);
  for (const map of [config.env, config.headers]) {
    if (map !== undefined && Object.values(object(map)).some((value) => !reference(value))) fail("credentials require controlled env references");
  }
  if (config.type === "stdio") {
    if (typeof config.command !== "string" || !/^[A-Za-z0-9_.-]+$/.test(config.command)) fail("unsupported command shape");
    if (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string" || !/^[A-Za-z0-9_./@:+-]+$/.test(arg) || /token|password|secret|api.?key/i.test(arg))) fail("unsupported or credential-like argument");
  } else {
    const url = new URL(String(config.url));
    if (url.protocol !== "https:" || url.search || url.username || url.password || url.hash) fail("managed HTTP requires HTTPS without credentials or query");
  }
}
function compute(p: Paths) {
  const { state, requirements, diagnostics } = resolveProviderMcpRequirements(p.project);
  if (diagnostics.length) fail("enabled Provider has no MCP declaration");
  const host = read(p.target);
  const servers = host.value.mcpServers === undefined ? {} : object(host.value.mcpServers);
  const ownership = ledger(p);
  const domainSnapshot = p.domains === null ? null : read(p.domains);
  if (domainSnapshot?.digest === null) fail("domain file is missing");
  const domains = domainSnapshot?.value ?? {};
  if (Object.values(domains).some((value) => typeof value !== "string")) fail("invalid credential domains");
  const configs: ObjectValue = {};
  const changes = [...new Set(requirements.map((item) => item.connection.name))].sort().map((name) => {
    const items = requirements.filter((item) => item.connection.name === name);
    if (new Set(items.map((item) => sha256ProviderDigest(item.connection))).size !== 1) fail("Provider requirements conflict");
    const connection = items[0].connection;
    safeConfig(connection.config);
    const configDigest = sha256ProviderDigest(connection.config);
    const present = Object.hasOwn(servers, name);
    const owned = Object.hasOwn(ownership.value.entries, name) ? object(ownership.value.entries[name]) : null;
    if (owned && owned.state !== "committed") fail("entry retained after conflict; manual reconciliation required");
    if (owned && (owned.after !== configDigest || owned.credential_domain !== connection.credential_domain)) fail("owned entry or credential domain conflict");
    if (present) {
      const current = object(servers[name]);
      const comparable = { ...current, ...(current.type === undefined && typeof current.command === "string" ? { type: "stdio" } : {}) };
      if (sha256ProviderDigest(comparable) !== configDigest) fail("host entry conflict (including pin/approval/disabled fields)");
      const domain = Object.hasOwn(domains, name) ? domains[name] : owned?.credential_domain ?? "none";
      if (domain !== connection.credential_domain) fail("credential domain differs or is unknown");
    } else if (owned) fail("owned entry was removed externally");
    configs[name] = connection.config;
    return { name, action: present ? "reuse" : "add", config_digest: configDigest, credential_domain: connection.credential_domain,
      ownership: owned ? "managed" : present ? "external" : "new", sources: items.map((item) => item.source) };
  });
  const payload = { schema: PLAN, consumer: sha256ProviderDigest({ project: p.project }), target: p.target, structure: "mcpServers",
    domains_path: p.domains, domains_digest: domainSnapshot?.digest ?? null,
    source_digest: sha256ProviderDigest({ config: state.config, lock: state.lock }), target_digest: host.digest, ledger_digest: ownership.digest, ledger_state_digest: sha256ProviderDigest(ownership.value), changes };
  return { plan: { ...payload, plan_digest: sha256ProviderDigest(payload) }, host, ownership, configs };
}
export function planProviderMcp(projectRoot: string, input: Input) { return compute(paths(projectRoot, input)).plan; }

function validatePlan(value: unknown) {
  const plan = exact(value, ["schema", "consumer", "target", "structure", "domains_path", "domains_digest", "source_digest", "target_digest", "ledger_digest", "ledger_state_digest", "changes", "plan_digest"]);
  const { plan_digest, ...payload } = plan;
  if (plan.schema !== PLAN || plan.structure !== "mcpServers" || sha256ProviderDigest(payload) !== plan_digest || !Array.isArray(plan.changes)) fail("plan version or digest mismatch");
  // Full nested shape and values are compared against freshly computed requirements before writing.
  return plan;
}
function approved(plan: ObjectValue, approvals: readonly string[]): void {
  for (const change of plan.changes as ObjectValue[]) if (!approvals.includes(String(change.config_digest))) fail("explicit --approve-config digest required for every connection");
}
/** Same target lock across projects; never steal a live or old lock on a timer. */
function locked<T>(p: Paths, run: (guard: () => void) => T): T {
  safePath(p.lock);
  let fd: number;
  try { fd = openSync(p.lock, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("target busy; an orphan lock requires operator PID verification before removal"); throw error; }
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const guard = () => {
    safePath(p.lock);
    if (!existsSync(p.lock) || readFileSync(p.lock, "utf8") !== token) fail("target lock changed; preserve operator state");
  };
  try { writeFileSync(fd, token); return run(guard); }
  finally {
    closeSync(fd);
    try { guard(); unlinkSync(p.lock); } catch { /* Never remove a replacement lock. */ }
  }
}
type Fault = (point: "before-config" | "after-config" | "recovery-before-ledger" | "after-ledger") => void;
function nextLedger(p: Paths, plan: ObjectValue, previous: ReturnType<typeof emptyLedger> | null, after: string) {
  if (!previous) return null;
  const next = structuredClone(previous);
  for (const [id, receipt] of Object.entries(next.transactions)) if (object(receipt).consumer === plan.consumer) delete next.transactions[id];
  for (const change of plan.changes as ObjectValue[]) {
    if (change.action === "reuse" && change.ownership === "managed") {
      const entry = object(next.entries[String(change.name)]);
      Object.defineProperty(object(entry.consumers), String(plan.consumer), { enumerable: true, configurable: true, writable: true,
        value: { sources: change.sources, source_digest: plan.source_digest } });
      continue;
    }
    if (change.action !== "add") continue;
    if (Object.hasOwn(next.entries, String(change.name))) fail("ownership already exists");
    Object.defineProperty(next.entries, String(change.name), { enumerable: true, configurable: true, writable: true, value: {
      consumer: plan.consumer, sources: change.sources, before: null, after: change.config_digest,
      consumers: { [String(plan.consumer)]: { sources: change.sources, source_digest: plan.source_digest } },
      credential_domain: change.credential_domain, transaction: plan.plan_digest, state: "committed",
    } });
  }
  Object.defineProperty(next.transactions, String(plan.plan_digest), { enumerable: true, configurable: true, writable: true,
    value: { consumer: plan.consumer, source_digest: plan.source_digest, after } });
  return next;
}
/** The journal is intent, never authority: recovery consumes a current ledger prepare anchor. */
function transaction(p: Paths, plan: ObjectValue, own: ReturnType<typeof ledger>, next: ReturnType<typeof emptyLedger>, hostAfter: string | null, config: ObjectValue | null, fault?: Fault, guard?: () => void) {
  const journal = { schema: JOURNAL, plan, after: hostAfter, ledger_before: own.value, ledger_after: next };
  verifyInputs(p, plan, guard);
  if (ledger(p).digest !== plan.ledger_digest || read(p.target).digest !== plan.target_digest) fail("host or ledger changed before preparation");
  atomic(p.journal, journal);
  const preparation = { ...own.value, pending: { plan_digest: plan.plan_digest, journal_digest: sha256ProviderDigest(journal) } };
  atomic(p.ledger, preparation);
  const prepared = sha256FileDigest(bytes(preparation));
  fault?.("before-config");
  verifyInputs(p, plan, guard);
  if (read(p.target).digest !== plan.target_digest || ledger(p).digest !== prepared) fail("host or ledger changed before publication");
  if (config) atomic(p.target, config);
  fault?.("after-config");
  if (read(p.target).digest !== hostAfter || ledger(p).digest !== prepared) fail("host or ledger changed after publication; recovery required");
  verifyInputs(p, plan, guard);
  atomic(p.ledger, next);
  fault?.("after-ledger");
  unlinkSync(p.journal);
}
function verifyInputs(p: Paths, plan: ObjectValue, guard?: () => void) {
  guard?.();
  const { state } = resolveProviderMcpRequirements(p.project);
  if (sha256ProviderDigest({ config: state.config, lock: state.lock }) !== plan.source_digest) fail("source changed during pending transaction");
  if ((p.domains === null ? null : read(p.domains).digest) !== plan.domains_digest) fail("domains changed during pending transaction");
}
/** Read-only decision shared by diagnostics, explicit recovery and apply/cleanup retry. */
function recoveryState(p: Paths, plan: ObjectValue) {
  const pending = read(p.journal);
  if (pending.digest === null) return null;
  const journal = exact(pending.value, ["schema", "plan", "after", "ledger_before", "ledger_after"]);
  if (journal.schema !== JOURNAL || canonicalProviderJson(journal.plan) !== canonicalProviderJson(plan)) fail("pending transaction requires its original v2 transaction plan");
  verifyInputs(p, plan);
  const own = ledger(p);
  const baseline = object(journal.ledger_before) as ReturnType<typeof emptyLedger>;
  if (sha256ProviderDigest(baseline) !== plan.ledger_state_digest || baseline.pending !== null) fail("invalid transaction baseline");
  const next = plan.schema === PLAN ? nextLedger(p, plan, baseline, String(journal.after))! : cleanupLedger(plan, baseline, journal.after as string | null);
  if (canonicalProviderJson(next) !== canonicalProviderJson(journal.ledger_after)) fail("invalid transaction ledger");
  const afterDigest = sha256FileDigest(bytes(next));
  // A durable abort receipt makes rollback itself restartable between ledger publication
  // and journal removal. It is separate from the successful transaction receipt.
  const aborted = structuredClone(baseline);
  aborted.transactions[`abort:${sha256ProviderDigest(journal)}`] = { consumer: plan.consumer, source_digest: plan.source_digest, after: plan.target_digest };
  const abortCompleted = own.digest === sha256FileDigest(bytes(aborted));
  const anchor = own.value.pending;
  const authorized = anchor?.plan_digest === plan.plan_digest && anchor?.journal_digest === sha256ProviderDigest(journal)
    && canonicalProviderJson({ ...own.value, pending: null }) === canonicalProviderJson(baseline);
  const completed = own.digest === afterDigest && Object.hasOwn(own.value.transactions, String(plan.plan_digest));
  if (!authorized && !completed && !abortCompleted) {
    if (own.digest === plan.ledger_digest && read(p.target).digest === plan.target_digest) return { phase: "unprepared" as const, pending, own, baseline, next, host: plan.target_digest };
    fail("recovery conflict: no current ledger authorization");
  }
  const host = read(p.target).digest;
  if (abortCompleted) {
    if (host !== plan.target_digest) fail("recovery conflict: host changed after abort");
    return { phase: "after-abort" as const, pending, own, baseline, next: aborted, host };
  }
  if (host !== plan.target_digest && host !== journal.after) fail("recovery conflict: host changed; preserve user edits");
  if (host === plan.target_digest && host !== journal.after && authorized) {
    return { phase: "before-config" as const, pending, own, baseline, next: aborted, host };
  }
  if (host !== journal.after) fail("recovery conflict: inconsistent transaction");
  return { phase: completed ? "after-ledger" as const : "after-config" as const, pending, own, baseline, next, host };
}
function recover(p: Paths, plan: ObjectValue, fault?: Fault, guard?: () => void, explicit = false): boolean {
  const state = recoveryState(p, plan);
  if (!state) return false;
  const { phase, pending, own, next, host } = state;
  if (explicit && phase === "unprepared") fail("recovery conflict: no current ledger authorization; preserve unprepared journal");
  if (phase === "after-config" || phase === "after-ledger") fault?.("recovery-before-ledger");
  verifyInputs(p, plan, guard);
  if (read(p.target).digest !== host || ledger(p).digest !== own.digest || read(p.journal).digest !== pending.digest) fail("recovery conflict: host, ledger or journal changed before metadata publication");
  if (phase === "unprepared") { unlinkSync(p.journal); return false; }
  if (phase === "before-config" || phase === "after-abort") {
    if (phase === "before-config") atomic(p.ledger, next);
    fault?.("after-ledger");
    guard?.();
    if (read(p.journal).digest !== pending.digest) fail("recovery conflict: journal changed before abort finalization");
    unlinkSync(p.journal);
    if (explicit) return true;
    fail("transaction aborted before config; re-plan against current ledger");
  }
  if (phase !== "after-ledger") atomic(p.ledger, next);
  fault?.("after-ledger");
  guard?.();
  if (read(p.journal).digest !== pending.digest) fail("recovery conflict: journal changed before removal");
  unlinkSync(p.journal);
  return true;
}
function assertIdentity(p: Paths, plan: ObjectValue) {
  if (plan.target !== p.target || plan.domains_path !== p.domains || plan.consumer !== sha256ProviderDigest({ project: p.project })) fail("plan project or explicit target mismatch");
}
export function applyProviderMcp(projectRoot: string, input: Input & { plan: unknown; approvedConfigs: readonly string[] }, fault?: Fault) {
  const p = paths(projectRoot, input);
  const plan = validatePlan(input.plan);
  assertIdentity(p, plan);
  approved(plan, input.approvedConfigs);
  return locked(p, (guard) => {
    if (recover(p, plan, fault, guard)) return { status: "recovered", target: p.target };
    const current = compute(p);
    if (current.ownership.value.pending) fail("pending transaction requires recovery");
    const receipt = current.ownership.value.transactions[String(plan.plan_digest)];
    if (receipt) {
      const value = object(receipt);
      const referencesValid = (plan.changes as ObjectValue[]).every((change) => {
        if (change.ownership === "external") return true;
        const entry = current.ownership.value.entries[String(change.name)];
        if (!entry) return false;
        const item = object(entry);
        return item.state === "committed" && item.after === change.config_digest && item.credential_domain === change.credential_domain
          && canonicalProviderJson(object(item.consumers)[String(plan.consumer)] ?? null) === canonicalProviderJson({ sources: change.sources, source_digest: plan.source_digest });
      });
      if (referencesValid && value.consumer === plan.consumer && value.source_digest === current.plan.source_digest && value.after === current.host.digest && current.plan.domains_digest === plan.domains_digest) return { status: "unchanged", target: p.target };
      fail("completed plan is stale");
    }
    if (canonicalProviderJson(current.plan) !== canonicalProviderJson(plan)) fail("plan stale: source, target, domains or ledger changed");
    const referenceChanged = current.plan.changes.some((change) => {
      if (change.ownership !== "managed") return false;
      const consumers = object(object(current.ownership.value.entries[change.name]).consumers);
      return sha256ProviderDigest(consumers[current.plan.consumer] ?? null) !== sha256ProviderDigest({ sources: change.sources, source_digest: plan.source_digest });
    });
    const adding = current.plan.changes.some((change) => change.action === "add");
    if (!adding && !referenceChanged) return { status: "unchanged", target: p.target };
    const additions = Object.fromEntries(current.plan.changes.filter((change) => change.action === "add").map((change) => [change.name, current.configs[change.name]]));
    const next = { ...current.host.value, mcpServers: { ...object(current.host.value.mcpServers ?? {}), ...additions } };
    const after = adding ? sha256FileDigest(bytes(next)) : current.host.digest!;
    transaction(p, plan, current.ownership, nextLedger(p, plan, current.ownership.value, after)!, after, adding ? next : null, fault, guard);
    return { status: "applied", target: p.target };
  });
}

const CLEANUP = "aidlc.mcp-cleanup-plan/v1";
type CleanupInput = Input & { releaseAll?: boolean };
function computeCleanup(p: Paths, releaseAll: boolean) {
  const { state, requirements, diagnostics } = resolveProviderMcpRequirements(p.project);
  if (diagnostics.length && !releaseAll) fail("enabled Provider has unknown MCP requirements");
  const host = read(p.target);
  const own = ledger(p);
  const domainSnapshot = p.domains === null ? null : read(p.domains);
  if (domainSnapshot?.digest === null) fail("domain file is missing");
  const domains = domainSnapshot?.value ?? {};
  if (Object.values(domains).some((value) => typeof value !== "string")) fail("invalid credential domains");
  const consumer = sha256ProviderDigest({ project: p.project });
  const sourceDigest = sha256ProviderDigest({ config: state.config, lock: state.lock });
  const servers = object(host.value.mcpServers ?? {});
  const changes = Object.keys(own.value.entries).sort().flatMap((name) => {
    const entry = object(own.value.entries[name]);
    const consumers = object(entry.consumers);
    if (!Object.hasOwn(consumers, consumer)) return [];
    const needed = requirements.filter((item) => item.connection.name === name);
    const sources = needed.map((item) => item.source);
    const present = Object.hasOwn(servers, name);
    const reason = entry.state === "retained" ? "previous_conflict_retained" : !present ? "entry_missing"
      : sha256ProviderDigest(servers[name]) !== entry.after ? "user_modified"
      : p.domains !== null && (!Object.hasOwn(domains, name) || domains[name] !== entry.credential_domain) ? "credential_domain_unknown_or_changed" : null;
    const release = releaseAll || needed.length === 0;
    const remaining = Object.keys(consumers).filter((id) => id !== consumer);
    const refresh = canonicalProviderJson(consumers[consumer]) !== canonicalProviderJson({ sources, source_digest: sourceDigest });
    const action = !release ? refresh ? "refresh" : "keep" : reason ? "retain" : remaining.length ? "release" : "delete";
    return [{ name, action, reason, release, sources, remaining_consumers: remaining.sort(), entry_digest: sha256ProviderDigest(entry) }];
  });
  const nextServers = { ...servers };
  for (const change of changes) if (change.action === "delete") delete nextServers[change.name];
  const nextHost = changes.some((change) => change.action === "delete") ? { ...host.value, mcpServers: nextServers } : null;
  const payload = { schema: CLEANUP, consumer, target: p.target, domains_path: p.domains, domains_digest: domainSnapshot?.digest ?? null,
    release_all: releaseAll, source_digest: sourceDigest, target_digest: host.digest, target_after: nextHost ? sha256FileDigest(bytes(nextHost)) : host.digest,
    ledger_digest: own.digest, ledger_state_digest: sha256ProviderDigest(own.value), changes };
  return { plan: { ...payload, plan_digest: sha256ProviderDigest(payload) }, host, own, nextHost };
}
function cleanupLedger(plan: ObjectValue, previous: ReturnType<typeof emptyLedger>, after: string | null) {
  const next = structuredClone(previous);
  for (const change of plan.changes as ObjectValue[]) {
    const entry = object(next.entries[String(change.name)]);
    if (sha256ProviderDigest(entry) !== change.entry_digest || !Object.hasOwn(object(entry.consumers), String(plan.consumer))) fail("cleanup ownership conflict");
    if (change.action === "keep") continue;
    if (change.action === "refresh") { object(entry.consumers)[String(plan.consumer)] = { sources: change.sources, source_digest: plan.source_digest }; continue; }
    delete object(entry.consumers)[String(plan.consumer)];
    if (change.action === "delete") delete next.entries[String(change.name)];
    if (change.action === "retain") entry.state = "retained";
  }
  for (const [id, receipt] of Object.entries(next.transactions)) if (object(receipt).consumer === plan.consumer) delete next.transactions[id];
  next.transactions[String(plan.plan_digest)] = { consumer: plan.consumer, source_digest: plan.source_digest, after };
  return next;
}
export function planProviderMcpCleanup(projectRoot: string, input: CleanupInput) { return computeCleanup(paths(projectRoot, input), input.releaseAll === true).plan; }
function validateCleanupPlan(value: unknown) {
  const plan = exact(value, ["schema", "consumer", "target", "domains_path", "domains_digest", "release_all", "source_digest", "target_digest", "target_after", "ledger_digest", "ledger_state_digest", "changes", "plan_digest"]);
  const { plan_digest, ...payload } = plan;
  if (plan.schema !== CLEANUP || sha256ProviderDigest(payload) !== plan_digest || !Array.isArray(plan.changes) || typeof plan.release_all !== "boolean") fail("cleanup plan version, digest or release mode mismatch");
  return plan;
}
export function cleanupProviderMcp(projectRoot: string, input: CleanupInput & { plan: unknown }, fault?: Fault) {
  const p = paths(projectRoot, input);
  const plan = validateCleanupPlan(input.plan);
  if (plan.release_all !== (input.releaseAll === true)) fail("cleanup plan release mode mismatch");
  assertIdentity(p, plan);
  return locked(p, (guard) => {
    if (recover(p, plan, fault, guard)) return { status: "recovered", target: p.target, changes: plan.changes };
    const current = computeCleanup(p, input.releaseAll === true);
    if (current.own.value.pending) fail("pending transaction requires recovery");
    const receipt = current.own.value.transactions[String(plan.plan_digest)];
    if (receipt && object(receipt).after === current.host.digest && plan.source_digest === current.plan.source_digest && plan.domains_digest === current.plan.domains_digest) return { status: "unchanged", target: p.target, changes: plan.changes };
    if (canonicalProviderJson(plan) !== canonicalProviderJson(current.plan)) fail("cleanup plan stale: source, target, domains or ledger changed");
    if (!current.plan.changes.some((change) => change.action !== "keep")) return { status: "unchanged", target: p.target, changes: plan.changes };
    transaction(p, plan, current.own, cleanupLedger(plan, current.own.value, current.plan.target_after), current.plan.target_after, current.nextHost, fault, guard);
    return { status: "cleaned", target: p.target, changes: plan.changes };
  });
}

function transactionPlan(value: unknown) {
  return object(value).schema === CLEANUP ? validateCleanupPlan(value) : validatePlan(value);
}

/** An explicit original plan is required; the journal is never used to recreate approval. */
export function recoverProviderMcp(projectRoot: string, input: Input & { plan: unknown }) {
  const p = paths(projectRoot, input);
  const plan = transactionPlan(input.plan);
  assertIdentity(p, plan);
  if (read(p.journal).digest === null) {
    if (ledger(p).value.pending) fail("recovery conflict: prepared ledger is missing its journal; restore original artifacts, do not re-plan");
    return { status: "unchanged", target: p.target };
  }
  return locked(p, (guard) => {
    const state = recoveryState(p, plan);
    if (!state) return { status: "unchanged", target: p.target };
    recover(p, plan, undefined, guard, true);
    return { status: state.phase === "before-config" || state.phase === "after-abort" ? "aborted" : "recovered", target: p.target };
  });
}

/** Advisory snapshot only. Never serialize raw JSON, server names, config values or errors. */
export function statusProviderMcp(projectRoot: string, input: Input) {
  const p = paths(projectRoot, input);
  const summary = {
    target: { path: p.target, exists: false, digest: null as string | null },
    ledger: { exists: false, schema: "absent", entries: 0, transactions: 0, pending: false },
    journal: { exists: false, schema: "absent" },
    lock: { exists: false },
  };
  const result = (status: string, phase: string, diagnostic: string, recoverable = false) => ({
    status, phase, diagnostic, recoverable, can_recover: recoverable && !summary.lock.exists, ...summary,
  });
  let stage = "target";
  try {
    safePath(p.lock);
    summary.lock.exists = existsSync(p.lock);
    summary.target.exists = existsSync(p.target);
    const host = read(p.target);
    summary.target.exists = host.digest !== null; summary.target.digest = host.digest;
    const servers = object(host.value.mcpServers ?? {});
    stage = "ledger";
    safePath(p.ledger);
    summary.ledger.exists = existsSync(p.ledger);
    const rawLedger = read(p.ledger);
    summary.ledger.exists = rawLedger.digest !== null;
    if (rawLedger.digest !== null) {
      if (typeof rawLedger.value.schema !== "string") return result("corrupt", "unknown", "ledger-validation-failed");
      if (![LEDGER, "aidlc.mcp-ownership/v1"].includes(String(rawLedger.value.schema))) return result("incompatible", "unknown", "unsupported-ledger-version");
      summary.ledger.schema = String(rawLedger.value.schema);
    }
    const own = ledger(p);
    summary.ledger.entries = Object.keys(own.value.entries).length;
    summary.ledger.transactions = Object.keys(own.value.transactions).length;
    summary.ledger.pending = own.value.pending !== null;
    stage = "journal";
    safePath(p.journal);
    summary.journal.exists = existsSync(p.journal);
    const pending = read(p.journal);
    summary.journal.exists = pending.digest !== null;
    if (pending.digest === null) {
      if (own.value.pending) return result("conflict", "unknown", "missing-authorized-journal");
      if (Object.entries(own.value.entries).some(([name, entry]) => {
        const item = object(entry);
        return item.state !== "committed" || !Object.hasOwn(servers, name) || sha256ProviderDigest(servers[name]) !== item.after;
      })) return result("conflict", "completed", "managed-config-changed-or-retained");
      return summary.ledger.transactions ? result("completed", "completed", "no-pending-transaction") : result("no-transaction", "none", "no-pending-transaction");
    }
    if (pending.value.schema !== JOURNAL) {
      if (typeof pending.value.schema !== "string") return result("corrupt", "unknown", "journal-validation-failed");
      summary.journal.schema = "unsupported";
      return result("incompatible", "unknown", "original-v2-journal-required-no-auto-upgrade");
    }
    summary.journal.schema = JOURNAL;
    exact(pending.value, ["schema", "plan", "after", "ledger_before", "ledger_after"]);
    const plan = transactionPlan(pending.value.plan);
    stage = "recovery";
    assertIdentity(p, plan);
    const state = recoveryState(p, plan);
    if (!state) return result("conflict", "unknown", "snapshot-changed-retry-status");
    if (state.phase === "unprepared") return result("conflict", state.phase, "no-current-ledger-authorization");
    return result(state.phase === "after-ledger" || state.phase === "after-abort" ? "completed" : "recoverable", state.phase,
      summary.lock.exists ? "verify-owner-process-before-removing-orphan-lock" : state.phase === "before-config" ? "recovery-will-abort-before-config" : "original-plan-required", true);
  } catch {
    return result(stage === "recovery" ? "conflict" : "corrupt", "unknown", `${stage}-validation-failed`);
  }
}
