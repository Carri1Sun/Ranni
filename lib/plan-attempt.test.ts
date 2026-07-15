import assert from "node:assert/strict";
import test from "node:test";

import { PlanAttemptLedger } from "./plan-attempt";
import type { StepProgressReceipt } from "./progress";
import { executeTool, getToolDefinitions } from "./tools";

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
  const failedAttempt = snapshot.attempts.find(
    (attempt) => attempt.id === delta.failed,
  );
  assert.equal(failedAttempt?.status, "failed");
  assert.equal(failedAttempt?.supersededBy, delta.activeAttemptId);
  assert.equal(delta.superseded, undefined);
});

test("successful finalization closes the active attempt and validates assumptions", () => {
  const ledger = new PlanAttemptLedger("produce and verify the artifact");
  const [assumptionId] = ledger.recordAssumptions([
    "the selected exporter can produce the requested artifact",
  ]);

  const delta = ledger.succeed(8, ["artifact-receipt", "validation-receipt"]);
  const snapshot = ledger.snapshot();
  const attempt = snapshot.attempts.find(
    (candidate) => candidate.id === delta?.succeeded,
  );
  const assumption = snapshot.assumptions.find(
    (candidate) => candidate.id === assumptionId,
  );

  assert.equal(ledger.active(), undefined);
  assert.equal(attempt?.status, "succeeded");
  assert.equal(attempt?.endedAtStep, 8);
  assert.deepEqual(attempt?.evidenceRefs, [
    "artifact-receipt",
    "validation-receipt",
  ]);
  assert.equal(assumption?.status, "validated");
});

test("attempt snapshot can be restored without changing route identity", () => {
  const original = new PlanAttemptLedger("inspect the workspace");
  original.recordAssumptions(["the workspace is readable"]);
  const snapshot = original.snapshot();
  const restored = new PlanAttemptLedger("placeholder");

  restored.restore(snapshot);

  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.active()?.id, original.active()?.id);
});

test("repeating the same route and exit criteria keeps one active attempt", () => {
  const ledger = new PlanAttemptLedger("inspect the workspace");
  const initial = ledger.active();

  const repeated = ledger.propose(
    " inspect   the workspace ",
    3,
    initial?.exitCriteria ?? [],
    "repeat",
  );

  assert.equal(repeated.id, initial?.id);
  assert.equal(ledger.snapshot().attempts.length, 1);
});

test("replace_attempt exposes a dedicated route transition tool", async () => {
  const definition = getToolDefinitions().find(
    (candidate) => candidate.name === "replace_attempt",
  );
  let received:
    | {
        approach: string;
        assumptions: string[];
        exitCriteria: string[];
        reason: string;
      }
    | undefined;

  const result = JSON.parse(
    await executeTool(
      "replace_attempt",
      JSON.stringify({
        approach: "use the validated exporter",
        assumptions: ["the exporter is available"],
        exit_criteria: ["the artifact validates"],
        reason: "the previous command receipt rejected the old exporter",
      }),
      {
        replaceAttempt(input) {
          received = input;
          return {
            attemptId: "attempt-next",
            supersededAttemptId: "attempt-old",
          };
        },
      },
    ),
  ) as { attemptId: string; supersededAttemptId: string };

  assert.ok(definition);
  assert.match(definition?.description ?? "", /does not prove external progress/i);
  assert.deepEqual(received, {
    approach: "use the validated exporter",
    assumptions: ["the exporter is available"],
    exitCriteria: ["the artifact validates"],
    reason: "the previous command receipt rejected the old exporter",
  });
  assert.deepEqual(result, {
    attemptId: "attempt-next",
    supersededAttemptId: "attempt-old",
  });
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
