/** Fault injection child: terminate at the canonical publication boundary. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { recoverCanonical } from "../core/tools/aidlc-document-slices";
import { loadWorkflowView } from "../core/tools/aidlc-workflow-layout";
const state = loadWorkflowView(process.cwd(), "shop")!;
fs.linkSync = (() => { process.kill(process.pid, "SIGKILL"); throw new Error("termination failed"); }) as typeof fs.linkSync;
syncBuiltinESMExports();
recoverCanonical({ root: process.cwd(), workflow_id: state.workflow_id, module_id: "shop", scope: state.scope, stage: "units-generation", ui_route: "not-selected" }, true);
