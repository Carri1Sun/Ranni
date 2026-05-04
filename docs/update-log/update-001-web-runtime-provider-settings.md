# Update 001: Web Runtime 与 Provider 设置

- Commit: `7f03d00833e5d65e2f813733a4f57de454c52b0f`
- Date: `2026-05-03T18:08:28+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版把 Ranni 从 Electron 外壳切回网页应用形态，并同步引入更通用的模型 provider 配置层。

## 读到的改动

- 删除 `electron/main.ts`、`electron/preload.ts`，移除 Electron 运行脚本和依赖。
- `vite.config.ts` 调整为前端网页构建，生产产物输出到 `dist/client`。
- `src/server/app.ts` 增加静态网页托管逻辑，生产模式下由 Express 同时提供网页和 `/api/*`。
- 前端 API 调用改为优先读取 `VITE_API_BASE_URL`，为空时使用同源 `/api`。
- `lib/llm/providers/openai-compatible.ts` 抽出 OpenAI-compatible 通用 provider。
- 新增 `deepseek-openai`、`custom-openai`，重构 `qwen-openai` 复用通用 provider。
- 默认 provider 改为 DeepSeek，默认模型为 `deepseek-v4-pro`。
- 设置弹窗改成左右两栏结构，包含账号、外观、API 设置、关于。
- 新增浅色主题设计文档 `docs/ranni-light-theme.md`，并扩展 CSS 主题变量。

## 设计理解

这次改动的核心是降低运行复杂度：Ranni 不再依赖桌面壳，而是把本地能力收束到 Express 后端中。前端只关心网页 UI 和流式事件，后端负责模型调用、工具执行、静态资源托管。

模型层同时从单一 provider 变成通用协议层。DeepSeek、Qwen、自定义 URL 都被视作 OpenAI-compatible provider 的不同配置，这为后续增加 provider、测试连接、切换模型提供了统一入口。

## 影响范围

- 本地开发从 Electron 启动方式变为前后端 Web 启动方式。
- UI 设置入口和主题系统有较大变化。
- 模型请求协议集中到 `lib/llm/providers/openai-compatible.ts`。

## 后续注意

如果继续扩展模型 provider，应优先复用 OpenAI-compatible provider，而不是复制一整套请求解析逻辑。

