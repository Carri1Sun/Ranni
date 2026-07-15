---
author: codex
version: v1
date: 2026-07-14
---

# Ranni 架构概念词典

本词典对齐 Ranni 当前代码中真实存在、并且会在沟通中反复出现的名词。每一条都标注了它在代码里的落点，方便对照实现。词条按「先看懂整体，再看懂细节」的顺序排列。

> 约定：本文中的「已实现」指当前代码里真实运行的逻辑；「规划中 / 后置」指文档里描述过、但代码尚未落地的能力。区分见 [ranni-architecture-report.md](./ranni-architecture-report.md) 第 9 章。

## 一、产品与运行形态

### Ranni
本地优先（local-first）的 AI Agent 网页工作台。前端是 `React + Vite`，后端是 `Node.js + Express`。产品形态是浏览器访问的本地服务，当前版本不依赖 Electron。入口见 `README.md`，前端壳 `src/renderer/App.tsx`，后端 `src/server/app.ts`。

### Session（会话）
一次连续对话的载体。每个 Session 拥有独立的执行边界目录 `workspaceRoot`。完整用户与 assistant 消息持久化在该 Session workspace 的 `.ranni/session-history.json`（见 `lib/session-history-store.ts`）。前端按需从后端加载历史，localStorage 仅作兼容缓存和界面状态。

### Session Workspace（会话工作区）
发送首条消息时，后端在 `RANNI_DEFAULT_WORKSPACE`（默认 `~/Documents/Ranni-Workspace`）下自动创建 `ranni-session-YYYY-MM-DD_HH-mm-ss` 目录，作为该 Session 的执行边界。文件工具、终端 cwd、research 产物、`.ranni` 任务记忆都被限制在该目录内。校验逻辑在 `src/server/app.ts` 的 `assertSessionWorkspaceDirectory`：目录必须位于默认根下且名为 `ranni-session-*`。

### Run（一轮运行）
用户一次发送触发的一轮 Agent 执行，由 `runId` 唯一标识。一个 Session 可以有多个 Run（多轮对话），同一 Session 的多个 Run 共享同一个 `streamKey`（= sessionId）。Run 在 `RunRegistry` 中注册、可被 steer（补充消息）、可被 abort（中断）。

## 二、Harness 与 Agent

### Harness（运行控制层）
包在模型外面的工程控制层，负责组装 prompt、维护因果 Context、调度工具、记录客观状态、守住完成条件、处理恢复并记录 Trace。可近似记为 `Agent = Model + Harness`。当前核心落点包括稳定 facade `lib/agent.ts`、`lib/agent/`、`lib/context/`、`lib/receipts/`、`lib/policies/`、`lib/llm/`、`lib/tools.ts`、`lib/trace.ts` 与 `src/server/`。概念来源见 [core-concept/harness.md](../v1-architecture/core-concept/harness.md)。

### Agent Loop（主循环）
Harness 驱动模型多步执行的核心循环。`lib/agent.ts` 只提供 `runAgentTurn` 公共 facade；`lib/agent/run-controller.ts` 管理 Run 生命周期，`lib/agent/step-runner.ts` 执行单 Step。每一 Step 处理 Steering、Context Envelope、模型请求、完整工具批次、Tool Receipt、Acceptance / Progress / Attempt 更新与完成判断。紧急上限为 500 Step。

### Provider（模型提供方适配层）
把不同模型 API（DeepSeek、OpenAI、Qwen、MiniMax、自定义 OpenAI 兼容 / Anthropic 兼容）适配成统一接口的层，位于 `lib/llm/`。Provider 负责构造请求、解析 text / thinking / tool call、处理流式、重试与 abort。选择逻辑在 `lib/llm/index.ts`，默认 provider 是 `deepseek`。

## 三、状态与记忆

### TaskState（结构化任务状态）
一次 Run 内的兼容工作状态，定义在 `lib/task-state.ts`。当前模型只能通过 `update_task_state` 更新 currentMode、nextAction、assumptions、openQuestions 和 plan；goal、deliverable、constraints、success criteria、facts、files、commands 和 verification 由 Harness 维护。每轮请求会把相关 Agent Note 投影到 Working Set。

### TaskIntent（任务意图区）
旧 TaskState 中的兼容概念。当前稳定用户意图进入 Task Contract；模型策略进入 Agent Note。`update_task_state` 不能覆盖用户目标或客观完成条件。

