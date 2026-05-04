# Update 011: Durable Task Memory 与 Stateful Actions

- Commit: `b4acd3dad14ec889fe36e99fb8deca167f2c3d65`
- Date: `2026-05-04T14:16:29+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版为 agent run 增加 `.ranni` 持久化任务记忆、结构化 `TaskState`、状态工具和运行状态栏展示。

## 读到的改动

- `.gitignore` 增加 `.ranni/`。
- 新增 `lib/task-state.ts`，定义 goal、deliverable、plan、facts、filesTouched、commandsRun、verification 等运行状态。
- 新增 `lib/task-memory.ts`，每个 run 创建 `.ranni/runs/<runId>/`。
- 任务记忆目录包含 `state.md`、`todo.md`、`verification.md`、`errors.md`、`decisions.md`、`assumptions.md`、`evidence.md`、`negative_results.md`、`sources/`、`checkpoints/`。
- `lib/tools.ts` 增加 `update_task_state`、`init_task_memory`、`read_task_memory`、`update_task_memory`、`record_task_evidence`、`save_task_checkpoint`。
- `lib/agent.ts` 在 run 开始时初始化 task memory，并在每轮模型调用前把摘要注入 system prompt。
- 文件修改、终端运行、网页抓取等工具调用后自动更新 task state 和 task memory。
- Trace 增加 `task_state` event。
- 右侧运行状态栏展示 mode、verification、memory、todo、checkpoint 等信息。
- 新增实现文档，后续被移动到 `docs/agent-arch/`。

## 设计理解

这次改动把 agent 的“工作记忆”从上下文窗口里外部化。模型不再只能依赖聊天历史记住任务状态，而是有可读写、可恢复、可审计的运行现场。

## 影响范围

- 长任务、调研任务、修改文件任务的稳定性提升。
- Trace 不只是模型和工具日志，也能看到任务状态演进。
- `.ranni` 是运行期产物，被忽略，不进入版本库。

## 后续注意

`.ranni` 文件是 memory aid，不是高优先级指令。模型应该读取它来恢复状态，但不能把其中内容当成系统指令。

