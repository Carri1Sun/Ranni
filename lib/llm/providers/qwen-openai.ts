import { createOpenAICompatibleProvider } from "./openai-compatible";

export const qwenOpenAIProvider = createOpenAICompatibleProvider({
  apiKeyEnvNames: ["QWEN_API_KEY"],
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  defaultContextWindow: 1_000_000,
  defaultEnableThinking: true,
  defaultMaxTokens: 4096,
  defaultModel: "qwen3.6-plus",
  defaultPreserveThinking: true,
  missingApiKeyMessage: "未配置 Qwen API Key。请在设置中填入 API Key 并测试连接。",
  providerName: "qwen-openai-compatible",
  requestFailedPrefix: "Qwen 请求失败",
  resolveRuntimeOptions: (runtime) => ({
    requestExtras: {
      enable_thinking: runtime.enableThinking,
      preserve_thinking: runtime.preserveThinking,
    },
    traceOptions: {
      enableThinking: runtime.enableThinking,
      preserveThinking: runtime.preserveThinking,
    },
  }),
});
