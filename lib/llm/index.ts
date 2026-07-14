import type {
  CreateAgentMessageOptions,
  AgentMessage,
  AgentProvider,
  AgentToolDefinition,
  ModelConnectionConfig,
} from "./types";
import { customOpenAIProvider } from "./providers/custom-openai";
import { deepseekOpenAIProvider } from "./providers/deepseek-openai";
import { minimaxTokenPlanProvider } from "./providers/minimax-token-plan";
import { openAIProvider } from "./providers/openai";
import { qwenOpenAIProvider } from "./providers/qwen-openai";
import { chatGPTSubscriptionProvider } from "./providers/chatgpt-subscription";

const DEFAULT_PROVIDER = "deepseek";

const providers = {
  "chatgpt-subscription": chatGPTSubscriptionProvider,
  "chatgpt-subscription-local": chatGPTSubscriptionProvider,
  custom: customOpenAIProvider,
  "custom-openai": customOpenAIProvider,
  "custom-openai-compatible": customOpenAIProvider,
  deepseek: deepseekOpenAIProvider,
  "deepseek-openai": deepseekOpenAIProvider,
  "deepseek-openai-compatible": deepseekOpenAIProvider,
  minimax: minimaxTokenPlanProvider,
  "minimax-token-plan": minimaxTokenPlanProvider,
  "minimax-tokenplan": minimaxTokenPlanProvider,
  openai: openAIProvider,
  "openai-api": openAIProvider,
  "openai-chat-completions": openAIProvider,
  qwen: qwenOpenAIProvider,
  "qwen-openai": qwenOpenAIProvider,
  "qwen-openai-compatible": qwenOpenAIProvider,
} as const;

function resolveProvider(modelConfig?: ModelConnectionConfig): AgentProvider {
  const requested =
    modelConfig?.provider?.trim() || process.env.LLM_PROVIDER?.trim() || DEFAULT_PROVIDER;

  return providers[requested as keyof typeof providers] ?? providers[DEFAULT_PROVIDER];
}

export type {
  AgentAssistantBlock,
  AgentMessage,
  AgentToolDefinition,
  AgentToolUseBlock,
  AgentToolResultBlock,
  ModelCatalog,
  ModelConnectionConfig,
  ModelConnectionTestResult,
  ModelOption,
  ReasoningEffort,
} from "./types";

export function hasModelApiKey(modelConfig?: ModelConnectionConfig) {
  return resolveProvider(modelConfig).hasApiKey(modelConfig);
}

export function getModelRuntimeInfo(modelConfig?: ModelConnectionConfig) {
  return resolveProvider(modelConfig).getRuntimeInfo(modelConfig);
}

export function buildMessageRequest({
  messages,
  modelConfig,
  system,
  tools,
}: {
  messages: AgentMessage[];
  modelConfig?: ModelConnectionConfig;
  system: string;
  tools: AgentToolDefinition[];
}) {
  return resolveProvider(modelConfig).buildMessageRequest({
    messages,
    modelConfig,
    system,
    tools,
  });
}

export function createMessage(options: CreateAgentMessageOptions) {
  return resolveProvider(options.modelConfig).createMessage(options);
}

export function testModelConnection(modelConfig?: ModelConnectionConfig) {
  return resolveProvider(modelConfig).testConnection(modelConfig);
}

export function listProviderModels(modelConfig?: ModelConnectionConfig) {
  const provider = resolveProvider(modelConfig);

  if (!provider.listModels) {
    throw new Error("当前 Provider 不支持动态模型目录。");
  }

  return provider.listModels(modelConfig);
}
