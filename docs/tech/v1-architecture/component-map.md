---
author: codex
version: v1
date: 2026-07-06
---

# Component Map

这份文档用于快速定位 Ranni 当前核心目录、核心文件和它们的职责。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `components/` | React UI 组件和 CSS module |
| `src/renderer/` | Vite 前端入口 |
| `src/server/` | Express 后端、API、静态网页托管 |
| `lib/` | Agent loop、事件总线、运行注册表、EventMapper、工具、模型适配、trace、workspace、task memory |
| `skills/` | 本地动态 skill 包，当前产品能力为 `html` 和 `html-to-pptx` |
| `docs/` | 产品、架构、核心概念 |
| `public/` | 浏览器可访问静态资源 |
| `scripts/` | 维护脚本，例如 logo 资产生成、research eval、HTML 设计预览生成、HTML-to-PPTX spike runner |

## 根目录文件

| 路径 | 职责 |
| --- | --- |
| `README.md` | 项目入口文档，说明当前能力、启动方式、API 和文档索引 |
| `AGENTS.md` | 给后续 coding agent 的仓库规则、提交格式、文档维护规则 |
| `.env.example` | 本地环境变量模板 |
| `.gitignore` | 忽略依赖、构建产物、运行期 research 和 `.ranni` 记忆 |
| `package.json` | npm 脚本、运行依赖和开发依赖 |
| `vite.config.ts` | 前端 Vite 构建和开发期 API 代理 |
| `tsconfig.json` | 前端和共享 TypeScript 配置 |
| `tsconfig.node.json` | Node/Express 构建配置 |

## 前端核心

### `components/agent-console.tsx`

这是当前最核心的前端组件，负责整个工作台界面。

主要职责：

- session 创建、切换、保存、压缩。
- workspace picker 交互。
- settings modal。
- chat / report / trace 三个页面。
- session 级 SSE 订阅（`GET /api/events`），只读消费三层事件：Layer3 notification 驱动主 UI 状态、Layer2 重建 trace/debug 视图、Layer1 live delta 流式打字。
- run、step、tool、task state、thinking trace 的前端合并。
- thinking delta 的前端内存态展示、最终 thinking 持久化切换和 assistant delta 消息更新。
- 前端流事件顺序日志、消息流 UI 顺序和导出。
- 最多 3 个并行 agent run 的前端状态、按 session 终止和上限弹窗。
- 展示文案直接取自后端 notification（含 model 改写），前端不再二次请求 LLM。
- 运行中补充消息（steer）、手动终止运行（POST abort）。
- lastSeq localStorage 持久化，断线重连续传。
- assistant 消息复制、导出 markdown。
- session 级 trace 导出，包含未完成 run。
- 首条消息异步 session 命名。
- 输入框内的临时能力开关，例如“网页”和“PPTX”。

页面结构映射：

- `main.shell` / `workspace`：工作台。
- `aside.sidebar`：导航栏。
- `section.chatShell`：会话栏，包含 `chatHeader`、`draftSession`、会话 / 报告 / 运行详情内容和 `composer`。
- `aside.inspector`：运行状态栏。

### `components/agent-console.module.css`

工作台主要样式文件。

覆盖：

- 三栏布局。
- 左侧导航。
- 会话消息。
- 报告页。
- Trace 页面。
- 运行状态栏。
- 会话过程项、运行中状态 badge、扫光动效。
- Run 生命周期弱提示和 thinking 正文流式/渐进展示。
- 设置弹窗。
- workspace picker。
- provider list。

### `components/markdown-content.tsx`

Markdown 渲染组件，当前用于 assistant 消息和报告正文。

### `src/renderer/App.tsx`

前端应用壳，加载 runtime 信息并渲染 `AgentConsole`。

### `src/renderer/main.tsx`

React 应用入口。

## 服务端核心

### `src/server/app.ts`

Express 应用定义。

主要职责：

