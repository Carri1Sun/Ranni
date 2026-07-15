---
author: manus
version: v2
date: 2026-07-14
---

# Ranni 通用 Agent Harness：可观测性与交付开发方案

> 状态：核心可观测性、交付闭环与真实运行验收已完成
>
> 文档角色：Event Log、Trace、后端持久化、运行概览、Step 查看器、施工批次、测试与迁移
>
> 共享契约：以《总览与共享契约》为准

## 文档导航

- [总览与共享契约](./01-overview-and-contracts.md)
- [Runtime 与质量闭环](./02-runtime-and-quality.md)
- 可观测性与交付（当前）

## 开发边界

本文件负责运行事实的持久化与产品投影，并维护整套方案的施工顺序、测试、灰度、风险和完成定义。Runtime 内部控制流和领域 Policy 由《Runtime 与质量闭环》负责。

## 当前实施摘要（2026-07-15）

| 范围 | 当前实现 |
| --- | --- |
| durable events | 已增加 Tool Batch / Receipt、Observed State、Plan、Attempt、Acceptance、Progress、Recovery 和 Completion 事件 |
| Run Trace | `RunTraceStore` 将脱敏 Event Log、Run summary、`overview.json`、Step index 和逐 Step I/O 写入 Session workspace |
| 输入冻结 | 首次 `context.snapshot` 与 `model.request` 保存 Context 和 exact request，并生成持久化 input snapshot hash |
| 输出聚合 | 聚合 thinking、assistant text、tool call/result/receipt、TaskState、Observed、Plan Revision / Objective Projection、Attempt state、Assumption、Acceptance、Progress、Completion 与 Recovery |
| 查询 API | 已提供 Session Run 列表、Run Overview Projection、Run Step 索引、单 Step I/O 四个接口 |
| EventMapper | 默认采用确定性映射；共享 reducer 把语义事实投影为携带完整快照的 `run.overview.updated`；辅助模型改写需要显式环境变量启用 |
| 产品 UI | 运行状态栏整体计划面板、计划与进度视图、计划变化时间线、运行概览、上下文健康和 Step 输入输出查看器已消费运行级快照与持久化 API |

运行中的查询使用 RunRegistry workspace 映射；历史 Session 由 UI 附带已选择的 workspaceRoot，后端据此发现进程重启前的 Run 和 Step I/O。Runtime 已支持 `recoveryState` 恢复入口和 `run.started.resumedFromCheckpoint` 标记。独立 Raw / Diff / 区间导出 API、cursor / filter、checkpoint 选择与恢复 UI 和完整运行控制区继续作为后续工作。

首批 UI 已包含运行概览、运行状态栏整体计划面板、计划与进度视图、计划覆盖、交付验收、当前计划、当前路线、下一步、计划变化时间线、验收清单、交付缺口、当前阻塞、完成依据、进展回执，以及 Step 的 Input / Output / 原始数据、输入构成、上下文健康和工具配对。Step 对比、筛选搜索、长列表虚拟化、暂停与 checkpoint 恢复按钮仍属于本章后续设计。

指定的 GLM-5.2 调研与八页新粗野风格 PPTX 任务已经完成真实后台运行。持久化 Trace、八页 PPTX、渲染预览和验证回执均已检查，最近工具结果、工具配对、完成判定与最终状态保持一致。

## 1. Event Log、Trace 与后端持久化

### 1.1 事件分层

保持现有三层事件模型：

1. Provider Event：模型流式 delta 和底层协议事件。
2. Trace Event：Run、Step、Context、请求、响应、工具、状态和回执的持久事实。
3. Client Notification：面向消息流和 UI 的投影。

新增或扩展以下 Trace Event：

- `context.snapshot`
- `model.request`
- `model.response`
- `tool.batch.started`
- `tool.completed`
- `tool.receipt`
- `state.observed.updated`
- `plan.updated`
- `attempt.updated`
- `assumption.invalidated`
- `acceptance.updated`
- `progress.receipt`
- `step.completed`
- `recovery.started`
- `completion.checked`

`plan.updated` 携带完整 `PlanChange.snapshot`，`kind` 区分 Plan Revision、Objective Projection 和 Finalization。`attempt.updated` 携带 `AttemptDelta` 与转换后完整 `attemptState`，可以独立重放路线状态。`assumption.invalidated` 只在相同策略连续产生真实失败回执，或 `noMeaningfulProgressStreak` 达到路线重置阈值时发布，记录 assumptionIds、reason 和 evidenceRefs。`noObjectiveProgressStreak` 的 3 / 6 轮阈值只发布交付节奏提醒。

EventMapper 和 RunTraceStore 共同使用 `lib/runs/run-overview-projection.ts` 的纯 reducer。`context.snapshot`、`task.state`、`state.observed.updated`、`plan.updated`、`attempt.updated`、`acceptance.updated`、`progress.receipt`、`completion.checked` 和 `recovery.started` 会更新当前 Run 的完整 `RunOverviewProjection`。EventMapper 把变化后的完整快照放入 durable `run.overview.updated`；该通知只更新运行状态栏与运行详情，不新增消息流过程项。

新 `recovery.started` 只携带 Acceptance Gap、Context snapshot hash、错误和 checkpoint 元数据（schema version、已完成 Step、Plan Revision、Active Attempt ID、checkpoint 引用）。完整 `AgentRunRecoverySnapshot` 在 Task Memory checkpoint JSON 中持久化一次，减少 Trace 重复。旧 Trace 可能仍含内联 `runState`，读取侧按历史数据兼容。

### 1.2 Run 级运行概览投影

`RunOverviewProjection` 是当前 Run 的完整聚合快照：

```ts
type RunOverviewProjection = {
  schemaVersion: 1;
  runId: string;
  latestSeq: number;
  updatedAt: number;
  plan?: PlanSnapshot;
  attempt?: PlanAttemptLedgerSnapshot;
  acceptance?: AcceptanceSnapshot;
  progress?: StepProgressReceipt;
  taskState?: TaskState;
  observedState?: ObservedState;
  completion?: RunOverviewCompletion;
  recovery?: RunOverviewRecovery;
  timeline: RunOverviewTimelineEntry[];
};
```

投影器的顺序与幂等契约：

