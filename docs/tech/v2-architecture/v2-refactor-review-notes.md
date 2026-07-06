---
author: claude
version: v2
date: 2026-07-03
---

# Ranni v2 重构实施 Review Notes

本文档记录「事件驱动 + 前后端解耦」v2 重构的实施结果、对架构设计文档（《Ranni 架构设计思想报告》《Ranni 架构重构实现参考手册》）的符合性核对，以及在实施过程中产生的偏差判断与待议事项。重构本身已按文档指导完成，本文档不打断本轮重构，仅作后续迭代参考。

## 1. 实现概览

新增模块（`lib/events/`、`lib/runs/`）：

| 模块 | 职责 |
|---|---|
| `lib/events/schema.ts` | 三层事件类型定义（ProviderEvent / TraceEvent / ClientNotification）+ 三段式字段（textId / thinkingId）+ 共享展示类型（ActivityDisplay / ProcessIconId / ActivityType）+ `isDurableEventType`。 |
| `lib/events/event-bus.ts` | 进程内 EventBus：per-streamKey(=sessionId) ring buffer + 单调 seq + 同步回放订阅 + `subscribeAll`（mapper 用）。durable 入 buffer 可回放，live-only 仅广播。 |
| `lib/events/legacy-map.ts` | 旧 `StreamEvent` → v2 事件映射纯函数（agent.ts 适配层用，保留 agent 主体 38 处 emit 调用不动）。 |
| `lib/runs/run-registry.ts` | 运行注册表：runId 生成上移、Steering Queue（steer/drainSteer）、abort、并发计数。 |
| `lib/runs/display-fallback.ts` | 从前端抽取的展示文案 fallback 纯函数（前后端共享，mapper 用）。 |
| `lib/runs/activity-rewrite.ts` | 从 app.ts 抽取的 LLM 改写逻辑（prompt / 脱敏 / 解析 / `rewriteActivityDisplay`）。 |
| `lib/runs/event-mapper.ts` | Event Mapper：订阅 TraceEvent 投影为 ClientNotification；`tool.started` 异步 LLM 改写 → `activity.display_updated`；`run.completed` 前 await 未完成改写（8s 超时）；task.state 签名去重。 |

改造的既有模块：

- `lib/agent.ts`：`runAgentTurn` 新增 `runId/sessionId/streamKey/eventBus/registry` 入参，删除 `emit`；内部 emit 适配层把旧 StreamEvent 映射为 v2 事件 publish；循环开头注入 `drainSteer`；`emitAssistantMessage` / thinking 处补 `text.started` / `thinking.started`（三段式）。
- `src/server/app.ts`：删除 `/api/chat`（NDJSON）与 `/api/activity/describe`；新增 `POST /api/runs`（Command，异步启动）、`GET /api/events`（SSE，Last-Event-ID header 优先、query 兜底、心跳）、`POST /api/runs/:id/steer`、`POST /api/runs/:id/abort`；接线 EventBus/Registry/Mapper。
- `components/agent-console.tsx`：删除 `requestActivityRewrite` 与 `/api/activity/describe` 调用、NDJSON reader 循环、reader 专用的 6 个 fallback display 函数与 `removeDuplicateStatusForThinking`；新增 session 级 EventSource + `dispatchEventRef`（消费三层事件）+ `lastSeq` localStorage 持久化；`sendMessage` 改 `POST /api/runs` + 运行中走 steer；`stopAgentRun` 改 `POST abort`。
- `scripts/research-eval.ts`：用 EventBus/Registry + 订阅替代 emit 回调，`toLegacyEvent` 把 v2 事件反向映射回旧 `StreamEvent`，保持既有分析逻辑不变。

## 2. 架构符合性核对

| 文档要求 | 实现 | 状态 |
|---|---|---|
| 事件语义三层分离（Provider live / Trace durable / Notification durable） | `schema.ts` + `DURABLE_EVENT_TYPES`；EventBus 按 durable 标志分配 seq/入 buffer | ✅ |
| 三段式 Started → Delta(live) → Ended(durable) | text/thinking 各有 started/delta/completed，textId/thinkingId 由后端在 started 生成 | ✅ |
| Event Sourcing（seq + 回放 + 断线续传） | EventBus per-session 单调 seq + ring buffer + subscribe(fromSeq) 同步回放；SSE `Last-Event-ID` + 前端 localStorage lastSeq | ✅（内存范围，见 §4） |
| Event Mapper 展示逻辑后移 | `event-mapper.ts`：tool.started 在后端异步 LLM 改写 → display_updated；前端不再二次请求 LLM | ✅ |
| 通信正交化 Command + SSE | `POST /api/runs` / `:id/steer` / `:id/abort` + `GET /api/events`(SSE) | ✅ |
| Steering Queue（turn 边界注入） | RunRegistry steer/drainSteer + agent.ts 循环开头（LLM 请求前）抽取注入 | ✅ |
| 前端退化为只读渲染器 | EventSource + dispatchEvent；删除 requestActivityRewrite；display 直接取自 notification | ✅（语义见 §3.2） |

