/** Test setup adapter: production writers always receive an explicit fixture claim.
 * Stale/no-binding behavior is tested separately in test_mars244_writes.ts. */
import * as ui from "../core/tools/aidlc-ui-governance";
import * as slices from "../core/tools/aidlc-document-slices";
import { loadWorkflowState } from "../core/tools/aidlc-light-state";
import { fixtureEnvironment } from "./mars243_fixture_session";
function bound<T>(root: string, work: () => T): T {
  const original = process.env.AIDLC_SESSION_BINDING;
  const state = loadWorkflowState(root);
  if (state) process.env.AIDLC_SESSION_BINDING = fixtureEnvironment(root, ["evidence", "run"]).AIDLC_SESSION_BINDING;
  try { return work(); } finally {
    if (original === undefined) delete process.env.AIDLC_SESSION_BINDING; else process.env.AIDLC_SESSION_BINDING = original;
  }
}
export const createUiGenerationLock: typeof ui.createUiGenerationLock = (r,o) => bound(r, () => ui.createUiGenerationLock(r,o));
export const createUiGenerationAcceptance: typeof ui.createUiGenerationAcceptance = (r,o) => bound(r, () => ui.createUiGenerationAcceptance(r,o));
export const refreshUiGenerationFreshness: typeof ui.refreshUiGenerationFreshness = (r,o) => bound(r, () => ui.refreshUiGenerationFreshness(r,o));
export const reverifyUiGenerationFreshness: typeof ui.reverifyUiGenerationFreshness = (r,o) => bound(r, () => ui.reverifyUiGenerationFreshness(r,o));
export const rebaselineUiDesignResource: typeof ui.rebaselineUiDesignResource = (r,m) => bound(r, () => ui.rebaselineUiDesignResource(r,m));
export const generateSlices: typeof slices.generateSlices = ctx => bound(ctx.root, () => slices.generateSlices(ctx));
export const recoverCanonical: typeof slices.recoverCanonical = (ctx, apply) => apply ? bound(ctx.root, () => slices.recoverCanonical(ctx, apply)) : slices.recoverCanonical(ctx, apply);
