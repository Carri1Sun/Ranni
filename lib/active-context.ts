import type {
  AgentMessage,
  AgentToolResultBlock,
  AgentToolUseBlock,
} from "./llm";

export type SlideArtifactPhase = "off" | "slides" | "styles";

export type ArtifactReceipt = {
  artifactKey: string;
  details: string[];
  inputHash: string;
  payloadChars: number;
  resultSummary: string;
  resultHash: string;
  toolName: string;
};

export type FailureObservation = {
  count: number;
  fingerprint: string;
  noProgressObserved: boolean;
  toolName: string;
  toolUseId: string;
};

export type ObservationState = {
  fingerprint: string;
  noChangeObserved: boolean;
  repeatedCount: number;
  target: string;
  toolName: string;
  toolUseId: string;
};

export type ActiveContextProjectionMetadata = {
  applied: boolean;
  failureObservations: FailureObservation[];
  observationStates: ObservationState[];
  omittedToolPairCount: number;
  originalMessageCount: number;
  preservedToolPairCount: number;
  preservedUserTextBlockCount: number;
  projectedMessageCount: number;
  receipts: ArtifactReceipt[];
};

export type ActiveContextProjection = {
  messages: AgentMessage[];
  metadata: ActiveContextProjectionMetadata;
};

type ToolAttempt = {
  artifactKey: string | null;
  index: number;
  result: AgentToolResultBlock;
  use: AgentToolUseBlock;
};

const ARTIFACT_TOOLS = new Set([
  "assemble_deck_styles",
  "assemble_slide_deck",
  "export_html_to_pptx",
  "init_slide_html_workspace",
  "patch_slide_fragment",
  "prepare_slide_html_for_pptx",
  "set_slide_manifest",
  "validate_html_pptx_export",
  "write_slide_fragment",
  "write_style_fragment",
]);

const RECENT_OBSERVATION_TOOLS = new Set([
  "inspect_slide_fragment",
  "list_files",
  "read_file",
  "read_task_memory",
  "search_in_files",
]);

const MAX_RECENT_OBSERVATION_PAIRS = 8;
const MAX_RECENT_OBSERVATION_CHARS = 40_000;
const MAX_UNRESOLVED_FAILURE_PAIRS = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeFailureContent(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

function compactExcerpt(value: string, maxChars = 420) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= maxChars) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

