/**
 * EventMapper：把后端内部 Core TraceEvent（Layer2）投影为面向前端的 ClientNotification（Layer3）。
 *
 * 对应架构文档「Event Mapper：展示逻辑后移」：
 *   - 订阅 EventBus 全部事件，只处理 Layer2 TraceEvent（忽略 Layer1 delta 与自身产出的 Layer3，
 *     避免自循环）。
 *   - tool.started 时立即下发 fallback display 的 activity.appended，并异步调用 LLM 生成 model
 *     display，完成后下发 activity.display_updated（前端不再二次请求 LLM 改写文案）。
 *   - run.completed 前等待本 run 未完成的改写（带 8s 超时），避免前端进入「run 结束」态后才收到
 *     迟到的 display_updated。
 *
 * 通知统一 publish 回事件所属 streamKey（=sessionId），前端经 SSE 单一通道消费三层事件。
 */

import type { EventBus, PublishedEvent } from "../events/event-bus";
import type { ClientNotification, TraceEvent } from "../events/schema";
import type { RunRegistry } from "./run-registry";
import { rewriteActivityDisplay } from "./activity-rewrite";
import {
  compactInlinePayload,
  compactText,
  createResearchDisplay,
  createRunCompletedDisplay,
  createRunStartedDisplay,
  createStatusDisplay,
  createStepCompletedDisplay,
  createTaskStateDisplay,
  createToolCallDisplay,
  createToolResultDisplay,
  getToolDisplayName,
} from "./display-fallback";
import {
  createRunOverviewProjection,
  reduceRunOverviewProjection,
  type RunOverviewProjection,
} from "./run-overview-projection";

const RUN_COMPLETION_DISPLAY_TIMEOUT_MS = 8000;
const ACTIVITY_REWRITE_ENABLED =
  process.env.RANNI_ACTIVITY_REWRITE_ENABLED?.trim().toLowerCase() === "true";
const RUN_OVERVIEW_SOURCE_TYPES = new Set([
  "acceptance.updated",
  "attempt.updated",
  "completion.checked",
  "context.snapshot",
  "plan.updated",
  "progress.receipt",
  "recovery.started",
  "state.observed.updated",
  "task.state",
]);

type ToolStartedEvent = Extract<TraceEvent, { type: "tool.started" }>;

export class EventMapper {
  private started = false;

  /** toolUseId -> tool_call 的 activityId（供 display_updated 定位）。 */
  private readonly callActivityByTool = new Map<string, string>();

  /** runId -> 未完成的改写 Promise（run.completed 前 await）。 */
  private readonly pending = new Map<string, Set<Promise<unknown>>>();

  /** runId -> 最近一次 task.state 签名（去重用，避免每 step 重复刷出 state activity）。 */
  private readonly lastTaskSignature = new Map<string, string>();

