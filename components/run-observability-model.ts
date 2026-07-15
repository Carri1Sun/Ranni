import type { AcceptanceStatus } from "../lib/acceptance";
import type { ContextSectionName } from "../lib/context/types";
import type { StepProgressReceipt } from "../lib/progress";
import type { StepTraceIO } from "../lib/runs/run-trace-store";
import type { TraceContextSnapshot, TraceStep } from "../lib/trace";

export type TraceLoadStatus = "error" | "idle" | "loading" | "success";

export type AcceptanceItemView = {
  description: string;
  evidenceRefs: string[];
  id: string;
  required: boolean;
  status: AcceptanceStatus;
};

export type RunOverviewView = {
  acceptance: {
    counts: Record<AcceptanceStatus, number>;
    criteria: AcceptanceItemView[];
    total: number;
  };
  blockers: string[];
  completion?: {
    evidenceRefs: string[];
    ready: boolean;
    reason: string;
  };
  deliverableGap: string[];
  evidenceRefs: string[];
  legacy: boolean;
  nextAction: string;
  progress?: StepProgressReceipt;
  route: {
    approach: string;
    changeReason?: string;
    id: string;
    status: string;
  };
};

export type ContextHealthView = {
  causalIntegrity: "complete" | "unknown" | "warning";
  items: Array<{ label: string; value: string }>;
};

export type CompositionSectionView = {
  content: unknown;
  estimatedTokens?: number;
  itemCount?: number;
  key: ContextSectionName | "composition";
  label: string;
  treatment?: "full" | "pinned" | "summarized";
};

export type ToolPairView = {
  call?: Record<string, unknown>;
  name: string;
  result?: Record<string, unknown>;
  success?: boolean;
  toolUseId: string;
};

const ACCEPTANCE_STATUSES: AcceptanceStatus[] = [
  "passed",
  "pending",
  "failed",
  "unknown",
  "waived",
];

