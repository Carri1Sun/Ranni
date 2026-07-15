# Ranni UI 命名约定

这份文档是 Ranni 页面区域、可见 UI 元素、消息流元素和事件到 UI 投影的协作词表。产品迭代、设计讨论、Issue、代码 Review 和问题反馈应使用这里的规范中文名。

Agent Runtime 概念的语义由 `CONCEPT-NAMING.md` 定义。本文件只说明这些概念在 UI 中如何命名和展示。

## 1. 使用规则

1. 使用“页面或区域 / 元素 / 行为”描述问题，例如“运行详情页 / 进展回执卡片 / 连续停滞显示错误”。
2. 首次出现 UI 元素时可以补充英文名、组件名或事件名；后续使用规范中文名。
3. 引用屏幕上的固定文案时使用引号，例如“更新运行状态”；引用元素类型时使用本文件定义的名称，例如“运行提示项”。
4. “状态过程项”“状态面板”“事件”等宽泛称呼应替换为运行提示项、任务状态面板、TraceEvent 等精确名称。
5. UI 元素与 Runtime 数据分开命名。例如“进展回执”是 Runtime 数据，“进展回执卡片”是可见 UI。
6. 兼容事件名只用于定位旧协议，日常讨论使用三层事件 schema 中的当前事件名。

## 2. 一级页面结构

| 规范中文名 | 英文名 | 说明 | 主要代码位置 |
| --- | --- | --- | --- |
| 工作台 | Workspace / Shell | 整个 Ranni 主界面。 | `main.shell` |
| 导航栏 | Sidebar | 左侧栏，包含新会话、历史 Session 和设置入口。 | `aside.sidebar` |
| 会话栏 | Chat Panel | 中间主区域，承载会话页、草稿页、报告页和运行详情页。 | `section.chatShell` |
| 运行状态栏 | Run Inspector | 右侧栏，展示当前 Session、Run、Step、工具、任务状态兼容投影和运行环境。 | `aside.inspector` |

## 3. 导航栏

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 新会话按钮 | New Session Button | 进入新会话草稿。 |
| 历史 Session 列表 | Session List | 已创建的 Session 列表。 |
| Session 条目 | Session Item | 单个 Session 的入口。 |
| Session 停止按钮 | Session Stop Button | 终止该 Session 当前正在运行的 Run。 |
| 设置入口 | Settings Entry | 打开设置弹窗。 |
| 导航栏浮层 | Sidebar Overlay | 窄屏下展开的导航栏。 |
| 导航栏遮罩 | Sidebar Backdrop | 点击后关闭导航栏浮层。 |

## 4. 会话栏

### 页面顶部栏

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 导航栏折叠按钮 | Sidebar Toggle | 折叠或展开导航栏。 |
| 会话标题 | Session Title | 当前 Session 标题；草稿态显示默认标题。 |
| 页面导航 | Page Nav | 在会话页、报告页和运行详情页之间切换。 |
| 运行状态栏折叠按钮 | Inspector Toggle | 折叠或展开运行状态栏。 |

### 会话页

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 消息流 | Feed | 按 UI 接收顺序展示用户消息、Assistant 消息和过程项。 |
| 用户消息 | User Message | 用户提交的消息卡片。 |
| Assistant 消息 | Assistant Message | 模型对用户可见的回答卡片，支持 Markdown、复制和导出。 |
| 过程项 | Process Item / Activity | Run 生命周期、运行提示、thinking、工具、任务状态、研究和错误的过程展示。 |
| 消息工具条 | Message Toolbar | Assistant 消息下方的复制和导出操作。 |
| 回到底部按钮 | Scroll To Bottom | 消息流离开底部时显示。 |
| 底部输入区 | Composer | 已创建 Session 的输入区域。 |
| 输入能力开关 | Composer Skill Toggle | 为下一次 Run 选择需要预先激活的 Skill，例如“幻灯片”。 |
| 研究校验开关 | Composer Research Guard Toggle | 为下一次 Run 开启研究信号校验与完整性打回。 |
| 发送按钮 | Send Button | Run 空闲时提交输入并创建新 Run。 |
| 发送补充按钮 | Send Steering Button / “发送补充” | 当前 Run 执行时提交输入，将自然语言要求作为 Steering Message 注入下一 Step 边界，不创建新 Run。 |
| 当前 Session 停止按钮 | Current Session Stop Button | 当前 Run 执行时与发送补充按钮并列，用于中止当前 Run。 |

