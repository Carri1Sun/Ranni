---
author: manus
version: v2
date: 2026-07-14
---

# Ranni 通用 Agent Harness：Runtime 与质量闭环开发方案

> 状态：核心 Runtime、兼容回归与真实运行验收已完成
>
> 文档角色：Agent Runtime、Context、状态、质量闭环、Skill Policy 与代码拆分
>
> 共享契约：以《总览与共享契约》为准

## 文档导航

- [总览与共享契约](./01-overview-and-contracts.md)
- Runtime 与质量闭环（当前）
- [可观测性与交付](./03-observability-and-delivery.md)

## 开发边界

本文件负责可执行 Runtime 的内部设计。Task Contract、Observed State、Working Set、Tool Receipt、Progress Receipt、Deliverable Contract、Plan / Attempt Ledger 和 Acceptance Ledger 的语义引用《总览与共享契约》。Event Log 持久化、查询 API、运行概览和 Step 查看器由《可观测性与交付》负责。

## 当前实现摘要（2026-07-15）

- `lib/agent.ts` 已从 3011 行主循环收敛为稳定 facade。
- `lib/agent/` 已建立 Controller、Runner、State、Executor、Finalization、Recovery、Policy、Event Sink 和 Streaming 边界。
- Context Composer V2 已成为主请求路径；旧 `active-context.ts` 只保留不裁剪 conversation 的兼容 facade。
- Receipt Registry 是文件、命令、证据、工件、验证和错误进入 Observed State 的统一入口。
- Acceptance、Progress、Attempt、同策略真实失败检查、`noObjectiveProgressStreak` 3 / 6 轮提醒、`noMeaningfulProgressStreak` 6 轮路线重置与 10 轮 checkpoint 已接入每个工具 Step。
- HTML-to-PPTX Policy 已迁出通用 Controller，并通过 Deliverable Contract、专属 Receipt projector 和 Completion Guard 约束工件。
- 动态 `load_skill` 会在下一 Step 重新派生 Deliverable Contract；静态 HTML 与通用 workspace 文件任务也由客观文件、命令和验证回执约束完成。
- ChatGPT Subscription Provider 已实现原子 SSE 提交与最多两次额外瞬时故障重试。

后续结构增强包括继续缩小 Step Runner、接入 checkpoint 自动恢复入口，以及在现有 workspace、命令黑名单与工具级防线之上抽象通用 SideEffectGate。这些增强不影响本次核心 Runtime 完成状态。长回答 chunked-final 已迁入独立纯控制器，并在聚合完成后进入 Acceptance 验收。

当前 Composition Manifest 已记录 stable prefix hash、真实失效原因、cache-eligible message count、Skill version / body hash、压缩原因、因果配对和 snapshot hash。Research Handoff 提供 thesis、findings、claimIds、sourceIds、artifactPlan、openGaps 和 weakEvidence。模型 assumptions 会进入 Attempt Ledger；具有相同策略签名的真实失败连续发生，或 `noMeaningfulProgressStreak` 达到路线重置阈值时，Harness 才会把相关假设标记为 rejected 并发布 `assumption.invalidated`。`noObjectiveProgressStreak` 的 3 / 6 轮阈值只提供交付节奏提醒。

## 1. Context Composer V2

### 1.1 Context 的四层结构

每次主模型请求由四层 Context 组成。

| 层 | 主要内容 | 生命周期 | 保留优先级 |
| --- | --- | --- | --- |
| Task Contract | 目标、交付物、约束、成功条件 | 整个 Run | 最高 |
| Working Set | 当前意图、Observed State、active attempt、有效假设、Acceptance Gap、artifact、失败、handoff | 每轮重建 | 最高 |
| Recent Causal Tail | 最近 2–4 个完整 Causal Turn | 滑动窗口 | 最高 |
| Archive Summary | 更早历史的摘要和引用 | 按预算更新 | 可压缩 |

Steering Messages 在下一轮边界注入，并同步更新 Task Contract 或 Working Set。

### 1.2 每轮 Input Envelope

```ts
type ContextEnvelope = {
  stepIndex: number;
  systemPrompt: string;
  taskContract: TaskContractView;
  workingSet: WorkingSetView;
  archiveSummary: ArchiveSummaryView;
  causalTail: CausalTurn[];
  steeringMessages: AgentMessage[];
  toolDefinitions: TraceToolDefinition[];
  composition: ContextCompositionManifest;
};
```

