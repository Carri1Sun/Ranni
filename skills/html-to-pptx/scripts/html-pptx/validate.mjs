import {
  readJsonFromStdin,
  validateHtmlPptxExport,
  writeJsonResult,
} from "./lib.mjs";

try {
  const args = await readJsonFromStdin();
  const result = await validateHtmlPptxExport(args);

  writeJsonResult(result);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}
