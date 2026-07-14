---
author: manus
version: v2
date: 2026-07-14
---

# Ranni 通用 Agent Harness：可观测性与交付开发方案

> 状态：开发方案草案
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

## 1. Event Log、Trace 与后端持久化

### 1.1 事件分层

保持现有三层事件模型：

1. Provider Event：模型流式 delta 和底层协议事件。
2. Trace Event：Run、Step、Context、请求、响应、工具、状态和回执的持久事实。
3. Client Notification：面向消息流和 UI 的投影。

新增或扩展以下 Trace Event：

- `context.snapshot`
- `model.request.started`
- `model.response.completed`
- `tool.batch.started`
- `tool.completed`
- `state.observed.updated`
- `attempt.updated`
- `assumption.invalidated`
- `acceptance.updated`
- `progress.receipt`
- `step.completed`
- `recovery.started`
- `completion.checked`

### 1.2 Step I/O 数据模型

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
    attemptDelta: AttemptDelta;
    acceptanceDelta: AcceptanceDelta;
    progressReceipt: StepProgressReceipt;
    error?: string;
  };
};
```

Input 在模型请求发出前冻结。Output 在 reasoning、tool 和 receipt 到达时增量补齐，Step 结束后封存。

### 1.3 存储布局

完整 Step Trace 不再只依赖前端 localStorage。建议保存在 Session workspace：

```text
.ranni/runs/<runId>/
├── run.json
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
- `step-index.json`：轻量 Step 摘要，用于列表和筛选。
- `steps/*-input.json`：实际 Input Snapshot 与 Context Manifest。
- `steps/*-output.json`：模型输出、工具配对、状态、attempt、acceptance delta 和 Progress Receipt。

写入采用增量追加和原子替换。API Key、Authorization Header 和其他敏感字段在落盘前脱敏。

### 1.4 查询 API

建议增加：

```text
GET /api/sessions/:sessionId/runs
GET /api/runs/:runId/steps?cursor=&filter=
GET /api/runs/:runId/steps/:stepId/io
GET /api/runs/:runId/steps/:stepId/raw
GET /api/runs/:runId/steps/:stepId/diff?against=previous
```

前端先加载 Step 索引，选中后按需加载详细 I/O。运行中的 Step 继续通过 SSE 增量更新。

### 1.5 老 Trace 兼容

旧 Trace 缺少 semantic sections 和 Progress Receipt 时：

- 使用现有 system prompt、messages、tools、request、response 和 tool records。
- UI 标记 `Legacy Trace`。
- 输入页展示可确定的顶层区块。
- 上下文健康检查中将无法计算的字段标记为 unknown。
- 原始数据仍然可以查看和导出。

## 2. Step 输入输出查看器

### 2.1 产品位置

现有「运行详情页」提供两个信息层次：

1. 默认进入面向用户的「运行概览」，展示当前路线、交付缺口、验收结果、阻塞和运行控制。
2. 进入面向开发者的「Step 输入输出查看器」，检查每轮 Context、模型响应、工具回执和 Diff。

用户无需阅读原始 Trace 即可判断 Agent 是否持续推进、为何改变路线以及凭什么宣告完成。

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

### 2.2 运行概览与用户控制

```text
┌──────────────────────────────────────────────────────────────────┐
│ Run #3 · 正在执行 · 当前路线：生成并验证幻灯片                 │
├──────────────────────────────────────────────────────────────────┤
│ 交付进度        8 / 11                                          │
│ 已完成          研究、Manifest、Styles、7 个页面                 │
│ 待验收          export、视觉检查、最终 PPTX                      │
│ 当前阻塞        第 5 页布局验证失败                              │
│ 最近重规划      Attempt 2 → Attempt 3 · 旧假设已证伪             │
│ 下一步          修复第 5 页并重新执行视觉检查                    │
│                                                                  │
│ [发送补充要求] [暂停] [从检查点恢复] [查看完成依据] [Step 详情] │
└──────────────────────────────────────────────────────────────────┘
```

运行概览展示：

- 当前 Plan / Attempt 及最近一次路线替代原因。
- Acceptance Ledger 的 passed、pending、failed、unknown、waived 数量。
- 当前 Deliverable Gap、阻塞和最近 regression。
- 下一步和最近 objective progress。
- Steering、暂停、恢复 checkpoint 和查看完成依据入口。

运行控制动作必须沿用现有授权边界。恢复 checkpoint 会创建新的 attempt 并保留原 Event Log，不覆盖原运行事实。完整分支树和并行路线比较不进入首批 UI。

