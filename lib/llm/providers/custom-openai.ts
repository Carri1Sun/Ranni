import { createOpenAICompatibleProvider } from "./openai-compatible";

export const customOpenAIProvider = createOpenAICompatibleProvider({
  defaultBaseUrl: "https://api.deepseek.com",
  defaultContextWindow: null,
  defaultEnableThinking: false,
  defaultMaxTokens: 4096,
  defaultModel: "deepseek-v4-pro",
  defaultPreserveThinking: false,
  missingApiKeyMessage:
    "未配置自定义 Provider API Key。请在设置中填入 API Key 并测试连接。",
  providerName: "custom-openai-compatible",
  requestFailedPrefix: "自定义 Provider 请求失败",
  resolveRuntimeOptions: () => ({
    requestExtras: {},
    traceOptions: {},
  }),
});
