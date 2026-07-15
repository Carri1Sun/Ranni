import assert from "node:assert/strict";
import test from "node:test";

import { PlanAttemptLedger } from "./plan-attempt";
import type { StepProgressReceipt } from "./progress";

function failedProgress(): StepProgressReceipt {
  return {
    deliverableGapAfter: ["artifact pending"],
    deliverableGapBefore: ["artifact pending"],
    informationDeltas: [],
    informationGain: false,
    noMeaningfulProgressStreak: 6,
    noObjectiveProgressStreak: 6,
    objectiveDeltas: [],
    objectiveProgress: false,
    primaryCategory: "failed",
    regression: false,
    regressionDeltas: [],
    sameStrategyFailureStreak: 2,
    stateHash: "observed-state-6",
    strategySignature: "same-route",
  };
}

test("failed attempt invalidates its active assumptions with evidence", () => {
  const ledger = new PlanAttemptLedger("use primary exporter");
  const [assumptionId] = ledger.recordAssumptions([
    "primary exporter supports the current deck",
  ]);

  const delta = ledger.observe(failedProgress(), 6);
  const snapshot = ledger.snapshot();
  const assumption = snapshot.assumptions.find(
    (item) => item.id === assumptionId,
  );

  assert.deepEqual(delta.invalidatedAssumptionIds, [assumptionId]);
  assert.equal(assumption?.status, "rejected");
  assert.deepEqual(assumption?.evidenceRefs, ["observed-state-6"]);
  assert.equal(ledger.active()?.approach, "重新读取现场并采用替代路线");
});

test("repeated rejected assumption is not restored without new evidence", () => {
  const ledger = new PlanAttemptLedger("route");
  const [assumptionId] = ledger.recordAssumptions(["same assumption"]);
  ledger.observe(failedProgress(), 6);

  const recorded = ledger.recordAssumptions(["same assumption"]);

  assert.deepEqual(recorded, []);
  assert.equal(
    ledger.snapshot().assumptions.find((item) => item.id === assumptionId)
      ?.status,
    "rejected",
  );
});

test("successful research does not fail an attempt when only the deliverable gap stays open", () => {
  const ledger = new PlanAttemptLedger("research primary sources");
  const [assumptionId] = ledger.recordAssumptions([
    "primary sources can support the comparison",
  ]);

  const delta = ledger.observe(
    {
      ...failedProgress(),
      informationDeltas: ["new evidence"],
      informationGain: true,
      noMeaningfulProgressStreak: 0,
      sameStrategyFailureStreak: 0,
      primaryCategory: "evidence",
    },
    6,
  );

  assert.equal(delta.failed, undefined);
  assert.equal(ledger.active()?.approach, "research primary sources");
  assert.equal(
    ledger.snapshot().assumptions.find((item) => item.id === assumptionId)
      ?.status,
    "active",
  );
});

test("a successful workspace receipt does not inherit an objective-only failure streak", () => {
  const ledger = new PlanAttemptLedger("initialize the artifact workspace");

  const delta = ledger.observe(
    {
      ...failedProgress(),
      informationGain: false,
      noMeaningfulProgressStreak: 0,
      noObjectiveProgressStreak: 7,
      primaryCategory: "unchanged",
      sameStrategyFailureStreak: 0,
    },
    7,
  );

  assert.equal(delta.failed, undefined);
  assert.equal(ledger.active()?.approach, "initialize the artifact workspace");
});

test("six rounds without meaningful progress fail the route only at the threshold crossing", () => {
  const ledger = new PlanAttemptLedger("stalled route");

  const failed = ledger.observe(
    {
      ...failedProgress(),
      sameStrategyFailureStreak: 0,
    },
    6,
  );
  const nextAttemptId = ledger.active()?.id;
  const afterThreshold = ledger.observe(
    {
      ...failedProgress(),
      noMeaningfulProgressStreak: 7,
      noObjectiveProgressStreak: 7,
      sameStrategyFailureStreak: 0,
    },
    7,
  );

  assert.ok(failed.failed);
  assert.equal(afterThreshold.failed, undefined);
  assert.equal(ledger.active()?.id, nextAttemptId);
});
