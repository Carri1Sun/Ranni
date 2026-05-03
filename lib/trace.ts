export type TraceRuntimeInfo = {
  baseUrl: string;
  contextWindow: number | null;
  maxTokens: number;
  model: string;
  provider: string;
};

export type TraceToolDefinition = {
  description?: string;
  inputSchema?: unknown;
  name: string;
};

export type TraceUsage = {
  actualInputOccupancyRatio: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  inputTokens: number | null;
  modelContextWindow: number | null;
  outputTokens: number | null;
  totalInputTokens: number | null;
};

export type TraceContextMessage = {
  content: unknown;
  estimatedTokens: number;
  role: "user" | "assistant";
  serializedChars: number;
  typeSummary: string[];
};

export type TraceContextSnapshot = {
  messages: TraceContextMessage[];
  stats: {
    assistantMessageCount: number;
    contentBlockCount: number;
    estimatedInputOccupancyRatio: number | null;
    estimatedInputTokens: number;
    modelContextWindow: number | null;
    serializedChars: number;
    systemPromptChars: number;
    toolCount: number;
    userMessageCount: number;
  };
  systemPrompt: string;
  tools: TraceToolDefinition[];
};

export type TraceModelRequest = {
  maxTokens: number;
  messages: unknown[];
  providerOptions?: unknown;
  runtime: TraceRuntimeInfo;
  systemPrompt: string;
  tools: TraceToolDefinition[];
};

export type TraceModelResponse = {
  content: unknown[];
  id: string;
  model: string;
  requestId: string | null;
  role: string;
  stopReason: string | null;
  usage: TraceUsage;
};

export type TraceStatusMessage = {
  at: number;
  message: string;
};

export type TraceToolCall = {
  arguments: unknown;
  endedAt?: number;
  id: string;
  name: string;
  startedAt: number;
  toolUseId: string;
};

export type TraceToolResult = {
  durationMs: number;
  endedAt: number;
  id: string;
  name: string;
  result: string;
  startedAt: number;
  success: boolean;
  toolUseId: string;
};

export type TraceStep = {
  assistantText: string;
  context?: TraceContextSnapshot;
  durationMs?: number;
  endedAt?: number;
  error?: string;
  id: string;
  request?: TraceModelRequest;
  researchState?: string;
  response?: TraceModelResponse;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  statusMessages: TraceStatusMessage[];
  stepIndex: number;
  stopReason?: string | null;
  thinking: string;
  toolCalls: TraceToolCall[];
  toolResults: TraceToolResult[];
};

export type TraceRun = {
  durationMs?: number;
  endedAt?: number;
  error?: string;
  finalAssistantMessage?: string;
  id: string;
  prompt: string;
  runtime: TraceRuntimeInfo;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  steps: TraceStep[];
  totalSteps: number;
};

export type StreamEvent =
  | {
      prompt: string;
      runId: string;
      runtime: TraceRuntimeInfo;
      startedAt: number;
      toolDefinitions: TraceToolDefinition[];
      type: "run_started";
    }
  | {
      runId: string;
      startedAt: number;
      stepId: string;
      stepIndex: number;
      type: "step_started";
    }
  | {
      context: TraceContextSnapshot;
      runId: string;
      stepId: string;
      stepIndex: number;
      type: "context_snapshot";
    }
  | {
      request: TraceModelRequest;
      runId: string;
      stepId: string;
      stepIndex: number;
      type: "model_request";
    }
  | {
      response: TraceModelResponse;
      runId: string;
      stepId: string;
      stepIndex: number;
      type: "model_response";
    }
  | {
      message: string;
      runId: string;
      stepId: string;
      stepIndex: number;
      timestamp: number;
      type: "thinking";
    }
  | {
      arguments: unknown;
      name: string;
      runId: string;
      startedAt: number;
      stepId: string;
      stepIndex: number;
      toolUseId: string;
      type: "tool_call";
    }
  | {
      durationMs: number;
      name: string;
      result: string;
      runId: string;
      startedAt: number;
      stepId: string;
      stepIndex: number;
      success: boolean;
      toolUseId: string;
      type: "tool_result";
    }
  | {
      researchState: string;
      runId: string;
      stepId: string;
      stepIndex: number;
      type: "research_state";
    }
  | {
      message: string;
      runId: string;
      stepId?: string;
      stepIndex?: number;
      timestamp: number;
      type: "status";
    }
  | {
      message: string;
      runId: string;
      stepId?: string;
      stepIndex?: number;
      type: "assistant";
    }
  | {
      durationMs: number;
      endedAt: number;
      runId: string;
      status: "completed" | "failed" | "cancelled";
      stepId: string;
      stepIndex: number;
      stopReason?: string | null;
      type: "step_completed";
    }
  | {
      durationMs: number;
      endedAt: number;
      error?: string;
      runId: string;
      status: "completed" | "failed" | "cancelled";
      totalSteps: number;
      type: "run_completed";
    }
  | {
      message: string;
      runId?: string;
      stepId?: string;
      stepIndex?: number;
      type: "error";
    }
  | {
      type: "done";
    };
