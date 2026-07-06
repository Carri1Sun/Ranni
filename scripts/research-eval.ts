import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { runAgentTurn } from "../lib/agent";
import {
  createMessage,
  getModelRuntimeInfo,
  hasModelApiKey,
  type AgentAssistantBlock,
  type AgentMessage,
  type ModelConnectionConfig,
} from "../lib/llm";
import type { StreamEvent } from "../lib/trace";
import { EventBus, type PublishedEvent } from "../lib/events/event-bus";
import { RunRegistry } from "../lib/runs/run-registry";
import { loadEnvFiles } from "../src/server/env";

// v2 事件 → 旧 StreamEvent：评测脚本的分析逻辑仍按旧事件格式编写，
// 订阅到 v2 事件后用此函数反向映射回旧格式，保持分析逻辑不变。
function toLegacyEvent(event: PublishedEvent): StreamEvent | null {
  const e = event as Record<string, unknown> & { type: string };

  switch (e.type) {
    case "run.started":
      return {
        prompt: e.prompt,
        runId: e.runId,
        runtime: e.runtime,
        startedAt: e.startedAt,
        toolDefinitions: e.toolDefinitions,
        type: "run_started",
      } as unknown as StreamEvent;
    case "run.completed":
      return {
        durationMs: e.durationMs,
        endedAt: e.endedAt,
        ...(e.error ? { error: e.error } : {}),
        runId: e.runId,
        status: e.status,
        totalSteps: e.totalSteps,
        type: "run_completed",
      } as unknown as StreamEvent;
    case "step.started":
      return {
        runId: e.runId,
        startedAt: e.startedAt,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "step_started",
      } as unknown as StreamEvent;
    case "step.completed":
      return {
        durationMs: e.durationMs,
        endedAt: e.endedAt,
        runId: e.runId,
        status: e.status,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        ...(e.stopReason !== undefined ? { stopReason: e.stopReason } : {}),
        type: "step_completed",
      } as unknown as StreamEvent;
    case "tool.started":
      return {
        arguments: e.arguments,
        name: e.name,
        runId: e.runId,
        startedAt: e.startedAt,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        toolUseId: e.toolUseId,
        type: "tool_call",
      } as unknown as StreamEvent;
    case "tool.completed":
      return {
        durationMs: e.durationMs,
        name: e.name,
        result: e.result,
        runId: e.runId,
        startedAt: e.startedAt,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        success: e.success,
        toolUseId: e.toolUseId,
        type: "tool_result",
      } as unknown as StreamEvent;
    case "text.completed":
      return {
        message: e.message,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "assistant",
      } as unknown as StreamEvent;
    case "thinking.completed":
      return {
        message: e.message,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        timestamp: e.timestamp ?? Date.now(),
        type: "thinking",
      } as unknown as StreamEvent;
    case "model.request":
      return {
        request: e.request,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "model_request",
      } as unknown as StreamEvent;
    case "model.response":
      return {
        response: e.response,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "model_response",
      } as unknown as StreamEvent;
    case "context.snapshot":
      return {
        context: e.context,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "context_snapshot",
      } as unknown as StreamEvent;
    case "task.state":
      return {
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        taskState: e.taskState,
        type: "task_state",
      } as unknown as StreamEvent;
    case "research.state":
      return {
        researchState: e.researchState,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        type: "research_state",
      } as unknown as StreamEvent;
    case "run.status":
      return {
        message: e.message,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        timestamp: e.timestamp ?? Date.now(),
        type: "status",
      } as unknown as StreamEvent;
    case "text.delta":
      return {
        delta: e.delta,
        ...(e.reset ? { reset: true } : {}),
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        timestamp: e.timestamp ?? Date.now(),
        type: "assistant_delta",
      } as unknown as StreamEvent;
    case "thinking.delta":
      return {
        delta: e.delta,
        runId: e.runId,
        stepId: e.stepId,
        stepIndex: e.stepIndex,
        timestamp: e.timestamp ?? Date.now(),
        type: "thinking_delta",
      } as unknown as StreamEvent;
    default:
      return null;
  }
}

type ResearchCase = {
  id: string;
  prompt: string;
  referenceResultPath?: string;
  referenceTracePath?: string;
  suite: "smoke" | "high";
  title: string;
};

type CliOptions = {
  caseId?: string;
  compare?: [string, string];
  judge: boolean;
  judgePair?: [string, string];
  judgeRun?: string;
  label: string;
  outDir: string;
  reanalyze?: string;
  reference?: string;
  repeats: number;
  suite?: "smoke" | "high";
  timeoutMs: number;
  workspaceRoot: string;
};

type ToolCallRecord = {
  arguments: unknown;
  name: string;
};

type MemoryArtifacts = {
  files: Array<{
    chars: number;
    exists: boolean;
    name: string;
    nonEmpty: boolean;
  }>;
  readBackSignals: number;
  runDirectory: string | null;
  sourceNoteCount: number;
};

type ResearchMetrics = {
  artifact: MemoryArtifacts;
  caseId: string;
  durationMs: number | null;
  final: {
    chars: number;
    citationLikeCount: number;
    hasMethodologySynthesis: boolean;
    hasThesis: boolean;
    headingCount: number;
  };
  guard: {
    chunkedFinalContinueCount: number;
    completionGuardCount: number;
    lengthFinalChunkRepairCount: number;
    lengthFinalRepairCount: number;
    modelFailureRecoveryCount: number;
    researchAnswerQualityGuardCount: number;
    researchFinalizationGuardCount: number;
  };
  model: {
    model: string;
    provider: string;
  };
  runId: string | null;
  score: {
    dimensions: Record<string, number>;
    total: number;
  };
  status: string | null;
  tools: {
    coverageMatrixWrites: number;
    fetchUrlCount: number;
    fetchedUrls: string[];
    planResearchCount: number;
    readTaskMemoryCount: number;
    recordResearchFindingCount: number;
    recordTaskEvidenceCount: number;
    reviewResearchStateCount: number;
    searchCategories: string[];
    searchQueries: string[];
    searchWebCount: number;
    sourceLedgerWrites: number;
    synthesisBriefWrites: number;
    totalToolCalls: number;
    uniqueSearchQueryCount: number;
    updateTaskMemoryCount: number;
  };
};

type JudgeDimension = {
  evidence: string;
  improvement: string;
  name: string;
  note?: string;
  rationale: string;
  score: number;
};

type JudgeRubric = {
  claimAudit: Array<{
    claim: string;
    issue: string;
    sourceAlignment: "supported" | "partially_supported" | "unsupported" | "unclear";
  }>;
  dimensions: JudgeDimension[];
  harnessImplications: Array<{
    likelyHarnessCause: string;
    suggestedChange: string;
    userVisibleIssue: string;
  }>;
  likelyUserComplaints: string[];
  objectiveScore: number;
  overallScore: number;
  productScore: number;
  strengths: string[];
  summary: string;
  weaknesses: string[];
};

type PairwiseJudge = {
  decision: "a" | "b" | "tie";
  dimensionWinners: Array<{
    dimension: string;
    rationale: string;
    winner: "a" | "b" | "tie";
  }>;
  harnessImplications: string[];
  rationale: string;
  userPreferenceReason: string;
};

type StyleJudgeDimension = {
  antiPattern: string;
  improvement: string;
  name: string;
  note: string;
  score: number;
};

type StyleJudge = {
  aiFlavorRisk: number;
  dimensions: StyleJudgeDimension[];
  harnessImplications: Array<{
    likelyHarnessCause: string;
    suggestedChange: string;
    userVisibleIssue: string;
  }>;
  readerExperience: string;
  readerValueScore: number;
  rewriteAdvice: string[];
  strengths: string[];
  styleScore: number;
  summary: string;
  weaknesses: string[];
};

type JudgedRun = {
  rubric: JudgeRubric;
  style: StyleJudge;
};

