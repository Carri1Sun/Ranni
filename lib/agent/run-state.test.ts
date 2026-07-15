import assert from "node:assert/strict";
import test from "node:test";

import { createTextDeliverableContract } from "../acceptance";
import type { ObservedState } from "../receipts/types";
import {
  createAgentRunRecoverySnapshot,
  createAgentRunState,
  reconcileTaskStateFromObserved,
  restoreAgentRunState,
} from "./run-state";

test("task-state compatibility projection uses latest verification per scope", () => {
  const state = createAgentRunState({
    activeSkillNames: [],
    conversation: [],
    deliverableContract: createTextDeliverableContract(),
    latestUserPrompt: "verify",
  });
  const observed: ObservedState = {
    artifacts: {},
    commands: [],
    evidence: {},
    files: {},
    receipts: [],
    stateHash: "state",
    unresolvedErrors: [],
    verification: [
      {
        details: ["first failed"],
        passed: false,
        receiptId: "failed",
        scope: "build",
      },
      {
        details: ["later passed"],
        passed: true,
        receiptId: "passed",
        scope: "build",
      },
    ],
  };

  reconcileTaskStateFromObserved(state, observed);

  assert.equal(state.taskState.verification.status, "passed");
  assert.deepEqual(state.taskState.verification.evidence, [
    "first failed",
    "later passed",
  ]);
});

test("run recovery snapshot restores plan, attempt, progress, receipts, and causal context", () => {
  const state = createAgentRunState({
    activeSkillNames: ["html-to-pptx"],
    conversation: [
      { role: "user", content: [{ type: "text", text: "create a deck" }] },
    ],
    deliverableContract: createTextDeliverableContract(),
    latestUserPrompt: "create a deck",
  });
  state.contextSnapshotHash = "causal-snapshot";
  state.completedSteps = 4;
  state.planLedger.updateLegacy(["research", "build", "verify"], {
    attemptId: state.attempts.active()?.id,
    stepIndex: 1,
  });
  state.planAuthority = "structured";
  state.attempts.propose(
    "build with the validated slide exporter",
    2,
    ["PPTX validates"],
    "the exporter is available",
  );
  state.progress.restore({
    noMeaningfulProgressStreak: 1,
    noObjectiveProgressStreak: 3,
    previousStrategySignature: "route-signature",
    sameStrategyFailureStreak: 1,
    seenInformation: ["evidence:one"],
    seenObjectiveActions: ["command:build"],
  });

  const snapshot = createAgentRunRecoverySnapshot(state);
  const restored = restoreAgentRunState(
    JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
  );

  assert.deepEqual(createAgentRunRecoverySnapshot(restored), snapshot);
  assert.equal(restored.planLedger.snapshot().revision, 1);
  assert.equal(restored.planAuthority, "structured");
  assert.equal(restored.attempts.active()?.approach, "build with the validated slide exporter");
  assert.equal(restored.progress.snapshot().noObjectiveProgressStreak, 3);
  assert.equal(restored.contextSnapshotHash, "causal-snapshot");
});

test("recovery snapshots without plan authority preserve legacy plan compatibility", () => {
  const state = createAgentRunState({
    activeSkillNames: [],
    conversation: [],
    deliverableContract: createTextDeliverableContract(),
    latestUserPrompt: "continue a legacy run",
  });
  state.planLedger.updateLegacy(["inspect", "deliver"], { stepIndex: 1 });

  const snapshot = createAgentRunRecoverySnapshot(state);
  delete snapshot.planAuthority;
  const restored = restoreAgentRunState(snapshot);

  assert.equal(restored.planLedger.snapshot().revision, 1);
  assert.equal(restored.planAuthority, "legacy");
});
