import type {
  AcceptanceCriterion,
  AcceptanceSnapshot,
  DeliverableContract,
} from "../acceptance";
import type { PlanAttemptRecord } from "../plan-attempt";
import type {
  ArtifactReceipt,
  ErrorReceipt,
  ObservedState,
  VerificationReceipt,
} from "../receipts/types";

export type FinalizationGuardIssueCode =
  | "acceptance_gap"
  | "empty_final"
  | "missing_evidence"
  | "pptx_not_validated"
  | "pptx_page_count_mismatch"
  | "truncated_final"
  | "unresolved_deliverable_error";

export type FinalizationGuardIssue = {
  code: FinalizationGuardIssueCode;
  criterionId?: string;
  evidenceRef?: string;
  message: string;
  receiptId?: string;
};

export type FinalizationDecision =
  | {
      attemptId?: string;
      feedback: string;
      finalSynthesisAllowed: false;
      issues: FinalizationGuardIssue[];
      kind: "guard_retry";
      nextAction: "continue_tools" | "repair_final";
      observedStateHash: string;
    }
  | {
      completion: {
        attemptId?: string;
        evidenceRefs: string[];
        observedStateHash: string;
      };
      finalSynthesisAllowed: true;
      kind: "final";
      message: string;
      stopReason: string;
    };

export type FinalizationInput = {
  acceptanceSnapshot: AcceptanceSnapshot;
  activeAttempt?: PlanAttemptRecord | null;
  deliverableContract: DeliverableContract;
  observedState: ObservedState;
  stopReason?: string | null;
  visibleContent: string;
};

type CompletionStateInput = {
  acceptanceSnapshot: AcceptanceSnapshot;
  deliverableContract?: DeliverableContract;
  observedState: ObservedState;
};

type CriterionView = AcceptanceCriterion;

const NON_DELIVERABLE_TERMS = new Set([
  "artifact",
  "file",
  "other",
  "text",
  "verification",
]);

