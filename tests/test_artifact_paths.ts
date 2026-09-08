import assert from "node:assert/strict";
import {
  isEvidenceArtifactLabel,
  normalizeArtifactLabel,
  portableDirname,
} from "../core/tools/aidlc-execution-context";

const windowsEvidence = ".aidlc\\evidence\\units-generation\\orders\\design-intent-coverage.json";

assert.equal(
  normalizeArtifactLabel(windowsEvidence),
  ".aidlc/evidence/units-generation/orders/design-intent-coverage.json",
);
assert.equal(isEvidenceArtifactLabel(windowsEvidence), true);
assert.equal(
  isEvidenceArtifactLabel(".aidlc/evidence/units-generation/orders/design-intent-coverage.json"),
  true,
);
assert.equal(
  isEvidenceArtifactLabel(".aidlc\\evidence/units-generation\\orders/design-intent-coverage.json"),
  true,
);
for (const evidence of [
  ".aidlc\\evidence\\requirements-methods\\orders\\diagram-contract.json",
  ".aidlc\\evidence\\units-generation\\orders\\design-intent-coverage.json",
  ".aidlc\\evidence\\cross-validation\\orders\\inception-consistency.json",
]) {
  assert.equal(isEvidenceArtifactLabel(evidence), true);
}
assert.equal(
  isEvidenceArtifactLabel("docs\\aidlc\\modules\\orders\\inception\\units.md"),
  false,
);
assert.equal(
  isEvidenceArtifactLabel(".aidlc\\evidence-copy\\units-generation\\result.json"),
  false,
);

assert.equal(
  portableDirname("C:\\repo\\docs\\aidlc\\modules\\orders\\inception\\sso-business-flows.diagram.json"),
  "C:\\repo\\docs\\aidlc\\modules\\orders\\inception",
);
assert.equal(
  portableDirname("/repo/docs/aidlc/modules/orders/inception/sso-business-flows.diagram.json"),
  "/repo/docs/aidlc/modules/orders/inception",
);
assert.equal(
  portableDirname("C:\\repo/docs\\aidlc/modules\\orders\\sso-business-flows.diagram.json"),
  "C:\\repo/docs\\aidlc/modules\\orders",
);
assert.equal(portableDirname("sso-business-flows.diagram.json"), ".");

console.log("Cross-platform artifact path tests passed");
