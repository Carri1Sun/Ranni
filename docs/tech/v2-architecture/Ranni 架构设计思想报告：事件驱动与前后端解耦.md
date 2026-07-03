---
author: manus
version: v2
date: 2026-07-03
---

# Ranni 架构设计思想报告：事件驱动与前后端解耦

本报告旨在为 Ranni 的下一代架构演进提供核心设计思想与理论支撑。报告深入剖析了 Ranni 当前架构的耦合痛点，并提炼了业界顶尖开源 Agent 框架（OpenCode、Pi、Codex）的最佳实践，最终给出了针对 Ranni 的新版架构设计蓝图。

## 1. 现状剖析：Ranni 的三大耦合痛点

Ranni 在 Agent 编排理念（驾驭 LLM 而非流程化）上表现优异，但在工程实现上，尤其是事件驱动与通信层，存在以下核心痛点：

### 1.1 事件语义混杂
在 Ranni 中，核心的 `StreamEvent` 联合类型将三类生命周期完全不同的事件混为一谈：
- **生命周期事件**（如 `run_started`）
- **可观测轨迹事件**（如 `model_request`）
- **UI 渲染片段事件**（如 `thinking_delta`）

这种混杂使得系统无法在底层区分哪些是需要持久化的关键状态，哪些是即抛型的内存态数据。

### 1.2 通信生命周期强绑定
Ranni 当前的后端通信采用单次 HTTP 请求结合 NDJSON 响应流模式。Agent 内部调用 `emit` 等价于直接写入 HTTP 响应。这种设计导致 Agent 的运行生命周期与单个 HTTP 请求强绑定，缺乏独立的事件总线或注册表，断线即丢失事件，无法实现断点续传（Resume）或回放（Replay）。

### 1.3 展示事件与内部 Trace 强耦合
前端承担了过重的状态推导职责。前端不仅需要解析复杂的后端 Trace 结构以推导 `FeedActivity`，甚至在接收到工具调用事件后，还需要主动发起额外的 `/api/activity/describe` 请求，利用 LLM 进行二次改写以生成 UI 文案。展示逻辑反向依赖了业务模型调用，导致前后端边界模糊。

---

## 2. 核心设计原则与开源启发

为了解决上述痛点，我们调研了三个成熟的开源项目，并提炼出以下核心设计原则。

### 2.1 事件三段式与 Event Sourcing（启发自 OpenCode）
OpenCode 采用了严格的事件溯源（Event Sourcing）设计，区分了进程内的总线事件与持久化事件。更重要的是，它将事件规范为 `Started` -> `Delta` -> `Ended` 的三段式模型。
- **Delta**：被定义为 "live-only"（仅实时），不进行持久化。
- **Ended**：作为可回放的完整值边界进行落库。
这一设计天然地分离了内存态增量与持久化全量数据。

### 2.2 协议映射与投影层（启发自 Codex）
Codex 展示了教科书般的解耦设计。它在内部维护了一套细粒度的 Core Protocol（如 `EventMsg`），而对外提供的是基于 JSON-RPC 风格的 App-Server Protocol。两者之间通过专门的 `event_mapping.rs` 进行显式投影。
**核心思想**：后端展示事件与 Agent 事件本身解耦。前端不再消费内部的 Trace，而是消费经过映射层处理后的标准化 UI 通知。

### 2.3 队列注入与通信通道正交化（启发自 Pi）
针对"执行中补充消息"（Steering / Follow-up）的需求，Pi 的实现非常巧妙：它并没有依赖全双工的 WebSocket 连接，而是为 Agent Loop 提供了专门的消息队列（Steering Queue）。
- **控制指令（上行）**：通过独立的 HTTP POST 请求发送，将消息推入队列。
- **事件广播（下行）**：通过单向的 stdio（或 SSE）流持续输出。
在 Agent 的 Turn 边界，Loop 会主动抽取队列中的消息并注入上下文。这种**通信通道正交化**的设计，使得控制流与事件流各司其职。

---

## 3. 新版架构设计蓝图

基于上述原则，Ranni 的新版架构将围绕以下几个维度进行重构：

### 3.1 语义分层：拆分 StreamEvent
将庞大的 `StreamEvent` 拆分为三个独立领域：
1. **AI Provider 层事件**：纯粹的模型生成片段（如 `text.delta`），不落盘。
2. **Core Trace Events**：Agent 运行时的核心状态变迁（如 `tool.started`, `tool.completed`），必须带序列号（seq）持久化。
3. **Client Notifications (UI Events)**：面向前端的标准化渲染事件。

### 3.2 引入 Event Mapper：展示逻辑后移
彻底解决前端二次请求 LLM 改写 UI 文案的问题。
- 在后端引入 **Event Mapper** 层。
- Mapper 监听内部的 Core Trace Events，遇到需要展示的事件（如 `tool.completed`）时，**在后端异步调用 LLM** 生成展示文案。
- Mapper 将生成的文案包装为 Client Notification（如 `message.part.completed`）推入专门的 UI EventBus。
- 前端退化为纯粹的"只读渲染器"，接收到什么就渲染什么。

### 3.3 通信架构：Command 控制流 + SSE 广播流
针对 Ranni "下行洪流 + 上行细流" 的不对称通信特征，我们明确推荐 **Command (HTTP REST) + SSE** 组合，而非 WebSocket。

#### 为什么选择 SSE + Command？
1. **原生断线续传**：SSE 协议内建 `Last-Event-ID`，与基于序列号（seq）的事件溯源设计完美契合，几乎零成本实现重连与回放。
2. **职责清晰与正交**：
   - **Command 通道**（如 `POST /api/runs/:id/steer`）：用于发送离散、低频的控制指令（启动、打断、补充消息、审批），拥有明确的 HTTP 状态码与回执。
   - **Event 通道**（`GET /api/events` via SSE）：专门负责高频、单向的下行事件广播。
3. **基础设施友好**：普通的 HTTP 长连接，无需处理复杂的代理穿透、心跳保活与鉴权握手。

#### 关于"执行中补充消息"的误区
补充消息本质上是**"往运行中的 Agent 队列里投递一条命令"**，它是一个离散的、即发即忘的上行动作。正如 Pi 和 OpenCode 的实现一样，这完全可以通过普通的 HTTP POST 完成（将消息压入 Steering 队列），而补充后的效果自然会通过下行的 SSE 事件流反馈给客户端。这是一种**请求-响应式双向**，而非需要 WebSocket 的**全双工流式**（后者适用于交互式终端或实时语音）。

### 3.4 架构流转总结
1. **指令下发**：前端通过 REST API（Command）发起任务或补充消息。
2. **核心运行**：后端独立运行 Agent Loop，产生 Core Trace Events 并落库。
3. **事件投影**：后端的 Event Mapper 捕获核心事件，异步生成 UI 文案，转化为 Client Notifications。
4. **单向广播**：通过 SSE 通道将 Client Notifications 持续推送给前端，前端进行纯粹的无状态渲染。

通过这一套设计，Ranni 将实现真正的事件驱动与前后端解耦，为未来的大规模扩展奠定坚实的工程基础。