const CASES: ResearchCase[] = [
  {
    id: "agent-eval-landscape",
    suite: "smoke",
    title: "Agent evaluation landscape",
    referenceResultPath: "docs/research-optimize/chatgpt-pro-research-result.md",
    referenceTracePath: "docs/research-optimize/chatgpt-pro-research-trace.md",
    prompt:
      "详细的搜索、总结来向我介绍一下学术界和工业界最新的关于 Agent 的评测相关的工作和方法论。请覆盖最新 benchmark、工业实践、评测基础设施、安全/可靠性、judge 方法、成本与开放问题，并给出有来源支撑的综合判断。",
  },
  {
    id: "agent-context-engineering",
    suite: "high",
    title: "Agent context engineering",
    prompt:
      "请做一次 deep research：2025-2026 年 agent 上下文工程、memory、trajectory compression、subagent/context sharding、tool result 管理有哪些最新方法和工业实践？请区分学术论文、产品文档、工程博客，并总结可落地的方法论。",
  },
  {
    id: "enterprise-rag-evaluation",
    suite: "high",
    title: "Enterprise RAG evaluation",
    prompt:
      "请详细调研企业级 RAG/Agentic RAG 的最新评测方法：数据集构建、groundedness、citation quality、检索覆盖、权限安全、生产监控、人工校准和成本指标。请结合学术界和工业界一手资料。",
  },
  {
    id: "code-agent-safety",
    suite: "high",
    title: "Code agent safety and eval",
    prompt:
      "请做一份关于 coding agent 安全与可靠性评测的深度调研：SWE 类 benchmark、terminal/CLI 环境、sandbox 隔离、权限边界、恶意任务、回归评测、工业上线监控分别有什么新进展和方法论？",
  },
  {
    id: "browser-computer-use-eval",
    suite: "high",
    title: "Browser and computer-use eval",
    prompt:
      "请调研 browser agent 与 computer-use agent 的最新评测工作：WebArena/OSWorld/AndroidWorld 及后续改进、真实网页/桌面环境验证、视觉 grounding、安全隐私设置、human-in-the-loop、轨迹级 judge 和 benchmark 可信度问题。",
  },
  {
    id: "ai-research-agent-methodology",
    suite: "high",
    title: "AI research agent methodology",
    prompt:
      "请调研 deep research agent / AI research assistant 的方法论与评测：开放网络信息搜集、报告质量、citation alignment、多模态证据、长时程研究、expert review、反证搜索和防幻觉机制。请优先使用一手来源。",
  },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    judge: false,
    label: "run",
    outDir: "research/research-eval",
    repeats: 1,
    timeoutMs: 20 * 60 * 1000,
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--case" && next) {
      options.caseId = next;
      index += 1;
    } else if (arg === "--suite" && next) {
      if (next !== "smoke" && next !== "high") {
        throw new Error(`未知 suite: ${next}`);
      }

      options.suite = next;
      index += 1;
    } else if (arg === "--label" && next) {
      options.label = next;
      index += 1;
    } else if (arg === "--repeats" && next) {
      options.repeats = Math.max(1, Number.parseInt(next, 10));
      index += 1;
    } else if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Math.max(30_000, Number.parseInt(next, 10));
      index += 1;
    } else if (arg === "--workspace-root" && next) {
      options.workspaceRoot = path.resolve(next);
      index += 1;
    } else if (arg === "--compare" && next && argv[index + 2]) {
      options.compare = [next, argv[index + 2]];
      index += 2;
    } else if (arg === "--judge") {
      options.judge = true;
    } else if (arg === "--judge-run" && next) {
      options.judgeRun = next;
      index += 1;
    } else if (arg === "--judge-pair" && next && argv[index + 2]) {
      options.judgePair = [next, argv[index + 2]];
      index += 2;
    } else if (arg === "--reference" && next) {
      options.reference = next;
      index += 1;
    } else if (arg === "--reanalyze" && next) {
      options.reanalyze = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run research:eval -- --case agent-eval-landscape --label baseline
  npm run research:eval -- --suite high --label improved-v1 --repeats 3
  npm run research:eval -- --compare <baseline> <candidate> --reference chatgpt-pro
  npm run research:eval -- --judge-run <run>
  npm run research:eval -- --judge-pair <baseline> <candidate>

Options:
  --case <id>              Run one research case.
  --suite <smoke|high>     Run a suite. high includes every case.
  --label <label>          Label for output directories.
  --repeats <n>            Repeated runs per case.
  --workspace-root <path>  Workspace for Ranni tools and .ranni memory.
  --out-dir <path>         Output directory. Default: research/research-eval.
  --timeout-ms <n>         Wall-clock timeout per run. Default: 1200000.
  --compare <a> <b>        Compare two previous run directories or substrings.
  --judge                  Run LLM-as-judge after each new research run.
  --judge-run <run>        Judge one previous run directory or substring.
  --judge-pair <a> <b>     Blind pairwise judge between two previous runs or files.
  --reanalyze <run>        Recompute metrics/score/analysis for an existing run directory or substring.
  --reference <name>       Optional reference, currently chatgpt-pro.
`);
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function timestampSegment() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function buildModelConfigFromEnv(): ModelConnectionConfig {
  return {
    apiKey: process.env.LLM_API_KEY?.trim() || undefined,
    baseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY?.trim() || undefined,
    model: process.env.LLM_MODEL?.trim() || undefined,
    provider: process.env.LLM_PROVIDER?.trim() || undefined,
    qwenApiKey: process.env.QWEN_API_KEY?.trim() || undefined,
  };
}

function assertModelRunnable(modelConfig: ModelConnectionConfig) {
  if (!hasModelApiKey(modelConfig)) {
    const runtime = getModelRuntimeInfo(modelConfig);
    throw new Error(
      `缺少模型 API Key，无法运行 research eval。provider=${runtime.provider}。请配置 DEEPSEEK_API_KEY、QWEN_API_KEY 或 LLM_API_KEY。`,
    );
  }
}

function assertRunnable(modelConfig: ModelConnectionConfig) {
  assertModelRunnable(modelConfig);

  if (!process.env.TAVILY_API_KEY?.trim()) {
    throw new Error(
      "缺少 TAVILY_API_KEY，无法运行需要 web search 的 research eval。请在 .env 或 .env.local 中配置。",
    );
  }
}

function selectCases(options: CliOptions) {
  if (options.caseId) {
    const found = CASES.find((item) => item.id === options.caseId);

    if (!found) {
      throw new Error(`未知 case: ${options.caseId}`);
    }

    return [found];
  }

  if (options.suite === "smoke") {
    return CASES.filter((item) => item.suite === "smoke").slice(0, 2);
  }

  if (options.suite === "high") {
    return CASES;
  }

  throw new Error("请提供 --case、--suite 或 --compare。");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStringField(value: unknown, key: string) {
  return isObject(value) && typeof value[key] === "string"
    ? value[key].trim()
    : "";
}

function getToolCalls(events: StreamEvent[]) {
  return events
    .filter((event) => event.type === "tool_call")
    .map(
      (event): ToolCallRecord => ({
        arguments: event.arguments,
        name: event.name,
      }),
    );
}

function classifySearchQuery(query: string) {
  const lower = query.toLowerCase();
  const categories = new Set<string>();

  if (/arxiv|paper|survey|benchmark|bench|openreview|neurips|iclr|icml|acl/.test(lower)) {
    categories.add("academic");
  }
  if (/openai|anthropic|google|deepmind|microsoft|industry|production|evals|blog/.test(lower)) {
    categories.add("industry");
  }
  if (/safety|security|privacy|prompt injection|harm|attack|risk|robust/.test(lower)) {
    categories.add("safety");
  }
  if (/judge|grader|rubric|human|trajectory|process|eval awareness|contamination/.test(lower)) {
    categories.add("methodology");
  }
  if (/harness|scaffold|protocol|mcp|infrastructure|cost|latency|token/.test(lower)) {
    categories.add("infrastructure");
  }
  if (/counter|limitation|failure|critique|trustworthy|exploit|gap/.test(lower)) {
    categories.add("counterevidence");
  }

  if (categories.size === 0) {
    categories.add("general");
  }

  return [...categories];
}

function countCitationLikeLinks(finalText: string) {
  const markdownLinks = finalText.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g)?.length ?? 0;
  const referenceLinks = finalText.match(/\[[0-9]+\]/g)?.length ?? 0;
  const bareUrls = finalText.match(/https?:\/\/\S+/g)?.length ?? 0;

  return markdownLinks + referenceLinks + bareUrls;
}

function getTextFromAssistantBlocks(blocks: AgentAssistantBlock[]) {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractJsonObject<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const direct = tryParseJson<T>(cleaned);

  if (direct.ok) {
    return direct.value;
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start >= 0 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    const parsed = tryParseJson<T>(sliced);

    if (parsed.ok) {
      return parsed.value;
    }
  }

  throw new Error(`Judge 没有返回可解析 JSON：${text.slice(0, 1200)}`);
}

function tryParseJson<T>(value: string) {
  try {
    return {
      ok: true as const,
      value: JSON.parse(value) as T,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "JSON parse failed",
      ok: false as const,
    };
  }
}

async function readIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }

    throw error;
  }
}

async function inspectMemoryArtifacts(workspaceRoot: string, runId: string | null, toolCalls: ToolCallRecord[]) {
  if (!runId) {
    return {
      files: [],
      readBackSignals: 0,
      runDirectory: null,
      sourceNoteCount: 0,
    } satisfies MemoryArtifacts;
  }

  const runDirectory = path.join(workspaceRoot, ".ranni", "runs", runId);
  const artifactNames = [
    "source-ledger.md",
    "claim-ledger.md",
    "coverage-matrix.md",
    "synthesis-brief.md",
    "negative_results.md",
    "evidence.md",
  ];
  const files = await Promise.all(
    artifactNames.map(async (name) => {
      const content = await readIfExists(path.join(runDirectory, name));
      return {
        chars: content.length,
        exists: Boolean(content),
        name,
        nonEmpty: content.replace(/^# .+|Created: .+|\s+/gm, "").length > 20,
      };
    }),
  );
  const sourcesDirectory = path.join(runDirectory, "sources");
  let sourceNoteCount = 0;

  try {
    sourceNoteCount = (await fs.readdir(sourcesDirectory)).filter((name) =>
      name.endsWith(".md"),
    ).length;
  } catch {
    sourceNoteCount = 0;
  }

  const readBackSignals = toolCalls.filter((call) => {
    if (call.name === "read_task_memory") {
      return true;
    }

    if (call.name !== "read_file") {
      return false;
    }

    const filePath = readStringField(call.arguments, "path");
    return /source-ledger|claim-ledger|coverage-matrix|synthesis-brief|evidence\.md/.test(
      filePath,
    );
  }).length;

  return {
    files,
    readBackSignals,
    runDirectory,
    sourceNoteCount,
  } satisfies MemoryArtifacts;
}

function countAutomaticMemoryReadBackSignals(events: StreamEvent[]) {
  let sawStructuredMemoryWrite = false;
  let count = 0;

  for (const event of events) {
    if (event.type === "tool_call" && event.name === "update_task_memory") {
      const section = readStringField(event.arguments, "section");

      if (
        section === "source_ledger" ||
        section === "claim_ledger" ||
        section === "coverage_matrix" ||
        section === "synthesis_brief"
      ) {
        sawStructuredMemoryWrite = true;
      }
    }

    if (!sawStructuredMemoryWrite || event.type !== "context_snapshot") {
      continue;
    }

    const systemPrompt = event.context.systemPrompt;

    if (
      /source-ledger\.md|claim-ledger\.md|coverage-matrix\.md|synthesis-brief\.md/.test(
        systemPrompt,
      ) &&
      /## coverage-matrix\.md|## synthesis-brief\.md|## source-ledger\.md|## claim-ledger\.md/.test(
        systemPrompt,
      )
    ) {
      count += 1;
    }
  }

  return count;
}

function scoreMetrics(metrics: Omit<ResearchMetrics, "score">) {
  const sourceDiscovery = Math.min(
    5,
    metrics.tools.searchWebCount * 0.6 +
      metrics.tools.uniqueSearchQueryCount * 0.4 +
      metrics.tools.fetchUrlCount * 0.8,
  );
  const evidenceDiscipline = Math.min(
    5,
    metrics.tools.recordResearchFindingCount * 1.2 +
      metrics.tools.recordTaskEvidenceCount +
      metrics.final.citationLikeCount * 0.25,
  );
  const citationDisciplineCap =
    metrics.tools.fetchUrlCount >= 3 && metrics.final.citationLikeCount < 5 ? 3 : 5;
  const coverage = Math.min(
    5,
    metrics.tools.searchCategories.length * 0.6 +
      metrics.tools.reviewResearchStateCount * 1.2 +
      metrics.tools.coverageMatrixWrites,
  );
  const memoryUse = Math.min(
    5,
    metrics.tools.sourceLedgerWrites +
      metrics.tools.coverageMatrixWrites +
      metrics.tools.synthesisBriefWrites +
      metrics.artifact.readBackSignals * 1.2,
  );
  const synthesis = Math.min(
    5,
    (metrics.final.hasThesis ? 1.5 : 0) +
      (metrics.final.hasMethodologySynthesis ? 1.5 : 0) +
      Math.min(1, metrics.final.headingCount / 4) +
      Math.min(1, metrics.final.chars / 5000),
  );
  const trajectory = Math.min(
    5,
    metrics.tools.searchCategories.length * 0.5 +
      metrics.tools.fetchUrlCount * 0.4 +
      metrics.guard.researchFinalizationGuardCount * 0.6 +
      (metrics.tools.uniqueSearchQueryCount >= 4 ? 1 : 0),
  );
  const dimensions = {
    coverage: roundScore(coverage),
    evidenceDiscipline: roundScore(
      Math.min(evidenceDiscipline, citationDisciplineCap),
    ),
    memoryUse: roundScore(memoryUse),
    sourceDiscovery: roundScore(sourceDiscovery),
    synthesis: roundScore(synthesis),
    trajectory: roundScore(trajectory),
  };
  const uncappedTotal = Object.values(dimensions).reduce(
    (sum, value) => sum + value,
    0,
  );
  const failedRunCap =
    metrics.status === "failed" ? (metrics.final.chars > 0 ? 20 : 12) : 30;
  const total = roundScore(Math.min(uncappedTotal, failedRunCap));

  return {
    dimensions,
    total,
  };
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

async function analyzeRun({
  caseId,
  events,
  finalText,
  workspaceRoot,
}: {
  caseId: string;
  events: StreamEvent[];
  finalText: string;
  workspaceRoot: string;
}) {
  const visibleFinalText = /^\((?:no|empty) final answer\)\s*$/i.test(
    finalText.trim(),
  )
    ? ""
    : finalText;
  const toolCalls = getToolCalls(events);
  const runStarted = events.find((event) => event.type === "run_started");
  const runCompleted = [...events].reverse().find((event) => event.type === "run_completed");
  const runId = runStarted?.type === "run_started" ? runStarted.runId : null;
  const runtime = runStarted?.type === "run_started" ? runStarted.runtime : null;
  const searchQueries = toolCalls
    .filter((call) => call.name === "search_web")
    .map((call) => readStringField(call.arguments, "query"))
    .filter(Boolean);
  const fetchedUrls = toolCalls
    .filter((call) => call.name === "fetch_url")
    .map((call) => readStringField(call.arguments, "url"))
    .filter(Boolean);
  const searchCategories = [
    ...new Set(searchQueries.flatMap((query) => classifySearchQuery(query))),
  ].sort();
  const memorySections = toolCalls
    .filter((call) => call.name === "update_task_memory")
    .map((call) => readStringField(call.arguments, "section"));
  const artifact = await inspectMemoryArtifacts(workspaceRoot, runId, toolCalls);
  artifact.readBackSignals += countAutomaticMemoryReadBackSignals(events);
  const baseMetrics = {
    artifact,
    caseId,
    durationMs:
      runCompleted?.type === "run_completed" ? runCompleted.durationMs : null,
    final: {
      chars: visibleFinalText.length,
      citationLikeCount: countCitationLikeLinks(visibleFinalText),
      hasMethodologySynthesis:
        /方法论|methodology|框架|原则|趋势|未解|open question|tradeoff/i.test(
          visibleFinalText,
        ),
      hasThesis: /总判断|核心判断|结论|我的判断|总体来看|趋势是/i.test(
        visibleFinalText,
      ),
      headingCount: visibleFinalText.match(/^#{1,4}\s+/gm)?.length ?? 0,
    },
    guard: {
      chunkedFinalContinueCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "chunked_final_continue",
      ).length,
      completionGuardCount: events.filter(
        (event) => event.type === "step_completed" && event.stopReason === "completion_guard",
      ).length,
      lengthFinalChunkRepairCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "length_final_chunk_repair",
      ).length,
      lengthFinalRepairCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "length_final_repair",
      ).length,
      modelFailureRecoveryCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "model_failure_recovery",
      ).length,
      researchAnswerQualityGuardCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "research_answer_quality_guard",
      ).length,
      researchFinalizationGuardCount: events.filter(
        (event) =>
          event.type === "step_completed" &&
          event.stopReason === "research_finalization_guard",
      ).length,
    },
    model: {
      model: runtime?.model ?? "(unknown)",
      provider: runtime?.provider ?? "(unknown)",
    },
    runId,
    status: runCompleted?.type === "run_completed" ? runCompleted.status : null,
    tools: {
      coverageMatrixWrites: memorySections.filter((section) => section === "coverage_matrix").length,
      fetchUrlCount: fetchedUrls.length,
      fetchedUrls,
      planResearchCount: toolCalls.filter((call) => call.name === "plan_research").length,
      readTaskMemoryCount: toolCalls.filter((call) => call.name === "read_task_memory").length,
      recordResearchFindingCount: toolCalls.filter((call) => call.name === "record_research_finding").length,
      recordTaskEvidenceCount: toolCalls.filter((call) => call.name === "record_task_evidence").length,
      reviewResearchStateCount: toolCalls.filter((call) => call.name === "review_research_state").length,
      searchCategories,
      searchQueries,
      searchWebCount: searchQueries.length,
      sourceLedgerWrites: memorySections.filter((section) => section === "source_ledger").length,
      synthesisBriefWrites: memorySections.filter((section) => section === "synthesis_brief").length,
      totalToolCalls: toolCalls.length,
      uniqueSearchQueryCount: new Set(searchQueries).size,
      updateTaskMemoryCount: memorySections.length,
    },
  } satisfies Omit<ResearchMetrics, "score">;

  return {
    ...baseMetrics,
    score: scoreMetrics(baseMetrics),
  } satisfies ResearchMetrics;
}

function buildFailureAttribution(metrics: ResearchMetrics) {
  const findings: string[] = [];

  if (metrics.tools.searchWebCount === 0) {
    findings.push("模型能力未被 research prompt 唤起：没有执行 web discovery。");
  }

  if (metrics.status === "failed") {
    findings.push("交付失败：run 已失败，未能稳定产出最终答案。");
  }

  if (metrics.status === "failed" && metrics.final.chars === 0) {
    findings.push("最终综合恢复不足：已有 trajectory/evidence 但没有 final answer。");
  }

  if (metrics.tools.searchWebCount > 1 && metrics.tools.uniqueSearchQueryCount <= 1) {
    findings.push("动态扩展不足：搜索 query 重复度高。");
  }

  if (metrics.tools.searchWebCount >= 2 && metrics.tools.fetchUrlCount === 0) {
    findings.push("工具结果信息密度不足：停留在 search snippets，没有正文核验。");
  }

  if (
    metrics.tools.fetchUrlCount > 0 &&
    metrics.tools.recordResearchFindingCount + metrics.tools.recordTaskEvidenceCount === 0
  ) {
    findings.push("证据纪律不足：抓取了来源但没有形成可审计 finding/evidence。");
  }

  if (metrics.tools.searchWebCount >= 3 && metrics.tools.reviewResearchStateCount === 0) {
    findings.push("缺少 coverage audit：最终前没有显式检查缺口、冲突和弱证据。");
  }

  if (
    metrics.tools.searchWebCount + metrics.tools.fetchUrlCount >= 6 &&
    metrics.tools.updateTaskMemoryCount === 0
  ) {
    findings.push("文件记忆使用不足：来源/claim 较多但没有外部 ledger 或 synthesis brief。");
  }

  if (metrics.tools.updateTaskMemoryCount > 0 && metrics.artifact.readBackSignals === 0) {
    findings.push("文件记忆复用不足：写了中间文件但最终综合前没有明显读回。");
  }

  if (metrics.guard.researchFinalizationGuardCount === 0 && metrics.score.total < 16) {
    findings.push("guard 可能过早放行：总分偏低但没有触发 research finalization guard。");
  }

  if (metrics.final.citationLikeCount < 5) {
    findings.push("引用纪律不足：最终报告中的可见引用或链接偏少。");
  }

  return findings.length > 0 ? findings : ["未发现明显 trajectory 层面的硬缺口。"];
}

function renderTrajectoryAnalysis(metrics: ResearchMetrics) {
  const attribution = buildFailureAttribution(metrics);

  return [
    `# Trajectory Analysis: ${metrics.caseId}`,
    "",
    "## Run",
    `- Run ID: ${metrics.runId ?? "(unknown)"}`,
    `- Status: ${metrics.status ?? "(unknown)"}`,
    `- Model: ${metrics.model.provider} / ${metrics.model.model}`,
    `- Duration: ${metrics.durationMs ?? "(unknown)"} ms`,
    "",
    "## Research Signals",
    `- Tool calls: ${metrics.tools.totalToolCalls}`,
    `- search_web: ${metrics.tools.searchWebCount}`,
    `- unique search queries: ${metrics.tools.uniqueSearchQueryCount}`,
    `- search categories: ${metrics.tools.searchCategories.join(", ") || "(none)"}`,
    `- fetch_url: ${metrics.tools.fetchUrlCount}`,
    `- record_research_finding: ${metrics.tools.recordResearchFindingCount}`,
    `- record_task_evidence: ${metrics.tools.recordTaskEvidenceCount}`,
    `- review_research_state: ${metrics.tools.reviewResearchStateCount}`,
    `- research finalization guard: ${metrics.guard.researchFinalizationGuardCount}`,
    `- research answer quality guard: ${metrics.guard.researchAnswerQualityGuardCount}`,
    `- length final repair: ${metrics.guard.lengthFinalRepairCount ?? 0}`,
    `- length final chunk repair: ${metrics.guard.lengthFinalChunkRepairCount ?? 0}`,
    `- chunked final continues: ${metrics.guard.chunkedFinalContinueCount ?? 0}`,
    `- model failure recovery: ${metrics.guard.modelFailureRecoveryCount}`,
    "",
    "## Intermediate Artifacts",
    `- Run memory: ${metrics.artifact.runDirectory ?? "(none)"}`,
    `- Source notes: ${metrics.artifact.sourceNoteCount}`,
    `- Read-back signals: ${metrics.artifact.readBackSignals}`,
    ...metrics.artifact.files.map(
      (file) =>
        `- ${file.name}: ${file.exists ? `${file.chars} chars${file.nonEmpty ? "" : " (thin)"}` : "missing"}`,
    ),
    "",
    "## Failure Attribution",
    ...attribution.map((item) => `- ${item}`),
    "",
    "## Search Queries",
    metrics.tools.searchQueries.length > 0
      ? metrics.tools.searchQueries.map((query, index) => `${index + 1}. ${query}`).join("\n")
      : "- (none)",
    "",
    "## Fetched URLs",
    metrics.tools.fetchedUrls.length > 0
      ? metrics.tools.fetchedUrls.map((url, index) => `${index + 1}. ${url}`).join("\n")
      : "- (none)",
    "",
  ].join("\n");
}

