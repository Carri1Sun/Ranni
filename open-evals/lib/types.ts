export type ResearchEvalCase = {
  audience?: string;
  expectedDeliverables?: string[];
  id?: string;
  preferredSourceTypes?: string[];
  query: string;
  requiredDimensions?: string[];
  riskClaims?: string[];
  timeWindow?: string;
};

export type JudgeRequest = {
  caseSpec: ResearchEvalCase;
  finalMarkdown: string;
};

export type RubricGrade = {
  dimensionScores: Array<{
    evidenceFromAnswer?: string;
    name: string;
    reason: string;
    score: number;
  }>;
  harnessImplications: string[];
  likelyUserComplaints: string[];
  objectiveScore: number;
  overallScore: number;
  productScore: number;
  revisionAdvice: string[];
  strengths: string[];
  weaknesses: string[];
};

export type StyleGrade = {
  aiFlavorRisk: number;
  dimensionScores: Array<{
    name: string;
    reason: string;
    score: number;
  }>;
  harnessImplications: string[];
  readerExperience: string;
  readerValueScore: number;
  rewriteAdvice: string[];
  styleScore: number;
};

export type ClaimAuditGrade = {
  citationAlignmentIssues: string[];
  claims: Array<{
    citationStatus: string;
    citedSources?: string[];
    claim: string;
    importance: string;
    reason: string;
    supportStatus: string;
    type: string;
  }>;
  highRiskUnsupportedClaims: string[];
  supportedRatio: number;
};

export type PairwiseGrade = {
  confidence: number;
  decision: "A" | "B" | "tie";
  dimensionWinners: Array<{
    dimension: string;
    reason: string;
    winner: "A" | "B" | "tie";
  }>;
  harnessImplications: string[];
  rationale: string;
  userPreferenceReason: string;
};

export type OpenEvalTraceEvent = {
  content?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
  name?: string;
  output?: unknown;
  timestamp?: string;
  type: string;
};

export type TraceAnalysisGrade = {
  behaviorScores: Array<{
    name: string;
    reason: string;
    score: number;
  }>;
  observedFailures: Array<{
    evidence: string;
    likelyFix: string;
    type: string;
  }>;
  positiveBehaviors: string[];
  staticFeatures: Record<string, unknown>;
};

export type DeterministicFinalChecks = {
  features: {
    citationCount: number;
    finalCharCount: number;
    firstScreenHasThesisSignal: boolean;
    hasDanglingProtocolToken: boolean;
    hasTruncationMarker: boolean;
    headingCount: number;
    listItemCount: number;
    processLeakage: boolean;
    sourceSectionPresent: boolean;
    tableCount: number;
    uniqueDomainCount: number;
  };
  hardFailures: string[];
  passed: boolean;
  warnings: string[];
};
