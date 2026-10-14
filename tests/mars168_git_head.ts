import { spawnSync } from "node:child_process";
const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }); if (result.status) throw new Error(result.stderr); process.stdout.write(result.stdout);
