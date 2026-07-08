import type {
  AgentAssistantBlock,
  AgentMessage,
  AgentProvider,
  AgentToolDefinition,
  CreateAgentMessageOptions,
  CreateAgentMessageResult,
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
  /\bterminated\b/i,
  /\baborted\b/i,
  /\bconnection\b/i,
];

type AnthropicContentBlock =
  | {
      text: string;
      type: "text";
    }
  | {
      thinking: string;
      type: "thinking";
    }
  | {
      id: string;
      input: unknown;
      name: string;
      type: "tool_use";
    }
  | {
      content: string;
      tool_use_id: string;
      type: "tool_result";
    };

type AnthropicMessage = {
  content: AnthropicContentBlock[];
  role: "assistant" | "user";
};

type AnthropicTool = {
  description?: string;
  input_schema: unknown;
  name: string;
};

type AnthropicMessagesRequest = {
  max_tokens: number;
  messages: AnthropicMessage[];
  model: string;
  stream?: boolean;
  system: string;
  tools?: AnthropicTool[];
} & Record<string, unknown>;

type AnthropicMessagesResponse = {
  content?: AnthropicContentBlock[];
  error?: {
    code?: string | number | null;
    message?: string;
    type?: string;
  };
  id?: string;
  model?: string;
  role?: string;
  stop_reason?: string | null;
  type?: string;
  usage?: AnthropicUsage;
};

type AnthropicUsage = {
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
};

type AnthropicStreamEvent = {
  content_block?: Partial<AnthropicContentBlock>;
  delta?: {
    partial_json?: string;
    stop_reason?: string | null;
    text?: string;
    thinking?: string;
    type?: string;
  };
  index?: number;
  message?: AnthropicMessagesResponse;
  type?: string;
  usage?: AnthropicUsage;
};

type RuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  contextWindow: number | null;
  enableThinking: boolean;
  maxTokens: number;
  model: string;
};

type ProviderRuntimeOptions = {
  requestExtras: Record<string, unknown>;
  traceOptions: Record<string, unknown>;
};

type AnthropicCompatibleProviderOptions = {
  apiKeyEnvNames?: string[];
  baseUrlEnvNames?: string[];
  contextWindowEnvNames?: string[];
  defaultBaseUrl: string;
  defaultContextWindow: number | null;
  defaultEnableThinking?: boolean;
  defaultMaxTokens: number;
  defaultModel: string;
  fallbackBaseUrls?: string[];
  maxTokensEnvNames?: string[];
  missingApiKeyMessage: string;
  modelEnvNames?: string[];
  providerName: string;
  requestFailedPrefix: string;
  resolveRuntimeOptions: (runtime: RuntimeConfig) => ProviderRuntimeOptions;
};

type StreamingToolUse = {
  id: string;
  inputJson: string;
  name: string;
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

function resolveModelApiKey(
  modelConfig: ModelConnectionConfig | undefined,
  apiKeyEnvNames: string[],
) {
  return (
    modelConfig?.apiKey?.trim() ||
    modelConfig?.minimaxTokenPlanKey?.trim() ||
    readEnvValue(apiKeyEnvNames)
  );
}

function createRuntimeConfig(
  options: AnthropicCompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
): RuntimeConfig {
  const baseUrlFromEnv = readEnvValue(options.baseUrlEnvNames ?? []);

  return {
    apiKey: resolveModelApiKey(modelConfig, options.apiKeyEnvNames ?? []),
    baseUrl:
      modelConfig?.baseUrl?.trim().replace(/\/+$/, "") ||
      baseUrlFromEnv.replace(/\/+$/, "") ||
      options.defaultBaseUrl,
    contextWindow: readNullablePositiveInteger(
      readEnvValue(options.contextWindowEnvNames ?? []),
      options.defaultContextWindow,
    ),
    enableThinking: readBoolean(
      process.env.LLM_ENABLE_THINKING,
      options.defaultEnableThinking ?? true,
    ),
    maxTokens: readPositiveInteger(
      readEnvValue(options.maxTokensEnvNames ?? ["LLM_MAX_TOKENS"]),
      options.defaultMaxTokens,
    ),
    model:
      modelConfig?.model?.trim() ||
      readEnvValue(options.modelEnvNames ?? []) ||
      options.defaultModel,
  };
}

function getRuntimeConfig(
  options: AnthropicCompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  return createRuntimeConfig(options, modelConfig);
}

function getConfig(
  options: AnthropicCompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  const config = getRuntimeConfig(options, modelConfig);

  if (!config.apiKey) {
    throw new Error(options.missingApiKeyMessage);
  }

  return config;
}

function createAbortError() {
  const error = new Error("Agent run was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function sleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function safeParseJson(value: string):
  | {
      ok: true;
      value: unknown;
    }
  | {
      error: string;
      ok: false;
      raw: string;
    } {
  try {
    return {
      ok: true,
      value: JSON.parse(value),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Tool arguments were not valid JSON.",
      ok: false,
      raw: value,
    };
  }
}

function normalizeToolInput(input: unknown) {
  return typeof input === "object" && input !== null ? input : {};
}

function toAnthropicContentBlocks(message: AgentMessage) {
  const blocks: AnthropicContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      blocks.push({
        type: "text",
        text: block.text,
      });
      continue;
    }

    if (message.role === "assistant" && block.type === "thinking") {
      if (block.thinking.trim()) {
        blocks.push({
          type: "thinking",
          thinking: block.thinking,
        });
      }
      continue;
    }

    if (message.role === "assistant" && block.type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: normalizeToolInput(block.input),
      });
      continue;
    }

    if (message.role === "user" && block.type === "tool_result") {
      blocks.push({
        type: "tool_result",
        content: block.content,
        tool_use_id: block.tool_use_id,
      });
    }
  }

  return blocks;
}

