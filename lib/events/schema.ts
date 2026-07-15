/**
 * v2 事件 schema：三层语义 + 三段式生命周期。
 *
 * 三层（语义分层）：
 *   - ProviderEvent：AI 模型生成的流式片段，live-only（不持久化、不分配 seq）。
 *   - TraceEvent：Agent 运行时核心状态变迁，durable（带 seq、可回放）。
 *   - ClientNotification：面向前端的标准化渲染事件，durable（由 event-mapper 投影）。
 *
 * 三段式（Started → Delta → Ended）：
 *   - Started：durable，标记开始，由后端生成贯穿三段的 id（textId / thinkingId）。
 *   - Delta：live-only，仅实时流式。
 *   - Ended：durable，作为可回放的完整值边界。
 *
 * 详见 docs/tech/v2-architecture/。
 */

import type {
  TraceContextSnapshot,
  TraceModelRequest,
  TraceModelResponse,
  TraceRuntimeInfo,
  TraceToolDefinition,
} from "../trace";
import type { TaskState } from "../task-state";
import type { AcceptanceDelta, AcceptanceSnapshot } from "../acceptance";
import type { AttemptDelta } from "../plan-attempt";
import type { StepProgressReceipt } from "../progress";
import type { ObservedState, ToolReceipt } from "../receipts/types";

// ---- 共享展示类型（前后端共用，展示逻辑后移后的契约）-------------------------

export type ProcessIconId =
  | "activity"
  | "check"
  | "database"
  | "error"
  | "file"
  | "globe"
  | "research"
  | "search"
  | "spark"
  | "state"
  | "terminal"
  | "tool";

export type ActivityType =
  | "status"
  | "tool_call"
  | "tool_result"
  | "error"
  | "step"
  | "state"
  | "research"
  | "thinking";

export type ActivityDisplay = {
  detail: string;
  icon: ProcessIconId;
  meta?: string;
  source?: "fallback" | "model";
  title: string;
};

// ---- 公共定位字段 -----------------------------------------------------------

type RunLocator = {
  runId: string;
  sessionId: string;
};

type StepLocator = RunLocator & {
  stepId: string;
  stepIndex?: number;
};

// ---- Layer 1: ProviderEvent（live-only）-------------------------------------

export type TextDeltaEvent = StepLocator & {
  type: "text.delta";
  textId: string;
  delta: string;
  reset?: boolean;
};

export type ThinkingDeltaEvent = StepLocator & {
  type: "thinking.delta";
  thinkingId: string;
  delta: string;
};

export type ProviderEvent = TextDeltaEvent | ThinkingDeltaEvent;

// ---- Layer 2: TraceEvent（durable）------------------------------------------

export type RunStartedEvent = RunLocator & {
  type: "run.started";
  prompt: string;
  runtime: TraceRuntimeInfo;
  startedAt: number;
  toolDefinitions: TraceToolDefinition[];
};

export type RunCompletedEvent = RunLocator & {
  type: "run.completed";
  status: "completed" | "failed" | "cancelled";
  endedAt: number;
  durationMs: number;
  totalSteps: number;
  error?: string;
  finalAssistantMessage?: string;
};

export type StepStartedEvent = StepLocator & {
  type: "step.started";
  startedAt: number;
};

export type StepCompletedEvent = StepLocator & {
  type: "step.completed";
  status: "completed" | "failed" | "cancelled";
  endedAt: number;
  durationMs: number;
  error?: string;
  stopReason?: string | null;
};

export type ToolStartedEvent = StepLocator & {
  type: "tool.started";
  toolUseId: string;
  name: string;
  arguments: unknown;
  startedAt: number;
};

