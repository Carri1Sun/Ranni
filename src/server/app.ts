import express from "express";
import { z } from "zod";

import { runAgentTurn } from "../../lib/agent";
import { getModelRuntimeInfo, hasModelApiKey } from "../../lib/llm";
import { getWorkspaceRoot } from "../../lib/workspace";

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

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

  return app;
}
