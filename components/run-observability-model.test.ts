import assert from "node:assert/strict";
import test from "node:test";

import type { StepTraceIO } from "../lib/runs/run-trace-store";
import {
  createRunOverviewProjection,
  reduceRunOverviewProjection,
} from "../lib/runs/run-overview-projection";

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
          plan: {
            focusItemId: "P01",
            id: "plan-1",
            items: [
              {
                acceptanceRefs: [],
                attemptIds: ["attempt-1"],
                createdAtStep: 1,
                dependsOn: [],
                evidenceHints: [],
                evidenceRefs: [],
                id: "P01",
                intent: "draft deck",
                modelStatus: "in_progress",
                status: "active",
                statusSource: "model",
                title: "draft deck",
                updatedAtStep: 1,
              },
            ],
            projectionVersion: 0,
            revision: 1,
          },
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
      latestPlanState: {
        focusItemId: "P02",
        id: "plan-1",
        items: [
          {
            acceptanceRefs: ["pptx"],
            evidenceRefs: ["receipt-slides"],
            id: "P02",
            status: "active",
            title: "validate PPTX",
          },
        ],
        projectionVersion: 3,
        revision: 2,
        revisions: [{ reason: "slides are ready for validation" }],
      },
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
          attemptState: {
            assumptions: [],
            attempts: [
              {
                approach: "assemble and validate deck",
                assumptionIds: [],
                endedAtStep: 2,
                evidenceRefs: ["failed-state"],
                exitCriteria: [],
                id: "attempt-1",
                startedAtStep: 0,
                status: "failed",
                supersededBy: "attempt-2",
              },
              {
                approach: "repair export, then validate the PPTX",
                assumptionIds: [],
                evidenceRefs: [],
                exitCriteria: ["PPTX validation passes"],
                id: "attempt-2",
                startedAtStep: 2,
                status: "active",
              },
            ],
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
  assert.equal(
    overview.route.approach,
    "repair export, then validate the PPTX",
  );
  assert.equal(overview.route.id, "attempt-2");
  assert.equal(overview.route.status, "active");
  assert.match(overview.route.changeReason ?? "", /attempt-1/);
  assert.equal(overview.acceptance.counts.passed, 1);
  assert.equal(overview.acceptance.counts.pending, 1);
  assert.deepEqual(overview.deliverableGap, ["pptx: export deck (pending)"]);
  assert.deepEqual(overview.evidenceRefs, ["receipt-slides"]);
  assert.equal(overview.progress?.objectiveProgress, true);
  assert.equal(overview.nextAction, "run validation");
  assert.deepEqual(overview.blockers, ["preview stale"]);
  assert.equal(overview.plan.revision, 2);
  assert.equal(overview.plan.focusItemId, "P02");
  assert.equal(overview.plan.items[0]?.title, "validate PPTX");
  assert.equal(
    overview.plan.revisionReason,
    "slides are ready for validation",
  );
});

