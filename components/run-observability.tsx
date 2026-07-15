"use client";

import { useEffect, useState } from "react";

import type { StepTraceIO } from "../lib/runs/run-trace-store";
import type { RunOverviewProjection } from "../lib/runs/run-overview-projection";
import type { TraceRun, TraceStep } from "../lib/trace";

import styles from "./agent-console.module.css";
import {
  buildContextHealthView,
  buildInputCompositionSections,
  buildRunOverviewView,
  buildToolPairs,
  getPersistedStepProgress,
  type TraceLoadStatus,
} from "./run-observability-model";

type TracePanelProps = {
  fallbackStep?: TraceStep;
  io?: StepTraceIO;
  loadMessage?: string;
  loadStatus: TraceLoadStatus;
};

type RunOverviewPanelProps = TracePanelProps & {
  overview?: RunOverviewProjection;
  run: TraceRun;
};

type StepIOTab = "input" | "output" | "raw";

const ACCEPTANCE_LABELS = {
  failed: "失败",
  passed: "已通过",
  pending: "待处理",
  unknown: "未知",
  waived: "已豁免",
} as const;

const PROGRESS_LABELS = {
  artifact: "工件推进",
  diagnostic: "诊断增量",
  evidence: "证据增量",
  failed: "执行失败",
  final: "完成",
  recovery: "恢复",
  regression: "结果回退",
  unchanged: "无交付推进",
  verification: "验证推进",
} as const;

const PLAN_LABELS = {
  active: "进行中",
  blocked: "受阻",
  cancelled: "已取消",
  pending: "待处理",
  satisfied: "已满足",
  superseded: "已替代",
} as const;

const PLAN_STATUS_STYLE = {
  active: "pending",
  blocked: "failed",
  cancelled: "waived",
  pending: "pending",
  satisfied: "passed",
  superseded: "waived",
} as const;

function renderJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderList(values: string[], emptyText: string) {
  if (values.length === 0) {
    return <p className={styles.semanticEmpty}>{emptyText}</p>;
  }

  return (
    <ul className={styles.semanticList}>
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function TraceAvailability({
  legacy,
  loadMessage,
  loadStatus,
}: {
  legacy: boolean;
  loadMessage?: string;
  loadStatus: TraceLoadStatus;
}) {
  if (loadStatus === "loading") {
    return (
      <span className={styles.traceAvailability}>正在读取持久化语义 Trace</span>
    );
  }

  if (loadStatus === "error") {
    return (
      <span className={`${styles.traceAvailability} ${styles.traceAvailabilityWarning}`}>
        {loadMessage || "持久化语义 Trace 暂不可用，已显示实时 Trace"}
      </span>
    );
  }

  if (legacy) {
    return <span className={styles.traceAvailability}>Legacy Trace</span>;
  }

  return <span className={styles.traceAvailability}>持久化语义 Trace</span>;
}

export function RunOverviewPanel({
  fallbackStep,
  io,
  loadMessage,
  loadStatus,
  overview: projection,
  run,
}: RunOverviewPanelProps) {
  const overview = buildRunOverviewView({
    fallbackStep,
    io,
    overview: projection,
  });
  const requiredCount = overview.acceptance.criteria.filter(
    (criterion) => criterion.required,
  ).length;
  const satisfiedCount = overview.acceptance.criteria.filter(
    (criterion) =>
      criterion.required &&
      (criterion.status === "passed" || criterion.status === "waived"),
  ).length;
  const currentPlanItems = overview.plan.items.filter(
    (item) => item.status !== "cancelled" && item.status !== "superseded",
  );

  return (
    <div className={styles.semanticPanelStack}>
      <div className={styles.semanticPanelHeader}>
        <div>
          <p>运行概览</p>
          <h2>{run.prompt}</h2>
        </div>
        <TraceAvailability
          legacy={overview.legacy}
          loadMessage={loadMessage}
          loadStatus={loadStatus}
        />
      </div>

      <div className={styles.semanticMetricGrid}>
        <article>
          <span>Run 状态</span>
          <strong>{run.status}</strong>
        </article>
        <article>
          <span>验收进度</span>
          <strong>
            {overview.acceptance.total > 0
              ? `${satisfiedCount} / ${requiredCount}`
              : "等待语义回执"}
          </strong>
        </article>
        <article>
          <span>最近进展</span>
          <strong>
            {overview.completion?.ready
              ? "完成"
              : overview.progress
              ? PROGRESS_LABELS[overview.progress.primaryCategory]
              : "等待回执"}
          </strong>
        </article>
        <article>
          <span>完成判定</span>
          <strong>
            {overview.completion
              ? overview.completion.ready
                ? "可完成"
                : "继续工作"
              : "尚未检查"}
          </strong>
        </article>
      </div>

      <div className={styles.semanticOverviewGrid}>
        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>当前计划</h3>
            <span>
              R{overview.plan.revision} · P{overview.plan.projectionVersion}
            </span>
          </div>
          {currentPlanItems.length > 0 ? (
            <div className={styles.acceptanceList}>
              {currentPlanItems.map((item) => (
                <div key={item.id} className={styles.acceptanceItem}>
                  <span
                    className={`${styles.acceptanceStatus} ${styles[`acceptance_${PLAN_STATUS_STYLE[item.status]}`]}`}
                  >
                    {PLAN_LABELS[item.status]}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.id}
                      {item.id === overview.plan.focusItemId
                        ? " · 当前焦点"
                        : ""}
                      {item.evidenceRefs.length > 0
                        ? ` · ${item.evidenceRefs.length} 条依据`
                        : ""}
                      {item.acceptanceRefs.length > 0
                        ? ` · 验收 ${item.acceptanceRefs.join(", ")}`
                        : ""}
                    </small>
                    {item.blockedReason ? (
                      <small>{item.blockedReason}</small>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.semanticEmpty}>
              当前任务尚未建立显式工作计划，Agent 可以直接处理简单任务。
            </p>
          )}
          {overview.plan.revisionReason ? (
            <p className={styles.semanticNotice}>
              最近修订：{overview.plan.revisionReason}
            </p>
          ) : null}
        </article>

        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>当前路线</h3>
            <span>{overview.route.status}</span>
          </div>
          <strong className={styles.semanticLead}>{overview.route.approach}</strong>
          <p className={styles.semanticMeta}>Attempt {overview.route.id}</p>
          {overview.route.changeReason ? (
            <p className={styles.semanticNotice}>{overview.route.changeReason}</p>
          ) : null}
          <div className={styles.semanticNextAction}>
            <span>下一步</span>
            <strong>{overview.nextAction}</strong>
          </div>
        </article>

        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>验收清单</h3>
            <span>{overview.acceptance.total}</span>
          </div>
          {overview.acceptance.criteria.length > 0 ? (
            <div className={styles.acceptanceList}>
              {overview.acceptance.criteria.map((criterion) => (
                <div key={criterion.id} className={styles.acceptanceItem}>
                  <span
                    className={`${styles.acceptanceStatus} ${styles[`acceptance_${criterion.status}`]}`}
                  >
                    {ACCEPTANCE_LABELS[criterion.status]}
                  </span>
                  <div>
                    <strong>{criterion.description}</strong>
                    <small>
                      {criterion.id}
                      {criterion.evidenceRefs.length > 0
                        ? ` · ${criterion.evidenceRefs.length} 条依据`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.semanticEmpty}>
              当前 Step 还没有可投影的 Acceptance Ledger。
            </p>
          )}
        </article>

        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>交付缺口</h3>
            <span>{overview.deliverableGap.length}</span>
          </div>
          {renderList(overview.deliverableGap, "当前没有待处理的交付缺口。")}
          {overview.blockers.length > 0 ? (
            <>
              <h4 className={styles.semanticSubheading}>当前阻塞</h4>
              {renderList(overview.blockers, "当前没有已记录阻塞。")}
            </>
          ) : null}
        </article>

        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>完成依据</h3>
            <span>{overview.evidenceRefs.length}</span>
          </div>
          {renderList(overview.evidenceRefs, "验收通过后将在这里显示客观回执引用。")}
          {overview.completion ? (
            <p
              className={
                overview.completion.ready
                  ? styles.semanticSuccessNotice
                  : styles.semanticNotice
              }
            >
              {overview.completion.reason}
            </p>
          ) : null}
        </article>
      </div>

      {overview.progress ? (
        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>进展回执</h3>
            <span>{PROGRESS_LABELS[overview.progress.primaryCategory]}</span>
          </div>
          <div className={styles.progressAxes}>
            <div>
              <span>交付推进</span>
              <strong>{overview.progress.objectiveProgress ? "有" : "无"}</strong>
            </div>
            <div>
              <span>信息增量</span>
              <strong>{overview.progress.informationGain ? "有" : "无"}</strong>
            </div>
            <div>
              <span>结果回退</span>
              <strong>{overview.progress.regression ? "有" : "无"}</strong>
            </div>
            <div>
              <span>连续停滞</span>
              <strong>{overview.progress.noObjectiveProgressStreak}</strong>
            </div>
          </div>
          {renderList(
            [
              ...overview.progress.objectiveDeltas,
              ...overview.progress.informationDeltas,
              ...overview.progress.regressionDeltas,
            ],
            "本轮没有新的语义增量。",
          )}
        </article>
      ) : null}
    </div>
  );
}

export function StepIOViewer({
  fallbackStep,
  io,
  loadMessage,
  loadStatus,
}: TracePanelProps) {
  const [tab, setTab] = useState<StepIOTab>("input");
  const stepId = io?.summary.stepId ?? fallbackStep?.id ?? "";
  const health = buildContextHealthView({ fallbackStep, io });
  const inputSections = buildInputCompositionSections({ fallbackStep, io });
  const progress = getPersistedStepProgress(io, fallbackStep);
  const toolPairs = buildToolPairs(io);

  useEffect(() => {
    setTab("input");
  }, [stepId]);

  return (
    <div className={styles.semanticPanelStack}>
      <div className={styles.semanticPanelHeader}>
        <div>
          <p>Step 输入输出查看器</p>
          <h2>
            Step {io?.summary.stepIndex ?? fallbackStep?.stepIndex ?? "-"} ·{" "}
            {io?.summary.status ?? fallbackStep?.status ?? "unknown"}
          </h2>
        </div>
        <TraceAvailability
          legacy={!io}
          loadMessage={loadMessage}
          loadStatus={loadStatus}
        />
      </div>

      <nav className={styles.stepIOTabs} aria-label="Step 输入输出视图">
        {(
          [
            ["input", "输入"],
            ["output", "输出"],
            ["raw", "原始数据"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            className={tab === value ? styles.stepIOTabActive : ""}
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "input" ? (
        <>
          <article className={styles.semanticCard}>
            <div className={styles.semanticCardHeader}>
              <h3>上下文健康检查</h3>
              <span
                className={
                  health.causalIntegrity === "complete"
                    ? styles.semanticSuccessText
                    : health.causalIntegrity === "warning"
                      ? styles.semanticWarningText
                      : ""
                }
              >
                因果链 {health.causalIntegrity}
              </span>
            </div>
            <div className={styles.contextHealthGrid}>
              {health.items.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className={styles.semanticCard}>
            <div className={styles.semanticCardHeader}>
              <h3>输入构成列表</h3>
              <span>{inputSections.length}</span>
            </div>
            <div className={styles.compositionList}>
              {inputSections.map((section) => (
                <details key={section.key} className={styles.compositionItem}>
                  <summary>
                    <strong>{section.label}</strong>
                    <span>
                      {section.itemCount ?? "?"} 项 ·{" "}
                      {section.estimatedTokens ?? "?"} tokens
                      {section.treatment ? ` · ${section.treatment}` : ""}
                    </span>
                  </summary>
                  <pre>{renderJson(section.content)}</pre>
                </details>
              ))}
            </div>
          </article>
        </>
      ) : null}

      {tab === "output" ? (
        <>
          {progress ? (
            <article className={styles.semanticCard}>
              <div className={styles.semanticCardHeader}>
                <h3>进展回执</h3>
                <span>{PROGRESS_LABELS[progress.primaryCategory]}</span>
              </div>
              <div className={styles.progressAxes}>
                <div>
                  <span>交付推进</span>
                  <strong>{progress.objectiveProgress ? "有" : "无"}</strong>
                </div>
                <div>
                  <span>信息增量</span>
                  <strong>{progress.informationGain ? "有" : "无"}</strong>
                </div>
                <div>
                  <span>结果回退</span>
                  <strong>{progress.regression ? "有" : "无"}</strong>
                </div>
                <div>
                  <span>同路线失败</span>
                  <strong>{progress.sameStrategyFailureStreak}</strong>
                </div>
              </div>
              <pre>{renderJson(progress)}</pre>
            </article>
          ) : null}

          <article className={styles.semanticCard}>
            <div className={styles.semanticCardHeader}>
              <h3>Tool Calls and Results</h3>
              <span>
                {toolPairs.length > 0
                  ? `${toolPairs.filter((pair) => pair.result).length} / ${toolPairs.length}`
                  : fallbackStep
                    ? `${fallbackStep.toolResults.length} / ${fallbackStep.toolCalls.length}`
                    : "0 / 0"}
              </span>
            </div>
            {toolPairs.length > 0 ? (
              <div className={styles.toolPairList}>
                {toolPairs.map((pair) => (
                  <details key={pair.toolUseId} className={styles.toolPairItem}>
                    <summary>
                      <strong>{pair.name}</strong>
                      <span>
                        {pair.result
                          ? pair.success
                            ? "success"
                            : "failed"
                          : "waiting"}
                      </span>
                    </summary>
                    <div className={styles.toolPairGrid}>
                      <div>
                        <span>Call · {pair.toolUseId}</span>
                        <pre>{renderJson(pair.call ?? {})}</pre>
                      </div>
                      <div>
                        <span>Result</span>
                        <pre>{renderJson(pair.result ?? { pending: true })}</pre>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <pre>
                {renderJson({
                  toolCalls: fallbackStep?.toolCalls ?? [],
                  toolResults: fallbackStep?.toolResults ?? [],
                })}
              </pre>
            )}
          </article>

          <div className={styles.outputCompositionGrid}>
            {[
              ["Thinking", io?.output.thinking ?? fallbackStep?.thinking ?? ""],
              [
                "Assistant Text",
                io?.output.assistantText ?? fallbackStep?.assistantText ?? "",
              ],
              ["State Delta", io?.output.observedStates ?? []],
              [
                "Attempt and Assumption Delta",
                {
                  attempts: io?.output.attemptDeltas ?? [],
                  invalidations: io?.output.assumptionInvalidations ?? [],
                },
              ],
              ["Acceptance Delta", io?.output.acceptanceDeltas ?? []],
              ["Completion Decision", io?.output.completionChecks ?? []],
              [
                "Error and Recovery",
                {
                  error: io?.output.error ?? fallbackStep?.error,
                  recovery: io?.output.recoveryEvents ?? [],
                },
              ],
            ].map(([label, value]) => (
              <details key={String(label)} className={styles.compositionItem}>
                <summary>
                  <strong>{String(label)}</strong>
                </summary>
                <pre>{typeof value === "string" ? value || "(empty)" : renderJson(value)}</pre>
              </details>
            ))}
          </div>
        </>
      ) : null}

      {tab === "raw" ? (
        <article className={styles.semanticCard}>
          <div className={styles.semanticCardHeader}>
            <h3>原始数据</h3>
            <span>已由后端脱敏</span>
          </div>
          <pre>
            {renderJson(
              io ?? {
                context: fallbackStep?.context,
                request: fallbackStep?.request,
                response: fallbackStep?.response,
                toolCalls: fallbackStep?.toolCalls ?? [],
                toolResults: fallbackStep?.toolResults ?? [],
              },
            )}
          </pre>
        </article>
      ) : null}
    </div>
  );
}
