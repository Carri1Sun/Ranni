import type { DeliverableContract } from "../acceptance";
import type { AgentToolDefinition } from "../llm";
import type { ReceiptProjector } from "../receipts/registry";
import type { ToolReceipt } from "../receipts/types";

export type PolicyObservation = {
  statusMessages: string[];
};

export type RunPolicySet = {
  deliverableContract: DeliverableContract;
  getDeliverableContract(activeSkillNames: string[]): DeliverableContract;
  getInstructions(activeSkillNames: string[]): string[];
  getReceiptProjectors(activeSkillNames: string[]): ReceiptProjector[];
  getToolDefinitions(activeSkillNames: string[]): AgentToolDefinition[];
  observeReceipts(receipts: ToolReceipt[]): PolicyObservation;
  snapshot(): Array<{
    id: string;
    state: Record<string, unknown>;
  }>;
};
