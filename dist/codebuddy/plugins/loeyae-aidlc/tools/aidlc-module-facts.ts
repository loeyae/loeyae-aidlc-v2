/** Bounded, offline module facts. Nothing in a build file is ever executed. */
import { lstatSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { sha256ProviderDigest } from "./aidlc-project-provider.js";
import { createHash } from "node:crypto";
import type { Sha256Digest } from "./aidlc-provider-types.js";

export const MODULE_FACTS_PATH = ".aidlc/module-facts.json";
function fail(message: string): never { throw new Error(`MODULE_FACTS_INVALID: ${message}`); }
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as Record<string, any>;
}
function fields(value: Record<string, any>, names: string[]): void {
  if (Object.keys(value).some(key => !names.includes(key))) fail("unknown field");
}
function portable(path: unknown, dot = false): string {
  if (dot && path === ".") return ".";
  if (typeof path !== "string" || !path || path.length > 512 || path.split("/").some(p => !p || p === "." || p === "..") || /[\\:\u0000-\u001f]/.test(path)) fail("unsafe relative path");
  return path;
}
function read(project: string, path: string): Buffer | undefined {
  let cursor = resolve(project);
  if (lstatSync(cursor).isSymbolicLink()) fail("symlink project");
  for (const part of portable(path).split("/")) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) fail("symlink source");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  const stat = lstatSync(cursor);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) fail("source is not a bounded regular file");
  return readFileSync(cursor);
}
const hash = (bytes: Buffer): Sha256Digest => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const exactVersion = (value: unknown): value is string => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
function compatibleDeclaration(declared: unknown, version: string): boolean | undefined {
  if (exactVersion(declared)) return declared === version;
  const range = typeof declared === "string" ? /^([~^])(\d+)\.(\d+)\.(\d+)$/.exec(declared) : null;
  if (!range || !/^\d+\.\d+\.\d+$/.test(version)) return undefined;
  const lower = range.slice(2).map(Number), current = version.split(".").map(Number);
  const upper = range[1] === "~" ? [lower[0], lower[1] + 1, 0] : lower[0] > 0 ? [lower[0] + 1, 0, 0] : lower[1] > 0 ? [0, lower[1] + 1, 0] : [0, 0, lower[2] + 1];
  const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return compare(current, lower) >= 0 && compare(current, upper) < 0;
}
export interface DependencyFact {
  dependency: string;
  status: "known" | "unknown" | "conflict";
  version?: string;
  sources: { path: string; digest: Sha256Digest; declared: string | null; kind: string }[];
}
export interface ModuleFacts {
  module_id: string;
  root: string | null;
  sources: { path: string; digest: Sha256Digest | null }[];
  dependencies: DependencyFact[];
  facts_digest: Sha256Digest;
}

