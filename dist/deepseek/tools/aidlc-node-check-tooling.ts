import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import type * as TypeScript from "typescript";

interface Command { role: string; argv: string[]; cwd?: string; evidence_inputs?: { environment: string[] } }

/** Bounded adapter using the selected compiler's parser for final options.
 * Unknown wrappers/config inheritance fail closed with a useful diagnostic. */
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
  const checks = commands.filter(command => command.role === "check" && resolve(root, command.cwd || root) === base);
  // Match the existing evidence environment contract: declared inputs plus
  // executable discovery, or conservative environment binding without a list.
  // Store only a digest, never environment values in public evidence.
  const environmentKeys = checks.some(command => !command.evidence_inputs)
    ? Object.keys(process.env).filter(key => key !== "AIDLC_SESSION_BINDING")
    : [...new Set(["PATH", "Path", "PATHEXT", "SystemRoot", "ComSpec", "NODE_OPTIONS", "NODE_PATH", ...checks.flatMap(command => command.evidence_inputs!.environment)])];
  bindings["@execution-context"] = createHash("sha256").update(JSON.stringify({
    runtime: { executable: process.execPath, version: process.version, platform: process.platform, arch: process.arch },
    environment: environmentKeys.sort().map(key => [key, process.env[key] ?? null]),
  })).digest("hex");
  const bind = (path: string) => {
    if (!statSync(path).isFile()) fail(`tool input is not a file: ${path}`);
    bindings[relative(root, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
  };
  for (const name of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]) if (existsSync(resolve(base, name))) bind(regularFile(resolve(base, name), "TypeScript dependency lock"));
  const scripts = pkg.scripts ?? {};
  const tokenize = (script: unknown): string[] => {
    if (typeof script !== "string" || /[;&|<>`$\r\n]/.test(script)) return fail("shell expressions/wrappers are ambiguous");
    const tokens = script.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g) ?? [];
    if (tokens.join(" ").replace(/\s+/g, " ") !== script.trim().replace(/\s+/g, " ")) fail("unsupported script quoting");
    return tokens.map(token => /^['"]/.test(token) ? token.slice(1, -1) : token);
  };
  const mentionsTsc = (value: string) => /(?:\btsc\b|\btypescript\b)/i.test(value);
  const consumedScripts = new Set<string>();
  const inspect = (argv: string[], cwd: string, seen: string[] = []): boolean => {
    if (/^(?:npm|npm\.cmd)$/.test(argv[0] ?? "") && argv[1] === "run") {
      const name = argv[2];
      if (!name || seen.includes(name) || seen.length > 16 || scripts[name] === undefined) return fail("missing/cyclic npm script");
      consumedScripts.add(name);
      if (scripts[`pre${name}`] || scripts[`post${name}`]) fail(`npm lifecycle for ${name} needs separate build analysis`);
      const extra = argv.slice(3);
      if (extra.length && extra[0] !== "--") fail("unsupported npm run arguments");
      return inspect([...tokenize(scripts[name]), ...extra.slice(1)], cwd, [...seen, name]);
    }
    if (!isTsc(argv)) {
      if (mentionsTsc(argv.join(" "))) fail("unrecognized TypeScript invocation");
      return false;
    }
    const bare = /^(?:tsc|tsc\.cmd)$/.test(argv[0]);
    let compilerPackage: string;
    try {
      compilerPackage = bare ? createRequire(packagePath).resolve("typescript/package.json")
        : resolve(dirname(resolve(cwd, argv[1])), "../package.json");
    } catch { return fail("tsc needs a locally resolvable TypeScript installation"); }
    const compilerRoot = dirname(compilerPackage);
    const metadata = JSON.parse(readFileSync(compilerPackage, "utf8"));
    if (metadata.name !== "typescript" || !/^5\./.test(metadata.version)) fail("compiler must be a verifiable TypeScript 5.x package");
    for (const name of ["package.json", "bin/tsc", "lib/tsc.js", "lib/_tsc.js", "lib/typescript.js"]) if (existsSync(resolve(compilerRoot, name))) bind(resolve(compilerRoot, name));
    const ts: typeof TypeScript = createRequire(compilerPackage)(resolve(compilerRoot, "lib/typescript.js"));
    const diagnostics = (errors: readonly TypeScript.Diagnostic[]) => {
      if (errors.length) fail(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; "));
    };
    const readConfig = (path: string): string => {
      const safe = regularFile(path, "TypeScript check config");
      bind(safe);
      const bytes = readFileSync(safe, "utf8"), parsed = ts.parseConfigFileTextToJson(safe, bytes);
      if (parsed.error) diagnostics([parsed.error]);
      const value = parsed.config;
      if (!value || typeof value !== "object" || Array.isArray(value) || value.references !== undefined) fail(`unsupported tsconfig/references: ${safe}`);
      if (value.extends !== undefined && (typeof value.extends !== "string" || !value.extends.startsWith("."))) fail(`only local relative tsconfig extends is verifiable: ${safe}`);
      return bytes;
    };
    const args = argv.slice(bare ? 1 : 2);
    if (args.some(arg => arg.startsWith("@"))) fail("response files are not verifiable");
    const parsed = ts.parseCommandLine(args);
    diagnostics(parsed.errors);
    let options = parsed.options;
    if (options.project && parsed.fileNames.length) fail("project option mixed with input files");
    if (options.project || !parsed.fileNames.length) {
      let path = resolve(cwd, options.project || "tsconfig.json");
      if (existsSync(path) && statSync(path).isDirectory()) path = resolve(path, "tsconfig.json");
      const loaded = ts.readConfigFile(path, readConfig);
      if (loaded.error) diagnostics([loaded.error]);
      let reads = 0;
      const resolved = ts.parseJsonConfigFileContent(loaded.config, {
        ...ts.sys, getCurrentDirectory: () => cwd,
        readFile: path => { if (++reads > 16) fail("deep tsconfig inheritance"); return readConfig(path); },
      }, dirname(path), parsed.options, path);
      diagnostics(resolved.errors);
      options = resolved.options;
    }
    // noEmit suppresses JS/declarations/maps, including configured output paths.
    // Incremental/composite still write build-info; trace/profile write separately.
    if (options.noEmit !== true) fail("compiler may emit artifacts");
    for (const key of ["incremental", "composite", "generateTrace", "generateCpuProfile", "watch", "build", "init", "showConfig", "listFilesOnly", "help", "version", "noCheck"] as const) {
      if (options[key]) fail(`output/build or non-check option ${key}`);
    }
    return true;
  };
  let observed = false;
  for (const command of commands) {
    const cwd = resolve(root, command.cwd || root);
    if (cwd !== base) continue; // another module's check cannot justify this package
    const check = inspect(command.argv, cwd);
    if (check && command.role !== "check") fail("TypeScript noEmit must be a check role");
    observed ||= check;
  }
  // Evaluate consumed scripts with their actual forwarded CLI overrides. Other
  // declared tooling flows still need analysis; dormant configs alone do not.
  for (const [name, value] of Object.entries(scripts)) if (!consumedScripts.has(name) && mentionsTsc(String(value))) inspect(tokenize(value), base);
  if (!observed) fail("no controlled noEmit check for this package");
  return bindings;
}
