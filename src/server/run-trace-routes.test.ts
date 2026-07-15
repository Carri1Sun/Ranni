import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import express from "express";

import { EventBus } from "../../lib/events/event-bus";
import type { RunOverviewProjection } from "../../lib/runs/run-overview-projection";
import { RunRegistry } from "../../lib/runs/run-registry";
import {
  type RunTraceRecord,
  type StepTraceIO,
  type StepTraceSummary,
  RunTraceStore,
} from "../../lib/runs/run-trace-store";
import { registerRunTraceRoutes } from "./run-trace-routes";

test("queries persisted runs and step IO through registry-owned workspaces", async (t) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-trace-routes-"),
  );
  const workspaceRoot = path.join(temporaryRoot, "ranni-session-routes");
  await fs.mkdir(workspaceRoot);
  t.after(async () => {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  });

  const sessionId = "session-routes";
  const stepId = "step-routes-1";
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
    prompt: "Route test",
    runtime: { provider: "test", model: "test" },
    startedAt: 2_000,
    toolDefinitions: [],
  });
  eventBus.publish(sessionId, {
    type: "step.started",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    startedAt: 2_010,
  });
  eventBus.publish(sessionId, {
    type: "task.state",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    taskState: {
      assumptions: [],
      commandsRun: [],
      constraints: [],
      currentMode: "plan",
      deliverable: "route test artifact",
      facts: [],
      filesTouched: [],
      goal: "Route test",
      nextAction: "Inspect the overview route",
      openQuestions: [],
      plan: ["Inspect overview"],
      successCriteria: [],
      verification: { evidence: [], status: "pending" },
    },
  });
  eventBus.publish(sessionId, {
    type: "context.snapshot",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    context: { messages: [] },
  });
  eventBus.publish(sessionId, {
    type: "model.request",
    runId,
    sessionId,
    stepId,
    stepIndex: 1,
    request: { messages: [] },
  });
  await store.flush(runId);

  const app = express();
  registerRunTraceRoutes(app, registry, store);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const runsResponse = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/runs`,
  );
  assert.equal(runsResponse.status, 200);
  const runsBody = (await runsResponse.json()) as {
    ok: boolean;
    result: { runs: RunTraceRecord[] };
  };
  assert.equal(runsBody.ok, true);
  assert.deepEqual(runsBody.result.runs.map((run) => run.runId), [runId]);

  const stepsResponse = await fetch(`${baseUrl}/api/runs/${runId}/steps`);
  assert.equal(stepsResponse.status, 200);
  const stepsBody = (await stepsResponse.json()) as {
    ok: boolean;
    result: { steps: StepTraceSummary[] };
  };
  assert.equal(stepsBody.result.steps[0]?.stepId, stepId);

  const overviewResponse = await fetch(
    `${baseUrl}/api/runs/${runId}/overview`,
  );
  assert.equal(overviewResponse.status, 200);
  const overviewBody = (await overviewResponse.json()) as {
    ok: boolean;
    result: { overview: RunOverviewProjection };
  };
  assert.equal(overviewBody.ok, true);
  assert.equal(
    overviewBody.result.overview.taskState?.nextAction,
    "Inspect the overview route",
  );

  const ioResponse = await fetch(
    `${baseUrl}/api/runs/${runId}/steps/${stepId}/io`,
  );
  assert.equal(ioResponse.status, 200);
  const ioBody = (await ioResponse.json()) as {
    ok: boolean;
    result: { io: StepTraceIO };
  };
  assert.equal(ioBody.result.io.input.stepId, stepId);
  assert.equal(ioBody.result.io.summary.inputAvailable, true);

  store.stop();
  const restartedRegistry = new RunRegistry();
  const restartedStore = new RunTraceStore(new EventBus(), restartedRegistry);
  const restartedApp = express();
  registerRunTraceRoutes(restartedApp, restartedRegistry, restartedStore);
  const restartedServer = restartedApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    restartedServer.once("listening", resolve);
    restartedServer.once("error", reject);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        restartedServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const restartedPort = (restartedServer.address() as AddressInfo).port;
  const workspaceQuery = `workspaceRoot=${encodeURIComponent(workspaceRoot)}`;
  const discoveredResponse = await fetch(
    `http://127.0.0.1:${restartedPort}/api/sessions/${encodeURIComponent(sessionId)}/runs?${workspaceQuery}`,
  );
  assert.equal(discoveredResponse.status, 200);
  const discoveredBody = (await discoveredResponse.json()) as {
    result: { runs: RunTraceRecord[] };
  };
  assert.deepEqual(discoveredBody.result.runs.map((run) => run.runId), [runId]);
  const restartedSteps = await fetch(
    `http://127.0.0.1:${restartedPort}/api/runs/${runId}/steps`,
  );
  assert.equal(restartedSteps.status, 200);
  const restartedOverview = await fetch(
    `http://127.0.0.1:${restartedPort}/api/runs/${runId}/overview?${workspaceQuery}`,
  );
  assert.equal(restartedOverview.status, 200);
  const restartedOverviewBody = (await restartedOverview.json()) as {
    result: { overview: RunOverviewProjection };
  };
  assert.equal(
    restartedOverviewBody.result.overview.taskState?.nextAction,
    "Inspect the overview route",
  );

  const unknownResponse = await fetch(
    `${baseUrl}/api/runs/unregistered-run/steps`,
  );
  assert.equal(unknownResponse.status, 404);
});