function appendAnthropicMessage(
  messages: AnthropicMessage[],
  nextMessage: AnthropicMessage,
) {
  const previous = messages.at(-1);

  if (previous?.role === nextMessage.role) {
    previous.content.push(...nextMessage.content);
    return;
  }

  messages.push(nextMessage);
}

function toAnthropicMessages(messages: AgentMessage[]) {
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    const content = toAnthropicContentBlocks(message);

    if (content.length === 0) {
      continue;
    }

    appendAnthropicMessage(anthropicMessages, {
      role: message.role,
      content,
    });
  }

  return anthropicMessages;
}

function toAnthropicTools(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    description: tool.description,
    input_schema:
      tool.input_schema ?? {
        type: "object",
        properties: {},
      },
    name: tool.name,
  })) satisfies AnthropicTool[];
}

function toTraceToolDefinitions(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.input_schema,
    name: tool.name,
  })) satisfies TraceToolDefinition[];
}

function toUsageSnapshot(
  usage: AnthropicUsage | undefined,
  runtime: TraceRuntimeInfo,
): TraceUsage {
  const inputTokens = usage?.input_tokens ?? null;

  return {
    actualInputOccupancyRatio:
      runtime.contextWindow && typeof inputTokens === "number"
        ? inputTokens / runtime.contextWindow
        : null,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? null,
    inputTokens,
    modelContextWindow: runtime.contextWindow,
    outputTokens: usage?.output_tokens ?? null,
    totalInputTokens: inputTokens,
  };
}

function normalizeAssistantBlocks(content: AnthropicContentBlock[] | undefined) {
  const blocks: AgentAssistantBlock[] = [];

  for (const block of content ?? []) {
    if (block.type === "thinking" && block.thinking.trim()) {
      blocks.push({
        type: "thinking",
        thinking: block.thinking,
      });
      continue;
    }

    if (block.type === "text" && block.text.trim()) {
      blocks.push({
        type: "text",
        text: block.text,
      });
      continue;
    }

    if (block.type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: block.id?.trim() || crypto.randomUUID(),
        input: normalizeToolInput(block.input),
        rawInput: JSON.stringify(normalizeToolInput(block.input)),
        name: block.name?.trim() || "unknown_tool",
      });
    }
  }

  return blocks;
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
    response.headers.get("x-minimax-request-id");
  const text = await response.text();
  const parsed = safeParseJson(text);

  if (
    parsed.ok &&
    typeof parsed.value === "object" &&
    parsed.value !== null &&
    "error" in parsed.value &&
    typeof parsed.value.error === "object" &&
    parsed.value.error !== null &&
    "message" in parsed.value.error
  ) {
    const message = (parsed.value.error as { message?: string }).message;

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

function getRuntimeInfo(
  options: AnthropicCompatibleProviderOptions,
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
  options: AnthropicCompatibleProviderOptions,
  modelConfig?: ModelConnectionConfig,
) {
  const runtime = getRuntimeConfig(options, modelConfig);
  return Boolean(runtime.apiKey);
}

function buildRequestPayload({
  messages,
  options,
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  options: AnthropicCompatibleProviderOptions;
  runtime: RuntimeConfig;
  system: string;
  tools: AgentToolDefinition[];
}) {
  const anthropicTools = toAnthropicTools(tools);

  return {
    max_tokens: runtime.maxTokens,
    messages: toAnthropicMessages(messages),
    model: runtime.model,
    system,
    ...options.resolveRuntimeOptions(runtime).requestExtras,
    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
  } satisfies AnthropicMessagesRequest;
}

function buildTraceRequest({
  messages,
  options,
  runtime,
  system,
  tools,
}: {
  messages: AgentMessage[];
  options: AnthropicCompatibleProviderOptions;
  runtime: RuntimeConfig;
  system: string;
  tools: AgentToolDefinition[];
}) {
  const traceRuntime = getRuntimeInfo(options, {
    apiKey: runtime.apiKey,
  });

  return {
    maxTokens: runtime.maxTokens,
    messages: toAnthropicMessages(messages),
    providerOptions: options.resolveRuntimeOptions(runtime).traceOptions,
    runtime: traceRuntime,
    systemPrompt: system,
    tools: toTraceToolDefinitions(tools),
  } satisfies TraceModelRequest;
}

function getRequestId(response: Response) {
  return (
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("x-minimax-request-id") ??
    null
  );
}

function getRuntimeCandidates(
  options: AnthropicCompatibleProviderOptions,
  runtime: RuntimeConfig,
) {
  const seen = new Set<string>();
  const candidates: RuntimeConfig[] = [];

  for (const baseUrl of [
    runtime.baseUrl,
    ...(options.fallbackBaseUrls ?? []),
  ]) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    candidates.push({
      ...runtime,
      baseUrl: normalized,
    });
  }

  return candidates;
}

