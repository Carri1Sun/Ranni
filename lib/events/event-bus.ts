/**
 * EventBus：进程内事件总线，v2 事件驱动的中枢。
 *
 * 设计要点（对应架构文档 Event Sourcing + 断线续传）：
 *   - 按 streamKey（=sessionId）组织事件流。多 run 共享同一 streamKey，seq 在 streamKey
 *     维度单调递增、跨 run 不重置，前端按 runId 分流。
 *   - durable 事件分配递增 seq 并进入 ring buffer（可回放）；live-only 事件不分配 seq、
 *     不入 buffer，仅实时广播。
 *   - subscribe(streamKey, fromSeq) 同步回放 buffer 中 seq > fromSeq 的 durable 事件，
 *     再注册到实时订阅者。JS 单线程下同步回放与注册之间不存在并发缺口，回放期间不会有
 *     publish 插入，因此天然连续、不丢事件——这是 SSE 断线续传/重连回放正确性的基础。
 *   - subscribeAll 供 event-mapper 消费所有 streamKey 的 Layer2 TraceEvent。
 *
 * 持久化范围：内存 ring buffer（容量上限），进程重启即丢。完整用户与 assistant 消息由
 * Session workspace 的 session-history 文件保存；TraceRun 仍由前端 localStorage 压缩缓存。
 */

import { isDurableEventType } from "./schema";

export type PublishedEvent = { type: string; seq?: number; [key: string]: unknown };
export type Subscriber = (event: PublishedEvent) => void;

type StreamState = {
  /** 下一个待分配的 durable seq；已分配的最大 seq = seq（初始 0 表示无）。 */
  seq: number;
  /** durable 事件的 ring buffer（仅 durable，按 seq 升序）。 */
  buffer: PublishedEvent[];
  /** 该 streamKey 的实时订阅者。 */
  subscribers: Set<Subscriber>;
};

const DEFAULT_CAPACITY = 2000;

export class EventBus {
  private readonly streams = new Map<string, StreamState>();
  private readonly globalSubscribers = new Set<Subscriber>();
  private readonly capacity: number;

  constructor(options?: { capacity?: number }) {
    this.capacity = options?.capacity ?? DEFAULT_CAPACITY;
  }

  private getOrCreate(streamKey: string): StreamState {
    let state = this.streams.get(streamKey);

    if (!state) {
      state = { seq: 0, buffer: [], subscribers: new Set() };
      this.streams.set(streamKey, state);
    }

    return state;
  }

  /**
   * 发布事件。durable 事件分配 seq 并入 buffer；live-only 事件不入 buffer。
   * 无论 durable 与否，都广播给该 streamKey 的订阅者与所有 global 订阅者。
   *
   * durable 与否的判定优先使用显式 opts.durable；若未提供，则按事件 type 查表
   * （isDurableEventType）判定，方便调用方少传参。
   */
  publish<T extends { type: string }>(
    streamKey: string,
    event: T,
    options?: { durable?: boolean },
  ): void {
    const state = this.getOrCreate(streamKey);
    const durable = options?.durable ?? isDurableEventType(event.type);
    const envelope: PublishedEvent = durable
      ? { ...event, seq: (state.seq += 1) }
      : { ...event };

    if (durable) {
      state.buffer.push(envelope);

      if (state.buffer.length > this.capacity) {
        state.buffer.splice(0, state.buffer.length - this.capacity);
      }
    }

    for (const subscriber of state.subscribers) {
      subscriber(envelope);
    }

    for (const subscriber of this.globalSubscribers) {
      subscriber(envelope);
    }
  }

  /**
   * 订阅指定 streamKey。先同步回放 buffer 中 seq > fromSeq 的 durable 事件，
   * 再注册实时订阅。返回取消订阅函数。
   *
   * 同步回放保证回放段与实时段之间无并发缺口（JS 单线程）。
   */
  subscribe(streamKey: string, fromSeq: number, subscriber: Subscriber): () => void {
    const state = this.getOrCreate(streamKey);

    for (const event of state.buffer) {
      if (typeof event.seq === "number" && event.seq > fromSeq) {
        subscriber(event);
      }
    }

    state.subscribers.add(subscriber);

    return () => {
      state.subscribers.delete(subscriber);
    };
  }

  /**
   * 订阅所有 streamKey 的全部事件（durable + live）。供 event-mapper 使用。
   * 不回放历史（mapper 只处理实时 TraceEvent，run 内的事件在 run 启动后产生）。
   */
  subscribeAll(subscriber: Subscriber): () => void {
    this.globalSubscribers.add(subscriber);

    return () => {
      this.globalSubscribers.delete(subscriber);
    };
  }

  /** 返回 streamKey 已分配的最大 durable seq（无事件则 0）。 */
  getLatestSeq(streamKey: string): number {
    return this.streams.get(streamKey)?.seq ?? 0;
  }

  /** 返回 streamKey 当前 buffer 中最早的 seq（用于前端检测回放缺口）。 */
  getEarliestSeq(streamKey: string): number {
    const state = this.streams.get(streamKey);

    if (!state || state.buffer.length === 0) {
      return 0;
    }

    const first = state.buffer[0]?.seq;
    return typeof first === "number" ? first : 0;
  }
}
