import type { AgentToolUseBlock } from "../llm";
import type {
  ObservedState,
  ReceiptCategory,
  ReceiptProjection,
  ToolReceipt,
} from "./types";

export type ReceiptProjector = (input: {
  result: string;
  success: boolean;
  toolCall: AgentToolUseBlock;
}) => ReceiptProjection | null;

export function stableReceiptHash(value: unknown) {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compact(value: string, limit = 800) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, key: string) {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function readRecordArray(value: unknown, key: string) {
  return isRecord(value) && Array.isArray(value[key])
    ? value[key].filter(isRecord)
    : [];
}

function evidenceSources(toolCall: AgentToolUseBlock, result: string) {
  const nestedKey =
    toolCall.name === "record_task_evidence"
      ? "sources"
      : toolCall.name === "record_research_finding"
        ? "evidence"
        : "";
  const nestedUrls = nestedKey
    ? readRecordArray(toolCall.input, nestedKey)
        .map((item) => readString(item, "url"))
        .filter(Boolean)
    : [];
  const resultUrls =
    toolCall.name === "search_web"
      ? [...result.matchAll(/^URL:\s*(https?:\/\/\S+)$/gim)].map(
          (match) => match[1]?.trim() ?? "",
        )
      : [];
  const directUrl = readString(toolCall.input, "url");

  return [...new Set([...nestedUrls, ...resultUrls, directUrl].filter(Boolean))];
}

function parseTerminalResult(result: string) {
  const exitCodeText = result.match(/^exit_code:\s*([^\n]+)/m)?.[1]?.trim();
  const parsedExitCode = exitCodeText ? Number(exitCodeText) : Number.NaN;

  return {
    exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : null,
    timedOut: /^timed_out:\s*true$/im.test(result),
  };
}

function inferCategory(toolName: string): ReceiptCategory {
  if (toolName === "update_task_state") return "state";
  if (toolName === "run_terminal") return "command";
  if (/validate|inspect|review/.test(toolName)) return "verification";
  if (/slide|pptx|deck|manifest|style/.test(toolName)) return "artifact";
  if (/search|fetch|evidence|research/.test(toolName)) return "evidence";
  if (/file|path/.test(toolName)) return "file";
  if (/list|read/.test(toolName)) return "observation";
  return "other";
}

function createStrategySignature(toolCall: AgentToolUseBlock) {
  const input = toolCall.input;
  const target = [
    "path",
    "query",
    "url",
    "command",
    "deckDir",
    "slideId",
    "styleId",
    "outPptx",
  ]
    .map((key) => readString(input, key))
    .filter(Boolean)
    .join("|");

  return `${toolCall.name}:${stableReceiptHash(target || input)}`;
}

function genericProjection({
  result,
  success,
  toolCall,
}: {
  result: string;
  success: boolean;
  toolCall: AgentToolUseBlock;
}): ReceiptProjection {
  const projection: ReceiptProjection = {};

  if (toolCall.name === "run_terminal") {
    const terminal = parseTerminalResult(result);
    projection.commands = [
      {
        command: readString(toolCall.input, "command"),
        ...terminal,
      },
    ];
  }

  if (
    success &&
    ["write_file", "move_path", "delete_path"].includes(toolCall.name)
  ) {
    const path = readString(toolCall.input, "path");
    const from = readString(toolCall.input, "from");
    const to = readString(toolCall.input, "to");
    const content = readString(toolCall.input, "content");

    projection.files =
      toolCall.name === "move_path"
        ? [
            {
              deleted: true,
              hash: stableReceiptHash(result),
              path: from,
              toolName: toolCall.name,
            },
            {
              hash: stableReceiptHash(result),
              path: to,
              toolName: toolCall.name,
            },
          ].filter((file) => Boolean(file.path))
        : path
          ? [
              {
                ...(toolCall.name === "delete_path" ? { deleted: true } : {}),
                hash: stableReceiptHash(
                  toolCall.name === "write_file" ? content : result,
                ),
                path,
                toolName: toolCall.name,
              },
            ]
          : [];
  }

  if (
    success &&
    [
      "fetch_url",
      "record_research_finding",
      "record_task_evidence",
      "search_web",
    ].includes(toolCall.name)
  ) {
    const sources = evidenceSources(toolCall, result);
    const summary =
      readString(toolCall.input, "summary") ||
      readString(toolCall.input, "claim") ||
      compact(result);
    projection.evidence = (sources.length > 0 ? sources : [""]).map(
      (source) => ({
        key: `${toolCall.name}:${stableReceiptHash(source || result)}`,
        ...(source ? { source } : {}),
        summary: compact(summary),
      }),
    );
  }

  return projection;
}

function mergeProjection(
  left: ReceiptProjection,
  right: ReceiptProjection | null,
) {
  if (!right) return left;

  return {
    artifacts: [...(left.artifacts ?? []), ...(right.artifacts ?? [])],
    commands: [...(left.commands ?? []), ...(right.commands ?? [])],
    evidence: [...(left.evidence ?? []), ...(right.evidence ?? [])],
    files: [...(left.files ?? []), ...(right.files ?? [])],
    verification: [
      ...(left.verification ?? []),
      ...(right.verification ?? []),
    ],
  };
}

function isDomainSuccess(toolCall: AgentToolUseBlock, transportSuccess: boolean, result: string) {
  if (!transportSuccess) return false;
  if (toolCall.name !== "run_terminal") return true;
  const terminal = parseTerminalResult(result);
  return !terminal.timedOut && (terminal.exitCode === null || terminal.exitCode === 0);
}

export function createToolReceipt({
  endedAt,
  projectors = [],
  result,
  startedAt,
  success: transportSuccess,
  toolCall,
}: {
  endedAt: number;
  projectors?: ReceiptProjector[];
  result: string;
  startedAt: number;
  success: boolean;
  toolCall: AgentToolUseBlock;
}): ToolReceipt {
  const success = isDomainSuccess(toolCall, transportSuccess, result);
  let projection = genericProjection({ result, success, toolCall });

  for (const projector of projectors) {
    projection = mergeProjection(
      projection,
      projector({ result, success, toolCall }),
    );
  }

  const explicitNoChange = /"noChange"\s*:\s*true|未变化|unchanged/i.test(result);
  const toolUseId = toolCall.id;
  const resultHash = stableReceiptHash(result);
  const inputHash = stableReceiptHash(toolCall.rawInput ?? toolCall.input);

  return {
    category: inferCategory(toolCall.name),
    domainStatus: explicitNoChange
      ? "unchanged"
      : success
        ? "succeeded"
        : "failed",
    durationMs: Math.max(0, endedAt - startedAt),
    endedAt,
    ...(!success ? { error: compact(result, 1_200) } : {}),
    id: `${toolUseId}:${inputHash}:${resultHash}`,
    input: toolCall.input,
    inputHash,
    inputSummary: compact(
      toolCall.rawInput ?? JSON.stringify(toolCall.input ?? {}),
    ),
    projection,
    result,
    resultHash,
    resultSummary: compact(result),
    reused: false,
    startedAt,
    strategySignature: createStrategySignature(toolCall),
    success,
    toolName: toolCall.name,
    toolUseId,
    unchanged: explicitNoChange,
  };
}

function initialObservedState(): ObservedState {
  return {
    artifacts: {},
    commands: [],
    evidence: {},
    files: {},
    receipts: [],
    stateHash: stableReceiptHash("empty"),
    unresolvedErrors: [],
    verification: [],
  };
}

function stateHash(state: Omit<ObservedState, "stateHash">) {
  return stableReceiptHash({
    artifacts: state.artifacts,
    commands: state.commands,
    evidence: state.evidence,
    files: state.files,
    unresolvedErrors: state.unresolvedErrors,
    verification: state.verification,
  });
}

export class ReceiptRegistry {
  private state = initialObservedState();
  private readonly byExecutionKey = new Map<string, ToolReceipt>();
  private readonly fingerprints = new Set<string>();

  findCompleted(toolUseId: string, inputHash: string) {
    return this.byExecutionKey.get(`${toolUseId}:${inputHash}`);
  }

  record(receipt: ToolReceipt) {
    const executionKey = `${receipt.toolUseId}:${receipt.inputHash}`;
    const completed = this.byExecutionKey.get(executionKey);

    if (completed) {
      return { ...completed, reused: true };
    }

    const fingerprint = `${receipt.toolName}:${receipt.inputHash}:${receipt.resultHash}:${receipt.domainStatus}`;
    receipt.unchanged = receipt.unchanged || this.fingerprints.has(fingerprint);
    if (receipt.unchanged && receipt.success) {
      receipt.domainStatus = "unchanged";
    }
    this.fingerprints.add(fingerprint);
    this.byExecutionKey.set(executionKey, receipt);
    this.state.receipts.push(receipt);

    for (const file of receipt.projection.files ?? []) {
      this.state.files[file.path] = { ...file, receiptId: receipt.id };
    }
    for (const command of receipt.projection.commands ?? []) {
      this.state.commands.push({ ...command, receiptId: receipt.id });
    }
    for (const evidence of receipt.projection.evidence ?? []) {
      this.state.evidence[evidence.key] = {
        ...evidence,
        receiptId: receipt.id,
      };
    }
    for (const artifact of receipt.projection.artifacts ?? []) {
      this.state.artifacts[artifact.key] = {
        ...artifact,
        receiptId: receipt.id,
      };
    }
    for (const verification of receipt.projection.verification ?? []) {
      this.state.verification.push({
        ...verification,
        receiptId: receipt.id,
      });
    }

    if (!receipt.success) {
      const fingerprint = `${receipt.toolName}:${receipt.resultHash}`;
      const prior = this.state.unresolvedErrors.find(
        (error) => error.fingerprint === fingerprint && !error.resolved,
      );

      if (!prior) {
        this.state.unresolvedErrors.push({
          fingerprint,
          message: receipt.resultSummary,
          receiptId: receipt.id,
          resolved: false,
          strategySignature: receipt.strategySignature,
          toolName: receipt.toolName,
        });
      }
    } else {
      const closesArtifactErrors =
        (receipt.projection.verification ?? []).some(
          (verification) => verification.passed,
        ) ||
        (receipt.projection.artifacts ?? []).some(
          (artifact) => artifact.status === "validated",
        );
      for (const error of this.state.unresolvedErrors) {
        const failedReceipt = this.state.receipts.find(
          (candidate) => candidate.id === error.receiptId,
        );
        if (
          !error.resolved &&
          (error.strategySignature === receipt.strategySignature ||
            (closesArtifactErrors &&
              (failedReceipt?.category === "artifact" ||
                failedReceipt?.category === "verification")))
        ) {
          error.resolved = true;
        }
      }
    }

    this.state.stateHash = stateHash({
      artifacts: this.state.artifacts,
      commands: this.state.commands,
      evidence: this.state.evidence,
      files: this.state.files,
      receipts: this.state.receipts,
      unresolvedErrors: this.state.unresolvedErrors,
      verification: this.state.verification,
    });
    return receipt;
  }

  snapshot(): ObservedState {
    return structuredClone(this.state);
  }
}
