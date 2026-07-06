/**
 * RunRegistry：运行实例注册表。
 *
 * v2 架构里 Agent 运行与 HTTP 请求生命周期解耦——POST /api/runs 启动一个 run 后立即返回，
 * run 在后台异步执行，事件经 EventBus/SSE 下发。RunRegistry 负责管理这些活跃 run：
 *   - runId 在此生成并上移（供 steer/abort 端点在 run 启动后即可引用，也供 agent.ts 复用）。
 *   - Steering Queue：steer(message) 入队，drainSteer() 由 Agent Loop 在 turn 边界抽取注入。
 *   - abort：通过 handle.abortController.abort() 中断 Agent Loop（signal），并清空 steer 队列。
 *   - 并发计数：activeCount() 替代旧的全局 activeAgentRunCount。
 *
 * 详见架构文档「通信正交化」「队列注入」。
 */

import type { ModelConnectionConfig } from "../llm/types";

export type PlainMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type RunHandle = {
  runId: string;
  sessionId: string;
  /** SSE 流的订阅键，等于 sessionId（一个 session 的事件流涵盖其下所有 run）。 */
  streamKey: string;
  status: RunStatus;
  abortController: AbortController;
  /** 待注入 Agent Loop 的补充消息（Steering Queue）。 */
  steerQueue: PlainMessage[];
  startedAt: number;
  /** event-mapper 改写 UI 文案时所需的本 run 模型配置。 */
  modelConfig?: ModelConnectionConfig;
};

export type StartRunOptions = {
  sessionId: string;
  modelConfig?: ModelConnectionConfig;
};

export class RunRegistry {
  private readonly runs = new Map<string, RunHandle>();

  /** 注册一个新 run，返回 runId 与 streamKey。runId 在此生成（上移自 agent.ts:1499）。 */
  start({ sessionId, modelConfig }: StartRunOptions): {
    runId: string;
    streamKey: string;
  } {
    const runId = crypto.randomUUID();
    const handle: RunHandle = {
      runId,
      sessionId,
      streamKey: sessionId,
      status: "running",
      abortController: new AbortController(),
      steerQueue: [],
      startedAt: Date.now(),
      ...(modelConfig ? { modelConfig } : {}),
    };
    this.runs.set(runId, handle);
    return { runId, streamKey: handle.streamKey };
  }

  get(runId: string): RunHandle | undefined {
    return this.runs.get(runId);
  }

  /** 向运行中的 run 投递补充消息。仅在 run 处于 running 时入队，返回是否成功。 */
  steer(runId: string, message: PlainMessage): boolean {
    const handle = this.runs.get(runId);
    if (!handle || handle.status !== "running") {
      return false;
    }
    handle.steerQueue.push(message);
    return true;
  }

  /** Agent Loop 在 turn 边界调用：取出并清空待注入的补充消息。 */
  drainSteer(runId: string): PlainMessage[] {
    const handle = this.runs.get(runId);
    if (!handle) {
      return [];
    }
    const messages = handle.steerQueue;
    handle.steerQueue = [];
    return messages;
  }

  /** 中断运行中的 run：触发 abort signal 并清空 steer 队列。返回 run 是否存在。 */
  abort(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle) {
      return false;
    }
    if (handle.status === "running") {
      handle.status = "cancelled";
      handle.steerQueue = [];
      handle.abortController.abort();
    }
    return true;
  }

  /** Agent Loop 结束时标记最终状态。 */
  finish(runId: string, status: Exclude<RunStatus, "running">): void {
    const handle = this.runs.get(runId);
    if (!handle) {
      return;
    }
    handle.status = status;
  }

  listBySession(sessionId: string): RunHandle[] {
    return [...this.runs.values()].filter((handle) => handle.sessionId === sessionId);
  }

  /** 当前运行中的 run 数量（并发限流用，替代旧 activeAgentRunCount）。 */
  activeCount(): number {
    let count = 0;
    for (const handle of this.runs.values()) {
      if (handle.status === "running") {
        count += 1;
      }
    }
    return count;
  }
}
