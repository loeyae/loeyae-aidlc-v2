import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stringify } from "yaml";
import { ProjectRules, rulePattern } from "../core/tools/aidlc-project-rules.js";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aidlc rules 中文 "));
const project = path.join(temporary, "docs"), repository = process.cwd();
const roots = Object.fromEntries(["docs", "operation", "mini", "web", "app", "backend"].map(id => [id, path.join(temporary, id)]));
function git(root: string, args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.trim();
}
function write(file: string, text: string) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function rule(repo: string, file: string, meta: object, body: string) {
  write(path.join(roots[repo], ".agents/rules", file), `---\n${stringify(meta)}---\n${body}\n`);
}
const ids = (result: ReturnType<ProjectRules["select"]>) => result.selected.map(rule => rule.id).sort();
const only = (result: ReturnType<ProjectRules["select"]>, expected: string[]) => assert.deepEqual(ids(result), expected.sort());
const config = { repositories: Object.fromEntries(Object.entries(roots).map(([id, root]) => [id, { root: path.relative(project, root) || ".", remote: `https://example.org/dfi/${id}.git` }])), shared: ["docs"] };
const saveConfig = () => write(path.join(project, "AGENTS.md"), `# Existing project instructions\nPreserve quality, permissions and product goals.\n\n\`\`\`aidlc-rules\n${stringify(config)}\`\`\`\n`);
// Explicit real-project mode reuses the same selector and temporary repositories.
// It projects existing source sections without modifying or claiming migration of the real project.
function verifyDfi(dfi: string) {
  assert(dfi, "--dfi-mall requires the actual project path");
  const names: Record<string, string> = { docs: ".", backend: "dfi-mall-microservice", operation: "dfi-mall-operation-fe", mini: "dfi-mall-miniprogram-fe", web: "dfi-mall-operation-web", app: "dfi-mall-app-shell" };
  const originals = new Map<string, Buffer>();
  const read = (file: string) => { const full = path.join(dfi, file), bytes = fs.readFileSync(full); originals.set(full, bytes); return bytes.toString("utf8"); };
  const guide = read("AGENTS.md"), coding = read(".kiro/steering/coding-standards.md");
  const section = (text: string, title: string) => {
    const lines = text.split(/\r?\n/), start = lines.findIndex(line => line === title);
    assert(start >= 0, `Missing real source section: ${title}`);
    const depth = title.match(/^#+/)![0].length;
    let end = start + 1;
    while (end < lines.length && !(new RegExp(`^#{1,${depth}} `)).test(lines[end])) end++;
    return lines.slice(start, end).join("\n").trim();
  };
  for (const [id, name] of Object.entries(names)) {
    const actual = path.resolve(dfi, name);
    assert.equal(fs.realpathSync(git(actual, ["rev-parse", "--show-toplevel"])), fs.realpathSync(actual));
    const remote = git(actual, ["remote", "get-url", "origin"]);
    config.repositories[id].remote = remote;
    git(roots[id], ["remote", "set-url", "origin", remote]);
  }
  saveConfig();
  const common = [section(guide, "## 二、仓库结构（多仓库共存，目录归属敏感）"), section(guide, "## 四、实施铁律（避免弯路与返工）"), section(guide, "## 五、交付与完成口径")].join("\n\n");
  rule("docs", "base.md", { description: "Existing dfi-mall ownership, quality and completion requirements", always: true }, common);
  rule("docs", "typescript.md", { description: "Existing shared TypeScript conventions", tasks: ["typescript"] }, section(coding, "### 通用"));
  rule("docs", "contract.md", { description: "Existing API consumer acceptance", tasks: ["api-change"] }, read(".kiro/steering/api-change-e2e.md"));
  const bodies: Record<string, string> = { backend: section(coding, "## 后端规范（Java）"), operation: section(coding, "### 运营后台（dfi-mall-operation-fe）"), mini: section(coding, "### 小程序（dfi-mall-miniprogram-fe）") };
  for (const id of ["backend", "operation", "mini", "web", "app"]) {
    const row = guide.split(/\r?\n/).find(line => line.startsWith(`| \`${names[id]}\``));
    assert(row, `Missing real repository declaration: ${id}`);
    rule(id, "base.md", { description: `Existing ${names[id]} baseline`, always: true }, row!);
    const body = bodies[id] || (id === "app" ? read(".kiro/steering/wellcome-app-scope.md") : row!);
    rule(id, "coding.md", { description: `Existing ${names[id]} guidance`, include: id === "backend" ? ["**/*.java"] : id === "app" ? ["lib/**"] : ["src/**"], requires: ["docs:base.md", ...(["operation", "mini", "web"].includes(id) ? ["docs:typescript.md"] : [])] }, body);
  }
  rule("backend", "contract.md", { description: "API change consumers", include: ["**/ProductType*.java"], requires: ["docs:contract.md"] }, "沿既有接口消费者和 STORY/AC 核对受影响端，不以当前 Java 文件范围认定产品目标完整。");
  const targets: Record<string, string[]> = {};
  for (const [id, patterns] of Object.entries({ backend: ["vibe-product-center/*ProductTypeChangeGuard.java"], operation: ["src/api/product/*.ts"], mini: ["src/pages/**/*.tsx"], web: ["src/**/*.tsx"], app: ["lib/*.dart"] })) {
    const files = git(path.join(dfi, names[id]), ["ls-files", "--", ...patterns]).split("\n").filter(Boolean);
    assert(files.length, `No actual target for ${id}; narrow the scenario using current project facts`);
    assert(fs.existsSync(path.join(dfi, names[id], files[0])));
    targets[id] = [files[0]];
  }
  const rules = new ProjectRules(project), rows: object[] = [];
  for (const id of Object.keys(targets)) {
    const scope = { [id]: targets[id] }, result = rules.select(scope);
    assert(result.selected.some(item => item.id === `${id}:coding.md`));
    assert(result.selected.every(item => item.id.startsWith("docs:") || item.id.startsWith(`${id}:`)), `${id}: unrelated endpoint loaded`);
    const contents = result.selected.map(item => rules.load(scope, [], item.id).content);
    assert(contents.some(content => content.trim() === common), "Do not weaken existing quality/ownership/completion instructions");
    if (bodies[id]) assert(contents.some(content => content.trim() === bodies[id]));
    rows.push({ endpoint: names[id], actual_target: targets[id][0], selected: result.selected.length, body_bytes: contents.reduce((n, body) => n + Buffer.byteLength(body), 0) });
  }
  const scope = { backend: targets.backend, operation: targets.operation, mini: targets.mini };
  const result = rules.select(scope);
  for (const id of Object.keys(scope)) assert(result.selected.some(item => item.id === `${id}:coding.md`));
  assert.equal(result.selected.filter(item => item.id === "docs:base.md").length, 1);
  assert.equal(result.selected.filter(item => item.id === "docs:typescript.md").length, 1);
  assert(result.selected.some(item => item.id === "docs:contract.md"));
  assert.equal(result.coverage, "not_evaluated"); assert.equal(result.permissions_granted, false);
  const mock = read(".kiro/steering/ui-mock-design-spec.md");
  write(path.join(roots.docs, ".agents/rules/old-mock.md"), mock);
  assert.throws(() => new ProjectRules(project).select({ operation: targets.operation }), /unknown fields/);
  fs.unlinkSync(path.join(roots.docs, ".agents/rules/old-mock.md"));
  for (const host of ["codex", "kiro", "skill"]) assert.equal(rules.adapter("operation", host).writes, false);
  for (const [file, before] of originals) assert.deepEqual(fs.readFileSync(file), before, `Real source changed: ${file}`);
  console.log(JSON.stringify({ mode: "dfi-mall bounded source projection", endpoints: rows, cross_endpoint_rules: result.selected.length, original_files_unchanged: originals.size, real_project_migrated: false, native_session_executed: false, limitation: "Web/Flutter only exercise existing declared guidance; this does not establish complete endpoint standards or product acceptance." }));
}
try {
  for (const [id, root] of Object.entries(roots)) {
    fs.mkdirSync(root, { recursive: true }); git(root, ["init", "--quiet"]);
    git(root, ["remote", "add", "origin", `git@example.org:dfi/${id}.git`]);
    rule(id, "base.md", { description: `${id} baseline`, always: true }, `${id} required baseline`);
  }
  saveConfig();
  if (process.argv[2] === "--dfi-mall") verifyDfi(process.argv[3]);
  else {
  rule("docs", "contract.md", { description: "shared API contract", tasks: ["api-change"] }, "Preserve consumers and all original acceptance criteria.");
  rule("docs", "mock.md", { description: "HTML mock only", tasks: ["ui-mock"] }, "MOCK_ONLY");
  rule("operation", "forms.md", { description: "Ant Design forms", include: ["src/pages/**/*.tsx", "src/components/**"], exclude: ["src/components/generated/**"], requires: ["docs:base.md"] }, "ANTD_FORM_BODY");
  rule("operation", "api.md", { description: "operation API consumer", include: ["src/api/**"], requires: ["docs:contract.md"] }, "OPERATION_API");
  rule("mini", "pages.md", { description: "Taro/NutUI", include: ["src/pages/**"], requires: ["docs:base.md"] }, "TARO_BODY");
  rule("web", "pages.md", { description: "Vite SSR", include: ["src/pages/**"] }, "SSR_BODY");
  rule("app", "pages.md", { description: "Flutter", include: ["lib/**"] }, "FLUTTER_BODY");
  rule("backend", "api.md", { description: "Java service contract", include: ["src/**/*.java"], requires: ["docs:contract.md", "docs:base.md"] }, "JAVA_BODY");
  const originalGuide = fs.readFileSync(path.join(project, "AGENTS.md"));
  let rules = new ProjectRules(project);
  only(rules.select({ operation: ["src/pages/new.tsx"] }), ["docs:base.md", "operation:base.md", "operation:forms.md"]);
  only(rules.select({ mini: ["src/pages/new.tsx"] }), ["docs:base.md", "mini:base.md", "mini:pages.md"]);
  only(rules.select({ web: ["src/pages/new.tsx"] }), ["docs:base.md", "web:base.md", "web:pages.md"]);
  only(rules.select({ app: ["lib/new.dart"] }), ["docs:base.md", "app:base.md", "app:pages.md"]);
  only(rules.select({ operation: ["src\\components\\form.tsx", "src/pages/new.tsx"] }), ["docs:base.md", "operation:base.md", "operation:forms.md"]);
  only(rules.select({ operation: ["src/components/generated/form.tsx"] }), ["docs:base.md", "operation:base.md"]);
  only(rules.select({ operation: [] }), ["docs:base.md", "operation:base.md"]);
  only(rules.select({ docs: ["docs/CR-M20.md"] }), ["docs:base.md"]);
  only(rules.select({ operation: ["public/index.html"] }, ["ui-mock"]), ["docs:base.md", "docs:mock.md", "operation:base.md"]);
  const crossScope = { backend: ["src/Product.java"], operation: ["src/api/product.ts"] };
  const cross = rules.select(crossScope);
  only(cross, ["docs:base.md", "docs:contract.md", "backend:base.md", "backend:api.md", "operation:base.md", "operation:api.md"]);
  assert.equal(cross.coverage, "not_evaluated"); assert.equal(cross.permissions_granted, false);
  assert.equal(cross.selected.filter(rule => rule.id === "docs:contract.md").length, 1);
  assert(!JSON.stringify(rules.catalog(["operation"])).includes("ANTD_FORM_BODY"));
  assert(!JSON.stringify(cross).includes("JAVA_BODY"));
  assert.equal(rules.load({ operation: ["src/pages/new.tsx"] }, [], "operation:forms.md").content.trim(), "ANTD_FORM_BODY");
  const originalForm = fs.readFileSync(path.join(roots.operation, ".agents/rules/forms.md"));
  rule("operation", "forms.md", { description: "changed scope", tasks: ["changed-form"] }, "NEW_BODY");
  only(rules.select({ operation: ["src/pages/new.tsx"] }), ["docs:base.md", "operation:base.md"]);
  assert.equal(rules.load({ operation: [] }, ["changed-form"], "operation:forms.md").content.trim(), "NEW_BODY");
  fs.writeFileSync(path.join(roots.operation, ".agents/rules/forms.md"), originalForm);
  assert.throws(() => rules.load({ operation: [] }, [], "mini:pages.md"), /not selected/);
  assert.throws(() => rules.select({}), /empty scope/);
  assert.throws(() => rules.select({ missing: [] }), /Unknown repository/);
  for (const target of ["../outside", "/absolute", "C:\\absolute", "./ambiguous"]) assert.throws(() => rules.select({ operation: [target] }), /relative path/);
  for (const pattern of ["../**", "src/**x", "{src,test}/**", "[ab]/*", "!src/**"]) assert.throws(() => rulePattern(pattern));
  assert(rulePattern("src/**/*.tsx").test("src/direct.tsx")); assert(rulePattern("src/**/*.tsx").test("src/a/b/deep.tsx"));
  assert(!rulePattern("src/*.tsx").test("src/a/deep.tsx")); assert(!rulePattern("src/**").test("SRC/page.tsx"));

  // Native fragments contain only pointers, not business rule bodies or inaccurate exclude translations.
  const kiro = rules.adapter("operation", "kiro");
  const forms = kiro.fragments.find(item => item.content.includes("候选 operation:forms.md"))!;
  const api = kiro.fragments.find(item => item.content.includes("候选 operation:api.md"))!;
  assert(forms.content.includes("inclusion: manual")); assert(!forms.content.includes("fileMatchPattern"));
  assert(api.content.includes("inclusion: fileMatch")); assert(api.content.includes("src/api/**"));
  for (const host of ["codex", "kiro", "skill"]) { const adapter = rules.adapter("operation", host); assert.equal(adapter.writes, false); assert(!JSON.stringify(adapter).includes("ANTD_FORM_BODY")); }
  assert.deepEqual(fs.readFileSync(path.join(project, "AGENTS.md")), originalGuide);
  assert(!fs.existsSync(path.join(project, ".aidlc"))); assert(!fs.existsSync(path.join(roots.operation, "AGENTS.md")));

  const invalidFile = path.join(roots.operation, ".agents/rules/invalid.md");
  for (const meta of [{ description: "bad", always: true, include: "src/**" }, { description: "bad", include: [] }, { description: "bad", inclusion: "manual" }, { description: "bad", include: "src/**", requires: "missing.md" }]) {
    rule("operation", "invalid.md", meta, "invalid");
    assert.throws(() => new ProjectRules(project).select({ operation: ["src/a.ts"] }));
  }
  rule("operation", "invalid.md", { description: "cycle", always: true, requires: "invalid.md" }, "invalid");
  assert.throws(() => new ProjectRules(project).select({ operation: [] }), /Cyclic/);
  fs.unlinkSync(invalidFile);
  const origin = config.repositories.operation.remote;
  config.repositories.operation.remote = "https://example.org/dfi/mini.git"; saveConfig();
  assert.throws(() => new ProjectRules(project).select({ operation: [] }), /origin does not match/);
  config.repositories.operation.remote = origin; saveConfig();
  const nested = path.join(roots.operation, "nested"); fs.mkdirSync(nested); git(nested, ["init", "--quiet"]);
  assert.throws(() => new ProjectRules(project).select({ operation: ["nested/new.ts"] }), /different Git repository/);
  const outside = path.join(temporary, "outside"); fs.mkdirSync(outside);
  const link = path.join(roots.operation, "escape"); fs.symlinkSync(outside, link, "junction");
  assert.throws(() => new ProjectRules(project).select({ operation: ["escape/new.tsx"] }), /outside rule source/);
  fs.unlinkSync(link);

  // A real Git worktree, not the directory name, determines the endpoint identity.
  git(roots.operation, ["add", ".agents/rules"]);
  git(roots.operation, ["-c", "user.name=AIDLC test", "-c", "user.email=aidlc@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${outside}`, "commit", "--quiet", "-m", "rules fixture"]);
  const worktree = path.join(temporary, "not-named-operation");
  git(roots.operation, ["worktree", "add", "--detach", "--quiet", worktree]);
  const previousRoot = config.repositories.operation.root;
  config.repositories.operation.root = path.relative(project, worktree); saveConfig();
  only(new ProjectRules(project).select({ operation: ["src/pages/new.tsx"] }), ["docs:base.md", "operation:base.md", "operation:forms.md"]);
  config.repositories.operation.root = previousRoot; saveConfig();

  const cli = spawnSync(process.execPath, [path.join(repository, "bin/cli.js"), "rules", "select", "--project", project, "--scope", JSON.stringify(crossScope)], { cwd: roots.app, encoding: "utf8", windowsHide: true });
  assert.equal(cli.status, 0, cli.stderr); only(JSON.parse(cli.stdout), ids(cross));
  assert(!cli.stdout.includes("JAVA_BODY"));
  const single = new ProjectRules(roots.mini); only(single.select({ self: [] }), ["self:base.md"]);
  write(path.join(project, "AGENTS.md"), "```aidlc-rules\nrepositories: {}\n");
  assert.throws(() => rules.select({ operation: [] }), /instructions changed/);
  assert.throws(() => new ProjectRules(project), /Malformed/);
  console.log("PASS project rules: five endpoints, shared constraints, new files, exclusions, explicit tasks, complete dependency union, bounded output, Git identity/worktree, path confinement, read-only host fragments and CLI");
  }
} finally {
  assert(temporary.startsWith(path.join(os.tmpdir(), "aidlc rules 中文 ")));
  fs.rmSync(temporary, { recursive: true, force: true });
}
