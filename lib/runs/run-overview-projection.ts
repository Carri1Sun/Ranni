import type { AcceptanceSnapshot } from "../acceptance";
import type { PublishedEvent } from "../events/event-bus";
import type { PlanSnapshot, PlanItemStatus } from "../plan";
import type { PlanAttemptLedgerSnapshot } from "../plan-attempt";
import type { StepProgressReceipt } from "../progress";
import type { ObservedState } from "../receipts/types";
import type { TaskState } from "../task-state";

const RUN_OVERVIEW_SCHEMA_VERSION = 1 as const;
const MAX_TIMELINE_ENTRIES = 120;

export type RunOverviewTimelineType =
  | "acceptance.changed"
  | "attempt.changed"
  | "completion.checked"
  | "context.seeded"
  | "plan.finalization"
  | "plan.focus"
  | "plan.item.status"
  | "plan.projection"
  | "plan.revision"
  | "progress.information"
  | "progress.objective"
  | "progress.regression"
  | "progress.stalled"
  | "recovery.started";

export type RunOverviewTimelineEntry = {
  at: number;
  detail?: string;
  fromStatus?: PlanItemStatus;
  id: string;
  itemId?: string;
  itemTitle?: string;
  planRevision?: number;
  projectionVersion?: number;
  seq: number;
  stepIndex?: number;
  title: string;
  toStatus?: PlanItemStatus;
  type: RunOverviewTimelineType;
};

export type RunOverviewCompletion = {
  acceptanceGap: string[];
  checkedAt: number;
  evidenceRefs: string[];
  ready: boolean;
  reason: string;
  stepIndex?: number;
};

export type RunOverviewRecovery = {
  acceptanceGap: string[];
  checkpoint?: {
    activeAttemptId?: string;
    checkpointRef?: string;
    completedSteps: number;
    planRevision: number;
    schemaVersion: number;
  };
  contextSnapshotHash: string;
  error: string;
  startedAt: number;
  stepIndex?: number;
};

export type RunOverviewProjection = {
  acceptance?: AcceptanceSnapshot;
  attempt?: PlanAttemptLedgerSnapshot;
  completion?: RunOverviewCompletion;
  latestSeq: number;
  observedState?: ObservedState;
  plan?: PlanSnapshot;
  progress?: StepProgressReceipt;
  recovery?: RunOverviewRecovery;
  runId: string;
  schemaVersion: typeof RUN_OVERVIEW_SCHEMA_VERSION;
  taskState?: TaskState;
  timeline: RunOverviewTimelineEntry[];
  updatedAt: number;
};

type ProjectionEvent = PublishedEvent & {
  runId?: unknown;
  seq?: unknown;
  stepIndex?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getStepIndex(event: ProjectionEvent): number | undefined {
  const stepIndex = getFiniteNumber(event.stepIndex);
  return stepIndex !== undefined && stepIndex > 0
    ? Math.floor(stepIndex)
    : undefined;
}

function eventTimestamp(event: ProjectionEvent, now: number): number {
  const receipt = isRecord(event.progressReceipt)
    ? event.progressReceipt
    : isRecord(event.receipt)
      ? event.receipt
      : undefined;
  return (
    getFiniteNumber(event.at) ??
    getFiniteNumber(event.endedAt) ??
    getFiniteNumber(event.startedAt) ??
    getFiniteNumber(receipt?.endedAt) ??
    now
  );
}

function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.revision === "number" &&
    typeof value.projectionVersion === "number" &&
    Array.isArray(value.items) &&
    Array.isArray(value.revisions)
  );
}

function toPlanSnapshot(value: unknown): PlanSnapshot | undefined {
  if (isPlanSnapshot(value)) return clone(value);
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.revision !== "number" ||
    typeof value.projectionVersion !== "number" ||
    !Array.isArray(value.items)
  ) {
    return undefined;
  }

  const lastRevision = isRecord(value.lastRevision)
    ? value.lastRevision
    : undefined;
  return clone({
    focusItemId:
      typeof value.focusItemId === "string" ? value.focusItemId : undefined,
    id: value.id,
    items: value.items,
    projectionVersion: value.projectionVersion,
    revision: value.revision,
    revisions: lastRevision ? [lastRevision] : [],
  } as PlanSnapshot);
}