### 2.3 Step 输入输出布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ Run #3 · Step 150 · Completed · 28.7k → 814 · 31.2s             │
│ Progress: No change · Context: 2.7% · Causal integrity: Warning  │
├──────────────────┬───────────────────────────────────────────────┤
│ Run / Step 列表   │ [输入] [输出] [与上一轮对比] [原始数据]       │
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
- Active Attempt 与策略签名变化。
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

Working Set 展开后单独展示当前 Attempt、有效假设、Acceptance Gap 和 unresolved regression。已经失效的假设只显示引用和失效原因，不混入当前建议。

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
5. Progress Receipt。
6. Attempt and Assumption Delta。
7. Acceptance Delta。
8. Completion Decision。
9. Error and Recovery。

Tool Call 和 Tool Result 按 toolUseId 配对。并行调用显示为同一批次，避免用户在两个 JSON 区块间手工查找。

### 2.8 与上一轮对比

默认使用确定性 Diff：

- Context Section 增删与 hash 变化。
- Token 和 message 数量变化。
- Tool Definitions 变化。
- 上一轮 tool pair 是否保留。
- Task Contract、Working Set 和 Agent Note 变化。
- State Delta、Artifact Delta、Attempt Delta、Acceptance Delta 和三轴 Progress Delta。

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

支持复制、下载当前 Step、下载 Step 区间和导出 JSON。所有内容沿用后端脱敏结果。

### 2.10 实时更新

正在运行的 Step 展示四个状态：

```text
Context ready
→ Model streaming
→ Tools running
→ Receipt finalized
```

Input Snapshot 在模型请求发出时冻结。Thinking、Tool Call、Tool Result 和 Progress Receipt 逐步补齐 Output。

### 2.11 UI 命名

本方案使用以下统一命名，并已同步到 `UI-NAMING.md`：

- 运行概览。
- 当前路线。
- 验收清单。
- 交付缺口。
- 运行控制区。
- 恢复检查点按钮。
- 完成依据。
- Step 输入输出查看器。
- 输入构成列表。
- 输入构成项。
- 输出构成列表。
- 输出构成项。
- 上下文健康检查。
- Step 对比。
- 原始数据。
- 进展回执（Progress Receipt）。
- 因果链完整性。

### 2.12 可观测性代码地图

| 文件或目录 | 主要职责与改动 |
| --- | --- |
| `lib/trace.ts` | Context Section、Composition Manifest、Progress Receipt、Step I/O 类型 |
| `lib/events/schema.ts` | 新增 progress、completion、recovery 等 durable event |
| `lib/events/legacy-map.ts` | 新旧事件兼容 |
| `lib/runs/event-mapper.ts` | Trace 到 UI Notification 的确定性投影 |
| `lib/runs/activity-rewrite.ts` | 辅助请求隔离或默认停用 |
| `src/server/app.ts` | Step I/O 查询、Run Trace 持久化和导出 API |
| `components/agent-console.tsx` | 运行详情页重构、Step I/O 查看器、运行状态栏入口 |
| `components/agent-console.module.css` | 查看器布局、accordion、diff、health、虚拟列表样式 |
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
7. 把 Research guards 和 signals 迁入 `lib/research/runtime-policy.ts`。
8. 把 `SlideArtifactPhase`、静态工具集合和 phase 推进迁入 `lib/html-to-pptx/artifact-policy.ts`。
9. 引入 `AgentRunState`、`StepOutcome`、Step Runner 和 Run Controller，逐步替换主循环内的局部 counter 与 `continue`。
10. 把 final、guard retry 和 provider recovery 迁入 Finalization Controller 与 Recovery Controller。
11. 更新测试导入：allowlist 测试归属 Artifact Policy，unsafe tool call 测试归属 Tool Batch Executor。
12. `src/server/app.ts` 和 `scripts/research-eval.ts` 继续通过 `lib/agent.ts` 调用 `runAgentTurn`。

验收：

- `lib/agent.ts` 只保留 50–100 行 facade。
- `runAgentTurn` 编排实现不超过 150 行。
- 通用 Run Controller 不导入 Research 或 HTML-to-PPTX 的具体类型。
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
2. 增加 Plan / Attempt Ledger、Assumption Record 和策略签名。
3. 增加 Acceptance Ledger，并从 Task Contract 派生 required criteria。
4. `update_task_state` 改为 delta patch 和 `noChange` 回执。
5. Tool Receipt 覆盖文件、命令、研究、artifact 和验证工具。
6. 实现 objective progress、information gain、regression 三轴 Progress Receipt。
7. 实现同策略失败 2 轮与无交付推进 3 / 6 / 10 轮 Watchdog。
8. 将语义失效投影与容量压缩分离。
9. Completion Guard 按 Acceptance Ledger 和 Deliverable Contract 双重检查。
10. Artifact Guard 移除过早的严格工具白名单。
11. 自动生成 Research Handoff。
12. `search_in_files` 支持文件和目录。
13. 辅助 LLM 请求与主 Agent 隔离。

