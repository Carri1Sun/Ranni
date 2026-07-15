import path from "node:path";

import { toTraceToolDefinitions } from "../context/trace-snapshot";
import { getModelRuntimeInfo, type AgentMessage } from "../llm";
import { createRunPolicySet } from "../policies/registry";
import { normalizeSkillNames } from "../skills/registry";
import { AgentEventSink } from "./event-sink";
import {
  createAgentRunRecoverySnapshot,
  createAgentRunState,
  applyRunTaskPatch,
  restoreAgentRunState,
} from "./run-state";
import { createAgentRuntimeServices } from "./runtime-services";
import { createRunTerminator } from "./run-termination";
import { runStep } from "./step-runner";
import { CANCELLED_MESSAGE } from "./streaming";
import type {
  PlainMessage,
  RunAgentTurnOptions,
  RunAgentTurnResult,
} from "./types";

const MAX_TOOL_STEPS = 500;

function assertRecoveryBinding(
  snapshot: NonNullable<RunAgentTurnOptions["recoveryState"]>,
  sessionId: string,
  workspaceRoot?: string,
) {
  const binding = snapshot.recoveryBinding;
  if (!binding) return;
  if (binding.sessionId !== sessionId) {
    throw new Error("Recovery checkpoint belongs to a different session.");
  }
  if (
    binding.workspaceRoot &&
    (!workspaceRoot ||
      path.resolve(binding.workspaceRoot) !== path.resolve(workspaceRoot))
  ) {
    throw new Error("Recovery checkpoint belongs to a different workspace.");
  }
}

function toConversation(
  messages: RunAgentTurnOptions["messages"],
): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: "text", text: message.content }],
  }));
}

function latestUserPrompt(messages: RunAgentTurnOptions["messages"]) {
  return (
    [...messages].reverse().find((message) => message.role === "user")?.content ??
    ""
  );
}

function appendSteering(
  state: ReturnType<typeof createAgentRunState>,
  messages: PlainMessage[],
) {
  const steering: AgentMessage[] = [];
  for (const message of messages) {
    const normalized: AgentMessage = {
      role: "user",
      content: [{ type: "text", text: message.content }],
    };
    state.conversation.push(normalized);
    steering.push(normalized);
  }

  if (messages.length > 0) {
    const additions = messages
      .map((message) => message.content.trim())
      .filter(Boolean);
    state.taskContract.goal = [
      state.taskContract.goal,
      ...additions.map((message) => `User steering: ${message}`),
    ].join("\n");
    applyRunTaskPatch(state, { goal: state.taskContract.goal });
  }
  return steering;
}

export async function runAgentTurnController(
  options: RunAgentTurnOptions,
): Promise<RunAgentTurnResult> {
  const {
    drainSteer,
    eventBus,
    messages,
    modelConfig,
    recoveryState,
    runId,
    sessionId,
    signal,
    streamKey,
    toolSettings,
    workspaceRoot,
  } = options;
  const startedAt = Date.now();
  const configuredSkillNames = normalizeSkillNames(toolSettings?.activeSkills);
  const initialPrompt = latestUserPrompt(messages);
  const initialPolicySet = createRunPolicySet({
    activeSkillNames: configuredSkillNames,
    prompt: initialPrompt,
  });
  if (recoveryState) {
    assertRecoveryBinding(recoveryState, sessionId, workspaceRoot);
  }
  const state = recoveryState
    ? restoreAgentRunState(recoveryState)
    : createAgentRunState({
        activeSkillNames: configuredSkillNames,
        conversation: toConversation(messages),
        deliverableContract:
          initialPolicySet.getDeliverableContract(configuredSkillNames),
        latestUserPrompt: initialPrompt,
        recoveryBinding: { sessionId, ...(workspaceRoot ? { workspaceRoot } : {}) },
      });
  if (recoveryState && messages.length > 0) {
    appendSteering(state, messages);
  }
  for (const skillName of configuredSkillNames) {
    state.loadedSkills.add(skillName);
  }
  const activeSkillNames = [...state.loadedSkills];
  const prompt = state.taskContract.goal;
  const policySet = createRunPolicySet({ activeSkillNames, prompt });
  const { researchNotebook, taskMemory } = createAgentRuntimeServices({
    latestUserPrompt: prompt,
    runId,
    workspaceRoot,
  });
  const sink = new AgentEventSink(eventBus, streamKey, runId, sessionId);
  const runtime = getModelRuntimeInfo(modelConfig);
  const initialTools = policySet.getToolDefinitions(activeSkillNames);
  const terminator = createRunTerminator({
    runId,
    sessionId,
    signal,
    sink,
    startedAt,
    state,
    taskMemory,
    workspaceRoot,
  });

  try {
    await taskMemory.syncTaskState(
      state.taskState,
      state.planLedger.serialize(),
    );
    applyRunTaskPatch(state, { memory: taskMemory.getStatus() });
    state.acceptance.reconcile(state.receiptRegistry.snapshot());

    sink.emit({
      prompt,
      ...(recoveryState
        ? {
            resumedFromCheckpoint: {
              completedSteps: recoveryState.completedSteps,
              contextSnapshotHash: recoveryState.contextSnapshotHash,
              planRevision: recoveryState.plan.snapshot.revision,
            },
          }
        : {}),
      runId,
      runtime,
      startedAt,
      toolDefinitions: toTraceToolDefinitions(initialTools),
      type: "run_started",
    });
    sink.emit({
      message: `已连接 ${runtime.provider}，开始执行任务。`,
      runId,
      timestamp: Date.now(),
      type: "status",
    });

    for (
      let stepIndex = state.completedSteps + 1;
      stepIndex <= MAX_TOOL_STEPS;
      stepIndex += 1
    ) {
      if (signal?.aborted) {
        const error = new Error(CANCELLED_MESSAGE);
        error.name = "AbortError";
        throw error;
      }

      const drained = drainSteer?.(runId) ?? [];
      const steeringMessages = appendSteering(state, drained);
      for (const message of drained) {
        sink.emit({
          message: `已接收补充要求：${message.content.slice(0, 80)}`,
          runId,
          timestamp: Date.now(),
          type: "status",
        });
      }

      const outcome = await runStep({
        modelConfig,
        policySet,
        researchMode: toolSettings?.researchMode ?? false,
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
      });

      if (outcome.kind === "tool_batch" || outcome.kind === "guard_retry") {
        continue;
      }
      if (outcome.kind === "final") {
        return terminator.complete(outcome.message);
      }
      return terminator.fail({
        ...(outcome.kind === "recover"
          ? { checkpoint: outcome.checkpoint }
          : {}),
        error: outcome.error,
        recoverable: outcome.kind === "recover",
      });
    }

    const error = `本轮对话超过最大工具步数 ${MAX_TOOL_STEPS}。`;
    return terminator.fail({
      checkpoint: {
        acceptanceGap: state.acceptance.snapshot().gap,
        contextSnapshotHash: state.contextSnapshotHash,
        runState: createAgentRunRecoverySnapshot(state),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      },
      error,
    });
  } catch (error) {
    return terminator.recover(error, Math.max(1, state.completedSteps + 1));
  }
}
