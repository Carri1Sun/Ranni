import type { AcceptanceDelta, AcceptanceSnapshot } from "./acceptance";
import type { ObservedState, ToolReceipt } from "./receipts/types";
import { stableReceiptHash } from "./receipts/registry";

export type StepProgressReceipt = {
  artifactHash?: string;
  deliverableGapAfter: string[];
  deliverableGapBefore: string[];
  informationDeltas: string[];
  informationGain: boolean;
  noMeaningfulProgressStreak: number;
  noObjectiveProgressStreak: number;
  objectiveDeltas: string[];
  objectiveProgress: boolean;
  primaryCategory:
    | "artifact"
    | "diagnostic"
    | "evidence"
    | "failed"
    | "final"
    | "recovery"
    | "regression"
    | "unchanged"
    | "verification";
  regression: boolean;
  regressionDeltas: string[];
  sameStrategyFailureStreak: number;
  stateHash: string;
  strategySignature: string;
};

export class ProgressTracker {
  private noMeaningfulProgressStreak = 0;
  private noObjectiveProgressStreak = 0;
  private sameStrategyFailureStreak = 0;
  private previousStrategySignature = "";
  private seenInformation = new Set<string>();
  private seenObjectiveActions = new Set<string>();

  evaluate({
    acceptanceAfter,
    acceptanceDelta,
    observedState,
    receipts,
  }: {
    acceptanceAfter: AcceptanceSnapshot;
    acceptanceDelta: AcceptanceDelta;
    observedState: ObservedState;
    receipts: ToolReceipt[];
  }): StepProgressReceipt {
    const objectiveDeltas = acceptanceDelta.changed
      .filter((change) => change.to === "passed")
      .map((change) => `${change.id}: ${change.from} -> passed`);
    const pendingArtifactTargets = new Set(
      acceptanceAfter.criteria
        .filter(
          (criterion) =>
            criterion.required &&
            criterion.kind === "artifact" &&
            criterion.status !== "passed" &&
            criterion.status !== "waived",
        )
        .map((criterion) => criterion.target),
    );
    const regressionDeltas = acceptanceDelta.changed
      .filter(
        (change) =>
          change.from === "passed" &&
          change.to !== "passed" &&
          change.to !== "waived",
      )
      .map((change) => `${change.id}: passed -> ${change.to}`);
    const informationDeltas: string[] = [];

    for (const receipt of receipts) {
      if (receipt.unchanged || receipt.category === "state") continue;

      if (receipt.success && !receipt.reused) {
        for (const artifact of receipt.projection.artifacts ?? []) {
          if (
            pendingArtifactTargets.has(artifact.kind) &&
            ["accepted", "prepared", "exported", "validated"].includes(
              artifact.status,
            )
          ) {
            objectiveDeltas.push(
              `artifact ${artifact.kind} advanced: ${artifact.key}`,
            );
          }
        }

        if (
          ["delete_path", "move_path", "write_file"].includes(
            receipt.toolName,
          )
        ) {
          for (const file of receipt.projection.files ?? []) {
            objectiveDeltas.push(
              `file ${file.deleted ? "deleted" : "changed"}: ${file.path}`,
            );
          }
        }

        const successfulCommand = receipt.projection.commands?.find(
          (command) => !command.timedOut && command.exitCode === 0,
        );
        const commandAction = `command:${receipt.strategySignature}`;
        if (
          successfulCommand &&
          !this.seenObjectiveActions.has(commandAction)
        ) {
          this.seenObjectiveActions.add(commandAction);
          objectiveDeltas.push(
            `command completed: ${successfulCommand.command}`,
          );
        }
      }

      if (
        receipt.category === "evidence" ||
        (!receipt.success && !this.seenInformation.has(receipt.resultHash))
      ) {
        const fingerprint = `${receipt.category}:${receipt.resultHash}`;
        if (!this.seenInformation.has(fingerprint)) {
          this.seenInformation.add(fingerprint);
          informationDeltas.push(
            receipt.success
              ? `new ${receipt.category}: ${receipt.resultSummary}`
              : `new diagnostic: ${receipt.resultSummary}`,
          );
        }
      }
    }

    const uniqueObjectiveDeltas = [...new Set(objectiveDeltas)];
    const objectiveProgress = uniqueObjectiveDeltas.length > 0;
    const informationGain = informationDeltas.length > 0;
    const regression = regressionDeltas.length > 0;
    const meaningfulReceipt = receipts.some(
      (receipt) =>
        receipt.success &&
        !receipt.reused &&
        !receipt.unchanged &&
        receipt.category !== "state" &&
        ((receipt.projection.artifacts?.length ?? 0) > 0 ||
          (receipt.projection.commands?.length ?? 0) > 0 ||
          (receipt.projection.evidence?.length ?? 0) > 0 ||
          (receipt.projection.files?.length ?? 0) > 0 ||
          (receipt.projection.verification?.length ?? 0) > 0 ||
          /^(?:inspect_|list_|load_skill$|query_|read_)/.test(
            receipt.toolName,
          )),
    );
    this.noObjectiveProgressStreak = objectiveProgress
      ? 0
      : this.noObjectiveProgressStreak + 1;
    this.noMeaningfulProgressStreak =
      objectiveProgress || meaningfulReceipt
        ? 0
        : this.noMeaningfulProgressStreak + 1;

    const strategySignature = stableReceiptHash(
      receipts.map((receipt) => receipt.strategySignature).sort(),
    );
    const strategyFailed =
      receipts.length > 0 &&
      !objectiveProgress &&
      receipts.every(
        (receipt) =>
          !receipt.success || receipt.unchanged || receipt.category === "state",
      );
    if (strategyFailed && strategySignature === this.previousStrategySignature) {
      this.sameStrategyFailureStreak += 1;
    } else {
      this.sameStrategyFailureStreak = strategyFailed ? 1 : 0;
    }
    this.previousStrategySignature = strategySignature;

    const primaryCategory = regression
      ? "regression"
      : objectiveProgress &&
          receipts.some((receipt) => receipt.category === "verification")
        ? "verification"
        : objectiveProgress
          ? "artifact"
          : informationGain &&
              receipts.some((receipt) => receipt.category === "evidence")
            ? "evidence"
            : informationGain
              ? "diagnostic"
              : receipts.some((receipt) => !receipt.success)
                ? "failed"
                : "unchanged";

    return {
      artifactHash:
        Object.keys(observedState.artifacts).length > 0
          ? stableReceiptHash(observedState.artifacts)
          : undefined,
      deliverableGapAfter: acceptanceAfter.gap,
      deliverableGapBefore: acceptanceDelta.gapBefore,
      informationDeltas,
      informationGain,
      noMeaningfulProgressStreak: this.noMeaningfulProgressStreak,
      noObjectiveProgressStreak: this.noObjectiveProgressStreak,
      objectiveDeltas: uniqueObjectiveDeltas,
      objectiveProgress,
      primaryCategory,
      regression,
      regressionDeltas,
      sameStrategyFailureStreak: this.sameStrategyFailureStreak,
      stateHash: observedState.stateHash,
      strategySignature,
    };
  }
}