- CORS 和 JSON body 处理。
- 健康检查。
- runtime 查询。
- workspace 推荐、校验、系统目录选择。
- session title 生成。
- 接线全局 EventBus / RunRegistry / EventMapper。
- Command 通道：启动 run、补充消息（steer）、中断（abort），最多 3 个 active run 并发上限。
- Event 通道：`GET /api/events` SSE 单向下行广播（Last-Event-ID 续传 + 心跳）。
- model provider 测试。
- Tavily 测试。
- 生产模式静态网页托管。

关键 API：

- `GET /health`
- `GET /api/runtime`
- `GET /api/workspaces/roots`
- `GET /api/workspaces/list`
- `POST /api/workspaces/validate`
- `POST /api/workspaces/auto-create`
- `POST /api/workspaces/pick`
- `POST /api/session/title`
- `POST /api/runs`（启动 run，达到上限返回 `AGENT_CONCURRENCY_LIMIT`）
- `GET /api/events`（SSE，query `streamKey` + `lastSeq`）
- `POST /api/runs/:runId/steer`（补充消息入队）
- `POST /api/runs/:runId/abort`（中断）
- `POST /api/model/test`
- `POST /api/tavily/test`
- `POST /api/computer-use/test`

### `src/server/index.ts`

后端启动入口，读取 host/port 并监听服务。

### `src/server/env.ts`

加载环境变量。

## Agent 核心

### `lib/agent.ts`

Agent 主循环。

主要职责：

- 接收外部传入的 runId / sessionId / streamKey / EventBus / drainSteer。
- 构造 system prompt。
- 注入 task state 和 task memory summary。
- 调用模型。
- 解析 assistant text、thinking、tool use。
- 执行工具。
- 同步 task state、task memory、research state。
- 触发 completion guard、final answer repair、unsafe tool-call guard。
- 通过内部 emit 适配层把旧 StreamEvent 映射为 v2 三层事件（Layer2 TraceEvent durable + Layer1 delta live-only）发布到 EventBus，包含三段式 `text.started/delta/completed`、`thinking.started/delta/completed`。
- 循环开头 `drainSteer(runId)` 抽取补充消息注入上下文（Steering）。
- 处理 abort/cancel。

### `lib/events/`

v2 事件驱动架构的核心模块。

- `schema.ts`：三层事件类型（ProviderEvent / TraceEvent / ClientNotification）+ 三段式（textId / thinkingId）+ 共享展示类型（ActivityDisplay / ProcessIconId / ActivityType）+ `DURABLE_EVENT_TYPES`。
- `event-bus.ts`：进程内单例 EventBus。per-streamKey(=sessionId) ring buffer + 单调 seq + 同步回放订阅 + `subscribeAll`。durable 入 buffer 可回放，live-only 仅广播。
- `legacy-map.ts`：旧 `StreamEvent` → v2 事件映射纯函数，供 agent.ts emit 适配层使用。

### `lib/runs/`

运行实例管理与展示投影。

- `run-registry.ts`：运行注册表。runId 在此生成（上移自 agent），维护 steerQueue（steer/drainSteer）、abort（触发 AbortController + 清空队列）、并发计数（activeCount）。
- `event-mapper.ts`：EventMapper。订阅所有 Layer2 TraceEvent 投影为 Layer3 ClientNotification；`tool.started` 异步调 LLM 生成 model display → `activity.display_updated`；`run.completed` 前 await 改写（8s 超时）；`task.state` 签名去重；`research.state` → `research.context.updated`，`thinking.completed` → `thinking.message`。
- `display-fallback.ts`：展示文案 fallback 纯函数（前后端共享，从 components/agent-console.tsx 抽取）。
- `activity-rewrite.ts`：LLM 改写逻辑（prompt / 脱敏 / 解析 / `rewriteActivityDisplay`），供 mapper 使用。

### `lib/tools.ts`

工具注册和执行层。

主要职责：

