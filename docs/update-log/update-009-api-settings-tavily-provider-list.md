# Update 009: API 设置重构为 Tavily 与 Provider 列表

- Commit: `803f53eba156a57c986a48d4ae110ffb16e1c164`
- Date: `2026-05-04T01:14:48+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版把 API 设置页改成两个 section：Tavily 搜索 Key 和模型 provider 列表。

## 读到的改动

- 设置状态增加 `tavilyApiKey`。
- API 设置页新增 Tavily section，支持 key 配置、清除、测试连接。
- 服务端新增 `/api/tavily/test`。
- `src/server/app.ts` 的 chat 请求 schema 增加 `toolSettings`。
- `runAgentTurn` 和 `executeTool` 开始透传 `toolSettings`。
- `lib/tools.ts` 的 Tavily 搜索优先使用 settings 中的 key，其次读取 `TAVILY_API_KEY`。
- 模型 provider 列表支持展开/收起、选中/非选中。
- 选择 provider 时弹出 toast：`模型 provider 已更新为 xxx`。
- provider 展开后可在同一列表里配置 key、自定义 URL 和模型名。

## 设计理解

搜索 API 和模型 API 属于不同能力，应拆成独立 section。模型 provider 选择不再跳转二级页，而是在列表项内展开配置，减少设置流程的层级。

## 影响范围

- Tavily key 可以通过 UI 本地存储，不必只依赖 `.env.local`。
- Agent 网页搜索能力运行时可以使用用户当前设置。
- Provider 切换反馈更即时。

## 后续注意

设置中的 key 存储在浏览器 localStorage，适合本地个人使用；如果未来支持远端部署，需要重新设计密钥存储边界。

