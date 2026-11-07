/** Isolated checker: its complete dependency closure is bound by identity v2. */
import { templateCompletenessPayload } from "./aidlc-sensor-inputs";

const option = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
try {
  if (option("--sensor") !== "template-completeness") throw new Error("unsupported isolated sensor");
  console.log(JSON.stringify(templateCompletenessPayload(process.cwd(), option("--module"), option("--unit"))));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