Context Envelope 在 Trace 和 UI 中使用以下逻辑顺序：

```text
System Prompt
→ Task Contract
→ Working Set
→ Archive Summary
→ Recent Causal Tail
→ 最新 Steering Messages
→ Tool Definitions
```

### 1.3 Provider 物理序列化与稳定前缀

Context Composer 负责统一语义，Provider Adapter 负责满足不同协议的物理序列化。逻辑区块顺序不要求所有 Provider 生成完全相同的请求数组。

Provider Adapter 在不破坏协议和因果连续性的前提下：

1. 保持 System Prompt、稳定 Task Contract、已激活 Skill 指令和未变化 Tool Definitions 的前缀稳定。
2. 将频繁变化的 Working Set、最新 Acceptance Gap 和 Steering 放在适合当前 Provider 的近端位置。
3. 保持上一轮 Provider-required reasoning、tool call 和 tool result 的合法顺序。
4. Provider 支持原生 continuation 或 compact 时，由 Adapter 维护 opaque payload 和 compact 结果。
5. Provider 只支持无状态 messages 时，由 Adapter 从 Context Envelope 重建完整有效输入。

Task Contract、Skill 或工具集合真实变化时允许稳定前缀失效。Context Manifest 需要记录失效原因，避免为了缓存命中隐藏当前用户约束或能力变化。

### 1.4 Causal Turn 的原子性

```ts
type CausalTurn = {
  stepId: string;
  stepIndex: number;
  assistant: {
    reasoning: unknown[];
    visibleThinking: string;
    text: string;
    toolCalls: TraceToolCall[];
  };
  toolResults: TraceToolResult[];
  attemptDelta: AttemptDelta;
  acceptanceDelta: AcceptanceDelta;
  progressReceipt: StepProgressReceipt;
};
```

约束：

1. Step N 的全部 tool call 和 result 在 Step N+1 中至少出现一次。
2. 并行工具批次整体保留，不能按 path、target 或工具白名单裁掉其中一部分。
3. 单个结果过大时，保留调用、状态、摘要、hash 和完整引用；正文可以按确定性规则截断。
4. Tool call/result 配对失败时停止发起下一次模型请求，并进入协议恢复。
5. 最近一轮拥有最高优先级，任何 phase 切换都不能移除它。

### 1.5 Provider reasoning 的维护

不同 Provider 对 reasoning 的协议要求不同：

- DeepSeek thinking 需要在后续工具轮次回传 reasoning content。
- ChatGPT Subscription Responses 需要回传 opaque reasoning item、function call 和 function call output。
- 部分 Provider 只提供可见 thinking 文本或完全不提供 thinking。

Context Composer 需要同时维护两种表示：

1. Provider Continuation Payload：满足 Provider 协议的原始或 opaque 项，只在最近因果尾部中使用。
2. Human-readable Thinking：用于 UI、Trace 和较老历史摘要。

旧 Causal Turn 移入 Archive 时，移除 Provider continuation metadata，保留决策摘要、调用和结果。这样可以避免几十轮前的 reasoning 被当成当前续写状态。

### 1.6 Context Composition Manifest

每次组装都生成可审计清单：

```ts
type ContextCompositionManifest = {
  version: 2;
  originalMessageCount: number;
  finalMessageCount: number;
  estimatedInputTokens: number;
  safeInputBudget: number;
  compactionApplied: boolean;
  compactionReason?: "budget" | "provider-limit";
  previousTurnToolPairs: {
    expected: number;
    preserved: number;
  };
  recentCausalTurnCount: number;
  omittedHistoricalToolPairCount: number;
  staleReasoningItemCount: number;
  semanticInvalidationCount: number;
  stablePrefixHash?: string;
  stablePrefixInvalidationReason?:
    | "task-contract-changed"
    | "skill-changed"
    | "tools-changed"
    | "provider-protocol";
  prefixCacheEligibleMessageCount?: number;
  sections: TraceContextSection[];
  snapshotHash: string;
};
```

它既服务于 Trace，也服务于前端上下文健康检查。

### 1.7 语义失效与容量压缩分离

容量压缩解决 Token 预算问题，语义失效解决路径纠偏问题。两者使用独立触发条件。

新证据推翻假设或验证否定当前 approach 时：

