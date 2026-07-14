import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listSessionHistories,
  readSessionHistory,
  SESSION_HISTORY_RELATIVE_PATH,
  upsertSessionHistory,
  type SessionHistoryMessage,
} from "./session-history-store";

test("persists more than 120 messages and restores them in order", async (t) => {
  const workspaceBase = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-session-history-"),
  );
  const workspaceRoot = path.join(workspaceBase, "ranni-session-test");
  const sessionId = "session-history-test";
  const createdAt = Date.now();

  await fs.mkdir(workspaceRoot);
  t.after(async () => {
    await fs.rm(workspaceBase, { force: true, recursive: true });
  });

  const messages: SessionHistoryMessage[] = Array.from(
    { length: 130 },
    (_, index) => ({
      content: `message-${index + 1}`,
      id: `message-${String(index + 1).padStart(3, "0")}`,
      role: index % 2 === 0 ? "user" : "assistant",
      updatedAt: createdAt + index,
    }),
  );

  for (let index = 0; index < messages.length; index += 25) {
    await upsertSessionHistory({
      createdAt,
      messages: messages.slice(index, index + 25),
      sessionId,
      title: "History test",
      updatedAt: createdAt + index,
      workspaceRoot,
    });
  }

  const restored = await readSessionHistory(workspaceRoot);

  assert.ok(restored);
  assert.equal(restored.messages.length, 130);
  assert.equal(restored.messages[0]?.content, "message-1");
  assert.equal(restored.messages[129]?.content, "message-130");

  await upsertSessionHistory({
    createdAt,
    messages: [
      {
        ...messages[64]!,
        content: "message-65-updated",
        updatedAt: createdAt + 1000,
      },
    ],
    sessionId,
    title: "History test updated",
    updatedAt: createdAt + 1000,
    workspaceRoot,
  });

  const updated = await readSessionHistory(workspaceRoot);

  assert.ok(updated);
  assert.equal(updated.messages.length, 130);
  assert.equal(updated.messages[64]?.content, "message-65-updated");
  assert.equal(updated.title, "History test updated");

  const summaries = await listSessionHistories(workspaceBase);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.messageCount, 130);
  assert.equal(summaries[0]?.sessionId, sessionId);

  const historyDirectory = path.dirname(
    path.join(workspaceRoot, SESSION_HISTORY_RELATIVE_PATH),
  );
  const historyFiles = await fs.readdir(historyDirectory);

  assert.deepEqual(historyFiles, ["session-history.json"]);
});