### 新会话草稿

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 新会话草稿 | New Session Draft | 首条消息发送前的空白会话状态。 |
| 草稿输入框 | Draft Composer | 草稿中央输入框。 |
| 草稿专属目录提示 | Draft Session Workspace Prompt | 说明首条消息发送后会创建 Session 工作区。 |
| 专属目录说明 | Session Workspace Info | 展示 Session 工作区边界和创建规则。 |
| Session 工作区 | Session Workspace | Session 独占的 Agent 执行目录。 |

## 5. 消息流元素

消息流数据结构为 `FeedItem = FeedMessage | FeedActivity`，渲染入口位于 `components/agent-console.tsx`。

| 规范中文名 | 代码识别 | 展示与更新语义 |
| --- | --- | --- |
| 用户消息 | `FeedMessage`、`role: "user"` | 用户提交时新增，右侧对齐。 |
| Assistant 消息 | `FeedMessage`、`role: "assistant"` | `text.delta` 实时更新，`assistant.message` 用完整文本校准；左侧对齐并显示消息工具条。 |
| Run 生命周期行 | `FeedActivity`、`type: "step"` 的 Run 开始或结束投影 | 一行弱提示，显示 Run 开始、完成、失败或终止。 |
| 运行提示项 | `FeedActivity`、`type: "status"` | 浅背景行内提示，展示 Provider 重试、无进展观察器提醒、Policy 提示等 Harness 运行消息。 |
| Thinking 正文 | `FeedActivity`、`type: "thinking"` | `thinking.delta` 实时追加，`thinking.message` 用完整文本校准；受 Thinking 展示开关控制。 |
| 工具调用卡片 | 两条 `FeedActivity` 按 `runId + toolUseId` 形成的渲染投影 | 工具开始时出现，工具完成时在同一卡片更新摘要。默认收起；点击卡片展开或收起调用输入与执行结果。 |
| 任务状态过程项 | `FeedActivity`、`type: "state"` | 任务状态兼容投影的关键签名变化时新增；重复签名不新增。 |
| 研究状态过程项 | `FeedActivity`、`type: "research"` | 研究笔记更新时新增，并同步 Session 研究上下文。 |
| 错误过程项 | `FeedActivity`、`type: "error"` | 展示 Step 失败、接口错误或运行错误。 |
| 手动终止过程项 | 前端本地 Activity | 用户点击停止按钮后新增终止提示。 |
| 补充消息过程项 | 前端本地 Activity | Run 中发送 Steering Message 后新增“已发送补充消息”提示。 |

### `ActivityType` 规范映射

| `ActivityType` | 规范 UI 名称 | 内容来源 |
| --- | --- | --- |
| `status` | 运行提示项 | `run.status → activity.appended` |
| `tool_call` | 工具调用卡片的发起记录 | `tool.started → activity.appended` |
| `tool_result` | 工具调用卡片的结束记录 | `tool.completed → activity.appended` |
| `error` | 错误过程项 | 失败的 `step.completed` 或 `error` 通知 |
| `step` | Run 生命周期行 | `run.started`、`run.completed` 的投影 |
| `state` | 任务状态过程项 | `task.state → activity.appended` |
| `research` | 研究状态过程项 | `research.state → activity.appended` |
| `thinking` | Thinking 正文 | `thinking.delta` 与 `thinking.message` |

任务状态过程项的去重签名由 `currentMode`、`nextAction` 和 `verification.status` 组成。三项都未变化时，新的 `task.state` 不会增加消息流条目。

`load_skill` 产生的两条 Activity 归入同一张“工具调用卡片”，显示文案可以使用“激活技能”。

### 工具调用卡片

工具调用卡片是消息流的渲染元素，底层仍保存两条独立 `FeedActivity`：