- 定义工具 schema。
- 执行文件、搜索、终端、网页、research、task memory 工具。
- 注册 `operate_computer`，把 OpenAI computer tool loop 接入 agent 工具调用。
- 限制 workspace 越界。
- 限制危险命令。
- 支持 abort signal。
- 将 Tavily key 和 Computer use OpenAI key 从 settings 或 env 传入工具层。

### `lib/computer-use/`

OpenAI computer-use 运行层。

主要职责：

- `openai-computer-use.ts` 调用 OpenAI Responses API 的 `computer` tool，处理 `computer_call` / `computer_call_output` 循环。
- `macos-adapter.ts` 负责 macOS 屏幕截图、坐标换算、点击、移动、滚动、输入、按键和拖拽。
- 截图和动作日志写入当前 run 的 `.ranni/runs/<runId>/computer-use/`，没有 task memory 时写入 workspace 下 `.ranni/computer-use/`。
- 依赖 macOS Screen Recording 和 Accessibility 权限。

### `lib/task-state.ts`

结构化任务状态。

它记录 agent 当前 goal、deliverable、constraints、success criteria、plan、facts、files touched、commands run、open questions、mode、next action、verification 等。

### `lib/task-memory.ts`

`.ranni` 持久化任务记忆。

每个 run 创建：

```text
.ranni/runs/<runId>/
  state.md
  todo.md
  verification.md
  errors.md
  decisions.md
  assumptions.md
  evidence.md
  source-ledger.md
  claim-ledger.md
  coverage-matrix.md
  synthesis-brief.md
  negative_results.md
  sources/
  checkpoints/
```

### `lib/research.ts`

Research notebook 运行期记录。

用于规划调研问题、记录 finding、审查 research state、保存 research checkpoint。

当前支持 deep research 质量字段：

- coverage dimensions。
- source strategy。
- stop rules。
- evidence source type / date / claim span。
- source mix、coverage gaps、low-confidence findings、open questions 审查。

### `scripts/research-eval.ts`

本地 deep research 评测 CLI。

主要职责：

- 创建本地 EventBus / RunRegistry，订阅 v2 事件并用 `toLegacyEvent` 反向映射回旧 `StreamEvent`，保持既有分析逻辑不变；调用 `runAgentTurn` 跑 research case。
- 输出 `trace.ndjson`、`final.md`、`metrics.json`、`score.md`、`trajectory-analysis.md`、`comparison.md`。
- 读取 `.ranni/runs/<runId>/` 中间文件，分析文件记忆是否被写入和读回。
- 支持 run 对比：`--compare <baseline> <candidate>`。
- 支持最终产物 judge：`--judge-run <run>`、`--judge-pair <a> <b>`、`--judge`。
- 输出 `judge-rubric.json`、`judge-rubric.md`、`claim-audit.md`、`style-judge.json`、`style-judge.md` 和 pairwise judge 文件。

### `scripts/slides-html-pptx-spike.ts`

本地 HTML-to-PPTX spike runner。

主要职责：

- 创建或复用 `ranni-session-html-pptx-spike` session workspace。
- 顺序调用 `init_slide_html_workspace`、`prepare_slide_html_for_pptx`、`export_html_to_pptx`、`validate_html_pptx_export`。
- 生成 8 页受限 slide HTML 示例、局部截图回退资产、HTML 预览、PPTX 预览状态、`measurements.json`、`qa-report.json` 和最终 `.pptx`。

### `lib/trace.ts`

Trace 类型定义。

定义 run、step、model request、model response、tool call、tool result、context snapshot、task state、stream event 等结构。

### `lib/workspace.ts`

Workspace 边界工具。

### `lib/skills/registry.ts`

本地动态 skill 注册表。

主要职责：

- 扫描 `skills/*/SKILL.md` 并解析 `name` / `description` / 正文。
- 提供 system prompt 的轻量 skill 索引和已激活 skill 正文。
- 加载已激活 skill 的 `tools.ts` 专属工具。
- 规范化 `activeSkills`，过滤不存在的 skill。

