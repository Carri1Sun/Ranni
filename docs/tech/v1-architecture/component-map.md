---
author: codex
version: v1
date: 2026-07-06
---

# Component Map

这份文档用于快速定位 Ranni 当前核心目录、核心文件和它们的职责。

## 顶层目录

| 路径 | 职责 |
| --- | --- |
| `components/` | React UI 组件和 CSS module |
| `src/renderer/` | Vite 前端入口 |
| `src/server/` | Express 后端、API、静态网页托管 |
| `lib/` | Agent loop、事件总线、运行注册表、EventMapper、工具、模型适配、trace、workspace、task memory |
| `skills/` | 本地动态 skill 包，当前产品能力为 `html` 和 `html-to-pptx` |
| `docs/` | 产品、架构、核心概念 |
| `public/` | 浏览器可访问静态资源 |
| `scripts/` | 维护脚本，例如 logo 资产生成、research eval、HTML 设计预览生成、HTML-to-PPTX spike runner |

## 根目录文件

| 路径 | 职责 |
| --- | --- |
| `README.md` | 项目入口文档，说明当前能力、启动方式、API 和文档索引 |
| `AGENTS.md` | 给后续 coding agent 的仓库规则、提交格式、文档维护规则 |
| `UI-NAMING.md` | 页面区域、可见 UI 元素和事件到 UI 投影的权威词表 |
| `CONCEPT-NAMING.md` | Agent Runtime 概念、状态语义、事件层和模块责任的权威词表 |
| `.env.example` | 本地环境变量模板 |
| `.gitignore` | 忽略依赖、构建产物、运行期 research 和 `.ranni` 记忆 |
| `package.json` | npm 脚本、运行依赖和开发依赖 |
| `vite.config.ts` | 前端 Vite 构建和开发期 API 代理 |
| `tsconfig.json` | 前端和共享 TypeScript 配置 |
| `tsconfig.node.json` | Node/Express 构建配置 |

## 前端核心

### `components/agent-console.tsx`

这是当前最核心的前端组件，负责整个工作台界面。

主要职责：

- session 创建、切换、保存、压缩。
- 从后端加载完整 Session 消息，并把旧 localStorage 消息迁移到 Session workspace。
- workspace picker 交互。
- settings modal。
- chat / report / trace 三个页面。
- session 级 SSE 订阅（`GET /api/events`），只读消费三层事件：Layer3 notification 驱动主 UI 状态、Layer2 重建 trace/debug 视图、Layer1 live delta 流式打字。
- run、step、tool、task state、thinking trace 的前端合并。
- 从持久化 Trace API 加载 Session Run、Run Overview Projection、Step index 和单 Step I/O；服务重启后通过当前 Session workspace 重新发现历史 Run。
- 通过 `run.overview.updated` 实时替换当前 Run 的完整概览快照，并按 `latestSeq` 忽略重复或更早快照。
- 在运行详情中装配运行概览、计划与进度视图和 Step 输入输出查看器，并在运行状态栏提供整体计划面板和入口。
- thinking delta 的前端内存态展示、最终 thinking 持久化切换和 assistant delta 消息更新。
- 前端流事件顺序日志、消息流 UI 顺序和导出。
- 最多 3 个并行 agent run 的前端状态、按 session 终止和上限弹窗。
- 展示文案直接取自后端 notification（含 model 改写），前端不再二次请求 LLM。
- 运行中补充消息（steer）、手动终止运行（POST abort）。
- lastSeq localStorage 持久化，断线重连续传。
- assistant 消息复制、导出 markdown。
- session 级 trace 导出，包含未完成 run。
- 首条消息异步 session 命名。
- 输入框内的临时能力开关，例如“网页”和“PPTX”。

页面结构映射：

- `main.shell` / `workspace`：工作台。
- `aside.sidebar`：导航栏。
- `section.chatShell`：会话栏，包含 `chatHeader`、`draftSession`、会话 / 报告 / 运行详情内容和 `composer`。
- `aside.inspector`：运行状态栏。

### `components/agent-console.module.css`

