# Update 003: DeepSeek Thinking 回传修复

- Commit: `dbe787a639ecd2bc8c0ee415f542eb4b7257b7ad`
- Date: `2026-05-03T18:34:10+08:00`
- Type: `fix`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版修复 DeepSeek thinking mode 下多轮工具调用报错：`reasoning_content in the thinking mode must be passed back to the API`。

## 读到的改动

- `lib/llm/providers/openai-compatible.ts` 的 assistant 历史消息保留 thinking block。
- 请求历史中 assistant message 可以携带 `reasoning_content`。
- 增加 `joinThinkingContent` 聚合 thinking 内容。
- Provider 配置增加 `replayAssistantThinking` 选项。
- `deepseek-openai.ts` 在 thinking mode 开启时启用 thinking replay。

## 设计理解

DeepSeek 的 thinking mode 不是只把 reasoning 内容返回给客户端展示。只要后续继续把该 assistant 消息放回上下文，API 就要求把对应的 `reasoning_content` 一并传回。

如果 Ranni 丢弃 thinking，只保留 tool call 或 visible text，DeepSeek 会认为上下文中的 assistant message 不完整，于是拒绝后续请求。

## 影响范围

- DeepSeek 多步工具调用链路恢复稳定。
- Trace 中模型请求能看到 reasoning 相关字段。
- 其他 provider 不必强制回传 thinking，仍由 provider 配置决定。

## 后续注意

对带 reasoning/thinking 协议的模型，不能把 thinking 当成纯 UI 展示数据。它可能是 provider 上下文协议的一部分。