function renderPartialStatus({
  eventCount,
  finalText,
  researchCase,
  startedAt,
}: {
  eventCount: number;
  finalText: string;
  researchCase: ResearchCase;
  startedAt: number;
}) {
  return [
    `# Partial Research Eval Status`,
    "",
    `- Case: ${researchCase.id}`,
    `- Title: ${researchCase.title}`,
    `- Started At: ${new Date(startedAt).toISOString()}`,
    `- Updated At: ${new Date().toISOString()}`,
    `- Events written: ${eventCount}`,
    `- Latest final chars: ${finalText.length}`,
    "",
    "This file is updated during the run so long research trajectories remain observable.",
    "",
  ].join("\n");
}

function renderScore(metrics: ResearchMetrics) {
  return [
    `# Research Eval Score: ${metrics.caseId}`,
    "",
    `Total: ${metrics.score.total} / 30`,
    "",
    "| Dimension | Score |",
    "|---|---:|",
    ...Object.entries(metrics.score.dimensions).map(
      ([name, score]) => `| ${name} | ${score} / 5 |`,
    ),
    "",
    "## Notes",
    ...buildFailureAttribution(metrics).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function clampScore(value: unknown, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(max, roundScore(numeric)));
}

function compactForJudge(value: string, maxChars = 70_000) {
  if (value.length <= maxChars) {
    return value;
  }

  const head = value.slice(0, Math.floor(maxChars * 0.62));
  const tail = value.slice(-Math.floor(maxChars * 0.32));

  return [
    head,
    "",
    `[... omitted ${value.length - head.length - tail.length} chars from the middle for judge context budget ...]`,
    "",
    tail,
  ].join("\n");
}

function buildJudgeSystemPrompt() {
  return [
    "You are a strict deep-research quality judge.",
    "Judge the final deliverable from the user's product perspective and from objective research quality.",
    "Do not reward hidden trajectory, tool calls, or effort. Evaluate only what the user can read in the final answer.",
    "Prefer concrete, source-auditable, thesis-driven synthesis over long source lists.",
    "Return valid JSON only. Do not wrap it in Markdown.",
  ].join("\n");
}

function buildRubricJudgePrompt({
  finalText,
  researchCase,
}: {
  finalText: string;
  researchCase: ResearchCase;
}) {
  return [
    "Evaluate this deep-research final answer using the quality spec below.",
    "",
    "User query:",
    researchCase.prompt,
    "",
    "Quality dimensions, each scored 0-5:",
    "1. Coverage: key dimensions, boundaries, missing areas.",
    "2. Freshness: current sources, dates, recency risk.",
    "3. Source Quality: primary sources, papers, official docs, repos, firsthand industrial writing.",
    "4. Citation Alignment: important claims trace to appropriate sources.",
    "5. Evidence Discipline: numbers, rankings, causal claims, benchmark claims are supported.",
    "6. Conflict Handling: conflicts, weak evidence, bias, limits, unresolved questions.",
    "7. Synthesis Depth: thesis-first judgment, trends, methodology abstraction, cross-source synthesis.",
    "8. Product Value: reduces user's work, helps decisions, surfaces non-obvious insight.",
    "9. Readability: first-screen value, structure, density, low template feel.",
    "10. Specificity: tailored to this query rather than generic encyclopedia content.",
    "",
    "Return compact JSON exactly with this shape:",
    "Keep every string under 60 Chinese characters. Use exactly the 10 listed dimensions. Use at most 3 claimAudit items and at most 3 harnessImplications.",
    "{",
    '  "overallScore": 0-100,',
    '  "objectiveScore": 0-100,',
    '  "productScore": 0-100,',
    '  "summary": "very short",',
    '  "strengths": ["max 3 short items"],',
    '  "weaknesses": ["max 3 short items"],',
    '  "likelyUserComplaints": ["max 3 short items"],',
    '  "dimensions": [{"name":"Coverage","score":0-5,"note":"short reason"}],',
    '  "claimAudit": [{"claim":"short","sourceAlignment":"supported|partially_supported|unsupported|unclear","issue":"short"}],',
    '  "harnessImplications": [{"userVisibleIssue":"short","likelyHarnessCause":"short","suggestedChange":"short"}]',
    "}",
    "",
    "Final answer to judge:",
    compactForJudge(finalText, 28_000),
  ].join("\n");
}

function buildTinyRubricJudgePrompt({
  finalText,
  researchCase,
}: {
  finalText: string;
  researchCase: ResearchCase;
}) {
  return [
    "Judge this deep-research answer. Return valid compact JSON only.",
    "Every string must be under 30 Chinese characters.",
    "",
    "User query:",
    researchCase.prompt,
    "",
    "Return exactly:",
    "{",
    '"overallScore":0-100,',
    '"objectiveScore":0-100,',
    '"productScore":0-100,',
    '"summary":"short",',
    '"strengths":["max2"],',
    '"weaknesses":["max2"],',
    '"likelyUserComplaints":["max2"],',
    '"dimensions":[{"name":"Coverage","score":0-5,"note":"short"},{"name":"Freshness","score":0-5,"note":"short"},{"name":"Source Quality","score":0-5,"note":"short"},{"name":"Citation Alignment","score":0-5,"note":"short"},{"name":"Evidence Discipline","score":0-5,"note":"short"},{"name":"Conflict Handling","score":0-5,"note":"short"},{"name":"Synthesis Depth","score":0-5,"note":"short"},{"name":"Product Value","score":0-5,"note":"short"},{"name":"Readability","score":0-5,"note":"short"},{"name":"Specificity","score":0-5,"note":"short"}],',
    '"claimAudit":[{"claim":"short","sourceAlignment":"supported|partially_supported|unsupported|unclear","issue":"short"}],',
    '"harnessImplications":[{"userVisibleIssue":"short","likelyHarnessCause":"short","suggestedChange":"short"}]',
    "}",
    "",
    "Answer:",
    compactForJudge(finalText, 18_000),
  ].join("\n");
}

function normalizeRubricJudge(raw: JudgeRubric) {
  return {
    claimAudit: Array.isArray(raw.claimAudit) ? raw.claimAudit.slice(0, 3) : [],
    dimensions: Array.isArray(raw.dimensions)
      ? raw.dimensions.slice(0, 12).map((dimension) => {
          const maybeDimension = dimension as JudgeDimension & { note?: unknown };
          const note = String(
            maybeDimension.note ?? maybeDimension.rationale ?? "",
          );

          return {
            evidence: String(maybeDimension.evidence ?? ""),
            improvement: String(maybeDimension.improvement ?? ""),
            name: String(dimension.name ?? "Unknown"),
            note,
            rationale: note,
            score: clampScore(dimension.score, 5),
          };
        })
      : [],
    harnessImplications: Array.isArray(raw.harnessImplications)
      ? raw.harnessImplications.slice(0, 3)
      : [],
    likelyUserComplaints: Array.isArray(raw.likelyUserComplaints)
      ? raw.likelyUserComplaints.map(String).slice(0, 3)
      : [],
    objectiveScore: clampScore(raw.objectiveScore, 100),
    overallScore: clampScore(raw.overallScore, 100),
    productScore: clampScore(raw.productScore, 100),
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String).slice(0, 3) : [],
    summary: String(raw.summary ?? ""),
    weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.map(String).slice(0, 3) : [],
  } satisfies JudgeRubric;
}

