import type { EventBus } from "../events/event-bus";
import type { ModelConnectionConfig } from "../llm";
import type { ToolSettings } from "../tools";
import type { AgentRunRecoverySnapshot } from "./run-state";

export type PlainMessage = {
  content: string;
  role: "assistant" | "user";
};

export type RunAgentTurnOptions = {
  drainSteer?: (runId: string) => PlainMessage[];
  eventBus: EventBus;
  messages: PlainMessage[];
  modelConfig?: ModelConnectionConfig;
  /**
   * Resume an interrupted run from its serialized harness state. When set,
   * `messages` contains only new steering received after the checkpoint.
   */
  recoveryState?: AgentRunRecoverySnapshot;
  runId: string;
  sessionId: string;
  signal?: AbortSignal;
  streamKey: string;
  toolSettings?: ToolSettings;
  workspaceRoot?: string;
};

export type RunAgentTurnResult = {
  checkpoint?: {
    acceptanceGap: string[];
    contextSnapshotHash: string;
    runState?: AgentRunRecoverySnapshot;
    workspaceRoot?: string;
  };
  error?: string;
  finalMessage?: string;
  recoverable?: boolean;
  status: "cancelled" | "completed" | "failed";
  totalSteps: number;
};

export type StepOutcome =
  | {
      kind: "tool_batch";
      stopReason?: string | null;
    }
  | {
      kind: "guard_retry";
      reason: string;
      stopReason: string;
    }
  | {
      completionEvidence: string[];
      kind: "final";
      message: string;
      stopReason?: string | null;
    }
  | {
      checkpoint: NonNullable<RunAgentTurnResult["checkpoint"]>;
      error: string;
      kind: "recover";
    }
  | {
      error: string;
      kind: "failed";
    };