export type ToolCompletedEvent = StepLocator & {
  type: "tool.completed";
  toolUseId: string;
  name: string;
  result: string;
  success: boolean;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

export type ToolBatchStartedEvent = StepLocator & {
  type: "tool.batch.started";
  count: number;
  toolUseIds: string[];
};

export type ToolReceiptEvent = StepLocator & {
  type: "tool.receipt";
  receipt: ToolReceipt;
};

export type TextStartedEvent = StepLocator & {
  type: "text.started";
  textId: string;
};

export type TextCompletedEvent = StepLocator & {
  type: "text.completed";
  textId: string;
  message: string;
};

export type ThinkingStartedEvent = StepLocator & {
  type: "thinking.started";
  thinkingId: string;
};

export type ThinkingCompletedEvent = StepLocator & {
  type: "thinking.completed";
  thinkingId: string;
  message: string;
};

export type ModelRequestEvent = StepLocator & {
  type: "model.request";
  request: TraceModelRequest;
};

export type ModelResponseEvent = StepLocator & {
  type: "model.response";
  response: TraceModelResponse;
};

export type ContextSnapshotEvent = StepLocator & {
  type: "context.snapshot";
  context: TraceContextSnapshot;
};

export type TaskStateEvent = {
  runId: string;
  sessionId: string;
  stepId?: string;
  stepIndex?: number;
  type: "task.state";
  taskState: TaskState;
};

export type ResearchStateEvent = StepLocator & {
  type: "research.state";
  researchState: string;
};

export type RunStatusEvent = {
  runId: string;
  sessionId: string;
  stepId?: string;
  stepIndex?: number;
  type: "run.status";
  message: string;
};

export type ObservedStateUpdatedEvent = StepLocator & {
  type: "state.observed.updated";
  observedState: ObservedState;
};

export type AttemptUpdatedEvent = StepLocator & {
  type: "attempt.updated";
  attemptDelta: AttemptDelta;
};

export type AssumptionInvalidatedEvent = StepLocator & {
  type: "assumption.invalidated";
  assumptionIds: string[];
  evidenceRefs: string[];
  reason: string;
};

export type AcceptanceUpdatedEvent = StepLocator & {
  type: "acceptance.updated";
  acceptanceDelta: AcceptanceDelta;
  acceptanceState: AcceptanceSnapshot;
};

export type ProgressReceiptEvent = StepLocator & {
  type: "progress.receipt";
  progressReceipt: StepProgressReceipt;
};

export type RecoveryStartedEvent = StepLocator & {
  type: "recovery.started";
  acceptanceGap: string[];
  contextSnapshotHash: string;
  error: string;
};

export type CompletionCheckedEvent = StepLocator & {
  type: "completion.checked";
  acceptanceGap: string[];
  evidenceRefs: string[];
  ready: boolean;
  reason: string;
};

export type TraceEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolBatchStartedEvent
  | ToolReceiptEvent
  | TextStartedEvent
  | TextCompletedEvent
  | ThinkingStartedEvent
  | ThinkingCompletedEvent
  | ModelRequestEvent
  | ModelResponseEvent
  | ContextSnapshotEvent
  | TaskStateEvent
  | ResearchStateEvent
  | RunStatusEvent
  | ObservedStateUpdatedEvent
  | AttemptUpdatedEvent
  | AssumptionInvalidatedEvent
  | AcceptanceUpdatedEvent
  | ProgressReceiptEvent
  | RecoveryStartedEvent
  | CompletionCheckedEvent;

// ---- Layer 3: ClientNotification（durable，前端 UI 主消费）------------------

export type ActivityAppendedNotification = {
  runId: string;
  sessionId: string;
  type: "activity.appended";
  activityId: string;
  activityType: ActivityType;
  label: string;
  detail: string;
  display: ActivityDisplay;
  toolName?: string;
  toolUseId?: string;
  stepId?: string;
  stepIndex?: number;
};

export type ActivityDisplayUpdatedNotification = {
  runId: string;
  sessionId: string;
  type: "activity.display_updated";
  activityId: string;
  display: ActivityDisplay;
};

export type AssistantMessageNotification = {
  runId: string;
  sessionId: string;
  type: "assistant.message";
  textId: string;
  message: string;
  stepId?: string;
  stepIndex?: number;
};

export type LifecycleNotification = {
  runId: string;
  sessionId: string;
  type: "lifecycle";
  phase: "run_started" | "run_completed";
  status: "running" | "completed" | "failed" | "cancelled";
  prompt?: string;
  error?: string;
  totalSteps?: number;
  durationMs?: number;
};

export type ErrorNotification = {
  runId?: string;
  sessionId?: string;
  type: "error";
  message: string;
};

export type ResearchContextUpdatedNotification = {
  runId: string;
  sessionId: string;
  type: "research.context.updated";
  researchContext: string;
};

export type ThinkingMessageNotification = {
  runId: string;
  sessionId: string;
  type: "thinking.message";
  thinkingId: string;
  message: string;
  stepId?: string;
  stepIndex?: number;
};

export type ClientNotification =
  | ActivityAppendedNotification
  | ActivityDisplayUpdatedNotification
  | AssistantMessageNotification
  | LifecycleNotification
  | ResearchContextUpdatedNotification
  | ThinkingMessageNotification
  | ErrorNotification;

// ---- 聚合 -------------------------------------------------------------------

export type StreamEventV2 = TraceEvent | ProviderEvent | ClientNotification;

/** durable（带 seq、可回放）的事件类型集合；其余为 live-only。 */
export const DURABLE_EVENT_TYPES: ReadonlySet<string> = new Set<StreamEventV2["type"]>([
  "run.started",
  "run.completed",
  "step.started",
  "step.completed",
  "tool.started",
  "tool.completed",
  "tool.batch.started",
  "tool.receipt",
  "text.started",
  "text.completed",
  "thinking.started",
  "thinking.completed",
  "model.request",
  "model.response",
  "context.snapshot",
  "task.state",
  "research.state",
  "run.status",
  "state.observed.updated",
  "attempt.updated",
  "assumption.invalidated",
  "acceptance.updated",
  "progress.receipt",
  "recovery.started",
  "completion.checked",
  "activity.appended",
  "activity.display_updated",
  "assistant.message",
  "lifecycle",
  "research.context.updated",
  "thinking.message",
  "error",
]);

export function isDurableEventType(type: string): boolean {
  return DURABLE_EVENT_TYPES.has(type);
}
