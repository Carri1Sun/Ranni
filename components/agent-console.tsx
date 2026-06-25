"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpenText,
  CheckCircle2,
  CircleDot,
  Database,
  FileText,
  Globe2,
  Info,
  Loader2,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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
import {
  ACTION_MODES,
  VERIFICATION_STATUSES,
  type TaskState,
} from "../lib/task-state";

import { MarkdownContent } from "./markdown-content";
import styles from "./agent-console.module.css";

type MessageRole = "user" | "assistant";
type ActivityType =
  | "status"
  | "tool_call"
  | "tool_result"
  | "error"
  | "step"
  | "state"
  | "research"
  | "thinking";
type ViewMode = "chat" | "report" | "trace";
type ThemeMode = "dark" | "light" | "system";
type ProviderId = "custom" | "deepseek" | "openai" | "qwen";
type SettingsTab = "about" | "account" | "api" | "appearance" | "debug";
type WorkspacePickerMode = "draftSession" | "initial";

type ProcessIconId =
  | "activity"
  | "check"
  | "database"
  | "error"
  | "file"
  | "globe"
  | "research"
  | "search"
  | "spark"
  | "state"
  | "terminal"
  | "tool";

type ActivityDisplay = {
  detail: string;
  icon: ProcessIconId;
  meta?: string;
  source?: "fallback" | "model";
  title: string;
};

type ChatMessage = {
  content: string;
  id: string;
  role: MessageRole;
};

type FeedMessage = ChatMessage & {
  kind: "message";
};

type FeedActivity = {
  display?: ActivityDisplay;
  detail: string;
  eventType?: StreamEvent["type"] | "manual";
  id: string;
  kind: "activity";
  label: string;
  runId?: string;
  stepId?: string;
  stepIndex?: number;
  toolName?: string;
  toolUseId?: string;
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
  workspaceRoot: string;
};

type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
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
  computerUseApiKey: string;
  computerUseModel: string;
  deepseekApiKey: string;
  openaiApiKey: string;
  openaiModel: string;
  provider: ProviderId;
  qwenApiKey: string;
  showThinkingInFeed: boolean;
  showProcessDetails: boolean;
  tavilyApiKey: string;
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

type ActivityDebugTarget = {
  activityId: string;
  sessionId: string;
};

const STARTER_PROMPTS = [
  "先帮我列出当前工作目录的文件结构。",
  "读取 README，如果没有就创建一个项目说明初稿。",
  "搜索最近关于 DeepSeek API 的文档更新并总结要点。",
];

const INITIAL_ASSISTANT_MESSAGE =
  "我可以读取文件、搜索网页、调用工具并整理研究报告。给我一个主题，或让我先检查当前工作区。";

const DEFAULT_SESSION_TITLE = "新研究会话";
const SESSION_TITLE_MAX_LENGTH = 15;
const SESSIONS_STORAGE_KEY = "next-agent:sessions";
const ACTIVE_SESSION_STORAGE_KEY = "next-agent:active-session";
const SIDEBAR_STORAGE_KEY = "next-agent:sidebar-collapsed";
const INSPECTOR_STORAGE_KEY = "next-agent:inspector-collapsed";
const SETTINGS_STORAGE_KEY = "ranni:settings";
const WORKSPACE_DIRECTORIES_STORAGE_KEY = "next-agent:workspace-directories";
const INSPECTOR_OVERLAY_MEDIA_QUERY = "(max-width: 1279px)";
const SIDEBAR_OVERLAY_MEDIA_QUERY = "(max-width: 1279px)";
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
    id: "debug",
    label: "Debug",
    status: "Trace",
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
  computerUseApiKey: "",
  computerUseModel: "",
  deepseekApiKey: "",
  openaiApiKey: "",
  openaiModel: "",
  provider: "deepseek",
  qwenApiKey: "",
  showThinkingInFeed: true,
  showProcessDetails: false,
  tavilyApiKey: "",
  theme: "dark",
};
const PROCESS_ICON_IDS = [
  "activity",
  "check",
  "database",
  "error",
  "file",
  "globe",
  "research",
  "search",
  "spark",
  "state",
  "terminal",
  "tool",
] as const satisfies ProcessIconId[];
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
    baseUrl: "https://api.openai.com/v1",
    description: "OpenAI 官方 API，默认使用 gpt-5.5。",
    envKey: "OPENAI_API_KEY",
    id: "openai",
    label: "OpenAI",
    model: "gpt-5.5",
    provider: "openai",
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
const TRACE_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly TraceRun["status"][];

const EMPTY_RUNTIME_INFO: TraceRuntimeInfo = {
  baseUrl: "",
  contextWindow: null,
  maxTokens: 0,
  model: "未知模型",
  provider: "unknown-provider",
};
const PROCESS_ICON_COMPONENTS: Record<ProcessIconId, LucideIcon> = {
  activity: CircleDot,
  check: CheckCircle2,
  database: Database,
  error: AlertCircle,
  file: FileText,
  globe: Globe2,
  research: BookOpenText,
  search: Search,
  spark: Sparkles,
  state: Loader2,
  terminal: SquareTerminal,
  tool: Wrench,
};

function createId() {
  return crypto.randomUUID();
}

function getProcessIconComponent(icon: ProcessIconId) {
  return PROCESS_ICON_COMPONENTS[icon] ?? CircleDot;
}

function createAssistantMessage(): ChatMessage {
  return {
    id: createId(),
    role: "assistant",
    content: INITIAL_ASSISTANT_MESSAGE,
  };
}

function createSession({
  id,
  includeInitialAssistantMessage = true,
  title = DEFAULT_SESSION_TITLE,
  workspaceRoot,
}: {
  id?: string;
  includeInitialAssistantMessage?: boolean;
  title?: string;
  workspaceRoot: string;
}): SessionRecord {
  const initialAssistantMessage = includeInitialAssistantMessage
    ? createAssistantMessage()
    : undefined;
  const now = Date.now();

  return {
    id: id ?? createId(),
    title,
    createdAt: now,
    updatedAt: now,
    workspaceRoot,
    researchContext: "",
    messages: initialAssistantMessage ? [initialAssistantMessage] : [],
    runs: [],
    feed: initialAssistantMessage
      ? [
          {
            kind: "message",
            ...initialAssistantMessage,
          },
        ]
      : [],
  };
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system";
}