| 卡片区域 | 数据来源 | 展示语义 |
| --- | --- | --- |
| 工具调用摘要 | 已有结束记录时优先使用 `tool_result.display`，否则使用 `tool_call.display` | 展示当前状态、工具动作摘要、耗时或结果摘要。 |
| 调用输入 | `tool_call.detail` | 展开后展示工具调用输入摘要。 |
| 执行结果 | `tool_result.detail` | 展开后展示工具执行结果摘要；运行中显示等待说明。 |
| 完整过程信息入口 | 同一 `toolUseId` 对应的 Trace Step | “显示完整过程信息”开启时进入现有过程信息弹窗。 |

配对键为 `runId + toolUseId`，防止不同 Run 复用相同调用 ID 时发生误合并。只有一侧到达、通知乱序或 SSE 重放出现重复通知时，消息流仍只渲染一张稳定卡片。原始 Activity 顺序、TraceEvent 和 ClientNotification 不做合并。

## 6. 运行提示项的内容名称

“运行提示项”是 `status` Activity 的统一 UI 元素名。具体内容应使用下列名称沟通：

| 规范内容名 | 典型来源 | 当前 fallback 标题或文案 |
| --- | --- | --- |
| 连接提示 | Run 启动后的 Provider 连接消息 | “开始分析请求” |
| Provider 重试提示 | 同一模型请求的有界重试回调 | “模型请求重试” |
| 交付进度提醒 | 无进展观察器的 `review` 决策 | 三轮阈值显示“检查交付推进”，六轮阈值显示“检查交付充分性”；正文说明当前交付缺口 |
| 路线重置提醒 | 无进展观察器的 `replan` 决策 | 显示“调整当前路线”；正文说明同路线失败或缺少有效进展 |
| 恢复现场提示 | 无进展观察器的 `checkpoint` 决策 | 显示“保存恢复现场”；正文说明循环停止和 checkpoint 位置 |
| 工件关注点提示 | Run Policy 根据客观回执更新工件关注点 | 通用标题可能显示“更新运行状态” |
| 思路整理提示 | 较长的 `run.status` 文本 | “整理执行思路” |

“更新运行状态”只用于未命中特定类别的通用 fallback。讨论用户观察到的具体内容时，使用“消息流 / 运行提示项 / 交付进度提醒”等完整名称。

交付进度提醒表达 Harness 对 Progress Receipt 的观察结果。它不会更新 Agent 工作笔记，也不会被计为客观交付推进。

## 7. 三层事件到 UI 的投影

事件 schema 位于 `lib/events/schema.ts`。三层事件的规范名称如下：

| 事件层 | 类型 | 持久化 | UI 责任 |
| --- | --- | --- | --- |
| Provider 流事件 | `ProviderEvent` | 否 | 实时更新 Assistant 消息和 Thinking 正文。 |
| 运行事实事件 | `TraceEvent` | 是 | 记录 Run、Step、模型、工具、回执、状态、验收、进展、完成与恢复事实。 |
| 前端通知 | `ClientNotification` | 是 | 驱动主消息流和 Session 前端状态。 |

### 实时流投影

| Provider 流事件 | UI 元素 | 行为 |
| --- | --- | --- |
| `text.delta` | Assistant 消息 | 按 `textId` 创建或追加同一条消息。 |
| `thinking.delta` | Thinking 正文 | 按 `thinkingId` 创建或追加同一条正文。 |

### TraceEvent 到 ClientNotification