- `latestSeq` 指向最近一次被投影接受的 Layer 2 事实事件。
- 同 Run 的事件或快照满足 `seq <= latestSeq` 时保持当前投影，SSE 重放和乱序到达不会把 UI 回退到较早现场。
- `context.snapshot` 可以为新 Run 或 Recovery Run 恢复当前可得的 Working Plan、Attempt、Acceptance Gap、Progress、TaskState 和 Observed State。
- `plan.updated`、`attempt.updated` 和 `acceptance.updated` 使用事件中的完整结构替换对应当前值；Progress、Completion 和 Recovery 使用最近有效值。
- 时间线最多保留最近 120 条计划修订、计划项状态、Plan Focus、路线、验收、进展、完成与恢复变化。

`overview.json` 和 `run.overview.updated` 使用同一结构。API 负责刷新、服务重启和断线后的快照恢复，SSE 负责运行中的实时同步。前端只接受 Run ID 匹配且 `latestSeq` 更新的快照。

结构化 `PlanSnapshot` 是计划 UI 的权威来源。`TaskState.plan` 只提供标题列表兼容引导；Run 一旦通过 `update_plan` 进入 `structured` 计划权威模式，后续旧 `update_task_state.plan` 输入只会同步现有标题投影，不会替换结构化计划项。

### 1.3 Step I/O 数据模型

```ts
type TraceStepIO = {
  stepId: string;
  stepIndex: number;
  input: {
    envelope: ContextEnvelope;
    exactRequest: TraceModelRequest;
    snapshotHash: string;
  };
  output: {
    thinking: string;
    response?: TraceModelResponse;
    assistantText: string;
    toolCalls: TraceToolCall[];
    toolResults: TraceToolResult[];
    stateDelta: StateDelta;
    planChanges: PlanChange[];
    latestPlanState?: PlanSnapshot;
    attemptDeltas: AttemptDelta[];
    latestAttemptState?: PlanAttemptLedgerSnapshot;
    acceptanceDelta: AcceptanceDelta;
    progressReceipt: StepProgressReceipt;
    error?: string;
  };
};
```

Input 在模型请求发出前冻结。Output 在 reasoning、tool 和 receipt 到达时增量补齐，Step 结束后封存。

### 1.4 存储布局

完整 Step Trace 已保存在 Session workspace：

```text
.ranni/runs/<runId>/
├── run.json
├── overview.json
├── step-index.json
├── trace.jsonl
└── steps/
    ├── 0001-input.json
    ├── 0001-output.json
    ├── 0002-input.json
    └── 0002-output.json
```

职责：

- `trace.jsonl`：完整追加 Event Log。
- `overview.json`：当前 Run 的完整 `RunOverviewProjection`，通过原子替换保持可恢复读取。
- `step-index.json`：轻量 Step 摘要，用于列表和筛选。
- `steps/*-input.json`：实际 Input Snapshot 与 Context Manifest。
- `steps/*-output.json`：模型输出、工具配对、状态、Plan Change / latest Plan state、Attempt Delta / latest Attempt state、Acceptance Delta 和 Progress Receipt。

写入采用增量追加和原子替换。API Key、Authorization Header 和其他敏感字段在落盘前脱敏。

### 1.5 查询 API

当前已实现：

```text
GET /api/sessions/:sessionId/runs?workspaceRoot=<workspace>
GET /api/runs/:runId/overview?workspaceRoot=<workspace>
GET /api/runs/:runId/steps?workspaceRoot=<workspace>
GET /api/runs/:runId/steps/:stepId/io?workspaceRoot=<workspace>
```

后续扩展：

```text
GET /api/runs/:runId/steps/:stepId/raw
GET /api/runs/:runId/steps/:stepId/diff?against=previous
GET /api/runs/:runId/steps?cursor=&filter=
```

前端选择 Run 后先加载 `overview.json` 对应的完整运行概览投影，同时加载 Step 索引；用户选中 Step 后按需加载详细 I/O。运行概览通过 `run.overview.updated` 实时同步，运行中的 Step 继续通过 SSE 增量更新。Session Run 列表可以带 `workspaceRoot`，合并当前进程 Run 与磁盘中匹配 sessionId 的历史 Run。

### 1.6 老 Trace 兼容

旧 Trace 缺少 semantic sections 和 Progress Receipt 时：

- 使用现有 system prompt、messages、tools、request、response 和 tool records。
- UI 标记 `Legacy Trace`。
- 缺少 `overview.json` 时，整体计划面板标记“Step 回退”，并从当前可读 Step 的结构化字段或 `TaskState.plan` 兼容投影生成只读展示。
- 输入页展示可确定的顶层区块。
- 上下文健康检查中将无法计算的字段标记为 unknown。
- 原始数据仍然可以查看和导出。

## 2. Step 输入输出查看器

### 2.1 产品位置

现有「运行详情页」提供三个信息层次：

1. 默认进入面向用户的「运行概览」，展示当前计划、当前路线、交付缺口、验收结果、阻塞和完成依据。
2. 「计划与进度」展示当前 Run 的完整整体计划、计划覆盖、交付验收、计划项、当前路线和变化时间线。
3. 「Step 输入输出查看器」面向开发者，检查用户所选历史 Step 的 Context、模型响应、工具回执和原始数据。

用户无需阅读原始 Trace 即可判断 Agent 是否持续推进、为何改变路线以及凭什么宣告完成。

运行概览和计划与进度视图读取 Run 级 `RunOverviewProjection`，表达当前完整快照。Step 输入输出查看器读取用户选择的历史 Step I/O，表达该 Step 的冻结现场。用户定位到旧 Step 时，整体计划面板继续显示当前 Run 快照；计划变化时间线条目可以把查看器定位到对应 Step。

「运行状态栏」承担摘要和入口：

```text
当前 Step 150
Input       28.7k
Output      814
结果        无交付推进
因果尾部    完整
上下文占用  2.7%

[查看 Step 输入输出]
```

消息流不增加新的调试卡片。现有过程项的信息按钮可以深链到对应 Step。

### 2.2 运行概览与后续用户控制

当前运行概览已经展示 Working Plan、当前 Attempt、验收、交付缺口、阻塞、下一步、完成依据和进展回执。运行状态栏内的整体计划面板使用紧凑形态，“计划与进度”使用完整形态。下图中的暂停与 checkpoint 恢复属于后续完整控制区设计：