function isProviderId(value: unknown): value is ProviderId {
  return (
    value === "custom" ||
    value === "deepseek" ||
    value === "openai" ||
    value === "qwen"
  );
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
    computerUseApiKey:
      typeof raw.computerUseApiKey === "string"
        ? raw.computerUseApiKey.trim()
        : "",
    computerUseModel:
      typeof raw.computerUseModel === "string" ? raw.computerUseModel.trim() : "",
    deepseekApiKey:
      typeof raw.deepseekApiKey === "string"
        ? raw.deepseekApiKey.trim()
        : provider === "deepseek"
          ? legacyApiKey
          : "",
    openaiApiKey:
      typeof raw.openaiApiKey === "string"
        ? raw.openaiApiKey.trim()
        : provider === "openai"
          ? legacyApiKey
          : "",
    openaiModel:
      typeof raw.openaiModel === "string" ? raw.openaiModel.trim() : "",
    provider,
    qwenApiKey:
      typeof raw.qwenApiKey === "string"
        ? raw.qwenApiKey.trim()
        : provider === "qwen"
          ? legacyApiKey
          : "",
    showThinkingInFeed:
      typeof raw.showThinkingInFeed === "boolean"
        ? raw.showThinkingInFeed
        : DEFAULT_SETTINGS.showThinkingInFeed,
    showProcessDetails:
      typeof raw.showProcessDetails === "boolean"
        ? raw.showProcessDetails
        : DEFAULT_SETTINGS.showProcessDetails,
    tavilyApiKey:
      typeof raw.tavilyApiKey === "string" ? raw.tavilyApiKey.trim() : "",
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

function createTimestampFileSegment(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
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

function normalizeSessionTitle(value: string) {
  const normalized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(标题|名称|会话名|session\s*title)\s*[:：]\s*/i, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^[`"'“”‘’「『《【[(（\s]+/, "")
    .replace(/[`"'“”‘’」』》】\])）\s。.!！?？,，、:：;；]+$/, "")
    .trim();

  return Array.from(normalized).slice(0, SESSION_TITLE_MAX_LENGTH).join("");
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

function getObjectField(value: unknown, key: string) {
  return isObject(value) ? value[key] : undefined;
}

function getStringField(value: unknown, key: string) {
  const field = getObjectField(value, key);

  return typeof field === "string" ? field.trim() : "";
}

function getNumberField(value: unknown, key: string) {
  const field = getObjectField(value, key);

  return typeof field === "number" ? field : undefined;
}

function compactText(value: string, maxLength = 80) {
  return shorten(value.replace(/\s+/g, " ").trim(), maxLength);
}

function compactPathLabel(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= 2) {
    return normalized || "未指定路径";
  }

  return `${parts.at(-2)}/${parts.at(-1)}`;
}

function getUrlHost(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function getToolDisplayName(toolName: string) {
  const labels: Record<string, string> = {
    delete_path: "删除路径",
    fetch_url: "读取网页",
    init_task_memory: "初始化任务记忆",
    list_files: "列出文件",
    move_path: "移动路径",
    plan_research: "规划研究",
    read_file: "读取文件",
    read_task_memory: "读取任务记忆",
    record_research_finding: "记录研究发现",
    record_task_evidence: "记录证据",
    review_research_state: "检查研究状态",
    run_terminal: "运行终端命令",
    save_research_checkpoint: "保存研究快照",
    save_task_checkpoint: "保存任务快照",
    search_in_files: "搜索工作区文件",
    search_web: "搜索网页",
    update_task_memory: "更新任务记忆",
    update_task_state: "更新任务状态",
    write_file: "写入文件",
  };

  return labels[toolName] ?? toolName.replace(/_/g, " ");
}

function getToolIcon(toolName: string): ProcessIconId {
  if (toolName === "search_web" || toolName === "search_in_files") {
    return "search";
  }

  if (toolName === "fetch_url") {
    return "globe";
  }

  if (
    toolName === "read_file" ||
    toolName === "write_file" ||
    toolName === "move_path" ||
    toolName === "delete_path" ||
    toolName === "list_files"
  ) {
    return "file";
  }

  if (toolName === "run_terminal") {
    return "terminal";
  }

  if (toolName.includes("memory")) {
    return "database";
  }

  if (toolName.includes("research")) {
    return "research";
  }

  if (toolName === "update_task_state") {
    return "state";
  }

  return "tool";
}

function inferSearchIntent(query: string) {
  const normalized = query
    .replace(/\b(site|filetype|intitle|inurl):\S+/gi, "")
    .replace(/[|"'“”‘’`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "相关信息";
  }

  if (/骨片/.test(normalized) && /(刷|获取|途径|来源|掉落|获得)/.test(normalized)) {
    return "骨片获取途径";
  }

  if (/(官方|文档|docs?|api|sdk|reference)/i.test(normalized)) {
    const topic = normalized
      .replace(/官方|文档|docs?|api|sdk|reference/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    return topic ? `${compactText(topic, 10)}官方文档` : "官方文档";
  }

  const stopWords = new Set([
    "怎么",
    "如何",
    "为什么",
    "是否",
    "教程",
    "攻略",
    "方法",
    "最新",
    "查询",
    "搜索",
    "获取",
    "获得",
    "途径",
    "刷",
    "the",
    "a",
    "an",
    "how",
    "to",
    "latest",
  ]);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !stopWords.has(token.toLowerCase()));
  const compacted = tokens.slice(0, 3).join(" ") || normalized;

  return compactText(compacted, 14);
}

function createToolCallDisplay(toolName: string, args: unknown): ActivityDisplay {
  const displayName = getToolDisplayName(toolName);
  const icon = getToolIcon(toolName);

  if (toolName === "search_web") {
    const query = getStringField(args, "query");
    const maxResults = getNumberField(args, "max_results");

    return {
      detail: query ? `Query: ${compactText(query, 72)}` : "准备搜索公开网页",
      icon,
      meta: maxResults ? `最多 ${maxResults} 条` : "web",
      source: "fallback",
      title: `搜索${inferSearchIntent(query)}`,
    };
  }

  if (toolName === "fetch_url") {
    const url = getStringField(args, "url");

    return {
      detail: url ? getUrlHost(url) : "准备读取页面正文",
      icon,
      meta: "url",
      source: "fallback",
      title: "读取网页内容",
    };
  }

  if (toolName === "run_terminal") {
    const command = getStringField(args, "command");

    return {
      detail: command ? compactText(command, 86) : "准备执行终端命令",
      icon,
      meta: "terminal",
      source: "fallback",
      title: "运行终端命令",
    };
  }

  if (toolName === "search_in_files") {
    const query = getStringField(args, "query");
    const targetPath = getStringField(args, "path");

    return {
      detail: [
        query ? `查找 ${compactText(query, 44)}` : "查找文本",
        targetPath ? `范围 ${compactPathLabel(targetPath)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      icon,
      meta: "workspace",
      source: "fallback",
      title: "搜索工作区文件",
    };
  }

  if (
    toolName === "read_file" ||
    toolName === "write_file" ||
    toolName === "move_path" ||
    toolName === "delete_path" ||
    toolName === "list_files"
  ) {
    const targetPath =
      getStringField(args, "path") ||
      getStringField(args, "from") ||
      getStringField(args, "to");

    return {
      detail: targetPath ? compactPathLabel(targetPath) : "工作区路径",
      icon,
      meta: "file",
      source: "fallback",
      title: displayName,
    };
  }

  if (toolName === "update_task_state") {
    const currentMode = getStringField(args, "currentMode");
    const nextAction = getStringField(args, "nextAction");

    return {
      detail: compactText(nextAction || currentMode || "刷新结构化任务状态", 88),
      icon,
      meta: currentMode || "state",
      source: "fallback",
      title: "更新任务状态",
    };
  }

  return {
    detail: compactInlinePayload(args, 88),
    icon,
    meta: "tool",
    source: "fallback",
    title: displayName,
  };
}

function createToolResultDisplay({
  durationMs,
  result,
  success,
  toolName,
}: {
  durationMs?: number;
  result: string;
  success?: boolean;
  toolName: string;
}): ActivityDisplay {
  const displayName = getToolDisplayName(toolName);

  return {
    detail: compactText(result, 110),
    icon: success === false ? "error" : "check",
    meta: formatDuration(durationMs),
    source: "fallback",
    title: success === false ? `${displayName}失败` : `${displayName}完成`,
  };
}

function createStatusDisplay(message: string): ActivityDisplay {
  const compactMessage = compactText(message, 110);

  if (/已连接/.test(message)) {
    return {
      detail: compactMessage,
      icon: "spark",
      meta: "run",
      source: "fallback",
      title: "开始分析请求",
    };
  }

  if (/重试|暂时不稳定/.test(message)) {
    return {
      detail: compactMessage,
      icon: "activity",
      meta: "retry",
      source: "fallback",
      title: "模型请求重试",
    };
  }

  if (message.length > 180) {
    return {
      detail: compactMessage,
      icon: "spark",
      meta: "thinking",
      source: "fallback",
      title: "整理执行思路",
    };
  }

  return {
    detail: compactMessage,
    icon: "activity",
    meta: "status",
    source: "fallback",
    title: "更新运行状态",
  };
}

function createThinkingDisplay(message: string): ActivityDisplay {
  const normalized = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  return {
    detail: compactText(normalized || message, 180),
    icon: "spark",
    meta: "thinking",
    source: "fallback",
    title: "模型思考",
  };
}

function createTaskStateDisplay(taskState: TaskState): ActivityDisplay {
  return {
    detail: compactText(taskState.nextAction || taskState.goal || "任务状态已刷新", 100),
    icon: "state",
    meta: taskState.currentMode,
    source: "fallback",
    title: "更新任务状态",
  };
}

function createStepCompletedDisplay({
  durationMs,
  status,
  stepIndex,
}: {
  durationMs?: number;
  status: "failed" | "cancelled";
  stepIndex: number;
}): ActivityDisplay {
  return {
    detail:
      status === "cancelled"
        ? "本轮已被手动终止"
        : "本轮执行失败，详情见调试信息",
    icon: status === "cancelled" ? "activity" : "error",
    meta: formatDuration(durationMs),
    source: "fallback",
    title:
      status === "cancelled" ? `终止第 ${stepIndex} 轮` : `第 ${stepIndex} 轮失败`,
  };
}

function createRunStartedDisplay(): ActivityDisplay {
  return {
    detail: "已建立本轮 run，开始进入 agent loop",
    icon: "spark",
    meta: "run",
    source: "fallback",
    title: "开始执行任务",
  };
}

function createRunCompletedDisplay({
  durationMs,
  status,
  totalSteps,
}: {
  durationMs?: number;
  status: "completed" | "failed" | "cancelled";
  totalSteps: number;
}): ActivityDisplay {
  return {
    detail: `共 ${totalSteps} 轮 · ${formatDuration(durationMs)}`,
    icon: status === "completed" ? "check" : status === "cancelled" ? "activity" : "error",
    meta: getStatusLabel(status),
    source: "fallback",
    title:
      status === "completed"
        ? "任务执行完成"
        : status === "cancelled"
          ? "任务已终止"
          : "任务执行失败",
  };
}

function createResearchDisplay(): ActivityDisplay {
  return {
    detail: "研究笔记已产生新的结构化状态",
    icon: "research",
    meta: "research",
    source: "fallback",
    title: "更新研究笔记",
  };
}

function createErrorDisplay(message: string): ActivityDisplay {
  return {
    detail: compactText(message, 120),
    icon: "error",
    meta: "error",
    source: "fallback",
    title: "运行出现错误",
  };
}

function createFallbackActivityDisplay(
  type: ActivityType,
  label: string,
  detail: string,
  toolName?: string,
): ActivityDisplay {
  if (type === "tool_call" && toolName) {
    return createToolCallDisplay(toolName, detail);
  }

  if (type === "tool_result" && toolName) {
    return createToolResultDisplay({
      result: detail,
      success: true,
      toolName,
    });
  }

  if (type === "error") {
    return createErrorDisplay(detail);
  }

  if (type === "thinking") {
    return createThinkingDisplay(detail);
  }

  return {
    detail: compactText(detail || label, 110),
    icon:
      type === "state"
        ? "state"
        : type === "research"
          ? "research"
          : "activity",
    meta: type,
    source: "fallback",
    title: compactText(label, 28),
  };
}

function isValidMessageRole(role: unknown): role is MessageRole {
  return role === "user" || role === "assistant";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProcessIconId(value: unknown): value is ProcessIconId {
  return (
    typeof value === "string" &&
    (PROCESS_ICON_IDS as readonly string[]).includes(value)
  );
}

function sanitizeActivityDisplay(raw: unknown): ActivityDisplay | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  if (typeof raw.title !== "string" || typeof raw.detail !== "string") {
    return undefined;
  }

  return {
    detail: raw.detail,
    icon: isProcessIconId(raw.icon) ? raw.icon : "activity",
    meta: typeof raw.meta === "string" ? raw.meta : undefined,
    source: raw.source === "model" ? "model" : "fallback",
    title: raw.title,
  };
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

function sanitizeStringList(raw: unknown) {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizeTaskMemory(raw: unknown): TaskState["memory"] {
  if (!isObject(raw)) {
    return undefined;
  }

  const todo = isObject(raw.todo) ? raw.todo : {};

  return {
    initialized: raw.initialized === true,
    latestCheckpointPath:
      typeof raw.latestCheckpointPath === "string"
        ? raw.latestCheckpointPath
        : null,
    relativeRunDirectory:
      typeof raw.relativeRunDirectory === "string"
        ? raw.relativeRunDirectory
        : "",
    runDirectory:
      typeof raw.runDirectory === "string" ? raw.runDirectory : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    todo: {
      blocked: typeof todo.blocked === "number" ? todo.blocked : 0,
      doing: typeof todo.doing === "number" ? todo.doing : 0,
      done: typeof todo.done === "number" ? todo.done : 0,
      pending: typeof todo.pending === "number" ? todo.pending : 0,
      skipped: typeof todo.skipped === "number" ? todo.skipped : 0,
      total: typeof todo.total === "number" ? todo.total : 0,
    },
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

function sanitizeTaskState(raw: unknown): TaskState | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const verification = isObject(raw.verification) ? raw.verification : {};
  const currentMode = (ACTION_MODES as readonly string[]).includes(
    String(raw.currentMode),
  )
    ? (raw.currentMode as TaskState["currentMode"])
    : "intake";
  const verificationStatus = (VERIFICATION_STATUSES as readonly string[]).includes(
    String(verification.status),
  )
    ? (verification.status as TaskState["verification"]["status"])
    : "pending";

  return {
    assumptions: sanitizeStringList(raw.assumptions),
    commandsRun: sanitizeStringList(raw.commandsRun),
    constraints: sanitizeStringList(raw.constraints),
    currentMode,
    deliverable:
      typeof raw.deliverable === "string" ? raw.deliverable : "",
    facts: sanitizeStringList(raw.facts),
    filesTouched: sanitizeStringList(raw.filesTouched),
    goal: typeof raw.goal === "string" ? raw.goal : "",
    memory: sanitizeTaskMemory(raw.memory),
    nextAction:
      typeof raw.nextAction === "string" ? raw.nextAction : "",
    openQuestions: sanitizeStringList(raw.openQuestions),
    plan: sanitizeStringList(raw.plan),
    successCriteria: sanitizeStringList(raw.successCriteria),
    verification: {
      evidence: sanitizeStringList(verification.evidence),
      status: verificationStatus,
    },
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
    taskState: sanitizeTaskState(raw.taskState),
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
        taskState: sanitizeTaskState(run.taskState),
        totalSteps:
          typeof run.totalSteps === "number" ? run.totalSteps : steps.length,
      } satisfies TraceRun;
    })
    .filter(Boolean) as TraceRun[];
}

function sanitizeSessions(raw: unknown, defaultWorkspaceRoot: string) {
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

      const messages = candidate.messages
        .map((message) => {
          if (typeof message !== "object" || message === null) {
            return null;
          }

          const maybeMessage = message as Partial<ChatMessage>;

          if (
            typeof maybeMessage.id !== "string" ||
            typeof maybeMessage.content !== "string" ||
            !isValidMessageRole(maybeMessage.role)
          ) {
            return null;
          }

          return {
            content: maybeMessage.content,
            id: maybeMessage.id,
            role: maybeMessage.role,
          } satisfies ChatMessage;
        })
        .filter((message): message is ChatMessage => message !== null);

      const feed = candidate.feed.map((item): FeedItem | null => {
        if (typeof item !== "object" || item === null) {
          return null;
        }

        const maybeItem = item as Partial<FeedItem>;

        if (maybeItem.kind === "message") {
          if (
            typeof maybeItem.id !== "string" ||
            typeof maybeItem.content !== "string" ||
            !isValidMessageRole(maybeItem.role)
          ) {
            return null;
          }

          return {
            content: maybeItem.content,
            id: maybeItem.id,
            kind: "message" as const,
            role: maybeItem.role,
          } satisfies FeedMessage;
        }

        if (maybeItem.kind === "activity") {
          if (
            typeof maybeItem.id !== "string" ||
            typeof maybeItem.label !== "string" ||
            typeof maybeItem.detail !== "string" ||
            !(
              maybeItem.type === "status" ||
              maybeItem.type === "tool_call" ||
              maybeItem.type === "tool_result" ||
              maybeItem.type === "error" ||
              maybeItem.type === "step" ||
              maybeItem.type === "state" ||
              maybeItem.type === "research" ||
              maybeItem.type === "thinking"
            )
          ) {
            return null;
          }

          return {
            display: sanitizeActivityDisplay(maybeItem.display),
            detail: maybeItem.detail,
            eventType:
              typeof maybeItem.eventType === "string"
                ? maybeItem.eventType
                : undefined,
            id: maybeItem.id,
            kind: "activity" as const,
            label: maybeItem.label,
            runId:
              typeof maybeItem.runId === "string" ? maybeItem.runId : undefined,
            stepId:
              typeof maybeItem.stepId === "string"
                ? maybeItem.stepId
                : undefined,
            stepIndex:
              typeof maybeItem.stepIndex === "number"
                ? maybeItem.stepIndex
                : undefined,
            toolName:
              typeof maybeItem.toolName === "string"
                ? maybeItem.toolName
                : undefined,
            toolUseId:
              typeof maybeItem.toolUseId === "string"
                ? maybeItem.toolUseId
                : undefined,
            type: maybeItem.type,
          } satisfies FeedActivity;
        }

        return null;
      }).filter((item): item is FeedItem => item !== null);

      if (messages.length === 0 || feed.length === 0) {
        return null;
      }

      return {
        id: candidate.id,
        title: candidate.title,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        workspaceRoot:
          typeof candidate.workspaceRoot === "string" &&
          candidate.workspaceRoot.trim()
            ? candidate.workspaceRoot.trim()
            : defaultWorkspaceRoot,
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
          event.type === "task_state" ||
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

            if (event.type === "task_state") {
              return {
                ...run,
                taskState: event.taskState,
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
            taskState:
              event.type === "task_state" ? event.taskState : run.taskState,
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

              if (event.type === "task_state") {
                return {
                  ...step,
                  taskState: event.taskState,
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

function createWorkspaceDirectoryEntry(workspacePath: string) {
  const path = workspacePath.trim();

  return {
    name: createWorkspaceLabel(path),
    path,
  };
}

function mergeWorkspaceDirectories(entries: WorkspaceDirectoryEntry[]) {
  const seen = new Set<string>();
  const merged: WorkspaceDirectoryEntry[] = [];

  for (const entry of entries) {
    const entryPath = entry.path.trim();

    if (!entryPath || seen.has(entryPath)) {
      continue;
    }

    seen.add(entryPath);
    merged.push({
      name: entry.name.trim() || createWorkspaceLabel(entryPath),
      path: entryPath,
    });
  }

  return merged;
}

function sanitizeWorkspaceDirectories(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return mergeWorkspaceDirectories(
    raw
      .map((entry) => {
        if (typeof entry === "string") {
          return createWorkspaceDirectoryEntry(entry);
        }

        if (typeof entry !== "object" || entry === null) {
          return null;
        }

        const candidate = entry as Partial<WorkspaceDirectoryEntry>;

        if (typeof candidate.path !== "string" || !candidate.path.trim()) {
          return null;
        }

        return {
          name:
            typeof candidate.name === "string" && candidate.name.trim()
              ? candidate.name.trim()
              : createWorkspaceLabel(candidate.path),
          path: candidate.path.trim(),
        };
      })
      .filter(Boolean) as WorkspaceDirectoryEntry[],
  );
}

function getProviderOption(provider: ProviderId) {
  return (
    PROVIDER_OPTIONS.find((option) => option.id === provider) ??
    PROVIDER_OPTIONS[0]
  );
}

function getProviderApiKey(
  settings: AppSettings,
  providerId: ProviderId = settings.provider,
) {
  if (providerId === "custom") {
    return settings.customApiKey.trim();
  }

  if (providerId === "qwen") {
    return settings.qwenApiKey.trim();
  }

  if (providerId === "openai") {
    return settings.openaiApiKey.trim();
  }

  return settings.deepseekApiKey.trim();
}

function getProviderBaseUrl(
  settings: AppSettings,
  providerId: ProviderId = settings.provider,
) {
  const provider = getProviderOption(providerId);

  if (providerId === "custom") {
    return settings.customBaseUrl.trim();
  }

  return provider.baseUrl;
}

function getProviderModel(
  settings: AppSettings,
  providerId: ProviderId = settings.provider,
) {
  const provider = getProviderOption(providerId);

  if (providerId === "custom") {
    return settings.customModel.trim();
  }

  if (providerId === "openai") {
    return settings.openaiModel.trim() || provider.model;
  }

  return provider.model;
}

function setProviderApiKey(
  settings: AppSettings,
  providerId: ProviderId,
  apiKey: string,
) {
  if (providerId === "custom") {
    return {
      ...settings,
      customApiKey: apiKey,
    };
  }

  if (providerId === "qwen") {
    return {
      ...settings,
      qwenApiKey: apiKey,
    };
  }

  if (providerId === "openai") {
    return {
      ...settings,
      openaiApiKey: apiKey,
    };
  }

  return {
    ...settings,
    deepseekApiKey: apiKey,
  };
}

function buildModelSettings(
  settings: AppSettings,
  providerId: ProviderId = settings.provider,
) {
  const provider = getProviderOption(providerId);

  return {
    apiKey: getProviderApiKey(settings, providerId),
    baseUrl: getProviderBaseUrl(settings, providerId),
    model: getProviderModel(settings, providerId),
    provider: provider.provider,
  };
}

function buildToolSettings(settings: AppSettings) {
  return {
    computerUseApiKey:
      settings.computerUseApiKey.trim() || settings.openaiApiKey.trim(),
    computerUseModel: settings.computerUseModel.trim() || "gpt-5.5",
    tavilyApiKey: settings.tavilyApiKey.trim(),
  };
}

function getProviderValidationMessage(
  settings: AppSettings,
  hasEnvironmentApiKey: boolean,
  providerId: ProviderId = settings.provider,
) {
  const hasApiKey =
    Boolean(getProviderApiKey(settings, providerId)) || hasEnvironmentApiKey;

  if (providerId === "custom") {
    if (!getProviderBaseUrl(settings, providerId)) {
      return "请先填写自定义 Provider URL。";
    }

    if (!getProviderModel(settings, providerId)) {
      return "请先填写自定义模型名称。";
    }

    if (!getProviderApiKey(settings, providerId)) {
      return "请先填写自定义 Provider API Key。";
    }

    return "";
  }

  if (!hasApiKey) {
    return `请先填写 ${getProviderOption(providerId).label} API Key。`;
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

function summarizeRunStatuses(runs: TraceRun[]) {
  const counts: Record<TraceRun["status"], number> = {
    cancelled: 0,
    completed: 0,
    failed: 0,
    running: 0,
  };

  for (const run of runs) {
    counts[run.status] += 1;
  }

  return TRACE_RUN_STATUSES.map((status) => `${status}:${counts[status]}`).join(
    ", ",
  );
}

function buildSessionTraceExportText(session: SessionRecord) {
  const exportedAt = new Date().toISOString();
  const runningRunIds = session.runs
    .filter((run) => run.status === "running")
    .map((run) => run.id);
  const payload = {
    exportedAt,
    session: {
      createdAt: new Date(session.createdAt).toISOString(),
      feed: session.feed,
      id: session.id,
      messages: session.messages,
      researchContext: session.researchContext ?? "",
      runs: session.runs,
      title: session.title,
      updatedAt: new Date(session.updatedAt).toISOString(),
      workspaceRoot: session.workspaceRoot,
    },
  };

  return [
    "# Ranni Session Trace Export",
    "",
    "## Export Metadata",
    `- Exported At: ${exportedAt}`,
    `- Session ID: ${session.id}`,
    `- Session Title: ${session.title}`,
    `- Workspace Root: ${session.workspaceRoot}`,
    `- Created At: ${new Date(session.createdAt).toISOString()}`,
    `- Updated At: ${new Date(session.updatedAt).toISOString()}`,
    `- Message Count: ${session.messages.length}`,
    `- Feed Item Count: ${session.feed.length}`,
    `- Trace Run Count: ${session.runs.length}`,
    `- Run Statuses: ${summarizeRunStatuses(session.runs)}`,
    `- Running Run IDs: ${runningRunIds.join(", ") || "(none)"}`,
    "",
    "## Session Trace JSON",
    "",
    JSON.stringify(payload, null, 2),
    "",
  ].join("\n");
}

function buildActivityDebugPayload({
  item,
  step,
  toolCall,
  toolResult,
}: {
  item: FeedActivity;
  step?: TraceStep;
  toolCall?: TraceToolCall;
  toolResult?: TraceToolResult;
}) {
  return {
    processItem: {
      detail: item.detail,
      display: item.display,
      eventType: item.eventType,
      id: item.id,
      label: item.label,
      runId: item.runId,
      stepId: item.stepId,
      stepIndex: item.stepIndex,
      toolName: item.toolName,
      toolUseId: item.toolUseId,
      type: item.type,
    },
    round: step
      ? {
          assistantText: step.assistantText || undefined,
          context: step.context,
          durationMs: step.durationMs,
          endedAt: step.endedAt,
          error: step.error,
          id: step.id,
          modelRequest: step.request,
          modelResponse: step.response,
          startedAt: step.startedAt,
          status: step.status,
          statusMessages: step.statusMessages,
          stepIndex: step.stepIndex,
          stopReason: step.stopReason,
          taskState: step.taskState,
          thinking: step.thinking || undefined,
          toolInput: toolCall,
          ...(toolResult ? { output: toolResult } : {}),
        }
      : undefined,
  };
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

function compactTaskStateForStorage(taskState: TaskState | undefined) {
  if (!taskState) {
    return undefined;
  }

  return {
    ...taskState,
    assumptions: taskState.assumptions.slice(-12),
    commandsRun: taskState.commandsRun.slice(-20),
    constraints: taskState.constraints.slice(-12),
    facts: taskState.facts.slice(-20),
    filesTouched: taskState.filesTouched.slice(-30),
    memory: taskState.memory
      ? {
          ...taskState.memory,
          summary: trimStoredText(taskState.memory.summary, 900),
        }
      : undefined,
    openQuestions: taskState.openQuestions.slice(-12),
    plan: taskState.plan.slice(-12),
    successCriteria: taskState.successCriteria.slice(-12),
    verification: {
      ...taskState.verification,
      evidence: taskState.verification.evidence.slice(-20),
    },
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
    taskState: compactTaskStateForStorage(run.taskState),
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
      taskState: compactTaskStateForStorage(step.taskState),
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
                  display: item.display
                    ? {
                        ...item.display,
                        detail: trimStoredText(
                          item.display.detail,
                          Math.min(260, profile.activityDetailLimit),
                        ),
                        title: trimStoredText(item.display.title, 80),
                      }
                    : undefined,
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
  const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false);
  const [isDraftSessionActive, setIsDraftSessionActive] = useState(false);
  const [draftWorkspaceRoot, setDraftWorkspaceRoot] = useState("");
  const [draftSessionError, setDraftSessionError] = useState("");
  const [activityDebugTarget, setActivityDebugTarget] =
    useState<ActivityDebugTarget | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("api");
  const [workspacePickerMode, setWorkspacePickerMode] =
    useState<WorkspacePickerMode>("initial");
  const [workspacePickerDirectories, setWorkspacePickerDirectories] = useState<
    WorkspaceDirectoryEntry[]
  >([]);
  const [workspacePickerRoots, setWorkspacePickerRoots] = useState<
    WorkspaceDirectoryEntry[]
  >([]);
  const [workspacePickerSelectedPath, setWorkspacePickerSelectedPath] =
    useState("");
  const [workspacePickerStatus, setWorkspacePickerStatus] = useState<
    "error" | "idle" | "loading"
  >("idle");
  const [workspacePickerError, setWorkspacePickerError] = useState("");
  const [defaultWorkspaceBase, setDefaultWorkspaceBase] = useState("");
  const [expandedProviderId, setExpandedProviderId] = useState<ProviderId | "">(
    DEFAULT_SETTINGS.provider,
  );
  const [isComputerUseKeyEditorOpen, setIsComputerUseKeyEditorOpen] =
    useState(false);
  const [isTavilyKeyEditorOpen, setIsTavilyKeyEditorOpen] = useState(false);
  const [settingsToast, setSettingsToast] = useState("");
  const [testConnectionState, setTestConnectionState] =
    useState<TestConnectionState>({
      status: "idle",
    });
  const [tavilyConnectionState, setTavilyConnectionState] =
    useState<TestConnectionState>({
      status: "idle",
    });
  const [computerUseConnectionState, setComputerUseConnectionState] =
    useState<TestConnectionState>({
      status: "idle",
    });
  const [messageActionState, setMessageActionState] = useState<{
    action: "copied" | "exported";
    id: string;
  } | null>(null);
  const [sessionTraceActionState, setSessionTraceActionState] = useState<{
    sessionId: string;
  } | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [isInspectorOverlayMode, setIsInspectorOverlayMode] = useState(false);
  const [isSidebarOverlayMode, setIsSidebarOverlayMode] = useState(false);
  const [isFeedAtBottom, setIsFeedAtBottom] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);
  const messageActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTraceActionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const settingsToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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
      const storedWorkspaceDirectories = localStorage.getItem(
        WORKSPACE_DIRECTORIES_STORAGE_KEY,
      );
      const parsedSessions = sanitizeSessions(
        storedSessions ? JSON.parse(storedSessions) : [],
        workspaceRoot,
      );
      const initialSessions = parsedSessions;
      const sessionDirectories = initialSessions.map((session) =>
        createWorkspaceDirectoryEntry(session.workspaceRoot),
      );
      const initialWorkspaceDirectories = mergeWorkspaceDirectories([
        ...sanitizeWorkspaceDirectories(
          storedWorkspaceDirectories
            ? JSON.parse(storedWorkspaceDirectories)
            : [],
        ),
        ...sessionDirectories,
      ]);
      const storedActiveSessionId =
        localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) ?? "";
      const activeSessionExists = initialSessions.some(
        (session) => session.id === storedActiveSessionId,
      );
      const storedSidebarCollapsed =
        localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
      const storedInspectorCollapsed =
        localStorage.getItem(INSPECTOR_STORAGE_KEY) === "true";
      const shouldUseInspectorOverlay = window.matchMedia(
        INSPECTOR_OVERLAY_MEDIA_QUERY,
      ).matches;
      const shouldUseSidebarOverlay = window.matchMedia(
        SIDEBAR_OVERLAY_MEDIA_QUERY,
      ).matches;
      const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);

      setSessions(initialSessions);
      setActiveSessionId(
        activeSessionExists ? storedActiveSessionId : initialSessions[0]?.id ?? "",
      );
      setIsSidebarCollapsed(storedSidebarCollapsed || shouldUseSidebarOverlay);
      setIsInspectorCollapsed(storedInspectorCollapsed || shouldUseInspectorOverlay);
      setIsSidebarOverlayMode(shouldUseSidebarOverlay);
      setIsInspectorOverlayMode(shouldUseInspectorOverlay);
      setWorkspacePickerDirectories(initialWorkspaceDirectories);
      setWorkspacePickerSelectedPath(
        initialSessions[0]?.workspaceRoot ??
          initialWorkspaceDirectories[0]?.path ??
          "",
      );

      if (initialSessions.length === 0) {
        setWorkspacePickerMode("initial");
        setIsWorkspacePickerOpen(true);
      }

      const nextSettings = sanitizeSettings(
        storedSettings ? JSON.parse(storedSettings) : null,
      );

      setSettings(nextSettings);
      setExpandedProviderId(nextSettings.provider);
    } catch {
      setSessions([]);
      setActiveSessionId("");
      setWorkspacePickerMode("initial");
      setWorkspacePickerDirectories([]);
      setWorkspacePickerSelectedPath("");
      setIsWorkspacePickerOpen(true);
      setSettings(DEFAULT_SETTINGS);
      setExpandedProviderId(DEFAULT_SETTINGS.provider);
    } finally {
      setIsHydrated(true);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    const inspectorQuery = window.matchMedia(INSPECTOR_OVERLAY_MEDIA_QUERY);
    const sidebarQuery = window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY);
    const syncPanelLayout = () => {
      const shouldUseInspectorOverlay = inspectorQuery.matches;
      const shouldUseSidebarOverlay = sidebarQuery.matches;

      setIsSidebarOverlayMode(shouldUseSidebarOverlay);
      setIsInspectorOverlayMode(shouldUseInspectorOverlay);

      if (shouldUseSidebarOverlay) {
        setIsSidebarCollapsed(true);
      }

      if (shouldUseInspectorOverlay) {
        setIsInspectorCollapsed(true);
      }
    };

    syncPanelLayout();
    inspectorQuery.addEventListener("change", syncPanelLayout);
    sidebarQuery.addEventListener("change", syncPanelLayout);

    return () => {
      inspectorQuery.removeEventListener("change", syncPanelLayout);
      sidebarQuery.removeEventListener("change", syncPanelLayout);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [isHydrated, settings]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    localStorage.setItem(
      WORKSPACE_DIRECTORIES_STORAGE_KEY,
      JSON.stringify(workspacePickerDirectories),
    );
  }, [isHydrated, workspacePickerDirectories]);

  useEffect(() => {
    if (!isWorkspacePickerOpen) {
      return;
    }

    const controller = new AbortController();

    setWorkspacePickerStatus("loading");
    setWorkspacePickerError("");

    void fetch(`${apiBaseUrl}/api/workspaces/roots`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          ok?: boolean;
          result?: {
            defaultWorkspaceBase?: string;
            roots?: WorkspaceDirectoryEntry[];
          };
        };

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "无法读取推荐目录。");
        }

        setWorkspacePickerRoots(payload.result?.roots ?? []);
        setDefaultWorkspaceBase(payload.result?.defaultWorkspaceBase ?? "");
        setWorkspacePickerStatus("idle");
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setWorkspacePickerRoots([]);
        setWorkspacePickerStatus("error");
        setWorkspacePickerError(
          error instanceof Error ? error.message : "无法读取推荐目录。",
        );
      });

    return () => {
      controller.abort();
    };
  }, [apiBaseUrl, isWorkspacePickerOpen]);

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

      if (sessionTraceActionTimerRef.current) {
        clearTimeout(sessionTraceActionTimerRef.current);
      }

      if (settingsToastTimerRef.current) {
        clearTimeout(settingsToastTimerRef.current);
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

  const flashSessionTraceAction = (sessionId: string) => {
    setSessionTraceActionState({ sessionId });

    if (sessionTraceActionTimerRef.current) {
      clearTimeout(sessionTraceActionTimerRef.current);
    }

    sessionTraceActionTimerRef.current = setTimeout(() => {
      setSessionTraceActionState((current) =>
        current?.sessionId === sessionId ? null : current,
      );
      sessionTraceActionTimerRef.current = null;
    }, 1800);
  };

  const flashSettingsToast = (message: string) => {
    setSettingsToast(message);

    if (settingsToastTimerRef.current) {
      clearTimeout(settingsToastTimerRef.current);
    }

    settingsToastTimerRef.current = setTimeout(() => {
      setSettingsToast("");
      settingsToastTimerRef.current = null;
    }, 1800);
  };

  const selectProvider = (providerId: ProviderId) => {
    const provider = getProviderOption(providerId);

    setSettings((current) => ({
      ...current,
      provider: providerId,
    }));
    setExpandedProviderId(providerId);
    setTestConnectionState({ status: "idle" });
    flashSettingsToast(`模型 provider 已更新为 ${provider.label}`);
  };

  const openWorkspacePicker = (mode: WorkspacePickerMode) => {
    const initialPath =
      mode === "draftSession"
        ? draftWorkspaceRoot || activeSession?.workspaceRoot || workspaceRoot
        : activeSession?.workspaceRoot || workspaceRoot;

    setWorkspacePickerMode(mode);
    setWorkspacePickerSelectedPath(initialPath);
    setWorkspacePickerError("");
    setWorkspacePickerStatus("idle");
    setIsWorkspacePickerOpen(true);
  };

  const closeWorkspacePicker = () => {
    setIsWorkspacePickerOpen(false);
  };

  const addWorkspaceDirectory = (workspacePath: string) => {
    const trimmed = workspacePath.trim();

    if (!trimmed) {
      return;
    }

    setWorkspacePickerDirectories((current) =>
      mergeWorkspaceDirectories([
        createWorkspaceDirectoryEntry(trimmed),
        ...current,
      ]),
    );
    setWorkspacePickerSelectedPath(trimmed);
  };

  const startSessionWithWorkspace = (
    workspacePath: string,
    sessionId?: string,
  ) => {
    const nextSession = createSession({
      id: sessionId,
      workspaceRoot: workspacePath,
    });

    addWorkspaceDirectory(workspacePath);
    setSessions((current) =>
      workspacePickerMode === "initial" && current.length === 0
        ? [nextSession]
        : [nextSession, ...current],
    );
    setActiveSessionId(nextSession.id);
    setSelectedRunId("");
    setSelectedStepId("");
    setInput("");
    setActiveView("chat");
    setWorkspacePickerSelectedPath(workspacePath);
    setWorkspacePickerStatus("idle");
    setIsWorkspacePickerOpen(false);
  };

  const confirmWorkspaceSelection = async () => {
    const nextPath = workspacePickerSelectedPath.trim();

    if (!nextPath) {
      setWorkspacePickerStatus("error");
      setWorkspacePickerError("请先选择一个执行目录。");
      return;
    }

    setWorkspacePickerStatus("loading");
    setWorkspacePickerError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: nextPath,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          path?: string;
        };
      };

      if (!response.ok || payload.ok === false || !payload.result?.path) {
        throw new Error(payload.error || "目标目录不可用。");
      }

      if (workspacePickerMode === "draftSession") {
        addWorkspaceDirectory(payload.result.path);
        setDraftWorkspaceRoot(payload.result.path);
        setDraftSessionError("");
        setWorkspacePickerSelectedPath(payload.result.path);
        setWorkspacePickerStatus("idle");
        setIsWorkspacePickerOpen(false);
        return;
      }

      startSessionWithWorkspace(payload.result.path);
    } catch (error) {
      setWorkspacePickerStatus("error");
      setWorkspacePickerError(
        error instanceof Error ? error.message : "目标目录不可用。",
      );
    }
  };

  const createAutoWorkspaceSession = async () => {
    setWorkspacePickerStatus("loading");
    setWorkspacePickerError("");

    const sessionId = createId();

    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/auto-create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          base?: string;
          path?: string;
        };
      };

      if (!response.ok || payload.ok === false || !payload.result?.path) {
        throw new Error(payload.error || "无法创建默认工作目录。");
      }

      if (payload.result.base) {
        setDefaultWorkspaceBase(payload.result.base);
      }

      startSessionWithWorkspace(payload.result.path, sessionId);
    } catch (error) {
      setWorkspacePickerStatus("error");
      setWorkspacePickerError(
        error instanceof Error ? error.message : "无法创建默认工作目录。",
      );
    }
  };

  const useDefaultWorkspaceForDraft = () => {
    setDraftWorkspaceRoot("");
    setDraftSessionError("");
    setWorkspacePickerSelectedPath("");
    setWorkspacePickerStatus("idle");
    setIsWorkspacePickerOpen(false);
  };

  const createDraftSessionForSend = async () => {
    const sessionId = createId();
    const selectedWorkspace = draftWorkspaceRoot.trim();

    setDraftSessionError("");
    setWorkspacePickerStatus("loading");
    setWorkspacePickerError("");

    try {
      let nextWorkspaceRoot = selectedWorkspace;

      if (nextWorkspaceRoot) {
        const response = await fetch(`${apiBaseUrl}/api/workspaces/validate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: nextWorkspaceRoot,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          ok?: boolean;
          result?: {
            path?: string;
          };
        };

        if (!response.ok || payload.ok === false || !payload.result?.path) {
          throw new Error(payload.error || "目标目录不可用。");
        }

        nextWorkspaceRoot = payload.result.path;
      } else {
        const response = await fetch(`${apiBaseUrl}/api/workspaces/auto-create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId }),
        });
        const payload = (await response.json()) as {
          error?: string;
          ok?: boolean;
          result?: {
            base?: string;
            path?: string;
          };
        };

        if (!response.ok || payload.ok === false || !payload.result?.path) {
          throw new Error(payload.error || "无法创建默认工作目录。");
        }

        if (payload.result.base) {
          setDefaultWorkspaceBase(payload.result.base);
        }

        nextWorkspaceRoot = payload.result.path;
      }

      const nextSession = createSession({
        id: sessionId,
        includeInitialAssistantMessage: false,
        workspaceRoot: nextWorkspaceRoot,
      });

      addWorkspaceDirectory(nextWorkspaceRoot);
      setSessions((current) => [nextSession, ...current]);
      setActiveSessionId(nextSession.id);
      setSelectedRunId("");
      setSelectedStepId("");
      setActiveView("chat");
      setIsDraftSessionActive(false);
      setDraftWorkspaceRoot("");
      setWorkspacePickerSelectedPath(nextWorkspaceRoot);
      setWorkspacePickerStatus("idle");

      return nextSession;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "无法创建新会话。";

      setDraftSessionError(message);
      setWorkspacePickerStatus("error");
      setWorkspacePickerError(message);
      return null;
    }
  };

  const pickWorkspaceWithSystemDialog = async () => {
    setWorkspacePickerStatus("loading");
    setWorkspacePickerError("");

    try {
      const response = await fetch(`${apiBaseUrl}/api/workspaces/pick`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        cancelled?: boolean;
        error?: string;
        ok?: boolean;
        result?: {
          path?: string;
        };
      };

      if (payload.cancelled) {
        setWorkspacePickerStatus("idle");
        return;
      }

      if (!response.ok || payload.ok === false || !payload.result?.path) {
        throw new Error(payload.error || "无法打开系统目录选择器。");
      }

      addWorkspaceDirectory(payload.result.path);
      setWorkspacePickerStatus("idle");
    } catch (error) {
      setWorkspacePickerStatus("error");
      setWorkspacePickerError(
        error instanceof Error ? error.message : "无法打开系统目录选择器。",
      );
    }
  };

  const copyMessageContent = async (message: ChatMessage) => {
    try {
      await copyTextToClipboard(message.content);
      flashMessageAction(message.id, "copied");
    } catch (error) {
      console.error("Failed to copy message content.", error);
    }
  };

  const copyArbitraryText = async (id: string, content: string) => {
    try {
      await copyTextToClipboard(content);
      flashMessageAction(id, "copied");
    } catch (error) {
      console.error("Failed to copy text content.", error);
    }
  };

  const downloadTextFile = ({
    content,
    fileName,
    mimeType,
  }: {
    content: string;
    fileName: string;
    mimeType: string;
  }) => {
    const blob = new Blob([content], {
      type: mimeType,
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  const exportMessageAsMarkdown = (message: ChatMessage) => {
    const sessionSegment = sanitizeFileNameSegment(activeSession?.title || "session");
    const fileName = `${sessionSegment || "session"}-${message.id.slice(0, 8)}.md`;
    downloadTextFile({
      content: message.content,
      fileName,
      mimeType: "text/markdown;charset=utf-8",
    });
    flashMessageAction(message.id, "exported");
  };

  const exportSessionTrace = (session: SessionRecord) => {
    const sessionSegment = sanitizeFileNameSegment(session.title || "session");
    const fileName = `${createTimestampFileSegment()}-${
      sessionSegment || "session"
    }-trace.txt`;
    downloadTextFile({
      content: buildSessionTraceExportText(session),
      fileName,
      mimeType: "text/plain;charset=utf-8",
    });
    flashSessionTraceAction(session.id);
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
      display?: ActivityDisplay;
      eventType?: FeedActivity["eventType"];
      runId?: string;
      stepId?: string;
      stepIndex?: number;
      toolName?: string;
      toolUseId?: string;
    },
  ) => {
    const nextItem: FeedActivity = {
      display:
        options?.display ??
        createFallbackActivityDisplay(type, label, detail, options?.toolName),
      id: createId(),
      kind: "activity",
      type,
      label,
      detail,
      eventType: options?.eventType,
      runId: options?.runId,
      stepId: options?.stepId,
      stepIndex: options?.stepIndex,
      toolName: options?.toolName,
      toolUseId: options?.toolUseId,
    };

    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      feed: [...session.feed, nextItem],
    }));

    return nextItem.id;
  };

  const updateActivityDisplay = (
    sessionId: string,
    activityId: string,
    display: ActivityDisplay,
  ) => {
    updateSession(sessionId, (session) => ({
      ...session,
      updatedAt: Date.now(),
      feed: session.feed.map((item) =>
        item.kind === "activity" && item.id === activityId
          ? {
              ...item,
              display,
            }
          : item,
      ),
    }));
  };

  const removeDuplicateStatusForThinking = ({
    message,
    runId,
    sessionId,
    stepId,
  }: {
    message: string;
    runId: string;
    sessionId: string;
    stepId: string;
  }) => {
    updateSession(sessionId, (session) => ({
      ...session,
      feed: session.feed.filter(
        (item) =>
          !(
            item.kind === "activity" &&
            item.type === "status" &&
            item.eventType === "status" &&
            item.runId === runId &&
            item.stepId === stepId &&
            item.detail === message
          ),
      ),
      updatedAt: Date.now(),
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
      {
        display: {
          detail: "用户手动停止了当前 agent run",
          icon: "activity",
          meta: "cancelled",
          source: "fallback",
          title: "终止当前运行",
        },
        eventType: "manual",
        runId: activeRequest.runId,
      },
    );
    markRunningRunCancelled(activeRequest.sessionId, activeRequest.runId);
    setIsRunning(false);
  };

  const createNewSession = () => {
    setIsDraftSessionActive(true);
    setDraftWorkspaceRoot("");
    setDraftSessionError("");
    setInput("");
    setSelectedRunId("");
    setSelectedStepId("");
    setActiveView("chat");

    if (isSidebarOverlayMode) {
      setIsSidebarCollapsed(true);
    }
  };

  const testModelSettings = async (providerId: ProviderId = settings.provider) => {
    const validationMessage = getProviderValidationMessage(
      settings,
      canUseEnvironmentApiKeyForProvider(providerId),
      providerId,
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
          modelSettings: buildModelSettings(settings, providerId),
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

  const testTavilySettings = async () => {
    if (!settings.tavilyApiKey.trim()) {
      setIsTavilyKeyEditorOpen(true);
      setTavilyConnectionState({
        status: "error",
        message: "请先填写 Tavily 搜索 API Key。",
      });
      return;
    }

    setTavilyConnectionState({ status: "testing" });

    try {
      const response = await fetch(`${apiBaseUrl}/api/tavily/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolSettings: buildToolSettings(settings),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          requestId?: string | null;
          resultCount?: number;
        };
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Tavily 连接测试失败。");
      }

      setTavilyConnectionState({
        status: "success",
        message: [
          "连接成功",
          typeof payload.result?.resultCount === "number"
            ? `结果数：${payload.result.resultCount}`
            : "",
          payload.result?.requestId ? `request_id：${payload.result.requestId}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (error) {
      setTavilyConnectionState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Tavily 连接测试失败。",
      });
    }
  };

  const testComputerUseSettings = async () => {
    setComputerUseConnectionState({ status: "testing" });

    try {
      const response = await fetch(`${apiBaseUrl}/api/computer-use/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          toolSettings: buildToolSettings(settings),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          model?: string;
          requestId?: string | null;
        };
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Computer use OpenAI 连接测试失败。");
      }

      setComputerUseConnectionState({
        status: "success",
        message: [
          "连接成功",
          payload.result?.model ? `模型：${payload.result.model}` : "",
          payload.result?.requestId
            ? `response_id：${payload.result.requestId}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch (error) {
      setComputerUseConnectionState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Computer use OpenAI 连接测试失败。",
      });
    }
  };

  const requestActivityRewrite = async ({
    event,
    fallback,
    sessionId,
    activityId,
    signal,
  }: {
    activityId: string;
    event: Partial<StreamEvent> & Record<string, unknown>;
    fallback: ActivityDisplay;
    sessionId: string;
    signal?: AbortSignal;
  }) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/activity/describe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          event,
          modelSettings: buildModelSettings(settings),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: Partial<ActivityDisplay>;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "过程展示改写失败。");
      }

      const result = payload.result;

      if (!result?.title || !result.detail) {
        return;
      }

      updateActivityDisplay(sessionId, activityId, {
        detail: result.detail,
        icon: isProcessIconId(result.icon) ? result.icon : fallback.icon,
        meta: typeof result.meta === "string" ? result.meta : fallback.meta,
        source: "model",
        title: result.title,
      });
    } catch (error) {
      if (signal?.aborted) {
        return;
      }

      console.warn("Failed to rewrite process activity.", error);
    }
  };

  const requestSessionTitle = async (messageText: string) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/session/title`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText,
          modelSettings: buildModelSettings(settings),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        ok?: boolean;
        result?: {
          title?: string;
        };
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "会话命名失败。");
      }

      return normalizeSessionTitle(payload.result?.title ?? "");
    } catch (error) {
      console.warn("Failed to generate session title.", error);
      return "";
    }
  };

  const generateSessionTitleInBackground = (
    sessionId: string,
    messageText: string,
  ) => {
    void requestSessionTitle(messageText).then((title) => {
      if (!title) {
        return;
      }

      updateSession(sessionId, (session) => {
        if (session.title !== DEFAULT_SESSION_TITLE) {
          return session;
        }

        return {
          ...session,
          title,
        };
      });
    });
  };

  const sendMessage = async (messageText: string) => {
    if (!activeSession && !isDraftSessionActive) {
      return;
    }

    const trimmed = messageText.trim();

    if (!trimmed || isRunning) {
      return;
    }

    if (!isProviderReady) {
      setIsSettingsOpen(true);
      setSettingsTab("api");
      setExpandedProviderId(settings.provider);
      setTestConnectionState({
        status: "error",
        message:
          getProviderValidationMessage(settings, canUseEnvironmentApiKey) ||
          "请先完成 Provider 配置。",
      });
      return;
    }

    const sessionForRun = isDraftSessionActive
      ? await createDraftSessionForSend()
      : activeSession;

    if (!sessionForRun) {
      return;
    }

    const sessionId = sessionForRun.id;
    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };
    const shouldGenerateSessionTitle =
      sessionForRun.title === DEFAULT_SESSION_TITLE &&
      !sessionForRun.messages.some((message) => message.role === "user");
    const abortController = new AbortController();

    activeAgentRequestRef.current = {
      controller: abortController,
      sessionId,
      stopped: false,
    };
    setIsRunning(true);
    setInput("");

    try {
      const history = [
        ...sessionForRun.messages,
        ...(sessionForRun.researchContext
          ? [
              {
                role: "assistant" as const,
                content: [
                  "以下是当前 session 持续维护的 research notebook 摘要，请把它视为先前已经验证过的研究上下文，在新的请求里继续复用：",
                  sessionForRun.researchContext,
                ].join("\n\n"),
              },
            ]
          : []),
        userMessage,
      ].map(({ role, content }) => ({
        role,
        content,
      }));

      updateSession(sessionId, (session) => ({
        ...session,
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

      if (shouldGenerateSessionTitle) {
        generateSessionTitleInBackground(sessionId, trimmed);
      }

      const response = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          messages: history,
          modelSettings: buildModelSettings(settings),
          toolSettings: buildToolSettings(settings),
          workspaceRoot: sessionForRun.workspaceRoot,
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
      let lastTaskStateSignature = "";

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

          if (event.type === "run_started") {
            appendActivity(
              sessionId,
              "step",
              "开始执行任务",
              event.prompt,
              {
                display: createRunStartedDisplay(),
                eventType: event.type,
                runId: event.runId,
              },
            );
            continue;
          }

          if (event.type === "step_started") {
            continue;
          }

          if (event.type === "task_state") {
            const signature = [
              event.taskState.currentMode,
              event.taskState.nextAction,
              event.taskState.verification.status,
            ].join("|");

            if (signature !== lastTaskStateSignature) {
              lastTaskStateSignature = signature;
              appendActivity(
                sessionId,
                "state",
                "任务状态",
                prettifyPayload(event.taskState),
                {
                  display: createTaskStateDisplay(event.taskState),
                  eventType: event.type,
                  runId: event.runId,
                  stepId: event.stepId,
                  stepIndex: event.stepIndex,
                },
              );
            }
            continue;
          }

          if (event.type === "status") {
            appendActivity(sessionId, "status", "状态", event.message, {
              display: createStatusDisplay(event.message),
              eventType: event.type,
              runId: event.runId,
              stepId: event.stepId,
              stepIndex: event.stepIndex,
            });
            continue;
          }

          if (event.type === "thinking") {
            removeDuplicateStatusForThinking({
              message: event.message,
              runId: event.runId,
              sessionId,
              stepId: event.stepId,
            });

            if (settings.showThinkingInFeed) {
              appendActivity(
                sessionId,
                "thinking",
                `Step ${event.stepIndex} thinking`,
                event.message,
                {
                  display: createThinkingDisplay(event.message),
                  eventType: event.type,
                  runId: event.runId,
                  stepId: event.stepId,
                  stepIndex: event.stepIndex,
                },
              );
            }
            continue;
          }

          if (event.type === "tool_call") {
            const fallbackDisplay = createToolCallDisplay(
              event.name,
              event.arguments,
            );
            const activityId = appendActivity(
              sessionId,
              "tool_call",
              `调用 ${event.name}`,
              prettifyPayload(event.arguments),
              {
                display: fallbackDisplay,
                eventType: event.type,
                runId: event.runId,
                stepId: event.stepId,
                stepIndex: event.stepIndex,
                toolName: event.name,
                toolUseId: event.toolUseId,
              },
            );

            void requestActivityRewrite({
              activityId,
              event: {
                arguments: event.arguments,
                name: event.name,
                stepIndex: event.stepIndex,
                type: event.type,
              },
              fallback: fallbackDisplay,
              sessionId,
              signal: abortController.signal,
            });
            continue;
          }

          if (event.type === "tool_result") {
            appendActivity(
              sessionId,
              "tool_result",
              `${event.name} 返回`,
              event.result,
              {
                display: createToolResultDisplay({
                  durationMs: event.durationMs,
                  result: event.result,
                  success: event.success,
                  toolName: event.name,
                }),
                eventType: event.type,
                runId: event.runId,
                stepId: event.stepId,
                stepIndex: event.stepIndex,
                toolName: event.name,
                toolUseId: event.toolUseId,
              },
            );
            continue;
          }

          if (event.type === "research_state") {
            appendActivity(
              sessionId,
              "research",
              "研究状态",
              event.researchState,
              {
                display: createResearchDisplay(),
                eventType: event.type,
                runId: event.runId,
                stepId: event.stepId,
                stepIndex: event.stepIndex,
              },
            );
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

          if (event.type === "step_completed") {
            if (event.status === "completed") {
              continue;
            }

            appendActivity(
              sessionId,
              event.status === "failed" ? "error" : "step",
              `Step ${event.stepIndex} ${event.status}`,
              prettifyPayload(event),
              {
                display: createStepCompletedDisplay({
                  durationMs: event.durationMs,
                  status: event.status,
                  stepIndex: event.stepIndex,
                }),
                eventType: event.type,
                runId: event.runId,
                stepId: event.stepId,
                stepIndex: event.stepIndex,
              },
            );
            continue;
          }

          if (event.type === "run_completed") {
            appendActivity(
              sessionId,
              event.status === "failed" ? "error" : "step",
              `Run ${event.status}`,
              prettifyPayload(event),
              {
                display: createRunCompletedDisplay({
                  durationMs: event.durationMs,
                  status: event.status,
                  totalSteps: event.totalSteps,
                }),
                eventType: event.type,
                runId: event.runId,
              },
            );
            continue;
          }

          if (event.type === "error") {
            appendActivity(sessionId, "error", "错误", event.message, {
              display: createErrorDisplay(event.message),
              eventType: event.type,
              runId: event.runId,
              stepId: event.stepId,
              stepIndex: event.stepIndex,
            });
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

  const isDraftWorkspacePicker = workspacePickerMode === "draftSession";
  const workspacePickerModal = isWorkspacePickerOpen ? (
    <>
      <button
        aria-label="关闭目录选择"
        className={styles.modalBackdrop}
        type="button"
        onClick={closeWorkspacePicker}
      />

      <section
        aria-labelledby="workspace-picker-title"
        className={styles.workspacePickerModal}
        role="dialog"
        aria-modal="true"
      >
        <header className={styles.settingsHeader}>
          <div>
            <p>Workspace</p>
            <h3 id="workspace-picker-title">选择执行目录</h3>
          </div>
          <button
            className={styles.secondarySettingsButton}
            type="button"
            onClick={closeWorkspacePicker}
          >
            取消
          </button>
        </header>

        <div className={styles.workspacePickerBody}>
          <p className={styles.workspacePickerSubtitle}>
            Agent 会以所选目录作为环境运行任务，可能会编辑该目录下的文件，并在该目录中执行命令。
          </p>

          <section className={`${styles.workspacePickerSection} ${styles.workspaceAutoSection}`}>
            <div className={styles.workspaceAutoCard}>
              <div className={styles.workspaceAutoText}>
                <strong>
                  {isDraftWorkspacePicker
                    ? "使用默认执行目录"
                    : "不想选目录？直接开始"}
                </strong>
                <small>
                  {isDraftWorkspacePicker
                    ? "发送消息后会自动创建默认工作目录"
                    : defaultWorkspaceBase
                    ? `将在 ${defaultWorkspaceBase}/ranni-session-<session> 下自动创建`
                    : "将在默认位置自动创建 ranni-session-<session> 工作目录"}
                </small>
              </div>
              <button
                className={styles.primarySettingsButton}
                disabled={workspacePickerStatus === "loading"}
                type="button"
                onClick={() => {
                  if (isDraftWorkspacePicker) {
                    useDefaultWorkspaceForDraft();
                    return;
                  }

                  void createAutoWorkspaceSession();
                }}
              >
                {isDraftWorkspacePicker ? "使用默认" : "自动开始"}
              </button>
            </div>
          </section>

          <section className={styles.workspacePickerSection}>
            <div className={styles.settingsSectionHeader}>
              <h4>已添加的目录</h4>
              <span>{workspacePickerDirectories.length}</span>
            </div>
            <div className={styles.workspaceDirectoryGrid}>
              <button
                className={styles.workspaceAddDirectoryButton}
                disabled={workspacePickerStatus === "loading"}
                type="button"
                onClick={() => {
                  void pickWorkspaceWithSystemDialog();
                }}
              >
                <span>添加项目</span>
                <small>打开系统选择文件夹</small>
              </button>
              {workspacePickerDirectories.map((directory) => {
                const isSelected =
                  workspacePickerSelectedPath === directory.path;

                return (
                  <button
                    key={directory.path}
                    className={`${styles.workspaceDirectoryCard} ${
                      isSelected ? styles.workspaceDirectoryCardActive : ""
                    }`}
                    type="button"
                    onClick={() => setWorkspacePickerSelectedPath(directory.path)}
                  >
                    <span>{directory.name}</span>
                    <small>{directory.path}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.workspacePickerSection}>
            <div className={styles.settingsSectionHeader}>
              <h4>推荐目录</h4>
              <span>{workspacePickerRoots.length}</span>
            </div>
            <div className={styles.workspaceDirectoryGrid}>
              {workspacePickerRoots.length > 0 ? (
                workspacePickerRoots.map((root) => {
                  const isSelected = workspacePickerSelectedPath === root.path;

                  return (
                    <button
                      key={root.path}
                      className={`${styles.workspaceDirectoryCard} ${
                        isSelected ? styles.workspaceDirectoryCardActive : ""
                      }`}
                      type="button"
                      onClick={() => setWorkspacePickerSelectedPath(root.path)}
                    >
                      <span>{root.name}</span>
                      <small>{root.path}</small>
                    </button>
                  );
                })
              ) : (
                <p className={styles.settingsHint}>
                  {workspacePickerStatus === "loading"
                    ? "正在读取推荐目录..."
                    : "暂无推荐目录。"}
                </p>
              )}
            </div>
          </section>

          {workspacePickerStatus === "error" ? (
            <p
              className={`${styles.connectionNotice} ${styles.connectionNoticeError}`}
            >
              {workspacePickerError}
            </p>
          ) : null}
        </div>

        <footer className={styles.workspacePickerFooter}>
          <div>
            <span>
              {isDraftWorkspacePicker
                ? "将作为发送后的执行目录"
                : "将作为新 session 的执行目录"}
            </span>
            <strong>{workspacePickerSelectedPath || "未选择"}</strong>
          </div>
          <button
            className={styles.primarySettingsButton}
            type="button"
            disabled={
              workspacePickerStatus === "loading" ||
              !workspacePickerSelectedPath
            }
            onClick={() => {
              void confirmWorkspaceSelection();
            }}
          >
            确定
          </button>
        </footer>
      </section>
    </>
  ) : null;

  if (!isHydrated || !activeSession) {
    return (
      <main className={styles.shell}>
        <section className={styles.loadingCard}>
          {isHydrated ? (
            <div className={styles.workspaceEmptyState}>
              <strong>还没有 session</strong>
              <span>选择一个执行目录，或让 Ranni 自动创建一个工作目录后直接开始。</span>
              <div className={styles.workspaceEmptyActions}>
                <button
                  className={styles.primarySettingsButton}
                  type="button"
                  disabled={workspacePickerStatus === "loading"}
                  onClick={() => {
                    void createAutoWorkspaceSession();
                  }}
                >
                  自动创建并开始
                </button>
                <button
                  className={styles.secondarySettingsButton}
                  type="button"
                  onClick={() => openWorkspacePicker("initial")}
                >
                  选择执行目录
                </button>
              </div>
            </div>
          ) : (
            "正在加载本地会话..."
          )}
        </section>
        {workspacePickerModal}
      </main>
    );
  }

  const selectedRun = isDraftSessionActive
    ? undefined
    : activeSession.runs.find((run) => run.id === selectedRunId) ??
      activeSession.runs[0];
  const selectedStep =
    selectedRun?.steps.find((step) => step.id === selectedStepId) ??
    selectedRun?.steps[selectedRun.steps.length - 1];
  const currentTaskState = selectedStep?.taskState ?? selectedRun?.taskState;
  const reportCandidate = isDraftSessionActive
    ? undefined
    : getReportCandidate(activeSession.messages);
  const completedStepCount = getCompletedStepCount(selectedRun);
  const latestStatusMessage =
    selectedStep?.statusMessages[selectedStep.statusMessages.length - 1];
  const activeWorkspaceRoot = isDraftSessionActive
    ? draftWorkspaceRoot || "发送后自动创建默认执行目录"
    : activeSession.workspaceRoot;
  const workspaceLabel = isDraftSessionActive
    ? draftWorkspaceRoot
      ? createWorkspaceLabel(draftWorkspaceRoot)
      : "默认目录"
    : createWorkspaceLabel(activeWorkspaceRoot);
  const draftWorkspaceDetail = draftWorkspaceRoot
    ? draftWorkspaceRoot
    : defaultWorkspaceBase
      ? `${defaultWorkspaceBase}/ranni-session-<session>`
      : "发送后自动创建默认执行目录";
  const selectedProvider = getProviderOption(settings.provider);
  const selectedProviderApiKey = getProviderApiKey(settings);
  const selectedProviderBaseUrl = getProviderBaseUrl(settings);
  const selectedProviderModel = getProviderModel(settings);
  const hasConfiguredModel = Boolean(selectedProviderApiKey);
  const canUseEnvironmentApiKeyForProvider = (providerId: ProviderId) => {
    const provider = getProviderOption(providerId);

    return (
      providerId !== "custom" &&
      hasApiKey &&
      runtimeInfo.provider === provider.provider
    );
  };
  const canUseEnvironmentApiKey =
    canUseEnvironmentApiKeyForProvider(settings.provider);
  const effectiveHasApiKey = hasConfiguredModel || canUseEnvironmentApiKey;
  const isProviderReady =
    Boolean(selectedProviderBaseUrl) &&
    Boolean(selectedProviderModel) &&
    effectiveHasApiKey;
  const tavilyApiKey = settings.tavilyApiKey.trim();
  const tavilyStatusLabel = tavilyApiKey
    ? `Configured · ${maskSecret(tavilyApiKey)}`
    : "Missing key";
  const computerUseApiKey = settings.computerUseApiKey.trim();
  const effectiveComputerUseApiKey =
    computerUseApiKey || settings.openaiApiKey.trim();
  const computerUseStatusLabel = effectiveComputerUseApiKey
    ? `Configured · ${maskSecret(effectiveComputerUseApiKey)}`
    : "Missing key";
  const settingsRuntimeInfo = {
    ...runtimeInfo,
    baseUrl: selectedProviderBaseUrl || runtimeInfo.baseUrl,
    model: selectedProviderModel || runtimeInfo.model,
    provider: selectedProvider.provider,
  };
  const inspectorRuntime = selectedRun?.runtime ?? settingsRuntimeInfo;
  const runningSessionId = isRunning
    ? activeAgentRequestRef.current?.sessionId
    : undefined;
  const latestProcessActivityId =
    !isDraftSessionActive && runningSessionId === activeSession.id
      ? [...activeSession.feed]
          .reverse()
          .find((item) => item.kind === "activity")?.id
      : undefined;
  const activityDebugSession = activityDebugTarget
    ? sessions.find((session) => session.id === activityDebugTarget.sessionId)
    : undefined;
  const activityDebugItem = activityDebugSession?.feed.find(
    (item): item is FeedActivity =>
      item.kind === "activity" &&
      item.id === activityDebugTarget?.activityId,
  );
  const activityDebugRun = activityDebugItem?.runId
    ? activityDebugSession?.runs.find((run) => run.id === activityDebugItem.runId)
    : activityDebugSession?.runs[0];
  const activityDebugStep = activityDebugItem?.stepId
    ? activityDebugRun?.steps.find((step) => step.id === activityDebugItem.stepId)
    : activityDebugRun?.steps.at(-1);
  const activityDebugToolCall =
    activityDebugItem?.toolUseId && activityDebugStep
      ? activityDebugStep.toolCalls.find(
          (toolCall) => toolCall.toolUseId === activityDebugItem.toolUseId,
        )
      : undefined;
  const activityDebugToolResult =
    activityDebugItem?.toolUseId && activityDebugStep
      ? activityDebugStep.toolResults.find(
          (toolResult) => toolResult.toolUseId === activityDebugItem.toolUseId,
        )
      : undefined;
  const activityDebugPayload = activityDebugItem
    ? buildActivityDebugPayload({
        item: activityDebugItem,
        step: activityDebugStep,
        toolCall: activityDebugToolCall,
        toolResult: activityDebugToolResult,
      })
    : undefined;
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
        {!isSidebarCollapsed && isSidebarOverlayMode ? (
          <button
            aria-label="关闭导航栏"
            className={styles.sidebarBackdrop}
            type="button"
            onClick={() => setIsSidebarCollapsed(true)}
          />
        ) : null}

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
                    onClick={() => {
                      setActiveView(item.id);

                      if (item.id !== "chat") {
                        setIsDraftSessionActive(false);
                        setDraftSessionError("");
                      }

                      if (isSidebarOverlayMode) {
                        setIsSidebarCollapsed(true);
                      }
                    }}
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
                const isActive =
                  !isDraftSessionActive && session.id === activeSession.id;
                const sessionIsRunning =
                  runningSessionId === session.id ||
                  session.runs.some((run) => run.status === "running");

                return (
                  <button
                    key={session.id}
                    className={`${styles.sessionItem} ${
                      isActive ? styles.sessionItemActive : ""
                    } ${sessionIsRunning ? styles.sessionItemRunning : ""}`}
                    type="button"
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setIsDraftSessionActive(false);
                      setDraftSessionError("");

                      if (isSidebarOverlayMode) {
                        setIsSidebarCollapsed(true);
                      }
                    }}
                    title={session.title}
                  >
                    <div className={styles.sessionIndex}>{index + 1}</div>
                    <div className={styles.sessionMeta}>
                      <strong>{session.title}</strong>
                      <span>{formatSessionTime(session.updatedAt)}</span>
                      <small>{createWorkspaceLabel(session.workspaceRoot)}</small>
                    </div>
                    {sessionIsRunning ? (
                      <span className={styles.sessionRunningBadge}>
                        <span />
                        运行中
                      </span>
                    ) : null}
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
                  setIsSettingsOpen(true);

                  if (isSidebarOverlayMode) {
                    setIsSidebarCollapsed(true);
                  }
                }}
              >
                <span>设置</span>
                <small>Provider / 外观 / Debug</small>
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
              <h2>{isDraftSessionActive ? DEFAULT_SESSION_TITLE : activeSession.title}</h2>
            </div>
            <div className={styles.headerControls}>
              <div className={styles.chatMeta}>
                <span>
                  {isDraftSessionActive
                    ? "草稿"
                    : formatSessionTime(activeSession.updatedAt)}
                </span>
                <span
                  className={`${styles.runStateBadge} ${
                    isRunning ? styles.runStateBadgeActive : ""
                  }`}
                >
                  <span />
                  {isRunning ? "执行中" : "空闲"}
                </span>
                <span>
                  {isProviderReady ? settingsRuntimeInfo.provider : "模型未连接"}
                </span>
                <span>{workspaceLabel}</span>
              </div>
              {!isDraftSessionActive ? (
                <button
                  className={styles.headerTraceButton}
                  type="button"
                  onClick={() => exportSessionTrace(activeSession)}
                >
                  {sessionTraceActionState?.sessionId === activeSession.id
                    ? "已导出 trace"
                    : "导出 trace"}
                </button>
              ) : null}
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

          {isDraftSessionActive ? (
            <form
              className={styles.draftSession}
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(input);
              }}
            >
              <div className={styles.draftSessionInner}>
                <div className={styles.draftComposerInputWrap}>
                  <textarea
                    className={styles.draftTextarea}
                    name="prompt"
                    placeholder="Ask Ranni to inspect files, browse, research, or draft a report..."
                    rows={4}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) {
                        return;
                      }

                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();

                        if (
                          !isRunning &&
                          workspacePickerStatus !== "loading" &&
                          input.trim()
                        ) {
                          void sendMessage(input);
                        }
                      }
                    }}
                  />
                  <button
                    className={styles.submitButton}
                    disabled={
                      !input.trim() ||
                      !effectiveHasApiKey ||
                      workspacePickerStatus === "loading"
                    }
                    type="submit"
                  >
                    {effectiveHasApiKey ? "发送" : "先设置 Key"}
                  </button>
                </div>

                <button
                  className={styles.draftWorkspaceButton}
                  type="button"
                  disabled={workspacePickerStatus === "loading"}
                  onClick={() => openWorkspacePicker("draftSession")}
                >
                  <span>执行目录</span>
                  <strong>{draftWorkspaceDetail}</strong>
                </button>

                {draftSessionError ? (
                  <p
                    className={`${styles.connectionNotice} ${styles.connectionNoticeError}`}
                  >
                    {draftSessionError}
                  </p>
                ) : null}
              </div>
            </form>
          ) : activeView === "chat" ? (
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
                  ) : (() => {
                    const display =
                      item.display ??
                      createFallbackActivityDisplay(
                        item.type,
                        item.label,
                        item.detail,
                        item.toolName,
                      );
                    const ActivityIcon = getProcessIconComponent(display.icon);
                    const isLatestActive =
                      isRunning && latestProcessActivityId === item.id;

                    if (item.type === "thinking") {
                      return (
                        <article
                          key={item.id}
                          className={`${styles.activity} ${styles.thinking} ${
                            isLatestActive ? styles.activityActive : ""
                          }`}
                        >
                          <div className={styles.activityIcon} aria-hidden="true">
                            <ActivityIcon size={16} strokeWidth={2} />
                          </div>
                          <div className={styles.activityContent}>
                            <details className={styles.thinkingDisclosure}>
                              <summary className={styles.thinkingSummary}>
                                <span className={styles.thinkingTitleLine}>
                                  <strong>{display.title}</strong>
                                  {display.meta ? <span>{display.meta}</span> : null}
                                </span>
                                <p>{display.detail}</p>
                                <span className={styles.thinkingSummaryHint}>
                                  展开完整思考
                                </span>
                              </summary>
                              <pre className={styles.thinkingBody}>{item.detail}</pre>
                              <div className={styles.thinkingActions}>
                                <button
                                  className={styles.messageActionButton}
                                  type="button"
                                  onClick={() => {
                                    void copyArbitraryText(item.id, item.detail);
                                  }}
                                >
                                  {messageActionState?.id === item.id &&
                                  messageActionState.action === "copied"
                                    ? "已复制"
                                    : "复制 thinking"}
                                </button>
                                {settings.showProcessDetails ? (
                                  <button
                                    className={styles.messageActionButton}
                                    type="button"
                                    onClick={() =>
                                      setActivityDebugTarget({
                                        activityId: item.id,
                                        sessionId: activeSession.id,
                                      })
                                    }
                                  >
                                    查看 Trace
                                  </button>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        </article>
                      );
                    }

                    return (
                      <article
                        key={item.id}
                        className={`${styles.activity} ${styles[item.type]} ${
                          isLatestActive ? styles.activityActive : ""
                        }`}
                      >
                        <div className={styles.activityIcon} aria-hidden="true">
                          <ActivityIcon size={16} strokeWidth={2} />
                        </div>
                        <div className={styles.activityContent}>
                          <div className={styles.activityTopLine}>
                            <strong>{display.title}</strong>
                            {display.meta ? <span>{display.meta}</span> : null}
                          </div>
                          <p>{display.detail}</p>
                        </div>
                        {settings.showProcessDetails ? (
                          <button
                            aria-label="查看完整过程信息"
                            className={styles.activityInfoButton}
                            title="查看完整过程信息"
                            type="button"
                            onClick={() =>
                              setActivityDebugTarget({
                                activityId: item.id,
                                sessionId: activeSession.id,
                              })
                            }
                          >
                            <Info size={14} strokeWidth={2} />
                          </button>
                        ) : null}
                      </article>
                    );
                  })(),
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

                        <article className={`${styles.traceBlock} ${styles.thinkingTraceBlock}`}>
                          <div className={styles.traceBlockHeader}>
                            <div>
                              <h3>Thinking</h3>
                              <span>
                                {selectedStep.thinking
                                  ? `${selectedStep.thinking.length} chars`
                                  : "无"}
                              </span>
                            </div>
                            {selectedStep.thinking ? (
                              <button
                                className={styles.messageActionButton}
                                type="button"
                                onClick={() => {
                                  void copyArbitraryText(
                                    `thinking-${selectedStep.id}`,
                                    selectedStep.thinking,
                                  );
                                }}
                              >
                                {messageActionState?.id ===
                                  `thinking-${selectedStep.id}` &&
                                messageActionState.action === "copied"
                                  ? "已复制"
                                  : "复制 thinking"}
                              </button>
                            ) : null}
                          </div>
                          {selectedStep.thinking ? (
                            <div className={styles.thinkingTraceMeta}>
                              <div>
                                <span>Step</span>
                                <strong>{selectedStep.stepIndex}</strong>
                              </div>
                              <div>
                                <span>Stop</span>
                                <strong>{selectedStep.stopReason ?? "未知"}</strong>
                              </div>
                              <div>
                                <span>Tools</span>
                                <strong>{selectedStep.toolCalls.length}</strong>
                              </div>
                            </div>
                          ) : null}
                          <pre className={styles.thinkingTracePre}>{selectedStep.thinking || "(no thinking blocks)"}</pre>
                        </article>

                        <article className={styles.traceBlock}>
                          <div className={styles.traceBlockHeader}>
                            <h3>Task State</h3>
                            <span>
                              {selectedStep.taskState?.currentMode ?? "未知"}
                            </span>
                          </div>
                          <pre>{renderCodeBlock(selectedStep.taskState ?? {})}</pre>
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

          {!isDraftSessionActive ? (
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
          ) : null}
        </section>

        {!isInspectorCollapsed && isInspectorOverlayMode ? (
          <button
            aria-label="关闭运行状态栏"
            className={styles.inspectorBackdrop}
            type="button"
            onClick={() => setIsInspectorCollapsed(true)}
          />
        ) : null}

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
                <div>
                  <span>Mode</span>
                  <strong>{currentTaskState?.currentMode ?? "未知"}</strong>
                </div>
                <div>
                  <span>Verify</span>
                  <strong>
                    {currentTaskState?.verification.status ?? "pending"}
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
              <h3>Task State</h3>
              <span>{currentTaskState?.currentMode ?? "Idle"}</span>
            </div>
            {currentTaskState ? (
              <div className={styles.taskStatePanel}>
                <div>
                  <span>Goal</span>
                  <strong>{shorten(currentTaskState.goal || "未设置", 120)}</strong>
                </div>
                <div>
                  <span>Next</span>
                  <strong>
                    {shorten(currentTaskState.nextAction || "未设置", 120)}
                  </strong>
                </div>
                <div>
                  <span>Verification</span>
                  <strong>{currentTaskState.verification.status}</strong>
                </div>
                <div>
                  <span>Files</span>
                  <strong>{currentTaskState.filesTouched.length}</strong>
                </div>
                {currentTaskState.memory ? (
                  <>
                    <div>
                      <span>Memory</span>
                      <strong>
                        {shorten(
                          currentTaskState.memory.relativeRunDirectory || "未初始化",
                          120,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>Todo</span>
                      <strong>
                        {currentTaskState.memory.todo.done}/
                        {currentTaskState.memory.todo.total}
                        {currentTaskState.memory.todo.blocked > 0
                          ? ` · ${currentTaskState.memory.todo.blocked} blocked`
                          : ""}
                      </strong>
                    </div>
                    <div>
                      <span>Checkpoint</span>
                      <strong>
                        {shorten(
                          currentTaskState.memory.latestCheckpointPath ?? "暂无",
                          120,
                        )}
                      </strong>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <p className={styles.inspectorEmpty}>
                Task state 会在模型开始执行后出现。
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
                    onClick={() => setSettingsTab(item.id)}
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
                          ? "Integrations"
                          : settingsTab === "debug"
                            ? "Debug"
                          : "About"}
                  </p>
                  <h3>
                    {settingsTab === "account"
                      ? "账号"
                      : settingsTab === "appearance"
                        ? "外观"
                        : settingsTab === "api"
                          ? "API 设置"
                          : settingsTab === "debug"
                            ? "调试"
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

                {settingsTab === "api" ? (
                  <>
                    {settingsToast ? (
                      <p className={styles.settingsToast}>{settingsToast}</p>
                    ) : null}

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>Tavily 搜索 API Key</h4>
                        <span>{tavilyStatusLabel}</span>
                      </div>

                      {isTavilyKeyEditorOpen ? (
                        <label className={styles.settingsField}>
                          <span>API Key</span>
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder="tvly-..."
                            value={settings.tavilyApiKey}
                            onChange={(event) => {
                              setSettings((current) => ({
                                ...current,
                                tavilyApiKey: event.target.value,
                              }));
                              setTavilyConnectionState({ status: "idle" });
                            }}
                          />
                        </label>
                      ) : null}

                      <div className={styles.settingsActions}>
                        <button
                          className={styles.primarySettingsButton}
                          type="button"
                          onClick={() => {
                            void testTavilySettings();
                          }}
                          disabled={tavilyConnectionState.status === "testing"}
                        >
                          {tavilyConnectionState.status === "testing"
                            ? "测试中..."
                            : "测试连接"}
                        </button>
                        <button
                          className={styles.secondarySettingsButton}
                          type="button"
                          onClick={() =>
                            setIsTavilyKeyEditorOpen((current) => !current)
                          }
                        >
                          {isTavilyKeyEditorOpen ? "收起配置" : "配置 Key"}
                        </button>
                        {isTavilyKeyEditorOpen && tavilyApiKey ? (
                          <button
                            className={styles.secondarySettingsButton}
                            type="button"
                            onClick={() => {
                              setSettings((current) => ({
                                ...current,
                                tavilyApiKey: "",
                              }));
                              setTavilyConnectionState({ status: "idle" });
                            }}
                          >
                            清空 Key
                          </button>
                        ) : null}
                      </div>

                      {tavilyConnectionState.status !== "idle" ? (
                        <p
                          className={`${styles.connectionNotice} ${
                            tavilyConnectionState.status === "success"
                              ? styles.connectionNoticeSuccess
                              : tavilyConnectionState.status === "error"
                                ? styles.connectionNoticeError
                                : ""
                          }`}
                        >
                          {tavilyConnectionState.status === "testing"
                            ? "正在请求 Tavily..."
                            : tavilyConnectionState.message}
                        </p>
                      ) : null}
                    </section>

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>Computer use OpenAI API Key</h4>
                        <span>{computerUseStatusLabel}</span>
                      </div>

                      {isComputerUseKeyEditorOpen ? (
                        <>
                          <label className={styles.settingsField}>
                            <span>API Key</span>
                            <input
                              type="password"
                              autoComplete="off"
                              placeholder="sk-..."
                              value={settings.computerUseApiKey}
                              onChange={(event) => {
                                setSettings((current) => ({
                                  ...current,
                                  computerUseApiKey: event.target.value,
                                }));
                                setComputerUseConnectionState({ status: "idle" });
                              }}
                            />
                          </label>

                          <label className={styles.settingsField}>
                            <span>Model</span>
                            <input
                              type="text"
                              placeholder="gpt-5.5"
                              value={settings.computerUseModel}
                              onChange={(event) => {
                                setSettings((current) => ({
                                  ...current,
                                  computerUseModel: event.target.value,
                                }));
                                setComputerUseConnectionState({ status: "idle" });
                              }}
                            />
                          </label>
                        </>
                      ) : null}

                      <p className={styles.settingsHint}>
                        Computer use 将通过 OpenAI Responses API 独立运行；未单独填写时会复用 OpenAI provider 的 API Key。
                      </p>

                      <div className={styles.settingsActions}>
                        <button
                          className={styles.primarySettingsButton}
                          type="button"
                          onClick={() => {
                            void testComputerUseSettings();
                          }}
                          disabled={
                            computerUseConnectionState.status === "testing"
                          }
                        >
                          {computerUseConnectionState.status === "testing"
                            ? "测试中..."
                            : "测试连接"}
                        </button>
                        <button
                          className={styles.secondarySettingsButton}
                          type="button"
                          onClick={() =>
                            setIsComputerUseKeyEditorOpen((current) => !current)
                          }
                        >
                          {isComputerUseKeyEditorOpen ? "收起配置" : "配置 Key"}
                        </button>
                        {isComputerUseKeyEditorOpen && computerUseApiKey ? (
                          <button
                            className={styles.secondarySettingsButton}
                            type="button"
                            onClick={() => {
                              setSettings((current) => ({
                                ...current,
                                computerUseApiKey: "",
                              }));
                              setComputerUseConnectionState({ status: "idle" });
                            }}
                          >
                            清空 Key
                          </button>
                        ) : null}
                      </div>

                      {computerUseConnectionState.status !== "idle" ? (
                        <p
                          className={`${styles.connectionNotice} ${
                            computerUseConnectionState.status === "success"
                              ? styles.connectionNoticeSuccess
                              : computerUseConnectionState.status === "error"
                                ? styles.connectionNoticeError
                                : ""
                          }`}
                        >
                          {computerUseConnectionState.status === "testing"
                            ? "正在请求 OpenAI Responses API..."
                            : computerUseConnectionState.message}
                        </p>
                      ) : null}
                    </section>

                    <section className={styles.settingsSection}>
                      <div className={styles.settingsSectionHeader}>
                        <h4>模型 Provider</h4>
                        <span>{selectedProvider.label}</span>
                      </div>

                      <div className={styles.providerOptionList}>
                        {PROVIDER_OPTIONS.map((provider) => {
                          const isSelected = settings.provider === provider.id;
                          const isExpanded = expandedProviderId === provider.id;
                          const providerApiKey = getProviderApiKey(
                            settings,
                            provider.id,
                          );
                          const providerBaseUrl = getProviderBaseUrl(
                            settings,
                            provider.id,
                          );
                          const providerModel = getProviderModel(
                            settings,
                            provider.id,
                          );
                          const canUseProviderEnvironmentKey =
                            canUseEnvironmentApiKeyForProvider(provider.id);
                          const providerValidationMessage =
                            getProviderValidationMessage(
                              settings,
                              canUseProviderEnvironmentKey,
                              provider.id,
                            );

                          return (
                            <article
                              key={provider.id}
                              className={`${styles.providerOptionCard} ${
                                isSelected ? styles.providerOptionCardActive : ""
                              } ${
                                isExpanded
                                  ? styles.providerOptionCardExpanded
                                  : ""
                              }`}
                            >
                              <div className={styles.providerOptionHeader}>
                                <button
                                  className={`${styles.providerOptionButton} ${
                                    isSelected
                                      ? styles.providerOptionButtonActive
                                      : ""
                                  }`}
                                  type="button"
                                  onClick={() => selectProvider(provider.id)}
                                >
                                  <span>{isSelected ? "已选中" : "可选"}</span>
                                  <strong>{provider.label}</strong>
                                  <small>
                                    {provider.id === "custom"
                                      ? "Custom URL"
                                      : provider.model}{" "}
                                    · {provider.description}
                                  </small>
                                </button>
                                <button
                                  className={styles.providerExpandButton}
                                  type="button"
                                  aria-expanded={isExpanded}
                                  onClick={() => {
                                    setExpandedProviderId((current) =>
                                      current === provider.id ? "" : provider.id,
                                    );
                                    setTestConnectionState({ status: "idle" });
                                  }}
                                >
                                  {isExpanded ? "收起" : "展开"}
                                </button>
                              </div>

                              {isExpanded ? (
                                <div className={styles.providerOptionBody}>
                                  {provider.id === "custom" ? (
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
                                            setTestConnectionState({
                                              status: "idle",
                                            });
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
                                            setTestConnectionState({
                                              status: "idle",
                                            });
                                          }}
                                        />
                                      </label>
                                    </>
                                  ) : provider.id === "openai" ? (
                                    <>
                                      <div className={styles.settingsInfoGrid}>
                                        <div>
                                          <span>Provider URL</span>
                                          <strong>{providerBaseUrl}</strong>
                                        </div>
                                      </div>

                                      <label className={styles.settingsField}>
                                        <span>Model</span>
                                        <input
                                          type="text"
                                          placeholder={provider.model}
                                          value={settings.openaiModel}
                                          onChange={(event) => {
                                            setSettings((current) => ({
                                              ...current,
                                              openaiModel: event.target.value,
                                            }));
                                            setTestConnectionState({
                                              status: "idle",
                                            });
                                          }}
                                        />
                                      </label>
                                    </>
                                  ) : (
                                    <div className={styles.settingsInfoGrid}>
                                      <div>
                                        <span>Provider URL</span>
                                        <strong>{providerBaseUrl}</strong>
                                      </div>
                                      <div>
                                        <span>Model</span>
                                        <strong>{providerModel}</strong>
                                      </div>
                                    </div>
                                  )}

                                  <label className={styles.settingsField}>
                                    <span>API Key</span>
                                    <input
                                      type="password"
                                      autoComplete="off"
                                      placeholder="sk-..."
                                      value={providerApiKey}
                                      onChange={(event) => {
                                        const nextApiKey = event.target.value;

                                        setSettings((current) =>
                                          setProviderApiKey(
                                            current,
                                            provider.id,
                                            nextApiKey,
                                          ),
                                        );
                                        setTestConnectionState({
                                          status: "idle",
                                        });
                                      }}
                                    />
                                  </label>

                                  <div className={styles.settingsActions}>
                                    {!isSelected ? (
                                      <button
                                        className={
                                          styles.secondarySettingsButton
                                        }
                                        type="button"
                                        onClick={() =>
                                          selectProvider(provider.id)
                                        }
                                      >
                                        使用此 Provider
                                      </button>
                                    ) : null}
                                    <button
                                      className={styles.primarySettingsButton}
                                      disabled={
                                        testConnectionState.status ===
                                          "testing" ||
                                        Boolean(providerValidationMessage)
                                      }
                                      type="button"
                                      onClick={() => {
                                        if (!isSelected) {
                                          selectProvider(provider.id);
                                        }

                                        void testModelSettings(provider.id);
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
                                        setSettings((current) =>
                                          setProviderApiKey(
                                            current,
                                            provider.id,
                                            "",
                                          ),
                                        );
                                        setTestConnectionState({
                                          status: "idle",
                                        });
                                      }}
                                    >
                                      清空 Key
                                    </button>
                                  </div>

                                  {testConnectionState.status !== "idle" ? (
                                    <p
                                      className={`${styles.connectionNotice} ${
                                        testConnectionState.status === "success"
                                          ? styles.connectionNoticeSuccess
                                          : testConnectionState.status ===
                                              "error"
                                            ? styles.connectionNoticeError
                                            : ""
                                      }`}
                                    >
                                      {testConnectionState.status === "testing"
                                        ? `正在请求 ${provider.provider}...`
                                        : testConnectionState.message}
                                    </p>
                                  ) : providerValidationMessage ? (
                                    <p
                                      className={`${styles.connectionNotice} ${styles.connectionNoticeError}`}
                                    >
                                      {providerValidationMessage}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  </>
                ) : null}

                {settingsTab === "debug" ? (
                  <section className={styles.settingsSection}>
                    <div className={styles.settingsSectionHeader}>
                      <h4>会话过程</h4>
                      <span>
                        {settings.showThinkingInFeed ? "thinking on" : "thinking off"}
                      </span>
                    </div>
                    <label className={styles.settingsToggleRow}>
                      <span>
                        <strong>在会话流显示模型思考</strong>
                        <small>
                          开启后，模型返回的 thinking 会以独立卡片显示，完整内容仍保留在运行详情中。
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showThinkingInFeed}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            showThinkingInFeed: event.target.checked,
                          }))
                        }
                      />
                    </label>
                    <label className={styles.settingsToggleRow}>
                      <span>
                        <strong>会话过程展示具体内容</strong>
                        <small>
                          开启后，每条过程项会出现 info 按钮，用当前 run / step / tool trace 展示完整信息。
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={settings.showProcessDetails}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            showProcessDetails: event.target.checked,
                          }))
                        }
                      />
                    </label>
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

      {workspacePickerModal}

      {activityDebugTarget ? (
        <>
          <button
            aria-label="关闭过程详情"
            className={styles.modalBackdrop}
            type="button"
            onClick={() => setActivityDebugTarget(null)}
          />

          <section
            aria-labelledby="process-debug-title"
            className={styles.processDebugModal}
            role="dialog"
            aria-modal="true"
          >
            <header className={styles.settingsHeader}>
              <div>
                <p>Process Debug</p>
                <h3 id="process-debug-title">过程详情</h3>
              </div>
              <button
                className={styles.iconButton}
                type="button"
                onClick={() => setActivityDebugTarget(null)}
              >
                ×
              </button>
            </header>

            <div className={styles.processDebugBody}>
              {activityDebugItem ? (
                <>
                  <section className={styles.processDebugSummary}>
                    <div>
                      <span>Event</span>
                      <strong>
                        {activityDebugItem.eventType ?? activityDebugItem.type}
                      </strong>
                    </div>
                    <div>
                      <span>Run</span>
                      <strong>{activityDebugItem.runId ?? "未绑定"}</strong>
                    </div>
                    <div>
                      <span>Step</span>
                      <strong>
                        {activityDebugItem.stepIndex
                          ? `Step ${activityDebugItem.stepIndex}`
                          : "未绑定"}
                      </strong>
                    </div>
                    <div>
                      <span>Tool</span>
                      <strong>{activityDebugItem.toolName ?? "无"}</strong>
                    </div>
                  </section>

                  <section className={styles.traceBlock}>
                    <div className={styles.traceBlockHeader}>
                      <h3>当前轮次详情</h3>
                      <span>
                        {activityDebugStep
                          ? `Step ${activityDebugStep.stepIndex}`
                          : activityDebugRun?.status ?? "unknown"}
                      </span>
                    </div>
                    <pre>{renderCodeBlock(activityDebugPayload)}</pre>
                  </section>
                </>
              ) : (
                <p className={styles.traceEmpty}>没有找到对应过程项。</p>
              )}
            </div>
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
                <strong>{activeWorkspaceRoot}</strong>
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