test("prefers the run-level projection when an older step stays selected", () => {
  const initial = createRunOverviewProjection("run-1", 100);
  const planProjection = reduceRunOverviewProjection(initial, {
    type: "plan.updated",
    runId: "run-1",
    sessionId: "session-1",
    seq: 42,
    stepId: "step-4",
    stepIndex: 4,
    planChange: {
      changed: true,
      changedItemIds: ["P03"],
      kind: "revision",
      snapshot: {
        focusItemId: "P03",
        id: "plan-1",
        items: [
          {
            acceptanceRefs: ["pptx"],
            attemptIds: ["attempt-3"],
            createdAtStep: 4,
            dependsOn: ["P02"],
            evidenceHints: ["verification receipt"],
            evidenceRefs: [],
            expectedOutcome: "A validated PPTX",
            id: "P03",
            intent: "validate final artifact",
            modelStatus: "in_progress",
            status: "active",
            statusSource: "model",
            title: "验证最终 PPTX",
            updatedAtStep: 4,
          },
        ],
        projectionVersion: 3,
        revision: 3,
        revisions: [
          {
            changedItemIds: ["P03"],
            createdAtStep: 4,
            id: "revision-3",
            itemIds: ["P03"],
            number: 3,
            reason: "进入最终验证",
            reasonKind: "refinement",
          },
        ],
      },
    },
  });
  const acceptanceProjection = reduceRunOverviewProjection(planProjection, {
    acceptanceDelta: {
      changed: [{ from: "pending", id: "pptx", to: "passed" }],
      gapAfter: [],
      gapBefore: ["pptx"],
    },
    acceptanceState: {
      criteria: [
        {
          description: "Validate PPTX",
          evidenceRefs: ["receipt-current"],
          id: "pptx",
          required: true,
          status: "passed",
        },
      ],
      gap: [],
    },
    runId: "run-1",
    seq: 43,
    sessionId: "session-1",
    stepId: "step-4",
    stepIndex: 4,
    type: "acceptance.updated",
  });
  const observedProjection = reduceRunOverviewProjection(
    acceptanceProjection,
    {
      observedState: {
        artifacts: {},
        commands: [],
        evidence: {},
        files: {},
        receipts: [],
        stateHash: "current-state",
        unresolvedErrors: [],
        verification: [],
      },
      runId: "run-1",
      seq: 44,
      sessionId: "session-1",
      stepId: "step-4",
      stepIndex: 4,
      type: "state.observed.updated",
    },
  );
  const progressProjection = reduceRunOverviewProjection(observedProjection, {
    progressReceipt: {
      deliverableGapAfter: [],
      deliverableGapBefore: ["pptx"],
      informationDeltas: [],
      informationGain: false,
      noMeaningfulProgressStreak: 0,
      noObjectiveProgressStreak: 0,
      objectiveDeltas: ["pptx: pending -> passed"],
      objectiveProgress: true,
      primaryCategory: "verification",
      regression: false,
      regressionDeltas: [],
      sameStrategyFailureStreak: 0,
      stateHash: "current-state",
      strategySignature: "validate-current-pptx",
    },
    runId: "run-1",
    seq: 45,
    sessionId: "session-1",
    stepId: "step-4",
    stepIndex: 4,
    type: "progress.receipt",
  });
  const projection = reduceRunOverviewProjection(progressProjection, {
    attemptDelta: {
      activeAttemptId: "attempt-3",
      created: "attempt-3",
    },
    attemptState: {
      assumptions: [],
      attempts: [
        {
          approach: "validate the current PPTX",
          assumptionIds: [],
          evidenceRefs: [],
          exitCriteria: ["validation passes"],
          id: "attempt-3",
          startedAtStep: 4,
          status: "active",
        },
      ],
    },
    runId: "run-1",
    seq: 46,
    sessionId: "session-1",
    stepId: "step-4",
    stepIndex: 4,
    type: "attempt.updated",
  });

  const overview = buildRunOverviewView({
    io: createStepIO(),
    overview: projection,
  });

  assert.equal(overview.plan.focusItemId, "P03");
  assert.equal(overview.plan.revision, 3);
  assert.equal(overview.plan.items[0]?.title, "验证最终 PPTX");
  assert.deepEqual(overview.plan.items[0]?.dependsOn, ["P02"]);
  assert.equal(overview.plan.items[0]?.statusSource, "model");
  assert.equal(overview.route.id, "attempt-3");
  assert.equal(overview.route.changeReason, undefined);
  assert.deepEqual(overview.deliverableGap, []);
  assert.deepEqual(overview.blockers, []);
  assert.deepEqual(overview.evidenceRefs, ["receipt-current"]);
  assert.equal(overview.latestSeq, 46);
  assert.equal(overview.legacy, false);
  assert.ok(overview.timeline.length > 0);
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
  assert.deepEqual(overview.plan.items, []);
});
