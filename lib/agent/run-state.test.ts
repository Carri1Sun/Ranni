import assert from "node:assert/strict";
import test from "node:test";

import { createTextDeliverableContract } from "../acceptance";
import type { ObservedState } from "../receipts/types";
import {
  createAgentRunState,
  reconcileTaskStateFromObserved,
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
