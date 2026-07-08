import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { runAgentTurn } from "../../lib/agent";
import { EventBus } from "../../lib/events/event-bus";
import { EventMapper } from "../../lib/runs/event-mapper";
import { RunRegistry } from "../../lib/runs/run-registry";
import {
  createMessage,
  getModelRuntimeInfo,
  hasModelApiKey,
  testModelConnection,
} from "../../lib/llm";
import {
  testComputerUseConnection,
  testTavilyConnection,
} from "../../lib/tools";
import {
  listHtmlDesignStyles,
  listHtmlPageTemplates,
} from "../../lib/html-design/catalog";
import { listHtmlToPptxTemplates } from "../../lib/html-to-pptx/templates";
import { listSkillIndices } from "../../lib/skills/registry";
import { getWorkspaceRoot } from "../../lib/workspace";

const execFileAsync = promisify(execFile);
const SYSTEM_PICKER_TIMEOUT_MS = 120_000;
const SESSION_TITLE_MAX_LENGTH = 15;
const SESSION_TITLE_PROMPT_MAX_LENGTH = 4000;
const AGENT_CONCURRENCY_LIMIT_CODE = "AGENT_CONCURRENCY_LIMIT";
const MAX_CONCURRENT_AGENT_RUNS = 3;

const optionalSecretSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
const requiredWorkspaceRootSchema = z
  .string()
  .trim()
  .min(1);

const modelSettingsSchema = z
  .object({
    apiKey: optionalSecretSchema,
    baseUrl: optionalSecretSchema,
    deepseekApiKey: optionalSecretSchema,
    minimaxTokenPlanKey: optionalSecretSchema,
    model: optionalSecretSchema,
    provider: optionalSecretSchema,
    qwenApiKey: optionalSecretSchema,
  })
  .transform((settings) => ({
    apiKey:
      settings.apiKey ??
      settings.deepseekApiKey ??
      settings.qwenApiKey ??
      settings.minimaxTokenPlanKey,
    baseUrl: settings.baseUrl,
    deepseekApiKey: settings.deepseekApiKey,
    minimaxTokenPlanKey: settings.minimaxTokenPlanKey,
    model: settings.model,
    provider: settings.provider,
    qwenApiKey: settings.qwenApiKey,
  }));

const toolSettingsSchema = z.object({
  activeSkills: z.array(z.string().trim().min(1)).max(24).optional().default([]),
  computerUseApiKey: optionalSecretSchema,
  computerUseModel: optionalSecretSchema,
  htmlDesign: z
    .object({
      styleId: optionalSecretSchema,
      templateId: optionalSecretSchema,
    })
    .optional(),
  htmlToPptx: z
    .object({
      styleId: optionalSecretSchema,
      styleVariantId: optionalSecretSchema,
      templateId: optionalSecretSchema,
    })
    .optional(),
  researchMode: z.boolean().optional().default(false),
  tavilyApiKey: optionalSecretSchema,
});
const defaultToolSettings = {
  activeSkills: [],
  computerUseApiKey: undefined,
  computerUseModel: undefined,
  htmlDesign: undefined,
  htmlToPptx: undefined,
  researchMode: false,
  tavilyApiKey: undefined,
};

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
  modelSettings: modelSettingsSchema,
  toolSettings: toolSettingsSchema.optional().default(defaultToolSettings),
  workspaceRoot: requiredWorkspaceRootSchema,
  sessionId: z.string().trim().min(1),
});

const testModelSchema = z.object({
  modelSettings: modelSettingsSchema,
});

const sessionTitleSchema = z.object({
  message: z.string().trim().min(1),
  modelSettings: modelSettingsSchema,
});

const testTavilySchema = z.object({
  toolSettings: toolSettingsSchema.optional().default(defaultToolSettings),
});

const testComputerUseSchema = z.object({
  toolSettings: toolSettingsSchema.optional().default(defaultToolSettings),
});

const workspaceDirectorySchema = z.object({
  path: z.string().trim().min(1),
});

const autoWorkspaceSchema = z.object({
  sessionId: z.string().trim().min(1),
});

class DirectoryPickerCancelledError extends Error {
  constructor() {
    super("用户取消了目录选择。");
  }
}

function normalizeDirectoryPath(inputPath?: string) {
  return path.resolve(inputPath?.trim() || getWorkspaceRoot());
}

