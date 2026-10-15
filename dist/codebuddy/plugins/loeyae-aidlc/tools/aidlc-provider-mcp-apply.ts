import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonicalProviderJson, sha256FileDigest, sha256ProviderDigest } from "./aidlc-project-provider.js";
import { resolveProviderMcpRequirements } from "./aidlc-provider-mcp.js";

type ObjectValue = Record<string, unknown>;
type Input = { hostConfig: string; hostDomains?: string };
const PLAN = "aidlc.mcp-plan/v1";
const LEDGER = "aidlc.mcp-ownership/v1";
const JOURNAL = "aidlc.mcp-transaction/v1";
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
function emptyLedger(p: Paths) { return { schema: LEDGER, target: p.target, entries: {} as ObjectValue, transactions: {} as ObjectValue }; }
function ledger(p: Paths) {
  const current = read(p.ledger);
  if (current.digest === null) return { value: emptyLedger(p), digest: null };
  const value = exact(current.value, ["schema", "target", "entries", "transactions"]);
  if (value.schema !== LEDGER || value.target !== p.target) fail("ledger version or target mismatch");
  const entries = object(value.entries);
  for (const entry of Object.values(entries)) {
    const item = exact(entry, ["consumer", "sources", "consumers", "before", "after", "credential_domain", "transaction", "state"]);
    if (item.state !== "committed" || item.before !== null || !Array.isArray(item.sources)) fail("invalid ownership record");
    for (const consumer of Object.values(object(item.consumers))) exact(consumer, ["sources", "source_digest"]);
  }
  const transactions = object(value.transactions);
  for (const receipt of Object.values(transactions)) exact(receipt, ["consumer", "source_digest", "after"]);
  return { value: { schema: LEDGER, target: p.target, entries, transactions }, digest: current.digest };
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
    source_digest: sha256ProviderDigest({ config: state.config, lock: state.lock }), target_digest: host.digest, ledger_digest: ownership.digest, changes };
  return { plan: { ...payload, plan_digest: sha256ProviderDigest(payload) }, host, ownership, configs };
}
export function planProviderMcp(projectRoot: string, input: Input) { return compute(paths(projectRoot, input)).plan; }

