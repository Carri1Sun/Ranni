export const ACTION_MODES = [
  "intake",
  "recon",
  "plan",
  "edit",
  "shell",
  "verify",
  "debug",
  "review",
  "research",
  "synthesis",
] as const;

export const VERIFICATION_STATUSES = [
  "not_needed",
  "pending",
  "passed",
  "failed",
  "skipped",
] as const;

export type ActionMode = (typeof ACTION_MODES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type TaskMemoryStatus = {
  initialized: boolean;
  latestCheckpointPath: string | null;
  relativeRunDirectory: string;
  runDirectory: string;
  summary: string;
  todo: {
    blocked: number;
    doing: number;
    done: number;
    pending: number;
    skipped: number;
    total: number;
  };
  updatedAt: number;
};

export type TaskState = {
  assumptions: string[];
  commandsRun: string[];
  constraints: string[];
  currentMode: ActionMode;
  deliverable: string;
  facts: string[];
  filesTouched: string[];
  goal: string;
  memory?: TaskMemoryStatus;
  nextAction: string;
  openQuestions: string[];
  plan: string[];
  successCriteria: string[];
  verification: {
    evidence: string[];
    status: VerificationStatus;
  };
};

export type TaskStatePatch = {
  assumptions?: string[];
  commandsRun?: string[];
  constraints?: string[];
  currentMode?: ActionMode;
  deliverable?: string;
  facts?: string[];
  filesTouched?: string[];
  goal?: string;
  memory?: TaskMemoryStatus;
  nextAction?: string;
  openQuestions?: string[];
  plan?: string[];
  successCriteria?: string[];
  verificationEvidence?: string[];
  verificationStatus?: VerificationStatus;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactList(values: string[], limit = 24) {
  const seen = new Set<string>();
  const compacted: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    compacted.push(normalized);
  }

  return compacted.slice(-limit);
}

function mergeList(current: string[], next?: string[], limit?: number) {
  return compactList([...current, ...(next ?? [])], limit);
}

function cleanScalar(value: string | undefined) {
  return typeof value === "string" ? value.trim() : undefined;
}

export function createInitialTaskState(latestUserPrompt: string): TaskState {
  const goal = latestUserPrompt.trim();

  return {
    assumptions: [],
    commandsRun: [],
    constraints: [],
    currentMode: "intake",
    deliverable: "",
    facts: [],
    filesTouched: [],
    goal,
    memory: undefined,
    nextAction: "建立任务契约并选择下一步行动。",
    openQuestions: [],
    plan: [],
    successCriteria: [],
    verification: {
      evidence: [],
      status: "pending",
    },
  };
}

export function applyTaskStatePatch(
  current: TaskState,
  patch: TaskStatePatch,
): TaskState {
  return {
    assumptions: mergeList(current.assumptions, patch.assumptions),
    commandsRun: mergeList(current.commandsRun, patch.commandsRun, 40),
    constraints: mergeList(current.constraints, patch.constraints),
    currentMode: patch.currentMode ?? current.currentMode,
    deliverable: cleanScalar(patch.deliverable) ?? current.deliverable,
    facts: mergeList(current.facts, patch.facts, 40),
    filesTouched: mergeList(current.filesTouched, patch.filesTouched, 80),
    goal: cleanScalar(patch.goal) ?? current.goal,
    memory: patch.memory ?? current.memory,
    nextAction: cleanScalar(patch.nextAction) ?? current.nextAction,
    openQuestions: mergeList(current.openQuestions, patch.openQuestions),
    plan: patch.plan ? compactList(patch.plan, 12) : current.plan,
    successCriteria: patch.successCriteria
      ? compactList(patch.successCriteria)
      : current.successCriteria,
    verification: {
      evidence: mergeList(
        current.verification.evidence,
        patch.verificationEvidence,
        40,
      ),
      status: patch.verificationStatus ?? current.verification.status,
    },
  };
}

export function summarizeTaskState(taskState: TaskState) {
  return [
    `Mode: ${taskState.currentMode}`,
    `Goal: ${taskState.goal || "(unset)"}`,
    taskState.deliverable ? `Deliverable: ${taskState.deliverable}` : "",
    taskState.successCriteria.length > 0
      ? `Success criteria:\n${taskState.successCriteria.map((item) => `- ${item}`).join("\n")}`
      : "",
    taskState.plan.length > 0
      ? `Plan:\n${taskState.plan.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "",
    taskState.facts.length > 0
      ? `Facts discovered:\n${taskState.facts.map((item) => `- ${item}`).join("\n")}`
      : "",
    taskState.filesTouched.length > 0
      ? `Files touched:\n${taskState.filesTouched.map((item) => `- ${item}`).join("\n")}`
      : "",
    taskState.memory
      ? [
          "Task memory:",
          `- Directory: ${taskState.memory.relativeRunDirectory}`,
          `- Initialized: ${taskState.memory.initialized ? "yes" : "no"}`,
          `- Todo: ${taskState.memory.todo.done}/${taskState.memory.todo.total} done, ${taskState.memory.todo.blocked} blocked`,
          taskState.memory.latestCheckpointPath
            ? `- Latest checkpoint: ${taskState.memory.latestCheckpointPath}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    taskState.commandsRun.length > 0
      ? `Commands run:\n${taskState.commandsRun.map((item) => `- ${item}`).join("\n")}`
      : "",
    `Verification: ${taskState.verification.status}`,
    taskState.verification.evidence.length > 0
      ? `Verification evidence:\n${taskState.verification.evidence.map((item) => `- ${item}`).join("\n")}`
      : "",
    taskState.openQuestions.length > 0
      ? `Open questions:\n${taskState.openQuestions.map((item) => `- ${item}`).join("\n")}`
      : "",
    `Next action: ${taskState.nextAction || "(unset)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
