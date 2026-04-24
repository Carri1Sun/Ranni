import { z } from "zod";

import type {
  CreateAgentMessageOptions,
  CreateAgentMessageResult,
  AgentAssistantBlock,
  AgentMessage,
  AgentProvider,
  AgentToolDefinition,
} from "../types";
import type {
  TraceModelRequest,
  TraceModelResponse,
  TraceRuntimeInfo,
  TraceToolDefinition,
  TraceUsage,
} from "../../trace";

const envSchema = z.object({
  DASHSCOPE_API_KEY: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_CONTEXT_WINDOW: z.coerce.number().int().positive().optional(),
  LLM_ENABLE_THINKING: z.string().optional(),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_PRESERVE_THINKING: z.string().optional(),
});

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MODEL = "qwen3.6-plus";
const PROVIDER_NAME = "qwen-openai-compatible";
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
  enable_thinking: boolean;
  max_tokens: number;
  messages: OpenAIChatMessage[];
  model: string;
  preserve_thinking: boolean;
  tools: Array<{
    function: {
      description?: string;
      name: string;
      parameters: unknown;
    };
    type: "function";
  }>;
};

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
    prompt_tokens?: number | null;
    prompt_tokens_details?: {
      cached_tokens?: number | null;
    };
    total_tokens?: number | null;
  };
};

function parseBooleanEnv(value: string | undefined, fallback: boolean) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function getRuntimeConfig() {
  const env = envSchema.parse(process.env);

  return {
    apiKey: env.LLM_API_KEY?.trim() || env.DASHSCOPE_API_KEY?.trim() || "",
    baseUrl: (env.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    contextWindow: env.LLM_CONTEXT_WINDOW ?? DEFAULT_CONTEXT_WINDOW,
    enableThinking: parseBooleanEnv(env.LLM_ENABLE_THINKING, true),
    maxTokens: env.LLM_MAX_TOKENS ?? DEFAULT_MAX_TOKENS,
    model: env.LLM_MODEL ?? DEFAULT_MODEL,
    preserveThinking: parseBooleanEnv(env.LLM_PRESERVE_THINKING, true),
  };
}

function getConfig() {
  const config = getRuntimeConfig();

  if (!config.apiKey) {
    throw new Error(
      "未配置 Qwen API Key。请在 .env.local 中设置 LLM_API_KEY（或 DASHSCOPE_API_KEY）。",
    );
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
    .filter((block): block is Extract<AgentMessage["content"][number], { type: "text" }> => block.type === "text")
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
          (block): block is Extract<AgentMessage["content"][number], { type: "tool_use" }> =>
            block.type === "tool_use",
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
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens ?? null;

  return {
    actualInputOccupancyRatio:
      runtime.contextWindow && typeof inputTokens === "number"
        ? inputTokens / runtime.contextWindow
        : null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: cachedTokens,
    inputTokens,
    modelContextWindow: runtime.contextWindow,
    outputTokens: usage?.completion_tokens ?? null,
    totalInputTokens: inputTokens,
  };
}

function extractErrorInfo(error: unknown) {
  const fallbackMessage =
    error instanceof Error ? error.message : "Qwen OpenAI 兼容接口请求失败。";

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
    message:
      maybeError.error?.message ??
      maybeError.message ??
      fallbackMessage,
    requestId: maybeError.requestId ?? undefined,
    status: maybeError.status,
  };
}

function isRetryableError(error: unknown) {
  const { message, status } = extractErrorInfo(error);

  if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function formatError(error: unknown, retried: boolean) {
  const { message, requestId, status } = extractErrorInfo(error);

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
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  runtime: ReturnType<typeof getRuntimeConfig>;
  system: string;
  tools: AgentToolDefinition[];
}) {
  return {
    enable_thinking: runtime.enableThinking,
    max_tokens: runtime.maxTokens,
    messages: toOpenAIChatMessages({ messages, system }),
    model: runtime.model,
    preserve_thinking: runtime.preserveThinking,
    tools: toOpenAITools(tools),
  } satisfies OpenAIChatRequest;
}

function buildTraceRequest({
  messages,
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  runtime: ReturnType<typeof getRuntimeConfig>;
  system: string;
  tools: AgentToolDefinition[];
}) {
  const traceRuntime = getRuntimeInfo();

  return {
    maxTokens: runtime.maxTokens,
    messages: toOpenAIChatMessages({ messages, system }),
    providerOptions: {
      enableThinking: runtime.enableThinking,
      preserveThinking: runtime.preserveThinking,
    },
    runtime: traceRuntime,
    systemPrompt: system,
    tools: toTraceToolDefinitions(tools),
  } satisfies TraceModelRequest;
}

export function getRuntimeInfo() {
  const runtime = getRuntimeConfig();

  return {
    baseUrl: runtime.baseUrl,
    contextWindow: runtime.contextWindow,
    maxTokens: runtime.maxTokens,
    model: runtime.model,
    provider: PROVIDER_NAME,
  } satisfies TraceRuntimeInfo;
}

export function hasApiKey() {
  const runtime = getRuntimeConfig();
  return Boolean(runtime.apiKey);
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
  const runtime = getRuntimeConfig();
  return buildTraceRequest({ messages, runtime, system, tools });
}

export async function createMessage({
  messages,
  onRetry,
  system,
  tools,
}: CreateAgentMessageOptions) {
  const runtime = getConfig();
  const request = buildTraceRequest({ messages, runtime, system, tools });
  const requestBody = buildRequestPayload({ messages, runtime, system, tools });

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
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("request-id") ??
        response.headers.get("x-dashscope-request-id") ??
        payload.request_id ??
        null;
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
          usage: toUsageSnapshot(payload.usage, getRuntimeInfo()),
        } satisfies TraceModelResponse,
      } satisfies CreateAgentMessageResult;
    } catch (error) {
      const shouldRetry = attempt === 1 && isRetryableError(error);

      if (shouldRetry) {
        onRetry?.({
          attempt,
          reason: formatError(error, false),
        });
        await sleep(900);
        continue;
      }

      throw new Error(`Qwen 请求失败：${formatError(error, attempt > 1)}`);
    }
  }

  throw new Error("Qwen 请求失败：重试后仍未获得响应。");
}

export const qwenOpenAIProvider = {
  buildMessageRequest,
  createMessage,
  getRuntimeInfo,
  hasApiKey,
} satisfies AgentProvider;
