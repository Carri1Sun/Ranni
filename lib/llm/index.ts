import type {
  CreateAgentMessageOptions,
  AgentMessage,
  AgentToolDefinition,
  ModelConnectionConfig,
} from "./types";
import { customOpenAIProvider } from "./providers/custom-openai";
import { deepseekOpenAIProvider } from "./providers/deepseek-openai";
import { qwenOpenAIProvider } from "./providers/qwen-openai";

const DEFAULT_PROVIDER = "deepseek";

const providers = {
  custom: customOpenAIProvider,
  "custom-openai": customOpenAIProvider,
  "custom-openai-compatible": customOpenAIProvider,
  deepseek: deepseekOpenAIProvider,
  "deepseek-openai": deepseekOpenAIProvider,
  "deepseek-openai-compatible": deepseekOpenAIProvider,
  qwen: qwenOpenAIProvider,
  "qwen-openai": qwenOpenAIProvider,
  "qwen-openai-compatible": qwenOpenAIProvider,
} as const;

function resolveProvider(modelConfig?: ModelConnectionConfig) {
  const requested =
    modelConfig?.provider?.trim() || process.env.LLM_PROVIDER?.trim() || DEFAULT_PROVIDER;

  return providers[requested as keyof typeof providers] ?? providers[DEFAULT_PROVIDER];
}

export type {
  AgentAssistantBlock,
  AgentMessage,
  AgentToolDefinition,
  AgentToolResultBlock,
  ModelConnectionConfig,
  ModelConnectionTestResult,
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
