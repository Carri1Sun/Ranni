# Ranni Agent 概念命名约定

这份文档是 Ranni Agent Loop、Context、状态、Skill、Policy、Receipt、验收、恢复、事件层和模块边界的协作词表。产品讨论、架构设计、Issue、代码 Review 和技术文档应使用这里的规范中文名。

## 1. 权威范围

| 文档 | 负责定义 | 配合关系 |
| --- | --- | --- |
| `CONCEPT-NAMING.md` | Agent Runtime 概念、状态语义、事件层和模块责任 | 为 UI 与架构文档提供统一概念名 |
| `UI-NAMING.md` | 可见 UI 元素、页面区域、消息流元素和事件到 UI 的投影 | 引用本文件定义的 Runtime 语义 |
| `docs/tech/architecture-global/glossary.md` | 代码落点和跨架构实现索引 | 使用本文件的规范名称补充实现细节 |
| 通用 Agent Harness 三份架构文档 | 设计动机、完整契约、执行细节和演进路线 | 使用本文件的概念名展开设计 |
| 当前代码与类型 | 已实现字段、事件 schema 和模块入口 | 为命名文档提供可核对的实现事实 |

当代码、架构文档与命名文档出现差异时，应在同一变更中消除差异。讨论期间使用“规范中文名（代码名）”标记差异位置。

## 2. 使用规则

1. 首次出现概念时使用“规范中文名（English / code name）”，后续使用规范中文名。
2. “状态”“计划”“阶段”“上下文”“结果”“完成”“任务”等词必须带能够确定对象的限定词。
3. 代码标识保持原样，例如 `ObservedState`、`progress.receipt`、`load_skill`。
4. Runtime 概念与 UI 元素分开命名。例如“进展回执”是 Runtime 数据，“进展回执卡片”是 UI 元素。
5. Action Mode 和工件关注点用于描述当前意图或现场，不构成固定状态机。
6. 兼容概念需要带“兼容”限定词，例如“任务状态兼容投影”“旧 StreamEvent 兼容事件”。

## 3. 执行层级

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| Agent | Agent | 在模型、Harness、Active Skills、工具和 Session 工作区现实共同作用下执行用户目标的工作主体。 |
| 模型 | Model | 根据 Context Envelope 进行 reasoning、选择路线、调用工具并生成最终候选。 |
| Agent Harness | Harness | 组装 Context、执行工具、维护客观事实、保护权限与协议、判断完成和恢复的运行控制层。 |
| Provider 适配器 | Provider Adapter | 把具体模型服务适配到统一模型请求、流事件、工具协议、重试和 Abort 语义。 |
| 会话 | Session | 用户在工作台中的持续对话容器，绑定一个 Session 工作区，可以包含多个 Run。 |
| 运行 | Run | 一次用户提交触发的完整 Agent 执行，拥有 `runId`、多个 Step、一个终止结果和持久化 Trace。 |
| Agent 循环 | Agent Loop | Run 内持续组装 Context、请求模型、执行工具、协调客观状态、判断完成或恢复的循环。 |
| 步骤 | Step | 一次主模型请求及其输出处理边界。一个 Step 可以输出工具批次、最终候选、Guard 打回或错误。 |
| 因果轮次 | Causal Turn | 一组连续的 assistant reasoning、text、tool call 与全部匹配 tool result。Progress Receipt 和语义状态变更归属同一 Step，并通过 Working Set 与 Trace 进入后续判断。 |
| 正式对话 | Conversation | 已提交的用户消息、完整模型响应和工具结果序列。失败 Provider 尝试的半截响应不进入该序列。 |
| 工具批次 | Tool Batch | 同一模型响应中产生的一组工具调用。Harness 在批次内执行、配对并汇总回执。 |
| 补充要求 | Steering Message | Run 进行中由用户追加的要求，在下一 Step 边界进入 Task Contract 和 Context Envelope。 |
| 运行终止结果 | Run Result | `completed`、`failed` 或 `cancelled`，附带最终消息、错误或恢复检查点。 |

### Step 结果

| 规范中文名 | `StepOutcome.kind` | 含义 |
| --- | --- | --- |
| 工具批次结果 | `tool_batch` | 工具已经执行并协调状态，Agent Loop 继续下一 Step。 |
| 完成条件打回 | `guard_retry` | 模型给出最终候选，但客观完成条件尚未满足；下一 Step 继续工作。 |
| 最终结果 | `final` | 最终候选通过完成检查，可以结束 Run。 |
| 恢复结果 | `recover` | 当前现场已保存为恢复检查点，Run 以可恢复失败结束。 |
| 失败结果 | `failed` | 出现无法继续的错误，Run 失败结束。 |

