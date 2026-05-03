"use client";

import { useEffect, useRef, useState } from "react";

import type {
  StreamEvent,
  TraceContextSnapshot,
  TraceModelRequest,
  TraceModelResponse,
  TraceRun,
  TraceRuntimeInfo,
  TraceStep,
  TraceToolCall,
  TraceToolResult,
  TraceUsage,
} from "../lib/trace";

import { MarkdownContent } from "./markdown-content";
import styles from "./agent-console.module.css";

type MessageRole = "user" | "assistant";
type ActivityType = "status" | "tool_call" | "tool_result" | "error";
type ViewMode = "chat" | "report" | "trace";
type ThemeMode = "dark" | "light" | "system";
type ProviderId = "custom" | "deepseek" | "qwen";
type ApiSettingsView = "overview" | "providerConfig" | "providerList";
type SettingsTab = "about" | "account" | "api" | "appearance";

type ChatMessage = {
  content: string;
  id: string;
  role: MessageRole;
};

type FeedMessage = ChatMessage & {
  kind: "message";
};

type FeedActivity = {
  detail: string;
  id: string;
  kind: "activity";
  label: string;
  toolName?: string;
  type: ActivityType;
};

type FeedItem = FeedMessage | FeedActivity;

type SessionRecord = {
  createdAt: number;
  feed: FeedItem[];
  id: string;
  messages: ChatMessage[];
  researchContext?: string;
  runs: TraceRun[];
  title: string;
  updatedAt: number;
};

type AgentConsoleProps = {
  apiBaseUrl: string;
  hasApiKey: boolean;
  runtimeInfo: TraceRuntimeInfo;
  workspaceRoot: string;
};

type AppSettings = {
  customApiKey: string;
  customBaseUrl: string;
  customModel: string;
  deepseekApiKey: string;
  provider: ProviderId;
  qwenApiKey: string;
  theme: ThemeMode;
};

type TestConnectionState =
  | {
      status: "idle";
    }
  | {
      status: "testing";
    }
  | {
      message: string;
      status: "success";
    }
  | {
      message: string;
      status: "error";
    };

type ActiveAgentRequest = {
  controller: AbortController;
  runId?: string;
  sessionId: string;
  stopped: boolean;
};

const STARTER_PROMPTS = [
  "先帮我列出当前工作目录的文件结构。",
  "读取 README，如果没有就创建一个项目说明初稿。",
  "搜索最近关于 DeepSeek API 的文档更新并总结要点。",
];

const INITIAL_ASSISTANT_MESSAGE =
  "我可以读取文件、搜索网页、调用工具并整理研究报告。给我一个主题，或让我先检查当前工作区。";

const DEFAULT_SESSION_TITLE = "新研究会话";
const SESSIONS_STORAGE_KEY = "next-agent:sessions";
const ACTIVE_SESSION_STORAGE_KEY = "next-agent:active-session";
const SIDEBAR_STORAGE_KEY = "next-agent:sidebar-collapsed";
const INSPECTOR_STORAGE_KEY = "next-agent:inspector-collapsed";
const SETTINGS_STORAGE_KEY = "ranni:settings";
const PAGE_NAV_ITEMS = [
  {
    description: "当前对话和消息流",
    id: "chat",
    label: "会话",
  },
  {
    description: "查看最近生成的报告",
    id: "report",
    label: "报告",
  },
  {
    description: "进入运行详情二级页面",
    id: "trace",
    label: "运行详情",
  },
] as const satisfies Array<{
  description: string;
  id: ViewMode;
  label: string;
}>;
const SETTINGS_NAV_ITEMS = [
  {
    id: "account",
    label: "账号",
    status: "Local",
  },
  {
    id: "appearance",
    label: "外观",
    status: "Theme",
  },
  {
    id: "api",
    label: "API 设置",
    status: "Provider",
  },
  {
    id: "about",
    label: "关于",
    status: "Info",
  },
] as const satisfies Array<{
  id: SettingsTab;
  label: string;
  status: string;
}>;
const DEFAULT_SETTINGS: AppSettings = {
  customApiKey: "",
  customBaseUrl: "",
  customModel: "",
  deepseekApiKey: "",
  provider: "deepseek",
  qwenApiKey: "",
  theme: "dark",
};
const PROVIDER_OPTIONS = [
  {
    baseUrl: "https://api.deepseek.com",
    description: "默认使用 deepseek-v4-pro，只需要提供 DeepSeek API Key。",
    envKey: "DEEPSEEK_API_KEY",
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-v4-pro",
    provider: "deepseek-openai-compatible",
  },
  {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    description: "Qwen OpenAI 兼容接口，只需要提供 DashScope API Key。",
    envKey: "QWEN_API_KEY",
    id: "qwen",
    label: "Qwen",
    model: "qwen3.6-plus",
    provider: "qwen-openai-compatible",
  },
  {
    baseUrl: "",
    description: "连接任意 OpenAI-compatible 服务，需要提供 URL、模型和 API Key。",
    envKey: "LLM_API_KEY",
    id: "custom",
    label: "自定义 URL",
    model: "",
    provider: "custom-openai-compatible",
  },
] as const satisfies Array<{
  baseUrl: string;
  description: string;
  envKey: string;
  id: ProviderId;
  label: string;
  model: string;
  provider: string;
}>;
const STORAGE_PROFILES = [
  {
    activityDetailLimit: 3000,
    feedLimit: 180,
    includeTracePayloads: true,
    messageLimit: 120,
    runLimit: 6,
    sessionLimit: 8,
    stepLimit: 24,
    textLimit: 12000,
  },
  {
    activityDetailLimit: 1800,
    feedLimit: 120,
    includeTracePayloads: false,
    messageLimit: 90,
    runLimit: 4,
    sessionLimit: 6,
    stepLimit: 16,
    textLimit: 8000,
  },
  {
    activityDetailLimit: 900,
    feedLimit: 72,
    includeTracePayloads: false,
    messageLimit: 60,
    runLimit: 2,
    sessionLimit: 4,
    stepLimit: 10,
    textLimit: 4000,
  },
  {
    activityDetailLimit: 400,
    feedLimit: 40,
    includeTracePayloads: false,
    messageLimit: 40,
    runLimit: 0,
    sessionLimit: 3,
    stepLimit: 0,
    textLimit: 2000,
  },
] as const;

const EMPTY_RUNTIME_INFO: TraceRuntimeInfo = {
  baseUrl: "",
  contextWindow: null,
  maxTokens: 0,
  model: "未知模型",
  provider: "unknown-provider",
};

function createId() {
  return crypto.randomUUID();
}

function createAssistantMessage(): ChatMessage {
  return {
    id: createId(),
    role: "assistant",
    content: INITIAL_ASSISTANT_MESSAGE,
  };
}

function createSession(title = DEFAULT_SESSION_TITLE): SessionRecord {
  const initialAssistantMessage = createAssistantMessage();
  const now = Date.now();

  return {
    id: createId(),
    title,
    createdAt: now,
    updatedAt: now,
    researchContext: "",
    messages: [initialAssistantMessage],
    runs: [],
    feed: [
      {
        kind: "message",
        ...initialAssistantMessage,
      },
    ],
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "custom" || value === "deepseek" || value === "qwen";
}

function sanitizeSettings(raw: unknown): AppSettings {
  if (!isObject(raw)) {
    return DEFAULT_SETTINGS;
  }

  const legacyApiKey =
    typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  const provider = isProviderId(raw.provider)
    ? raw.provider
    : DEFAULT_SETTINGS.provider;

  return {
    customApiKey:
      typeof raw.customApiKey === "string"
        ? raw.customApiKey.trim()
        : provider === "custom"
          ? legacyApiKey
          : "",
    customBaseUrl:
      typeof raw.customBaseUrl === "string" ? raw.customBaseUrl.trim() : "",
    customModel:
      typeof raw.customModel === "string" ? raw.customModel.trim() : "",
    deepseekApiKey:
      typeof raw.deepseekApiKey === "string"
        ? raw.deepseekApiKey.trim()
        : provider === "deepseek"
          ? legacyApiKey
          : "",
    provider,
    qwenApiKey:
      typeof raw.qwenApiKey === "string"
        ? raw.qwenApiKey.trim()
        : provider === "qwen"
          ? legacyApiKey
          : "",
    theme: isThemeMode(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
  };
}

function shorten(value: string, maxLength = 320) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trimEnd()}…`
    : value;
}

function sanitizeFileNameSegment(value: string) {
  const normalized = value.trim().replace(/\s+/g, "-");

  return normalized
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function prettifyPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function trimStoredText(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trimEnd()}\n\n...[storage-trimmed]`
    : value;
}

