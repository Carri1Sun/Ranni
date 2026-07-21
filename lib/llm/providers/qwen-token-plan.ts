import { createOpenAICompatibleProvider } from "./openai-compatible";

export const qwenTokenPlanProvider = createOpenAICompatibleProvider({
  apiKeyEnvNames: ["QWEN_TOKEN_PLAN_KEY"],
  baseUrlEnvNames: ["QWEN_TOKEN_PLAN_BASE_URL"],
  defaultBaseUrl:
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  defaultContextWindow: 262_144,
  defaultEnableThinking: true,
  defaultMaxTokens: 4096,
  defaultModel: "qwen3.7-max",
  defaultPreserveThinking: true,
  missingApiKeyMessage:
    "未配置 Qwen Token Plan Key。请在设置中填入 Key，或在 .env.local 中设置 QWEN_TOKEN_PLAN_KEY。",
  modelEnvNames: ["QWEN_TOKEN_PLAN_MODEL"],
  providerName: "qwen-token-plan",
  requestFailedPrefix: "Qwen Token Plan 请求失败",
  resolveRuntimeOptions: (runtime) => ({
    // qwen3.8-max-preview 只允许 enable_thinking=true，关闭思考时改为省略参数，
    // 让服务端按模型默认值处理，保证连接测试对套餐内所有模型可用。
    requestExtras: runtime.enableThinking
      ? {
          enable_thinking: true,
          preserve_thinking: runtime.preserveThinking,
        }
      : {},
    traceOptions: {
      enableThinking: runtime.enableThinking,
      preserveThinking: runtime.preserveThinking,
      tokenPlan: true,
    },
  }),
});