“完成条件打回”和“Provider 请求重试”是两个独立概念。前者产生新的 Step，后者在同一模型请求内部有界重试。

## 4. Context 概念

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 上下文信封 | Context Envelope / `ContextEnvelope` | Step 发给 Provider 前的完整语义输入包，包含 system prompt、messages、工具定义和组成清单。 |
| 上下文组合器 | Context Composer | 按稳定契约组装 Context Envelope，并在安全输入预算需要时压缩较老历史。 |
| 任务契约 | Task Contract | 用户目标、交付物、约束、成功条件和授权边界的稳定表达。 |
| 当前工作集 | Working Set | 每个 Step 重新生成的当前工作视图，包含 Agent Note、Observed State 摘要、Working Plan、验收缺口、当前 Attempt、研究交接和未解决错误。 |
| 最近因果尾部 | Recent Causal Tail | 最近完整 Causal Turn 的精确 Provider 消息，保留 tool call 与全部 tool result 配对。 |
| 历史摘要 | Archive Summary | 容量压缩时从较老历史派生的摘要。它保存关键决策、证据和引用。 |
| 补充要求区 | Steering Section | 当前 Step 新收到的 Steering Message 集合。 |
| 可用工具定义 | Available Tool Definitions | 当前 Active Skill 和 Run Policy 共同暴露给模型的工具 schema。 |
| 上下文组成清单 | Context Composition Manifest | 记录各语义区块、token 估算、压缩原因、因果配对、Skill hash、稳定前缀和 snapshot hash。 |
| 上下文快照 | Context Snapshot | 持久化到 Trace 的脱敏 Context Envelope 视图。 |
| 稳定前缀 | Stable Prefix | Task Contract、Active Skill 和工具定义共同形成的可复用前缀身份。 |
| 安全输入预算 | Safe Input Budget | Context Window 扣除最大输出和安全余量后的输入容量。 |
| 容量压缩 | Capacity Compaction | 完整输入超过安全预算阈值时进行的历史压缩，原因记录为 `budget` 或 `provider-limit`。 |

### Context 不变量

- 最近因果尾部按完整 Causal Turn 保留。
- 上一轮每个 `tool_use_id` 必须存在匹配的 Tool Result。
- Skill 激活、工件关注点变化和 Agent Note 更新不会触发容量压缩。
- Task Contract、当前工作集、补充要求和可用工具定义具有独立语义区块。
- 半截 Provider 响应和不完整工具调用不会提交到正式 Conversation。

## 5. 状态与事实

| 规范中文名 | 英文名 / 代码名 | 写入者 | 权威范围 |
| --- | --- | --- | --- |
| 任务契约 | Task Contract | 用户消息与 Harness | 用户目标、交付、约束、成功条件、授权边界 |
| Agent 工作笔记 | Agent Note | 模型通过 `update_task_state` | 当前行动模式、下一动作、假设和开放问题 |
| 客观现场 | Observed State / `ObservedState` | Receipt Registry | 文件、命令、证据、工件、验证和未解决错误 |
| 工作计划 | Working Plan | 模型通过 `update_plan` 提出修订，Harness 通过客观投影协调 | 用户目标的工作覆盖、结果顺序、当前焦点与证据支持状态 |
| 路线尝试 | Attempt | 模型通过 `replace_attempt` 提出，Harness 根据回执协调 | 当前具体方法、退出条件、关联假设和路线结果 |
| 运行内存状态 | Agent Run State / `AgentRunState` | Run Controller 与 Step Runner | 聚合 Conversation、Task Contract、TaskState、Receipt Registry、Working Plan、Acceptance、Progress、Attempt、Active Skills 和控制器状态；各字段保留自己的权威来源 |
| 任务状态兼容投影 | Task State / `TaskState` | Harness 聚合，部分字段由模型维护 | 兼容旧工具、Task Memory 和现有 UI；协作时应引用更具体的权威对象 |
| 任务记忆 | Task Memory | Runtime 服务与工具 | `.ranni` 下的任务摘要、错误记录、待办和 checkpoint |
| 研究笔记 | Research Notebook | 研究工具 | 来源、发现、证据缺口和研究交接 |
| 运行状态 | Run Status | Run Registry / 生命周期事件 | `running`、`completed`、`failed`、`cancelled` |
| 运行提示消息 | Run Status Message / `run.status` | Harness | 面向用户的连接、重试、进展观察或 Policy 提示；它不改变 Run Status |

### Agent 工作笔记字段

