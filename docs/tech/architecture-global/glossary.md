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
包在模型外面的工程控制层，负责组装 prompt、管理上下文、调度工具、维护状态、处理错误与重试、记录 trace、持久化记忆。可近似记为 `Agent = Model + Harness`。在 Ranni 里 Harness 是一组协作机制，核心落点：`lib/agent.ts`（主循环）、`lib/llm/`（provider 适配）、`lib/tools.ts`（工具）、`lib/task-state.ts`（状态）、`lib/task-memory.ts`（持久记忆）、`lib/trace.ts`（事件结构）、`src/server/app.ts`（HTTP 接入）、`components/agent-console.tsx`（UI）。概念来源见 [core-concept/harness.md](../v1-architecture/core-concept/harness.md)。

### Agent Loop（主循环）
Harness 驱动模型多步执行的核心循环，实现是 `lib/agent.ts` 的 `runAgentTurn`。每一「步」（step）做：注入补充消息 → 构造 system prompt + 活动上下文投影 → 调模型 → 解析响应 → 执行工具或触发 guard → 发事件。最多 500 步（`MAX_TOOL_STEPS`）。详见主报告第 3 章。

### Provider（模型提供方适配层）
把不同模型 API（DeepSeek、OpenAI、Qwen、MiniMax、自定义 OpenAI 兼容 / Anthropic 兼容）适配成统一接口的层，位于 `lib/llm/`。Provider 负责构造请求、解析 text / thinking / tool call、处理流式、重试与 abort。选择逻辑在 `lib/llm/index.ts`，默认 provider 是 `deepseek`。

## 三、状态与记忆

### TaskState（结构化任务状态）
一次 Run 内的内存态工作状态，定义在 `lib/task-state.ts`。包含 goal、deliverable、constraints、successCriteria、assumptions、plan、facts、filesTouched、commandsRun、openQuestions、currentMode、nextAction、verification、memory。每一轮模型调用都会把它摘要注入 system prompt。它在逻辑上被划分为 TaskIntent 与 ObservedState 两个责任区。

### TaskIntent（任务意图区）
TaskState 中由「用户和 Agent 表达」的字段：goal、deliverable、constraints、successCriteria、assumptions、plan、openQuestions、currentMode、nextAction。模型可以通过 `update_task_state` 工具修改这些字段。

### ObservedState（观察状态区）
TaskState 中由「Harness 根据工具回执和文件系统事实维护」的字段：实际写入的文件、hash、draft/accepted 工件、命令退出码、验证回执、错误诊断。当前首版从工具回执派生（如 `filesTouched`、`commandsRun`、`verification`），独立的、完整的 ObservedState registry 属于后续防线，尚未实现。`keepObservedFileTouches` 保证失败写入不会进入 `filesTouched`（状态真实性不变量）。

### currentMode（认知姿态）
表达 Agent 当前认知姿态的字段，取值 10 种：`intake / recon / plan / edit / shell / verify / debug / review / research / synthesis`（见 `task-state.ts` 的 `ACTION_MODES`）。它只用于提示和 trace，**不参与安全观察工具的授权判断**，也不是强制阶段状态机。Harness 会根据工具类型自动推进 mode（如 `read_file` → `recon`，`search_web` → `research`，验证命令 → `verify`）。

### verification（验证状态）
表达「修改是否经过验证」的字段，取值 5 种：`not_needed / pending / passed / failed / skipped`。Harness 在执行验证类终端命令后按退出码自动设置 passed/failed；文件修改后设为 pending。当前 `verification` 仍为 agent-writable（`task-state.ts` 注释标注「until verification receipts are separated」），独立的验证回执 registry 属于后置。

### Durable Task Memory（持久任务记忆）
每个 Run 在 Session workspace 下创建 `.ranni/runs/<runId>/`，落盘任务现场，实现 `lib/task-memory.ts`。包含 `state.md / todo.md / verification.md / errors.md / decisions.md / assumptions.md / evidence.md / source-ledger.md / claim-ledger.md / coverage-matrix.md / synthesis-brief.md / negative_results.md`，以及 `sources/`、`checkpoints/` 目录。关键原则：`.ranni` 是 memory aid，不是更高优先级的指令。`read_task_memory` 返回 compact summary，按文件类型分别截断。

