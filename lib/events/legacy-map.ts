/**
 * legacy-map：旧 StreamEvent（trace.ts 联合类型）→ v2 三层事件 的映射纯函数。
 *
 * 用途：Phase 3 改造 agent.ts 时，保留其内部 38 处 `emit(legacyEvent)` 调用不动，
 * 在 emit 适配层里调用本模块把这些旧事件映射为 v2 事件后 publish 到 EventBus，
 * 从而把"事件发布解耦"的改动收敛到适配层，避免大面积改写 agent 主体逻辑。
 *
 * 映射约定：
 *   - assistant_delta / thinking_delta → ProviderEvent（live-only），需传入当前 textId / thinkingId。
 *   - assistant / thinking             → text.completed / thinking.completed（durable），需 id。
 *   - error                            → run.status（保留错误消息作为可见状态），run.completed 另带 error。
 *   - done                             → 丢弃（SSE 连接本身即生命周期，不再需要 done 哨兵）。
 *   - 其余                              → 对应 TraceEvent（durable）。
 */

import type { StreamEvent } from "../trace";
import type { ProviderEvent, TraceEvent } from "./schema";

export type MappingContext = {
  runId: string;
  sessionId: string;
};

/** assistant_delta（旧）→ text.delta（live）。 */
export function mapAssistantDelta(
  event: Extract<StreamEvent, { type: "assistant_delta" }>,
  ctx: MappingContext,
  textId: string,
): ProviderEvent {
  return {
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    stepId: event.stepId,
    stepIndex: event.stepIndex,
    type: "text.delta",
    textId,
    delta: event.delta,
    ...(event.reset ? { reset: true } : {}),
  };
}

/** thinking_delta（旧）→ thinking.delta（live）。 */
export function mapThinkingDelta(
  event: Extract<StreamEvent, { type: "thinking_delta" }>,
  ctx: MappingContext,
  thinkingId: string,
): ProviderEvent {
  return {
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    stepId: event.stepId,
    stepIndex: event.stepIndex,
    type: "thinking.delta",
    thinkingId,
    delta: event.delta,
  };
}

/** assistant（旧）→ text.completed（durable）。 */
export function mapAssistantCompleted(
  event: Extract<StreamEvent, { type: "assistant" }>,
  ctx: MappingContext,
  textId: string,
): TraceEvent {
  return {
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    stepId: event.stepId ?? "",
    stepIndex: event.stepIndex,
    type: "text.completed",
    textId,
    message: event.message,
  };
}

/** thinking（旧）→ thinking.completed（durable）。 */
export function mapThinkingCompleted(
  event: Extract<StreamEvent, { type: "thinking" }>,
  ctx: MappingContext,
  thinkingId: string,
): TraceEvent {
  return {
    runId: ctx.runId,
    sessionId: ctx.sessionId,
    stepId: event.stepId,
    stepIndex: event.stepIndex,
    type: "thinking.completed",
    thinkingId,
    message: event.message,
  };
}

/** 非 delta / 非 assistant / 非 thinking 的旧事件 → TraceEvent（durable）；返回 null 表示丢弃。 */
export function mapLegacyTraceEvent(
  event: StreamEvent,
  ctx: MappingContext,
): TraceEvent | null {
  switch (event.type) {
    case "run_started":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        type: "run.started",
        prompt: event.prompt,
        ...(event.resumedFromCheckpoint
          ? { resumedFromCheckpoint: event.resumedFromCheckpoint }
          : {}),
        runtime: event.runtime,
        startedAt: event.startedAt,
        toolDefinitions: event.toolDefinitions,
      };

    case "run_completed":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        type: "run.completed",
        status: event.status,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        totalSteps: event.totalSteps,
        ...(event.error ? { error: event.error } : {}),
        ...(event.finalAssistantMessage
          ? { finalAssistantMessage: event.finalAssistantMessage }
          : {}),
      };

    case "step_started":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "step.started",
        startedAt: event.startedAt,
      };

    case "step_completed":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "step.completed",
        status: event.status,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        ...(event.error ? { error: event.error } : {}),
        ...(event.stopReason !== undefined
          ? { stopReason: event.stopReason }
          : {}),
      };

    case "tool_call":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "tool.started",
        toolUseId: event.toolUseId,
        name: event.name,
        arguments: event.arguments,
        startedAt: event.startedAt,
      };

    case "tool_result":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "tool.completed",
        toolUseId: event.toolUseId,
        name: event.name,
        result: event.result,
        success: event.success,
        startedAt: event.startedAt,
        endedAt: event.startedAt + event.durationMs,
        durationMs: event.durationMs,
      };

    case "context_snapshot":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "context.snapshot",
        context: event.context,
      };

    case "model_request":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "model.request",
        request: event.request,
      };

    case "model_response":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "model.response",
        response: event.response,
      };

    case "research_state":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        type: "research.state",
        researchState: event.researchState,
      };

    case "task_state":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        ...(event.stepId ? { stepId: event.stepId } : {}),
        stepIndex: event.stepIndex,
        type: "task.state",
        taskState: event.taskState,
      };

    case "status":
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        ...(event.stepId ? { stepId: event.stepId } : {}),
        stepIndex: event.stepIndex,
        type: "run.status",
        message: event.message,
      };

    // assistant / thinking / *_delta 由专用函数处理；done 已废弃。
    case "assistant":
    case "thinking":
    case "assistant_delta":
    case "thinking_delta":
    case "done":
      return null;

    case "error":
      // 错误作为可见状态消息保留；终止错误由 run.completed(failed, error) 承载。
      return {
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        ...(event.stepId ? { stepId: event.stepId } : {}),
        stepIndex: event.stepIndex,
        type: "run.status",
        message: event.message,
      };

    default: {
      // 穷尽检查：若 StreamEvent 新增 type 未在 switch 处理，此处 event 不再是 never，编译报错。
      const exhaustive: never = event;
      void exhaustive;
      return null;
    }
  }
}