工作台主要样式文件。

覆盖：

- 三栏布局。
- 左侧导航。
- 会话消息。
- 报告页。
- 运行详情页。
- 运行状态栏。
- 会话过程项、运行中状态 badge、扫光动效。
- Run 生命周期弱提示和 thinking 正文流式/渐进展示。
- 设置弹窗。
- workspace picker。
- provider list。
- 运行概览、整体计划面板、计划覆盖与交付验收进度条、计划变化时间线、语义卡片、验收状态、Step I/O tabs、输入构成、上下文健康和窄屏布局。

### `components/run-observability.tsx`

运行详情的语义展示组件：

- 运行概览展示当前计划、当前路线、下一步、验收清单、交付缺口、当前阻塞、完成依据和进展回执。
- Step 输入输出查看器展示 Input / Output / 原始数据 tabs、上下文健康检查、输入构成列表和 tool call/result 配对。
- 持久化 I/O 加载失败或旧 Run 缺少语义字段时回退到实时 Legacy Trace。

### `components/run-plan-progress.tsx`

Run 级整体计划与进度组件：

- `compact` 形态嵌入运行状态栏，持续展示当前 Plan Focus、有效计划项和两类进度。
- `detail` 形态构成“计划与进度”视图，展示完整计划项、当前 Attempt、下一动作、已取消或已替代项和计划变化时间线。
- 计划覆盖统计 `satisfied / 有效计划项`，分母排除 `cancelled` 和 `superseded`；交付验收统计必需验收项中的 `passed + waived / required`。
- “调整计划”把自然语言要求预填到 Composer；Agent 通过 `update_plan` 形成结构化 Plan Revision 后，UI 才显示新的修订。
- 时间线条目可以按 `stepIndex` 定位到对应历史 Step I/O。

### `components/run-observability-model.ts`

优先把 `RunOverviewProjection` 确定性投影为当前 Run 的 UI view model，并在缺少运行级快照时从持久化 Step I/O 或实时 `TraceStep` 做 Legacy 回退。负责 Plan、Acceptance、Progress、Attempt 汇总、计划时间线、因果链健康检查、Context section 展开数据和按 toolUseId 配对，避免 React 组件承担 Trace 语义推导。当前完整快照与用户选择的历史 Step I/O 保持独立。对应测试为 `components/run-observability-model.test.ts`。

### `components/markdown-content.tsx`

Markdown 渲染组件，当前用于 assistant 消息和报告正文。

### `src/renderer/App.tsx`

前端应用壳，加载 runtime 信息并渲染 `AgentConsole`。

### `src/renderer/main.tsx`

React 应用入口。

## 服务端核心

### `src/server/app.ts`

Express 应用定义。

主要职责：

- CORS 和 JSON body 处理。
- 健康检查。
- runtime 查询。
- workspace 推荐、校验、系统目录选择。
- session title 生成。
- 接线全局 EventBus / RunRegistry / EventMapper。
- 初始化 RunTraceStore，并注册持久化 Run / Step 查询路由。
- Command 通道：启动 run、补充消息（steer）、中断（abort），最多 3 个 active run 并发上限；新 Run 会消费同 Session、同 workspace 的最新可恢复状态，并把最新用户消息作为恢复 Steering。
- Event 通道：`GET /api/events` SSE 单向下行广播（Last-Event-ID 续传 + 心跳）。
- model provider 测试。
- Tavily 测试。
- 生产模式静态网页托管。

关键 API：