### Active Context Projection（活动上下文投影）
每次模型请求时，从历史中构造「当前决策需要的工作视图」的机制，实现 `lib/active-context.ts` 的 `buildActiveContextProjection`。它保留：用户文本对话、成功 artifact 的 receipt、最新未解决失败、最新观察结果，并附一条确定性投影说明。**当前首版仅对 slide artifact 场景生效**（`phase` 为 `slides`/`styles`）；`phase="off"` 时直接透传原始 conversation。投影会计算 fingerprint 和重复次数，作为「观察是否推进」的事实信号，但不规定 Agent 下一步动作。

### Event Log（事件日志）
Run 内的完整过程事实来源，用于审计、回放、按需恢复。当前首版的 Event Log 来源是「conversation + TraceEvent + task memory + 工具回执」的组合；跨进程持久化的完整 Event Log 属于后续审计防线，尚未实现。注意它和 EventBus 的内存 ring buffer 是两个层次：ring buffer 只做运行期断线续传。

## 四、工件与产物

### Artifact（工件）
Agent 产出的可写产物，例如 HTML 页面、slide、PPTX。工件采用 draft / accepted 双层生命周期语义，保证失败不破坏已通过检查的版本。当前完整实现的是 HTML-to-PPTX 路线。

### draft / accepted（草稿 / 已接受）
工件的两层状态。生成或 patch 先写 draft，跑客观诊断，通过硬性检查后原子 promote 为 accepted。失败 draft、诊断 JSON、预览都保留供 Agent 检查与局部修补；accepted 始终指向最近一次通过检查的版本。assemble 和最终导出只消费 accepted。实现见 `skills/html-to-pptx/tools.ts` 的 `write_slide_fragment` / `inspect_slide_fragment` / `patch_slide_fragment`。

### Slide Artifact Phase（slide 工件阶段）
HTML-to-PPTX 场景下的工件推进标签，取值 `off / styles / slides`（`active-context.ts` 的 `SlideArtifactPhase`）。Run 起始为 `off`；执行 `init_slide_html_workspace` 后进入 `styles`；`assemble_deck_styles` 通过后进入 `slides`。当 phase 非 `off` 时，`getStepToolDefinitions` 会把可用工具过滤为一个**静态白名单** `SLIDE_ARTIFACT_TOOL_NAMES`（共 19 个：11 个专用工件工具 + `list_files/read_file/search_in_files/search_web/fetch_url/read_task_memory/review_research_state/update_task_state` 这 8 个安全观察工具）。`write_file/move_path/delete_path/run_terminal/operate_computer` 等通用 mutation 工具因不在白名单而被移出工具集，从而阻止绕过工件校验的写入。这个标签描述观察到的进度，不规定修复顺序。

### Skill（动态技能）
面向某类任务的可复用指令包 + 专属工具，位于 `skills/<name>/`，入口是 `SKILL.md`（含 frontmatter 的 name/description + 正文）。`lib/skills/registry.ts` 扫描注册，`lib/skills/runtime-instructions.ts` 注入 runtime 指令。当前产品内置 `html`（静态网页创作）和 `html-to-pptx`（受限 slide HTML → 可编辑 PPTX）。Skill 可被用户在输入框临时启用，或被 Agent 通过 `load_skill` 主动加载。

## 五、事件与通信

### Command 通道 / Event 通道
前后端解耦的两条正交通道。Command 是 HTTP REST（`POST /api/runs`、`/steer`、`/abort` 等），即发即忘地下发控制指令并立即返回；Event 是 `GET /api/events` 的 SSE 单向下行广播。Agent 运行与 HTTP 请求生命周期彻底解耦：启动 Run 后立即返回 `runId`，所有状态变化通过 SSE 下发。

### EventBus（事件总线）
进程内事件总线，实现 `lib/events/event-bus.ts`。按 `streamKey`（= sessionId）组织事件流；durable 事件分配 per-streamKey 单调递增的 `seq` 并写入 ring buffer（容量 2000，可回放）；live-only 事件不分配 seq、不入 buffer，仅实时广播。`subscribe(streamKey, fromSeq)` 同步回放 `seq > fromSeq` 的 durable 事件再切实时，JS 单线程下回放与注册之间无并发缺口。**持久化范围是进程内内存，重启即清空**；完整消息由 session-history 文件保存。

### 三层事件（ProviderEvent / TraceEvent / ClientNotification）
事件按语义分三层，定义在 `lib/events/schema.ts`：
- Layer 1 ProviderEvent（live-only）：`text.delta`、`thinking.delta`，用于前端流式打字。
- Layer 2 TraceEvent（durable）：`run.started/completed`、`step.started/completed`、`tool.started/completed`、`text.started/completed`、`thinking.started/completed`、`model.request/response`、`context.snapshot`、`task.state`、`research.state`、`run.status`。
- Layer 3 ClientNotification（durable，前端主消费）：`activity.appended`、`activity.display_updated`、`assistant.message`、`lifecycle`、`research.context.updated`、`thinking.message`、`error`。

