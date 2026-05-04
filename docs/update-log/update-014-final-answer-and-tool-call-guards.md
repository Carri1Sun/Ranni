# Update 014: 最终回答与 Tool Call Guard

- Commit: `daec9abe79979bbec81cca0f404f1e0597e35650`
- Date: `2026-05-04T16:47:15+08:00`
- Type: `fix`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版修复模型最终回答为空或截断时的架构问题，并阻止无效、截断的大型 tool call 被直接执行。

## 读到的改动

- `lib/agent.ts` 重写 system prompt，强调 Ranni 是工具型 coding/research agent。
- Prompt 从固定流程转向原则式约束：目标、证据、状态、验证、外部事实、工具积极性、长任务记忆。
- 增加 `MAX_EMPTY_FINAL_REPAIR_ATTEMPTS`，最终回答为空或因 token limit 截断时，追加内部 repair message 要求模型生成可见中文最终回答。
- 增加 `MAX_UNSAFE_TOOL_CALL_REPAIR_ATTEMPTS`，工具参数无效或疑似截断时不执行工具，而是返回内部错误结果并要求模型修复。
- `lib/llm/providers/openai-compatible.ts` 的 JSON 解析保留 `rawInput` 和 `inputParseError`。
- `AgentToolUseBlock` 类型增加 `rawInput`、`inputParseError`。
- tool replay 使用原始参数，避免历史消息丢失。
- `write_file` 内容限制为 12,000 chars，避免模型把长篇咨询回答塞进工具参数导致截断。

## 设计理解

这次修复的关键不是“换一句兜底文案”，而是在 agent loop 中加入守卫。当模型准备结束但没有可见文本时，loop 会要求模型基于已有证据重新生成最终回答；当工具参数不可信时，loop 不执行可能错误的副作用。

## 影响范围

- 减少“任务已完成，但模型没有返回可显示文本”。
- 减少因为大型 `write_file` 参数被 provider 截断而产生的无效工具调用。
- 让 advisory/research 类任务更倾向直接在聊天中回答，而不是滥用文件工具。

## 后续注意

Guard 应该修复可靠性问题，但不应把 agent 变成固定流程机。后续新增 guard 也应遵循“保留模型判断，只修复失败模式”的原则。

