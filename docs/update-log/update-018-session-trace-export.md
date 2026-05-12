# Update 018: Session 级 Trace 导出

这一版把 trace 导出从 assistant 消息操作改为 session 级操作。

## 变更

- 顶部会话栏新增 `导出 trace`。
- 消息和报告区保留复制与导出 Markdown，不再显示消息级 trace 导出。
- Trace 导出内容改为当前 session 快照，包含 messages、process feed、research context 和全部 runs。
- Running run 会随当前状态一起导出，因此未完成任务也能拿到排障 trace。

## 原因

旧实现依赖 assistant 消息上的 `traceRunId`。如果任务仍在运行、被取消，或失败前没有产生最终 assistant 消息，用户就没有可用入口导出 trace。Session 级导出以 session 本身为边界，更符合 Ranni 的本地工作台模型。

## 影响

- 开发者可以在任务中途导出 trace 分析卡住、失败或取消的原因。
- 分享 trace 时仍需注意其中可能包含用户输入、本地路径、工具输出和模型上下文。
