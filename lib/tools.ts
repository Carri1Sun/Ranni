import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { Readability } from "@mozilla/readability";
import { load } from "cheerio";
import { JSDOM } from "jsdom";
import { z } from "zod";

import type { AgentToolDefinition } from "./llm";
import type { ResearchNotebook } from "./research";
import {
  getWorkspaceRoot,
  isSkippableDir,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "./workspace";

export type ToolExecutionContext = {
  researchNotebook?: ResearchNotebook;
};

type ToolDefinition = {
  execute: (args: unknown, context: ToolExecutionContext) => Promise<string>;
  schema: z.ZodType<unknown>;
  tool: AgentToolDefinition;
};

const listFilesSchema = z.object({
  path: z.string().default("."),
  recursive: z.boolean().default(false),
  limit: z.number().int().min(1).max(400).default(80),
});

const readFileSchema = z.object({
  path: z.string().min(1),
});

const writeFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const movePathSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

const deletePathSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(false),
});

const searchFilesSchema = z.object({
  query: z.string().min(1),
  path: z.string().default("."),
  limit: z.number().int().min(1).max(120).default(40),
});

const terminalSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().default("."),
  timeout_ms: z.number().int().min(1000).max(20000).default(12000),
});

const webSearchSchema = z
  .object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).default(5),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .transform(({ limit, max_results, query }) => ({
    max_results: limit ?? max_results,
    query,
  }));

const fetchUrlSchema = z.object({
  url: z.string().url(),
});

const planResearchSchema = z.object({
  angles: z.array(z.string().min(1)).max(12).default([]),
  assumptions: z.array(z.string().min(1)).max(12).default([]),
  deliverable: z.string().min(1).default("向用户输出结构化调研结论"),
  goal: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1).max(12),
  topic: z.string().min(1),
});

const recordResearchFindingSchema = z.object({
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  evidence: z
    .array(
      z.object({
        note: z.string().min(1),
        title: z.string().min(1),
        url: z.string().url().optional(),
      }),
    )
    .min(1)
    .max(8),
  open_questions: z.array(z.string().min(1)).max(8).default([]),
  subquestion: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).max(8).default([]),
});

const reviewResearchStateSchema = z.object({
  include_all_findings: z.boolean().default(true),
  max_findings: z.number().int().min(1).max(20).default(10),
});