| 规范中文名 | 字段 | 定义 |
| --- | --- | --- |
| 行动模式 | `currentMode` / `ActionMode` | 模型对下一项有意义工作的意图标签，例如 `research`、`edit`、`verify`。 |
| 下一动作 | `nextAction` | 模型当前准备执行的具体动作。 |
| 工作假设 | `assumptions` | 当前路线依赖、仍需证据检验的判断。 |
| 开放问题 | `openQuestions` | 仍需研究、观察或用户决定的问题。 |
| 工作计划兼容投影 | `plan` / `TaskState.plan` | 只保留 Working Plan 当前计划项标题的有损列表。`legacy` 计划权威模式允许旧调用方经兼容桥建立初始计划；`structured` 模式只同步 Plan Ledger 标题，新代码使用 `update_plan`。 |

行动模式只表达当前意图。Agent 可以根据现场自由切换，不需要遵循 `research → plan → act → verify` 顺序。

### 行动模式取值

| 取值 | 规范中文名 | 表达的当前意图 |
| --- | --- | --- |
| `intake` | 请求理解 | 理解用户目标、交付要求和授权边界。 |
| `recon` | 现场侦察 | 读取工作区、配置或已有工件，建立当前现场。 |
| `plan` | 计划协调 | 整理工作覆盖、计划焦点和下一动作。 |
| `edit` | 内容修改 | 修改文件、代码或工件内容。 |
| `shell` | 命令执行 | 通过终端执行构建、转换或其他命令。 |
| `verify` | 结果验证 | 检查工件、测试结果或验收依据。 |
| `debug` | 失败诊断 | 读取错误和现场，定位失败原因。 |
| `review` | 结果复核 | 复核当前输出、证据充分性或交付缺口。 |
| `research` | 外部研究 | 搜索、读取和记录外部资料。 |
| `synthesis` | 结果综合 | 组织最终内容或候选交付说明。 |

这些取值是 Agent 工作笔记中的意图标签。工具权限、Context 压缩和 Skill 能力由各自契约决定。

### 客观现场组成

| 规范中文名 | 字段 | 定义 |
| --- | --- | --- |
| 文件事实 | `files` | 成功文件工具回执确认的路径、hash 和删除状态。 |
| 命令事实 | `commands` | 命令、退出码和超时状态。 |
| 证据事实 | `evidence` | 来源、摘要和回执引用。 |
| 工件事实 | `artifacts` | 工件类型、路径、hash、数量和生命周期。 |
| 验证事实 | `verification` | 验证范围、通过状态、详情和可选页数。 |
| 未解决错误 | `unresolvedErrors` | 失败指纹、策略签名、错误消息和解决状态。 |
| 工具回执序列 | `receipts` | Run 内按执行顺序保存的全部 Tool Receipt。 |

模型文本声明不会直接改变客观现场。

## 6. 工具与回执

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 工具定义 | Tool Definition | 暴露给模型的工具名、描述和输入 schema。 |
| 工具调用 | Tool Call / `tool.started` | 模型请求执行工具的协议对象，拥有 `toolUseId` 和输入。 |
| 工具结果 | Tool Result / `tool.completed` | 返回给模型的文本结果，保持 Provider 工具协议配对。 |
| 工具回执 | Tool Receipt / `tool.receipt` | Harness 对一次工具执行生成的结构化事实，包含 hash、成功状态、策略签名、结果摘要和事实投影。 |
| 工具 Activity 对 | Tool Activity Pair | Event Mapper 为一次工具调用生成的两条前端通知记录：发起 Activity 与结束 Activity；二者通过 `toolUseId` 关联。 |
| 工具调用卡片投影 | Tool Call Card Projection | 前端按 `runId + toolUseId` 把 Tool Activity Pair 投影为一个可展开的消息流元素。该投影只改变渲染，不改变事件、Feed 数据和 Trace 事实。 |
| 回执投影 | Receipt Projection | Tool Receipt 中可合并到文件、命令、证据、工件和验证事实的结构化增量。 |
| 回执注册表 | Receipt Registry | 注册 Tool Receipt、去重并生成 Observed State 的权威容器。 |
| 复用回执 | Reused Receipt | 相同工具调用已经有成功回执时返回的复用标记；已成功副作用不会再次执行。 |
| 未变化回执 | Unchanged Receipt | 工具执行没有改变相关客观状态的回执。 |
| 策略签名 | Strategy Signature | 用于识别相同调用方法和重复失败路线的稳定签名。 |

工具结果服务于模型协议，工具回执服务于 Harness 事实协调。两者通过同一 `toolUseId` 关联。工具 Activity 对服务于前端通知回放，工具调用卡片投影服务于消息流展示；四者共享调用标识并保持各自的数据边界。

## 7. 工作计划、路线尝试与假设

