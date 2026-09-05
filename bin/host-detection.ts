import { spawnSync } from "child_process";
import { closeSync, existsSync, openSync, readSync } from "fs";
import path from "path";

type CodeBuddyHost = "workbuddy" | "codebuddy";
type WindowsRegistryQuery = (args: string[]) => string | undefined;

interface WindowsApplicationRoot {
  host: CodeBuddyHost;
  root: string;
}

export interface HostCliInvocation {
  argsPrefix: string[];
  command: string;
}

function hasNodeShebang(filePath: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "r");
    const prefix = Buffer.alloc(256);
    const bytesRead = readSync(descriptor, prefix, 0, prefix.length, 0);
    return /^\uFEFF?#![^\r\n]*\bnode(?:\.exe)?\b/i.test(prefix.toString("utf8", 0, bytesRead));
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function hostCliInvocation(
  cliPath: string,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
): HostCliInvocation {
  const direct = { command: cliPath, argsPrefix: [] };
  if (platform !== "win32" || !existsSync(cliPath)) return direct;
  const extension = path.win32.extname(cliPath).toLowerCase();
  const isNodeScript = [".js", ".cjs", ".mjs"].includes(extension)
    || (!extension && hasNodeShebang(cliPath));
  return isNodeScript
    ? { command: nodeExecutable, argsPrefix: [cliPath] }
    : direct;
}

const WINDOWS_APP_NAMES: Array<{ host: CodeBuddyHost; relativePath: string }> = [
  { host: "workbuddy", relativePath: "WorkBuddy" },
  { host: "codebuddy", relativePath: "CodeBuddy" },
  { host: "workbuddy", relativePath: path.win32.join("Tencent", "WorkBuddy") },
  { host: "codebuddy", relativePath: path.win32.join("Tencent", "CodeBuddy") },
];

const WINDOWS_CLI_RELATIVE_PATHS = [
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy.exe"),
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy.cmd"),
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
];

