import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, test } from "node:test";

import { chatGPTSubscriptionProvider } from "./chatgpt-subscription";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function startServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void> | void,
): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

test("loads the live subscription model catalog", async () => {
  const baseUrl = await startServer((request, response) => {
    assert.equal(request.url, "/api/models");
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        defaults: { model: "gpt-5.6-terra", reasoningEffort: "high" },
        models: [
          {
            id: "gpt-5.6-terra",
            displayName: "GPT-5.6 Terra",
            efforts: ["low", "high", "max"],
          },
        ],
      }),
    );
  });

  const catalog = await chatGPTSubscriptionProvider.listModels({ baseUrl });
  assert.equal(catalog.defaults.model, "gpt-5.6-terra");
  assert.deepEqual(catalog.models[0].efforts, ["low", "high", "max"]);
});

test("streams thinking, content, tools, and replays encrypted reasoning items", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const baseUrl = await startServer(async (request, response) => {
    assert.equal(request.url, "/api/agent");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write('event: thinking\ndata: {"delta":"检查工具"}\n\n');
    response.write('event: content\ndata: {"delta":"准备读取。"}\n\n');
    response.write(
      'event: tool_call\ndata: {"id":"call_next","name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}\n\n',
    );
    response.end(
      'event: done\ndata: {"id":"resp_1","model":"gpt-5.6-terra","status":"completed","reasoningItems":[{"id":"rs_next","type":"reasoning","encrypted_content":"opaque"}],"usage":{"input_tokens":30,"output_tokens":12}}\n\n',
    );
  });
  const thinkingDeltas: string[] = [];
  const previousReasoning = {
    id: "rs_previous",
    type: "reasoning",
    encrypted_content: "encrypted",
  };

  const result = await chatGPTSubscriptionProvider.createMessage({
    messages: [
      { role: "user", content: [{ type: "text", text: "继续" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_previous",
            input: { path: "package.json" },
            inputComplete: true,
            name: "read_file",
            providerMetadata: {
              responsesReasoningItems: [previousReasoning],
            },
            rawInput: '{"path":"package.json"}',
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_previous",
            content: "package contents",
          },
        ],
      },
    ],
    modelConfig: {
      baseUrl,
      model: "gpt-5.6-terra",
      provider: "chatgpt-subscription",
      reasoningEffort: "high",
    },
    onThinkingDelta: ({ delta }) => thinkingDeltas.push(delta),
    system: "Use tools.",
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
  });

  assert.deepEqual(thinkingDeltas, ["检查工具"]);
  assert.deepEqual(requestBody?.input, [
    { role: "user", content: "继续" },
    previousReasoning,
    {
      type: "function_call",
      call_id: "call_previous",
      name: "read_file",
      arguments: '{"path":"package.json"}',
    },
    {
      type: "function_call_output",
      call_id: "call_previous",
      output: "package contents",
    },
  ]);
  assert.equal(requestBody?.reasoningEffort, "high");
  assert.equal(result.message.content[0].type, "thinking");
  assert.equal(result.message.content[1].type, "text");
  const tool = result.message.content[2];
  assert.equal(tool.type, "tool_use");
  if (tool.type === "tool_use") {
    assert.equal(tool.name, "read_file");
    assert.deepEqual(tool.input, { path: "README.md" });
    assert.equal(
      tool.providerMetadata?.responsesReasoningItems?.[0] &&
        (tool.providerMetadata.responsesReasoningItems[0] as { id?: string }).id,
      "rs_next",
    );
  }
  assert.equal(result.response.stopReason, "tool_use");
  assert.equal(result.response.usage.inputTokens, 30);
});

test("tests the selected model and effort with a real BFF chat request", async () => {
  const receivedPaths: string[] = [];
  let chatBody: Record<string, unknown> | undefined;
  const baseUrl = await startServer(async (request, response) => {
    receivedPaths.push(request.url ?? "");
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/models") {
      response.end(
        JSON.stringify({
          defaults: { model: "gpt-5.6-terra", reasoningEffort: "high" },
          models: [
            {
              id: "gpt-5.6-luna",
              displayName: "GPT-5.6 Luna",
              efforts: ["low", "high"],
            },
          ],
        }),
      );
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    chatBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.end(JSON.stringify({ id: "resp_test", model: "gpt-5.6-luna" }));
  });

  const result = await chatGPTSubscriptionProvider.testConnection({
    baseUrl,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
  });

  assert.deepEqual(receivedPaths, ["/api/models", "/api/chat"]);
  assert.equal(chatBody?.model, "gpt-5.6-luna");
  assert.equal(chatBody?.reasoningEffort, "low");
  assert.equal(result.requestId, "resp_test");
});
