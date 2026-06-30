# Update 026: Agent 并行上限

- 增加最多 3 个 agent run 并行能力。
- 增加 `/api/chat` 进程内 active run 上限锁。
- 增加 `AGENT_CONCURRENCY_LIMIT` 错误码和前端上限弹窗。
- 改为按 session 追踪运行中状态和终止请求。
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`; `git diff --check`

这次更新把前端运行状态从单个全局请求改成按 session 维护。用户可以在不同 session 中同时启动多个 agent run，当前 session 正在运行时仍显示终止按钮。

服务端在 `/api/chat` 中维护 active run 计数，达到 3 个时返回 `429` JSON，前端识别 `AGENT_CONCURRENCY_LIMIT` 后弹出任务上限提醒。run 完成、失败或取消都会释放服务端 slot。
