import type { AgentMessage } from "../llm";
import {
  AcceptanceLedger,
  type DeliverableContract,
} from "../acceptance";
import {
  PlanAttemptLedger,
  type PlanAttemptLedgerSnapshot,
} from "../plan-attempt";
import {
  createPlanLedger,
  type PlanLedger,
  type SerializedPlanLedger,
} from "../plan";
import {
  ProgressTracker,
  type ProgressTrackerSnapshot,
} from "../progress";
import { ReceiptRegistry } from "../receipts/registry";
import type { ObservedState } from "../receipts/types";
import {
  applyTaskStatePatch,
  createInitialTaskState,
  type TaskState,
  type TaskStatePatch,
} from "../task-state";
import type {
  StablePrefixState,
  TaskContractView,
  WorkingSetView,
} from "../context/types";
import type { ChunkedFinalState } from "./chunked-final-controller";

export type AgentRunState = {
  acceptance: AcceptanceLedger;
  attempts: PlanAttemptLedger;
  chunkedFinal: ChunkedFinalState | null;
  completedSteps: number;
  contextSnapshotHash: string;
  conversation: AgentMessage[];
  deliverableContract: DeliverableContract;
  initialMessageCount: number;
  loadedSkills: Set<string>;
  maintenanceToolSuppressedUntilStep: number;
  planAuthority: "legacy" | "structured";
  planLedger: PlanLedger;
  progress: ProgressTracker;
  receiptRegistry: ReceiptRegistry;
  recoveryBinding?: {
    sessionId: string;
    workspaceRoot?: string;
  };
  stablePrefixState: StablePrefixState | null;
  taskContract: TaskContractView;
  taskState: TaskState;
};

export type AgentRunRecoverySnapshot = {
  acceptance: ReturnType<AcceptanceLedger["snapshot"]>;
  attempts: PlanAttemptLedgerSnapshot;
  chunkedFinal: ChunkedFinalState | null;
  completedSteps: number;
  contextSnapshotHash: string;
  conversation: AgentMessage[];
  deliverableContract: DeliverableContract;
  initialMessageCount: number;
  loadedSkills: string[];
  maintenanceToolSuppressedUntilStep: number;
  planAuthority?: "legacy" | "structured";
  observedState: ObservedState;
  plan: SerializedPlanLedger;
  progress: ProgressTrackerSnapshot;
  recoveryBinding?: {
    sessionId: string;
    workspaceRoot?: string;
  };
  schemaVersion: 2;
  stablePrefixState: StablePrefixState | null;
  taskContract: TaskContractView;
  taskState: TaskState;
};

function createTaskContract(
  prompt: string,
  contract: DeliverableContract,
): TaskContractView {
  return {
    authorizationBoundary: [
      "selected session workspace",
      "public web research through available tools",
      "no destructive, privileged, secret-touching, or external-impact action without required user authority",
    ],
    constraints: [],
    deliverable: contract.textOnly ? "用户可见的中文回答" : contract.type,
    goal: prompt.trim(),
    successCriteria: contract.criteria.map((criterion) => criterion.description),
  };
}

export function createAgentRunState({
  activeSkillNames,
  conversation,
  deliverableContract,
  latestUserPrompt,
  recoveryBinding,
}: {
  activeSkillNames: string[];
  conversation: AgentMessage[];
  deliverableContract: DeliverableContract;
  latestUserPrompt: string;
  recoveryBinding?: AgentRunState["recoveryBinding"];
}): AgentRunState {
  const taskContract = createTaskContract(
    latestUserPrompt,
    deliverableContract,
  );
  const taskState = applyTaskStatePatch(
    createInitialTaskState(latestUserPrompt),
    {
      deliverable: taskContract.deliverable,
      successCriteria: taskContract.successCriteria,
    },
  );

  return {
    acceptance: new AcceptanceLedger(deliverableContract),
    attempts: new PlanAttemptLedger(),
    chunkedFinal: null,
    completedSteps: 0,
    contextSnapshotHash: "",
    conversation,
    deliverableContract,
    initialMessageCount: conversation.length,
    loadedSkills: new Set(activeSkillNames),
    maintenanceToolSuppressedUntilStep: 0,
    planAuthority: "legacy",
    planLedger: createPlanLedger(),
    progress: new ProgressTracker(),
    receiptRegistry: new ReceiptRegistry(),
    ...(recoveryBinding
      ? { recoveryBinding: structuredClone(recoveryBinding) }
      : {}),
    stablePrefixState: null,
    taskContract,
    taskState,
  };
}

