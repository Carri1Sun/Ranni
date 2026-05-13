import type { ResearchEvalCase } from "./types";

export function renderCaseSpec(caseSpec: ResearchEvalCase) {
  return JSON.stringify(
    {
      audience: caseSpec.audience ?? "",
      expectedDeliverables: caseSpec.expectedDeliverables ?? [],
      preferredSourceTypes: caseSpec.preferredSourceTypes ?? [],
      query: caseSpec.query,
      requiredDimensions: caseSpec.requiredDimensions ?? [],
      riskClaims: caseSpec.riskClaims ?? [],
      timeWindow: caseSpec.timeWindow ?? "",
    },
    null,
    2,
  );
}

export const rubricSystemPrompt = [
  "You are a strict evaluator for information-retrieval research agents.",
  "Evaluate only the user-visible final answer. Do not reward hidden trace, tool calls, or effort.",
  "Be skeptical about unsupported numbers, benchmark claims, vendor claims, freshness claims, and broad recommendations.",
  "Return valid compact JSON only. Do not wrap it in Markdown.",
].join("\n");

export function rubricUserPrompt(caseSpec: ResearchEvalCase, finalMarkdown: string) {
  return [
    "Evaluate this final research answer against the user's query and case spec.",
    "",
    "Case spec:",
    renderCaseSpec(caseSpec),
    "",
    "Rubric dimensions, each scored 0-5:",
    "- coverage",
    "- freshness",
    "- source_quality",
    "- citation_alignment",
    "- evidence_discipline",
    "- conflict_handling",
    "- synthesis_depth",
    "- specificity",
    "- decision_value",
    "- honesty",
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        dimensionScores: [
          {
            evidenceFromAnswer: "short quote or paraphrase from final answer",
            name: "coverage",
            reason: "specific reason",
            score: 0,
          },
        ],
        harnessImplications: ["what the harness/prompt/tooling should change"],
        likelyUserComplaints: ["what a user would complain about"],
        objectiveScore: 0,
        overallScore: 0,
        productScore: 0,
        revisionAdvice: ["concrete revision advice"],
        strengths: ["top strengths"],
        weaknesses: ["top weaknesses"],
      },
      null,
      2,
    ),
    "",
    "Final answer:",
    finalMarkdown,
  ].join("\n");
}

export const styleSystemPrompt = [
  "You are a strict writing-quality judge for deep research answers.",
  "Evaluate only reader experience and style. Do not reward hidden trace or tool effort.",
  "Do not re-grade factual coverage except where it affects reader trust.",
  "Return valid compact JSON only. Do not wrap it in Markdown.",
].join("\n");

export function styleUserPrompt(caseSpec: ResearchEvalCase, finalMarkdown: string) {
  return [
    "Evaluate the user-visible writing style and reading experience.",
    "",
    "Case spec:",
    renderCaseSpec(caseSpec),
    "",
    "Style dimensions, each scored 0-5:",
    "- opening_value",
    "- authorial_voice",
    "- narrative_flow",
    "- paragraph_craft",
    "- format_taste",
    "- anti_template_naturalness",
    "- cognitive_load",
    "- reader_guidance",
    "- citation_integration",
    "- domain_register",
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        aiFlavorRisk: 0,
        dimensionScores: [{ name: "opening_value", reason: "specific reason", score: 0 }],
        harnessImplications: ["what harness/prompt should change"],
        readerExperience: "brief holistic reading experience",
        readerValueScore: 0,
        rewriteAdvice: ["concrete writing advice"],
        styleScore: 0,
      },
      null,
      2,
    ),
    "",
    "Final answer:",
    finalMarkdown,
  ].join("\n");
}

export const claimAuditSystemPrompt = [
  "You are a claim-audit judge for research answers.",
  "Extract important claims and evaluate whether visible citations or provided source context support them.",
  "Be especially strict for numbers, rankings, benchmark results, costs, vendor claims, freshness claims, and recommendations.",
  "Return valid compact JSON only. Do not wrap it in Markdown.",
].join("\n");

