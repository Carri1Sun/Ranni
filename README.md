# Ranni

Ranni 是一个本地优先的 AI Agent 网页工作台。它用 `React + Vite` 提供前端界面，用 `Node.js + Express` 提供后端 API、模型调用、本地工具执行和静态网页托管。

当前版本不依赖 Electron。开发时前端和后端分别运行；生产构建后由 Express 托管 `dist/client` 并继续提供 `/api/*` 接口。

## 当前能力

- 多 session 对话，历史 session 保存在本机浏览器 localStorage。
- 点击新建 session 会先进入空白草稿页，发送首条消息时才创建 session。
- 发送首条消息时，Ranni 会在 `~/Documents/Ranni-Workspace/ranni-session-YYYY-MM-DD_HH-mm-ss` 下自动创建一个 session 专属目录作为执行边界；中间文件、运行产物和终端命令默认都在该目录内，同一秒内重复创建会追加数字后缀。
- 左侧导航栏包含新建 session、历史 session 和底部设置入口。
- 中间会话栏包含页面顶部栏、会话 / 报告 / 运行详情、输入区和草稿页状态，支持 Markdown 回复、复制、导出 `.md`、导出 session 级完整 `trace.txt`，输入框支持 `Enter` 发送、`Shift + Enter` 换行。
- 右侧运行状态栏展示 runtime、tool calls、task state、verification、memory、trace、并行任务数量，并支持收起。
- 最多支持 3 个 agent run 并行；达到上限时会提示同时进行的任务数量已达上限。
- Agent 运行中可按 session 手动终止；取消信号会传递到模型请求、工具调用和终端子进程。
- 设置页包含账号、外观、API 设置、Debug、关于。API 设置分为 Tavily 搜索 key 和模型 provider 列表。
- 设置页包含能力设置；输入框内的“网页 / PPTX”开关可在下一次发送时临时启用 `html` 或 `html-to-pptx` skill。
- 模型 provider 支持 DeepSeek、OpenAI、Qwen、MiniMax Token Plan、自定义 OpenAI-compatible URL。默认 provider 是 DeepSeek，默认模型是 `deepseek-v4-pro`。
- DeepSeek thinking mode 支持 `reasoning_content` 回传，能维持多步工具调用协议；agent 会等待 thinking delta 发完后再继续后续过程事件，前端会流式展示 thinking 正文和最终 assistant 回复。
- 首条用户消息会异步生成十五字以内 session 名称，不阻塞主对话流程。
- Agent 有文件读写/移动/删除、工作区搜索、终端命令、macOS 桌面 computer-use、Tavily 搜索、URL 抓取、research notebook、task memory、动态 skill 等工具。当前内置 `html` 和 `html-to-pptx` skill，分别用于静态网页创作，以及通过受限 slide HTML、Playwright、`dom-to-pptx` 和局部截图回退生成有限可编辑 `.pptx`。
- 每次 run 会写入 `.ranni/runs/<runId>/` 任务记忆，用于保存 state、todo、verification、evidence、source/claim/coverage/synthesis ledger、errors、sources、checkpoints。
- `npm run research:eval` 可脚本化运行 deep research case，输出 trace、最终回答、metrics、score、trajectory analysis、rubric judge、claim audit、style judge 和 pairwise judge，用于优化 research agent 行为与用户可见质量。
- 长 research final 支持分段协议：模型可分多段输出，harness 聚合为完整最终回答后再做 quality guard、metrics 和 judge。

## 技术结构

```text
components/        React UI 组件，核心是 agent-console
docs/              产品、架构和核心概念文档
lib/agent.ts       Agent 主循环、状态同步、guard、chunked final、trace 事件
lib/llm/           模型 provider 适配层
lib/tools.ts       本地工具、网页工具、computer-use 工具、task memory 工具
lib/computer-use/  OpenAI computer tool loop 和 macOS 桌面适配器
lib/task-state.ts  结构化任务状态
lib/task-memory.ts .ranni 持久化任务记忆
lib/workspace.ts   session workspace 路径边界
lib/skills/        本地 skill 注册表
lib/html-design/   HTML 设计风格与网页类型 catalog
skills/            本地动态 skill 包，例如 html、html-to-pptx
src/renderer/      Vite 前端入口
src/server/        Express 后端入口和 API
public/            favicon、logo 和静态资源
scripts/           本地维护脚本和 research eval CLI
```

## 快速启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

也可以用封装好的启动脚本，会自动检查依赖、补建 `.env.local` 并按模式启动：

```bash
./scripts/start.sh            # dev（默认）
./scripts/start.sh build      # 生产构建
./scripts/start.sh start      # 生产模式启动（需先 build）
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3001`

开发期 Vite 会把 `/api` 和 `/health` 代理到 Node 后端。

