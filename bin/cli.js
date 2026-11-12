#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsx = require.resolve("tsx/cli");
const cli = resolve(root, "bin/cli.ts");
const cliArgs = process.argv.slice(2);
// Native host owns turn boundaries. The legacy diagnostic is useful only when
// a caller explicitly carries a managed binding; avoid starting TS/Core per stop.
if (cliArgs[0] === "hook" && !process.env.AIDLC_SESSION_BINDING) process.exit(0);
const hookInput = cliArgs[0] === "hook" ? readFileSync(0) : undefined;
const result = spawnSync(process.execPath, [tsx, cli, ...cliArgs], {
  stdio: hookInput === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
  input: hookInput,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