function isAttemptSnapshot(value: unknown): value is PlanAttemptLedgerSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.assumptions) &&
    Array.isArray(value.attempts)
  );
}

function isAcceptanceSnapshot(value: unknown): value is AcceptanceSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.criteria) &&
    Array.isArray(value.gap)
  );
}

function isProgressReceipt(value: unknown): value is StepProgressReceipt {
  return (
    isRecord(value) &&
    typeof value.objectiveProgress === "boolean" &&
    typeof value.informationGain === "boolean" &&
    typeof value.regression === "boolean" &&
    typeof value.stateHash === "string"
  );
}

function isTaskState(value: unknown): value is TaskState {
  return (
    isRecord(value) &&
    typeof value.goal === "string" &&
    typeof value.currentMode === "string" &&
    typeof value.nextAction === "string"
  );
}

function isObservedState(value: unknown): value is ObservedState {
  return (
    isRecord(value) &&
    typeof value.stateHash === "string" &&
    isRecord(value.artifacts) &&
    Array.isArray(value.commands) &&
    isRecord(value.evidence) &&
    isRecord(value.files) &&
    Array.isArray(value.receipts) &&
    Array.isArray(value.unresolvedErrors) &&
    Array.isArray(value.verification)
  );
}

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function appendTimeline(
  current: RunOverviewTimelineEntry[],
  entries: RunOverviewTimelineEntry[],
): RunOverviewTimelineEntry[] {
  if (entries.length === 0) return current;
  return [...current, ...entries].slice(-MAX_TIMELINE_ENTRIES);
}

function timelineEntry(
  event: ProjectionEvent,
  at: number,
  type: RunOverviewTimelineType,
  index: number,
  title: string,
  detail?: string,
): RunOverviewTimelineEntry {
  const seq = event.seq as number;
  const stepIndex = getStepIndex(event);
  return {
    at,
    ...(detail ? { detail } : {}),
    id: `${String(event.runId)}:${seq}:${type}:${index}`,
    seq,
    ...(stepIndex !== undefined ? { stepIndex } : {}),
    title,
    type,
  };
}

function latestRevisionReason(plan: PlanSnapshot): string | undefined {
  const revision = plan.revisions.findLast(
    (entry) => entry.number === plan.revision,
  );
  return revision?.reason;
}

function planTimelineEntries(
  previous: PlanSnapshot | undefined,
  next: PlanSnapshot,
  kind: unknown,
  event: ProjectionEvent,
  at: number,
): RunOverviewTimelineEntry[] {
  const entries: RunOverviewTimelineEntry[] = [];
  const type = kind === "projection"
    ? "plan.projection"
    : kind === "finalization"
      ? "plan.finalization"
      : "plan.revision";
  const typeLabel = type === "plan.projection"
    ? "计划状态投影"
    : type === "plan.finalization"
      ? "计划完成投影"
      : "Working Plan 修订";
  const updateEntry = timelineEntry(
    event,
    at,
    type,
    entries.length,
    `${typeLabel} · R${next.revision} / P${next.projectionVersion}`,
    latestRevisionReason(next),
  );
  updateEntry.planRevision = next.revision;
  updateEntry.projectionVersion = next.projectionVersion;
  entries.push(updateEntry);

  const previousItems = new Map(
    (previous?.items ?? []).map((item) => [item.id, item]),
  );
  for (const item of next.items) {
    const previousItem = previousItems.get(item.id);
    if (previousItem?.status === item.status) continue;
    const statusEntry = timelineEntry(
      event,
      at,
      "plan.item.status",
      entries.length,
      `${item.id} · ${item.title}`,
      previousItem
        ? `${previousItem.status} → ${item.status}`
        : `加入计划 · ${item.status}`,
    );
    statusEntry.itemId = item.id;
    statusEntry.itemTitle = item.title;
    statusEntry.planRevision = next.revision;
    statusEntry.projectionVersion = next.projectionVersion;
    if (previousItem) statusEntry.fromStatus = previousItem.status;
    statusEntry.toStatus = item.status;
    entries.push(statusEntry);
  }

  if (previous?.focusItemId !== next.focusItemId && next.focusItemId) {
    const focusItem = next.items.find((item) => item.id === next.focusItemId);
    const focusEntry = timelineEntry(
      event,
      at,
      "plan.focus",
      entries.length,
      `当前 Plan Focus · ${next.focusItemId}`,
      focusItem?.title,
    );
    focusEntry.itemId = next.focusItemId;
    focusEntry.itemTitle = focusItem?.title;
    focusEntry.planRevision = next.revision;
    focusEntry.projectionVersion = next.projectionVersion;
    entries.push(focusEntry);
  }

  return entries;
}

