/**
 * I13 executable-behavior keywords.
 *
 * `\b` is an ASCII word boundary (even with the `u` flag), so it only guards the
 * English keywords (e.g. rejects `myAPI`). Chinese keywords sit outside `\b`;
 * otherwise a keyword preceded by Chinese text, Chinese punctuation, a space or
 * the start of a line never matches. English branches keep their original
 * left-boundary-only behavior (`APIs`, `endpoints`, `Scenarios` still match).
 */
export const EXECUTABLE_BEHAVIOR = /(?:\b(?:Given|When|Then|Scenario|API|endpoint|service method)|接口|业务行为|业务规则|状态转换|验收|可执行)/i;

export function hasExecutableBehavior(content: string): boolean {
  return EXECUTABLE_BEHAVIOR.test(content);
}
