/** Content identity of the installed semantic checker and its actual runtime dependencies. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const tools = dirname(fileURLToPath(import.meta.url));
let memo: string | undefined;
const sensorMemo = new Map<string, string>();
let memoDepth = 0;
const runtime = { node: process.version, platform: process.platform, arch: process.arch };

/** Share scans within one synchronous producer invocation, never across invocations. */
export function withSemanticCheckerIdentityMemoization<T>(operation: () => T): T {
  memo = undefined;
  sensorMemo.clear();
  memoDepth++;
  try { return operation(); }
  finally { memo = undefined; sensorMemo.clear(); memoDepth--; }
}

export function semanticCheckerDigest(refresh = false, sensor?: string): string {
  const isolated = sensor === "template-completeness" || sensor === "functional-design-completeness";
  const cached = isolated ? sensorMemo.get(sensor!) : memo;
  if (memoDepth && cached && !refresh) return cached;
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ version: sensor === "functional-design-completeness" ? 3 : isolated ? 2 : 1, runtime, ...(isolated ? { sensor } : {}) }));
  const digestFile = (file: string, label: string) => {
    if (lstatSync(file).isSymbolicLink()) throw new Error(`checker identity cannot follow a content symlink: ${label}`);
    hash
      .update(label)
      .update("\0")
      .update(createHash("sha256").update(readFileSync(file)).digest())
      .update("\0");
  };
  const walk = (root: string, prefix: string, onlyCode = false) => {
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        const file = join(directory, entry.name),
          label = prefix + "/" + relative(root, file).replace(/\\/g, "/");
        if (entry.isSymbolicLink())
          throw new Error(`checker identity cannot follow a package content symlink: ${label}`);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && (!onlyCode || /\.(?:ts|mjs|cjs|js|json)$/.test(file))) digestFile(file, label);
      }
    };
    visit(root);
  };
  if (isolated) {
    // A deliberately closed import graph. Adding an undeclared import blocks
    // production until this contract is expanded; it cannot escape the digest.
    const closure = sensor === "functional-design-completeness"
      ? ["aidlc-functional-design-checker.ts", "aidlc-functional-design-inputs.ts", "aidlc-design-documents.ts", "aidlc-artifact-presence.ts", "aidlc-unresolved-markers.ts", "aidlc-scan-root.ts", "aidlc-execution-context.ts", "data/functional-checker-tsconfig.json"]
      : ["aidlc-template-checker.ts", "aidlc-sensor-inputs.ts", "aidlc-execution-context.ts"];
    const builtinDependencies = new Set(["fs", "node:fs", "path", "node:path", "crypto", "node:crypto", "url", "node:url"]);
    for (const name of closure) {
      const source = readFileSync(join(tools, name), "utf8");
      const imports: string[] = [];
      // Recognize a deliberately small, complete declaration grammar, then
      // reject leftover loading syntax. Never infer "no dependency" from a
      // matcher that failed on comments, quoted binding names or re-exports.
      const remaining = source.replace(/\bimport\s+(?:type\s+)?(?:[\w$*,{}\s]+?\s+from\s+)?(["'])([^"'\\\r\n]+)\1\s*;?/g, (statement, _quote, specifier) => {
        imports.push(specifier);
        return "";
      }).replace(/\bimport\s*\.\s*meta\b/g, "");
      if (/\b(?:import|require|eval)\b/.test(remaining)
        || /\bexport\s*(?:\/[/*]|(?:type\s+)?(?:\*|\{))/.test(remaining)) {
        throw new Error(`undeclared checker dependency: unsupported module syntax in ${name}`);
      }
      for (const specifier of imports) {
        // No type-import exemption: `type` can be an ordinary default binding.
        // Native loader/evaluator modules also require an explicit contract
        // expansion instead of escaping the graph through an aliased factory.
        if (!builtinDependencies.has(specifier) && !closure.includes(`${specifier.replace(/^\.\//, "")}.ts`)) throw new Error(`undeclared checker dependency: ${specifier}`);
      }
      digestFile(join(tools, name), `tools/${name}`);
    }
    digestFile(join(tools, "aidlc-checker-identity.ts"), "tools/aidlc-checker-identity.ts");
  } else walk(tools, "tools", true);
  let packageRoot = dirname(tools);
  while (dirname(packageRoot) !== packageRoot) {
    const file = join(packageRoot, "package.json");
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === "loeyae-aidlc") break;
    packageRoot = dirname(packageRoot);
  }
  const manifests = new Set<string>();
  const dependency = (name: string, from: string, optional = false) => {
    const require = createRequire(join(from, "package.json"));
    let manifest: string | undefined;
    try {
      manifest = require.resolve(`${name}/package.json`);
    } catch {
      try {
        let directory = dirname(require.resolve(name));
        while (dirname(directory) !== directory) {
          const candidate = join(directory, "package.json");
          if (existsSync(candidate) && JSON.parse(readFileSync(candidate, "utf8")).name === name) {
            manifest = candidate;
            break;
          }
          directory = dirname(directory);
        }
        if (!manifest) throw new Error(`cannot resolve ${name}`);
      } catch (error) {
        if (optional) {
          hash.update(`optional-missing:${name}\0`);
          return;
        }
        throw error;
      }
    }
    const real = realpathSync.native(manifest!);
    if (manifests.has(real)) return;
    manifests.add(real);
    const pkg = JSON.parse(readFileSync(real, "utf8")),
      root = dirname(real);
    walk(root, `${pkg.name}@${pkg.version}`);
    for (const key of Object.keys(pkg.dependencies || {}).sort())
      dependency(key, root, Boolean(pkg.optionalDependencies?.[key]));
    for (const key of Object.keys(pkg.optionalDependencies || {}).sort())
      if (!pkg.dependencies?.[key]) dependency(key, root, true);
  };
  const file = join(packageRoot, "package.json");
  const pkg = existsSync(file) && JSON.parse(readFileSync(file, "utf8"));
  if (pkg?.name === "loeyae-aidlc") {
    if (sensor === "functional-design-completeness") {
      hash.update("package-runtime-config\0").update(JSON.stringify({ type: pkg.type, imports: pkg.imports, tsx: pkg.dependencies?.tsx }));
    } else if (isolated) {
      const { version: _version, ...configuration } = pkg;
      hash.update("package.json/configuration\0").update(JSON.stringify(configuration));
    } else digestFile(file, "package.json");
    for (const name of (sensor === "functional-design-completeness" ? ["tsx"] : Object.keys(pkg.dependencies || {}).sort())) dependency(name, packageRoot);
  } else
    for (const name of (sensor === "functional-design-completeness" ? ["tsx"] : ["tsx", "yaml", "markdown-it", "html-validate", "parse5", "jszip", "@xmldom/xmldom"]))
      dependency(name, tools);
  const result = hash.digest("hex");
  if (isolated) sensorMemo.set(sensor!, result);
  else memo = result;
  return result;
}

export function semanticCheckerIdentityErrors(value: Record<string, unknown>, sensor?: string): string[] {
  const isolated = (sensor === "template-completeness" && value.identity_version === 2) || (sensor === "functional-design-completeness" && value.identity_version === 3);
  return (value.identity_version === 1 || isolated) && value.implementation_digest === semanticCheckerDigest(false, isolated ? sensor : undefined)
    ? []
    : ["semantic checker implementation is missing or changed; refresh controlled evidence"];
}
