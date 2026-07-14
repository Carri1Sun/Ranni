import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "./llm";
import {
  buildActiveContextProjection,
  createFailureFingerprint,
} from "./active-context";

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): AgentToolUseBlock {
  return {
    id,
    input,
    inputComplete: true,
    name,
    type: "tool_use",
  };
}

function toolResult(
  toolUseId: string,
  content: string,
  isError = false,
): AgentToolResultBlock {
  return {
    content,
    ...(isError ? { is_error: true } : {}),
    tool_use_id: toolUseId,
    type: "tool_result",
  };
}

function pairedMessages(
  use: AgentToolUseBlock,
  result: AgentToolResultBlock,
): AgentMessage[] {
  return [
    { role: "assistant", content: [use] },
    { role: "user", content: [result] },
  ];
}

test("projects slide work into receipts plus the latest unresolved causal pair", () => {
  const repeatedError = "Tool execution failed. Overflow: 160px x 180px";
  const conversation: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "保留这条用户目标" }],
    },
    ...pairedMessages(
      toolUse("search-1", "search_web", { query: "GLM benchmark" }),
      toolResult("search-1", `SEARCH_RAW_MARKER ${"x".repeat(2_000)}`),
    ),
    ...pairedMessages(
      toolUse("slide-ok", "write_slide_fragment", {
        deckDir: "deck",
        html: "SUCCESS_HTML_MARKER",
        slideId: "11-summary",
      }),
      toolResult("slide-ok", "Wrote deck/slides/11-summary.html"),
    ),
    ...pairedMessages(
      toolUse("slide-fail-old", "write_slide_fragment", {
        deckDir: "deck",
        html: "SUPERSEDED_FAILED_HTML_MARKER",
        slideId: "11-summary",
      }),
      toolResult("slide-fail-old", repeatedError, true),
    ),
    ...pairedMessages(
      toolUse("slide-fail-current", "write_slide_fragment", {
        deckDir: "deck",
        html: "LATEST_FAILED_HTML_MARKER",
        slideId: "11-summary",
      }),
      toolResult("slide-fail-current", repeatedError, true),
    ),
  ];

  const projection = buildActiveContextProjection({
    conversation,
    phase: "slides",
  });
  const serialized = JSON.stringify(projection.messages);

  assert.match(serialized, /保留这条用户目标/);
  assert.match(serialized, /LATEST_FAILED_HTML_MARKER/);
  assert.doesNotMatch(serialized, /SUPERSEDED_FAILED_HTML_MARKER/);
  assert.doesNotMatch(serialized, /SUCCESS_HTML_MARKER/);
  assert.doesNotMatch(serialized, /SEARCH_RAW_MARKER/);
  assert.doesNotMatch(serialized, /Required next action/);
  assert.doesNotMatch(serialized, /retry the same/i);
  assert.equal(projection.metadata.receipts.length, 1);
  assert.equal(projection.metadata.preservedToolPairCount, 1);
  assert.deepEqual(projection.metadata.failureObservations, [
    {
      count: 2,
      fingerprint: createFailureFingerprint(
        "write_slide_fragment",
        repeatedError,
      ),
      noProgressObserved: true,
      toolName: "write_slide_fragment",
      toolUseId: "slide-fail-current",
    },
  ]);
});

test("preserves recent read observations and every retained tool/result pair", () => {
  const conversation: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "第一条用户消息" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "第二条用户消息" }],
    },
    ...pairedMessages(
      toolUse("read-1", "read_file", { path: "deck/slides/.draft/11.html" }),
      toolResult("read-1", "CURRENT_DRAFT_CONTENT"),
    ),
    ...pairedMessages(
      toolUse("fetch-1", "fetch_url", { url: "https://example.com" }),
      toolResult("fetch-1", "RAW_FETCH_CONTENT"),
    ),
  ];
  const projection = buildActiveContextProjection({
    conversation,
    phase: "slides",
  });
  const serialized = JSON.stringify(projection.messages);
  const retainedUses = new Set<string>();
  const retainedResults = new Set<string>();

  for (const message of projection.messages) {
    for (const block of message.content) {
      if (block.type === "tool_use") {
        retainedUses.add(block.id);
      }
      if (block.type === "tool_result") {
        retainedResults.add(block.tool_use_id);
      }
    }
  }

  assert.match(serialized, /第一条用户消息/);
  assert.match(serialized, /第二条用户消息/);
  assert.match(serialized, /CURRENT_DRAFT_CONTENT/);
  assert.doesNotMatch(serialized, /RAW_FETCH_CONTENT/);
  assert.deepEqual(retainedUses, retainedResults);
  assert.deepEqual([...retainedUses], ["read-1"]);
});

