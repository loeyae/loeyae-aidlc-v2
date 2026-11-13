/** Explicit method lookup; never expands dependencies or reads bodies for a catalog. */
import { readFileSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function methodCatalog() {
  return JSON.parse(readFileSync(resolve(root, "knowledge/methods.json"), "utf8")) as { id: string; description: string; path: string }[];
}
export function readMethod(id: string) {
  const method = methodCatalog().find(m => m.id === id);
  if (!method || !/^skills\/aidlc-[a-z-]+\/SKILL\.md$/.test(method.path)) throw Error("Unknown method; use methods to inspect the catalog");
  const file = resolve(root, method.path);
  if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 64 * 1024) throw Error("Unsafe method file");
  return readFileSync(file, "utf8");
}
export function runMethodsCli(args: string[]) {
  if (!args.length || (args.length === 1 && args[0] === "--help")) { console.log(JSON.stringify(methodCatalog(), null, 2)); return; }
  if (args.length !== 2 || args[0] !== "read") throw Error("methods [read <method-id>]");
  console.log(readMethod(args[1]));
}