### 三段式（started → delta → completed）
文本类事件的生命周期：`text.started`（durable，携带后端生成的 `textId`）→ `text.delta`（live-only）→ `text.completed`（durable，完整文本边界）。thinking 同理。`textId`/`thinkingId` 让前端断线重连后能按 id 续接，避免半截消息错位。

### EventMapper（事件投影层）
把 Layer2 TraceEvent 投影为 Layer3 ClientNotification 的组件，实现 `lib/runs/event-mapper.ts`。关键行为：`tool.started` 立即发 fallback display 的 `activity.appended`，并异步调 LLM 改写后发 `activity.display_updated`；`run.completed` 前会 await 本 run 未完成的改写（8s 超时）；`task.state` 按 `currentMode|nextAction|verification.status` 签名去重。展示文案逻辑后移到后端，前端不再二次请求 LLM 改写。

### Steering（执行中补充消息）
用户在 Run 运行中追加的消息。`POST /api/runs/:runId/steer` 把消息入 `RunRegistry` 的 `steerQueue`；主循环在每个 step 开头发起下一次模型请求前调 `drainSteer(runId)` 抽取并注入 conversation。这让「补充消息」通过普通 HTTP POST 完成，无需全双工通道。

### Trace（追踪）
Run / step / model request / response / tool call / context snapshot / task state 等结构化记录，定义在 `lib/trace.ts`。前端用 Layer2 事件重建 trace/debug 视图，支持导出 session 级 `trace.txt`（含未完成 run）。

## 六、限制与防线

### Guard（守卫）
Harness 在 loop 中自动触发、用于守住不变量的机制。Ranni 的 guard 只约束「不可妥协的条件」，不规定具体思考路径。当前实现的 guard 包括：completion guard、research finalization guard、research answer quality guard、final answer repair、artifact output recovery、model failure recovery、chunked final、unsafe tool-call guard。详见主报告第 5 章。

### Workspace 边界
所有文件工具和终端 cwd 都被限制在当前 Session workspace 内。`resolveWorkspacePath`（`lib/workspace.ts`）把相对路径解析到 workspace 内并拒绝越界（`..` 或绝对路径）。服务端 `POST /api/runs` 强制要求合法的 `ranni-session-*` workspace。

### 安全观察工具（Safe Observation Tools）
只读、不受 `currentMode` 限制、在 slide artifact 防线期间也保持可用的工具：`list_files`、`read_file`、`search_in_files`、`search_web`、`fetch_url`、`read_task_memory`、`review_research_state`、`update_task_state`、`inspect_slide_fragment` 等。写入、终端、删除、外发、桌面操作继续经过 workspace 与权限检查。

### 九类架构防线（设计目标）
权限 / 指令 / 状态真实性 / 产物原子性 / 协议 / 完成 / 恢复 / 审计 / 资源。这是目标防线划分，各项按施工批次渐进落地，当前实现边界见 [architecture-defenses.md](../v1-architecture/agent-arch/architecture-defenses.md) 末尾「当前实现边界」。

## 七、其它高频词

### Tool-Eager（积极用工具）
Ranni 的工具姿态：能向环境求证、能用工具完成、能记录状态时就主动做。原则是「积极观测、克制副作用、严格验证」。低风险观察大胆用，副作用动作有目的且事后验证，破坏性 / 不可逆 / 涉密 / 外发动作需用户确认。来源见 [agent-arch-optimize.md](../v1-architecture/agent-arch/agent-arch-optimize.md)。

### One-Shot 成功率
当前架构优化的主目标：让 Agent 在一次用户请求中更稳定地完成「明确任务 → 侦察 → 计划 → 执行 → 记录 → 验证 → 交付可审查结果」。

### Chunked Final（分段最终回答）
长 research final 的分段协议。模型用 `RANNI_FINAL_PART n/N`、`RANNI_FINAL_CONTINUE`、`RANNI_FINAL_DONE` 输出多段；Harness 聚合为完整最终回答后再做 quality guard 和 judge。最多 8 段（`MAX_CHUNKED_FINAL_PARTS`）。

### Research Eval（研究评测闭环）
`npm run research:eval` 提供的本地 deep research 评测 CLI，输出 trace、final、metrics、score、trajectory analysis、rubric / claim audit / style judge、pairwise judge。用于优化 research agent 行为与用户可见质量，产物写入已忽略的 `research/research-eval/`。
