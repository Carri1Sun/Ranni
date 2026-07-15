import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgentTurn } from "../agent";
import { EventBus, type PublishedEvent } from "../events/event-bus";

type AgentRequest = {
  input?: Array<Record<string, unknown>>;
  tools?: Array<{ name?: string }>;
};

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function withProvider(
  handler: (
    request: AgentRequest,
    index: number,
  ) => string,
  run: (baseUrl: string, requests: AgentRequest[]) => Promise<void>,
) {
  const requests: AgentRequest[] = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/api/agent") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AgentRequest;
    requests.push(payload);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(handler(payload, requests.length - 1));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("run controller preserves an eight-call causal batch in the next exact request", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ranni-run-controller-"));

  try {
    await withProvider(
      (_request, index) => {
        if (index === 0) {
          return [
            ...Array.from({ length: 8 }, (_, callIndex) =>
              sse("tool_call", {
                arguments: JSON.stringify({
                  next_action: `inspect-${callIndex}`,
                }),
                id: `call-${callIndex}`,
                name: "update_task_state",
              }),
            ),
            sse("done", {
              id: "response-1",
              model: "test-model",
              status: "completed",
            }),
          ].join("");
        }
        return [
          sse("content", { delta: "任务完成。" }),
          sse("done", {
            id: "response-2",
            model: "test-model",
            status: "completed",
          }),
        ].join("");
      },
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "整理当前行动并给出回答" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "run",
          sessionId: "session",
          streamKey: "session",
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "completed");
        assert.equal(requests.length, 2);
        const secondInput = requests[1]?.input ?? [];
        const functionCalls = secondInput.filter(
          (item) => item.type === "function_call",
        );
        const functionOutputs = secondInput.filter(
          (item) => item.type === "function_call_output",
        );
        assert.equal(functionCalls.length, 8);
        assert.equal(functionOutputs.length, 8);
        assert.deepEqual(
          functionCalls.map((item) => item.call_id),
          functionOutputs.map((item) => item.call_id),
        );

        const snapshots = events.filter(
          (event) => event.type === "context.snapshot",
        );
        const secondSnapshot = snapshots[1] as
          | { context?: { composition?: { previousTurnToolPairs?: unknown } } }
          | undefined;
        assert.deepEqual(
          secondSnapshot?.context?.composition?.previousTurnToolPairs,
          { expected: 8, preserved: 8 },
        );
        const progress = events.find(
          (event) => event.type === "progress.receipt",
        ) as { progressReceipt?: { objectiveProgress?: boolean } } | undefined;
        assert.equal(progress?.progressReceipt?.objectiveProgress, false);
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("structured plan persists across steps without creating an attempt per revision", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-plan-ledger-"),
  );

  try {
    await withProvider(
      (_request, index) =>
        index === 0
          ? [
              sse("tool_call", {
                arguments: JSON.stringify({
                  approach: "inspect the workspace and produce the answer",
                  exit_criteria: ["answer is ready"],
                  reason: "the task requires a concrete workspace route",
                }),
                id: "attempt-1",
                name: "replace_attempt",
              }),
              sse("tool_call", {
                arguments: JSON.stringify({
                  items: [
                    {
                      expected_outcome: "workspace facts are understood",
                      status: "in_progress",
                      title: "inspect workspace",
                    },
                    { title: "deliver answer" },
                  ],
                  reason: "establish the initial work coverage",
                  reason_kind: "initial",
                }),
                id: "plan-1",
                name: "update_plan",
              }),
              sse("tool_call", {
                arguments: JSON.stringify({
                  mode: "plan",
                  next_action: "inspect workspace",
                  plan: ["legacy plan must not replace structured items"],
                }),
                id: "state-1",
                name: "update_task_state",
              }),
              sse("done", {
                id: "response-plan",
                model: "test-model",
                status: "completed",
              }),
            ].join("")
          : [
              sse("content", { delta: "已完成现场整理。" }),
              sse("done", {
                id: "response-final",
                model: "test-model",
                status: "completed",
              }),
            ].join(""),
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("plan-session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "整理当前工作区并给出回答" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "plan-run",
          sessionId: "plan-session",
          streamKey: "plan-session",
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "completed");
        assert.equal(requests.length, 2);
        assert.match(
          JSON.stringify(requests[1]?.input),
          /inspect workspace/,
        );
        assert.match(
          JSON.stringify(requests[1]?.input),
          /inspect the workspace and produce the answer/,
        );
        const createdAttempts = events.filter(
          (event) =>
            event.type === "attempt.updated" &&
            Boolean(
              (event as { attemptDelta?: { created?: string } }).attemptDelta
                ?.created,
            ),
        );
        assert.equal(createdAttempts.length, 1);
        assert.ok(events.some((event) => event.type === "plan.updated"));
        const planRevisions = events.filter(
          (event) =>
            event.type === "plan.updated" &&
            (event as { planChange?: { kind?: string } }).planChange?.kind ===
              "revision",
        );
        assert.equal(planRevisions.length, 1);
        const finalPlan = events.findLast(
          (event) => event.type === "plan.updated",
        ) as
          | {
              planChange?: {
                snapshot?: { items?: Array<{ status?: string }> };
              };
            }
          | undefined;
        assert.ok(
          finalPlan?.planChange?.snapshot?.items?.every(
            (item) => item.status === "satisfied",
          ),
        );
        const runDirectory = path.join(
          workspace,
          ".ranni",
          "runs",
          "plan-run",
        );
        assert.match(
          await fs.readFile(path.join(runDirectory, "todo.md"), "utf8"),
          /\| P01 \| inspect workspace \| done \|/,
        );
        assert.ok(
          JSON.parse(
            await fs.readFile(path.join(runDirectory, "plan.json"), "utf8"),
          ),
        );
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("recovery resumes causal state and reuses a completed tool call", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-recovery-resume-"),
  );

  try {
    await withProvider(
      (_request, index) => {
        if (index === 0 || index === 4) {
          return [
            sse("tool_call", {
              arguments: JSON.stringify({
                command: "printf x >> recovery-counter.txt",
              }),
              id: "durable-command-1",
              name: "run_terminal",
            }),
            sse("done", {
              id: `tool-response-${index}`,
              model: "test-model",
              status: "completed",
            }),
          ].join("");
        }
        if (index >= 1 && index <= 3) {
          return sse("error", {
            message: "fetch failed: transient provider outage",
          });
        }
        return [
          sse("content", { delta: "恢复后的任务已完成。" }),
          sse("done", {
            id: "recovered-final",
            model: "test-model",
            status: "completed",
          }),
        ].join("");
      },
      async (baseUrl, requests) => {
        const firstBus = new EventBus();
        const firstResult = await runAgentTurn({
          eventBus: firstBus,
          messages: [{ role: "user", content: "检查本地环境后给出简短回答" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "interrupted-run",
          sessionId: "recovery-session",
          streamKey: "recovery-session",
          workspaceRoot: workspace,
        });

        assert.equal(firstResult.status, "failed");
        assert.ok(firstResult.checkpoint?.runState);
        assert.equal(
          await fs.readFile(path.join(workspace, "recovery-counter.txt"), "utf8"),
          "x",
        );

        const foreignWorkspace = path.join(workspace, "foreign-workspace");
        await fs.mkdir(foreignWorkspace);
        await assert.rejects(
          runAgentTurn({
            eventBus: new EventBus(),
            messages: [],
            modelConfig: {
              baseUrl,
              model: "test-model",
              provider: "chatgpt-subscription",
            },
            recoveryState: firstResult.checkpoint?.runState,
            runId: "wrong-workspace-run",
            sessionId: "recovery-session",
            streamKey: "recovery-session",
            workspaceRoot: foreignWorkspace,
          }),
          /different workspace/i,
        );
        assert.equal(requests.length, 4);

        const resumedEvents: PublishedEvent[] = [];
        const resumedBus = new EventBus();
        resumedBus.subscribe("recovery-session", 0, (event) =>
          resumedEvents.push(event),
        );
        const resumedResult = await runAgentTurn({
          eventBus: resumedBus,
          messages: [],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          recoveryState: firstResult.checkpoint?.runState,
          runId: "resumed-run",
          sessionId: "recovery-session",
          streamKey: "recovery-session",
          workspaceRoot: workspace,
        });

        assert.equal(resumedResult.status, "completed");
        assert.equal(requests.length, 6);
        assert.equal(
          await fs.readFile(path.join(workspace, "recovery-counter.txt"), "utf8"),
          "x",
        );
        const reusedReceipt = resumedEvents.find(
          (event) => event.type === "tool.receipt",
        ) as { receipt?: { reused?: boolean } } | undefined;
        assert.equal(reusedReceipt?.receipt?.reused, true);
        const resumedRun = resumedEvents.find(
          (event) => event.type === "run.started",
        ) as
          | {
              resumedFromCheckpoint?: {
                completedSteps?: number;
                contextSnapshotHash?: string;
              };
            }
          | undefined;
        assert.equal(resumedRun?.resumedFromCheckpoint?.completedSteps, 1);
        assert.ok(resumedRun?.resumedFromCheckpoint?.contextSnapshotHash);
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("premature PPT text is guarded and provider exhaustion preserves a recoverable gap", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ranni-run-artifact-"));

  try {
    await withProvider(
      (_request, index) =>
        index === 0
          ? [
              sse("content", { delta: "PPT 已完成。" }),
              sse("done", {
                id: "premature",
                model: "test-model",
                status: "completed",
              }),
            ].join("")
          : sse("error", { message: "fetch failed: transient provider outage" }),
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("artifact-session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "制作一个 8 页 PPT" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "artifact-run",
          sessionId: "artifact-session",
          streamKey: "artifact-session",
          toolSettings: {
            activeSkills: ["html-to-pptx"],
            researchMode: true,
          },
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "failed");
        assert.ok(result.checkpoint?.acceptanceGap.length);
        assert.equal(
          events.some((event) => event.type === "text.completed"),
          false,
        );
        const completion = events.find(
          (event) => event.type === "completion.checked",
        ) as { ready?: boolean; acceptanceGap?: string[] } | undefined;
        assert.equal(completion?.ready, false);
        assert.ok(completion?.acceptanceGap?.some((gap) => /pptx/i.test(gap)));
        const recoveryEvent = events.find(
          (event) => event.type === "recovery.started",
        ) as
          | {
              checkpoint?: { checkpointRef?: string; schemaVersion?: number };
              runState?: unknown;
            }
          | undefined;
        assert.equal(recoveryEvent?.runState, undefined);
        assert.equal(recoveryEvent?.checkpoint?.schemaVersion, 2);
        assert.match(
          recoveryEvent?.checkpoint?.checkpointRef ?? "",
          /checkpoints\/checkpoint_001\.md$/,
        );
        const terminal = events.findLast(
          (event) => event.type === "run.completed",
        ) as { status?: string } | undefined;
        assert.equal(terminal?.status, "failed");

        assert.ok(requests.length >= 4);
        const guardedRequest = requests[1];
        assert.match(JSON.stringify(guardedRequest?.input), /completion guard/i);
        const advertised = new Set(
          (guardedRequest?.tools ?? []).map((tool) => tool.name),
        );
        for (const toolName of [
          "search_web",
          "fetch_url",
          "read_file",
          "record_research_finding",
          "update_task_memory",
          "write_slide_fragment",
          "validate_html_pptx_export",
        ]) {
          assert.equal(advertised.has(toolName), true, `${toolName} unavailable`);
        }
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("load_skill upgrades the live deliverable contract before finalization", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "ranni-run-dynamic-skill-"));

  try {
    await withProvider(
      (_request, index) => {
        if (index === 0) {
          return [
            sse("tool_call", {
              arguments: JSON.stringify({ name: "html-to-pptx" }),
              id: "load-pptx",
              name: "load_skill",
            }),
            sse("done", { id: "loaded", model: "test-model", status: "completed" }),
          ].join("");
        }
        if (index === 1) {
          return [
            sse("content", { delta: "PPT 已完成。" }),
            sse("done", { id: "early", model: "test-model", status: "completed" }),
          ].join("");
        }
        return sse("error", { message: "fetch failed after dynamic contract guard" });
      },
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("dynamic-session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "制作一个 8 页 PPT" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "dynamic-run",
          sessionId: "dynamic-session",
          streamKey: "dynamic-session",
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "failed");
        assert.ok(result.checkpoint?.acceptanceGap.some((gap) => /pptx/i.test(gap)));
        assert.ok(
          requests[1]?.tools?.some(
            (tool) => tool.name === "init_slide_html_workspace",
          ),
        );
        assert.equal(
          events.some((event) => event.type === "completion.checked" && event.ready === false),
          true,
        );
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("chunked final hides tools and finalizes only the aggregated answer", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-chunked-final-"),
  );

  try {
    await withProvider(
      (_request, index) =>
        index === 0
          ? [
              sse("content", {
                delta:
                  "RANNI_FINAL_PART 1/2\n第一部分结论。\nRANNI_FINAL_CONTINUE",
              }),
              sse("done", {
                id: "chunk-1",
                model: "test-model",
                status: "completed",
              }),
            ].join("")
          : index === 1
            ? [
                sse("content", { delta: "遗漏分段协议的正文。" }),
                sse("done", {
                  id: "chunk-repair",
                  model: "test-model",
                  status: "completed",
                }),
              ].join("")
            : [
              sse("content", {
                delta:
                  "RANNI_FINAL_PART 2/2\n第二部分证据。\nRANNI_FINAL_DONE",
              }),
              sse("done", {
                id: "chunk-2",
                model: "test-model",
                status: "completed",
              }),
            ].join(""),
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("chunk-session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "给出一份较长的研究结论" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "chunk-run",
          sessionId: "chunk-session",
          streamKey: "chunk-session",
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "completed");
        assert.equal(result.finalMessage, "第一部分结论。\n\n第二部分证据。");
        assert.equal(requests.length, 3);
        assert.ok((requests[0]?.tools?.length ?? 0) > 0);
        assert.equal(requests[1]?.tools?.length, 0);
        assert.equal(requests[2]?.tools?.length, 0);
        assert.match(
          JSON.stringify(requests[1]?.input),
          /RANNI_FINAL_PART 1\/2/,
        );

        const completedText = events.filter(
          (event) => event.type === "text.completed",
        ) as Array<{ message?: string }>;
        assert.equal(completedText.length, 1);
        assert.equal(
          completedText[0]?.message,
          "第一部分结论。\n\n第二部分证据。",
        );
        const stepStops = events
          .filter((event) => event.type === "step.completed")
          .map((event) => (event as { stopReason?: string }).stopReason);
        assert.deepEqual(stepStops, [
          "chunked_final_continue",
          "chunked_final_protocol_repair",
          "completed",
        ]);
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("a truncated gap-free final restarts from chunk one", async () => {
  const workspace = await fs.mkdtemp(
    path.join(os.tmpdir(), "ranni-run-chunk-repair-"),
  );

  try {
    await withProvider(
      (_request, index) => {
        const responses = [
          [
            sse("content", { delta: "这是一段被截断、不能直接交付的正文" }),
            sse("done", {
              id: "truncated",
              model: "test-model",
              status: "max_output_tokens",
            }),
          ].join(""),
          [
            sse("content", {
              delta:
                "RANNI_FINAL_PART 1/2\n重建后的第一部分。\nRANNI_FINAL_CONTINUE",
            }),
            sse("done", {
              id: "repair-1",
              model: "test-model",
              status: "completed",
            }),
          ].join(""),
          [
            sse("content", {
              delta:
                "RANNI_FINAL_PART 2/2\n重建后的第二部分。\nRANNI_FINAL_DONE",
            }),
            sse("done", {
              id: "repair-2",
              model: "test-model",
              status: "completed",
            }),
          ].join(""),
        ];
        return responses[index] ?? responses.at(-1)!;
      },
      async (baseUrl, requests) => {
        const eventBus = new EventBus();
        const events: PublishedEvent[] = [];
        eventBus.subscribe("repair-session", 0, (event) => events.push(event));
        const result = await runAgentTurn({
          eventBus,
          messages: [{ role: "user", content: "输出完整的长研究报告" }],
          modelConfig: {
            baseUrl,
            model: "test-model",
            provider: "chatgpt-subscription",
          },
          runId: "repair-run",
          sessionId: "repair-session",
          streamKey: "repair-session",
          workspaceRoot: workspace,
        });

        assert.equal(result.status, "completed");
        assert.equal(
          result.finalMessage,
          "重建后的第一部分。\n\n重建后的第二部分。",
        );
        assert.equal(requests.length, 3);
        assert.equal(requests[1]?.tools?.length, 0);
        assert.match(
          JSON.stringify(requests[1]?.input),
          /RANNI_FINAL_PART 1\/N/,
        );
        const stepStops = events
          .filter((event) => event.type === "step.completed")
          .map((event) => (event as { stopReason?: string }).stopReason);
        assert.deepEqual(stepStops, [
          "length_final_chunk_repair",
          "chunked_final_continue",
          "completed",
        ]);
      },
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