async function judgeRubric({
  finalText,
  modelConfig,
  researchCase,
}: {
  finalText: string;
  modelConfig: ModelConnectionConfig;
  researchCase: ResearchCase;
}) {
  const runJudgeRequest = async (text: string) => {
    const messages: AgentMessage[] = [
      {
        content: [
          {
            text,
            type: "text",
          },
        ],
        role: "user",
      },
    ];
    const result = await createMessage({
      messages,
      modelConfig,
      system: buildJudgeSystemPrompt(),
      tools: [],
    });

    return getTextFromAssistantBlocks(result.message.content);
  };
  const primaryText = await runJudgeRequest(
    buildRubricJudgePrompt({
      finalText,
      researchCase,
    }),
  );

  try {
    return normalizeRubricJudge(extractJsonObject<JudgeRubric>(primaryText));
  } catch {
    const fallbackText = await runJudgeRequest(
      buildTinyRubricJudgePrompt({
        finalText,
        researchCase,
      }),
    );

    return normalizeRubricJudge(extractJsonObject<JudgeRubric>(fallbackText));
  }
}

function buildStyleJudgePrompt({
  finalText,
  researchCase,
}: {
  finalText: string;
  researchCase: ResearchCase;
}) {
  return [
    "Evaluate the user-visible writing style and reading experience of this deep-research answer.",
    "Do not reward hidden trajectory or effort. Do not re-grade factual coverage except where it affects reader trust.",
    "The target is a strong research memo: thesis-led, prose-readable, source-auditable, specific to the user's task, and low in template/AI flavor.",
    "Good formatting is intentional: use headings, bullets, or tables only when they reduce reader work; avoid checklist sprawl.",
    "",
    "User query:",
    researchCase.prompt,
    "",
    "Style dimensions, each scored 0-5:",
    "1. Opening Value: first screen gives judgment and stakes.",
    "2. Authorial Voice: sounds like a thinking analyst, not a template.",
    "3. Narrative Flow: sections connect into an argument.",
    "4. Paragraph Craft: paragraphs have topic, evidence, implication.",
    "5. Format Taste: bullets/tables/headings are useful, not decorative.",
    "6. Anti-Template Naturalness: avoids generic AI phrasing and ritual sections.",
    "7. Cognitive Load: dense but readable; no wall of undifferentiated facts.",
    "8. Reader Guidance: tells the reader what matters, what changed, what to do next.",
    "9. Citation Integration: citations support reading without breaking flow.",
    "10. Domain Register: style fits the user's domain and expertise.",
    "",
    "Return compact JSON exactly with this shape:",
    "Keep every string under 60 Chinese characters. Use exactly the 10 listed dimensions. aiFlavorRisk: 0 means no AI flavor, 100 means severe template feel. Use at most 3 rewriteAdvice and 3 harnessImplications.",
    "{",
    '  "styleScore": 0-100,',
    '  "readerValueScore": 0-100,',
    '  "aiFlavorRisk": 0-100,',
    '  "summary": "very short",',
    '  "readerExperience": "very short",',
    '  "strengths": ["max 3 short items"],',
    '  "weaknesses": ["max 3 short items"],',
    '  "dimensions": [{"name":"Opening Value","score":0-5,"note":"short","antiPattern":"short","improvement":"short"}],',
    '  "rewriteAdvice": ["max 3 short items"],',
    '  "harnessImplications": [{"userVisibleIssue":"short","likelyHarnessCause":"short","suggestedChange":"short"}]',
    "}",
    "",
    "Final answer to judge:",
    compactForJudge(finalText, 26_000),
  ].join("\n");
}

