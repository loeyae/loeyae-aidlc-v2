import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  codeBuddyConfigDirForCli,
  codeBuddyKnownCliPaths,
  hostCliInvocation,
  hostCliSpawnSpec,
  qoderCnMcpConfigPath,
  resolveWindowsCommand,
  type WindowsDesktopHarness,
  windowsDesktopHostPaths,
} from "../bin/host-detection";

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

// Windows 批处理包装(npm 全局安装的 claude.cmd 等):裸命令名按 PATHEXT 解析,并经 cmd.exe 严格转义执行。
const cmdRoot = mkdtempSync(path.join(scratchRoot, "aidlc-host-cmd-"));
try {
  const echoScript = path.join(cmdRoot, "echo-args.cjs");
  writeFileSync(echoScript, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  const binDir = path.join(cmdRoot, "bin dir (x86) & co");
  mkdirSync(binDir);
  const shim = path.join(binDir, "fakehost.cmd");
  writeFileSync(shim, `@"${process.execPath}" "${echoScript}" %*\r\n`);
  const winEnv: NodeJS.ProcessEnv = { PATH: binDir, PATHEXT: ".exe;.cmd", ComSpec: "C:\\Windows\\System32\\cmd.exe" };
  // 注入 exists,模拟 Windows 文件系统:只承认 fakehost.cmd 候选存在。
  // 这样 POSIX 主机也能测 win32 命令解析,无需真实文件系统(该文件用 win32 路径分隔符,POSIX 上不存在)。
  const fakeHostCmd = path.win32.join(binDir, "fakehost.cmd");
  const mockExists = (filePath: string): boolean => filePath === fakeHostCmd;

  assert.equal(resolveWindowsCommand("fakehost", "win32", winEnv, mockExists), fakeHostCmd);
  assert.equal(resolveWindowsCommand("fakehost", "darwin", winEnv), "fakehost");
  assert.equal(resolveWindowsCommand("missing-host", "win32", winEnv, mockExists), "missing-host");

  const spec = hostCliSpawnSpec("fakehost", ["a b"], "win32", "node.exe", winEnv, mockExists);
  assert.equal(spec.command, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(spec.windowsVerbatimArguments, true);
  assert.deepEqual(spec.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.deepEqual(hostCliSpawnSpec("fakehost", ["a b"], "linux", "node", winEnv), { command: "fakehost", args: ["a b"] });
  assert.throws(() => hostCliSpawnSpec("fakehost", ["line\nbreak"], "win32", "node.exe", winEnv, mockExists), /line break/);

  if (process.platform === "win32") {
    const tricky = [
      "plain",
      "with space",
      "C:\\Program Files (x86)\\market & co",
      "quote\"inside",
      "trailing\\",
      "%PATH%",
      "a|b<c>d^e!f",
      "x\" & echo INJECTED & \"",
      "",
    ];
    const runEnv = { ...process.env, PATH: `${binDir};${process.env.PATH ?? ""}` };
    const runSpec = hostCliSpawnSpec("fakehost", tricky, "win32", process.execPath, runEnv);
    const result = spawnSync(runSpec.command, runSpec.args, {
      env: runEnv,
      encoding: "utf8",
      windowsVerbatimArguments: runSpec.windowsVerbatimArguments,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), tricky);
  }
} finally {
  rmSync(cmdRoot, { recursive: true, force: true });
}

const windowsEnvironment: NodeJS.ProcessEnv = {
  LOCALAPPDATA: "C:\\Users\\andy\\AppData\\Local",
  USERPROFILE: "C:\\Users\\andy",
  ProgramW6432: "C:\\Program Files",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};
assert.equal(
  qoderCnMcpConfigPath("win32", { USERPROFILE: "C:\\Users\\loeye" }),
  "C:\\Users\\loeye\\.qoder-cn\\mcp.json",
);
assert.equal(
  qoderCnMcpConfigPath("win32", {
    USERPROFILE: "C:\\Users\\loeye",
    QODER_CN_MCP_CONFIG: "D:\\Qoder Data\\mcp.json",
  }),
  "D:\\Qoder Data\\mcp.json",
);
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

const desktopApplications: Array<{
  displayName: string;
  executableName: string;
  harness: WindowsDesktopHarness;
  root: string;
}> = [
  { harness: "kiro-crew", displayName: "KiroCrew", executableName: "KiroCrew.exe", root: "D:\\Desktop Hosts\\KiroCrew Custom" },
  { harness: "kiro-ide", displayName: "Kiro", executableName: "Kiro.exe", root: "D:\\Desktop Hosts\\Kiro Custom" },
  { harness: "opencode", displayName: "OpenCode", executableName: "OpenCode.exe", root: "D:\\Desktop Hosts\\OpenCode Custom" },
  { harness: "codex", displayName: "Codex", executableName: "Codex.exe", root: "D:\\Desktop Hosts\\Codex Custom" },
  { harness: "qoder", displayName: "Qoder CN", executableName: "Qoder.exe", root: "D:\\Desktop Hosts\\Qoder CN Custom" },
  { harness: "zcode", displayName: "ZCode", executableName: "ZCode.exe", root: "D:\\Desktop Hosts\\ZCode Custom" },
];
const desktopRegistryQuery = (args: string[]): string | undefined => {
  for (const application of desktopApplications) {
    const key = `${uninstallRoot}\\${application.harness}`;
    if (args[0] === "query" && args[1] === uninstallRoot && args.includes(application.displayName)) {
      return `${key}\r\n    DisplayName    REG_SZ    ${application.displayName}\r\n`;
    }
    if (args[0] === "query" && args[1] === key) {
      return [
        key,
        `    DisplayName    REG_SZ    ${application.displayName}`,
        `    InstallLocation    REG_SZ    ${application.root}`,
        "",
      ].join("\r\n");
    }
  }
  return undefined;
};
for (const application of desktopApplications) {
  const paths = windowsDesktopHostPaths(
    application.harness,
    "win32",
    customWindowsEnvironment,
    desktopRegistryQuery,
  );
  assert.equal(paths[0], `${application.root}\\${application.executableName}`);
  assert(paths.includes(application.root));
}

const kiroCrewRegistryKey = `${uninstallRoot}\\kiro-crew-only`;
const kiroCrewOnlyQuery = (args: string[]): string | undefined => {
  if (args[0] === "query" && args[1] === uninstallRoot && args.includes("Kiro")) {
    return `${kiroCrewRegistryKey}\r\n    DisplayName    REG_SZ    Kiro Crew\r\n`;
  }
  if (args[0] === "query" && args[1] === kiroCrewRegistryKey) {
    return [
      kiroCrewRegistryKey,
      "    DisplayName    REG_SZ    Kiro Crew",
      "    InstallLocation    REG_SZ    D:\\Desktop Hosts\\Kiro Crew Only",
      "",
    ].join("\r\n");
  }
  return undefined;
};
assert.deepEqual(
  windowsDesktopHostPaths("kiro-ide", "win32", customWindowsEnvironment, kiroCrewOnlyQuery),
  [],
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
