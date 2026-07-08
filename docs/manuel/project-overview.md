---
author: codex
version: v1
date: 2026-06-29
---

# Project Overview

Ranni 是一个本地优先的 AI Agent 网页工作台。它为每个 session 创建独立执行目录，让 agent 在这个目录内理解任务、调用工具、编辑文件、运行命令、记录证据并交付结果。

## 产品模型

Ranni 的当前产品模型可以概括为五件事：

1. 点击新建 session 后进入空白草稿页。
2. 在草稿页输入任务，发送首条消息时自动创建 session 专属执行目录。
3. 发送首条消息后创建 session，并让 agent 在该 session 的专属 workspace 内执行任务。
4. Agent 通过模型、工具、文件系统、终端、搜索和 durable memory 完成任务。
5. 用户通过会话、报告、运行详情和 trace 审查结果。

## 页面结构

一级页面结构有四个：

- 工作台：整体页面和三栏布局容器。
- 导航栏：左侧栏。
- 会话栏：中间栏，承载页面顶部栏、草稿页状态、会话页、报告页、运行详情页和底部输入区。
- 运行状态栏：右侧栏。

### 左侧：导航栏

左侧栏承担全局导航职责：

- 新建 session 草稿。
- 展示历史 session。
- 底部进入设置。

新建 session 草稿不会进入历史列表。用户发送首条消息后才会创建 session。历史 session 会显示 session 名称、更新时间和 workspace 简称。Session 名称默认是 `新研究会话`，首条消息发送后会异步请求模型生成十五字以内标题。

### 中间：会话栏

会话栏是主工作区：

- 顶部提供会话标题、页面导航和左右栏折叠按钮。
- 展示用户消息、assistant 回复和运行活动。
- 在草稿页状态下展示新 session 输入和即将自动创建的专属目录提示。
- 在会话 / 报告 / 运行详情之间切换。
- 运行活动以轻量过程展示，覆盖 run 生命周期、异常 step、task state、工具调用、工具结果、research state 和错误。Run 生命周期只显示一行弱提示。
- 模型 thinking 以正文形式流式展示；agent 会等待 thinking delta 发完后再发送后续过程事件，完整 thinking 在模型输出完成后进入 session trace。
- 最终 assistant 回复通过 `assistant_delta` 流式进入同一条消息，最终 `assistant` event 负责完整内容校准和 trace 持久化。
- 工具调用会先用本地规则即时生成短标题、说明、图标和 meta，再异步请求模型改写为更自然的中文文案。
- 支持 Markdown 渲染。
- 支持复制 assistant 消息。
- 支持导出 assistant 消息为 `.md`。
- 支持导出完整 `trace.txt`。
- 支持导出前端流事件顺序，用于排查接收顺序和展示顺序。
- 支持导出消息流 UI 顺序，用于对照最终展示列表。
- 支持 `Enter` 发送、`Shift + Enter` 换行。
- 当前 session 运行中时，输入区会变成终止按钮。
- 最多支持 3 个 agent run 并行；达到上限时弹出任务数量上限提醒。
- 最新过程项在当前 session 运行中显示扫光动效；左侧 session 会显示运行态。

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
- 动态 skill 工具：`load_skill` 可按需激活本地 skill。当前 `slides` skill 激活后会提供 HTML-to-PPTX 工具 `init_slide_html_workspace`、`prepare_slide_html_for_pptx`、`export_html_to_pptx`、`validate_html_pptx_export`，用于通过受限 slide HTML 生成有限可编辑 `.pptx`。

文件、终端和运行产物受 session 专属 workspace 边界限制。`operate_computer` 会控制用户实际 macOS 桌面，只应在用户明确要求桌面操作时使用，并在支付、登录、敏感信息或破坏性确认前停止。

Deep research 任务会额外强调动态研究地图、正文核验、证据记录、coverage audit 和 thesis-driven synthesis。来源或 claim 较多时，agent 可把 `source_ledger`、`claim_ledger`、`coverage_matrix`、`synthesis_brief`、`negative_results` 写入 `.ranni/runs/<runId>/`，并在最终综合前读回。

幻灯片任务可通过输入框内的“幻灯片”开关临时启用 `slides` skill，或在设置页的能力设置中设为默认强制加载。`slides` skill 规定受限 slide HTML 创作方法和产物目录结构，最终 PPTX 放在 `final/` 子目录；具体落点遵守 session workspace 边界。HTML-to-PPTX 产物会保留 `prompt.txt`、`html-generation-report.json`、`deck.html`、`deck.prepared.html`、`measurements.json`、`qa-report.json`、`preview-html/` 和 `preview-pptx/`。

## 过程展示规范

会话过程项按语义分为七类：

- `step`：run 开始/结束，以及失败或终止的 step；在会话流中显示为一行弱提示。
- `state`：`task_state` 中 current mode、next action、verification 的变化。
- `thinking`：模型返回的 thinking 会先通过 `thinking_delta` 流式展示正文；后端会补齐缺失的最终 thinking 后缀，并等待 delta 发完后再发送后续过程项。
- `status`：模型重试、运行提示等短状态。
- `tool_call`：工具调用意图，显示图标、短标题、目标和补充 meta。
- `tool_result`：工具执行结果，显示成功/失败、耗时和结果摘要。
- `research`：research notebook 状态更新。
- `error`：接口、模型或工具层错误。

assistant 回复作为会话消息展示。最终整体回复会先通过 `assistant_delta` 流式更新同一条消息，完整 `assistant` event 用于最终内容校准。

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
- 草稿页发送首条消息时，后端会在 `RANNI_DEFAULT_WORKSPACE`（默认 `~/Documents/Ranni-Workspace`）下创建 `ranni-session-YYYY-MM-DD_HH-mm-ss` session 专属目录，同一秒内重复创建会追加数字后缀。
- `write_file` 是全文件写入工具，适合小文件或完整重写，不适合盲目局部 patch。
- `.ranni` 用于 agent 任务记忆，避免作为用户文档归档区。