`resolveWorkspacePath` 保证文件工具只能访问当前 workspace 内的路径。

### `lib/skills/runtime-instructions.ts`

Skill runtime instruction 统一入口。

主要职责：

- 按 `activeSkillNames` 选择需要注入的 runtime instruction builder。
- 读取 `toolSettings` 中对应 skill 的选择项，并委托领域模块生成 prompt 片段。
- 从 `skills/html-design/reference-materials/base-html-design-guide.md` 注入 HTML design 基础 guide。
- 让 `lib/agent.ts` 只调用统一 builder，避免在 agent 主循环内拼接具体 skill 的业务字段。

### `skills/html/tools.ts`

HTML skill 专属工具。

主要职责：

- `init_html_workspace` 初始化静态网页目录，写入 `index.html`、`styles.css`、`assets/`、`preview/` 和生成报告。
- `validate_static_html` 用 Playwright 渲染桌面和移动视口，输出预览截图和 `qa-report.json`。
- 所有工具输入输出通过 workspace resolver 解析。

### `skills/html-to-pptx/tools.ts`

HTML-to-PPTX skill 专属工具。

主要职责：

- `init_slide_html_workspace`、`prepare_slide_html_for_pptx`、`export_html_to_pptx`、`validate_html_pptx_export` 提供 HTML-to-PPTX 路线的工具入口。
- 保留 zod schema、workspace resolver、模板初始化和 `.mjs` 脚本调度。
- 所有工具输入输出通过 workspace resolver 解析。

### `skills/html-to-pptx/scripts/html-pptx/`

HTML-to-PPTX 脚本实现目录。

主要职责：

- 用 Playwright 渲染、测量和截图回退。
- 用 `dom-to-pptx` 导出有限可编辑 PPTX。
- 用 LibreOffice、Poppler、JSZip、pixelmatch 和 pngjs 执行预览、结构检查和客观视觉 smoke check。

### `lib/html-design/catalog.ts`

HTML 设计风格和网页类型 catalog。

主要职责：

- 从 `skills/html-design/styles/*/guide.md` 和 `skills/html-design/patterns/*/guide.md` 加载文件化内容资产。
- 用 schema 校验运行时字段，并把 Markdown 正文转换成 `guidance`。
- 提供后端接口、前端选择卡片、HTML 工具和 runtime instruction prompt 需要的查询函数。
- 忽略 `sources` 人工参考字段，避免外部 URL 进入 API 和默认 agent runtime prompt。
- 在同目录 `reference.md` 存在时，为 runtime prompt 提供本地参考资料路径，参考资料正文不默认注入。
- 加载失败时返回可用文件集合；目录缺失或全部失败时返回空数组。

### `skills/html-design/`

HTML design 文件化内容资产目录。

主要职责：

- `styles/*/guide.md` 保存设计风格，包含 `id`、`name`、`description`、颜色、预览图、标签、正文 guidance 和指向同目录参考资料的 `sources`。
- `styles/*/reference.md` 保存与对应设计风格同目录的本地化参考资料。
- `patterns/*/guide.md` 保存 HTML 页面 pattern，额外包含 `sections`。
- `patterns/*/reference.md` 保存与对应页面 pattern 同目录的本地化参考资料。
- `reference-materials/base-html-design-guide.md` 保存 runtime 注入的产品级基础 guide。
- 文件顺序通过数字前缀表达，首个可用文件作为默认选项。

### `lib/html-to-pptx/sample-decks.ts`

HTML-to-PPTX 内部示例 deck registry。

主要职责：

- 扫描 `skills/html-to-pptx/examples/*/manifest.json`。
- 为本地 spike 脚本和 HTML-to-PPTX 工具提供示例 deck 元信息。
- 用户 PPTX 路径不提供模板选择，agent 根据设计风格和用户内容规划页面结构。