## 3. 偏差判断与决策（与文档措辞的出入）

### 3.1 改写时机：`tool.started` 而非文档措辞的 `tool.completed`

文档《实现参考手册》§2.1 与《思想报告》§3.2 措辞为「监听 tool.completed 生成文案」。Ranni 现状前端原本在 `tool_call`（即 started）时就改写，目的是让用户尽早看到「正在搜索什么」。本次实现**保留在 `tool.started` 触发改写**：先下发 fallback display 的 `activity.appended`，异步 LLM 完成后发 `activity.display_updated`；`tool.completed` 仅作 Ended 边界（产出 result 的 fallback display）。这与文档措辞略有出入，但更贴合现状 UX（尽早展示）。如需严格对齐文档，可改为 completed 触发。

### 3.2 「前端只读渲染」的实际语义

文档《思想报告》§3.4 称前端「纯粹的只读渲染器，接收到什么就渲染什么」「完全无状态」。实际实现中前端仍维护：feed 顺序、`(runId,textId)` 流累积、`lastSeq`、trace 视图重建（Layer2 → `applyTraceEventToSession`）、steer/abort 的 Command 触发。更准确的表述是「**前端不再承担展示文案推导、不再二次请求 LLM 改写**」，而非「完全无状态」。建议文档修正该措辞，避免误解为前端零状态。

### 3.3 SSE 同时下发三层事件（保留 trace 视图）

文档未明确规定 SSE 是否同时下发 Layer2 TraceEvent。本次为保留 Ranni 既有的 trace/debug 视图（按 run/step 展示 context/request/response/toolCalls），**SSE 同时下发三层**：前端 UI 消费 Layer3 + Layer1 live delta，trace 视图消费 Layer2（经 `toLegacyStreamEvent` 反向映射后复用既有 `applyTraceEventToSession`）。这使前端仍「消费内部 Trace」，但仅用于调试视图，不用于 UI 文案推导——与文档「展示逻辑后移」不冲突。

### 3.4 持久化范围：内存 ring buffer

文档强调「带 seq 持久化 / 落库」「Event Sourcing」。本次采用**进程内内存 ring buffer**（容量 2000/session），满足文档核心诉求（seq + 断线续传 + 重连回放）；进程重启即丢历史事件，TraceRun 的跨重启持久化仍由前端 localStorage 维持（与现状一致）。完整磁盘 Event Store（append-only 文件 / DB）列为后续演进（见 §4）。这是 local-first 单进程场景下的合理取舍。

### 3.5 Steering 注入的语义

注入的补充消息按 `PlainMessage { role:"user" }` 直接 push 进 conversation，并 emit 一条 `run.status` 告知前端「已接收补充消息」。文档未规定模型侧是否需要特殊 system 提示（如「以下为执行中补充的用户新指令」）。当前实现未加特殊标记，模型将其视为普通用户新轮输入。若评测发现模型对补充消息响应不理想，可考虑在注入时附带 system/前缀提示。

### 3.6 task.state 去重后移

原前端按 `currentMode|nextAction|verification.status` 签名对 task_state 去重。本次将去重后移到 event-mapper（per-run 签名缓存），run.completed 时清理。前端 dispatchEvent 不再做该去重。

### 3.7 Vite dev proxy 下 SSE 兼容性

`vite.config.ts` 的 `/api` 代理在 dev 模式下转发 SSE。http-proxy 默认对 `text/event-stream` 透明（不缓冲），但非保证。生产 build 同源无此问题。建议 dev 模式手测 SSE 流式性（见 §5）。

## 4. 已知限制与后续演进

- **磁盘持久化**：当前内存 ring buffer，重启丢历史。后续可按 session append-only 写 `.ranni/events/<sessionId>.ndjson`，实现跨重启回放。
- **ring buffer 容量**：2000/session，超出删最旧。`subscribe(fromSeq < earliest)` 会丢失早期事件（前端可检测 `firstReplayedSeq > fromSeq+1`）。长任务 trace 视图历史可能截断。
- **多 session SSE**：前端当前单 activeSession 一个 EventSource。多 session 并发订阅场景未实现。
- **mapper 阻塞**：run.completed 前 await 未完成改写（8s 超时）。极端情况下改写慢会延迟 run_completed 通知最多 8s。
- **EventSource 重连**：依赖浏览器自动重连 + Last-Event-ID header。代理若剥离 header 会退化为 query lastSeq（前端 localStorage）。

## 5. 验证状态

- `npm run typecheck`（前端 + 后端）：通过。
- `npm run lint`：通过（清理了 reader 删除后的 7 处 unused）。
- `npm run build`（vite + tsc emit）：通过。
- 运行时端到端手测（启动 run 看 fallback→model display 更新、steer 补充、abort、trace 视图、断线重连）：**待用户在配好模型 key 的环境执行** `npm run dev` 验证；尤其建议验证 §3.7 的 Vite proxy SSE 流式性与 §3.5 的 steer 注入效果。
