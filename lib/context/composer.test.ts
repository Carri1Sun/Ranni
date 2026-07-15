import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "../llm";
import { composeContext } from "./composer";
import type { StablePrefixState } from "./types";

function toolUse(id: string, name: string): AgentToolUseBlock {
  return {
    id,
    input: { query: id },
    inputComplete: true,
    name,
    providerMetadata: {
      responsesReasoningItems: [{ id: `reasoning-${id}`, type: "reasoning" }],
    },
    type: "tool_use",
  };
}

function toolResult(id: string): AgentToolResultBlock {
  return {
    content: `result-${id}`,
    tool_use_id: id,
    type: "tool_result",
  };
}

function compose(
  messages: AgentMessage[],
  contextWindow = 1_050_000,
  previousStablePrefixState?: StablePrefixState,
  activeSkillNames = ["html-to-pptx"],
) {
  return composeContext({
    activeSkillNames,
    contextWindow,
    initialMessageCount: 1,
    maxOutputTokens: Math.min(128_000, Math.floor(contextWindow / 4)),
    messages,
    ...(previousStablePrefixState ? { previousStablePrefixState } : {}),
    safetyMargin: Math.min(500, Math.floor(contextWindow / 10)),
    stepIndex: 2,
    systemPrompt: "stable system",
    taskContract: {
      authorizationBoundary: ["workspace"],
      constraints: [],
      deliverable: "pptx",
      goal: "create deck",
      successCriteria: ["validated"],
    },
    toolDefinitions: [{ name: "search_web" }],
    workingSet: {
      acceptanceGap: ["pptx pending"],
      agentNote: { nextAction: "continue" },
      artifactSummary: [],
      observedFacts: [],
      rejectedAssumptionCount: 0,
      unresolvedErrors: [],
    },
  });
}

test("phase-independent context preserves every previous parallel tool pair", () => {
  const uses = Array.from({ length: 8 }, (_, index) =>
    toolUse(`call-${index}`, index % 2 ? "fetch_url" : "search_web"),
  );
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning before parallel work" },
        ...uses,
      ],
    },
    { role: "user", content: uses.map((use) => toolResult(use.id)) },
  ];
  const envelope = compose(messages);
  const serialized = JSON.stringify(envelope.messages);

  assert.equal(envelope.composition.compactionApplied, false);
  assert.deepEqual(envelope.composition.previousTurnToolPairs, {
    expected: 8,
    preserved: 8,
  });
  for (const use of uses) {
    assert.match(serialized, new RegExp(use.id));
    assert.match(serialized, new RegExp(`result-${use.id}`));
  }
  assert.match(serialized, /reasoning before parallel work/);
  assert.equal(envelope.composition.prefixCacheEligibleMessageCount, 0);
});

test("stable prefix reports cache eligibility and real invalidation causes", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
    { role: "assistant", content: [toolUse("call-1", "search_web")] },
    { role: "user", content: [toolResult("call-1")] },
  ];
  const first = compose(messages);
  const unchanged = compose(messages, 1_050_000, first.stablePrefixState);
  const skillChanged = compose(
    messages,
    1_050_000,
    unchanged.stablePrefixState,
    ["html-to-pptx", "new-skill"],
  );

  assert.equal(unchanged.composition.stablePrefixInvalidationReason, undefined);
  assert.equal(unchanged.composition.prefixCacheEligibleMessageCount, 1);
  assert.equal(
    skillChanged.composition.stablePrefixInvalidationReason,
    "skill-changed",
  );
  assert.equal(skillChanged.composition.prefixCacheEligibleMessageCount, 0);
});

test("compaction is triggered by capacity and keeps recent causal turns atomic", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
  ];

  for (let index = 0; index < 7; index += 1) {
    messages.push({
      role: "assistant",
      content: [
        { type: "thinking", thinking: `reasoning-${index}` },
        toolUse(`call-${index}`, "read_file"),
      ],
    });
    messages.push({
      role: "user",
      content: [
        {
          ...toolResult(`call-${index}`),
          content: `${`payload-${index}-`.repeat(400)}`,
        },
      ],
    });
  }

  const envelope = compose(messages, 8_000);
  const serialized = JSON.stringify(envelope.messages);

  assert.equal(envelope.composition.compactionApplied, true);
  assert.equal(envelope.composition.compactionReason, "budget");
  assert.deepEqual(envelope.composition.previousTurnToolPairs, {
    expected: 1,
    preserved: 1,
  });
  assert.match(serialized, /call-6/);
  assert.match(serialized, /payload-6/);
  assert.match(envelope.archiveSummary, /capacity compaction/);
});

test("incomplete previous causal turn is rejected before a provider request", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
    {
      role: "assistant",
      content: [toolUse("call-missing", "search_web")],
    },
  ];

  assert.throws(
    () => compose(messages),
    /missing tool results for call-missing/,
  );
});

test("capacity compaction also handles long tool-free history", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "original goal" }] },
  ];
  for (let index = 0; index < 20; index += 1) {
    messages.push({
      role: index % 2 === 0 ? "assistant" : "user",
      content: [
        {
          type: "text",
          text: `historical-${index}-${"payload".repeat(300)}`,
        },
      ],
    });
  }

  const envelope = compose(messages, 8_000);
  const serialized = JSON.stringify(envelope.messages);

  assert.equal(envelope.composition.compactionApplied, true);
  assert.match(serialized, /original goal/);
  assert.match(serialized, /historical-19/);
  assert.doesNotMatch(serialized, /historical-1-payload/);
  assert.match(envelope.archiveSummary, /capacity compaction/);
});

test("any incomplete historical causal turn is rejected before provider input", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
    { role: "assistant", content: [toolUse("old-missing", "search_web")] },
    { role: "assistant", content: [{ type: "text", text: "continued" }] },
  ];

  assert.throws(() => compose(messages), /old-missing/);
});

test("oversized pinned causal tail fails before a provider request", () => {
  const messages: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "goal" }] },
    { role: "assistant", content: [toolUse("huge", "fetch_url")] },
    {
      role: "user",
      content: [{ ...toolResult("huge"), content: "x".repeat(30_000) }],
    },
  ];

  assert.throws(
    () => compose(messages, 8_000),
    /Context capacity exceeded after safe compaction/,
  );
});
