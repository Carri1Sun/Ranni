# Agent Loop Implementation

这份文档记录当前已经落地的 agent loop 优化。它对应 `effective-agent-loop.md` 里的方向，覆盖任务状态、显式状态更新、验证守卫、持久化任务记忆，以及运行状态栏可观测性。

## 目标

当前优化的核心目标是提高 one-shot 任务成功率。

也就是说，agent 在用户给出一个任务后，应该更稳定地完成以下流程：

1. 先明确任务目标和交付物。
2. 在执行过程中持续维护任务状态。
3. 把关键任务现场写入 `.ranni/`，避免完全依赖上下文窗口。
4. 修改文件后不要过早结束。
5. 在最终回答前完成验证，或明确记录为什么无法验证。

本轮暂时没有实现高风险动作审批。风险门控可以后置。

## 已实现的核心组件

### 1. TaskState

实现位置：

- `lib/task-state.ts`

`TaskState` 是一次 agent run 内部维护的任务状态。它不是聊天消息，也不是用户可编辑配置，而是 agent loop 用来保持工作记忆的结构化状态。

主要字段：

```ts
type TaskState = {
  goal: string;
  deliverable: string;
  constraints: string[];
  successCriteria: string[];
  assumptions: string[];
  plan: string[];
  facts: string[];
  filesTouched: string[];
  commandsRun: string[];
  openQuestions: string[];
  currentMode: ActionMode;
  nextAction: string;
  memory?: TaskMemoryStatus;
  verification: {
    status: VerificationStatus;
    evidence: string[];
  };
};
```

`currentMode` 目前支持：

```text
intake, recon, plan, edit, shell, verify, debug, review, research, synthesis
```

`verification.status` 目前支持：

```text
not_needed, pending, passed, failed, skipped
```

### 2. update_task_state 工具

实现位置：

- `lib/tools.ts`

新增了一个编排工具：`update_task_state`。

它不直接读写文件，也不执行命令。它的作用是让模型在关键节点显式更新任务状态，例如：

- 刚开始时写入目标、交付物、成功标准。
- 侦察后记录事实。
- 修改前记录计划和下一步。
- 验证后记录验证状态和证据。
- 遇到阻塞时记录 open questions。

典型调用意图：

```text
mode: recon
goal: 修复用户描述的问题
success_criteria:
- 找到相关实现
- 完成最小改动
- 跑过相关验证
next_action: 搜索相关文件和入口
```

这个工具的价值是把模型的“短期想法”变成可观察、可追踪的运行状态。

### 3. 持久化任务记忆

实现位置：

- `lib/task-memory.ts`

每次 agent run 会在 session 选择的 workspace 下创建：

```text
.ranni/runs/<runId>/
```

核心文件包括：

- `state.md`
- `todo.md`
- `verification.md`
- `errors.md`
- `decisions.md`
- `assumptions.md`
- `evidence.md`
- `negative_results.md`
- `sources/`
- `checkpoints/`

这些文件是 agent 的 durable task memory。它们用于记录任务现场、证据、失败路径、验证状态和恢复点。

`.ranni/latest.md` 会指向最近一次 run。

### 4. Stateful Action 工具

实现位置：

- `lib/tools.ts`

新增工具：

- `init_task_memory`
- `read_task_memory`
- `update_task_memory`
- `record_task_evidence`
- `save_task_checkpoint`

这些工具不是普通业务工具，而是让 agent 显式维护任务现场的 action。

### 5. 自动状态更新

实现位置：

- `lib/agent.ts`

除了模型主动调用 `update_task_state`，agent loop 也会根据工具调用自动补充一部分状态。

当前自动规则：

