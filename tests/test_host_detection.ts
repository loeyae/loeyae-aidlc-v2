import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codeBuddyConfigDirForCli, codeBuddyKnownCliPaths, hostCliInvocation } from "../bin/host-detection";

const scratchRoot = process.env.KIROCREW_SCRATCH || process.env.TMPDIR || tmpdir();
const launcherRoot = mkdtempSync(path.join(scratchRoot, "aidlc-host-cli-"));
try {
  const nodeLauncher = path.join(launcherRoot, "codebuddy");
  const nodeExecutable = "C:\\Program Files\\nodejs\\node.exe";
  writeFileSync(nodeLauncher, "#!/usr/bin/env node\nconsole.log('codebuddy');\n");
  assert.deepEqual(hostCliInvocation(nodeLauncher, "win32", nodeExecutable), {
    command: nodeExecutable,
    argsPrefix: [nodeLauncher],
  });
  assert.deepEqual(hostCliInvocation(nodeLauncher, "darwin", nodeExecutable), {
    command: nodeLauncher,
    argsPrefix: [],
  });
} finally {
  rmSync(launcherRoot, { recursive: true, force: true });
}

const windowsEnvironment: NodeJS.ProcessEnv = {
  LOCALAPPDATA: "C:\\Users\\andy\\AppData\\Local",
  USERPROFILE: "C:\\Users\\andy",
  ProgramW6432: "C:\\Program Files",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};
const windowsPaths = codeBuddyKnownCliPaths("win32", windowsEnvironment, () => undefined);

assert(windowsPaths.includes("C:\\Users\\andy\\AppData\\Local\\Programs\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Users\\andy\\AppData\\Local\\Tencent\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Program Files (x86)\\Tencent\\CodeBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert.equal(new Set(windowsPaths).size, windowsPaths.length);

const customRoot = "D:\\Company Tools\\Desktop Agent";
const customWorkBuddyCli = `${customRoot}\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe`;
const uninstallRoot = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
const uninstallKey = `${uninstallRoot}\\workbuddy-enterprise`;
const registryQueries: string[][] = [];
const customWindowsEnvironment: NodeJS.ProcessEnv = {
  ...windowsEnvironment,
  CUSTOM_WORKBUDDY_ROOT: customRoot,
};
const registryQuery = (args: string[]): string | undefined => {
  registryQueries.push(args);
  if (
    args[0] === "query"
    && args[1] === uninstallRoot
    && args.includes("/f")
    && args.includes("WorkBuddy")
  ) {
    return `${uninstallKey}\r\n    DisplayName    REG_SZ    WorkBuddy Enterprise\r\n`;
  }
  if (args[0] === "query" && args[1] === uninstallKey) {
    return [
      uninstallKey,
      "    DisplayName    REG_SZ    WorkBuddy Enterprise",
      "    InstallLocation    REG_EXPAND_SZ    %CUSTOM_WORKBUDDY_ROOT%",
      `    DisplayIcon    REG_SZ    "${customRoot}\\WorkBuddy.exe",0`,
      "",
    ].join("\r\n");
  }
  return undefined;
};
const customWindowsPaths = codeBuddyKnownCliPaths("win32", customWindowsEnvironment, registryQuery);
assert.equal(customWindowsPaths[0], customWorkBuddyCli);
assert(registryQueries.some((args) => args[1] === uninstallRoot && args.includes("WorkBuddy")));
assert(registryQueries.some((args) => args[1] === uninstallKey));
assert.equal(
  codeBuddyConfigDirForCli(customWorkBuddyCli, "win32", customWindowsEnvironment, registryQuery),
  "C:\\Users\\andy\\.workbuddy",
);

const macWorkBuddyCli = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
const macCodeBuddyCli = "/Users/andy/Applications/CodeBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
const macPaths = codeBuddyKnownCliPaths("darwin", { HOME: "/Users/andy" });
assert(macPaths.includes(macWorkBuddyCli));
assert(macPaths.includes(macCodeBuddyCli));
assert.equal(codeBuddyConfigDirForCli(macWorkBuddyCli, "darwin", { HOME: "/Users/andy" }), "/Users/andy/.workbuddy");
assert.equal(codeBuddyConfigDirForCli(macCodeBuddyCli, "darwin", { HOME: "/Users/andy" }), undefined);

const windowsWorkBuddyCli = "C:\\Users\\andy\\AppData\\Local\\Programs\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe";
assert.equal(
  codeBuddyConfigDirForCli(windowsWorkBuddyCli, "win32", { USERPROFILE: "C:\\Users\\andy" }, () => undefined),
  "C:\\Users\\andy\\.workbuddy",
);
assert.equal(
  codeBuddyConfigDirForCli(macWorkBuddyCli, "darwin", {
    HOME: "/Users/andy",
    CODEBUDDY_CONFIG_DIR: "/custom/codebuddy-home",
  }),
  "/custom/codebuddy-home",
);

console.log("Host detection tests passed");
