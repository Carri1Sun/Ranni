import {
  buildMessageRequest,
  createMessage,
  getModelRuntimeInfo,
  type AgentAssistantBlock,
  type AgentMessage,
  type AgentToolResultBlock,
  type ModelConnectionConfig,
} from "./llm";
import { createResearchNotebook } from "./research";
import {
  executeTool,
  getToolDefinitions,
  type ToolSettings,
} from "./tools";
import type {
  StreamEvent,
  TraceContextMessage,
  TraceContextSnapshot,
  TraceToolDefinition,
} from "./trace";
import { getWorkspaceRoot } from "./workspace";

const MAX_TOOL_STEPS = 500;
const RESEARCH_TOOL_NAMES = new Set([
  "plan_research",
  "record_research_finding",
  "review_research_state",
  "save_research_checkpoint",
]);

type PlainMessage = {
  role: "user" | "assistant";
  content: string;
};

type RunAgentTurnOptions = {
  emit: (event: StreamEvent) => void;
  messages: PlainMessage[];
  modelConfig?: ModelConnectionConfig;
  signal?: AbortSignal;
  toolSettings?: ToolSettings;
  workspaceRoot?: string;
};

const CANCELLED_MESSAGE = "已手动终止运行。";

function createAbortError() {
  const error = new Error(CANCELLED_MESSAGE);
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /cancelled|aborted|中止|终止/i.test(error.message))
  );
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createSystemPrompt({
  runtime,
  toolNames,
  workspaceRoot,
}: {
  runtime: ReturnType<typeof getModelRuntimeInfo>;
  toolNames: string[];
  workspaceRoot?: string;
}) {
  const currentDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(new Date());

  return [
    "You are a local execution AI agent. Your job is to complete the user's task through verifiable tool use, not by giving speculative advice.",
    "",
    "You operate inside a local workspace and may inspect files, modify files, run short terminal commands, and retrieve public web information through the provided tools.",
    "",
    "Core principles:",
    "1. Prefer evidence over guesswork. Read files, inspect outputs, and use tool results as the source of truth.",
    "2. Before modifying files, moving files, deleting files, or running commands, gather the minimum necessary context.",
    "3. Do not invent file contents, command outputs, web content, or execution results.",
    "4. Destructive actions such as overwriting, deleting, or moving important files must be justified by the task. Unless the user has explicitly requested them, explain the reason before performing them.",
    "5. Keep actions efficient, but do not skip validation when the task requires correctness.",
    "6. If a tool returns an error, treat the failure reason as evidence and decide the next step accordingly instead of stopping immediately.",
    "",
    "Working protocol:",
    "1. First understand the task and identify whether it requires local inspection, file changes, terminal verification, or web research.",
    "2. Gather evidence before acting. Prefer locating relevant files or sources before reading large amounts of content.",
    "3. Choose the tool with the highest information gain for the current step.",
    "4. After making changes, perform the smallest meaningful verification step.",
    "5. Once enough evidence has been gathered and the task is complete, stop using tools and provide the result.",
    "",
    "Progress and anti-loop protocol:",
    "1. Every step must serve exactly one of these goals: gather evidence, execute a change, or verify a result.",
    "2. Do not repeat the same tool call or the same strategy to obtain the same information unless something has materially changed, such as:",
    "   - a narrower or more specific input",
    "   - a different target file, directory, URL, or command",
    "   - a new clue from a previous tool result",
    "   - a failed attempt that revealed a concrete reason to retry differently",
    "3. Think in strategy families, not only in individual tool calls:",
    "   - directory exploration: list_files, search_in_files",
    "   - file reading: read_file",
    "   - file modification: write_file, move_path, delete_path",
    "   - terminal verification: run_terminal",
    "   - web discovery: search_web",
    "   - web extraction: fetch_url",
    "4. If the same strategy family fails to produce new evidence twice in a row, switch to a different strategy family.",
    "5. If three consecutive steps produce no new evidence, no successful modification, and no meaningful verification result, stop and report the blocker clearly instead of continuing blindly.",
    "6. After changing files or running a command that is meant to affect the workspace, prefer verification before declaring success.",
    "",
    "File strategy:",
    "1. Prefer locate -> read -> modify -> verify.",
    "2. Use search tools to narrow the target before reading large files.",
    "3. Treat write_file as a full-file overwrite tool. Use it for creating new files or for full rewrites only after reading enough context. Do not use it for blind partial edits.",
    "4. If the available evidence is insufficient to safely modify a file, continue gathering context first.",
    "",
    "Terminal strategy:",
    "1. Use terminal commands only for short, non-interactive tasks.",
    "2. Prefer commands for inspection, validation, build, test, or reading CLI output.",
    "3. If a command fails, use stdout and stderr to decide the next step. Do not mindlessly rerun the same command.",
    "",
    "Web strategy:",
    "1. Use search_web to discover candidate sources, official documentation, and recent public information.",
    "2. search_web returns search results and snippets, not full page contents.",
    "3. Use fetch_url only when you need the readable content of a specific public page.",
    "4. Prefer reading a small number of high-value pages rather than fetching many pages blindly.",
    "5. Public-page extraction may fail on login walls, highly dynamic pages, or anti-bot protected sites.",
    "",
    "Research protocol:",
    "1. Treat a task as non-trivial research if it requires multiple sources, comparisons, tradeoff analysis, current information, or synthesis beyond a single fact lookup.",
    "2. For non-trivial research, do not jump directly from search snippets to the final answer.",
    "3. First use plan_research to define the topic, goal, subquestions, and analysis angles.",
    "4. As you gather evidence, periodically use record_research_finding to store source-backed conclusions, confidence, and unresolved questions.",
    "5. Before finalizing, use review_research_state to check coverage and remaining gaps.",
    "6. If the investigation is long, reusable, or benefits from handoff notes, use save_research_checkpoint to write a Markdown checkpoint into the workspace.",
    "7. When sources conflict, record the conflict explicitly in a finding before choosing a conclusion.",
    "",
    "Response requirements:",
    "1. Respond to the user in Chinese.",
    "2. Be concise and outcome-focused.",
    "3. When relevant, state:",
    "   - what you did",
    "   - what evidence you used",
    "   - what result you obtained",
    "   - what remains uncertain or risky",
    "4. If you are blocked, say what you tried and why it did not work.",
    "",
    "Runtime context:",
    `- Workspace root: ${getWorkspaceRoot(workspaceRoot)}`,
    `- Current date: ${currentDate}`,
    `- Max tool steps: ${MAX_TOOL_STEPS}`,
    `- Current model: ${runtime.model}`,
    `- Available tools: ${toolNames.join(", ")}`,
  ].join("\n");
}

