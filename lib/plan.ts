import type { AcceptanceSnapshot } from "./acceptance";
import type { ObservedState, ToolReceipt } from "./receipts/types";

export type PlanItemModelStatus =
  | "blocked"
  | "cancelled"
  | "completed"
  | "in_progress"
  | "pending";

export type PlanItemStatus =
  | "active"
  | "blocked"
  | "cancelled"
  | "pending"
  | "satisfied"
  | "superseded";

export type PlanRevisionReason =
  | "acceptance_gap"
  | "failed_assumption"
  | "initial"
  | "new_evidence"
  | "recovery"
  | "refinement"
  | "user_change";

export type PlanItemProposal = {
  acceptanceRefs?: string[];
  blockedReason?: string;
  dependsOn?: string[];
  evidenceHints?: string[];
  expectedOutcome?: string;
  id?: string;
  intent?: string;
  status?: PlanItemModelStatus;
  title: string;
};

export type PlanItemRecord = {
  acceptanceRefs: string[];
  attemptIds: string[];
  blockedReason?: string;
  createdAtStep: number;
  dependsOn: string[];
  evidenceHints: string[];
  evidenceRefs: string[];
  expectedOutcome?: string;
  id: string;
  intent: string;
  modelStatus: PlanItemModelStatus;
  outcome?: string;
  status: PlanItemStatus;
  statusSource: "acceptance" | "finalization" | "model" | "receipt";
  title: string;
  updatedAtStep: number;
};

export type PlanRevision = {
  basedOnObservedStateHash?: string;
  changedItemIds: string[];
  createdAtStep: number;
  id: string;
  itemIds: string[];
  number: number;
  reason: string;
  reasonKind: PlanRevisionReason;
};

export type PlanSnapshot = {
  focusItemId?: string;
  id: string;
  items: PlanItemRecord[];
  projectionVersion: number;
  revision: number;
  revisions: PlanRevision[];
};

export type CompactPlanSnapshot = Omit<PlanSnapshot, "items" | "revisions"> & {
  items: PlanItemRecord[];
  lastRevision?: PlanRevision;
};

export type PlanUpdateOptions = {
  attemptId?: string;
  basedOnObservedStateHash?: string;
  focusItemId?: string;
  reason?: string;
  reasonKind?: PlanRevisionReason;
  stepIndex: number;
};

export type PlanChange = {
  changed: boolean;
  changedItemIds: string[];
  kind: "finalization" | "none" | "projection" | "revision";
  snapshot: PlanSnapshot;
};

export type SerializedPlanLedger = {
  itemCounter: number;
  schemaVersion: 1;
  snapshot: PlanSnapshot;
};

function normalizeText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalPlanItemId(value: string | undefined) {
  const normalized = normalizeText(value);
  const numeric = /^P0*([1-9]\d*)$/i.exec(normalized);
  return numeric
    ? `P${numeric[1].padStart(2, "0")}`
    : normalized;
}

function unique(values: string[] | undefined) {
  return [
    ...new Set(
      (values ?? []).map((value) => normalizeText(value)).filter(Boolean),
    ),
  ];
}