const SECTION_LABELS: Record<ContextSectionName | "composition", string> = {
  archive: "Archive Summary",
  causal_tail: "Recent Causal Tail",
  composition: "Context Composition",
  steering: "Steering Messages",
  system: "System Prompt",
  task_contract: "Task Contract",
  tools: "Available Tools",
  working_set: "Working Set",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function latestRecord(values: unknown[] | undefined): Record<string, unknown> | undefined {
  if (!values) return undefined;
  return [...values].reverse().find(isRecord);
}

function latestSemanticEvent(
  io: StepTraceIO | undefined,
  type: string,
): Record<string, unknown> | undefined {
  return [...(io?.output.semanticEvents ?? [])]
    .reverse()
    .find((event) => isRecord(event) && event.type === type) as
    | Record<string, unknown>
    | undefined;
}

function getContext(
  io: StepTraceIO | undefined,
  fallbackStep?: TraceStep,
): TraceContextSnapshot | undefined {
  if (isRecord(io?.input.context)) {
    return io.input.context as TraceContextSnapshot;
  }
  return fallbackStep?.context;
}

function getWorkingSet(
  io: StepTraceIO | undefined,
  fallbackStep?: TraceStep,
): Record<string, unknown> | undefined {
  const context = getContext(io, fallbackStep);
  return isRecord(context?.workingSet) ? context.workingSet : undefined;
}

function sanitizeProgress(value: unknown): StepProgressReceipt | undefined {
  if (!isRecord(value)) return undefined;
  const primaryCategory = asString(value.primaryCategory);
  if (!primaryCategory) return undefined;

  return {
    artifactHash: asString(value.artifactHash),
    deliverableGapAfter: asStringArray(value.deliverableGapAfter),
    deliverableGapBefore: asStringArray(value.deliverableGapBefore),
    informationDeltas: asStringArray(value.informationDeltas),
    informationGain: value.informationGain === true,
    noMeaningfulProgressStreak:
      typeof value.noMeaningfulProgressStreak === "number"
        ? value.noMeaningfulProgressStreak
        : 0,
    noObjectiveProgressStreak:
      typeof value.noObjectiveProgressStreak === "number"
        ? value.noObjectiveProgressStreak
        : 0,
    objectiveDeltas: asStringArray(value.objectiveDeltas),
    objectiveProgress: value.objectiveProgress === true,
    primaryCategory:
      primaryCategory as StepProgressReceipt["primaryCategory"],
    regression: value.regression === true,
    regressionDeltas: asStringArray(value.regressionDeltas),
    sameStrategyFailureStreak:
      typeof value.sameStrategyFailureStreak === "number"
        ? value.sameStrategyFailureStreak
        : 0,
    stateHash: asString(value.stateHash) ?? "unknown",
    strategySignature: asString(value.strategySignature) ?? "unknown",
  };
}

function getProgress(
  io: StepTraceIO | undefined,
  fallbackStep?: TraceStep,
): StepProgressReceipt | undefined {
  return (
    sanitizeProgress(latestRecord(io?.output.progressReceipts)) ??
    fallbackStep?.progressReceipt
  );
}

function sanitizeAcceptanceCriteria(value: unknown): AcceptanceItemView[] {
  if (!isRecord(value) || !Array.isArray(value.criteria)) return [];

  return value.criteria.flatMap((criterion) => {
    if (!isRecord(criterion)) return [];
    const id = asString(criterion.id);
    const description = asString(criterion.description);
    const status = asString(criterion.status);
    if (
      !id ||
      !description ||
      !status ||
      !ACCEPTANCE_STATUSES.includes(status as AcceptanceStatus)
    ) {
      return [];
    }
    return [
      {
        description,
        evidenceRefs: asStringArray(criterion.evidenceRefs),
        id,
        required: criterion.required !== false,
        status: status as AcceptanceStatus,
      },
    ];
  });
}

function completionView(io: StepTraceIO | undefined) {
  const event = latestRecord(io?.output.completionChecks);
  if (!event) return undefined;
  return {
    evidenceRefs: asStringArray(event.evidenceRefs),
    ready: event.ready === true,
    reason: asString(event.reason) ?? "尚无完成判定说明",
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function latestAttemptDelta(io: StepTraceIO | undefined) {
  const deltas = [
    ...(io?.output.semanticEvents ?? [])
      .filter((event) => isRecord(event) && event.type === "attempt.updated")
      .map((event) =>
        isRecord((event as Record<string, unknown>).attemptDelta)
          ? ((event as Record<string, unknown>).attemptDelta as Record<
              string,
              unknown
            >)
          : undefined,
      ),
    ...(io?.output.attemptDeltas ?? []).map((delta) =>
      isRecord(delta) ? delta : undefined,
    ),
  ].filter((delta): delta is Record<string, unknown> => Boolean(delta));

  return (
    [...deltas]
      .reverse()
      .find(
        (delta) =>
          asString(delta.created) ||
          asString(delta.failed) ||
          asString(delta.superseded),
      ) ?? deltas.at(-1)
  );
}

function observedEvidence(io: StepTraceIO | undefined): string[] {
  const observed = latestRecord(io?.output.observedStates);
  if (!observed) return [];
  const artifacts = isRecord(observed.artifacts)
    ? Object.values(observed.artifacts).filter(isRecord)
    : [];
  const verification = Array.isArray(observed.verification)
    ? observed.verification.filter(isRecord)
    : [];
  const commands = Array.isArray(observed.commands)
    ? observed.commands.filter(isRecord)
    : [];

  return [
    ...artifacts
      .filter((artifact) =>
        ["accepted", "prepared", "exported", "validated"].includes(
          asString(artifact.status) ?? "",
        ),
      )
      .map(
        (artifact) =>
          `${asString(artifact.kind) ?? "artifact"}: ${asString(artifact.path) ?? asString(artifact.key) ?? "unknown"} (${asString(artifact.status) ?? "unknown"})`,
      ),
    ...verification
      .filter((receipt) => receipt.passed === true)
      .map(
        (receipt) =>
          `verification: ${asString(receipt.scope) ?? "unknown"} · ${asString(receipt.receiptId) ?? "unknown"}`,
      ),
    ...commands
      .filter((receipt) => receipt.exitCode === 0)
      .map(
        (receipt) =>
          `command: ${asString(receipt.command) ?? "unknown"} · ${asString(receipt.receiptId) ?? "unknown"}`,
      ),
  ];
}

export function buildRunOverviewView({
  fallbackStep,
  io,
}: {
  fallbackStep?: TraceStep;
  io?: StepTraceIO;
}): RunOverviewView {
  const workingSet = getWorkingSet(io, fallbackStep);
  const activeAttempt = isRecord(workingSet?.activeAttempt)
    ? workingSet.activeAttempt
    : undefined;
  const attemptEvent = latestSemanticEvent(io, "attempt.updated");
  const attemptDelta = latestAttemptDelta(io);
  const acceptanceEvent = latestSemanticEvent(io, "acceptance.updated");
  const acceptanceState = acceptanceEvent?.acceptanceState;
  const criteria = sanitizeAcceptanceCriteria(acceptanceState);
  const progress = getProgress(io, fallbackStep);
  const completion = completionView(io);
  const acceptanceCounts = Object.fromEntries(
    ACCEPTANCE_STATUSES.map((status) => [
      status,
      criteria.filter((criterion) => criterion.status === status).length,
    ]),
  ) as Record<AcceptanceStatus, number>;
  const acceptanceGap = asStringArray(workingSet?.acceptanceGap);
  const deliverableGap = unique(
    progress?.deliverableGapAfter.length
      ? progress.deliverableGapAfter
      : acceptanceGap,
  );
  const unresolvedErrors = asStringArray(workingSet?.unresolvedErrors);
  const recovery = latestRecord(io?.output.recoveryEvents);
  const recoveryError = asString(recovery?.error);
  const rejectedOrFailed = criteria
    .filter((criterion) => criterion.required && criterion.status === "failed")
    .map((criterion) => `${criterion.id}: ${criterion.description}`);
  const passedEvidence = criteria.flatMap((criterion) =>
    criterion.status === "passed" ? criterion.evidenceRefs : [],
  );
  const routeChanged = attemptDelta
    ? asString(attemptDelta.created) ?? asString(attemptDelta.activeAttemptId)
    : undefined;
  const priorRouteFailed = asString(attemptDelta?.failed);
  const priorRouteSuperseded = asString(attemptDelta?.superseded);
  const routeChangeReason = priorRouteFailed
    ? `路线 ${priorRouteFailed} 已失败，已创建替代路线 ${routeChanged ?? ""}`.trim()
    : priorRouteSuperseded
      ? `路线 ${priorRouteSuperseded} 已被替代，新路线 ${routeChanged ?? ""}`.trim()
      : routeChanged && routeChanged !== asString(activeAttempt?.id)
        ? `已创建路线 ${routeChanged}，下一 Step 将展开最新路线内容`
        : undefined;
  const agentNote = isRecord(workingSet?.agentNote)
    ? workingSet.agentNote
    : undefined;
  const latestTaskState = isRecord(io?.output.latestTaskState)
    ? io.output.latestTaskState
    : fallbackStep?.taskState;

  return {
    acceptance: {
      counts: acceptanceCounts,
      criteria,
      total: criteria.length,
    },
    blockers: unique([
      ...unresolvedErrors,
      ...rejectedOrFailed,
      ...(recoveryError ? [recoveryError] : []),
      ...(io?.output.error ? [io.output.error] : []),
    ]),
    completion,
    deliverableGap,
    evidenceRefs: unique([
      ...passedEvidence,
      ...(completion?.evidenceRefs ?? []),
      ...observedEvidence(io),
    ]),
    legacy: !io || (!acceptanceEvent && !progress && !attemptEvent),
    nextAction:
      asString(agentNote?.nextAction) ??
      asString(latestTaskState?.nextAction) ??
      "等待下一条客观回执",
    progress,
    route: {
      approach:
        asString(activeAttempt?.approach) ??
        "Agent 正在根据当前现场自主选择推进路线",
      changeReason: routeChangeReason,
      id: asString(activeAttempt?.id) ?? asString(attemptDelta?.activeAttemptId) ?? "unknown",
      status: asString(activeAttempt?.status) ?? "unknown",
    },
  };
}

export function buildContextHealthView({
  fallbackStep,
  io,
}: {
  fallbackStep?: TraceStep;
  io?: StepTraceIO;
}): ContextHealthView {
  const context = getContext(io, fallbackStep);
  const composition = context?.composition;
  if (!composition) {
    return {
      causalIntegrity: "unknown",
      items: [
        { label: "因果链完整性", value: "unknown" },
        { label: "Trace 版本", value: "Legacy Trace" },
      ],
    };
  }

  const expected = composition.previousTurnToolPairs.expected;
  const preserved = composition.previousTurnToolPairs.preserved;
  const causalIntegrity = expected === preserved ? "complete" : "warning";

  return {
    causalIntegrity,
    items: [
      {
        label: "上一轮完整工具结果",
        value: `${preserved} / ${expected}`,
      },
      {
        label: "最近完整因果轮次",
        value: String(composition.recentCausalTurnCount),
      },
      {
        label: "旧 Reasoning Metadata",
        value: String(composition.staleReasoningItemCount),
      },
      {
        label: "被省略历史工具调用",
        value: String(composition.omittedHistoricalToolPairCount),
      },
      {
        label: "语义失效项",
        value: String(composition.semanticInvalidationCount),
      },
      {
        label: "压缩原因",
        value: composition.compactionApplied
          ? composition.compactionReason ?? "budget"
          : "none",
      },
      {
        label: "稳定前缀",
        value: composition.stablePrefixHash.slice(0, 12),
      },
      {
        label: "稳定前缀失效原因",
        value: composition.stablePrefixInvalidationReason ?? "none",
      },
      {
        label: "可复用前缀消息",
        value: String(composition.prefixCacheEligibleMessageCount),
      },
      {
        label: "Context 预算",
        value: composition.safeInputBudget
          ? `${composition.estimatedInputTokens} / ${composition.safeInputBudget}`
          : String(composition.estimatedInputTokens),
      },
    ],
  };
}

export function buildInputCompositionSections({
  fallbackStep,
  io,
}: {
  fallbackStep?: TraceStep;
  io?: StepTraceIO;
}): CompositionSectionView[] {
  const context = getContext(io, fallbackStep);
  const composition = context?.composition;
  const exactRequest = isRecord(io?.input.exactRequest)
    ? io.input.exactRequest
    : fallbackStep?.request;
  const requestMessages = isRecord(exactRequest)
    ? exactRequest.messages
    : fallbackStep?.request?.messages;
  const manifestByName = new Map(
    (composition?.sections ?? []).map((section) => [section.name, section]),
  );
  const values: Record<ContextSectionName, unknown> = {
    archive: context?.archiveSummary ?? "",
    causal_tail: context?.messages ?? requestMessages ?? [],
    steering: manifestByName.get("steering")
      ? { note: "Steering 已进入冻结请求，请在 Exact Model Request 中核对。" }
      : [],
    system: context?.systemPrompt ?? "",
    task_contract: context?.taskContract ?? {},
    tools: context?.tools ?? fallbackStep?.request?.tools ?? [],
    working_set: context?.workingSet ?? {},
  };

  const order: ContextSectionName[] = [
    "system",
    "task_contract",
    "working_set",
    "causal_tail",
    "archive",
    "steering",
    "tools",
  ];

  return [
    ...order.map((key) => {
      const manifest = manifestByName.get(key);
      return {
        content: values[key],
        estimatedTokens: manifest?.estimatedTokens,
        itemCount: manifest?.itemCount,
        key,
        label: SECTION_LABELS[key],
        treatment: manifest?.treatment,
      } satisfies CompositionSectionView;
    }),
    {
      content: composition ?? { legacy: true },
      estimatedTokens: composition?.estimatedInputTokens,
      itemCount: composition?.finalMessageCount,
      key: "composition",
      label: SECTION_LABELS.composition,
      treatment: composition ? "pinned" : undefined,
    },
  ];
}

export function buildToolPairs(io: StepTraceIO | undefined): ToolPairView[] {
  const calls = (io?.output.toolCalls ?? []).filter(isRecord);
  const results = (io?.output.toolResults ?? []).filter(isRecord);
  const toolUseIds = unique([
    ...calls.map((call) => asString(call.toolUseId) ?? asString(call.id) ?? ""),
    ...results.map(
      (result) => asString(result.toolUseId) ?? asString(result.id) ?? "",
    ),
  ]);

  return toolUseIds.map((toolUseId) => {
    const call = calls.find(
      (candidate) =>
        (asString(candidate.toolUseId) ?? asString(candidate.id)) === toolUseId,
    );
    const result = results.find(
      (candidate) =>
        (asString(candidate.toolUseId) ?? asString(candidate.id)) === toolUseId,
    );
    return {
      call,
      name: asString(call?.name) ?? asString(result?.name) ?? "unknown",
      result,
      success: result ? result.success !== false : undefined,
      toolUseId,
    };
  });
}

export function getPersistedStepProgress(
  io: StepTraceIO | undefined,
  fallbackStep?: TraceStep,
): StepProgressReceipt | undefined {
  return getProgress(io, fallbackStep);
}

export function selectStepIOForView({
  expectedRunId,
  expectedStepId,
  io,
}: {
  expectedRunId?: string;
  expectedStepId?: string;
  io?: StepTraceIO;
}): StepTraceIO | undefined {
  if (
    !io ||
    !expectedRunId ||
    !expectedStepId ||
    io.input.runId !== expectedRunId ||
    io.summary.stepId !== expectedStepId
  ) {
    return undefined;
  }
  return io;
}