function seedAttemptFromWorkingSet(
  workingSet: Record<string, unknown>,
  stepIndex: number | undefined,
): PlanAttemptLedgerSnapshot | undefined {
  const activeAttempt = isRecord(workingSet.activeAttempt)
    ? workingSet.activeAttempt
    : undefined;
  if (
    !activeAttempt ||
    typeof activeAttempt.id !== "string" ||
    typeof activeAttempt.approach !== "string"
  ) {
    return undefined;
  }
  const status = [
    "abandoned",
    "active",
    "failed",
    "succeeded",
    "superseded",
  ].includes(String(activeAttempt.status))
    ? activeAttempt.status as
        | "abandoned"
        | "active"
        | "failed"
        | "succeeded"
        | "superseded"
    : "active";
  const activeAssumptions = Array.isArray(workingSet.activeAssumptions)
    ? workingSet.activeAssumptions.filter(
        (statement): statement is string => typeof statement === "string",
      )
    : [];
  const assumptions = activeAssumptions.map((statement, index) => ({
    evidenceRefs: [],
    id: `context-assumption-${index + 1}`,
    statement,
    status: "active" as const,
  }));
  return {
    assumptions,
    attempts: [
      {
        approach: activeAttempt.approach,
        assumptionIds: assumptions.map((assumption) => assumption.id),
        evidenceRefs: [],
        exitCriteria: [],
        id: activeAttempt.id,
        startedAtStep: Math.max(0, (stepIndex ?? 1) - 1),
        status,
      },
    ],
  };
}

function applyContextSeed(
  current: RunOverviewProjection,
  event: ProjectionEvent,
  at: number,
): RunOverviewProjection | null {
  if (!isRecord(event.context)) return null;
  const context = event.context;
  const workingSet = isRecord(context.workingSet)
    ? context.workingSet
    : undefined;
  const seededPlan = toPlanSnapshot(
    context.plan ?? workingSet?.plan,
  );
  const directAttempt = isAttemptSnapshot(context.attemptState)
    ? clone(context.attemptState)
    : undefined;
  const seededAttempt =
    directAttempt ??
    (workingSet
      ? seedAttemptFromWorkingSet(workingSet, getStepIndex(event))
      : undefined);
  const directAcceptance = isAcceptanceSnapshot(context.acceptanceState)
    ? clone(context.acceptanceState)
    : undefined;
  const seededAcceptance =
    directAcceptance ??
    (workingSet && Array.isArray(workingSet.acceptanceGap)
      ? {
          criteria: [],
          gap: workingSet.acceptanceGap.filter(
            (gap): gap is string => typeof gap === "string",
          ),
        }
      : undefined);
  const seededProgress = isProgressReceipt(context.progressReceipt)
    ? clone(context.progressReceipt)
    : undefined;
  const seededTaskState = isTaskState(context.taskState)
    ? clone(context.taskState)
    : undefined;
  const seededObservedState = isObservedState(context.observedState)
    ? clone(context.observedState)
    : undefined;

  const planShouldAdvance = Boolean(
    seededPlan &&
      (!current.plan ||
        seededPlan.revision > current.plan.revision ||
        (seededPlan.revision === current.plan.revision &&
          seededPlan.projectionVersion > current.plan.projectionVersion)),
  );
  const nextPlan = planShouldAdvance ? seededPlan : current.plan;
  const nextAttempt = current.attempt ?? seededAttempt;
  const nextAcceptance = current.acceptance ?? seededAcceptance;
  const nextProgress = current.progress ?? seededProgress;
  const nextTaskState = current.taskState ?? seededTaskState;
  const nextObservedState = current.observedState ?? seededObservedState;
  const changed =
    nextPlan !== current.plan ||
    nextAttempt !== current.attempt ||
    nextAcceptance !== current.acceptance ||
    nextProgress !== current.progress ||
    nextTaskState !== current.taskState ||
    nextObservedState !== current.observedState;
  if (!changed) return null;

  const entry = timelineEntry(
    event,
    at,
    "context.seeded",
    0,
    "从 Context Snapshot 恢复 Run 概览",
    [
      nextPlan !== current.plan ? "Working Plan" : "",
      nextAttempt !== current.attempt ? "Attempt" : "",
      nextAcceptance !== current.acceptance ? "Acceptance" : "",
      nextProgress !== current.progress ? "Progress" : "",
      nextTaskState !== current.taskState ? "Task State" : "",
      nextObservedState !== current.observedState ? "Observed State" : "",
    ].filter(Boolean).join("、"),
  );
  return {
    ...current,
    ...(nextAcceptance ? { acceptance: nextAcceptance } : {}),
    ...(nextAttempt ? { attempt: nextAttempt } : {}),
    ...(nextObservedState ? { observedState: nextObservedState } : {}),
    ...(nextPlan ? { plan: nextPlan } : {}),
    ...(nextProgress ? { progress: nextProgress } : {}),
    ...(nextTaskState ? { taskState: nextTaskState } : {}),
    latestSeq: event.seq as number,
    timeline: appendTimeline(current.timeline, [entry]),
    updatedAt: at,
  };
}