- `GET /health`
- `GET /api/runtime`
- `GET /api/workspaces/roots`
- `GET /api/workspaces/list`
- `POST /api/workspaces/validate`
- `POST /api/workspaces/auto-create`
- `POST /api/workspaces/pick`
- `POST /api/session/title`
- `GET /api/session-history`（Session 历史摘要）
- `GET /api/session-history/:sessionId`（完整用户与 assistant 消息）
- `PUT /api/session-history/:sessionId/messages`（增量持久化消息与元数据）
- `POST /api/runs`（启动 run，达到上限返回 `AGENT_CONCURRENCY_LIMIT`）
- `GET /api/runs/status`（按 session 查询当前进程内 Run 状态）
- `GET /api/sessions/:sessionId/runs?workspaceRoot=...`（合并当前进程与 workspace 持久化 Run Trace）
- `GET /api/runs/:runId/overview?workspaceRoot=...`（读取当前 Run 的完整运行概览投影）
- `GET /api/runs/:runId/steps?workspaceRoot=...`（读取或重新发现 Run，并返回 Step 索引）
- `GET /api/runs/:runId/steps/:stepId/io?workspaceRoot=...`（读取冻结的 Step 输入输出）
- `GET /api/events`（SSE，query `streamKey` + `lastSeq`）
- `POST /api/runs/:runId/steer`（补充消息入队）
- `POST /api/runs/:runId/abort`（中断）
- `POST /api/model/test`
- `POST /api/tavily/test`
- `POST /api/computer-use/test`

### `src/server/index.ts`

后端启动入口，读取 host/port 并监听服务。

### `src/server/env.ts`

加载环境变量。

## Agent 核心

### `lib/agent.ts`

稳定公共 facade。保留 `runAgentTurn` 公开调用方式、公开类型和少量兼容纯函数，具体运行策略由 `lib/agent/` 承担。Server 和 research eval 继续从这个路径导入。HTML-to-PPTX 工具定义的 re-export 是现有公共调用方的兼容桥，不承载领域运行策略。

### `lib/agent/`

通用 Agent Harness 的运行边界：

| 路径 | 当前职责 |
| --- | --- |
| `lib/agent/run-controller.ts` | Run 初始化、Steering、Step 循环、终止和预算 |
| `lib/agent/step-runner.ts` | 冻结 Context / exact request、调用 Provider、追加完整工具批次、发布语义事件并委托完成判断 |
| `lib/agent/run-state.ts` | `AgentRunState`、Task Contract、Working Set、`planAuthority` 计划权威边界和 TaskState 兼容投影 |
| `lib/agent/runtime-services.ts` | Research Notebook 与 Task Memory 的领域服务创建适配边界，向通用 Controller 暴露窄运行依赖 |
| `lib/agent/event-sink.ts` | v2 运行事件发布与 legacy StreamEvent 兼容 |
| `lib/agent/tool-batch-executor.ts` | 工具请求校验、安全检查、顺序执行、幂等复用和完整 Tool Receipt 批次 |
| `lib/agent/finalization-controller.ts` | Acceptance / Deliverable / 当前证据驱动的完成决策 |
| `lib/agent/recovery-controller.ts` | Abort、Provider 故障和未完成工件的恢复决策与 checkpoint |
| `lib/agent/chunked-final-controller.ts` | 长回答分段解析、continue / repair、最多 8 段聚合和完成候选生成 |
| `lib/agent/policy.ts` | `RunPolicySet` 通用窄接口 |
| `lib/agent/streaming.ts` | abort-aware 文本节奏与流式聚合 |
| `lib/agent/types.ts` | 稳定公开入参、结果与 `StepOutcome` 类型 |

### `lib/context/`

- `composer.ts`：Context Composer V2。验证最近 tool call/result 配对，保留最近四个完整因果轮次；仅在安全输入预算达到 75% 后压缩较老历史。
- `types.ts`：Task Contract、Working Set、Context Envelope 和 Composition Manifest。
- `system-prompt.ts`：稳定 Harness contract、Skill 正文、Research Handoff 和当前工作集。
- `trace-snapshot.ts`：把 Context Envelope 与真实工具定义转换为 Trace snapshot。

`lib/active-context.ts` 只保留迁移兼容 facade，不再按 HTML-to-PPTX phase 投影或删除 conversation。

### `lib/receipts/`、`lib/acceptance.ts`、`lib/progress.ts`、`lib/plan.ts`、`lib/plan-attempt.ts`

