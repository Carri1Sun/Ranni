const MAX_CHUNKED_FINAL_PARTS = 8;

export type ChunkedFinalState = {
  chunks: string[];
  expectedTotal: number | null;
  lastPart: number;
};

export type ChunkedFinalDecision =
  | {
      candidate: string;
      kind: "inactive";
    }
  | {
      candidate: string;
      kind: "complete";
    }
  | {
      controlMessage: string;
      kind: "continue";
      nextPart: number;
      state: ChunkedFinalState;
      stopReason: "chunked_final_continue";
    }
  | {
      controlMessage: string;
      kind: "repair";
      nextPart: number;
      state: ChunkedFinalState;
      stopReason: "chunked_final_protocol_repair";
    }
  | {
      error: string;
      kind: "error";
    };

type ParsedChunk = {
  content: string;
  done: boolean;
  expectedTotal: number | null;
  part: number;
  shouldContinue: boolean;
};

export function createChunkedFinalState(): ChunkedFinalState {
  return { chunks: [], expectedTotal: null, lastPart: 0 };
}

function parseChunkedFinalPart(value: string): ParsedChunk | null {
  const lines = value.trim().split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const partMatch = firstLine.match(
    /^RANNI_FINAL_PART\s+(\d+)\s*\/\s*(\d+|\?)$/i,
  );
  if (!partMatch) return null;

  const part = Number.parseInt(partMatch[1] ?? "", 10);
  const totalToken = partMatch[2] ?? "?";
  const expectedTotal =
    totalToken === "?" ? null : Number.parseInt(totalToken, 10);
  const lastLine = lines.at(-1)?.trim() ?? "";
  const done = /^RANNI_FINAL_DONE$/i.test(lastLine);
  const shouldContinue = /^RANNI_FINAL_CONTINUE$/i.test(lastLine);
  const content = lines
    .slice(1, done || shouldContinue ? -1 : undefined)
    .join("\n")
    .trim();

  return {
    content,
    done,
    expectedTotal,
    part,
    shouldContinue,
  };
}

function renderChunks(state: ChunkedFinalState) {
  return state.chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function continueMessage(expectedTotal: number | null, nextPart: number) {
  return [
    "Continue the chunked final answer in Chinese.",
    "- Do not call tools or repeat completed parts.",
    `- First line: RANNI_FINAL_PART ${nextPart}/${expectedTotal ?? "?"}`,
    "- Output exactly one substantive, non-overlapping part.",
    "- Last line: RANNI_FINAL_CONTINUE when another part remains, otherwise RANNI_FINAL_DONE.",
    "- Keep claim-to-source references close to the claims they support.",
  ].join("\n");
}

function repairDecision(
  state: ChunkedFinalState,
  reason: string,
): Extract<ChunkedFinalDecision, { kind: "repair" }> {
  const nextPart = state.lastPart + 1;
  return {
    controlMessage: [
      "Internal chunked-final protocol guard:",
      reason,
      continueMessage(state.expectedTotal, nextPart),
    ].join("\n"),
    kind: "repair",
    nextPart,
    state,
    stopReason: "chunked_final_protocol_repair",
  };
}

export function decideChunkedFinal({
  currentState,
  visibleContent,
}: {
  currentState: ChunkedFinalState | null;
  visibleContent: string;
}): ChunkedFinalDecision {
  const chunk = parseChunkedFinalPart(visibleContent);

  if (!chunk && !currentState) {
    return { candidate: visibleContent, kind: "inactive" };
  }
  if (!chunk && currentState) {
    return repairDecision(
      currentState,
      "The response omitted the required RANNI_FINAL_PART header or terminal marker.",
    );
  }

  const state = currentState
    ? {
        chunks: [...currentState.chunks],
        expectedTotal: currentState.expectedTotal,
        lastPart: currentState.lastPart,
      }
    : createChunkedFinalState();
  const expectedPart = state.lastPart + 1;

  if (!chunk || chunk.part !== expectedPart) {
    return repairDecision(
      state,
      `Expected final part ${expectedPart}; received ${chunk?.part ?? "none"}.`,
    );
  }
  if (
    !Number.isInteger(chunk.part) ||
    chunk.part < 1 ||
    chunk.part > MAX_CHUNKED_FINAL_PARTS ||
    (chunk.expectedTotal !== null &&
      (!Number.isInteger(chunk.expectedTotal) ||
        chunk.expectedTotal < chunk.part ||
        chunk.expectedTotal > MAX_CHUNKED_FINAL_PARTS))
  ) {
    return {
      error: `分段最终回答编号或总段数无效；最多允许 ${MAX_CHUNKED_FINAL_PARTS} 段。`,
      kind: "error",
    };
  }
  if (
    state.expectedTotal !== null &&
    chunk.expectedTotal !== null &&
    state.expectedTotal !== chunk.expectedTotal
  ) {
    return repairDecision(
      state,
      `Expected total ${state.expectedTotal}; received ${chunk.expectedTotal}.`,
    );
  }
  if (!chunk.content) {
    return repairDecision(state, "The final part body was empty.");
  }
  if (chunk.done === chunk.shouldContinue) {
    return repairDecision(
      state,
      "End the part with exactly one RANNI_FINAL_CONTINUE or RANNI_FINAL_DONE marker.",
    );
  }

  state.expectedTotal = state.expectedTotal ?? chunk.expectedTotal;
  state.chunks[chunk.part - 1] = chunk.content;
  state.lastPart = chunk.part;

  if (chunk.done) {
    if (
      state.expectedTotal !== null &&
      state.lastPart !== state.expectedTotal
    ) {
      return repairDecision(
        state,
        `RANNI_FINAL_DONE arrived at part ${state.lastPart}, but ${state.expectedTotal} parts were declared.`,
      );
    }
    return { candidate: renderChunks(state), kind: "complete" };
  }

  if (
    state.lastPart >= MAX_CHUNKED_FINAL_PARTS ||
    (state.expectedTotal !== null && state.lastPart >= state.expectedTotal)
  ) {
    return {
      error: `分段最终回答达到 ${state.lastPart} 段后仍请求继续。`,
      kind: "error",
    };
  }

  const nextPart = state.lastPart + 1;
  return {
    controlMessage: continueMessage(state.expectedTotal, nextPart),
    kind: "continue",
    nextPart,
    state,
    stopReason: "chunked_final_continue",
  };
}

export function createChunkedFinalStartMessage({
  reason,
  stopReason,
}: {
  reason: string;
  stopReason?: string | null;
}) {
  return [
    "Internal long-final guard:",
    `The previous final answer was incomplete: ${reason}`,
    stopReason ? `Stop reason: ${stopReason}` : "",
    "Restart the final answer from the beginning using the chunked final protocol.",
    "- Do not call tools; use the accepted evidence and current task state.",
    "- Output exactly one part per response, with 2 to 8 parts total.",
    "- First line: RANNI_FINAL_PART 1/N",
    "- Last line: RANNI_FINAL_CONTINUE unless this is the final part; then RANNI_FINAL_DONE.",
    "- Keep parts substantive, non-overlapping, and source-auditable.",
  ]
    .filter(Boolean)
    .join("\n");
}
