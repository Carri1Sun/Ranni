import type { Express, Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";

import type { RunRegistry } from "../../lib/runs/run-registry";
import type { RunTraceStore } from "../../lib/runs/run-trace-store";

function respondWithTraceError(response: Response, error: unknown): void {
  response.status(500).json({
    error:
      error instanceof Error ? error.message : "无法读取持久化运行 Trace。",
    ok: false,
  });
}

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0]?.trim() ?? "") : (value?.trim() ?? "");
}

async function getWorkspaceQuery(request: Request): Promise<string | null> {
  const value =
    typeof request.query.workspaceRoot === "string"
      ? request.query.workspaceRoot.trim()
      : "";
  if (!value) return null;
  const workspaceRoot = path.resolve(value);
  const stat = await fs.stat(workspaceRoot);
  if (!stat.isDirectory()) throw new Error("workspaceRoot 不是目录。");
  return workspaceRoot;
}

async function ensureTraceRun(
  request: Request,
  traceStore: RunTraceStore,
  runId: string,
) {
  if (traceStore.hasRun(runId)) return true;
  const workspaceRoot = await getWorkspaceQuery(request);
  return workspaceRoot
    ? Boolean(await traceStore.discoverRun(runId, workspaceRoot))
    : false;
}

export function registerRunTraceRoutes(
  app: Express,
  registry: RunRegistry,
  traceStore: RunTraceStore,
): void {
  app.get(
    "/api/sessions/:sessionId/runs",
    async (request: Request, response: Response) => {
      try {
        const sessionId = getRouteParam(request.params.sessionId);
        if (!sessionId) {
          response.status(400).json({ error: "sessionId 是必填参数。", ok: false });
          return;
        }

        const handles = registry
          .listBySession(sessionId)
          .filter((handle) => Boolean(handle.workspaceRoot));
        const liveRuns = (
          await Promise.all(
            handles.map((handle) => traceStore.readRun(handle.runId)),
          )
        ).filter((run) => run !== null);
        const workspaceRoot = await getWorkspaceQuery(request);
        const persistedRuns = workspaceRoot
          ? await traceStore.discoverSessionRuns(sessionId, workspaceRoot)
          : [];
        const runs = [
          ...new Map(
            [...liveRuns, ...persistedRuns].map((run) => [run.runId, run]),
          ).values(),
        ].sort((left, right) => right.startedAt - left.startedAt);

        response.json({ ok: true, result: { runs } });
      } catch (error) {
        respondWithTraceError(response, error);
      }
    },
  );

  app.get(
    "/api/runs/:runId/steps",
    async (request: Request, response: Response) => {
      const runId = getRouteParam(request.params.runId);
      try {
        if (!(await ensureTraceRun(request, traceStore, runId))) {
          response.status(404).json({ error: "运行不存在。", ok: false });
          return;
        }
        const [run, index] = await Promise.all([
          traceStore.readRun(runId),
          traceStore.listSteps(runId),
        ]);
        if (!run || !index) {
          response.status(404).json({ error: "运行 Trace 尚未建立。", ok: false });
          return;
        }

        response.json({
          ok: true,
          result: {
            run,
            steps: index.steps,
            updatedAt: index.updatedAt,
          },
        });
      } catch (error) {
        respondWithTraceError(response, error);
      }
    },
  );

  app.get(
    "/api/runs/:runId/steps/:stepId/io",
    async (request: Request, response: Response) => {
      const runId = getRouteParam(request.params.runId);
      try {
        if (!(await ensureTraceRun(request, traceStore, runId))) {
          response.status(404).json({ error: "运行不存在。", ok: false });
          return;
        }
        const io = await traceStore.readStepIO(
          runId,
          getRouteParam(request.params.stepId),
        );
        if (!io) {
          response.status(404).json({ error: "Step Trace 不存在。", ok: false });
          return;
        }
        response.json({ ok: true, result: { io } });
      } catch (error) {
        respondWithTraceError(response, error);
      }
    },
  );
}
