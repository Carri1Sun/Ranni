import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTaskStatePatch,
  createInitialTaskState,
  type TaskState,
} from "./task-state";
import { executeTool, getToolDefinitions } from "./tools";

test("update_task_state only changes agent note fields", async () => {
  let taskState = createInitialTaskState("initial goal");

  const result = await executeTool(
    "update_task_state",
    JSON.stringify({
      assumptions: ["working assumption"],
      commands_run: ["rm -rf pretend-command"],
      constraints: ["pretend constraint"],
      deliverable: "pretend deliverable",
      facts: ["pretend observed fact"],
      files_touched: ["pretend-output.txt"],
      goal: "updated goal",
      mode: "plan",
      next_action: "inspect the current workspace",
      open_questions: ["which entry point matters?"],
      plan: ["inspect", "act", "verify"],
      success_criteria: ["pretend criterion"],
      verification_evidence: ["pretend verification"],
      verification_status: "passed",
    }),
    {
      get taskState() {
        return taskState;
      },
      updateTaskState(patch) {
        taskState = applyTaskStatePatch(taskState, patch);
        return taskState;
      },
    },
  );

  const receipt = JSON.parse(result) as {
    changedFields: string[];
    noChange: boolean;
    stateHash: string;
  };

  assert.equal(taskState.goal, "initial goal");
  assert.equal(taskState.deliverable, "");
  assert.deepEqual(taskState.constraints, []);
  assert.deepEqual(taskState.successCriteria, []);
  assert.deepEqual(taskState.facts, []);
  assert.deepEqual(taskState.filesTouched, []);
  assert.deepEqual(taskState.commandsRun, []);
  assert.deepEqual(taskState.verification, {
    evidence: [],
    status: "pending",
  });
  assert.equal(taskState.currentMode, "plan");
  assert.equal(taskState.nextAction, "inspect the current workspace");
  assert.deepEqual(taskState.assumptions, ["working assumption"]);
  assert.deepEqual(taskState.openQuestions, ["which entry point matters?"]);
  assert.deepEqual(taskState.plan, ["inspect", "act", "verify"]);
  assert.deepEqual(receipt.changedFields, [
    "currentMode",
    "nextAction",
    "assumptions",
    "openQuestions",
    "plan",
  ]);
  assert.equal(receipt.noChange, false);
  assert.match(receipt.stateHash, /^[a-f0-9]{8}$/);
});

test("update_task_state schema exposes only agent note fields", () => {
  const definition = getToolDefinitions().find(
    (candidate) => candidate.name === "update_task_state",
  );
  const inputSchema = definition?.input_schema as
    | { properties?: Record<string, unknown> }
    | undefined;
  const properties = inputSchema?.properties;

  assert.doesNotMatch(
    definition?.description ?? "",
    /use this early|before edits?|before final/i,
  );
  assert.match(definition?.description ?? "", /does not prove external progress/i);
  assert.ok(properties);
  for (const field of [
    "mode",
    "next_action",
    "assumptions",
    "open_questions",
    "plan",
  ]) {
    assert.equal(field in properties, true, `${field} should be model-writable`);
  }
  for (const field of [
    "goal",
    "deliverable",
    "constraints",
    "success_criteria",
    "facts",
    "verification_status",
    "verification_evidence",
    "files_touched",
    "commands_run",
  ]) {
    assert.equal(field in properties, false, `${field} should be harness-owned`);
  }
});

test("update_task_state reports repeated semantic updates as noChange", async () => {
  let taskState = createInitialTaskState("goal");
  const context = {
    get taskState() {
      return taskState;
    },
    updateTaskState(patch: Parameters<typeof applyTaskStatePatch>[1]) {
      taskState = applyTaskStatePatch(taskState, patch);
      return taskState;
    },
  };
  const args = JSON.stringify({
    mode: "recon",
    next_action: "read package metadata",
  });

  const first = JSON.parse(await executeTool("update_task_state", args, context)) as {
    changedFields: string[];
    noChange: boolean;
    stateHash: string;
  };
  const repeated = JSON.parse(
    await executeTool("update_task_state", args, context),
  ) as typeof first;

  assert.deepEqual(first.changedFields, ["currentMode", "nextAction"]);
  assert.equal(first.noChange, false);
  assert.deepEqual(repeated.changedFields, []);
  assert.equal(repeated.noChange, true);
  assert.equal(repeated.stateHash, first.stateHash);
});

test("harness patches retain contract, observed, and verification authority", () => {
  const initial = createInitialTaskState("goal");
  const next: TaskState = applyTaskStatePatch(initial, {
    commandsRun: ["npm run typecheck"],
    constraints: ["keep public APIs compatible"],
    deliverable: "verified implementation",
    facts: ["typecheck exited successfully"],
    filesTouched: ["lib/task-state.ts"],
    goal: "harness-owned goal",
    successCriteria: ["tests pass"],
    verificationEvidence: ["npm run typecheck -> exit_code 0"],
    verificationStatus: "passed",
  });

  assert.equal(next.goal, "harness-owned goal");
  assert.equal(next.deliverable, "verified implementation");
  assert.deepEqual(next.constraints, ["keep public APIs compatible"]);
  assert.deepEqual(next.successCriteria, ["tests pass"]);
  assert.deepEqual(next.facts, ["typecheck exited successfully"]);
  assert.deepEqual(next.commandsRun, ["npm run typecheck"]);
  assert.deepEqual(next.filesTouched, ["lib/task-state.ts"]);
  assert.deepEqual(next.verification, {
    evidence: ["npm run typecheck -> exit_code 0"],
    status: "passed",
  });
});
