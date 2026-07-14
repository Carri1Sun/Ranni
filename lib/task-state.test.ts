import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTaskStatePatch,
  createInitialTaskState,
  type TaskState,
} from "./task-state";
import { executeTool, getToolDefinitions } from "./tools";

test("update_task_state cannot forge observed files or commands", async () => {
  let taskState = createInitialTaskState("initial goal");

  await executeTool(
    "update_task_state",
    JSON.stringify({
      commands_run: ["rm -rf pretend-command"],
      facts: ["model judgment remains writable"],
      files_touched: ["pretend-output.txt"],
      goal: "updated goal",
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

  assert.equal(taskState.goal, "updated goal");
  assert.deepEqual(taskState.facts, ["model judgment remains writable"]);
  assert.deepEqual(taskState.filesTouched, []);
  assert.deepEqual(taskState.commandsRun, []);
});

test("update_task_state schema exposes intent fields but not observed facts", () => {
  const definition = getToolDefinitions().find(
    (candidate) => candidate.name === "update_task_state",
  );
  const inputSchema = definition?.input_schema as
    | { properties?: Record<string, unknown> }
    | undefined;
  const properties = inputSchema?.properties;

  assert.ok(properties);
  assert.ok("goal" in properties);
  assert.ok("verification_status" in properties);
  assert.equal("files_touched" in properties, false);
  assert.equal("commands_run" in properties, false);
});

test("harness patches can still record observed files and commands", () => {
  const initial = createInitialTaskState("goal");
  const next: TaskState = applyTaskStatePatch(initial, {
    commandsRun: ["npm run typecheck"],
    filesTouched: ["lib/task-state.ts"],
  });

  assert.deepEqual(next.commandsRun, ["npm run typecheck"]);
  assert.deepEqual(next.filesTouched, ["lib/task-state.ts"]);
});
