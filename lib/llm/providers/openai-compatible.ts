import type {
  CreateAgentMessageOptions,
  CreateAgentMessageResult,
  AgentAssistantBlock,
  AgentMessage,
  AgentProvider,
  AgentToolDefinition,
  ModelConnectionConfig,
  ModelConnectionTestResult,
} from "../types";
import type {
  TraceModelRequest,
  TraceModelResponse,
  TraceRuntimeInfo,
  TraceToolDefinition,
  TraceUsage,
} from "../../trace";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE_PATTERNS = [
  /\btimeout\b/i,
  /\btemporarily unavailable\b/i,
  /\bfetch failed\b/i,
  /\baborted\b/i,
  /\bconnection\b/i,
];

type OpenAIChatMessage =
  | {
      content: string;
      role: "system" | "user";
    }
  | {
      content?: string | null;
      role: "assistant";
      tool_calls?: OpenAIToolCall[];
    }
  | {
      content: string;
      role: "tool";
      tool_call_id: string;
    };

type OpenAIToolCall = {
  function?: {
    arguments?: string;
    name?: string;
  };
  id?: string;
  type?: "function";
};

type OpenAIChatRequest = {
  max_tokens: number;
  messages: OpenAIChatMessage[];
  model: string;
  tools?: Array<{
    function: {
      description?: string;
      name: string;
      parameters: unknown;
    };
    type: "function";
  }>;
} & Record<string, unknown>;

type OpenAIChatResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    index?: number;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      role?: string;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  error?: {
    code?: string | number | null;
    message?: string;
    type?: string;
  };
  id?: string;
  model?: string;
  request_id?: string | null;
  usage?: {
    completion_tokens?: number | null;
    completion_tokens_details?: {
      reasoning_tokens?: number | null;
    };
    prompt_cache_hit_tokens?: number | null;
    prompt_cache_miss_tokens?: number | null;
    prompt_tokens?: number | null;
    prompt_tokens_details?: {
      cached_tokens?: number | null;
    };
    total_tokens?: number | null;
  };
};

type RuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  contextWindow: number | null;
  enableThinking: boolean;
  maxTokens: number;
  model: string;
  preserveThinking: boolean;
  reasoningEffort: "high" | "max";
};

type ProviderRuntimeOptions = {
  requestExtras: Record<string, unknown>;
  traceOptions: Record<string, unknown>;
};

type OpenAICompatibleProviderOptions = {
  apiKeyEnvNames?: string[];
  defaultBaseUrl: string;
  defaultContextWindow: number | null;
  defaultEnableThinking?: boolean;
  defaultMaxTokens: number;
  defaultModel: string;
  defaultPreserveThinking?: boolean;
  defaultReasoningEffort?: "high" | "max";
  missingApiKeyMessage: string;
  providerName: string;
  requestFailedPrefix: string;
  resolveRuntimeOptions: (runtime: RuntimeConfig) => ProviderRuntimeOptions;
};

function readEnvValue(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNullablePositiveInteger(
  value: string | undefined,
  fallback: number | null,
) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readReasoningEffort(
  value: string | undefined,
  fallback: "high" | "max",
) {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "max" || normalized === "xhigh") {
    return "max";
  }

  return fallback;
}

function resolveModelApiKey(
  modelConfig: ModelConnectionConfig | undefined,
  apiKeyEnvNames: string[],
) {
  return (
    modelConfig?.apiKey?.trim() ||
    modelConfig?.deepseekApiKey?.trim() ||
    modelConfig?.qwenApiKey?.trim() ||
    readEnvValue(apiKeyEnvNames)
  );
}

function createRuntimeConfig(
  options: OpenAICompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
): RuntimeConfig {
  return {
    apiKey: resolveModelApiKey(modelConfig, [
      ...(options.apiKeyEnvNames ?? []),
      "LLM_API_KEY",
    ]),
    baseUrl:
      modelConfig?.baseUrl?.trim().replace(/\/+$/, "") ||
      process.env.LLM_BASE_URL?.trim().replace(/\/+$/, "") ||
      options.defaultBaseUrl,
    contextWindow: readNullablePositiveInteger(
      process.env.LLM_CONTEXT_WINDOW,
      options.defaultContextWindow,
    ),
    enableThinking: readBoolean(
      process.env.LLM_ENABLE_THINKING,
      options.defaultEnableThinking ?? true,
    ),
    maxTokens: readPositiveInteger(
      process.env.LLM_MAX_TOKENS,
      options.defaultMaxTokens,
    ),
    model: modelConfig?.model?.trim() || process.env.LLM_MODEL?.trim() || options.defaultModel,
    preserveThinking: readBoolean(
      process.env.LLM_PRESERVE_THINKING,
      options.defaultPreserveThinking ?? true,
    ),
    reasoningEffort: readReasoningEffort(
      process.env.LLM_REASONING_EFFORT,
      options.defaultReasoningEffort ?? "high",
    ),
  };
}

function getRuntimeConfig(
  options: OpenAICompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  return createRuntimeConfig(options, modelConfig);
}