验收：

- 同义状态更新返回 `noChange`。
- 状态维护不计为外部进展。
- 新诊断不会无限重置无交付推进计数。
- 同一策略连续失败两轮后重新检查或替代当前 attempt。
- 已失效假设在下一轮退出 Working Set，同时保留 Event Log 引用。
- required Acceptance Criterion 未通过时不能完成 Run。
- state-only 连续调用在三轮后出现事实性诊断。
- Skill phase 变化后研究和安全观察能力仍可用。
- Research Handoff 在工件制作期间持续可见。
- 主请求和辅助请求可以独立统计。

### 第三批：用户控制、持久化与 Step 可观测性

目标：让用户理解路线、验收和恢复入口，让开发者低成本查看、对比和回放每轮真实输入输出。

工作项：

1. 后端持久化 Step index、Input、Output 和 Event Log。
2. 增加 Step I/O 查询 API。
3. 增加运行概览、当前路线、验收清单、交付缺口和完成依据。
4. 增加 Steering、暂停和 checkpoint 恢复入口。
5. 重构运行详情页。
6. 增加结构化输入、输出、Diff 和 Raw Tabs。
7. 增加上下文健康检查。
8. 运行状态栏增加当前 Step 摘要和入口。
9. 支持筛选、搜索、虚拟列表和按需加载。
10. 兼容旧 Trace。

验收：

- Ranni 重启后仍能查看完整历史 Step。
- 用户无需阅读 Raw Trace 即可看到当前路线、剩余验收项和完成依据。
- 从 checkpoint 恢复会创建新 attempt，并保留原 Event Log。
- 260 个 Step 的列表滚动和切换保持流畅。
- 页面显示的 Input snapshot hash 与实际请求一致。
- 上下文健康检查能识别最近工具结果缺失。
- Tool Call 和 Result 可以一一配对查看。
- 原始数据导出经过脱敏。

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
- 相同策略签名连续失败会结束或替代当前 attempt。
- 模型声明不能直接把 Acceptance Criterion 标记为 passed。

#### Completion 与 Recovery

- 文本任务在 final text 完成后可交付。
- PPTX 缺少页面或验证时继续执行。
- required criterion 为 pending、failed 或 unknown 时继续执行或明确返回阻塞。
- 用户明确调整要求后，相应 criterion 可以记录为 waived。
- Provider 失败保留 Causal Tail。
- Recovery 不删除工具、artifact、attempt 和 acceptance 状态。

### 4.2 集成测试

- `lib/agent.ts` facade 在 server 和 research eval 中保持原调用方式。
- characterization fixture 在拆分前后生成相同的 durable event 类型顺序和 stop reason。
- Steering、abort、工具失败、chunked final、Research Guard 和 Provider recovery 分支行为保持一致。
- 动态加载 Skill 后 system prompt 和工具集合同步变化。
- 一轮并行工具结果完整进入下一次 Provider 请求。
- Steering 在下一轮边界注入。
- Steering 改变约束时同步更新 Task Contract 和 Acceptance Ledger。
- checkpoint 恢复创建新 attempt 并引用原 checkpoint。
- Context Snapshot 与 exact request hash 一致。
- Step I/O 通过后端持久化并能在重启后读取。

### 4.3 Trace Replay 回归

将本次 265 Step 失败 Trace 提炼为可公开、无敏感数据的回归 fixture，重点回放：

- Step 30 → 31 的 phase 切换。
- 多工具研究结果的保留。
- 连续状态更新的 no-progress 判定。
- 连续新增错误但交付缺口不缩小的路径停滞判定。
- 假设证伪后的 Working Set 投影和 attempt 替代。
- Provider 失败时的 Deliverable Contract 检查。

Replay 不需要真实调用模型，可以验证 Context 投影、Progress Receipt 和 Recovery 决策。

### 4.4 真实模型运行

使用同一 GLM-5.2 任务进行至少三次运行，记录：

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
- Diff 与 raw 数据一致。
- 运行概览与 Acceptance Ledger、Plan / Attempt Ledger 一致。
- 完成依据能够定位到有效 evidenceRefs。
- checkpoint 恢复后原 Run 事实仍可查看。
- 260+ Step 虚拟列表性能达标。
- 窄屏通过运行状态栏浮层进入查看器。

## 5. 迁移与兼容策略

### 5.1 双轨 Trace

