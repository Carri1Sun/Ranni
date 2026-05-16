import { createOpenAICompatibleProvider } from "./openai-compatible";

export const openAIProvider = createOpenAICompatibleProvider({
  apiKeyEnvNames: ["OPENAI_API_KEY"],
  baseUrlEnvNames: ["OPENAI_BASE_URL"],
  defaultBaseUrl: "https://api.openai.com/v1",
  defaultContextWindow: 1_050_000,
  defaultEnableThinking: false,
  defaultMaxTokens: 4096,
  defaultModel: "gpt-5.5",
  defaultPreserveThinking: false,
  maxTokensRequestKey: "max_completion_tokens",
  missingApiKeyMessage:
    "未配置 OpenAI API Key。请在设置中填入 API Key，或在 .env.local 中设置 OPENAI_API_KEY。",
  modelEnvNames: ["OPENAI_MODEL"],
  providerName: "openai",
  requestFailedPrefix: "OpenAI 请求失败",
  resolveRuntimeOptions: () => ({
    requestExtras: {},
    traceOptions: {
      endpoint: "chat_completions",
    },
  }),
});