function buildTinyStyleJudgePrompt({
  finalText,
  researchCase,
}: {
  finalText: string;
  researchCase: ResearchCase;
}) {
  return [
    "Judge only writing style/readability. Return valid compact JSON only.",
    "Every string must be under 30 Chinese characters.",
    "",
    "User query:",
    researchCase.prompt,
    "",
    "Return exactly:",
    "{",
    '"styleScore":0-100,',
    '"readerValueScore":0-100,',
    '"aiFlavorRisk":0-100,',
    '"summary":"short",',
    '"readerExperience":"short",',
    '"strengths":["max2"],',
    '"weaknesses":["max2"],',
    '"dimensions":[{"name":"Opening Value","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Authorial Voice","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Narrative Flow","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Paragraph Craft","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Format Taste","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Anti-Template Naturalness","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Cognitive Load","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Reader Guidance","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Citation Integration","score":0-5,"note":"short","antiPattern":"short","improvement":"short"},{"name":"Domain Register","score":0-5,"note":"short","antiPattern":"short","improvement":"short"}],',
    '"rewriteAdvice":["max2"],',
    '"harnessImplications":[{"userVisibleIssue":"short","likelyHarnessCause":"short","suggestedChange":"short"}]',
    "}",
    "",
    "Answer:",
    compactForJudge(finalText, 16_000),
  ].join("\n");
}

function normalizeStyleJudge(raw: StyleJudge) {
  return {
    aiFlavorRisk: clampScore(raw.aiFlavorRisk, 100),
    dimensions: Array.isArray(raw.dimensions)
      ? raw.dimensions.slice(0, 12).map((dimension) => ({
          antiPattern: String(dimension.antiPattern ?? ""),
          improvement: String(dimension.improvement ?? ""),
          name: String(dimension.name ?? "Unknown"),
          note: String(dimension.note ?? ""),
          score: clampScore(dimension.score, 5),
        }))
      : [],
    harnessImplications: Array.isArray(raw.harnessImplications)
      ? raw.harnessImplications.slice(0, 3).map((item) => ({
          likelyHarnessCause: String(item.likelyHarnessCause ?? ""),
          suggestedChange: String(item.suggestedChange ?? ""),
          userVisibleIssue: String(item.userVisibleIssue ?? ""),
        }))
      : [],
    readerExperience: String(raw.readerExperience ?? ""),
    readerValueScore: clampScore(raw.readerValueScore, 100),
    rewriteAdvice: Array.isArray(raw.rewriteAdvice)
      ? raw.rewriteAdvice.map(String).slice(0, 3)
      : [],
    strengths: Array.isArray(raw.strengths)
      ? raw.strengths.map(String).slice(0, 3)
      : [],
    styleScore: clampScore(raw.styleScore, 100),
    summary: String(raw.summary ?? ""),
    weaknesses: Array.isArray(raw.weaknesses)
      ? raw.weaknesses.map(String).slice(0, 3)
      : [],
  } satisfies StyleJudge;
}

async function judgeStyle({
  finalText,
  modelConfig,
  researchCase,
}: {
  finalText: string;
  modelConfig: ModelConnectionConfig;
  researchCase: ResearchCase;
}) {
  const runJudgeRequest = async (text: string) => {
    const messages: AgentMessage[] = [
      {
        content: [
          {
            text,
            type: "text",
          },
        ],
        role: "user",
      },
    ];
    const result = await createMessage({
      messages,
      modelConfig,
      system: buildJudgeSystemPrompt(),
      tools: [],
    });

    return getTextFromAssistantBlocks(result.message.content);
  };
  const primaryText = await runJudgeRequest(
    buildStyleJudgePrompt({
      finalText,
      researchCase,
    }),
  );

  try {
    return normalizeStyleJudge(extractJsonObject<StyleJudge>(primaryText));
  } catch {
    const fallbackText = await runJudgeRequest(
      buildTinyStyleJudgePrompt({
        finalText,
        researchCase,
      }),
    );

    return normalizeStyleJudge(extractJsonObject<StyleJudge>(fallbackText));
  }
}

