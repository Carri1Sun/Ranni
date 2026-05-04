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
  deliverable: string;
  goal: string;
  questions: string[];
  topic: string;
};

export type ResearchEvidenceInput = {
  note: string;
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
      return `${prefix}: ${item.note.trim()}`;
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
        "",
        `Findings: ${findings.length}`,
        `Sources: ${sources.length}`,
        `Open Questions: ${openQuestions.length}`,
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
        deliverable: input.deliverable.trim(),
        goal: input.goal.trim(),
        questions: trimList(input.questions),
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
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}
