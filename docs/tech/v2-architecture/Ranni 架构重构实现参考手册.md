---
author: manus
version: v2
date: 2026-07-03
---

# Ranni 架构重构实现参考手册

本手册是《Ranni 架构设计思想报告》的配套实现指南，旨在为编码 Agent 或开发者提供具体、可落地的代码参考。所有引用均精确到具体项目的源码文件与行号，展示了顶级开源项目是如何解决 Ranni 目前面临的工程痛点的。

---

## 1. 事件定义：三段式模型与 Event Sourcing

Ranni 当前的 `StreamEvent` 将各种状态混杂在一起。OpenCode 提供了一套极其优雅的基于 Event Sourcing 的分层事件定义。

### 参考 1.1：Started / Delta / Ended 三段式事件定义
**来源项目**：OpenCode
**文件路径**：`packages/schema/src/session-event.ts`
**实现细节**：
OpenCode 将文本生成或工具调用的生命周期严格拆分为三段。
- **Started**：标记开始。
- **Delta**：被显式注释为 "live-only"（仅实时），用于流式传输。
- **Ended**：作为可回放的完整值边界。

```typescript
// 摘自 opencode/packages/schema/src/session-event.ts (Line 198-232)
export namespace Text {
  export const Started = Event.define({
    type: "session.next.text.started",
    ...options, // 包含 durable: { aggregate: "sessionID", version: 1 }
    schema: { ...Base, assistantMessageID: SessionMessage.ID, textID: Schema.String },
  })

  // Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
  export const Delta = Event.define({
    type: "session.next.text.delta",
    schema: { ...Base, assistantMessageID: SessionMessage.ID, textID: Schema.String, delta: Schema.String },
  })

  export const Ended = Event.define({
    type: "session.next.text.ended",
    ...options,
    schema: { ...Base, assistantMessageID: SessionMessage.ID, textID: Schema.String, text: Schema.String },
  })
}
```

### 参考 1.2：Durable Event（持久化事件）声明
**来源项目**：OpenCode
**文件路径**：`packages/schema/src/event.ts` (Line 15-25) & `packages/core/src/event.ts` (Line 585-605)
**实现细节**：
OpenCode 的 `Event.define` 允许传入 `durable` 选项。只有携带此选项的事件才会被赋予序列号（seq）并写入数据库（EventSequenceTable / EventTable），从而实现断点续传。

---

## 2. 协议映射与展示解耦 (Event Mapper)

Ranni 前端目前通过 `/api/activity/describe` 动态请求 LLM 生成文案。Codex 证明了这部分逻辑必须下沉到后端，并通过"投影层"将核心事件转化为纯粹的 UI 通知。

### 参考 2.1：从 Core Event 到 Server Notification 的显式映射
**来源项目**：Codex
**文件路径**：`codex-rs/app-server-protocol/src/protocol/event_mapping.rs` (Line 25-95)
**实现细节**：
Codex 在 `item_event_to_server_notification` 函数中，通过模式匹配将内部的 `EventMsg`（如 `DynamicToolCallResponse`）映射为对外的 `ServerNotification::ItemCompleted`。

```rust
// 摘自 codex/codex-rs/app-server-protocol/src/protocol/event_mapping.rs
pub fn item_event_to_server_notification(
    msg: EventMsg,
    thread_id: &str,
    turn_id: &str,
) -> ServerNotification {
    match msg {
        EventMsg::DynamicToolCallResponse(response) => {
            // 组装对外的 UI 状态
            let status = if response.success { DynamicToolCallStatus::Completed } else { DynamicToolCallStatus::Failed };
            let item = ThreadItem::DynamicToolCall {
                id: response.call_id,
                // ... 省略部分字段
                status,
            };
            // 返回标准化的 ServerNotification
            ServerNotification::ItemCompleted(ItemCompletedNotification {
                thread_id: thread_id.to_string(),
                turn_id: response.turn_id,
                item,
                completed_at_ms: response.completed_at_ms,
            })
        }
        // ...
    }
}
```
**对 Ranni 的指导**：在后端实现类似的 `Mapper`，捕获 `TraceToolResult` 后，在后端发起 LLM 调用生成文案，然后包装成 `FeedActivity` 格式直接通过 SSE 发送给前端。

