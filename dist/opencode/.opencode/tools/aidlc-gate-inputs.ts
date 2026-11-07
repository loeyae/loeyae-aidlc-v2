/** Fresh non-source key for canonical current GREEN checks in one immutable request. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { currentHead, readSourceRevision } from "./aidlc-revision";
import { evidenceTimeError } from "./aidlc-evidence-policy";

export function greenGateInputKey(root: string, evidence: Record<string, unknown>, context: unknown): string | null {
  const binding = evidence.phase_input_binding as { files?: Array<{ path: string }> } | undefined;
  if (evidence.status !== "passed" || (evidence.evidence_mode !== undefined && evidence.evidence_mode !== "original") || evidence.exemption_validation_execution || evidence.alternative_validation_execution || !Array.isArray(binding?.files)) return null;
  try {
    const hash = createHash("sha256");
    let count = 0, bytes = 0;
    const visited = new Set<string>();
    const visit = (label: string): void => {
      const path = resolve(root, label), rel = relative(resolve(root), path);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("gate input outside project");
      let cursor = resolve(root);
      for (const part of rel.split(sep)) { cursor = join(cursor, part); if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("gate input symlink"); }
      if (visited.has(path)) return;
      visited.add(path);
      hash.update(rel.replace(/\\/g, "/")).update("\0");
      if (!existsSync(path)) { hash.update("missing\0"); return; }
      const stat = lstatSync(path);
      if (++count > 4000 || (bytes += stat.isFile() ? stat.size : 0) > 64 * 1024 * 1024) throw new Error("gate input inventory too large");
      if (stat.isDirectory()) { hash.update("directory\0"); for (const name of readdirSync(path).sort()) visit(join(rel, name)); }
      else if (stat.isFile()) {
        const content = readFileSync(path);
        if (rel.replace(/\\/g, "/").startsWith(".aidlc/evidence/") && path.endsWith(".json")) {
          const value = JSON.parse(content.toString("utf8"));
          if (value?.evidence_version === "1" && evidenceTimeError(value, String(value.checker?.sensor || "unknown"))) throw new Error("time-sensitive evidence requires full validation");
        }
        hash.update("file\0").update(createHash("sha256").update(content).digest()).update("\0");
      }
      else throw new Error("unsupported gate input");
    };
    // Includes workflow/baseline/claims, I13, command/freshness/source-root
    // declarations and current evidence bytes, including ignored control files.
    for (const path of ["aidlc", ".aidlc", "docs/aidlc", ...binding.files.map(file => file.path)].sort()) visit(path);
    const recorded = evidence.source_revision as { repos?: Record<string, unknown> } | undefined;
    const nested = Object.keys(recorded?.repos || {}).sort();
    for (const key of nested) {
      const path = resolve(root, key);
      if (!path.startsWith(`${resolve(root)}${sep}`)) return null;
    }
    hash.update(JSON.stringify({ context, evidence, environment: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
      heads: [currentHead(root), ...nested.map(key => currentHead(join(root, key)))], revision: readSourceRevision(root, undefined, nested) }));
    return `green-current-v1:${hash.digest("hex")}`;
  } catch { return null; } // Unsupported or unbounded inputs always run the full gate.
}