function summarizeForStorage(value: unknown, maxLength: number) {
  if (typeof value === "string") {
    return trimStoredText(value, maxLength);
  }

  try {
    return trimStoredText(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return trimStoredText(String(value), maxLength);
  }
}

function deriveSessionTitle(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

function isCollapsibleToolResult(item: FeedActivity) {
  const collapsibleToolNames = new Set(["search_web", "fetch_url"]);
  const collapsibleLabels = new Set(["search_web 返回", "fetch_url 返回"]);

  return (
    item.type === "tool_result" &&
    (collapsibleToolNames.has(item.toolName ?? "") ||
      collapsibleLabels.has(item.label))
  );
}

function formatSessionTime(timestamp?: number) {
  if (typeof timestamp !== "number") {
    return "未记录";
  }

  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(durationMs?: number) {
  if (typeof durationMs !== "number") {
    return "进行中";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)} s`;
  }

  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number") {
    return "未配置";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatTokenCount(value?: number | null) {
  if (typeof value !== "number") {
    return "未知";
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

function isValidMessageRole(role: unknown): role is MessageRole {
  return role === "user" || role === "assistant";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeRuntimeInfo(raw: unknown): TraceRuntimeInfo {
  if (!isObject(raw)) {
    return EMPTY_RUNTIME_INFO;
  }

  return {
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
    contextWindow:
      typeof raw.contextWindow === "number" ? raw.contextWindow : null,
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : 0,
    model: typeof raw.model === "string" ? raw.model : "未知模型",
    provider:
      typeof raw.provider === "string" && raw.provider.trim()
        ? raw.provider
        : "unknown-provider",
  };
}

function sanitizeUsage(raw: unknown): TraceUsage {
  if (!isObject(raw)) {
    return {
      actualInputOccupancyRatio: null,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
      inputTokens: null,
      modelContextWindow: null,
      outputTokens: null,
      totalInputTokens: null,
    };
  }

  return {
    actualInputOccupancyRatio:
      typeof raw.actualInputOccupancyRatio === "number"
        ? raw.actualInputOccupancyRatio
        : null,
    cacheCreationInputTokens:
      typeof raw.cacheCreationInputTokens === "number"
        ? raw.cacheCreationInputTokens
        : null,
    cacheReadInputTokens:
      typeof raw.cacheReadInputTokens === "number"
        ? raw.cacheReadInputTokens
        : null,
    inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : null,
    modelContextWindow:
      typeof raw.modelContextWindow === "number" ? raw.modelContextWindow : null,
    outputTokens:
      typeof raw.outputTokens === "number" ? raw.outputTokens : null,
    totalInputTokens:
      typeof raw.totalInputTokens === "number" ? raw.totalInputTokens : null,
  };
}

function sanitizeContext(raw: unknown): TraceContextSnapshot | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    stats: isObject(raw.stats)
      ? {
          assistantMessageCount:
            typeof raw.stats.assistantMessageCount === "number"
              ? raw.stats.assistantMessageCount
              : 0,
          contentBlockCount:
            typeof raw.stats.contentBlockCount === "number"
              ? raw.stats.contentBlockCount
              : 0,
          estimatedInputOccupancyRatio:
            typeof raw.stats.estimatedInputOccupancyRatio === "number"
              ? raw.stats.estimatedInputOccupancyRatio
              : null,
          estimatedInputTokens:
            typeof raw.stats.estimatedInputTokens === "number"
              ? raw.stats.estimatedInputTokens
              : 0,
          modelContextWindow:
            typeof raw.stats.modelContextWindow === "number"
              ? raw.stats.modelContextWindow
              : null,
          serializedChars:
            typeof raw.stats.serializedChars === "number"
              ? raw.stats.serializedChars
              : 0,
          systemPromptChars:
            typeof raw.stats.systemPromptChars === "number"
              ? raw.stats.systemPromptChars
              : 0,
          toolCount:
            typeof raw.stats.toolCount === "number" ? raw.stats.toolCount : 0,
          userMessageCount:
            typeof raw.stats.userMessageCount === "number"
              ? raw.stats.userMessageCount
              : 0,
        }
      : {
          assistantMessageCount: 0,
          contentBlockCount: 0,
          estimatedInputOccupancyRatio: null,
          estimatedInputTokens: 0,
          modelContextWindow: null,
          serializedChars: 0,
          systemPromptChars: 0,
          toolCount: 0,
          userMessageCount: 0,
        },
    systemPrompt:
      typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    tools: Array.isArray(raw.tools) ? raw.tools : [],
  };
}

function sanitizeRequest(raw: unknown): TraceModelRequest | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    maxTokens: typeof raw.maxTokens === "number" ? raw.maxTokens : 0,
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    providerOptions:
      "providerOptions" in raw ? raw.providerOptions : undefined,
    runtime: sanitizeRuntimeInfo(raw.runtime),
    systemPrompt:
      typeof raw.systemPrompt === "string" ? raw.systemPrompt : "",
    tools: Array.isArray(raw.tools) ? raw.tools : [],
  };
}

function sanitizeResponse(raw: unknown): TraceModelResponse | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  return {
    content: Array.isArray(raw.content) ? raw.content : [],
    id: typeof raw.id === "string" ? raw.id : createId(),
    model: typeof raw.model === "string" ? raw.model : "未知模型",
    requestId:
      typeof raw.requestId === "string" ? raw.requestId : null,
    role: typeof raw.role === "string" ? raw.role : "assistant",
    stopReason:
      typeof raw.stopReason === "string" ? raw.stopReason : null,
    usage: sanitizeUsage(raw.usage),
  };
}

function sanitizeToolCall(raw: unknown): TraceToolCall | null {
  if (!isObject(raw) || typeof raw.id !== "string") {
    return null;
  }

  return {
    arguments: raw.arguments,
    endedAt: typeof raw.endedAt === "number" ? raw.endedAt : undefined,
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "unknown",
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    toolUseId: typeof raw.toolUseId === "string" ? raw.toolUseId : raw.id,
  };
}

function sanitizeToolResult(raw: unknown): TraceToolResult | null {
  if (!isObject(raw) || typeof raw.id !== "string") {
    return null;
  }

  return {
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : 0,
    endedAt: typeof raw.endedAt === "number" ? raw.endedAt : Date.now(),
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "unknown",
    result: typeof raw.result === "string" ? raw.result : "",
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    success: raw.success !== false,
    toolUseId: typeof raw.toolUseId === "string" ? raw.toolUseId : raw.id,
  };
}

function sanitizeStep(raw: unknown): TraceStep | null {
  if (!isObject(raw) || typeof raw.id !== "string") {
    return null;
  }

  const toolCalls = Array.isArray(raw.toolCalls)
    ? raw.toolCalls
        .map(sanitizeToolCall)
        .filter((item): item is TraceToolCall => item !== null)
    : [];
  const toolResults = Array.isArray(raw.toolResults)
    ? raw.toolResults
        .map(sanitizeToolResult)
        .filter((item): item is TraceToolResult => item !== null)
    : [];
  const statusMessages =
    Array.isArray(raw.statusMessages) && raw.statusMessages.every(isObject)
      ? raw.statusMessages.map((item) => ({
          at: typeof item.at === "number" ? item.at : Date.now(),
          message: typeof item.message === "string" ? item.message : "",
        }))
      : [];

  return {
    assistantText:
      typeof raw.assistantText === "string" ? raw.assistantText : "",
    context: sanitizeContext(raw.context),
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    endedAt: typeof raw.endedAt === "number" ? raw.endedAt : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    id: raw.id,
    request: sanitizeRequest(raw.request),
    researchState:
      typeof raw.researchState === "string" ? raw.researchState : undefined,
    response: sanitizeResponse(raw.response),
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    status:
      raw.status === "completed" ||
      raw.status === "failed" ||
      raw.status === "running" ||
      raw.status === "cancelled"
        ? raw.status
        : "completed",
    statusMessages,
    stepIndex: typeof raw.stepIndex === "number" ? raw.stepIndex : 1,
    stopReason:
      typeof raw.stopReason === "string" ? raw.stopReason : undefined,
    thinking: typeof raw.thinking === "string" ? raw.thinking : "",
    toolCalls,
    toolResults,
  };
}

function sanitizeRuns(raw: unknown): TraceRun[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((run) => {
      if (!isObject(run) || typeof run.id !== "string") {
        return null;
      }

      const steps = Array.isArray(run.steps)
        ? run.steps
            .map(sanitizeStep)
            .filter((item): item is TraceStep => item !== null)
        : [];

      return {
        durationMs:
          typeof run.durationMs === "number" ? run.durationMs : undefined,
        endedAt: typeof run.endedAt === "number" ? run.endedAt : undefined,
        error: typeof run.error === "string" ? run.error : undefined,
        finalAssistantMessage:
          typeof run.finalAssistantMessage === "string"
            ? run.finalAssistantMessage
            : undefined,
        id: run.id,
        prompt: typeof run.prompt === "string" ? run.prompt : "未知输入",
        runtime: sanitizeRuntimeInfo(run.runtime),
        startedAt:
          typeof run.startedAt === "number" ? run.startedAt : Date.now(),
        status:
          run.status === "completed" ||
          run.status === "failed" ||
          run.status === "running" ||
          run.status === "cancelled"
            ? run.status
            : "completed",
        steps,
        totalSteps:
          typeof run.totalSteps === "number" ? run.totalSteps : steps.length,
      } satisfies TraceRun;
    })
    .filter(Boolean) as TraceRun[];
}

function sanitizeSessions(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((session) => {
      if (typeof session !== "object" || session === null) {
        return null;
      }

      const candidate = session as Partial<SessionRecord> & {
        runs?: unknown;
      };

      if (
        typeof candidate.id !== "string" ||
        typeof candidate.title !== "string" ||
        typeof candidate.createdAt !== "number" ||
        typeof candidate.updatedAt !== "number" ||
        !Array.isArray(candidate.messages) ||
        !Array.isArray(candidate.feed)
      ) {
        return null;
      }

      const messages = candidate.messages.filter((message) => {
        if (typeof message !== "object" || message === null) {
          return false;
        }

        const maybeMessage = message as Partial<ChatMessage>;
        return (
          typeof maybeMessage.id === "string" &&
          typeof maybeMessage.content === "string" &&
          isValidMessageRole(maybeMessage.role)
        );
      }) as ChatMessage[];

      const feed = candidate.feed.filter((item) => {
        if (typeof item !== "object" || item === null) {
          return false;
        }

        const maybeItem = item as Partial<FeedItem>;

        if (maybeItem.kind === "message") {
          return (
            typeof maybeItem.id === "string" &&
            typeof maybeItem.content === "string" &&
            isValidMessageRole(maybeItem.role)
          );
        }

        if (maybeItem.kind === "activity") {
          return (
            typeof maybeItem.id === "string" &&
            typeof maybeItem.label === "string" &&
            typeof maybeItem.detail === "string" &&
            (maybeItem.type === "status" ||
              maybeItem.type === "tool_call" ||
              maybeItem.type === "tool_result" ||
              maybeItem.type === "error")
          );
        }

        return false;
      }) as FeedItem[];

      if (messages.length === 0 || feed.length === 0) {
        return null;
      }

      return {
        id: candidate.id,
        title: candidate.title,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        messages,
        researchContext:
          typeof candidate.researchContext === "string"
            ? candidate.researchContext
            : "",
        runs: sanitizeRuns(candidate.runs),
        feed,
      };
    })
    .filter(Boolean) as SessionRecord[];
}

function createEmptyRun(runId: string): TraceRun {
  return {
    id: runId,
    prompt: "未知输入",
    runtime: EMPTY_RUNTIME_INFO,
    startedAt: Date.now(),
    status: "running",
    steps: [],
    totalSteps: 0,
  };
}

function createEmptyStep(stepId: string, stepIndex: number): TraceStep {
  return {
    assistantText: "",
    id: stepId,
    startedAt: Date.now(),
    status: "running",
    statusMessages: [],
    stepIndex,
    thinking: "",
    toolCalls: [],
    toolResults: [],
  };
}

function upsertRun(
  runs: TraceRun[],
  runId: string,
  updater: (run: TraceRun) => TraceRun,
): TraceRun[] {
  const existingIndex = runs.findIndex((run) => run.id === runId);

  if (existingIndex === -1) {
    return [updater(createEmptyRun(runId)), ...runs];
  }

  return runs.map((run, index) => (index === existingIndex ? updater(run) : run));
}

function upsertStep(
  steps: TraceStep[],
  stepId: string,
  stepIndex: number,
  updater: (step: TraceStep) => TraceStep,
): TraceStep[] {
  const existingIndex = steps.findIndex((step) => step.id === stepId);

  if (existingIndex === -1) {
    return [...steps, updater(createEmptyStep(stepId, stepIndex))];
  }

  return steps.map((step, index) =>
    index === existingIndex ? updater(step) : step,
  );
}

function appendUniqueToolCall(step: TraceStep, nextCall: TraceToolCall) {
  const existingIndex = step.toolCalls.findIndex(
    (toolCall) => toolCall.toolUseId === nextCall.toolUseId,
  );

  if (existingIndex === -1) {
    return [...step.toolCalls, nextCall];
  }

  return step.toolCalls.map((toolCall, index) =>
    index === existingIndex ? { ...toolCall, ...nextCall } : toolCall,
  );
}

function appendUniqueToolResult(step: TraceStep, nextResult: TraceToolResult) {
  const existingIndex = step.toolResults.findIndex(
    (toolResult) => toolResult.toolUseId === nextResult.toolUseId,
  );

  if (existingIndex === -1) {
    return [...step.toolResults, nextResult];
  }

  return step.toolResults.map((toolResult, index) =>
    index === existingIndex ? { ...toolResult, ...nextResult } : toolResult,
  );
}

function findLatestStep(run: TraceRun) {
  return run.steps[run.steps.length - 1];
}

function applyTraceEventToSession(
  session: SessionRecord,
  event: StreamEvent,
): SessionRecord {
  const updatedAt = Date.now();

  if (event.type === "done") {
    return session;
  }

  if (event.type === "run_started") {
    return {
      ...session,
      updatedAt,
      runs: upsertRun(session.runs, event.runId, (run) => ({
        ...run,
        prompt: event.prompt || "未知输入",
        runtime: event.runtime,
        startedAt: event.startedAt,
        status: "running",
      })),
    };
  }

  if ("runId" in event && typeof event.runId === "string") {
    return {
      ...session,
      updatedAt,
      runs: upsertRun(session.runs, event.runId, (run) => {
        if (event.type === "step_started") {
          return {
            ...run,
            startedAt: Math.min(run.startedAt, event.startedAt),
            status: "running",
            totalSteps: Math.max(run.totalSteps, event.stepIndex),
            steps: upsertStep(
              run.steps,
              event.stepId,
              event.stepIndex,
              (step) => ({
                ...step,
                startedAt: event.startedAt,
                status: "running",
                stepIndex: event.stepIndex,
              }),
            ),
          };
        }

        if (
          event.type === "context_snapshot" ||
          event.type === "model_request" ||
          event.type === "model_response" ||
          event.type === "research_state" ||
          event.type === "thinking" ||
          event.type === "tool_call" ||
          event.type === "tool_result" ||
          event.type === "status" ||
          event.type === "assistant" ||
          event.type === "step_completed"
        ) {
          const stepId =
            "stepId" in event && typeof event.stepId === "string"
              ? event.stepId
              : findLatestStep(run)?.id;
          const stepIndex =
            "stepIndex" in event && typeof event.stepIndex === "number"
              ? event.stepIndex
              : findLatestStep(run)?.stepIndex ?? 1;

          if (!stepId) {
            if (event.type === "assistant") {
              return {
                ...run,
                finalAssistantMessage: event.message,
              };
            }

            return run;
          }

          return {
            ...run,
            finalAssistantMessage:
              event.type === "assistant"
                ? event.message
                : run.finalAssistantMessage,
            runtime:
              event.type === "model_request"
                ? event.request.runtime
                : run.runtime,
            steps: upsertStep(run.steps, stepId, stepIndex, (step) => {
              if (event.type === "context_snapshot") {
                return {
                  ...step,
                  context: event.context,
                };
              }

              if (event.type === "model_request") {
                return {
                  ...step,
                  request: event.request,
                };
              }

              if (event.type === "model_response") {
                return {
                  ...step,
                  response: event.response,
                  stopReason: event.response.stopReason,
                };
              }

              if (event.type === "research_state") {
                return {
                  ...step,
                  researchState: event.researchState,
                };
              }

              if (event.type === "thinking") {
                return {
                  ...step,
                  thinking: step.thinking
                    ? `${step.thinking}\n\n${event.message}`
                    : event.message,
                };
              }

              if (event.type === "status") {
                return {
                  ...step,
                  statusMessages: [
                    ...step.statusMessages,
                    {
                      at: event.timestamp,
                      message: event.message,
                    },
                  ],
                };
              }

              if (event.type === "tool_call") {
                return {
                  ...step,
                  toolCalls: appendUniqueToolCall(step, {
                    arguments: event.arguments,
                    id: `${event.toolUseId}:call`,
                    name: event.name,
                    startedAt: event.startedAt,
                    toolUseId: event.toolUseId,
                  }),
                };
              }

              if (event.type === "tool_result") {
                return {
                  ...step,
                  toolCalls: step.toolCalls.map((toolCall) =>
                    toolCall.toolUseId === event.toolUseId
                      ? {
                          ...toolCall,
                          endedAt: event.startedAt + event.durationMs,
                        }
                      : toolCall,
                  ),
                  toolResults: appendUniqueToolResult(step, {
                    durationMs: event.durationMs,
                    endedAt: event.startedAt + event.durationMs,
                    id: `${event.toolUseId}:result`,
                    name: event.name,
                    result: event.result,
                    startedAt: event.startedAt,
                    success: event.success,
                    toolUseId: event.toolUseId,
                  }),
                };
              }

              if (event.type === "assistant") {
                return {
                  ...step,
                  assistantText: event.message,
                };
              }

              if (event.type === "step_completed") {
                return {
                  ...step,
                  durationMs: event.durationMs,
                  endedAt: event.endedAt,
                  error:
                    event.status === "failed" || event.status === "cancelled"
                      ? run.error ?? step.error
                      : step.error,
                  status: event.status,
                  stopReason: event.stopReason ?? step.stopReason,
                };
              }

              return step;
            }),
          };
        }

        if (event.type === "run_completed") {
          return {
            ...run,
            durationMs: event.durationMs,
            endedAt: event.endedAt,
            error: event.error,
            status: event.status,
            totalSteps: Math.max(run.totalSteps, event.totalSteps),
          };
        }

        if (event.type === "error") {
          if (!event.stepId || typeof event.stepIndex !== "number") {
            return {
              ...run,
              error: event.message,
              status: "failed",
            };
          }

          return {
            ...run,
            error: event.message,
            status: "failed",
            steps: upsertStep(run.steps, event.stepId, event.stepIndex, (step) => ({
              ...step,
              error: event.message,
              status: "failed",
            })),
          };
        }

        return run;
      }),
    };
  }

  return session;
}

function createRunTitle(run: TraceRun) {
  const prompt = run.prompt.replace(/\s+/g, " ").trim();
  return prompt.length > 28 ? `${prompt.slice(0, 28)}…` : prompt || "未命名 Run";
}

function createWorkspaceLabel(workspaceRoot: string) {
  const normalized = workspaceRoot.replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length === 0) {
    return workspaceRoot || "未配置";
  }

  return parts.at(-1) ?? workspaceRoot;
}

function getProviderOption(provider: ProviderId) {
  return (
    PROVIDER_OPTIONS.find((option) => option.id === provider) ??
    PROVIDER_OPTIONS[0]
  );
}

function getProviderApiKey(settings: AppSettings) {
  if (settings.provider === "custom") {
    return settings.customApiKey.trim();
  }

  if (settings.provider === "qwen") {
    return settings.qwenApiKey.trim();
  }

  return settings.deepseekApiKey.trim();
}

function getProviderBaseUrl(settings: AppSettings) {
  const provider = getProviderOption(settings.provider);

  if (settings.provider === "custom") {
    return settings.customBaseUrl.trim();
  }

  return provider.baseUrl;
}

function getProviderModel(settings: AppSettings) {
  const provider = getProviderOption(settings.provider);

  if (settings.provider === "custom") {
    return settings.customModel.trim();
  }

  return provider.model;
}

function buildModelSettings(settings: AppSettings) {
  const provider = getProviderOption(settings.provider);

  return {
    apiKey: getProviderApiKey(settings),
    baseUrl: getProviderBaseUrl(settings),
    model: getProviderModel(settings),
    provider: provider.provider,
  };
}

function getProviderValidationMessage(
  settings: AppSettings,
  hasEnvironmentApiKey: boolean,
) {
  const hasApiKey = Boolean(getProviderApiKey(settings)) || hasEnvironmentApiKey;

  if (settings.provider === "custom") {
    if (!getProviderBaseUrl(settings)) {
      return "请先填写自定义 Provider URL。";
    }

    if (!getProviderModel(settings)) {
      return "请先填写自定义模型名称。";
    }

    if (!getProviderApiKey(settings)) {
      return "请先填写自定义 Provider API Key。";
    }

    return "";
  }

  if (!hasApiKey) {
    return `请先填写 ${getProviderOption(settings.provider).label} API Key。`;
  }

  return "";
}

function getStatusLabel(status?: string) {
  if (status === "running") {
    return "运行中";
  }

  if (status === "completed") {
    return "已完成";
  }

  if (status === "failed") {
    return "失败";
  }

  if (status === "cancelled") {
    return "已终止";
  }

  return "空闲";
}

function getCompletedStepCount(run?: TraceRun) {
  if (!run) {
    return 0;
  }

  return run.steps.filter((step) => step.status !== "running").length;
}

function hasReportSignals(content: string) {
  const normalized = content.trim();

  if (normalized.length > 600) {
    return true;
  }

  return (
    /^#{1,3}\s+\S/m.test(normalized) ||
    /^\s*[-*]\s+\S/m.test(normalized) ||
    /\[[^\]]+\]\([^)]+\)/.test(normalized) ||
    /^\|.+\|$/m.test(normalized)
  );
}

function getReportCandidate(messages: ChatMessage[]) {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        message.content !== INITIAL_ASSISTANT_MESSAGE &&
        hasReportSignals(message.content),
    );
}

function findToolResult(step: TraceStep | undefined, toolUseId: string) {
  return step?.toolResults.find((result) => result.toolUseId === toolUseId);
}

function compactInlinePayload(value: unknown, maxLength = 220) {
  return shorten(prettifyPayload(value).replace(/\s+/g, " "), maxLength);
}

function maskSecret(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "未配置";
  }

  if (trimmed.length <= 8) {
    return "已保存";
  }

  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function renderCodeBlock(value: unknown) {
  return prettifyPayload(value);
}

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("当前环境不支持复制。");
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function compactContextForStorage(
  context: TraceStep["context"],
  textLimit: number,
  includeTracePayloads: boolean,
) {
  if (!context) {
    return undefined;
  }

  return {
    ...context,
    messages: includeTracePayloads
      ? context.messages.slice(-8).map((message) => ({
          ...message,
          content: summarizeForStorage(message.content, Math.min(1200, textLimit)),
        }))
      : [],
    systemPrompt: includeTracePayloads
      ? trimStoredText(context.systemPrompt, Math.min(2500, textLimit))
      : "[storage-trimmed]",
    tools: includeTracePayloads
      ? context.tools.map((tool) => ({
          description: tool.description,
          name: tool.name,
        }))
      : context.tools.map((tool) => ({ name: tool.name })),
  };
}

function compactRequestForStorage(
  request: TraceStep["request"],
  textLimit: number,
  includeTracePayloads: boolean,
) {
  if (!request) {
    return undefined;
  }

  return {
    ...request,
    messages: includeTracePayloads
      ? request.messages.slice(-8).map((message) => summarizeForStorage(message, 800))
      : [],
    systemPrompt: includeTracePayloads
      ? trimStoredText(request.systemPrompt, Math.min(2000, textLimit))
      : "[storage-trimmed]",
    tools: request.tools.map((tool) => ({
      description: includeTracePayloads ? tool.description : undefined,
      name: tool.name,
    })),
  };
}

function compactResponseForStorage(
  response: TraceStep["response"],
  textLimit: number,
  includeTracePayloads: boolean,
) {
  if (!response) {
    return undefined;
  }

  return {
    ...response,
    content: includeTracePayloads
      ? response.content.slice(0, 4).map((item) => summarizeForStorage(item, 800))
      : [],
  };
}

function compactRunsForStorage(
  runs: TraceRun[],
  profile: (typeof STORAGE_PROFILES)[number],
) {
  if (profile.runLimit <= 0) {
    return [];
  }

  return runs.slice(0, profile.runLimit).map((run) => ({
    ...run,
    error: run.error ? trimStoredText(run.error, 600) : undefined,
    finalAssistantMessage: run.finalAssistantMessage
      ? trimStoredText(run.finalAssistantMessage, profile.textLimit)
      : undefined,
    prompt: trimStoredText(run.prompt, Math.min(1200, profile.textLimit)),
    steps: run.steps.slice(-profile.stepLimit).map((step) => ({
      ...step,
      assistantText: trimStoredText(step.assistantText, profile.textLimit),
      context: compactContextForStorage(
        step.context,
        profile.textLimit,
        profile.includeTracePayloads,
      ),
      error: step.error ? trimStoredText(step.error, 600) : undefined,
      request: compactRequestForStorage(
        step.request,
        profile.textLimit,
        profile.includeTracePayloads,
      ),
      researchState: step.researchState
        ? trimStoredText(step.researchState, Math.min(2400, profile.textLimit))
        : undefined,
      response: compactResponseForStorage(
        step.response,
        profile.textLimit,
        profile.includeTracePayloads,
      ),
      statusMessages: step.statusMessages.slice(-24).map((message) => ({
        ...message,
        message: trimStoredText(message.message, 400),
      })),
      thinking: trimStoredText(step.thinking, Math.min(4000, profile.textLimit)),
      toolCalls: step.toolCalls.slice(-24).map((toolCall) => ({
        ...toolCall,
        arguments: summarizeForStorage(toolCall.arguments, 500),
      })),
      toolResults: step.toolResults.slice(-24).map((toolResult) => ({
        ...toolResult,
        result: trimStoredText(toolResult.result, profile.activityDetailLimit),
      })),
    })),
  }));
}

function compactSessionsForStorage(
  sessions: SessionRecord[],
  profile: (typeof STORAGE_PROFILES)[number],
) {
  return sessions.slice(0, profile.sessionLimit).map((session) => {
    const messages = session.messages
      .slice(-profile.messageLimit)
      .map((message) => ({
        ...message,
        content: trimStoredText(message.content, profile.textLimit),
      }));
    const fallbackFeed = messages.map((message) => ({
      kind: "message" as const,
      ...message,
    }));
    const feed =
      profile.runLimit <= 0
        ? fallbackFeed
        : session.feed.slice(-profile.feedLimit).map((item) =>
            item.kind === "message"
              ? {
                  ...item,
                  content: trimStoredText(item.content, profile.textLimit),
                }
              : {
                  ...item,
                  detail: trimStoredText(item.detail, profile.activityDetailLimit),
                },
          );

    return {
      ...session,
      feed,
      messages,
      researchContext: session.researchContext
        ? trimStoredText(session.researchContext, Math.min(3000, profile.textLimit))
        : "",
      runs: compactRunsForStorage(session.runs, profile),
    };
  });
}

function persistSessionsToStorage(
  sessions: SessionRecord[],
  activeSessionId: string,
  isSidebarCollapsed: boolean,
  isInspectorCollapsed: boolean,
) {
  let lastError: unknown = null;

  for (const profile of STORAGE_PROFILES) {
    try {
      const payload = JSON.stringify(compactSessionsForStorage(sessions, profile));
      localStorage.setItem(SESSIONS_STORAGE_KEY, payload);
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      localStorage.setItem(
        SIDEBAR_STORAGE_KEY,
        isSidebarCollapsed ? "true" : "false",
      );
      localStorage.setItem(
        INSPECTOR_STORAGE_KEY,
        isInspectorCollapsed ? "true" : "false",
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  console.warn("Failed to persist sessions to localStorage after compaction.", lastError);
  localStorage.removeItem(SESSIONS_STORAGE_KEY);
  localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
  localStorage.setItem(
    SIDEBAR_STORAGE_KEY,
    isSidebarCollapsed ? "true" : "false",
  );
  localStorage.setItem(
    INSPECTOR_STORAGE_KEY,
    isInspectorCollapsed ? "true" : "false",
  );
}

export function AgentConsole({
  apiBaseUrl,
  hasApiKey,
  runtimeInfo,
  workspaceRoot,
}: AgentConsoleProps) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [activeView, setActiveView] = useState<ViewMode>("chat");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [selectedStepId, setSelectedStepId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isHydrated, setIsHydrated] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [apiSettingsView, setApiSettingsView] =
    useState<ApiSettingsView>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("api");
  const [testConnectionState, setTestConnectionState] =
    useState<TestConnectionState>({
      status: "idle",
    });
  const [messageActionState, setMessageActionState] = useState<{
    action: "copied" | "exported";
    id: string;
  } | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isFeedAtBottom, setIsFeedAtBottom] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const messageActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAgentRequestRef = useRef<ActiveAgentRequest | null>(null);

  const isNearBottom = (node: HTMLDivElement) =>
    node.scrollHeight - node.scrollTop - node.clientHeight <= 24;

  const scrollFeedToBottom = (behavior: ScrollBehavior = "smooth") => {
    const node = feedRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior,
    });
    setIsFeedAtBottom(true);
  };

  useEffect(() => {
    try {
      const storedSessions = localStorage.getItem(SESSIONS_STORAGE_KEY);
      const parsedSessions = sanitizeSessions(
        storedSessions ? JSON.parse(storedSessions) : [],
      );
      const initialSessions =
        parsedSessions.length > 0 ? parsedSessions : [createSession()];
      const storedActiveSessionId =
        localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ?? "";
      const activeSessionExists = initialSessions.some(
        (session) => session.id === storedActiveSessionId,
      );
      const storedSidebarCollapsed =
        localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
      const storedInspectorCollapsed =
        localStorage.getItem(INSPECTOR_STORAGE_KEY) === "true";
      const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);

      setSessions(initialSessions);
      setActiveSessionId(
        activeSessionExists ? storedActiveSessionId : initialSessions[0]!.id,
      );
      setIsSidebarCollapsed(storedSidebarCollapsed);
      setIsInspectorCollapsed(storedInspectorCollapsed);
      setSettings(
        sanitizeSettings(storedSettings ? JSON.parse(storedSettings) : null),
      );
    } catch {
      const fallbackSession = createSession();
      setSessions([fallbackSession]);
      setActiveSessionId(fallbackSession.id);
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [isHydrated, settings]);

  useEffect(() => {
    const applyTheme = () => {
      const resolvedTheme =
        settings.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : settings.theme;

      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = settings.theme;
    };
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    applyTheme();

    if (settings.theme !== "system") {
      return;
    }

    mediaQuery.addEventListener("change", applyTheme);

    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, [settings.theme]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    persistSessionsToStorage(
      sessions,
      activeSessionId,
      isSidebarCollapsed,
      isInspectorCollapsed,
    );
  }, [
    activeSessionId,
    isHydrated,
    isInspectorCollapsed,
    isSidebarCollapsed,
    sessions,
  ]);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  useEffect(() => {
    const node = feedRef.current;

    if (node && activeView === "chat" && sessions.length > 0) {
      scrollFeedToBottom("auto");
    }
  }, [activeSessionId, activeView, sessions.length]);

  useEffect(() => {
    const node = feedRef.current;

    if (!node || activeView !== "chat") {
      return;
    }

    const updateScrollState = () => {
      setIsFeedAtBottom(isNearBottom(node));
    };

    updateScrollState();
    node.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      node.removeEventListener("scroll", updateScrollState);
    };
  }, [activeSession?.id, activeView]);

  useEffect(() => {
    const node = feedRef.current;

    if (!node || activeView !== "chat") {
      return;
    }

    if (isFeedAtBottom) {
      scrollFeedToBottom("auto");
      return;
    }

    setIsFeedAtBottom(isNearBottom(node));
  }, [activeSession?.feed.length, activeView, isFeedAtBottom]);

  useEffect(() => {
    return () => {
      if (messageActionTimerRef.current) {
        clearTimeout(messageActionTimerRef.current);
      }

      activeAgentRequestRef.current?.controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return;
    }

    const nextRun =
      activeSession.runs.find((run) => run.id === selectedRunId) ??
      activeSession.runs[0];

    if (!nextRun) {
      setSelectedRunId("");
      setSelectedStepId("");
      return;
    }

    if (nextRun.id !== selectedRunId) {
      setSelectedRunId(nextRun.id);
    }

    const nextStep =
      nextRun.steps.find((step) => step.id === selectedStepId) ??
      nextRun.steps[nextRun.steps.length - 1];

    if (!nextStep) {
      setSelectedStepId("");
      return;
    }

    if (nextStep.id !== selectedStepId) {
      setSelectedStepId(nextStep.id);
    }
  }, [activeSession, selectedRunId, selectedStepId]);

  const orderedSessions = [...sessions].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );

  const flashMessageAction = (
    id: string,
    action: "copied" | "exported",
  ) => {
    setMessageActionState({ action, id });

    if (messageActionTimerRef.current) {
      clearTimeout(messageActionTimerRef.current);
    }

    messageActionTimerRef.current = setTimeout(() => {
      setMessageActionState((current) =>
        current?.id === id && current.action === action ? null : current,
      );
      messageActionTimerRef.current = null;
    }, 1800);
  };

  const copyMessageContent = async (message: ChatMessage) => {
    try {
      await copyTextToClipboard(message.content);
      flashMessageAction(message.id, "copied");
    } catch (error) {
      console.error("Failed to copy message content.", error);
    }
  };

  const exportMessageAsMarkdown = (message: ChatMessage) => {
    const sessionSegment = sanitizeFileNameSegment(activeSession?.title || "session");
    const fileName = `${sessionSegment || "session"}-${message.id.slice(0, 8)}.md`;
    const blob = new Blob([message.content], {
      type: "text/markdown;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    flashMessageAction(message.id, "exported");
  };

  const updateSession = (
    sessionId: string,
    updater: (session: SessionRecord) => SessionRecord,
  ) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === sessionId ? updater(session) : session,
      ),
    );
  };

  const appendActivity = (
    sessionId: string,
    type: ActivityType,
    label: string,
    detail: string,
    options?: {
      toolName?: string;
    },
  ) => {
    const nextItem: FeedActivity = {
      id: createId(),
      kind: "activity",
      type,
      label,
      detail,
      toolName: options?.toolName,
    };

    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      feed: [...session.feed, nextItem],
    }));
  };

  const markRunningRunCancelled = (sessionId: string, runId?: string) => {
    const endedAt = Date.now();

    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: endedAt,
      runs: session.runs.map((run) => {
        const shouldCancel =
          (runId ? run.id === runId : run.status === "running") &&
          run.status === "running";

        if (!shouldCancel) {
          return run;
        }

        return {
          ...run,
          durationMs: endedAt - run.startedAt,
          endedAt,
          error: "已手动终止运行。",
          status: "cancelled",
          steps: run.steps.map((step) =>
            step.status === "running"
              ? {
                  ...step,
                  durationMs: endedAt - step.startedAt,
                  endedAt,
                  error: "已手动终止运行。",
                  status: "cancelled",
                }
              : step,
          ),
        };
      }),
    }));
  };

  const applyTraceEvent = (sessionId: string, event: StreamEvent) => {
    updateSession(sessionId, (session) => applyTraceEventToSession(session, event));

    if (event.type === "run_started") {
      if (activeAgentRequestRef.current?.sessionId === sessionId) {
        activeAgentRequestRef.current.runId = event.runId;
      }

      setSelectedRunId(event.runId);
      setSelectedStepId("");
      return;
    }

    if (event.type === "step_started") {
      setSelectedRunId(event.runId);
      setSelectedStepId(event.stepId);
    }
  };

  const stopAgentRun = () => {
    const activeRequest = activeAgentRequestRef.current;

    if (!activeRequest || !isRunning) {
      return;
    }

    activeRequest.stopped = true;
    activeRequest.controller.abort();
    appendActivity(
      activeRequest.sessionId,
      "status",
      "状态",
      "已手动终止当前运行。",
    );
    markRunningRunCancelled(activeRequest.sessionId, activeRequest.runId);
    setIsRunning(false);
  };

  const createNewSession = () => {
    const nextSession = createSession();
    setSessions((current) => [nextSession, ...current]);
    setActiveSessionId(nextSession.id);
    setSelectedRunId("");
    setSelectedStepId("");
    setInput("");
  };

  const testModelSettings = async () => {
    const validationMessage = getProviderValidationMessage(
      settings,
      canUseEnvironmentApiKey,
    );

    if (validationMessage) {
      setTestConnectionState({
        status: "error",
        message: validationMessage,
      });
      return;
    }

    setTestConnectionState({ status: "testing" });

    try {
      const response = await fetch(`${apiBaseUrl}/api/model/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelSettings: buildModelSettings(settings),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          model?: string;
          provider?: string;
          requestId?: string | null;
        };
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "模型连接测试失败。");
      }

      setTestConnectionState({
        status: "success",
        message: [
          "连接成功",
          payload.result?.model ? `模型：${payload.result.model}` : "",
          payload.result?.requestId ? `request_id：${payload.result.requestId}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (error) {
      setTestConnectionState({
        status: "error",
        message:
          error instanceof Error ? error.message : "模型连接测试失败。",
      });
    }
  };

  const sendMessage = async (messageText: string) => {
    if (!activeSession) {
      return;
    }

    const trimmed = messageText.trim();

    if (!trimmed || isRunning) {
      return;
    }

    if (!isProviderReady) {
      setIsSettingsOpen(true);
      setSettingsTab("api");
      setApiSettingsView("providerConfig");
      setTestConnectionState({
        status: "error",
        message:
          getProviderValidationMessage(settings, canUseEnvironmentApiKey) ||
          "请先完成 Provider 配置。",
      });
      return;
    }

    const sessionId = activeSession.id;
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };
    const nextTitle =
      activeSession.title === DEFAULT_SESSION_TITLE
        ? deriveSessionTitle(trimmed)
        : activeSession.title;
    const history = [
      ...activeSession.messages,
      ...(activeSession.researchContext
        ? [
            {
              role: "assistant" as const,
              content: [
                "以下是当前 session 持续维护的 research notebook 摘要，请把它视为先前已经验证过的研究上下文，在新的请求里继续复用：",
                activeSession.researchContext,
              ].join("\n\n"),
            },
          ]
        : []),
      userMessage,
    ].map(({ role, content }) => ({
      role,
      content,
    }));
    const abortController = new AbortController();

    activeAgentRequestRef.current = {
      controller: abortController,
      sessionId,
      stopped: false,
    };
    setIsRunning(true);
    setInput("");
    updateSession(sessionId, (session) => ({
      ...session,
      title: nextTitle,
      updatedAt: Date.now(),
      messages: [...session.messages, userMessage],
      feed: [
        ...session.feed,
        {
          kind: "message",
          ...userMessage,
        },
      ],
    }));

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          messages: history,
          modelSettings: buildModelSettings(settings),
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || "接口请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantMessageId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();

        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const event = JSON.parse(line) as StreamEvent;
          applyTraceEvent(sessionId, event);

          if (event.type === "status") {
            appendActivity(sessionId, "status", "状态", shorten(event.message));
            continue;
          }

          if (event.type === "tool_call") {
            appendActivity(
              sessionId,
              "tool_call",
              `调用 ${event.name}`,
              prettifyPayload(event.arguments),
            );
            continue;
          }

          if (event.type === "tool_result") {
            appendActivity(
              sessionId,
              "tool_result",
              `${event.name} 返回`,
              event.result,
              {
                toolName: event.name,
              },
            );
            continue;
          }

          if (event.type === "research_state") {
            updateSession(sessionId, (session) => ({
              ...session,
              updatedAt: Date.now(),
              researchContext: event.researchState,
            }));
            continue;
          }

          if (event.type === "assistant") {
            const nextId: string = assistantMessageId ?? createId();
            assistantMessageId = nextId;

            updateSession(sessionId, (session) => {
              const nextMessage: ChatMessage = {
                id: nextId,
                role: "assistant",
                content: event.message,
              };
              const messageExists = session.messages.some(
                (message) => message.id === nextId,
              );
              const feedExists = session.feed.some(
                (item) => item.kind === "message" && item.id === nextId,
              );

              return {
                ...session,
                updatedAt: Date.now(),
                messages: messageExists
                  ? session.messages.map((message) =>
                      message.id === nextId ? nextMessage : message,
                    )
                  : [...session.messages, nextMessage],
                feed: feedExists
                  ? session.feed.map((item) =>
                      item.kind === "message" && item.id === nextId
                        ? {
                            kind: "message",
                            ...nextMessage,
                          }
                        : item,
                    )
                  : [
                      ...session.feed,
                      {
                        kind: "message",
                        ...nextMessage,
                      },
                    ],
              };
            });
            continue;
          }

          if (event.type === "error") {
            appendActivity(sessionId, "error", "错误", event.message);
          }
        }

        if (done) {
          break;
        }
      }
    } catch (caughtError) {
      const wasStopped = activeAgentRequestRef.current?.stopped;
      const isAbortError =
        caughtError instanceof DOMException && caughtError.name === "AbortError";

      if (wasStopped || isAbortError) {
        return;
      }

      const message =
        caughtError instanceof Error ? caughtError.message : "请求失败";
      appendActivity(sessionId, "error", "错误", message);
    } finally {
      if (activeAgentRequestRef.current?.controller === abortController) {
        activeAgentRequestRef.current = null;
      }

      setIsRunning(false);
    }
  };

  if (!isHydrated || !activeSession) {
    return (
      <main className={styles.shell}>
        <section className={styles.loadingCard}>正在加载本地会话...</section>
      </main>
    );
  }

  const selectedRun =
    activeSession.runs.find((run) => run.id === selectedRunId) ??
    activeSession.runs[0];
  const selectedStep =
    selectedRun?.steps.find((step) => step.id === selectedStepId) ??
    selectedRun?.steps[selectedRun.steps.length - 1];
  const reportCandidate = getReportCandidate(activeSession.messages);
  const completedStepCount = getCompletedStepCount(selectedRun);
  const latestStatusMessage =
    selectedStep?.statusMessages[selectedStep.statusMessages.length - 1];
  const workspaceLabel = createWorkspaceLabel(workspaceRoot);
  const selectedProvider = getProviderOption(settings.provider);
  const selectedProviderApiKey = getProviderApiKey(settings);
  const selectedProviderBaseUrl = getProviderBaseUrl(settings);
  const selectedProviderModel = getProviderModel(settings);
  const hasConfiguredModel = Boolean(selectedProviderApiKey);
  const canUseEnvironmentApiKey =
    settings.provider !== "custom" &&
    hasApiKey &&
    runtimeInfo.provider === selectedProvider.provider;
  const effectiveHasApiKey = hasConfiguredModel || canUseEnvironmentApiKey;
  const isProviderReady =
    Boolean(selectedProviderBaseUrl) &&
    Boolean(selectedProviderModel) &&
    effectiveHasApiKey;
  const settingsRuntimeInfo = {
    ...runtimeInfo,
    baseUrl: selectedProviderBaseUrl || runtimeInfo.baseUrl,
    model: selectedProviderModel || runtimeInfo.model,
    provider: selectedProvider.provider,
  };
  const inspectorRuntime = selectedRun?.runtime ?? settingsRuntimeInfo;
  const apiStatusLabel = !effectiveHasApiKey
    ? "Missing key"
    : hasConfiguredModel
      ? `Connected · ${maskSecret(selectedProviderApiKey)}`
      : "Connected via env";
  const workspaceClassName = [
    styles.workspace,
    isSidebarCollapsed ? styles.workspaceCollapsed : "",
    isInspectorCollapsed ? styles.workspaceInspectorCollapsed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={styles.shell}>
      <div className={workspaceClassName}>
        {!isSidebarCollapsed ? (
          <aside className={styles.sidebar} aria-label="导航栏">
            <div className={styles.brandBlock}>
              <img
                className={styles.brandMark}
                src="/logo-192.png"
                alt=""
                aria-hidden="true"
              />
              <div className={styles.brandText}>
                <strong>Ranni</strong>
                <span>导航栏</span>
              </div>
            </div>

            <div className={styles.sidebarTop}>
              <button
                className={styles.primarySidebarButton}
                type="button"
                onClick={createNewSession}
              >
                新研究会话
              </button>
            </div>

            <section className={styles.sidebarNavSection}>
              <div className={styles.sidebarLabel}>页面</div>
              <div className={styles.sidebarNavList}>
                {PAGE_NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    className={`${styles.sidebarNavButton} ${
                      activeView === item.id ? styles.sidebarNavButtonActive : ""
                    }`}
                    type="button"
                    onClick={() => setActiveView(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            </section>

            <div className={styles.sidebarLabel}>
              {`历史 Session · ${sessions.length}`}
            </div>

            <div className={styles.sessionList}>
              {orderedSessions.map((session, index) => {
                const isActive = session.id === activeSession.id;

                return (
                  <button
                    key={session.id}
                    className={`${styles.sessionItem} ${
                      isActive ? styles.sessionItemActive : ""
                    }`}
                    type="button"
                    onClick={() => setActiveSessionId(session.id)}
                    title={session.title}
                  >
                    <div className={styles.sessionIndex}>{index + 1}</div>
                    <div className={styles.sessionMeta}>
                      <strong>{session.title}</strong>
                      <span>{formatSessionTime(session.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className={styles.sidebarFooter}>
              <button
                className={styles.sidebarUtilityButton}
                type="button"
                onClick={() => {
                  setIsInfoOpen(false);
                  setSettingsTab("api");
                  setApiSettingsView("overview");
                  setIsSettingsOpen(true);
                }}
              >
                <span>设置</span>
                <small>Provider / 外观 / 关于</small>
              </button>
            </div>
          </aside>
        ) : null}

        <section className={styles.chatShell} aria-label="会话栏">
          <div className={styles.chatHeader}>
            <div className={styles.headerTitle}>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={isSidebarCollapsed ? "展开会话列表" : "隐藏会话列表"}
                onClick={() => setIsSidebarCollapsed((current) => !current)}
              >
                {isSidebarCollapsed ? ">" : "<"}
              </button>
              <h2>{activeSession.title}</h2>
            </div>
            <div className={styles.headerControls}>
              <div className={styles.chatMeta}>
                <span>{formatSessionTime(activeSession.updatedAt)}</span>
                <span>{isRunning ? "执行中" : "空闲"}</span>
                <span>
                  {isProviderReady ? settingsRuntimeInfo.provider : "模型未连接"}
                </span>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label={
                  isInspectorCollapsed ? "展开运行状态栏" : "隐藏运行状态栏"
                }
                onClick={() => setIsInspectorCollapsed((current) => !current)}
              >
                {isInspectorCollapsed ? "<" : ">"}
              </button>
            </div>
          </div>

          {activeView === "chat" ? (
            <div className={styles.feedWrap}>
              <div className={styles.feed} ref={feedRef}>
                {activeSession.feed.map((item) =>
                  item.kind === "message" ? (
                    <article
                      key={item.id}
                      className={`${styles.message} ${
                        item.role === "assistant"
                          ? styles.assistantMessage
                          : styles.userMessage
                      }`}
                    >
                      {item.role === "assistant" ? (
                        <>
                          <MarkdownContent content={item.content} />
                          <div className={styles.messageToolbar}>
                            <div className={styles.messageActions}>
                              <button
                                className={styles.messageActionButton}
                                type="button"
                                onClick={() => {
                                  void copyMessageContent(item);
                                }}
                              >
                                {messageActionState?.id === item.id &&
                                messageActionState.action === "copied"
                                  ? "已复制"
                                  : "复制"}
                              </button>
                              <button
                                className={styles.messageActionButton}
                                type="button"
                                onClick={() => exportMessageAsMarkdown(item)}
                              >
                                {messageActionState?.id === item.id &&
                                messageActionState.action === "exported"
                                  ? "已导出"
                                  : "导出 .md"}
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p>{item.content}</p>
                      )}
                    </article>
                  ) : (
                    <article
                      key={item.id}
                      className={`${styles.activity} ${styles[item.type]}`}
                    >
                      {isCollapsibleToolResult(item) ? (
                        <details className={styles.activityDisclosure}>
                          <summary className={styles.activitySummary}>
                            <div className={styles.activityLabel}>{item.label}</div>
                            <span className={styles.activitySummaryHint}>
                              点击展开结果
                            </span>
                          </summary>
                          <pre>{item.detail}</pre>
                        </details>
                      ) : (
                        <>
                          <div className={styles.activityLabel}>{item.label}</div>
                          <pre>{item.detail}</pre>
                        </>
                      )}
                    </article>
                  ),
                )}
              </div>
              {!isFeedAtBottom ? (
                <button
                  className={styles.scrollToBottomButton}
                  type="button"
                  onClick={() => scrollFeedToBottom()}
                >
                  ↓ 底部
                </button>
              ) : null}
            </div>
          ) : activeView === "report" ? (
            <div className={styles.reportWrap}>
              {reportCandidate ? (
                <article className={styles.reportCanvas}>
                  <header className={styles.reportHeader}>
                    <div>
                      <p>Report Preview</p>
                      <h1>{activeSession.title}</h1>
                      <span>
                        最近更新于 {formatSessionTime(activeSession.updatedAt)}
                      </span>
                    </div>
                    <div className={styles.reportActions}>
                      <button
                        className={styles.messageActionButton}
                        type="button"
                        onClick={() => {
                          void copyMessageContent(reportCandidate);
                        }}
                      >
                        {messageActionState?.id === reportCandidate.id &&
                        messageActionState.action === "copied"
                          ? "已复制"
                          : "复制报告"}
                      </button>
                      <button
                        className={styles.messageActionButton}
                        type="button"
                        onClick={() => exportMessageAsMarkdown(reportCandidate)}
                      >
                        {messageActionState?.id === reportCandidate.id &&
                        messageActionState.action === "exported"
                          ? "已导出"
                          : "导出 .md"}
                      </button>
                    </div>
                  </header>
                  <MarkdownContent content={reportCandidate.content} />
                </article>
              ) : (
                <div className={styles.reportEmpty}>
                  <p>Report Preview</p>
                  <h2>还没有可预览的研究报告</h2>
                  <span>
                    让 Ranni 调研一个主题、核查资料或整理结构化报告后，这里会显示最近一条 Markdown 输出。
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.traceShell}>
              <aside className={styles.traceSidebar}>
                <div className={styles.traceSidebarHeader}>
                  <h3>Runs</h3>
                  <span>{activeSession.runs.length}</span>
                </div>
                <div className={styles.traceRunList}>
                  {activeSession.runs.length === 0 ? (
                    <div className={styles.traceEmpty}>
                      还没有运行记录。发送一条消息后，这里会展示每一轮的模型输入、输出和工具轨迹。
                    </div>
                  ) : (
                    activeSession.runs.map((run) => {
                      const isRunActive = run.id === selectedRun?.id;

                      return (
                        <article
                          key={run.id}
                          className={`${styles.runCard} ${
                            isRunActive ? styles.runCardActive : ""
                          }`}
                        >
                          <button
                            className={styles.runButton}
                            type="button"
                            onClick={() => {
                              setSelectedRunId(run.id);
                              setSelectedStepId(
                                run.steps[run.steps.length - 1]?.id ?? "",
                              );
                            }}
                          >
                            <div className={styles.runCardTop}>
                              <strong>{createRunTitle(run)}</strong>
                              <span>{run.status}</span>
                            </div>
                            <div className={styles.runCardMeta}>
                              <span>{formatSessionTime(run.startedAt)}</span>
                              <span>{formatDuration(run.durationMs)}</span>
                              <span>{run.steps.length} steps</span>
                            </div>
                          </button>

                          {isRunActive && run.steps.length > 0 ? (
                            <div className={styles.stepList}>
                              {run.steps.map((step) => (
                                <button
                                  key={step.id}
                                  className={`${styles.stepButton} ${
                                    step.id === selectedStep?.id
                                      ? styles.stepButtonActive
                                      : ""
                                  }`}
                                  type="button"
                                  onClick={() => setSelectedStepId(step.id)}
                                >
                                  <div>
                                    <strong>Step {step.stepIndex}</strong>
                                    <span>{step.status}</span>
                                  </div>
                                  <span>{formatDuration(step.durationMs)}</span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  )}
                </div>
              </aside>

              <section className={styles.traceDetailPanel}>
                {selectedRun ? (
                  <>
                    <div className={styles.traceSummaryGrid}>
                      <article className={styles.summaryCard}>
                        <span>模型</span>
                        <strong>{selectedRun.runtime.model}</strong>
                      </article>
                      <article className={styles.summaryCard}>
                        <span>Run 状态</span>
                        <strong>{selectedRun.status}</strong>
                      </article>
                      <article className={styles.summaryCard}>
                        <span>耗时</span>
                        <strong>{formatDuration(selectedRun.durationMs)}</strong>
                      </article>
                      <article className={styles.summaryCard}>
                        <span>总步数</span>
                        <strong>{selectedRun.totalSteps || selectedRun.steps.length}</strong>
                      </article>
                    </div>

                    <article className={styles.traceBlock}>
                      <div className={styles.traceBlockHeader}>
                        <h3>Run Overview</h3>
                        <span>{formatSessionTime(selectedRun.startedAt)}</span>
                      </div>
                      <pre>{selectedRun.prompt}</pre>
                    </article>

                    {selectedStep ? (
                      <>
                        <div className={styles.traceSummaryGrid}>
                          <article className={styles.summaryCard}>
                            <span>Step</span>
                            <strong>{selectedStep.stepIndex}</strong>
                          </article>
                          <article className={styles.summaryCard}>
                            <span>Stop Reason</span>
                            <strong>{selectedStep.stopReason ?? "未知"}</strong>
                          </article>
                          <article className={styles.summaryCard}>
                            <span>Input Tokens</span>
                            <strong>
                              {formatTokenCount(
                                selectedStep.response?.usage.totalInputTokens ??
                                  selectedStep.context?.stats.estimatedInputTokens,
                              )}
                            </strong>
                          </article>
                          <article className={styles.summaryCard}>
                            <span>Context 占用</span>
                            <strong>
                              {formatPercent(
                                selectedStep.response?.usage.actualInputOccupancyRatio ??
                                  selectedStep.context?.stats
                                    .estimatedInputOccupancyRatio,
                              )}
                            </strong>
                          </article>
                        </div>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Step Overview</h3>
                            <span>{formatDuration(selectedStep.durationMs)}</span>
                          </div>
                          <div className={styles.kvGrid}>
                            <div>
                              <span>Request ID</span>
                              <strong>
                                {selectedStep.response?.requestId ?? "未知"}
                              </strong>
                            </div>
                            <div>
                              <span>Started At</span>
                              <strong>{formatSessionTime(selectedStep.startedAt)}</strong>
                            </div>
                            <div>
                              <span>Output Tokens</span>
                              <strong>
                                {formatTokenCount(
                                  selectedStep.response?.usage.outputTokens,
                                )}
                              </strong>
                            </div>
                            <div>
                              <span>Cache Read</span>
                              <strong>
                                {formatTokenCount(
                                  selectedStep.response?.usage.cacheReadInputTokens,
                                )}
                              </strong>
                            </div>
                          </div>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>System Prompt</h3>
                            <span>
                              {selectedStep.context?.stats.systemPromptChars ?? 0} chars
                            </span>
                          </div>
                          <pre>{selectedStep.context?.systemPrompt ?? "(empty)"}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Conversation Snapshot</h3>
                            <span>
                              {selectedStep.context?.messages.length ?? 0} messages
                            </span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.context?.messages ?? [])}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Tool Definitions</h3>
                            <span>
                              {selectedStep.context?.stats.toolCount ?? 0} tools
                            </span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.context?.tools ?? [])}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Model Request</h3>
                            <span>{selectedStep.request?.runtime.baseUrl ?? ""}</span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.request ?? {})}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Model Response</h3>
                            <span>{selectedStep.response?.stopReason ?? "未知"}</span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.response ?? {})}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Thinking</h3>
                            <span>
                              {selectedStep.thinking
                                ? `${selectedStep.thinking.length} chars`
                                : "无"}
                            </span>
                          </div>
                          <pre>{selectedStep.thinking || "(no thinking blocks)"}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Status Messages</h3>
                            <span>{selectedStep.statusMessages.length}</span>
                          </div>
                          <pre>
                            {renderCodeBlock(selectedStep.statusMessages)}
                          </pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Tool Calls</h3>
                            <span>{selectedStep.toolCalls.length}</span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.toolCalls)}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Tool Results</h3>
                            <span>{selectedStep.toolResults.length}</span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.toolResults)}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Assistant Output</h3>
                            <span>
                              {selectedStep.assistantText
                                ? `${selectedStep.assistantText.length} chars`
                                : "无"}
                            </span>
                          </div>
                          <pre>{selectedStep.assistantText || "(no assistant text)"}</pre>
                        </article>
                      </>
                    ) : (
                      <div className={styles.traceEmpty}>
                        当前 run 还没有 step。模型开始调用后，这里会出现每一步的上下文快照、请求体和响应体。
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.traceEmpty}>
                    当前 session 还没有 Trace 数据。
                  </div>
                )}
              </section>
            </div>
          )}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(input);
            }}
          >
            <div className={styles.composerInputWrap}>
              <textarea
                className={styles.textarea}
                name="prompt"
                placeholder="Ask Ranni to inspect files, browse, research, or draft a report..."
                rows={3}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) {
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();

                    if (!isRunning && input.trim()) {
                      void sendMessage(input);
                    }
                  }
                }}
              />
              {isRunning ? (
                <button
                  className={`${styles.submitButton} ${styles.stopButton}`}
                  type="button"
                  onClick={stopAgentRun}
                >
                  停止
                </button>
              ) : (
                <button
                  className={styles.submitButton}
                  disabled={!input.trim() || !effectiveHasApiKey}
                  type="submit"
                >
                  {effectiveHasApiKey ? "发送" : "先设置 Key"}
                </button>
              )}
            </div>
          </form>
        </section>

        {!isInspectorCollapsed ? (
          <aside className={styles.inspector} aria-label="运行状态栏">
            <div className={styles.inspectorTopBar}>
              <div>
                <span>Run Monitor</span>
                <strong>运行状态栏</strong>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="隐藏运行状态栏"
                onClick={() => setIsInspectorCollapsed(true)}
              >
                &gt;
              </button>
            </div>

          <section className={styles.inspectorSection}>
            <div className={styles.inspectorHeader}>
              <h3>Current Run</h3>
              <span
                className={`${styles.statusPill} ${
                  selectedRun ? styles[selectedRun.status] : ""
                }`}
              >
                {getStatusLabel(selectedRun?.status)}
              </span>
            </div>

            {selectedRun ? (
              <div className={styles.inspectorMetrics}>
                <div>
                  <span>Started</span>
                  <strong>{formatSessionTime(selectedRun.startedAt)}</strong>
                </div>
                <div>
                  <span>Duration</span>
                  <strong>{formatDuration(selectedRun.durationMs)}</strong>
                </div>
                <div>
                  <span>Steps</span>
                  <strong>
                    {completedStepCount}/
                    {selectedRun.totalSteps || selectedRun.steps.length}
                  </strong>
                </div>
              </div>
            ) : (
              <p className={styles.inspectorEmpty}>
                发送任务后，这里会显示本轮执行状态。
              </p>
            )}
          </section>

          <section className={styles.inspectorSection}>
            <div className={styles.inspectorHeader}>
              <h3>Step Progress</h3>
              <span>{selectedRun?.steps.length ?? 0}</span>
            </div>
            {selectedRun && selectedRun.steps.length > 0 ? (
              <div className={styles.inspectorStepList}>
                {selectedRun.steps.map((step) => (
                  <button
                    key={step.id}
                    className={`${styles.inspectorStep} ${
                      step.id === selectedStep?.id ? styles.inspectorStepActive : ""
                    }`}
                    type="button"
                    onClick={() => {
                      setActiveView("trace");
                      setSelectedRunId(selectedRun.id);
                      setSelectedStepId(step.id);
                    }}
                  >
                    <span>Step {step.stepIndex}</span>
                    <strong>{getStatusLabel(step.status)}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.inspectorEmpty}>暂无 step。</p>
            )}
            {latestStatusMessage ? (
              <p className={styles.latestStatus}>
                {shorten(latestStatusMessage.message, 140)}
              </p>
            ) : null}
          </section>

          <section className={styles.inspectorSection}>
            <div className={styles.inspectorHeader}>
              <h3>Tool Calls</h3>
              <span>{selectedStep?.toolCalls.length ?? 0}</span>
            </div>
            {selectedStep && selectedStep.toolCalls.length > 0 ? (
              <div className={styles.toolInspectorList}>
                {selectedStep.toolCalls.map((toolCall) => {
                  const toolResult = findToolResult(selectedStep, toolCall.toolUseId);

                  return (
                    <details
                      key={toolCall.id}
                      className={styles.toolInspectorCard}
                    >
                      <summary>
                        <span>{toolCall.name}</span>
                        <strong
                          className={`${styles.statusPill} ${
                            toolResult
                              ? styles[toolResult.success ? "completed" : "failed"]
                              : styles.running
                          }`}
                        >
                          {toolResult
                            ? toolResult.success
                              ? "success"
                              : "failed"
                            : "running"}
                        </strong>
                      </summary>
                      <p>{compactInlinePayload(toolCall.arguments)}</p>
                      <pre>{renderCodeBlock(toolCall.arguments)}</pre>
                      {toolResult ? (
                        <>
                          <p>
                            {formatDuration(toolResult.durationMs)} ·{" "}
                            {shorten(toolResult.result, 180)}
                          </p>
                          <pre>{toolResult.result}</pre>
                        </>
                      ) : null}
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className={styles.inspectorEmpty}>当前 step 没有工具调用。</p>
            )}
          </section>

          <section className={styles.inspectorSection}>
            <div className={styles.inspectorHeader}>
              <h3>Runtime</h3>
              <span>{inspectorRuntime.provider}</span>
            </div>
            <div className={styles.inspectorMetrics}>
              <div>
                <span>Model</span>
                <strong>{inspectorRuntime.model}</strong>
              </div>
              <div>
                <span>Max Tokens</span>
                <strong>{formatTokenCount(inspectorRuntime.maxTokens)}</strong>
              </div>
              <div>
                <span>Context</span>
                <strong>{formatTokenCount(inspectorRuntime.contextWindow)}</strong>
              </div>
            </div>
          </section>

          <section className={styles.inspectorSection}>
            <div className={styles.inspectorHeader}>
              <h3>Research Signals</h3>
              <span>{activeSession.researchContext ? "Active" : "Idle"}</span>
            </div>
            {selectedStep?.researchState || activeSession.researchContext ? (
              <pre className={styles.researchSignal}>
                {shorten(
                  selectedStep?.researchState ?? activeSession.researchContext ?? "",
                  900,
                )}
              </pre>
            ) : (
              <p className={styles.inspectorEmpty}>
                Research notebook 尚未产生状态。
              </p>
            )}
          </section>
          </aside>
        ) : null}
      </div>

      {isSettingsOpen ? (
        <>
          <button
            aria-label="关闭设置"
            className={styles.modalBackdrop}
            type="button"
            onClick={() => setIsSettingsOpen(false)}
          />

          <section
            aria-labelledby="ranni-settings-title"
            className={styles.settingsModal}
            role="dialog"
            aria-modal="true"
          >
            <aside className={styles.settingsSidebar}>
              <div className={styles.settingsBrand}>
                <p>Ranni Settings</p>
                <h3 id="ranni-settings-title">设置</h3>
              </div>

              <nav className={styles.settingsNavList} aria-label="设置导航">
                {SETTINGS_NAV_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    className={`${styles.settingsNavItem} ${
                      settingsTab === item.id ? styles.settingsNavItemActive : ""
                    }`}
                    type="button"
                    onClick={() => {
                      setSettingsTab(item.id);

                      if (item.id === "api") {
                        setApiSettingsView("overview");
                      }
                    }}
                  >
                    <span>{item.label}</span>
                    <small>{item.status}</small>
                  </button>
                ))}
              </nav>

              <div className={styles.settingsSidebarSummary}>
                <span>Provider</span>
                <strong>{selectedProvider.label}</strong>
                <small>{isProviderReady ? "Ready" : "Missing key"}</small>
              </div>
            </aside>

            <section className={styles.settingsContent}>
              <header className={styles.settingsHeader}>
                <div>
                  <p>
                    {settingsTab === "account"
                      ? "Local Profile"
                      : settingsTab === "appearance"
                        ? "Theme"
                        : settingsTab === "api"
                          ? apiSettingsView === "providerList"
                            ? "Provider Catalog"
                            : apiSettingsView === "providerConfig"
                              ? "Provider Credentials"
                              : "Model Provider"
                          : "About"}
                  </p>
                  <h3>
                    {settingsTab === "account"
                      ? "账号"
                      : settingsTab === "appearance"
                        ? "外观"
                        : settingsTab === "api"
                          ? apiSettingsView === "providerList"
                            ? "选择 Provider"
                            : apiSettingsView === "providerConfig"
                              ? selectedProvider.label
                              : "API 设置"
                          : "关于"}
                  </h3>
                </div>
                <button
                  className={styles.iconButton}
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  ×
                </button>
              </header>

              <div className={styles.settingsContentBody}>
                {settingsTab === "account" ? (
                  <>
                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>本地账号</h4>
                        <span>local</span>
                      </div>
                      <div className={styles.settingsProfileBlock}>
                        <div className={styles.settingsAvatar}>R</div>
                        <div>
                          <strong>本地工作区用户</strong>
                          <span>{workspaceLabel}</span>
                        </div>
                      </div>
                    </section>

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>同步状态</h4>
                        <span>offline</span>
                      </div>
                      <p className={styles.settingsHint}>
                        当前版本仅使用本机浏览器存储保存会话、主题和 Provider 配置。
                      </p>
                    </section>
                  </>
                ) : null}

                {settingsTab === "appearance" ? (
                  <section className={styles.settingsSection}>
                    <div className={styles.settingsSectionHeader}>
                      <h4>主题</h4>
                      <span>{settings.theme}</span>
                    </div>
                    <div className={styles.themeSegmented}>
                      {(["dark", "light", "system"] as const).map((theme) => (
                        <button
                          key={theme}
                          className={`${styles.themeButton} ${
                            settings.theme === theme ? styles.themeButtonActive : ""
                          }`}
                          type="button"
                          onClick={() =>
                            setSettings((current) => ({
                              ...current,
                              theme,
                            }))
                          }
                        >
                          {theme === "dark"
                            ? "深色"
                            : theme === "light"
                              ? "浅色"
                              : "跟随系统"}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {settingsTab === "api" && apiSettingsView === "overview" ? (
                  <>
                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>当前 Provider</h4>
                        <span>{isProviderReady ? "ready" : "missing"}</span>
                      </div>
                      <button
                        className={styles.settingsNavButton}
                        type="button"
                        onClick={() => setApiSettingsView("providerList")}
                      >
                        <span>模型服务</span>
                        <strong>{selectedProvider.label}</strong>
                        <small>
                          {selectedProviderModel || "未配置模型"} ·{" "}
                          {selectedProviderBaseUrl || "未配置 URL"}
                        </small>
                      </button>
                    </section>

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>连接状态</h4>
                        <span>{apiStatusLabel}</span>
                      </div>
                      <div className={styles.settingsInfoGrid}>
                        <div>
                          <span>Provider</span>
                          <strong>{settingsRuntimeInfo.provider}</strong>
                        </div>
                        <div>
                          <span>Model</span>
                          <strong>{settingsRuntimeInfo.model}</strong>
                        </div>
                        <div>
                          <span>Endpoint</span>
                          <strong>{settingsRuntimeInfo.baseUrl}</strong>
                        </div>
                      </div>
                      <div className={styles.settingsActions}>
                        <button
                          className={styles.primarySettingsButton}
                          type="button"
                          onClick={() => setApiSettingsView("providerConfig")}
                        >
                          配置 Key
                        </button>
                        <button
                          className={styles.secondarySettingsButton}
                          type="button"
                          onClick={() => setApiSettingsView("providerList")}
                        >
                          更换 Provider
                        </button>
                      </div>
                    </section>
                  </>
                ) : null}

                {settingsTab === "api" && apiSettingsView === "providerList" ? (
                  <section className={styles.settingsSection}>
                    <div className={styles.settingsSectionHeader}>
                      <h4>选择 Provider</h4>
                      <span>{selectedProvider.label}</span>
                    </div>
                    <div className={styles.providerOptionList}>
                      {PROVIDER_OPTIONS.map((provider) => (
                        <button
                          key={provider.id}
                          className={`${styles.providerOptionButton} ${
                            settings.provider === provider.id
                              ? styles.providerOptionButtonActive
                              : ""
                          }`}
                          type="button"
                          onClick={() => {
                            setSettings((current) => ({
                              ...current,
                              provider: provider.id,
                            }));
                            setTestConnectionState({ status: "idle" });
                            setApiSettingsView("providerConfig");
                          }}
                        >
                          <span>{provider.label}</span>
                          <strong>
                            {provider.id === "custom" ? "Custom URL" : provider.model}
                          </strong>
                          <small>{provider.description}</small>
                        </button>
                      ))}
                    </div>
                    <button
                      className={styles.secondarySettingsButton}
                      type="button"
                      onClick={() => setApiSettingsView("overview")}
                    >
                      返回 API 设置
                    </button>
                  </section>
                ) : null}

                {settingsTab === "api" && apiSettingsView === "providerConfig" ? (
                  <section className={styles.settingsSection}>
                    <div className={styles.settingsSectionHeader}>
                      <h4>{selectedProvider.label}</h4>
                      <span>{isProviderReady ? "ready" : "missing"}</span>
                    </div>

                    {settings.provider === "custom" ? (
                      <>
                        <label className={styles.settingsField}>
                          <span>Provider URL</span>
                          <input
                            type="url"
                            placeholder="https://api.example.com"
                            value={settings.customBaseUrl}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                customBaseUrl: event.target.value,
                              }));
                              setTestConnectionState({ status: "idle" });
                            }}
                          />
                        </label>

                        <label className={styles.settingsField}>
                          <span>Model</span>
                          <input
                            type="text"
                            placeholder="model-name"
                            value={settings.customModel}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                customModel: event.target.value,
                              }));
                              setTestConnectionState({ status: "idle" });
                            }}
                          />
                        </label>
                      </>
                    ) : (
                      <div className={styles.settingsInfoGrid}>
                        <div>
                          <span>Provider URL</span>
                          <strong>{selectedProvider.baseUrl}</strong>
                        </div>
                        <div>
                          <span>Model</span>
                          <strong>{selectedProvider.model}</strong>
                        </div>
                      </div>
                    )}

                    <label className={styles.settingsField}>
                      <span>API Key</span>
                      <input
                        type="password"
                        autoComplete="off"
                        placeholder="sk-..."
                        value={selectedProviderApiKey}
                        onChange={(event) => {
                          const nextApiKey = event.target.value;

                          setSettings((current) => {
                            if (current.provider === "custom") {
                              return {
                                ...current,
                                customApiKey: nextApiKey,
                              };
                            }

                            if (current.provider === "qwen") {
                              return {
                                ...current,
                                qwenApiKey: nextApiKey,
                              };
                            }

                            return {
                              ...current,
                              deepseekApiKey: nextApiKey,
                            };
                          });
                          setTestConnectionState({ status: "idle" });
                        }}
                      />
                    </label>

                    <div className={styles.settingsActions}>
                      <button
                        className={styles.primarySettingsButton}
                        disabled={
                          testConnectionState.status === "testing" ||
                          Boolean(
                            getProviderValidationMessage(
                              settings,
                              canUseEnvironmentApiKey,
                            ),
                          )
                        }
                        type="button"
                        onClick={() => {
                          void testModelSettings();
                        }}
                      >
                        {testConnectionState.status === "testing"
                          ? "测试中..."
                          : "测试连接"}
                      </button>
                      <button
                        className={styles.secondarySettingsButton}
                        type="button"
                        onClick={() => {
                          setSettings((current) => {
                            if (current.provider === "custom") {
                              return {
                                ...current,
                                customApiKey: "",
                              };
                            }

                            if (current.provider === "qwen") {
                              return {
                                ...current,
                                qwenApiKey: "",
                              };
                            }

                            return {
                              ...current,
                              deepseekApiKey: "",
                            };
                          });
                          setTestConnectionState({ status: "idle" });
                        }}
                      >
                        清空 Key
                      </button>
                      <button
                        className={styles.secondarySettingsButton}
                        type="button"
                        onClick={() => setApiSettingsView("providerList")}
                      >
                        更换 Provider
                      </button>
                    </div>

                    {testConnectionState.status !== "idle" ? (
                      <p
                        className={`${styles.connectionNotice} ${
                          testConnectionState.status === "success"
                            ? styles.connectionNoticeSuccess
                            : testConnectionState.status === "error"
                              ? styles.connectionNoticeError
                              : ""
                        }`}
                      >
                        {testConnectionState.status === "testing"
                          ? `正在请求 ${settingsRuntimeInfo.provider}...`
                          : testConnectionState.message}
                      </p>
                    ) : (
                      <p className={styles.settingsHint}>
                        预置 Provider 只需要填写 Key；自定义 URL 需要额外填写服务地址和模型名称。
                      </p>
                    )}
                  </section>
                ) : null}

                {settingsTab === "about" ? (
                  <>
                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>Ranni</h4>
                        <span>Local AI Agent</span>
                      </div>
                      <div className={styles.settingsInfoGrid}>
                        <div>
                          <span>Workspace</span>
                          <strong>{workspaceLabel}</strong>
                        </div>
                        <div>
                          <span>Runtime</span>
                          <strong>{settingsRuntimeInfo.provider}</strong>
                        </div>
                        <div>
                          <span>Model</span>
                          <strong>{settingsRuntimeInfo.model}</strong>
                        </div>
                      </div>
                    </section>

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>数据</h4>
                        <span>browser</span>
                      </div>
                      <p className={styles.settingsHint}>
                        会话、主题和 API 设置保存在当前浏览器环境。敏感 Key 仅用于本地请求后端测试和对话。
                      </p>
                    </section>
                  </>
                ) : null}
              </div>
            </section>
          </section>
        </>
      ) : null}

      {isInfoOpen ? (
        <>
          <button
            aria-label="关闭辅助信息"
            className={styles.infoBackdrop}
            type="button"
            onClick={() => setIsInfoOpen(false)}
          />

          <section className={styles.infoPanel}>
            <div className={styles.infoPanelHeader}>
              <h3>辅助信息</h3>
              <button
                className={styles.iconButton}
                type="button"
                onClick={() => setIsInfoOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.infoGrid}>
              <article className={styles.infoCard}>
                <span>工作空间</span>
                <strong>{workspaceRoot}</strong>
              </article>
              <article className={styles.infoCard}>
                <span>模型状态</span>
                <strong>
                  {effectiveHasApiKey ? "API Key 已配置" : "缺少 API Key"}
                </strong>
              </article>
              <article className={styles.infoCard}>
                <span>模型配置</span>
                <strong>
                  {settingsRuntimeInfo.model}
                  {settingsRuntimeInfo.contextWindow
                    ? ` · ${formatTokenCount(settingsRuntimeInfo.contextWindow)} ctx`
                    : ""}
                </strong>
              </article>
              <article className={styles.infoCard}>
                <span>能力边界</span>
                <strong>终端 / 文件读写删改 / 网页搜索 / 页面抓取 / Run Trace</strong>
              </article>
            </div>

            <div className={styles.infoPromptList}>
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className={styles.infoPromptButton}
                  type="button"
                  onClick={() => {
                    setInput(prompt);
                    setIsInfoOpen(false);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>

            {!effectiveHasApiKey ? (
              <div className={styles.inlineWarning}>
                需要在设置中填入 API Key，或在环境变量中配置 LLM_API_KEY。浏览器设置里的 Key 会保存在本机存储中。
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {!isSettingsOpen ? (
        <button
          aria-label={isInfoOpen ? "关闭辅助信息" : "打开辅助信息"}
          className={styles.floatingInfoButton}
          title="辅助信息"
          type="button"
          onClick={() => setIsInfoOpen((current) => !current)}
        >
          {isInfoOpen ? "x" : "i"}
        </button>
      ) : null}
    </main>
  );
}
