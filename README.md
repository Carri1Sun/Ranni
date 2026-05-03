# Ranni

Ranni 是一个本地优先的 AI Agent 网页工作台。它用 `React + Vite` 提供前端界面，用 `Node.js + Express` 提供后端 API、工具执行和模型调用能力。

当前版本已经不依赖 Electron。开发时前端和后端分别运行；生产构建后由 Express 托管静态网页并继续提供 `/api/*` 接口。

## 功能概览

- 多 session 对话，支持历史会话保存到本机浏览器存储。
- 左侧导航栏：新建 session、历史 session、会话 / 报告 / 运行详情页面入口、设置入口。
- 中间会话栏：对话消息流、Markdown 渲染、报告预览、Run Trace 详情；输入框支持 `Enter` 发送、`Shift + Enter` 换行。
- 右侧运行状态栏：展示当前 run、step progress、tool calls、runtime 和 research signals，并支持收起。
- 设置弹窗：账号、外观、API 设置、关于四个分区；API 设置支持 DeepSeek、Qwen 和自定义 OpenAI-compatible URL。
- Agent 工具能力：文件读写/移动/删除、工作区搜索、终端命令、网页搜索、网页内容抓取、research notebook 工作流。
- 模型 Trace：记录模型请求、响应、thinking、工具调用、工具结果、token 和耗时。
- DeepSeek thinking mode：支持 `reasoning_content` 在工具调用链路中的回传，避免多步工具调用时上下文协议断裂。

## 技术结构

```text
components/        React UI 组件
docs/              产品、设计和核心概念文档
lib/agent.ts       Agent 主循环、工具调用和 trace 事件
lib/llm/           模型 provider 适配层
lib/tools.ts       本地工具与网页工具定义
lib/trace.ts       Run / Step / Tool / Model trace 类型
src/renderer/      Vite 前端入口
src/server/        Express 后端入口
public/            favicon、logo 和静态资源
scripts/           本地维护脚本
```

## 环境配置

复制模板：

```bash
cp .env.example .env.local
```

默认 provider 是 DeepSeek：

```dotenv
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
LLM_ENABLE_THINKING=true
LLM_REASONING_EFFORT=high
```

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `QWEN_API_KEY` | Qwen / DashScope API Key |
| `LLM_API_KEY` | 自定义 OpenAI-compatible 服务的 API Key |
| `LLM_PROVIDER` | `deepseek`、`qwen`、`custom` 等 provider |
| `LLM_BASE_URL` | 自定义模型服务地址 |
| `LLM_MODEL` | 模型名称 |
| `LLM_CONTEXT_WINDOW` | 上下文窗口估计值 |
| `LLM_MAX_TOKENS` | 单次模型输出上限 |
| `LLM_ENABLE_THINKING` | 是否启用 thinking mode |
| `LLM_REASONING_EFFORT` | DeepSeek reasoning effort，支持 `high` / `max` |
| `TAVILY_API_KEY` | 网页搜索能力所需 key |
| `AGENT_WORKSPACE_ROOT` | Agent 可操作的工作区根目录，默认 `.` |
| `BACKEND_HOST` | 后端监听地址，默认 `127.0.0.1` |
| `BACKEND_PORT` | 后端端口，默认 `3001` |
| `VITE_API_BASE_URL` | 前端 API 地址；为空时使用同源 `/api` |

也可以在左侧导航栏底部的设置入口中配置 provider key。浏览器内配置会保存在本机 localStorage 中，适合本地开发和个人使用。

## 本地开发

安装依赖：

```bash
npm install
```

启动前端和后端：

```bash
npm run dev
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3001`

开发期 Vite 会把 `/api` 和 `/health` 代理到 Node 后端。

## 构建与运行

类型检查：

```bash
npm run typecheck
```

Lint：

```bash
npm run lint
```

生产构建：

```bash
npm run build
```

启动构建后的服务：

```bash
npm run start
```

生产模式下，Express 会托管 `dist/client` 下的网页静态资源。

## Logo 资产

根目录的 `logo.png` 是源图。修改源图后运行：

```bash
npm run assets:logo
```

脚本会生成圆角 favicon、apple touch icon 和网页 logo 到 `public/`：

```text
public/favicon.ico
public/favicon-16.png
public/favicon-32.png
public/favicon-48.png
public/apple-touch-icon.png
public/logo.png
public/logo-192.png
public/logo-512.png
```

## 后端 API

- `GET /health`：健康检查。
- `GET /api/runtime`：返回运行时信息、模型配置和工作区路径。
- `POST /api/chat`：启动一轮 agent 对话，返回 NDJSON 流式事件。
- `POST /api/model/test`：测试当前 provider 配置是否可用。

## 运行产物

`research/` 是本地研究输出目录，已被 `.gitignore` 忽略。需要保存为正式文档时，应移动到 `docs/` 或其他受版本控制的目录。

## 设计文档

- [Ranni UI Design System](docs/v1-ranni-design.md)
- [Ranni UI Requirements](docs/v1-ranni-ui-requirements.md)
- [Harness 核心概念](docs/core-concept/harness.md)
