/** P1-08 read-only native convergence in the actual candidate checkout. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { projectAutonomyScope } from "./aidlc-autonomy";
import { loadWorkflowParts, mergeWorkflowView } from "./aidlc-workflow-layout";
import { loadWorkflowState } from "./aidlc-light-state";
import {
  loadGraph,
  makeInstance,
  runtimeInstance,
  checkSensors,
  checkHistoricalTddSensors,
  globalReviewRequired,
} from "./aidlc-orchestrate";
import { evidenceRelativePath } from "./aidlc-execution-context";
import { safeFile } from "./aidlc-autonomy-files";
import { observationHash } from "./aidlc-observation-inputs";
type Row = Record<string, any>;
export async function checkBatchNative(): Promise<Row> {
  const root = process.cwd(),
    scope = projectAutonomyScope(root),
    parts = loadWorkflowParts(root),
    global = loadWorkflowState(root)!,
    graph = loadGraph();
  const failures: Row[] = [],
    refs: Row[] = [],
    checked: Row[] = [];
  const verify = async (slug: string, module_id?: string, unit_id?: string) => {
    const node = graph.stages.find((s) => s.slug === slug);
    if (!node) throw Error("NATIVE_STAGE_UNAVAILABLE");
    const raw = makeInstance(node, node.axis, { module_id, unit_id });
    if (checked.some((r) => r.stage_instance === raw.instance_id)) return;
    const owner = parts.split
      ? mergeWorkflowView(parts.parts, module_id ? { kind: "module", module_id } : { kind: "integration" })
      : global;
    const instance = runtimeInstance(raw, owner);
    if (!owner.completed_stage_instances.includes(instance.instance_id))
      failures.push({
        stage_instance: instance.instance_id,
        sensor: "stage-completion",
        status: "incomplete",
        message: "required Native instance is not completed",
      });
    const errors =
      slug === "tdd"
        ? await checkHistoricalTddSensors(instance, owner)
        : await checkSensors(instance, owner, { tolerateRevisionDrift: true, allowDownstreamReportDrift: true });
    failures.push(...errors.map((e) => ({ ...e, stage_instance: instance.instance_id, status: "blocked" })));
    for (const sensor of instance.stage.sensors) {
      const path = evidenceRelativePath(slug, sensor, node.axis, { module_id, unit_id }).replace(/\\/g, "/");
      if (!existsSync(resolve(root, path))) continue;
      const bytes = readFileSync(safeFile(root, path));
      refs.push({
        path,
        digest: observationHash(bytes),
        sensor,
        stage_instance: instance.instance_id,
        workflow_id: owner.workflow_id,
      });
    }
    checked.push({
      stage_instance: instance.instance_id,
      workflow_id: owner.workflow_id,
      sensors: instance.stage.sensors,
      status: errors.length
        ? "blocked"
        : owner.completed_stage_instances.includes(instance.instance_id)
          ? "passed"
          : "incomplete",
    });
  };
  for (const u of scope.units!.filter((u) => u.role === "implement")) {
    const { module_id, unit_id } = u.unit_ref;
    await verify("test-case-derivation", module_id);
    await verify("tdd", module_id, unit_id);
    await verify("code-generation", module_id, unit_id);
    await verify("code-review", module_id, unit_id);
  }
  for (const module of new Set(scope.ui_refs!.map((r: any) => /\/modules\/([^/]+)\//.exec(r.path)?.[1]))) {
    if (!module) {
      failures.push({ status: "blocked", sensor: "ui-choice", message: "UI page has no owning module" });
      continue;
    }
    const owner = parts.split ? mergeWorkflowView(parts.parts, { kind: "module", module_id: module }) : global;
    const choice = [...owner.history]
      .reverse()
      .find((h) => h.stage === "ui-mock" && (!h.module_id || h.module_id === module))?.user_input;
    if (!["html-mock", "figma-create", "figma-existing"].includes(String(choice))) {
      failures.push({
        status: "blocked",
        sensor: "ui-choice",
        message: "Required UI lacks its Native design choice and full acceptance",
      });
      continue;
    }
    await verify("ui-page-planning", module);
    await verify(choice === "html-mock" ? "ui-mock-generation" : "ui-figma-generation", module);
    const covered = new Set<string>();
    for (const u of scope.units!.filter((u) => u.unit_ref.module_id === module)) {
      const path = evidenceRelativePath("code-review", "ui-design-alignment", "unit", u.unit_ref).replace(/\\/g, "/");
      if (!existsSync(resolve(root, path))) continue;
      const raw = makeInstance(graph.stages.find((s) => s.slug === "code-review")!, "unit", u.unit_ref),
        instance = runtimeInstance(raw, owner);
      const errors = await checkSensors(instance, owner, {
        onlySensors: ["ui-design-alignment"],
        tolerateRevisionDrift: true,
      });
      if (errors.length) {
        failures.push(...errors.map((e) => ({ ...e, status: "blocked", stage_instance: instance.instance_id })));
        continue;
      }
      const proof = JSON.parse(readFileSync(safeFile(root, path), "utf8"));
      if (proof.status === "passed") for (const p of proof.pages_covered || []) covered.add(p);
      if (!refs.some((r) => r.path === path))
        refs.push({
          path,
          digest: observationHash(readFileSync(safeFile(root, path))),
          sensor: "ui-design-alignment",
          stage_instance: instance.instance_id,
          workflow_id: owner.workflow_id,
        });
    }
    for (const page of scope.ui_refs!.filter((r: any) => r.path.includes(`/modules/${module}/`)))
      if (!covered.has(String(page.item_id)))
        failures.push({
          status: "blocked",
          sensor: "ui-design-alignment",
          message: "Selected UI page has no current Native alignment: " + page.item_id,
        });
  }
  const aggregate = parts.split ? mergeWorkflowView(parts.parts, { kind: "integration" }) : global;
  await verify("build-and-test");
  return {
    status: failures.length ? "blocked" : "passed",
    failures,
    refs,
    checked,
    global_review_required: globalReviewRequired(aggregate),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await checkBatchNative()));
  } catch (e) {
    console.error(String(e));
    process.exitCode = 2;
  }
}