const saveResearchCheckpointSchema = z.object({
  include_full_findings: z.boolean().default(true),
  path: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

const MAX_TEXT_BYTES = 20_000;
const FETCH_URL_TEXT_LIMIT = 12_000;
const WEB_REQUEST_TIMEOUT_MS = 10_000;
const BLOCKED_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bhalt\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bdiskutil\s+erase/i,
  /rm\s+-rf\s+\/($|\s)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];
const WEB_REQUEST_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

type TavilySearchResponse = {
  answer?: string;
  request_id?: string;
  results?: Array<{
    content?: string;
    score?: number;
    title?: string;
    url?: string;
  }>;
};

function truncate(value: string, maxLength = MAX_TEXT_BYTES) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength).trimEnd()}\n\n...[truncated]`
    : value;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return normalizeText(load(`<div>${value}</div>`).text());
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return String(error);
}

function describeNetworkError({
  error,
  operation,
  resource,
  timeoutMs,
}: {
  error: unknown;
  operation: string;
  resource: string;
  timeoutMs: number;
}) {
  const message = getErrorMessage(error);
  const timeoutSeconds = Math.round(timeoutMs / 1000);

  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    /\bThis operation was aborted\b/i.test(message)
  ) {
    return `${operation}失败：请求在 ${timeoutSeconds} 秒内没有收到响应，已被主动中止。目标资源：${resource}。可能原因：目标站点响应很慢、网络链路不稳定、连接被服务端中断，或站点存在反爬限制。你可以尝试换一个 URL、稍后重试，或先用 search_web 找到备用网址。`;
  }

  if (/\bfetch failed\b/i.test(message)) {
    return `${operation}失败：网络请求未能成功建立或被远端关闭。目标资源：${resource}。可能原因：DNS 或网络异常、TLS 握手失败、目标站点拒绝连接，或被反爬策略拦截。你可以尝试换一个来源、稍后重试，或先用 search_web 寻找其他公开页面。`;
  }

  return `${operation}失败：${message}。目标资源：${resource}。`;
}

function getTavilyApiKey() {
  const apiKey = process.env.TAVILY_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "未配置 TAVILY_API_KEY。请在 .env.local 中设置 Tavily API Key。",
    );
  }

  return apiKey;
}

function requireResearchNotebook(context: ToolExecutionContext) {
  if (!context.researchNotebook) {
    throw new Error("当前运行未初始化 research notebook。");
  }

  return context.researchNotebook;
}

async function collectEntries(
  directoryPath: string,
  recursive: boolean,
  limit: number,
) {
  const queue = [directoryPath];
  const lines: string[] = [];

  while (queue.length > 0 && lines.length < limit) {
    const currentDirectory = queue.shift();

    if (!currentDirectory) {
      break;
    }

    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (lines.length >= limit) {
        break;
      }

      if (entry.isDirectory() && isSkippableDir(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = toWorkspaceRelative(absolutePath);

      if (entry.isDirectory()) {
        lines.push(`[dir]  ${relativePath}`);

        if (recursive) {
          queue.push(absolutePath);
        }

        continue;
      }

      const stats = await fs.stat(absolutePath);
      lines.push(`[file] ${relativePath} (${formatBytes(stats.size)})`);
    }
  }

  return lines;
}

async function listFiles(args: z.infer<typeof listFilesSchema>) {
  const targetPath = resolveWorkspacePath(args.path);
  const stats = await fs.stat(targetPath);

  if (!stats.isDirectory()) {
    throw new Error("list_files 只能作用于目录路径。");
  }

  const lines = await collectEntries(targetPath, args.recursive, args.limit);

  return [
    `Workspace Root: ${getWorkspaceRoot()}`,
    `Directory: ${toWorkspaceRelative(targetPath)}`,
    `Entries: ${lines.length}`,
    "",
    lines.join("\n") || "(empty directory)",
  ].join("\n");
}

async function readFile(args: z.infer<typeof readFileSchema>) {
  const filePath = resolveWorkspacePath(args.path);
  const buffer = await fs.readFile(filePath);

  if (buffer.includes(0)) {
    return `文件 ${toWorkspaceRelative(filePath)} 可能是二进制文件，大小 ${formatBytes(buffer.length)}。`;
  }

  return [
    `Path: ${toWorkspaceRelative(filePath)}`,
    `Bytes: ${formatBytes(buffer.length)}`,
    "",
    truncate(buffer.toString("utf8")),
  ].join("\n");
}

async function writeFile(args: z.infer<typeof writeFileSchema>) {
  const filePath = resolveWorkspacePath(args.path);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, args.content, "utf8");

  return `已写入 ${toWorkspaceRelative(filePath)}，共 ${formatBytes(Buffer.byteLength(args.content, "utf8"))}。`;
}

async function movePath(args: z.infer<typeof movePathSchema>) {
  const sourcePath = resolveWorkspacePath(args.from);
  const targetPath = resolveWorkspacePath(args.to);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(sourcePath, targetPath);

  return `已移动 ${toWorkspaceRelative(sourcePath)} -> ${toWorkspaceRelative(targetPath)}。`;
}

async function deletePath(args: z.infer<typeof deletePathSchema>) {
  const targetPath = resolveWorkspacePath(args.path);
  const stats = await fs.stat(targetPath);

  if (stats.isDirectory() && !args.recursive) {
    throw new Error("目标是目录。如需删除目录，请传 recursive=true。");
  }

  await fs.rm(targetPath, {
    force: false,
    recursive: args.recursive,
  });

  return `已删除 ${toWorkspaceRelative(targetPath)}。`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function searchInFile(
  absolutePath: string,
  query: string,
  results: string[],
  limit: number,
) {
  const buffer = await fs.readFile(absolutePath);

  if (buffer.includes(0) || buffer.length > 300_000) {
    return;
  }

  const lines = buffer.toString("utf8").split(/\r?\n/);
  const matcher = new RegExp(escapeRegExp(query), "i");

  for (let index = 0; index < lines.length && results.length < limit; index += 1) {
    if (matcher.test(lines[index] ?? "")) {
      results.push(
        `${toWorkspaceRelative(absolutePath)}:${index + 1}: ${lines[index]?.trim() ?? ""}`,
      );
    }
  }
}

async function walkAndSearch(
  directoryPath: string,
  query: string,
  results: string[],
  limit: number,
) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= limit) {
      return;
    }

    if (entry.isDirectory() && isSkippableDir(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      await walkAndSearch(absolutePath, query, results, limit);
      continue;
    }

    await searchInFile(absolutePath, query, results, limit);
  }
}

async function searchFiles(args: z.infer<typeof searchFilesSchema>) {
  const directoryPath = resolveWorkspacePath(args.path);
  const stats = await fs.stat(directoryPath);

  if (!stats.isDirectory()) {
    throw new Error("search_in_files 的 path 必须是目录。");
  }

  const results: string[] = [];
  await walkAndSearch(directoryPath, args.query, results, args.limit);

  return results.length > 0
    ? results.join("\n")
    : `未在 ${toWorkspaceRelative(directoryPath)} 中找到 "${args.query}"。`;
}

async function runTerminal(args: z.infer<typeof terminalSchema>) {
  if (BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(args.command))) {
    throw new Error("该命令命中安全限制，已拒绝执行。");
  }

  const currentDirectory = resolveWorkspacePath(args.cwd);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(args.command, {
      cwd: currentDirectory,
      env: process.env,
      shell: "/bin/zsh",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500);
    }, args.timeout_ms);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      const summary = [
        `cwd: ${toWorkspaceRelative(currentDirectory)}`,
        `command: ${args.command}`,
        `exit_code: ${code ?? "unknown"}`,
        timedOut ? "timed_out: true" : "timed_out: false",
        "",
        stdout ? `stdout:\n${truncate(stdout, 12_000)}` : "stdout:\n(empty)",
        "",
        stderr ? `stderr:\n${truncate(stderr, 8_000)}` : "stderr:\n(empty)",
      ].join("\n");

      resolve(summary);
    });
  });
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = WEB_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavily(query: string, limit: number) {
  let response: Response;

  try {
    response = await fetchWithTimeout("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        ...WEB_REQUEST_HEADERS,
        Authorization: `Bearer ${getTavilyApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: "basic",
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        include_favicon: false,
      }),
    });
  } catch (error) {
    throw new Error(
      describeNetworkError({
        error,
        operation: "Tavily 搜索",
        resource: query,
        timeoutMs: WEB_REQUEST_TIMEOUT_MS,
      }),
    );
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Tavily 搜索失败，状态码 ${response.status}。${details ? ` ${truncate(details, 400)}` : ""}`,
    );
  }

  const payload = (await response.json()) as TavilySearchResponse;

  return {
    answer: normalizeText(payload.answer ?? ""),
    requestId: payload.request_id?.trim() ?? "",
    results: payload.results ?? [],
  };
}

async function searchWeb(args: z.infer<typeof webSearchSchema>) {
  const response = await searchTavily(args.query, args.max_results);

  if (response.results.length === 0) {
    return `Tavily 没有搜索到与 "${args.query}" 相关的结果。`;
  }

  const lines = response.results.map((result, index) =>
    [
      `${index + 1}. ${decodeHtml(result.title?.trim() || result.url?.trim() || "(untitled)")}`,
      result.url?.trim() ? `URL: ${result.url.trim()}` : "",
      result.content ? `摘要: ${normalizeText(result.content)}` : "",
      typeof result.score === "number" ? `Score: ${result.score.toFixed(3)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (response.answer) {
    lines.unshift(`Answer:\n${response.answer}`);
  }

  if (response.requestId) {
    lines.push(`Request ID: ${response.requestId}`);
  }

  return lines.join("\n\n");
}

async function fetchUrl(args: z.infer<typeof fetchUrlSchema>) {
  let response: Response;

  try {
    response = await fetchWithTimeout(
      args.url,
      {
        headers: WEB_REQUEST_HEADERS,
        redirect: "follow",
      },
      WEB_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(
      describeNetworkError({
        error,
        operation: "fetch_url 抓取页面",
        resource: args.url,
        timeoutMs: WEB_REQUEST_TIMEOUT_MS,
      }),
    );
  }

  if (!response.ok) {
    const statusDetails =
      response.status === 401 || response.status === 403
        ? "目标页面可能需要登录、带有反爬策略，或明确拒绝当前请求。"
        : response.status >= 500
          ? "目标站点服务端异常，稍后重试或换一个来源可能更合适。"
          : "目标页面不可直接访问，可能已经跳转、失效，或不适合公开抓取。";

    throw new Error(
      `fetch_url 抓取页面失败：状态码 ${response.status}。${statusDetails} 目标 URL：${args.url}。`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const rawText = await response.text();

  if (
    contentType.includes("application/json") ||
    contentType.startsWith("text/plain")
  ) {
    return truncate(rawText, FETCH_URL_TEXT_LIMIT);
  }

  const dom = new JSDOM(rawText, { url: args.url });

  try {
    const article = new Readability(dom.window.document).parse();

    if (article?.textContent?.trim()) {
      return [
        article.title ? `Title: ${normalizeText(article.title)}` : "",
        article.siteName ? `Site: ${normalizeText(article.siteName)}` : "",
        article.byline ? `Byline: ${normalizeText(article.byline)}` : "",
        article.excerpt ? `Excerpt: ${normalizeText(article.excerpt)}` : "",
        "",
        truncate(normalizeText(article.textContent), FETCH_URL_TEXT_LIMIT),
      ]
        .filter(Boolean)
        .join("\n");
    }
  } finally {
    dom.window.close();
  }

  const $ = load(rawText);
  $("script, style, noscript").remove();

  const title = normalizeText($("title").first().text());
  const description = normalizeText(
    $('meta[name="description"]').attr("content")?.trim() ?? "",
  );
  const text = normalizeText($("body").text());

  if (!text) {
    throw new Error(
      `fetch_url 抓取成功，但没有提取到可读正文。目标 URL：${args.url}。这通常意味着页面正文依赖客户端渲染、内容被脚本包裹，或页面本身并不适合 Readability 提取。可以尝试换一个更直接的正文页，或先用 search_web 找到备用网址。`,
    );
  }

  return [
    title ? `Title: ${title}` : "",
    description ? `Description: ${description}` : "",
    "",
    truncate(text, FETCH_URL_TEXT_LIMIT),
  ]
    .filter(Boolean)
    .join("\n");
}

async function planResearch(
  args: z.infer<typeof planResearchSchema>,
  context: ToolExecutionContext,
) {
  return requireResearchNotebook(context).setPlan({
    angles: args.angles,
    assumptions: args.assumptions,
    deliverable: args.deliverable,
    goal: args.goal,
    questions: args.questions,
    topic: args.topic,
  });
}

async function recordResearchFinding(
  args: z.infer<typeof recordResearchFindingSchema>,
  context: ToolExecutionContext,
) {
  return requireResearchNotebook(context).recordFinding({
    confidence: args.confidence,
    evidence: args.evidence,
    openQuestions: args.open_questions,
    subquestion: args.subquestion,
    summary: args.summary,
    tags: args.tags,
  });
}

async function reviewResearchState(
  args: z.infer<typeof reviewResearchStateSchema>,
  context: ToolExecutionContext,
) {
  return requireResearchNotebook(context).getStateSummary({
    includeAllFindings: args.include_all_findings,
    maxFindings: args.max_findings,
  });
}

async function saveResearchCheckpoint(
  args: z.infer<typeof saveResearchCheckpointSchema>,
  context: ToolExecutionContext,
) {
  return requireResearchNotebook(context).saveCheckpoint({
    includeFullFindings: args.include_full_findings,
    path: args.path,
    title: args.title,
  });
}

const toolRegistry = new Map<string, ToolDefinition>([
  [
    "list_files",
    {
      schema: listFilesSchema,
      tool: {
        name: "list_files",
        description:
          "List files and directories inside the workspace. Use this to inspect directory structure before reading or modifying files. Prefer shallow exploration first. This returns directory entries, not file contents.",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative directory path to inspect.",
            },
            recursive: {
              type: "boolean",
              description:
                "Whether to include nested subdirectories. Enable only when deeper exploration is necessary.",
              default: false,
            },
            limit: {
              type: "integer",
              description: "Maximum number of entries to return.",
              default: 80,
            },
          },
        },
      },
      execute: async (rawArgs) => listFiles(listFilesSchema.parse(rawArgs)),
    },
  ],
  [
    "read_file",
    {
      schema: readFileSchema,
      tool: {
        name: "read_file",
        description:
          "Read the contents of a single text file. Use this before analyzing or modifying a file. Binary files will not return readable text, and very large files may be truncated.",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative path of the file to read.",
            },
          },
          required: ["path"],
        },
      },
      execute: async (rawArgs) => readFile(readFileSchema.parse(rawArgs)),
    },
  ],
  [
    "write_file",
    {
      schema: writeFileSchema,
      tool: {
        name: "write_file",
        description:
          "Create a new file or fully overwrite an existing file. Use this for new files or full rewrites only after reading enough context. Do not use it for blind partial edits.",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Workspace-relative path of the file to create or overwrite.",
            },
            content: {
              type: "string",
              description:
                "Complete file contents to write. This replaces the existing file contents entirely.",
            },
          },
          required: ["path", "content"],
        },
      },
      execute: async (rawArgs) => writeFile(writeFileSchema.parse(rawArgs)),
    },
  ],
  [
    "move_path",
    {
      schema: movePathSchema,
      tool: {
        name: "move_path",
        description:
          "Move or rename a file or directory inside the workspace. Use this when the task requires reorganizing or renaming paths. Confirm source and destination carefully before using it.",
        input_schema: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Existing workspace-relative source path.",
            },
            to: {
              type: "string",
              description: "Target workspace-relative destination path.",
            },
          },
          required: ["from", "to"],
        },
      },
      execute: async (rawArgs) => movePath(movePathSchema.parse(rawArgs)),
    },
  ],
  [
    "delete_path",
    {
      schema: deletePathSchema,
      tool: {
        name: "delete_path",
        description:
          "Delete a file or directory inside the workspace. This is a destructive action and should be used only when required by the task or explicitly requested by the user. Directory deletion requires explicit recursive intent.",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative path to delete.",
            },
            recursive: {
              type: "boolean",
              description:
                "Whether to delete a directory recursively. Required for directory deletion.",
              default: false,
            },
          },
          required: ["path"],
        },
      },
      execute: async (rawArgs) => deletePath(deletePathSchema.parse(rawArgs)),
    },
  ],
  [
    "search_in_files",
    {
      schema: searchFilesSchema,
      tool: {
        name: "search_in_files",
        description:
          "Search for text matches inside workspace files. Use this to locate relevant files, symbols, or configuration before reading full files. It returns matched snippets and line references, not whole-file contents.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Text to search for inside workspace files.",
            },
            path: {
              type: "string",
              description:
                "Workspace-relative directory path where the search should start.",
              default: ".",
            },
            limit: {
              type: "integer",
              description: "Maximum number of matches to return.",
              default: 40,
            },
          },
          required: ["query"],
        },
      },
      execute: async (rawArgs) =>
        searchFiles(searchFilesSchema.parse(rawArgs)),
    },
  ],
  [
    "run_terminal",
    {
      schema: terminalSchema,
      tool: {
        name: "run_terminal",
        description:
          "Run a short, non-interactive terminal command inside the workspace. Use this for inspection, validation, build, test, or reading CLI output. Do not use it for long-running, interactive, or high-risk commands.",
        input_schema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "Shell command to execute. Keep it short and non-interactive.",
            },
            cwd: {
              type: "string",
              description:
                "Workspace-relative working directory for the command.",
              default: ".",
            },
            timeout_ms: {
              type: "integer",
              description: "Maximum execution time in milliseconds.",
              default: 12000,
            },
          },
          required: ["command"],
        },
      },
      execute: async (rawArgs) => runTerminal(terminalSchema.parse(rawArgs)),
    },
  ],
  [
    "plan_research",
    {
      schema: planResearchSchema,
      tool: {
        name: "plan_research",
        description:
          "Create or update an explicit research plan before broad investigation. Use this for non-trivial research tasks that require multiple sources, comparisons, or current information. Capture the topic, goal, subquestions, and analysis angles.",
        input_schema: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Research topic or decision to investigate.",
            },
            goal: {
              type: "string",
              description: "What the research must ultimately answer for the user.",
            },
            questions: {
              type: "array",
              description: "Concrete subquestions that need evidence.",
              items: { type: "string" },
            },
            angles: {
              type: "array",
              description:
                "Optional comparison axes, stakeholder views, or evaluation lenses.",
              items: { type: "string" },
              default: [],
            },
            assumptions: {
              type: "array",
              description: "Optional assumptions to verify or challenge later.",
              items: { type: "string" },
              default: [],
            },
            deliverable: {
              type: "string",
              description: "Expected final deliverable format.",
              default: "向用户输出结构化调研结论",
            },
          },
          required: ["topic", "goal", "questions"],
        },
      },
      execute: async (rawArgs, context) =>
        planResearch(planResearchSchema.parse(rawArgs), context),
    },
  ],
  [
    "record_research_finding",
    {
      schema: recordResearchFindingSchema,
      tool: {
        name: "record_research_finding",
        description:
          "Persist a verified interim finding during research. Use this at key milestones to store source-backed conclusions, confidence, and unresolved questions instead of keeping them only in scratch reasoning.",
        input_schema: {
          type: "object",
          properties: {
            subquestion: {
              type: "string",
              description: "Which research subquestion this finding addresses.",
            },
            summary: {
              type: "string",
              description: "Condensed conclusion stated in your own words.",
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
              default: "medium",
            },
            evidence: {
              type: "array",
              description: "Supporting evidence snippets with source attribution.",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  note: { type: "string" },
                },
                required: ["title", "note"],
              },
            },
            open_questions: {
              type: "array",
              description: "What still needs verification before finalizing.",
              items: { type: "string" },
              default: [],
            },
            tags: {
              type: "array",
              description: "Optional labels such as market, pricing, risk, timeline.",
              items: { type: "string" },
              default: [],
            },
          },
          required: ["subquestion", "summary", "evidence"],
        },
      },
      execute: async (rawArgs, context) =>
        recordResearchFinding(recordResearchFindingSchema.parse(rawArgs), context),
    },
  ],
  [
    "review_research_state",
    {
      schema: reviewResearchStateSchema,
      tool: {
        name: "review_research_state",
        description:
          "Inspect the current structured research notebook. Use this before finalizing to check coverage, source count, open questions, and already-recorded findings.",
        input_schema: {
          type: "object",
          properties: {
            include_all_findings: {
              type: "boolean",
              description:
                "Whether to include every recorded finding in the review output.",
              default: true,
            },
            max_findings: {
              type: "integer",
              description:
                "Maximum findings to show when include_all_findings is false.",
              default: 10,
            },
          },
        },
      },
      execute: async (rawArgs, context) =>
        reviewResearchState(reviewResearchStateSchema.parse(rawArgs), context),
    },
  ],
  [
    "save_research_checkpoint",
    {
      schema: saveResearchCheckpointSchema,
      tool: {
        name: "save_research_checkpoint",
        description:
          "Write the current research notebook to a Markdown file in the workspace. Use this for long investigations, handoff artifacts, or reusable research notes.",
        input_schema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Optional workspace-relative path for the Markdown checkpoint file.",
            },
            title: {
              type: "string",
              description: "Optional title for the generated checkpoint document.",
            },
            include_full_findings: {
              type: "boolean",
              description:
                "Whether to include all recorded findings in the Markdown output.",
              default: true,
            },
          },
        },
      },
      execute: async (rawArgs, context) =>
        saveResearchCheckpoint(saveResearchCheckpointSchema.parse(rawArgs), context),
    },
  ],
  [
    "search_web",
    {
      schema: webSearchSchema,
      tool: {
        name: "search_web",
        description:
          "Search the public web for recent information, official documentation, and candidate sources. This returns search results, links, and snippets, not full page contents. Narrow the query before repeating the same search.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query for finding relevant public web results.",
            },
            max_results: {
              type: "integer",
              description: "Maximum number of search results to return.",
              default: 5,
            },
          },
          required: ["query"],
        },
      },
      execute: async (rawArgs) => searchWeb(webSearchSchema.parse(rawArgs)),
    },
  ],
  [
    "fetch_url",
    {
      schema: fetchUrlSchema,
      tool: {
        name: "fetch_url",
        description:
          "Fetch a public web page and extract readable main content. Use this only after identifying a specific high-value URL, usually from search results. It returns extracted readable text, not raw HTML, and may fail on login pages, highly dynamic sites, or anti-bot protected pages.",
        input_schema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description:
                "Public URL to fetch and extract readable content from.",
            },
          },
          required: ["url"],
        },
      },
      execute: async (rawArgs) => fetchUrl(fetchUrlSchema.parse(rawArgs)),
    },
  ],
]);

export function getToolDefinitions() {
  return [...toolRegistry.values()].map((entry) => entry.tool);
}

export async function executeTool(
  name: string,
  rawArguments: string,
  context: ToolExecutionContext = {},
) {
  const tool = toolRegistry.get(name);

  if (!tool) {
    throw new Error(`未知工具：${name}`);
  }

  let parsedArguments: unknown = {};

  if (rawArguments.trim()) {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      throw new Error(`工具 ${name} 的参数不是合法 JSON：${rawArguments}`);
    }
  }

  return tool.execute(tool.schema.parse(parsedArguments), context);
}
