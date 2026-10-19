/** Counts from a complete test report, never inferred from process success. */
export interface TestStats { total: number; passed: number; failed: number; skipped: number }

export function validTestStats(value: unknown): value is TestStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as TestStats;
  return [stats.total, stats.passed, stats.failed, stats.skipped].every(n => Number.isSafeInteger(n) && n >= 0)
    && stats.total === stats.passed + stats.failed + stats.skipped;
}

/** Node's TAP reporter has one unindented final summary. Nested plans/results
 * belong to suites and must not be added to these leaf counts a second time.
 * Unknown/truncated TAP fails closed, without falling back to prose counters.
 */
export function parseTestStats(output: string): TestStats | null {
  const lines = output.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines.some(line => /^(?:TAP version|# (?:tests|pass|fail)\b|1\.\.)/.test(line))) {
    if (lines.some(line => /^\s*Bail out!/i.test(line))) return null;
    if (lines.filter(line => line === "TAP version 13").length !== 1) return null;
    const plans = lines.filter(line => /^1\.\.\d+$/.test(line));
    if (plans.length !== 1) return null;
    const points = lines.filter(line => /^(?:not )?ok \d+(?:\s|$)/.test(line));
    const planned = Number(plans[0].slice(3));
    if (points.length !== planned || points.some((line, i) => Number(line.match(/^(?:not )?ok (\d+)/)![1]) !== i + 1)) return null;
    const keys = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];
    const counts: Record<string, number> = {};
    for (const key of keys) {
      const matches = lines.filter(line => line.startsWith(`# ${key} `));
      if (matches.length !== 1 || !new RegExp(`^# ${key} \\d+$`).test(matches[0])) return null;
      counts[key] = Number(matches[0].slice(key.length + 3));
      if (!Number.isSafeInteger(counts[key])) return null;
    }
    // Node emits one result for every test and suite, at its nesting indentation.
    // Reconcile the summary without turning suite parents into successful tests.
    const allPoints = lines.filter(line => /^\s*(?:not )?ok \d+(?:\s|$)/.test(line));
    if (allPoints.length !== counts.tests + counts.suites) return null;
    const results = lines.flatMap((line, index) => {
      const match = /^(\s*)(?:not )?ok \d+(?:\s|$)/.exec(line);
      if (!match) return [];
      const indent = match[1] + "  ";
      let type: string | undefined;
      if (lines[index + 1] === `${indent}---`) {
        for (let i = index + 2; i < lines.length && lines[i] !== `${indent}...`; i++) {
          if (!lines[i].startsWith(indent)) break;
          const label = lines[i].slice(indent.length).match(/^type: '(test|suite)'$/);
          if (label) type = label[1];
        }
      }
      return [{ line: line.trimStart(), type }];
    });
    // Recent Node versions label suite diagnostics. Older versions without any
    // labels still reconcile the leaf total; suite-free reports need no labels.
    if (results.some(result => result.type) || counts.suites === 0) {
      if (results.filter(result => result.type === "suite").length !== counts.suites) return null;
      const leaf = results.filter(result => result.type !== "suite");
      const skipped = leaf.filter(result => /# SKIP\b/.test(result.line)).length;
      const todo = leaf.filter(result => /# TODO\b/.test(result.line)).length;
      const failed = leaf.filter(result => /^not ok /.test(result.line) && !/# (?:SKIP|TODO)\b/.test(result.line)).length;
      if (counts.skipped !== skipped || counts.todo !== todo || counts.fail + counts.cancelled !== failed || counts.pass !== leaf.length - skipped - todo - failed) return null;
    }
    const start = lines.indexOf(`# tests ${counts.tests}`);
    if (lines.indexOf(plans[0]) >= start || keys.some((key, i) => lines[start + i] !== `# ${key} ${counts[key]}`)
      || !/^# duration_ms \d+(?:\.\d+)?$/.test(lines[start + keys.length] ?? "") || start + keys.length + 1 !== lines.length) return null;
    // A failed suite/root cannot be hidden by a contradictory successful summary.
    if (!counts.fail && !counts.cancelled && points.some(line => /^not ok /.test(line) && !/# TODO\b/.test(line))) return null;
    const stats = { total: counts.tests, passed: counts.pass, failed: counts.fail + counts.cancelled, skipped: counts.skipped + counts.todo };
    return validTestStats(stats) ? stats : null;
  }
  // Keep the existing numeric framework summaries; a bare word "passed" is not evidence.
  const count = (label: string) => [...output.matchAll(new RegExp(`(?:^|[^\\d])(\\d+)\\s+(?:tests?\\s+)?${label}\\b`, "gi"))].reduce((sum, match) => sum + Number(match[1]), 0);
  const passed = count("passed"), failed = count("failed"), skipped = count("skipped");
  if (!passed && !failed && !skipped) return null;
  const explicitTotal = output.match(/(?:tests?\s*[:=]|total\s*[:=])\s*(\d+)/i);
  const stats = { total: explicitTotal ? Number(explicitTotal[1]) : passed + failed + skipped, passed, failed, skipped };
  return validTestStats(stats) ? stats : null;
}
