import type {
  AgentAssistantBlock,
  AgentMessage,
  AgentProvider,
  AgentToolDefinition,
  CreateAgentMessageOptions,
  CreateAgentMessageResult,
  ModelCatalog,
  ModelConnectionConfig,
  ModelConnectionTestResult,
  ReasoningEffort,
} from "../types";
import type {
  TraceModelRequest,
  TraceModelResponse,
  TraceRuntimeInfo,
  TraceToolDefinition,
  TraceUsage,
} from "../../trace";

const DEFAULT_PORT = 8790;
const DEFAULT_MODEL = "gpt-5.6-terra";
const DEFAULT_EFFORT: ReasoningEffort = "high";
const DEFAULT_CONTEXT_WINDOW = 1_050_000;
const DEFAULT_MAX_TOKENS = 128_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [100, 250] as const;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_PATTERNS = [
  /\bterminated\b/i,
  /\btimeout\b/i,
  /\btemporarily unavailable\b/i,
  /\bfetch failed\b/i,
  /\bconnection\b/i,
  /\bECONNRESET\b/i,
  /\bUND_ERR\b/i,
  /\bsocket\b/i,
];
const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

type RuntimeConfig = {
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  model: string;
  reasoningEffort: ReasoningEffort;
};

type ResponsesInput =
  | {
      content: string;
      role: "assistant" | "user";
    }
  | {
      arguments: string;
      call_id: string;
      name: string;
      type: "function_call";
    }
  | {
      call_id: string;
      output: string;
      type: "function_call_output";
    }
  | Record<string, unknown>;

type NormalizedToolCall = {
  arguments: string;
  id: string;
  name: string;
};

type BffDonePayload = {
  id?: string;
  model?: string;
  reasoningItems?: unknown[];
  status?: string;
  usage?: {
    input_tokens?: number | null;
    input_tokens_details?: {
      cached_tokens?: number | null;
    };
    output_tokens?: number | null;
    total_tokens?: number | null;
  };
};

class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`HTTP ${status} | ${message}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

class RetryableStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableStreamError";
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createAbortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error("本地 ChatGPT 订阅请求已取消。");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function isRetryableError(error: unknown) {
  if (error instanceof RetryableStreamError || error instanceof TypeError) {
    return true;
  }

  if (error instanceof HttpStatusError) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }

  const message = getErrorMessage(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(createAbortError(signal));
    };

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePort(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return DEFAULT_PORT;
  const parsed = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("CODEX_API_PORT 必须是 1 到 65535 之间的整数。");
  }
  return parsed;
}

function resolveEffort(value: string | undefined, fallback = DEFAULT_EFFORT) {
  const normalized = value?.trim().toLowerCase() as ReasoningEffort | undefined;
  return normalized && REASONING_EFFORTS.has(normalized) ? normalized : fallback;
}

function getRuntimeConfig(modelConfig?: ModelConnectionConfig): RuntimeConfig {
  const baseUrl =
    modelConfig?.baseUrl?.trim().replace(/\/+$/, "") ||
    process.env.CHATGPT_SUBSCRIPTION_BASE_URL?.trim().replace(/\/+$/, "") ||
    `http://127.0.0.1:${resolvePort(process.env.CODEX_API_PORT)}`;

  return {
    baseUrl,
    contextWindow: readPositiveInteger(
      process.env.CHATGPT_SUBSCRIPTION_CONTEXT_WINDOW,
      DEFAULT_CONTEXT_WINDOW,
    ),
    maxTokens: readPositiveInteger(
      process.env.CHATGPT_SUBSCRIPTION_MAX_TOKENS,
      DEFAULT_MAX_TOKENS,
    ),
    model:
      modelConfig?.model?.trim() ||
      process.env.CHATGPT_SUBSCRIPTION_MODEL?.trim() ||
      DEFAULT_MODEL,
    reasoningEffort: resolveEffort(
      modelConfig?.reasoningEffort ??
        process.env.CHATGPT_SUBSCRIPTION_REASONING_EFFORT,
    ),
  };
}