| TraceEvent | ClientNotification | UI 投影 |
| --- | --- | --- |
| `run.started` | `activity.appended` + `lifecycle` | 新增 Run 生命周期行，并把 Run 标记为运行中；`resumedFromCheckpoint` 存在时在 Trace 中保留恢复来源元数据。 |
| `run.completed` | `activity.appended` + `lifecycle`，失败时附加 `error` | 新增 Run 生命周期行并更新最终 Run 状态。 |
| `run.status` | `activity.appended`，`activityType: "status"` | 新增运行提示项。 |
| `task.state` | `activity.appended`，`activityType: "state"` | 关键签名变化时新增任务状态过程项。 |
| `research.state` | `activity.appended` + `research.context.updated` | 新增研究状态过程项并更新 Session 研究上下文。 |
| `tool.started` | `activity.appended`，`activityType: "tool_call"` | 新增工具发起记录；消息流创建或补全工具调用卡片。 |
| `tool.completed` | `activity.appended`，`activityType: "tool_result"` | 新增工具结束记录；消息流更新或补全同一工具调用卡片。 |
| `text.completed` | `assistant.message` | 用完整文本校准 Assistant 消息。 |
| `thinking.completed` | `thinking.message` | 用完整文本校准 Thinking 正文。 |
| `context.snapshot`、`task.state`、`state.observed.updated`、`plan.updated`、`attempt.updated`、`acceptance.updated`、`progress.receipt`、`completion.checked`、`recovery.started` | `run.overview.updated` | 更新当前 Run 的完整运行概览投影；通知携带完整快照和 `latestSeq`，不新增消息流过程项。 |
| 失败或取消的 `step.completed` | `activity.appended`，`activityType: "error"` | 新增错误或终止提示。 |
| 成功的 `step.completed` | 无消息流通知 | 只更新 Trace 和 Step 视图。 |

`activity.display_updated` 通过服务端 `activityId` 更新已有 Activity 的标题、说明、图标和 meta。工具发起记录更新后，对应工具调用卡片随前端渲染投影同步刷新。当前只有显式设置 `RANNI_ACTIVITY_REWRITE_ENABLED=true` 时才会请求模型生成改写文案，默认使用确定性 fallback 文案。

### 语义事实与运行概览投影

| TraceEvent | 主要展示位置 |
| --- | --- |
| `step.started`、成功的 `step.completed` | Run 列表、Step 列表、运行详情页 |
| `context.snapshot`、`model.request`、`model.response` | Step 输入输出查看器 |
| `tool.batch.started`、`tool.receipt` | Step 输出、工具调用与结果、客观现场 |
| `state.observed.updated` | 当前运行概览、完成依据、Step 输出；变化进入 `run.overview.updated` |
| `plan.updated` | 当前计划卡片、整体计划面板、计划变化时间线和 Step 输出；记录 Plan Revision、Objective Projection 或 Finalization，不新增消息流过程项 |
| `attempt.updated` | 当前路线卡片、整体计划面板、计划变化时间线和 Step 输出；优先使用事件中的完整 `attemptState` 重建路线状态 |
| `assumption.invalidated` | Step 输出和持久化 Trace；后续完整 `attemptState` 反映当前有效假设与路线状态 |
| `acceptance.updated` | 验收清单卡片、交付缺口卡片、交付验收指标和计划变化时间线 |
| `progress.receipt` | 进展回执卡片、计划变化时间线和 Step 进展摘要 |
| `completion.checked` | 完成判定、完成依据和计划变化时间线 |
| `recovery.started` | 当前阻塞、错误、恢复区块和计划变化时间线；新事件只展示验收缺口、Context hash 和 checkpoint 引用等精简元数据 |
| `text.started`、`thinking.started` | 流边界和 Trace 重建 |

`run.overview.updated` 是更新已有 UI 状态的前端通知。它携带当前 Run 的完整 `RunOverviewProjection`，前端按 `latestSeq` 接受更新，并忽略重复或更早的快照。刷新页面或 SSE 断线恢复时，运行概览 API 返回同一结构。

## 8. 兼容事件名

以下 snake_case 名称属于旧 `StreamEvent` 兼容协议。`AgentEventSink` 和兼容映射层仍可接收它们，架构讨论和新代码使用当前三层事件名。

| 兼容事件名 | 当前事件或通知 |
| --- | --- |
| `assistant_delta` | `text.delta` |
| `assistant` | `text.completed`，随后投影为 `assistant.message` |
| `thinking_delta` | `thinking.delta` |
| `thinking` | `thinking.completed`，随后投影为 `thinking.message` |
| `run_started` | `run.started` |
| `run_completed` | `run.completed` |
| `step_started` | `step.started` |
| `step_completed` | `step.completed` |
| `context_snapshot` | `context.snapshot` |
| `model_request` | `model.request` |
| `model_response` | `model.response` |
| `tool_call` | `tool.started` |
| `tool_result` | `tool.completed`；`tool.receipt` 单独记录结构化事实 |
| `task_state` | `task.state` |
| `research_state` | `research.state` |
| `status` | `run.status` |

