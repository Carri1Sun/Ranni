import type {
  TraceModelRequest,
  TraceModelResponse,
  TraceRuntimeInfo,
} from "../trace";

export type AgentToolDefinition = {
  description?: string;
  input_schema?: unknown;
  name: string;
};

export type AgentTextBlock = {
  text: string;
  type: "text";
};

export type AgentThinkingBlock = {
  thinking: string;
  type: "thinking";
};

export type AgentToolUseBlock = {
  id: string;
  input: unknown;
  name: string;
  type: "tool_use";
};

export type AgentToolResultBlock = {
  content: string;
  is_error?: boolean;
  tool_use_id: string;
  type: "tool_result";
};

export type AgentAssistantBlock =
  | AgentTextBlock
  | AgentThinkingBlock
  | AgentToolUseBlock;

export type AgentConversationBlock =
  | AgentTextBlock
  | AgentThinkingBlock
  | AgentToolUseBlock
  | AgentToolResultBlock;

export type AgentMessage = {
  content: AgentConversationBlock[];
  role: "assistant" | "user";
};

export type AgentAssistantMessage = {
  content: AgentAssistantBlock[];
  id: string;
  model: string;
  role: "assistant";
};

export type CreateAgentMessageOptions = {
  messages: AgentMessage[];
  modelConfig?: ModelConnectionConfig;
  onRetry?: (payload: { attempt: number; reason: string }) => void;
  signal?: AbortSignal;
  system: string;
  tools: AgentToolDefinition[];
};

export type CreateAgentMessageResult = {
  message: AgentAssistantMessage;
  request: TraceModelRequest;
  response: TraceModelResponse;
};

export type ModelConnectionConfig = {
  apiKey?: string;
  baseUrl?: string;
  deepseekApiKey?: string;
  model?: string;
  provider?: string;
  qwenApiKey?: string;
};

export type ModelConnectionTestResult = {
  model: string;
  provider: string;
  requestId: string | null;
  runtime: TraceRuntimeInfo;
};

export type AgentProvider = {
  buildMessageRequest: (payload: {
    messages: AgentMessage[];
    modelConfig?: ModelConnectionConfig;
    system: string;
    tools: AgentToolDefinition[];
  }) => TraceModelRequest;
  createMessage: (payload: CreateAgentMessageOptions) => Promise<CreateAgentMessageResult>;
  getRuntimeInfo: (modelConfig?: ModelConnectionConfig) => TraceRuntimeInfo;
  hasApiKey: (modelConfig?: ModelConnectionConfig) => boolean;
  testConnection: (modelConfig?: ModelConnectionConfig) => Promise<ModelConnectionTestResult>;
};
