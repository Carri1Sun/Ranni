import {
  buildMessageRequest,
  createMessage,
  getModelRuntimeInfo,
  type AgentAssistantBlock,
  type AgentMessage,
  type ModelConnectionConfig,
} from "../llm";
import { composeContext } from "../context/composer";
import { createHarnessSystemPrompt } from "../context/system-prompt";
import {
  createTraceContextSnapshot,
  toTraceToolDefinitions,
} from "../context/trace-snapshot";
import type { AgentEventSink } from "./event-sink";
import type { RunPolicySet } from "./policy";
import {
  applyRunTaskPatch,
  buildWorkingSet,
  reconcileDeliverableContract,
  reconcileTaskStateFromObserved,
  type AgentRunState,
} from "./run-state";
import {
  assertNotAborted,
  PacedTextEmitter,
} from "./streaming";
import { executeToolBatch } from "./tool-batch-executor";
import type { StepOutcome } from "./types";
import type { TaskMemory } from "../task-memory";
import { buildSkillRuntimeInstructions } from "../skills/runtime-instructions";
import { listSkillIndices } from "../skills/registry";
import type { ToolSettings } from "../tools";
import { decideFinalization } from "./finalization-controller";
import { evaluateNoProgressWatchdog } from "../progress";
import type { ToolReceipt } from "../receipts/types";
import type { AgentRuntimeServices } from "./runtime-services";
import {
  createChunkedFinalStartMessage,
  createChunkedFinalState,
  decideChunkedFinal,
} from "./chunked-final-controller";

const MAX_TOOL_STEPS = 500;

export class StepExecutionError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
    readonly contextSnapshotHash: string,
    readonly stepId: string,
    readonly stepIndex: number,
  ) {
    super(message);
    this.name = "StepExecutionError";
  }
}