---

## 3. 通信正交化：Command + SSE 架构

针对"执行中补充消息"的需求，Pi 和 OpenCode 都展示了如何利用正交的 Command 队列与单向事件流，彻底摆脱对 WebSocket 的依赖。

### 参考 3.1：SSE 事件广播端点
**来源项目**：OpenCode
**文件路径**：`packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` (Line 68-87)
**实现细节**：
标准的 `text/event-stream` 实现，单向广播系统内的事件。

```typescript
// 摘自 opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts
return HttpServerResponse.stream(
  Stream.make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
    Stream.concat(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
    Stream.map(eventData),
    Stream.pipeThroughChannel(Sse.encode()),
    Stream.encodeText,
  ),
  {
    contentType: "text/event-stream",
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  },
)
```

### 参考 3.2：执行中补充消息（Steering Queue）
**来源项目**：Pi
**文件路径**：`packages/agent/src/agent-loop.ts` (Line 160-270)
**实现细节**：
这是解决 Ranni "双向交互"需求的最关键代码。Pi 的 Agent Loop 在 Turn 的边界主动拉取 `SteeringMessages` 队列，将其注入当前上下文。

```typescript
// 摘自 pi/packages/agent/src/agent-loop.ts
// Outer loop
while (true) {
    let hasMoreToolCalls = true;

    // Inner loop: process tool calls and steering messages
    while (hasMoreToolCalls || pendingMessages.length > 0) {
        // 核心逻辑：在发起下一次模型请求前，注入队列中的外部补充消息
        if (pendingMessages.length > 0) {
            for (const message of pendingMessages) {
                await emit({ type: "message_start", message });
                await emit({ type: "message_end", message });
                currentContext.messages.push(message);
                newMessages.push(message);
            }
            pendingMessages = [];
        }

        // 发起 LLM 请求
        const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
        // ... 执行工具 ...

        // Turn 结束时，再次检查是否有新到达的补充消息
        pendingMessages = (await config.getSteeringMessages?.()) || [];
    }
}
```

### 参考 3.3：独立的 Command 控制流端点
**来源项目**：OpenCode
**文件路径**：`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (Line 293-337)
**实现细节**：
控制指令（如打断、补充 prompt）全部走独立的 POST 请求。

```typescript
// 摘自 opencode/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
  params: { sessionID: SessionID }
  payload: typeof CommandPayload.Type
}) {
  yield* requireSession(ctx.params.sessionID)
  // 将命令压入会话队列，不在此处等待完整事件流
  return yield* promptSvc
    .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
    .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
})
```

---

## 4. 给 Ranni 编码 Agent 的落地指引

当您准备重构时，请遵循以下步骤：

1. **改造通信层**：
   - 废弃 `app.ts` 中基于单次请求生命周期的 `res.write` NDJSON 流。
   - 实现全局的 EventBus，提供 `subscribe(sessionId, lastSeq)` 方法。
   - 新增 `GET /api/events` 提供 SSE 支持（参考 OpenCode 3.1）。
2. **实现 Steering Queue**：
   - 为 Agent 实例添加 `steer(message)` 方法，将消息存入内存队列。
   - 新增 `POST /api/runs/:id/steer` 端点调用此方法（参考 OpenCode 3.3）。
   - 在 `agent.ts` 的 `runAgentTurn` 循环中，在每次请求 LLM 前，检查并注入队列中的消息（参考 Pi 3.2）。
3. **实现 Event Mapper**：
   - 拦截内部的 `TraceToolResult`。
   - 在后端调用 LLM 生成描述，并封装为 `FeedActivity`。
   - 将组装好的 `FeedActivity` 抛入 EventBus。
4. **清理前端**：
   - 删除 `agent-console.tsx` 中的 `requestActivityRewrite` 逻辑。
   - 将前端的状态管理器改造为纯粹消费 SSE 下发事件的只读渲染器。