function uniqueIssues(issues: FinalizationGuardIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.criterionId ?? "",
      issue.evidenceRef ?? "",
      issue.receiptId ?? "",
      issue.message,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function criterionViews({
  acceptanceSnapshot,
  deliverableContract,
}: Pick<CompletionStateInput, "acceptanceSnapshot" | "deliverableContract">) {
  const byId = new Map<string, CriterionView>();

  for (const criterion of deliverableContract?.criteria ?? []) {
    byId.set(criterion.id, {
      ...criterion,
      evidenceRefs: [],
      status: "pending",
    });
  }

  for (const criterion of acceptanceSnapshot.criteria) {
    const contractCriterion = byId.get(criterion.id);
    byId.set(
      criterion.id,
      contractCriterion
        ? {
            ...criterion,
            ...contractCriterion,
            evidenceRefs: criterion.evidenceRefs,
            lastCheckedAt: criterion.lastCheckedAt,
            required: Boolean(contractCriterion.required || criterion.required),
            status: criterion.status,
            waivedByUserMessageId: criterion.waivedByUserMessageId,
          }
        : criterion,
    );
  }

  return [...byId.values()];
}

function knownEvidenceRefs(observedState: ObservedState) {
  return new Set([
    ...observedState.receipts
      .filter((receipt) => receipt.success && receipt.domainStatus === "succeeded")
      .map((receipt) => receipt.id),
    ...Object.values(observedState.artifacts)
      .filter((artifact) =>
        ["accepted", "prepared", "exported", "validated"].includes(
          artifact.status,
        ),
      )
      .map((artifact) => artifact.receiptId),
    ...observedState.commands
      .filter(
        (command) => !command.timedOut && command.exitCode === 0,
      )
      .map((command) => command.receiptId),
    ...Object.values(observedState.evidence).map(
      (evidence) => evidence.receiptId,
    ),
    ...Object.values(observedState.files)
      .filter((file) => !file.deleted)
      .map((file) => file.receiptId),
    ...observedState.verification
      .filter((verification) => verification.passed)
      .map((verification) => verification.receiptId),
  ]);
}

function latestArtifact(
  observedState: ObservedState,
  kind: string,
): ArtifactReceipt | undefined {
  for (let index = observedState.receipts.length - 1; index >= 0; index -= 1) {
    const receipt = observedState.receipts[index];
    const artifacts = receipt?.projection.artifacts ?? [];
    for (let artifactIndex = artifacts.length - 1; artifactIndex >= 0; artifactIndex -= 1) {
      const artifact = artifacts[artifactIndex];
      if (receipt.success && artifact?.kind === kind) {
        return { ...artifact, receiptId: receipt.id };
      }
    }
  }

  const receiptOrder = new Map(
    observedState.receipts.map((receipt, index) => [receipt.id, index]),
  );
  return Object.values(observedState.artifacts)
    .filter((artifact) => artifact.kind === kind)
    .sort(
      (left, right) =>
        (receiptOrder.get(left.receiptId) ?? -1) -
        (receiptOrder.get(right.receiptId) ?? -1),
    )
    .at(-1);
}

function latestVerification(
  observedState: ObservedState,
  scope: string,
): VerificationReceipt | undefined {
  return observedState.verification
    .filter((verification) => verification.scope === scope)
    .at(-1);
}

function latestArtifactMutationAfter(
  observedState: ObservedState,
  receiptId: string,
) {
  const validationIndex = observedState.receipts.findIndex(
    (receipt) => receipt.id === receiptId,
  );
  if (validationIndex < 0) return undefined;

  return observedState.receipts
    .slice(validationIndex + 1)
    .findLast(
      (receipt) =>
        receipt.success &&
        !receipt.reused &&
        !receipt.unchanged &&
        (receipt.projection.artifacts?.length ?? 0) > 0,
    );
}

function isPptxCompletion(
  deliverableContract: DeliverableContract | undefined,
  criteria: CriterionView[],
) {
  return (
    /pptx|presentation|slide deck/i.test(deliverableContract?.type ?? "") ||
    criteria.some((criterion) =>
      /pptx/i.test(`${criterion.id} ${criterion.target}`),
    )
  );
}

function targetTerms(
  deliverableContract: DeliverableContract | undefined,
  criteria: CriterionView[],
) {
  const values = [
    deliverableContract?.type ?? "",
    ...criteria.flatMap((criterion) => [criterion.id, criterion.target]),
  ];

  return new Set(
    values
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff.-]+/))
      .map((value) => value.trim())
      .filter(
        (value) => value.length >= 3 && !NON_DELIVERABLE_TERMS.has(value),
      ),
  );
}

