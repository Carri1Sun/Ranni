import assert from "node:assert/strict";
import test from "node:test";

import { createTextDeliverableContract } from "../acceptance";
import {
  createAgentRunRecoverySnapshot,
  createAgentRunState,
} from "../agent/run-state";
import { RunRegistry } from "./run-registry";

test("a failed session hands its recovery state to the next matching run once", () => {
  const registry = new RunRegistry();
  const workspaceRoot = "/tmp/ranni-recovery-workspace";
  const { runId } = registry.start({
    sessionId: "session-1",
    workspaceRoot,
  });
  const state = createAgentRunState({
    activeSkillNames: [],
    conversation: [],
    deliverableContract: createTextDeliverableContract(),
    latestUserPrompt: "continue the task",
    recoveryBinding: { sessionId: "session-1", workspaceRoot },
  });
  state.completedSteps = 3;
  const snapshot = createAgentRunRecoverySnapshot(state);

  assert.equal(registry.storeRecoveryState(runId, snapshot), true);
  registry.finish(runId, "failed");

  assert.deepEqual(
    registry.takeLatestRecoveryState("session-1", workspaceRoot),
    snapshot,
  );
  assert.equal(
    registry.takeLatestRecoveryState("session-1", workspaceRoot),
    undefined,
  );
});

test("recovery state cannot cross a session or workspace boundary", () => {
  const registry = new RunRegistry();
  const { runId } = registry.start({
    sessionId: "session-1",
    workspaceRoot: "/tmp/workspace-a",
  });
  const state = createAgentRunState({
    activeSkillNames: [],
    conversation: [],
    deliverableContract: createTextDeliverableContract(),
    latestUserPrompt: "continue",
  });
  registry.storeRecoveryState(runId, createAgentRunRecoverySnapshot(state));
  registry.finish(runId, "failed");

  assert.equal(
    registry.takeLatestRecoveryState("session-2", "/tmp/workspace-a"),
    undefined,
  );
  assert.equal(
    registry.takeLatestRecoveryState("session-1", "/tmp/workspace-b"),
    undefined,
  );
});
