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
- [目录选择弹窗](#目录选择弹窗)
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
| Thinking 卡片 | Thinking Card | 模型 thinking 的可展开过程卡片。 |
| 消息工具条 | Message Toolbar | 复制、导出 `.md` 等按钮。 |
| 回到底部按钮 | Scroll To Bottom | 消息流未到底部时出现。 |
| 底部输入区 | Composer | 已创建 session 的输入区。 |
| 发送按钮 | Send Button | 提交当前输入。 |
| 停止按钮 | Stop Button | 运行中替换发送按钮。 |

### 草稿页状态

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 新会话草稿 | New Session Draft | 尚未创建 session 的空白状态。 |
| 草稿输入框 | Draft Composer | 草稿页中间的大输入框。 |
| 草稿目录提示 | Draft Workspace Prompt | 草稿输入框下方的目录提示按钮。 |
| 草稿目录选择 | Draft Workspace Picker | 草稿页打开的目录选择弹窗。 |
| 默认执行目录 | Default Workspace | 未手动选择目录时，发送后自动创建的目录。 |

## 目录选择弹窗

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 目录选择弹窗 | Workspace Picker Modal | 选择执行目录的弹窗。 |
| 已添加目录 | Saved Directories | 用户已经添加过的目录。 |
| 推荐目录 | Recommended Directories | 后端返回的推荐目录。 |
| 添加项目按钮 | Add Directory Button | 打开系统目录选择器。 |
| 目录卡片 | Directory Card | 一个可选目录。 |
| 使用默认按钮 | Use Default Button | 草稿模式下清空手动目录，发送后自动创建默认目录。 |
| 确定按钮 | Confirm Workspace Button | 确认当前选择；草稿模式下只设置目录。 |

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

## 运行状态栏

| 中文名 | 英文名 | 说明 |
| --- | --- | --- |
| 会话信息 | Session Info | 顶部集中区：更新时间、并行任务数量、工作目录、导出 trace；草稿态隐藏导出。 |
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
| 外观设置 | Appearance Settings | dark、light、system。 |
| Debug 设置 | Debug Settings | 过程详情开关。 |
| 关于页 | About Settings | workspace、provider、本地说明。 |

## 推荐描述格式

- 导航栏 / 历史 Session 列表 / Session 条目高亮有问题。
- 草稿页 / 草稿目录提示 / 点击后复用目录选择弹窗。
- 运行状态栏 / 窄屏浮层 / 关闭后拉宽保持收起。
- 运行状态栏 / 会话信息 / 导出 trace 按钮在草稿态隐藏。
- 页面顶部栏 / 页面导航 / 切换 session 默认回到会话视图。
- 运行详情页 / Trace 详情面板 / Model Request 区块太高。
