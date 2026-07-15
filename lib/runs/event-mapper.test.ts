import assert from "node:assert/strict";
import test from "node:test";

import { EventBus, type PublishedEvent } from "../events/event-bus";
import { RunRegistry } from "./run-registry";
import { EventMapper } from "./event-mapper";

test("publishes idempotent run overview snapshots for semantic events", () => {
  const eventBus = new EventBus();
  const mapper = new EventMapper(eventBus, new RunRegistry());
  const sessionId = "session-overview-notification";
  const runId = "run-overview-notification";
  const received: PublishedEvent[] = [];

  eventBus.subscribe(sessionId, 0, (event) => received.push(event));
  mapper.start();
  eventBus.publish(sessionId, {
    type: "run.started",
    runId,
    sessionId,
    prompt: "Build an artifact",
    runtime: { model: "test", provider: "test" },
    startedAt: 1_000,
    toolDefinitions: [],
  });

  const planChange = {
    changed: true,
    changedItemIds: ["P01"],
    kind: "revision",
    snapshot: {
      focusItemId: "P01",
      id: "plan-overview-notification",
      items: [
        {
          acceptanceRefs: ["artifact"],
          attemptIds: [],
          createdAtStep: 1,
          dependsOn: [],
          evidenceHints: [],
          evidenceRefs: [],
          id: "P01",
          intent: "create artifact",
          modelStatus: "in_progress",
          status: "active",
          statusSource: "model",
          title: "创建工件",
          updatedAtStep: 1,
        },
      ],
      projectionVersion: 0,
      revision: 1,
      revisions: [
        {
          changedItemIds: ["P01"],
          createdAtStep: 1,
          id: "revision-1",
          itemIds: ["P01"],
          number: 1,
          reason: "建立初始工作计划",
          reasonKind: "initial",
        },
      ],
    },
  } as const;

  eventBus.publish(sessionId, {
    type: "plan.updated",
    runId,
    sessionId,
    stepId: "step-1",
    stepIndex: 1,
    planChange,
  });
  eventBus.publish(sessionId, {
    type: "plan.updated",
    runId,
    sessionId,
    stepId: "step-1",
    stepIndex: 1,
    planChange,
  });

  const notifications = received.filter(
    (event) => event.type === "run.overview.updated",
  );
  assert.equal(notifications.length, 1);
  const overview = notifications[0]?.overview as {
    latestSeq: number;
    plan?: { focusItemId?: string; revision: number };
    timeline: unknown[];
  };
  assert.equal(overview.plan?.revision, 1);
  assert.equal(overview.plan?.focusItemId, "P01");
  assert.ok(overview.latestSeq > 0);
  assert.ok(overview.timeline.length >= 1);
});