function validatePlan(value: unknown) {
  const plan = exact(value, ["schema", "consumer", "target", "structure", "domains_path", "domains_digest", "source_digest", "target_digest", "ledger_digest", "changes", "plan_digest"]);
  const { plan_digest, ...payload } = plan;
  if (plan.schema !== PLAN || plan.structure !== "mcpServers" || sha256ProviderDigest(payload) !== plan_digest || !Array.isArray(plan.changes)) fail("plan version or digest mismatch");
  // Full nested shape and values are compared against freshly computed requirements before writing.
  return plan;
}
function approved(plan: ObjectValue, approvals: readonly string[]): void {
  for (const change of plan.changes as ObjectValue[]) if (!approvals.includes(String(change.config_digest))) fail("explicit --approve-config digest required for every connection");
}
/** Same target lock across projects; never steal a live or old lock on a timer. */
function locked<T>(p: Paths, run: () => T): T {
  safePath(p.lock);
  let fd: number;
  try { fd = openSync(p.lock, "wx", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("target busy; an orphan lock requires operator PID verification before removal"); throw error; }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); return run(); }
  finally { closeSync(fd); unlinkSync(p.lock); }
}
type Fault = (point: "before-config" | "after-config" | "recovery-before-ledger" | "after-ledger") => void;
/** Recovery never replays config bytes: before => retry fresh; after => finish metadata; other => preserve and conflict. */
function recover(p: Paths, plan: ObjectValue, approvals: readonly string[], fault?: Fault): boolean {
  const pending = read(p.journal);
  if (pending.digest === null) return false;
  const journal = exact(pending.value, ["schema", "plan", "after", "ledger_before", "ledger_after"]);
  if (journal.schema !== JOURNAL || canonicalProviderJson(journal.plan) !== canonicalProviderJson(plan)) fail("pending transaction requires its original plan");
  if (journal.ledger_before !== plan.ledger_digest) fail("transaction ledger baseline mismatch");
  approved(plan, approvals);
  const { state, requirements, diagnostics } = resolveProviderMcpRequirements(p.project);
  if (diagnostics.length || sha256ProviderDigest({ config: state.config, lock: state.lock }) !== plan.source_digest) fail("source changed during pending transaction");
  for (const change of plan.changes as ObjectValue[]) {
    const items = requirements.filter((item) => item.connection.name === change.name);
    if (!items.length || items.some((item) => sha256ProviderDigest(item.connection.config) !== change.config_digest || item.connection.credential_domain !== change.credential_domain)
      || canonicalProviderJson(items.map((item) => item.source)) !== canonicalProviderJson(change.sources)) fail("pending requirements changed");
    items.forEach((item) => safeConfig(item.connection.config));
  }
  const domainDigest = p.domains === null ? null : read(p.domains).digest;
  if (domainDigest !== plan.domains_digest) fail("domains changed during pending transaction");
  const host = read(p.target).digest;
  if (host !== plan.target_digest && host !== journal.after) fail("recovery conflict: host changed; preserve user edits");
  const own = ledger(p);
  const afterDigest = sha256FileDigest(bytes(journal.ledger_after));
  if (own.digest !== journal.ledger_before && own.digest !== afterDigest) fail("recovery conflict: ledger changed");
  if (host === plan.target_digest && own.digest === journal.ledger_before) { unlinkSync(p.journal); return false; }
  if (host !== journal.after) fail("recovery conflict: inconsistent transaction");
  // Reconstruct intended metadata from the approved plan; do not trust journal ownership claims.
  const expected = nextLedger(p, plan, own.digest === afterDigest ? null : own.value, String(journal.after));
  if (expected && canonicalProviderJson(expected) !== canonicalProviderJson(journal.ledger_after)) fail("invalid transaction ledger");
  fault?.("recovery-before-ledger");
  if (read(p.target).digest !== host || ledger(p).digest !== own.digest) fail("recovery conflict: host or ledger changed before metadata publication");
  if (own.digest !== afterDigest) atomic(p.ledger, journal.ledger_after);
  fault?.("after-ledger");
  unlinkSync(p.journal);
  return true;
}
function nextLedger(p: Paths, plan: ObjectValue, previous: ReturnType<typeof emptyLedger> | null, after: string) {
  if (!previous) return null;
  const next = structuredClone(previous);
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
export function applyProviderMcp(projectRoot: string, input: Input & { plan: unknown; approvedConfigs: readonly string[] }, fault?: Fault) {
  const p = paths(projectRoot, input);
  const plan = validatePlan(input.plan);
  if (plan.target !== p.target || plan.domains_path !== p.domains || plan.consumer !== sha256ProviderDigest({ project: p.project })) fail("plan project or explicit target mismatch");
  approved(plan, input.approvedConfigs);
  return locked(p, () => {
    if (recover(p, plan, input.approvedConfigs, fault)) return { status: "recovered", target: p.target };
    const current = compute(p);
    const receipt = current.ownership.value.transactions[String(plan.plan_digest)];
    if (receipt) {
      const value = object(receipt);
      if (value.consumer === plan.consumer && value.source_digest === current.plan.source_digest && value.after === current.host.digest && current.plan.domains_digest === plan.domains_digest) return { status: "unchanged", target: p.target };
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
    const nextOwnership = nextLedger(p, plan, current.ownership.value, after)!;
    atomic(p.journal, { schema: JOURNAL, plan, after, ledger_before: current.ownership.digest, ledger_after: nextOwnership });
    fault?.("before-config");
    // Check once more immediately before replacement for non-cooperating host edits.
    if (read(p.target).digest !== plan.target_digest) fail("host changed before publication");
    const source = resolveProviderMcpRequirements(p.project).state;
    if (sha256ProviderDigest({ config: source.config, lock: source.lock }) !== plan.source_digest) fail("source changed before publication");
    if (adding) atomic(p.target, next);
    fault?.("after-config");
    if (read(p.target).digest !== after || ledger(p).digest !== current.ownership.digest) fail("host or ledger changed after publication; recovery required");
    atomic(p.ledger, nextOwnership);
    fault?.("after-ledger");
    unlinkSync(p.journal);
    return { status: "applied", target: p.target };
  });
}
