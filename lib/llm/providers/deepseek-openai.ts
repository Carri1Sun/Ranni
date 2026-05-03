import { createOpenAICompatibleProvider } from "./openai-compatible";

export const deepseekOpenAIProvider = createOpenAICompatibleProvider({
  apiKeyEnvNames: ["DEEPSEEK_API_KEY"],
  defaultBaseUrl: "https://api.deepseek.com",
  defaultContextWindow: 128_000,
  defaultEnableThinking: true,
  defaultMaxTokens: 4096,
  defaultModel: "deepseek-v4-pro",
  defaultPreserveThinking: false,
  defaultReasoningEffort: "high",
  missingApiKeyMessage:
    "未配置 DeepSeek API Key。请在设置中填入 API Key 并测试连接。",
  providerName: "deepseek-openai-compatible",
  replayAssistantThinking: (runtime) => runtime.enableThinking,
  requestFailedPrefix: "DeepSeek 请求失败",
  resolveRuntimeOptions: (runtime) => {
    if (!runtime.enableThinking) {
      return {
        requestExtras: {},
        traceOptions: {
          thinking: "disabled",
        },
      };
    }

    return {
      requestExtras: {
        reasoning_effort: runtime.reasoningEffort,
        thinking: {
          type: "enabled",
        },
      },
      traceOptions: {
        reasoningEffort: runtime.reasoningEffort,
        thinking: "enabled",
      },
    };
  },
});