function readStringArray(value: unknown, key: string) {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

export function createFailureFingerprint(toolName: string, content: string) {
  return `${toolName}:${stableHash(normalizeFailureContent(content))}`;
}

function getArtifactKey(toolUse: AgentToolUseBlock) {
  if (!ARTIFACT_TOOLS.has(toolUse.name)) {
    return null;
  }

  const deckDir = readString(toolUse.input, "deckDir");
  const slideId = readString(toolUse.input, "slideId");
  const styleId = readString(toolUse.input, "styleId");
  const outHtml = readString(toolUse.input, "outHtml");

  if (slideId) {
    return `${deckDir || "."}/slides/${slideId}.html`;
  }
  if (styleId) {
    return `${deckDir || "."}/styles/${styleId}.css`;
  }
  if (toolUse.name === "assemble_deck_styles") {
    return `${deckDir || "."}/styles.css`;
  }
  if (toolUse.name === "assemble_slide_deck") {
    return outHtml || `${deckDir || "."}/deck.html`;
  }

  return `${toolUse.name}:${deckDir || "."}`;
}

function getPayloadChars(toolUse: AgentToolUseBlock) {
  const html = readString(toolUse.input, "html");
  const css = readString(toolUse.input, "css");

  return (html || css).length;
}

function getReceiptDetails(toolUse: AgentToolUseBlock) {
  const details: string[] = [];
  const slideIds = readStringArray(toolUse.input, "slideIds");
  const styleIds = readStringArray(toolUse.input, "styleIds");
  const source = readString(toolUse.input, "source");

  if (slideIds.length > 0) {
    details.push(`slide_ids=${compactExcerpt(slideIds.join(","), 500)}`);
  }
  if (styleIds.length > 0) {
    details.push(`style_ids=${compactExcerpt(styleIds.join(","), 300)}`);
  }
  if (source) {
    details.push(`source=${compactExcerpt(source, 160)}`);
  }

  return details;
}

function collectToolAttempts(conversation: AgentMessage[]) {
  const uses = new Map<
    string,
    { block: AgentToolUseBlock; order: number }
  >();
  const attempts: ToolAttempt[] = [];
  let order = 0;

  conversation.forEach((message) => {
    for (const block of message.content) {
      if (message.role === "assistant" && block.type === "tool_use") {
        uses.set(block.id, {
          block,
          order,
        });
        order += 1;
        continue;
      }

      if (message.role !== "user" || block.type !== "tool_result") {
        continue;
      }

      const use = uses.get(block.tool_use_id);

      if (!use) {
        continue;
      }

      attempts.push({
        artifactKey: getArtifactKey(use.block),
        index: use.order,
        result: block,
        use: use.block,
      });
    }
  });

  return attempts.sort((left, right) => left.index - right.index);
}

function collectAcceptedArtifactReceipts(attempts: ToolAttempt[]) {
  const latestSuccessByArtifact = new Map<string, ToolAttempt>();

  for (const attempt of attempts) {
    if (attempt.artifactKey && !attempt.result.is_error) {
      latestSuccessByArtifact.set(attempt.artifactKey, attempt);
    }
  }

  return [...latestSuccessByArtifact.values()]
    .sort((left, right) => left.index - right.index)
    .map((attempt): ArtifactReceipt => {
      const serializedInput =
        attempt.use.rawInput ?? JSON.stringify(attempt.use.input ?? {});

      return {
        artifactKey: attempt.artifactKey ?? attempt.use.name,
        details: getReceiptDetails(attempt.use),
        inputHash: stableHash(serializedInput),
        payloadChars: getPayloadChars(attempt.use),
        resultSummary: compactExcerpt(attempt.result.content),
        resultHash: stableHash(attempt.result.content),
        toolName: attempt.use.name,
      };
    });
}

function getFailureTarget(attempt: ToolAttempt) {
  if (attempt.artifactKey) {
    return attempt.artifactKey;
  }

  const path = readString(attempt.use.input, "path");
  const url = readString(attempt.use.input, "url");
  const query = readString(attempt.use.input, "query");

  return `${attempt.use.name}:${path || url || query || "default"}`;
}

function selectUnresolvedFailures(attempts: ToolAttempt[]) {
  const latestByTarget = new Map<string, ToolAttempt>();

  for (const attempt of attempts) {
    latestByTarget.set(getFailureTarget(attempt), attempt);
  }

  const unresolved = [...latestByTarget.values()]
    .filter((attempt) => attempt.result.is_error)
    .sort((left, right) => right.index - left.index);
  const latestArtifactFailure = unresolved.find(
    (attempt) => attempt.artifactKey !== null,
  );
  const selected = new Map<string, ToolAttempt>();

  if (latestArtifactFailure) {
    selected.set(latestArtifactFailure.use.id, latestArtifactFailure);
  }

  for (const attempt of unresolved) {
    if (selected.size >= MAX_UNRESOLVED_FAILURE_PAIRS) {
      break;
    }
    selected.set(attempt.use.id, attempt);
  }

  return [...selected.values()].sort((left, right) => left.index - right.index);
}

function selectRecentObservations(attempts: ToolAttempt[]) {
  const selected: ToolAttempt[] = [];
  const selectedTargets = new Set<string>();
  let selectedChars = 0;

  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];

    if (
      attempt.result.is_error ||
      !RECENT_OBSERVATION_TOOLS.has(attempt.use.name)
    ) {
      continue;
    }

    const target = getFailureTarget(attempt);

    if (selectedTargets.has(target)) {
      continue;
    }

    const pairChars =
      attempt.result.content.length +
      (attempt.use.rawInput ?? JSON.stringify(attempt.use.input ?? {})).length;

    if (
      selected.length > 0 &&
      selectedChars + pairChars > MAX_RECENT_OBSERVATION_CHARS
    ) {
      continue;
    }

    selectedTargets.add(target);
    selected.push(attempt);
    selectedChars += pairChars;

    if (selected.length >= MAX_RECENT_OBSERVATION_PAIRS) {
      break;
    }
  }

  return selected.reverse();
}

