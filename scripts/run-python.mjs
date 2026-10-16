import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function testPython() {
  const configured = process.env.AIDLC_TEST_PYTHON;
  for (const executable of configured ? [configured] : ["python3", "python", "py"]) {
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10000 });
    if (probe.status === 0 && /^Python 3\./.test((probe.stdout + probe.stderr).trim())) return executable;
  }
  throw new Error("Python 3 unavailable. Set AIDLC_TEST_PYTHON to a working interpreter (Windows Store aliases are not interpreters).");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const result = spawnSync(testPython(), process.argv.slice(2), { stdio: "inherit", env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
