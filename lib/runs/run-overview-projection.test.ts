import assert from "node:assert/strict";
import test from "node:test";

import type { PlanSnapshot } from "../plan";
import { createInitialTaskState } from "../task-state";
import {
  createRunOverviewProjection,
  reduceRunOverviewProjection,
} from "./run-overview-projection";

function planSnapshot(input?: {
  focusItemId?: string;
  revision?: number;
  projectionVersion?: number;
  firstStatus?: "active" | "satisfied";
}): PlanSnapshot {
  const revision = input?.revision ?? 1;
  return {
    focusItemId: input?.focusItemId ?? "P01",
    id: "plan-1",
    items: [
      {
        acceptanceRefs: ["criterion-file"],
        attemptIds: ["attempt-1"],
        createdAtStep: 1,
        dependsOn: [],
        evidenceHints: ["file receipt"],
        evidenceRefs: input?.firstStatus === "satisfied" ? ["receipt-1"] : [],
        id: "P01",
        intent: "create artifact",
        modelStatus:
          input?.firstStatus === "satisfied" ? "completed" : "in_progress",
        status: input?.firstStatus ?? "active",
        statusSource:
          input?.firstStatus === "satisfied" ? "receipt" : "model",
        title: "创建工件",
        updatedAtStep: revision,
      },
      ...(revision > 1
        ? [
            {
              acceptanceRefs: ["criterion-verify"],
              attemptIds: ["attempt-2"],
              createdAtStep: 2,
              dependsOn: ["P01"],
              evidenceHints: ["verification receipt"],
              evidenceRefs: [],
              id: "P02",
              intent: "verify artifact",
              modelStatus: "in_progress" as const,
              status: "active" as const,
              statusSource: "model" as const,
              title: "验证工件",
              updatedAtStep: 2,
            },
          ]
        : []),
    ],
    projectionVersion: input?.projectionVersion ?? revision,
    revision,
    revisions: [
      {
        changedItemIds: revision > 1 ? ["P01", "P02"] : ["P01"],
        createdAtStep: revision,
        id: `revision-${revision}`,
        itemIds: revision > 1 ? ["P01", "P02"] : ["P01"],
        number: revision,
        reason: revision > 1 ? "工件已生成，进入验证" : "建立初始计划",
        reasonKind: revision > 1 ? "new_evidence" : "initial",
      },
    ],
  };
}