- `receipts/registry.ts`：工具事实进入 Observed State 的统一入口；记录 input/result hash、文件、命令、证据、工件、验证和未解决错误，并按 `(toolUseId, inputHash)` 复用已完成执行。
- `acceptance.ts`：从 Deliverable Contract 派生 criterion，并且只根据当前有效回执或用户明确豁免更新状态。
- `progress.ts`：区分 objective progress、information gain 和 regression；`noObjectiveProgressStreak` 的 3 / 6 轮阈值只提醒交付节奏，相同策略真实失败或 `noMeaningfulProgressStreak` 达到阈值时更新 Attempt，10 轮无 meaningful progress 时保存 checkpoint。
- `plan.ts`：维护 Working Plan、稳定 Plan Item ID、Plan Revision、Objective Projection、Plan Focus 与恢复序列化。`update_plan` 修订计划；候选计划在提交前事务式校验重复 ID、自依赖、未知依赖和依赖环；Tool Receipt 与 Acceptance Snapshot 协调计划项客观状态。
- `plan-attempt.ts`：维护 Attempt、Assumption、路线失败、替代和证据引用。`replace_attempt` 在具体方法实质改变时创建新 Attempt。

### `lib/policies/registry.ts`、`lib/html-to-pptx/artifact-policy.ts` 与 `lib/html/artifact-policy.ts`

Policy registry 负责把任务与已激活 Skill 组装成通用 `RunPolicySet`，并在动态 Skill 加载后重新派生契约。HTML-to-PPTX Policy 派生 PPTX Deliverable Contract、Receipt projector 和安全工具能力；静态 HTML Policy 要求桌面与移动视口 QA 零告警；其余明确要求写入 workspace 的任务至少需要真实文件回执，并在用户要求验证时需要成功验证命令。工件关注点变化只移除绕过专用工件防线的通用 mutation 工具，研究、读取、Task Memory、工件检查和验证能力持续可用。

### `lib/session-history-store.ts`

Session 消息历史存储层。负责读取和校验 `ranni.session-history.v1`、扫描默认 workspace 下的 Session 摘要、按消息 ID 增量合并，并通过串行写入队列与原子 rename 保存 `<session-workspace>/.ranni/session-history.json`。

### `lib/events/`

v2 事件驱动架构的核心模块。

- `schema.ts`：三层事件类型（ProviderEvent / TraceEvent / ClientNotification）+ 三段式（textId / thinkingId）+ 共享展示类型（ActivityDisplay / ProcessIconId / ActivityType）+ `DURABLE_EVENT_TYPES`；`run.overview.updated` 携带完整 `RunOverviewProjection`。
- `schema.ts` 的语义 Trace 事件还包括 `tool.batch.started`、`tool.receipt`、`state.observed.updated`、`plan.updated`、`attempt.updated`、`assumption.invalidated`、`acceptance.updated`、`progress.receipt`、`recovery.started` 和 `completion.checked`。
- `event-bus.ts`：进程内单例 EventBus。per-streamKey(=sessionId) ring buffer + 单调 seq + 同步回放订阅 + `subscribeAll`。durable 入 buffer 可回放，live-only 仅广播。
- `legacy-map.ts`：旧 `StreamEvent` → v2 事件映射纯函数，供 `lib/agent/event-sink.ts` 的兼容发布层使用。

### `lib/runs/`

运行实例管理与展示投影。

