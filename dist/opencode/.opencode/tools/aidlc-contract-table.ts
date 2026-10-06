/**
 * Shared parsing rules for project-level contract tables
 * (docs/aidlc/ideation/product-contracts.md): the column headers and the module match
 * used by the orchestrator's shared-contract projection and dependency graph, and, in a
 * module context, by the contract-baseline checker (4.8.1) to keep only the rows of the
 * active module.
 */
import { type ModuleDescriptor } from "./aidlc-execution-context";

/** Contract id column: `契约 ID` / `contract` / `contract id`. */
export const CONTRACT_ID_COLUMN = /契约\s*ID|^contract(?:\s*id)?$/i;
/** Provider column: `提供方` / `provider`. */
export const CONTRACT_PROVIDER_COLUMN = /^(?:提供方|provider)$/i;
/** Consumer column: `消费者` / `消费方` / `consumer(s)`. */
export const CONTRACT_CONSUMER_COLUMN = /^(?:消费者|消费方|consumers?)$/i;

/**
 * The module a table cell names (4.8.1: no plain substring match):
 * 1. a module whose module_id, service_id or name equals the trimmed cell;
 * 2. otherwise a module whose module_id occurs in the cell as a whole token, bounded by
 *    the cell edges or by characters other than ASCII letters and digits (so `m10/unit`
 *    and `order-api` name m10 / order, while `m100`, `xm10y` and `orders` name nothing).
 *    When several module ids match, the longest wins (`order-ext/api` is order-ext, not
 *    order), then manifest order.
 * `excluded` (e.g. the provider when resolving its consumer) never matches.
 */
export function moduleForValue(modules: ModuleDescriptor[], value: string, excluded?: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const candidates = modules.filter((module) => module.module_id !== excluded);
  const exact = candidates.find((module) => normalized === module.module_id || normalized === module.service_id || normalized === module.name);
  if (exact) return exact.module_id;
  const token = (id: string): boolean => new RegExp(`(?:^|[^A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(normalized);
  const matches = candidates.filter((module) => token(module.module_id));
  return matches.reduce<ModuleDescriptor | undefined>((best, module) => (!best || module.module_id.length > best.module_id.length ? module : best), undefined)?.module_id;
}

export function contractTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export interface ModuleContractRows {
  /** Header lines of the tables that have at least one validated or reference row of the module. */
  headers: string[];
  /** Validated data rows: every row of a contract the module provides, and only the module's own rows of a contract it merely consumes. */
  rows: string[];
  /** Reference rows: the provider rows of contracts the module only consumes. They identify the owner and the consumed version and are hashed, but are not validated for unresolved markers. */
  references: string[];
  /** Headers, validated rows and reference rows in document order (the module's view of the table). */
  lines: string[];
  /** Provider cells of the module's contracts, owner first (the module's own provider rows). */
  providers: string[];
  /** Consumer cells of the validated rows (each cell split on , ， 、 /); for a consumed contract only the module itself. */
  consumers: string[];
}

/**
 * Rows of a contract table that belong to `moduleId`, across all tables of the document
 * that have a contract id column (lines outside such tables are not part of the result):
 * - a contract the module provides (provider column): every row of that contract, since
 *   the provider answers for all of its consumers;
 * - a contract the module only consumes (consumer column): only the rows whose consumer
 *   cell names the module are validated. The provider's row is kept as a reference row
 *   (owner, consumed version, hash) without being validated; the other consumers' rows
 *   are not part of the result.
 * `rows` is empty when no contract involves the module.
 */
export function contractTableRowsForModule(content: string, modules: ModuleDescriptor[], moduleId: string): ModuleContractRows {
  interface Row { table: number; line: string; id: string; provider?: string; consumers: string[] }
  const tables: string[] = [];
  const parsedRows: Row[] = [];
  let header: string[] | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      header = undefined;
      continue;
    }
    const cells = contractTableCells(line);
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    if (!header) {
      header = cells;
      tables.push(line.trim());
      continue;
    }
    const column = (pattern: RegExp): number => header!.findIndex((cell) => pattern.test(cell));
    const idIndex = column(CONTRACT_ID_COLUMN);
    const id = idIndex >= 0 ? cells[idIndex] || "" : "";
    if (!id || id === "-") continue;
    const providerIndex = column(CONTRACT_PROVIDER_COLUMN);
    const consumerIndex = column(CONTRACT_CONSUMER_COLUMN);
    parsedRows.push({
      table: tables.length - 1,
      line: line.trim(),
      id,
      ...(providerIndex >= 0 && cells[providerIndex] ? { provider: cells[providerIndex] } : {}),
      consumers: consumerIndex >= 0 ? (cells[consumerIndex] || "").split(/[,，、/]/).map((item) => item.trim()).filter(Boolean) : [],
    });
  }
  const involves = (value: string | undefined): boolean => Boolean(value) && moduleForValue(modules, value!) === moduleId;
  const provided = new Set(parsedRows.filter((row) => involves(row.provider)).map((row) => row.id));
  const consumed = new Set(parsedRows.filter((row) => !provided.has(row.id) && row.consumers.some(involves)).map((row) => row.id));
  const validated = parsedRows.filter((row) => provided.has(row.id) || (consumed.has(row.id) && row.consumers.some(involves)));
  const referenced = parsedRows.filter((row) => consumed.has(row.id) && row.provider && !row.consumers.some(involves));
  const included = new Set([...validated, ...referenced]);
  const lines: string[] = [];
  let lastTable = -1;
  for (const row of parsedRows) {
    if (!included.has(row)) continue;
    if (row.table !== lastTable) {
      lines.push(tables[row.table]);
      lastTable = row.table;
    }
    lines.push(row.line);
  }
  const providers = [...new Set([
    ...validated.filter((row) => provided.has(row.id) && involves(row.provider)).map((row) => row.provider!),
    ...[...validated, ...referenced].flatMap((row) => (row.provider ? [row.provider] : [])),
  ])];
  return {
    headers: [...new Set([...included].map((row) => row.table))].sort((a, b) => a - b).map((table) => tables[table]),
    rows: validated.map((row) => row.line),
    references: referenced.map((row) => row.line),
    lines,
    providers,
    consumers: [...new Set(validated.flatMap((row) => row.consumers.filter((consumer) => provided.has(row.id) || involves(consumer))))],
  };
}