test("reduces run-level semantic state across steps and ignores repeated seq", () => {
  const runId = "run-overview";
  let overview = createRunOverviewProjection(runId, 100);
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "context.snapshot",
      runId,
      seq: 2,
      stepId: "step-1",
      stepIndex: 1,
      context: {
        workingSet: {
          acceptanceGap: ["criterion-file: create artifact (pending)"],
          activeAttempt: {
            approach: "先创建工件",
            id: "attempt-1",
            status: "active",
          },
          activeAssumptions: ["workspace 可写"],
          plan: {
            ...planSnapshot(),
            lastRevision: planSnapshot().revisions[0],
            revisions: undefined,
          },
        },
      },
    },
    { now: 200 },
  );

  assert.equal(overview.latestSeq, 2);
  assert.equal(overview.plan?.focusItemId, "P01");
  assert.equal(overview.attempt?.attempts[0]?.id, "attempt-1");
  assert.deepEqual(overview.acceptance?.gap, [
    "criterion-file: create artifact (pending)",
  ]);
  assert.equal(overview.timeline[0]?.type, "context.seeded");

  const repeated = reduceRunOverviewProjection(
    overview,
    {
      type: "context.snapshot",
      runId,
      seq: 2,
      stepIndex: 1,
      context: {},
    },
    { now: 201 },
  );
  assert.equal(repeated, overview);
  const outOfOrder = reduceRunOverviewProjection(
    overview,
    {
      type: "plan.updated",
      runId,
      seq: 1,
      stepIndex: 1,
      planChange: {
        changed: true,
        kind: "revision",
        snapshot: planSnapshot({ revision: 2 }),
      },
    },
    { now: 202 },
  );
  assert.equal(outOfOrder, overview);

  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "plan.updated",
      runId,
      seq: 4,
      stepId: "step-2",
      stepIndex: 2,
      planChange: {
        changed: true,
        changedItemIds: ["P01", "P02"],
        kind: "revision",
        snapshot: planSnapshot({
          firstStatus: "satisfied",
          focusItemId: "P02",
          projectionVersion: 2,
          revision: 2,
        }),
      },
    },
    { now: 400 },
  );
  assert.equal(overview.plan?.revision, 2);
  assert.equal(overview.plan?.focusItemId, "P02");
  assert.ok(
    overview.timeline.some(
      (entry) =>
        entry.type === "plan.item.status" &&
        entry.itemId === "P01" &&
        entry.fromStatus === "active" &&
        entry.toStatus === "satisfied",
    ),
  );

  const taskState = {
    ...createInitialTaskState("创建并验证工件"),
    currentMode: "verify" as const,
    nextAction: "检查工件",
  };
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "task.state",
      runId,
      seq: 5,
      stepIndex: 2,
      taskState,
    },
    { now: 500 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "state.observed.updated",
      runId,
      seq: 6,
      stepIndex: 2,
      observedState: {
        artifacts: {},
        commands: [],
        evidence: {},
        files: {},
        receipts: [],
        stateHash: "observed-1",
        unresolvedErrors: [],
        verification: [],
      },
    },
    { now: 600 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "progress.receipt",
      runId,
      seq: 7,
      stepIndex: 2,
      progressReceipt: {
        deliverableGapAfter: [],
        deliverableGapBefore: ["criterion-file"],
        informationDeltas: [],
        informationGain: false,
        noMeaningfulProgressStreak: 0,
        noObjectiveProgressStreak: 0,
        objectiveDeltas: ["criterion-file: pending → passed"],
        objectiveProgress: true,
        primaryCategory: "artifact",
        regression: false,
        regressionDeltas: [],
        sameStrategyFailureStreak: 0,
        stateHash: "progress-1",
        strategySignature: "write-file",
      },
    },
    { now: 700 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "attempt.updated",
      runId,
      seq: 8,
      stepIndex: 2,
      attemptDelta: {
        activeAttemptId: "attempt-2",
        created: "attempt-2",
        superseded: "attempt-1",
      },
      attemptState: {
        assumptions: [],
        attempts: [
          {
            approach: "验证现有工件",
            assumptionIds: [],
            evidenceRefs: [],
            exitCriteria: ["验证通过"],
            id: "attempt-2",
            startedAtStep: 2,
            status: "active",
          },
        ],
      },
    },
    { now: 800 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "acceptance.updated",
      runId,
      seq: 9,
      stepIndex: 2,
      acceptanceDelta: {
        changed: [{ from: "pending", id: "criterion-file", to: "passed" }],
        gapAfter: [],
        gapBefore: ["criterion-file"],
      },
      acceptanceState: {
        criteria: [
          {
            description: "工件存在",
            evidenceRefs: ["receipt-1"],
            id: "criterion-file",
            kind: "file",
            required: true,
            status: "passed",
            target: "artifact.pptx",
          },
        ],
        gap: [],
      },
    },
    { now: 900 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "completion.checked",
      runId,
      seq: 10,
      stepIndex: 2,
      acceptanceGap: [],
      evidenceRefs: ["receipt-1"],
      ready: true,
      reason: "工件和验证均已具备客观回执。",
    },
    { now: 1_000 },
  );
  overview = reduceRunOverviewProjection(
    overview,
    {
      type: "recovery.started",
      runId,
      seq: 11,
      stepIndex: 3,
      acceptanceGap: ["criterion-verify"],
      contextSnapshotHash: "snapshot-hash",
      error: "provider stream ended",
    },
    { now: 1_100 },
  );

  assert.equal(overview.latestSeq, 11);
  assert.equal(overview.taskState?.nextAction, "检查工件");
  assert.equal(overview.observedState?.stateHash, "observed-1");
  assert.equal(overview.progress?.objectiveProgress, true);
  assert.equal(overview.attempt?.attempts[0]?.id, "attempt-2");
  assert.equal(overview.acceptance?.criteria[0]?.status, "passed");
  assert.equal(overview.completion?.ready, true);
  assert.equal(overview.recovery?.contextSnapshotHash, "snapshot-hash");
  assert.ok(
    overview.timeline.some((entry) => entry.type === "progress.objective"),
  );
  assert.ok(
    overview.timeline.some((entry) => entry.type === "recovery.started"),
  );

  const irrelevant = reduceRunOverviewProjection(
    overview,
    { type: "thinking.completed", runId, seq: 12, message: "done" },
    { now: 1_200 },
  );
  assert.equal(irrelevant, overview);
});

test("keeps the semantic timeline bounded", () => {
  const runId = "run-overview-bounded";
  let overview = createRunOverviewProjection(runId, 0);
  for (let seq = 1; seq <= 140; seq += 1) {
    overview = reduceRunOverviewProjection(
      overview,
      {
        type: "completion.checked",
        runId,
        seq,
        stepIndex: seq,
        acceptanceGap: [`gap-${seq}`],
        evidenceRefs: [],
        ready: false,
        reason: `reason-${seq}`,
      },
      { now: seq },
    );
  }

  assert.equal(overview.timeline.length, 120);
  assert.equal(overview.timeline[0]?.seq, 21);
  assert.equal(overview.timeline.at(-1)?.seq, 140);
});
