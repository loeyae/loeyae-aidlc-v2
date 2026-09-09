import { realpathSync } from "fs";
import {
  migrateWorkflowStateFileV2ToV3,
  migrateWorkflowStateV2ToV3,
  repairableLegacyStateFromV3Migration,
  repairWorkflowStateFileV3Migration,
  type V2MigrationIdentity,
} from "./aidlc-state-v3";
import { dependencyInstances, expandStageInstances, loadGraph } from "./aidlc-orchestrate";
import { loadWorkflowState, type WorkflowState } from "./aidlc-state";
import { loadWorkflowStateV3 } from "./aidlc-state-v3-store";

interface Options {
  apply: boolean;
  repair: boolean;
  identity: V2MigrationIdentity;
}

function parse(args: string[]): Options {
  const values: Record<string, string> = {};
  let apply = false;
  let repair = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      if (apply) throw new Error("duplicate --apply");
      apply = true;
      continue;
    }
    if (argument === "--repair") {
      if (repair) throw new Error("duplicate --repair");
      repair = true;
      continue;
    }
    if (!["--actor-id", "--device-id", "--client-id"].includes(argument)) {
      throw new Error(`unknown migration option: ${argument}`);
    }
    if (values[argument]) throw new Error(`duplicate migration option: ${argument}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values[argument] = value;
  }
  for (const flag of ["--actor-id", "--device-id", "--client-id"]) {
    if (!values[flag]) throw new Error(`state migrate-v3 requires ${flag} <id>`);
  }
  return {
    apply,
    repair,
    identity: {
      actor_id: values["--actor-id"],
      device_id: values["--device-id"],
      client_id: values["--client-id"],
    },
  };
}

function instanceRequires(source: WorkflowState): Record<string, string[]> {
  const instances = expandStageInstances(loadGraph(), source);
  return Object.fromEntries(instances.map((instance) => {
    const requires = new Set<string>();
    for (const dependency of instance.stage.requires || []) {
      const candidates = dependencyInstances(instance, dependency, instances);
      if (candidates.length === 0) {
        if (!instance.stage.scope_waived_requires.includes(dependency)) {
          throw new Error(`stage instance ${instance.instance_id} has unavailable required dependency ${dependency}`);
        }
        continue;
      }
      for (const candidate of candidates) requires.add(candidate.instance_id);
    }
    return [instance.instance_id, [...requires]];
  }));
}

function main(): void {
  const options = parse(process.argv.slice(2));
  const projectRoot = realpathSync(process.cwd());
  const occurredAt = new Date().toISOString();
  let sourceSchemaVersion: 2 | 3;
  let sourceRevision: number;
  let activeStageInstance: string | null;
  let migrated;

  if (options.repair) {
    const source = loadWorkflowStateV3(projectRoot);
    if (!source) throw new Error("no schema v3 workflow state found to repair");
    const legacy = repairableLegacyStateFromV3Migration(source);
    const migrationOptions = {
      identity: options.identity,
      occurred_at: occurredAt,
      require_feature_flag: false,
      instance_requires: instanceRequires(legacy),
    };
    migrated = options.apply
      ? repairWorkflowStateFileV3Migration(projectRoot, migrationOptions)
      : migrateWorkflowStateV2ToV3(legacy, migrationOptions);
    sourceSchemaVersion = 3;
    sourceRevision = source.revision;
    activeStageInstance = source.current_stage_instance || source.current_stage || null;
  } else {
    const source = loadWorkflowState(projectRoot);
    if (!source) throw new Error("no schema v2 workflow state found to migrate");
    const migrationOptions = {
      identity: options.identity,
      occurred_at: occurredAt,
      require_feature_flag: false,
      instance_requires: instanceRequires(source),
    };
    migrated = options.apply
      ? migrateWorkflowStateFileV2ToV3(projectRoot, migrationOptions)
      : migrateWorkflowStateV2ToV3(source, migrationOptions);
    sourceSchemaVersion = 2;
    sourceRevision = source.revision;
    activeStageInstance = source.current_stage_instance || source.current_stage || null;
  }

  const appliedMessage = options.repair
    ? "Schema v3 migration repair committed atomically."
    : "Schema v3 migration committed atomically.";
  const dryRunMessage = options.repair
    ? "Dry run only; rerun with --repair --apply after reviewing this repair plan."
    : "Dry run only; rerun with --apply after reviewing this plan.";
  process.stdout.write(`${JSON.stringify({
    kind: options.repair
      ? (options.apply ? "state-v3-migration-repair-applied" : "state-v3-migration-repair-plan")
      : (options.apply ? "state-v3-migration-applied" : "state-v3-migration-plan"),
    applied: options.apply,
    repair: options.repair,
    workflow_id: migrated.workflow_id,
    source_schema_version: sourceSchemaVersion,
    target_schema_version: 3,
    source_revision: sourceRevision,
    target_revision: migrated.revision,
    active_stage_instance: activeStageInstance,
    compatibility_holder: activeStageInstance ? options.identity : null,
    event_count: migrated.events.length,
    message: options.apply ? appliedMessage : dryRunMessage,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exit(2);
}
