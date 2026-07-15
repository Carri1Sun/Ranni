import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "../llm";
import type { TraceToolDefinition } from "../trace";
import type {
  ContextCompositionManifest,
  ContextEnvelope,
  ContextSectionManifest,
  StablePrefixState,
  TaskContractView,
  WorkingSetView,
} from "./types";

const DEFAULT_SAFETY_MARGIN = 50_000;
const COMPACTION_THRESHOLD = 0.75;
const RECENT_CAUSAL_TURNS = 4;

type CausalTurnRange = {
  end: number;
  resultIds: Set<string>;
  start: number;
  toolUseIds: Set<string>;
};

function stableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function serialize(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function estimateTokens(value: unknown) {
  return Math.max(1, Math.ceil(serialize(value).length / 4));
}

function getToolUses(message: AgentMessage) {
  return message.role === "assistant"
    ? message.content.filter(
        (block): block is AgentToolUseBlock => block.type === "tool_use",
      )
    : [];
}

function getToolResults(message: AgentMessage) {
  return message.role === "user"
    ? message.content.filter(
        (block): block is AgentToolResultBlock => block.type === "tool_result",
      )
    : [];
}

function collectCausalTurns(messages: AgentMessage[]) {
  const turns: CausalTurnRange[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const uses = getToolUses(messages[index]);

    if (uses.length === 0) {
      continue;
    }

    const toolUseIds = new Set(uses.map((use) => use.id));
    const resultIds = new Set<string>();
    let end = index;

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      if (messages[cursor].role === "assistant") {
        break;
      }

      for (const result of getToolResults(messages[cursor])) {
        if (toolUseIds.has(result.tool_use_id)) {
          resultIds.add(result.tool_use_id);
          end = cursor;
        }
      }
    }

    turns.push({ end, resultIds, start: index, toolUseIds });
  }

  return turns;
}

function assertCausalTurnsComplete(turns: CausalTurnRange[]) {
  for (const turn of turns) {
    const missing = [...turn.toolUseIds].filter(
      (toolUseId) => !turn.resultIds.has(toolUseId),
    );

    if (missing.length > 0) {
      throw new Error(
        `Context protocol violation: causal turn at message ${turn.start} is missing tool results for ${missing.join(", ")}.`,
      );
    }
  }
}

function cloneMessages(
  messages: AgentMessage[],
  continuationToolIds: ReadonlySet<string>,
) {
  let staleReasoningItemCount = 0;
  const cloned = messages.map((message): AgentMessage => ({
    role: message.role,
    content: message.content.map((block) => {
      if (
        block.type !== "tool_use" ||
        continuationToolIds.has(block.id) ||
        !block.providerMetadata?.responsesReasoningItems?.length
      ) {
        return { ...block };
      }

      staleReasoningItemCount +=
        block.providerMetadata.responsesReasoningItems.length;
      const clonedBlock = { ...block };
      delete clonedBlock.providerMetadata;
      return clonedBlock;
    }),
  }));

  return { messages: cloned, staleReasoningItemCount };
}

function buildArchiveSummary(
  messages: AgentMessage[],
  omittedTurns: CausalTurnRange[],
) {
  if (messages.length === 0) {
    return "";
  }

  const toolNames = new Set<string>();
  let resultCount = 0;

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use") {
        toolNames.add(block.name);
      } else if (block.type === "tool_result") {
        resultCount += 1;
      }
    }
  }

  return [
    "Archive summary (capacity compaction):",
    `- Historical messages summarized: ${messages.length}`,
    `- Historical causal turns summarized: ${omittedTurns.length}`,
    `- Historical tool results summarized: ${resultCount}`,
    toolNames.size > 0
      ? `- Historical tool families: ${[...toolNames].sort().join(", ")}`
      : "",
    "- Current facts, artifacts, failures and acceptance gaps are carried by the Working Set and receipts.",
  ]
    .filter(Boolean)
    .join("\n");
}

function createArchiveMessage(summary: string): AgentMessage[] {
  return summary
    ? [
        {
          role: "user",
          content: [{ type: "text", text: summary }],
        },
      ]
    : [];
}

