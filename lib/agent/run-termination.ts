import type { AgentRuntimeServices } from "./runtime-services";
import type { AgentEventSink } from "./event-sink";
import {
  createAgentRunRecoverySnapshot,
  type AgentRunState,
} from "./run-state";
import { decideRecovery } from "./recovery-controller";
import { StepExecutionError } from "./step-runner";
import type { RunAgentTurnResult } from "./types";

type TerminalStatus = Extract<
  RunAgentTurnResult["status"],
  "cancelled" | "failed"
>;

export function createRunTerminator({
  runId,
  sessionId,
  signal,
  sink,
  startedAt,
  state,
  taskMemory,
  workspaceRoot,
}: {
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  sink: AgentEventSink;
  startedAt: number;
  state: AgentRunState;
  taskMemory: AgentRuntimeServices["taskMemory"];
  workspaceRoot?: string;
}) {
  function complete(
    finalMessage: string,
    totalSteps = state.completedSteps,
  ): RunAgentTurnResult {
    const endedAt = Date.now();
    sink.emit({
      durationMs: endedAt - startedAt,
      endedAt,
      finalAssistantMessage: finalMessage,
      runId,
      status: "completed",
      totalSteps,
      type: "run_completed",
    });
    return { finalMessage, status: "completed", totalSteps };
  }

  function fail({
    checkpoint,
    error,
    status = "failed",
    totalSteps = state.completedSteps,
    recoverable = false,
  }: {
    checkpoint?: RunAgentTurnResult["checkpoint"];
    error: string;
    status?: TerminalStatus;
    totalSteps?: number;
    recoverable?: boolean;
  }): RunAgentTurnResult {
    const endedAt = Date.now();
    sink.emit({
      durationMs: endedAt - startedAt,
      endedAt,
      error,
      runId,
      status,
      totalSteps,
      type: "run_completed",
    });
    return {
      ...(checkpoint ? { checkpoint } : {}),
      error,
      ...(recoverable ? { recoverable: true } : {}),
      status,
      totalSteps,
    };
  }

  async function recover(
    error: unknown,
    currentStepIndex: number,
  ): Promise<RunAgentTurnResult> {
    const stepError =
      error instanceof StepExecutionError ? error.cause : error;
    const acceptanceSnapshot = state.acceptance.snapshot();
    const runStateSnapshot = createAgentRunRecoverySnapshot(state);
    const decision = decideRecovery({
      abort: signal,
      acceptanceSnapshot,
      attempt: state.attempts.active(),
      causalTailSnapshotHash:
        error instanceof StepExecutionError
          ? error.contextSnapshotHash
          : state.contextSnapshotHash,
      error: stepError,
      observedState: state.receiptRegistry.snapshot(),
      runState: runStateSnapshot,
    });
    const stepId =
      error instanceof StepExecutionError ? error.stepId : crypto.randomUUID();
    const stepIndex =
      error instanceof StepExecutionError ? error.stepIndex : currentStepIndex;

    let checkpointRef: string | undefined;
    if (decision.kind === "failed" && decision.recoverable) {
      try {
        await taskMemory.saveCheckpoint({
          nextAction: decision.resumeInstruction,
          recoveryState: decision.checkpoint.runState,
          summary: [
            decision.message,
            ...decision.gaps.map((gap) => `- ${gap}`),
          ].join("\n"),
          title: "Provider recovery checkpoint",
        });
        checkpointRef = taskMemory.getStatus().latestCheckpointPath ?? undefined;
      } catch (checkpointError) {
        sink.emit({
          message: `恢复检查点写入失败，运行现场仍保留在内存和 workspace：${
            checkpointError instanceof Error
              ? checkpointError.message
              : String(checkpointError)
          }`,
          runId,
          timestamp: Date.now(),
          type: "status",
        });
      }
    }

    const activeAttemptId = state.attempts.active()?.id;
    sink.publishTrace({
      acceptanceGap: acceptanceSnapshot.gap,
      checkpoint: {
        ...(activeAttemptId ? { activeAttemptId } : {}),
        ...(checkpointRef ? { checkpointRef } : {}),
        completedSteps: state.completedSteps,
        planRevision: state.planLedger.snapshot().revision,
        schemaVersion: runStateSnapshot.schemaVersion,
      },
      contextSnapshotHash: decision.checkpoint.causalTailSnapshotHash,
      error: decision.error.message,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "recovery.started",
    });

    if (decision.kind === "final_recovery") {
      sink.startText(stepId, stepIndex);
      sink.emit({
        message: decision.message,
        runId,
        stepId,
        stepIndex,
        type: "assistant",
      });
      return complete(
        decision.message,
        Math.max(state.completedSteps, stepIndex),
      );
    }

    return fail({
      checkpoint: {
        acceptanceGap: acceptanceSnapshot.gap,
        contextSnapshotHash: decision.checkpoint.causalTailSnapshotHash,
        ...(decision.checkpoint.runState
          ? { runState: decision.checkpoint.runState }
          : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      },
      error: decision.message,
      recoverable: decision.kind === "failed" && decision.recoverable,
      status: decision.kind === "cancelled" ? "cancelled" : "failed",
      totalSteps: Math.max(state.completedSteps, stepIndex),
    });
  }

  return { complete, fail, recover };
}
