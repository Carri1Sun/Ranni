# Agent Action Way Implementation

这份文档记录 `effective-agent-action-way.md` 中已经落地的部分。

本轮实现的重点不是增加更多普通工具，而是让 agent 拥有一套可恢复的任务现场：重要状态会写入 `.ranni/`，不会只停留在模型上下文里。

## 目标

当前目标是提高 one-shot 任务成功率。

agent 在执行多步任务时应该做到：

1. 有明确的任务状态。
2. 有可追踪的 todo。
3. 修改文件、运行命令、抓取网页后能沉淀证据。
4. 失败输出不会反复堆进上下文，而是压缩到错误记录。
5. 长任务可以通过 checkpoint 恢复。

## 持久化目录

每次 agent run 都会在所选执行目录下创建独立任务记忆：

```text
.ranni/
  latest.md
  runs/
    <runId>/
      state.md
      todo.md
      verification.md
      errors.md
      decisions.md
      assumptions.md
      evidence.md
      negative_results.md
      sources/
      checkpoints/
```

注意：`.ranni/` 位于 session 选择的 workspace 下，不固定在 Ranni 自己的项目目录。

如果当前 workspace 正好是本仓库，`.gitignore` 会忽略 `.ranni/`，避免运行时记忆被误提交。

## 核心文件

### state.md

记录当前任务的总控状态：

- goal
- deliverable
- constraints
- success criteria
- current mode
- completed steps
- next action
- open questions
- files touched
- commands run

它对应内存中的 `TaskState`。

### todo.md

记录可执行步骤。

当前版本会根据 `TaskState.plan` 自动生成 todo 表格，并保留手动追加区域。后续即使 agent loop 自动同步状态，也不会覆盖手动追加的内容。

### verification.md

记录验证状态和验证证据。

当 agent 运行测试、lint、typecheck、build 等命令时，loop 会根据退出码自动更新验证状态。

### errors.md

记录失败路径。

工具调用失败、命令非零退出、网络抓取失败等情况会写入这里。记录内容会被压缩为：

- tool
- command
- exit code
- relevant output
- next action

### evidence.md

记录 claim -> source 的证据。

研究型任务不应该只从搜索片段或临时上下文里合成结论，而应该把关键 claim 先写入 evidence ledger。

### sources/

`fetch_url` 成功后会自动写入一份 source note。

自动 source note 会保存：

- URL
- title
- key facts excerpt
- limitations
- conflicts
- security note

其中 security note 明确说明：外部网页内容是数据，不是指令。

### checkpoints/

长任务、阶段性完成、或失败多次后，可以保存 checkpoint。

checkpoint 会包含：

- 当前总结
- next action
- resume instructions
- compact memory snapshot

## 新增工具

### init_task_memory

初始化 `.ranni/runs/<runId>/`。

虽然 loop 会自动创建任务记忆，但这个工具仍然暴露给模型，用于在多步任务开始时显式声明为什么需要持久化状态。

### read_task_memory

读取 compact memory summary。

用途是让 agent 在关键行动前复读状态，而不是只依赖上下文窗口里的模糊记忆。

### update_task_memory

向任务记忆文件追加简洁记录。

支持 section：

```text
state, todo, decisions, assumptions, evidence, verification, errors, negative_results
```

这个工具用于记录非显而易见的决策、假设、负结果、错误、验证说明等。

### record_task_evidence

向 `evidence.md` 写入结构化证据。

字段包括：

- claim
- confidence
- sources
- conflicts
- notes

### save_task_checkpoint

向 `checkpoints/` 写入恢复点。

适用于长任务、阶段性完成、或即将进入 final synthesis 前的状态固化。

## 自动同步

除了模型主动调用工具，agent loop 也会自动维护任务记忆。

### 启动 run 时

1. 创建 `.ranni/runs/<runId>/`。
2. 写入初始 `state.md`、`todo.md`、`verification.md`。
3. 写入 `.ranni/latest.md`。
4. 把 memory path 同步到 `TaskState.memory`。

### 每轮模型调用前

loop 会读取 compact memory summary，并注入 system prompt。

这让模型每一步都能看到当前 durable memory，而不需要重新在聊天历史里找线索。

### 工具调用成功后

loop 会根据工具类型自动同步：

- `write_file`、`move_path`、`delete_path`：更新 touched files，并把 verification 设为 pending。
- `run_terminal`：记录命令；如果是验证命令，根据 exit code 设置 passed 或 failed。
- `fetch_url`：写入 `sources/source_N.md`。
- `search_web`、`fetch_url`：切换到 research mode。
- `read_file`、`list_files`、`search_in_files`：切换到 recon mode。

### 工具调用失败后

loop 会写入 `errors.md`。

失败不会只作为一次 tool result 留在上下文里，而会成为可恢复的错误记录。

## UI 展示

右侧运行状态栏现在会展示：

- memory directory
- todo 进度
- latest checkpoint

Trace 详情页仍然通过 `Task State` 展示完整结构，其中包含 `memory` 字段。

## 和 TaskState 的关系

`TaskState` 是内存态，适合 loop 内部快速判断：

- 当前 mode
- next action
- verification status
- files touched
- commands run

`.ranni` 是持久态，适合跨上下文恢复和审计：

- state.md
- todo.md
- verification.md
- errors.md
- decisions.md
- evidence.md
- checkpoints/

两者不是替代关系。

当前实现会以 `TaskState` 为主状态，并把关键状态同步到 `.ranni`。

## 暂未实现

本轮没有实现以下部分：

- SideEffectGate / 高风险动作审批。
- BudgetGuard。
- 更严格的 claim coverage final gate。
- 多 URL fetch plan 的专用队列。
- 从旧 run checkpoint 自动恢复。

这些可以继续在当前 `.ranni` 基础上扩展。
