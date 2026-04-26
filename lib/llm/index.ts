import type {
  CreateAgentMessageOptions,
  AgentMessage,
  AgentToolDefinition,
  ModelConnectionConfig,
} from "./types";
import { qwenOpenAIProvider } from "./providers/qwen-openai";

const DEFAULT_PROVIDER = "qwen-openai";

const providers = {
  "qwen-openai": qwenOpenAIProvider,
  "qwen-openai-compatible": qwenOpenAIProvider,
} as const;

function resolveProvider() {
  const requested = process.env.LLM_PROVIDER?.trim() || DEFAULT_PROVIDER;

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
  return resolveProvider().hasApiKey(modelConfig);
}

export function getModelRuntimeInfo(modelConfig?: ModelConnectionConfig) {
  return resolveProvider().getRuntimeInfo(modelConfig);
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
  return resolveProvider().buildMessageRequest({
    messages,
    modelConfig,
    system,
    tools,
  });
}

export function createMessage(options: CreateAgentMessageOptions) {
  return resolveProvider().createMessage(options);
}

export function testModelConnection(modelConfig?: ModelConnectionConfig) {
  return resolveProvider().testConnection(modelConfig);
}
