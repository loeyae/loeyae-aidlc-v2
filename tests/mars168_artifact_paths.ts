import { readdirSync } from "node:fs";
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(file => {
    const path = `${dir}/${file.name}`;
    return file.isDirectory() ? walk(path) : /\.(md|html|json)$/.test(file.name) && !/(?:-review\.json|quality-adoption\.json|ui-generation-|change-checkpoints)/.test(file.name) ? [path] : [];
  });
}
console.log(JSON.stringify(walk("docs/aidlc/modules/shop")));
