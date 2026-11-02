import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
export const integrationOwners = {
  test_loeyae_boot_selector: "loeyae-boot",
  test_external_provider_knowledge: "loeyae-boot-knowledge", test_module_knowledge: "technical-knowledge",
  test_context_source: "ssot-readonly", test_design_resource: "design-resource",
  test_figma_existing: "figma-existing", test_figma_create: "figma-create",
  test_diagram_visual_provider: "diagram-visual", test_diagram_visual_chain: "diagram-visual",
  test_document_export_provider: "document-render", test_docx_provider: "document-render",
  test_tech_extraction: "technical-knowledge",
};
export function loadIntegrationProviders(file) {
  const value = JSON.parse(readFileSync(resolve(file), "utf8"));
  assert(value.schema === "aidlc.integration-providers/v1" && value.providers && typeof value.providers === "object" && !Array.isArray(value.providers), "invalid integration Provider registry");
  const providers = {};
  for (const [name, entry] of Object.entries(value.providers)) {
    assert(Object.values(integrationOwners).includes(name), `unknown integration Provider ${name}`);
    assert(entry && typeof entry.source === "string" && entry.source && /^[a-f0-9]{40}$/.test(entry.revision) && typeof entry.checkout === "string", `invalid pinned Provider ${name}`);
    const checkout = realpathSync(resolve(entry.checkout));
    const git = (...args) => { const r = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
    assert.equal(git("rev-parse", "--show-toplevel").replaceAll("\\", "/").toLowerCase(), checkout.replaceAll("\\", "/").toLowerCase(), `${name}: checkout must be the repository root`);
    assert.equal(git("rev-parse", "HEAD"), entry.revision, `${name}: checkout revision differs`);
    assert.equal(git("status", "--porcelain", "--untracked-files=no"), "", `${name}: checkout is dirty`);
    providers[name] = { source: entry.source, revision: entry.revision, checkout };
  }
  return providers;
}