## 9. 专属目录弹窗

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 专属目录弹窗 | Session Workspace Modal | 说明 Session 工作区规则并支持自动创建。 |
| 专属目录说明区 | Session Workspace Info Section | 说明 Documents 下的创建位置和执行边界。 |
| 自动创建按钮 | Auto Create Session Workspace Button | 创建独立目录并进入新 Session。 |
| 查看目录规则按钮 | View Workspace Rule Button | 从新会话草稿打开专属目录弹窗。 |

## 10. 任务上限弹窗

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 任务上限弹窗 | Agent Limit Modal | 并行 Run 达到上限时显示。 |

## 11. 报告页

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 报告页 | Report View | 查看最近一条完整 Assistant 消息。 |
| 报告预览 | Report Preview | Markdown 报告展示区域。 |
| 报告操作区 | Report Actions | 复制报告或导出 `.md`。 |

## 12. 运行详情页

| 规范中文名 | 英文名 / 当前标签 | 说明 |
| --- | --- | --- |
| 运行详情页 | Run Detail View | 查看 Run 概览和每个 Step 的真实输入输出。 |
| 运行概览 | Run Overview | 默认视图，展示当前计划、当前路线、验收、缺口、完成依据和最近进展。 |
| 计划与进度视图 | Plan and Progress View / “计划与进度” | 展示当前 Run 的完整整体计划、两类进度、计划项、当前路线和变化时间线。 |
| Run 状态指标 | Run Status Metric | 显示当前 Run 生命周期状态。 |
| 验收进度指标 | Acceptance Progress Metric | 显示必需验收项已满足数量。 |
| 最近进展指标 | Latest Progress Metric | Completion Check 已通过时显示“完成”；其余情况显示最近 Progress Receipt 的主类别。 |
| 完成判定指标 | Completion Decision Metric | 显示“可完成”“继续工作”或“尚未检查”。 |
| 当前计划卡片 | Current Plan Card | 展示 Working Plan 的计划项、客观状态、证据数、Plan Focus、Plan Revision 编号、Objective Projection 版本和最近修订原因。 |
| 当前路线卡片 | Current Attempt Card | 展示 Active Attempt 的具体方法、状态、替代原因和下一动作。 |
| 整体计划面板 | Overall Plan Panel / `RunPlanProgress` | 使用 Run 级运行概览投影展示 Working Plan；在运行状态栏使用紧凑形态，在计划与进度视图使用完整形态。 |
| 计划同步标记 | Plan Sync Badge / “已同步”“Step 回退” | “已同步”表示数据来自 Run 级完整快照；“Step 回退”表示当前只有历史 Step 或 Legacy Trace 可供兼容投影。 |
| 计划覆盖指标 | Plan Coverage Metric | 统计有效计划项中的 `satisfied` 数量；分母排除 `cancelled` 和 `superseded`。 |
| 交付验收指标 | Delivery Acceptance Metric | 统计必需验收项中 `passed` 或 `waived` 的数量。 |
| 计划项列表 | Plan Item List | 展示稳定 Plan Item ID、状态、Plan Focus、更新 Step、状态来源、依赖、阻塞原因和客观依据数。 |
| 计划变化时间线 | Plan Change Timeline | 按最新在前展示计划修订、计划状态投影、Plan Focus、路线、验收、进展、完成检查和 Recovery 变化。 |
| 计划变化项 | Plan Change Item | 单条变化记录，显示标题、说明、Step、Plan Revision 和 Objective Projection 版本；可定位对应 Step 输入输出。 |
| 调整计划按钮 | Adjust Plan Button / “调整计划” | 回到会话页并在底部输入区预填自然语言计划调整要求；用户发送后由 Agent 通过 `update_plan` 提交结构化修订。 |
| 查看计划变化按钮 | View Plan Changes Button / “查看计划变化” | 从运行状态栏打开计划与进度视图。 |
| 验收清单卡片 | Acceptance Checklist Card | 展示验收项、状态和依据数量。 |
| 交付缺口卡片 | Deliverable Gap Card | 展示仍待满足的必需验收项和当前阻塞。 |
| 完成依据卡片 | Completion Evidence Card | 展示支持完成判定的 Receipt 引用。 |
| 进展回执卡片 | Progress Receipt Card | 展示交付推进、信息增量、结果回退和连续计数。 |
| Run 列表 | Run List | Session 下的 Run 列表。 |
| Run 卡片 | Run Card | 单个 Run 摘要。 |
| Step 列表 | Step List | 当前 Run 的 Step 列表。 |
| Step 输入输出查看器 | Step I/O Viewer | 查看单个 Step 的持久化输入、输出和原始数据。 |
| 输入标签页 | Input Tab | 展示上下文健康检查和输入构成列表。 |
| 输出标签页 | Output Tab | 展示进展回执、工具配对和语义输出。 |
| 原始数据标签页 | Raw Data Tab | 展示后端脱敏后的 Step I/O。 |
| 上下文健康检查 | Context Health | 展示因果链、工具配对、压缩和稳定前缀指标。 |
| 输入构成列表 | Input Composition List | 按 Context Section 展示实际输入。 |
| 输入构成项 | Input Composition Item | System Prompt、Task Contract、Working Set、Archive Summary、Recent Causal Tail、Steering Messages、Available Tools 或 Context Composition。 |
| 工具调用与结果 | Tool Calls and Results | 按 `toolUseId` 配对展示 Tool Call 与 Tool Result。 |
| 输出构成列表 | Output Composition List | 展示 Thinking、Assistant Text、State Delta、Plan Revision / Objective Projection、Attempt and Assumption Delta、Acceptance Delta、Completion Decision、Error and Recovery。 |
| 原始数据 | Raw Data | Step I/O 的脱敏 JSON。 |
| 持久化语义 Trace 标记 | Persistent Semantic Trace Badge | 表示当前视图来自工作区持久化 Trace。 |
| Legacy Trace 标记 | Legacy Trace Badge | 表示当前只有旧内存 Trace 可用。 |
| 事件顺序导出按钮 | Event Order Export Button | 导出前端事件接收与处理顺序。 |
| 消息流顺序导出按钮 | Feed Order Export Button | 导出消息流实际展示顺序。 |

