import assert from "node:assert/strict";
import test from "node:test";

import type { AcceptanceSnapshot } from "../acceptance";
import type { PlanAttemptRecord } from "../plan-attempt";
import type { ObservedState } from "../receipts/types";
import { decideRecovery } from "./recovery-controller";

function emptyObservedState(): ObservedState {
  return {
    artifacts: {},
    commands: [],
    evidence: {},
    files: {},
    receipts: [],
    stateHash: "observed-empty",
    unresolvedErrors: [],
    verification: [],
  };
}

function pendingAcceptance(): AcceptanceSnapshot {
  return {
    criteria: [
      {
        description: "PPTX 已验证",
        evidenceRefs: [],
        id: "pptx",
        kind: "artifact",
        required: true,
        status: "pending",
        target: "pptx",
      },
    ],
    gap: ["pptx: PPTX 已验证 (pending)"],
  };
}

function completedAcceptance(receiptId = "validate-final"): AcceptanceSnapshot {
  return {
    criteria: [
      {
        description: "PPTX 已验证",
        evidenceRefs: [receiptId],
        id: "pptx",
        kind: "artifact",
        required: true,
        status: "passed",
        target: "pptx",
      },
    ],
    gap: [],
  };
}

function completedObserved(receiptId = "validate-final"): ObservedState {
  return {
    ...emptyObservedState(),
    artifacts: {
      pptx: {
        count: 8,
        key: "pptx",
        kind: "pptx",
        path: "deck/final.pptx",
        receiptId,
        status: "validated",
      },
    },
    stateHash: "observed-complete",
  };
}

function activeAttempt(): PlanAttemptRecord {
  return {
    approach: "验证并交付 PPTX",
    assumptionIds: [],
    evidenceRefs: [],
    exitCriteria: ["PPTX validated"],
    id: "attempt-1",
    startedAtStep: 12,
    status: "active",
  };
}

test("abort always cancels while preserving a serializable checkpoint", () => {
  const acceptanceSnapshot = pendingAcceptance();
  const observedState = emptyObservedState();
  const result = decideRecovery({
    abort: true,
    acceptanceSnapshot,
    attempt: activeAttempt(),
    causalTailSnapshotHash: "causal-123",
    error: new Error("connection terminated"),
    observedState,
  });

  assert.equal(result.kind, "cancelled");
  assert.equal(result.finalSynthesisAllowed, false);
  assert.doesNotThrow(() => JSON.stringify(result.checkpoint));
  assert.equal(result.checkpoint.causalTailSnapshotHash, "causal-123");
  assert.equal(result.checkpoint.attempt?.id, "attempt-1");
  assert.notEqual(result.checkpoint.observedState, observedState);
  assert.notEqual(result.checkpoint.acceptanceSnapshot, acceptanceSnapshot);
});

test("exhausted transient provider failure returns a recoverable failed checkpoint", () => {
  const result = decideRecovery({
    acceptanceSnapshot: pendingAcceptance(),
    attempt: activeAttempt(),
    causalTailSnapshotHash: "causal-pending",
    error: new Error(
      "本地 ChatGPT 订阅请求失败：connection terminated（已自动重试 2 次）。",
    ),
    observedState: emptyObservedState(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.reason, "provider_retry_exhausted");
    assert.equal(result.recoverable, true);
    assert.equal(result.finalSynthesisAllowed, false);
    assert.ok(result.gaps.some((gap) => gap.includes("pptx")));
    assert.match(result.message, /checkpoint.*继续工作/);
    assert.match(result.resumeInstruction ?? "", /不得进入 final synthesis/);
    assert.equal(result.checkpoint.observedStateHash, "observed-empty");
    assert.equal(result.checkpoint.attempt?.status, "active");
  }
});

test("empty acceptance cannot synthesize a text deliverable after provider failure", () => {
  const result = decideRecovery({
    acceptanceSnapshot: { criteria: [], gap: [] },
    causalTailSnapshotHash: "causal-text",
    error: new Error("fetch failed after retry"),
    observedState: emptyObservedState(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.recoverable, true);
    assert.equal(result.finalSynthesisAllowed, false);
    assert.deepEqual(result.gaps, [
      "缺少可用于确定性交付恢复的客观完成证据。",
    ]);
  }
});

test("gap-free evidence allows deterministic final recovery", () => {
  const result = decideRecovery({
    acceptanceSnapshot: completedAcceptance(),
    causalTailSnapshotHash: "causal-complete",
    error: new Error("socket connection terminated after bounded retries"),
    observedState: completedObserved(),
  });

  assert.equal(result.kind, "final_recovery");
  if (result.kind === "final_recovery") {
    assert.equal(result.finalSynthesisAllowed, true);
    assert.match(result.message, /deck\/final\.pptx/);
    assert.match(result.message, /1 项 passed/);
    assert.deepEqual(result.completion.acceptanceEvidenceRefs, [
      "validate-final",
    ]);
  }
});

test("non-transient errors fail without final recovery even when acceptance passed", () => {
  const result = decideRecovery({
    acceptanceSnapshot: completedAcceptance(),
    causalTailSnapshotHash: "causal-invalid",
    error: new Error("provider protocol invariant violated"),
    observedState: completedObserved(),
  });

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.equal(result.reason, "unrecoverable_error");
    assert.equal(result.recoverable, false);
    assert.equal(result.finalSynthesisAllowed, false);
  }
});

test("an AbortError cancels even without an explicit abort flag", () => {
  const error = new Error("stop now");
  error.name = "AbortError";
  const result = decideRecovery({
    acceptanceSnapshot: completedAcceptance(),
    causalTailSnapshotHash: "causal-abort-error",
    error,
    observedState: completedObserved(),
  });

  assert.equal(result.kind, "cancelled");
  assert.equal(result.error.name, "AbortError");
});
