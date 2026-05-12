import fs from "node:fs/promises";
import path from "node:path";

import {
  getWorkspaceRoot,
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "./workspace";

export type ResearchPlanInput = {
  angles: string[];
  assumptions: string[];
  coverageDimensions: string[];
  deliverable: string;
  goal: string;
  questions: string[];
  sourceStrategy: string[];
  stopRules: string[];
  topic: string;
};

export type ResearchEvidenceInput = {
  note: string;
  publishedAt?: string;
  quoteOrClaimSpan?: string;
  sourceType?: string;
  title: string;
  url?: string;
};

export type ResearchFindingInput = {
  confidence: "low" | "medium" | "high";
  evidence: ResearchEvidenceInput[];
  openQuestions: string[];
  subquestion: string;
  summary: string;
  tags: string[];
};

export type SaveResearchCheckpointInput = {
  includeFullFindings: boolean;
  path?: string;
  title?: string;
};

type ResearchPlan = ResearchPlanInput & {
  updatedAt: number;
};

type ResearchFinding = ResearchFindingInput & {
  createdAt: number;
  id: string;
};

type ResearchSource = {
  note: string;
  title: string;
  url?: string;
};

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(timestamp));
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function trimList(values: string[]) {
  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatBulletList(values: string[]) {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- (none)";
}

function formatEvidenceList(evidence: ResearchEvidenceInput[]) {
  return evidence
    .map((item) => {
      const prefix = item.url?.trim()
        ? `- [${item.title.trim()}](${item.url.trim()})`
        : `- ${item.title.trim()}`;
      const metadata = [
        item.sourceType?.trim() ? `type=${item.sourceType.trim()}` : "",
        item.publishedAt?.trim() ? `date=${item.publishedAt.trim()}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      const span = item.quoteOrClaimSpan?.trim()
        ? ` Claim span: ${item.quoteOrClaimSpan.trim()}`
        : "";

      return `${prefix}${metadata ? ` (${metadata})` : ""}: ${item.note.trim()}${span}`;
    })
    .join("\n");
}

function formatConfidence(value: ResearchFinding["confidence"]) {
  if (value === "high") {
    return "高";
  }

  if (value === "low") {
    return "低";
  }

  return "中";
}

function summarizePlan(plan: ResearchPlan) {
  return [
    `主题：${plan.topic}`,
    `目标：${plan.goal}`,
    `交付物：${plan.deliverable}`,
    `问题数：${plan.questions.length}`,
    `角度数：${plan.angles.length}`,
    `覆盖维度数：${plan.coverageDimensions.length}`,
    `来源策略数：${plan.sourceStrategy.length}`,
    `停止规则数：${plan.stopRules.length}`,
    `更新时间：${formatTimestamp(plan.updatedAt)}`,
  ].join("\n");
}

function dedupeSources(findings: ResearchFinding[]) {
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];

  for (const finding of findings) {
    for (const evidence of finding.evidence) {
      const key = `${evidence.url?.trim() ?? ""}::${evidence.title.trim().toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      sources.push({
        note: evidence.note.trim(),
        title: evidence.title.trim(),
        url: evidence.url?.trim(),
      });
    }
  }

  return sources;
}

function buildFindingSummary(finding: ResearchFinding) {
  return [
    `${finding.id} | 子问题：${finding.subquestion}`,
    `结论：${finding.summary}`,
    `置信度：${formatConfidence(finding.confidence)}`,
    finding.tags.length > 0 ? `标签：${finding.tags.join(" / ")}` : "",
    "证据：",
    formatEvidenceList(finding.evidence),
    finding.openQuestions.length > 0
      ? `待解问题：\n${formatBulletList(finding.openQuestions)}`
      : "",
    `记录时间：${formatTimestamp(finding.createdAt)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getSourceType(evidence: ResearchEvidenceInput) {
  if (evidence.sourceType?.trim()) {
    return evidence.sourceType.trim().toLowerCase();
  }

  if (!evidence.url) {
    return "unspecified";
  }

  const url = evidence.url.toLowerCase();

  if (url.includes("arxiv.org") || url.includes("openreview.net")) {
    return "paper";
  }

  if (
    url.includes("openai.com") ||
    url.includes("anthropic.com") ||
    url.includes("deepmind.google") ||
    url.includes("developers.google") ||
    url.includes("microsoft.com")
  ) {
    return "official";
  }

  if (url.includes("github.com") || url.includes("gitlab.com")) {
    return "repo";
  }

  return "web";
}

function countBySourceType(findings: ResearchFinding[]) {
  const counts = new Map<string, number>();

  for (const finding of findings) {
    for (const evidence of finding.evidence) {
      const type = getSourceType(evidence);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([type, count]) => `${type}: ${count}`);
}

function normalizeForCoverage(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function findingMatchesNeed(finding: ResearchFinding, need: string) {
  const normalizedNeed = normalizeForCoverage(need);
  const haystack = normalizeForCoverage(
    [
      finding.subquestion,
      finding.summary,
      ...finding.tags,
      ...finding.evidence.map((item) => `${item.title} ${item.note}`),
    ].join(" "),
  );

  return (
    haystack.includes(normalizedNeed) ||
    normalizedNeed
      .split(/[ /,，、:：;；|]+/)
      .filter((part) => part.length >= 3)
      .some((part) => haystack.includes(part))
  );
}

function buildCoverageReview(plan: ResearchPlan | null, findings: ResearchFinding[]) {
  const needs = [
    ...(plan?.questions ?? []),
    ...(plan?.coverageDimensions ?? []),
  ];
  const gaps = needs.filter(
    (need) => !findings.some((finding) => findingMatchesNeed(finding, need)),
  );
  const lowConfidence = findings.filter((finding) => finding.confidence === "low");
  const conflicts = findings.flatMap((finding) =>
    finding.openQuestions.map((question) => `${finding.id}: ${question}`),
  );
  const sourceMix = countBySourceType(findings);

  return [
    "Research Quality Review:",
    `- Source mix: ${sourceMix.length > 0 ? sourceMix.join("; ") : "(none)"}`,
    `- Coverage gaps: ${gaps.length > 0 ? gaps.join(" | ") : "(none detected)"}`,
    `- Low-confidence findings: ${
      lowConfidence.length > 0
        ? lowConfidence.map((finding) => finding.id).join(", ")
        : "(none)"
    }`,
    `- Conflicts/open questions: ${
      conflicts.length > 0 ? conflicts.join(" | ") : "(none recorded)"
    }`,
  ].join("\n");
}

export type ResearchNotebook = ReturnType<typeof createResearchNotebook>;

export function createResearchNotebook({
  latestUserPrompt,
  runId,
  workspaceRoot,
}: {
  latestUserPrompt: string;
  runId: string;
  workspaceRoot?: string;
}) {
  const resolvedWorkspaceRoot = getWorkspaceRoot(workspaceRoot);
  const createdAt = Date.now();
  let updatedAt = createdAt;
  let latestCheckpointPath: string | null = null;
  let plan: ResearchPlan | null = null;
  const findings: ResearchFinding[] = [];

  const buildCheckpointMarkdown = ({
    includeFullFindings,
    title,
  }: {
    includeFullFindings: boolean;
    title?: string;
  }) => {
    const nextTitle = title?.trim() || plan?.topic || "Research Checkpoint";
    const sources = dedupeSources(findings);
    const openQuestions = findings.flatMap((finding) => finding.openQuestions);
    const findingsToRender = includeFullFindings ? findings : findings.slice(-5);

    return [
      `# ${nextTitle}`,
      "",
      "## 元信息",
      `- Run ID: \`${runId}\``,
      `- 工作目录: \`${resolvedWorkspaceRoot}\``,
      `- 创建时间: ${formatTimestamp(createdAt)}`,
      `- 更新时间: ${formatTimestamp(updatedAt)}`,
      `- 用户原始请求: ${latestUserPrompt || "(empty)"}`,
      "",
      "## 调研计划",
      plan
        ? [
            `- 主题: ${plan.topic}`,
            `- 目标: ${plan.goal}`,
            `- 交付物: ${plan.deliverable}`,
            "- 核心问题:",
            formatBulletList(plan.questions),
            plan.angles.length > 0 ? "- 拆解角度:" : "",
            plan.angles.length > 0 ? formatBulletList(plan.angles) : "",
            plan.coverageDimensions.length > 0 ? "- 覆盖维度:" : "",
            plan.coverageDimensions.length > 0
              ? formatBulletList(plan.coverageDimensions)
              : "",
            plan.sourceStrategy.length > 0 ? "- 来源策略:" : "",
            plan.sourceStrategy.length > 0 ? formatBulletList(plan.sourceStrategy) : "",
            plan.stopRules.length > 0 ? "- 停止规则:" : "",
            plan.stopRules.length > 0 ? formatBulletList(plan.stopRules) : "",
            plan.assumptions.length > 0 ? "- 初始假设:" : "",
            plan.assumptions.length > 0 ? formatBulletList(plan.assumptions) : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "- 尚未建立调研计划。",
      "",
      "## 当前状态",
      `- 已记录关键结论: ${findings.length}`,
      `- 已收录来源: ${sources.length}`,
      `- 未解决问题: ${openQuestions.length}`,
      latestCheckpointPath ? `- 上一次 checkpoint: \`${latestCheckpointPath}\`` : "",
      "",
      "## 关键结论",
      findingsToRender.length > 0
        ? findingsToRender
            .map((finding) =>
              [
                `### ${finding.id} · ${finding.subquestion}`,
                "",
                finding.summary,
                "",
                `- 置信度: ${formatConfidence(finding.confidence)}`,
                finding.tags.length > 0 ? `- 标签: ${finding.tags.join(" / ")}` : "",
                "",
                "**证据**",
                formatEvidenceList(finding.evidence),
                finding.openQuestions.length > 0 ? "" : "",
                finding.openQuestions.length > 0 ? "**待解问题**" : "",
                finding.openQuestions.length > 0
                  ? formatBulletList(finding.openQuestions)
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n")
        : "- 尚未记录结论。",
      !includeFullFindings && findings.length > findingsToRender.length
        ? `\n> 已省略更早的 ${findings.length - findingsToRender.length} 条结论，可再次导出完整 checkpoint。`
        : "",
      "## 来源索引",
      sources.length > 0
        ? sources
            .map((source, index) => {
              const titleLine = source.url
                ? `${index + 1}. [${source.title}](${source.url})`
                : `${index + 1}. ${source.title}`;
              return `${titleLine}\n   - ${source.note}`;
            })
            .join("\n")
        : "- 尚未收录来源。",
      "",
      "## 调研质量审查",
      buildCoverageReview(plan, findings),
      openQuestions.length > 0 ? "" : "",
      openQuestions.length > 0 ? "## 待继续验证的问题" : "",
      openQuestions.length > 0 ? formatBulletList(openQuestions) : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  return {
    hasContent() {
      return Boolean(plan) || findings.length > 0;
    },
    getStateSummary({
      includeAllFindings = true,
      maxFindings = 10,
    }: {
      includeAllFindings?: boolean;
      maxFindings?: number;
    } = {}) {
      const limitedFindings = includeAllFindings
        ? findings
        : findings.slice(Math.max(0, findings.length - maxFindings));
      const sources = dedupeSources(findings);
      const openQuestions = limitedFindings.flatMap((finding) => finding.openQuestions);

      return [
        `Research Notebook | run=${runId}`,
        `Workspace: ${resolvedWorkspaceRoot}`,
        `Created At: ${formatTimestamp(createdAt)}`,
        `Updated At: ${formatTimestamp(updatedAt)}`,
        latestCheckpointPath ? `Latest Checkpoint: ${latestCheckpointPath}` : "",
        "",
        "Plan:",
        plan ? summarizePlan(plan) : "尚未建立调研计划。",
        plan?.coverageDimensions.length ? "" : "",
        plan?.coverageDimensions.length ? "Coverage Dimensions:" : "",
        plan?.coverageDimensions.length ? formatBulletList(plan.coverageDimensions) : "",
        plan?.sourceStrategy.length ? "" : "",
        plan?.sourceStrategy.length ? "Source Strategy:" : "",
        plan?.sourceStrategy.length ? formatBulletList(plan.sourceStrategy) : "",
        plan?.stopRules.length ? "" : "",
        plan?.stopRules.length ? "Stop Rules:" : "",
        plan?.stopRules.length ? formatBulletList(plan.stopRules) : "",
        "",
        `Findings: ${findings.length}`,
        `Sources: ${sources.length}`,
        `Open Questions: ${openQuestions.length}`,
        "",
        buildCoverageReview(plan, findings),
        limitedFindings.length > 0 ? "" : "",
        limitedFindings.length > 0 ? "Recorded Findings:" : "",
        limitedFindings.length > 0
          ? limitedFindings.map((finding) => buildFindingSummary(finding)).join("\n\n")
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
    recordFinding(input: ResearchFindingInput) {
      const finding: ResearchFinding = {
        ...input,
        createdAt: Date.now(),
        evidence: input.evidence.map((item) => ({
          note: item.note.trim(),
          publishedAt: item.publishedAt?.trim(),
          quoteOrClaimSpan: item.quoteOrClaimSpan?.trim(),
          sourceType: item.sourceType?.trim(),
          title: item.title.trim(),
          url: item.url?.trim(),
        })),
        id: `F${String(findings.length + 1).padStart(2, "0")}`,
        openQuestions: trimList(input.openQuestions),
        subquestion: input.subquestion.trim(),
        summary: input.summary.trim(),
        tags: trimList(input.tags),
      };

      findings.push(finding);
      updatedAt = Date.now();

      return [
        `已记录研究结论 ${finding.id}。`,
        `子问题：${finding.subquestion}`,
        `置信度：${formatConfidence(finding.confidence)}`,
        `证据条数：${finding.evidence.length}`,
        finding.openQuestions.length > 0
          ? `待解问题：${finding.openQuestions.join("；")}`
          : "待解问题：无",
      ].join("\n");
    },
    saveCheckpoint: async (input: SaveResearchCheckpointInput) => {
      const topicSegment = sanitizeSegment(plan?.topic || latestUserPrompt || "research");
      const defaultRelativePath = path.join(
        ".next-agent",
        "research",
        `${topicSegment || "research"}-${runId.slice(0, 8)}.md`,
      );
      const targetPath = resolveWorkspacePath(
        input.path?.trim() || defaultRelativePath,
        resolvedWorkspaceRoot,
      );
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      const markdown = buildCheckpointMarkdown({
        includeFullFindings: input.includeFullFindings,
        title: input.title,
      });

      await fs.writeFile(targetPath, markdown, "utf8");
      updatedAt = Date.now();
      latestCheckpointPath = toWorkspaceRelative(targetPath, resolvedWorkspaceRoot);

      return [
        `已保存 research checkpoint。`,
        `路径：${latestCheckpointPath}`,
        `计划状态：${plan ? "已建立" : "未建立"}`,
        `结论条数：${findings.length}`,
        `来源条数：${dedupeSources(findings).length}`,
      ].join("\n");
    },
    setPlan(input: ResearchPlanInput) {
      plan = {
        ...input,
        angles: trimList(input.angles),
        assumptions: trimList(input.assumptions),
        coverageDimensions: trimList(input.coverageDimensions),
        deliverable: input.deliverable.trim(),
        goal: input.goal.trim(),
        questions: trimList(input.questions),
        sourceStrategy: trimList(input.sourceStrategy),
        stopRules: trimList(input.stopRules),
        topic: input.topic.trim(),
        updatedAt: Date.now(),
      };
      updatedAt = plan.updatedAt;

      return [
        "已建立/更新调研计划。",
        summarizePlan(plan),
        "",
        "核心问题：",
        formatBulletList(plan.questions),
        plan.angles.length > 0 ? "" : "",
        plan.angles.length > 0 ? "拆解角度：" : "",
        plan.angles.length > 0 ? formatBulletList(plan.angles) : "",
        plan.coverageDimensions.length > 0 ? "" : "",
        plan.coverageDimensions.length > 0 ? "覆盖维度：" : "",
        plan.coverageDimensions.length > 0
          ? formatBulletList(plan.coverageDimensions)
          : "",
        plan.sourceStrategy.length > 0 ? "" : "",
        plan.sourceStrategy.length > 0 ? "来源策略：" : "",
        plan.sourceStrategy.length > 0 ? formatBulletList(plan.sourceStrategy) : "",
        plan.stopRules.length > 0 ? "" : "",
        plan.stopRules.length > 0 ? "停止规则：" : "",
        plan.stopRules.length > 0 ? formatBulletList(plan.stopRules) : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}
