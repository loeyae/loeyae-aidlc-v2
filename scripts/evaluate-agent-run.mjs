import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const pack = JSON.parse(readFileSync(new URL("../docs/evals/agent-task-pack.json", import.meta.url), "utf8"));
const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/evaluate-agent-run.mjs <run.json> (real host observations and local raw evidence)");
  process.exit(2);
}
const input = resolve(path), run = JSON.parse(readFileSync(input, "utf8"));
const failures = [];
for (const field of ["host", "model", "started_at", "finished_at"]) if (typeof run[field] !== "string" || !run[field].trim()) failures.push(`missing ${field}`);
if (!Number.isFinite(Date.parse(run.started_at)) || !Number.isFinite(Date.parse(run.finished_at)) || Date.parse(run.finished_at) < Date.parse(run.started_at)) failures.push("invalid run time range");
const records = Array.isArray(run.tasks) ? run.tasks : [];
if (new Set(records.map(task => task.id)).size !== records.length) failures.push("duplicate task records");
const localEvidence = path => typeof path === "string" && existsSync(resolve(dirname(input), path));
const tasks = pack.tasks.map(task => {
  const record = records.find(record => record.id === task.id);
  if (!record) return { id: task.id, status: "not_evaluated" };
  const errors = [];
  if (!localEvidence(record.transcript)) errors.push("missing raw host transcript");
  for (const field of ["interventions", "tool_calls", "false_passes"]) if (!Number.isSafeInteger(record[field]) || record[field] < 0) errors.push(`invalid ${field}`);
  if (record.false_passes !== 0) errors.push("observed false pass");
  for (const criterion of task.criteria) {
    const observation = record.observations?.find(item => item.criterion === criterion);
    if (observation?.passed !== true || !observation.evidence?.length || !observation.evidence.every(localEvidence)) errors.push(`unverified ${criterion}`);
  }
  return { id: task.id, status: errors.length ? "failed" : "recorded_pass", errors };
});
const report = { authority: "host_observation_record_only", note: "Records submitted observations and checks evidence availability; it does not execute an agent or prove transcript assertions.", tasks, errors: failures };
console.log(JSON.stringify(report, null, 2));
if (failures.length || tasks.some(task => task.status !== "recorded_pass")) process.exitCode = 1;
