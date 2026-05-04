# Project Overview

Ranni 是一个本地优先的 AI Agent 网页工作台。它的目标不是做一个普通聊天界面，而是让用户选择本机一个项目目录，然后让 agent 在这个目录内理解任务、调用工具、编辑文件、运行命令、记录证据并交付结果。

## 产品模型

Ranni 的当前产品模型可以概括为四件事：

1. 选择一个执行目录。
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
- 支持 Markdown 渲染。
- 支持复制 assistant 消息。
- 支持导出 assistant 消息为 `.md`。
- 支持导出完整 `trace.txt`。
- 支持 `Enter` 发送、`Shift + Enter` 换行。
- 运行中输入区会变成终止按钮。

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
  - 模型 provider 列表，支持 DeepSeek、Qwen、自定义 OpenAI-compatible URL。
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

- Qwen / DashScope OpenAI-compatible API。
- 自定义 OpenAI-compatible Base URL。

Provider 适配层在 `lib/llm/`，由 `lib/llm/index.ts` 根据配置选择 provider。

## 工具能力

Agent 可用工具主要分为六类：

- 工作区文件工具：`list_files`、`read_file`、`write_file`、`move_path`、`delete_path`、`search_in_files`。
- 终端工具：`run_terminal`。
- Web 工具：`search_web`、`fetch_url`。
- Research notebook 工具：`plan_research`、`record_research_finding`、`review_research_state`、`save_research_checkpoint`。
- Task state 工具：`update_task_state`。
- Durable memory 工具：`init_task_memory`、`read_task_memory`、`update_task_memory`、`record_task_evidence`、`save_task_checkpoint`。

所有文件和终端工具都受 session workspace 边界限制。

## Trace 与导出

每次 `/api/chat` 会产生一个 run。Run 由多个 step 组成，每个 step 包含：

- system prompt 和上下文快照。
- model request 和 model response。
- thinking。
- tool calls 和 tool results。
- task state。
- status message。

Assistant 回复会绑定对应 `traceRunId`。点击 `导出 trace` 会下载完整 `trace.txt`，文件名使用时间戳，便于后续分析失败原因。

## 当前边界

- Ranni 是本地优先应用，设置密钥保存在 localStorage，不适合作为多用户远端服务直接部署。
- 目录选择依赖本机系统能力；Linux 需要 `zenity` 或 `kdialog`。
- `write_file` 是全文件写入工具，适合小文件或完整重写，不适合盲目局部 patch。
- `.ranni` 是 agent 任务记忆，不是用户文档归档区。

