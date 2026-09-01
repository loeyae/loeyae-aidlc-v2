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
