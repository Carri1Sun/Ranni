import type { StepProgressReceipt } from "./progress";

export type PlanAttemptRecord = {
  approach: string;
  assumptionIds: string[];
  endedAtStep?: number;
  evidenceRefs: string[];
  exitCriteria: string[];
  id: string;
  startedAtStep: number;
  status: "abandoned" | "active" | "failed" | "succeeded" | "superseded";
  supersededBy?: string;
  transitionReason?: string;
};

export type AssumptionRecord = {
  evidenceRefs: string[];
  id: string;
  statement: string;
  status: "active" | "rejected" | "superseded" | "validated";
  supersededBy?: string;
};

export type AttemptDelta = {
  activeAttemptId: string;
  abandoned?: string;
  created?: string;
  failed?: string;
  invalidatedAssumptionIds?: string[];
  succeeded?: string;
  superseded?: string;
};

export type PlanAttemptLedgerSnapshot = {
  assumptions: AssumptionRecord[];
  attempts: PlanAttemptRecord[];
};

export class PlanAttemptLedger {
  private attempts: PlanAttemptRecord[] = [];
  private assumptions: AssumptionRecord[] = [];

  constructor(initialApproach = "自主选择能够推进用户目标的路线") {
    this.attempts.push({
      approach: initialApproach,
      assumptionIds: [],
      evidenceRefs: [],
      exitCriteria: ["交付缺口缩小", "路线被证伪或持续无进展"],
      id: crypto.randomUUID(),
      startedAtStep: 0,
      status: "active",
    });
  }

  active() {
    return this.attempts.findLast((attempt) => attempt.status === "active");
  }

  private createActive(
    approach: string,
    stepIndex: number,
    exitCriteria: string[] = [],
  ) {
    const next: PlanAttemptRecord = {
      approach: approach.replace(/\s+/g, " ").trim(),
      assumptionIds: [],
      evidenceRefs: [],
      exitCriteria: [
        ...new Set(
          exitCriteria
            .map((criterion) => criterion.replace(/\s+/g, " ").trim())
            .filter(Boolean),
        ),
      ],
      id: crypto.randomUUID(),
      startedAtStep: stepIndex,
      status: "active",
    };
    this.attempts.push(next);
    return next;
  }

  recordAssumptions(statements: string[]) {
    const activeAttempt = this.active();
    const ids: string[] = [];
    for (const statement of statements) {
      const normalized = statement.replace(/\s+/g, " ").trim();
      if (!normalized) continue;
      const rejected = this.assumptions.findLast(
        (assumption) =>
          assumption.statement === normalized &&
          assumption.status === "rejected",
      );
      if (rejected) continue;
      const existing = this.assumptions.findLast(
        (assumption) =>
          assumption.statement === normalized &&
          assumption.status !== "rejected" &&
          assumption.status !== "superseded",
      );
      const assumption =
        existing ??
        ({
          evidenceRefs: [],
          id: crypto.randomUUID(),
          statement: normalized,
          status: "active",
        } satisfies AssumptionRecord);
      if (!existing) this.assumptions.push(assumption);
      ids.push(assumption.id);
      if (
        activeAttempt &&
        !activeAttempt.assumptionIds.includes(assumption.id)
      ) {
        activeAttempt.assumptionIds.push(assumption.id);
      }
    }
    return ids;
  }

  propose(
    approach: string,
    stepIndex: number,
    exitCriteria: string[] = [],
    transitionReason = "模型采用了实质不同的工作方法。",
  ) {
    const current = this.active();
    const normalizedApproach = approach.replace(/\s+/g, " ").trim();
    const normalizedExitCriteria = [
      ...new Set(
        exitCriteria
          .map((criterion) => criterion.replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    ];
    if (
      current &&
      current.approach.replace(/\s+/g, " ").trim() === normalizedApproach &&
      JSON.stringify(current.exitCriteria) ===
        JSON.stringify(normalizedExitCriteria)
    ) {
      return current;
    }
    const next = this.createActive(approach, stepIndex, exitCriteria);
    if (current) {
      current.status = "superseded";
      current.endedAtStep = stepIndex;
      current.supersededBy = next.id;
      current.transitionReason = transitionReason;
    }
    return next;
  }

  succeed(
    stepIndex: number,
    evidenceRefs: string[] = [],
    transitionReason = "验收条件已经由客观回执满足。",
  ): AttemptDelta | null {
    const current = this.active();
    if (!current) return null;

    current.status = "succeeded";
    current.endedAtStep = stepIndex;
    current.transitionReason = transitionReason;
    current.evidenceRefs = [
      ...new Set([...current.evidenceRefs, ...evidenceRefs.filter(Boolean)]),
    ];
    for (const assumptionId of current.assumptionIds) {
      const assumption = this.assumptions.find((item) => item.id === assumptionId);
      if (!assumption || assumption.status !== "active") continue;
      assumption.status = "validated";
      assumption.evidenceRefs = [
        ...new Set([...assumption.evidenceRefs, ...evidenceRefs.filter(Boolean)]),
      ];
    }

    return { activeAttemptId: current.id, succeeded: current.id };
  }

  abandon(
    stepIndex: number,
    transitionReason: string,
  ): AttemptDelta | null {
    const current = this.active();
    if (!current) return null;
    current.status = "abandoned";
    current.endedAtStep = stepIndex;
    current.transitionReason = transitionReason.trim();
    return { abandoned: current.id, activeAttemptId: current.id };
  }

  observe(progress: StepProgressReceipt, stepIndex: number): AttemptDelta {
    const current = this.active();
    if (!current) {
      const created = this.propose("根据当前现场重新选择路线", stepIndex);
      return { activeAttemptId: created.id, created: created.id };
    }

    if (progress.objectiveProgress) {
      current.evidenceRefs = [
        ...new Set([...current.evidenceRefs, progress.stateHash]),
      ];
      return { activeAttemptId: current.id };
    }

    if (
      progress.sameStrategyFailureStreak === 2 ||
      progress.noMeaningfulProgressStreak === 6
    ) {
      current.status = "failed";
      current.endedAtStep = stepIndex;
      current.transitionReason =
        "重复真实失败或持续缺少有意义进展的回执证伪了当前方法。";
      current.evidenceRefs.push(progress.stateHash);
      const invalidatedAssumptionIds = current.assumptionIds.filter((id) => {
        const assumption = this.assumptions.find((item) => item.id === id);
        if (!assumption || assumption.status !== "active") return false;
        assumption.status = "rejected";
        assumption.evidenceRefs.push(progress.stateHash);
        return true;
      });
      const next = this.createActive("重新读取现场并采用替代路线", stepIndex, [
        "产生新的客观回执",
        "避免复用已失败的策略签名",
      ]);
      current.supersededBy = next.id;
      return {
        activeAttemptId: next.id,
        created: next.id,
        failed: current.id,
        ...(invalidatedAssumptionIds.length > 0
          ? { invalidatedAssumptionIds }
          : {}),
      };
    }

    return { activeAttemptId: current.id };
  }

  snapshot(): PlanAttemptLedgerSnapshot {
    return {
      assumptions: structuredClone(this.assumptions),
      attempts: structuredClone(this.attempts),
    };
  }

  restore(snapshot: PlanAttemptLedgerSnapshot) {
    this.assumptions = structuredClone(snapshot.assumptions);
    this.attempts = structuredClone(snapshot.attempts);
  }
}