export function createRunOverviewProjection(
  runId: string,
  updatedAt = Date.now(),
): RunOverviewProjection {
  return {
    latestSeq: 0,
    runId,
    schemaVersion: RUN_OVERVIEW_SCHEMA_VERSION,
    timeline: [],
    updatedAt,
  };
}

export function reduceRunOverviewProjection(
  current: RunOverviewProjection,
  event: ProjectionEvent,
  options?: { now?: number },
): RunOverviewProjection {
  if (
    event.runId !== current.runId ||
    typeof event.seq !== "number" ||
    !Number.isFinite(event.seq) ||
    event.seq <= current.latestSeq
  ) {
    return current;
  }

  const at = eventTimestamp(event, options?.now ?? Date.now());
  const base = {
    ...current,
    latestSeq: event.seq,
    updatedAt: at,
  };

  if (event.type === "context.snapshot") {
    return applyContextSeed(current, event, at) ?? current;
  }

  if (event.type === "plan.updated" && isRecord(event.planChange)) {
    const plan = toPlanSnapshot(event.planChange.snapshot);
    if (!plan || stableValue(plan) === stableValue(current.plan)) return current;
    const entries = planTimelineEntries(
      current.plan,
      plan,
      event.planChange.kind,
      event,
      at,
    );
    return {
      ...base,
      plan,
      timeline: appendTimeline(current.timeline, entries),
    };
  }

  if (event.type === "attempt.updated" && isAttemptSnapshot(event.attemptState)) {
    const attempt = clone(event.attemptState);
    if (stableValue(attempt) === stableValue(current.attempt)) return current;
    const delta = isRecord(event.attemptDelta) ? event.attemptDelta : {};
    const changedIds = [
      delta.created,
      delta.failed,
      delta.succeeded,
      delta.abandoned,
      delta.superseded,
    ].filter((value): value is string => typeof value === "string");
    const entry = timelineEntry(
      event,
      at,
      "attempt.changed",
      0,
      "工作路线已更新",
      changedIds.length > 0
        ? [...new Set(changedIds)].join("、")
        : typeof delta.activeAttemptId === "string"
          ? `当前 Attempt · ${delta.activeAttemptId}`
          : undefined,
    );
    return {
      ...base,
      attempt,
      timeline: appendTimeline(current.timeline, [entry]),
    };
  }

  if (
    event.type === "acceptance.updated" &&
    isAcceptanceSnapshot(event.acceptanceState)
  ) {
    const acceptance = clone(event.acceptanceState);
    if (stableValue(acceptance) === stableValue(current.acceptance)) return current;
    const delta = isRecord(event.acceptanceDelta) ? event.acceptanceDelta : {};
    const changes = Array.isArray(delta.changed) ? delta.changed : [];
    const entry = timelineEntry(
      event,
      at,
      "acceptance.changed",
      0,
      "Acceptance Snapshot 已更新",
      changes
        .filter(isRecord)
        .map((change) =>
          typeof change.id === "string"
            ? `${change.id}: ${String(change.from)} → ${String(change.to)}`
            : "",
        )
        .filter(Boolean)
        .join("；") || undefined,
    );
    return {
      ...base,
      acceptance,
      timeline: appendTimeline(current.timeline, [entry]),
    };
  }

  if (event.type === "progress.receipt" && isProgressReceipt(event.progressReceipt)) {
    const progress = clone(event.progressReceipt);
    if (stableValue(progress) === stableValue(current.progress)) return current;
    const entries: RunOverviewTimelineEntry[] = [];
    if (progress.regression) {
      entries.push(
        timelineEntry(
          event,
          at,
          "progress.regression",
          entries.length,
          "交付进展发生回退",
          progress.regressionDeltas.join("；") || undefined,
        ),
      );
    } else if (progress.objectiveProgress) {
      entries.push(
        timelineEntry(
          event,
          at,
          "progress.objective",
          entries.length,
          "交付缺口已缩小",
          progress.objectiveDeltas.join("；") || undefined,
        ),
      );
    } else if (progress.informationGain) {
      entries.push(
        timelineEntry(
          event,
          at,
          "progress.information",
          entries.length,
          "获得新的有效信息",
          progress.informationDeltas.join("；") || undefined,
        ),
      );
    } else if (
      progress.sameStrategyFailureStreak === 2 ||
      progress.noMeaningfulProgressStreak === 3 ||
      progress.noMeaningfulProgressStreak === 6
    ) {
      entries.push(
        timelineEntry(
          event,
          at,
          "progress.stalled",
          entries.length,
          "当前路线需要重新评估",
          `无有效进展 ${progress.noMeaningfulProgressStreak} 轮；相同路线失败 ${progress.sameStrategyFailureStreak} 轮`,
        ),
      );
    }
    return {
      ...base,
      progress,
      timeline: appendTimeline(current.timeline, entries),
    };
  }

  if (event.type === "task.state" && isTaskState(event.taskState)) {
    const taskState = clone(event.taskState);
    if (stableValue(taskState) === stableValue(current.taskState)) return current;
    return { ...base, taskState };
  }

  if (
    event.type === "state.observed.updated" &&
    isObservedState(event.observedState)
  ) {
    const observedState = clone(event.observedState);
    if (observedState.stateHash === current.observedState?.stateHash) return current;
    return { ...base, observedState };
  }

  if (event.type === "completion.checked") {
    const acceptanceGap = Array.isArray(event.acceptanceGap)
      ? event.acceptanceGap.filter((gap): gap is string => typeof gap === "string")
      : [];
    const evidenceRefs = Array.isArray(event.evidenceRefs)
      ? event.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [];
    if (typeof event.ready !== "boolean" || typeof event.reason !== "string") {
      return current;
    }
    const completion: RunOverviewCompletion = {
      acceptanceGap,
      checkedAt: at,
      evidenceRefs,
      ready: event.ready,
      reason: event.reason,
      ...(getStepIndex(event) !== undefined
        ? { stepIndex: getStepIndex(event) }
        : {}),
    };
    const entry = timelineEntry(
      event,
      at,
      "completion.checked",
      0,
      event.ready ? "完成条件已满足" : "完成条件仍有缺口",
      event.reason,
    );
    return {
      ...base,
      completion,
      timeline: appendTimeline(current.timeline, [entry]),
    };
  }

  if (
    event.type === "recovery.started" &&
    typeof event.contextSnapshotHash === "string" &&
    typeof event.error === "string"
  ) {
    const recovery: RunOverviewRecovery = {
      acceptanceGap: Array.isArray(event.acceptanceGap)
        ? event.acceptanceGap.filter(
            (gap): gap is string => typeof gap === "string",
          )
        : [],
      ...(isRecord(event.checkpoint)
        ? {
            checkpoint: clone(event.checkpoint) as RunOverviewRecovery["checkpoint"],
          }
        : {}),
      contextSnapshotHash: event.contextSnapshotHash,
      error: event.error,
      startedAt: at,
      ...(getStepIndex(event) !== undefined
        ? { stepIndex: getStepIndex(event) }
        : {}),
    };
    const entry = timelineEntry(
      event,
      at,
      "recovery.started",
      0,
      "进入 Recovery",
      event.error,
    );
    return {
      ...base,
      recovery,
      timeline: appendTimeline(current.timeline, [entry]),
    };
  }

  return current;
}
