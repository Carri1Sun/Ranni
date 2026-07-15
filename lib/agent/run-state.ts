import type { AgentMessage } from "../llm";
import {
  AcceptanceLedger,
  type DeliverableContract,
} from "../acceptance";
import { PlanAttemptLedger } from "../plan-attempt";
import { ProgressTracker } from "../progress";
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
  progress: ProgressTracker;
  receiptRegistry: ReceiptRegistry;
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
}: {
  activeSkillNames: string[];
  conversation: AgentMessage[];
  deliverableContract: DeliverableContract;
  latestUserPrompt: string;
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
    progress: new ProgressTracker(),
    receiptRegistry: new ReceiptRegistry(),
    stablePrefixState: null,
    taskContract,
    taskState,
  };
}

export function applyRunTaskPatch(
  state: AgentRunState,
  patch: TaskStatePatch,
) {
  state.taskState = applyTaskStatePatch(state.taskState, patch);
  return state.taskState;
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