function getRuntimeInfo(modelConfig?: ModelConnectionConfig) {
  const runtime = getRuntimeConfig(modelConfig);
  return {
    baseUrl: runtime.baseUrl,
    contextWindow: runtime.contextWindow,
    maxTokens: runtime.maxTokens,
    model: runtime.model,
    provider: "chatgpt-subscription",
  } satisfies TraceRuntimeInfo;
}

function toTraceTools(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.input_schema,
    name: tool.name,
  })) satisfies TraceToolDefinition[];
}

function toResponsesTools(tools: AgentToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters:
      tool.input_schema ?? {
        type: "object",
        properties: {},
      },
  }));
}

function toResponsesInput(messages: AgentMessage[]): ResponsesInput[] {
  const input: ResponsesInput[] = [];
  const reasoningItemIds = new Set<string>();

  for (const message of messages) {
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .filter((value) => value.trim())
      .join("\n");

    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        for (const item of block.providerMetadata?.responsesReasoningItems ?? []) {
          if (!item || typeof item !== "object") continue;
          const record = item as Record<string, unknown>;
          const id = typeof record.id === "string" ? record.id : JSON.stringify(record);
          if (reasoningItemIds.has(id)) continue;
          reasoningItemIds.add(id);
          input.push(record);
        }
      }

      if (text) {
        input.push({ role: "assistant", content: text });
      }

      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        input.push({
          type: "function_call",
          call_id: block.id,
          name: block.name,
          arguments: block.rawInput ?? JSON.stringify(block.input ?? {}),
        });
      }
      continue;
    }

    if (text) {
      input.push({ role: "user", content: text });
    }

    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      input.push({
        type: "function_call_output",
        call_id: block.tool_use_id,
        output: block.content,
      });
    }
  }

  return input;
}