async function assertDirectory(inputPath?: string) {
  const directoryPath = normalizeDirectoryPath(inputPath);
  const stats = await fs.promises.stat(directoryPath);

  if (!stats.isDirectory()) {
    throw new Error("目标路径不是目录。");
  }

  return directoryPath;
}

function isChildPath(parentPath: string, candidatePath: string) {
  const relativePath = path.relative(parentPath, candidatePath);

  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function resolveDefaultWorkspaceBase() {
  const configuredBase = process.env.RANNI_DEFAULT_WORKSPACE?.trim();

  if (configuredBase) {
    return path.resolve(configuredBase);
  }

  const homeDirectory = os.homedir() || process.cwd();
  const documentsDirectory = path.join(homeDirectory, "Documents");

  // macOS / Windows 以及部分 Linux 桌面环境会有 Documents 目录；没有则退回用户根目录，
  // 避免在没有文档目录的服务器上凭空创建一个 Documents 文件夹。
  return path.join(
    fs.existsSync(documentsDirectory) ? documentsDirectory : homeDirectory,
    "Ranni-Workspace",
  );
}

function padTimestampPart(value: number) {
  return String(value).padStart(2, "0");
}

function formatWorkspaceTimestamp(date = new Date()) {
  const datePart = [
    date.getFullYear(),
    padTimestampPart(date.getMonth() + 1),
    padTimestampPart(date.getDate()),
  ].join("-");
  const timePart = [
    padTimestampPart(date.getHours()),
    padTimestampPart(date.getMinutes()),
    padTimestampPart(date.getSeconds()),
  ].join("-");

  return `${datePart}_${timePart}`;
}

function isFileExistsError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

async function createUniqueDirectory(basePath: string, baseDirectoryName: string) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const directoryName =
      attempt === 0 ? baseDirectoryName : `${baseDirectoryName}-${attempt + 1}`;
    const targetPath = path.join(basePath, directoryName);

    try {
      await fs.promises.mkdir(targetPath);
      return targetPath;
    } catch (error) {
      if (isFileExistsError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("无法创建默认工作目录。");
}

async function createAutoSessionWorkspace() {
  const basePath = resolveDefaultWorkspaceBase();
  const directoryName = `ranni-session-${formatWorkspaceTimestamp()}`;

  await fs.promises.mkdir(basePath, { recursive: true });

  const targetPath = await createUniqueDirectory(basePath, directoryName);

  const stats = await fs.promises.stat(targetPath);

  if (!stats.isDirectory()) {
    throw new Error("无法创建默认工作目录。");
  }

  return targetPath;
}

async function assertSessionWorkspaceDirectory(inputPath: string) {
  const directoryPath = await assertDirectory(inputPath);
  const basePath = resolveDefaultWorkspaceBase();
  const [realBasePath, realDirectoryPath] = await Promise.all([
    fs.promises.realpath(basePath),
    fs.promises.realpath(directoryPath),
  ]);

  if (!isChildPath(realBasePath, realDirectoryPath)) {
    throw new Error(`Session 工作目录必须位于 ${basePath} 下。`);
  }

  if (!path.basename(realDirectoryPath).startsWith("ranni-session-")) {
    throw new Error("Session 工作目录必须是自动创建的 ranni-session-* 目录。");
  }

  return realDirectoryPath;
}

function getQueryPath(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

async function listWorkspaceDirectories(inputPath?: string) {
  const directoryPath = await assertDirectory(inputPath);
  const entries = await fs.promises.readdir(directoryPath, {
    withFileTypes: true,
  });
  const directories = (
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: absolutePath,
          };
        }

        if (!entry.isSymbolicLink()) {
          return null;
        }

        try {
          const stats = await fs.promises.stat(absolutePath);

          if (!stats.isDirectory()) {
            return null;
          }

          return {
            name: entry.name,
            path: absolutePath,
          };
        } catch {
          return null;
        }
      }),
    )
  )
    .filter(Boolean)
    .filter(
      (entry): entry is { name: string; path: string } => entry !== null,
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    entries: directories,
    parentPath: path.dirname(directoryPath) === directoryPath
      ? null
      : path.dirname(directoryPath),
    path: directoryPath,
    roots: await getWorkspaceDirectoryRoots(),
  };
}

