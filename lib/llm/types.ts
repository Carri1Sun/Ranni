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
  onRetry?: (payload: { attempt: number; reason: string }) => void;
  system: string;
  tools: AgentToolDefinition[];
};

export type CreateAgentMessageResult = {
  message: AgentAssistantMessage;
  request: TraceModelRequest;
  response: TraceModelResponse;
};

export type AgentProvider = {
  buildMessageRequest: (payload: {
    messages: AgentMessage[];
    system: string;
    tools: AgentToolDefinition[];
  }) => TraceModelRequest;
  createMessage: (payload: CreateAgentMessageOptions) => Promise<CreateAgentMessageResult>;
  getRuntimeInfo: () => TraceRuntimeInfo;
  hasApiKey: () => boolean;
};