1. Event Log 追加 assumption invalidated 或 attempt failed 事件。
2. Plan / Attempt Ledger 更新状态、证据引用和替代关系。
3. Working Set 在下一轮停止呈现已经失效的假设。
4. Recent Causal Tail 继续完整保留刚发生的证伪过程。
5. Archive Summary 在下次重建时记录结论和引用，避免重新采用同一路线。

语义失效不会删除历史，也不会提前裁剪上一轮工具结果。它只改变当前有效工作视图。

### 1.8 动态 Token 预算

```text
Safe Input Budget
= Model Context Window
- Max Output Tokens
- Safety Margin
```

建议在 Safe Input Budget 使用到约 75% 时压缩较老历史。对于 1,050,000 context、128,000 max output 和 50,000 safety margin：

```text
Safe Input Budget = 872,000
Compaction Threshold ≈ 654,000
```

典型压缩顺序：

1. 删除 Archive 中重复细节。
2. 将旧工具正文替换为摘要和内容引用。
3. 合并已经完成的旧阶段。
4. 清理已经解决的问题和过时计划。
5. 保留最近 2–4 个完整 Causal Turn。

Task Contract、Working Set、上一轮完整 Causal Turn、当前未解决错误和当前 artifact 始终保留。

### 1.9 Context 组装失败防线

模型请求前执行以下确定性检查：

- 上一轮 tool call/result 数量一致。
- 上一轮所有 toolUseId 均有结果。
- Task Contract 存在。
- Deliverable Contract 存在或明确标记为 text-only。
- Context Snapshot hash 已生成。
- Provider continuation payload 符合当前适配器要求。
- Input 低于 Safe Input Budget。

检查失败时记录结构化错误并进入恢复，不把不完整 Input 发送给模型。

## 2. 状态、回执与真实进展

### 2.1 状态分层

#### Task Contract

稳定表达用户意图，用户消息拥有最高优先级。

#### Observed State

由 Receipt Registry 自动生成：

```ts
type ObservedState = {
  files: Record<string, FileReceipt>;
  commands: CommandReceipt[];
  evidence: EvidenceReceipt[];
  artifacts: Record<string, ArtifactReceipt>;
  verification: VerificationReceipt[];
  unresolvedErrors: ErrorReceipt[];
};
```

#### Agent Note

只保存模型当前策略：

```ts
type AgentNote = {
  currentIntent?: string;
  nextAction?: string;
  activeAttemptId?: string;
  assumptionIds?: string[];
  openQuestions?: string[];
};
```

#### Plan / Attempt Ledger

模型可以提出新 attempt、退出当前 attempt 或标记假设待验证。Harness 负责保存结构、关联 Tool Receipt，并根据验证和错误事实更新结果：

```ts
type PlanAttemptRecord = {
  id: string;
  approach: string;
  hypothesis?: string;
  status: "active" | "succeeded" | "failed" | "abandoned" | "superseded";
  startedAtStep: number;
  endedAtStep?: number;
  exitCriteria: string[];
  evidenceRefs: string[];
  assumptionIds: string[];
  supersededBy?: string;
};

type AssumptionRecord = {
  id: string;
  statement: string;
  status: "active" | "validated" | "rejected" | "superseded";
  evidenceRefs: string[];
  supersededBy?: string;
};
```

#### Acceptance Ledger

Harness 根据 Task Contract 创建 criterion，并根据 Tool Receipt 与 Observed State 更新状态：

```ts
type AcceptanceCriterion = {
  id: string;
  description: string;
  required: boolean;
  status: "pending" | "passed" | "failed" | "unknown" | "waived";
  evidenceRefs: string[];
  lastCheckedAt?: string;
  waivedByUserMessageId?: string;
};
```

`waived` 只接受用户明确调整要求。Provider 失败、验证工具不可用或模型认为无需验证时保持 `unknown` 或 `pending`。

### 2.2 `update_task_state` 的新语义

保留该工具用于兼容和策略表达，但改为 delta patch：

```json
{
  "nextAction": "写入 Manifest"
}
```

返回：

```json
{
  "changedFields": ["nextAction"],
  "stateHash": "abc123",
  "noChange": false
}
```

同义或无效更新返回 `noChange: true`。工具说明中移除“编辑前使用”等仪式化引导。Task Contract 和 Observed State 的权威字段不允许被该工具覆盖。

该工具可以更新 Agent Note 和 plan；非空且发生变化的 plan 会被 Step Runner 提交为新 attempt。当前工具没有单独的“结束 attempt”字段。它不能直接把 Acceptance Criterion 标记为 passed，也不能声明产生了 objective progress。