function renderJudgeRubric(judge: JudgeRubric, researchCase: ResearchCase) {
  return [
    `# Deep Research Judge: ${researchCase.id}`,
    "",
    `Overall: ${judge.overallScore} / 100`,
    `Objective: ${judge.objectiveScore} / 100`,
    `Product: ${judge.productScore} / 100`,
    "",
    "## Summary",
    judge.summary || "(empty)",
    "",
    "## Dimensions",
    "| Dimension | Score | Rationale | Improvement |",
    "|---|---:|---|---|",
    ...judge.dimensions.map(
      (dimension) =>
        `| ${dimension.name} | ${dimension.score} / 5 | ${dimension.rationale.replace(/\|/g, "\\|")} | ${dimension.improvement.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Strengths",
    ...(judge.strengths.length > 0 ? judge.strengths : ["(none)"]).map(
      (item) => `- ${item}`,
    ),
    "",
    "## Weaknesses",
    ...(judge.weaknesses.length > 0 ? judge.weaknesses : ["(none)"]).map(
      (item) => `- ${item}`,
    ),
    "",
    "## Likely User Complaints",
    ...(judge.likelyUserComplaints.length > 0
      ? judge.likelyUserComplaints
      : ["(none)"]
    ).map((item) => `- ${item}`),
    "",
    "## Claim Audit",
    "| Claim | Alignment | Issue |",
    "|---|---|---|",
    ...judge.claimAudit.map(
      (item) =>
        `| ${item.claim.replace(/\|/g, "\\|")} | ${item.sourceAlignment} | ${item.issue.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Harness Implications",
    "| User-visible issue | Likely harness cause | Suggested change |",
    "|---|---|---|",
    ...judge.harnessImplications.map(
      (item) =>
        `| ${item.userVisibleIssue.replace(/\|/g, "\\|")} | ${item.likelyHarnessCause.replace(/\|/g, "\\|")} | ${item.suggestedChange.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ].join("\n");
}

function renderStyleJudge(judge: StyleJudge, researchCase: ResearchCase) {
  return [
    `# Deep Research Style Judge: ${researchCase.id}`,
    "",
    `Style: ${judge.styleScore} / 100`,
    `Reader Value: ${judge.readerValueScore} / 100`,
    `AI Flavor Risk: ${judge.aiFlavorRisk} / 100`,
    "",
    "## Summary",
    judge.summary || "(empty)",
    "",
    "## Reader Experience",
    judge.readerExperience || "(empty)",
    "",
    "## Dimensions",
    "| Dimension | Score | Note | Anti-pattern | Improvement |",
    "|---|---:|---|---|---|",
    ...judge.dimensions.map(
      (dimension) =>
        `| ${dimension.name.replace(/\|/g, "\\|")} | ${dimension.score} / 5 | ${dimension.note.replace(/\|/g, "\\|")} | ${dimension.antiPattern.replace(/\|/g, "\\|")} | ${dimension.improvement.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Strengths",
    ...(judge.strengths.length > 0 ? judge.strengths : ["(none)"]).map(
      (item) => `- ${item}`,
    ),
    "",
    "## Weaknesses",
    ...(judge.weaknesses.length > 0 ? judge.weaknesses : ["(none)"]).map(
      (item) => `- ${item}`,
    ),
    "",
    "## Rewrite Advice",
    ...(judge.rewriteAdvice.length > 0 ? judge.rewriteAdvice : ["(none)"]).map(
      (item) => `- ${item}`,
    ),
    "",
    "## Harness Implications",
    "| User-visible issue | Likely harness cause | Suggested change |",
    "|---|---|---|",
    ...judge.harnessImplications.map(
      (item) =>
        `| ${item.userVisibleIssue.replace(/\|/g, "\\|")} | ${item.likelyHarnessCause.replace(/\|/g, "\\|")} | ${item.suggestedChange.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ].join("\n");
}

async function judgeRunDirectory({
  modelConfig,
  runDirectory,
}: {
  modelConfig: ModelConnectionConfig;
  runDirectory: string;
}) {
  const metrics = await readMetrics(runDirectory);
  const researchCase =
    CASES.find((item) => item.id === metrics.caseId) ??
    CASES.find((item) => item.id === "agent-eval-landscape") ??
    CASES[0];
  const finalText = await readIfExists(path.join(runDirectory, "final.md"));
  const judge = await judgeRubric({
    finalText,
    modelConfig,
    researchCase,
  });
  const styleJudge = await judgeStyle({
    finalText,
    modelConfig,
    researchCase,
  });

  await Promise.all([
    fs.writeFile(
      path.join(runDirectory, "judge-rubric.json"),
      `${JSON.stringify(judge, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(runDirectory, "judge-rubric.md"),
      renderJudgeRubric(judge, researchCase),
      "utf8",
    ),
    fs.writeFile(
      path.join(runDirectory, "claim-audit.md"),
      renderClaimAudit(judge, researchCase),
      "utf8",
    ),
    fs.writeFile(
      path.join(runDirectory, "style-judge.json"),
      `${JSON.stringify(styleJudge, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(runDirectory, "style-judge.md"),
      renderStyleJudge(styleJudge, researchCase),
      "utf8",
    ),
  ]);

  return {
    rubric: judge,
    style: styleJudge,
  } satisfies JudgedRun;
}

function renderClaimAudit(judge: JudgeRubric, researchCase: ResearchCase) {
  return [
    `# Claim Audit: ${researchCase.id}`,
    "",
    "| Claim | Alignment | Issue |",
    "|---|---|---|",
    ...judge.claimAudit.map(
      (item) =>
        `| ${item.claim.replace(/\|/g, "\\|")} | ${item.sourceAlignment} | ${item.issue.replace(/\|/g, "\\|")} |`,
    ),
    "",
  ].join("\n");
}

function buildPairwiseJudgePrompt({
  answerA,
  answerB,
  prompt,
}: {
  answerA: string;
  answerB: string;
  prompt: string;
}) {
  return [
    "Blindly compare two deep-research final answers for the same user query.",
    "Do not assume A or B is the baseline. Judge only user-visible quality.",
    "",
    "User query:",
    prompt,
    "",
    "Decision criteria:",
    "- User preference and first-screen value",
    "- Trust and citation/source alignment",
    "- Coverage and freshness",
    "- Synthesis depth and non-obvious insight",
    "- Decision/action value",
    "- Readability, prose flow, and low template/AI flavor",
    "- Format taste: headings, bullets, tables, and citations should reduce reader work",
    "- Specificity to the user's source categories, comparison axes, and task context",
    "- Honest uncertainty and conflict handling",
    "",
    "Return JSON exactly with this shape:",
    "Keep every string under 180 characters. Use at most 8 dimensionWinners and at most 5 harnessImplications.",
    "{",
    '  "decision": "a|b|tie",',
    '  "rationale": "one paragraph",',
    '  "userPreferenceReason": "one paragraph",',
    '  "dimensionWinners": [{"dimension":"Trust","winner":"a|b|tie","rationale":"..."}],',
    '  "harnessImplications": ["..."]',
    "}",
    "",
    "Answer A:",
    compactForJudge(answerA, 38_000),
    "",
    "Answer B:",
    compactForJudge(answerB, 38_000),
  ].join("\n");
}

function normalizePairwiseJudge(raw: PairwiseJudge) {
  const decision = raw.decision === "a" || raw.decision === "b" ? raw.decision : "tie";

  return {
    decision,
    dimensionWinners: Array.isArray(raw.dimensionWinners)
      ? raw.dimensionWinners.slice(0, 12).map((item) => ({
          dimension: String(item.dimension ?? ""),
          rationale: String(item.rationale ?? ""),
          winner: item.winner === "a" || item.winner === "b" ? item.winner : "tie",
        }))
      : [],
    harnessImplications: Array.isArray(raw.harnessImplications)
      ? raw.harnessImplications.map(String).slice(0, 12)
      : [],
    rationale: String(raw.rationale ?? ""),
    userPreferenceReason: String(raw.userPreferenceReason ?? ""),
  } satisfies PairwiseJudge;
}

function readReferenceStats(workspaceRoot: string, researchCase: ResearchCase) {
  const resultPath = researchCase.referenceResultPath
    ? path.join(workspaceRoot, researchCase.referenceResultPath)
    : "";
  const tracePath = researchCase.referenceTracePath
    ? path.join(workspaceRoot, researchCase.referenceTracePath)
    : "";

  return Promise.all([
    resultPath ? readIfExists(resultPath) : Promise.resolve(""),
    tracePath ? readIfExists(tracePath) : Promise.resolve(""),
  ]).then(
    ([result, trace]) => ({
      citationLikeCount: countCitationLikeLinks(result),
      chars: result.length,
      headingCount: result.match(/^#{1,4}\s+/gm)?.length ?? 0,
      searchIntentCount: trace.match(/^Searching /gm)?.length ?? 0,
      traceChars: trace.length,
    }),
  );
}

async function renderReferenceComparison(
  metrics: ResearchMetrics,
  researchCase: ResearchCase,
  workspaceRoot: string,
) {
  const reference = await readReferenceStats(workspaceRoot, researchCase);

  if (reference.chars === 0 && reference.traceChars === 0) {
    return [
      `# Comparison: ${metrics.caseId}`,
      "",
      "No reference artifact configured or readable.",
      "",
    ].join("\n");
  }

  return [
    `# Comparison: ${metrics.caseId}`,
    "",
    "## Ranni Run",
    `- Final chars: ${metrics.final.chars}`,
    `- Citation-like links: ${metrics.final.citationLikeCount}`,
    `- Search queries: ${metrics.tools.searchWebCount}`,
    `- Fetches: ${metrics.tools.fetchUrlCount}`,
    `- Findings/evidence: ${
      metrics.tools.recordResearchFindingCount + metrics.tools.recordTaskEvidenceCount
    }`,
    `- Score: ${metrics.score.total} / 30`,
    "",
    "## Reference Snapshot",
    `- Reference final chars: ${reference.chars}`,
    `- Reference citation-like links: ${reference.citationLikeCount}`,
    `- Reference trace search intents: ${reference.searchIntentCount}`,
    "",
    "## Gap Reading",
    ...buildFailureAttribution(metrics).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

async function runCase({
  modelConfig,
  options,
  repeatIndex,
  researchCase,
}: {
  modelConfig: ModelConnectionConfig;
  options: CliOptions;
  repeatIndex: number;
  researchCase: ResearchCase;
}) {
  const segment = [
    timestampSegment(),
    sanitizeSegment(options.label),
    sanitizeSegment(researchCase.id),
    `r${repeatIndex}`,
  ].join("-");
  const outputDirectory = path.resolve(options.workspaceRoot, options.outDir, segment);
  await fs.mkdir(outputDirectory, { recursive: true });

  const events: StreamEvent[] = [];
  const startedAt = Date.now();
  const abortController = new AbortController();
  let timedOut = false;
  let finalText = "";
  const tracePath = path.join(outputDirectory, "trace.ndjson");
  const partialStatusPath = path.join(outputDirectory, "partial-status.md");
  const finalPath = path.join(outputDirectory, "final.md");

  console.log(`Running case=${researchCase.id} repeat=${repeatIndex} -> ${outputDirectory}`);
  await Promise.all([
    fs.writeFile(tracePath, "", "utf8"),
    fs.writeFile(finalPath, "(run in progress)\n", "utf8"),
    fs.writeFile(
      partialStatusPath,
      renderPartialStatus({
        eventCount: 0,
        finalText,
        researchCase,
        startedAt,
      }),
      "utf8",
    ),
  ]);

  const timeout = setTimeout(() => {
    timedOut = true;
    console.warn(
      `Run timeout reached after ${options.timeoutMs} ms. Aborting case=${researchCase.id} repeat=${repeatIndex}.`,
    );
    abortController.abort();
  }, options.timeoutMs);

  const sessionId = `eval-${researchCase.id}-${repeatIndex}`;
  const eventBus = new EventBus();
  const registry = new RunRegistry();
  const { runId } = registry.start({ sessionId, modelConfig });

  const unsubscribe = eventBus.subscribe(sessionId, 0, (v2Event) => {
    const event = toLegacyEvent(v2Event);

    if (!event) {
      return;
    }

    events.push(event);
    fsSync.appendFileSync(tracePath, `${JSON.stringify(event)}\n`, "utf8");

    if (event.type === "assistant") {
      finalText = event.message;
      fsSync.writeFileSync(finalPath, finalText || "(empty final answer)", "utf8");
    }

    if (
      event.type === "run_started" ||
      event.type === "step_completed" ||
      event.type === "tool_result" ||
      event.type === "run_completed" ||
      event.type === "assistant"
    ) {
      fsSync.writeFileSync(
        partialStatusPath,
        renderPartialStatus({
          eventCount: events.length,
          finalText,
          researchCase,
          startedAt,
        }),
        "utf8",
      );
    }
  });

  try {
    await runAgentTurn({
      runId,
      sessionId,
      streamKey: sessionId,
      eventBus,
      messages: [
        {
          role: "user",
          content: researchCase.prompt,
        },
      ],
      modelConfig,
      signal: abortController.signal,
      toolSettings: {
        tavilyApiKey: process.env.TAVILY_API_KEY?.trim(),
      },
      workspaceRoot: options.workspaceRoot,
    });
  } finally {
    unsubscribe();
    clearTimeout(timeout);
  }

  const metrics = await analyzeRun({
    caseId: researchCase.id,
    events,
    finalText,
    workspaceRoot: options.workspaceRoot,
  });
  const metadata = [
    `# Research Eval Run`,
    "",
    `- Case: ${researchCase.id}`,
    `- Title: ${researchCase.title}`,
    `- Label: ${options.label}`,
    `- Repeat: ${repeatIndex}`,
    `- Started At: ${new Date(startedAt).toISOString()}`,
    `- Output Directory: ${outputDirectory}`,
    `- Timed Out: ${timedOut ? "yes" : "no"}`,
    `- Timeout Ms: ${options.timeoutMs}`,
    "",
  ].join("\n");

  await Promise.all([
    fs.writeFile(path.join(outputDirectory, "final.md"), finalText || "(no final answer)", "utf8"),
    fs.writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(outputDirectory, "score.md"), renderScore(metrics), "utf8"),
    fs.writeFile(path.join(outputDirectory, "trajectory-analysis.md"), renderTrajectoryAnalysis(metrics), "utf8"),
    fs.writeFile(
      path.join(outputDirectory, "comparison.md"),
      await renderReferenceComparison(metrics, researchCase, options.workspaceRoot),
      "utf8",
    ),
    fs.writeFile(path.join(outputDirectory, "metadata.md"), metadata, "utf8"),
  ]);

  if (options.judge) {
    const judged = await judgeRunDirectory({
      modelConfig,
      runDirectory: outputDirectory,
    });
    console.log(
      [
        `Judge overall=${judged.rubric.overallScore}/100`,
        `product=${judged.rubric.productScore}/100`,
        `style=${judged.style.styleScore}/100`,
        `aiFlavorRisk=${judged.style.aiFlavorRisk}/100`,
      ].join(" "),
    );
  }

  console.log(
    `Completed case=${researchCase.id} repeat=${repeatIndex} score=${metrics.score.total}/30`,
  );
}

async function resolveRunDirectory(outDir: string, needle: string, workspaceRoot: string) {
  const absoluteNeedle = path.isAbsolute(needle)
    ? needle
    : path.resolve(workspaceRoot, needle);

  try {
    const stats = await fs.stat(absoluteNeedle);

    if (stats.isDirectory()) {
      return absoluteNeedle;
    }
  } catch {
    // Continue to substring lookup.
  }

  const baseDirectory = path.resolve(workspaceRoot, outDir);
  const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes(needle))
    .map((entry) => path.join(baseDirectory, entry.name))
    .sort();

  if (matches.length === 0) {
    throw new Error(`没有找到 run directory: ${needle}`);
  }

  return matches.at(-1) as string;
}

async function readMetrics(runDirectory: string) {
  const raw = await fs.readFile(path.join(runDirectory, "metrics.json"), "utf8");
  return JSON.parse(raw) as ResearchMetrics;
}

async function resolveAnswerArtifact({
  needle,
  options,
}: {
  needle: string;
  options: CliOptions;
}) {
  const absolute = path.isAbsolute(needle)
    ? needle
    : path.resolve(options.workspaceRoot, needle);

  try {
    const stats = await fs.stat(absolute);

    if (stats.isDirectory()) {
      const metrics = await readMetrics(absolute).catch(() => null);
      return {
        caseId: metrics?.caseId,
        label: path.basename(absolute),
        sourcePath: path.join(absolute, "final.md"),
        text: await readIfExists(path.join(absolute, "final.md")),
      };
    }

    if (stats.isFile()) {
      return {
        caseId: options.caseId,
        label: path.basename(absolute),
        sourcePath: absolute,
        text: await fs.readFile(absolute, "utf8"),
      };
    }
  } catch {
    // Continue to run directory substring lookup.
  }

  const runDirectory = await resolveRunDirectory(
    options.outDir,
    needle,
    options.workspaceRoot,
  );
  const metrics = await readMetrics(runDirectory).catch(() => null);

  return {
    caseId: metrics?.caseId,
    label: path.basename(runDirectory),
    sourcePath: path.join(runDirectory, "final.md"),
    text: await readIfExists(path.join(runDirectory, "final.md")),
  };
}

async function judgePairwise({
  answerA,
  answerB,
  modelConfig,
  prompt,
}: {
  answerA: string;
  answerB: string;
  modelConfig: ModelConnectionConfig;
  prompt: string;
}) {
  const messages: AgentMessage[] = [
    {
      content: [
        {
          text: buildPairwiseJudgePrompt({
            answerA,
            answerB,
            prompt,
          }),
          type: "text",
        },
      ],
      role: "user",
    },
  ];
  const result = await createMessage({
    messages,
    modelConfig,
    system: buildJudgeSystemPrompt(),
    tools: [],
  });
  const text = getTextFromAssistantBlocks(result.message.content);

  return normalizePairwiseJudge(extractJsonObject<PairwiseJudge>(text));
}

function renderPairwiseJudge({
  artifactA,
  artifactB,
  judge,
  prompt,
}: {
  artifactA: Awaited<ReturnType<typeof resolveAnswerArtifact>>;
  artifactB: Awaited<ReturnType<typeof resolveAnswerArtifact>>;
  judge: PairwiseJudge;
  prompt: string;
}) {
  return [
    "# Deep Research Pairwise Judge",
    "",
    `- Decision: ${judge.decision.toUpperCase()}`,
    `- Answer A: ${artifactA.label}`,
    `- Answer B: ${artifactB.label}`,
    "",
    "## User Query",
    prompt,
    "",
    "## Rationale",
    judge.rationale || "(empty)",
    "",
    "## User Preference",
    judge.userPreferenceReason || "(empty)",
    "",
    "## Dimension Winners",
    "| Dimension | Winner | Rationale |",
    "|---|---|---|",
    ...judge.dimensionWinners.map(
      (item) =>
        `| ${item.dimension.replace(/\|/g, "\\|")} | ${item.winner.toUpperCase()} | ${item.rationale.replace(/\|/g, "\\|")} |`,
    ),
    "",
    "## Harness Implications",
    ...(judge.harnessImplications.length > 0
      ? judge.harnessImplications
      : ["(none)"]
    ).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

async function runJudgeRun(options: CliOptions, modelConfig: ModelConnectionConfig) {
  if (!options.judgeRun) {
    throw new Error("缺少 --judge-run 参数。");
  }

  const runDirectory = await resolveRunDirectory(
    options.outDir,
    options.judgeRun,
    options.workspaceRoot,
  );
  const judged = await judgeRunDirectory({
    modelConfig,
    runDirectory,
  });

  console.log(
    [
      `Judged ${runDirectory}:`,
      `overall=${judged.rubric.overallScore}/100`,
      `style=${judged.style.styleScore}/100`,
      `aiFlavorRisk=${judged.style.aiFlavorRisk}/100`,
    ].join(" "),
  );
}

async function runJudgePair(options: CliOptions, modelConfig: ModelConnectionConfig) {
  if (!options.judgePair) {
    throw new Error("缺少 --judge-pair 参数。");
  }

  const [first, second] = options.judgePair;
  const artifactA = await resolveAnswerArtifact({
    needle: first,
    options,
  });
  const artifactB = await resolveAnswerArtifact({
    needle: second,
    options,
  });
  const caseId = artifactA.caseId ?? artifactB.caseId ?? options.caseId;
  const researchCase =
    CASES.find((item) => item.id === caseId) ??
    CASES.find((item) => item.id === "agent-eval-landscape") ??
    CASES[0];
  const judge = await judgePairwise({
    answerA: artifactA.text,
    answerB: artifactB.text,
    modelConfig,
    prompt: researchCase.prompt,
  });
  const outputBase = path.resolve(
    options.workspaceRoot,
    options.outDir,
    `judge-pair-${timestampSegment()}-${sanitizeSegment(options.label)}`,
  );

  await Promise.all([
    fs.writeFile(`${outputBase}.json`, `${JSON.stringify(judge, null, 2)}\n`, "utf8"),
    fs.writeFile(
      `${outputBase}.md`,
      renderPairwiseJudge({
        artifactA,
        artifactB,
        judge,
        prompt: researchCase.prompt,
      }),
      "utf8",
    ),
  ]);

  console.log(
    `Wrote pairwise judge: ${outputBase}.md decision=${judge.decision.toUpperCase()}`,
  );
}

async function runComparison(options: CliOptions) {
  if (!options.compare) {
    throw new Error("缺少 --compare 参数。");
  }

  const [baselineNeedle, candidateNeedle] = options.compare;
  const baselineDirectory = await resolveRunDirectory(
    options.outDir,
    baselineNeedle,
    options.workspaceRoot,
  );
  const candidateDirectory = await resolveRunDirectory(
    options.outDir,
    candidateNeedle,
    options.workspaceRoot,
  );
  const baseline = await readMetrics(baselineDirectory);
  const candidate = await readMetrics(candidateDirectory);
  const outputPath = path.resolve(
    options.workspaceRoot,
    options.outDir,
    `comparison-${timestampSegment()}-${sanitizeSegment(options.label)}.md`,
  );
  const delta = candidate.score.total - baseline.score.total;
  const markdown = [
    "# Research Eval Comparison",
    "",
    `- Baseline: ${baselineDirectory}`,
    `- Candidate: ${candidateDirectory}`,
    `- Reference: ${options.reference ?? "(none)"}`,
    `- Total delta: ${roundScore(delta)}`,
    "",
    "| Metric | Baseline | Candidate | Delta |",
    "|---|---:|---:|---:|",
    `| Total score | ${baseline.score.total} | ${candidate.score.total} | ${roundScore(delta)} |`,
    `| search_web | ${baseline.tools.searchWebCount} | ${candidate.tools.searchWebCount} | ${candidate.tools.searchWebCount - baseline.tools.searchWebCount} |`,
    `| unique queries | ${baseline.tools.uniqueSearchQueryCount} | ${candidate.tools.uniqueSearchQueryCount} | ${candidate.tools.uniqueSearchQueryCount - baseline.tools.uniqueSearchQueryCount} |`,
    `| fetch_url | ${baseline.tools.fetchUrlCount} | ${candidate.tools.fetchUrlCount} | ${candidate.tools.fetchUrlCount - baseline.tools.fetchUrlCount} |`,
    `| findings/evidence | ${
      baseline.tools.recordResearchFindingCount + baseline.tools.recordTaskEvidenceCount
    } | ${
      candidate.tools.recordResearchFindingCount + candidate.tools.recordTaskEvidenceCount
    } | ${
      candidate.tools.recordResearchFindingCount +
      candidate.tools.recordTaskEvidenceCount -
      baseline.tools.recordResearchFindingCount -
      baseline.tools.recordTaskEvidenceCount
    } |`,
    `| memory writes | ${baseline.tools.updateTaskMemoryCount} | ${candidate.tools.updateTaskMemoryCount} | ${candidate.tools.updateTaskMemoryCount - baseline.tools.updateTaskMemoryCount} |`,
    `| read-back signals | ${baseline.artifact.readBackSignals} | ${candidate.artifact.readBackSignals} | ${candidate.artifact.readBackSignals - baseline.artifact.readBackSignals} |`,
    "",
    "## Candidate Attribution",
    ...buildFailureAttribution(candidate).map((item) => `- ${item}`),
    "",
  ].join("\n");

  await fs.writeFile(outputPath, markdown, "utf8");
  console.log(`Wrote comparison: ${outputPath}`);
}

async function parseTraceFile(tracePath: string) {
  const content = await fs.readFile(tracePath, "utf8");

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
}

async function runReanalyze(options: CliOptions) {
  if (!options.reanalyze) {
    throw new Error("缺少 --reanalyze 参数。");
  }

  const runDirectory = await resolveRunDirectory(
    options.outDir,
    options.reanalyze,
    options.workspaceRoot,
  );
  const existingMetrics = await readMetrics(runDirectory);
  const researchCase =
    CASES.find((item) => item.id === existingMetrics.caseId) ??
    CASES.find((item) => item.id === options.caseId) ??
    CASES[0];
  const events = await parseTraceFile(path.join(runDirectory, "trace.ndjson"));
  const finalText = await readIfExists(path.join(runDirectory, "final.md"));
  const metrics = await analyzeRun({
    caseId: existingMetrics.caseId,
    events,
    finalText,
    workspaceRoot: options.workspaceRoot,
  });

  await Promise.all([
    fs.writeFile(
      path.join(runDirectory, "metrics.json"),
      `${JSON.stringify(metrics, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(path.join(runDirectory, "score.md"), renderScore(metrics), "utf8"),
    fs.writeFile(
      path.join(runDirectory, "trajectory-analysis.md"),
      renderTrajectoryAnalysis(metrics),
      "utf8",
    ),
    fs.writeFile(
      path.join(runDirectory, "comparison.md"),
      await renderReferenceComparison(metrics, researchCase, options.workspaceRoot),
      "utf8",
    ),
  ]);

  console.log(`Reanalyzed ${runDirectory}: score=${metrics.score.total}/30`);
}

async function main() {
  loadEnvFiles();
  const options = parseArgs(process.argv.slice(2));

  if (options.compare) {
    await runComparison(options);
    return;
  }

  if (options.judgeRun || options.judgePair) {
    const modelConfig = buildModelConfigFromEnv();
    assertModelRunnable(modelConfig);

    if (options.judgeRun) {
      await runJudgeRun(options, modelConfig);
      return;
    }

    await runJudgePair(options, modelConfig);
    return;
  }

  if (options.reanalyze) {
    await runReanalyze(options);
    return;
  }

  const modelConfig = buildModelConfigFromEnv();
  assertRunnable(modelConfig);

  const selectedCases = selectCases(options);

  for (const researchCase of selectedCases) {
    for (let repeatIndex = 1; repeatIndex <= options.repeats; repeatIndex += 1) {
      await runCase({
        modelConfig,
        options,
        repeatIndex,
        researchCase,
      });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
