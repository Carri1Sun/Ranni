import type { ObservedState } from "./receipts/types";

export type AcceptanceStatus =
  | "failed"
  | "passed"
  | "pending"
  | "unknown"
  | "waived";

export type AcceptanceCriterion = {
  evidenceRefs: string[];
  id: string;
  kind: "artifact" | "command" | "file" | "page-count" | "verification";
  lastCheckedAt?: string;
  minimumCount?: number;
  required: boolean;
  status: AcceptanceStatus;
  target: string;
  description: string;
  waivedByUserMessageId?: string;
};

export type DeliverableContract = {
  criteria: Array<
    Omit<
      AcceptanceCriterion,
      "evidenceRefs" | "lastCheckedAt" | "status" | "waivedByUserMessageId"
    >
  >;
  textOnly: boolean;
  type: string;
  verificationRequired: boolean;
};

export type AcceptanceDelta = {
  changed: Array<{
    from: AcceptanceStatus;
    id: string;
    to: AcceptanceStatus;
  }>;
  gapAfter: string[];
  gapBefore: string[];
};

export type AcceptanceSnapshot = {
  criteria: AcceptanceCriterion[];
  gap: string[];
};

function criterionEvidence(
  criterion: AcceptanceCriterion,
  observed: ObservedState,
) {
  if (criterion.kind === "artifact") {
    const matches = Object.values(observed.artifacts).filter(
      (artifact) => artifact.kind === criterion.target,
    );
    const accepted = matches.filter((artifact) =>
      ["accepted", "prepared", "exported", "validated"].includes(
        artifact.status,
      ),
    );
    const minimumCount = criterion.minimumCount ?? 1;
    return {
      evidenceRefs: accepted.map((artifact) => artifact.receiptId),
      passed: accepted.length >= minimumCount,
      status: accepted.length >= minimumCount ? "passed" : "pending",
    } as const;
  }

  if (criterion.kind === "file") {
    const files = Object.values(observed.files).filter((file) => !file.deleted);
    const minimumCount = criterion.minimumCount ?? 1;
    return {
      evidenceRefs: files.map((file) => file.receiptId),
      passed: files.length >= minimumCount,
      status: files.length >= minimumCount ? "passed" : "pending",
    } as const;
  }

  if (criterion.kind === "command") {
    const commands = observed.commands.filter(
      (command) =>
        !command.timedOut &&
        command.exitCode === 0 &&
        /(?:test|typecheck|lint|build|check|verify|validate|pytest|\btsc\b|eslint)/i.test(
          command.command,
        ),
    );
    const minimumCount = criterion.minimumCount ?? 1;
    return {
      evidenceRefs: commands.map((command) => command.receiptId),
      passed: commands.length >= minimumCount,
      status: commands.length >= minimumCount ? "passed" : "pending",
    } as const;
  }

  if (criterion.kind === "verification") {
    const relevant = observed.verification.filter(
      (verification) => verification.scope === criterion.target,
    );
    const latest = relevant.at(-1);
    const verificationReceiptIndex = latest
      ? observed.receipts.findIndex(
          (receipt) => receipt.id === latest.receiptId,
        )
      : -1;
    const invalidated =
      Boolean(latest?.passed) &&
      verificationReceiptIndex >= 0 &&
      observed.receipts
        .slice(verificationReceiptIndex + 1)
        .some(
          (receipt) =>
            receipt.success &&
            !receipt.reused &&
            !receipt.unchanged &&
            ((receipt.projection.artifacts?.length ?? 0) > 0 ||
              (receipt.projection.files?.length ?? 0) > 0),
        );

    return {
      evidenceRefs: latest && !invalidated ? [latest.receiptId] : [],
      passed: Boolean(latest?.passed && !invalidated),
      status: invalidated
        ? "pending"
        : latest?.passed
          ? "passed"
          : latest
            ? "failed"
            : "pending",
    } as const;
  }

  const relevant = observed.verification.filter(
    (verification) => verification.scope === criterion.target,
  );
  const expected = criterion.minimumCount ?? 1;
  const latest = relevant.at(-1);
  const verificationReceiptIndex = latest
    ? observed.receipts.findIndex(
        (receipt) => receipt.id === latest.receiptId,
      )
    : -1;
  const invalidated =
    Boolean(latest?.passed) &&
    verificationReceiptIndex >= 0 &&
    observed.receipts
      .slice(verificationReceiptIndex + 1)
      .some(
        (receipt) =>
          receipt.success &&
          !receipt.reused &&
          !receipt.unchanged &&
          ((receipt.projection.artifacts?.length ?? 0) > 0 ||
            (receipt.projection.files?.length ?? 0) > 0),
      );
  const exact =
    latest?.passed && latest.slideCount === expected && !invalidated;
  const mismatch =
    latest?.passed &&
    typeof latest.slideCount === "number" &&
    latest.slideCount !== expected;

  return {
    evidenceRefs: latest && !invalidated ? [latest.receiptId] : [],
    passed: Boolean(exact),
    status: exact
      ? "passed"
      : mismatch || (latest && !latest.passed)
        ? "failed"
        : "pending",
  } as const;
}