### 2.3 Progress Receipt

```ts
type StepProgressReceipt = {
  objectiveProgress: boolean;
  informationGain: boolean;
  regression: boolean;
  primaryCategory:
    | "evidence"
    | "artifact"
    | "verification"
    | "diagnostic"
    | "regression"
    | "unchanged"
    | "failed"
    | "recovery"
    | "final";
  objectiveDeltas: string[];
  informationDeltas: string[];
  regressionDeltas: string[];
  deliverableGapBefore: string[];
  deliverableGapAfter: string[];
  strategySignature: string;
  noMeaningfulProgressStreak: number;
  noObjectiveProgressStreak: number;
  sameStrategyFailureStreak: number;
  stateHash: string;
  artifactHash?: string;
};
```

以下变化计为 objective progress：

- Acceptance Criterion 从 pending、failed 或 unknown 变为 passed。
- 文件内容 hash 改变，并推进当前 required criterion 或目标 artifact。
- required artifact 从 pending 变为 draft、accepted、exported 或 validated。
- 验证结果通过并缩小 Deliverable Contract 的交付缺口。
- 已确认的阻塞被解除。

以下变化计为 information gain：

- 新增 evidence、finding、source 或 claim。
- 首次出现具有诊断价值的失败。
- 假设被验证、证伪或替代。
- 用户提供新的约束、答案或授权。

以下变化计为 regression：

- 已通过的 Acceptance Criterion 重新失败。
- accepted artifact 被未验证内容覆盖。
- 新错误破坏已经完成的交付条件。

以下行为不增加进展计数：

- 同义改写 Agent Note。
- 重复读取未变化文件。
- 相同搜索返回相同结果。
- 重复报告同一个错误。
- 只改变 next action 文本，没有外部事实变化。

Information gain 不重置 `noObjectiveProgressStreak`，因此 3 / 6 轮提醒仍能推动模型判断证据是否已经足够。这两个阈值只提醒交付节奏，不单独把 Attempt 标记为 failed，也不触发 assumption invalidation。成功的新证据、真实观察或工件 / 文件 / 命令 / 验证回执会重置 `noMeaningfulProgressStreak`；状态更新、失败回执和重复结果不会重置它。Tool Receipt 的 `strategySignature` 由工具名与关键 path、query、URL、command 或目标 artifact 派生，连续 Step 的 Progress Receipt 用它识别同一动作路线的真实重复失败；Attempt Delta 记录触发时所属路线及替代关系。

### 2.4 No-progress Watchdog

Watchdog 根据交付缺口、策略签名和回退事实介入。Information gain 与 objective progress 分开累计；必需交付缺口为空后停止发布停滞提醒。

#### 同一策略连续失败 2 轮

- 保留完整证伪过程。
- 要求模型重新检查当前 hypothesis 和 exit criteria。
- 只有相同 `strategySignature` 连续产生真实失败回执时，才将当前 attempt 标记为 failed 或 superseded，并使相关 assumption 失效。

#### 连续 3 轮

向模型注入事实性诊断：

```text
最近三轮没有缩小交付缺口。
重复策略：update_task_state。
当前交付缺口：manifest pending。
期间新增诊断：1。
请重新评估策略，选择能够改变外部状态的动作，或说明明确阻塞。
```

该提醒只反映交付缺口连续三轮未缩小，不改变 Attempt 或 Assumption 状态。

#### 连续 6 轮

- 保留完整 Recent Causal Tail。
- 发起一次包含当前假设、已有失败证据和未完成验收项的强交付节奏提醒。
- 对已经连续返回 `noChange` 的维护性工具暂时降权或隐藏一轮。
- 继续开放安全观察、工件、研究和验证工具。
- `noObjectiveProgressStreak` 达到 6 本身不结束 active attempt，也不使 assumption 失效。

当 `noMeaningfulProgressStreak` 达到路线重置阈值，或相同策略连续产生真实失败回执时，Plan / Attempt Ledger 才会记录 failed、superseded 和 assumption invalidation。该判断绑定 Tool Receipt 与状态 hash。

#### 连续 10 轮

- 仅在 `noMeaningfulProgressStreak` 达到 10 时触发；持续获得新证据或真实工件准备不会被硬停。
- 保存 checkpoint。
- 终止当前无进展循环。
- 返回已完成内容、阻塞条件、最近失败、Acceptance Gap 和恢复入口。