function errorCoversDeliverable({
  criteria,
  deliverableContract,
  error,
  observedState,
}: {
  criteria: CriterionView[];
  deliverableContract?: DeliverableContract;
  error: ErrorReceipt;
  observedState: ObservedState;
}) {
  const receipt = observedState.receipts.find(
    (candidate) => candidate.id === error.receiptId,
  );
  const hasMaterialDeliverable = criteria.some(
    (criterion) =>
      criterion.required &&
      ["artifact", "page-count", "verification"].includes(criterion.kind),
  );

  if (
    hasMaterialDeliverable &&
    (receipt?.category === "artifact" || receipt?.category === "verification")
  ) {
    return true;
  }

  if (
    criteria.some(
      (criterion) =>
        criterion.required && criterion.evidenceRefs.includes(error.receiptId),
    )
  ) {
    return true;
  }

  const searchable = [
    error.message,
    error.strategySignature,
    error.toolName,
    receipt?.inputSummary ?? "",
    receipt?.resultSummary ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return [...targetTerms(deliverableContract, criteria)].some((target) =>
    searchable.includes(target),
  );
}

function collectAcceptanceIssues({
  acceptanceSnapshot,
  deliverableContract,
  observedState,
}: CompletionStateInput) {
  const criteria = criterionViews({ acceptanceSnapshot, deliverableContract });
  const knownRefs = knownEvidenceRefs(observedState);
  const issues: FinalizationGuardIssue[] = [];

  for (const criterion of criteria.filter((candidate) => candidate.required)) {
    if (criterion.status === "waived") {
      if (!criterion.waivedByUserMessageId?.trim()) {
        issues.push({
          code: "acceptance_gap",
          criterionId: criterion.id,
          message: `${criterion.id} 被标记为 waived，但缺少用户明确豁免依据。`,
        });
      }
      continue;
    }

    if (criterion.status !== "passed") {
      issues.push({
        code: "acceptance_gap",
        criterionId: criterion.id,
        message: `${criterion.id}: ${criterion.description} (${criterion.status})`,
      });
      continue;
    }

    if (criterion.evidenceRefs.length === 0) {
      issues.push({
        code: "missing_evidence",
        criterionId: criterion.id,
        message: `${criterion.id} 已标记 passed，但缺少客观 evidenceRefs。`,
      });
      continue;
    }

    for (const evidenceRef of criterion.evidenceRefs) {
      if (!knownRefs.has(evidenceRef)) {
        issues.push({
          code: "missing_evidence",
          criterionId: criterion.id,
          evidenceRef,
          message: `${criterion.id} 引用了当前现场中不存在的证据 ${evidenceRef}。`,
        });
      }
    }
  }

  for (const gap of acceptanceSnapshot.gap) {
    const criterionId = gap.split(":", 1)[0]?.trim();
    if (
      criterionId &&
      issues.some(
        (issue) =>
          issue.code === "acceptance_gap" &&
          issue.criterionId === criterionId,
      )
    ) {
      continue;
    }
    issues.push({
      code: "acceptance_gap",
      ...(criterionId ? { criterionId } : {}),
      message: gap,
    });
  }

  if (isPptxCompletion(deliverableContract, criteria)) {
    const pptx = latestArtifact(observedState, "pptx");
    const pptxValidationCriterion = criteria.find(
      (criterion) =>
        criterion.required &&
        criterion.kind === "verification" &&
        /pptx/i.test(`${criterion.id} ${criterion.target}`) &&
        criterion.status !== "waived",
    );
    const validationCriterion =
      pptxValidationCriterion ??
      criteria.find(
        (criterion) =>
          criterion.required &&
          criterion.kind === "verification" &&
          criterion.status !== "waived",
      );
    const validation = validationCriterion
      ? latestVerification(observedState, validationCriterion.target)
      : undefined;
    const laterArtifactMutation = validation?.passed
      ? latestArtifactMutationAfter(observedState, validation.receiptId)
      : undefined;

    if (
      pptx?.status !== "validated" ||
      (validationCriterion && !validation?.passed) ||
      laterArtifactMutation
    ) {
      issues.push({
        code: "pptx_not_validated",
        criterionId: validationCriterion?.id ?? "pptx",
        message: laterArtifactMutation
          ? `PPTX 验证后又发生工件变化（${laterArtifactMutation.toolName}），需要重新导出并验证当前版本。`
          : pptx
            ? `当前 PPTX 状态为 ${pptx.status}，仍需有效验证回执。`
            : "当前现场缺少 validated PPTX 工件。",
        ...(laterArtifactMutation?.id
          ? { receiptId: laterArtifactMutation.id }
          : pptx?.receiptId
            ? { receiptId: pptx.receiptId }
            : {}),
      });
    }

    const pageCriterion = criteria.find(
      (criterion) =>
        criterion.required &&
        criterion.kind === "page-count" &&
        criterion.status !== "waived" &&
        typeof criterion.minimumCount === "number",
    );

    if (pageCriterion) {
      const pageVerification = latestVerification(
        observedState,
        pageCriterion.target,
      );
      const expected = pageCriterion.minimumCount ?? 0;
      const observedCounts = [pageVerification?.slideCount, pptx?.count].filter(
        (count): count is number => typeof count === "number",
      );
      const exact =
        Boolean(pageVerification?.passed) &&
        pageVerification?.slideCount === expected &&
        observedCounts.every((count) => count === expected);

      if (!exact) {
        issues.push({
          code: "pptx_page_count_mismatch",
          criterionId: pageCriterion.id,
          message:
            observedCounts.length > 0
              ? `PPTX 需要恰好 ${expected} 页，当前验证现场记录为 ${[...new Set(observedCounts)].join("/")} 页。`
              : `PPTX 需要恰好 ${expected} 页，当前现场缺少可用页数验证。`,
          ...(pageVerification?.receiptId
            ? { receiptId: pageVerification.receiptId }
            : {}),
        });
      }
    }
  }

  for (const error of observedState.unresolvedErrors.filter(
    (candidate) => !candidate.resolved,
  )) {
    if (
      errorCoversDeliverable({
        criteria,
        deliverableContract,
        error,
        observedState,
      })
    ) {
      issues.push({
        code: "unresolved_deliverable_error",
        message: `交付物仍有未解决错误：${error.message}`,
        receiptId: error.receiptId,
      });
    }
  }

  return uniqueIssues(issues);
}

export function collectCompletionIssues(input: CompletionStateInput) {
  return collectAcceptanceIssues(input);
}

function isTruncatedStopReason(stopReason: string | null | undefined) {
  return /max[_ -]?(?:output[_ -]?)?tokens?|length|incomplete|truncat/i.test(
    stopReason ?? "",
  );
}

function feedbackForGuard(
  issues: FinalizationGuardIssue[],
  nextAction: "continue_tools" | "repair_final",
  activeAttempt?: PlanAttemptRecord | null,
) {
  return [
    "Internal completion guard:",
    "最终交付条件尚未满足，当前回答不会作为完成结果提交。",
    activeAttempt
      ? `当前 attempt：${activeAttempt.id} (${activeAttempt.status})`
      : "",
    ...issues.map((issue) => `- ${issue.message}`),
    nextAction === "continue_tools"
      ? "继续使用现有研究、观察、工件或验证工具缩小客观缺口；保留当前现场和最近因果过程。"
      : "交付现场已满足验收，请基于现有事实修复或续写最终说明。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function decideFinalization({
  acceptanceSnapshot,
  activeAttempt,
  deliverableContract,
  observedState,
  stopReason,
  visibleContent,
}: FinalizationInput): FinalizationDecision {
  const issues = collectCompletionIssues({
    acceptanceSnapshot,
    deliverableContract,
    observedState,
  });
  const normalizedContent = visibleContent.trim();

  if (!normalizedContent) {
    issues.push({
      code: "empty_final",
      message: "模型没有产生可交付的最终文字说明。",
    });
  } else if (isTruncatedStopReason(stopReason)) {
    issues.push({
      code: "truncated_final",
      message: `最终文字因 stopReason=${stopReason} 截断。`,
    });
  }

  const normalizedIssues = uniqueIssues(issues);
  if (normalizedIssues.length > 0) {
    const hasDeliverableIssue = normalizedIssues.some(
      (issue) =>
        issue.code !== "empty_final" && issue.code !== "truncated_final",
    );
    const nextAction = hasDeliverableIssue
      ? "continue_tools"
      : "repair_final";

    return {
      ...(activeAttempt?.id ? { attemptId: activeAttempt.id } : {}),
      feedback: feedbackForGuard(normalizedIssues, nextAction, activeAttempt),
      finalSynthesisAllowed: false,
      issues: normalizedIssues,
      kind: "guard_retry",
      nextAction,
      observedStateHash: observedState.stateHash,
    };
  }

  const evidenceRefs = acceptanceSnapshot.criteria
    .filter(
      (criterion) => criterion.required && criterion.status === "passed",
    )
    .flatMap((criterion) => criterion.evidenceRefs);

  return {
    completion: {
      ...(activeAttempt?.id ? { attemptId: activeAttempt.id } : {}),
      evidenceRefs: [...new Set(evidenceRefs)],
      observedStateHash: observedState.stateHash,
    },
    finalSynthesisAllowed: true,
    kind: "final",
    message: normalizedContent,
    stopReason: stopReason?.trim() || "completed",
  };
}
