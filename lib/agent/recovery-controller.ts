import type { AcceptanceSnapshot } from "../acceptance";
import type { PlanAttemptRecord } from "../plan-attempt";
import type { ObservedState } from "../receipts/types";
import { collectCompletionIssues } from "./finalization-controller";
import type { AgentRunRecoverySnapshot } from "./run-state";

export type RecoveryCheckpoint = {
  acceptanceSnapshot: AcceptanceSnapshot;
  attempt?: PlanAttemptRecord;
  causalTailSnapshotHash: string;
  observedState: ObservedState;
  observedStateHash: string;
  runState?: AgentRunRecoverySnapshot;
};

export type RecoveryError = {
  message: string;
  name: string;
  transientProviderFailure: boolean;
};

export type RecoveryDecision =
  | {
      checkpoint: RecoveryCheckpoint;
      error: RecoveryError;
      finalSynthesisAllowed: false;
      kind: "cancelled";
      message: string;
      reason: "abort";
    }
  | {
      checkpoint: RecoveryCheckpoint;
      error: RecoveryError;
      finalSynthesisAllowed: false;
      gaps: string[];
      kind: "failed";
      message: string;
      reason: "provider_retry_exhausted" | "unrecoverable_error";
      recoverable: boolean;
      resumeInstruction?: string;
    }
  | {
      checkpoint: RecoveryCheckpoint;
      completion: {
        acceptanceEvidenceRefs: string[];
        observedStateHash: string;
      };
      error: RecoveryError;
      finalSynthesisAllowed: true;
      kind: "final_recovery";
      message: string;
    };

export type RecoveryInput = {
  abort?: AbortSignal | boolean;
  acceptanceSnapshot: AcceptanceSnapshot;
  attempt?: PlanAttemptRecord | null;
  causalTailSnapshotHash: string;
  error: unknown;
  observedState: ObservedState;
  runState?: AgentRunRecoverySnapshot;
};

function errorDetails(error: unknown): Omit<RecoveryError, "transientProviderFailure"> {
  if (error instanceof Error) {
    return { message: error.message, name: error.name || "Error" };
  }
  return {
    message: typeof error === "string" ? error : String(error),
    name: "Error",
  };
}

function isTransientProviderFailure(error: unknown) {
  const message = errorDetails(error).message;
  return /terminated|timeout|fetch failed|network|connection|ECONNRESET|UND_ERR|socket|temporarily unavailable|premature|提前结束|未收到 done|HTTP\s+(?:408|429|500|502|503|504)\b/i.test(
    message,
  );
}