function getText(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getThinking(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getToolCalls(blocks: AgentAssistantBlock[]) {
  return blocks.filter((block) => block.type === "tool_use");
}

function getModelPlanProposal(receipts: ToolReceipt[]) {
  const receipt = receipts.findLast(
    (candidate) =>
      candidate.toolName === "update_task_state" &&
      candidate.success &&
      !candidate.unchanged &&
      typeof candidate.input === "object" &&
      candidate.input !== null &&
      Array.isArray((candidate.input as Record<string, unknown>).plan) &&
      ((candidate.input as Record<string, unknown>).plan as unknown[]).some(
        (item) => typeof item === "string" && Boolean(item.trim()),
      ),
  );
  if (!receipt || typeof receipt.input !== "object" || receipt.input === null) {
    return null;
  }
  const input = receipt.input as Record<string, unknown>;
  const plan = Array.isArray(input.plan)
    ? input.plan.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
  if (plan.length === 0) return null;
  return {
    approach: plan.map((item, index) => `${index + 1}. ${item.trim()}`).join(" "),
    exitCriteria: [
      "产生能够缩小验收缺口的客观回执",
      "路线被回执证伪或持续没有客观进展时重新选择方法",
    ],
  };
}

function getModelAssumptions(receipts: ToolReceipt[]) {
  const receipt = receipts.findLast(
    (candidate) =>
      candidate.toolName === "update_task_state" &&
      candidate.success &&
      !candidate.unchanged &&
      typeof candidate.input === "object" &&
      candidate.input !== null &&
      Array.isArray(
        (candidate.input as Record<string, unknown>).assumptions,
      ) &&
      (
        (candidate.input as Record<string, unknown>).assumptions as unknown[]
      ).some((item) => typeof item === "string" && Boolean(item.trim())),
  );
  if (!receipt || typeof receipt.input !== "object" || receipt.input === null) {
    return [];
  }
  const assumptions = (receipt.input as Record<string, unknown>).assumptions;
  return Array.isArray(assumptions)
    ? assumptions.filter(
        (item): item is string => typeof item === "string" && Boolean(item.trim()),
      )
    : [];
}

async function recordReceiptMemory(
  taskMemory: TaskMemory,
  receipt: ToolReceipt,
) {
  if (receipt.success) return;
  const command =
    receipt.toolName === "run_terminal" &&
    typeof receipt.input === "object" &&
    receipt.input !== null &&
    "command" in receipt.input &&
    typeof receipt.input.command === "string"
      ? receipt.input.command
      : "";
  const commandReceipt = receipt.projection.commands?.[0];
  await taskMemory.recordError({
    command,
    exitCode: commandReceipt?.exitCode ?? null,
    nextAction: "读取失败回执与当前现场，调整路线后继续。",
    relevantOutput: receipt.resultSummary,
    toolName: receipt.toolName,
  });
}

async function emitFinalMessage({
  message,
  runId,
  signal,
  sink,
  stepId,
  stepIndex,
}: {
  message: string;
  runId: string;
  signal?: AbortSignal;
  sink: AgentEventSink;
  stepId: string;
  stepIndex: number;
}) {
  sink.startText(stepId, stepIndex);
  const emitter = new PacedTextEmitter((delta) => {
    sink.emit({
      delta,
      runId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      type: "assistant_delta",
    });
  }, signal);
  emitter.enqueue(message);
  await emitter.drain();
  sink.emit({ message, runId, stepId, stepIndex, type: "assistant" });
}

function appendUserControl(state: AgentRunState, text: string) {
  state.conversation.push({
    role: "user",
    content: [{ type: "text", text }],
  });
}

export async function runStep({
  modelConfig,
  policySet,
  researchMode,
  researchNotebook,
  runId,
  sessionId,
  signal,
  sink,
  state,
  steeringMessages,
  stepIndex,
  taskMemory,
  toolSettings,
  workspaceRoot,
}: {
  modelConfig?: ModelConnectionConfig;
  policySet: RunPolicySet;
  researchMode: boolean;
  researchNotebook: AgentRuntimeServices["researchNotebook"];
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  sink: AgentEventSink;
  state: AgentRunState;
  steeringMessages: AgentMessage[];
  stepIndex: number;
  taskMemory: TaskMemory;
  toolSettings?: ToolSettings;
  workspaceRoot?: string;
}): Promise<StepOutcome> {
  if (stepIndex > MAX_TOOL_STEPS) {
    throw new Error(`本轮对话超过最大工具步数 ${MAX_TOOL_STEPS}。`);
  }
  assertNotAborted(signal);
  const stepId = crypto.randomUUID();
  const stepStartedAt = Date.now();
  const activeSkillNames = [...state.loadedSkills];
  const contractChanged = reconcileDeliverableContract(
    state,
    policySet.getDeliverableContract(activeSkillNames),
  );
  if (contractChanged) {
    await taskMemory.syncTaskState(state.taskState);
  }
  const skillIndices = listSkillIndices();
  const activeSkills = skillIndices
    .filter((skill) => activeSkillNames.includes(skill.name))
    .map(({ bodyHash, name, resourcePaths, version }) => ({
      bodyHash,
      name,
      resourcePaths,
      version,
    }));
  const runtime = getModelRuntimeInfo(modelConfig);
  const toolDefinitions = state.chunkedFinal
    ? []
    : policySet
        .getToolDefinitions(activeSkillNames)
        .filter(
          (tool) =>
            tool.name !== "update_task_state" ||
            stepIndex > state.maintenanceToolSuppressedUntilStep,
        );
  const traceToolDefinitions = toTraceToolDefinitions(toolDefinitions);
  const workingSet = buildWorkingSet(state);
  const systemPrompt = createHarnessSystemPrompt({
    activeSkillNames,
    researchMode,
    runtime,
    skillIndices,
    skillRuntimeInstructions: [
      ...buildSkillRuntimeInstructions({ activeSkillNames, toolSettings }),
      ...policySet.getInstructions(activeSkillNames),
    ],
    taskContract: state.taskContract,
    taskMemorySummary: await taskMemory.readSummary(),
    taskState: state.taskState,
    toolNames: toolDefinitions.map((tool) => tool.name),
    workingSet,
    workspaceRoot,
  });
  const envelope = composeContext({
    activeSkillNames,
    activeSkills,
    contextWindow: runtime.contextWindow,
    initialMessageCount: state.initialMessageCount,
    maxOutputTokens: runtime.maxTokens,
    messages: state.conversation,
    ...(state.stablePrefixState
      ? { previousStablePrefixState: state.stablePrefixState }
      : {}),
    steeringMessages,
    stepIndex,
    systemPrompt,
    taskContract: state.taskContract,
    toolDefinitions: traceToolDefinitions,
    workingSet,
  });
  state.contextSnapshotHash = envelope.composition.snapshotHash;
  state.stablePrefixState = envelope.stablePrefixState;
  const context = createTraceContextSnapshot({
    contextWindow: runtime.contextWindow,
    envelope,
  });

  sink.emit({
    runId,
    startedAt: stepStartedAt,
    stepId,
    stepIndex,
    type: "step_started",
  });
  sink.emit({
    runId,
    stepId,
    stepIndex,
    taskState: state.taskState,
    type: "task_state",
  });
  sink.emit({ context, runId, stepId, stepIndex, type: "context_snapshot" });
  sink.emit({
    request: buildMessageRequest({
      messages: envelope.messages,
      modelConfig,
      system: systemPrompt,
      tools: toolDefinitions,
    }),
    runId,
    stepId,
    stepIndex,
    type: "model_request",
  });

  let thinkingStarted = false;
  let streamedThinking = "";
  const thinkingEmitter = new PacedTextEmitter((delta) => {
    sink.emit({
      delta,
      runId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      type: "thinking_delta",
    });
  }, signal);
  const startThinking = () => {
    if (thinkingStarted) return;
    thinkingStarted = true;
    sink.startThinking(stepId, stepIndex);
  };

  let assistantResult: Awaited<ReturnType<typeof createMessage>>;
  try {
    assistantResult = await createMessage({
      messages: envelope.messages,
      modelConfig,
      onRetry: ({ attempt, reason }) => {
        sink.emit({
          message: `${runtime.model} 瞬时故障，正在执行有界重试（${attempt}）：${reason}`,
          runId,
          stepId,
          stepIndex,
          timestamp: Date.now(),
          type: "status",
        });
      },
      onThinkingDelta: ({ delta }) => {
        if (!delta) return;
        startThinking();
        streamedThinking += delta;
        thinkingEmitter.enqueue(delta);
      },
      signal,
      system: systemPrompt,
      tools: toolDefinitions,
    });
  } catch (error) {
    if (streamedThinking) await thinkingEmitter.drain();
    const errorMessage =
      error instanceof Error ? error.message : "模型请求失败。";
    sink.emit({
      durationMs: Date.now() - stepStartedAt,
      endedAt: Date.now(),
      error: errorMessage,
      runId,
      status: signal?.aborted ? "cancelled" : "failed",
      stepId,
      stepIndex,
      stopReason: "provider_failure",
      type: "step_completed",
    });
    throw new StepExecutionError(
      errorMessage,
      error,
      state.contextSnapshotHash,
      stepId,
      stepIndex,
    );
  }

  assertNotAborted(signal);
  const blocks = assistantResult.message.content;
  const thinking = getThinking(blocks);
  const visibleContent = getText(blocks);
  const toolCalls = getToolCalls(blocks);

  if (thinking) {
    const missing = thinking.startsWith(streamedThinking)
      ? thinking.slice(streamedThinking.length)
      : streamedThinking
        ? ""
        : thinking;
    startThinking();
    thinkingEmitter.enqueue(missing);
    await thinkingEmitter.drain();
    sink.emit({
      message: thinking,
      runId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      type: "thinking",
    });
  } else if (streamedThinking) {
    await thinkingEmitter.drain();
  }

  sink.emit({
    response: assistantResult.response,
    runId,
    stepId,
    stepIndex,
    type: "model_response",
  });
  state.conversation.push({ role: "assistant", content: blocks });

  if (toolCalls.length > 0) {
    if (visibleContent) {
      sink.emit({
        message: visibleContent,
        runId,
        stepId,
        stepIndex,
        timestamp: Date.now(),
        type: "status",
      });
    }
    sink.publishTrace({
      count: toolCalls.length,
      runId,
      sessionId,
      stepId,
      stepIndex,
      toolUseIds: toolCalls.map((toolCall) => toolCall.id),
      type: "tool.batch.started",
    });
    const requestedToolNames = new Set(
      toolDefinitions.map((tool) => tool.name),
    );
    const batch = await executeToolBatch({
      advertisedToolNames: requestedToolNames,
      currentToolNames: new Set(
        policySet
          .getToolDefinitions(activeSkillNames)
          .map((tool) => tool.name),
      ),
      executionContext: {
        get taskState() {
          return state.taskState;
        },
        activeSkillNames,
        activateSkill: (name) => state.loadedSkills.add(name),
        researchNotebook,
        signal,
        taskMemory,
        toolSettings,
        updateTaskState: (patch) => applyRunTaskPatch(state, patch),
        workspaceRoot,
      },
      onCompleted: async ({ receipt }) => {
        sink.emit({
          durationMs: receipt.durationMs,
          name: receipt.toolName,
          result: receipt.result,
          runId,
          startedAt: receipt.startedAt,
          stepId,
          stepIndex,
          success: receipt.success,
          toolUseId: receipt.toolUseId,
          type: "tool_result",
        });
        sink.publishTrace({
          receipt,
          runId,
          sessionId,
          stepId,
          stepIndex,
          type: "tool.receipt",
        });
        await recordReceiptMemory(taskMemory, receipt);
      },
      onStarted: ({ startedAt, toolCall }) => {
        sink.emit({
          arguments: toolCall.inputParseError
            ? {
                inputParseError: toolCall.inputParseError,
                rawInput: toolCall.rawInput?.slice(0, 1_600),
              }
            : toolCall.input,
          name: toolCall.name,
          runId,
          startedAt,
          stepId,
          stepIndex,
          toolUseId: toolCall.id,
          type: "tool_call",
        });
      },
      projectors: policySet.getReceiptProjectors(activeSkillNames),
      registry: state.receiptRegistry,
      signal,
      stopReason: assistantResult.response.stopReason,
      toolCalls,
    });
    state.conversation.push({ role: "user", content: batch.toolResults });

    const observedState = state.receiptRegistry.snapshot();
    reconcileTaskStateFromObserved(state, observedState);
    await taskMemory.syncTaskState(state.taskState);
    applyRunTaskPatch(state, { memory: taskMemory.getStatus() });
    const acceptanceDelta = state.acceptance.reconcile(observedState);
    const acceptanceState = state.acceptance.snapshot();
    const progressReceipt = state.progress.evaluate({
      acceptanceAfter: acceptanceState,
      acceptanceDelta,
      observedState,
      receipts: batch.receipts,
    });
    const modelPlanProposal = getModelPlanProposal(batch.receipts);
    if (
      modelPlanProposal &&
      state.attempts.active()?.approach !== modelPlanProposal.approach
    ) {
      const superseded = state.attempts.active()?.id;
      const created = state.attempts.propose(
        modelPlanProposal.approach,
        stepIndex,
        modelPlanProposal.exitCriteria,
      );
      sink.publishTrace({
        attemptDelta: {
          activeAttemptId: created.id,
          created: created.id,
          ...(superseded ? { superseded } : {}),
        },
        runId,
        sessionId,
        stepId,
        stepIndex,
        type: "attempt.updated",
      });
    }
    state.attempts.recordAssumptions(getModelAssumptions(batch.receipts));
    const attemptDelta = state.attempts.observe(progressReceipt, stepIndex);
    const policyObservation = policySet.observeReceipts(batch.receipts);

    sink.publishTrace({
      observedState,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "state.observed.updated",
    });
    sink.publishTrace({
      acceptanceDelta,
      acceptanceState,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "acceptance.updated",
    });
    sink.publishTrace({
      progressReceipt,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "progress.receipt",
    });
    sink.publishTrace({
      attemptDelta,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "attempt.updated",
    });
    if (attemptDelta.invalidatedAssumptionIds?.length) {
      sink.publishTrace({
        assumptionIds: attemptDelta.invalidatedAssumptionIds,
        evidenceRefs: [progressReceipt.stateHash],
        reason: "当前路线被重复真实失败或持续缺少有意义进展的回执证伪。",
        runId,
        sessionId,
        stepId,
        stepIndex,
        type: "assumption.invalidated",
      });
    }
    for (const message of policyObservation.statusMessages) {
      sink.emit({
        message,
        runId,
        stepId,
        stepIndex,
        timestamp: Date.now(),
        type: "status",
      });
    }
    if (researchNotebook.hasContent()) {
      sink.emit({
        researchState: researchNotebook.getStateSummary({
          includeAllFindings: false,
          maxFindings: 8,
        }),
        runId,
        stepId,
        stepIndex,
        type: "research_state",
      });
    }

    const watchdog = evaluateNoProgressWatchdog(progressReceipt);
    if (watchdog) {
      if (watchdog.suppressMaintenanceTools) {
        state.maintenanceToolSuppressedUntilStep = stepIndex + 1;
      }
      appendUserControl(state, watchdog.message);
      sink.emit({
        message: watchdog.message.split("\n")[1] ?? watchdog.message,
        runId,
        stepId,
        stepIndex,
        timestamp: Date.now(),
        type: "status",
      });
      if (watchdog.action === "checkpoint") {
        await taskMemory.saveCheckpoint({
          nextAction: "恢复后读取现场，并采用能够产生客观回执的新路线。",
          summary: watchdog.message,
          title: "No-progress checkpoint",
        });
      }
    }

    sink.emit({
      durationMs: Date.now() - stepStartedAt,
      endedAt: Date.now(),
      runId,
      status: "completed",
      stepId,
      stepIndex,
      stopReason: watchdog?.action ?? assistantResult.response.stopReason,
      type: "step_completed",
    });
    state.completedSteps = stepIndex;

    if (watchdog?.action === "checkpoint") {
      return {
        checkpoint: {
          acceptanceGap: acceptanceState.gap,
          contextSnapshotHash: state.contextSnapshotHash,
          workspaceRoot,
        },
        error: "连续十轮没有客观推进或新的有效信息，已保存可恢复检查点。",
        kind: "recover",
      };
    }
    return {
      kind: "tool_batch",
      stopReason: assistantResult.response.stopReason,
    };
  }

  const observedState = state.receiptRegistry.snapshot();
  const acceptanceDelta = state.acceptance.reconcile(observedState);
  const acceptanceState = state.acceptance.snapshot();
  if (acceptanceDelta.changed.length > 0) {
    sink.publishTrace({
      acceptanceDelta,
      acceptanceState,
      runId,
      sessionId,
      stepId,
      stepIndex,
      type: "acceptance.updated",
    });
  }
  const chunkedFinal = decideChunkedFinal({
    currentState: state.chunkedFinal,
    visibleContent,
  });
  if (chunkedFinal.kind === "error") {
    throw new Error(chunkedFinal.error);
  }
  if (chunkedFinal.kind === "continue" || chunkedFinal.kind === "repair") {
    state.chunkedFinal = chunkedFinal.state;
    appendUserControl(state, chunkedFinal.controlMessage);
    applyRunTaskPatch(state, {
      currentMode: "synthesis",
      nextAction: `继续生成分段最终回答第 ${chunkedFinal.nextPart} 段。`,
    });
    await taskMemory.syncTaskState(state.taskState);
    sink.emit({
      message:
        chunkedFinal.kind === "continue"
          ? `已接收最终回答第 ${chunkedFinal.state.lastPart} 段，继续生成第 ${chunkedFinal.nextPart} 段。`
          : `分段协议需要修复，重新请求第 ${chunkedFinal.nextPart} 段。`,
      runId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      type: "status",
    });
    sink.emit({
      durationMs: Date.now() - stepStartedAt,
      endedAt: Date.now(),
      runId,
      status: "completed",
      stepId,
      stepIndex,
      stopReason: chunkedFinal.stopReason,
      type: "step_completed",
    });
    state.completedSteps = stepIndex;
    return {
      kind: "guard_retry",
      reason: chunkedFinal.controlMessage,
      stopReason: chunkedFinal.stopReason,
    };
  }

  const finalCandidate = chunkedFinal.candidate;
  if (chunkedFinal.kind === "complete") {
    state.chunkedFinal = null;
  }
  const decision = decideFinalization({
    acceptanceSnapshot: acceptanceState,
    activeAttempt: state.attempts.active(),
    deliverableContract: state.deliverableContract,
    observedState,
    stopReason: assistantResult.response.stopReason,
    visibleContent: finalCandidate,
  });

  sink.publishTrace({
    acceptanceGap: acceptanceState.gap,
    evidenceRefs:
      decision.kind === "final" ? decision.completion.evidenceRefs : [],
    ready: decision.kind === "final",
    reason:
      decision.kind === "final"
        ? "all required acceptance criteria have objective evidence"
        : decision.issues.map((issue) => issue.message).join("；"),
    runId,
    sessionId,
    stepId,
    stepIndex,
    type: "completion.checked",
  });

  if (decision.kind === "guard_retry") {
    const shouldStartChunkedRepair =
      decision.nextAction === "repair_final" &&
      decision.issues.some((issue) => issue.code === "truncated_final");
    const controlMessage = shouldStartChunkedRepair
      ? createChunkedFinalStartMessage({
          reason: decision.issues.map((issue) => issue.message).join("；"),
          stopReason: assistantResult.response.stopReason,
        })
      : decision.feedback;
    if (shouldStartChunkedRepair) {
      state.chunkedFinal = createChunkedFinalState();
    }
    appendUserControl(state, controlMessage);
    applyRunTaskPatch(state, {
      currentMode:
        decision.nextAction === "continue_tools" ? "verify" : "synthesis",
      nextAction:
        decision.nextAction === "continue_tools"
          ? "根据验收缺口继续研究、制作或验证。"
          : shouldStartChunkedRepair
            ? "使用分段协议从第一段重新生成完整最终说明。"
            : "基于已验收现场修复最终说明。",
    });
    await taskMemory.syncTaskState(state.taskState);
    sink.emit({
      message:
        decision.nextAction === "continue_tools"
          ? "交付条件仍有客观缺口，继续执行。"
          : shouldStartChunkedRepair
            ? "最终说明被截断，正在使用分段协议重新生成。"
            : "最终说明不完整，正在基于已验收现场修复。",
      runId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      type: "status",
    });
    sink.emit({
      durationMs: Date.now() - stepStartedAt,
      endedAt: Date.now(),
      runId,
      status: "completed",
      stepId,
      stepIndex,
      stopReason: shouldStartChunkedRepair
        ? "length_final_chunk_repair"
        : "completion_guard",
      type: "step_completed",
    });
    state.completedSteps = stepIndex;
    return {
      kind: "guard_retry",
      reason: controlMessage,
      stopReason: shouldStartChunkedRepair
        ? "length_final_chunk_repair"
        : "completion_guard",
    };
  }

  await emitFinalMessage({
    message: decision.message,
    runId,
    signal,
    sink,
    stepId,
    stepIndex,
  });
  applyRunTaskPatch(state, {
    currentMode: "synthesis",
    nextAction: "交付已验收结果。",
  });
  await taskMemory.syncTaskState(state.taskState);
  sink.emit({
    durationMs: Date.now() - stepStartedAt,
    endedAt: Date.now(),
    runId,
    status: "completed",
    stepId,
    stepIndex,
    stopReason: decision.stopReason,
    type: "step_completed",
  });
  state.completedSteps = stepIndex;
  return {
    completionEvidence: decision.completion.evidenceRefs,
    kind: "final",
    message: decision.message,
    stopReason: decision.stopReason,
  };
}
