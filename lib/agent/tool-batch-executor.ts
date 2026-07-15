import type {
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "../llm";
import {
  createToolReceipt,
  ReceiptRegistry,
  stableReceiptHash,
  type ReceiptProjector,
} from "../receipts/registry";
import type { ToolReceipt } from "../receipts/types";
import { executeTool, type ToolExecutionContext } from "../tools";

export type ToolExecutionStarted = {
  index: number;
  startedAt: number;
  toolCall: AgentToolUseBlock;
};

export type ToolExecutionCompleted = ToolExecutionStarted & {
  endedAt: number;
  receipt: ToolReceipt;
  toolResult: AgentToolResultBlock;
};

export type ToolBatchExecutorOptions = {
  advertisedToolNames: ReadonlySet<string>;
  currentToolNames: ReadonlySet<string>;
  executionContext: ToolExecutionContext;
  onCompleted?: (
    event: ToolExecutionCompleted,
  ) => Promise<void> | void;
  onStarted?: (event: ToolExecutionStarted) => Promise<void> | void;
  projectors?: ReceiptProjector[];
  registry: ReceiptRegistry;
  signal?: AbortSignal;
  stopReason?: string | null;
  toolCalls: AgentToolUseBlock[];
};

export type ToolBatchExecutionResult = {
  receipts: ToolReceipt[];
  toolResults: AgentToolResultBlock[];
};

type ValidationIssue = {
  code:
    | "DUPLICATE_TOOL_USE_ID"
    | "TOOL_INPUT_INCOMPLETE"
    | "TOOL_INPUT_INVALID"
    | "TOOL_NOT_ADVERTISED"
    | "TOOL_NOT_CURRENT";
  message: string;
};

function createAbortError() {
  const error = new Error("Agent run was cancelled.");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function collectValidationIssues({
  advertisedToolNames,
  currentToolNames,
  stopReason,
  toolCalls,
}: Pick<
  ToolBatchExecutorOptions,
  "advertisedToolNames" | "currentToolNames" | "stopReason" | "toolCalls"
>) {
  const idCounts = new Map<string, number>();
  const issues = new Map<AgentToolUseBlock, ValidationIssue[]>();

  for (const toolCall of toolCalls) {
    idCounts.set(toolCall.id, (idCounts.get(toolCall.id) ?? 0) + 1);
  }

  for (const toolCall of toolCalls) {
    const callIssues: ValidationIssue[] = [];

    if ((idCounts.get(toolCall.id) ?? 0) > 1) {
      callIssues.push({
        code: "DUPLICATE_TOOL_USE_ID",
        message: `toolUseId ${JSON.stringify(toolCall.id)} appears more than once in this batch.`,
      });
    }
    if (!advertisedToolNames.has(toolCall.name)) {
      callIssues.push({
        code: "TOOL_NOT_ADVERTISED",
        message: `Tool ${toolCall.name} was not advertised in the model request.`,
      });
    }
    if (!currentToolNames.has(toolCall.name)) {
      callIssues.push({
        code: "TOOL_NOT_CURRENT",
        message: `Tool ${toolCall.name} is unavailable under the current tool policy.`,
      });
    }
    if (!toolCall.inputComplete) {
      callIssues.push({
        code: "TOOL_INPUT_INCOMPLETE",
        message: `The provider stream ended before the tool input completed${stopReason ? ` (stop reason: ${stopReason})` : ""}.`,
      });
    }
    if (toolCall.inputParseError) {
      callIssues.push({
        code: "TOOL_INPUT_INVALID",
        message: `Tool input is not valid JSON: ${toolCall.inputParseError}`,
      });
    }

    issues.set(toolCall, callIssues);
  }

  return issues;
}

function renderValidationFailure(
  toolCall: AgentToolUseBlock,
  issues: ValidationIssue[],
) {
  return [
    "Tool call was not executed.",
    `Tool: ${toolCall.name}`,
    "Validation issues:",
    ...issues.map((issue) => `- ${issue.code}: ${issue.message}`),
    "Observed status: no tool side effect was attempted.",
  ].join("\n");
}

function renderExecutionFailure(toolCall: AgentToolUseBlock, error: unknown) {
  return [
    "Tool execution failed.",
    `Tool: ${toolCall.name}`,
    `Reason: ${error instanceof Error ? error.message : String(error)}`,
    "Observed status: this call did not complete successfully.",
  ].join("\n");
}

function toToolResult(receipt: ToolReceipt): AgentToolResultBlock {
  return {
    content: receipt.result,
    ...(!receipt.success ? { is_error: true } : {}),
    tool_use_id: receipt.toolUseId,
    type: "tool_result",
  };
}

export async function executeToolBatch({
  advertisedToolNames,
  currentToolNames,
  executionContext,
  onCompleted,
  onStarted,
  projectors = [],
  registry,
  signal,
  stopReason,
  toolCalls,
}: ToolBatchExecutorOptions): Promise<ToolBatchExecutionResult> {
  const executionSignal = signal ?? executionContext.signal;
  const validationIssues = collectValidationIssues({
    advertisedToolNames,
    currentToolNames,
    stopReason,
    toolCalls,
  });
  const receipts: ToolReceipt[] = [];
  const toolResults: AgentToolResultBlock[] = [];

  for (const [index, toolCall] of toolCalls.entries()) {
    assertNotAborted(executionSignal);

    const startedAt = Date.now();
    const startedEvent: ToolExecutionStarted = {
      index,
      startedAt,
      toolCall,
    };
    await onStarted?.(startedEvent);
    assertNotAborted(executionSignal);

    const issues = validationIssues.get(toolCall) ?? [];
    const inputHash = stableReceiptHash(toolCall.rawInput ?? toolCall.input);
    let receipt: ToolReceipt;

    if (issues.length > 0) {
      const endedAt = Date.now();
      receipt = registry.record(
        createToolReceipt({
          endedAt,
          projectors,
          result: renderValidationFailure(toolCall, issues),
          startedAt,
          success: false,
          toolCall,
        }),
      );
    } else {
      const completed = registry.findCompleted(toolCall.id, inputHash);

      if (completed) {
        receipt = { ...completed, reused: true };
      } else {
        let result: string;
        let transportSuccess = true;

        try {
          result = await executeTool(
            toolCall.name,
            JSON.stringify(toolCall.input ?? {}),
            {
              ...executionContext,
              signal: executionSignal,
            },
          );
        } catch (error) {
          if (isAbortError(error, executionSignal)) {
            throw error;
          }

          transportSuccess = false;
          result = renderExecutionFailure(toolCall, error);
        }

        receipt = registry.record(
          createToolReceipt({
            endedAt: Date.now(),
            projectors,
            result,
            startedAt,
            success: transportSuccess,
            toolCall,
          }),
        );
      }
    }

    const toolResult = toToolResult(receipt);
    receipts.push(receipt);
    toolResults.push(toolResult);
    await onCompleted?.({
      ...startedEvent,
      endedAt: receipt.endedAt,
      receipt,
      toolResult,
    });
    assertNotAborted(executionSignal);
  }

  return { receipts, toolResults };
}
