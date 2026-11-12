/** MARS-271: the unresolved-marker tokens themselves (待决类文字,含未加否定的 阻断). */
const UNRESOLVED_MARKER_PATTERN = /\b(?:TODO|FIXME|TBD|HACK|NotImplemented)\b|待确认|待定|未解决|未定义|(?<![不非无])阻断/i;
/** Section headings whose body is historical record, not an open decision (MARS-271). */
const HISTORICAL_SECTION_PATTERN = /历史|history|changelog|变更记录|决策记录|修订记录|审计记录|操作日志/i;

/**
 * MARS-271 marker taxonomy: a line carrying an unresolved-marker token is classified by
 * nature — `pending` (待决: an open decision the artifact still owes), `historical`
 * (历史记录: a dated/changelog/record entry or an explicitly resolved item) or `note`
 * (备注: a blockquote or annotated remark). Only `pending` participates in the
 * unresolved verdict; historical records and notes describe past events or annotations.
 */
function classifyUnresolvedLine(line: string, historicalSection: boolean): "pending" | "historical" | "note" | null {
  if (!UNRESOLVED_MARKER_PATTERN.test(line)) return null;
  if (historicalSection) return "historical";
  const body = line.trim().replace(/^\s*(?:[-*+]\s*)*/, "");
  // 引用块 / 备注行:备注性质。
  if (/^>/.test(line.trim()) || /^(?:备注|注\s*[:：]|note\s*[:：]|说明\s*[:：]|附注\s*[:：])/i.test(body)) return "note";
  // 日期前缀(changelog 条目)或显式历史标签:历史记录性质。
  if (/^(?:历史|history|changelog|变更记录|决策记录|修订记录|审计记录|记录)[:：\s]/i.test(body)) return "historical";
  if (/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/.test(body)) return "historical";
  // 已解决/已关闭的条目是历史,不是待决。
  if (/已解决|已关闭|已处理|\b(?:resolved|closed)\b/i.test(line)) return "historical";
  return "pending";
}

/** Pending-marker findings with position and classification, for a detailed failure message. */
export function unresolvedMarkerFindings(label: string, content: string): string[] {
  const findings: string[] = [];
  let historicalSection = false;
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (heading) historicalSection = HISTORICAL_SECTION_PATTERN.test(heading[1]);
    const kind = classifyUnresolvedLine(line, historicalSection);
    if (kind === "pending") findings.push(`${label}:${index + 1}: ${line.trim().slice(0, 60)} [待决]`);
  }
  return findings;
}

export function noUnresolved(value: string, label = "project artifact"): void {
  // 4.8.1: a negated 阻断 (不阻断 / 非阻断 / 无阻断) describes the absence of a blocker.
  // MARS-271: only 待决 markers fail; 历史/备注 markers are listed in the failure detail.
  const findings = unresolvedMarkerFindings(label, value);
  if (findings.length > 0) {
    const shown = findings.slice(0, 10).join("; ");
    throw new Error(`unresolved marker found in project artifact: ${shown}${findings.length > 10 ? ` (+${findings.length - 10} more pending markers)` : ""}`);
  }
}

