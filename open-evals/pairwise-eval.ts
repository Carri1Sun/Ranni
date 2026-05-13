import { getArg, getListArg, parseArgs, requireArg, shouldShowHelp } from "./lib/args";
import { gradePairwise } from "./lib/graders";
import { readTextFile, writeJsonFile } from "./lib/io";
import type { ResearchEvalCase } from "./lib/types";

function printHelp() {
  console.log(`Usage:
  npx tsx open-evals/pairwise-eval.ts --query "<query>" --answer-a a.md --answer-b b.md [--out pairwise.json]

Options:
  --query         User query for the research task.
  --answer-a      First final answer markdown.
  --answer-b      Second final answer markdown.
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
  const answerA = await readTextFile(requireArg(args, "answer-a"));
  const answerB = await readTextFile(requireArg(args, "answer-b"));
  const grade = await gradePairwise({ answerA, answerB, caseSpec });
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
