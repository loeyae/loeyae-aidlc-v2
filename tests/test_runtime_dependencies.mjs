import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url),
  semver = require("semver");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
assert.equal(lock.packages[""].engines.node, pkg.engines.node);
for (const name of Object.keys(pkg.dependencies)) {
  let manifest;
  try {
    manifest = require.resolve(name + "/package.json");
  } catch {
    let directory = dirname(require.resolve(name));
    for (;;) {
      const file = join(directory, "package.json");
      try {
        if (JSON.parse(readFileSync(file, "utf8")).name === name) {
          manifest = file;
          break;
        }
      } catch {}
      if (dirname(directory) === directory) throw new Error(`package metadata unavailable: ${name}`);
      directory = dirname(directory);
    }
  }
  const dependency = JSON.parse(readFileSync(manifest, "utf8"));
  if (dependency.engines?.node)
    assert(
      semver.subset(pkg.engines.node, dependency.engines.node),
      `${name}: project support ${pkg.engines.node} exceeds dependency ${dependency.engines.node}`,
    );
}
assert(semver.satisfies(process.version, pkg.engines.node));
const { HtmlValidate } = require("html-validate");
assert.equal(
  new HtmlValidate({ extends: ["html-validate:recommended"] }).validateStringSync(
    '<!DOCTYPE html><html lang="en"><head><title>Smoke</title></head><body><button type="button">OK</button></body></html>',
  ).valid,
  true,
);
const MarkdownIt = require("markdown-it");
assert.match(new MarkdownIt().render("# Runtime smoke"), /<h1>Runtime smoke<\/h1>/);
console.log(
  `PASS RA-03/05: actual runtime ${process.version}, declared dependency engines, HTML and Markdown execution`,
);