function collectObservationStates(
  attempts: ToolAttempt[],
  selectedObservations: ToolAttempt[],
) {
  return selectedObservations.map((attempt): ObservationState => {
    const target = getFailureTarget(attempt);
    const fingerprint = createFailureFingerprint(
      attempt.use.name,
      attempt.result.content,
    );
    const targetHistory = attempts
      .filter(
        (candidate) =>
          candidate.index <= attempt.index &&
          !candidate.result.is_error &&
          getFailureTarget(candidate) === target,
      )
      .sort((left, right) => right.index - left.index);
    let repeatedCount = 0;

    for (const candidate of targetHistory) {
      if (
        createFailureFingerprint(
          candidate.use.name,
          candidate.result.content,
        ) !== fingerprint
      ) {
        break;
      }
      repeatedCount += 1;
    }

    return {
      fingerprint,
      noChangeObserved: repeatedCount > 1,
      repeatedCount,
      target,
      toolName: attempt.use.name,
      toolUseId: attempt.use.id,
    };
  });
}

function collectFailureObservations(
  attempts: ToolAttempt[],
  selectedFailures: ToolAttempt[],
) {
  return selectedFailures.map((attempt): FailureObservation => {
    const fingerprint = createFailureFingerprint(
      attempt.use.name,
      attempt.result.content,
    );
    const target = getFailureTarget(attempt);
    const targetHistory = attempts
      .filter(
        (candidate) =>
          candidate.index <= attempt.index &&
          getFailureTarget(candidate) === target,
      )
      .sort((left, right) => right.index - left.index);
    let count = 0;

    for (const candidate of targetHistory) {
      if (
        !candidate.result.is_error ||
        createFailureFingerprint(
          candidate.use.name,
          candidate.result.content,
        ) !== fingerprint
      ) {
        break;
      }
      count += 1;
    }

    return {
      count,
      fingerprint,
      noProgressObserved: count > 1,
      toolName: attempt.use.name,
      toolUseId: attempt.use.id,
    };
  });
}