function gap(criteria: AcceptanceCriterion[]) {
  return criteria
    .filter(
      (criterion) =>
        criterion.required &&
        criterion.status !== "passed" &&
        criterion.status !== "waived",
    )
    .map((criterion) => `${criterion.id}: ${criterion.description} (${criterion.status})`);
}

export class AcceptanceLedger {
  private criteria: AcceptanceCriterion[];

  constructor(contract: DeliverableContract) {
    this.criteria = contract.criteria.map((criterion) => ({
      ...criterion,
      evidenceRefs: [],
      status: "pending",
    }));
  }

  reconcile(observed: ObservedState): AcceptanceDelta {
    const gapBefore = gap(this.criteria);
    const changed: AcceptanceDelta["changed"] = [];

    this.criteria = this.criteria.map((criterion) => {
      if (criterion.status === "waived") return criterion;
      const evaluation = criterionEvidence(criterion, observed);
      if (evaluation.status !== criterion.status) {
        changed.push({
          from: criterion.status,
          id: criterion.id,
          to: evaluation.status,
        });
      }
      return {
        ...criterion,
        evidenceRefs: evaluation.evidenceRefs,
        lastCheckedAt: new Date().toISOString(),
        status: evaluation.status,
      };
    });

    return { changed, gapAfter: gap(this.criteria), gapBefore };
  }

  waive(criterionId: string, userMessageId: string) {
    const criterion = this.criteria.find((item) => item.id === criterionId);
    if (!criterion) return false;
    criterion.status = "waived";
    criterion.waivedByUserMessageId = userMessageId;
    return true;
  }

  snapshot(): AcceptanceSnapshot {
    const criteria = structuredClone(this.criteria);
    return { criteria, gap: gap(criteria) };
  }

  restore(snapshot: AcceptanceSnapshot) {
    this.criteria = structuredClone(snapshot.criteria);
  }
}

export function createTextDeliverableContract(): DeliverableContract {
  return {
    criteria: [],
    textOnly: true,
    type: "text",
    verificationRequired: false,
  };
}

export function createWorkspaceArtifactContract({
  verificationRequired = false,
}: {
  verificationRequired?: boolean;
} = {}): DeliverableContract {
  return {
    criteria: [
      {
        description: "用户要求的 workspace 文件已经由成功工具回执确认",
        id: "workspace-files",
        kind: "file",
        required: true,
        target: "workspace",
      },
      ...(verificationRequired
        ? [
            {
              description: "至少一项验证命令已成功完成",
              id: "workspace-verification",
              kind: "command" as const,
              required: true,
              target: "workspace",
            },
          ]
        : []),
    ],
    textOnly: false,
    type: "workspace-artifact",
    verificationRequired,
  };
}
