"use client";

import type { RunOverviewProjection } from "../lib/runs/run-overview-projection";
import type { TraceRun } from "../lib/trace";

import styles from "./agent-console.module.css";
import type { RunOverviewView } from "./run-observability-model";

type RunPlanProgressProps = {
  onAdjustPlan?: () => void;
  onOpenDetails?: () => void;
  onOpenStep?: (stepIndex: number) => void;
  overview: RunOverviewView;
  projection?: RunOverviewProjection;
  run: TraceRun;
  variant?: "compact" | "detail";
};

const PLAN_STATUS_LABELS = {
  active: "进行中",
  blocked: "受阻",
  cancelled: "已取消",
  pending: "待处理",
  satisfied: "已满足",
  superseded: "已替代",
} as const;

const STATUS_SOURCE_LABELS: Record<string, string> = {
  acceptance: "验收投影",
  finalization: "完成检查",
  model: "模型修订",
  receipt: "工具回执",
};

const TIMELINE_TYPE_LABELS: Record<string, string> = {
  acceptance: "验收变化",
  completion: "完成检查",
  plan: "计划变化",
  progress: "客观进展",
  recovery: "恢复现场",
  route: "路线变化",
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatUpdatedAt(value: number | undefined) {
  if (!value) return "等待首个计划快照";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function getTimelineView(change: unknown) {
  const item = asRecord(change);
  const type = asString(item.type) ?? asString(item.kind) ?? "plan";
  const transitions = Array.isArray(item.transitions)
    ? item.transitions.map(asRecord)
    : [];
  const transitionSummary = transitions
    .map((transition) => {
      const itemId = asString(transition.itemId) ?? asString(transition.id);
      const from = asString(transition.fromStatus) ?? asString(transition.from);
      const to = asString(transition.toStatus) ?? asString(transition.to);
      return [itemId, from && to ? `${from} → ${to}` : to]
        .filter(Boolean)
        .join(" · ");
    })
    .filter(Boolean)
    .join("；");

  return {
    detail:
      asString(item.detail) ??
      asString(item.reason) ??
      (transitionSummary || "计划投影已更新"),
    id:
      asString(item.id) ??
      `${String(type)}-${String(
        asNumber(item.seq) ?? asNumber(item.stepIndex) ?? asString(item.title) ?? "change",
      )}`,
    projectionVersion: asNumber(item.projectionVersion),
    revision: asNumber(item.revision) ?? asNumber(item.planRevision),
    seq: asNumber(item.seq),
    stepIndex: asNumber(item.stepIndex),
    title:
      asString(item.title) ?? TIMELINE_TYPE_LABELS[type] ?? "运行状态变化",
    type,
  };
}

function ProgressMetric({
  label,
  satisfied,
  total,
}: {
  label: string;
  satisfied: number;
  total: number;
}) {
  const percent = total > 0 ? clampPercent((satisfied / total) * 100) : 0;

  return (
    <div className={styles.planMetric}>
      <div>
        <span>{label}</span>
        <strong>{total > 0 ? `${satisfied} / ${total}` : "等待定义"}</strong>
      </div>
      <div
        aria-label={label}
        aria-valuemax={total > 0 ? total : undefined}
        aria-valuemin={total > 0 ? 0 : undefined}
        aria-valuenow={total > 0 ? satisfied : undefined}
        aria-valuetext={total > 0 ? `${satisfied} / ${total}` : "等待定义"}
        className={styles.planProgressTrack}
        role="progressbar"
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function RunPlanProgress({
  onAdjustPlan,
  onOpenDetails,
  onOpenStep,
  overview,
  projection,
  run,
  variant = "detail",
}: RunPlanProgressProps) {
  const compact = variant === "compact";
  const activeItems = overview.plan.items.filter(
    (item) => item.status !== "cancelled" && item.status !== "superseded",
  );
  const archivedItems = overview.plan.items.filter(
    (item) => item.status === "cancelled" || item.status === "superseded",
  );
  const visibleItems = compact ? activeItems.slice(0, 5) : activeItems;
  const satisfiedPlanItems = activeItems.filter(
    (item) => item.status === "satisfied",
  ).length;
  const requiredCriteria = overview.acceptance.criteria.filter(
    (criterion) => criterion.required,
  );
  const satisfiedCriteria = requiredCriteria.filter(
    (criterion) =>
      criterion.status === "passed" || criterion.status === "waived",
  ).length;
  const focus = overview.plan.items.find(
    (item) => item.id === overview.plan.focusItemId,
  );
  const headline = focus?.title ??
    (activeItems.length > 0 && satisfiedPlanItems === activeItems.length
      ? "工作计划已完成"
      : activeItems[0]?.title ?? "等待 Agent 建立工作计划");
  const timeline = overview.timeline.map(getTimelineView).reverse();

  return (
    <section
      aria-label="整体计划与进度"
      className={`${styles.planProgressPanel} ${
        compact ? styles.planProgressPanelCompact : ""
      }`}
    >
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles.planLiveStatus}
        role="status"
      >
        {headline}。计划覆盖 {satisfiedPlanItems} / {activeItems.length}。交付验收{" "}
        {satisfiedCriteria} / {requiredCriteria.length}。
      </p>
      <header className={styles.planProgressHeader}>
        <div>
          <span>整体计划</span>
          <strong>{headline}</strong>
        </div>
        <span
          className={`${styles.planSyncBadge} ${
            projection ? styles.planSyncBadgeLive : ""
          }`}
        >
          {projection ? "已同步" : "Step 回退"}
        </span>
      </header>

      <div className={styles.planProgressMetrics}>
        <ProgressMetric
          label="计划覆盖"
          satisfied={satisfiedPlanItems}
          total={activeItems.length}
        />
        <ProgressMetric
          label="交付验收"
          satisfied={satisfiedCriteria}
          total={requiredCriteria.length}
        />
      </div>

      <div className={styles.planProgressMeta}>
        <span>{run.status}</span>
        <span>
          R{overview.plan.revision} · P{overview.plan.projectionVersion}
        </span>
        <span>{formatUpdatedAt(overview.updatedAt)}</span>
        {overview.latestSeq ? <span>Seq {overview.latestSeq}</span> : null}
      </div>

      {visibleItems.length > 0 ? (
        <div className={styles.planItemList}>
          {visibleItems.map((item) => (
            <article
              className={`${styles.planItem} ${
                item.id === overview.plan.focusItemId
                  ? styles.planItemFocus
                  : ""
              } ${styles[`planItem_${item.status}`] ?? ""}`}
              key={item.id}
            >
              <span className={styles.planItemStatus} aria-hidden="true" />
              <div>
                <div className={styles.planItemTitleRow}>
                  <strong>{item.title}</strong>
                  <span>{PLAN_STATUS_LABELS[item.status]}</span>
                </div>
                <small>
                  {item.id}
                  {item.id === overview.plan.focusItemId ? " · 当前焦点" : ""}
                  {item.updatedAtStep
                    ? ` · Step ${item.updatedAtStep}`
                    : ""}
                  {item.statusSource
                    ? ` · ${STATUS_SOURCE_LABELS[item.statusSource] ?? item.statusSource}`
                    : ""}
                </small>
                {!compact && item.expectedOutcome ? (
                  <p>{item.expectedOutcome}</p>
                ) : null}
                {!compact && item.dependsOn.length > 0 ? (
                  <small>依赖：{item.dependsOn.join("、")}</small>
                ) : null}
                {item.blockedReason ? (
                  <p className={styles.planItemBlocked}>{item.blockedReason}</p>
                ) : null}
                {!compact && item.evidenceRefs.length > 0 ? (
                  <small>{item.evidenceRefs.length} 条客观依据</small>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.semanticEmpty}>
          当前 Run 尚未建立显式计划。简单任务可以直接执行，产生计划后会在这里同步。
        </p>
      )}

      {compact && activeItems.length > visibleItems.length ? (
        <p className={styles.planMoreHint}>
          还有 {activeItems.length - visibleItems.length} 个计划项
        </p>
      ) : null}

      {!compact ? (
        <div className={styles.planRouteSummary}>
          <div>
            <span>当前路线</span>
            <strong>{overview.route.approach}</strong>
            <small>
              Attempt {overview.route.id} · {overview.route.status}
            </small>
          </div>
          <div>
            <span>下一动作</span>
            <strong>{overview.nextAction}</strong>
          </div>
        </div>
      ) : null}

      {!compact && archivedItems.length > 0 ? (
        <details className={styles.planArchive}>
          <summary>已取消或已替代 · {archivedItems.length}</summary>
          <div className={styles.planItemList}>
            {archivedItems.map((item) => (
              <article className={styles.planItem} key={item.id}>
                <span className={styles.planItemStatus} aria-hidden="true" />
                <div>
                  <div className={styles.planItemTitleRow}>
                    <strong>{item.title}</strong>
                    <span>{PLAN_STATUS_LABELS[item.status]}</span>
                  </div>
                  <small>{item.id}</small>
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}

      {!compact ? (
        <div className={styles.planTimelineSection}>
          <div className={styles.planTimelineHeader}>
            <div>
              <span>计划变化时间线</span>
              <strong>修订、客观投影与恢复记录</strong>
            </div>
            <span>{timeline.length}</span>
          </div>
          {timeline.length > 0 ? (
            <ol className={styles.planTimeline}>
              {timeline.map((change) => (
                <li key={change.id}>
                  <button
                    disabled={!change.stepIndex || !onOpenStep}
                    type="button"
                    onClick={() =>
                      change.stepIndex && onOpenStep?.(change.stepIndex)
                    }
                  >
                    <span className={styles.planTimelineDot} aria-hidden="true" />
                    <div>
                      <div>
                        <strong>{change.title}</strong>
                        <span>
                          {change.stepIndex ? `Step ${change.stepIndex}` : "Run"}
                          {change.revision !== undefined
                            ? ` · R${change.revision}`
                            : ""}
                          {change.projectionVersion !== undefined
                            ? ` · P${change.projectionVersion}`
                            : ""}
                        </span>
                      </div>
                      <p>{change.detail}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.semanticEmpty}>
              首个计划修订或客观状态变化出现后，这里会保留可回看的变化记录。
            </p>
          )}
        </div>
      ) : null}

      <footer className={styles.planProgressActions}>
        {onAdjustPlan ? (
          <button type="button" onClick={onAdjustPlan}>
            调整计划
          </button>
        ) : null}
        {onOpenDetails ? (
          <button type="button" onClick={onOpenDetails}>
            查看计划变化
          </button>
        ) : null}
      </footer>
    </section>
  );
}
