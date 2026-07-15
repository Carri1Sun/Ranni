/**
 * display-fallback：从 components/agent-console.tsx 抽取的「展示文案 fallback 推导」纯函数。
 *
 * v2 架构把展示逻辑后移到后端 event-mapper（见架构文档「Event Mapper」）。这些函数既被
 * 后端 event-mapper 用作 LLM 改写前的即时 fallback 文案，也仍被前端用作兜底渲染，因此
 * 抽取为无 React 依赖的纯函数模块，前后端共享同一份推导逻辑。
 *
 * 从 agent-console.tsx 迁移：isObject/shorten/prettifyPayload/compactText/compactPathLabel/
 * compactInlinePayload/getUrlHost/getObjectField/getStringField/getNumberField/formatDuration/
 * getStatusLabel/getToolDisplayName/getToolIcon/inferSearchIntent/create*Display/
 * createFallbackActivityDisplay。
 */

import type { TaskState } from "../task-state";
import type {
  ActivityDisplay,
  ActivityType,
  ProcessIconId,
} from "../events/schema";

export const PROCESS_ICON_IDS = [
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

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isProcessIconId(value: unknown): value is ProcessIconId {
  return (
    typeof value === "string" &&
    (PROCESS_ICON_IDS as readonly string[]).includes(value)
  );
}

export function shorten(value: string, maxLength = 320) {
  return value.length > maxLength ? `${value.slice(0, maxLength).trimEnd()}…` : value;
}

export function prettifyPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function compactText(value: string, maxLength = 80) {
  return shorten(value.replace(/\s+/g, " ").trim(), maxLength);
}

export function compactPathLabel(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= 2) {
    return normalized || "未指定路径";
  }

  return `${parts.at(-2)}/${parts.at(-1)}`;
}

export function compactInlinePayload(value: unknown, maxLength = 220) {
  return shorten(prettifyPayload(value).replace(/\s+/g, " "), maxLength);
}

export function getUrlHost(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

export function getObjectField(value: unknown, key: string) {
  return isObject(value) ? value[key] : undefined;
}

export function getStringField(value: unknown, key: string) {
  const field = getObjectField(value, key);
  return typeof field === "string" ? field.trim() : "";
}

export function getNumberField(value: unknown, key: string) {
  const field = getObjectField(value, key);
  return typeof field === "number" ? field : undefined;
}

export function formatDuration(durationMs?: number) {
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

export function getStatusLabel(status?: string) {
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

export function getToolDisplayName(toolName: string) {
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
    replace_attempt: "替换当前路线",
    update_task_memory: "更新任务记忆",
    update_plan: "更新工作计划",
    update_task_state: "更新任务状态",
    write_file: "写入文件",
  };

  return labels[toolName] ?? toolName.replace(/_/g, " ");
}

export function getToolIcon(toolName: string): ProcessIconId {
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
  if (
    toolName === "replace_attempt" ||
    toolName === "update_plan" ||
    toolName === "update_task_state"
  ) {
    return "state";
  }
  return "tool";
}

export function inferSearchIntent(query: string) {
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
    "怎么", "如何", "为什么", "是否", "教程", "攻略", "方法", "最新", "查询",
    "搜索", "获取", "获得", "途径", "刷", "the", "a", "an", "how", "to", "latest",
  ]);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && !stopWords.has(token.toLowerCase()));
  const compacted = tokens.slice(0, 3).join(" ") || normalized;

  return compactText(compacted, 14);
}

export function createToolCallDisplay(toolName: string, args: unknown): ActivityDisplay {
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

export function createToolResultDisplay({
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

export function createStatusDisplay(message: string): ActivityDisplay {
  const compactMessage = compactText(message, 110);

  if (/已连接/.test(message)) {
    return { detail: compactMessage, icon: "spark", meta: "run", source: "fallback", title: "开始分析请求" };
  }
  if (/重试|暂时不稳定/.test(message)) {
    return { detail: compactMessage, icon: "activity", meta: "retry", source: "fallback", title: "模型请求重试" };
  }
  if (/最近三轮没有缩小交付缺口/.test(message)) {
    return {
      detail: compactMessage,
      icon: "state",
      meta: "review",
      source: "fallback",
      title: "检查交付推进",
    };
  }
  if (/连续六轮没有缩小交付缺口/.test(message)) {
    return {
      detail: compactMessage,
      icon: "state",
      meta: "review",
      source: "fallback",
      title: "检查交付充分性",
    };
  }
  if (/同一策略连续两轮失败|连续六轮没有产出有效新证据/.test(message)) {
    return {
      detail: compactMessage,
      icon: "activity",
      meta: "route",
      source: "fallback",
      title: "调整当前路线",
    };
  }
  if (/连续十轮没有产生客观推进/.test(message)) {
    return {
      detail: compactMessage,
      icon: "database",
      meta: "checkpoint",
      source: "fallback",
      title: "保存恢复现场",
    };
  }
  if (message.length > 180) {
    return { detail: compactMessage, icon: "spark", meta: "thinking", source: "fallback", title: "整理执行思路" };
  }
  return { detail: compactMessage, icon: "state", meta: "status", source: "fallback", title: "更新运行状态" };
}

export function createThinkingDisplay(message: string): ActivityDisplay {
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

export function createTaskStateDisplay(taskState: TaskState): ActivityDisplay {
  return {
    detail: compactText(taskState.nextAction || taskState.goal || "任务状态已刷新", 100),
    icon: "state",
    meta: taskState.currentMode,
    source: "fallback",
    title: "更新任务状态",
  };
}

export function createStepCompletedDisplay({
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
      status === "cancelled" ? "本轮已被手动终止" : "本轮执行失败，详情见调试信息",
    icon: status === "cancelled" ? "activity" : "error",
    meta: formatDuration(durationMs),
    source: "fallback",
    title: status === "cancelled" ? `终止第 ${stepIndex} 轮` : `第 ${stepIndex} 轮失败`,
  };
}

export function createRunStartedDisplay(): ActivityDisplay {
  return {
    detail: "已建立本轮 run，开始进入 agent loop",
    icon: "spark",
    meta: "run",
    source: "fallback",
    title: "开始执行任务",
  };
}

export function createRunCompletedDisplay({
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

export function createResearchDisplay(): ActivityDisplay {
  return {
    detail: "研究笔记已产生新的结构化状态",
    icon: "research",
    meta: "research",
    source: "fallback",
    title: "更新研究笔记",
  };
}

export function createErrorDisplay(message: string): ActivityDisplay {
  return {
    detail: compactText(message, 120),
    icon: "error",
    meta: "error",
    source: "fallback",
    title: "运行出现错误",
  };
}

export function createFallbackActivityDisplay(
  type: ActivityType,
  label: string,
  detail: string,
  toolName?: string,
): ActivityDisplay {
  if (type === "tool_call" && toolName) {
    return createToolCallDisplay(toolName, detail);
  }
  if (type === "tool_result" && toolName) {
    return createToolResultDisplay({ result: detail, success: true, toolName });
  }
  if (type === "error") {
    return createErrorDisplay(detail);
  }
  if (type === "thinking") {
    return createThinkingDisplay(detail);
  }

  return {
    detail: compactText(detail || label, 110),
    icon: type === "state" ? "state" : type === "research" ? "research" : "activity",
    meta: type,
    source: "fallback",
    title: compactText(label, 28),
  };
}
