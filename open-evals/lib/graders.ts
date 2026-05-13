import { callJsonJudge } from "./llm";
import {
  claimAuditSystemPrompt,
  claimAuditUserPrompt,
  pairwiseSystemPrompt,
  pairwiseUserPrompt,
  rubricSystemPrompt,
  rubricUserPrompt,
  styleSystemPrompt,
  styleUserPrompt,
  traceSystemPrompt,
  traceUserPrompt,
} from "./prompts";
import { analyzeFinalAnswer, analyzeTraceEvents } from "./static-checks";
import { compactTraceForJudge } from "./trace";
import type {
  ClaimAuditGrade,
  DeterministicFinalChecks,
  JudgeRequest,
  OpenEvalTraceEvent,
  PairwiseGrade,
  ResearchEvalCase,
  RubricGrade,
  StyleGrade,
  TraceAnalysisGrade,
} from "./types";

export async function gradeRubric(request: JudgeRequest) {
  return callJsonJudge<RubricGrade>({
    system: rubricSystemPrompt,
    user: rubricUserPrompt(request.caseSpec, request.finalMarkdown),
  });
}

export async function gradeStyle(request: JudgeRequest) {
  return callJsonJudge<StyleGrade>({
    system: styleSystemPrompt,
    user: styleUserPrompt(request.caseSpec, request.finalMarkdown),
  });
}

export async function gradeClaimAudit({
  caseSpec,
  finalMarkdown,
  sourceContext,
}: JudgeRequest & { sourceContext?: string }) {
  return callJsonJudge<ClaimAuditGrade>({
    system: claimAuditSystemPrompt,
    user: claimAuditUserPrompt({ caseSpec, finalMarkdown, sourceContext }),
  });
}

export async function gradePairwise({
  answerA,
  answerB,
  caseSpec,
}: {
  answerA: string;
  answerB: string;
  caseSpec: ResearchEvalCase;
}) {
  return callJsonJudge<PairwiseGrade>({
    system: pairwiseSystemPrompt,
    user: pairwiseUserPrompt({ answerA, answerB, caseSpec }),
  });
}

export async function gradeTrace({
  caseSpec,
  finalMarkdown,
  traceEvents,
}: {
  caseSpec: ResearchEvalCase;
  finalMarkdown: string;
  traceEvents: OpenEvalTraceEvent[];
}) {
  const finalChecks = analyzeFinalAnswer(finalMarkdown);
  const staticFeatures = analyzeTraceEvents(traceEvents);
  const compactTrace = compactTraceForJudge(traceEvents);
  const grade = await callJsonJudge<TraceAnalysisGrade>({
    system: traceSystemPrompt,
    user: traceUserPrompt({
      caseSpec,
      compactTrace,
      finalChecks,
      finalMarkdown,
      staticFeatures,
    }),
  });

  return {
    ...grade,
    staticFeatures: {
      ...staticFeatures,
      ...(grade.staticFeatures ?? {}),
    },
  };
}

export function buildResultCheck({
  claimAudit,
  finalChecks,
  rubric,
  style,
}: {
  claimAudit: ClaimAuditGrade;
  finalChecks: DeterministicFinalChecks;
  rubric: RubricGrade;
  style: StyleGrade;
}) {
  const hardFailures = [...finalChecks.hardFailures];
  const warnings = [...finalChecks.warnings];
  const highRiskUnsupportedCount = claimAudit.highRiskUnsupportedClaims.length;

  if (rubric.objectiveScore < 75) {
    warnings.push("objective_score_below_75");
  }

  if (rubric.productScore < 75) {
    warnings.push("product_score_below_75");
  }

  if (style.styleScore < 70 && style.aiFlavorRisk > 60) {
    warnings.push("style_low_and_ai_flavor_high");
  }

  if (highRiskUnsupportedCount > 0) {
    warnings.push("high_risk_unsupported_claims");
  }

  const status =
    hardFailures.length > 0
      ? "fail"
      : warnings.length > 0
        ? "needs_review"
        : "pass";

  return {
    aiFlavorRisk: style.aiFlavorRisk,
    claimSupportedRatio: claimAudit.supportedRatio,
    hardFailures,
    objectiveScore: rubric.objectiveScore,
    overallScore: rubric.overallScore,
    productScore: rubric.productScore,
    releaseRecommendation:
      status === "pass" ? "ship" : status === "fail" ? "hold" : "manual_review",
    status,
    styleScore: style.styleScore,
    warnings,
  };
}