function section(
  name: ContextSectionManifest["name"],
  value: unknown,
  itemCount: number,
  treatment: ContextSectionManifest["treatment"],
): ContextSectionManifest {
  const serialized = serialize(value);

  return {
    estimatedTokens: estimateTokens(serialized),
    hash: stableHash(serialized),
    itemCount,
    name,
    treatment,
  };
}

function countPreservedPairs(
  messages: AgentMessage[],
  expectedIds: ReadonlySet<string>,
) {
  const uses = new Set<string>();
  const results = new Set<string>();

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use" && expectedIds.has(block.id)) {
        uses.add(block.id);
      } else if (
        block.type === "tool_result" &&
        expectedIds.has(block.tool_use_id)
      ) {
        results.add(block.tool_use_id);
      }
    }
  }

  return [...expectedIds].filter(
    (toolUseId) => uses.has(toolUseId) && results.has(toolUseId),
  ).length;
}

export function composeContext({
  activeSkillNames,
  activeSkills = activeSkillNames.map((name) => ({
    bodyHash: "unknown",
    name,
    resourcePaths: [],
    version: "unknown",
  })),
  contextWindow,
  initialMessageCount,
  maxOutputTokens,
  messages,
  previousStablePrefixState,
  safetyMargin = DEFAULT_SAFETY_MARGIN,
  steeringMessages = [],
  stepIndex,
  systemPrompt,
  taskContract,
  toolDefinitions,
  workingSet,
}: {
  activeSkillNames: string[];
  activeSkills?: Array<{
    bodyHash: string;
    name: string;
    resourcePaths: string[];
    version: string;
  }>;
  contextWindow: number | null;
  initialMessageCount: number;
  maxOutputTokens: number;
  messages: AgentMessage[];
  previousStablePrefixState?: StablePrefixState;
  safetyMargin?: number;
  steeringMessages?: AgentMessage[];
  stepIndex: number;
  systemPrompt: string;
  taskContract: TaskContractView;
  toolDefinitions: TraceToolDefinition[];
  workingSet: WorkingSetView;
}): ContextEnvelope {
  const causalTurns = collectCausalTurns(messages);
  assertCausalTurnsComplete(causalTurns);

  const recentTurns = causalTurns.slice(-RECENT_CAUSAL_TURNS);
  const recentToolIds = new Set(
    recentTurns.flatMap((turn) => [...turn.toolUseIds]),
  );
  const cloned = cloneMessages(messages, recentToolIds);
  const safeInputBudget =
    contextWindow === null
      ? null
      : Math.max(1, contextWindow - maxOutputTokens - safetyMargin);
  const fullEstimate = estimateTokens({
    messages: cloned.messages,
    systemPrompt,
    toolDefinitions,
  });
  const shouldCompact =
    safeInputBudget !== null &&
    fullEstimate > Math.floor(safeInputBudget * COMPACTION_THRESHOLD);
  let archiveSummary = "";
  let causalTail = cloned.messages;
  let finalMessages = cloned.messages;
  let omittedHistoricalToolPairCount = 0;
  let compactionApplied = false;

  if (shouldCompact) {
    const tailStart = recentTurns[0]?.start ?? Math.max(
      initialMessageCount,
      cloned.messages.length - 8,
    );
    const latestInitialUser = cloned.messages
      .slice(0, Math.max(0, initialMessageCount))
      .findLast((message) => message.role === "user");
    const pinnedInitial = latestInitialUser ? [latestInitialUser] : [];
    const omittedMessages = cloned.messages.slice(0, tailStart);
    const omittedTurns = causalTurns.filter((turn) => turn.start < tailStart);

    if (omittedMessages.length > 0) {
      archiveSummary = buildArchiveSummary(omittedMessages, omittedTurns);
      causalTail = cloned.messages.slice(tailStart);
      finalMessages = [
        ...pinnedInitial,
        ...createArchiveMessage(archiveSummary),
        ...causalTail,
      ];
      omittedHistoricalToolPairCount = omittedTurns.reduce(
        (count, turn) => count + turn.toolUseIds.size,
        0,
      );
      compactionApplied = true;
    }
  }

  const latestTurn = causalTurns.at(-1);
  const expectedPreviousPairs = latestTurn?.toolUseIds ?? new Set<string>();
  const preservedPreviousPairs = countPreservedPairs(
    finalMessages,
    expectedPreviousPairs,
  );

  if (preservedPreviousPairs !== expectedPreviousPairs.size) {
    throw new Error(
      `Context protocol violation: preserved ${preservedPreviousPairs}/${expectedPreviousPairs.size} previous tool pairs.`,
    );
  }

  const sortedSkills = [...activeSkills].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const stablePrefixState: StablePrefixState = {
    hash: "",
    skillsHash: stableHash(serialize(sortedSkills)),
    taskContractHash: stableHash(serialize(taskContract)),
    toolsHash: stableHash(serialize(toolDefinitions)),
  };
  stablePrefixState.hash = stableHash(
    serialize({
      skillsHash: stablePrefixState.skillsHash,
      taskContractHash: stablePrefixState.taskContractHash,
      toolsHash: stablePrefixState.toolsHash,
    }),
  );
  const stablePrefixInvalidationReason = previousStablePrefixState
    ? previousStablePrefixState.taskContractHash !==
      stablePrefixState.taskContractHash
      ? ("task-contract-changed" as const)
      : previousStablePrefixState.skillsHash !== stablePrefixState.skillsHash
        ? ("skill-changed" as const)
        : previousStablePrefixState.toolsHash !== stablePrefixState.toolsHash
          ? ("tools-changed" as const)
          : previousStablePrefixState.hash !== stablePrefixState.hash
            ? ("provider-protocol" as const)
            : undefined
    : undefined;
  const prefixCacheEligibleMessageCount =
    previousStablePrefixState?.hash === stablePrefixState.hash &&
    !compactionApplied
      ? (latestTurn?.start ?? 0)
      : 0;
  const sections = [
    section("system", systemPrompt, 1, "pinned"),
    section("task_contract", taskContract, 1, "pinned"),
    section("working_set", workingSet, 1, "pinned"),
    section(
      "archive",
      archiveSummary,
      archiveSummary ? 1 : 0,
      archiveSummary ? "summarized" : "full",
    ),
    section("causal_tail", causalTail, recentTurns.length, "pinned"),
    section("steering", steeringMessages, steeringMessages.length, "full"),
    section("tools", toolDefinitions, toolDefinitions.length, "pinned"),
  ];
  const estimatedInputTokens = estimateTokens({
    messages: finalMessages,
    systemPrompt,
    toolDefinitions,
  });
  if (
    safeInputBudget !== null &&
    estimatedInputTokens > safeInputBudget
  ) {
    throw new Error(
      `Context capacity exceeded after safe compaction: estimated ${estimatedInputTokens} tokens, safe input budget ${safeInputBudget}. Recent causal turns remain pinned.`,
    );
  }
  const compositionWithoutHash: Omit<
    ContextCompositionManifest,
    "snapshotHash"
  > = {
    version: 2,
    compactionApplied,
    ...(compactionApplied ? { compactionReason: "budget" as const } : {}),
    estimatedInputTokens,
    finalMessageCount: finalMessages.length,
    omittedHistoricalToolPairCount,
    originalMessageCount: messages.length,
    previousTurnToolPairs: {
      expected: expectedPreviousPairs.size,
      preserved: preservedPreviousPairs,
    },
    recentCausalTurnCount: recentTurns.length,
    safeInputBudget,
    sections,
    semanticInvalidationCount: workingSet.rejectedAssumptionCount,
    skills: activeSkills,
    stablePrefixHash: stablePrefixState.hash,
    ...(stablePrefixInvalidationReason
      ? { stablePrefixInvalidationReason }
      : {}),
    staleReasoningItemCount: cloned.staleReasoningItemCount,
    prefixCacheEligibleMessageCount,
  };
  const composition: ContextCompositionManifest = {
    ...compositionWithoutHash,
    snapshotHash: stableHash(
      serialize({
        composition: compositionWithoutHash,
        messages: finalMessages,
        systemPrompt,
        toolDefinitions,
      }),
    ),
  };

  return {
    archiveSummary,
    causalTail,
    composition,
    messages: finalMessages,
    stepIndex,
    steeringMessages,
    stablePrefixState,
    systemPrompt,
    taskContract,
    toolDefinitions,
    workingSet,
  };
}