  /** runId -> 最新运行概览投影；用于把语义事实实时推送给前端。 */
  private readonly runOverviews = new Map<string, RunOverviewProjection>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly registry: RunRegistry,
  ) {}

  /** 在 app 启动时一次性注册全局订阅。 */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.eventBus.subscribeAll((event) => {
      this.handle(event).catch(() => {
        // mapper 投影失败不应影响事件流；忽略。
      });
    });
  }

  private notify(streamKey: string, notification: ClientNotification): void {
    this.eventBus.publish(streamKey, notification, { durable: true });
  }

  private async handle(event: PublishedEvent): Promise<void> {
    if (RUN_OVERVIEW_SOURCE_TYPES.has(event.type)) {
      this.handleRunOverviewSource(event);
    }

    switch (event.type) {
      case "run.started":
        this.handleRunStarted(event as Extract<TraceEvent, { type: "run.started" }>);
        return;
      case "run.completed":
        await this.handleRunCompleted(event as Extract<TraceEvent, { type: "run.completed" }>);
        return;
      case "run.status":
        this.handleRunStatus(event as Extract<TraceEvent, { type: "run.status" }>);
        return;
      case "task.state":
        this.handleTaskState(event as Extract<TraceEvent, { type: "task.state" }>);
        return;
      case "research.state":
        this.handleResearchState(event as Extract<TraceEvent, { type: "research.state" }>);
        return;
      case "tool.started":
        this.handleToolStarted(event as ToolStartedEvent);
        return;
      case "tool.completed":
        this.handleToolCompleted(event as Extract<TraceEvent, { type: "tool.completed" }>);
        return;
      case "text.completed":
        this.handleTextCompleted(event as Extract<TraceEvent, { type: "text.completed" }>);
        return;
      case "thinking.completed":
        this.handleThinkingCompleted(
          event as Extract<TraceEvent, { type: "thinking.completed" }>,
        );
        return;
      case "step.completed":
        this.handleStepCompleted(event as Extract<TraceEvent, { type: "step.completed" }>);
        return;
      default:
        // delta / thinking.* / model.* / context.* / text.started 以及自身产出的 Layer3：忽略。
        return;
    }
  }

  private handleRunStarted(event: Extract<TraceEvent, { type: "run.started" }>) {
    const { runId, sessionId } = event;
    this.runOverviews.set(
      runId,
      createRunOverviewProjection(runId, event.startedAt),
    );
    const display = createRunStartedDisplay();
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "step",
      label: "开始执行任务",
      detail: display.detail,
      display,
    });
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "lifecycle",
      phase: "run_started",
      status: "running",
      ...(event.prompt ? { prompt: event.prompt } : {}),
    });
  }

  private async handleRunCompleted(event: Extract<TraceEvent, { type: "run.completed" }>) {
    const { runId, sessionId } = event;

    // 等待本 run 未完成的工具文案改写（带超时），保证 display_updated 在 run 结束前落地。
    const pendingSet = this.pending.get(runId);
    if (pendingSet && pendingSet.size > 0) {
      await Promise.race([
        Promise.allSettled([...pendingSet]),
        new Promise((resolve) => {
          setTimeout(resolve, RUN_COMPLETION_DISPLAY_TIMEOUT_MS);
        }),
      ]);
    }
    this.pending.delete(runId);
    this.lastTaskSignature.delete(runId);
    this.runOverviews.delete(runId);

    const display = createRunCompletedDisplay({
      status: event.status,
      totalSteps: event.totalSteps,
      durationMs: event.durationMs,
    });
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "step",
      label: display.title,
      detail: display.detail,
      display,
    });
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "lifecycle",
      phase: "run_completed",
      status: event.status,
      ...(event.error ? { error: event.error } : {}),
      totalSteps: event.totalSteps,
      durationMs: event.durationMs,
    });

    if (event.status === "failed" && event.error) {
      this.notify(sessionId, { runId, sessionId, type: "error", message: event.error });
    }
  }

  private handleRunOverviewSource(event: PublishedEvent) {
    if (
      typeof event.runId !== "string" ||
      typeof event.sessionId !== "string" ||
      typeof event.seq !== "number"
    ) {
      return;
    }
    const current =
      this.runOverviews.get(event.runId) ??
      createRunOverviewProjection(event.runId);
    const overview = reduceRunOverviewProjection(current, event);
    if (overview === current) {
      return;
    }
    this.runOverviews.set(event.runId, overview);
    this.notify(event.sessionId, {
      runId: event.runId,
      sessionId: event.sessionId,
      type: "run.overview.updated",
      overview,
    });
  }

  private handleRunStatus(event: Extract<TraceEvent, { type: "run.status" }>) {
    const { runId, sessionId } = event;
    const display = createStatusDisplay(event.message);
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "status",
      label: compactText(event.message, 28),
      detail: event.message,
      display,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private handleTaskState(event: Extract<TraceEvent, { type: "task.state" }>) {
    const { runId, sessionId } = event;
    const signature = [
      event.taskState.currentMode,
      event.taskState.nextAction,
      event.taskState.verification.status,
    ].join("|");

    if (this.lastTaskSignature.get(runId) === signature) {
      return;
    }
    this.lastTaskSignature.set(runId, signature);

    const display = createTaskStateDisplay(event.taskState);
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "state",
      label: "更新任务状态",
      detail: event.taskState.nextAction || event.taskState.goal || "任务状态已刷新",
      display,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private handleResearchState(event: Extract<TraceEvent, { type: "research.state" }>) {
    const { runId, sessionId } = event;
    const display = createResearchDisplay();
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "research",
      label: "更新研究笔记",
      detail: compactText(event.researchState, 110),
      display,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
    // 同时把研究笔记投影为 session 级 researchContext 的 Layer3 notification，让前端主状态
    // （researchContext）由 notification 驱动，而非从 Layer2 TraceEvent 反推。
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "research.context.updated",
      researchContext: event.researchState,
    });
  }

  private handleToolStarted(event: ToolStartedEvent) {
    const { runId, sessionId, toolUseId, name, arguments: args } = event;
    const activityId = crypto.randomUUID();
    this.callActivityByTool.set(toolUseId, activityId);

    const display = createToolCallDisplay(name, args);
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId,
      activityType: "tool_call",
      label: getToolDisplayName(name),
      detail: compactInlinePayload(args),
      display,
      toolName: name,
      toolUseId,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });

    // 后端异步调用 LLM 生成 model display，完成后下发 display_updated（展示逻辑后移）。
    const modelConfig = ACTIVITY_REWRITE_ENABLED
      ? this.registry.get(runId)?.modelConfig
      : undefined;
    if (modelConfig) {
      const promise = this.rewriteToolCallDisplay(event, activityId, modelConfig);
      this.addPending(runId, promise);
    }
  }

  private handleToolCompleted(event: Extract<TraceEvent, { type: "tool.completed" }>) {
    const { runId, sessionId } = event;
    const display = createToolResultDisplay({
      result: event.result,
      success: event.success,
      toolName: event.name,
      durationMs: event.durationMs,
    });
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "tool_result",
      label: getToolDisplayName(event.name),
      detail: compactText(event.result, 110),
      display,
      toolName: event.name,
      toolUseId: event.toolUseId,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private handleTextCompleted(event: Extract<TraceEvent, { type: "text.completed" }>) {
    this.notify(event.sessionId, {
      runId: event.runId,
      sessionId: event.sessionId,
      type: "assistant.message",
      textId: event.textId,
      message: event.message,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private handleThinkingCompleted(
    event: Extract<TraceEvent, { type: "thinking.completed" }>,
  ) {
    this.notify(event.sessionId, {
      runId: event.runId,
      sessionId: event.sessionId,
      type: "thinking.message",
      thinkingId: event.thinkingId,
      message: event.message,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private handleStepCompleted(event: Extract<TraceEvent, { type: "step.completed" }>) {
    if (event.status === "completed") {
      return;
    }
    const { runId, sessionId } = event;
    const display = createStepCompletedDisplay({
      status: event.status,
      stepIndex: event.stepIndex ?? 0,
      durationMs: event.durationMs,
    });
    this.notify(sessionId, {
      runId,
      sessionId,
      type: "activity.appended",
      activityId: crypto.randomUUID(),
      activityType: "error",
      label: display.title,
      detail: display.detail,
      display,
      ...(event.stepId ? { stepId: event.stepId } : {}),
      stepIndex: event.stepIndex,
    });
  }

  private async rewriteToolCallDisplay(
    event: ToolStartedEvent,
    activityId: string,
    modelConfig: NonNullable<Parameters<typeof rewriteActivityDisplay>[0]>,
  ): Promise<void> {
    const display = await rewriteActivityDisplay(modelConfig, {
      type: "tool_call",
      name: event.name,
      arguments: event.arguments,
      stepIndex: event.stepIndex,
    });
    if (!display) {
      return;
    }
    this.notify(event.sessionId, {
      runId: event.runId,
      sessionId: event.sessionId,
      type: "activity.display_updated",
      activityId,
      display,
    });
  }

  private addPending(runId: string, promise: Promise<unknown>): void {
    let set = this.pending.get(runId);
    if (!set) {
      set = new Set();
      this.pending.set(runId, set);
    }
    set.add(promise);
    void promise.finally(() => {
      set?.delete(promise);
    });
  }
}
