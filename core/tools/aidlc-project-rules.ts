/** Read-only project rule selection. No state, approval, completion or source writes. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument, stringify } from "yaml";

type Repository = { root: string; remote?: string };
type Rule = { id: string; source: string; description: string; always: boolean; include: string[]; exclude: string[]; tasks: string[]; requires: string[] };
export type RuleScope = Record<string, string[]>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const inside = (root: string, file: string) => { const rel = path.relative(root, file); return !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`); };
const slash = (value: string) => value.replaceAll("\\", "/");
function keys(value: unknown, allowed: string[], context: string): asserts value is Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error(`${context}: unknown fields or invalid object`);
}
function strings(value: unknown, context: string): string[] {
  if (value === undefined) return [];
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || list.some(item => typeof item !== "string" || !item.trim())) throw Error(`${context}: expected nonempty strings`);
  return [...new Set(list)];
}
function yaml(text: string, source: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw Error(`${source}: invalid YAML`);
  return doc.toJS({ maxAliasCount: 0 });
}
function relative(value: string): string {
  const normalized = slash(value);
  if (!normalized || /[:\x00-\x1f]/.test(normalized) || normalized.split("/").some(part => !part || part === "." || part === "..")) throw Error(`Expected repository-relative path: ${value}`);
  return normalized;
}
// Portable, deliberately small glob vocabulary; unsupported syntax is never silently ignored.
export function rulePattern(pattern: string): RegExp {
  const normalized = relative(pattern);
  if (/[\[\]{}()!]/.test(normalized)) throw Error(`Unsupported glob: ${pattern}; use an include array, *, ** or ?`);
  const parts = normalized.split("/");
  const expression = parts.map((part, index) => {
    if (part === "**") return index === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
    if (part.includes("**")) throw Error(`** must occupy a whole path segment: ${pattern}`);
    return [...part].map(char => char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("") + (index < parts.length - 1 ? "/" : "");
  }).join("");
  return new RegExp(`^${expression}$`);
}
function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw Error(`${root}: cannot verify Git identity (${args[0]})`);
  return result.stdout.trim();
}
function identity(remote: string): string {
  const url = /^[^/:]+@[^:]+:/.test(remote) ? `ssh://${remote.replace(":", "/")}` : remote;
  try { const parsed = new URL(url); return `${parsed.hostname.toLowerCase()}/${parsed.pathname.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/$/, "")}`; }
  catch { throw Error("Use an SSH or HTTPS repository remote, not a machine-specific directory"); }
}
function confined(root: string, file: string): string {
  if (!inside(root, file)) throw Error(`Path outside rule source: ${file}`);
  const actual = fs.realpathSync(file);
  if (!inside(root, actual)) throw Error(`Symlink outside rule source: ${file}`);
  return actual;
}
// Read only a bounded header. A catalogue never reads/prints whole rule bodies.
function header(file: string): unknown {
  const fd = fs.openSync(file, "r"), chunks: Buffer[] = [];
  try {
    for (let size = 0; size < 64 * 1024; size += 1024) {
      const buffer = Buffer.alloc(1024), count = fs.readSync(fd, buffer, 0, buffer.length, null);
      chunks.push(buffer.subarray(0, count));
      const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      if (match) return yaml(match[1], file);
      if (!count) break;
    }
    throw Error(`${file}: missing/oversized YAML front matter; do not assume always or inapplicable`);
  } finally { fs.closeSync(fd); }
}

export class ProjectRules {
  readonly project: string;
  readonly repositories: Record<string, Repository>;
  readonly shared: string[];
  private guideText: string;
  private roots = new Map<string, string>();
  private cache = new Map<string, Rule>();

  constructor(project: string) {
    this.project = fs.realpathSync(project);
    const guide = path.join(this.project, "AGENTS.md");
    const text = fs.existsSync(guide) ? fs.readFileSync(confined(this.project, guide), "utf8") : "";
    this.guideText = text;
    const blocks = [...text.matchAll(/^```aidlc-rules\s*\r?\n([\s\S]*?)^```\s*$/gm)];
    if ([...text.matchAll(/^```aidlc-rules\b/gm)].length !== blocks.length) throw Error("Malformed aidlc-rules mapping; do not silently fall back to self");
    if (blocks.length > 1) throw Error("Keep one aidlc-rules mapping in the existing AGENTS.md");
    const config = blocks.length ? yaml(blocks[0][1], guide) : { repositories: { self: { root: "." } } };
    keys(config, ["repositories", "shared"], guide);
    if (!object(config.repositories) || !Object.keys(config.repositories).length) throw Error("Declare repositories in AGENTS.md");
    this.repositories = Object.create(null);
    for (const [id, repo] of Object.entries(config.repositories)) {
      if (!/^[a-z][a-z0-9-]*$/.test(id)) throw Error(`Invalid repository id: ${id}`);
      keys(repo, ["root", "remote"], id);
      if (typeof repo.root !== "string" || !repo.root || path.isAbsolute(repo.root) || /^[A-Za-z]:|^\\/.test(repo.root)) throw Error(`${id}: root must be relative to AGENTS.md`);
      if (repo.remote !== undefined && (typeof repo.remote !== "string" || !repo.remote)) throw Error(`${id}: invalid remote`);
      if (blocks.length && !repo.remote) throw Error(`${id}: explicit repository mappings require the expected origin remote`);
      this.repositories[id] = repo as Repository;
    }
    this.shared = strings(config.shared, "shared");
    for (const id of this.shared) if (!Object.hasOwn(this.repositories, id)) throw Error(`Unknown shared repository: ${id}`);
  }

  private begin() {
    const guide = path.join(this.project, "AGENTS.md");
    const current = fs.existsSync(guide) ? fs.readFileSync(confined(this.project, guide), "utf8") : "";
    if (current !== this.guideText) throw Error("Project instructions changed; reopen the mapping before selecting rules");
    this.roots.clear(); this.cache.clear(); // Reuse only within a query, never across changed inputs.
  }

  root(id: string): string {
    if (this.roots.has(id)) return this.roots.get(id)!;
    if (!Object.hasOwn(this.repositories, id)) throw Error(`Unknown repository: ${id}`);
    const repo = this.repositories[id], root = fs.realpathSync(path.resolve(this.project, slash(repo.root)));
    if (fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"])) !== root) throw Error(`${id}: mapped directory is not its Git root`);
    if (repo.remote && identity(git(root, ["remote", "get-url", "origin"])) !== identity(repo.remote)) throw Error(`${id}: origin does not match the declared repository; verify the actual checkout`);
    for (const [other, known] of this.roots) if (known === root && other !== id) throw Error(`Duplicate repository mapping: ${other}, ${id}`);
    this.roots.set(id, root);
    return root;
  }

  private rule(id: string): Rule {
    if (typeof id !== "string") throw Error("Expected repository:rule.md");
    const split = id.indexOf(":"), repo = id.slice(0, split), name = relative(id.slice(split + 1));
    if (split < 1 || !name.endsWith(".md")) throw Error(`Expected repository:rule.md: ${id}`);
    id = `${repo}:${name}`;
    if (this.cache.has(id)) return this.cache.get(id)!;
    const root = this.root(repo), base = confined(root, path.join(root, ".agents/rules"));
    const file = confined(base, path.join(base, name)), meta = header(file);
    if (file !== path.resolve(base, name)) throw Error(`${id}: reference the canonical rule path, not a symlink/alias`);
    keys(meta, ["description", "always", "include", "exclude", "tasks", "requires"], id);
    if (typeof meta.description !== "string" || !meta.description.trim()) throw Error(`${id}: description is required`);
    if (meta.always !== undefined && typeof meta.always !== "boolean") throw Error(`${id}: always must be boolean`);
    const rule: Rule = { id, source: file, description: meta.description, always: meta.always === true,
      include: strings(meta.include, id), exclude: strings(meta.exclude, id), tasks: strings(meta.tasks, id), requires: strings(meta.requires, id) };
    if (rule.always ? ["include", "exclude", "tasks"].some(key => Object.hasOwn(meta, key)) : !rule.include.length && !rule.tasks.length) throw Error(`${id}: use always alone, or explicit include/tasks; never mix always with filters`);
    if (rule.exclude.length && !rule.include.length) throw Error(`${id}: exclude requires include`);
    for (const pattern of [...rule.include, ...rule.exclude]) rulePattern(pattern);
    this.cache.set(id, rule);
    return rule;
  }

  catalog(repositories: string[]): Rule[] {
    this.begin();
    const result: Rule[] = [];
    for (const id of [...new Set([...this.shared, ...repositories])]) {
      const root = this.root(id), base = confined(root, path.join(root, ".agents/rules"));
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const file = path.join(dir, entry.name);
          if (entry.isSymbolicLink()) throw Error(`Rule directories must not contain symlinks: ${file}`);
          if (entry.isDirectory()) walk(file);
          else if (entry.name.endsWith(".md")) result.push(this.rule(`${id}:${slash(path.relative(base, file))}`));
        }
      };
      walk(base);
      if (!result.some(rule => rule.id.startsWith(`${id}:`))) throw Error(`${id}: no rules; resolve the source instead of treating an empty selection as coverage`);
    }
    return result;
  }

  select(scope: RuleScope, tasks: string[] = []) {
    if (!object(scope) || !Object.keys(scope).length) throw Error("Supply the actual affected repositories; an empty scope is not coverage");
    const candidates = this.catalog(Object.keys(scope));
    for (const [id, files] of Object.entries(scope)) {
      const root = this.root(id);
      if (!Array.isArray(files) || files.some(file => typeof file !== "string")) throw Error(`${id}: scope must be an array of planned/affected paths`);
      for (const file of files) {
        let candidate = path.join(root, relative(file));
        while (!fs.existsSync(candidate)) candidate = path.dirname(candidate);
        confined(root, candidate); // Includes new files under an existing symlink/junction.
        const directory = fs.statSync(candidate).isDirectory() ? candidate : path.dirname(candidate);
        if (fs.realpathSync(git(directory, ["rev-parse", "--show-toplevel"])) !== root) throw Error(`${id}: target belongs to a different Git repository: ${file}`);
      }
    }
    const selected = new Map<string, Rule & { reasons: string[] }>(), visiting = new Set<string>();
    const add = (rule: Rule, reason: string) => {
      if (visiting.has(rule.id)) throw Error(`Cyclic rule dependency: ${rule.id}`);
      if (selected.has(rule.id)) { selected.get(rule.id)!.reasons.push(reason); return; }
      visiting.add(rule.id);
      for (const dep of rule.requires) add(this.rule(dep.includes(":") ? dep : `${rule.id.split(":")[0]}:${dep}`), `required by ${rule.id}`);
      visiting.delete(rule.id);
      selected.set(rule.id, { ...rule, reasons: [reason] });
    };
    for (const rule of candidates) {
      const repo = rule.id.split(":")[0], files = Object.hasOwn(scope, repo) ? scope[repo] : [];
      const matches = files.filter(file => rule.include.some(glob => rulePattern(glob).test(slash(file))) && !rule.exclude.some(glob => rulePattern(glob).test(slash(file))));
      if (rule.always) add(rule, "required repository/shared baseline");
      else if (matches.length) add(rule, `path (${matches.length}): ${matches[0]}`);
      else if (rule.tasks.some(task => tasks.includes(task))) add(rule, "explicit task kind");
    }
    return { scope, selected: [...selected.values()], coverage: "not_evaluated", permissions_granted: false };
  }

  load(scope: RuleScope, tasks: string[], id: string) {
    const rule = this.select(scope, tasks).selected.find(item => item.id === id);
    if (!rule) throw Error(`Rule is not selected: ${id}`);
    return { id, source: rule.source, content: fs.readFileSync(rule.source, "utf8").replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") };
  }

  adapter(repository: string, host: string) {
    if (!["codex", "kiro", "skill"].includes(host)) throw Error("adapter --host codex|kiro|skill");
    this.begin();
    const root = this.root(repository), guide = slash(path.relative(root, path.join(this.project, "AGENTS.md")));
    const entry = `AIDLC 项目规范入口：先读取 ${JSON.stringify(guide)} 中的 aidlc-rules 映射。\n以该文件所在目录为 --project，使用 rules select/load（或等价原生读取）按实际仓库、拟改/受影响路径和任务类型加载 .agents/rules/ 正文与 requires；已加载且未变的来源复用。\n必须保留 shared/always 约束，沿原目标、STORY/AC 和消费者关系补齐跨端范围；选择结果不证明目标完整或授予权限。\n宿主命中提示只定位候选，不复制规范正文；排除条件和依赖由统一选择器处理。\n`;
    if (host !== "kiro") return { host, repository, fragments: [{ destination: host === "codex" ? "AGENTS.md" : "host skill/project instructions", content: entry }], writes: false };
    const fragment = (destination: string, meta: object, content: string) => ({ destination, content: `---\n${stringify(meta)}---\n${content}` });
    const fragments = [fragment(".kiro/steering/aidlc-project-rules.md", { inclusion: "always" }, entry)];
    for (const rule of this.catalog([repository]).filter(rule => rule.id.startsWith(`${repository}:`) && !rule.always)) {
      // Kiro cannot express subtraction/task predicates exactly. Never broaden them to always.
      const conditional = rule.include.length && !rule.exclude.length && !rule.tasks.length;
      const meta = conditional ? { inclusion: "fileMatch", fileMatchPattern: rule.include } : { inclusion: "manual" };
      fragments.push(fragment(`.kiro/steering/aidlc-${encodeURIComponent(rule.id)}.md`, meta, `${rule.description}\n候选 ${rule.id}；来源 ${JSON.stringify(slash(path.relative(root, rule.source)))}。按 AIDLC 入口选择后读取，已加载来源不重读。\n`));
    }
    return { host, repository, fragments, writes: false };
  }
}

export function runProjectRulesCli(args: string[]) {
  const usage = 'rules catalog|select|load --project <mapping-root> --scope <JSON repository-to-paths> [--tasks <JSON array>] [--rule <repository:rule.md>] | rules adapter --project <root> --repository <id> --host codex|kiro|skill';
  if (!args.length || args[0] === "--help") { console.log(usage); return; }
  const [mode, ...rest] = args, options: Record<string, string> = Object.create(null);
  if (!["catalog", "select", "load", "adapter"].includes(mode)) throw Error(usage);
  const allowed = mode === "adapter" ? ["project", "repository", "host"] : ["project", "scope", ...(mode === "catalog" ? [] : ["tasks"]), ...(mode === "load" ? ["rule"] : [])];
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].slice(2), value = rest[i + 1];
    if (!rest[i].startsWith("--") || !allowed.includes(name) || value === undefined || Object.hasOwn(options, name)) throw Error(usage);
    options[name] = value;
  }
  const rules = new ProjectRules(options.project || process.cwd());
  if (mode === "adapter") { console.log(JSON.stringify(rules.adapter(options.repository, options.host))); return; }
  const scope = options.scope ? JSON.parse(options.scope) : { self: [] };
  if (!object(scope) || !Object.keys(scope).length) throw Error("Nonempty scope required");
  const tasks = options.tasks ? strings(JSON.parse(options.tasks), "tasks") : [];
  const result = mode === "catalog" ? { rules: rules.catalog(Object.keys(scope)), coverage: "not_evaluated", permissions_granted: false }
    : mode === "load" ? rules.load(scope as RuleScope, tasks, options.rule) : rules.select(scope as RuleScope, tasks);
  console.log(JSON.stringify(result));
}
