import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { EventBus, PublishedEvent } from "../events/event-bus";
import type { RunRegistry } from "./run-registry";

const TRACE_SCHEMA_VERSION = 1;
const REDACTED_VALUE = "[REDACTED]";
const CLIENT_NOTIFICATION_TYPES = new Set([
  "activity.appended",
  "activity.display_updated",
  "assistant.message",
  "error",
  "lifecycle",
  "research.context.updated",
  "thinking.message",
  "text.delta",
  "thinking.delta",
]);
const SEMANTIC_OUTPUT_TYPES = new Set([
  "acceptance.updated",
  "assumption.invalidated",
  "attempt.updated",
  "completion.checked",
  "progress.receipt",
  "recovery.started",
  "state.observed.updated",
  "tool.batch.started",
  "tool.receipt",
]);

export type PersistedTraceEvent = PublishedEvent & {
  runId: string;
  seq: number;
  sessionId: string;
};

export type RunTraceRecord = {
  schemaVersion: number;
  runId: string;
  sessionId: string;
  workspaceRoot: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  updatedAt: number;
  traceEventCount: number;
  latestSeq: number;
  stepCount: number;
  prompt?: string;
  runtime?: unknown;
  toolDefinitions?: unknown;
  endedAt?: number;
  durationMs?: number;
  totalSteps?: number;
  error?: string;
  finalAssistantMessage?: string;
  taskState?: unknown;
};

export type StepTraceSummary = {
  stepId: string;
  stepIndex: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  updatedAt: number;
  inputAvailable: boolean;
  outputAvailable: boolean;
  inputPath: string;
  outputPath: string;
  toolCallCount: number;
  toolResultCount: number;
  failedToolCount: number;
  latestSeq: number;
  endedAt?: number;
  durationMs?: number;
  stopReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type StepTraceIndex = {
  schemaVersion: number;
  runId: string;
  updatedAt: number;
  steps: StepTraceSummary[];
};

export type StepTraceInput = {
  schemaVersion: number;
  runId: string;
  stepId: string;
  stepIndex: number;
  snapshotHash: string;
  context?: unknown;
  contextSeq?: number;
  exactRequest?: unknown;
  requestSeq?: number;
  frozenAtSeq?: number;
};

export type StepTraceOutput = {
  schemaVersion: number;
  runId: string;
  stepId: string;
  stepIndex: number;
  status: "running" | "completed" | "failed" | "cancelled";
  thinking: string;
  assistantText: string;
  toolCalls: unknown[];
  toolResults: unknown[];
  toolReceipts: unknown[];
  taskStates: unknown[];
  observedStates: unknown[];
  attemptDeltas: unknown[];
  assumptionInvalidations: unknown[];
  acceptanceDeltas: unknown[];
  researchStates: string[];
  statusMessages: string[];
  progressReceipts: unknown[];
  completionChecks: unknown[];
  recoveryEvents: unknown[];
  semanticEvents: PersistedTraceEvent[];
  updatedAt: number;
  response?: unknown;
  latestTaskState?: unknown;
  endedAt?: number;
  durationMs?: number;
  stopReason?: string | null;
  error?: string;
};

export type StepTraceIO = {
  input: StepTraceInput;
  output: StepTraceOutput;
  summary: StepTraceSummary;
};

type StepAggregate = {
  input: StepTraceInput;
  output: StepTraceOutput;
  summary: StepTraceSummary;
};

type RunAggregate = {
  record: RunTraceRecord;
  steps: Map<string, StepAggregate>;
};

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return (
    normalized === "apikey" ||
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken"
  );
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "undefined" || typeof value === "function") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitizeValue(item, seen));
    seen.delete(value);
    return sanitized;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? REDACTED_VALUE
      : sanitizeValue(item, seen);
  }
  seen.delete(value);
  return sanitized;
}

function sanitizeTraceEvent(event: PublishedEvent): PersistedTraceEvent {
  return sanitizeValue(event) as PersistedTraceEvent;
}

function isPersistableTraceEvent(
  event: PublishedEvent,
): event is PersistedTraceEvent {
  return (
    typeof event.seq === "number" &&
    typeof event.runId === "string" &&
    event.runId.length > 0 &&
    typeof event.sessionId === "string" &&
    event.sessionId.length > 0 &&
    !CLIENT_NOTIFICATION_TYPES.has(event.type)
  );
}

