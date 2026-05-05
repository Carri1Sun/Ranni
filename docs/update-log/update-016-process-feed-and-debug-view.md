# Update 016: 会话过程展示与 Debug 详情

## 改动内容

- 将会话中的中间过程从原始 label + JSON 展示改为语义化过程项。
- 过程项覆盖 run 生命周期、step、task state、status、tool call、tool result、research state 和 error。
- 工具调用先使用前端本地规则即时生成标题、说明、图标和 meta，再通过 `/api/activity/describe` 请求当前模型异步改写。
- 设置中新增 Debug section，包含「会话过程展示具体内容」开关。
- Debug 开启后，每条过程项显示 info 按钮，可查看该项对应的 run、step、tool call、tool result 和当前 agent loop trace。
- 运行中的最新过程项显示扫光动效；左侧 session 列表和顶部状态显示运行态。

## 设计理解

过程展示面向阅读，trace 面向排障。默认视图应解释 agent 正在做什么，而不是暴露工具参数结构。完整信息仍保留在 trace 中，由 Debug 浮窗按过程项关联展示，避免用户在普通阅读路径中被长 JSON、长结果和模型 thinking 淹没。

过程项的主要类型：

- `step`：run 和 step 生命周期。
- `state`：结构化任务状态变化。
- `status`：运行提示、重试、thinking 摘要。
- `tool_call`：工具调用意图。
- `tool_result`：工具结果和耗时。
- `research`：研究笔记状态。
- `error`：失败信息。

## 影响范围

- 前端核心组件：`components/agent-console.tsx`。
- 工作台样式：`components/agent-console.module.css`。
- 服务端 API：`src/server/app.ts`。
- 依赖：新增 `lucide-react`。
- 文档：更新 project overview 和 component map。

## 后续注意

- `/api/activity/describe` 只做 UI 文案改写，不参与 agent 决策。
- 改写请求会对事件 payload 做长度压缩和常见密钥字段脱敏。
- 如果模型改写失败，前端会保留本地规则生成的 fallback 文案。
