# Ranni

一个基于 `React + Vite + Node.js` 的本地 AI Agent 网页原型。

当前结构保留前后端分层，但不再依赖 Electron：

- `React + Vite` 负责网页 UI
- `Node.js + Express` 负责 agent API、工具执行和模型调用

## 目录结构

```text
src/renderer/      React 渲染入口
src/server/        Node.js 后端入口
components/        可复用前端组件
lib/               agent / llm / tools / trace 等共享逻辑
```

## 环境变量

先复制模板：

```bash
cp .env.example .env.local
```

至少需要配置：

- `DEEPSEEK_API_KEY` 或 `LLM_API_KEY`

默认模型配置：

- `LLM_PROVIDER=deepseek`
- `LLM_BASE_URL=https://api.deepseek.com`
- `LLM_MODEL=deepseek-v4-pro`

可选项：

- `TAVILY_API_KEY`
- `AGENT_WORKSPACE_ROOT`
- `LLM_PROVIDER`，支持 `deepseek`、`deepseek-openai-compatible`、`qwen-openai-compatible`、`custom-openai-compatible`
- `LLM_CONTEXT_WINDOW`
- `LLM_MAX_TOKENS`
- `LLM_ENABLE_THINKING`
- `LLM_REASONING_EFFORT`，DeepSeek 支持 `high` / `max`
- `BACKEND_PORT`，默认 `3001`
- `BACKEND_HOST`，默认 `127.0.0.1`
- `VITE_API_BASE_URL`，可选；不配置时网页走同源 `/api`，开发期由 Vite 代理到后端

## 本地开发

安装依赖：

```bash
npm install
```

启动 Vite 网页前端和 Node 后端：

```bash
npm run dev
```

默认端口：

- 网页前端：`http://127.0.0.1:5173`
- Node 后端：`http://127.0.0.1:3001`

开发期前端会把 `/api` 和 `/health` 请求代理到 Node 后端。

## 构建与运行

构建：

```bash
npm run build
```

启动构建后的网页服务：

```bash
npm run start
```

生产模式下，Express 会托管 `dist/client` 下的网页静态资源，并继续提供 `/api/*` 接口。

## 当前能力

- 对话式任务执行
- 本地终端命令调用
- 文件读、写、移动、删除
- 工作目录全文搜索
- 网页搜索与页面抓取
- Research notebook 工作流
- 模型 Trace 与工具调用日志展示
- Markdown 助手回复渲染

## 迁移说明

这次改造的重点是：

- 移除了 `Next.js App Router` 和 `app/api/*` 路由
- 保留现有 `lib/agent.ts`、`lib/tools.ts`、`lib/llm/*` 作为共享业务层
- 新增 `/api/runtime` 和 `/api/chat` 由 `Express` 提供
- 前端默认通过同源 `/api` 请求 Node API；开发期由 Vite proxy 转发

## 备注

当前 `npm run dev` 下：

- 后端由独立 `Node.js` 进程运行
- 前端由 Vite 开发服务运行
- `npm run start` 会启动构建后的 Express 网页服务
