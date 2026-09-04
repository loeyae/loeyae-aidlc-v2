import path from "path";

const WINDOWS_APP_NAMES = [
  "WorkBuddy",
  "CodeBuddy",
  path.win32.join("Tencent", "WorkBuddy"),
  path.win32.join("Tencent", "CodeBuddy"),
];

const WINDOWS_CLI_RELATIVE_PATHS = [
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy.exe"),
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy.cmd"),
  path.win32.join("resources", "app.asar.unpacked", "cli", "bin", "codebuddy"),
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nonEmpty(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function windowsApplicationRoots(env: NodeJS.ProcessEnv): string[] {
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
  const appRoots = unique([...perUserRoots, ...machineRoots]).flatMap((root) =>
    WINDOWS_APP_NAMES.map((appName) => path.win32.join(root, appName)),
  );
  return unique(appRoots);
}

export function codeBuddyKnownCliPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "win32") {
    return unique(windowsApplicationRoots(env).flatMap((root) =>
      WINDOWS_CLI_RELATIVE_PATHS.map((relativePath) => path.win32.join(root, relativePath)),
    ));
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
