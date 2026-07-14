import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createTaskMemory } from "./task-memory";
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