function shouldTryNextBaseUrl(error: unknown) {
  const { message, status } = extractErrorInfo(error, "请求失败");

  return (
    status === 401 ||
    status === 403 ||
    /\binvalid api key\b/i.test(message) ||
    /\bauthentication\b/i.test(message)
  );
}

function readSseDataBlocks(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");

  return {
    blocks: parts.slice(0, -1),
    rest: parts.at(-1) ?? "",
  };
}

function parseSseData(block: string) {
  const lines = block.split("\n");
  const dataLines = lines
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());

  return dataLines.length > 0 ? dataLines.join("\n") : "";
}

function splitSseDataMessages(data: string): string[] {
  const trimmed = data.trim();

  if (!trimmed) {
    return [];
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 1 ? lines : [trimmed];
}

function toStreamingToolUse(block: Partial<AnthropicContentBlock>) {
  if (block.type !== "tool_use") {
    return undefined;
  }

  return {
    id: typeof block.id === "string" ? block.id : crypto.randomUUID(),
    inputJson: "",
    name: typeof block.name === "string" ? block.name : "unknown_tool",
  } satisfies StreamingToolUse;
}

function toToolUseBlock(toolUse: StreamingToolUse) {
  const rawInput = toolUse.inputJson.trim() || "{}";
  const parsedInput = safeParseJson(rawInput);

  return {
    type: "tool_use",
    id: toolUse.id,
    input: parsedInput.ok ? normalizeToolInput(parsedInput.value) : {},
    rawInput,
    ...(parsedInput.ok
      ? {}
      : {
          inputParseError: parsedInput.error,
        }),
    name: toolUse.name,
  } satisfies AgentAssistantBlock;
}

async function readStreamingResponse({
  modelConfig,
  onThinkingDelta,
  options,
  request,
  response,
  runtime,
  signal,
}: {
  modelConfig?: ModelConnectionConfig;
  onThinkingDelta?: (payload: { delta: string }) => void;
  options: AnthropicCompatibleProviderOptions;
  request: TraceModelRequest;
  response: Response;
  runtime: RuntimeConfig;
  signal?: AbortSignal;
}): Promise<CreateAgentMessageResult> {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error("流式响应没有可读取的 body。");
  }

  const decoder = new TextDecoder();
  const responseBlocks: AnthropicContentBlock[] = [];
  const assistantBlocks: AgentAssistantBlock[] = [];
  const toolUses = new Map<number, StreamingToolUse>();
  let buffer = "";
  let done = false;
  let id = "";
  let model = "";
  let role = "assistant";
  let stopReason: string | null = null;
  let usage: AnthropicUsage | undefined;

  const processData = (data: string) => {
    if (!data) {
      return;
    }

    const chunk = JSON.parse(data.trim()) as AnthropicStreamEvent;

    if (chunk.type === "message_start" && chunk.message) {
      id = chunk.message.id?.trim() || id;
      model = chunk.message.model?.trim() || model;
      role = chunk.message.role?.trim() || role;
      usage = chunk.message.usage ?? usage;
      return;
    }

    if (chunk.type === "content_block_start" && typeof chunk.index === "number") {
      const contentBlock = chunk.content_block;

      if (!contentBlock) {
        return;
      }

      if (contentBlock.type === "tool_use") {
        const toolUse = toStreamingToolUse(contentBlock);

        if (toolUse) {
          toolUses.set(chunk.index, toolUse);
        }
        return;
      }

      if (contentBlock.type === "thinking") {
        responseBlocks[chunk.index] = {
          type: "thinking",
          thinking:
            typeof contentBlock.thinking === "string"
              ? contentBlock.thinking
              : "",
        };
        return;
      }

      if (contentBlock.type === "text") {
        responseBlocks[chunk.index] = {
          type: "text",
          text: typeof contentBlock.text === "string" ? contentBlock.text : "",
        };
      }
      return;
    }

    if (chunk.type === "content_block_delta" && typeof chunk.index === "number") {
      const delta = chunk.delta;

      if (!delta) {
        return;
      }

      if (delta.type === "thinking_delta" && delta.thinking) {
        const current = responseBlocks[chunk.index];
        const nextThinking =
          current?.type === "thinking"
            ? `${current.thinking}${delta.thinking}`
            : delta.thinking;

        responseBlocks[chunk.index] = {
          type: "thinking",
          thinking: nextThinking,
        };
        onThinkingDelta?.({ delta: delta.thinking });
        return;
      }

      if (delta.type === "text_delta" && delta.text) {
        const current = responseBlocks[chunk.index];
        const nextText =
          current?.type === "text" ? `${current.text}${delta.text}` : delta.text;

        responseBlocks[chunk.index] = {
          type: "text",
          text: nextText,
        };
        return;
      }

      if (delta.type === "input_json_delta" && delta.partial_json) {
        const toolUse = toolUses.get(chunk.index);

        if (toolUse) {
          toolUse.inputJson += delta.partial_json;
        }
      }
      return;
    }

    if (chunk.type === "content_block_stop" && typeof chunk.index === "number") {
      const toolUse = toolUses.get(chunk.index);

      if (toolUse) {
        const rawInput = toolUse.inputJson.trim() || "{}";
        const parsedInput = safeParseJson(rawInput);

        responseBlocks[chunk.index] = {
          type: "tool_use",
          id: toolUse.id,
          input: parsedInput.ok ? normalizeToolInput(parsedInput.value) : {},
          name: toolUse.name,
        };
        assistantBlocks[chunk.index] = toToolUseBlock(toolUse);
        toolUses.delete(chunk.index);
      }
      return;
    }

    if (chunk.type === "message_delta") {
      stopReason = chunk.delta?.stop_reason ?? stopReason;
      usage = chunk.usage ?? usage;
      return;
    }

    if (chunk.type === "message_stop") {
      done = true;
    }
  };

  while (!done) {
    throwIfAborted(signal);

    const { done: readerDone, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !readerDone });
    const { blocks, rest } = readSseDataBlocks(buffer);
    buffer = rest;

    for (const block of blocks) {
      for (const message of splitSseDataMessages(parseSseData(block))) {
        processData(message);
      }
    }

    if (readerDone) {
      break;
    }
  }

  if (buffer.trim()) {
    for (const message of splitSseDataMessages(parseSseData(buffer))) {
      processData(message);
    }
  }

  responseBlocks.forEach((block, index) => {
    if (assistantBlocks[index]) {
      return;
    }

    const normalizedBlock = normalizeAssistantBlocks([block])[0];

    if (normalizedBlock) {
      assistantBlocks[index] = normalizedBlock;
    }
  });

  const filteredResponseBlocks = responseBlocks.filter(
    (block): block is AnthropicContentBlock => Boolean(block),
  );
  const filteredAssistantBlocks = assistantBlocks.filter(
    (block): block is AgentAssistantBlock => Boolean(block),
  );
  const messageId = id || crypto.randomUUID();
  const responseModel = model || runtime.model;

  return {
    message: {
      content: filteredAssistantBlocks,
      id: messageId,
      model: responseModel,
      role: "assistant",
    },
    request,
    response: {
      content: filteredResponseBlocks,
      id: messageId,
      model: responseModel,
      requestId: getRequestId(response),
      role,
      stopReason,
      usage: toUsageSnapshot(usage, getRuntimeInfo(options, modelConfig)),
    } satisfies TraceModelResponse,
  } satisfies CreateAgentMessageResult;
}

