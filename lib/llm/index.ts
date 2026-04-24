import type {
  CreateAgentMessageOptions,
  AgentMessage,
  AgentToolDefinition,
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
} from "./types";

export function hasModelApiKey() {
  return resolveProvider().hasApiKey();
}

export function getModelRuntimeInfo() {
  return resolveProvider().getRuntimeInfo();
}

export function buildMessageRequest({
  messages,
  system,
  tools,
}: {
  messages: AgentMessage[];
  system: string;
  tools: AgentToolDefinition[];
}) {
  return resolveProvider().buildMessageRequest({
    messages,
    system,
    tools,
  });
}

export function createMessage(options: CreateAgentMessageOptions) {
  return resolveProvider().createMessage(options);
}