export function claimAuditUserPrompt({
  caseSpec,
  finalMarkdown,
  sourceContext,
}: {
  caseSpec: ResearchEvalCase;
  finalMarkdown: string;
  sourceContext?: string;
}) {
  return [
    "Audit 10-20 important claims from the final answer.",
    "",
    "Case spec:",
    renderCaseSpec(caseSpec),
    "",
    sourceContext
      ? `Source context for source-aware checking:\n${sourceContext}`
      : "No source context was provided. Use final-only mode: check visible citation presence and obvious overclaims.",
    "",
    "Use supportStatus values: supported, partially_supported, unsupported, contradicted, overclaimed, not_checked.",
    "Use citationStatus values: cited, uncited, unclear.",
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        citationAlignmentIssues: ["citation/claim alignment issues"],
        claims: [
          {
            citationStatus: "unclear",
            citedSources: ["source label or URL if visible"],
            claim: "important claim",
            importance: "high",
            reason: "support judgment",
            supportStatus: "not_checked",
            type: "number",
          },
        ],
        highRiskUnsupportedClaims: ["high-risk unsupported claim"],
        supportedRatio: 0,
      },
      null,
      2,
    ),
    "",
    "Final answer:",
    finalMarkdown,
  ].join("\n");
}

export const pairwiseSystemPrompt = [
  "You are a blind pairwise evaluator for research-agent final answers.",
  "Choose the answer that a real user would prefer for the given query.",
  "Do not infer model identity or reward verbosity. Prefer trust, synthesis, usefulness, readable structure, and citation alignment.",
  "Return valid compact JSON only. Do not wrap it in Markdown.",
].join("\n");

export function pairwiseUserPrompt({
  answerA,
  answerB,
  caseSpec,
}: {
  answerA: string;
  answerB: string;
  caseSpec: ResearchEvalCase;
}) {
  return [
    "Blindly compare Answer A and Answer B.",
    "",
    "Case spec:",
    renderCaseSpec(caseSpec),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        confidence: 0,
        decision: "tie",
        dimensionWinners: [
          { dimension: "trust", reason: "specific reason", winner: "tie" },
          { dimension: "coverage", reason: "specific reason", winner: "tie" },
          { dimension: "synthesis", reason: "specific reason", winner: "tie" },
          { dimension: "readability", reason: "specific reason", winner: "tie" },
          { dimension: "decision_value", reason: "specific reason", winner: "tie" },
          { dimension: "citation_quality", reason: "specific reason", winner: "tie" },
          { dimension: "style", reason: "specific reason", winner: "tie" },
        ],
        harnessImplications: ["what this preference implies for eval/harness iteration"],
        rationale: "brief rationale",
        userPreferenceReason: "why a real user would prefer this answer",
      },
      null,
      2,
    ),
    "",
    "Answer A:",
    answerA,
    "",
    "Answer B:",
    answerB,
  ].join("\n");
}

export const traceSystemPrompt = [
  "You are a trace analyzer for information-retrieval research agents.",
  "Use the trace only for behavioral diagnosis. Do not add credit to the final answer for hidden effort.",
  "Identify what behavior likely caused final-answer quality issues.",
  "Return valid compact JSON only. Do not wrap it in Markdown.",
].join("\n");

export function traceUserPrompt({
  caseSpec,
  compactTrace,
  finalChecks,
  finalMarkdown,
  staticFeatures,
}: {
  caseSpec: ResearchEvalCase;
  compactTrace: unknown;
  finalChecks: unknown;
  finalMarkdown: string;
  staticFeatures: unknown;
}) {
  return [
    "Analyze this research-agent trace and final answer together.",
    "",
    "Case spec:",
    renderCaseSpec(caseSpec),
    "",
    "Static trace features:",
    JSON.stringify(staticFeatures, null, 2),
    "",
    "Static final checks:",
    JSON.stringify(finalChecks, null, 2),
    "",
    "Compact trace sample:",
    JSON.stringify(compactTrace, null, 2),
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        behaviorScores: [
          { name: "source_discovery", reason: "specific reason", score: 0 },
          { name: "evidence_acquisition", reason: "specific reason", score: 0 },
          { name: "research_control", reason: "specific reason", score: 0 },
          { name: "memory_use", reason: "specific reason", score: 0 },
          { name: "finalization", reason: "specific reason", score: 0 },
        ],
        observedFailures: [
          {
            evidence: "trace evidence",
            likelyFix: "harness/prompt/tooling adjustment",
            type: "no_fetch",
          },
        ],
        positiveBehaviors: ["positive trace behavior"],
        staticFeatures: {},
      },
      null,
      2,
    ),
    "",
    "Final answer:",
    finalMarkdown,
  ].join("\n");
}
