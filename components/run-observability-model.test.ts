import assert from "node:assert/strict";
import test from "node:test";

import type { StepTraceIO } from "../lib/runs/run-trace-store";

import {
  buildContextHealthView,
  buildInputCompositionSections,
  buildRunOverviewView,
  buildToolPairs,
  selectStepIOForView,
} from "./run-observability-model";

function createStepIO(): StepTraceIO {
  return {
    input: {
      context: {
        archiveSummary: "earlier research",
        composition: {
          compactionApplied: false,
          estimatedInputTokens: 2100,
          finalMessageCount: 4,
          omittedHistoricalToolPairCount: 3,
          originalMessageCount: 4,
          previousTurnToolPairs: { expected: 2, preserved: 2 },
          prefixCacheEligibleMessageCount: 1,
          recentCausalTurnCount: 3,
          safeInputBudget: 8000,
          sections: [
            {
              estimatedTokens: 1200,
              hash: "system",
              itemCount: 1,
              name: "system",
              treatment: "pinned",
            },
            {
              estimatedTokens: 300,
              hash: "working",
              itemCount: 4,
              name: "working_set",
              treatment: "full",
            },
          ],
          semanticInvalidationCount: 1,
          skills: [],
          snapshotHash: "snapshot",
          stablePrefixHash: "stable-prefix-hash",
          stablePrefixInvalidationReason: "tools-changed",
          staleReasoningItemCount: 0,
          version: 2,
        },
        messages: [],
        stats: {
          assistantMessageCount: 1,
          contentBlockCount: 4,
          estimatedInputOccupancyRatio: 0.2,
          estimatedInputTokens: 2100,
          modelContextWindow: 16000,
          serializedChars: 8000,
          systemPromptChars: 1200,
          toolCount: 2,
          userMessageCount: 2,
        },
        systemPrompt: "system",
        taskContract: {
          authorizationBoundary: [],
          constraints: ["8 pages"],
          deliverable: "pptx",
          goal: "create deck",
          successCriteria: ["validated"],
        },
        tools: [],
        workingSet: {
          acceptanceGap: ["pptx: export deck (pending)"],
          activeAttempt: {
            approach: "assemble and validate deck",
            id: "attempt-1",
            status: "active",
          },
          agentNote: { nextAction: "run validation" },
          artifactSummary: ["slides 8/8"],
          observedFacts: [],
          rejectedAssumptionCount: 0,
          unresolvedErrors: ["preview stale"],
        },
      },
      exactRequest: { messages: [{ role: "user", content: "continue" }] },
      frozenAtSeq: 3,
      requestSeq: 3,
      runId: "run-1",
      schemaVersion: 1,
      snapshotHash: "snapshot",
      stepId: "step-2",
      stepIndex: 2,
    },
    output: {
      acceptanceDeltas: [
        {
          changed: [{ from: "pending", id: "slides", to: "passed" }],
          gapAfter: ["pptx: export deck (pending)"],
          gapBefore: ["slides", "pptx"],
        },
      ],
      assistantText: "",
      assumptionInvalidations: [],
      attemptDeltas: [
        {
          activeAttemptId: "attempt-2",
          created: "attempt-2",
          failed: "attempt-1",
        },
      ],
      completionChecks: [
        {
          acceptanceGap: ["pptx"],
          evidenceRefs: ["receipt-slides"],
          ready: false,
          reason: "PPTX validation pending",
          type: "completion.checked",
        },
      ],
      observedStates: [],
      progressReceipts: [
        {
          deliverableGapAfter: ["pptx: export deck (pending)"],
          deliverableGapBefore: ["slides", "pptx"],
          informationDeltas: [],
          informationGain: false,
          noMeaningfulProgressStreak: 0,
          noObjectiveProgressStreak: 0,
          objectiveDeltas: ["slides: pending -> passed"],
          objectiveProgress: true,
          primaryCategory: "artifact",
          regression: false,
          regressionDeltas: [],
          sameStrategyFailureStreak: 0,
          stateHash: "state",
          strategySignature: "strategy",
        },
      ],
      recoveryEvents: [],
      researchStates: [],
      runId: "run-1",
      schemaVersion: 1,
      semanticEvents: [
        {
          acceptanceDelta: {},
          acceptanceState: {
            criteria: [
              {
                description: "Generate eight slides",
                evidenceRefs: ["receipt-slides"],
                id: "slides",
                required: true,
                status: "passed",
              },
              {
                description: "Validate PPTX",
                evidenceRefs: [],
                id: "pptx",
                required: true,
                status: "pending",
              },
            ],
            gap: ["pptx"],
          },
          runId: "run-1",
          seq: 8,
          sessionId: "session-1",
          stepId: "step-2",
          type: "acceptance.updated",
        },
        {
          attemptDelta: {
            activeAttemptId: "attempt-2",
            created: "attempt-2",
            failed: "attempt-1",
          },
          runId: "run-1",
          seq: 9,
          sessionId: "session-1",
          stepId: "step-2",
          type: "attempt.updated",
        },
      ],
      status: "completed",
      statusMessages: [],
      stepId: "step-2",
      stepIndex: 2,
      taskStates: [],
      thinking: "",
      toolCalls: [
        { name: "export", toolUseId: "tool-1", type: "tool.started" },
        { name: "validate", toolUseId: "tool-2", type: "tool.started" },
      ],
      toolReceipts: [],
      toolResults: [
        {
          name: "export",
          success: true,
          toolUseId: "tool-1",
          type: "tool.completed",
        },
      ],
      updatedAt: 100,
    },
    summary: {
      failedToolCount: 0,
      inputAvailable: true,
      inputPath: "steps/0002-input.json",
      latestSeq: 10,
      outputAvailable: true,
      outputPath: "steps/0002-output.json",
      startedAt: 1,
      status: "completed",
      stepId: "step-2",
      stepIndex: 2,
      toolCallCount: 2,
      toolResultCount: 1,
      updatedAt: 100,
    },
  };
}

