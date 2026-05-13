import { getArg, getListArg, parseArgs, requireArg, shouldShowHelp } from "./lib/args";
import { gradeRubric } from "./lib/graders";
import { readTextFile, writeJsonFile } from "./lib/io";
import type { ResearchEvalCase } from "./lib/types";

function printHelp() {
  console.log(`Usage:
  npx tsx open-evals/rubric-eval.ts --query "<query>" --result result.md [--out rubric.json]

Options:
  --query         User query for the research task.
  --result        Markdown file containing the final research result.
  --dimensions    Optional comma-separated required dimensions.
  --out           Optional JSON output path. Defaults to stdout.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (shouldShowHelp(args)) {
    printHelp();
    return;
  }

  const caseSpec: ResearchEvalCase = {
    query: requireArg(args, "query"),
    requiredDimensions: getListArg(args, "dimensions"),
  };
  const finalMarkdown = await readTextFile(requireArg(args, "result"));
  const grade = await gradeRubric({ caseSpec, finalMarkdown });
  const out = getArg(args, "out");

  if (out) {
    await writeJsonFile(out, grade);
  } else {
    console.log(JSON.stringify(grade, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
