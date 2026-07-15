import type { AgentMessage } from "./llm";
import type { SlideArtifactPhase } from "./html-to-pptx/artifact-policy";

/**
 * Context Composer V2 的迁移期兼容 facade。
 *
 * phase 只表达工件关注点，不再触发历史投影或压缩。真实容量压缩、Causal Tail、
 * Provider continuation 与 Composition Manifest 由 `lib/context/composer.ts` 维护。
 */
export type ActiveContextProjectionMetadata = {
  applied: false;
  failureObservations: [];
  observationStates: [];
  omittedToolPairCount: 0;
  originalMessageCount: number;
  preservedToolPairCount: number;
  preservedUserTextBlockCount: number;
  projectedMessageCount: number;
  receipts: [];
};

export type ActiveContextProjection = {
  messages: AgentMessage[];
  metadata: ActiveContextProjectionMetadata;
};

export { type SlideArtifactPhase };

export function createFailureFingerprint(toolName: string, content: string) {
  let hash = 0x811c9dc5;
  const normalized = content.replace(/\s+/g, " ").trim();

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${toolName}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildActiveContextProjection({
  conversation,
}: {
  conversation: AgentMessage[];
  initialMessageCount?: number;
  phase: SlideArtifactPhase;
}): ActiveContextProjection {
  const toolUseIds = new Set<string>();
  const resultIds = new Set<string>();
  let preservedUserTextBlockCount = 0;

  for (const message of conversation) {
    for (const block of message.content) {
      if (block.type === "tool_use") toolUseIds.add(block.id);
      if (block.type === "tool_result") resultIds.add(block.tool_use_id);
      if (message.role === "user" && block.type === "text") {
        preservedUserTextBlockCount += 1;
      }
    }
  }

  const preservedToolPairCount = [...toolUseIds].filter((toolUseId) =>
    resultIds.has(toolUseId),
  ).length;

  return {
    messages: conversation,
    metadata: {
      applied: false,
      failureObservations: [],
      observationStates: [],
      omittedToolPairCount: 0,
      originalMessageCount: conversation.length,
      preservedToolPairCount,
      preservedUserTextBlockCount,
      projectedMessageCount: conversation.length,
      receipts: [],
    },
  };
}