原有最大 500 Step 继续作为紧急上限。时间、Token 和辅助请求预算也应单独可观测。

## 3. 通用 Skill Runtime

### 3.1 两层加载模型

Skill 继续采用两层知识模型：

| 层 | 内容 | 进入 Context 的条件 |
| --- | --- | --- |
| Skill Index | name、description、版本、能力摘要 | Run 常驻 |
| Skill Body | SKILL.md 正文、references、专属工具、资源 | 用户强制加载或 Agent 激活 |

Skill Body 进入 system prompt，深度 references 通过读取工具按需进入，scripts 和 templates 由工具执行时引用。

### 3.2 Skill 激活与 Context 的关系

Skill 激活后：

1. Skill 正文进入 System Prompt 的 Skill Instructions 区域。
2. Skill 专属工具加入 Tool Definitions。
3. Skill 资源路径加入只读资源索引。
4. Context Manifest 记录 skill name、version、body hash 和工具集合变化。
5. Run 内 Skill 保持已激活状态，避免知识和工具在中途消失。

用户显式开关与模型 `load_skill` 最终进入同一个 `activeSkills` 集合。

### 3.3 Skill 工具面保持稳定

Skill 可以提供工具推荐和工件约束，但 phase 不应删除 Agent 仍需使用的安全能力。

以下通用能力在重型 Skill 运行期间保持可用：

- `list_files`
- `read_file`
- `search_in_files`
- Task Memory 读取与必要更新
- `search_web`
- `fetch_url`
- Research ledger 记录
- Artifact inspect
- 与当前任务相关的验证工具

写入、删除、终端、桌面操作和外部影响继续经过 workspace、权限和 side-effect 防线。

### 3.4 Research Handoff

研究型任务转入工件制作时，Harness 自动生成固定的 Research Handoff：

```ts
type ResearchHandoff = {
  thesis: string;
  findings: Array<{ id: string; summary: string }>;
  sourceIds: string[];
  claimIds: string[];
  artifactPlan: string[];
  openGaps: string[];
  weakEvidence: string[];
};
```

Handoff 固定进入 Working Set，直到相关 artifact 完成。后续搜索和 fetch 仍然可以更新 ledger，更新后的 delta 会进入下一轮 Recent Causal Tail。

### 3.5 Artifact Guard 的职责

Artifact Guard 负责：

- manifest 结构。
- draft / accepted 生命周期。
- 文件和 hash 一致性。
- 写入完整性。
- prepare / export / validate 前置条件。
- 失败 draft 不覆盖 accepted。

Artifact Guard 不负责决定模型必须先做哪一步，也不以 phase 为理由压缩 Context 或隐藏安全观察工具。

### 3.6 HTML-to-PPTX 示例

```text
研究与证据完成
→ 生成 Research Handoff
→ 初始化 slide workspace
→ 写入 manifest
→ 写入并组装 styles
→ 写入、inspect、patch slide fragments
→ assemble deck
→ prepare
→ export PPTX
→ validate
→ Completion Guard 检查 Deliverable Contract
```

模型可以在任意安全节点回到研究、读取、诊断或修改。Harness 只根据工具回执更新工件状态。

## 4. 完成、恢复与辅助请求

### 4.1 Completion Guard

最终回答前检查：

- Deliverable Contract 的必需工件存在。
- Acceptance Ledger 中所有 required criterion 均为 passed 或由用户明确 waived。
- 每个 passed criterion 均存在当前有效的 evidenceRefs。
- artifact hash 与 accepted receipt 一致。
- 必需验证已经通过。
- manifest、页面集合、导出结果一致。
- 没有覆盖交付物的 unresolved hard error。
- 没有尚未处理的 regression。
- 用户要求的最终文字说明已经准备好。

条件未满足时，把客观 Acceptance Gap 作为一个新的 Guard Turn 放入 Recent Causal Tail，继续执行。语义质量无法通过确定性工具判断时，criterion 保持 unknown，并根据任务要求使用独立 Judge、视觉检查或用户验收。

### 4.2 Provider Failure Recovery

模型请求发生 `terminated`、`fetch failed`、timeout 或连接错误时：

1. 冻结当前 Context Envelope 和 snapshot hash。
2. 保存 Agent Note、Observed State、Causal Tail 和 artifact receipts。
3. 执行少量有界重试和退避。
4. 检查 Deliverable Contract、Acceptance Ledger 和当前 Plan / Attempt。
5. 交付已完成时进入 final recovery。
6. 交付仍有缺口时恢复执行或返回可恢复 checkpoint。

