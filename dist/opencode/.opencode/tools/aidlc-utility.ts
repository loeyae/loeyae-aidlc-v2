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
    const count = graph.stages.filter(
      (stage) => stage.execution === "ALWAYS" || stage.scopes.includes(scope),
    ).length;
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
