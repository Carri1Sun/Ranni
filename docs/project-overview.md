# Project Overview

Ranni 是一个本地优先的 AI Agent 网页工作台。它的目标不是做一个普通聊天界面，而是让用户选择本机一个项目目录，然后让 agent 在这个目录内理解任务、调用工具、编辑文件、运行命令、记录证据并交付结果。

## 产品模型

Ranni 的当前产品模型可以概括为四件事：

1. 选择一个执行目录，或让 Ranni 在 `~/Documents/Ranni-Workspace` 下自动创建一个 `ranni-session-<sessionId>` 目录后直接开始。
2. 在 session 中向 agent 交代任务。
3. Agent 通过模型、工具、文件系统、终端、搜索和 durable memory 完成任务。
4. 用户通过会话、报告、运行详情和 trace 审查结果。

## 页面结构

### 左侧：导航栏

左侧栏承担全局导航职责：

- 新建 session。
- 展示历史 session。
- 进入会话、报告、运行详情页面。
- 底部进入设置。

历史 session 会显示 session 名称、更新时间和 workspace 简称。Session 名称默认是 `新研究会话`，首条消息发送后会异步请求模型生成十五字以内标题。

### 中间：会话栏

会话栏是主工作区：

- 展示用户消息、assistant 回复和运行活动。
- 运行活动以过程项展示，覆盖 run 生命周期、异常 step、task state、工具调用、工具结果、research state 和错误。
- 工具调用会先用本地规则即时生成短标题、说明、图标和 meta，再异步请求模型改写为更自然的中文文案。
- 支持 Markdown 渲染。
- 支持复制 assistant 消息。
- 支持导出 assistant 消息为 `.md`。
- 支持导出完整 `trace.txt`。
- 支持 `Enter` 发送、`Shift + Enter` 换行。
- 运行中输入区会变成终止按钮。
- 最新过程项在运行中显示扫光动效；左侧 session 和顶部状态也会显示运行态。

报告页复用 assistant 消息内容，便于查看较完整的最终输出。

### 右侧：运行状态栏

右侧栏用于观察 agent 当前运行状态：

- runtime provider、model、context window。
- 当前 run、step、tool calls。
- task mode、goal、verification status。
- `.ranni` memory 目录、todo 进度、latest checkpoint。
- research signal 和 trace 摘要。

右侧栏可以收起，适合用户专注阅读会话。

## 设置能力

设置弹窗是左右两栏布局，左侧是设置导航，右侧是具体内容。

当前设置项：

- 账号：预留账号信息展示，目前不实现登录逻辑。
- 外观：支持 dark、light、system。
- API 设置：
  - Tavily 搜索 API Key，支持配置、清除、测试。
  - Computer use OpenAI API Key，支持配置、清除、测试，用于 OpenAI Responses API `computer` tool loop。
  - 模型 provider 列表，支持 DeepSeek、OpenAI、Qwen、自定义 OpenAI-compatible URL。
- Debug：支持「会话过程展示具体内容」开关。关闭时只显示优化后的过程文案；开启后每条过程项出现 info 按钮，可查看该项绑定的 run、step、tool call、tool result 和当前 agent loop trace。
- 关于：展示当前 workspace、provider、model 和本地运行说明。

## 模型能力

默认 provider 是 DeepSeek：

- Provider: `deepseek-openai-compatible`
- Base URL: `https://api.deepseek.com`
- Model: `deepseek-v4-pro`
- Context window: `128000`
- Thinking: enabled
- Reasoning effort: `high`

同时支持：

- OpenAI 官方 API，默认模型 `gpt-5.5`。
- Qwen / DashScope OpenAI-compatible API。
- 自定义 OpenAI-compatible Base URL。

Provider 适配层在 `lib/llm/`，由 `lib/llm/index.ts` 根据配置选择 provider。

## 工具能力

Agent 可用工具主要分为七类：

- 工作区文件工具：`list_files`、`read_file`、`write_file`、`move_path`、`delete_path`、`search_in_files`。
- 终端工具：`run_terminal`。
- 桌面操作工具：`operate_computer`，通过 OpenAI `computer` tool 规划动作，本机 macOS 适配器执行截图、点击、滚动、输入、按键和拖拽。
- Web 工具：`search_web`、`fetch_url`。
- Research notebook 工具：`plan_research`、`record_research_finding`、`review_research_state`、`save_research_checkpoint`。
- Task state 工具：`update_task_state`。
- Durable memory 工具：`init_task_memory`、`read_task_memory`、`update_task_memory`、`record_task_evidence`、`save_task_checkpoint`。

文件、终端和运行产物受 session workspace 边界限制。`operate_computer` 会控制用户实际 macOS 桌面，只应在用户明确要求桌面操作时使用，并在支付、登录、敏感信息或破坏性确认前停止。

Deep research 任务会额外强调动态研究地图、正文核验、证据记录、coverage audit 和 thesis-driven synthesis。来源或 claim 较多时，agent 可把 `source_ledger`、`claim_ledger`、`coverage_matrix`、`synthesis_brief`、`negative_results` 写入 `.ranni/runs/<runId>/`，并在最终综合前读回。

## 过程展示规范

会话过程项按语义分为七类：

- `step`：run 开始/结束，以及失败或终止的 step；成功的 step 开始/完成不进入默认会话流。
- `state`：`task_state` 中 current mode、next action、verification 的变化。
- `thinking`：模型返回的 thinking 会以独立会话过程卡片展示，可展开阅读、复制，并继续关联到对应 run / step trace。
- `status`：模型重试、运行提示等短状态。
- `tool_call`：工具调用意图，显示图标、短标题、目标和补充 meta。
- `tool_result`：工具执行结果，显示成功/失败、耗时和结果摘要。
- `research`：research notebook 状态更新。
- `error`：接口、模型或工具层错误。

展示层默认隐藏原始 JSON 和长结果，只保留可读摘要。完整信息不丢弃，仍保存在 run trace 中，由 Debug info 浮窗按当前过程项关联展示。

## Trace 与导出

每次 `/api/chat` 会产生一个 run。Run 由多个 step 组成，每个 step 包含：

- system prompt 和上下文快照。
- model request 和 model response。
- thinking。
- tool calls 和 tool results。
- task state。
- status message。

Trace 导出挂在 session 上，不再依赖某条 assistant 回复。点击顶部 `导出 trace` 会下载当前 session 的完整 `trace.txt`，包含 messages、process feed、research context 和全部 run JSON；即使任务尚未完成、还没有最终 assistant 回复，也能导出当前 running run 的轨迹，便于后续分析失败原因。

本地 `npm run research:eval` 可对 deep research case 进行脚本化回放和分析，产物写入已忽略的 `research/research-eval/`，用于比较不同 prompt / harness 改动下的 trajectory 和最终质量。`--judge-run` / `--judge-pair` 会对最终回答做 rubric、style 和 blind pairwise 质量评审，让 harness 迭代围绕用户可见结果、阅读体验和工具轨迹共同展开。

## 当前边界

- Ranni 是本地优先应用，设置密钥保存在 localStorage，不适合作为多用户远端服务直接部署。
- 目录选择依赖本机系统能力；Linux 需要 `zenity` 或 `kdialog`。不选择目录时可用「自动开始」，由后端在 `RANNI_DEFAULT_WORKSPACE`（默认 `~/Documents/Ranni-Workspace`）下创建 `ranni-session-<sessionId>` 目录。
- `write_file` 是全文件写入工具，适合小文件或完整重写，不适合盲目局部 patch。
- `.ranni` 是 agent 任务记忆，不是用户文档归档区。
