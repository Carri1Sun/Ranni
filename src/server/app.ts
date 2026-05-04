import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

import { runAgentTurn } from "../../lib/agent";
import {
  getModelRuntimeInfo,
  hasModelApiKey,
  testModelConnection,
} from "../../lib/llm";
import { testTavilyConnection } from "../../lib/tools";
import { getWorkspaceRoot } from "../../lib/workspace";

const execFileAsync = promisify(execFile);
const SYSTEM_PICKER_TIMEOUT_MS = 120_000;

const optionalSecretSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);
const optionalWorkspaceRootSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const modelSettingsSchema = z
  .object({
    apiKey: optionalSecretSchema,
    baseUrl: optionalSecretSchema,
    deepseekApiKey: optionalSecretSchema,
    model: optionalSecretSchema,
    provider: optionalSecretSchema,
    qwenApiKey: optionalSecretSchema,
  })
  .transform((settings) => ({
    apiKey: settings.apiKey ?? settings.deepseekApiKey ?? settings.qwenApiKey,
    baseUrl: settings.baseUrl,
    deepseekApiKey: settings.deepseekApiKey,
    model: settings.model,
    provider: settings.provider,
    qwenApiKey: settings.qwenApiKey,
  }));

const toolSettingsSchema = z.object({
  tavilyApiKey: optionalSecretSchema,
});
const defaultToolSettings = { tavilyApiKey: undefined };

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
  workspaceRoot: optionalWorkspaceRootSchema,
});

const testModelSchema = z.object({
  modelSettings: modelSettingsSchema,
});

const testTavilySchema = z.object({
  toolSettings: toolSettingsSchema.optional().default(defaultToolSettings),
});

const workspaceDirectorySchema = z.object({
  path: z.string().trim().min(1),
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

export function createServerApp() {
  const app = express();

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
      workspaceRoot: getWorkspaceRoot(),
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
          roots,
        },
      });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "无法读取推荐目录。",
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

  app.post("/api/chat", async (request, response) => {
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
      workspacePath = await assertDirectory(payload.workspaceRoot);
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "目标工作目录不可用。",
      });
      return;
    }

    response.status(200);
    response.setHeader(
      "Content-Type",
      "application/x-ndjson; charset=utf-8",
    );
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");

    const abortController = new AbortController();
    let completed = false;
    const abortRun = () => {
      if (!completed && !abortController.signal.aborted) {
        abortController.abort();
      }
    };
    const push = (event: Record<string, unknown>) => {
      if (response.destroyed || response.writableEnded) {
        return;
      }

      try {
        response.write(`${JSON.stringify(event)}\n`);
      } catch {
        abortRun();
      }
    };

    request.on("aborted", abortRun);
    response.on("close", abortRun);

    try {
      await runAgentTurn({
        messages: payload.messages,
        modelConfig: payload.modelSettings,
        signal: abortController.signal,
        toolSettings: payload.toolSettings,
        workspaceRoot: workspacePath,
        emit: push,
      });
    } catch (error) {
      push({
        type: "error",
        message:
          error instanceof Error ? error.message : "Agent 执行失败，请重试。",
      });
    } finally {
      completed = true;
      request.off("aborted", abortRun);
      response.off("close", abortRun);

      if (!response.destroyed && !response.writableEnded) {
        push({ type: "done" });
        response.end();
      }
    }
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
