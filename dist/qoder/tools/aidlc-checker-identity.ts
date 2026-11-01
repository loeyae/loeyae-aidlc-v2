/** Content identity of the installed semantic checker and its actual runtime dependencies. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const tools = dirname(fileURLToPath(import.meta.url));
let memo: string | undefined;
const runtime = { node: process.version, platform: process.platform, arch: process.arch };

/** Share scans within one synchronous producer invocation, never across invocations. */
export function withSemanticCheckerIdentityMemoization<T>(operation: () => T): T {
  memo = undefined;
  try { return operation(); }
  finally { memo = undefined; }
}

export function semanticCheckerDigest(refresh = false): string {
  if (memo && !refresh) return memo;
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ version: 1, runtime }));
  const digestFile = (file: string, label: string) =>
    hash
      .update(label)
      .update("\0")
      .update(createHash("sha256").update(readFileSync(file)).digest())
      .update("\0");
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
  walk(tools, "tools", true);
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
    digestFile(file, "package.json");
    for (const name of Object.keys(pkg.dependencies || {}).sort()) dependency(name, packageRoot);
  } else
    for (const name of ["tsx", "yaml", "markdown-it", "html-validate", "parse5", "jszip", "@xmldom/xmldom"])
      dependency(name, tools);
  memo = hash.digest("hex");
  return memo;
}

export function semanticCheckerIdentityErrors(value: Record<string, unknown>): string[] {
  return value.identity_version === 1 && value.implementation_digest === semanticCheckerDigest()
    ? []
    : ["semantic checker implementation is missing or changed; refresh controlled evidence"];
}