/** Roots are explicit approved module identities; never inferred from names/platform. */
export function readModuleFacts(project: string, moduleId: string | undefined): ModuleFacts {
  const registryBytes = read(project, MODULE_FACTS_PATH);
  const sources: ModuleFacts["sources"] = [{ path: MODULE_FACTS_PATH, digest: registryBytes ? hash(registryBytes) : null }];
  let module: Record<string, any> | undefined;
  if (registryBytes) {
    const registry = object(JSON.parse(registryBytes.toString("utf8")));
    fields(registry, ["schema", "modules"]);
    if (registry.schema !== "aidlc.module-facts/v1" || !Array.isArray(registry.modules) || registry.modules.length > 128) fail("invalid registry");
    const ids = new Set<string>();
    for (const entry of registry.modules) {
      const item = object(entry); fields(item, ["id", "root", "declarations"]);
      if (typeof item.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item.id) || ids.has(item.id)) fail("invalid/duplicate module id");
      ids.add(item.id); portable(item.root, true);
      if (item.id === moduleId) module = item;
    }
  }
  const dependencies = new Map<string, DependencyFact>();
  function add(dependency: string, declared: unknown, path: string, digest: Sha256Digest, kind: string, resolved?: unknown): void {
    if (!/^(?:npm:[@a-zA-Z0-9_.\/-]+|maven:[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+|(?:runtime|convention):[a-z][a-z0-9-]*)$/.test(dependency)) fail("invalid dependency coordinate");
    // Resolve only the small, auditable npm ^/~ language. Variables, tags,
    // workspace/git specs and arbitrary expressions deliberately remain unknown.
    const compatibility = exactVersion(resolved) ? compatibleDeclaration(declared, resolved) : undefined;
    const lockedVersion = compatibility === true ? resolved as string : undefined;
    const rangeConflict = compatibility === false;
    const version = exactVersion(declared) ? declared : lockedVersion;
    const previous = dependencies.get(dependency);
    const fact: DependencyFact = previous ?? { dependency, status: version ? "known" : "unknown", ...(version ? { version } : {}), sources: [] };
    if (rangeConflict || (previous && (previous.status === "conflict" || (version && previous.version && version !== previous.version)))) { fact.status = "conflict"; delete fact.version; }
    else if (previous && !version) { fact.status = "unknown"; delete fact.version; }
    else if (previous && version && kind === "explicit-declaration") {
      // A reviewed, explicit effective version may resolve missing/inherited facts,
      // but can never override a contrary literal/range or a lock conflict.
      if (previous.sources.some(source => compatibleDeclaration(source.declared, version) === false)) { fact.status = "conflict"; delete fact.version; }
      else { fact.status = "known"; fact.version = version; }
    }
    fact.sources.push({ path, digest, declared: typeof declared === "string" ? declared : null, kind });
    dependencies.set(dependency, fact);
  }
  if (module) {
    const prefix = module.root === "." ? "" : `${module.root}/`;
    const files = new Map<string, Buffer>();
    for (const name of ["package.json", "package-lock.json", "pom.xml"]) {
      const path = `${prefix}${name}`; const bytes = read(project, path);
      sources.push({ path, digest: bytes ? hash(bytes) : null });
      if (bytes) files.set(name, bytes);
    }
    const pkgBytes = files.get("package.json");
    if (pkgBytes) {
      const pkg = object(JSON.parse(pkgBytes.toString("utf8")));
      const manager = typeof pkg.packageManager === "string" ? /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager) : null;
      if (manager) add(`runtime:${manager[1]}`, manager[2], `${prefix}package.json`, hash(pkgBytes), "package-manager");
      const lockBytes = files.get("package-lock.json");
      const lock = lockBytes ? object(JSON.parse(lockBytes.toString("utf8"))) : undefined;
      if (lock && ![2, 3].includes(lock.lockfileVersion)) fail("only npm lock v2/v3 supported; use explicit declarations for other managers");
      for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
        if (!pkg[group]) continue;
        for (const [name, declared] of Object.entries(object(pkg[group]))) {
          const locked = lock?.packages?.[`node_modules/${name}`]?.version;
          const lockDeclared = lock?.packages?.[""]?.[group]?.[name];
          add(`npm:${name}`, declared, `${prefix}package.json`, hash(pkgBytes), group, locked);
          if (lockBytes && locked) {
            add(`npm:${name}`, locked, `${prefix}package-lock.json`, hash(lockBytes), "resolved");
          }
          if (lock && (!locked || lockDeclared !== declared)) {
            const fact = dependencies.get(`npm:${name}`)!; fact.status = "conflict"; delete fact.version;
            if (!locked) fact.sources.push({ path: `${prefix}package-lock.json`, digest: hash(lockBytes!), declared: null, kind: "missing-lock-entry" });
          }
        }
      }
    }
    const pom = files.get("pom.xml");
    if (pom) {
      const xml = pom.toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XML declarations/entities prohibited");
      const doc = new DOMParser({ onError: () => fail("malformed pom.xml") }).parseFromString(xml, "application/xml");
      function children(element: Element, tag: string): Element[] { return Array.from(element.childNodes).filter((n: any) => n.nodeType === 1 && n.localName === tag) as unknown as Element[]; }
      const projectNode = doc.documentElement as unknown as Element;
      const childText = (el: Element, name: string) => children(el, name)[0]?.textContent?.trim();
      // Direct dependencies only. Inherited, property and BOM versions remain unknown.
      for (const block of children(projectNode, "dependencies")) for (const dep of children(block, "dependency")) {
        const group = childText(dep, "groupId"), artifact = childText(dep, "artifactId");
        if (group && artifact && !/[${}]/.test(group + artifact)) add(`maven:${group}:${artifact}`, childText(dep, "version"), `${prefix}pom.xml`, hash(pom), "direct-dependency");
      }
    }
    if (module.declarations !== undefined) {
      if (!Array.isArray(module.declarations) || module.declarations.length > 128) fail("invalid declarations");
      for (const declaration of module.declarations) {
        const item = object(declaration); fields(item, ["dependency", "version", "decision"]);
        if (!exactVersion(item.version)) fail("explicit version must be an exact reviewed version");
        portable(item.decision);
        if (!/^\.aidlc\/decisions\/[a-zA-Z0-9._-]+\.json$/.test(item.decision)) fail("decision must be a bounded .aidlc/decisions JSON file");
        const decision = read(project, item.decision);
        if (!decision) fail("explicit declaration requires an existing local approved decision source");
        const approval = object(JSON.parse(decision.toString("utf8")));
        fields(approval, ["schema", "module_id", "approved", "dependencies"]);
        if (approval.schema !== "aidlc.module-decision/v1" || approval.module_id !== moduleId || approval.approved !== true || !Array.isArray(approval.dependencies) || approval.dependencies.length > 128) fail("invalid/unapproved module decision");
        for (const entry of approval.dependencies) fields(object(entry), ["dependency", "version"]);
        if (!approval.dependencies.some((entry: any) => entry.dependency === item.dependency && entry.version === item.version)) fail("declaration differs from approved decision");
        sources.push({ path: item.decision, digest: hash(decision) });
        add(item.dependency, item.version, item.decision, hash(decision), "explicit-declaration");
      }
    }
  }
  const body = { module_id: moduleId ?? "", root: module?.root ?? null, sources, dependencies: [...dependencies.values()].sort((a, b) => a.dependency.localeCompare(b.dependency)) };
  return { ...body, facts_digest: sha256ProviderDigest(body) };
}

