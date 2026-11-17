import { posix } from "node:path";

/** Assemble build-time and native-install entries from the same rule source. */
export function renderSkillEntry(template: string, executionRules: string, rootPrefix = ""): string {
  if (template.split("{{execution}}").length !== 2) {
    throw new Error("Skill entry must include the shared execution rules exactly once");
  }
  const execution = executionRules.trim().replace(/^# /gm, "## ")
    .replace(/\]\(([^)]+)\)/g, (link, target: string) =>
      /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)
        ? link
        : `](${posix.normalize(`${rootPrefix}knowledge/protocols/${target}`)})`);
  return template.replace("{{execution}}", execution).replaceAll("{{root}}", rootPrefix);
}
