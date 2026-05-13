import { getArg, getListArg, parseArgs, requireArg, shouldShowHelp } from "./lib/args";
import { gradeTrace } from "./lib/graders";
import { readTextFile, writeJsonFile } from "./lib/io";
import { analyzeFinalAnswer, analyzeTraceEvents } from "./lib/static-checks";
import { readTraceEvents } from "./lib/trace";
import type { ResearchEvalCase } from "./lib/types";

function printHelp() {
  console.log(`Usage:
  npx tsx open-evals/trace-analyzer.ts --query "<query>" --result result.md --trace trace.ndjson [--out trace-analysis.json]

Options:
  --query         User query for the research task.
  --result        Markdown file containing the final research result.
  --trace         Trace file. Supports JSON array, JSON object with events, or NDJSON.
  --dimensions    Optional comma-separated required dimensions.
  --static-only   Only run deterministic trace/final checks, no LLM judge call.
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
  const traceEvents = await readTraceEvents(requireArg(args, "trace"));
  const staticSummary = {
    finalChecks: analyzeFinalAnswer(finalMarkdown),
    traceFeatures: analyzeTraceEvents(traceEvents),
  };
  const result = args.flags.has("static-only")
    ? staticSummary
    : {
        ...staticSummary,
        traceGrade: await gradeTrace({ caseSpec, finalMarkdown, traceEvents }),
      };
  const out = getArg(args, "out");

  if (out) {
    await writeJsonFile(out, result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
