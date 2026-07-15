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
  created?: string;
  failed?: string;
  invalidatedAssumptionIds?: string[];
  superseded?: string;
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

  propose(approach: string, stepIndex: number, exitCriteria: string[] = []) {
    const current = this.active();
    const next: PlanAttemptRecord = {
      approach: approach.trim(),
      assumptionIds: [],
      evidenceRefs: [],
      exitCriteria,
      id: crypto.randomUUID(),
      startedAtStep: stepIndex,
      status: "active",
    };
    if (current) {
      current.status = "superseded";
      current.endedAtStep = stepIndex;
      current.supersededBy = next.id;
    }
    this.attempts.push(next);
    return next;
  }

  observe(progress: StepProgressReceipt, stepIndex: number): AttemptDelta {
    const current = this.active();
    if (!current) {
      const created = this.propose("根据当前现场重新选择路线", stepIndex);
      return { activeAttemptId: created.id, created: created.id };
    }

    if (progress.objectiveProgress) {
      current.evidenceRefs.push(progress.stateHash);
      return { activeAttemptId: current.id };
    }

    if (
      progress.sameStrategyFailureStreak === 2 ||
      progress.noMeaningfulProgressStreak === 6
    ) {
      current.status = "failed";
      current.endedAtStep = stepIndex;
      current.evidenceRefs.push(progress.stateHash);
      const invalidatedAssumptionIds = current.assumptionIds.filter((id) => {
        const assumption = this.assumptions.find((item) => item.id === id);
        if (!assumption || assumption.status !== "active") return false;
        assumption.status = "rejected";
        assumption.evidenceRefs.push(progress.stateHash);
        return true;
      });
      const next = this.propose("重新读取现场并采用替代路线", stepIndex, [
        "产生新的客观回执",
        "避免复用已失败的策略签名",
      ]);
      return {
        activeAttemptId: next.id,
        created: next.id,
        failed: current.id,
        ...(invalidatedAssumptionIds.length > 0
          ? { invalidatedAssumptionIds }
          : {}),
        superseded: current.id,
      };
    }

    return { activeAttemptId: current.id };
  }

  snapshot() {
    return {
      assumptions: structuredClone(this.assumptions),
      attempts: structuredClone(this.attempts),
    };
  }
}
