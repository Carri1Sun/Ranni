# Ranni UI 命名约定

这份文档用于产品迭代、代码 review、设计讨论和问题反馈。讨论页面元素时优先使用这里的中文名，必要时补充英文名或代码名。

## 命名原则

1. 页面上可见的区域使用中文名沟通。
2. 代码组件、状态、CSS class 可继续使用英文名。
3. 需求描述优先使用「区域 + 元素 + 行为」格式，例如「会话栏 / 页面顶部栏 / 运行状态栏按钮，在窄屏下打开右侧浮层」。
4. 当一个词已经在这里定义，后续需求和文档保持同一叫法。

## 页面内导航

- [一级页面结构](#一级页面结构)
- [导航栏](#导航栏)
- [会话栏子结构](#会话栏子结构)
- [消息流展示触发类型](#消息流展示触发类型)
- [Session 专属目录弹窗](#session-专属目录弹窗)
- [任务上限弹窗](#任务上限弹窗)
- [报告页](#报告页)
- [运行详情页](#运行详情页)
- [运行状态栏](#运行状态栏)
- [设置](#设置)

## 一级页面结构

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| [工作台](#一级页面结构) | Workspace / Shell | 整个 Ranni 主界面。 |
| [导航栏](#导航栏) | Sidebar | 左侧栏，包含新会话、历史 session、设置入口。 |
| [会话栏](#会话栏子结构) | Chat Panel | 中间主区域，承载当前会话、草稿页、报告页、运行详情页。 |
| [运行状态栏](#运行状态栏) | Run Inspector | 右侧栏，展示会话信息、run、step、tool、task state、runtime。 |

代码中的一级结构对应关系：

- [工作台](#一级页面结构)：`main.shell` 和内部 `workspace` 布局容器。
- [导航栏](#导航栏)：`aside.sidebar`。
- [会话栏](#会话栏子结构)：`section.chatShell`。
- [运行状态栏](#运行状态栏)：`aside.inspector`。

## 导航栏

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 新会话按钮 | New Session Button | 点击后进入草稿页。 |
| 历史 Session 列表 | Session List | 左侧历史会话列表。 |
| Session 条目 | Session Item | 历史列表中的单个 session。 |
| Session 停止按钮 | Session Stop Button | 运行中的 Session 条目右侧按钮，可直接终止该 Session 的当前 run。 |
| 设置入口 | Settings Entry | 导航栏底部设置按钮。 |
| 导航栏浮层 | Sidebar Overlay | 窄屏下展开导航栏时的浮层形式。 |
| 导航栏遮罩 | Sidebar Backdrop | 点击后关闭导航栏浮层。 |

## 会话栏子结构

页面顶部栏、输入区、草稿页都归属于会话栏。草稿页是新 session 尚未创建时的会话栏状态。

### 页面顶部栏

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 侧边栏折叠按钮 | Sidebar Toggle | 折叠 / 展开导航栏。 |
| 会话标题 | Session Title | 当前 session 标题，草稿态显示默认标题。 |
| 页面导航 | Page Nav | session 内页面切换下拉：会话、报告、运行详情；切换 session 默认回到会话视图，草稿态隐藏。 |
| 运行状态栏折叠按钮 | Inspector Toggle | 折叠 / 展开运行状态栏。 |

### 会话内容

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 消息流 | Feed | 会话中的用户消息、assistant 消息、过程项。 |
| 用户消息 | User Message | 用户发送的消息卡片。 |
| Assistant 消息 | Assistant Message | 模型最终回复卡片。 |
| 过程项 | Process Item / Activity | 工具调用、状态、thinking、错误等运行过程展示。 |
| Thinking 正文 | Thinking Text | 模型 thinking 的流式正文展示。 |
| Run 生命周期行 | Run Lifecycle Line | run 开始、完成、失败、终止的一行弱提示。 |
| 消息工具条 | Message Toolbar | 复制、导出 `.md` 等按钮。 |
| 回到底部按钮 | Scroll To Bottom | 消息流未到底部时出现。 |
| 底部输入区 | Composer | 已创建 session 的输入区。 |
| 输入能力开关 | Composer Skill Toggle | 输入框内的临时能力开关，例如“幻灯片”；只影响下一次发送。 |
| 研究校验开关 | Composer Research Guard Toggle | 输入框内的临时研究校验开关，启用后本次发送开启 research 信号校验与完整性打回；默认关闭。 |
| 发送按钮 | Send Button | 提交当前输入。 |
| 当前 Session 停止按钮 | Current Session Stop Button | 当前 Session 运行中时替换发送按钮。 |

## 消息流展示触发类型

这张表定义“什么输入会在消息流中新增或更新一条可见内容”。后续新增过程样式、消息样式或事件类型时，先更新这里，再改组件和 CSS。

### UI 元素类型

代码里的消息流数据结构是 `FeedItem = FeedMessage | FeedActivity`，渲染入口在 `components/agent-console.tsx` 的 `activeSession.feed.map(...)`。

| UI 元素类型 | 代码定义 / 识别条件 | 展示逻辑 | 流式 / 更新逻辑 | 对齐方式 |
| --- | --- | --- | --- | --- |
| 用户消息 | `FeedMessage`，`kind: "message"`，`role: "user"` | 渲染为消息卡片，使用 `message userMessage`；正文用普通 `<p>` 展示，保留换行。 | 用户提交时新增一条；当前没有流式输出，提交后通常不再更新。 | 在消息流右侧对齐，`align-self: flex-end`；宽度按内容收缩，最大 `min(88%, 900px)`。 |
| Assistant 消息 | `FeedMessage`，`kind: "message"`，`role: "assistant"` | 渲染为消息卡片，使用 `message assistantMessage`；正文走 Markdown 渲染；底部带复制和导出 `.md` 的消息工具条。 | `assistant_delta` 创建或更新同一条消息，形成流式输出；`assistant` 用最终内容校准或补齐同一条消息。 | 在消息流左侧对齐，`align-self: flex-start`；宽度按内容收缩，最大 `min(88%, 900px)`。 |
| Run 生命周期行 | `FeedActivity`，`eventType` 为 `run_started` / `run_completed` / `step_completed` | 渲染为一行弱提示，使用 `runLifecycleLine`；包含小图标和短标题；失败状态追加红色样式。 | 每个生命周期事件新增一行；没有流式输出；当前不会改写已有生命周期行。 | 在消息流左侧对齐，`align-self: flex-start`，`margin: 2px 0`。 |
| 状态过程项 | `FeedActivity`，`type: "status"` | 渲染为浅背景、浅边框的行内过程项；左侧 20x20 无背景图标；右侧第一行展示标题，第二行展示 detail；meta 不展示；标题不换行，detail 空间不足时换行。 | 每个 `status` 事件新增一行；当前没有流式输出；后续收到内容相同的 `thinking` 事件时可能移除重复状态行。 | 在消息流左侧对齐，`align-self: flex-start`；宽度为 `92%`。 |
| Thinking 正文 | `FeedActivity`，`type: "thinking"` | 渲染为正文文本块，使用 `thinkingInline`；内容放在 `<pre>`，保留换行和空白；活动中显示闪烁光标。 | `thinking_delta` 按 run / step 复用同一条正文并持续追加；`thinking` 用最终内容补齐或校准；受 Debug 设置中的 thinking 展示开关控制。 | 在消息流左侧对齐，`align-self: flex-start`；宽度为 `86%`。 |
| 过程项 | `FeedActivity`，除 Run 生命周期行、状态过程项和 Thinking 正文外的 activity | 渲染为透明背景的过程卡片，使用 `activity` + `type` class；卡片内包含图标、标题、可选 meta、单行 detail，开启过程详情时显示信息按钮。 | 默认按事件新增一张卡片；工具调用过程项可能被活动文案改写结果更新 `display`；最新活动项在运行中显示 active 动效。 | 在消息流左侧对齐，`align-self: flex-start`；宽度为 `92%`。 |

`FeedActivity.type` 当前代码定义为：

| `ActivityType` | 当前 UI 名称 | 套用的 UI 元素类型 | 展示 / 更新逻辑 |
| --- | --- | --- | --- |
| `status` | 状态过程项 | 状态过程项 | 模型重试、运行提示等短状态；每个 `status` 事件新增一行浅背景、浅边框的状态过程项。 |
| `tool_call` | 工具调用过程项 | 过程项 | 工具开始调用时新增一张过程卡片；后续活动文案改写可能更新标题、说明、图标或 meta。 |
| `tool_result` | 工具结果过程项 | 过程项 | 工具返回后新增一张过程卡片；展示成功/失败、耗时和摘要。 |
| `error` | 错误过程项 | 过程项 / Run 生命周期行 | 普通 `error` 事件展示为错误过程卡片；失败的 run / step 生命周期事件展示为红色生命周期行。 |
| `step` | Run 生命周期行 / 手动终止过程项 | Run 生命周期行或过程项 | `run_started`、非失败 `run_completed`、取消的 `step_completed` 展示为生命周期行；用户点击停止按钮新增一张手动终止过程卡片。 |
| `state` | 任务状态过程项 | 过程项 | `task_state` 的 current mode、next action、verification status 签名变化时新增一张过程卡片；重复签名不新增。 |
| `research` | 研究状态过程项 | 过程项 | `research_state` 到达时新增一张过程卡片，并同步更新 session 的 research context。 |
| `thinking` | Thinking 正文 | Thinking 正文 | `thinking_delta` 流式追加到同一条正文，`thinking` 负责最终校准。 |

`load_skill` 工具调用使用“激活技能过程项”文案，仍归类为工具调用过程项。

### 会展示的触发源

| 触发源 | 当前 UI 名称 | 英文名 | 展示行为 | 备注 |
| --- | --- | --- | --- | --- |
| 用户发送消息 | 用户消息 | User Message | 新增一条消息卡片。 | `FeedMessage`，由前端提交时写入。 |
| `assistant_delta` | Assistant 消息 | Assistant Message | 创建或更新同一条 assistant 消息卡片。 | 流式更新最终整体回复。 |
| `assistant` | Assistant 消息 | Assistant Message | 校准或新增完整 assistant 消息卡片。 | 完整最终回复，同时进入 run trace。 |
| `run_started` | Run 生命周期行 | Run Lifecycle Line | 新增一行弱提示。 | 显示 run 开始。 |
| `run_completed` | Run 生命周期行 | Run Lifecycle Line | 新增一行弱提示。 | 显示 run 完成、失败或取消。 |
| `step_completed`，状态为 `failed` / `cancelled` | Run 生命周期行 / 错误过程项 | Run Lifecycle Line / Error Activity | 新增一条失败或终止提示。 | `completed` 状态当前不展示。 |
| `status` | 状态过程项 | Status Activity | 新增一条状态过程项。 | 用于模型重试、运行提示等短状态。 |
| `task_state`，关键签名变化 | 任务状态过程项 | Task State Activity | 新增一条任务状态过程项。 | 签名为 current mode、next action、verification status。 |
| `thinking_delta` | Thinking 正文 | Thinking Text | 创建或更新同一条 thinking 正文。 | 受 Debug 设置中的 thinking 展示开关影响。 |
| `thinking` | Thinking 正文 | Thinking Text | 校准或补齐同一条 thinking 正文。 | 完整内容进入 step trace。 |
| `tool_call` | 工具调用过程项 | Tool Call Activity | 新增一条工具调用过程项。 | 后续可能被模型改写展示文案。 |
| `tool_result` | 工具结果过程项 | Tool Result Activity | 新增一条工具结果过程项。 | 显示成功/失败、耗时和摘要。 |
| `research_state` | 研究状态过程项 | Research Activity | 新增一条研究状态过程项。 | 同步 research notebook 摘要。 |
| `error` | 错误过程项 | Error Activity | 新增一条错误过程项。 | 用于接口、模型或工具层错误。 |
| 用户点击停止按钮 | 手动终止过程项 | Manual Stop Activity | 新增一条终止提示。 | 前端本地动作，同时 `POST /api/runs/:runId/abort` 中断当前 run。 |
| 运行中发送补充消息 | 补充消息过程项 | Steer Activity | 新增一条「已发送补充消息」提示。 | 经 `POST /api/runs/:runId/steer` 投递，Agent 在下一 turn 边界注入。 |

### 当前不新增消息流内容的事件

| 触发源 | 行为 | 备注 |
| --- | --- | --- |
| `step_started` | 更新运行详情选中 step。 | 消息流不新增内容。 |
| `context_snapshot` | 写入 run / step trace。 | 消息流不新增内容。 |
| `model_request` | 写入 run / step trace。 | 消息流不新增内容。 |
| `model_response` | 写入 run / step trace。 | 消息流不新增内容。 |
| `step_completed`，状态为 `completed` | 写入 step trace。 | 成功 step 完成当前不新增内容。 |
| 活动文案改写结果 | 更新已有过程项。 | 不新增消息流条目，只改写标题、说明、图标或 meta。 |

### 草稿页状态

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 新会话草稿 | New Session Draft | 尚未创建 session 的空白状态。 |
| 草稿输入框 | Draft Composer | 草稿页中间的大输入框。 |
| 草稿专属目录提示 | Draft Session Workspace Prompt | 草稿输入框下方的 session 专属目录提示。 |
| 专属目录说明 | Session Workspace Info | 草稿页打开的专属目录规则说明。 |
| Session 专属目录 | Session Workspace | 发送首条消息时自动创建的 session 专属执行目录。 |

## Session 专属目录弹窗

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 专属目录弹窗 | Session Workspace Modal | 说明 session 专属目录规则并支持自动创建。 |
| 专属目录说明区 | Session Workspace Info Section | 说明 Documents 下的自动创建位置和执行边界。 |
| 自动创建按钮 | Auto Create Session Workspace Button | 在 Documents 下创建 session 专属目录并进入新 session。 |
| 查看目录规则按钮 | View Workspace Rule Button | 草稿空白态打开专属目录弹窗。 |

## 任务上限弹窗

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 任务上限弹窗 | Agent Limit Modal | 并行 agent run 达到上限时的提醒弹窗。 |

## 报告页

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 报告页 | Report View | 查看最近完整 assistant 输出。 |
| 报告预览 | Report Preview | Markdown 报告展示区域。 |
| 报告操作区 | Report Actions | 复制报告、导出 `.md`。 |

## 运行详情页

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 运行详情页 | Trace View | 查看 run、step、request、response、tool trace。 |
| Run 列表 | Run List | 左侧 run 列表。 |
| Run 卡片 | Run Card | 单个 run。 |
| Step 列表 | Step List | 当前 run 下的 step。 |
| Trace 详情面板 | Trace Detail Panel | 右侧详细 trace 内容。 |
| Trace 区块 | Trace Block | System Prompt、Model Request、Tool Calls 等内容块。 |
| 事件顺序导出按钮 | Event Order Export Button | 导出当前 session 的前端流事件接收和展示处理顺序。 |
| 消息流顺序导出按钮 | Feed Order Export Button | 导出当前 session 的消息流实际 UI 展示顺序。 |

## 运行状态栏

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 会话信息 | Session Info | 顶部集中区：更新时间、并行任务数量、工作目录、导出 trace、导出事件顺序、导出消息流顺序；草稿态隐藏导出。 |
| 当前 Run | Current Run | 当前选中或最近 run 的摘要。 |
| Task State 面板 | Task State Panel | goal、next action、verification 等。 |
| Step 进度 | Step Progress | 当前 run 的 step 列表。 |
| Tool Calls 面板 | Tool Calls Panel | 当前 step 的工具调用。 |
| Runtime 面板 | Runtime Panel | provider、model、context 等。 |
| Research Signals | Research Signals | research notebook 摘要。 |
| 运行状态栏浮层 | Inspector Overlay | 窄屏下运行状态栏的展开形式。 |
| 运行状态栏遮罩 | Inspector Backdrop | 点击后关闭运行状态栏浮层。 |

## 设置

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 设置弹窗 | Settings Modal | 主设置面板。 |
| 设置侧栏 | Settings Sidebar | 设置弹窗左侧 tab。 |
| API 设置 | API Settings | provider、key、连接测试。 |
| 模型 Provider 列表 | Model Provider List | API 设置中的模型服务选项列表。 |
| MiniMax 国际 Provider | MiniMax International Provider | 使用 `api.minimax.io` 国际端点的 MiniMax Token Plan 选项。 |
| MiniMax 中国 Provider | MiniMax China Provider | 使用 `api.minimaxi.com` 中国区端点的 MiniMax Token Plan 选项。 |
| 能力设置 | Skills Settings | 本地 skill 能力开关，控制新 run 的强制加载能力。 |
| 能力加载开关 | Skill Toggle | 单个本地 skill 的强制加载开关。 |
| 能力运行状态 | Skill Runtime Status | 根据当前会话或运行 trace 展示已选或已激活的能力状态。 |
| 外观设置 | Appearance Settings | dark、light、system。 |
| Debug 设置 | Debug Settings | 过程详情开关。 |
| 关于页 | About Settings | workspace、provider、本地说明。 |

## 推荐描述格式

- 导航栏 / 历史 Session 列表 / Session 条目高亮有问题。
- 草稿页 / 草稿专属目录提示 / 展示发送后自动创建的 session 专属目录规则。
- 运行状态栏 / 窄屏浮层 / 关闭后拉宽保持收起。
- 运行状态栏 / 会话信息 / 导出 trace 按钮在草稿态隐藏。
- 页面顶部栏 / 页面导航 / 切换 session 默认回到会话视图。
- 运行详情页 / Trace 详情面板 / Model Request 区块太高。
