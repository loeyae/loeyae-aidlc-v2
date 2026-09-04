import assert from "node:assert/strict";
import { codeBuddyKnownCliPaths } from "../bin/host-detection";

const windowsEnvironment: NodeJS.ProcessEnv = {
  LOCALAPPDATA: "C:\\Users\\andy\\AppData\\Local",
  USERPROFILE: "C:\\Users\\andy",
  ProgramW6432: "C:\\Program Files",
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
};
const windowsPaths = codeBuddyKnownCliPaths("win32", windowsEnvironment);

assert(windowsPaths.includes("C:\\Users\\andy\\AppData\\Local\\Programs\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Users\\andy\\AppData\\Local\\Tencent\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert(windowsPaths.includes("C:\\Program Files (x86)\\Tencent\\CodeBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy.exe"));
assert.equal(new Set(windowsPaths).size, windowsPaths.length);

const macPaths = codeBuddyKnownCliPaths("darwin", { HOME: "/Users/andy" });
assert(macPaths.includes("/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"));
assert(macPaths.includes("/Users/andy/Applications/CodeBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"));

console.log("Host detection tests passed");
