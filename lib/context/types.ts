import type { AgentMessage } from "../llm";
import type { CompactPlanSnapshot } from "../plan";
import type { TraceToolDefinition } from "../trace";

export type ContextSectionName =
  | "system"
  | "task_contract"
  | "working_set"
  | "archive"
  | "causal_tail"
  | "steering"
  | "tools";

export type ContextSectionManifest = {
  estimatedTokens: number;
  hash: string;
  itemCount: number;
  name: ContextSectionName;
  treatment: "full" | "pinned" | "summarized";
};

export type ContextCompositionManifest = {
  version: 2;
  compactionApplied: boolean;
  compactionReason?: "budget" | "provider-limit";
  estimatedInputTokens: number;
  finalMessageCount: number;
  omittedHistoricalToolPairCount: number;
  originalMessageCount: number;
  previousTurnToolPairs: {
    expected: number;
    preserved: number;
  };
  recentCausalTurnCount: number;
  safeInputBudget: number | null;
  sections: ContextSectionManifest[];
  semanticInvalidationCount: number;
  skills: Array<{
    bodyHash: string;
    name: string;
    resourcePaths: string[];
    version: string;
  }>;
  snapshotHash: string;
  stablePrefixHash: string;
  stablePrefixInvalidationReason?:
    | "task-contract-changed"
    | "skill-changed"
    | "tools-changed"
    | "provider-protocol";
  staleReasoningItemCount: number;
  prefixCacheEligibleMessageCount: number;
};

export type StablePrefixState = {
  hash: string;
  skillsHash: string;
  taskContractHash: string;
  toolsHash: string;
};

export type TaskContractView = {
  authorizationBoundary: string[];
  constraints: string[];
  deliverable: string;
  goal: string;
  successCriteria: string[];
};

export type WorkingSetView = {
  acceptanceGap: string[];
  activeAssumptions?: string[];
  activeAttempt?: {
    approach: string;
    id: string;
    status: string;
  };
  agentNote: {
    currentIntent?: string;
    nextAction?: string;
    openQuestions?: string[];
  };
  artifactSummary: string[];
  observedFacts: string[];
  plan: CompactPlanSnapshot;
  researchHandoff?: {
    artifactPlan: string[];
    claimIds: string[];
    findings: string[];
    openGaps: string[];
    sourceIds: string[];
    thesis: string;
    weakEvidence: string[];
  };
  rejectedAssumptionCount: number;
  unresolvedErrors: string[];
};

export type ContextEnvelope = {
  archiveSummary: string;
  causalTail: AgentMessage[];
  composition: ContextCompositionManifest;
  messages: AgentMessage[];
  stepIndex: number;
  steeringMessages: AgentMessage[];
  stablePrefixState: StablePrefixState;
  systemPrompt: string;
  taskContract: TaskContractView;
  toolDefinitions: TraceToolDefinition[];
  workingSet: WorkingSetView;
};