test("projects persisted semantic receipts into the run overview", () => {
  const overview = buildRunOverviewView({ io: createStepIO() });

  assert.equal(overview.legacy, false);
  assert.equal(overview.route.approach, "assemble and validate deck");
  assert.match(overview.route.changeReason ?? "", /attempt-1/);
  assert.equal(overview.acceptance.counts.passed, 1);
  assert.equal(overview.acceptance.counts.pending, 1);
  assert.deepEqual(overview.deliverableGap, ["pptx: export deck (pending)"]);
  assert.deepEqual(overview.evidenceRefs, ["receipt-slides"]);
  assert.equal(overview.progress?.objectiveProgress, true);
  assert.equal(overview.nextAction, "run validation");
  assert.deepEqual(overview.blockers, ["preview stale"]);
});

test("reports causal integrity and all eight input composition sections", () => {
  const io = createStepIO();
  const health = buildContextHealthView({ io });
  const sections = buildInputCompositionSections({ io });

  assert.equal(health.causalIntegrity, "complete");
  assert.deepEqual(health.items[0], {
    label: "上一轮完整工具结果",
    value: "2 / 2",
  });
  assert.deepEqual(
    health.items.find((item) => item.label === "稳定前缀失效原因"),
    { label: "稳定前缀失效原因", value: "tools-changed" },
  );
  assert.equal(sections.length, 8);
  assert.deepEqual(
    sections.map((section) => section.key),
    [
      "system",
      "task_contract",
      "working_set",
      "causal_tail",
      "archive",
      "steering",
      "tools",
      "composition",
    ],
  );
});

test("pairs parallel tool calls and results by toolUseId", () => {
  const pairs = buildToolPairs(createStepIO());

  assert.equal(pairs.length, 2);
  assert.equal(pairs[0]?.name, "export");
  assert.equal(pairs[0]?.success, true);
  assert.equal(pairs[1]?.name, "validate");
  assert.equal(pairs[1]?.result, undefined);
});

test("never exposes persisted IO for a different selected step", () => {
  const io = createStepIO();

  assert.equal(
    selectStepIOForView({
      expectedRunId: "run-1",
      expectedStepId: "step-1",
      io,
    }),
    undefined,
  );
  assert.equal(
    selectStepIOForView({
      expectedRunId: "run-1",
      expectedStepId: "step-2",
      io,
    }),
    io,
  );
});

test("marks an SSE-only step as legacy while keeping its next action", () => {
  const overview = buildRunOverviewView({
    fallbackStep: {
      assistantText: "",
      id: "legacy",
      startedAt: 1,
      status: "running",
      statusMessages: [],
      stepIndex: 1,
      taskState: {
        assumptions: [],
        commandsRun: [],
        constraints: [],
        currentMode: "edit",
        deliverable: "",
        facts: [],
        filesTouched: [],
        goal: "test",
        nextAction: "inspect workspace",
        openQuestions: [],
        plan: [],
        successCriteria: [],
        verification: { evidence: [], status: "pending" },
      },
      thinking: "",
      toolCalls: [],
      toolResults: [],
    },
  });

  assert.equal(overview.legacy, true);
  assert.equal(overview.nextAction, "inspect workspace");
});