async function getWorkspaceDirectoryRoots() {
  const homeDirectory = os.homedir();
  const filesystemRoot = path.parse(homeDirectory || process.cwd()).root;
  const candidates = [
    {
      name: "当前项目",
      path: getWorkspaceRoot(),
    },
    {
      name: "用户目录",
      path: homeDirectory,
    },
    {
      name: "桌面",
      path: path.join(homeDirectory, "Desktop"),
    },
    {
      name: "下载",
      path: path.join(homeDirectory, "Downloads"),
    },
    {
      name: "文稿",
      path: path.join(homeDirectory, "Documents"),
    },
    {
      name: "电脑根目录",
      path: filesystemRoot,
    },
    ...(process.platform === "win32"
      ? []
      : [
          {
            name: "磁盘",
            path: "/Volumes",
          },
        ]),
  ];
  const seen = new Set<string>();
  const roots: Array<{ name: string; path: string }> = [];

  for (const candidate of candidates) {
    try {
      const directoryPath = await assertDirectory(candidate.path);

      if (seen.has(directoryPath)) {
        continue;
      }

      seen.add(directoryPath);
      roots.push({
        name: candidate.name,
        path: directoryPath,
      });
    } catch {
      // Ignore shortcuts that do not exist on the current OS/user profile.
    }
  }

  return roots;
}

function getExecErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code?: unknown }).code;
  }

  return undefined;
}

function getExecErrorStderr(error: unknown) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;

    return typeof stderr === "string" ? stderr : "";
  }

  return "";
}

function isCommandMissing(error: unknown) {
  return getExecErrorCode(error) === "ENOENT";
}

function isSystemPickerCancel(error: unknown, cancelCodes: number[]) {
  const code = getExecErrorCode(error);
  const stderr = getExecErrorStderr(error);

  return (
    cancelCodes.includes(Number(code)) ||
    /user canceled|用户取消|cancelled|canceled|-128/i.test(stderr)
  );
}

async function runSystemPickerCommand(
  command: string,
  args: string[],
  cancelCodes: number[],
) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: SYSTEM_PICKER_TIMEOUT_MS,
      windowsHide: false,
    });
    const selectedPath = stdout.toString().trim();

    if (!selectedPath) {
      throw new DirectoryPickerCancelledError();
    }

    return selectedPath;
  } catch (error) {
    if (
      error instanceof DirectoryPickerCancelledError ||
      isSystemPickerCancel(error, cancelCodes)
    ) {
      throw new DirectoryPickerCancelledError();
    }

    throw error;
  }
}

async function pickSystemDirectory() {
  if (process.platform === "darwin") {
    const selectedPath = await runSystemPickerCommand(
      "osascript",
      [
        "-e",
        'set selectedFolder to choose folder with prompt "选择 session 执行目录"',
        "-e",
        "POSIX path of selectedFolder",
      ],
      [1],
    );

    return assertDirectory(selectedPath);
  }

  if (process.platform === "win32") {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$dialog.Description = "选择 session 执行目录"',
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  Write-Output $dialog.SelectedPath",
      "} else {",
      "  exit 3",
      "}",
    ].join("; ");
    const selectedPath = await runSystemPickerCommand(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      [3],
    );

    return assertDirectory(selectedPath);
  }

  try {
    const selectedPath = await runSystemPickerCommand(
      "zenity",
      ["--file-selection", "--directory", "--title=选择 session 执行目录"],
      [1],
    );

    return assertDirectory(selectedPath);
  } catch (error) {
    if (error instanceof DirectoryPickerCancelledError) {
      throw error;
    }

    if (!isCommandMissing(error)) {
      throw error;
    }
  }

  try {
    const selectedPath = await runSystemPickerCommand(
      "kdialog",
      ["--getexistingdirectory", os.homedir()],
      [1],
    );

    return assertDirectory(selectedPath);
  } catch (error) {
    if (error instanceof DirectoryPickerCancelledError) {
      throw error;
    }

    if (isCommandMissing(error)) {
      throw new Error("当前系统没有可用的目录选择器，请使用路径输入或目录浏览。");
    }

    throw error;
  }
}

function resolveFrontendDistDir() {
  const configuredDir = process.env.FRONTEND_DIST_DIR?.trim();
  const candidates = [
    configuredDir ? path.resolve(configuredDir) : "",
    path.resolve(process.cwd(), "dist", "client"),
  ].filter(Boolean);

  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "index.html")),
    ) ?? null
  );
}

