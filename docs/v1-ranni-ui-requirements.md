# Ranni UI Refactor Requirements v1.0

## 1. Goal

把现有 Ranni 前端从当前偏 neo-brutal / demo console 的视觉，改造成一个成熟的本地 AI Agent 桌面工作台。

目标风格参考 `design.md`：**Moonlit Editorial Workbench**。最终效果应接近一个能长期使用的本地研究型 agent：左侧会话与工作区，中间执行与报告，右侧 trace / sources / runtime inspector。

本次改造只做前端与信息架构，不重写后端，不改变 agent 业务能力。

## 2. Current Repo Constraints

项目结构是：

- `electron/`：Electron 主进程与 preload。
- `src/renderer/`：React + Vite 渲染层入口。
- `src/server/`：Node.js + Express 后端入口。
- `components/`：前端可复用组件。
- `lib/`：agent / llm / tools / trace 等共享逻辑。

当前渲染入口：

- `src/renderer/App.tsx` 负责连接本地后端 `/api/runtime`。
- runtime ready 后渲染 `components/agent-console.tsx`。
- `components/agent-console.tsx` 当前承载会话、消息、stream events、trace runs、tool calls、tool results、localStorage persistence。
- `components/markdown-content.tsx` 负责 Markdown 渲染。

重要约束：

1. 保留 Electron + React + Vite + CSS Modules 架构。
2. 不引入 Tailwind，不引入大型 UI component library。
3. 不新增远程字体依赖；默认使用系统字体栈。
4. 不改 `/api/runtime` 和 `/api/chat` 的后端协议。
5. 不破坏现有 session localStorage、streaming、trace event 处理。
6. 不使用任何 Elden Ring 角色图像、游戏资产或疑似侵权素材。

## 3. Desired UX Structure

### 3.1 App Shell

