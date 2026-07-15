import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EventBus } from "../events/event-bus";
import { createInitialTaskState } from "../task-state";
import { RunRegistry } from "./run-registry";
import {
  type PersistedTraceEvent,
  RunTraceStore,
} from "./run-trace-store";

test("persists ordered durable trace events and frozen step input/output", async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-trace-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "ranni-session-trace");
  await fs.mkdir(workspaceRoot);
  t.after(async () => {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  const sessionId = "session-trace";
  const stepId = "step-1";
  const eventBus = new EventBus();
  const registry = new RunRegistry();
  const { runId } = registry.start({ sessionId, workspaceRoot });
  const store = new RunTraceStore(eventBus, registry);
  store.start();
  t.after(() => store.stop());
  await store.initializeRun(runId);

  eventBus.publish(sessionId, {
    type: "run.started",
    runId,
    sessionId,
    prompt: "Create an artifact",
    runtime: { provider: "test", model: "test-model" },
    startedAt: 1_000,
    toolDefinitions: [{ name: "write_file" }],
  });
  eventBus.publish(
    sessionId,
    {
      type: "activity.appended",
      runId,
      sessionId,
      activityId: "activity-1",
    },
    { durable: true },
  );
  eventBus.publish(
    sessionId,
    {
      type: "run.overview.updated",
      runId,
      sessionId,
      overview: {
        latestSeq: 0,
        runId,
        schemaVersion: 1,
        timeline: [],
        updatedAt: 1_035,
      },
    },
    { durable: true },
  );
  eventBus.publish(sessionId, {
    type: "step.started",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    startedAt: 1_010,
  });
  eventBus.publish(sessionId, {
    type: "task.state",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    taskState: createInitialTaskState("Create an artifact"),
  });
  eventBus.publish(sessionId, {
    type: "context.snapshot",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    context: { systemPrompt: "first-context", messages: [{ role: "user" }] },
  });
  eventBus.publish(sessionId, {
    type: "model.request",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    request: {
      messages: [{ role: "user", content: "first-request" }],
      providerOptions: {
        apiKey: "secret-key",
        headers: { authorization: "Bearer secret" },
      },
    },
  });
  eventBus.publish(sessionId, {
    type: "context.snapshot",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    context: { systemPrompt: "replacement-context" },
  });
  eventBus.publish(sessionId, {
    type: "model.request",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    request: { messages: [{ role: "user", content: "replacement-request" }] },
  });
  eventBus.publish(sessionId, {
    type: "thinking.completed",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    thinkingId: "thinking-1",
    message: "Inspect the workspace first.",
  });
  eventBus.publish(sessionId, {
    type: "model.response",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    response: {
      id: "response-1",
      usage: { inputTokens: 120, outputTokens: 30 },
    },
  });
  eventBus.publish(sessionId, {
    type: "tool.started",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    toolUseId: "tool-use-1",
    name: "write_file",
    arguments: { path: "result.txt" },
    startedAt: 1_020,
  });
  eventBus.publish(sessionId, {
    type: "tool.completed",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    toolUseId: "tool-use-1",
    name: "write_file",
    result: "Wrote result.txt",
    success: true,
    startedAt: 1_020,
    endedAt: 1_030,
    durationMs: 10,
  });
  eventBus.publish(
    sessionId,
    {
      type: "tool.receipt",
      runId,
      sessionId,
      stepId,
      stepIndex: 1,
      receipt: { toolUseId: "tool-use-1", effect: "artifact_changed" },
    },
    { durable: true },
  );
  eventBus.publish(
    sessionId,
    {
      type: "progress.receipt",
      runId,
      sessionId,
      stepId,
      stepIndex: 1,
      progressReceipt: {
        objectiveProgress: true,
        summary: "Created result.txt",
      },
    },
    { durable: true },
  );
  eventBus.publish(
    sessionId,
    {
      type: "attempt.updated",
      runId,
      sessionId,
      stepId,
      stepIndex: 1,
      attemptDelta: {
        activeAttemptId: "attempt-2",
        created: "attempt-2",
        superseded: "attempt-1",
      },
      attemptState: {
        assumptions: [],
        attempts: [
          {
            approach: "inspect then write",
            assumptionIds: [],
            endedAtStep: 1,
            evidenceRefs: [],
            exitCriteria: [],
            id: "attempt-1",
            startedAtStep: 0,
            status: "superseded",
            supersededBy: "attempt-2",
          },
          {
            approach: "write from inspected evidence",
            assumptionIds: [],
            evidenceRefs: [],
            exitCriteria: ["artifact exists"],
            id: "attempt-2",
            startedAtStep: 1,
            status: "active",
          },
        ],
      },
    },
    { durable: true },
  );
  eventBus.publish(
    sessionId,
    {
      type: "plan.updated",
      runId,
      sessionId,
      stepId,
      stepIndex: 1,
      planChange: {
        changed: true,
        changedItemIds: ["P01"],
        kind: "revision",
        snapshot: {
          focusItemId: "P01",
          id: "plan-1",
          items: [
            {
              acceptanceRefs: [],
              attemptIds: ["attempt-2"],
              createdAtStep: 1,
              dependsOn: [],
              evidenceHints: ["file receipt"],
              evidenceRefs: ["tool-use-1"],
              id: "P01",
              intent: "Create the requested artifact",
              modelStatus: "in_progress",
              status: "active",
              statusSource: "receipt",
              title: "Create artifact",
              updatedAtStep: 1,
            },
          ],
          projectionVersion: 1,
          revision: 1,
          revisions: [
            {
              changedItemIds: ["P01"],
              createdAtStep: 1,
              id: "revision-1",
              itemIds: ["P01"],
              number: 1,
              reason: "Initial plan",
              reasonKind: "initial",
            },
          ],
        },
      },
    },
    { durable: true },
  );
  eventBus.publish(sessionId, {
    type: "text.completed",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    textId: "text-1",
    message: "Artifact created.",
  });
  eventBus.publish(sessionId, {
    type: "step.completed",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    status: "completed",
    endedAt: 1_040,
    durationMs: 30,
    stopReason: "end_turn",
  });
  eventBus.publish(sessionId, {
    type: "run.completed",
    runId,
    sessionId,
    status: "completed",
    endedAt: 1_050,
    durationMs: 50,
    totalSteps: 1,
    finalAssistantMessage: "Artifact created.",
  });

  await store.flush(runId);

  const runDirectory = path.join(workspaceRoot, ".ranni", "runs", runId);
  const traceEvents = (await fs.readFile(
    path.join(runDirectory, "trace.jsonl"),
    "utf8",
  ))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as PersistedTraceEvent);
  assert.equal(traceEvents.length, 18);
  assert.equal(
    traceEvents.some((event) => event.type === "activity.appended"),
    false,
  );
  assert.equal(
    traceEvents.some((event) => event.type === "run.overview.updated"),
    false,
  );
  assert.deepEqual(
    traceEvents.map((event) => event.seq),
    [...traceEvents.map((event) => event.seq)].sort((left, right) => left - right),
  );

  const run = await store.readRun(runId);
  assert.ok(run);
  assert.equal(run.status, "completed");
  assert.equal(run.traceEventCount, 18);
  assert.equal(run.stepCount, 1);

  const overview = await store.readOverview(runId);
  assert.ok(overview);
  assert.equal(overview.plan?.focusItemId, "P01");
  assert.equal(overview.attempt?.attempts[1]?.id, "attempt-2");
  assert.ok(
    overview.timeline.some((entry) => entry.type === "plan.revision"),
  );

  const index = await store.listSteps(runId);
  assert.ok(index);
  assert.equal(index.steps.length, 1);
  assert.equal(index.steps[0]?.inputAvailable, true);
  assert.equal(index.steps[0]?.toolCallCount, 1);
  assert.equal(index.steps[0]?.toolResultCount, 1);
  assert.equal(index.steps[0]?.inputTokens, 120);
  assert.equal(index.steps[0]?.outputTokens, 30);

  const io = await store.readStepIO(runId, stepId);
  assert.ok(io);
  assert.equal(
    (io.input.context as { systemPrompt: string }).systemPrompt,
    "first-context",
  );
  const exactRequest = io.input.exactRequest as {
    messages: Array<{ content: string }>;
    providerOptions: {
      apiKey: string;
      headers: { authorization: string };
    };
  };
  assert.equal(exactRequest.messages[0]?.content, "first-request");
  assert.equal(exactRequest.providerOptions.apiKey, "[REDACTED]");
  assert.equal(
    exactRequest.providerOptions.headers.authorization,
    "[REDACTED]",
  );
  assert.match(io.input.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(io.output.thinking, "Inspect the workspace first.");
  assert.equal(io.output.assistantText, "Artifact created.");
  assert.equal(io.output.toolCalls.length, 1);
  assert.equal(io.output.toolResults.length, 1);
  assert.equal(io.output.toolReceipts.length, 1);
  assert.equal(io.output.progressReceipts.length, 1);
  assert.equal(io.output.attemptDeltas.length, 1);
  assert.equal(
    (
      io.output.latestAttemptState as {
        attempts: Array<{ approach: string }>;
      }
    ).attempts[1]?.approach,
    "write from inspected evidence",
  );
  assert.equal(io.output.planChanges?.length, 1);
  assert.equal(
    (io.output.latestPlanState as { focusItemId: string }).focusItemId,
    "P01",
  );
  assert.equal(io.output.status, "completed");

  const persistedIndexPath = path.join(runDirectory, "step-index.json");
  const persistedIndex = JSON.parse(
    await fs.readFile(persistedIndexPath, "utf8"),
  ) as { steps: Array<{ inputPath: string; outputPath: string }> };
  persistedIndex.steps[0]!.inputPath = "../../outside-input.json";
  persistedIndex.steps[0]!.outputPath = "../../outside-output.json";
  await fs.writeFile(persistedIndexPath, JSON.stringify(persistedIndex), "utf8");
  const ioAfterIndexTampering = await store.readStepIO(runId, stepId);
  assert.ok(ioAfterIndexTampering);
  assert.equal(
    ioAfterIndexTampering.summary.inputPath,
    "steps/0001-input.json",
  );

  const persistedFiles = await fs.readdir(runDirectory);
  assert.ok(persistedFiles.includes("overview.json"));
  assert.equal(persistedFiles.some((fileName) => fileName.endsWith(".tmp")), false);
});
