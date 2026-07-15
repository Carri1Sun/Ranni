export type ToolProjectableFeedItem = {
  id: string;
  kind: string;
  runId?: string;
  stepId?: string;
  toolUseId?: string;
  type?: string;
};

export type ToolActivityGroup<T extends ToolProjectableFeedItem> = {
  call?: T;
  first: T;
  key: string;
  kind: "tool_activity_group";
  result?: T;
};

export type ProjectedFeedItem<T extends ToolProjectableFeedItem> =
  | T
  | ToolActivityGroup<T>;

function isToolActivity<T extends ToolProjectableFeedItem>(
  item: T,
): item is T & { toolUseId: string } {
  return (
    item.kind === "activity" &&
    Boolean(item.toolUseId) &&
    (item.type === "tool_call" || item.type === "tool_result")
  );
}

function createToolActivityKey(
  item: ToolProjectableFeedItem & { toolUseId: string },
) {
  return `${item.runId ?? item.stepId ?? "legacy"}:${item.toolUseId}`;
}

/**
 * 保留 Feed 中的原始工具开始、结束记录，只生成一层供消息流渲染使用的配对视图。
 * 缺少一侧、乱序和重复通知都可以形成稳定的单卡片投影。
 */
export function projectFeedToolActivities<T extends ToolProjectableFeedItem>(
  items: T[],
): ProjectedFeedItem<T>[] {
  const groups = new Map<
    string,
    Omit<ToolActivityGroup<T>, "kind" | "key">
  >();

  for (const item of items) {
    if (!isToolActivity(item)) {
      continue;
    }

    const key = createToolActivityKey(item);
    const group = groups.get(key) ?? { first: item };

    if (item.type === "tool_call") {
      group.call ??= item;
    } else {
      group.result = item;
    }

    groups.set(key, group);
  }

  const emitted = new Set<string>();
  const projected: ProjectedFeedItem<T>[] = [];

  for (const item of items) {
    if (!isToolActivity(item)) {
      projected.push(item);
      continue;
    }

    const key = createToolActivityKey(item);
    if (emitted.has(key)) {
      continue;
    }

    const group = groups.get(key);
    if (!group) {
      projected.push(item);
      continue;
    }

    emitted.add(key);
    projected.push({ ...group, key, kind: "tool_activity_group" });
  }

  return projected;
}