/** Deliberately small version language: exact or numeric [minimum, maximum). */
export function matchKnowledgeRequirements(facts: ModuleFacts, value: unknown): "match" | "unknown" | "conflict" | "mismatch" {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const alternatives = object(value); fields(alternatives, ["any_of"]);
    if (!Array.isArray(alternatives.any_of) || !alternatives.any_of.length || alternatives.any_of.length > 16 || alternatives.any_of.some((item: unknown) => !Array.isArray(item))) fail("invalid requirement alternatives");
    const results = alternatives.any_of.map((item: unknown) => matchKnowledgeRequirements(facts, item));
    return results.includes("match") ? "match" : results.includes("conflict") ? "conflict" : results.includes("unknown") ? "unknown" : "mismatch";
  }
  if (!Array.isArray(value) || !value.length || value.length > 64) fail("expected 1..64 section requirements");
  const results = value.map(entry => {
    const requirement = object(entry); fields(requirement, ["dependency", "exact", "minimum", "maximum_exclusive"]);
    if (typeof requirement.dependency !== "string") fail("missing dependency");
    const pinned = requirement.exact !== undefined;
    if (pinned ? !exactVersion(requirement.exact) || requirement.minimum !== undefined || requirement.maximum_exclusive !== undefined : !/^\d+\.\d+\.\d+$/.test(requirement.minimum) || !/^\d+\.\d+\.\d+$/.test(requirement.maximum_exclusive)) fail("invalid compatibility version");
    const fact = facts.dependencies.find(dep => dep.dependency === requirement.dependency);
    if (!fact) return "mismatch";
    if (fact.status !== "known") return fact.status;
    if (pinned) return fact.version === requirement.exact ? "match" : "mismatch";
    if (!/^\d+\.\d+\.\d+$/.test(fact.version!)) return "unknown";
    const compare = (a: string, b: string) => { const aa = a.split(".").map(Number), bb = b.split(".").map(Number); return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2]; };
    return compare(fact.version!, requirement.minimum) >= 0 && compare(fact.version!, requirement.maximum_exclusive) < 0 ? "match" : "mismatch";
  });
  return results.includes("conflict") ? "conflict" : results.includes("mismatch") ? "mismatch" : results.includes("unknown") ? "unknown" : "match";
}