const WINDOWS_UNINSTALL_REGISTRY_ROOTS = [
  "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

const WINDOWS_APP_PATHS: Array<{ host: CodeBuddyHost; key: string }> = [
  {
    host: "workbuddy",
    key: "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\WorkBuddy.exe",
  },
  {
    host: "workbuddy",
    key: "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\WorkBuddy.exe",
  },
  {
    host: "codebuddy",
    key: "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\CodeBuddy.exe",
  },
  {
    host: "codebuddy",
    key: "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\CodeBuddy.exe",
  },
];

const WINDOWS_REGISTRY_VIEWS = ["/reg:64", "/reg:32"];

export type WindowsDesktopHarness = "kiro-crew" | "kiro-ide" | "opencode" | "codex" | "zcode";

const WINDOWS_DESKTOP_APPLICATIONS: Record<WindowsDesktopHarness, {
  displayNames: string[];
  executableNames: string[];
}> = {
  "kiro-crew": { displayNames: ["KiroCrew", "Kiro Crew"], executableNames: ["KiroCrew.exe"] },
  "kiro-ide": { displayNames: ["Kiro", "Kiro IDE"], executableNames: ["Kiro.exe"] },
  opencode: { displayNames: ["OpenCode"], executableNames: ["OpenCode.exe", "opencode.exe"] },
  codex: { displayNames: ["Codex"], executableNames: ["Codex.exe", "codex.exe"] },
  zcode: { displayNames: ["ZCode"], executableNames: ["ZCode.exe", "zcode.exe"] },
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueWindowsPaths(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = path.win32.normalize(value).toLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function uniqueWindowsApplicationRoots(values: WindowsApplicationRoot[]): WindowsApplicationRoot[] {
  const seen = new Set<string>();
  return values.filter(({ host, root }) => {
    const identity = `${host}:${path.win32.normalize(root).toLowerCase()}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function windowsDefaultApplicationRoots(env: NodeJS.ProcessEnv): WindowsApplicationRoot[] {
  const localAppData = env.LOCALAPPDATA?.trim();
  const profile = env.USERPROFILE?.trim() || env.HOME?.trim();
  const perUserRoots = localAppData
    ? [path.win32.join(localAppData, "Programs"), localAppData]
    : profile
      ? [
          path.win32.join(profile, "AppData", "Local", "Programs"),
          path.win32.join(profile, "AppData", "Local"),
        ]
      : [];
  const machineRoots = [env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"]].filter(nonEmpty);
  return uniqueWindowsApplicationRoots(
    uniqueWindowsPaths([...perUserRoots, ...machineRoots]).flatMap((root) =>
      WINDOWS_APP_NAMES.map(({ host, relativePath }) => ({
        host,
        root: path.win32.join(root, relativePath),
      })),
    ),
  );
}

function expandWindowsEnvironment(value: string, env: NodeJS.ProcessEnv): string {
  const environment = new Map(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([name, environmentValue]) => [name.toLowerCase(), environmentValue]),
  );
  return value.replace(/%([^%]+)%/g, (match, name: string) => environment.get(name.toLowerCase()) || match);
}

function windowsAbsolutePath(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const expanded = expandWindowsEnvironment(value.trim().replace(/^"|"$/g, ""), env);
  if (!path.win32.isAbsolute(expanded)) return undefined;
  return path.win32.normalize(expanded);
}

function windowsExecutablePath(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const expanded = expandWindowsEnvironment(value.trim(), env);
  const match = expanded.match(/^"([^"]+\.exe)"/i)
    || expanded.match(/^(.+?\.exe)(?=,\s*-?\d+|\s|$)/i);
  return match ? windowsAbsolutePath(match[1], env) : undefined;
}

function windowsRegistryValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/i);
    if (match) values.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  return values;
}

function windowsRegistryKeys(output: string): string[] {
  return unique(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^HKEY_(?:CURRENT_USER|LOCAL_MACHINE)\\/i.test(line)),
  );
}

function hostFromDisplayName(displayName: string | undefined): CodeBuddyHost | undefined {
  if (/workbuddy/i.test(displayName || "")) return "workbuddy";
  if (/codebuddy/i.test(displayName || "")) return "codebuddy";
  return undefined;
}

function registryRootPaths(
  output: string,
  env: NodeJS.ProcessEnv,
  includeAnyExecutable = false,
): string[] {
  const values = windowsRegistryValues(output);
  const roots: string[] = [];
  const installLocation = values.get("installlocation");
  if (installLocation) {
    const root = windowsAbsolutePath(installLocation, env);
    if (root) roots.push(root);
  }
  for (const valueName of ["displayicon", "uninstallstring", "quietuninstallstring"]) {
    const executable = windowsExecutablePath(values.get(valueName) || "", env);
    if (executable) roots.push(path.win32.dirname(executable));
  }
  if (includeAnyExecutable) {
    const executable = [...values.values()]
      .map((value) => windowsExecutablePath(value, env))
      .find(nonEmpty);
    if (executable) roots.push(path.win32.dirname(executable));
    const registeredPath = values.get("path");
    if (registeredPath) {
      for (const candidate of registeredPath.split(";")) {
        const root = windowsAbsolutePath(candidate, env);
        if (root) roots.push(root);
      }
    }
  }
  return uniqueWindowsPaths(roots);
}

function rootsFromRegistryValues(
  output: string,
  env: NodeJS.ProcessEnv,
  expectedHost?: CodeBuddyHost,
): WindowsApplicationRoot[] {
  const values = windowsRegistryValues(output);
  const host = expectedHost || hostFromDisplayName(values.get("displayname"));
  if (!host) return [];
  return registryRootPaths(output, env, Boolean(expectedHost)).map((root) => ({ host, root }));
}

function queryWindowsRegistry(args: string[]): string | undefined {
  const result = spawnSync("reg.exe", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout || undefined;
}

let registeredWindowsApplicationsCache: WindowsApplicationRoot[] | undefined;

function registeredWindowsApplicationRoots(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  registryQuery: WindowsRegistryQuery,
): WindowsApplicationRoot[] {
  if (platform !== "win32") return [];
  const cacheable = env === process.env && registryQuery === queryWindowsRegistry;
  if (cacheable && registeredWindowsApplicationsCache) return registeredWindowsApplicationsCache;

  const roots: WindowsApplicationRoot[] = [];
  for (const { host, key } of WINDOWS_APP_PATHS) {
    for (const registryView of WINDOWS_REGISTRY_VIEWS) {
      const output = registryQuery(["query", key, registryView]);
      if (output) roots.push(...rootsFromRegistryValues(output, env, host));
    }
  }

  const matchingKeys = new Map<string, string>();
  for (const registryRoot of WINDOWS_UNINSTALL_REGISTRY_ROOTS) {
    for (const registryView of WINDOWS_REGISTRY_VIEWS) {
      for (const productName of ["WorkBuddy", "CodeBuddy"]) {
        const output = registryQuery(["query", registryRoot, "/s", "/f", productName, "/d", registryView]);
        if (!output) continue;
        for (const key of windowsRegistryKeys(output)) matchingKeys.set(`${registryView}:${key}`, registryView);
      }
    }
  }
  for (const [identity, registryView] of matchingKeys) {
    const key = identity.slice(registryView.length + 1);
    const output = registryQuery(["query", key, registryView]);
    if (output) roots.push(...rootsFromRegistryValues(output, env));
  }

  const discovered = uniqueWindowsApplicationRoots(roots);
  if (cacheable) registeredWindowsApplicationsCache = discovered;
  return discovered;
}

function matchesDisplayName(actual: string | undefined, expectedNames: string[]): boolean {
  const normalized = actual?.trim().toLowerCase() || "";
  return expectedNames.some((name) => {
    const expected = name.toLowerCase();
    if (normalized === expected) return true;
    const suffix = normalized.slice(expected.length);
    return normalized.startsWith(expected) && /^\s*(?:\(|v?\d)/.test(suffix);
  });
}

const windowsDesktopHostPathsCache = new Map<WindowsDesktopHarness, string[]>();

export function windowsDesktopHostPaths(
  harness: WindowsDesktopHarness,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  registryQuery: WindowsRegistryQuery = queryWindowsRegistry,
): string[] {
  if (platform !== "win32") return [];
  const cacheable = env === process.env && registryQuery === queryWindowsRegistry;
  const cached = cacheable ? windowsDesktopHostPathsCache.get(harness) : undefined;
  if (cached) return cached;

  const descriptor = WINDOWS_DESKTOP_APPLICATIONS[harness];
  const roots: string[] = [];
  for (const registryHive of ["HKEY_CURRENT_USER", "HKEY_LOCAL_MACHINE"]) {
    for (const executableName of descriptor.executableNames) {
      const key = `${registryHive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`;
      for (const registryView of WINDOWS_REGISTRY_VIEWS) {
        const output = registryQuery(["query", key, registryView]);
        if (output) roots.push(...registryRootPaths(output, env, true));
      }
    }
  }

  const matchingKeys = new Map<string, string>();
  for (const registryRoot of WINDOWS_UNINSTALL_REGISTRY_ROOTS) {
    for (const registryView of WINDOWS_REGISTRY_VIEWS) {
      for (const displayName of descriptor.displayNames) {
        const output = registryQuery(["query", registryRoot, "/s", "/f", displayName, "/d", registryView]);
        if (!output) continue;
        for (const key of windowsRegistryKeys(output)) matchingKeys.set(`${registryView}:${key}`, registryView);
      }
    }
  }
  for (const [identity, registryView] of matchingKeys) {
    const key = identity.slice(registryView.length + 1);
    const output = registryQuery(["query", key, registryView]);
    if (!output) continue;
    const displayName = windowsRegistryValues(output).get("displayname");
    if (matchesDisplayName(displayName, descriptor.displayNames)) {
      roots.push(...registryRootPaths(output, env));
    }
  }

  const registeredRoots = uniqueWindowsPaths(roots);
  const candidates = uniqueWindowsPaths([
    ...registeredRoots.flatMap((root) =>
      descriptor.executableNames.map((executableName) => path.win32.join(root, executableName)),
    ),
    ...registeredRoots,
  ]);
  if (cacheable) windowsDesktopHostPathsCache.set(harness, candidates);
  return candidates;
}

function cliPathsForWindowsRoots(roots: WindowsApplicationRoot[]): string[] {
  return uniqueWindowsPaths(
    roots.flatMap(({ root }) =>
      WINDOWS_CLI_RELATIVE_PATHS.map((relativePath) => path.win32.join(root, relativePath)),
    ),
  );
}

export function codeBuddyKnownCliPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  registryQuery: WindowsRegistryQuery = queryWindowsRegistry,
): string[] {
  if (platform === "win32") {
    const registeredRoots = registeredWindowsApplicationRoots(platform, env, registryQuery);
    return cliPathsForWindowsRoots([
      ...registeredRoots,
      ...windowsDefaultApplicationRoots(env),
    ]);
  }
  if (platform !== "darwin") return [];

  const home = env.HOME || env.USERPROFILE || "~";
  const applicationRoots = unique([
    env.AIDLC_APPLICATIONS_ROOT?.trim() || "/Applications",
    path.resolve(home, "Applications"),
  ]);
  return applicationRoots.flatMap((root) => [
    path.resolve(root, "WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"),
    path.resolve(root, "CodeBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"),
  ]);
}

export function codeBuddyConfigDirForCli(
  cliPath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  registryQuery: WindowsRegistryQuery = queryWindowsRegistry,
): string | undefined {
  const configured = env.CODEBUDDY_CONFIG_DIR?.trim();
  if (configured) return configured;

  const normalized = cliPath.replace(/\\/g, "/").toLowerCase();
  const registeredWorkBuddyCli = platform === "win32"
    && cliPathsForWindowsRoots(
      registeredWindowsApplicationRoots(platform, env, registryQuery).filter(({ host }) => host === "workbuddy"),
    ).some((candidate) => path.win32.normalize(candidate).toLowerCase() === path.win32.normalize(cliPath).toLowerCase());
  const workBuddyConfig = env.WORKBUDDY_CONFIG_DIR?.trim();
  const isWorkBuddyCli = Boolean(workBuddyConfig)
    || env.CODEBUDDY_HOST?.trim().toLowerCase().startsWith("workbuddy")
    || registeredWorkBuddyCli
    || ((
      normalized.includes("/workbuddy.app/contents/resources/")
      || normalized.includes("/workbuddy/resources/")
    ) && /\/cli\/bin\/codebuddy(?:\.exe|\.cmd)?$/.test(normalized));
  if (!isWorkBuddyCli) return undefined;
  if (workBuddyConfig) return workBuddyConfig;

  const home = env.HOME?.trim() || env.USERPROFILE?.trim();
  if (!home) return undefined;
  const dataFolderName = env.WORKBUDDY_DATA_FOLDER_NAME?.trim() || ".workbuddy";
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.resolve(home, dataFolderName);
}