## 环境变量

默认配置示例：

```dotenv
TAVILY_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.5
OPENAI_COMPUTER_API_KEY=
OPENAI_COMPUTER_BASE_URL=https://api.openai.com/v1
OPENAI_COMPUTER_MODEL=gpt-5.5
AGENT_WORKSPACE_ROOT=.
RANNI_DEFAULT_WORKSPACE=
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
LLM_CONTEXT_WINDOW=128000
LLM_MAX_TOKENS=4096
LLM_ENABLE_THINKING=true
LLM_REASONING_EFFORT=high
LLM_PRESERVE_THINKING=false
MINIMAX_TOKEN_PLAN_KEY=
MINIMAX_TOKEN_PLAN_BASE_URL=https://api.minimax.io/anthropic
MINIMAX_TOKEN_PLAN_MODEL=MiniMax-M3
MINIMAX_TOKEN_PLAN_CONTEXT_WINDOW=1000000
MINIMAX_TOKEN_PLAN_MAX_TOKENS=4096
BACKEND_HOST=127.0.0.1
BACKEND_PORT=3001
VITE_API_BASE_URL=
```

常用变量：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `QWEN_API_KEY` | Qwen / DashScope API Key |
| `OPENAI_API_KEY` | OpenAI provider API Key，也可作为 Computer use 的后备 key |
| `OPENAI_BASE_URL` | OpenAI provider 服务地址，默认 `https://api.openai.com/v1` |
| `OPENAI_MODEL` | OpenAI provider 模型，默认 `gpt-5.5` |
| `OPENAI_COMPUTER_API_KEY` | Computer use 模块专用 OpenAI API Key |
| `OPENAI_COMPUTER_BASE_URL` | Computer use 模块服务地址，默认回退到 `OPENAI_BASE_URL` |
| `OPENAI_COMPUTER_MODEL` | Computer use 模块连接测试和后续操作模型，默认 `gpt-5.5` |
| `LLM_API_KEY` | 自定义 OpenAI-compatible provider API Key |
| `LLM_PROVIDER` | `deepseek`、`openai`、`qwen`、`custom` 等 provider |
| `LLM_BASE_URL` | 自定义模型服务地址 |
| `LLM_MODEL` | 模型名称 |
| `LLM_CONTEXT_WINDOW` | 上下文窗口估计值 |
| `LLM_MAX_TOKENS` | 单次模型输出上限 |
| `LLM_ENABLE_THINKING` | 是否启用 thinking mode |
| `LLM_REASONING_EFFORT` | DeepSeek reasoning effort |
| `LLM_PRESERVE_THINKING` | provider 是否保留 thinking |
| `MINIMAX_TOKEN_PLAN_KEY` | MiniMax Token Plan Subscription Key |
| `MINIMAX_TOKEN_PLAN_BASE_URL` | MiniMax Anthropic-compatible Token Plan 地址，默认 `https://api.minimax.io/anthropic` |
| `MINIMAX_TOKEN_PLAN_MODEL` | MiniMax Token Plan 模型，默认 `MiniMax-M3` |
| `MINIMAX_TOKEN_PLAN_CONTEXT_WINDOW` | MiniMax Token Plan 上下文窗口估计值，默认 `1000000` |
| `MINIMAX_TOKEN_PLAN_MAX_TOKENS` | MiniMax Token Plan 单次模型输出上限，默认 `4096` |
| `TAVILY_API_KEY` | 网页搜索能力所需 key |
| `AGENT_WORKSPACE_ROOT` | 低层工具缺少 workspaceRoot 时的后备工作区；产品主路径不依赖它 |
| `RANNI_DEFAULT_WORKSPACE` | 自动创建 session 专属目录的根目录，默认 `~/Documents/Ranni-Workspace` |
| `BACKEND_HOST` | 后端监听地址，默认 `127.0.0.1` |
| `BACKEND_PORT` | 后端端口，默认 `3001` |
| `VITE_API_BASE_URL` | 前端 API 地址；为空时使用同源 `/api` |

也可以在左侧导航栏底部进入设置页配置 provider key、Tavily key 和 Computer use OpenAI key。浏览器内配置保存在 localStorage，适合本地个人使用。

Computer use 走 OpenAI Responses API 的 `computer` tool，并由本机 Node 后端通过 macOS Screen Recording 和 Accessibility 权限截图、点击、滚动和输入。首次使用前需要在系统设置中允许运行 Ranni 的终端或 Node 进程进行屏幕录制和辅助功能控制。

