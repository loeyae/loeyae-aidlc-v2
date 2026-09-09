import { realpathSync } from "fs";
import {
  migrateWorkflowStateFileV2ToV3,
  migrateWorkflowStateV2ToV3,
  type V2MigrationIdentity,
} from "./aidlc-state-v3";
import { loadWorkflowState } from "./aidlc-state";

interface Options {
  apply: boolean;
  identity: V2MigrationIdentity;
}

function parse(args: string[]): Options {
  const values: Record<string, string> = {};
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      if (apply) throw new Error("duplicate --apply");
      apply = true;
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
    identity: {
      actor_id: values["--actor-id"],
      device_id: values["--device-id"],
      client_id: values["--client-id"],
    },
  };
}

function main(): void {
  const options = parse(process.argv.slice(2));
  const projectRoot = realpathSync(process.cwd());
  const source = loadWorkflowState(projectRoot);
  if (!source) throw new Error("no schema v2 workflow state found to migrate");
  const occurredAt = new Date().toISOString();
  const migrationOptions = {
    identity: options.identity,
    occurred_at: occurredAt,
    require_feature_flag: false,
  };
  const migrated = options.apply
    ? migrateWorkflowStateFileV2ToV3(projectRoot, migrationOptions)
    : migrateWorkflowStateV2ToV3(source, migrationOptions);
  process.stdout.write(`${JSON.stringify({
    kind: options.apply ? "state-v3-migration-applied" : "state-v3-migration-plan",
    applied: options.apply,
    workflow_id: migrated.workflow_id,
    source_schema_version: 2,
    target_schema_version: 3,
    source_revision: source.revision,
    target_revision: migrated.revision,
    active_stage_instance: source.current_stage_instance || source.current_stage || null,
    compatibility_holder: source.current_stage || source.current_stage_instance ? options.identity : null,
    event_count: migrated.events.length,
    message: options.apply
      ? "Schema v3 migration committed atomically."
      : "Dry run only; rerun with --apply after reviewing this plan.",
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
