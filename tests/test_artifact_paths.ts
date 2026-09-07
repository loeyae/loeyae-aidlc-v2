import assert from "node:assert/strict";
import {
  isEvidenceArtifactLabel,
  normalizeArtifactLabel,
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
assert.equal(
  isEvidenceArtifactLabel("docs\\aidlc\\modules\\orders\\inception\\units.md"),
  false,
);
assert.equal(
  isEvidenceArtifactLabel(".aidlc\\evidence-copy\\units-generation\\result.json"),
  false,
);

console.log("Cross-platform artifact path tests passed");