test("retains the latest observation for each target within the active budget", () => {
  const conversation: AgentMessage[] = [
    ...pairedMessages(
      toolUse("base-old", "read_file", { path: "deck/styles/base.css" }),
      toolResult("base-old", "BASE_V1"),
    ),
    ...pairedMessages(
      toolUse("layout", "read_file", { path: "deck/styles/layout.css" }),
      toolResult("layout", "LAYOUT_CURRENT"),
    ),
    ...pairedMessages(
      toolUse("components", "read_file", {
        path: "deck/styles/components.css",
      }),
      toolResult("components", "COMPONENTS_CURRENT"),
    ),
    ...pairedMessages(
      toolUse("manifest", "read_file", { path: "deck/manifest.json" }),
      toolResult("manifest", "MANIFEST_CURRENT"),
    ),
    ...pairedMessages(
      toolUse("base-latest", "read_file", { path: "deck/styles/base.css" }),
      toolResult("base-latest", "BASE_V1"),
    ),
  ];
  const projection = buildActiveContextProjection({
    conversation,
    phase: "slides",
  });
  const serialized = JSON.stringify(projection.messages);

  assert.match(serialized, /LAYOUT_CURRENT/);
  assert.match(serialized, /COMPONENTS_CURRENT/);
  assert.match(serialized, /MANIFEST_CURRENT/);
  assert.match(serialized, /base-latest/);
  assert.doesNotMatch(serialized, /base-old/);
  assert.equal(projection.metadata.observationStates.length, 4);
  assert.equal(
    projection.metadata.observationStates.find(
      (item) => item.target === "read_file:deck/styles/base.css",
    )?.repeatedCount,
    2,
  );
});

test("preserves initial dialogue and only the pending internal control text", () => {
  const conversation: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "请沿用上一轮的方案" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "上一轮确认的视觉方向" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Internal completion guard: old" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "已处理旧 guard" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "Internal model-output observation: current" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "用户追加：封面改成深色" }],
    },
  ];
  const projection = buildActiveContextProjection({
    conversation,
    initialMessageCount: 2,
    phase: "slides",
  });
  const serialized = JSON.stringify(projection.messages);

  assert.match(serialized, /请沿用上一轮的方案/);
  assert.match(serialized, /上一轮确认的视觉方向/);
  assert.match(serialized, /用户追加：封面改成深色/);
  assert.doesNotMatch(serialized, /Internal completion guard: old/);
  assert.match(serialized, /Internal model-output observation: current/);
});

test("keeps manifest semantics and observed result in a compact receipt", () => {
  const conversation: AgentMessage[] = [
    ...pairedMessages(
      toolUse("manifest", "set_slide_manifest", {
        deckDir: "deck",
        slideIds: ["01-cover", "02-context", "03-summary"],
      }),
      toolResult("manifest", "Manifest saved with 3 slides."),
    ),
  ];
  const projection = buildActiveContextProjection({
    conversation,
    phase: "slides",
  });
  const serialized = JSON.stringify(projection.messages);

  assert.match(serialized, /slide_ids=01-cover,02-context,03-summary/);
  assert.match(serialized, /Manifest saved with 3 slides/);
  assert.deepEqual(projection.metadata.receipts[0]?.details, [
    "slide_ids=01-cover,02-context,03-summary",
  ]);
});

test("removes a superseded failure after the same artifact succeeds", () => {
  const conversation: AgentMessage[] = [
    ...pairedMessages(
      toolUse("failed", "write_style_fragment", {
        css: "FAILED_CSS_PAYLOAD",
        deckDir: "deck",
        styleId: "base",
      }),
      toolResult("failed", "invalid css", true),
    ),
    ...pairedMessages(
      toolUse("succeeded", "write_style_fragment", {
        css: "SUCCESS_CSS_PAYLOAD",
        deckDir: "deck",
        styleId: "base",
      }),
      toolResult("succeeded", "Wrote deck/styles/base.css"),
    ),
  ];
  const projection = buildActiveContextProjection({
    conversation,
    phase: "styles",
  });
  const serialized = JSON.stringify(projection.messages);

  assert.doesNotMatch(serialized, /FAILED_CSS_PAYLOAD/);
  assert.doesNotMatch(serialized, /SUCCESS_CSS_PAYLOAD/);
  assert.equal(projection.metadata.failureObservations.length, 0);
  assert.equal(projection.metadata.receipts.length, 1);
});

test("returns the complete conversation outside slide artifact work", () => {
  const conversation: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "full context" }],
    },
  ];
  const projection = buildActiveContextProjection({
    conversation,
    phase: "off",
  });

  assert.equal(projection.messages, conversation);
  assert.equal(projection.metadata.applied, false);
});
