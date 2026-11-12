import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const modulePath = process.env.AIDLC_CR_TEST_ENGINE_ROOT ? join(process.env.AIDLC_CR_TEST_ENGINE_ROOT, "core/tools/aidlc-evidence.ts") : resolve(import.meta.dirname, "../core/tools/aidlc-evidence.ts");
const { phaseObservationEvidenceErrors } = await import(pathToFileURL(modulePath).href);
const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(JSON.stringify(phaseObservationEvidenceErrors("code-generation", evidence, process.argv[3])));