恢复流程不能清空已经建立的 Causal Tail，也不能在工件 pending 时禁止工具调用。

### 4.3 Tool Protocol Recovery

以下情况进入协议恢复：

- Tool call JSON 截断或无法解析。
- Tool call/result 配对缺失。
- Provider-required reasoning item 丢失。
- 工具名不在当前 Tool Definitions。
- 结果超出单轮安全预算。

协议恢复优先保留模型已经完成的 reasoning 和有效工具调用，并返回准确错误事实。

### 4.4 Activity Rewrite 隔离

过程卡片文案默认使用确定性映射。确需模型改写时：

- 使用独立的轻量模型或 Provider。
- 使用独立队列和并发限制。
- 拥有独立超时、重试和 Token 预算。
- 主 Run 结束后可以取消。
- 不阻塞主模型请求。
- 在 Trace 中标记 `requestKind: activity_rewrite`。

所有模型请求按类别统计：

```text
main_agent
activity_rewrite
title_generation
judge
recovery
```

UI 的 Step 数只表示 `main_agent` 请求。

### 4.5 工具接口的人因优化

工具接口应减少模型因常见理解差异造成的机械失败。例如 `search_in_files` 同时接受文件和目录：

- 目录执行递归搜索。
- 文件执行单文件搜索。
- 路径不存在时返回结构化建议。

重复调用指纹至少包含：

```text
tool + path + query + glob + options + workspaceVersion
```

相同 workspace 版本下的完全重复查询可以返回缓存和 `unchanged: true`。

## 5. `agent.ts` 职责审计与代码改造地图

### 5.1 迁移前审计基线

以下数据记录 2026-07-14 迁移前的基线，用于解释本轮拆分原因。当前公共文件已经收敛为 facade。

行数是可见症状，核心风险来自职责和状态耦合：通用 Run 编排器直接感知 Research 质量启发式、HTML-to-PPTX phase、工具白名单、Prompt 大段文本、事件兼容层、Task Memory 写入、分段最终回答和多类 Recovery。任何一项策略变化都可能修改同一个主循环。

截至 2026-07-14 的静态审计结果：

| 指标 | 当前值 | 说明 |
| --- | ---: | --- |
| 文件总行数 | 3011 | `lib/` 下最大的 TypeScript 文件 |
| 顶层函数 | 55 | 同时包含纯函数、领域策略、I/O 和编排逻辑 |
| `createSystemPrompt` | 212 行 | 混合通用原则、Research、Skill、PPTX phase、Task State 和 Runtime Context |
| `runAgentTurn` | 1337 行 | 占文件约 44% |
| `runAgentTurn` 内部 `if` | 41 | 多个 Guard 与 Recovery 直接嵌套 |
| 条件表达式 | 19 | 最终回答和错误处理存在较高分支密度 |
| `continue` | 10 | 通过循环跳转表达隐式状态转换 |
| 变量声明 | 109 | 多个计数器和临时状态共享同一函数作用域 |

这些数字不单独作为代码质量判定，但它们与当前职责混合相互印证。

### 5.2 迁移前的职责耦合

| 当前内容 | 主要问题 | 目标归属 |
| --- | --- | --- |
| Abort、sleep、文本节奏控制 | 基础运行设施与任务策略放在同一文件 | `lib/agent/streaming.ts` 与取消工具 |
| 212 行 System Prompt | Prompt 内容、Context 数据和领域规则一起变化 | Context Composer 与领域 Run Policy |
| Context Snapshot、工具定义投影 | 主循环负责数据组装和 Trace 形态 | `lib/active-context.ts` 与 Provider Adapter |
| Legacy StreamEvent → v2 EventBus | 事件兼容细节侵入业务控制流 | `lib/agent/event-sink.ts` |
| 工具合法性、安全检查、执行、结果、Memory、TaskState | 成功和失败分支重复副作用，Receipt 没有形成唯一事实入口 | `lib/agent/tool-batch-executor.ts` 与 Receipt Registry |
| `createToolTaskStatePatch` | 通用 Agent 按工具名硬编码事实派生 | Tool Receipt projector 与兼容 TaskState adapter |
| Research Notebook、signals 与持久化服务创建 | 领域服务创建不应进入 Controller 业务分支 | `lib/agent/runtime-services.ts` 作为创建适配边界，具体能力由 `lib/research.ts` 提供 |
| `SlideArtifactPhase`、静态工具白名单和 phase 推进 | 重型 Skill 的生命周期进入通用 Harness | `lib/html-to-pptx/artifact-policy.ts` |
| 截断修复、分段最终回答、Completion Guard | 多个 final 分支以固定顺序内嵌在主循环 | `lib/agent/finalization-controller.ts` |
| Provider failure recovery | 直接重写 conversation，可能绕过 Deliverable 和 Acceptance 检查 | `lib/agent/recovery-controller.ts` |
| 7 类 Guard/Recovery 计数器 | 隐式状态机分散在局部变量和 `continue` 中 | `AgentRunState` 与显式 `StepOutcome` |

