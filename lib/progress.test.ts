import assert from "node:assert/strict";
import test from "node:test";

import type { AcceptanceDelta, AcceptanceSnapshot } from "./acceptance";
import {
  evaluateNoProgressWatchdog,
  ProgressTracker,
  type ProgressTrackerSnapshot,
  type StepProgressReceipt,
} from "./progress";
import type { ObservedState, ToolReceipt } from "./receipts/types";

const openAcceptance: AcceptanceSnapshot = {
  criteria: [],
  gap: ["artifact pending"],
};

const unchangedAcceptance: AcceptanceDelta = {
  changed: [],
  gapAfter: ["artifact pending"],
  gapBefore: ["artifact pending"],
};

function receipt(overrides: Partial<ToolReceipt> = {}): ToolReceipt {
  const success = overrides.success ?? true;

  return {
    category: "command",
    domainStatus: success ? "succeeded" : "failed",
    durationMs: 1,
    endedAt: 2,
    id: "receipt",
    input: {},
    inputHash: "input",
    inputSummary: "input",
    projection: {},
    result: success ? "ok" : "failed",
    resultHash: success ? "ok-hash" : "failure-hash",
    resultSummary: success ? "ok" : "failed",
    reused: false,
    startedAt: 1,
    strategySignature: "route",
    success,
    toolName: "run_terminal",
    toolUseId: "tool-use",
    unchanged: false,
    ...overrides,
  };
}

function evaluateTracker(tracker: ProgressTracker, receipts: ToolReceipt[]) {
  const observedState: ObservedState = {
    artifacts: {},
    commands: [],
    evidence: {},
    files: {},
    receipts,
    stateHash: `state-${receipts.map((item) => item.id).join("-")}`,
    unresolvedErrors: [],
    verification: [],
  };

  return tracker.evaluate({
    acceptanceAfter: openAcceptance,
    acceptanceDelta: unchangedAcceptance,
    observedState,
    receipts,
  });
}

function progress(
  overrides: Partial<StepProgressReceipt> = {},
): StepProgressReceipt {
  return {
    deliverableGapAfter: ["pptx pending"],
    deliverableGapBefore: ["pptx pending"],
    informationDeltas: [],
    informationGain: false,
    noMeaningfulProgressStreak: 0,
    noObjectiveProgressStreak: 0,
    objectiveDeltas: [],
    objectiveProgress: false,
    primaryCategory: "unchanged",
    regression: false,
    regressionDeltas: [],
    sameStrategyFailureStreak: 0,
    stateHash: "state",
    strategySignature: "strategy",
    ...overrides,
  };
}

test("information-only work triggers a delivery review without declaring route failure", () => {
  const decision = evaluateNoProgressWatchdog(
    progress({
      informationDeltas: ["new evidence"],
      informationGain: true,
      noMeaningfulProgressStreak: 0,
      noObjectiveProgressStreak: 6,
      primaryCategory: "evidence",
    }),
  );

  assert.equal(decision?.action, "review");
  assert.equal(decision?.suppressMaintenanceTools, false);
  assert.doesNotMatch(decision?.message ?? "", /失败路线/);
});

test("ten state or failure rounds still create a recoverable checkpoint", () => {
  const decision = evaluateNoProgressWatchdog(
    progress({
      informationDeltas: ["new diagnostic"],
      informationGain: true,
      noMeaningfulProgressStreak: 10,
      noObjectiveProgressStreak: 10,
      primaryCategory: "failed",
    }),
  );

  assert.equal(decision?.action, "checkpoint");
  assert.match(decision?.message ?? "", /客观推进或新的有效信息/);
});

test("six rounds without meaningful progress require a strategy reset", () => {
  const decision = evaluateNoProgressWatchdog(
    progress({
      noMeaningfulProgressStreak: 6,
      noObjectiveProgressStreak: 6,
    }),
  );

  assert.equal(decision?.action, "replan");
  assert.equal(decision?.suppressMaintenanceTools, true);
  assert.match(decision?.message ?? "", /有效新证据、真实观察或客观工件推进/);
});

test("two identical real failures take precedence over a delivery review", () => {
  const decision = evaluateNoProgressWatchdog(
    progress({
      noMeaningfulProgressStreak: 2,
      noObjectiveProgressStreak: 6,
      primaryCategory: "failed",
      sameStrategyFailureStreak: 2,
    }),
  );

  assert.equal(decision?.action, "replan");
  assert.match(decision?.message ?? "", /同一策略连续两轮失败/);
});

test("a closed deliverable gap suppresses stale progress reminders", () => {
  const decision = evaluateNoProgressWatchdog(
    progress({
      deliverableGapAfter: [],
      deliverableGapBefore: [],
      noMeaningfulProgressStreak: 10,
      noObjectiveProgressStreak: 10,
      sameStrategyFailureStreak: 2,
    }),
  );

  assert.equal(decision, null);
});

test("progress tracker snapshot survives a JSON roundtrip", () => {
  const tracker = new ProgressTracker();
  const evidence = receipt({
    category: "evidence",
    id: "evidence-1",
    projection: {
      evidence: [{ key: "source", summary: "new source" }],
    },
    resultHash: "evidence-hash",
    resultSummary: "new source",
    strategySignature: "evidence-route",
    toolName: "search_web",
  });
  const verification = receipt({
    id: "verification-1",
    projection: {
      commands: [{ command: "npm test", exitCode: 0, timedOut: false }],
    },
    strategySignature: "verification-route",
  });
  const failed = receipt({
    domainStatus: "failed",
    id: "failure-1",
    result: "failed route",
    resultHash: "failure-hash",
    resultSummary: "failed route",
    strategySignature: "failed-route",
    success: false,
  });

  evaluateTracker(tracker, [evidence, verification]);
  evaluateTracker(tracker, [failed]);
  const snapshot = tracker.snapshot();
  const serialized = JSON.parse(
    JSON.stringify(snapshot),
  ) as ProgressTrackerSnapshot;
  const restored = new ProgressTracker();

  restored.restore(serialized);

  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(snapshot.noMeaningfulProgressStreak, 1);
  assert.equal(snapshot.noObjectiveProgressStreak, 1);
  assert.equal(snapshot.sameStrategyFailureStreak, 1);
  assert.ok(snapshot.previousStrategySignature);
  assert.ok(snapshot.seenInformation.length > 0);
  assert.ok(snapshot.seenObjectiveActions.length > 0);

  serialized.seenInformation.push("external-mutation");
  serialized.seenObjectiveActions.push("external-mutation");
  assert.deepEqual(restored.snapshot(), snapshot);
});

test("restored tracker continues the same failed strategy streak", () => {
  const original = new ProgressTracker();
  const failed = receipt({
    domainStatus: "failed",
    id: "failure",
    result: "same failure",
    resultHash: "same-failure-hash",
    resultSummary: "same failure",
    strategySignature: "same-route",
    success: false,
  });

  const first = evaluateTracker(original, [failed]);
  const restored = new ProgressTracker();
  restored.restore(original.snapshot());
  const second = evaluateTracker(restored, [
    { ...failed, id: "failure-after-recovery", toolUseId: "tool-use-2" },
  ]);

  assert.equal(first.sameStrategyFailureStreak, 1);
  assert.equal(second.sameStrategyFailureStreak, 2);
  assert.equal(second.noMeaningfulProgressStreak, 2);
  assert.equal(second.noObjectiveProgressStreak, 2);
  assert.equal(second.informationGain, false);
});
