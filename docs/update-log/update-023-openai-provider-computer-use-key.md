# Update 023: OpenAI Provider 与 Computer Use Key

## 改动内容

这一版为 Ranni 增加 OpenAI 官方 API provider，并在 API 设置中加入 Computer use OpenAI API Key 配置。

- `lib/llm/providers/openai.ts` 新增 OpenAI provider，默认模型 `gpt-5.5`，默认 base URL `https://api.openai.com/v1`。
- `lib/llm/index.ts` 注册 `openai`、`openai-api`、`openai-chat-completions`。
- `lib/llm/providers/openai-compatible.ts` 支持 provider 选择 `max_tokens` 或 `max_completion_tokens` 请求字段。
- OpenAI provider 使用 `OPENAI_BASE_URL` / `OPENAI_MODEL` 作为环境变量覆盖项，避免误用其他 provider 的 `LLM_*` 示例值。
- `lib/tools.ts` 新增 Computer use OpenAI key 读取和 Responses API 连接测试。
- `src/server/app.ts` 新增 `/api/computer-use/test`。
- `components/agent-console.tsx` 在 provider 列表加入 OpenAI，并在 API 设置页加入 Computer use key 配置。
- 前端直配时，Computer use 未单独填写 key 会复用 OpenAI provider key；Computer use 测试模型跟随 OpenAI provider 模型配置。

## 设计理解

主 agent loop 仍然使用现有 Chat Completions tool-calling 协议，避免一次性重写 `lib/agent.ts` 的上下文、trace 和 tool result 序列化。

Computer use 先只接入独立 OpenAI key 配置与连接测试。后续真正执行 computer-use loop 时，应走 OpenAI Responses API，并保持它和主模型 provider 分离。

## 影响范围

- 用户可以选择 OpenAI 作为主模型 provider。
- 用户可以单独配置 Computer use OpenAI key，也可以复用 OpenAI provider key。
- 默认 DeepSeek 行为不变。

## 后续注意点

- 真正启用 computer-use 工具前，需要实现隔离浏览器或 VM 执行层。
- Computer use 操作应默认受 allowlist、用户确认和截图 trace 约束。
