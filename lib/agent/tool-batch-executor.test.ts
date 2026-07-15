import assert from "node:assert/strict";
import test from "node:test";

import type { AgentToolUseBlock } from "../llm";
import { ReceiptRegistry } from "../receipts/registry";
import {
  applyTaskStatePatch,
  createInitialTaskState,
  type TaskStatePatch,
} from "../task-state";
import type { ToolExecutionContext } from "../tools";
import { executeToolBatch } from "./tool-batch-executor";

function call({
  id,
  input = {},
  inputComplete = true,
  inputParseError,
  name = "update_task_state",
}: {
  id: string;
  input?: Record<string, unknown>;
  inputComplete?: boolean;
  inputParseError?: string;
  name?: string;
}): AgentToolUseBlock {
  return {
    id,
    input,
    inputComplete,
    ...(inputParseError ? { inputParseError } : {}),
    name,
    type: "tool_use",
  };
}

function createTaskContext(onUpdate?: () => void) {
  let taskState = createInitialTaskState("test goal");
  const context: ToolExecutionContext = {
    get taskState() {
      return taskState;
    },
    updateTaskState(patch: TaskStatePatch) {
      onUpdate?.();
      taskState = applyTaskStatePatch(taskState, patch);
      return taskState;
    },
  };

  return {
    context,
    getTaskState: () => taskState,
  };
}

test("validates the whole batch and pairs every blocked or successful call", async () => {
  const { context, getTaskState } = createTaskContext();
  const registry = new ReceiptRegistry();
  const toolCalls = [
    call({ id: "duplicate", input: { mode: "recon" } }),
    call({ id: "duplicate", input: { mode: "plan" } }),
    call({ id: "unadvertised", name: "read_file", input: { path: "README.md" } }),
    call({ id: "incomplete", inputComplete: false }),
    call({ id: "invalid", inputParseError: "unexpected end" }),
    call({ id: "valid", input: { next_action: "inspect workspace" } }),
  ];
  const callbackOrder: string[] = [];
  let projectedSuccesses = 0;

  const result = await executeToolBatch({
    advertisedToolNames: new Set(["update_task_state"]),
    currentToolNames: new Set(["update_task_state", "read_file"]),
    executionContext: context,
    onCompleted: ({ toolCall }) => {
      callbackOrder.push(`completed:${toolCall.id}`);
    },
    onStarted: ({ toolCall }) => {
      callbackOrder.push(`started:${toolCall.id}`);
    },
    projectors: [({ success }) => {
      if (success) projectedSuccesses += 1;
      return null;
    }],
    registry,
    stopReason: "max_tokens",
    toolCalls,
  });

  assert.equal(result.toolResults.length, toolCalls.length);
  assert.equal(result.receipts.length, toolCalls.length);
  assert.deepEqual(
    result.toolResults.map((toolResult) => toolResult.tool_use_id),
    toolCalls.map((toolCall) => toolCall.id),
  );
  assert.equal(result.receipts.filter((receipt) => receipt.success).length, 1);
  assert.equal(projectedSuccesses, 1);
  assert.equal(getTaskState().nextAction, "inspect workspace");
  assert.match(result.toolResults[0]?.content ?? "", /DUPLICATE_TOOL_USE_ID/);
  assert.match(result.toolResults[2]?.content ?? "", /TOOL_NOT_ADVERTISED/);
  assert.match(result.toolResults[3]?.content ?? "", /TOOL_INPUT_INCOMPLETE/);
  assert.match(result.toolResults[3]?.content ?? "", /max_tokens/);
  assert.match(result.toolResults[4]?.content ?? "", /TOOL_INPUT_INVALID/);
  assert.equal(result.toolResults[5]?.is_error, undefined);
  assert.deepEqual(callbackOrder, toolCalls.flatMap((toolCall) => [
    `started:${toolCall.id}`,
    `completed:${toolCall.id}`,
  ]));
});

test("executes valid calls sequentially", async () => {
  const { context, getTaskState } = createTaskContext();
  const events: string[] = [];

  const result = await executeToolBatch({
    advertisedToolNames: new Set(["update_task_state"]),
    currentToolNames: new Set(["update_task_state"]),
    executionContext: context,
    onCompleted: ({ toolCall }) => {
      events.push(`complete:${toolCall.id}`);
    },
    onStarted: ({ toolCall }) => {
      events.push(`start:${toolCall.id}`);
    },
    registry: new ReceiptRegistry(),
    toolCalls: [
      call({ id: "first", input: { assumptions: ["inspect first"] } }),
      call({ id: "second", input: { next_action: "act second" } }),
    ],
  });

  assert.deepEqual(events, [
    "start:first",
    "complete:first",
    "start:second",
    "complete:second",
  ]);
  assert.deepEqual(getTaskState().assumptions, ["inspect first"]);
  assert.equal(getTaskState().nextAction, "act second");
  assert.ok(result.receipts.every((receipt) => receipt.success));
});