### `skills/html-to-pptx/examples/default-business/`

内部 HTML-to-PPTX spike 示例 deck。

主要职责：

- 提供真实 `deck.html`、`styles.css`、`manifest.json`、`tokens.json`、`guidance.md` 和本地 SVG 资产。
- 覆盖封面、目录、文本、双栏图文、数据表格、复杂图表截图回退、时间线和总结页。
- 遵守 HTML-to-PPTX 设计指南中的画布、排版、留白、低圆角、静态输出和 PPTX 兼容性规则。

### `src/server/app.ts` HTML design API

HTML 设计选项接口。

主要职责：

- `GET /api/html-design/options` 返回设计风格和网页类型模板。
- `POST /api/runs` 接收 `toolSettings.htmlDesign` 和 `toolSettings.htmlToPptx` 并传给 agent。

### `docs/tech/v2-architecture/slides-skill-design/`

HTML-to-PPTX 设计规范目录。

主要职责：

- 保存 HTML-to-PPTX agent 创作时必须遵守的审美、布局、排版和兼容性准则。
- 为 `SKILL.md` 和 HTML-to-PPTX QA 检查提供规则来源。

## 模型 Provider

### `lib/llm/index.ts`

根据 `modelConfig.provider` 或 `LLM_PROVIDER` 选择 provider。

默认 provider 是 `deepseek`。

### `lib/llm/providers/openai-compatible.ts`

OpenAI-compatible 通用 provider。

主要职责：

- 构造 chat completions 请求。
- 解析 text、thinking、tool calls。
- 解析 OpenAI-compatible Chat Completions 流式响应，向 agent 回传 thinking delta。
- 保留 raw tool input 和 JSON parse error。
- 处理 retry。
- 支持 abort。
- 生成 trace request/response。

### `lib/llm/providers/deepseek-openai.ts`

DeepSeek 配置：

- 默认模型 `deepseek-v4-pro`。
- 默认开启 thinking。
- 默认 `reasoning_effort=high`。
- thinking mode 下回传 assistant `reasoning_content`。

### `lib/llm/providers/openai.ts`

OpenAI 官方 API 配置：

- 默认模型 `gpt-5.5`。
- 默认 base URL `https://api.openai.com/v1`。
- 使用 Chat Completions endpoint 接入现有 agent tool-calling loop。
- 使用 `max_completion_tokens` 控制输出上限。
- 环境变量覆盖项为 `OPENAI_MODEL` 和 `OPENAI_BASE_URL`。

### `lib/llm/providers/qwen-openai.ts`

Qwen / DashScope 配置：

- 默认模型 `qwen3.6-plus`。
- 默认 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 默认 context window `1_000_000`。

### `lib/llm/providers/anthropic-compatible.ts`

Anthropic-compatible 通用 provider。

主要职责：

- 构造 Messages API 请求。
- 解析 text、thinking、tool use 和 tool result content blocks。
- 解析 Anthropic-compatible 流式响应，向 agent 回传 thinking delta。
- 处理 retry。
- 支持 abort。
- 生成 trace request/response。

### `lib/llm/providers/minimax-token-plan.ts`

MiniMax Token Plan 配置：

- 默认模型 `MiniMax-M3`。
- 默认 base URL `https://api.minimax.io/anthropic`。
- 默认 context window `1_000_000`。
- 使用 `MINIMAX_TOKEN_PLAN_KEY` 读取 Subscription Key。
- 全球 endpoint 鉴权区域不匹配时尝试 `https://api.minimaxi.com/anthropic`。

### `lib/llm/providers/custom-openai.ts`

自定义 OpenAI-compatible provider。

用户需要提供 base URL、model 和 API key。

## 维护脚本

### `scripts/generate-logo-assets.py`

从根目录 `logo.png` 生成 favicon、apple touch icon、manifest logo 等资产。

运行：

```bash
npm run assets:logo
```