function getConfig(
  options: OpenAICompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  const config = getRuntimeConfig(options, modelConfig);

  if (!config.apiKey) {
    throw new Error(options.missingApiKeyMessage);
  }

  return config;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {
      _raw: value,
      _warning: "Tool arguments were not valid JSON.",
    };
  }
}

function joinTextContent(message: AgentMessage) {
  return message.content
    .filter(
      (
        block,
      ): block is Extract<AgentMessage["content"][number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toOpenAITools(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      description: tool.description,
      name: tool.name,
      parameters:
        tool.input_schema ?? {
          type: "object",
          properties: {},
        },
    },
  }));
}

function toTraceToolDefinitions(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.input_schema,
    name: tool.name,
  })) satisfies TraceToolDefinition[];
}

function toOpenAIChatMessages({
  messages,
  system,
}: {
  messages: AgentMessage[];
  system: string;
}) {
  const chatMessages: OpenAIChatMessage[] = [
    {
      role: "system",
      content: system,
    },
  ];

  for (const message of messages) {
    if (message.role === "assistant") {
      const content = joinTextContent(message);
      const toolCalls = message.content
        .filter(
          (
            block,
          ): block is Extract<
            AgentMessage["content"][number],
            { type: "tool_use" }
          > => block.type === "tool_use",
        )
        .map((block) => ({
          id: block.id,
          type: "function" as const,
          function: {
            arguments: JSON.stringify(block.input ?? {}),
            name: block.name,
          },
        }));

      if (!content && toolCalls.length === 0) {
        continue;
      }

      chatMessages.push({
        role: "assistant",
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const content = joinTextContent(message);

    if (content) {
      chatMessages.push({
        role: "user",
        content,
      });
    }

    for (const block of message.content) {
      if (block.type !== "tool_result") {
        continue;
      }

      chatMessages.push({
        role: "tool",
        content: block.content,
        tool_call_id: block.tool_use_id,
      });
    }
  }

  return chatMessages;
}

function toUsageSnapshot(
  usage: OpenAIChatResponse["usage"],
  runtime: TraceRuntimeInfo,
): TraceUsage {
  const inputTokens = usage?.prompt_tokens ?? null;
  const cachedTokens =
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.prompt_cache_hit_tokens ??
    null;

  return {
    actualInputOccupancyRatio:
      runtime.contextWindow && typeof inputTokens === "number"
        ? inputTokens / runtime.contextWindow
        : null,
    cacheCreationInputTokens: usage?.prompt_cache_miss_tokens ?? null,
    cacheReadInputTokens: cachedTokens,
    inputTokens,
    modelContextWindow: runtime.contextWindow,
    outputTokens: usage?.completion_tokens ?? null,
    totalInputTokens: inputTokens,
  };
}

function extractErrorInfo(error: unknown, fallbackPrefix: string) {
  const fallbackMessage =
    error instanceof Error ? error.message : `${fallbackPrefix}。`;

  if (typeof error !== "object" || error === null) {
    return {
      message: fallbackMessage,
      requestId: undefined,
      status: undefined,
    };
  }

  const maybeError = error as {
    error?: {
      message?: string;
    };
    message?: string;
    requestId?: string | null;
    status?: number;
  };

  return {
    message: maybeError.error?.message ?? maybeError.message ?? fallbackMessage,
    requestId: maybeError.requestId ?? undefined,
    status: maybeError.status,
  };
}

function isRetryableError(error: unknown, fallbackPrefix: string) {
  const { message, status } = extractErrorInfo(error, fallbackPrefix);

  if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function formatError(error: unknown, fallbackPrefix: string, retried: boolean) {
  const { message, requestId, status } = extractErrorInfo(error, fallbackPrefix);

  return [
    typeof status === "number" ? `HTTP ${status}` : "",
    message,
    requestId ? `request_id: ${requestId}` : "",
    retried ? "已自动重试 1 次" : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

async function parseErrorResponse(response: Response) {
  const requestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-dashscope-request-id");
  const text = await response.text();
  const parsed = safeParseJson(text);

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    typeof parsed.error === "object" &&
    parsed.error !== null &&
    "message" in parsed.error
  ) {
    const message = (parsed.error as { message?: string }).message;

    return {
      message: message || text || "请求失败。",
      requestId,
      status: response.status,
    };
  }

  return {
    message: text || "请求失败。",
    requestId,
    status: response.status,
  };
}

function normalizeAssistantBlocks(
  message: NonNullable<OpenAIChatResponse["choices"]>[number]["message"],
) {
  const blocks: AgentAssistantBlock[] = [];
  const thinking = message?.reasoning_content?.trim();
  const content = message?.content?.trim();

  if (thinking) {
    blocks.push({
      type: "thinking",
      thinking,
    });
  }

  if (content) {
    blocks.push({
      type: "text",
      text: content,
    });
  }

  for (const toolCall of message?.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: toolCall.id?.trim() || crypto.randomUUID(),
      input: safeParseJson(toolCall.function?.arguments?.trim() || "{}"),
      name: toolCall.function?.name?.trim() || "unknown_tool",
    });
  }

  return blocks;
}

function buildRequestPayload({
  messages,
  options,
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  options: OpenAICompatibleProviderOptions;
  runtime: RuntimeConfig;
  system: string;
  tools: AgentToolDefinition[];
}) {
  const openAITools = toOpenAITools(tools);

  return {
    max_tokens: runtime.maxTokens,
    messages: toOpenAIChatMessages({ messages, system }),
    model: runtime.model,
    ...options.resolveRuntimeOptions(runtime).requestExtras,
    ...(openAITools.length > 0 ? { tools: openAITools } : {}),
  } satisfies OpenAIChatRequest;
}

function buildTraceRequest({
  messages,
  options,
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  options: OpenAICompatibleProviderOptions;
  runtime: RuntimeConfig;
  system: string;
  tools: AgentToolDefinition[];
}) {
  const traceRuntime = getRuntimeInfo(options, {
    apiKey: runtime.apiKey,
  });

  return {
    maxTokens: runtime.maxTokens,
    messages: toOpenAIChatMessages({ messages, system }),
    providerOptions: options.resolveRuntimeOptions(runtime).traceOptions,
    runtime: traceRuntime,
    systemPrompt: system,
    tools: toTraceToolDefinitions(tools),
  } satisfies TraceModelRequest;
}

function getRuntimeInfo(
  options: OpenAICompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  const runtime = getRuntimeConfig(options, modelConfig);

  return {
    baseUrl: runtime.baseUrl,
    contextWindow: runtime.contextWindow,
    maxTokens: runtime.maxTokens,
    model: runtime.model,
    provider: options.providerName,
  } satisfies TraceRuntimeInfo;
}

function hasApiKey(
  options: OpenAICompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  const runtime = getRuntimeConfig(options, modelConfig);
  return Boolean(runtime.apiKey);
}

function getRequestId(response: Response, payload: OpenAIChatResponse) {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-dashscope-request-id") ??
    payload.request_id ??
    null
  );
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
) {
  async function createMessage({
    messages,
    modelConfig,
    onRetry,
    system,
    tools,
  }: CreateAgentMessageOptions) {
    const runtime = getConfig(options, modelConfig);
    const request = buildTraceRequest({
      messages,
      options,
      runtime,
      system,
      tools,
    });
    const requestBody = buildRequestPayload({
      messages,
      options,
      runtime,
      system,
      tools,
    });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${runtime.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw await parseErrorResponse(response);
        }

        const payload = (await response.json()) as OpenAIChatResponse;
        const requestId = getRequestId(response, payload);
        const choice = payload.choices?.[0];
        const responseMessage = choice?.message ?? {
          role: "assistant",
          content: "",
        };
        const content = normalizeAssistantBlocks(responseMessage);

        return {
          message: {
            content,
            id: payload.id?.trim() || crypto.randomUUID(),
            model: payload.model?.trim() || runtime.model,
            role: "assistant",
          },
          request,
          response: {
            content: [responseMessage],
            id: payload.id?.trim() || crypto.randomUUID(),
            model: payload.model?.trim() || runtime.model,
            requestId,
            role: responseMessage.role ?? "assistant",
            stopReason: choice?.finish_reason ?? null,
            usage: toUsageSnapshot(payload.usage, getRuntimeInfo(options, modelConfig)),
          } satisfies TraceModelResponse,
        } satisfies CreateAgentMessageResult;
      } catch (error) {
        const shouldRetry =
          attempt === 1 && isRetryableError(error, options.requestFailedPrefix);

        if (shouldRetry) {
          onRetry?.({
            attempt,
            reason: formatError(error, options.requestFailedPrefix, false),
          });
          await sleep(900);
          continue;
        }

        throw new Error(
          `${options.requestFailedPrefix}：${formatError(
            error,
            options.requestFailedPrefix,
            attempt > 1,
          )}`,
        );
      }
    }

    throw new Error(`${options.requestFailedPrefix}：重试后仍未获得响应。`);
  }

  async function testConnection(
    modelConfig?: ModelConnectionConfig,
  ): Promise<ModelConnectionTestResult> {
    const runtime = getConfig(options, modelConfig);
    const requestBody = {
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: "ping",
        },
      ],
      model: runtime.model,
      ...options.resolveRuntimeOptions({
        ...runtime,
        enableThinking: false,
        preserveThinking: false,
      }).requestExtras,
    } satisfies OpenAIChatRequest;
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const payload = (await response.json()) as OpenAIChatResponse;
    const requestId = getRequestId(response, payload);

    return {
      model: payload.model?.trim() || runtime.model,
      provider: options.providerName,
      requestId,
      runtime: getRuntimeInfo(options, modelConfig),
    };
  }

  return {
    buildMessageRequest: ({ messages, modelConfig, system, tools }) => {
      const runtime = getRuntimeConfig(options, modelConfig);
      return buildTraceRequest({ messages, options, runtime, system, tools });
    },
    createMessage,
    getRuntimeInfo: (modelConfig) => getRuntimeInfo(options, modelConfig),
    hasApiKey: (modelConfig) => hasApiKey(options, modelConfig),
    testConnection,
  } satisfies AgentProvider;
}
