# Component Map

这份文档用于快速定位 Ranni 当前核心目录、核心文件和它们的职责。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `components/` | React UI 组件和 CSS module |
| `src/renderer/` | Vite 前端入口 |
| `src/server/` | Express 后端、API、静态网页托管 |
| `lib/` | Agent loop、工具、模型适配、trace、workspace、task memory |
| `docs/` | 产品、架构、核心概念、update log |
| `public/` | 浏览器可访问静态资源 |
| `scripts/` | 维护脚本，例如 logo 资产生成 |

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
- `/api/chat` NDJSON 流读取。
- run、step、tool、task state trace 的前端合并。
- 手动终止运行。
- assistant 消息复制、导出 markdown、导出 trace。
- 首条消息异步 session 命名。

### `components/agent-console.module.css`

工作台主要样式文件。

覆盖：

- 三栏布局。
- 左侧导航。
- 会话消息。
- 报告页。
- Trace 页面。
- 运行状态栏。
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
- chat NDJSON 流式接口。
- model provider 测试。
- Tavily 测试。
- 生产模式静态网页托管。

关键 API：

- `GET /health`
- `GET /api/runtime`
- `GET /api/workspaces/roots`
- `GET /api/workspaces/list`
- `POST /api/workspaces/validate`
- `POST /api/workspaces/pick`
- `POST /api/session/title`
- `POST /api/chat`
- `POST /api/model/test`
- `POST /api/tavily/test`

### `src/server/index.ts`

后端启动入口，读取 host/port 并监听服务。

### `src/server/env.ts`

加载环境变量。

## Agent 核心

### `lib/agent.ts`

Agent 主循环。

主要职责：

- 创建 run id。
- 构造 system prompt。
- 注入 task state 和 task memory summary。
- 调用模型。
- 解析 assistant text、thinking、tool use。
- 执行工具。
- 同步 task state、task memory、research state。
- 触发 completion guard、final answer repair、unsafe tool-call guard。
- 输出 trace stream events。
- 处理 abort/cancel。

### `lib/tools.ts`

工具注册和执行层。

主要职责：

- 定义工具 schema。
- 执行文件、搜索、终端、网页、research、task memory 工具。
- 限制 workspace 越界。
- 限制危险命令。
- 支持 abort signal。
- 将 Tavily key 从 settings 或 env 传入搜索工具。

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
  negative_results.md
  sources/
  checkpoints/
```

### `lib/research.ts`

Research notebook 运行期记录。

用于规划调研问题、记录 finding、审查 research state、保存 research checkpoint。

### `lib/trace.ts`

Trace 类型定义。

定义 run、step、model request、model response、tool call、tool result、context snapshot、task state、stream event 等结构。

### `lib/workspace.ts`

Workspace 边界工具。

`resolveWorkspacePath` 保证文件工具只能访问当前 workspace 内的路径。

## 模型 Provider

### `lib/llm/index.ts`

根据 `modelConfig.provider` 或 `LLM_PROVIDER` 选择 provider。

默认 provider 是 `deepseek`。

### `lib/llm/providers/openai-compatible.ts`

OpenAI-compatible 通用 provider。

主要职责：

- 构造 chat completions 请求。
- 解析 text、thinking、tool calls。
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

### `lib/llm/providers/qwen-openai.ts`

Qwen / DashScope 配置：

- 默认模型 `qwen3.6-plus`。
- 默认 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 默认 context window `1_000_000`。

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
