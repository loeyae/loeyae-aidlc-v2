import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as trust from "../core/tools/aidlc-trust";

// REG-WIN-ENROLLMENT-001: Windows drive-letter casing must not change project enrollment identity.
const normalizeProjectIdentityRoot = (trust as unknown as {
  normalizeProjectIdentityRoot?: (root: string, platform?: NodeJS.Platform) => string;
}).normalizeProjectIdentityRoot;

assert.equal(typeof normalizeProjectIdentityRoot, "function");
if (normalizeProjectIdentityRoot) {
  const lowerDrive = "e:\\Work\\repo\\node";
  const upperDrive = "E:\\Work\\repo\\node";
  const mixedPath = "e:\\Work\\Repo\\Node";

  assert.equal(normalizeProjectIdentityRoot(lowerDrive, "win32"), upperDrive);
  assert.equal(normalizeProjectIdentityRoot(upperDrive, "win32"), upperDrive);
  assert.equal(normalizeProjectIdentityRoot(mixedPath, "win32"), "E:\\Work\\Repo\\Node");
  assert.equal(normalizeProjectIdentityRoot("e:/Work/repo/node", "win32"), "E:/Work/repo/node");
  assert.equal(normalizeProjectIdentityRoot("\\\\server\\share\\repo", "win32"), "\\\\server\\share\\repo");
  assert.equal(normalizeProjectIdentityRoot(lowerDrive, "darwin"), lowerDrive);

  const identities = [lowerDrive, upperDrive].map((root) =>
    createHash("sha256").update(normalizeProjectIdentityRoot(root, "win32")).digest("hex"),
  );
  assert.equal(new Set(identities).size, 1);
}

console.log("Windows trust path tests passed");