- `run-registry.ts`：运行注册表。runId 在此生成（上移自 agent），维护 steerQueue（steer/drainSteer）、abort（触发 AbortController + 清空队列）、并发计数（activeCount），并暂存失败 Run 的可恢复状态。下一次同 Session、同 workspace 请求会一次性取出该状态；恢复绑定校验防止 Receipt Registry 跨 workspace 复用副作用。
- `run-overview-projection.ts`：共享纯 reducer。按单调事件 `seq` 聚合 Working Plan、Attempt、Acceptance、Progress、TaskState、Observed State、Completion 和 Recovery，生成完整 `RunOverviewProjection`、`latestSeq` 与最多 120 条变化时间线；同 Run 的重复或更早事件保持幂等。
- `event-mapper.ts`：EventMapper。订阅 Layer2 TraceEvent 并确定性投影为 Layer3 ClientNotification；对运行概览事实使用共享 reducer，发布 `run.overview.updated` 完整快照。默认不发辅助模型请求。仅在 `RANNI_ACTIVITY_REWRITE_ENABLED=true` 时为工具活动异步生成 model display；`task.state` 继续按签名去重。
- `display-fallback.ts`：展示文案 fallback 纯函数（前后端共享，从 components/agent-console.tsx 抽取）。
- `activity-rewrite.ts`：LLM 改写逻辑（prompt / 脱敏 / 解析 / `rewriteActivityDisplay`），供 mapper 使用。
- `run-trace-store.ts`：把脱敏后的 Layer2 事实增量写入 Session workspace 下的 `.ranni/runs/<runId>/`，使用同一 reducer 原子维护 `overview.json`，同时维护 run summary、Step index 和逐 Step I/O；支持按 workspace 发现进程重启前的 Run。

### `src/server/run-trace-routes.ts`

提供持久化 Trace 查询：Session Run 列表、Run Overview Projection、Run Step 索引和单 Step I/O。运行中的 Run 使用 RunRegistry workspace 映射；UI 为历史 Session 附带已选择的 workspaceRoot，路由据此扫描 `.ranni/runs/` 并恢复只读查询映射。`GET /api/runs/:runId/overview` 与 SSE `run.overview.updated` 返回同一种完整快照结构。

### `lib/tools.ts`

工具注册和执行层。

主要职责：

- 定义工具 schema。
- 执行文件、搜索、终端、网页、research、task memory 工具。
- 注册 `update_plan` 和 `replace_attempt`，分别修订 Working Plan 和替换具体 Attempt。
- 让文件列表、读取、内容搜索和 task memory 读取等安全观察能力保持可组合。
- 注册 `operate_computer`，把 OpenAI computer tool loop 接入 agent 工具调用。
- 限制 workspace 越界。
- 限制危险命令。
- 支持 abort signal。
- 将 Tavily key 和 Computer use OpenAI key 从 settings 或 env 传入工具层。

### `lib/computer-use/`

OpenAI computer-use 运行层。

主要职责：

- `openai-computer-use.ts` 调用 OpenAI Responses API 的 `computer` tool，处理 `computer_call` / `computer_call_output` 循环。
- `macos-adapter.ts` 负责 macOS 屏幕截图、坐标换算、点击、移动、滚动、输入、按键和拖拽。
- 截图和动作日志写入当前 run 的 `.ranni/runs/<runId>/computer-use/`，没有 task memory 时写入 workspace 下 `.ranni/computer-use/`。
- 依赖 macOS Screen Recording 和 Accessibility 权限。

### `lib/task-state.ts`

结构化任务状态。

`update_task_state` 的模型可见契约只允许维护 mode、next action、assumptions 和 open questions。执行层继续解析旧调用方的兼容 plan 输入。用户目标、交付条件、客观 facts、文件、命令和 verification 由 Task Contract 与 Receipt Registry 维护。`AgentRunState.planAuthority` 在 `legacy` 与 `structured` 之间标记计划权威边界；首次使用 `update_plan` 后，结构化 Working Plan 持续作为权威，`TaskState.plan` 只同步标题兼容投影。旧 plan 输入只在 `legacy` 模式下桥接到 Plan Ledger。同义更新返回 `noChange: true`，不会产生客观进展。

### `lib/task-memory.ts`

`.ranni` 持久化任务记忆。

每个 run 创建：

```text
.ranni/runs/<runId>/
  state.md
  todo.md
  plan.json
  verification.md
  errors.md
  decisions.md
  assumptions.md
  evidence.md
  source-ledger.md
  claim-ledger.md
  coverage-matrix.md
  synthesis-brief.md
  negative_results.md
  sources/
  checkpoints/
```

`plan.json` 保存可恢复 Plan Ledger，`todo.md` 按稳定 Plan Item ID 生成人类可读投影。checkpoint 可以同时写入完整 `AgentRunRecoverySnapshot` JSON。

