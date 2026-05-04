# Ranni

Ranni 是一个本地优先的 AI Agent 网页工作台。它用 `React + Vite` 提供前端界面，用 `Node.js + Express` 提供后端 API、模型调用、本地工具执行和静态网页托管。

当前版本不依赖 Electron。开发时前端和后端分别运行；生产构建后由 Express 托管 `dist/client` 并继续提供 `/api/*` 接口。

## 当前能力

- 多 session 对话，历史 session 保存在本机浏览器 localStorage。
- 创建 session 前选择执行目录，agent 的文件、终端、research、`.ranni` 记忆都运行在所选目录内。
- 左侧导航栏包含新建 session、历史 session、会话 / 报告 / 运行详情入口，以及底部设置入口。
- 中间会话栏支持 Markdown 回复、复制、导出 `.md`、导出完整 `trace.txt`，输入框支持 `Enter` 发送、`Shift + Enter` 换行。
- 右侧运行状态栏展示 runtime、tool calls、task state、verification、memory、trace，并支持收起。
- Agent 运行中可手动终止；取消信号会传递到模型请求、工具调用和终端子进程。
- 设置页包含账号、外观、API 设置、关于。API 设置分为 Tavily 搜索 key 和模型 provider 列表。
- 模型 provider 支持 DeepSeek、Qwen、自定义 OpenAI-compatible URL。默认 provider 是 DeepSeek，默认模型是 `deepseek-v4-pro`。
- DeepSeek thinking mode 支持 `reasoning_content` 回传，能维持多步工具调用协议。
- 首条用户消息会异步生成十五字以内 session 名称，不阻塞主对话流程。
- Agent 有文件读写/移动/删除、工作区搜索、终端命令、Tavily 搜索、URL 抓取、research notebook、task memory 等工具。
- 每次 run 会写入 `.ranni/runs/<runId>/` 任务记忆，用于保存 state、todo、verification、evidence、errors、sources、checkpoints。

## 技术结构

```text
components/        React UI 组件，核心是 agent-console
docs/              产品、架构、核心概念和 update log 文档
lib/agent.ts       Agent 主循环、状态同步、guard、trace 事件
lib/llm/           模型 provider 适配层
lib/tools.ts       本地工具、网页工具、task memory 工具
lib/task-state.ts  结构化任务状态
lib/task-memory.ts .ranni 持久化任务记忆
lib/workspace.ts   session workspace 路径边界
src/renderer/      Vite 前端入口
src/server/        Express 后端入口和 API
public/            favicon、logo 和静态资源
scripts/           本地维护脚本
```

## 快速启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3001`

开发期 Vite 会把 `/api` 和 `/health` 代理到 Node 后端。

## 环境变量

默认配置示例：

```dotenv
TAVILY_API_KEY=
AGENT_WORKSPACE_ROOT=.
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
BACKEND_HOST=127.0.0.1
BACKEND_PORT=3001
VITE_API_BASE_URL=
```

常用变量：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `QWEN_API_KEY` | Qwen / DashScope API Key |
| `LLM_API_KEY` | 自定义 OpenAI-compatible provider API Key |
| `LLM_PROVIDER` | `deepseek`、`qwen`、`custom` 等 provider |
| `LLM_BASE_URL` | 自定义模型服务地址 |
| `LLM_MODEL` | 模型名称 |
| `LLM_CONTEXT_WINDOW` | 上下文窗口估计值 |
| `LLM_MAX_TOKENS` | 单次模型输出上限 |
| `LLM_ENABLE_THINKING` | 是否启用 thinking mode |
| `LLM_REASONING_EFFORT` | DeepSeek reasoning effort |
| `LLM_PRESERVE_THINKING` | provider 是否保留 thinking |
| `TAVILY_API_KEY` | 网页搜索能力所需 key |
| `AGENT_WORKSPACE_ROOT` | 未传 session workspace 时的后备工作区 |
| `BACKEND_HOST` | 后端监听地址，默认 `127.0.0.1` |
| `BACKEND_PORT` | 后端端口，默认 `3001` |
| `VITE_API_BASE_URL` | 前端 API 地址；为空时使用同源 `/api` |

也可以在左侧导航栏底部进入设置页配置 provider key 和 Tavily key。浏览器内配置保存在 localStorage，适合本地个人使用。

## 常用脚本

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run start
npm run assets:logo
```

生产模式下，`npm run build` 会生成前端 `dist/client` 和后端构建产物，`npm run start` 由 Express 托管网页并提供 API。

## 后端 API

- `GET /health`：健康检查。
- `GET /api/runtime`：返回运行时信息、模型配置和默认 workspace。
- `GET /api/workspaces/roots`：返回推荐执行目录。
- `GET /api/workspaces/list`：读取目录下的子目录。
- `POST /api/workspaces/validate`：校验目录是否可作为 workspace。
- `POST /api/workspaces/pick`：调用系统文件夹选择器。
- `POST /api/session/title`：根据首条消息异步生成 session 标题。
- `POST /api/chat`：启动一轮 agent 对话，返回 NDJSON 流式事件。
- `POST /api/model/test`：测试当前模型 provider 配置。
- `POST /api/tavily/test`：测试 Tavily 搜索 key。

## 运行产物

- `research/`：旧 research notebook 和本地研究输出目录，已忽略。
- `.ranni/`：每个 workspace 下的 agent durable task memory，已忽略。
- `dist/`：构建产物，已忽略。

需要长期保存的资料应整理到 `docs/` 或其他受版本控制的目录。

## 文档入口

- [项目功能总览](docs/project-overview.md)
- [核心组件与目录地图](docs/component-map.md)
- [运行时架构](docs/runtime-architecture.md)
- [Agent 编排理念](docs/agent-orchestration.md)
- [Harness 核心概念](docs/core-concept/harness.md)
- [Agent 架构文档](docs/agent-arch/agent-arch-optimize.md)
- [Update Log](docs/update-log/README.md)
- [Ranni UI Design System](docs/v1-ranni-design.md)
- [Ranni UI Requirements](docs/v1-ranni-ui-requirements.md)

## Logo 资产

根目录的 `logo.png` 是源图。修改源图后运行：

```bash
npm run assets:logo
```

脚本会生成 favicon、apple touch icon、网页 logo 和 manifest 相关资产到 `public/`。