```text
┌──────────────────────────────────────────────────────────────────┐
│ Run #3 · 正在执行 · 计划焦点：P07 导出与验证              │
├──────────────────────────────────────────────────────────────────┤
│ 计划覆盖        6 / 8                                           │
│ 交付验收        8 / 11                                          │
│ 已完成          研究、Manifest、Styles、7 个页面                 │
│ 待验收          export、视觉检查、最终 PPTX                      │
│ 当前阻塞        第 5 页布局验证失败                              │
│ 当前路线        局部修复后重新渲染 · Attempt 3                  │
│ 最近计划修订  R4 · 根据验证回执聚焦 P07                        │
│ 下一步          修复第 5 页并重新执行视觉检查                    │
│                                                                  │
│ [调整计划] [查看计划变化] [暂停] [从检查点恢复] [Step 详情]    │
└──────────────────────────────────────────────────────────────────┘
```

运行概览展示：

- Working Plan、Plan Focus、Plan Revision 和 Objective Projection。
- 计划覆盖 `satisfied / 有效计划项`，分母排除 `cancelled` 和 `superseded`。
- 交付验收 `passed + waived / required`，只统计必需 Acceptance Criterion。
- 当前 Attempt 的具体 approach 及最近一次路线替代原因。
- Acceptance Ledger 的 passed、pending、failed、unknown、waived 数量。
- 当前 Deliverable Gap、阻塞和最近 regression。
- 下一步和最近 objective progress。
- 查看计划变化、完成依据和进入 Step 详情的入口。

计划覆盖与交付验收是两个独立维度。Working Plan 修订可能改变计划覆盖分母；Acceptance Snapshot 变化更新交付验收。UI 同时展示两项，避免把模型内部工作拆解数量当成交付完成度。

“调整计划”入口回到会话页并预填自然语言计划调整要求。用户发送后，该要求通过 Composer 或运行中的 Steering 通道进入 Agent；模型据此调用 `update_plan`。Plan Ledger 只在覆盖、顺序、范围、状态报告或 Plan Focus 发生语义变化时创建真实 Plan Revision，随后 `plan.updated → run.overview.updated` 同步整体计划面板和计划变化时间线。

结构化 Working Plan 持续作为计划权威。`TaskState.plan` 只在结构化计划尚未建立时提供 Legacy 兼容引导；进入 `structured` 计划权威模式后，旧 `update_task_state.plan` 输入不会覆盖稳定 Plan Item ID、依赖、验收引用、状态来源或 Plan Focus。

运行中的补充消息继续通过现有 Steering 通道提交。Runtime 恢复调用接受 `recoveryState`，重建 Working Plan、PlanAttemptLedger、Progress、Acceptance、Observed State 和 Conversation，保留原 Attempt 历史，再把新 Steering 追加到现场。Server 会让同 Session、同 workspace 的下一 Run 一次性消费失败 Run 的可恢复状态。暂停、checkpoint 选择 UI 和完整运行控制区作为后续增强。完整分支树和并行路线比较继续根据真实运行数据评估。

### 2.3 Step 输入输出布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ Run #3 · Step 150 · Completed · 28.7k → 814 · 31.2s             │
│ Progress: No change · Context: 2.7% · Causal integrity: Warning  │
├──────────────────┬───────────────────────────────────────────────┤
│ Run / Step 列表   │ [输入] [输出] [原始数据]                     │
│                  │                                               │
│ Step 147 失败     │ 上下文健康检查                                │
│ Step 148 +证据    │ 上一轮工具结果       1 / 1                    │
│ Step 149 状态     │ 最近因果轮次         3                        │
│ Step 150 无交付推进 ◀ │ 旧 Reasoning 回放    0                    │
│ Step 151 无交付推进   │ 被省略最近工具结果   0                    │
│                  │                                               │
│ 筛选              │ 输入构成列表                                  │
│ 全部 / 进展       │ ▸ System Prompt       24.1k tokens           │
│ 无交付推进 / 失败 │ ▸ Task Contract       1.2k tokens            │
│ 工件变化          │ ▾ Working Set         2.4k tokens            │
│                  │ ▾ Recent Causal Tail  3 steps                 │
│                  │ ▸ Archive Summary      4.1k tokens            │
│                  │ ▸ Available Tools      19 tools               │
└──────────────────┴───────────────────────────────────────────────┘
```

### 2.4 Step 列表

每个 Step 显示：

- 编号和状态。
- 耗时。
- Input / Output Token。
- Stop Reason。
- 主要进展类别。
- Objective Progress、Information Gain 和 Regression 状态。
- Plan Focus、Active Attempt 与策略签名变化。
- 主要工具或主要 artifact delta。

筛选项：

- 全部。
- 有进展。
- 无交付推进。
- 失败。
- 工件变化。
- Recovery。

支持按工具名、文件路径和文本搜索。长列表使用虚拟滚动。

### 2.5 输入页

输入页使用一层平铺的可折叠列表，固定顺序如下：

1. System Prompt。
2. Task Contract。
3. Working Set。
4. Recent Causal Tail。
5. Archive Summary。
6. Steering Messages。
7. Available Tools。
8. Context Composition。

每个顶层行显示：

```text
名称 · 项目数量 · token / chars · changed / unchanged · pinned / summarized
```

展开后显示语义条目，继续提供“查看原始内容”。

Working Set 展开后单独展示 Working Plan compact snapshot、Plan Focus、当前 Attempt、有效假设、Acceptance Gap 和 unresolved regression。已经失效的假设只显示引用和失效原因，不混入当前建议。

### 2.6 上下文健康检查

```text
上一轮完整工具结果        6 / 6
最近完整因果轮次          3
最新用户补充消息          1
旧 Reasoning Metadata     0
被省略历史工具调用        82
被省略最近工具调用        0
重复观察                  2
无交付推进连续轮数        3
同策略失败连续轮数        2
失效假设                  1
压缩原因                  budget
稳定前缀                  18.4k tokens
前缀失效原因              none
```

健康检查只展示事实，不替代 Agent 的策略判断。

### 2.7 输出页

顶层平铺：

1. Thinking。
2. Assistant Text。
3. Tool Calls and Results。
4. State Delta。
5. Plan Revision and Objective Projection。
6. Progress Receipt。
7. Attempt and Assumption Delta。
8. Acceptance Delta。
9. Completion Decision。
10. Error and Recovery。

Tool Call 和 Tool Result 按 toolUseId 配对。并行调用显示为同一批次，避免用户在两个 JSON 区块间手工查找。

### 2.8 后续增强：与上一轮对比

独立 Step Diff 尚未进入首批产品投影。后续实现使用确定性 Diff：

- Context Section 增删与 hash 变化。
- Token 和 message 数量变化。
- Tool Definitions 变化。
- 上一轮 tool pair 是否保留。
- Task Contract、Working Set 和 Agent Note 变化。
- State Delta、Artifact Delta、Plan Revision / Objective Projection、Attempt Delta、Acceptance Delta 和三轴 Progress Delta。

示例：

```text
Step 149 → Step 150