### `lib/research.ts`

Research notebook 运行期记录。

用于规划调研问题、记录 finding、审查 research state、保存 research checkpoint。

当前支持 deep research 质量字段：

- coverage dimensions。
- source strategy。
- stop rules。
- evidence source type / date / claim span。
- source mix、coverage gaps、low-confidence findings、open questions 审查。

### `scripts/research-eval.ts`

本地 deep research 评测 CLI。

主要职责：

- 创建本地 EventBus / RunRegistry，订阅 v2 事件并用 `toLegacyEvent` 反向映射回旧 `StreamEvent`，保持既有分析逻辑不变；调用 `runAgentTurn` 跑 research case。
- 输出 `trace.ndjson`、`final.md`、`metrics.json`、`score.md`、`trajectory-analysis.md`、`comparison.md`。
- 读取 `.ranni/runs/<runId>/` 中间文件，分析文件记忆是否被写入和读回。
- 支持 run 对比：`--compare <baseline> <candidate>`。
- 支持最终产物 judge：`--judge-run <run>`、`--judge-pair <a> <b>`、`--judge`。
- 输出 `judge-rubric.json`、`judge-rubric.md`、`claim-audit.md`、`style-judge.json`、`style-judge.md` 和 pairwise judge 文件。

### `scripts/slides-html-pptx-spike.ts`

本地 HTML-to-PPTX spike runner。

主要职责：

- 创建或复用 `ranni-session-html-pptx-spike` session workspace。
- 顺序调用 `init_slide_html_workspace`、`prepare_slide_html_for_pptx`、`export_html_to_pptx`、`validate_html_pptx_export`。
- 生成 8 页受限 slide HTML 示例、局部截图回退资产、HTML 预览、PPTX 预览状态、`measurements.json`、`qa-report.json` 和最终 `.pptx`。

### `lib/trace.ts`

Trace 类型定义。

定义 run、step、model request、model response、tool call、tool result、Context Composition Manifest、Task Contract、Working Set、Observed State、Progress Receipt 和 stream event 等结构。

### `lib/workspace.ts`

Workspace 边界工具。

### `lib/skills/registry.ts`

本地动态 skill 注册表。

主要职责：

- 扫描 `skills/*/SKILL.md` 并解析 `name` / `description` / 正文。
- 为 Skill Index 提供版本、正文 SHA-256 hash 和资源路径元数据。
- 提供 system prompt 的轻量 skill 索引和已激活 skill 正文。
- 加载已激活 skill 的 `tools.ts` 专属工具。
- 规范化 `activeSkills`，过滤不存在的 skill。

`resolveWorkspacePath` 保证文件工具只能访问当前 workspace 内的路径。

### `lib/skills/runtime-instructions.ts`

Skill runtime instruction 统一入口。

主要职责：

- 按 `activeSkillNames` 选择需要注入的 runtime instruction builder。
- 读取 `toolSettings` 中对应 skill 的选择项，并委托领域模块生成 prompt 片段。
- 从 `skills/html-design/reference-materials/base-html-design-guide.md` 注入 HTML design 基础 guide。
- 让 Step Runner 通过统一 builder 获取领域指令，避免在通用运行循环内拼接具体 Skill 的业务字段。

### `skills/html/tools.ts`

HTML skill 专属工具。

主要职责：

- `init_html_workspace` 初始化静态网页目录，写入 `index.html`、`styles.css`、`assets/`、`preview/` 和生成报告。
- `validate_static_html` 用 Playwright 渲染桌面和移动视口，输出预览截图和 `qa-report.json`。
- 所有工具输入输出通过 workspace resolver 解析。

### `skills/html-to-pptx/tools.ts`

HTML-to-PPTX skill 专属工具。

主要职责：

