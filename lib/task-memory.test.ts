import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskMemory } from "./task-memory";
import { createPlanLedger } from "./plan";
import { createInitialTaskState } from "./task-state";

test("task memory keeps current-file heads and append-only tails", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-task-memory-"),
  );
  t.after(async () => {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  });

  const taskState = createInitialTaskState("CURRENT_GOAL_MARKER");
  taskState.constraints = [
    "x".repeat(1_300),
    "OLD_STATE_TAIL_MARKER",
  ];
  const memory = createTaskMemory({
    latestUserPrompt: "fallback prompt",
    runId: "summary-tail-test",
    workspaceRoot,
  });

  await memory.ensureInitialized(taskState);
  await memory.appendEntry({
    content: `OLD_ERROR_MARKER\n${"e".repeat(1_200)}`,
    section: "errors",
    title: "old error",
  });
  await memory.appendEntry({
    content: "LATEST_ERROR_MARKER",
    section: "errors",
    title: "latest error",
  });
  await memory.appendEntry({
    content: `OLD_EVIDENCE_MARKER\n${"v".repeat(1_200)}`,
    section: "evidence",
    title: "old evidence",
  });
  await memory.appendEntry({
    content: "LATEST_EVIDENCE_MARKER",
    section: "evidence",
    title: "latest evidence",
  });

  const summary = await memory.readSummary();

  assert.match(summary, /CURRENT_GOAL_MARKER/);
  assert.doesNotMatch(summary, /OLD_STATE_TAIL_MARKER/);
  assert.match(summary, /LATEST_ERROR_MARKER/);
  assert.doesNotMatch(summary, /OLD_ERROR_MARKER/);
  assert.match(summary, /LATEST_EVIDENCE_MARKER/);
  assert.doesNotMatch(summary, /OLD_EVIDENCE_MARKER/);
  assert.ok(summary.length <= 9_000);
});

test("task memory persists the structured plan and renders stable todo ids", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-task-memory-plan-"),
  );
  t.after(async () => {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  });
  const taskState = createInitialTaskState("build an artifact");
  taskState.successCriteria = ["legacy positional check"];
  const plan = createPlanLedger();
  plan.replace(
    [
      {
        acceptanceRefs: ["artifact"],
        expectedOutcome: "artifact receipt exists",
        status: "in_progress",
        title: "produce artifact",
      },
      {
        blockedReason: "waiting for renderer",
        status: "blocked",
        title: "render artifact",
      },
      { title: "deliver result" },
    ],
    { stepIndex: 1 },
  );
  const memory = createTaskMemory({
    latestUserPrompt: taskState.goal,
    runId: "structured-plan-test",
    workspaceRoot,
  });

  await memory.syncTaskState(taskState, plan.serialize());
  const runDirectory = memory.getStatus().runDirectory;
  const todoPath = path.join(runDirectory, "todo.md");
  const initialTodo = await fs.readFile(todoPath, "utf8");
  const persistedPlan = await memory.readPlan();

  assert.match(initialTodo, /\| P01 \| produce artifact \| doing \| artifact receipt exists/);
  assert.match(initialTodo, /\| P02 \| render artifact \| blocked \|/);
  assert.match(initialTodo, /\| P03 \| deliver result \| pending \|/);
  assert.doesNotMatch(initialTodo, /legacy positional check/);
  assert.deepEqual(persistedPlan, plan.serialize());
  assert.deepEqual(memory.getStatus().todo, {
    blocked: 1,
    doing: 1,
    done: 0,
    pending: 1,
    skipped: 0,
    total: 3,
  });

  await fs.writeFile(
    todoPath,
    initialTodo.replace(
      "## Manual Todo Updates\n\n- (none yet)",
      "## Manual Todo Updates\n\n- preserve this note",
    ),
    "utf8",
  );
  await memory.syncTaskState(taskState, plan.serialize());

  assert.match(await fs.readFile(todoPath, "utf8"), /preserve this note/);
});

test("recovery state is written atomically with private permissions", async (t) => {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-task-memory-recovery-"),
  );
  t.after(async () => {
    await fs.rm(workspaceRoot, { force: true, recursive: true });
  });
  const memory = createTaskMemory({
    latestUserPrompt: "resume the task",
    runId: "private-recovery-test",
    workspaceRoot,
  });

  await memory.saveCheckpoint({
    nextAction: "continue",
    recoveryState: { schemaVersion: 2, state: "preserved" },
    summary: "provider interrupted",
  });

  const checkpointDirectory = path.join(
    memory.getStatus().runDirectory,
    "checkpoints",
  );
  const files = await fs.readdir(checkpointDirectory);
  const recoveryFile = files.find((file) => file.endsWith(".json"));
  assert.ok(recoveryFile);
  const recoveryPath = path.join(checkpointDirectory, recoveryFile);
  assert.deepEqual(
    JSON.parse(await fs.readFile(recoveryPath, "utf8")),
    { schemaVersion: 2, state: "preserved" },
  );
  assert.equal((await fs.stat(recoveryPath)).mode & 0o777, 0o600);
  assert.equal(files.some((file) => file.endsWith(".tmp")), false);
});
