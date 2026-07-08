import { createAnthropicCompatibleProvider } from "./anthropic-compatible";

export const minimaxTokenPlanProvider = createAnthropicCompatibleProvider({
  apiKeyEnvNames: ["MINIMAX_TOKEN_PLAN_KEY", "MINIMAX_API_KEY"],
  baseUrlEnvNames: ["MINIMAX_TOKEN_PLAN_BASE_URL", "MINIMAX_BASE_URL"],
  contextWindowEnvNames: ["MINIMAX_TOKEN_PLAN_CONTEXT_WINDOW"],
  defaultBaseUrl: "https://api.minimax.io/anthropic",
  defaultContextWindow: 1_000_000,
  defaultEnableThinking: true,
  defaultMaxTokens: 4096,
  defaultModel: "MiniMax-M3",
  fallbackBaseUrls: ["https://api.minimaxi.com/anthropic"],
  missingApiKeyMessage:
    "未配置 MiniMax Token Plan Subscription Key。请在设置中填入 Key，或在 .env.local 中设置 MINIMAX_TOKEN_PLAN_KEY。",
  maxTokensEnvNames: ["MINIMAX_TOKEN_PLAN_MAX_TOKENS", "LLM_MAX_TOKENS"],
  modelEnvNames: ["MINIMAX_TOKEN_PLAN_MODEL", "MINIMAX_MODEL"],
  providerName: "minimax-token-plan",
  requestFailedPrefix: "MiniMax Token Plan 请求失败",
  resolveRuntimeOptions: (runtime) => ({
    requestExtras: {
      thinking: {
        type: runtime.enableThinking ? "adaptive" : "disabled",
      },
    },
    traceOptions: {
      thinking: runtime.enableThinking ? "adaptive" : "disabled",
      tokenPlan: true,
    },
  }),
});