export function createAgentRunRecoverySnapshot(
  state: AgentRunState,
): AgentRunRecoverySnapshot {
  return structuredClone({
    acceptance: state.acceptance.snapshot(),
    attempts: state.attempts.snapshot(),
    chunkedFinal: state.chunkedFinal,
    completedSteps: state.completedSteps,
    contextSnapshotHash: state.contextSnapshotHash,
    conversation: state.conversation,
    deliverableContract: state.deliverableContract,
    initialMessageCount: state.initialMessageCount,
    loadedSkills: [...state.loadedSkills],
    maintenanceToolSuppressedUntilStep:
      state.maintenanceToolSuppressedUntilStep,
    planAuthority: state.planAuthority,
    observedState: state.receiptRegistry.snapshot(),
    plan: state.planLedger.serialize(),
    progress: state.progress.snapshot(),
    ...(state.recoveryBinding
      ? { recoveryBinding: state.recoveryBinding }
      : {}),
    schemaVersion: 2 as const,
    stablePrefixState: state.stablePrefixState,
    taskContract: state.taskContract,
    taskState: state.taskState,
  });
}

export function restoreAgentRunState(
  snapshot: AgentRunRecoverySnapshot,
): AgentRunState {
  if (snapshot.schemaVersion !== 2) {
    throw new Error("Unsupported Agent Run recovery snapshot schema.");
  }
  const state = createAgentRunState({
    activeSkillNames: snapshot.loadedSkills,
    conversation: structuredClone(snapshot.conversation),
    deliverableContract: structuredClone(snapshot.deliverableContract),
    latestUserPrompt: snapshot.taskContract.goal,
    recoveryBinding: snapshot.recoveryBinding,
  });
  state.acceptance.restore(snapshot.acceptance);
  state.attempts.restore(snapshot.attempts);
  state.chunkedFinal = structuredClone(snapshot.chunkedFinal);
  state.completedSteps = snapshot.completedSteps;
  state.contextSnapshotHash = snapshot.contextSnapshotHash;
  state.initialMessageCount = snapshot.initialMessageCount;
  state.loadedSkills = new Set(snapshot.loadedSkills);
  state.maintenanceToolSuppressedUntilStep =
    snapshot.maintenanceToolSuppressedUntilStep;
  state.planAuthority = snapshot.planAuthority ?? "legacy";
  state.planLedger.restore(snapshot.plan);
  state.progress.restore(snapshot.progress);
  state.receiptRegistry.restore(snapshot.observedState);
  state.recoveryBinding = structuredClone(snapshot.recoveryBinding);
  state.stablePrefixState = structuredClone(snapshot.stablePrefixState);
  state.taskContract = structuredClone(snapshot.taskContract);
  state.taskState = structuredClone(snapshot.taskState);
  return state;
}

export function applyRunTaskPatch(
  state: AgentRunState,
  patch: TaskStatePatch,
) {
  state.taskState = applyTaskStatePatch(state.taskState, patch);
  return state.taskState;
}

export function syncLegacyPlanProjection(state: AgentRunState) {
  const plan = state.planLedger
    .snapshot()
    .items.filter((item) => item.status !== "superseded")
    .map((item) => item.title);
  return applyRunTaskPatch(state, { plan });
}

export function reconcileDeliverableContract(
  state: AgentRunState,
  contract: DeliverableContract,
) {
  if (JSON.stringify(state.deliverableContract) === JSON.stringify(contract)) {
    return false;
  }
  state.deliverableContract = contract;
  state.acceptance = new AcceptanceLedger(contract);
  state.acceptance.reconcile(state.receiptRegistry.snapshot());
  state.taskContract.deliverable = contract.textOnly
    ? "用户可见的中文回答"
    : contract.type;
  state.taskContract.successCriteria = contract.criteria.map(
    (criterion) => criterion.description,
  );
  applyRunTaskPatch(state, {
    deliverable: state.taskContract.deliverable,
    successCriteria: state.taskContract.successCriteria,
    verificationStatus: contract.verificationRequired
      ? "pending"
      : "not_needed",
  });
  return true;
}

