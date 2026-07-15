import assert from "node:assert/strict";
import test from "node:test";

import type { AgentMessage } from "./llm";
import { buildActiveContextProjection } from "./active-context";

test("artifact focus never projects or deletes causal history", () => {
  const conversation: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "用户目标" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "最近 reasoning" },
        {
          id: "search",
          input: { query: "GLM 5.2" },
          inputComplete: true,
          name: "search_web",
          type: "tool_use",
        },
        {
          id: "fetch",
          input: { url: "https://example.com" },
          inputComplete: true,
          name: "fetch_url",
          type: "tool_use",
        },
      ],
    },
    {
      role: "user",
      content: [
        { content: "search result", tool_use_id: "search", type: "tool_result" },
        { content: "fetch result", tool_use_id: "fetch", type: "tool_result" },
      ],
    },
  ];

  for (const phase of ["styles", "slides"] as const) {
    const projection = buildActiveContextProjection({ conversation, phase });
    assert.equal(projection.messages, conversation);
    assert.equal(projection.metadata.applied, false);
    assert.equal(projection.metadata.omittedToolPairCount, 0);
    assert.equal(projection.metadata.preservedToolPairCount, 2);
    assert.match(JSON.stringify(projection.messages), /最近 reasoning/);
    assert.match(JSON.stringify(projection.messages), /search result/);
    assert.match(JSON.stringify(projection.messages), /fetch result/);
  }
});