当前计划卡片和整体计划面板回答“当前还需要覆盖哪些结果”，当前路线卡片回答“当前使用哪种方法推进”。`R<n>` 表示 Plan Revision，`P<n>` 表示 Objective Projection 版本；计划项本身使用 `P01`、`P02` 等稳定 ID。

运行概览与计划与进度视图读取当前 Run 的完整运行概览投影。Step 输入输出查看器读取用户选中的历史 Step I/O。用户选择旧 Step 时，整体计划面板继续显示当前快照；计划变化项可以把 Step 输入输出查看器定位到对应历史 Step。

计划覆盖与交付验收表达两个独立维度。计划覆盖描述 Working Plan 内部结果的推进，交付验收描述 Deliverable Contract 的必需条件满足情况。计划修订可能改变计划覆盖分母，Acceptance Snapshot 变化只影响交付验收。

## 13. 运行状态栏

| 规范中文名 | 英文名 / 当前标签 | 说明 |
| --- | --- | --- |
| 会话信息区 | Session Info | 更新时间、并行 Run 数量、工作目录和导出操作。 |
| 当前 Run 区 | Current Run | 当前选中或最近 Run 的摘要。 |
| 整体计划面板 | Overall Plan Panel / “整体计划” | 当前 Run 区内的紧凑计划与进度摘要，实时同步 Run 级完整快照，并提供调整计划和查看计划变化入口。 |
| 任务状态面板 | Task State Panel / “Task State” | 显示任务状态兼容投影中的 goal、next action 和 verification。 |
| Step 进度面板 | Step Progress | 当前 Run 的 Step 列表和进度。 |
| 工具调用面板 | Tool Calls Panel / “Tool Calls” | 当前 Step 的工具调用。 |
| 运行环境面板 | Runtime Panel / “Runtime” | Provider、model、max tokens 和 context window。 |
| 研究信号面板 | Research Signals Panel / “Research Signals” | Research Notebook 的摘要信号。 |
| 运行状态栏浮层 | Inspector Overlay | 窄屏下展开的运行状态栏。 |
| 运行状态栏遮罩 | Inspector Backdrop | 点击后关闭运行状态栏浮层。 |