改造早期同时保留当前 Trace 字段和 V2 semantic fields。前端优先使用 V2，缺失时回退到 Legacy Raw View。

### 5.2 Context Composer 灰度

开发期可以使用内部开关：

```text
RANNI_CONTEXT_COMPOSER_V2=true
```

同时记录旧投影和新投影的摘要差异，但只把其中一个发送给模型。对比稳定后删除旧实现。

### 5.3 TaskState 兼容

旧 `TaskState` 可以通过适配器映射：

- goal、deliverable、constraints、success criteria → Task Contract。
- currentMode、nextAction、openQuestions → Agent Note。
- assumptions → active Assumption Record，并在缺少证据时标记为待验证。
- filesTouched、commands、verification → 由 Receipt Registry 重建 Observed State。
- verification 和 success criteria → Acceptance Ledger；无法绑定客观证据时标记为 unknown。

### 5.4 存储与容量

完整 Input / Output 可能产生较大磁盘占用。建议：

- JSONL 追加写入。
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
| UI 信息密度过高 | 默认抽象列表，逐层展开，Raw View 放到最后一级 |
| 辅助请求影响主 Provider | 独立队列、模型、预算和 Trace 分类 |

## 7. 完成定义

本方案达到可交付状态需要同时满足：

### 代码结构

- `lib/agent.ts` 是稳定公共 facade，不再承载具体运行策略。
- `runAgentTurn` 只负责编排 Run Controller，目标不超过 150 行。
- Run Controller、Step Runner、Tool Batch Executor、Finalization 和 Recovery 拥有独立测试边界。
- 通用 Agent 模块不导入 Research 或 HTML-to-PPTX 的具体实现类型。
- Receipt Registry 成为工具事实进入 Observed State、Progress 和 Acceptance 的唯一入口。
- 新增 Skill 不要求在 Run Controller 中增加按 Skill 名称判断的分支。
- Server 与 research eval 的公共调用方式保持兼容。

### Harness

- Recent Causal Tail 在所有 Provider 下保持连续。
- Context 压缩只由预算触发。
- 语义失效可以即时更新 Working Set，同时保留 Event Log 和最近证伪过程。
- Provider Adapter 能记录稳定前缀、失效原因和 continuation 方式。
- Task Contract、Observed State、Agent Note、Plan / Attempt Ledger 和 Acceptance Ledger 分责生效。
- Progress Receipt 覆盖主要工具类型。
- Progress Receipt 能区分 objective progress、information gain 和 regression。
- No-progress Watchdog 能阻止长状态循环。
- 同策略重复失败能触发 attempt 重新检查或替代。
- Completion 和 Recovery 同时读取 Deliverable Contract、Acceptance Ledger 和当前 Attempt。

### Skill

- 强制加载和自主加载使用统一 activeSkills 语义。
- Skill 正文、工具和资源变化进入 Context Manifest。
- Artifact Guard 保护工件事实，同时保留必要安全能力。
- Research Handoff 能跨研究和制作阶段持续存在。

### 可观测性

- 运行概览能够展示当前路线、交付缺口、验收结果、阻塞和完成依据。
- 用户可以发送 Steering、暂停并从 checkpoint 恢复。
- 每个 Step 的实际 Input 和 Output 可查看、对比和导出。
- 上下文健康检查能够显示因果链完整性。
- 主模型请求与辅助请求分开计数。
- 历史 Step 在进程重启后可恢复。

### 质量

- 单元测试、集成测试和 Trace Replay 全部通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 全部通过。
- 同一重型 Skill 任务的重复运行不再出现长时间无进展循环。
- 用户要求的最终工件经过客观验证后再宣告完成。

## 8. 与现有文档的关系

《总览与共享契约》作为这套开发方案的统一主入口，以下文档继续提供专题背景：

- `docs/tech/v1-architecture/core-concept/harness.md`：Harness 基础概念。
- `docs/tech/v1-architecture/agent-arch/architecture-defenses.md`：架构防线与 Agent 自主性的边界。
- `docs/tech/v2-architecture/skill-dynamic-loading-plan.md`：Skill 动态加载机制。
- `docs/tech/v2-architecture/Ranni 架构设计思想报告：事件驱动与前后端解耦.md`：事件驱动和前后端解耦。
- `docs/tech/v2-architecture/Ranni 架构重构实现参考手册.md`：事件和通信层实现参考。
- `docs/tech/v2-architecture/slides-html-pptx-optimization-construction-plan.md`：HTML-to-PPTX 专项优化。

后续代码落地后，应同步更新 README、组件地图、Harness 概念文档、UI 命名和相关 Skill 开发指南，使文档描述与当前运行事实保持一致。