### 工作计划

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 工作计划 | Working Plan / `PlanSnapshot` | Run 内可修订的目标协调结构，表达工作覆盖、结果顺序、依赖、验收引用和当前焦点。 |
| 计划账本 | Plan Ledger / `PlanLedger` | 维护 Working Plan 的权威运行容器，保存稳定计划项 ID、计划修订、客观投影、计划焦点和恢复快照。 |
| 计划项 | Plan Item / `PlanItemRecord` | 单个可观察工作结果，使用 `P01`、`P02` 等稳定 ID，可关联依赖、Acceptance Criterion、Attempt 和证据引用。 |
| 计划修订 | Plan Revision / `PlanRevision` | 模型对计划项集合、顺序、范围或焦点的实质变更，记录原因、变更项、Step 和可选 Observed State hash。语义未变的提交不生成新修订。 |
| 客观投影 | Objective Projection / `PlanChange.kind: "projection"` | Harness 根据 Tool Receipt、Acceptance Snapshot 和 Finalization 更新计划项的证据与满足状态。阻塞状态及原因由 Plan Revision 提交。客观投影增加 `projectionVersion`，不增加 Plan Revision 编号。 |
| 计划焦点 | Plan Focus / `focusItemId` | 当前获得注意的未终止计划项。它帮助回执归属和 UI 展示，不规定工具顺序。 |
| 计划修订工具 | `update_plan` | 提交当前完整计划项集合、修订原因和可选计划焦点。修订既有计划项时复用稳定 ID；未提交的旧计划项进入 `superseded`。 |
| 计划权威边界 | Plan Authority / `AgentRunState.planAuthority` | 标记当前 Run 使用 `legacy` 兼容引导或 `structured` 结构化计划。首次提交 `update_plan` 后进入 `structured`；后续 Working Plan 只由 Plan Ledger 和客观投影更新。 |
| 工作计划兼容投影 | `TaskState.plan` | 只含当前计划项标题的有损列表。旧 `plan` 输入只在 `legacy` 计划权威模式经 `updateLegacy` 建立兼容计划；进入 `structured` 后由 Harness 用 Plan Ledger 标题同步该字段。 |

Working Plan 回答“当前需要覆盖哪些结果”。模型可以报告计划项 `completed`，客观投影需要找到有效 Tool Receipt、Acceptance 依据或通过完成检查，才会将其置为 `satisfied`。`update_plan` 和兼容 `TaskState.plan` 更新属于协调状态，不增加客观交付推进。

结构化 Working Plan 是计划语义、Context 和 UI 的权威来源。`TaskState.plan` 在 `legacy` 权威模式下提供迁移期兼容引导，并可以通过 `PlanLedger.updateLegacy` 建立初始计划；进入 `structured` 权威模式后，它只同步 Plan Ledger 的标题投影，旧 `update_task_state.plan` 输入不会替换结构化计划项。

Recovery Snapshot 显式保存 `planAuthority`。兼容读取缺少该字段的旧快照时使用 `legacy`，因为 Legacy Plan 和结构化 Working Plan 都可能具有非零 Plan Revision，Revision 编号无法判别权威来源。

用户从“调整计划”入口发送的自然语言要求进入 Composer 或运行中的 Steering 通道。Agent 根据要求调用 `update_plan`；Plan Ledger 只在计划覆盖、顺序、范围、状态报告或 Plan Focus 发生语义变化时生成新的 Plan Revision，并通过 `plan.updated` 和运行概览投影同步 UI。输入框中的自然语言和任务状态兼容投影本身不直接增加 Plan Revision。

Working Plan 的依赖图使用规范化稳定 ID。重复 Plan Item ID、自依赖、未知依赖和依赖环属于无效 Plan Revision；Plan Ledger 在提交状态和 ID 计数器前完成整图校验，拒绝结果不会留下部分修订。

### 路线尝试

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 路线尝试 | Attempt / `PlanAttemptRecord` | 对一种具体方法的有界执行记录，包含 approach、退出条件、关联假设、证据和状态。 |
| 当前路线尝试 | Active Attempt | 状态为 `active` 的 Attempt，进入当前工作集和完成检查。 |
| 路线尝试账本 | `PlanAttemptLedger` | 记录 Attempt 的创建、成功、失败、放弃、替代和证据，同时维护假设状态。 |
| 路线方法 | Approach | 当前 Attempt 对完成目标所采用的具体方法。 |
| 路线退出条件 | Exit Criteria | 判断当前 Attempt 获得推进、达成结果或应结束的可观察条件。 |
| 路线替代工具 | `replace_attempt` | 在具体方法、关键假设或退出条件实质变化时创建新 Attempt，记录转换原因并结束当前 Attempt。 |
| 假设记录 | Assumption Record | 由模型提出、与 Attempt 关联并由证据验证或证伪的判断。 |
| 失效假设 | Invalidated Assumption | 状态变为 `rejected` 或 `superseded` 的假设，保留证据引用并退出当前判断。 |
| 路线替代 | Attempt Supersession | 新 Attempt 接管当前路线，旧 Attempt 记录 `supersededBy`。 |