function getTextFromBlocks(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getThinkingFromBlocks(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getToolUseBlocks(blocks: AgentAssistantBlock[]) {
  return blocks.filter((block) => block.type === "tool_use");
}

function formatToolExecutionError(toolName: string, error: unknown) {
  const reason =
    error instanceof Error ? error.message : "工具执行失败，未获得可解析的错误信息。";

  const strategyHints: Record<string, string[]> = {
    fetch_url: [
      "尝试同主题的其他公开 URL",
      "先用 search_web 寻找备用网址、镜像页或官方文档页",
      "如果页面需要登录、强 JavaScript 或有反爬，考虑换来源而不是重复抓取同一地址",
    ],
    search_web: [
      "缩小或改写查询词",
      "减少结果数量，或改成更明确的站点/文档关键词",
      "如果已经有候选链接，可直接尝试 fetch_url",
    ],
    read_file: [
      "先用 list_files 或 search_in_files 确认路径",
      "检查目标是否为二进制文件、目录或超出工作区范围",
    ],
    run_terminal: [
      "根据 stdout/stderr 调整命令参数或执行目录",
      "避免原样重复同一命令",
    ],
  };

  const hints = strategyHints[toolName] ?? [
    "根据失败原因切换策略，而不是机械重试同一操作",
  ];

  return [
    "Tool execution failed.",
    `Tool: ${toolName}`,
    `Reason: ${reason}`,
    "Suggested next actions:",
    ...hints.map((hint) => `- ${hint}`),
  ].join("\n");
}

function estimateTokens(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function summarizeMessage(message: AgentMessage): TraceContextMessage {
  const role = message.role === "assistant" ? "assistant" : "user";
  const serialized = JSON.stringify(message.content, null, 2);
  const contentBlocks = Array.isArray(message.content) ? message.content : [];
  const typeSummary = contentBlocks
    .map((block) =>
      typeof block === "object" && block !== null && "type" in block
        ? String(block.type)
        : "unknown",
    )
    .filter(Boolean);

  return {
    content: message.content,
    estimatedTokens: estimateTokens(message.content),
    role,
    serializedChars: serialized.length,
    typeSummary,
  };
}

function toTraceToolDefinitions() {
  return getToolDefinitions().map((tool) => ({
    description: tool.description,
    inputSchema:
      "input_schema" in tool && tool.input_schema ? tool.input_schema : undefined,
    name: tool.name,
  })) satisfies TraceToolDefinition[];
}

function createContextSnapshot({
  conversation,
  modelConfig,
  system,
  tools,
}: {
  conversation: AgentMessage[];
  modelConfig?: ModelConnectionConfig;
  system: string;
  tools: TraceToolDefinition[];
}): TraceContextSnapshot {
  const runtime = getModelRuntimeInfo(modelConfig);
  const messages = conversation.map(summarizeMessage);
  const serializedChars =
    system.length +
    messages.reduce((sum, message) => sum + message.serializedChars, 0) +
    JSON.stringify(tools, null, 2).length;
  const estimatedInputTokens = Math.max(1, Math.ceil(serializedChars / 4));
  const assistantMessageCount = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const userMessageCount = messages.length - assistantMessageCount;
  const contentBlockCount = messages.reduce(
    (sum, message) => sum + message.typeSummary.length,
    0,
  );

  return {
    messages,
    stats: {
      assistantMessageCount,
      contentBlockCount,
      estimatedInputOccupancyRatio:
        runtime.contextWindow !== null
          ? estimatedInputTokens / runtime.contextWindow
          : null,
      estimatedInputTokens,
      modelContextWindow: runtime.contextWindow,
      serializedChars,
      systemPromptChars: system.length,
      toolCount: tools.length,
      userMessageCount,
    },
    systemPrompt: system,
    tools,
  };
}

export async function runAgentTurn({
  emit,
  messages,
  modelConfig,
  signal,
  toolSettings,
  workspaceRoot,
}: RunAgentTurnOptions) {
  const toolDefinitions = getToolDefinitions();
  const traceToolDefinitions = toTraceToolDefinitions();
  const runtime = getModelRuntimeInfo(modelConfig);
  const system = createSystemPrompt({
    runtime,
    toolNames: toolDefinitions.map((tool) => tool.name),
    workspaceRoot,
  });
  const runId = crypto.randomUUID();
  const runStartedAt = Date.now();
  const conversation: AgentMessage[] = messages.map((message) => ({
    role: message.role,
    content: [
      {
        type: "text",
        text: message.content,
      },
    ],
  }));
  const latestUserPrompt =
    [...messages].reverse().find((message) => message.role === "user")?.content ??
    "";
  const researchNotebook = createResearchNotebook({
    latestUserPrompt,
    runId,
    workspaceRoot,
  });

  emit({
    prompt: latestUserPrompt,
    runId,
    runtime,
    startedAt: runStartedAt,
    toolDefinitions: traceToolDefinitions,
    type: "run_started",
  });

  emit({
    message: `已连接 ${runtime.provider}，开始分析请求。`,
    runId,
    timestamp: Date.now(),
    type: "status",
  });

  let completedSteps = 0;
  let currentStepId: string | undefined;
  let currentStepIndex: number | undefined;
  let currentStepStartedAt: number | undefined;
  let currentStepOpen = false;

  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
      assertNotAborted(signal);

      const stepIndex = step + 1;
      const stepId = crypto.randomUUID();
      const stepStartedAt = Date.now();
      currentStepId = stepId;
      currentStepIndex = stepIndex;
      currentStepStartedAt = stepStartedAt;
      currentStepOpen = true;

      emit({
        runId,
        startedAt: stepStartedAt,
        stepId,
        stepIndex,
        type: "step_started",
      });

      const context = createContextSnapshot({
        conversation,
        modelConfig,
        system,
        tools: traceToolDefinitions,
      });

      emit({
        context,
        runId,
        stepId,
        stepIndex,
        type: "context_snapshot",
      });

      emit({
        request: buildMessageRequest({
          system,
          messages: conversation,
          modelConfig,
          tools: toolDefinitions,
        }),
        runId,
        stepId,
        stepIndex,
        type: "model_request",
      });

      assertNotAborted(signal);

      const assistantResult = await createMessage({
        system,
        messages: conversation,
        modelConfig,
        onRetry: ({ attempt, reason }) => {
          const message = `${runtime.model} 服务暂时不稳定，正在自动重试（${attempt}/1）。原因：${reason}`;

          emit({
            message,
            runId,
            stepId,
            stepIndex,
            timestamp: Date.now(),
            type: "status",
          });
        },
        signal,
        tools: toolDefinitions,
      });

      assertNotAborted(signal);

      emit({
        response: assistantResult.response,
        runId,
        stepId,
        stepIndex,
        type: "model_response",
      });

      const blocks = assistantResult.message.content;
      conversation.push({
        role: "assistant",
        content: blocks,
      });

      const thinking = getThinkingFromBlocks(blocks);
      const visibleContent = getTextFromBlocks(blocks);
      const toolUseBlocks = getToolUseBlocks(blocks);

      if (thinking) {
        emit({
          message: thinking,
          runId,
          stepId,
          stepIndex,
          timestamp: Date.now(),
          type: "status",
        });

        emit({
          message: thinking,
          runId,
          stepId,
          stepIndex,
          timestamp: Date.now(),
          type: "thinking",
        });
      }

      if (toolUseBlocks.length === 0) {
        const finalMessage =
          visibleContent || "任务已完成，但模型没有返回可显示文本。";

        emit({
          message: finalMessage,
          runId,
          stepId,
          stepIndex,
          type: "assistant",
        });

        completedSteps = stepIndex;
        emit({
          durationMs: Date.now() - stepStartedAt,
          endedAt: Date.now(),
          runId,
          status: "completed",
          stepId,
          stepIndex,
          stopReason: assistantResult.response.stopReason,
          type: "step_completed",
        });
        currentStepOpen = false;
        emit({
          durationMs: Date.now() - runStartedAt,
          endedAt: Date.now(),
          runId,
          status: "completed",
          totalSteps: completedSteps,
          type: "run_completed",
        });
        return;
      }

      if (visibleContent) {
        emit({
          message: visibleContent,
          runId,
          stepId,
          stepIndex,
          timestamp: Date.now(),
          type: "status",
        });
      }

      const toolResults: AgentToolResultBlock[] = [];

      for (const toolCall of toolUseBlocks) {
        assertNotAborted(signal);

        const toolStartedAt = Date.now();

        emit({
          arguments: toolCall.input,
          name: toolCall.name,
          runId,
          startedAt: toolStartedAt,
          stepId,
          stepIndex,
          toolUseId: toolCall.id,
          type: "tool_call",
        });

        try {
          const result = await executeTool(
            toolCall.name,
            JSON.stringify(toolCall.input),
            {
              researchNotebook,
              signal,
              toolSettings,
              workspaceRoot,
            },
          );
          assertNotAborted(signal);

          const durationMs = Date.now() - toolStartedAt;

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: result,
          });

          emit({
            durationMs,
            name: toolCall.name,
            result,
            runId,
            startedAt: toolStartedAt,
            stepId,
            stepIndex,
            success: true,
            toolUseId: toolCall.id,
            type: "tool_result",
          });

          if (
            RESEARCH_TOOL_NAMES.has(toolCall.name) &&
            researchNotebook.hasContent()
          ) {
            emit({
              researchState: researchNotebook.getStateSummary({
                includeAllFindings: false,
                maxFindings: 8,
              }),
              runId,
              stepId,
              stepIndex,
              type: "research_state",
            });
          }
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) {
            throw error;
          }

          const result = formatToolExecutionError(toolCall.name, error);
          const durationMs = Date.now() - toolStartedAt;

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: result,
            is_error: true,
          });

          emit({
            durationMs,
            name: toolCall.name,
            result,
            runId,
            startedAt: toolStartedAt,
            stepId,
            stepIndex,
            success: false,
            toolUseId: toolCall.id,
            type: "tool_result",
          });
        }
      }

      conversation.push({
        role: "user",
        content: toolResults,
      });

      completedSteps = stepIndex;
      emit({
        durationMs: Date.now() - stepStartedAt,
        endedAt: Date.now(),
        runId,
        status: "completed",
        stepId,
        stepIndex,
        stopReason: assistantResult.response.stopReason,
        type: "step_completed",
      });
      currentStepOpen = false;
    }

    throw new Error(
      `本轮对话超过最大工具步数 ${MAX_TOOL_STEPS}，请缩小任务范围后重试。`,
    );
  } catch (error) {
    const cancelled = signal?.aborted || isAbortError(error);
    const message = cancelled
      ? CANCELLED_MESSAGE
      : error instanceof Error
        ? error.message
        : "Agent 执行失败，请重试。";
    const endedAt = Date.now();

    if (cancelled) {
      emit({
        message,
        runId,
        stepId: currentStepId,
        stepIndex: currentStepIndex,
        timestamp: endedAt,
        type: "status",
      });
    } else {
      emit({
        message,
        runId,
        stepId: currentStepId,
        stepIndex: currentStepIndex,
        type: "error",
      });
    }

    if (
      currentStepOpen &&
      currentStepId &&
      currentStepIndex &&
      typeof currentStepStartedAt === "number"
    ) {
      emit({
        durationMs: Math.max(0, endedAt - currentStepStartedAt),
        endedAt,
        runId,
        status: cancelled ? "cancelled" : "failed",
        stepId: currentStepId,
        stepIndex: currentStepIndex,
        type: "step_completed",
      });
    }

    emit({
      durationMs: endedAt - runStartedAt,
      endedAt,
      error: message,
      runId,
      status: cancelled ? "cancelled" : "failed",
      totalSteps: Math.max(completedSteps, currentStepIndex ?? 0),
      type: "run_completed",
    });
  }
}