最严重的三个结构问题：

1. **通用 Harness 反向依赖领域策略。** `agent.ts` 直接导入 `SlideArtifactPhase`，并维护 Research 专属完成质量规则。新增 Skill 容易继续向主循环追加条件分支。
2. **状态转换缺少单一入口。** conversation、TaskState、Task Memory、Research Signals、Skill 集合、artifact phase 和多个 guard counter 分别原地修改，无法通过一个 reducer 重放 Step。
3. **最终回答分支形成隐式优先级。** 截断修复、chunk protocol、Research Guard、Completion Guard 和 final delivery 依靠代码位置与 `continue` 决定顺序，新增 Guard 容易改变既有行为。

### 5.3 当前调用关系

```text
lib/agent.ts public facade
└── Run Controller
    ├── AgentRunState + reducer
    ├── Event Sink
    ├── Step Runner
    │   ├── Context Composer
    │   ├── Provider Adapter
    │   ├── Tool Batch Executor
    │   └── Finalization Controller
    ├── Receipt Registry
    ├── Progress / Attempt / Acceptance
    └── Recovery Controller

Skill Runtime
├── Runtime Services Adapter → Research Notebook / Task Memory
└── HTML-to-PPTX Artifact Policy
```

`runAgentTurn` 只保留以下编排职责：

1. 初始化 `AgentRunState` 和 Run 依赖。
2. 在每个 Step 边界抽取 Steering。
3. 调用 `runStep(state, dependencies)`。
4. 把 `StepOutcome` 交给 reducer、Event Sink 和 Watchdog。
5. 在 final、failed、cancelled 或 checkpoint 状态结束 Run。

### 5.4 显式 StepOutcome

Step Runner 不直接控制外层循环，返回可审计的判别联合：

```ts
type StepOutcome =
  | {
      kind: "tool_batch";
      causalTurn: CausalTurn;
      receipts: ToolReceipt[];
    }
  | {
      kind: "guard_retry";
      reason: GuardReason;
      feedbackTurn: CausalTurn;
    }
  | {
      kind: "final";
      message: string;
      completion: CompletionDecision;
    }
  | {
      kind: "recover";
      checkpoint: RunCheckpoint;
      recovery: RecoveryDecision;
    }
  | {
      kind: "failed";
      error: RunError;
    };
```

Finalization Controller 负责 Guard 顺序并返回 `guard_retry` 或 `final`。Recovery Controller 读取 Deliverable Contract、Acceptance Ledger 和当前 Attempt 后返回 `recover` 或 `failed`。外层循环不再通过十余处 `continue` 表达业务状态。

### 5.5 Run Policy 边界

Research 和重型 Skill 通过窄接口提供策略：

```ts
type RunPolicy = {
  id: string;
  getInstructions(context: PolicyContext): string[];
  getToolPolicy(context: PolicyContext): ToolCapabilityPolicy;
  observeReceipts(receipts: ToolReceipt[]): PolicyDelta;
  evaluateFinalization(context: FinalizationContext): GuardDecision | null;
};
```

边界约束：

- Policy 返回指令、能力约束、状态 delta 或 GuardDecision，不直接修改 conversation。
- Run Controller 与 Step Runner 的业务控制流不包含按 Research、PPTX 或其他领域名称分支。
- `lib/agent/runtime-services.ts` 是 Research Notebook 与 Task Memory 的领域服务创建适配边界；它向 Controller 暴露窄运行依赖。
- `lib/agent.ts` 对 HTML-to-PPTX 工具定义的 re-export 是现有公共调用方的兼容桥，不承载领域运行策略。
- Context Composer 只读取状态快照，不执行工具、不写 Task Memory。
- Tool Batch Executor 只执行本轮请求并生成 Receipt，不直接把任务标记为完成。
- Receipt Registry 是 Observed State、Progress、Acceptance 和 TaskState 兼容投影的唯一事实入口。
- Event Sink 只发布事实事件，不决定下一步策略。
- `src/server/app.ts` 和 `scripts/research-eval.ts` 继续只从 `lib/agent.ts` 导入稳定公共 API。