- `write_file`：记录 `filesTouched`，验证状态设为 `pending`。
- `move_path`：记录源路径和目标路径，验证状态设为 `pending`。
- `delete_path`：记录删除路径，验证状态设为 `pending`。
- `run_terminal`：记录 `commandsRun`。
- 如果命令看起来像验证命令，例如 `test`、`typecheck`、`lint`、`build`、`tsc`、`pytest`、`vitest`、`jest`、`eslint`，则根据退出码更新验证状态。
- 工具失败、命令非零退出会写入 `.ranni/runs/<runId>/errors.md`。
- `fetch_url` 成功后会写入 `.ranni/runs/<runId>/sources/source_N.md`。
- `search_web`、`fetch_url`：把 mode 更新为 `research`。
- `list_files`、`read_file`、`search_in_files`：把 mode 更新为 `recon`。

这使得模型即使忘记主动更新状态，loop 也能保留关键执行证据。

## Completion Guard

实现位置：

- `lib/agent.ts`

Completion guard 用来防止 agent 改完文件后直接给最终回答。

触发条件：

1. 本轮 run 已经触碰过文件。
2. 验证状态不是 `passed` 或 `skipped`，或者没有验证证据。
3. guard 触发次数没有超过当前限制。

触发后，agent 不会立刻结束，而是向 conversation 追加一条内部消息，要求模型继续完成下面任一动作：

1. 运行最小相关验证。
2. 如果无法验证，调用 `update_task_state` 记录 `verification_status = skipped` 并说明原因。
3. 如果验证失败，进入 debug 并修复或说明阻塞。

这样可以显著减少“修改了代码但没有跑任何检查就宣布完成”的情况。

## Prompt 协议更新

实现位置：

- `lib/agent.ts` 的 `createSystemPrompt()`

system prompt 现在会注入当前 task state 和 durable task memory summary，并要求模型遵循更明确的 one-shot 工作协议：

1. 先建立任务契约。
2. 使用 `update_task_state` 维护状态。
3. 使用 task memory actions 把多步任务的现场写入 `.ranni/`。
4. 先侦察再行动。
5. 修改后做最小验证。
6. 最终回答前说明结果和验证状态。

每一轮模型调用都会看到最新的 `TaskState` 摘要和 `.ranni` compact memory summary。

## Trace 与 UI

实现位置：

- `lib/trace.ts`
- `components/agent-console.tsx`
- `components/agent-console.module.css`

新增了 `task_state` stream event。

运行时会把 task state 同步到：

- `TraceRun.taskState`
- `TraceStep.taskState`

前端运行状态栏现在可以看到：

- 当前 mode
- 当前验证状态
- 当前 goal
- next action
- touched files 数量
- `.ranni` memory directory
- todo 进度
- latest checkpoint

Trace 详情页也增加了 `Task State` 区块，方便调试 agent 为什么继续执行、为什么进入验证、为什么没有结束。

## 当前执行流程

简化后的流程如下：

```text
用户消息
  -> 创建初始 TaskState
  -> 创建 .ranni/runs/<runId>/ 持久化任务记忆
  -> 构建 system prompt，注入 TaskState 和 memory summary
  -> 模型选择下一步
  -> 可调用 update_task_state / task memory actions / 文件工具 / shell / research 工具
  -> agent loop 根据工具结果更新 TaskState 和 .ranni 文件
  -> emit task_state 到 trace/UI
  -> 如果模型想结束：
       - 若文件已修改但没有验证，触发 completion guard
       - 否则进入 synthesis 并输出最终回答
```

## 尚未实现

以下内容有意后置：

- RiskGate / 人工审批。
- 命令级风险分级和确认 UI。
- patch-style edit 工具。
- 多 skill playbook。
- 更严格的 final answer 结构检查。
- 多 URL fetch plan 专用队列。
- 从旧 checkpoint 自动恢复。

这些可以在当前 TaskState 基础上继续扩展。

## 维护建议

如果后续继续优化 one-shot 成功率，建议优先做：

1. 给常见任务加轻量 skill playbook，例如 bug fix、feature implementation、test repair。
2. 把 final answer 做成结构化检查，确保包含修改内容和验证状态。
3. 增加 patch/edit 工具，降低整文件覆盖风险。
4. 让前端运行状态栏展示更清楚的 verification evidence。

## 验证命令

本轮实现后已跑过：

```bash
npm run typecheck
npm run lint
npm run build
```