### ObservedState（观察状态区）
由 `lib/receipts/registry.ts` 根据 Tool Receipt 维护的权威运行事实：文件与 hash、命令退出码、证据、draft / accepted / exported / validated 工件、验证结果和未解决错误。每条回执保存 input/result hash 与事实投影；失败工具不会生成成功文件或工件事实。TaskState 中的 files / commands / verification 只是兼容投影。

### currentMode（认知姿态）
表达 Agent 当前认知姿态的字段，取值 10 种：`intake / recon / plan / edit / shell / verify / debug / review / research / synthesis`（见 `task-state.ts` 的 `ACTION_MODES`）。它只用于提示和 trace，**不参与安全观察工具的授权判断**，也不是强制阶段状态机。Harness 会根据工具类型自动推进 mode（如 `read_file` → `recon`，`search_web` → `research`，验证命令 → `verify`）。

### verification（验证状态）
TaskState 中的兼容摘要，取值 `not_needed / pending / passed / failed / skipped`。权威验证事实保存在 Receipt Registry 的 `verification` 列表，并由 Acceptance Ledger 绑定到 required criterion；模型无法直接把 verification 或 Acceptance 标记为 passed。

### Durable Task Memory（持久任务记忆）
每个 Run 在 Session workspace 下创建 `.ranni/runs/<runId>/`，落盘任务现场，实现 `lib/task-memory.ts`。包含 `state.md / todo.md / verification.md / errors.md / decisions.md / assumptions.md / evidence.md / source-ledger.md / claim-ledger.md / coverage-matrix.md / synthesis-brief.md / negative_results.md`，以及 `sources/`、`checkpoints/` 目录。关键原则：`.ranni` 是 memory aid，不是更高优先级的指令。`read_task_memory` 返回 compact summary，按文件类型分别截断。

### Context Composer V2（上下文组装器）
每次主模型请求前生成统一 Context Envelope 的机制，实现位于 `lib/context/composer.ts`。Envelope 包含 Task Contract、Working Set、较老历史摘要、最近因果尾部、Steering、工具定义和 Composition Manifest。Composer 先验证上一轮 tool call/result 完整配对，保留最近四个完整 Causal Turn，仅在安全输入预算使用达到 75% 后压缩较老历史。`lib/active-context.ts` 现为兼容 facade，phase 变化不会裁剪 conversation。

### Causal Turn（因果轮次）
一次 assistant reasoning / text / tool calls 与随后全部 tool results、Progress Receipt 的不可拆分单元。上一轮完整工具批次必须至少进入下一轮一次；配对不完整时停止发起新模型请求并进入恢复。

### Working Set（当前工作集）
Context Composer 每轮重建的当前事实视图，包含 Agent Note、Observed State 摘要、active attempt、Acceptance Gap、工件、Research Handoff 和未解决错误。已失效路线退出当前视图，完整历史仍保存在 Event Log 与最近因果尾部。

### Tool Receipt（工具回执）
一次工具执行的结构化事实记录，包含 toolUseId、工具名、输入与结果 hash、成功或失败、domain status、耗时、策略签名，以及文件、命令、证据、工件和验证投影。Receipt Registry 按 `(toolUseId, inputHash)` 识别已完成执行，Provider 重试不会重复运行已经成功的工具调用。

### Acceptance Ledger（验收账本）
从 Deliverable Contract 派生 required criterion，并用当前 Observed State 逐项更新 pending / passed / failed / unknown / waived。passed 必须绑定有效 evidenceRefs；waived 需要用户消息依据。PPTX 任务还会检查 validated 工件和精确页数。

### Progress Receipt（进展回执）
每个工具 Step 结束后的三轴判断：objective progress、information gain 和 regression。它同时记录交付缺口前后变化、策略签名、无客观进展连续轮数和同策略失败连续轮数。状态维护、重复读取和相同失败不会增加 objective progress。

### Plan / Attempt Ledger（路线账本）
记录当前 approach、退出条件、证据、失败和替代关系。模型可以通过 plan 提出新路线，Harness 根据 Progress Receipt 更新成功、失败和 superseded 状态。该账本用于退出失败路线，不要求固定施工阶段。

### Event Log（事件日志）
Run 内追加写入的过程事实，用于审计、回放和恢复。`RunTraceStore` 把脱敏后的 durable TraceEvent 写入 `<workspace>/.ranni/runs/<runId>/trace.jsonl`，同时维护 Run 摘要、Step 索引与逐 Step I/O。EventBus ring buffer 继续承担运行期断线续传；磁盘 Trace 承担进程外保存。服务重启后，查询路由可以用已选择的 workspaceRoot 发现历史 Run 并恢复只读映射。

