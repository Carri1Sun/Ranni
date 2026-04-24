# Ranni

一个基于 `Electron + React + Node.js` 的本地 AI Agent 原型。

当前结构已经从原来的 `Next.js` 单体前后端，拆成了两个明确层次：

- `Electron` 负责桌面窗口、主进程和 preload 桥接
- `React + Vite` 负责渲染层 UI
- `Node.js + Express` 负责 agent API、工具执行和模型调用

## 目录结构

```text
electron/          Electron 主进程与 preload
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

- `LLM_API_KEY`
- `LLM_BASE_URL`
- `LLM_MODEL`

可选项：

- `TAVILY_API_KEY`
- `AGENT_WORKSPACE_ROOT`
- `BACKEND_PORT`，默认 `3001`

## 本地开发

安装依赖：

```bash
npm install
```

启动 Electron 前端、Vite 渲染层、Node 后端和 TypeScript watch：

```bash
npm run dev
```

默认端口：

- 渲染层开发服务：`http://127.0.0.1:5173`
- Node 后端：`http://127.0.0.1:3001`

## 构建与运行

构建：

```bash
npm run build
```

启动构建后的桌面应用：

```bash
npm run start
```

生产模式下，Electron 会自动拉起打包后的本地 Node 后端。

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
- 前端通过 Electron preload 获取后端地址，再请求 Node API

## 备注

当前 `npm run dev` 下：

- 后端由独立 `Node.js` 进程运行
- Electron 通过环境变量连接独立后端
- `npm run start` 才会使用 Electron 主进程托管后端生命周期
# Ranni