### 5.6 规模约束

行数约束作为 review 信号使用：

- `lib/agent.ts` 保持为 50–100 行的公共 facade。
- `runAgentTurn` 编排函数目标不超过 150 行。
- `run-controller.ts` 和 `step-runner.ts` 单文件建议控制在 300–400 行。
- 单个函数超过 120 行时，需要检查能否抽成纯决策器、执行器或状态转换器。
- 领域 Policy 不进入通用主循环；新增 Skill 不应要求在 `run-controller.ts` 增加按 Skill 名称判断的分支。
- 避免把现有逻辑整体转移到已经超过 2000 行的 `lib/tools.ts`，工具目录需要按定义、执行和回执职责继续拆分。

### 5.7 目标代码地图

| 文件或目录 | 主要职责与改动 |
| --- | --- |
| `lib/agent.ts` | 稳定公共 facade，导出 `runAgentTurn` 和公开类型 |
| `lib/agent/types.ts` | `RunAgentTurnOptions`、依赖接口、`AgentRunState`、`StepOutcome` |
| `lib/agent/run-controller.ts` | Run 初始化、Steering、Step 循环、终止和预算 |
| `lib/agent/step-runner.ts` | 单 Step 的 Context、模型请求、响应解析和委托 |
| `lib/agent/run-state.ts` | 显式状态 reducer、guard counter、chunk state 和 checkpoint |
| `lib/agent/event-sink.ts` | v2 Run、Step、Text、Thinking、Tool、State 事件发布；隔离 legacy 兼容 |
| `lib/agent/streaming.ts` | `PacedTextEmitter`、abort-aware pacing 和 delta 聚合 |
| `lib/agent/tool-batch-executor.ts` | 工具请求校验、安全检查、执行和 Tool Receipt 批次 |
| `lib/agent/finalization-controller.ts` | 截断修复、chunk protocol、Guard 链和 Completion Decision |
| `lib/agent/recovery-controller.ts` | Provider、协议和无进展恢复，生成 Recovery Decision |
| `lib/agent/policy.ts` | `RunPolicy`、`PolicyDelta`、`GuardDecision` 通用接口 |
| `lib/active-context.ts` | Context Composer V2 迁移期兼容 facade |
| `lib/context/composer.ts` | Working Set、Recent Causal Tail、Archive 和 Steering 的语义组装 |
| `lib/context/system-prompt.ts` | 稳定 Harness prompt shell 与 Run Policy 指令片段组装 |
| `lib/receipts/registry.ts` | 统一 Tool Receipt、Observed State、内容引用和状态 hash |
| `lib/task-state.ts` | Task Contract、Agent Note、Observed State 的兼容与迁移 |
| `lib/plan-attempt.ts` | Plan / Attempt、Assumption、失败阈值消费、失效和替代关系 |
| `lib/acceptance.ts` | Acceptance Ledger、交付缺口、证据绑定和用户豁免 |
| `lib/task-memory.ts` | checkpoint、错误、证据和 durable memory；Working Set 由 Run State 构建 |
| `lib/tools.ts` | 保留工具公共 registry facade；定义和执行逐步迁入 `lib/tools/` 子模块 |
| `lib/agent/runtime-services.ts` | 隔离通用 Controller 与 Research Notebook / Task Memory 的具体创建 |
| `lib/html-to-pptx/artifact-policy.ts` | PPTX Deliverable Contract、工具能力和工件 Receipt projector；Research Handoff 由通用 Working Set 构建 |
| `lib/llm/providers/` | Provider continuation、原子重试、物理序列化和协议适配 |
| `lib/skills/registry.ts` | Skill 索引、版本、body hash、工具和资源元数据 |
| `lib/skills/runtime-instructions.ts` | Skill 正文进入 Context 的结构化表示 |
| `lib/runs/run-registry.ts` | Run workspace 映射、Steering、状态、并发计数和取消 |
| `docs/tech/` | 更新 Harness、Skill、Context 和组件地图文档 |