function normalizedIdentity(value: string) {
  return normalizeText(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function grams(value: string) {
  const normalized = normalizedIdentity(value);
  if (normalized.length <= 2) return new Set(normalized ? [normalized] : []);
  return new Set(
    Array.from({ length: normalized.length - 1 }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
}

function titleSimilarity(left: string, right: string) {
  const normalizedLeft = normalizedIdentity(left);
  const normalizedRight = normalizedIdentity(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return Math.min(normalizedLeft.length, normalizedRight.length) /
      Math.max(normalizedLeft.length, normalizedRight.length);
  }
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const intersection = [...leftGrams].filter((value) =>
    rightGrams.has(value),
  ).length;
  const union = new Set([...leftGrams, ...rightGrams]).size;
  return union > 0 ? intersection / union : 0;
}

function cloneSnapshot(snapshot: PlanSnapshot): PlanSnapshot {
  return structuredClone(snapshot);
}

function stableValue(value: unknown) {
  return JSON.stringify(value);
}

function isTerminal(status: PlanItemStatus) {
  return ["cancelled", "satisfied", "superseded"].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.revision === "number" &&
    typeof value.projectionVersion === "number" &&
    Array.isArray(value.items) &&
    Array.isArray(value.revisions)
  );
}

function validateProposalIds(proposals: PlanItemProposal[]) {
  const seen = new Set<string>();
  for (const proposal of proposals) {
    if (!normalizeText(proposal.title)) continue;
    const id = canonicalPlanItemId(proposal.id);
    if (!id) continue;
    if (seen.has(id)) {
      throw new Error(`Working Plan 包含重复 Plan Item ID：${id}。`);
    }
    seen.add(id);
  }
}

function validatePlanDependencyGraph(items: PlanItemRecord[]) {
  const byId = new Map<string, PlanItemRecord>();
  for (const item of items) {
    if (byId.has(item.id)) {
      throw new Error(`Working Plan 包含重复 Plan Item ID：${item.id}。`);
    }
    byId.set(item.id, item);
  }

  for (const item of items) {
    for (const dependencyId of item.dependsOn) {
      if (dependencyId === item.id) {
        throw new Error(
          `Working Plan 的 Plan Item ${item.id} 不能依赖自身。`,
        );
      }
      if (!byId.has(dependencyId)) {
        throw new Error(
          `Working Plan 的 Plan Item ${item.id} 引用了未知依赖：${dependencyId}。`,
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const visit = (itemId: string): void => {
    if (visited.has(itemId)) return;
    if (visiting.has(itemId)) {
      const cycleStart = stack.indexOf(itemId);
      const cycle = [...stack.slice(cycleStart), itemId];
      throw new Error(`Working Plan 依赖图存在环：${cycle.join(" → ")}。`);
    }

    visiting.add(itemId);
    stack.push(itemId);
    for (const dependencyId of byId.get(itemId)?.dependsOn ?? []) {
      visit(dependencyId);
    }
    stack.pop();
    visiting.delete(itemId);
    visited.add(itemId);
  };

  for (const item of items) visit(item.id);
}

function receiptEvidence(receipts: ToolReceipt[]) {
  return receipts.filter(
    (receipt) =>
      receipt.success &&
      receipt.category !== "state" &&
      !receipt.reused &&
      !receipt.unchanged,
  );
}

export class PlanLedger {
  private itemCounter = 0;
  private state: PlanSnapshot;

  constructor() {
    this.state = {
      id: crypto.randomUUID(),
      items: [],
      projectionVersion: 0,
      revision: 0,
      revisions: [],
    };
  }

  private applyFocus(focusItemId: string | undefined, stepIndex: number) {
    const requestedFocusItemId = canonicalPlanItemId(focusItemId);
    const byId = new Map(this.state.items.map((item) => [item.id, item]));
    const canFocus = (item: PlanItemRecord | undefined) =>
      Boolean(
        item &&
          !isTerminal(item.status) &&
          item.status !== "blocked" &&
          item.dependsOn.every(
            (dependencyId) => byId.get(dependencyId)?.status === "satisfied",
          ),
      );
    const requested = this.state.items.find(
      (item) => item.id === requestedFocusItemId && canFocus(item),
    );
    const current = this.state.items.find(
      (item) => item.id === this.state.focusItemId && canFocus(item),
    );
    const focus =
      requested ??
      current ??
      this.state.items.find((item) => canFocus(item));

    this.state.focusItemId = focus?.id;
    for (const item of this.state.items) {
      if (isTerminal(item.status) || item.status === "blocked") continue;
      const status = item.id === focus?.id && canFocus(item)
        ? "active"
        : "pending";
      if (item.status !== status) {
        item.status = status;
        item.statusSource = "model";
        item.updatedAtStep = stepIndex;
      }
    }
  }

  private findLegacyMatches(titles: string[]) {
    const available = this.state.items.filter(
      (item) => item.status !== "superseded" && item.status !== "cancelled",
    );
    const used = new Set<string>();
    return titles.map((title, index) => {
      const exact = available.find(
        (item) =>
          !used.has(item.id) &&
          normalizedIdentity(item.title) === normalizedIdentity(title),
      );
      if (exact) {
        used.add(exact.id);
        return exact;
      }

      const ranked = available
        .filter((item) => !used.has(item.id))
        .map((item) => ({ item, score: titleSimilarity(item.title, title) }))
        .sort((left, right) => right.score - left.score);
      const positional = available[index];
      const candidate =
        ranked[0] && ranked[0].score >= 0.42
          ? ranked[0].item
          : positional &&
              !used.has(positional.id) &&
              titleSimilarity(positional.title, title) >= 0.24
            ? positional
            : undefined;
      if (candidate) used.add(candidate.id);
      return candidate;
    });
  }

  updateLegacy(titles: string[], options: PlanUpdateOptions): PlanChange {
    const normalizedTitles = unique(titles);
    const matches = this.findLegacyMatches(normalizedTitles);
    return this.replace(
      normalizedTitles.map((title, index) => ({
        ...(matches[index] ? { id: matches[index]?.id } : {}),
        status:
          matches[index]?.modelStatus ?? (index === 0 ? "in_progress" : "pending"),
        title,
      })),
      {
        ...options,
        reason: options.reason ?? "兼容短计划更新。",
        reasonKind:
          options.reasonKind ??
          (this.state.revision === 0 ? "initial" : "refinement"),
      },
    );
  }

  replace(
    proposals: PlanItemProposal[],
    options: PlanUpdateOptions,
  ): PlanChange {
    validateProposalIds(proposals);
    const before = stableValue(this.state);
    const priorById = new Map(this.state.items.map((item) => [item.id, item]));
    const nextIds = new Set<string>();
    const changedItemIds = new Set<string>();
    let nextItemCounter = this.itemCounter;
    const nextItems = proposals.flatMap((proposal) => {
      const title = normalizeText(proposal.title);
      if (!title) return [];
      const proposalId = canonicalPlanItemId(proposal.id);
      const existing = proposalId ? priorById.get(proposalId) : undefined;
      if (!existing) nextItemCounter += 1;
      const id =
        existing?.id ?? `P${String(nextItemCounter).padStart(2, "0")}`;
      const modelStatus = proposal.status ?? existing?.modelStatus ?? "pending";
      const blockedReason =
        modelStatus === "blocked"
          ? normalizeText(proposal.blockedReason ?? existing?.blockedReason)
          : "";
      const explicitlyReopened =
        existing?.status === "satisfied" &&
        proposal.status !== undefined &&
        proposal.status !== "completed";
      const status: PlanItemStatus =
        modelStatus === "blocked"
          ? "blocked"
          : modelStatus === "cancelled"
            ? "cancelled"
            : existing?.status === "satisfied" && !explicitlyReopened
              ? "satisfied"
              : modelStatus === "in_progress"
                ? "active"
                : "pending";
      const item: PlanItemRecord = {
        acceptanceRefs: unique(
          proposal.acceptanceRefs ?? existing?.acceptanceRefs,
        ),
        attemptIds: unique([
          ...(existing?.attemptIds ?? []),
          ...(options.attemptId ? [options.attemptId] : []),
        ]),
        ...(blockedReason ? { blockedReason } : {}),
        createdAtStep: existing?.createdAtStep ?? options.stepIndex,
        dependsOn: unique(
          unique(proposal.dependsOn ?? existing?.dependsOn).map(
            canonicalPlanItemId,
          ),
        ),
        evidenceHints: unique(
          proposal.evidenceHints ?? existing?.evidenceHints,
        ),
        evidenceRefs: explicitlyReopened ? [] : existing?.evidenceRefs ?? [],
        ...(normalizeText(proposal.expectedOutcome ?? existing?.expectedOutcome)
          ? {
              expectedOutcome: normalizeText(
                proposal.expectedOutcome ?? existing?.expectedOutcome,
              ),
            }
          : {}),
        id,
        intent: normalizeText(proposal.intent ?? existing?.intent ?? title),
        modelStatus,
        ...(!explicitlyReopened && existing?.outcome
          ? { outcome: existing.outcome }
          : {}),
        status,
        statusSource:
          existing?.status === status ? existing.statusSource : "model",
        title,
        updatedAtStep: existing?.updatedAtStep ?? options.stepIndex,
      };
      nextIds.add(id);
      if (!existing || stableValue(existing) !== stableValue(item)) {
        item.updatedAtStep = options.stepIndex;
        changedItemIds.add(id);
      }
      return [item];
    });

    validatePlanDependencyGraph(nextItems);

    for (const existing of this.state.items) {
      if (nextIds.has(existing.id) || existing.status === "superseded") continue;
      nextItems.push({
        ...existing,
        modelStatus: "cancelled",
        outcome: "Removed by a later plan revision.",
        status: "superseded",
        statusSource: "model",
        updatedAtStep: options.stepIndex,
      });
      changedItemIds.add(existing.id);
    }

    this.itemCounter = nextItemCounter;
    this.state.items = nextItems;
    this.applyFocus(options.focusItemId, options.stepIndex);
    for (const item of this.state.items) {
      const previous = priorById.get(item.id);
      if (!previous || stableValue(previous) !== stableValue(item)) {
        changedItemIds.add(item.id);
      }
    }
    if (stableValue(this.state) === before) {
      return {
        changed: false,
        changedItemIds: [],
        kind: "none",
        snapshot: this.snapshot(),
      };
    }

    this.state.revision += 1;
    const revision: PlanRevision = {
      ...(options.basedOnObservedStateHash
        ? { basedOnObservedStateHash: options.basedOnObservedStateHash }
        : {}),
      changedItemIds: [...changedItemIds],
      createdAtStep: options.stepIndex,
      id: crypto.randomUUID(),
      itemIds: this.state.items
        .filter((item) => item.status !== "superseded")
        .map((item) => item.id),
      number: this.state.revision,
      reason: normalizeText(options.reason) || "计划内容发生修订。",
      reasonKind:
        options.reasonKind ??
        (this.state.revision === 1 ? "initial" : "refinement"),
    };
    this.state.revisions.push(revision);
    return {
      changed: true,
      changedItemIds: revision.changedItemIds,
      kind: "revision",
      snapshot: this.snapshot(),
    };
  }

  reconcile(
    acceptance: AcceptanceSnapshot,
    receiptsOrObserved: ToolReceipt[] | ObservedState,
    stepIndex: number,
  ): PlanChange {
    const before = stableValue(this.state);
    const receipts = Array.isArray(receiptsOrObserved)
      ? receiptsOrObserved
      : receiptsOrObserved.receipts;
    const evidence = receiptEvidence(receipts);
    const acceptanceById = new Map(
      acceptance.criteria.map((criterion) => [criterion.id, criterion]),
    );
    const focus = this.state.items.find(
      (item) => item.id === this.state.focusItemId,
    );
    const beforeItems = new Map(
      this.state.items.map((item) => [item.id, structuredClone(item)]),
    );
    if (focus && evidence.length > 0) {
      focus.evidenceRefs = unique([
        ...focus.evidenceRefs,
        ...evidence.map((receipt) => receipt.id),
      ]);
      focus.updatedAtStep = stepIndex;
      focus.statusSource = "receipt";
    }

    const changedItemIds = new Set<string>();
    for (const item of this.state.items) {
      if (isTerminal(item.status) && item.status !== "satisfied") continue;
      const criteria = item.acceptanceRefs
        .map((id) => acceptanceById.get(id))
        .filter((criterion) => Boolean(criterion));
      const acceptanceSatisfied =
        item.acceptanceRefs.length > 0 &&
        criteria.length === item.acceptanceRefs.length &&
        criteria.every(
          (criterion) =>
            criterion?.status === "passed" || criterion?.status === "waived",
        );
      const acceptanceEvidence = criteria.flatMap(
        (criterion) => criterion?.evidenceRefs ?? [],
      );
      if (acceptanceSatisfied) {
        const nextEvidenceRefs = unique([
          ...item.evidenceRefs,
          ...acceptanceEvidence,
        ]);
        if (
          item.status !== "satisfied" ||
          item.statusSource !== "acceptance" ||
          stableValue(item.evidenceRefs) !== stableValue(nextEvidenceRefs)
        ) {
          item.status = "satisfied";
          item.statusSource = "acceptance";
          item.evidenceRefs = nextEvidenceRefs;
          item.outcome = "Linked acceptance criteria are satisfied.";
          item.updatedAtStep = stepIndex;
          changedItemIds.add(item.id);
        }
      } else if (
        item.modelStatus === "completed" &&
        item.acceptanceRefs.length === 0 &&
        item.evidenceRefs.length > 0
      ) {
        item.status = "satisfied";
        item.statusSource = "receipt";
        item.outcome = "Model-reported completion is supported by tool receipts.";
        item.updatedAtStep = stepIndex;
        changedItemIds.add(item.id);
      }
    }

    this.applyFocus(undefined, stepIndex);
    for (const item of this.state.items) {
      const previous = beforeItems.get(item.id);
      if (!previous || stableValue(previous) !== stableValue(item)) {
        changedItemIds.add(item.id);
      }
    }
    if (stableValue(this.state) === before) {
      return {
        changed: false,
        changedItemIds: [],
        kind: "none",
        snapshot: this.snapshot(),
      };
    }
    this.state.projectionVersion += 1;
    return {
      changed: true,
      changedItemIds: [...changedItemIds],
      kind: "projection",
      snapshot: this.snapshot(),
    };
  }

  finalize(
    acceptance: AcceptanceSnapshot,
    {
      evidenceRefs = [],
      reason = "Run completion passed objective acceptance checks.",
      stepIndex,
    }: {
      evidenceRefs?: string[];
      reason?: string;
      stepIndex: number;
    },
  ): PlanChange {
    this.reconcile(acceptance, [], stepIndex);
    if (acceptance.gap.length > 0) {
      return {
        changed: false,
        changedItemIds: [],
        kind: "none",
        snapshot: this.snapshot(),
      };
    }

    const changedItemIds: string[] = [];
    const completionEvidence = unique([
      ...evidenceRefs,
      `completion:step-${stepIndex}`,
    ]);
    for (const item of this.state.items) {
      if (isTerminal(item.status)) continue;
      item.evidenceRefs = unique([...item.evidenceRefs, ...completionEvidence]);
      item.modelStatus = "completed";
      item.outcome = reason;
      item.status = "satisfied";
      item.statusSource = "finalization";
      item.updatedAtStep = stepIndex;
      changedItemIds.push(item.id);
    }
    if (changedItemIds.length === 0) {
      return {
        changed: false,
        changedItemIds: [],
        kind: "none",
        snapshot: this.snapshot(),
      };
    }
    this.state.focusItemId = undefined;
    this.state.projectionVersion += 1;
    return {
      changed: true,
      changedItemIds,
      kind: "finalization",
      snapshot: this.snapshot(),
    };
  }

  snapshot(): PlanSnapshot {
    return cloneSnapshot(this.state);
  }

  compactSnapshot(limit = 8): CompactPlanSnapshot {
    const active = this.state.items.filter(
      (item) => item.status === "active" || item.status === "blocked",
    );
    const pending = this.state.items.filter((item) => item.status === "pending");
    const recentTerminal = this.state.items
      .filter((item) => isTerminal(item.status))
      .slice(-3);
    const items = [...active, ...pending, ...recentTerminal]
      .filter(
        (item, index, all) =>
          all.findIndex((candidate) => candidate.id === item.id) === index,
      )
      .slice(0, Math.max(1, limit));
    return {
      ...(this.state.focusItemId
        ? { focusItemId: this.state.focusItemId }
        : {}),
      id: this.state.id,
      items: structuredClone(items),
      ...(this.state.revisions.at(-1)
        ? { lastRevision: structuredClone(this.state.revisions.at(-1)) }
        : {}),
      projectionVersion: this.state.projectionVersion,
      revision: this.state.revision,
    };
  }

  serialize(): SerializedPlanLedger {
    return {
      itemCounter: this.itemCounter,
      schemaVersion: 1,
      snapshot: this.snapshot(),
    };
  }

  restore(serialized: unknown) {
    if (!isRecord(serialized) || serialized.schemaVersion !== 1) {
      throw new Error("Unsupported plan ledger checkpoint schema.");
    }
    if (!isPlanSnapshot(serialized.snapshot)) {
      throw new Error("Invalid plan ledger checkpoint snapshot.");
    }
    this.itemCounter =
      typeof serialized.itemCounter === "number"
        ? Math.max(0, Math.floor(serialized.itemCounter))
        : serialized.snapshot.items.length;
    this.state = cloneSnapshot(serialized.snapshot);
  }

  static restore(serialized: unknown) {
    const ledger = new PlanLedger();
    ledger.restore(serialized);
    return ledger;
  }
}

export function createPlanLedger() {
  return new PlanLedger();
}