Attempt 回答“当前使用哪种方法推进”。Plan Revision 可以在同一 Attempt 内调整覆盖和焦点；只有路线方法、关键假设或退出条件变化时使用 `replace_attempt`。Harness 也会在同策略真实失败或持续缺少有意义进展时结束失败 Attempt，创建读取现场的替代 Attempt。

### 计划项、路线与假设状态

| 对象 | 状态 | 精确定义 |
| --- | --- | --- |
| Plan Item | `pending` | 已纳入 Working Plan，尚未成为计划焦点。 |
| Plan Item | `active` | 当前计划焦点。 |
| Plan Item | `blocked` | 已记录当前阻塞原因。 |
| Plan Item | `satisfied` | 客观投影已绑定回执、验收或完成检查依据。 |
| Plan Item | `cancelled` | 模型在当前修订中明确取消该项。 |
| Plan Item | `superseded` | 后续计划修订已删除或替换该项。 |

| 对象 | 状态 | 精确定义 |
| --- | --- | --- |
| Attempt | `active` | 当前正在采用的路线尝试。 |
| Attempt | `succeeded` | 已由客观依据确认达到路线退出条件。 |
| Attempt | `failed` | 路线被真实失败或持续无有效进展证伪。 |
| Attempt | `superseded` | 新路线已经替代该路线。 |
| Attempt | `abandoned` | Agent 主动结束该路线且没有成功结论。 |
| Assumption | `active` | 当前路线仍在使用、等待验证的假设。 |
| Assumption | `validated` | 客观依据支持该假设。 |
| Assumption | `rejected` | 客观依据证伪该假设。 |
| Assumption | `superseded` | 新假设已经替代该假设。 |

## 8. 交付、验收与进展

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 交付契约 | Deliverable Contract | 用户交付要求的机器可检查表达，定义工件类型、验收项和验证要求。 |
| 验收项 | Acceptance Criterion | 单项必需或可选要求，带状态和客观依据引用。 |
| 验收账本 | Acceptance Ledger | 从交付契约派生并根据客观现场协调的验收容器。 |
| 验收快照 | Acceptance Snapshot | 某个 Step 协调完成后的验收项和交付缺口。 |
| 验收变化 | Acceptance Delta | 本 Step 前后验收状态与交付缺口的变化。 |
| 交付缺口 | Deliverable Gap | 必需验收项中仍未 `passed` 或经用户明确 `waived` 的部分。 |
| 完成依据 | Completion Evidence | 支撑验收通过和 Run 完成判定的 Receipt 引用。 |
| 进展回执 | Progress Receipt / `StepProgressReceipt` | 每个工具 Step 对交付推进、信息增量、结果回退和重复失败的结构化判断。 |
| 进展跟踪器 | Progress Tracker | 跨 Step 维护进展指标和连续计数。 |
| 无进展观察器 | No-progress Watchdog | 根据进展回执产生检查、路线重置或 checkpoint 决策。 |

### 验收状态

| 状态 | 规范中文名 | 精确定义 |
| --- | --- | --- |
| `pending` | 待验收 | 验收项仍缺少足够客观依据。 |
| `passed` | 已通过 | 当前客观现场满足验收项，且 `evidenceRefs` 指向有效依据。 |
| `failed` | 验收失败 | 已有验证依据明确显示验收项未满足。 |
| `unknown` | 结论未知 | 当前事实无法形成通过或失败结论。 |
| `waived` | 用户豁免 | 用户明确取消该必需项，记录 `waivedByUserMessageId`。 |

### 进展三轴

| 规范中文名 | 字段 | 计入条件 |
| --- | --- | --- |
| 客观交付推进 | `objectiveProgress` | 验收项通过、待交付工件前进、文件真实变化或首次成功验证命令等客观增量。 |
| 有效信息增量 | `informationGain` | 新证据或首次出现的诊断结果。 |
| 结果回退 | `regression` | 已通过验收项因后续工件修改或验证失效而退回。 |

### 连续计数

| 规范中文名 | 字段 | 含义 |
| --- | --- | --- |
| 无客观推进轮数 | `noObjectiveProgressStreak` | 连续没有缩小交付缺口或产生其他客观交付增量的 Step 数。 |
| 无有效进展轮数 | `noMeaningfulProgressStreak` | 连续没有客观推进，也没有新回执事实或安全观察增量的 Step 数。 |
| 同路线失败轮数 | `sameStrategyFailureStreak` | 相同策略签名连续真实失败、未变化或仅更新状态的 Step 数。 |

`update_task_state`、重复读取和重复搜索只有在产生新的客观事实或有效信息时才会影响进展判断。

