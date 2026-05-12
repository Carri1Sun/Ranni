import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

import { runAgentTurn } from "../lib/agent";
import {
  getModelRuntimeInfo,
  hasModelApiKey,
  type ModelConnectionConfig,
} from "../lib/llm";
import type { StreamEvent } from "../lib/trace";
import { loadEnvFiles } from "../src/server/env";

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
    completionGuardCount: number;
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

Options:
  --case <id>              Run one research case.
  --suite <smoke|high>     Run a suite. high includes every case.
  --label <label>          Label for output directories.
  --repeats <n>            Repeated runs per case.
  --workspace-root <path>  Workspace for Ranni tools and .ranni memory.
  --out-dir <path>         Output directory. Default: research/research-eval.
  --timeout-ms <n>         Wall-clock timeout per run. Default: 1200000.
  --compare <a> <b>        Compare two previous run directories or substrings.
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

function assertRunnable(modelConfig: ModelConnectionConfig) {
  if (!hasModelApiKey(modelConfig)) {
    const runtime = getModelRuntimeInfo(modelConfig);
    throw new Error(
      `缺少模型 API Key，无法运行 research eval。provider=${runtime.provider}。请配置 DEEPSEEK_API_KEY、QWEN_API_KEY 或 LLM_API_KEY。`,
    );
  }

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
      completionGuardCount: events.filter(
        (event) => event.type === "step_completed" && event.stopReason === "completion_guard",
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

  try {
    await runAgentTurn({
      emit: (event) => {
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
      },
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
