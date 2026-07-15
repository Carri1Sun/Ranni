import assert from "node:assert/strict";
import test from "node:test";

import { projectFeedToolActivities } from "./feed-tool-projection";

type Item = {
  id: string;
  kind: "activity" | "message";
  runId?: string;
  toolUseId?: string;
  type?: string;
};

test("pairs tool start and completion into one render entry", () => {
  const call: Item = {
    id: "call-1",
    kind: "activity",
    runId: "run-1",
    toolUseId: "tool-1",
    type: "tool_call",
  };
  const result: Item = {
    id: "result-1",
    kind: "activity",
    runId: "run-1",
    toolUseId: "tool-1",
    type: "tool_result",
  };

  const projected = projectFeedToolActivities([call, result]);

  assert.equal(projected.length, 1);
  assert.deepEqual(projected[0], {
    call,
    first: call,
    key: "run-1:tool-1",
    kind: "tool_activity_group",
    result,
  });
});

test("keeps a pending call visible and preserves surrounding feed order", () => {
  const before: Item = { id: "before", kind: "message" };
  const call: Item = {
    id: "call-1",
    kind: "activity",
    runId: "run-1",
    toolUseId: "tool-1",
    type: "tool_call",
  };
  const after: Item = { id: "after", kind: "message" };

  const projected = projectFeedToolActivities([before, call, after]);

  assert.equal(projected.length, 3);
  assert.equal(projected[0], before);
  assert.equal(projected[2], after);
  assert.equal(projected[1].kind, "tool_activity_group");
  if (projected[1].kind === "tool_activity_group") {
    assert.equal(projected[1].call, call);
    assert.equal(projected[1].result, undefined);
  }
});

test("pairs out-of-order events and isolates reused ids between runs", () => {
  const result: Item = {
    id: "result-1",
    kind: "activity",
    runId: "run-1",
    toolUseId: "shared",
    type: "tool_result",
  };
  const call: Item = {
    id: "call-1",
    kind: "activity",
    runId: "run-1",
    toolUseId: "shared",
    type: "tool_call",
  };
  const nextRunCall: Item = {
    id: "call-2",
    kind: "activity",
    runId: "run-2",
    toolUseId: "shared",
    type: "tool_call",
  };

  const projected = projectFeedToolActivities([result, call, nextRunCall]);

  assert.equal(projected.length, 2);
  assert.equal(projected[0].kind, "tool_activity_group");
  if (projected[0].kind === "tool_activity_group") {
    assert.equal(projected[0].first, result);
    assert.equal(projected[0].call, call);
    assert.equal(projected[0].result, result);
  }
  assert.equal(projected[1].kind, "tool_activity_group");
});

test("collapses replayed notifications while keeping the latest result", () => {
  const call: Item = {
    id: "call-1",
    kind: "activity",
    toolUseId: "tool-1",
    type: "tool_call",
  };
  const firstResult: Item = {
    id: "result-1",
    kind: "activity",
    toolUseId: "tool-1",
    type: "tool_result",
  };
  const latestResult: Item = {
    id: "result-2",
    kind: "activity",
    toolUseId: "tool-1",
    type: "tool_result",
  };

  const projected = projectFeedToolActivities([call, firstResult, latestResult]);

  assert.equal(projected.length, 1);
  assert.equal(projected[0].kind, "tool_activity_group");
  if (projected[0].kind === "tool_activity_group") {
    assert.equal(projected[0].result, latestResult);
  }
});