function setCorsHeaders(response: express.Response, origin?: string) {
  if (origin === "null") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    return;
  }

  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
}

function normalizeSessionTitle(value: string) {
  const normalized = value
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(标题|名称|会话名|session\s*title)\s*[:：]\s*/i, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^[`"'“”‘’「『《【[(（\s]+/, "")
    .replace(/[`"'“”‘’」』》】\])）\s。.!！?？,，、:：;；]+$/, "")
    .trim();

  return Array.from(normalized).slice(0, SESSION_TITLE_MAX_LENGTH).join("");
}

function deriveFallbackSessionTitle(message: string) {
  return normalizeSessionTitle(message) || "新研究会话";
}

function extractAssistantText(
  content: Awaited<ReturnType<typeof createMessage>>["message"]["content"],
) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function createServerApp() {
  const app = express();
  const eventBus = new EventBus();
  const registry = new RunRegistry();
  const eventMapper = new EventMapper(eventBus, registry);
  eventMapper.start();

  app.use(express.json({ limit: "1mb" }));
  app.use((request, response, next) => {
    const origin = request.headers.origin;

    setCorsHeaders(response, origin);
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/runtime", (_request, response) => {
    response.json({
      hasApiKey: hasModelApiKey(),
      runtimeInfo: getModelRuntimeInfo(),
      workspaceRoot: resolveDefaultWorkspaceBase(),
    });
  });

  app.get("/api/skills", (_request, response) => {
    response.json({
      ok: true,
      result: {
        skills: listSkillIndices(),
      },
    });
  });

  app.get("/api/html-design/options", (_request, response) => {
    response.json({
      ok: true,
      result: {
        pageTemplates: listHtmlPageTemplates(),
        styles: listHtmlDesignStyles(),
      },
    });
  });

  app.get("/api/html-to-pptx/templates", (_request, response) => {
    response.json({
      ok: true,
      result: {
        templates: listHtmlToPptxTemplates().map((template) => ({
          compatibility: template.compatibility,
          accentColor: template.accentColor,
          default: template.default ?? false,
          description: template.description,
          fontPackages: template.fontPackages,
          id: template.id,
          layouts: template.layouts,
          name: template.name,
          preview: template.preview,
          surfaceColor: template.surfaceColor,
          tags: template.tags,
          version: template.version,
        })),
      },
    });
  });

  app.get("/api/slides/templates", (_request, response) => {
    response.json({
      ok: true,
      result: {
        templates: listHtmlToPptxTemplates().map((template) => ({
          compatibility: template.compatibility,
          accentColor: template.accentColor,
          default: template.default ?? false,
          description: template.description,
          fontPackages: template.fontPackages,
          id: template.id,
          layouts: template.layouts,
          name: template.name,
          preview: template.preview,
          surfaceColor: template.surfaceColor,
          tags: template.tags,
          version: template.version,
        })),
      },
    });
  });

  app.get("/api/workspaces/list", async (request, response) => {
    try {
      const result = await listWorkspaceDirectories(
        getQueryPath(request.query.path),
      );

      response.json({
        ok: true,
        result,
      });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "无法读取目标目录。",
        ok: false,
      });
    }
  });

  app.get("/api/workspaces/roots", async (_request, response) => {
    try {
      const roots = await getWorkspaceDirectoryRoots();

      response.json({
        ok: true,
        result: {
          defaultWorkspaceBase: resolveDefaultWorkspaceBase(),
          roots,
        },
      });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "无法读取候选目录。",
        ok: false,
      });
    }
  });

  app.post("/api/workspaces/validate", async (request, response) => {
    let payload: z.infer<typeof workspaceDirectorySchema>;

    try {
      payload = workspaceDirectorySchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    try {
      const workspacePath = await assertDirectory(payload.path);

      response.json({
        ok: true,
        result: {
          path: workspacePath,
        },
      });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "目标路径不是可用目录。",
        ok: false,
      });
    }
  });

  app.post("/api/workspaces/auto-create", async (request, response) => {
    try {
      autoWorkspaceSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message, ok: false });
      return;
    }

    try {
      const workspacePath = await createAutoSessionWorkspace();

      response.json({
        ok: true,
        result: {
          base: resolveDefaultWorkspaceBase(),
          path: workspacePath,
        },
      });
    } catch (error) {
      response.status(500).json({
        error:
          error instanceof Error ? error.message : "无法创建默认工作目录。",
        ok: false,
      });
    }
  });

  app.post("/api/workspaces/pick", async (_request, response) => {
    try {
      const workspacePath = await pickSystemDirectory();

      response.json({
        ok: true,
        result: {
          path: workspacePath,
        },
      });
    } catch (error) {
      if (error instanceof DirectoryPickerCancelledError) {
        response.json({
          cancelled: true,
          ok: false,
        });
        return;
      }

      response.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "无法打开系统目录选择器。",
        ok: false,
      });
    }
  });

  app.post("/api/session/title", async (request, response) => {
    let payload: z.infer<typeof sessionTitleSchema>;

    try {
      payload = sessionTitleSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message, ok: false });
      return;
    }

    const abortController = new AbortController();
    const abort = () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };

    request.on("aborted", abort);

    try {
      const firstMessage = payload.message.slice(
        0,
        SESSION_TITLE_PROMPT_MAX_LENGTH,
      );
      const result = await createMessage({
        modelConfig: payload.modelSettings,
        signal: abortController.signal,
        system: [
          "你是一个会话命名助手。",
          "根据用户第一条消息生成一个简洁中文标题。",
          "要求：十五个字以内；不要引号；不要标点；不要换行；只输出标题。",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `用户第一条消息：\n${firstMessage}`,
              },
            ],
          },
        ],
        tools: [],
      });
      const rawTitle = extractAssistantText(result.message.content);
      const title =
        normalizeSessionTitle(rawTitle) ||
        deriveFallbackSessionTitle(payload.message);

      response.json({
        ok: true,
        result: {
          title,
        },
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      response.status(502).json({
        error:
          error instanceof Error ? error.message : "会话命名请求失败。",
        ok: false,
      });
    } finally {
      request.off("aborted", abort);
    }
  });

  const steerSchema = z.object({ message: z.string().trim().min(1) });

  // Command 通道：启动 run。立即返回 runId，Agent 后台异步运行，事件经 EventBus → SSE 下发。
  app.post("/api/runs", async (request, response) => {
    let payload: z.infer<typeof requestSchema>;
    let workspacePath: string;

    try {
      payload = requestSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    try {
      workspacePath = await assertSessionWorkspaceDirectory(payload.workspaceRoot);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "目标工作目录不可用。",
      });
      return;
    }

    if (registry.activeCount() >= MAX_CONCURRENT_AGENT_RUNS) {
      response.status(429).json({
        activeCount: registry.activeCount(),
        error: "同时进行的任务数量已达上限，请等待已有任务完成后再试。",
        errorCode: AGENT_CONCURRENCY_LIMIT_CODE,
        limit: MAX_CONCURRENT_AGENT_RUNS,
      });
      return;
    }

    const { runId, streamKey } = registry.start({
      sessionId: payload.sessionId,
      modelConfig: payload.modelSettings,
    });
    const handle = registry.get(runId);

    response.status(200).json({
      ok: true,
      runId,
      sessionId: payload.sessionId,
      streamKey,
    });

    void (async () => {
      try {
        await runAgentTurn({
          runId,
          sessionId: payload.sessionId,
          streamKey,
          eventBus,
          drainSteer: (id) => registry.drainSteer(id),
          messages: payload.messages,
          modelConfig: payload.modelSettings,
          signal: handle?.abortController.signal,
          toolSettings: payload.toolSettings,
          workspaceRoot: workspacePath,
        });
        registry.finish(
          runId,
          handle?.abortController.signal.aborted ? "cancelled" : "completed",
        );
      } catch (error) {
        registry.finish(
          runId,
          handle?.abortController.signal.aborted ? "cancelled" : "failed",
        );
        console.error(
          `Agent run ${runId} failed:`,
          error instanceof Error ? error.message : error,
        );
      }
    })();
  });

  // Query 通道：前端 reconcile 的权威源。返回 session 下所有 run 的当前真实状态（基于 RunRegistry）。
  app.get("/api/runs/status", (request, response) => {
    const sessionId =
      typeof request.query.sessionId === "string"
        ? request.query.sessionId.trim()
        : "";

    if (!sessionId) {
      response.status(400).json({ error: "sessionId 是必填参数。" });
      return;
    }

    const runs = registry.listBySession(sessionId).map((handle) => ({
      runId: handle.runId,
      status: handle.status,
      startedAt: handle.startedAt,
    }));

    response.json({ ok: true, result: { runs } });
  });

  // Event 通道：SSE 单向下行广播。基于 lastSeq 回放 durable 事件 + 实时推送，支持断线续传。
  app.get("/api/events", (request, response) => {
    const streamKey =
      typeof request.query.streamKey === "string"
        ? request.query.streamKey.trim()
        : "";

    if (!streamKey) {
      response.status(400).json({ error: "streamKey 是必填参数。" });
      return;
    }

    const headerLastEventId = request.headers["last-event-id"];
    const headerValue = Array.isArray(headerLastEventId)
      ? headerLastEventId[0]
      : headerLastEventId;
    const querySeq = Number.parseInt(
      typeof request.query.lastSeq === "string" ? request.query.lastSeq : "",
      10,
    );
    // 重连时浏览器自动带 Last-Event-ID header（最后收到的 seq），优先用它以避免重复回放；
    // 首次连接无 header，回退到 query.lastSeq（前端从 localStorage 恢复）。
    const headerSeq = Number.parseInt(headerValue ?? "", 10) || 0;
    const lastSeq = headerSeq > 0 ? headerSeq : querySeq > 0 ? querySeq : 0;

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    let closed = false;
    const unsubscribe = eventBus.subscribe(streamKey, lastSeq, (event) => {
      if (closed || response.destroyed || response.writableEnded) {
        return;
      }
      try {
        if (typeof event.seq === "number") {
          response.write(`id: ${event.seq}\n`);
        }
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // 客户端断开等写入异常：忽略，close 时统一清理。
      }
    });

    const heartbeat = setInterval(() => {
      if (closed || response.destroyed || response.writableEnded) {
        return;
      }
      try {
        response.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
      } catch {
        // ignore
      }
    }, 25000);

    request.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Command 通道：向运行中的 run 投递补充消息（Steering Queue），即发即忘。
  app.post("/api/runs/:runId/steer", async (request, response) => {
    let payload: z.infer<typeof steerSchema>;

    try {
      payload = steerSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    const handle = registry.get(request.params.runId);

    if (!handle) {
      response.status(404).json({ error: "运行不存在。", ok: false });
      return;
    }

    if (handle.status !== "running") {
      response
        .status(409)
        .json({ error: "运行已结束，无法补充消息。", ok: false });
      return;
    }

    registry.steer(handle.runId, { role: "user", content: payload.message });
    response.json({ ok: true, queued: true });
  });

  // Command 通道：中断运行中的 run。
  app.post("/api/runs/:runId/abort", (request, response) => {
    const handle = registry.get(request.params.runId);

    if (!handle) {
      response.status(404).json({ error: "运行不存在。", ok: false });
      return;
    }

    registry.abort(handle.runId);
    response.json({ ok: true });
  });

  app.post("/api/model/test", async (request, response) => {
    let payload: z.infer<typeof testModelSchema>;

    try {
      payload = testModelSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    try {
      const result = await testModelConnection(payload.modelSettings);

      response.json({
        ok: true,
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : "模型连接测试失败。";

      response.status(502).json({
        error: message,
        ok: false,
      });
    }
  });

  app.post("/api/tavily/test", async (request, response) => {
    let payload: z.infer<typeof testTavilySchema>;

    try {
      payload = testTavilySchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    try {
      const result = await testTavilyConnection(payload.toolSettings);

      response.json({
        ok: true,
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : "Tavily 连接测试失败。";

      response.status(502).json({
        error: message,
        ok: false,
      });
    }
  });

  app.post("/api/computer-use/test", async (request, response) => {
    let payload: z.infer<typeof testComputerUseSchema>;

    try {
      payload = testComputerUseSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    try {
      const result = await testComputerUseConnection(payload.toolSettings);

      response.json({
        ok: true,
        result,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : "Computer use OpenAI 连接测试失败。";

      response.status(502).json({
        error: message,
        ok: false,
      });
    }
  });

  const frontendDistDir = resolveFrontendDistDir();

  if (frontendDistDir) {
    app.use(express.static(frontendDistDir));
    app.use((request, response, next) => {
      if (
        request.method !== "GET" ||
        request.path.startsWith("/api/") ||
        request.path === "/health" ||
        !request.accepts("html")
      ) {
        next();
        return;
      }

      response.sendFile(path.join(frontendDistDir, "index.html"));
    });
  }

  return app;
}
