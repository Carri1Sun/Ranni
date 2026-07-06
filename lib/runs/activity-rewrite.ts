/**
 * activity-rewrite：把 agent 过程事件改写为中文 UI 展示文案的逻辑。
 *
 * v2 架构把这部分逻辑从前端（旧 /api/activity/describe + 前端 requestActivityRewrite）后移到
 * 后端 event-mapper（见架构文档「Event Mapper：展示逻辑后移」）。本模块封装改写 prompt、脱敏、
 * JSON 解析与 LLM 调用，供 event-mapper 在收到 tool.started 时异步生成 model display 文案。
 *
 * 逻辑迁移自 src/server/app.ts 的 /api/activity/describe 实现（buildActivityRewritePrompt /
 * redactActivityPayload / parseJsonObjectFromText / extractAssistantText / activityRewriteResultSchema）。
 */

import { z } from "zod";

import { createMessage } from "../llm";
import type { ActivityDisplay, ProcessIconId } from "../events/schema";

const REWRITE_SYSTEM_PROMPT = [
  "你是 Ranni 的 agent 过程展示改写器。",
  "你的任务是把机器事件改写为短、清晰、可信的中文 UI 文案。",
  "只输出一个 JSON 对象，不要输出 Markdown，不要解释。",
].join("\n");

const processIconSchema = z.enum([
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
]);

const activityRewriteResultSchema = z.object({
  detail: z.string().trim().min(1).max(140),
  icon: processIconSchema.optional(),
  meta: z.string().trim().max(32).optional(),
  title: z.string().trim().min(1).max(40),
});

export function extractAssistantText(
  content: { type: string; text?: string }[],
) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function redactActivityPayload(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[depth-trimmed]";
  }

  if (typeof value === "string") {
    return value.length > 900 ? `${value.slice(0, 900)}...[trimmed]` : value;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => redactActivityPayload(item, depth + 1));
  }

  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    if (/api[-_]?key|token|secret|password|authorization|cookie/i.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = redactActivityPayload(item, depth + 1);
  }

  return result;
}

function buildActivityRewritePrompt(event: Record<string, unknown>) {
  return [
    "请把下面的 Ranni agent 过程事件改写成适合消息流展示的中文短文案。",
    "",
    "输出 JSON：",
    '{"title":"不超过 14 个中文字","detail":"不超过 36 个中文字","meta":"可选补充信息","icon":"activity|check|database|error|file|globe|research|search|spark|state|terminal|tool"}',
    "",
    "规则：",
    "- 只描述正在做什么，不编造工具结果。",
    "- 不展示原始 JSON、密钥、token、cookie、完整命令输出或长 URL。",
    "- title 用动宾结构，例如「搜索骨片获取途径」「读取项目 README」「运行类型检查」。",
    "- detail 补充目标、范围、最多条数、文件名、域名、Step 等信息。",
    "- search_web 要从 query 中提炼搜索意图，例如 query 为「饥荒 联机版 骨片 刷 鳗鱼 腐烂 鱼人 化石 传送门」时，title 写「搜索骨片获取途径」。",
    "- fetch_url 用「读取网页内容」或更具体的页面主题。",
    "- run_terminal 用「运行终端命令」，detail 只保留安全的短命令摘要。",
    "",
    "事件：",
    JSON.stringify(redactActivityPayload(event), null, 2).slice(0, 3200),
  ].join("\n");
}

function parseJsonObjectFromText(text: string) {
  const withoutFence = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }

    throw new Error("模型没有返回可解析的 JSON。");
  }
}

/**
 * 调用 LLM 把过程事件改写为展示文案。失败（无 key / 解析失败 / 网络错误）返回 null，
 * 调用方应回退到 fallback display。
 */
export async function rewriteActivityDisplay(
  modelConfig: { provider?: string; model?: string; apiKey?: string; baseUrl?: string } | undefined,
  event: Record<string, unknown>,
): Promise<ActivityDisplay | null> {
  try {
    const result = await createMessage({
      modelConfig,
      system: REWRITE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: buildActivityRewritePrompt(event) }],
        },
      ],
      tools: [],
    });
    const parsed = parseJsonObjectFromText(extractAssistantText(result.message.content));
    const rewrite = activityRewriteResultSchema.parse(parsed);

    const icon: ProcessIconId = rewrite.icon ?? "activity";

    return {
      detail: rewrite.detail,
      icon,
      ...(rewrite.meta ? { meta: rewrite.meta } : {}),
      source: "model",
      title: rewrite.title,
    };
  } catch {
    return null;
  }
}