## 常用脚本

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run start
npm run assets:logo
npm run slides:html-spike
npm run research:eval -- --case agent-eval-landscape --label baseline
npm run research:eval -- --suite high --label improved-v1 --repeats 3
npm run research:eval -- --reanalyze v4-citation-guard-context
npm run research:eval -- --judge-run v5-model-recovery-rag
npm run research:eval -- --judge-pair v3-generalization-context v4-citation-guard-context
```

`slides:html-spike` 会从内置 prompt 生成受限 slide HTML，执行 Playwright 截图回退、`dom-to-pptx` 导出、PPTX XML 检查和 PPTX 逐页预览渲染；也可以通过 `-- --prompt "..."` 传入自定义 prompt。

生产模式下，`npm run build` 会生成前端 `dist/client` 和后端构建产物，`npm run start` 由 Express 托管网页并提供 API。

`research:eval` 读取 `.env` / `.env.local` 中的模型和 Tavily 配置，运行产物写入已忽略的 `research/research-eval/`。每次 run 会增量写入 `trace.ndjson` 和 `partial-status.md`，`--timeout-ms` 可控制单次墙钟预算，`--reanalyze` 可在 analyzer 或 scoring 变更后重算历史 run。长 final synthesis 可通过分段协议聚合成完整 `final.md`，避免长程 research 把所有内容挤进一次模型输出。`--judge-run` 会调用模型对最终产物做 rubric、claim audit 和 style 质量评审；`--judge-pair` 会做 blind pairwise 偏好评审；这两类 judge 不需要 Tavily。缺少模型 key 或 research run 所需的 `TAVILY_API_KEY` 时会直接失败，不生成伪结果。

质量评审分三层：

- Trajectory analyzer：看 search/fetch/evidence/memory/guard 行为，用于归因。
- Rubric / claim audit judge：只看最终回答，评估覆盖、时效、来源质量、引用对齐、证据纪律、综合深度和产品价值。
- Style judge：只看最终回答，评估 first-screen value、authorial voice、narrative flow、format taste、reader guidance 和 AI flavor risk。

## 后端 API

- `GET /health`：健康检查。
- `GET /api/runtime`：返回运行时信息、模型配置和默认 session 根目录。
- `GET /api/skills`：返回本地动态 skill 索引。
- `GET /api/workspaces/roots`：返回默认 session 根目录和本机目录候选，保留给调试/扩展入口。
- `GET /api/workspaces/list`：读取目录下的子目录。
- `POST /api/workspaces/validate`：校验目录是否可作为 workspace。
- `POST /api/workspaces/pick`：调用系统文件夹选择器。
- `POST /api/session/title`：根据首条消息异步生成 session 标题。
- `POST /api/runs`：Command 通道，启动一轮 agent run（后台异步执行），必须携带自动创建的 session 专属 `workspaceRoot`；服务端要求该目录位于默认 session 根目录下且名称为 `ranni-session-*`，立即返回 `runId`；并行 run 达到上限时返回 `429` 和 `AGENT_CONCURRENCY_LIMIT`。
- `GET /api/events`：Event 通道，SSE 单向下行广播三层事件（`streamKey`=session、`lastSeq` 续传）。
- `POST /api/runs/:runId/steer`：向运行中的 run 投递补充消息（Steering）。
- `POST /api/runs/:runId/abort`：中断运行中的 run。
- `POST /api/model/test`：测试当前模型 provider 配置。
- `POST /api/tavily/test`：测试 Tavily 搜索 key。
- `POST /api/computer-use/test`：测试 Computer use 模块的 OpenAI key 和 `computer` tool 可用性。

## 运行产物

- `research/`：旧 research notebook 和本地研究输出目录，已忽略。
- `research/research-eval/`：deep research 实验输出，包含 trace、final、metrics、score、trajectory analysis、judge rubric、claim audit、style judge、pairwise judge 和 comparison，已忽略。
- `.ranni/`：每个 session 专属目录下的 agent durable task memory 和本地运行产物，例如 slides deck 产物目录，已忽略。
- `dist/`：构建产物，已忽略。

需要长期保存的资料应整理到 `docs/` 或其他受版本控制的目录。

## 文档入口

- [项目功能总览](docs/project-overview.md)
- [核心组件与目录地图](docs/component-map.md)
- [运行时架构](docs/runtime-architecture.md)
- [Agent 编排理念](docs/agent-orchestration.md)
- [Harness 核心概念](docs/core-concept/harness.md)
- [Agent 架构文档](docs/agent-arch/agent-arch-optimize.md)
- [Ranni UI Design System](docs/v1-ranni-design.md)
- [Ranni UI Requirements](docs/v1-ranni-ui-requirements.md)

## Logo 资产

根目录的 `logo.png` 是源图。修改源图后运行：

```bash
npm run assets:logo
```

脚本会生成 favicon、apple touch icon、网页 logo 和 manifest 相关资产到 `public/`。