function buildTraceRequest({
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
  const runtime = getRuntimeConfig(modelConfig);
  return {
    maxTokens: runtime.maxTokens,
    messages: toResponsesInput(messages),
    providerOptions: {
      endpoint: "responses-via-local-subscription-bff",
      reasoningEffort: runtime.reasoningEffort,
    },
    runtime: getRuntimeInfo(modelConfig),
    systemPrompt: system,
    tools: toTraceTools(tools),
  } satisfies TraceModelRequest;
}

function readSseBlocks(buffer: string) {
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  return { blocks: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

function parseSseBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join("\n") };
}

async function parseErrorResponse(response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error || text || `HTTP ${response.status}`;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

function safeParseArguments(rawInput: string) {
  try {
    return { ok: true as const, value: JSON.parse(rawInput) as unknown };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "工具参数不是有效 JSON。",
    };
  }
}

function toUsageSnapshot(
  usage: BffDonePayload["usage"],
  runtime: TraceRuntimeInfo,
): TraceUsage {
  const inputTokens = usage?.input_tokens ?? null;
  return {
    actualInputOccupancyRatio:
      runtime.contextWindow && typeof inputTokens === "number"
        ? inputTokens / runtime.contextWindow
        : null,
    cacheCreationInputTokens: null,
    cacheReadInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    inputTokens,
    modelContextWindow: runtime.contextWindow,
    outputTokens: usage?.output_tokens ?? null,
    totalInputTokens: inputTokens,
  };
}

async function readAgentStream({
  modelConfig,
  onThinkingDelta,
  request,
  response,
  signal,
}: {
  modelConfig?: ModelConnectionConfig;
  onThinkingDelta?: (payload: { delta: string }) => void;
  request: TraceModelRequest;
  response: Response;
  signal?: AbortSignal;
}): Promise<CreateAgentMessageResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("本地 ChatGPT 订阅响应没有可读取的流。");

  const decoder = new TextDecoder();
  const thinkingDeltas: string[] = [];
  const toolCallsById = new Map<string, NormalizedToolCall>();
  let buffer = "";
  let content = "";
  let thinking = "";
  let metadata: BffDonePayload = {};
  let sawDone = false;

  const processBlock = (block: string) => {
    const event = parseSseBlock(block);
    if (!event.data) return;
    const payload = JSON.parse(event.data) as Record<string, unknown>;
    if (event.event === "thinking" && typeof payload.delta === "string") {
      thinking += payload.delta;
      thinkingDeltas.push(payload.delta);
    } else if (event.event === "content" && typeof payload.delta === "string") {
      content += payload.delta;
    } else if (
      event.event === "tool_call" &&
      typeof payload.id === "string" &&
      typeof payload.name === "string" &&
      typeof payload.arguments === "string"
    ) {
      const toolCall = {
        id: payload.id,
        name: payload.name,
        arguments: payload.arguments,
      } satisfies NormalizedToolCall;
      const existing = toolCallsById.get(toolCall.id);

      if (existing) {
        if (
          existing.name === toolCall.name &&
          existing.arguments === toolCall.arguments
        ) {
          return;
        }
        throw new Error(`本地 ChatGPT 订阅流返回了内容冲突的重复 tool_call id：${toolCall.id}`);
      }

      toolCallsById.set(toolCall.id, toolCall);
    } else if (event.event === "done") {
      metadata = payload as BffDonePayload;
      sawDone = true;
    } else if (event.event === "error") {
      const streamError =
        typeof payload.message === "string"
          ? payload.message
          : "本地 ChatGPT 订阅流返回错误。";
      throw new RetryableStreamError(streamError);
    }
  };

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const parsed = readSseBlocks(buffer);
      buffer = parsed.rest;
      for (const block of parsed.blocks) {
        processBlock(block);
        if (sawDone) break;
      }
      if (sawDone) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (!sawDone && error instanceof SyntaxError) {
      throw new RetryableStreamError(
        `本地 ChatGPT 订阅流提前结束，未收到完整 SSE 数据：${error.message}`,
      );
    }
    throw error;
  }

  if (!sawDone) {
    throw new RetryableStreamError(
      "本地 ChatGPT 订阅流提前结束，未收到 done 事件。",
    );
  }

  if (
    metadata.status &&
    RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(metadata.status ?? ""))
  ) {
    throw new RetryableStreamError(
      `本地 ChatGPT 订阅流以瞬时故障状态结束：${metadata.status}`,
    );
  }

  const toolCalls = [...toolCallsById.values()];

  const blocks: AgentAssistantBlock[] = [];
  if (thinking.trim()) blocks.push({ type: "thinking", thinking });
  if (content.trim()) blocks.push({ type: "text", text: content });
  for (const toolCall of toolCalls) {
    const parsed = safeParseArguments(toolCall.arguments);
    blocks.push({
      type: "tool_use",
      id: toolCall.id,
      input: parsed.ok ? parsed.value : {},
      inputComplete: true,
      ...(parsed.ok ? {} : { inputParseError: parsed.error }),
      name: toolCall.name,
      providerMetadata:
        metadata.reasoningItems && metadata.reasoningItems.length > 0
          ? { responsesReasoningItems: metadata.reasoningItems }
          : undefined,
      rawInput: toolCall.arguments,
    });
  }

  const runtime = getRuntimeInfo(modelConfig);
  const messageId = metadata.id?.trim() || crypto.randomUUID();
  const responseModel = metadata.model?.trim() || runtime.model;
  const normalizedContent = [
    ...(thinking ? [{ type: "reasoning_summary", text: thinking }] : []),
    ...(content ? [{ type: "output_text", text: content }] : []),
    ...toolCalls.map((toolCall) => ({ type: "function_call", ...toolCall })),
  ];

  throwIfAborted(signal);
  for (const delta of thinkingDeltas) {
    throwIfAborted(signal);
    onThinkingDelta?.({ delta });
  }

  return {
    message: {
      content: blocks,
      id: messageId,
      model: responseModel,
      role: "assistant",
    },
    request,
    response: {
      content: normalizedContent,
      id: messageId,
      model: responseModel,
      requestId: messageId,
      role: "assistant",
      stopReason: toolCalls.length > 0 ? "tool_use" : metadata.status ?? "completed",
      usage: toUsageSnapshot(metadata.usage, runtime),
    } satisfies TraceModelResponse,
  };
}