Input
+ System Prompt           +321 chars
= Task Contract           unchanged
= Working Set             semantically unchanged
- Tool Result             update_task_state missing

Output
= Next Action             写入 Manifest
= External Progress       false
= Tool Strategy           update_task_state
```

### 2.9 原始数据页

保留以下原始内容：

- Exact Model Request。
- Exact Model Response。
- Context Snapshot。
- Trace Events。
- Tool Definitions。
- Provider Metadata。

当前原始数据页展示后端已经脱敏的 Step I/O JSON。独立复制、下载当前 Step、下载 Step 区间和导出 JSON API 属于后续增强。

### 2.10 实时更新

正在运行的 Step 展示四个状态：

```text
Context ready
→ Model streaming
→ Tools running
→ Receipt finalized
```

Input Snapshot 在模型请求发出时冻结。Thinking、Tool Call、Tool Result 和 Progress Receipt 逐步补齐 Output。

Run 级当前快照同步遵守以下顺序：

1. TraceEvent 进入共享 Run Overview reducer。
2. reducer 生成带较新 `latestSeq` 的完整 `RunOverviewProjection`。
3. RunTraceStore 原子更新 `overview.json`。
4. EventMapper 发布 durable `run.overview.updated`。
5. 前端按 Run ID 和 `latestSeq` 替换整体计划面板、运行概览和计划与进度视图。

相同或更早 `latestSeq` 的 SSE 重放不会回退当前 UI。历史 Step I/O 的选择只影响 Step 输入输出查看器。

### 2.11 UI 命名

本方案使用以下统一命名，并已同步到 `UI-NAMING.md`：

- 运行概览。
- 计划与进度视图。
- 整体计划面板。
- 计划同步标记。
- 计划覆盖指标。
- 交付验收指标。
- 计划项列表。
- 计划变化时间线与计划变化项。
- 调整计划按钮与查看计划变化按钮。
- 当前计划。
- 当前路线。
- 验收清单。
- 交付缺口。
- 完成依据。
- Step 输入输出查看器。
- 输入构成列表。
- 输入构成项。
- 输出构成列表。
- 输出构成项。
- 上下文健康检查。
- 原始数据。
- 进展回执（Progress Receipt）。
- 因果链完整性。

暂停、checkpoint 恢复和 Step 对比进入产品后，再同步补充对应的当前 UI 命名。

### 2.12 可观测性代码地图

| 文件或目录 | 主要职责与改动 |
| --- | --- |
| `lib/trace.ts` | Context Section、Composition Manifest、Progress Receipt、Step I/O 类型 |
| `lib/events/schema.ts` | 定义 `plan.updated`、完整 `attemptState`、精简 recovery checkpoint 元数据、`run.started.resumedFromCheckpoint`、`run.overview.updated` 与其他 durable event / notification |
| `lib/events/legacy-map.ts` | 新旧事件兼容 |
| `lib/runs/run-overview-projection.ts` | Run 级完整快照、`latestSeq` 幂等和计划变化时间线的共享纯 reducer |
| `lib/runs/event-mapper.ts` | Trace 到 UI Notification 的确定性投影，发布完整 `run.overview.updated` 快照 |
| `lib/runs/activity-rewrite.ts` | 辅助请求隔离或默认停用 |
| `lib/runs/run-trace-store.ts` | 脱敏 Event Log、Run summary、`overview.json`、Step index 和逐 Step I/O 持久化 |
| `src/server/run-trace-routes.ts` | Session Run 列表、Run Overview Projection、Step 索引和单 Step I/O 查询 API |
| `src/server/app.ts` | 初始化 Trace Store，并在启动 Run 前建立持久化目录 |
| `components/agent-console.tsx` | 运行概览 API 与 SSE 完整快照协调、`latestSeq` 幂等、运行详情装配、重启后历史发现和运行状态栏入口 |
| `components/run-plan-progress.tsx` | 整体计划面板、两类进度、计划项、当前路线、自然语言调整入口和计划变化时间线 |
| `components/run-observability.tsx` | 运行概览、Step 输入输出查看器、Context 健康、输入输出与 Raw tabs |
| `components/run-observability-model.ts` | Run 级当前投影优先、Plan / Acceptance / Progress / Attempt UI 投影、工具配对、因果健康和 Step / Legacy fallback |
| `components/agent-console.module.css` | 整体计划面板、进度条、变化时间线、语义卡片、验收状态、输入输出 tabs、Context health 和窄屏布局 |
| `UI-NAMING.md` | 新增可见模块的统一命名 |

实现时可以进一步拆分 `agent-console.tsx`，例如：

```text
components/run-inspector/
├── step-io-viewer.tsx
├── step-navigator.tsx
├── context-section-list.tsx
├── context-health.tsx
├── step-output-list.tsx
├── step-diff.tsx
└── raw-trace-view.tsx
```

## 3. 分批施工方案

施工批次用于控制代码变更风险，不映射为 Runtime 固定阶段。

### 第零批：冻结行为并拆分 `agent.ts`

目标：先建立可测试的编排边界，防止 Context V2、Progress、Acceptance 和 Recovery 继续堆入 3000 行单文件。

第零批由多个可独立合并的机械迁移提交组成，禁止一次性重写。事故根因的最小修复可以在 characterization fixture 建立后立即落地；Context V2 和新状态模型的主体实现进入新的模块边界。

工作项：

1. 为当前成功工具、工具失败、非法工具、unsafe tool call、Steering、abort、空 final 修复、chunked final、Research Guard、Completion Guard 和 Provider failure recovery 建立 characterization trace fixture。
2. 冻结关键事件顺序、stop reason、conversation tool call/result 配对和 Task Memory 写入结果。
3. 创建 `lib/agent/` 目录与稳定 `types.ts`，保留 `lib/agent.ts` 公共导入路径。
4. 先抽取纯函数和低耦合设施：streaming、event sink、chunk protocol、Prompt builder、Context Snapshot builder。
5. 抽取 Tool Batch Executor，首轮保持当前顺序执行语义，统一成功、失败和 blocked 回执路径。
6. 把 `createToolTaskStatePatch` 改成 Receipt Registry 的兼容投影。
7. 通过 `lib/agent/runtime-services.ts` 创建 Research Notebook 与 Task Memory，由 `lib/research.ts` 提供具体 Research 能力。
8. 把 `SlideArtifactPhase`、静态工具集合和 phase 推进迁入 `lib/html-to-pptx/artifact-policy.ts`。
9. 引入 `AgentRunState`、`StepOutcome`、Step Runner 和 Run Controller，逐步替换主循环内的局部 counter 与 `continue`。
10. 把 final、guard retry 和 provider recovery 迁入 Finalization Controller 与 Recovery Controller。
11. 更新测试导入：allowlist 测试归属 Artifact Policy，unsafe tool call 测试归属 Tool Batch Executor。
12. `src/server/app.ts` 和 `scripts/research-eval.ts` 继续通过 `lib/agent.ts` 调用 `runAgentTurn`。

验收：

- `lib/agent.ts` 只保留 50–100 行 facade。
- `runAgentTurn` 编排实现不超过 150 行。
- 通用 Run Controller 与 Step Runner 的业务控制流不包含按 Research 或 HTML-to-PPTX 名称分支；`runtime-services.ts` 只承担领域服务创建适配。
- 相同 fixture 的 durable event 顺序、stop reason、tool pair 和最终状态保持一致。
- 拆分阶段保持工具顺序执行，避免结构迁移同时改变并发语义。
- 不产生 `agent/`、Policy、Receipt Registry 之间的循环依赖。
- `npm run typecheck`、`npm run lint`、`npm run build` 和现有测试全部通过。

### 第一批：因果正确性与恢复正确性

目标：先消除这次 112 轮状态循环的根因。

工作项：

1. 引入 `CausalTurn` 和 `ContextEnvelope`。
2. 下一轮无条件保留上一轮完整 tool call/result。
3. 移除 artifact phase 触发的强制压缩。
4. 压缩只由 Token 预算触发。
5. 清理旧 Provider reasoning metadata 回放。
6. Context Snapshot 增加 Composition Manifest。
7. Recovery 增加 Deliverable Contract 检查。
8. incomplete artifact 保留现场并恢复执行。
9. Provider Adapter 记录稳定前缀 hash、失效原因和 continuation 方式。

验收：

- Step N 的全部工具结果 100% 出现在 Step N+1 Input。
- 并行 8 个工具时完整保留 8 个结果。
- Phase 切换不会删除 Recent Causal Tail。
- 窗口占用低于阈值时不启用压缩。
- 工件 pending 时不会进入 final synthesis recovery。
- Working Set 更新不会破坏 Provider-required tool pair 顺序。
- Task Contract、Skill 和工具集合未变化时稳定前缀 hash 保持一致。

### 第二批：完成度、路径纠偏与 Skill 韧性

目标：让 Harness 识别交付推进、及时退出失败路线，并保持 Skill 运行能力连续。

工作项：

1. 拆分 Task Contract、Observed State 和 Agent Note。
2. 增加 Working Plan / Plan Ledger、Attempt / PlanAttemptLedger、Assumption Record 和策略签名。
3. 增加 `update_plan` 与 `replace_attempt`，将 Plan Revision 和路线替代分开。
4. 增加 Acceptance Ledger，并从 Task Contract 派生 required criteria。
5. `update_task_state` 改为 delta patch 和 `noChange` 回执。
6. Tool Receipt 覆盖文件、命令、研究、artifact 和验证工具。
7. 实现 objective progress、information gain、regression 三轴 Progress Receipt。
8. 实现同策略真实失败 2 轮检查、`noObjectiveProgressStreak` 3 / 6 轮提醒、`noMeaningfulProgressStreak` 6 轮路线重置与 10 轮 checkpoint。
9. 将语义失效投影与容量压缩分离。
10. Completion Guard 按 Acceptance Ledger 和 Deliverable Contract 双重检查。
11. Artifact Guard 移除过早的严格工具白名单。
12. 自动生成 Research Handoff。
13. `search_in_files` 支持文件和目录。
14. 辅助 LLM 请求与主 Agent 隔离。

验收：

- 同义状态更新返回 `noChange`。
- 状态维护不计为外部进展。
- 新诊断不会无限重置无交付推进计数。
- 相同策略连续产生真实失败回执两轮后重新检查或替代当前 attempt。
- `noObjectiveProgressStreak` 的 3 / 6 轮阈值只提醒交付节奏，不直接使 Attempt 或 Assumption 失效。
- 已失效假设在下一轮退出 Working Set，同时保留 Event Log 引用。
- required Acceptance Criterion 未通过时不能完成 Run。
- state-only 连续调用在三轮后出现事实性诊断。
- Skill phase 变化后研究和安全观察能力仍可用。
- Research Handoff 在工件制作期间持续可见。
- 主请求和辅助请求可以独立统计。

### 第三批：用户控制、持久化与 Step 可观测性

目标：让用户理解路线、验收和恢复入口，让开发者低成本查看、对比和回放每轮真实输入输出。

本批的 Run Overview Projection、`overview.json`、查询 API、实时完整快照通知、整体计划面板、计划变化时间线、Step I/O、上下文健康、按需加载和 Legacy fallback 已完成。完整运行控制、Step Diff、独立导出、筛选搜索与虚拟列表作为后续增强。

工作项：

1. 后端持久化 Run Overview Projection、Step index、Input、Output 和 Event Log。
2. 增加 Run Overview Projection 与 Step I/O 查询 API。
3. 增加运行概览、整体计划面板、计划与进度视图、计划变化时间线、当前计划、当前路线、验收清单、交付缺口和完成依据。
4. 增加 Steering 与 Runtime `recoveryState` 恢复入口；暂停和 checkpoint 选择与恢复 UI 进入后续增强。
5. 重构运行详情页。
6. 增加结构化输入、输出和 Raw Tabs；Diff 进入后续增强。
7. 增加上下文健康检查。
8. 运行状态栏增加整体计划面板、当前 Step 摘要和入口。
9. 支持按需加载；筛选、搜索和虚拟列表进入后续增强。
10. 兼容旧 Trace。

验收：

- Ranni 重启后仍能查看完整历史 Step。
- Ranni 重启后可以从 `overview.json` 恢复当前 Run 的完整计划、路线、验收与进展快照。
- 用户无需阅读 Raw Trace 即可看到当前计划、当前路线、剩余验收项和完成依据。
- 用户选择旧 Step 时，整体计划面板继续展示当前 Run 快照；Step 输入输出查看器展示所选历史现场。
- SSE 重放、API 响应和实时通知按 `latestSeq` 协调，不会把当前计划回退到更早快照。
- 计划覆盖与交付验收分别显示，用户可以区分 Working Plan 推进与 Deliverable Contract 满足情况。
- 页面显示的 Input snapshot hash 与实际请求一致。
- 上下文健康检查能识别最近工具结果缺失。
- Tool Call 和 Result 可以一一配对查看。
- 原始数据页使用后端脱敏结果。

后续增强验收包括 checkpoint 选择与恢复 UI、260 个以上 Step 的虚拟列表性能，以及 Step / 区间独立导出。Runtime 恢复继承原 PlanAttemptLedger，路线发生实质变化后再创建新 Attempt。

完整分支树、并行路线执行和自动方案比较不进入前三批。先根据 attempt 替代次数、恢复成功率和任务完成率评估其必要性。

## 4. 测试与评估策略

### 4.1 单元测试

#### Agent 编排边界

- Run Controller 只根据 `StepOutcome.kind` 转换状态和决定继续或终止。
- Step Runner 不直接发布 Run completed，也不修改外层循环计数器。
- Finalization Controller 按明确优先级返回 guard retry、final 或 recover。
- Recovery Controller 在 Acceptance Gap 存在时不会返回 final。
- Tool Batch Executor 为成功、失败、blocked 和 unsafe 调用生成配对完整的 Tool Receipt。
- Event Sink 的 started、delta、completed 三段式 ID 保持一致。
- Run Policy 只能返回 Policy Delta 或 Guard Decision，不能直接修改 conversation。
- import boundary 测试阻止 Run Controller 直接导入 Research 和 HTML-to-PPTX 实现。

#### Context Composer

- 保留上一轮全部 tool pairs。
- 同一路径不同 query 不互相覆盖。
- `search_web`、`fetch_url`、state、research 结果进入下一轮。
- Old reasoning metadata 不进入当前 continuation。
- Phase 切换不触发压缩。
- 大结果生成摘要和引用，同时保持配对完整。
- 假设失效会更新 Working Set，不会删除 Event Log 或上一轮工具结果。
- 容量未到阈值时允许语义失效投影，不执行 Archive 压缩。
- 稳定 Task Contract、Skill 和工具集合生成相同 prefix hash。
- 动态 Working Set 不破坏 Provider-required continuation 顺序。

#### State 与 Progress

- Agent Note delta 正确合并。
- 同义更新返回 `noChange`。
- Artifact hash 变化只在缩小交付缺口时计为 objective progress。
- 重复读取和重复搜索不计进展。
- 首次结构化失败计为 information gain，不重置无交付推进连续轮数。
- 已通过 criterion 再次失败计为 regression。
- 相同策略签名连续产生真实失败回执，或 `noMeaningfulProgressStreak` 达到路线重置阈值时，才会结束或替代当前 attempt。
- `noObjectiveProgressStreak` 达到 3 / 6 只生成交付节奏提醒。
- 模型声明不能直接把 Acceptance Criterion 标记为 passed。

#### Completion 与 Recovery

- 文本任务在 final text 完成后可交付。
- PPTX 缺少页面或验证时继续执行。
- required criterion 为 pending、failed 或 unknown 时继续执行或明确返回阻塞。
- 用户明确调整要求后，相应 criterion 可以记录为 waived。
- Provider 失败保留 Causal Tail。
- Recovery 不删除工具、artifact、attempt 和 acceptance 状态。

#### Run Overview Projection

- 相同 Run 的事实事件按 `seq` 递增更新完整快照。
- 重复或更早 `seq` 保持当前投影引用与内容不变。
- `context.snapshot` 可以为 Recovery Run 恢复当前可得的 Working Plan 和 Attempt。
- `plan.updated` 生成 Plan Revision、Objective Projection、Plan Focus 和计划项状态时间线。
- Acceptance、Progress、Attempt、Completion 和 Recovery 变化按类型进入最多 120 条时间线。
- 结构化计划权威建立后，`update_task_state.plan` 不会替换 Working Plan。
- 自然语言调整要求只有在产生语义有变化的 `update_plan` 后才增加 Plan Revision。

### 4.2 集成测试

- `lib/agent.ts` facade 在 server 和 research eval 中保持原调用方式。
- characterization fixture 在拆分前后生成相同的 durable event 类型顺序和 stop reason。
- Steering、abort、工具失败、chunked final、Research Guard 和 Provider recovery 分支行为保持一致。
- 动态加载 Skill 后 system prompt 和工具集合同步变化。
- 一轮并行工具结果完整进入下一次 Provider 请求。
- Steering 在下一轮边界注入。
- Steering 改变约束时同步更新 Task Contract 和 Acceptance Ledger。
- Context Snapshot 与 exact request hash 一致。
- Step I/O 通过后端持久化并能在重启后读取。
- `overview.json` 与 `GET /api/runs/:runId/overview` 在重启前后返回同一 Run 级完整快照结构。
- EventMapper 对运行概览事实发布 durable `run.overview.updated`，通知内容与持久化投影一致。
- API 与 SSE 快照按 `latestSeq` 合并，不重复应用旧状态。

checkpoint 自动恢复集成测试覆盖“工具成功后 Provider 中断—恢复—相同执行键复用回执”，并验证命令副作用只发生一次。Run Registry 测试覆盖 Session / workspace 边界和一次性取用。

### 4.3 后续增强：Trace Replay 回归

将本次 265 Step 失败 Trace 提炼为可公开、无敏感数据的回归 fixture，重点回放：

- Step 30 → 31 的 phase 切换。
- 多工具研究结果的保留。
- 连续状态更新的 no-progress 判定。
- 连续新增错误但交付缺口不缩小的路径停滞判定。
- 假设证伪后的 Working Set 投影和 Attempt 替代。
- Provider 失败时的 Deliverable Contract 检查。

Replay 不需要真实调用模型，可以验证 Context 投影、Progress Receipt 和 Recovery 决策。当前核心回归由对应的 Context、Progress、Recovery、Provider 与 Run Controller 单元和集成测试覆盖，公开 Trace Replay fixture 不阻塞本次核心完成。

### 4.4 真实模型运行

完成行为改造后，至少执行一次完整 GLM-5.2 研究与 PPTX 任务，记录：

- 主模型 Step 数。
- 辅助请求数。
- 首次 artifact mutation 的 Step。
- 最长无 objective progress 连续轮数。
- Attempt 数、替代原因和同策略重复失败次数。
- Acceptance Criterion 通过率和证据覆盖率。
- Regression 次数和恢复成功率。
- 重复搜索比例。
- 输入 Token / accepted slide。
- styles、slides、export、validation 完成率。
- Provider 中断后的恢复结果。

额外重复运行用于调查明显的瞬时 Provider 污染或评估稳定性，不作为每次架构迁移的固定统计要求。

2026-07-15 的指定任务真实运行已经完成：Agent 完成资料研究、技术对比、八页 PPTX 制作、导出、渲染与验证，Acceptance Gap 最终为空，工具调用与结果配对完整。

参考验收目标：

- 初始化 workspace 后 10 个主 Step 内产生真实 artifact mutation。
- 不出现超过 3 轮且没有 Watchdog 反馈的无进展序列。
- 不出现新诊断持续掩盖交付停滞的序列。
- 已证伪假设不会继续作为 Working Set 的当前判断。
- 不出现最近一轮 tool result 丢失。
- Provider 稳定时完成最终工件和验证。
- Provider 中断时保留可恢复 checkpoint。

### 4.5 前端测试

- Input / Output Tabs 展示完整。
- Accordion 展开收起保持状态。
- Step 切换不会混用前一 Step 数据。
- Live Step 增量更新没有重复。
- 运行概览与 Acceptance Ledger、Plan Ledger、PlanAttemptLedger 一致。
- 整体计划面板在用户选择旧 Step 后仍展示 Run 级当前快照。
- 较小或相同 `latestSeq` 的 `run.overview.updated` 不会回退当前 UI。
- 计划覆盖排除 `cancelled` 和 `superseded`，交付验收只统计必需 criterion。
- 计划变化项可以按 `stepIndex` 打开对应 Step 输入输出。
- 缺少运行级投影的 Legacy Trace 明确显示“Step 回退”。
- 完成依据能够定位到有效 evidenceRefs。
- 窄屏通过运行状态栏浮层进入查看器。

Diff 一致性、checkpoint 恢复后的原 Run 查看和 260+ Step 虚拟列表性能随对应后续增强补充测试。

## 5. 迁移与兼容策略

### 5.1 双轨 Trace

改造早期同时保留当前 Trace 字段和 V2 semantic fields。前端优先使用 V2，缺失时回退到 Legacy Raw View。

### 5.2 Context Composer 灰度

Context Composer V2 已成为默认且唯一的主请求路径，没有保留运行期开关。`lib/active-context.ts` 只提供不裁剪 conversation 的兼容 facade，避免旧调用方通过 phase 删除最近因果过程。

### 5.3 TaskState 兼容

旧 `TaskState` 可以通过适配器映射：

- goal、deliverable、constraints、success criteria → Task Contract。
- currentMode、nextAction、openQuestions → Agent Note。
- assumptions → active Assumption Record，并在缺少证据时标记为待验证。
- plan → Working Plan 标题列表的兼容投影；`legacy` 计划权威模式下旧写入可以经 `PlanLedger.updateLegacy` 建立兼容计划，首次 `update_plan` 后进入 `structured` 模式并以结构化 Working Plan 为权威。
- filesTouched、commands、verification → 由 Receipt Registry 重建 Observed State。
- verification 和 success criteria → Acceptance Ledger；无法绑定客观证据时标记为 unknown。

### 5.4 存储与容量

完整 Input / Output 可能产生较大磁盘占用。建议：

- JSONL 追加写入。
- `overview.json` 只保存当前完整快照和最近 120 条变化，并通过原子替换更新。
- 大正文单独内容寻址存储。
- Step 文件按需压缩。
- 提供 Session 级清理入口。
- 长期保留摘要、hash 和关键回执。

## 6. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 拆分 `agent.ts` 时改变事件或 Guard 顺序 | 先建立 characterization trace，再做机械迁移；每个小批次比较 durable event、stop reason 和 tool pair |
| 只移动代码，隐式状态机继续存在 | 使用 `AgentRunState`、reducer 和判别联合 `StepOutcome` 收敛状态转换 |
| Run Policy 演变成任意 Hook 集合 | Policy 只返回指令、能力约束、状态 delta 和 Guard Decision，不持有主循环控制权 |
| 把职责转移到另一个超大文件 | 为 Controller、Runner、Policy 和工具子模块设置 review 规模信号，保持依赖方向单一 |
| 为追求行数拆出低内聚碎片 | 按变化原因和所有权拆分；共享纯函数仅在出现稳定复用边界后下沉 |
| Context V2 引入额外 Token | Working Set 保持简洁，Archive 按预算压缩，Manifest 不进入模型正文 |
| Provider reasoning 格式不同 | Provider adapter 维护 continuation codec，Context Composer 只处理统一表示 |
| 动态 Working Set 降低前缀缓存收益 | Provider Adapter 分离逻辑区块与物理序列化，记录稳定前缀 hash 和失效原因 |
| 失效假设继续影响路线 | Working Set 即时移除失效语义，Event Log 和 Archive 保留结论与引用 |
| Progress 误判 | 分离 objective progress、information gain 和 regression；无法确认时标记 unknown |
| 新诊断持续掩盖交付停滞 | Information gain 不持续重置无交付推进计数，按策略签名识别失败路线 |
| Watchdog 过度干预 | 只在连续客观无进展时介入，继续开放安全工具并保留模型选择权 |
| Attempt 状态被模型自述污染 | Harness 维护状态转换并绑定 Tool Receipt，模型只提出策略更新 |
| Acceptance 过度机械化 | 确定性检查、独立 Judge、视觉检查和用户豁免按 criterion 类型组合 |
| Skill 工具过多 | Skill Index 常驻，Skill Body 和专属工具按需加载 |
| Step Trace 数据量大 | 后端增量落盘、索引与详情分离、前端按需加载 |
| SSE 重放或 API 竞态使计划 UI 回退 | `RunOverviewProjection.latestSeq` 单调协调，Reducer 与前端忽略同 Run 的重复或更早快照 |
| 历史 Step 被误当成当前计划 | Run 级完整快照与 Step I/O 分开加载；整体计划面板只在缺少投影时使用明确标记的 Step 回退 |
| `TaskState.plan` 覆盖结构化计划 | `AgentRunState.planAuthority` 建立权威边界，`structured` 模式只同步兼容标题投影 |
| UI 信息密度过高 | 默认抽象列表，逐层展开，Raw View 放到最后一级 |
| 辅助请求影响主 Provider | 独立队列、模型、预算和 Trace 分类 |

## 7. 本次核心完成定义

本方案达到可交付状态需要同时满足：

### 代码结构

- `lib/agent.ts` 是稳定公共 facade，不再承载具体运行策略。
- `runAgentTurn` 只负责编排 Run Controller，目标不超过 150 行。
- Run Controller、Step Runner、Tool Batch Executor、Finalization 和 Recovery 拥有独立测试边界。
- 通用 Run Controller 与 Step Runner 的业务控制流不包含按 Research 或 HTML-to-PPTX 名称分支。
- `lib/agent/runtime-services.ts` 作为 Research Notebook / Task Memory 创建适配边界；`lib/agent.ts` 的 HTML-to-PPTX 工具定义 re-export 作为公共兼容桥，两处均不承载领域运行策略。
- Receipt Registry 成为工具事实进入 Observed State、Progress 和 Acceptance 的唯一入口。
- 新增 Skill 不要求在 Run Controller 中增加按 Skill 名称判断的分支。
- Server 与 research eval 的公共调用方式保持兼容。

### Harness

- Recent Causal Tail 在所有 Provider 下保持连续。
- Context 压缩只由预算触发。
- 语义失效可以即时更新 Working Set，同时保留 Event Log 和最近证伪过程。
- Provider Adapter 能记录稳定前缀、失效原因和 continuation 方式。
- Task Contract、Observed State、Agent Note、Plan Ledger、PlanAttemptLedger 和 Acceptance Ledger 分责生效。
- Progress Receipt 覆盖主要工具类型。
- Progress Receipt 能区分 objective progress、information gain 和 regression。
- No-progress Watchdog 能阻止长状态循环。
- 同策略重复失败能触发 Attempt 重新检查或替代。
- Completion 和 Recovery 同时读取 Deliverable Contract、Acceptance Ledger、Working Plan 和当前 Attempt；完成通过后终结计划项与路线。

### Skill

- 强制加载和自主加载使用统一 activeSkills 语义。
- Skill 正文、工具和资源变化进入 Context Manifest。
- Artifact Guard 保护工件事实，同时保留必要安全能力。
- Research Handoff 能跨研究和制作阶段持续存在。

### 可观测性

- 运行概览能够展示当前计划、当前路线、交付缺口、验收结果、阻塞和完成依据。
- 运行状态栏整体计划面板和计划与进度视图读取同一 Run 级完整快照。
- 计划覆盖与交付验收分开显示，计划变化时间线可以定位对应 Step。
- `overview.json`、运行概览 API 和 `run.overview.updated` 使用同一 `RunOverviewProjection`，并按 `latestSeq` 保持幂等。
- 用户选择历史 Step 时不会改变当前计划与进度；Step 输入输出查看器保留历史现场语义。
- 用户可以通过现有通道发送 Steering。
- 每个 Step 的实际 Input、Output 和脱敏原始数据可查看。
- 上下文健康检查能够显示因果链完整性。
- 默认执行路径不发送辅助活动改写请求，持久化的 `model.request` 均属于主模型 Step。
- 历史 Step 在进程重启后可恢复。

### 质量

- 相关单元测试和集成测试全部通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- 同一重型 Skill 任务的重复运行不再出现长时间无进展循环。
- 用户要求的最终工件经过客观验证后再宣告完成。

### 后续增强

以下增强独立演进，不阻塞本次核心完成：

- 暂停与 checkpoint 选择、恢复控制 UI。Runtime 自动续接已落地。
- 独立 Raw / Diff / Step 区间导出 API。
- Step 对比、筛选搜索和长列表虚拟化。
- 公开 Trace Replay fixture 与区间回放工具。
- 启用辅助活动改写后的独立队列、预算和请求计数。
- 完整分支树、并行路线探索和自动方案比较。

## 8. 与现有文档的关系

《总览与共享契约》作为这套开发方案的统一主入口，以下文档继续提供专题背景：

- `docs/tech/v1-architecture/core-concept/harness.md`：Harness 基础概念。
- `docs/tech/v1-architecture/agent-arch/architecture-defenses.md`：架构防线与 Agent 自主性的边界。
- `docs/tech/v2-architecture/skill-dynamic-loading-plan.md`：Skill 动态加载机制。
- `docs/tech/v2-architecture/Ranni 架构设计思想报告：事件驱动与前后端解耦.md`：事件驱动和前后端解耦。
- `docs/tech/v2-architecture/Ranni 架构重构实现参考手册.md`：事件和通信层实现参考。
- `docs/tech/v2-architecture/slides-html-pptx-optimization-construction-plan.md`：HTML-to-PPTX 专项优化。

后续代码落地后，应同步更新 README、组件地图、Harness 概念文档、UI 命名和相关 Skill 开发指南，使文档描述与当前运行事实保持一致。
