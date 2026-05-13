import path from "node:path";
import { getArg, getListArg, parseArgs, requireArg, shouldShowHelp } from "./lib/args";
import { buildResultCheck, gradeClaimAudit, gradeRubric, gradeStyle } from "./lib/graders";
import { readTextFile, writeJsonFile } from "./lib/io";
import { analyzeFinalAnswer } from "./lib/static-checks";
import type { ResearchEvalCase } from "./lib/types";

function printHelp() {
  console.log(`Usage:
  npx tsx open-evals/final-artifact-eval.ts --query "<query>" --result result.md --out-dir open-evals/out/run-1

Options:
  --query         User query for the research task.
  --result        Markdown file containing the final research result.
  --sources       Optional source ledger / fetched source context for source-aware claim audit.
  --dimensions    Optional comma-separated required dimensions.
  --out-dir       Output directory. Defaults to stdout-only JSON summary.
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
  const sourcesPath = getArg(args, "sources");
  const sourceContext = sourcesPath ? await readTextFile(sourcesPath) : undefined;
  const finalChecks = analyzeFinalAnswer(finalMarkdown);
  const [rubric, style, claimAudit] = await Promise.all([
    gradeRubric({ caseSpec, finalMarkdown }),
    gradeStyle({ caseSpec, finalMarkdown }),
    gradeClaimAudit({ caseSpec, finalMarkdown, sourceContext }),
  ]);
  const resultCheck = buildResultCheck({ claimAudit, finalChecks, rubric, style });
  const summary = {
    claimAudit,
    finalChecks,
    resultCheck,
    rubric,
    style,
  };
  const outDir = getArg(args, "out-dir");

  if (outDir) {
    await Promise.all([
      writeJsonFile(path.join(outDir, "rubric.json"), rubric),
      writeJsonFile(path.join(outDir, "style.json"), style),
      writeJsonFile(path.join(outDir, "claim-audit.json"), claimAudit),
      writeJsonFile(path.join(outDir, "final-checks.json"), finalChecks),
      writeJsonFile(path.join(outDir, "summary.json"), summary),
    ]);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