任务状态面板展示兼容聚合视图。整体计划面板中的结构化 Working Plan 是计划 UI 的权威来源；任务状态兼容投影中的 `plan` 只在缺少结构化计划时用于兼容引导。讨论其中的单项内容时，使用“任务状态面板 / 下一动作”“任务状态面板 / 验证状态”等完整名称。

## 14. 设置

| 规范中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 设置弹窗 | Settings Modal | 主设置面板。 |
| 设置侧栏 | Settings Sidebar | 设置分类导航。 |
| API 设置 | API Settings | Provider、Key 和连接测试。 |
| 模型 Provider 列表 | Model Provider List | 可选模型服务列表。 |
| 本机 ChatGPT 订阅 Provider | Local ChatGPT Subscription Provider | 通过 `CODEX_API_PORT` 连接本机 Codex OAuth 服务。 |
| 订阅模型选择器 | Subscription Model Select | 选择本机服务提供的模型。 |
| 推理强度选择器 | Reasoning Effort Select | 选择模型支持的 reasoning effort。 |
| MiniMax 国际 Provider | MiniMax International Provider | MiniMax 国际端点选项。 |
| MiniMax 中国 Provider | MiniMax China Provider | MiniMax 中国区端点选项。 |
| 能力设置 | Skills Settings | 配置新 Run 预先激活的本地 Skill。 |
| 能力加载开关 | Skill Toggle | 单个 Skill 的预激活开关。 |
| 能力运行状态 | Skill Runtime Status | 显示当前 Session 或 Run 已选择、已激活的 Skill。 |
| 外观设置 | Appearance Settings | dark、light、system。 |
| Debug 设置 | Debug Settings | 过程详情和 Thinking 展示开关。 |
| 关于页 | About Settings | Workspace、Provider 和本地运行说明。 |

## 15. 模糊名称替换

| 避免使用 | 规范名称 |
| --- | --- |
| 左边栏 | 导航栏 |
| 中间栏 | 会话栏 |
| 右边栏 / Trace 栏 | 运行状态栏 |
| 状态过程项 | 运行提示项或任务状态过程项 |
| 状态卡片 | 整体计划面板、当前计划卡片、当前路线卡片、验收清单卡片、交付缺口卡片、完成依据卡片或进展回执卡片 |
| Trace 页面 | 运行详情页 |
| 详情 | Step 输入输出查看器、原始数据标签页或过程详情 |
| 事件 | Provider 流事件、TraceEvent 或 ClientNotification |
| 技能按钮 | 输入能力开关、能力加载开关或能力运行状态 |

## 16. 推荐描述格式

- “消息流 / 运行提示项 / 交付进度提醒出现了两次。”
- “运行详情页 / 当前计划卡片 / P03 的客观状态没有随 `plan.updated` 更新。”
- “运行状态栏 / 整体计划面板 / P03 没有随 `run.overview.updated` 的较新 `latestSeq` 更新。”
- “运行详情页 / 计划变化时间线 / R4 的计划修订无法定位对应 Step。”
- “运行详情页 / 当前路线卡片 / 路线替代原因没有展示。”
- “运行详情页 / Step 输入输出查看器 / 工具调用与结果缺少一个 Tool Result。”
- “运行状态栏 / 任务状态面板 / 下一动作仍显示旧内容。”
- “设置弹窗 / 能力设置 / 幻灯片能力加载开关未生效。”
- “导航栏 / 历史 Session 列表 / 运行中的 Session 条目缺少停止按钮。”

## 17. 维护规则

- 新增或重命名可见 UI 元素时，在同一变更中更新本文件。
- 新增 TraceEvent 或 ClientNotification 时，记录它是否新增消息流元素、更新已有元素或只进入运行详情页。
- Runtime 语义变化先更新 `CONCEPT-NAMING.md`，随后同步本文件中的 UI 投影。
- 页面固定文案与规范 UI 名称可以分别记录；讨论时应明确引用“元素名”或“屏幕文案”。
- 兼容事件移除后，删除对应兼容映射表项并检查导出、SSE 重放和历史 Session。
