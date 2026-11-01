import { basename } from "node:path";
import { documentLineDefinition, markdownSourceLines } from "./aidlc-document-parser";
import type { UnitDescriptor } from "./aidlc-execution-context";

const SOURCE_ID = "(?:REQ-[A-Z0-9][A-Z0-9_-]*|STORY-[A-Z0-9][A-Z0-9_-]*|US-[A-Z0-9][A-Z0-9_-]*|NFR-[A-Z0-9][A-Z0-9_-]*|CR-[A-Z0-9][A-Z0-9_-]*)";
export const SOURCE_ID_PATTERN = new RegExp(`\\b${SOURCE_ID}\\b`, "g");

/** Definitions create coverage obligations; incidental prose references do not. */
export function i13SourceDefinitions(artifacts: Array<{ path: string; content: string }>): string[] {
  const definitions = new Set<string>();
  for (const artifact of artifacts) {
    const scanned = markdownSourceLines(artifact.content);
    if (scanned.unclosedFence) throw new Error(`I13_SOURCE_FORMAT: unclosed Markdown fence in ${artifact.path}`);
    const local = new Set<string>();
    const visible: string[] = [];
    let tableIdColumn = -1;
    for (const line of scanned.lines) {
      if (line.opaque) continue;
      visible.push(line.text);
      const cells = /^\s*\|/.test(line.text) ? line.text.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim().replace(/\*\*|`/g, "")) : undefined;
      if (!cells) tableIdColumn = -1;
      else {
        const headerId = cells.findIndex(cell => /^(?:(?:需求|故事|requirement|story|req)[ _-]*)?(?:id|编号|标识)$/i.test(cell));
        if (headerId >= 0) tableIdColumn = headerId;
      }
      const common = documentLineDefinition(line.text);
      const candidate = cells && tableIdColumn >= 0 && new RegExp(`^${SOURCE_ID}$`).test(cells[tableIdColumn] || "") ? cells[tableIdColumn]
        : common && common.kind !== "ac" ? common.id
        // Legacy plain ID lines, Markdown definitions, table ID cells, and explicit id fields.
        : new RegExp(`^\\s*(?:(?:#{1,6}|[-*+]|\\d+[.)])\\s+|\\|\\s*)?(?:\\*\\*|\x60)?(${SOURCE_ID})\\b`).exec(line.text)?.[1]
          ?? new RegExp(`^\\s*(?:[-*+]\\s*)?(?:id|source_id|requirement_id|story_id)\\s*:\\s*["']?(${SOURCE_ID})\\b`, "i").exec(line.text)?.[1];
      if (candidate) { local.add(candidate); definitions.add(candidate); }
      else if (cells && new RegExp(`\\b${SOURCE_ID}\\b`).test(line.text)) {
        throw new Error(`I13_SOURCE_FORMAT: ambiguous source table at ${artifact.path}:${line.line}; use an explicit ID column or put the defining source ID in the first column.`);
      }
      else if (/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/.test(line.text) && new RegExp(`\\b${SOURCE_ID}\\b`).test(line.text)
        && !/^\s*(?:[-*+]\s*)?(?:\*\*)?(?:来源|需求来源|Sources?|Requirements?|References?)\s*(?:\*\*)?\s*[:：]/i.test(line.text)) {
        throw new Error(`I13_SOURCE_FORMAT: ambiguous source heading/list at ${artifact.path}:${line.line}; put its defining source ID first, or express a provenance reference with a Sources: field. Do not add a UC-D merely to satisfy an incidental reference.`);
      }
    }
    // Unstructured legacy primary artifacts must be made explicit, not silently
    // emptied. Once definitions exist, other occurrences are provenance references.
    const ownPattern = basename(artifact.path) === "requirements.md" ? /\bREQ-[A-Z0-9][A-Z0-9_-]*\b/g
      : basename(artifact.path) === "user-stories.md" ? /\b(?:STORY|US)-[A-Z0-9][A-Z0-9_-]*\b/g : undefined;
    const ownIds = ownPattern ? [...new Set(visible.join("\n").match(ownPattern) || [])] : [];
    if (ownIds.length > 0 && !ownIds.some(id => local.has(id))) {
      throw new Error(`I13_SOURCE_FORMAT: ${artifact.path} contains source identifiers (${ownIds.join(", ")}) but no recognizable definitions; use an ID-leading heading/list/line, a table ID column, or an explicit id: field. Prose references alone do not define I13 scope.`);
    }
  }
  return [...definitions].sort();
}

/** Infer only complete, unique REQ ownership. Cross-unit or non-REQ provenance needs explicit unit_refs. */
export function inferUcdUnitOwnership(sources: Map<string, string[]>, units: UnitDescriptor[], sourceDefinitions: string[]): Record<string, string[]> {
  const knownSources = new Set(sourceDefinitions);
  const inferred: Record<string, string[]> = {};
  const ambiguous: string[] = [];
  for (const [id, refs] of sources) {
    const owners = refs.map(ref => units.filter(unit => unit.req_refs?.includes(ref)).map(unit => unit.unit_id));
    if (!refs.length || refs.some(ref => !/^REQ-/.test(ref) || !knownSources.has(ref))
      || owners.some(candidates => candidates.length !== 1) || new Set(owners.flat()).size !== 1) {
      ambiguous.push(`${id} (source_ref: ${refs.join(", ") || "missing"}) needs explicit unit_refs; its source requirements do not identify one approved unit`);
    } else inferred[id] = [owners[0][0]];
  }
  if (ambiguous.length) throw new Error(`I13_UNIT_OWNERSHIP: ${ambiguous.join("; ")}. Resolve unit-manifest req_refs or declare unit_refs for every active UC-D before TDD; do not map the whole module in every unit.`);
  return inferred;
}

/** Legacy source annotations are indexed once per file, never once per UC-D/file pair. */
export function indexedTestMappings(files: string[], read: (file: string) => string): Map<string, string[]> {
  const mapping = new Map<string, string[]>();
  for (const file of files) {
    for (const id of new Set(read(file).match(/\bUC-D-\d+\b/g) || [])) {
      const matches = mapping.get(id) ?? [];
      matches.push(file); mapping.set(id, matches);
    }
  }
  return mapping;
}
