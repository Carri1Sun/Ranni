import type { AgentMessage } from "../llm";
import type {
  TraceContextMessage,
  TraceContextSnapshot,
  TraceToolDefinition,
} from "../trace";
import type { ContextEnvelope } from "./types";

function estimateTokens(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function summarizeMessage(message: AgentMessage): TraceContextMessage {
  const serialized = JSON.stringify(message.content, null, 2);
  const typeSummary = message.content.map((block) => block.type);

  return {
    content: message.content,
    estimatedTokens: estimateTokens(message.content),
    role: message.role,
    serializedChars: serialized.length,
    typeSummary,
  };
}

export function toTraceToolDefinitions(
  tools: Array<{
    description?: string;
    input_schema?: unknown;
    name: string;
  }>,
) {
  return tools.map((tool) => ({
    description: tool.description,
    inputSchema: tool.input_schema,
    name: tool.name,
  })) satisfies TraceToolDefinition[];
}

export function createTraceContextSnapshot({
  contextWindow,
  envelope,
}: {
  contextWindow: number | null;
  envelope: ContextEnvelope;
}): TraceContextSnapshot {
  const messages = envelope.messages.map(summarizeMessage);
  const serializedChars =
    envelope.systemPrompt.length +
    messages.reduce((sum, message) => sum + message.serializedChars, 0) +
    JSON.stringify(envelope.toolDefinitions).length;
  const assistantMessageCount = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const estimatedInputTokens = envelope.composition.estimatedInputTokens;

  return {
    archiveSummary: envelope.archiveSummary,
    composition: envelope.composition,
    messages,
    stats: {
      assistantMessageCount,
      contentBlockCount: messages.reduce(
        (sum, message) => sum + message.typeSummary.length,
        0,
      ),
      estimatedInputOccupancyRatio:
        contextWindow === null ? null : estimatedInputTokens / contextWindow,
      estimatedInputTokens,
      modelContextWindow: contextWindow,
      serializedChars,
      systemPromptChars: envelope.systemPrompt.length,
      toolCount: envelope.toolDefinitions.length,
      userMessageCount: messages.length - assistantMessageCount,
    },
    systemPrompt: envelope.systemPrompt,
    taskContract: envelope.taskContract,
    tools: envelope.toolDefinitions,
    workingSet: envelope.workingSet,
  };
}