function renderProjectionNote({
  failureObservations,
  observationStates,
  omittedToolPairCount,
  receipts,
}: {
  failureObservations: FailureObservation[];
  observationStates: ObservationState[];
  omittedToolPairCount: number;
  receipts: ArtifactReceipt[];
}) {
  return [
    "Active slide artifact context (deterministic projection):",
    "- The complete event history remains in the run trace; this request contains the current working evidence.",
    receipts.length > 0 ? "- Successful artifact receipts:" : "",
    ...receipts.map(
      (receipt) =>
        `  - ${receipt.toolName} ${receipt.artifactKey}; input_hash=${receipt.inputHash}; result_hash=${receipt.resultHash}; payload_chars=${receipt.payloadChars}${receipt.details.length > 0 ? `; ${receipt.details.join("; ")}` : ""}; observed_result=${JSON.stringify(receipt.resultSummary)}`,
    ),
    failureObservations.length > 0
      ? "- Current unresolved failure observations:"
      : "",
    ...failureObservations.map(
      (failure) =>
        `  - tool=${failure.toolName}; fingerprint=${failure.fingerprint}; count=${failure.count}; unchanged_failure_observed=${failure.noProgressObserved}`,
    ),
    observationStates.length > 0
      ? "- Current observation targets (their latest complete pairs follow):"
      : "",
    ...observationStates.map(
      (observation) =>
        `  - tool=${observation.toolName}; target=${observation.target}; fingerprint=${observation.fingerprint}; repeated_unchanged_count=${observation.repeatedCount}; unchanged_observation=${observation.noChangeObserved}`,
    ),
    `- Historical tool pairs omitted from this active request: ${omittedToolPairCount}.`,
    failureObservations.length > 0
      ? "- The complete unresolved tool call/result pairs follow unchanged."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isInternalControlText(text: string) {
  return /^Internal (?:artifact|chunked-final|completion|final answer|long-final|model-failure|model-output|research|tool-call)\b/i.test(
    text.trim(),
  );
}

function cloneRelevantDialogueMessages(
  conversation: AgentMessage[],
  initialMessageCount: number,
) {
  const messages: AgentMessage[] = [];
  let pendingInternalControl: Extract<
    AgentMessage["content"][number],
    { type: "text" }
  > | null = null;

  conversation.forEach((message, index) => {
    const isInitialDialogue = index < initialMessageCount;

    if (!isInitialDialogue && message.role === "assistant") {
      pendingInternalControl = null;
    }

    const textBlocks = message.content.filter((block) => {
      if (block.type !== "text") {
        return false;
      }
      if (isInitialDialogue) {
        return true;
      }
      if (message.role !== "user") {
        return false;
      }
      if (isInternalControlText(block.text)) {
        pendingInternalControl = { ...block };
        return false;
      }
      return true;
    });

    if (textBlocks.length > 0) {
      messages.push({
        role: message.role,
        content: textBlocks.map((block) => ({ ...block })),
      });
    }
  });

  if (pendingInternalControl) {
    messages.push({
      role: "user",
      content: [pendingInternalControl],
    });
  }

  return messages;
}

export function buildActiveContextProjection({
  conversation,
  initialMessageCount = 0,
  phase,
}: {
  conversation: AgentMessage[];
  initialMessageCount?: number;
  phase: SlideArtifactPhase;
}): ActiveContextProjection {
  if (phase === "off") {
    return {
      messages: conversation,
      metadata: {
        applied: false,
        failureObservations: [],
        observationStates: [],
        omittedToolPairCount: 0,
        originalMessageCount: conversation.length,
        preservedToolPairCount: 0,
        preservedUserTextBlockCount: 0,
        projectedMessageCount: conversation.length,
        receipts: [],
      },
    };
  }

  const attempts = collectToolAttempts(conversation);
  const receipts = collectAcceptedArtifactReceipts(attempts);
  const selectedFailures = selectUnresolvedFailures(attempts);
  const selectedObservations = selectRecentObservations(attempts);
  const selectedAttempts = new Map<string, ToolAttempt>();

  for (const attempt of [
    ...selectedFailures,
    ...selectedObservations,
  ]) {
    selectedAttempts.set(attempt.use.id, attempt);
  }

  const selected = [...selectedAttempts.values()].sort(
    (left, right) => left.index - right.index,
  );
  const failureObservations = collectFailureObservations(
    attempts,
    selectedFailures,
  );
  const observationStates = collectObservationStates(
    attempts,
    selectedObservations,
  );
  const messages = cloneRelevantDialogueMessages(
    conversation,
    Math.min(Math.max(0, initialMessageCount), conversation.length),
  );
  const preservedUserTextBlockCount = messages.reduce(
    (count, message) =>
      count + (message.role === "user" ? message.content.length : 0),
    0,
  );
  const omittedToolPairCount = Math.max(0, attempts.length - selected.length);

  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: renderProjectionNote({
          failureObservations,
          observationStates,
          omittedToolPairCount,
          receipts,
        }),
      },
    ],
  });

  for (const attempt of selected) {
    messages.push({
      role: "assistant",
      content: [{ ...attempt.use }],
    });
    messages.push({
      role: "user",
      content: [{ ...attempt.result }],
    });
  }

  return {
    messages,
    metadata: {
      applied: true,
      failureObservations,
      observationStates,
      omittedToolPairCount,
      originalMessageCount: conversation.length,
      preservedToolPairCount: selected.length,
      preservedUserTextBlockCount,
      projectedMessageCount: messages.length,
      receipts,
    },
  };
}