实现一个三栏桌面工作台：

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Sidebar        │ Main Workspace                         │ Inspector     │
│                │                                        │               │
│ Ranni brand    │ Top task/runtime bar                   │ Current run   │
│ Sessions       │ Chat / Report / Trace tabs             │ Steps         │
│ Starter tasks  │ Assistant output / report canvas       │ Tool calls    │
│ Local status   │ Composer                               │ Runtime stats │
└─────────────────────────────────────────────────────────────────────────┘
```

默认布局：

- 左栏：264px。
- 右栏：340–380px。
- 中栏：自适应，占据剩余空间。
- 整体高度：100vh，不出现 body 级横向滚动。

### 3.2 Sidebar

Sidebar 应从“会话列表”升级为“本地 agent 档案馆”。

必须包含：

- Ranni brand：月牙抽象 logo、`Ranni`、`Local AI Agent`。
- New Session / New Task 按钮。
- Sessions 列表：标题、更新时间、active 状态。
- Starter prompts：保留现有 starter prompt，但做成更精致的小卡或按钮。
- Local status card：显示 API key、模型名、workspace root 简写。
- Collapse button：保留现有 sidebar collapse 行为。

建议 nav 项：

- Console
- Research
- Files
- Browser
- Reports
- Settings

如果当前功能尚未实现完整页面，nav 可以暂时只是视觉入口，不要做不可用的大量假页面。未实现项可 disabled 或显示 `Coming soon`。

### 3.3 Main Workspace

Main workspace 至少支持现有两个 view：`chat` 和 `trace`。建议增加第三个 view：`report`。

#### Chat view

- 保留现有消息流。
- 用户消息靠右或以紧凑 command block 展示。
- Assistant 长文本不要做普通小气泡，应渲染为 document card。
- Tool activity 不要挤在正文里，应作为 compact activity row 或交给右侧 Inspector。

#### Report view

从最近一条 assistant Markdown 中提取内容，显示为报告预览。

报告视图需要：

- 大标题。
- 正文良好排版。
- 引用链接清晰。
- 表格、代码、列表可读。
- 底部保留 composer，允许用户继续要求 Ranni 修改、扩写、核查。

如果最近没有可用报告：显示 empty state，例如：

`No report yet. Ask Ranni to research a topic and draft a structured report.`

#### Trace view

Trace view 可继续存在，但建议弱化成 Inspector 主导。主区域 trace 可展示：

- 当前 run timeline。
- 每个 step 的 thinking/status/tool summary。
- selected step detail。

### 3.4 Right Inspector

右栏是这次改造的关键。它用于建立用户对本地 agent 的信任。

必须包含：

1. **Current Run**
   - status: running / completed / failed
   - startedAt / duration
   - totalSteps / completedSteps

2. **Step Progress**
   - stepIndex
   - status messages
   - 当前 step 高亮

3. **Tool Calls**
   - tool name
   - startedAt / duration
   - success / failed
   - arguments summary
   - result summary
   - 可展开 payload

4. **Runtime**
   - provider
   - model
   - maxTokens
   - contextWindow
   - token / context occupancy if available

5. **Research Signals**
   - 如果 step 有 `researchState`，展示为状态卡。
   - 如果 tool 是 `search_web` 或 `fetch_url`，默认折叠，只展示标题/域名/摘要。

### 3.5 Composer

Composer 固定在主区域底部。

必须保留：

- 输入框。
- submit。
- disabled/loading 状态。
- Enter / Shift+Enter 行为，如果当前已有则不破坏。

建议增加：

- placeholder：`Ask Ranni to inspect files, browse, research, or write...`
- 右侧 submit button 使用月光蓝 primary。
- loading 时显示 `Ranni is working...`。

## 4. Implementation Plan

### Phase 1: Replace Global Design Tokens

修改 `src/renderer/globals.css`：

- 移除当前 bright / neo-brutal tokens。
- 引入 `design.md` 中的 Ranni tokens。
- 设置 `body` 深色月夜背景。
- 设置全局字体。
- 设置 selection、focus、scrollbar。
- 保留 `.app-shell` 和 `.splash-card`，但改成 Ranni 风格。

Loading / error splash 的目标：

- 不再显示 `Electron Frontend` 这种工程化标签作为主标题。
- loading 文案改为：`正在连接 Ranni 本地运行时`。
- error 文案保持清楚，但视觉上使用暗色 panel。

### Phase 2: Re-skin AgentConsole CSS

优先改 `components/agent-console.module.css`。

要求：

- 使用 CSS variables，不要硬编码大量颜色。
- 建立三栏 grid。
- 所有 panel 使用统一 border/radius/shadow。
- 清理旧的粗边框、硬阴影、过高饱和背景。
- 给 active / hover / focus / disabled 状态补齐视觉。

不要在第一版过度拆 TSX。先通过 CSS 和少量结构调整完成主要视觉升级。

### Phase 3: Improve Information Architecture

在 `components/agent-console.tsx` 内部做最小必要结构调整。

建议拆出以下内部组件或新文件：

- `RanniSidebar`
- `RanniTopBar`
- `ViewSwitcher`
- `ChatFeed`
- `ReportPreview`
- `TraceInspector`
- `ToolCallCard`
- `Composer`

如果 coding agent 认为拆分风险较大，可以先保留单文件，但 className 结构必须清晰。

### Phase 4: Report Preview

实现 `report` view。

最小实现：

- 找到当前 session 中最近一条 assistant message。
- 如果该 message 长度 > 600 或含 Markdown heading/list/table/link，则作为 report candidate。
- 使用 `MarkdownContent` 渲染在 report canvas 中。
- 保留“复制报告 / 导出 Markdown”按钮。如果现有导出能力没有实现，先只做 copy。

可选实现：

- 从 assistant markdown 中解析 H1 / H2，生成右侧 Outline。
- 从链接中提取 source list。

### Phase 5: Markdown Styling

修改 `components/markdown-content.module.css`。

要求：

- 报告正文不再像普通聊天内容。
- H1/H2 使用 serif。
- 表格、引用、代码块、链接统一美化。
- 代码块可横向滚动。
- list spacing 更舒适。

### Phase 6: Inspector and Trace

利用现有 `runs`, `steps`, `toolCalls`, `toolResults`, `runtimeInfo` 数据。

实现：

- 右侧固定 inspector。
- selected run / selected step 可视化。
- tool result 默认折叠。
- payload 使用 `<details>` 或按钮展开。
- 搜索和 fetch 结果只展示 summary，避免巨型 payload 撑爆布局。

## 5. Data Mapping Guide

### Session

使用现有 `SessionRecord`：

- `title` -> session title。
- `updatedAt` -> session time。
- `messages` -> chat feed / report candidate。
- `runs` -> inspector / trace。
- `feed` -> activity feed。
- `researchContext` -> optional context note。

### Run

使用现有 `TraceRun`：

- `status` -> status chip。
- `prompt` -> run title / task brief。
- `startedAt`, `endedAt`, `durationMs` -> runtime metadata。
- `steps`, `totalSteps` -> progress。
- `runtime` -> model card。

### Step

使用现有 `TraceStep`：

- `status` -> step state。
- `stepIndex` -> step number。
- `thinking` -> collapsible thinking section。
- `statusMessages` -> timeline。
- `toolCalls` / `toolResults` -> tool cards。
- `assistantText` -> assistant step output。
- `researchState` -> research state card。

## 6. Visual Acceptance Criteria

完成后应满足：

1. 整体默认是深色月夜工作台，不再是明亮 neo-brutal 页面。
2. 左侧有明确 Ranni brand 和本地 agent 状态。
3. 中间区域能清楚完成聊天、报告预览、trace 查看。
4. 右侧能审计 agent 当前运行过程。
5. Markdown 报告有明显编辑部 / 研究报告质感。
6. 工具调用结果不会把界面撑乱。
7. 所有按钮、输入框、可展开区域都有 hover/focus/disabled 状态。
8. `npm run typecheck` 通过。
9. `npm run lint` 不出现新增严重问题。
10. `npm run dev` 下 Electron app 能正常连接本地后端并运行原有对话功能。

## 7. Non-goals

本次不要做：

- 不重写 agent loop。
- 不改 LLM 调用逻辑。
- 不改工具执行逻辑。
- 不做完整文件管理器。
- 不做真实浏览器嵌入窗口，除非现有项目已经有。
- 不引入三维、复杂 canvas、粒子系统。
- 不把 UI 做成游戏 HUD。

## 8. Suggested File Changes

优先级从高到低：

1. `src/renderer/globals.css`
   - 替换全局设计 token。
   - 改 body 背景、字体、scrollbar、focus。
   - 改 loading/error splash。

2. `components/agent-console.module.css`
   - 主体视觉升级。
   - 三栏 grid。
   - sidebar / main / inspector / composer / cards。

3. `components/agent-console.tsx`
   - 小幅调整 layout。
   - 增加 report view。
   - 增加 inspector 信息块。
   - 尽量不碰 stream 逻辑。

4. `components/markdown-content.module.css`
   - 报告排版升级。

5. `components/markdown-content.tsx`
   - 如有必要，为 links / tables / code 增加更稳定的 renderer。

## 9. Concrete UI Copy

建议替换部分工程化文案：

- `Electron Frontend` -> `Ranni Local Workbench`
- `正在连接本地 Node.js 后端` -> `正在连接 Ranni 本地运行时`
- `后端未启动或未准备好` -> `Ranni 本地运行时尚未准备好`
- `新会话` -> `New Research Thread` 或 `新研究会话`
- `我已经具备终端、文件系统和网页搜索工具...` -> `我可以读取文件、搜索网页、调用工具并整理研究报告。给我一个主题，或让我先检查当前工作区。`

保留中文为主的产品文案，但品牌词可以英文。

## 10. QA Checklist

手动检查：

- 启动时 loading 页面是否美观。
- 后端未启动时 error 页面是否清楚。
- 新建 session 是否正常。
- 发送 prompt 是否正常。
- streaming 时界面不抖动。
- 工具调用多时右侧 inspector 不撑爆。
- 搜索结果 / fetch payload 可折叠。
- Markdown 长报告可读。
- 小窗口下 sidebar / inspector 不遮挡 composer。
- 复制 / 导出按钮如果未实现，不要显示成可用状态。

## 11. Final Instruction to Coding Agent

请把这次改造视为一次“前端产品化重构”，不是单纯换颜色。优先保证原有功能不坏，再提升布局、报告阅读和 trace 可审计性。所有新增视觉语言都应服从可读性和本地 agent 的可信感。