function isAbortRequested(abort: AbortSignal | boolean | undefined, error: unknown) {
  if (abort === true) return true;
  if (typeof abort === "object" && abort?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function createCheckpoint({
  acceptanceSnapshot,
  attempt,
  causalTailSnapshotHash,
  observedState,
  runState,
}: Omit<RecoveryInput, "abort" | "error">): RecoveryCheckpoint {
  return {
    acceptanceSnapshot: structuredClone(acceptanceSnapshot),
    ...(attempt ? { attempt: structuredClone(attempt) } : {}),
    causalTailSnapshotHash,
    observedState: structuredClone(observedState),
    observedStateHash: observedState.stateHash,
    ...(runState ? { runState: structuredClone(runState) } : {}),
  };
}

function acceptedEvidenceRefs(acceptanceSnapshot: AcceptanceSnapshot) {
  return [
    ...new Set(
      acceptanceSnapshot.criteria
        .filter(
          (criterion) => criterion.required && criterion.status === "passed",
        )
        .flatMap((criterion) => criterion.evidenceRefs),
    ),
  ];
}

function hasDeterministicCompletionEvidence(
  acceptanceSnapshot: AcceptanceSnapshot,
) {
  const required = acceptanceSnapshot.criteria.filter(
    (criterion) => criterion.required,
  );
  return (
    required.length > 0 &&
    required.every(
      (criterion) =>
        (criterion.status === "passed" && criterion.evidenceRefs.length > 0) ||
        (criterion.status === "waived" &&
          Boolean(criterion.waivedByUserMessageId?.trim())),
    )
  );
}

function deterministicRecoveryMessage(
  acceptanceSnapshot: AcceptanceSnapshot,
  observedState: ObservedState,
) {
  const acceptedRefs = new Set(acceptedEvidenceRefs(acceptanceSnapshot));
  const artifacts = Object.values(observedState.artifacts)
    .filter(
      (artifact) =>
        acceptedRefs.has(artifact.receiptId) || artifact.status === "validated",
    )
    .filter((artifact) => artifact.path)
    .sort((left, right) => left.kind.localeCompare(right.kind));
  const artifactLines = [
    ...new Map(
      artifacts.map((artifact) => [
        `${artifact.kind}:${artifact.path}`,
        `- ${artifact.kind}：${artifact.path}（${artifact.status}）`,
      ]),
    ).values(),
  ];
  const passed = acceptanceSnapshot.criteria.filter(
    (criterion) => criterion.required && criterion.status === "passed",
  ).length;
  const waived = acceptanceSnapshot.criteria.filter(
    (criterion) => criterion.required && criterion.status === "waived",
  ).length;
  const artifactSection =
    artifactLines.length > 0 ? ["", "已验收交付物：", ...artifactLines] : [];

  return [
    "模型连接在最终交付说明阶段中断，已依据客观验收现场完成确定性恢复。",
    ...artifactSection,
    "",
    `验收结果：${passed} 项 passed${waived > 0 ? `，${waived} 项由用户明确 waived` : ""}。`,
  ]
    .join("\n")
    .trim();
}

export function decideRecovery({
  abort,
  acceptanceSnapshot,
  attempt,
  causalTailSnapshotHash,
  error,
  observedState,
  runState,
}: RecoveryInput): RecoveryDecision {
  const transientProviderFailure = isTransientProviderFailure(error);
  const details = {
    ...errorDetails(error),
    transientProviderFailure,
  };
  const checkpoint = createCheckpoint({
    acceptanceSnapshot,
    attempt,
    causalTailSnapshotHash,
    observedState,
    runState,
  });

  if (isAbortRequested(abort, error)) {
    return {
      checkpoint,
      error: details,
      finalSynthesisAllowed: false,
      kind: "cancelled",
      message: "任务已取消，当前工作现场和验收记录已保留。",
      reason: "abort",
    };
  }

  const completionIssues = collectCompletionIssues({
    acceptanceSnapshot,
    observedState,
  });
  const gaps = completionIssues.map((issue) => issue.message);

  if (!transientProviderFailure) {
    return {
      checkpoint,
      error: details,
      finalSynthesisAllowed: false,
      gaps,
      kind: "failed",
      message: `运行因不可恢复错误停止：${details.message}`,
      reason: "unrecoverable_error",
      recoverable: false,
    };
  }

  if (gaps.length > 0 || !hasDeterministicCompletionEvidence(acceptanceSnapshot)) {
    return {
      checkpoint,
      error: details,
      finalSynthesisAllowed: false,
      gaps:
        gaps.length > 0
          ? gaps
          : ["缺少可用于确定性交付恢复的客观完成证据。"],
      kind: "failed",
      message:
        "模型连接暂时中断，当前工作现场已保存。任务仍有交付缺口，可从 checkpoint 继续工作。",
      reason: "provider_retry_exhausted",
      recoverable: true,
      resumeInstruction:
        "恢复 causal tail、Observed State 和当前 attempt，继续使用工具缩小交付缺口；不得进入 final synthesis。",
    };
  }

  return {
    checkpoint,
    completion: {
      acceptanceEvidenceRefs: acceptedEvidenceRefs(acceptanceSnapshot),
      observedStateHash: observedState.stateHash,
    },
    error: details,
    finalSynthesisAllowed: true,
    kind: "final_recovery",
    message: deterministicRecoveryMessage(acceptanceSnapshot, observedState),
  };
}