export function createAnthropicCompatibleProvider(
  options: AnthropicCompatibleProviderOptions,
) {
  async function createMessage({
    messages,
    modelConfig,
    onThinkingDelta,
    onRetry,
    signal,
    system,
    tools,
  }: CreateAgentMessageOptions) {
    const runtime = getConfig(options, modelConfig);
    const runtimeCandidates = getRuntimeCandidates(options, runtime);
    const shouldStream = Boolean(onThinkingDelta);
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      throwIfAborted(signal);

      for (let candidateIndex = 0; candidateIndex < runtimeCandidates.length; candidateIndex += 1) {
        const candidateRuntime = runtimeCandidates[candidateIndex];
        const request = buildTraceRequest({
          messages,
          options,
          runtime: candidateRuntime,
          system,
          tools,
        });
        const requestBody = buildRequestPayload({
          messages,
          options,
          runtime: candidateRuntime,
          system,
          tools,
        });
        const actualRequestBody = {
          ...requestBody,
          ...(shouldStream ? { stream: true } : {}),
        };

        try {
          const response = await fetch(`${candidateRuntime.baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": candidateRuntime.apiKey,
            },
            body: JSON.stringify(actualRequestBody),
            signal,
          });

          if (!response.ok) {
            const error = await parseErrorResponse(response);
            lastError = error;

            if (
              candidateIndex < runtimeCandidates.length - 1 &&
              shouldTryNextBaseUrl(error)
            ) {
              continue;
            }

            throw error;
          }

          if (shouldStream) {
            return await readStreamingResponse({
              modelConfig,
              onThinkingDelta,
              options,
              request,
              response,
              runtime: candidateRuntime,
              signal,
            });
          }

          const payload = (await response.json()) as AnthropicMessagesResponse;

          return {
            message: {
              content: normalizeAssistantBlocks(payload.content),
              id: payload.id?.trim() || crypto.randomUUID(),
              model: payload.model?.trim() || candidateRuntime.model,
              role: "assistant",
            },
            request,
            response: {
              content: payload.content ?? [],
              id: payload.id?.trim() || crypto.randomUUID(),
              model: payload.model?.trim() || candidateRuntime.model,
              requestId: getRequestId(response),
              role: payload.role ?? "assistant",
              stopReason: payload.stop_reason ?? null,
              usage: toUsageSnapshot(
                payload.usage,
                getRuntimeInfo(options, candidateRuntime),
              ),
            } satisfies TraceModelResponse,
          } satisfies CreateAgentMessageResult;
        } catch (error) {
          throwIfAborted(signal);
          lastError = error;

          if (
            candidateIndex < runtimeCandidates.length - 1 &&
            shouldTryNextBaseUrl(error)
          ) {
            continue;
          }

          const shouldRetry =
            attempt === 1 && isRetryableError(error, options.requestFailedPrefix);

          if (shouldRetry) {
            onRetry?.({
              attempt,
              reason: formatError(error, options.requestFailedPrefix, false),
            });
            await sleep(900, signal);
            break;
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
    }

    throw new Error(
      `${options.requestFailedPrefix}：${formatError(
        lastError,
        options.requestFailedPrefix,
        true,
      )}`,
    );
  }

  async function testConnection(
    modelConfig?: ModelConnectionConfig,
  ): Promise<ModelConnectionTestResult> {
    const runtime = getConfig(options, modelConfig);
    const runtimeCandidates = getRuntimeCandidates(options, runtime);
    let lastError: unknown;

    for (let candidateIndex = 0; candidateIndex < runtimeCandidates.length; candidateIndex += 1) {
      const candidateRuntime = runtimeCandidates[candidateIndex];
      const requestBody = {
        max_tokens: 8,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "ping",
              },
            ],
          },
        ],
        model: candidateRuntime.model,
        system: "Reply with pong.",
        ...options.resolveRuntimeOptions({
          ...candidateRuntime,
          enableThinking: false,
        }).requestExtras,
      } satisfies AnthropicMessagesRequest;
      const response = await fetch(`${candidateRuntime.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": candidateRuntime.apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await parseErrorResponse(response);
        lastError = error;

        if (
          candidateIndex < runtimeCandidates.length - 1 &&
          shouldTryNextBaseUrl(error)
        ) {
          continue;
        }

        throw error;
      }

      const payload = (await response.json()) as AnthropicMessagesResponse;

      return {
        model: payload.model?.trim() || candidateRuntime.model,
        provider: options.providerName,
        requestId: getRequestId(response),
        runtime: getRuntimeInfo(options, candidateRuntime),
      };
    }

    throw lastError ?? new Error(`${options.requestFailedPrefix}：未获得响应。`);
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
