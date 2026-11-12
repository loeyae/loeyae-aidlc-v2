import { functionalDesignPayload } from "./aidlc-functional-design-inputs";
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
try {
  if (option("--sensor") !== "functional-design-completeness") throw Error("unsupported isolated sensor");
  const module = option("--module") || process.env.AIDLC_ACTIVE_MODULE?.trim();
  const unit = option("--unit") || process.env.AIDLC_ACTIVE_UNIT?.trim();
  if ((module && !unit) || (unit && !module)) throw Error("functional design requires module and unit together");
  console.log(JSON.stringify(functionalDesignPayload(process.cwd(), module, unit)));
} catch (error) { process.stderr.write(String(error) + "\n"); process.exitCode = 1; }