- `init_slide_html_workspace`、manifest、样式分片、逐页写入、组装、prepare、export 和 validate 提供 HTML-to-PPTX 路线的工具入口。
- `write_slide_fragment` 管理 draft、语义诊断和 accepted 原子 promote；`inspect_slide_fragment` 与 `patch_slide_fragment` 提供可组合的失败观察和局部修复能力。
- 保留 zod schema、workspace resolver、模板初始化、artifact receipt 和 `.mjs` 脚本调度。
- 所有工具输入输出通过 workspace resolver 解析。

### `skills/html-to-pptx/scripts/html-pptx/`

HTML-to-PPTX 脚本实现目录。

主要职责：

- 用 Playwright 渲染、测量、截图回退，并在 `preflight.mjs` 中区分正文越界和允许裁切的背景装饰。
- 用 `dom-to-pptx` 导出有限可编辑 PPTX。
- 用 LibreOffice、Poppler、JSZip、pixelmatch 和 pngjs 执行预览、结构检查和客观视觉 smoke check。

### `lib/html-design/catalog.ts`

HTML 设计风格和网页类型 catalog。

主要职责：

- 从 `skills/html-design/styles/*/guide.md` 和 `skills/html-design/patterns/*/guide.md` 加载文件化内容资产。
- 用 schema 校验运行时字段，并把 Markdown 正文转换成 `guidance`。
- 提供后端接口、前端选择卡片、HTML 工具和 runtime instruction prompt 需要的查询函数。
- 忽略 `sources` 人工参考字段，避免外部 URL 进入 API 和默认 agent runtime prompt。
- 在同目录 `reference.md` 存在时，为 runtime prompt 提供本地参考资料路径，参考资料正文不默认注入。
- 加载失败时返回可用文件集合；目录缺失或全部失败时返回空数组。

### `skills/html-design/`

HTML design 文件化内容资产目录。

主要职责：

- `styles/*/guide.md` 保存设计风格，包含 `id`、`name`、`description`、颜色、预览图、标签、正文 guidance 和指向同目录参考资料的 `sources`。
- `styles/*/reference.md` 保存与对应设计风格同目录的本地化参考资料。
- `patterns/*/guide.md` 保存 HTML 页面 pattern，额外包含 `sections`。
- `patterns/*/reference.md` 保存与对应页面 pattern 同目录的本地化参考资料。
- `reference-materials/base-html-design-guide.md` 保存 runtime 注入的产品级基础 guide。
- 文件顺序通过数字前缀表达，首个可用文件作为默认选项。

### `lib/html-to-pptx/sample-decks.ts`

HTML-to-PPTX 内部示例 deck registry。

主要职责：

- 扫描 `skills/html-to-pptx/examples/*/manifest.json`。
- 为本地 spike 脚本和 HTML-to-PPTX 工具提供示例 deck 元信息。
- 用户 PPTX 路径不提供模板选择，agent 根据设计风格和用户内容规划页面结构。

### `skills/html-to-pptx/examples/default-business/`

内部 HTML-to-PPTX spike 示例 deck。

主要职责：

- 提供真实 `deck.html`、`styles.css`、`manifest.json`、`tokens.json`、`guidance.md` 和本地 SVG 资产。
- 覆盖封面、目录、文本、双栏图文、数据表格、复杂图表截图回退、时间线和总结页。
- 遵守 HTML-to-PPTX 设计指南中的画布、排版、留白、低圆角、静态输出和 PPTX 兼容性规则。

### `src/server/app.ts` HTML design API

HTML 设计选项接口。

主要职责：

- `GET /api/html-design/options` 返回设计风格和网页类型模板。
- `POST /api/runs` 接收 `toolSettings.htmlDesign` 和 `toolSettings.htmlToPptx` 并传给 agent。

### `docs/tech/v2-architecture/slides-skill-design/`

HTML-to-PPTX 设计规范目录。

主要职责：

- 保存 HTML-to-PPTX agent 创作时必须遵守的审美、布局、排版和兼容性准则。
- 为 `SKILL.md` 和 HTML-to-PPTX QA 检查提供规则来源。

### `docs/tech/v1-architecture/agent-arch/architecture-defenses.md`