async function listModels(modelConfig?: ModelConnectionConfig): Promise<ModelCatalog> {
  const runtime = getRuntimeConfig(modelConfig);
  const response = await fetch(`${runtime.baseUrl}/api/models`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`读取本地 ChatGPT 订阅模型失败：${await parseErrorResponse(response)}`);
  }
  const payload = (await response.json()) as {
    defaults?: { model?: string; reasoningEffort?: string };
    models?: Array<{ displayName?: string; efforts?: string[]; id?: string }>;
  };
  const models = (payload.models ?? [])
    .filter((item): item is { displayName?: string; efforts?: string[]; id: string } =>
      Boolean(item.id?.trim()),
    )
    .map((item) => ({
      displayName: item.displayName?.trim() || item.id,
      efforts: (item.efforts ?? []).filter((effort): effort is ReasoningEffort =>
        REASONING_EFFORTS.has(effort as ReasoningEffort),
      ),
      id: item.id,
    }))
    .filter((item) => item.efforts.length > 0);
  if (models.length === 0) {
    throw new Error("本地 ChatGPT 订阅服务没有返回可选模型。");
  }

  return {
    defaults: {
      model: payload.defaults?.model?.trim() || DEFAULT_MODEL,
      reasoningEffort: resolveEffort(payload.defaults?.reasoningEffort),
    },
    models,
  };
}

async function createMessage({
  messages,
  modelConfig,
  onRetry,
  onThinkingDelta,
  signal,
  system,
  tools,
}: CreateAgentMessageOptions) {
  const runtime = getRuntimeConfig(modelConfig);
  const request = buildTraceRequest({ messages, modelConfig, system, tools });
  const body = {
    instructions: system,
    input: toResponsesInput(messages),
    tools: toResponsesTools(tools),
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort,
    stream: true,
  };
  const serializedBody = JSON.stringify(body);
  let lastError: unknown;
  let retryCount = 0;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);

    try {
      const response = await fetch(`${runtime.baseUrl}/api/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: serializedBody,
        signal,
      });
      if (!response.ok) {
        const message = await parseErrorResponse(response);
        throw new HttpStatusError(response.status, message);
      }
      return await readAgentStream({
        modelConfig,
        onThinkingDelta,
        request,
        response,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;

      if (attempt >= MAX_REQUEST_ATTEMPTS || !isRetryableError(error)) {
        break;
      }

      retryCount += 1;
      onRetry?.({ attempt, reason: getErrorMessage(error) });
      await waitForRetry(RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1)!, signal);
    }
  }

  throw new Error(
    `本地 ChatGPT 订阅请求失败：${getErrorMessage(lastError)}（已自动重试 ${retryCount} 次）。`,
  );
}

async function testConnection(
  modelConfig?: ModelConnectionConfig,
): Promise<ModelConnectionTestResult> {
  const runtime = getRuntimeConfig(modelConfig);
  const catalog = await listModels(modelConfig);
  const selected = catalog.models.find((model) => model.id === runtime.model);
  if (!selected) throw new Error(`当前订阅不可用模型：${runtime.model}`);
  if (!selected.efforts.includes(runtime.reasoningEffort)) {
    throw new Error(`${runtime.model} 不支持 effort=${runtime.reasoningEffort}`);
  }

  const response = await fetch(`${runtime.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "只回复 LOCAL_SUBSCRIPTION_OK" }],
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`本地 ChatGPT 订阅连接测试失败：${await parseErrorResponse(response)}`);
  }
  const payload = (await response.json()) as { id?: string; model?: string };

  return {
    model: payload.model?.trim() || runtime.model,
    provider: "chatgpt-subscription",
    requestId: payload.id?.trim() || null,
    runtime: getRuntimeInfo(modelConfig),
  };
}

export const chatGPTSubscriptionProvider = {
  buildMessageRequest: ({ messages, modelConfig, system, tools }) =>
    buildTraceRequest({ messages, modelConfig, system, tools }),
  createMessage,
  getRuntimeInfo,
  hasApiKey: () => true,
  listModels,
  testConnection,
} satisfies AgentProvider;
