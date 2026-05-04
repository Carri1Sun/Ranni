# Update 002: 导航栏与运行状态栏调整

- Commit: `fa4e50d62e69b8b2234c02e22b101a3d17304957`
- Date: `2026-05-03T18:34:02+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版重新定义三栏布局：左侧是导航栏，中间是会话栏，右侧是运行状态栏，并补齐右侧栏收起能力。

## 读到的改动

- `components/agent-console.tsx` 增加 `PAGE_NAV_ITEMS`，把会话、报告、运行详情放入左侧导航。
- 设置入口移动到左侧栏底部。
- 移除左侧底部原有模型、API 状态、workspace 状态展示。
- 会话输入框支持 `Enter` 发送，`Shift + Enter` 换行。
- 右侧运行状态栏增加收起状态，并使用 `next-agent:inspector-collapsed` 持久化。
- `components/agent-console.module.css` 配套调整侧栏、导航按钮、右侧栏收起态和响应式布局。

## 设计理解

这次改动把页面结构从“聊天 + 附属面板”转成更清晰的工作台结构。左侧承担 session 和页面导航，中间承担主要交互，右侧承担运行可观测性。

设置入口放在左侧底部后，设置被视为全局导航能力，而不是某个对话页的局部动作。

## 影响范围

- 用户对页面区域的心智模型更稳定。
- 右侧 trace/status 面板可以按需隐藏，为长会话留出空间。
- 输入体验接近常见聊天工具。

## 后续注意

后续增加页面级功能时，应优先接入左侧导航栏，而不是继续往会话头部堆按钮。