### 无进展观察器决策

| 决策 | `WatchdogDecision.action` | 当前触发语义 |
| --- | --- | --- |
| 交付检查 | `review` | 无客观推进达到 3 或 6 轮，要求判断研究是否充分并明确下一项交付动作。 |
| 路线重置 | `replan` | 同路线连续失败 2 轮，或无有效进展达到 6 轮，要求读取现场并更换方法。 |
| 无进展检查点 | `checkpoint` | 无有效进展达到 10 轮，保存现场并结束当前循环。 |

这些决策会以 Harness 控制消息进入下一 Step，并以 `run.status` 投影为消息流中的运行提示项。

## 9. Skill、Policy 与工件

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 技能 | Skill | 一组可加载的领域指令、资源和可选专属工具。 |
| 技能索引 | Skill Index | 对所有 Skill 的轻量目录，包含 name、description、version、body hash 和资源路径。 |
| 技能正文 | Skill Body | Skill 激活后进入 system prompt 的完整指令正文。 |
| 技能资源 | Skill Resource | Skill 目录中供模型读取或工具使用的参考文件与资产。 |
| 技能专属工具 | Skill Tool | 随 Skill 激活而注册的工具定义与实现。 |
| 激活技能集合 | Active Skills / `loadedSkills` | 当前 Run 已激活的 Skill 名集合。用户选择和模型 `load_skill` 统一写入该集合。 |
| 技能激活 | Skill Activation | 将 Skill 加入激活集合；下一 Step 更新 Skill Body、工具、稳定前缀和交付契约。 |
| 运行策略集 | Run Policy Set | 根据用户请求和 Active Skills 提供交付契约、额外指令、工具定义、回执投影器和策略快照。 |
| 工件策略 | Artifact Policy | 针对特定工件定义交付契约、专属工具、回执投影和完成不变量。 |
| 工件防线 | Artifact Guard | 在专属工具和 Finalization 中保护 manifest、样式、页面、导出和验证等工件不变量。 |
| 工件关注点 | Artifact Focus | Policy 根据客观回执维护的当前工件关注范围，例如 `off`、`styles`、`slides`。它不规定模型的工具顺序。 |
| 工件生命周期 | Artifact Lifecycle | `pending`、`draft`、`accepted`、`prepared`、`exported`、`validated`。 |

Skill 提供知识和能力，Tool 执行具体动作，Policy 保护运行契约。三者分别命名。

### 工件生命周期取值

| 状态 | 规范中文名 | 精确定义 |
| --- | --- | --- |
| `pending` | 待生成 | 交付契约要求该工件，客观现场尚未确认可用版本。 |
| `draft` | 草稿 | 已生成可继续修改的中间版本。 |
| `accepted` | 已接受 | 专属工件工具已通过当前层级检查，可供后续组装使用。 |
| `prepared` | 已准备 | 已完成导出前转换或规范化。 |
| `exported` | 已导出 | 目标格式文件已经生成。 |
| `validated` | 已验证 | 导出文件已经通过对应验证工具。 |

## 10. 完成、重试与恢复

| 规范中文名 | 英文名 / 代码名 | 精确定义 |
| --- | --- | --- |
| 最终候选 | Final Candidate | 模型在没有工具调用时提出的用户可见最终文本。 |
| 最终化 | Finalization | 对最终候选执行完成条件检查并决定打回或结束 Run。 |
| 完成检查 | Completion Check / `completion.checked` | 基于验收快照、客观现场、当前 Attempt 和依据引用的确定性判断。 |
| 完成条件防线 | Completion Guard | 汇总缺少工件、验证失效、页数错误、未解决关键错误等完成问题。 |
| 完成条件打回 | Guard Retry | 最终候选未通过完成检查后追加控制消息，并进入下一 Step。 |
| Provider 请求重试 | Provider Retry | 瞬时 Provider 故障下，对同一 Context、工具定义和任务现场进行的短暂有界重试。 |
| 原子 Provider 响应 | Atomic Provider Response | 只有完整成功的一次请求尝试可以提交 thinking、text 和 tool calls。 |
| 恢复控制器 | Recovery Controller | Provider 重试耗尽或运行错误后，根据验收、客观现场和 Attempt 决定取消、失败或确定性恢复。 |
| 恢复检查点 | Recovery Checkpoint | 保存 Acceptance Snapshot、Working Plan、PlanAttemptLedger、Progress Tracker、Conversation、Causal Tail snapshot hash、Observed State 和 workspace 的恢复现场。 |
| 恢复输入 | Recovery State / `RunAgentTurnOptions.recoveryState` | 后续 Run 传入的 `AgentRunRecoverySnapshot`。Run Controller 校验 Session 与 workspace 绑定，从快照重建运行内存状态，再把新 Steering 追加到 Conversation。Server 会把失败 Run 的可恢复快照一次性交给同 Session、同 workspace 的下一 Run。 |
| 检查点恢复标记 | Resumed From Checkpoint / `run.started.resumedFromCheckpoint` | 新 Run 开始事件中的恢复来源摘要，记录已完成 Step、Context snapshot hash 和 Plan Revision。 |
| 确定性恢复交付 | Final Recovery | 所有必需验收项已有客观依据时，在最终说明阶段 Provider 中断后从现场生成确定性交付说明。 |
| 分块最终协议 | Chunked Final | 长文本分块收集协议，聚合完整结果后再进入 Finalization。 |