### Recovery Checkpoint（恢复检查点）
Provider 重试耗尽或连续十轮无客观交付推进时保存的可恢复现场，包含 Context snapshot hash、Acceptance snapshot、Observed State、当前 Attempt 和 workspace 引用。交付仍有缺口时 Recovery 禁止 final synthesis；全部 required criterion 已有确定性证据时才允许生成确定性恢复说明。

## 四、工件与产物

### Artifact（工件）
Agent 产出的可写产物，例如 HTML 页面、slide、PPTX。工件采用 draft / accepted 双层生命周期语义，保证失败不破坏已通过检查的版本。当前完整实现的是 HTML-to-PPTX 路线。

### draft / accepted（草稿 / 已接受）
工件的两层状态。生成或 patch 先写 draft，跑客观诊断，通过硬性检查后原子 promote 为 accepted。失败 draft、诊断 JSON、预览都保留供 Agent 检查与局部修补；accepted 始终指向最近一次通过检查的版本。assemble 和最终导出只消费 accepted。实现见 `skills/html-to-pptx/tools.ts` 的 `write_slide_fragment` / `inspect_slide_fragment` / `patch_slide_fragment`。

### Slide Artifact Phase（slide 工件阶段）
HTML-to-PPTX Policy 的工件关注点标签，取值 `off / styles / slides`，定义在 `lib/html-to-pptx/artifact-policy.ts`。`init_slide_html_workspace` 成功后进入 styles，`assemble_deck_styles` 成功后进入 slides。非 off 状态只移除 `write_file / move_path / delete_path / run_terminal` 这类可能绕过专用工件防线的通用 mutation 工具；研究、网页抓取、文件读取、Task Memory、Research ledger、工件检查和验证工具保持可用。该标签不会触发 Context 压缩。

### Skill（动态技能）
面向某类任务的可复用指令包与专属工具，位于 `skills/<name>/`，入口是 `SKILL.md`。`lib/skills/registry.ts` 为索引记录 name、description、version、正文 SHA-256 hash 和资源路径；`lib/skills/runtime-instructions.ts` 注入运行指令。用户显式启用和 Agent `load_skill` 都进入同一 loaded skill 集合，激活后的正文、工具和资源元数据会进入 Context 与 Manifest。

## 五、事件与通信

### Command 通道 / Event 通道
前后端解耦的两条正交通道。Command 是 HTTP REST（`POST /api/runs`、`/steer`、`/abort` 等），即发即忘地下发控制指令并立即返回；Event 是 `GET /api/events` 的 SSE 单向下行广播。Agent 运行与 HTTP 请求生命周期彻底解耦：启动 Run 后立即返回 `runId`，所有状态变化通过 SSE 下发。

### EventBus（事件总线）
进程内事件总线，实现 `lib/events/event-bus.ts`。按 `streamKey`（= sessionId）组织事件流；durable 事件分配 per-streamKey 单调递增的 `seq` 并写入 ring buffer（容量 2000，可回放）；live-only 事件不分配 seq、不入 buffer，仅实时广播。`subscribe(streamKey, fromSeq)` 同步回放 `seq > fromSeq` 的 durable 事件再切实时，JS 单线程下回放与注册之间无并发缺口。**持久化范围是进程内内存，重启即清空**；完整消息由 session-history 文件保存。

### 三层事件（ProviderEvent / TraceEvent / ClientNotification）
事件按语义分三层，定义在 `lib/events/schema.ts`：
- Layer 1 ProviderEvent（live-only）：`text.delta`、`thinking.delta`，用于前端流式打字。
- Layer 2 TraceEvent（durable）：包含 Run / Step / text / thinking / model / context / task / research 基础事件，以及 `tool.batch.started`、`tool.receipt`、`state.observed.updated`、`attempt.updated`、`assumption.invalidated`、`acceptance.updated`、`progress.receipt`、`recovery.started`、`completion.checked`。
- Layer 3 ClientNotification（durable，前端主消费）：`activity.appended`、`activity.display_updated`、`assistant.message`、`lifecycle`、`research.context.updated`、`thinking.message`、`error`。