定义 Agent harness 的权限、指令、状态真实性、产物原子性、协议、完成、恢复、审计和资源防线，以及 Task Contract / Agent Note / Observed State、Event Log / Context Composer V2 和 draft / accepted 语义。

## 模型 Provider

### `lib/llm/index.ts`

根据 `modelConfig.provider` 或 `LLM_PROVIDER` 选择 provider。

默认 provider 是 `deepseek`。

### `lib/llm/providers/openai-compatible.ts`

OpenAI-compatible 通用 provider。

主要职责：

- 构造 chat completions 请求。
- 解析 text、thinking、tool calls。
- 解析 OpenAI-compatible Chat Completions 流式响应，向 agent 回传 thinking delta。
- 保留 raw tool input 和 JSON parse error。
- 处理 retry。
- 支持 abort。
- 生成 trace request/response。

### `lib/llm/providers/deepseek-openai.ts`

DeepSeek 配置：

- 默认模型 `deepseek-v4-pro`。
- 默认开启 thinking。
- 默认 `reasoning_effort=high`。
- thinking mode 下回传 assistant `reasoning_content`。

### `lib/llm/providers/openai.ts`

OpenAI 官方 API 配置：

- 默认模型 `gpt-5.5`。
- 默认 base URL `https://api.openai.com/v1`。
- 使用 Chat Completions endpoint 接入现有 agent tool-calling loop。
- 使用 `max_completion_tokens` 控制输出上限。
- 环境变量覆盖项为 `OPENAI_MODEL` 和 `OPENAI_BASE_URL`。

### `lib/llm/providers/chatgpt-subscription.ts`

本机 ChatGPT 订阅配置：

- 通过 `CODEX_API_PORT` 连接 CLIProxyAPI BFF，默认端口 `8790`。
- 从 `/api/models` 读取当前 OAuth 账号的模型和 effort 目录。
- 通过 `/api/agent` 调用 Responses API 语义的 SSE、function calling 和 reasoning summary。
- 将 thinking、正文和 function call 规范化为 Ranni 的 assistant blocks。
- 在 `store=false` 模式下保留加密 reasoning item，并随工具结果回传给后续模型请求。
- 只有收到完整 `done` 才提交响应；瞬时网络、提前 EOF、408 / 429 / 5xx 最多额外重试两次，并复用相同请求。失败尝试中的半截 thinking 和工具调用不会进入正式 conversation。
- 无需在 Ranni 浏览器设置中保存 API Key。

### `lib/llm/providers/qwen-openai.ts`

Qwen / DashScope 配置：

- 默认模型 `qwen3.6-plus`。
- 默认 base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 默认 context window `1_000_000`。

### `lib/llm/providers/anthropic-compatible.ts`

Anthropic-compatible 通用 provider。

主要职责：

- 构造 Messages API 请求。
- 解析 text、thinking、tool use 和 tool result content blocks。
- 解析 Anthropic-compatible 流式响应，向 agent 回传 thinking delta。
- 处理 retry。
- 支持 abort。
- 生成 trace request/response。

### `lib/llm/providers/minimax-token-plan.ts`

MiniMax Token Plan 配置：

- 默认模型 `MiniMax-M3`。
- 默认 base URL `https://api.minimax.io/anthropic`。
- 默认 context window `1_000_000`。
- 使用 `MINIMAX_TOKEN_PLAN_KEY` 读取 Subscription Key。
- 全球 endpoint 鉴权区域不匹配时尝试 `https://api.minimaxi.com/anthropic`。
- 前端模型 Provider 列表提供 MiniMax 国际和 MiniMax 中国两个选项，分别显式传入 `https://api.minimax.io/anthropic` 和 `https://api.minimaxi.com/anthropic`，并复用同一个 Token Plan Key 配置。

### `lib/llm/providers/custom-openai.ts`

自定义 OpenAI-compatible provider。

用户需要提供 base URL、model 和 API key。

## 维护脚本

### `scripts/generate-logo-assets.py`

从根目录 `logo.png` 生成 favicon、apple touch icon、manifest logo 等资产。

运行：

```bash
npm run assets:logo
```