function getString(event: PersistedTraceEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function getNumber(event: PersistedTraceEvent, key: string): number | undefined {
  const value = event[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStepIndex(event: PersistedTraceEvent): number | undefined {
  const value = getNumber(event, "stepIndex");
  return value !== undefined && value > 0 ? Math.floor(value) : undefined;
}

function formatStepNumber(stepIndex: number): string {
  return String(stepIndex).padStart(4, "0");
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function createSnapshotHash(input: {
  context?: unknown;
  exactRequest?: unknown;
}): string {
  return createHash("sha256")
    .update(stableJson({
      context: input.context ?? null,
      exactRequest: input.exactRequest ?? null,
    }))
    .digest("hex");
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function relativeStepPath(stepIndex: number, suffix: "input" | "output"): string {
  return `steps/${formatStepNumber(stepIndex)}-${suffix}.json`;
}

function createStepAggregate(
  runId: string,
  stepId: string,
  stepIndex: number,
  startedAt: number,
  seq: number,
): StepAggregate {
  const input: StepTraceInput = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    runId,
    stepId,
    stepIndex,
    snapshotHash: createSnapshotHash({}),
  };
  const output: StepTraceOutput = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    runId,
    stepId,
    stepIndex,
    status: "running",
    thinking: "",
    assistantText: "",
    toolCalls: [],
    toolResults: [],
    toolReceipts: [],
    taskStates: [],
    observedStates: [],
    attemptDeltas: [],
    assumptionInvalidations: [],
    acceptanceDeltas: [],
    researchStates: [],
    statusMessages: [],
    progressReceipts: [],
    completionChecks: [],
    recoveryEvents: [],
    semanticEvents: [],
    updatedAt: startedAt,
  };
  const summary: StepTraceSummary = {
    stepId,
    stepIndex,
    status: "running",
    startedAt,
    updatedAt: startedAt,
    inputAvailable: false,
    outputAvailable: false,
    inputPath: relativeStepPath(stepIndex, "input"),
    outputPath: relativeStepPath(stepIndex, "output"),
    toolCallCount: 0,
    toolResultCount: 0,
    failedToolCount: 0,
    latestSeq: seq,
  };
  return { input, output, summary };
}

function eventTimestamp(event: PersistedTraceEvent): number {
  return (
    getNumber(event, "endedAt") ??
    getNumber(event, "startedAt") ??
    Date.now()
  );
}

export class RunTraceStore {
  private readonly aggregates = new Map<string, RunAggregate>();
  private readonly persistedRunRoots = new Map<string, string>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly writeErrors = new Map<string, Error>();
  private unsubscribe?: () => void;

  constructor(
    private readonly eventBus: EventBus,
    private readonly registry: RunRegistry,
  ) {}

  start(): void {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.eventBus.subscribeAll((event) => {
      if (!isPersistableTraceEvent(event)) {
        return;
      }

      const handle = this.registry.get(event.runId);
      if (
        !handle?.workspaceRoot ||
        handle.sessionId !== event.sessionId ||
        !this.aggregates.has(event.runId)
      ) {
        return;
      }

      try {
        this.enqueue(sanitizeTraceEvent(event));
      } catch (error) {
        this.recordWriteError(event.runId, error);
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async initializeRun(runId: string): Promise<void> {
    const handle = this.registry.get(runId);
    if (!handle?.workspaceRoot) {
      throw new Error(`Run ${runId} 缺少已登记的 workspace。`);
    }

    const runDirectory = this.resolveRunDirectory(runId);
    if (!runDirectory) {
      throw new Error(`Run ${runId} 的 workspace 映射无效。`);
    }

    const now = handle.startedAt;
    const record: RunTraceRecord = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId,
      sessionId: handle.sessionId,
      workspaceRoot: handle.workspaceRoot,
      status: "running",
      startedAt: now,
      updatedAt: now,
      traceEventCount: 0,
      latestSeq: 0,
      stepCount: 0,
    };
    this.aggregates.set(runId, { record, steps: new Map() });
    this.persistedRunRoots.set(runId, handle.workspaceRoot);

    await fs.mkdir(path.join(runDirectory, "steps"), { recursive: true });
    await fs.appendFile(path.join(runDirectory, "trace.jsonl"), "", {
      encoding: "utf8",
      mode: 0o600,
    });
    await Promise.all([
      writeJsonAtomically(path.join(runDirectory, "run.json"), record),
      writeJsonAtomically(path.join(runDirectory, "step-index.json"), {
        schemaVersion: TRACE_SCHEMA_VERSION,
        runId,
        updatedAt: now,
        steps: [],
      } satisfies StepTraceIndex),
    ]);
  }

  async flush(runId: string): Promise<void> {
    await this.queues.get(runId);
    const error = this.writeErrors.get(runId);
    if (error) {
      throw error;
    }
  }

  async readRun(runId: string): Promise<RunTraceRecord | null> {
    const runDirectory = this.resolveRunDirectory(runId);
    if (!runDirectory) {
      return null;
    }
    return this.runSerialized(runId, () =>
      readJson<RunTraceRecord>(path.join(runDirectory, "run.json")),
    );
  }

  hasRun(runId: string): boolean {
    return Boolean(this.resolveRunDirectory(runId));
  }

  async discoverRun(
    runId: string,
    workspaceRoot: string,
    expectedSessionId?: string,
  ): Promise<RunTraceRecord | null> {
    if (!/^[a-z0-9-]{1,128}$/i.test(runId)) return null;
    const root = path.resolve(workspaceRoot);
    const runDirectory = path.resolve(root, ".ranni", "runs", runId);
    const record = await readJson<RunTraceRecord>(
      path.join(runDirectory, "run.json"),
    );
    if (
      !record ||
      record.runId !== runId ||
      typeof record.sessionId !== "string" ||
      !record.sessionId ||
      (expectedSessionId !== undefined && record.sessionId !== expectedSessionId)
    ) {
      return null;
    }
    this.persistedRunRoots.set(runId, root);
    return record;
  }

  async discoverSessionRuns(
    sessionId: string,
    workspaceRoot: string,
  ): Promise<RunTraceRecord[]> {
    const root = path.resolve(workspaceRoot);
    const runsRoot = path.resolve(root, ".ranni", "runs");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const records = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() && /^[a-z0-9-]{1,128}$/i.test(entry.name),
        )
        .map((entry) => this.discoverRun(entry.name, root, sessionId)),
    );
    return records
      .filter(
        (record): record is RunTraceRecord =>
          record !== null && record.sessionId === sessionId,
      )
      .sort((left, right) => right.startedAt - left.startedAt);
  }

  async listSteps(runId: string): Promise<StepTraceIndex | null> {
    const runDirectory = this.resolveRunDirectory(runId);
    if (!runDirectory) {
      return null;
    }
    return this.runSerialized(runId, () =>
      readJson<StepTraceIndex>(path.join(runDirectory, "step-index.json")),
    );
  }

  async readStepIO(runId: string, stepId: string): Promise<StepTraceIO | null> {
    const runDirectory = this.resolveRunDirectory(runId);
    if (!runDirectory) {
      return null;
    }
    return this.runSerialized(runId, async () => {
      const index = await readJson<StepTraceIndex>(
        path.join(runDirectory, "step-index.json"),
      );
      const persistedSummary = Array.isArray(index?.steps)
        ? index.steps.find((step) => step.stepId === stepId)
        : undefined;
      if (
        !persistedSummary ||
        !Number.isInteger(persistedSummary.stepIndex) ||
        persistedSummary.stepIndex <= 0
      ) {
        return null;
      }

      const summary: StepTraceSummary = {
        ...persistedSummary,
        inputPath: relativeStepPath(persistedSummary.stepIndex, "input"),
        outputPath: relativeStepPath(persistedSummary.stepIndex, "output"),
      };

      const [input, output] = await Promise.all([
        readJson<StepTraceInput>(path.join(runDirectory, summary.inputPath)),
        readJson<StepTraceOutput>(path.join(runDirectory, summary.outputPath)),
      ]);
      if (!input || !output) {
        return null;
      }
      return { input, output, summary };
    });
  }

  private runSerialized<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(runId) ?? Promise.resolve();
    const result = previous.then(() => {
      const writeError = this.writeErrors.get(runId);
      if (writeError) {
        throw writeError;
      }
      return operation();
    });
    this.queues.set(
      runId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private enqueue(event: PersistedTraceEvent): void {
    const previous = this.queues.get(event.runId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.persistEvent(event))
      .catch((error) => {
        this.recordWriteError(event.runId, error);
      });
    this.queues.set(event.runId, next);
  }

  private recordWriteError(runId: string, error: unknown): void {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    this.writeErrors.set(runId, normalized);
    console.error(`Run ${runId} trace persistence failed:`, normalized.message);
  }

  private resolveRunDirectory(runId: string): string | null {
    const handle = this.registry.get(runId);
    const workspaceRoot =
      handle?.workspaceRoot ?? this.persistedRunRoots.get(runId);
    if (!workspaceRoot || !/^[a-z0-9-]{1,128}$/i.test(runId)) {
      return null;
    }

    const runsRoot = path.resolve(workspaceRoot, ".ranni", "runs");
    const runDirectory = path.resolve(runsRoot, runId);
    return runDirectory.startsWith(`${runsRoot}${path.sep}`)
      ? runDirectory
      : null;
  }

  private findStep(
    aggregate: RunAggregate,
    event: PersistedTraceEvent,
  ): StepAggregate | undefined {
    const stepId = getString(event, "stepId");
    if (stepId) {
      return aggregate.steps.get(stepId);
    }

    const stepIndex = getStepIndex(event);
    if (stepIndex === undefined) {
      return undefined;
    }
    return [...aggregate.steps.values()].find(
      (step) => step.summary.stepIndex === stepIndex,
    );
  }

  private ensureStep(
    aggregate: RunAggregate,
    event: PersistedTraceEvent,
  ): StepAggregate | undefined {
    const existing = this.findStep(aggregate, event);
    if (existing) {
      return existing;
    }

    const stepId = getString(event, "stepId");
    const stepIndex = getStepIndex(event);
    if (!stepId || stepIndex === undefined) {
      return undefined;
    }

    const step = createStepAggregate(
      event.runId,
      stepId,
      stepIndex,
      getNumber(event, "startedAt") ?? eventTimestamp(event),
      event.seq,
    );
    aggregate.steps.set(stepId, step);
    return step;
  }

  private applyRunEvent(
    aggregate: RunAggregate,
    event: PersistedTraceEvent,
  ): void {
    const record = aggregate.record;
    record.traceEventCount += 1;
    record.latestSeq = event.seq;
    record.updatedAt = eventTimestamp(event);

    if (event.type === "run.started") {
      record.prompt = getString(event, "prompt");
      record.runtime = event.runtime;
      record.toolDefinitions = event.toolDefinitions;
      record.startedAt = getNumber(event, "startedAt") ?? record.startedAt;
    } else if (event.type === "run.completed") {
      const status = getString(event, "status");
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        record.status = status;
      }
      record.endedAt = getNumber(event, "endedAt");
      record.durationMs = getNumber(event, "durationMs");
      record.totalSteps = getNumber(event, "totalSteps");
      record.error = getString(event, "error");
      record.finalAssistantMessage = getString(
        event,
        "finalAssistantMessage",
      );
    } else if (event.type === "task.state") {
      record.taskState = event.taskState;
    } else if (event.type === "text.completed") {
      record.finalAssistantMessage = getString(event, "message");
    }

    record.stepCount = aggregate.steps.size;
  }

  private applyStepEvent(
    step: StepAggregate,
    event: PersistedTraceEvent,
  ): { inputChanged: boolean; outputChanged: boolean } {
    let inputChanged = false;
    let outputChanged = false;
    const timestamp = eventTimestamp(event);
    step.summary.latestSeq = event.seq;
    step.summary.updatedAt = timestamp;
    step.output.updatedAt = timestamp;

    if (event.type === "context.snapshot" && step.input.context === undefined) {
      step.input.context = event.context;
      step.input.contextSeq = event.seq;
      inputChanged = true;
    } else if (
      event.type === "model.request" &&
      step.input.exactRequest === undefined
    ) {
      step.input.exactRequest = event.request;
      step.input.requestSeq = event.seq;
      step.input.frozenAtSeq = event.seq;
      inputChanged = true;
    } else if (event.type === "model.response") {
      step.output.response = event.response;
      const response = event.response;
      if (response && typeof response === "object" && "usage" in response) {
        const usage = response.usage;
        if (usage && typeof usage === "object") {
          const inputTokens = Reflect.get(usage, "inputTokens");
          const outputTokens = Reflect.get(usage, "outputTokens");
          step.summary.inputTokens =
            typeof inputTokens === "number" || inputTokens === null
              ? inputTokens
              : undefined;
          step.summary.outputTokens =
            typeof outputTokens === "number" || outputTokens === null
              ? outputTokens
              : undefined;
        }
      }
      outputChanged = true;
    } else if (event.type === "thinking.completed") {
      step.output.thinking = getString(event, "message") ?? "";
      outputChanged = true;
    } else if (event.type === "text.completed") {
      step.output.assistantText = getString(event, "message") ?? "";
      outputChanged = true;
    } else if (event.type === "tool.started") {
      step.output.toolCalls.push(event);
      step.summary.toolCallCount = step.output.toolCalls.length;
      outputChanged = true;
    } else if (event.type === "tool.completed") {
      step.output.toolResults.push(event);
      step.summary.toolResultCount = step.output.toolResults.length;
      step.summary.failedToolCount = step.output.toolResults.filter(
        (result) =>
          result !== null &&
          typeof result === "object" &&
          Reflect.get(result, "success") === false,
      ).length;
      outputChanged = true;
    } else if (event.type === "task.state") {
      step.output.taskStates.push(event.taskState);
      step.output.latestTaskState = event.taskState;
      outputChanged = true;
    } else if (event.type === "research.state") {
      const researchState = getString(event, "researchState");
      if (researchState !== undefined) {
        step.output.researchStates.push(researchState);
      }
      outputChanged = true;
    } else if (event.type === "run.status") {
      const message = getString(event, "message");
      if (message !== undefined) {
        step.output.statusMessages.push(message);
      }
      outputChanged = true;
    } else if (event.type === "step.completed") {
      const status = getString(event, "status");
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        step.summary.status = status;
        step.output.status = status;
      }
      step.summary.endedAt = getNumber(event, "endedAt");
      step.summary.durationMs = getNumber(event, "durationMs");
      step.summary.stopReason =
        event.stopReason === null ? null : getString(event, "stopReason");
      step.output.endedAt = step.summary.endedAt;
      step.output.durationMs = step.summary.durationMs;
      step.output.stopReason = step.summary.stopReason;
      if (status === "failed") {
        step.output.error = getString(event, "error") ?? "Step failed";
      }
      outputChanged = true;
    } else if (SEMANTIC_OUTPUT_TYPES.has(event.type)) {
      step.output.semanticEvents.push(event);
      if (event.type === "progress.receipt") {
        step.output.progressReceipts.push(event.progressReceipt ?? event);
      } else if (event.type === "tool.receipt") {
        step.output.toolReceipts.push(event.receipt ?? event);
      } else if (event.type === "state.observed.updated") {
        step.output.observedStates.push(event.observedState ?? event);
      } else if (event.type === "attempt.updated") {
        step.output.attemptDeltas.push(event.attemptDelta ?? event);
      } else if (event.type === "assumption.invalidated") {
        step.output.assumptionInvalidations.push(event);
      } else if (event.type === "acceptance.updated") {
        step.output.acceptanceDeltas.push(event.acceptanceDelta ?? event);
      } else if (event.type === "completion.checked") {
        step.output.completionChecks.push(event);
      } else if (event.type === "recovery.started") {
        step.output.recoveryEvents.push(event);
      }
      outputChanged = true;
    }

    if (inputChanged) {
      step.input.snapshotHash = createSnapshotHash(step.input);
    }
    step.summary.inputAvailable =
      step.input.context !== undefined && step.input.exactRequest !== undefined;
    step.summary.outputAvailable =
      step.summary.outputAvailable || outputChanged;
    return { inputChanged, outputChanged };
  }

  private async persistEvent(event: PersistedTraceEvent): Promise<void> {
    const aggregate = this.aggregates.get(event.runId);
    const runDirectory = this.resolveRunDirectory(event.runId);
    if (!aggregate || !runDirectory) {
      return;
    }

    await fs.appendFile(
      path.join(runDirectory, "trace.jsonl"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );

    const step = this.ensureStep(aggregate, event);
    const changes = step
      ? this.applyStepEvent(step, event)
      : { inputChanged: false, outputChanged: false };
    this.applyRunEvent(aggregate, event);

    const writes: Promise<void>[] = [
      writeJsonAtomically(
        path.join(runDirectory, "run.json"),
        aggregate.record,
      ),
    ];

    if (step) {
      if (event.type === "step.started" || changes.inputChanged) {
        writes.push(
          writeJsonAtomically(
            path.join(runDirectory, step.summary.inputPath),
            step.input,
          ),
        );
      }
      if (event.type === "step.started" || changes.outputChanged) {
        writes.push(
          writeJsonAtomically(
            path.join(runDirectory, step.summary.outputPath),
            step.output,
          ),
        );
      }
      writes.push(
        writeJsonAtomically(path.join(runDirectory, "step-index.json"), {
          schemaVersion: TRACE_SCHEMA_VERSION,
          runId: event.runId,
          updatedAt: aggregate.record.updatedAt,
          steps: [...aggregate.steps.values()]
            .map((entry) => entry.summary)
            .sort((left, right) => left.stepIndex - right.stepIndex),
        } satisfies StepTraceIndex),
      );
    }

    await Promise.all(writes);
  }
}