### 三段式（started → delta → completed）
文本类事件的生命周期：`text.started`（durable，携带后端生成的 `textId`）→ `text.delta`（live-only）→ `text.completed`（durable，完整文本边界）。thinking 同理。`textId`/`thinkingId` 让前端断线重连后能按 id 续接，避免半截消息错位。

### EventMapper（事件投影层）
把 Layer2 TraceEvent 投影为 Layer3 ClientNotification 的组件，实现 `lib/runs/event-mapper.ts`。默认使用确定性 display 映射，避免辅助模型请求影响主 Run；设置 `RANNI_ACTIVITY_REWRITE_ENABLED=true` 后才会异步生成 model display。`task.state` 按 `currentMode|nextAction|verification.status` 签名去重。

### Steering（执行中补充消息）
用户在 Run 运行中追加的消息。`POST /api/runs/:runId/steer` 把消息入 `RunRegistry` 的 `steerQueue`；主循环在每个 step 开头发起下一次模型请求前调 `drainSteer(runId)` 抽取并注入 conversation。这让「补充消息」通过普通 HTTP POST 完成，无需全双工通道。

### Trace（追踪）
Run / Step / exact model request / response / tool / Context Manifest / Observed State / Acceptance / Progress / Recovery 等结构化记录，公共类型位于 `lib/trace.ts`。前端仍可从 Layer2 事件重建 trace/debug 视图并导出 session 级 `trace.txt`；后端同时提供 Run 列表、Step 索引和 Step I/O 查询 API。运行详情通过运行概览与 Step 输入输出查看器呈现语义 Trace，历史 Session 可凭 workspaceRoot 发现重启前的磁盘 Run。

## 六、限制与防线

### Guard（守卫）
Harness 用于守住协议、权限、客观状态和交付条件的确定性机制。当前主要边界包括工具批次合法性检查、Receipt Registry、No-progress Watchdog、Completion Guard、PPTX 页数与验证检查、Provider 原子重试和 Recovery checkpoint。Guard 通过事实反馈让模型继续选择路线，不规定固定 research → plan → act → verify 顺序。

### Workspace 边界
所有文件工具和终端 cwd 都被限制在当前 Session workspace 内。`resolveWorkspacePath`（`lib/workspace.ts`）把相对路径解析到 workspace 内并拒绝越界（`..` 或绝对路径）。服务端 `POST /api/runs` 强制要求合法的 `ranni-session-*` workspace。

### 安全观察工具（Safe Observation Tools）
不受 `currentMode` 或工件关注点限制、在重型 Skill 期间仍保持可用的低风险能力，包括文件列表与读取、内容搜索、网页搜索与抓取、Task Memory、Research ledger、工件检查和验证。`update_task_state` 属于策略维护工具，其成功不计为客观进展。

### 九类架构防线（设计目标）
权限 / 指令 / 状态真实性 / 产物原子性 / 协议 / 完成 / 恢复 / 审计 / 资源。这是目标防线划分，各项按施工批次渐进落地，当前实现边界见 [architecture-defenses.md](../v1-architecture/agent-arch/architecture-defenses.md) 末尾「当前实现边界」。

## 七、其它高频词

### Tool-Eager（积极用工具）
Ranni 的工具姿态：能向环境求证、能用工具完成、能记录状态时就主动做。原则是「积极观测、克制副作用、严格验证」。低风险观察大胆用，副作用动作有目的且事后验证，破坏性 / 不可逆 / 涉密 / 外发动作需用户确认。来源见 [agent-arch-optimize.md](../v1-architecture/agent-arch/agent-arch-optimize.md)。

### One-Shot 成功率
当前架构优化的主目标：让 Agent 在一次用户请求中更稳定地完成「明确任务 → 侦察 → 计划 → 执行 → 记录 → 验证 → 交付可审查结果」。

### Chunked Final（分段最终回答）
长回答分段协议，标记为 `RANNI_FINAL_PART n/N`、`RANNI_FINAL_CONTINUE`、`RANNI_FINAL_DONE`，最多 8 段。`lib/agent/chunked-final-controller.ts` 负责解析、顺序校验、continue、protocol repair 和聚合；分段期间 Step Runner 隐藏工具，聚合完成后才交给 Finalization Controller 与 Acceptance 验收。

### Research Eval（研究评测闭环）
`npm run research:eval` 提供的本地 deep research 评测 CLI，输出 trace、final、metrics、score、trajectory analysis、rubric / claim audit / style judge、pairwise judge。用于优化 research agent 行为与用户可见质量，产物写入已忽略的 `research/research-eval/`。