test("marks a non-zero terminal receipt and tool result as failed", async () => {
  const registry = new ReceiptRegistry();
  const result = await executeToolBatch({
    advertisedToolNames: new Set(["run_terminal"]),
    currentToolNames: new Set(["run_terminal"]),
    executionContext: {},
    registry,
    toolCalls: [
      call({
        id: "terminal",
        input: { command: "exit 7", cwd: ".", timeout_ms: 5_000 },
        name: "run_terminal",
      }),
    ],
  });

  assert.equal(result.receipts[0]?.success, false);
  assert.equal(result.receipts[0]?.domainStatus, "failed");
  assert.equal(result.receipts[0]?.projection.commands?.[0]?.exitCode, 7);
  assert.equal(result.toolResults[0]?.is_error, true);
  assert.equal(registry.snapshot().commands[0]?.exitCode, 7);
});

test("reuses a completed toolUseId and input hash without another side effect", async () => {
  let updateCount = 0;
  const { context } = createTaskContext(() => {
    updateCount += 1;
  });
  const registry = new ReceiptRegistry();
  const toolCall = call({
    id: "stable-call",
    input: { next_action: "inspect once" },
  });
  const options = {
    advertisedToolNames: new Set(["update_task_state"]),
    currentToolNames: new Set(["update_task_state"]),
    executionContext: context,
    registry,
    toolCalls: [toolCall],
  };

  const first = await executeToolBatch(options);
  const repeated = await executeToolBatch(options);

  assert.equal(updateCount, 1);
  assert.equal(first.receipts[0]?.reused, false);
  assert.equal(repeated.receipts[0]?.reused, true);
  assert.equal(repeated.toolResults[0]?.content, first.toolResults[0]?.content);
  assert.equal(registry.snapshot().receipts.length, 1);
});

test("stops immediately when aborted between sequential calls", async () => {
  const controller = new AbortController();
  let updateCount = 0;
  const { context } = createTaskContext(() => {
    updateCount += 1;
  });
  const registry = new ReceiptRegistry();

  await assert.rejects(
    executeToolBatch({
      advertisedToolNames: new Set(["update_task_state"]),
      currentToolNames: new Set(["update_task_state"]),
      executionContext: context,
      onCompleted: () => controller.abort(),
      registry,
      signal: controller.signal,
      toolCalls: [
        call({ id: "first", input: { next_action: "first" } }),
        call({ id: "second", input: { next_action: "second" } }),
      ],
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );

  assert.equal(updateCount, 1);
  assert.equal(registry.snapshot().receipts.length, 1);
});

test("records a completed side effect before observing a concurrent abort", async () => {
  const controller = new AbortController();
  let updateCount = 0;
  const { context } = createTaskContext(() => {
    updateCount += 1;
    controller.abort();
  });
  const registry = new ReceiptRegistry();
  let completedCount = 0;

  await assert.rejects(
    executeToolBatch({
      advertisedToolNames: new Set(["update_task_state"]),
      currentToolNames: new Set(["update_task_state"]),
      executionContext: context,
      onCompleted: () => {
        completedCount += 1;
      },
      registry,
      signal: controller.signal,
      toolCalls: [
        call({ id: "completed-before-abort", input: { next_action: "done" } }),
      ],
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );

  assert.equal(updateCount, 1);
  assert.equal(completedCount, 1);
  assert.equal(registry.snapshot().receipts.length, 1);
  assert.equal(registry.snapshot().receipts[0]?.success, true);
});

test("turns execution errors into paired failed receipts", async () => {
  const registry = new ReceiptRegistry();
  const result = await executeToolBatch({
    advertisedToolNames: new Set(["missing_tool"]),
    currentToolNames: new Set(["missing_tool"]),
    executionContext: {},
    registry,
    toolCalls: [call({ id: "missing", name: "missing_tool" })],
  });

  assert.equal(result.receipts[0]?.success, false);
  assert.equal(result.toolResults[0]?.is_error, true);
  assert.match(result.toolResults[0]?.content ?? "", /未知工具：missing_tool/);
  assert.equal(registry.snapshot().receipts.length, 1);
});