Provider 请求重试不会创建任务进展，不会执行工具，也不会把失败尝试的半截响应写入正式 Conversation。Abort 会立即停止后续重试。

## 11. 事件与可观测性

| 规范中文名 | 英文名 / 代码名 | 持久化 | 作用 |
| --- | --- | --- | --- |
| Provider 流事件 | ProviderEvent | 否 | `text.delta`、`thinking.delta` 的实时片段。 |
| 运行事实事件 | TraceEvent | 是 | Run、Step、模型请求响应、工具、回执、状态、验收、进展、完成和恢复事实。 |
| 前端通知 | ClientNotification | 是 | Event Mapper 从 TraceEvent 投影出的标准 UI 渲染事件。 |
| 事件日志 | Event Log | 是 | 按顺序追加、带 `seq`、可回放的运行事实与前端通知。 |
| 持久化 Trace | Persistent Trace | 是 | Session 工作区 `.ranni/runs/<runId>/` 下的 `trace.jsonl`、索引和 Step I/O 文件。 |
| Step 输入 | Step Input | 是 | 实际 Context Snapshot、Model Request 和 Tool Definitions。 |
| Step 输出 | Step Output | 是 | Model Response、thinking、assistant text、工具配对、回执和语义事件；表示单个历史 Step 的封存现场。 |
| 事件映射器 | Event Mapper | 产出持久通知 | 把需要展示的 TraceEvent 投影为 ClientNotification。 |
| 运行概览投影 | Run Overview Projection / `RunOverviewProjection` | 从 Trace 派生并持久化 | 当前 Run 的完整快照，聚合 Working Plan、Attempt、Acceptance Snapshot、Progress Receipt、TaskState 兼容投影、Observed State、Completion、Recovery 和变化时间线。 |
| 运行概览序列 | Overview Latest Seq / `latestSeq` | 随运行概览投影持久化 | 最近一次被投影接受的 Layer 2 事实事件 `seq`。Reducer 和前端用它忽略同 Run 的重复或更早快照。 |
| 运行概览通知 | `run.overview.updated` | 是 | 携带完整 `RunOverviewProjection`，实时更新运行状态栏、运行概览和计划与进度视图，不新增消息流过程项。 |
| 运行概览快照文件 | `overview.json` | 是 | Session 工作区 `.ranni/runs/<runId>/` 下的当前 Run 投影；刷新、重启或 SSE 断线恢复后由运行概览 API 读取。 |

精确事件名和可见 UI 投影见 `UI-NAMING.md`。

`plan.updated` 携带完整 `PlanChange.snapshot`，用于重放 Plan Revision 与 Objective Projection。`attempt.updated` 携带 `AttemptDelta` 和可选完整 `attemptState`，新运行会写入转换后快照。`context.snapshot` 可以为新 Run 或 Recovery Run 恢复初始 Working Plan、Attempt 和当前可得的验收缺口。共享 Run Overview reducer 按事件顺序更新当前完整快照，并把最近 120 条计划、路线、验收、进展、完成和恢复变化保存在时间线中。

运行概览投影表达当前 Run 的最新聚合现场，与用户当前选择的 Step 无关。Step I/O 表达所选历史 Step 的冻结输入输出。用户定位旧 Step 时，计划 UI 继续使用 Run 级当前快照；缺少 `overview.json` 的 Legacy Trace 才使用所选 Step 做兼容回退。

`recovery.started` 在新运行中只携带验收缺口、Context hash 与精简 checkpoint 元数据；完整恢复快照由 Task Memory checkpoint JSON 持久化。旧 Trace 中内联的 `runState` 字段保留为兼容协议。

## 12. 模块责任

