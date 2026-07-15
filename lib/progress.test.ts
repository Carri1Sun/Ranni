import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNoProgressWatchdog,
  type StepProgressReceipt,
} from "./progress";

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
