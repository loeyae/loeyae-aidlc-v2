import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";

interface Command { role: string; argv: string[]; cwd?: string }

/** A deliberately bounded adapter, not a shell or a TypeScript compiler. Unknown
 * wrappers/options/config inheritance fail closed with a useful diagnostic. */
export function nativeNodeCheckTooling(
  packagePath: string, pkg: Record<string, any>, commands: Command[], root: string,
  regularFile: (path: string, field: string) => string,
): Record<string, string> | undefined {
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  const fail = (detail: string): never => { throw new Error(`native-node build exemption cannot verify TypeScript check-only tooling: ${detail}; use a real build or an unambiguous noEmit check`); };
  const isTsc = (argv: string[]) => /^(?:tsc|tsc\.cmd)$/.test(argv[0] ?? "") || (/^(?:.*[/\\])?node(?:\.exe)?$/.test(argv[0] ?? "") && /(?:^|[/\\])typescript[/\\](?:bin[/\\]tsc|lib[/\\]tsc\.js)$/.test(argv[1] ?? ""));
  if (!Object.hasOwn(dependencies, "typescript")) {
    if (commands.some(command => resolve(root, command.cwd || root) === dirname(packagePath) && isTsc(command.argv))) fail("TypeScript command has no declared development dependency");
    return undefined;
  }
  if (!pkg.devDependencies?.typescript || pkg.dependencies?.typescript || pkg.optionalDependencies?.typescript) fail("typescript must be a development-only dependency");
  const base = dirname(packagePath), bindings: Record<string, string> = {};
  const bind = (path: string) => {
    if (!statSync(path).isFile()) fail(`tool input is not a file: ${path}`);
    bindings[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  };
  for (const name of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]) if (existsSync(resolve(base, name))) bind(regularFile(resolve(base, name), "TypeScript dependency lock"));
  const scripts = pkg.scripts ?? {};
  const config = (path: string, stack: string[] = []): Record<string, any> => {
    const safe = regularFile(path, "TypeScript check config");
    if (stack.includes(safe) || stack.length > 16) fail("cyclic/deep tsconfig inheritance");
    const bytes = readFileSync(safe, "utf8");
    bind(safe);
    // JSONC: preserve strings while removing comments and trailing commas.
    const uncommented = bytes.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('"') ? token : " ");
    const json = uncommented.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, token => token.startsWith('"') ? token : "");
    let value: Record<string, any>;
    try { value = JSON.parse(json); } catch { return fail(`invalid JSONC: ${safe}`); }
    if (!value || Array.isArray(value) || typeof value !== "object" || value.references !== undefined) return fail(`unsupported tsconfig/references: ${safe}`);
    if (value.compilerOptions !== undefined && (!value.compilerOptions || typeof value.compilerOptions !== "object" || Array.isArray(value.compilerOptions))) return fail(`invalid compilerOptions: ${safe}`);
    let inherited = {};
    if (value.extends !== undefined) {
      if (typeof value.extends !== "string" || !value.extends.startsWith(".")) fail(`only local relative tsconfig extends is verifiable: ${safe}`);
      let parent = resolve(dirname(safe), value.extends);
      if (!existsSync(parent) && !parent.endsWith(".json")) parent += ".json";
      inherited = config(parent, [...stack, safe]);
    }
    const options = { ...inherited, ...value.compilerOptions };
    for (const key of ["outDir", "outFile", "declarationDir", "tsBuildInfoFile", "incremental", "composite", "declaration", "emitDeclarationOnly"]) {
      if (options[key] !== undefined && options[key] !== false) fail(`output/build option ${key} in ${safe}`);
    }
    return options;
  };
  const tokenize = (script: unknown): string[] => {
    if (typeof script !== "string" || /[;&|<>`$\r\n]/.test(script)) return fail("shell expressions/wrappers are ambiguous");
    const tokens = script.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) ?? [];
    if (tokens.join(" ").replace(/\s+/g, " ") !== script.trim().replace(/\s+/g, " ")) fail("unsupported script quoting");
    return tokens.map(token => /^['"]/.test(token) ? token.slice(1, -1) : token);
  };
  const mentionsTsc = (value: string) => /(?:\btsc\b|\btypescript\b)/i.test(value);
  const inspect = (argv: string[], cwd: string, seen: string[] = [], controlled = false): boolean => {
    if (/^(?:npm|npm\.cmd)$/.test(argv[0] ?? "") && argv[1] === "run") {
      const name = argv[2];
      if (!name || seen.includes(name) || seen.length > 16 || scripts[name] === undefined) return fail("missing/cyclic npm script");
      if (scripts[`pre${name}`] || scripts[`post${name}`]) fail(`npm lifecycle for ${name} needs separate build analysis`);
      const extra = argv.slice(3);
      if (extra.length && extra[0] !== "--") fail("unsupported npm run arguments");
      return inspect([...tokenize(scripts[name]), ...extra.slice(1)], cwd, [...seen, name], controlled);
    }
    if (!isTsc(argv)) {
      if (mentionsTsc(argv.join(" "))) fail("unrecognized TypeScript invocation");
      return false;
    }
    if (controlled) {
      let compilerPackage: string;
      if (/^(?:tsc|tsc\.cmd)$/.test(argv[0])) {
        try { compilerPackage = createRequire(packagePath).resolve("typescript/package.json"); }
        catch { return fail("bare tsc needs a locally resolvable TypeScript installation"); }
      } else compilerPackage = resolve(dirname(resolve(cwd, argv[1])), "../package.json");
      const compilerRoot = dirname(compilerPackage);
      if (JSON.parse(readFileSync(compilerPackage, "utf8")).name !== "typescript") fail("compiler path is not a TypeScript package");
      for (const name of ["package.json", "bin/tsc", "lib/tsc.js", "lib/_tsc.js"]) if (existsSync(resolve(compilerRoot, name))) bind(resolve(compilerRoot, name));
    }
    const args = argv.slice(/^(?:tsc|tsc\.cmd)$/.test(argv[0]) ? 1 : 2);
    const booleans = new Set(["allowJs", "checkJs", "strict", "skipLibCheck", "esModuleInterop", "allowSyntheticDefaultImports", "noImplicitAny", "strictNullChecks", "forceConsistentCasingInFileNames", "pretty"]);
    const values = new Set(["target", "module", "moduleResolution", "lib", "types", "jsx"]);
    let noEmit: boolean | undefined, project: string | undefined, files = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--noEmit") {
        if (noEmit !== undefined) fail("duplicate noEmit option");
        noEmit = args[i + 1] === "false" ? (i++, false) : (args[i + 1] === "true" ? (i++, true) : true);
      } else if (arg === "-p" || arg === "--project") {
        if (project || !args[i + 1] || args[i + 1].startsWith("-")) fail("invalid project option");
        project = args[++i];
      } else if (booleans.has(arg.slice(2)) && arg.startsWith("--")) {
        if (/^(true|false)$/.test(args[i + 1] ?? "")) i++;
      } else if (values.has(arg.slice(2)) && arg.startsWith("--")) {
        if (!args[++i] || args[i].startsWith("-")) fail(`missing value for ${arg}`);
      } else if (!arg.startsWith("-") && /\.[cm]?[jt]sx?$/.test(arg)) files = true;
      else fail(`unsupported or emitting compiler argument ${arg}`);
    }
    if (project && files) fail("project option mixed with input files");
    let options: Record<string, any> = {};
    if (project) {
      let path = resolve(cwd, project);
      if (!path.endsWith(".json")) path = resolve(path, "tsconfig.json");
      options = config(path);
    } else if (!files) {
      // Avoid silently depending on a tsconfig discovered in an ancestor.
      const path = resolve(cwd, "tsconfig.json");
      if (!existsSync(path)) fail("no explicit files/project or local tsconfig.json");
      options = config(path);
    }
    if ((noEmit ?? options.noEmit) !== true) fail("compiler may emit artifacts");
    return true;
  };
  // A dormant output configuration is also contradictory/ambiguous evidence.
  for (const name of readdirSync(base).filter(name => /^tsconfig(?:\..+)?\.json$/.test(name))) config(resolve(base, name));
  for (const value of Object.values(scripts)) if (mentionsTsc(String(value))) inspect(tokenize(value), base);
  let observed = false;
  for (const command of commands) {
    const cwd = resolve(root, command.cwd || root);
    if (cwd !== base) continue; // another module's check cannot justify this package
    const check = inspect(command.argv, cwd, [], true);
    if (check && command.role !== "check") fail("TypeScript noEmit must be a check role");
    observed ||= check;
  }
  if (!observed) fail("no controlled noEmit check for this package");
  return bindings;
}