export type WatchdogDecision = {
  action: "checkpoint" | "replan" | "review";
  message: string;
  suppressMaintenanceTools: boolean;
} | null;

export function evaluateNoProgressWatchdog(
  progress: StepProgressReceipt,
): WatchdogDecision {
  if (progress.deliverableGapAfter.length === 0) {
    return null;
  }

  if (progress.noMeaningfulProgressStreak === 10) {
    return {
      action: "checkpoint",
      message: [
        "No-progress checkpoint:",
        "连续十轮没有产生客观推进或新的有效信息，当前循环已停止。",
        `交付缺口：${progress.deliverableGapAfter.join("；") || "无"}`,
        "请从保存的现场恢复，并采用能够改变客观状态的新路线。",
      ].join("\n"),
      suppressMaintenanceTools: true,
    };
  }

  if (progress.sameStrategyFailureStreak === 2) {
    return {
      action: "replan",
      message: [
        "Repeated strategy failure:",
        "同一策略连续两轮失败，当前路线已经失去继续复用的依据。",
        `交付缺口：${progress.deliverableGapAfter.join("；") || "无"}`,
        "重新读取当前现场和失败回执，采用不同方法；安全观察、研究、工件和验证能力仍然可用。",
      ].join("\n"),
      suppressMaintenanceTools: true,
    };
  }

  if (progress.noMeaningfulProgressStreak === 6) {
    return {
      action: "replan",
      message: [
        "Strategy reset required:",
        "连续六轮没有产出有效新证据、真实观察或客观工件推进，当前路线需要结束或替代。",
        `交付缺口：${progress.deliverableGapAfter.join("；") || "无"}`,
        "重新读取当前现场和失败证据，选择能够产生有意义进展的方法。",
      ].join("\n"),
      suppressMaintenanceTools: true,
    };
  }

  if (progress.noObjectiveProgressStreak === 6) {
    return {
      action: "review",
      message: [
        "Delivery sufficiency review:",
        "连续六轮没有缩小交付缺口。当前研究或观察仍可能具有有效信息增量。",
        `交付缺口：${progress.deliverableGapAfter.join("；") || "无"}`,
        "判断现有证据是否足以进入工件推进；继续研究时请明确剩余问题和停止条件。",
      ].join("\n"),
      suppressMaintenanceTools: false,
    };
  }

  if (progress.noObjectiveProgressStreak === 3) {
    return {
      action: "review",
      message: [
        "Delivery progress review:",
        "最近三轮没有缩小交付缺口。",
        `当前策略签名：${progress.strategySignature}`,
        `当前交付缺口：${progress.deliverableGapAfter.join("；") || "无"}`,
        "检查研究或观察是否正在回答未解决问题，并明确下一项能够缩小交付缺口的动作。",
      ].join("\n"),
      suppressMaintenanceTools: false,
    };
  }

  return null;
}