| 模块 | 规范责任 |
| --- | --- |
| `lib/agent.ts` | 稳定公共 facade，导出公共类型和 `runAgentTurn`。 |
| `lib/agent/run-controller.ts` | 创建或从 `recoveryState` 恢复 Run 级服务与状态，驱动 Step 循环，处理 Steering 和终止结果。 |
| `lib/agent/step-runner.ts` | 组装单个 Step、请求模型、执行工具批次、协调语义状态并调用 Finalization。 |
| `lib/agent/tool-batch-executor.ts` | 校验和执行工具批次，保证配对、原子副作用复用和 Tool Receipt 生成。 |
| `lib/agent/run-state.ts` | 聚合 Run 内存状态，构建当前工作集，并序列化或恢复 `AgentRunRecoverySnapshot`。 |
| `lib/agent/finalization-controller.ts` | 检查最终候选和客观完成依据，返回 Guard Retry 或 Final。 |
| `lib/agent/recovery-controller.ts` | 在中断或错误后保存现场并决定恢复结果。 |
| `lib/agent/policy.ts` | 定义 Run Policy Set 公共接口。 |
| `lib/agent/event-sink.ts` | 将旧 Runtime StreamEvent 适配为三层事件 schema 并发布。 |
| `lib/context/composer.ts` | 生成 Context Envelope、保护因果配对、执行容量压缩。 |
| `lib/receipts/registry.ts` | 注册 Tool Receipt 并投影 Observed State。 |
| `lib/acceptance.ts` | 维护 Deliverable Contract 和 Acceptance Ledger。 |
| `lib/progress.ts` | 生成 Progress Receipt 并执行 No-progress Watchdog 判断。 |
| `lib/plan.ts` | 维护 Working Plan、Plan Item、Plan Revision、Objective Projection、Plan Focus 和恢复序列化。 |
| `lib/plan-attempt.ts` | 维护 Attempt 和 Assumption 的路线尝试账本。 |
| `lib/policies/registry.ts` | 按请求与 Active Skills 组装 Run Policy Set。 |
| `lib/events/schema.ts` | 定义 ProviderEvent、TraceEvent 和 ClientNotification。 |
| `lib/runs/run-overview-projection.ts` | 用共享纯 reducer 从 Run 事实事件生成完整运行概览投影、`latestSeq` 和变化时间线。 |
| `lib/runs/event-mapper.ts` | 把 TraceEvent 投影为前端通知，并发布携带完整快照的 `run.overview.updated`。 |
| `lib/runs/run-trace-store.ts` | 持久化并查询 Run、`overview.json`、Step 和语义 Trace。 |
| `components/run-plan-progress.tsx` | 展示整体计划面板、计划覆盖、交付验收、计划项和计划变化时间线。 |

## 13. 模糊词替换表

| 避免单独使用 | 根据语义改用 |
| --- | --- |
| 状态 | Run 状态、Agent 工作笔记、客观现场、验收快照、任务状态兼容投影、工件生命周期 |
| 计划 | Working Plan、Plan Item、Plan Revision、Objective Projection、Plan Focus、工作计划兼容投影、研究计划 |
| 阶段 / Phase | Step、Run 状态、工件关注点、工件生命周期 |
| 上下文 | Context Envelope、当前工作集、最近因果尾部、历史摘要、模型请求 |
| 结果 | Tool Result、Tool Receipt、Model Response、Run Result、最终候选 |
| 完成 | 工具执行成功、验收项通过、工件已验证、完成检查通过、Run 已完成 |
| 任务 | 用户目标、Session、Run、当前 Attempt |
| Skill 状态 | Active Skills、Skill Activation、Skill Runtime Status |
| Trace | Event Log、持久化 Trace、Step I/O、运行概览投影 |
| 重试 | Provider 请求重试、完成条件打回 |

## 14. 推荐描述格式

- “Context Composer / 最近因果尾部 / 上一轮三个 Tool Result 全部保留。”
- “计划账本 / 计划修订 / 新证据变更了计划项顺序和计划焦点。”
- “计划账本 / 客观投影 / P03 已绑定验收回执并进入 satisfied。”
- “路线尝试账本 / 当前路线尝试 / 相同策略失败两轮后被替代。”
- “Receipt Registry / 客观现场 / PPTX 工件已导出，验证回执仍待生成。”
- “验收账本 / 页数验收项 / 验证回执确认 8 页后通过。”
- “消息流 / 运行提示项 / 展示无进展观察器的交付检查提醒。”
- “运行详情页 / Step 输入输出查看器 / Provider 请求重试未产生重复 Tool Call。”

## 15. 维护规则

- 新增公共 Runtime 类型、状态语义、事件层或模块责任时同步更新本文件。
- 字段重命名时同时更新规范中文名、代码名、架构文档和 UI 投影。
- 新概念优先复用现有责任边界，避免为单条测试轨迹创建专用术语。
- 概念被降级为兼容层后，在名称中明确标记“兼容”，并记录权威替代概念。
- 每次更新后扫描 `AGENTS.md`、`UI-NAMING.md`、本文件和通用 Agent Harness 架构文档中的同义词与冲突定义。
