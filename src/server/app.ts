import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { runAgentTurn } from "../../lib/agent";
import {
  getModelRuntimeInfo,
  hasModelApiKey,
  testModelConnection,
} from "../../lib/llm";
import { getWorkspaceRoot } from "../../lib/workspace";

const optionalSecretSchema = z
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
});

const testModelSchema = z.object({
  modelSettings: modelSettingsSchema,
});

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

  app.post("/api/chat", async (request, response) => {
    let payload: z.infer<typeof requestSchema>;

    try {
      payload = requestSchema.parse(request.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求体格式不正确";

      response.status(400).json({ error: message });
      return;
    }

    response.status(200);
    response.setHeader(
      "Content-Type",
      "application/x-ndjson; charset=utf-8",
    );
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");

    const push = (event: Record<string, unknown>) => {
      response.write(`${JSON.stringify(event)}\n`);
    };

    try {
      await runAgentTurn({
        messages: payload.messages,
        modelConfig: payload.modelSettings,
        emit: push,
      });
    } catch (error) {
      push({
        type: "error",
        message:
          error instanceof Error ? error.message : "Agent 执行失败，请重试。",
      });
    } finally {
      push({ type: "done" });
      response.end();
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