export function reconcileTaskStateFromObserved(
  state: AgentRunState,
  observed: ObservedState,
) {
  const latestVerificationByScope = new Map(
    observed.verification.map((verification) => [
      verification.scope,
      verification,
    ]),
  );
  const currentVerification = [...latestVerificationByScope.values()];
  const passedVerification = currentVerification.filter(
    (verification) => verification.passed,
  );
  const failedVerification = currentVerification.filter(
    (verification) => !verification.passed,
  );
  const patch: TaskStatePatch = {
    commandsRun: observed.commands.map((command) => command.command),
    filesTouched: Object.values(observed.files)
      .filter((file) => !file.deleted)
      .map((file) => file.path),
    verificationEvidence: observed.verification.flatMap(
      (verification) => verification.details,
    ),
    verificationStatus:
      failedVerification.length > 0
        ? "failed"
        : passedVerification.length > 0
          ? "passed"
          : state.deliverableContract.verificationRequired
            ? "pending"
            : "not_needed",
  };
  return applyRunTaskPatch(state, patch);
}

export function buildWorkingSet(state: AgentRunState): WorkingSetView {
  const observed = state.receiptRegistry.snapshot();
  const acceptance = state.acceptance.snapshot();
  const activeAttempt = state.attempts.active();
  const attemptSnapshot = state.attempts.snapshot();
  const evidence = Object.values(observed.evidence);
  const evidenceSummaries = [...new Set(evidence.map((item) => item.summary))];

  return {
    acceptanceGap: acceptance.gap,
    activeAssumptions: attemptSnapshot.assumptions
      .filter(
        (assumption) =>
          assumption.status === "active" || assumption.status === "validated",
      )
      .map((assumption) => assumption.statement),
    ...(activeAttempt
      ? {
          activeAttempt: {
            approach: activeAttempt.approach,
            id: activeAttempt.id,
            status: activeAttempt.status,
          },
        }
      : {}),
    agentNote: {
      currentIntent: state.taskState.currentMode,
      nextAction: state.taskState.nextAction,
      openQuestions: state.taskState.openQuestions,
    },
    artifactSummary: Object.values(observed.artifacts).map(
      (artifact) =>
        `${artifact.kind}:${artifact.status}${artifact.path ? ` @ ${artifact.path}` : ""}${typeof artifact.count === "number" ? ` (${artifact.count})` : ""}`,
    ),
    observedFacts: [
      ...evidenceSummaries.slice(-12),
      ...observed.commands
        .slice(-6)
        .map(
          (command) =>
            `${command.command} -> exit ${command.exitCode ?? "unknown"}${command.timedOut ? " (timeout)" : ""}`,
        ),
    ],
    plan: state.planLedger.compactSnapshot(),
    ...(!state.deliverableContract.textOnly && evidence.length > 0
      ? {
          researchHandoff: {
            artifactPlan: acceptance.gap,
            claimIds: [...new Set(evidence.slice(-20).map((item) => item.key))],
            findings: evidenceSummaries.slice(-12),
            openGaps: acceptance.gap,
            sourceIds: [
              ...new Set(
                evidence.slice(-20).map((item) => item.source || item.key),
              ),
            ],
            thesis:
              "基于已记录证据形成交付物；保留来源对应关系，并用当前验收缺口指导制作和验证。",
            weakEvidence: state.taskState.openQuestions,
          },
        }
      : {}),
    rejectedAssumptionCount: attemptSnapshot.assumptions.filter(
      (assumption) => assumption.status === "rejected",
    ).length,
    unresolvedErrors: observed.unresolvedErrors
      .filter((error) => !error.resolved)
      .map((error) => `${error.toolName}: ${error.message}`),
  };
}
