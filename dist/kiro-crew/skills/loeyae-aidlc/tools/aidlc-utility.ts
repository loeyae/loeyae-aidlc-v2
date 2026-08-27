#!/usr/bin/env node
/**
 * aidlc-utility.ts — Read-only utilities derived from the compiled stage graph.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH_PATH = join(ROOT, "core", "tools", "data", "stage-graph.json");

interface StageGraph {
  stages: Array<{ scopes: string[]; execution: string }>;
}

function scopeTable(): void {
  const graph = JSON.parse(readFileSync(GRAPH_PATH, "utf-8")) as StageGraph;
  const scopes = [...new Set(graph.stages.flatMap((stage) => stage.scopes))].sort();
  for (const scope of scopes) {
    // A stage is a candidate for a scope iff the scope is listed in the
    // stage's scopes[] array. ALWAYS stages are already enumerated in the
    // relevant scopes[] arrays, so no separate ALWAYS special-case is needed
    // (the previous `execution === "ALWAYS" ||` branch double-counted
    // always-on stages into scopes that do not list them — e.g. bugfix/refactor).
    const count = graph.stages.filter((stage) => stage.scopes.includes(scope)).length;
    console.log(`${scope}\t${count}`);
  }
}

const command = process.argv[2];
if (command === "scope-table") {
  scopeTable();
} else {
  console.error("Usage: aidlc-utility.ts scope-table");
  process.exit(1);
}
