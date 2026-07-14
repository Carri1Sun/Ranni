import assert from "node:assert/strict";
import test from "node:test";

import { isUnsafeToolCall } from "../../agent";
import { createAnthropicCompatibleProvider } from "./anthropic-compatible";

test("marks closed and truncated streaming tool inputs independently", async () => {
  const originalFetch = globalThis.fetch;
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        model: "test-model",
        role: "assistant",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "tool_use",
        id: "tool_complete",
        name: "update_task_state",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: '{"current_mode":"edit"}',
      },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: {
        type: "tool_use",
        id: "tool_partial",
        name: "write_slide_fragment",
        input: {},
      },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: {
        type: "input_json_delta",
        partial_json: '{"deckDir":"deck","slideId":"02","html":"<section',
      },
    },
    {
      type: "message_delta",
      delta: { stop_reason: "max_tokens" },
      usage: { output_tokens: 4096 },
    },
    { type: "message_stop" },
  ];
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(sse, {
      headers: { "Content-Type": "text/event-stream" },
      status: 200,
    });
  };

  try {
    const provider = createAnthropicCompatibleProvider({
      apiKeyEnvNames: [],
      baseUrlEnvNames: [],
      contextWindowEnvNames: [],
      defaultBaseUrl: "https://example.test",
      defaultContextWindow: 200_000,
      defaultEnableThinking: true,
      defaultMaxTokens: 4_096,
      defaultModel: "test-model",
      maxTokensEnvNames: [],
      missingApiKeyMessage: "missing test key",
      modelEnvNames: [],
      providerName: "test-provider",
      requestFailedPrefix: "test request failed",
      resolveRuntimeOptions: (runtime) => ({
        requestExtras: {
          thinking: { type: runtime.enableThinking ? "adaptive" : "disabled" },
        },
        traceOptions: {},
      }),
    });
    const result = await provider.createMessage({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "write slides" }],
        },
      ],
      modelConfig: { apiKey: "test-key", enableThinking: false },
      onThinkingDelta: () => undefined,
      system: "test",
      tools: [],
    });
    const toolCalls = result.message.content.filter(
      (block) => block.type === "tool_use",
    );

    assert.equal(
      (requestBody?.thinking as { type?: string } | undefined)?.type,
      "disabled",
    );
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0]?.inputComplete, true);
    assert.equal(isUnsafeToolCall(toolCalls[0]!), false);
    assert.equal(toolCalls[1]?.inputComplete, false);
    assert.equal(isUnsafeToolCall(toolCalls[1]!), true);
    assert.equal(result.response.stopReason, "max_tokens");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
