import assert from "node:assert/strict";
import { bindSession, claimToken } from "../core/tools/aidlc-session";
import { fixture, write, cli } from "./mars244_fixture";

const f = fixture("code-review@module:shop@unit:api");
const binding = JSON.stringify(
  bindSession(f.root, {
    instance: "code-review@module:shop@unit:api",
    owner: "auditor",
    session: "review-paths",
    expected: claimToken(undefined),
  }).binding,
);
const paths = ["src/shop/api/code.ts", "src/shop/api/with space.ts", "src/shop/api/业务.ts"];
paths.slice(1).forEach((path) => write(f.root, path, "export const value = 1;\n"));
const header =
  "# Review\nreviewer: auditor\nSpec result: passed\nStandards result: passed\nissues_found: 0\nissues_resolved: 0\nissues_open: 0\n";
const run = (body: string) => {
  write(f.root, "docs/aidlc/modules/shop/construction/api/code-review.md", header + body);
  return cli(
    f.root,
    ["evidence", "run", "--stage", "code-review", "--module", "shop", "--unit", "api", "--sensor", "review-evidence"],
    binding,
  );
};
for (const body of [
  "files_reviewed: " + JSON.stringify(paths) + "\n",
  "Reviewed files:\n" + paths.map((path) => "- `" + path + "`").join("\n") + "\n",
]) {
  const result = run(body);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
for (const paths of [["../escape.ts"], ["/outside/file.ts"], ["src/shop/api/missing.ts"], ["src/shop/api/code.ts"]]) {
  const result = run("files_reviewed: " + JSON.stringify(paths) + "\n");
  assert.notEqual(result.status, 0, "invalid or incomplete inventory must fail");
}
assert.notEqual(
  run("files_reviewed: [broken JSON\n").status,
  0,
  "malformed explicit inventory cannot fall back to prose",
);
assert.notEqual(
  run("Reviewed files: " + paths.map((path) => "`" + path + "`").join(" ") + "\nfiles_reviewed:\n").status,
  0,
  "an empty explicit declaration cannot fall back to complete prose",
);
console.log("PASS RA-04: Unicode/space paths, structured and quoted lists, boundary and omission rejection");
