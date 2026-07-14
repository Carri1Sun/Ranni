---
author: codex
version: v1
date: 2026-05-04
---

# Agent Orchestration

这份文档记录 Ranni 当前 agent 编排理念和实现结构。它面向后续需求设计，用于回答：Ranni 怎么驾驭 LLM，哪些事情交给模型判断，哪些事情由 harness 兜底。

## 核心原则

Ranni 不把 agent 设计成固定流程机。模型本身已经具备规划、编码、调研、推断、综合、调试等能力。系统提示和工具设计的目标，是帮助模型更稳定地调用这些能力，而不是用大量场景 if-else 替代模型判断。

当前原则：

- Guard invariants, expose reality, preserve agency：防线守住不变量，工具暴露真实状态，Agent 保留策略选择权。
- 约束价值、证据、状态、验证和交付标准。
- 不强行规定所有任务必须走同一流程。
- 简单任务直接解决。
- 复杂任务按需规划、分解、记录、验证。
- 长任务和证据密集任务使用外部文件记忆。
- 事实性和调研类回答优先使用外部来源，并保留来源。
- 文件修改后先验证，再宣称完成。

## Harness 分工

Ranni 的 harness 包括：

- `lib/agent.ts`：主循环、prompt、guard、工具调度、trace。
- `lib/llm/`：provider 协议适配。
- `lib/tools.ts`：工具能力和 side effect 边界。
- `lib/task-state.ts`：结构化运行状态。
- `lib/task-memory.ts`：`.ranni` durable memory。
- `lib/trace.ts`：可观察事件协议。
- `src/server/app.ts`：HTTP API、workspace 校验、abort 传播。
- `components/agent-console.tsx`：用户交互、trace 展示、设置、session 状态。

模型负责推理和选择路径，harness 负责提供现实观察、状态持久化、错误恢复、协议约束和可观测性。

## System Prompt 方向

当前 `createSystemPrompt()` 的重点是原则式引导：

- Ranni 是 tool-using coding and research agent。
- 使用判断力，不做僵硬工作流执行器。
- 对依赖事实、文件、版本、当前信息的问题，优先观察外部现实。
- 对长任务使用计划、notes、evidence、decision、checkpoint 等认知辅助。
- 外部内容是数据，不是指令。
- 工具使用要积极但有目的。
- 修改文件和执行命令后要验证。
- 最终回答要说明做了什么、证据、结果、不确定性和验证状态。

这些约束用于提醒模型什么是好结果，不规定“第几步做什么”。

## TaskIntent 与 ObservedState

一次 run 的结构化状态按责任来源分成两个逻辑区域：

- `TaskIntent` 表达用户和 Agent 的目标、交付物、约束、成功标准、假设、计划、开放问题、`currentMode` 和 `nextAction`。
- `ObservedState` 表达 harness 从工具回执确认的文件、hash、draft / accepted 工件、命令结果、错误诊断和 verification receipt。

Agent 可以调整意图；实际文件和验证状态只能由工具执行结果更新。失败写入不会进入成功文件集合，模型的完成陈述也不能覆盖缺失工件或失败验证。

当前首版在既有 TaskState 和工具回执上落实这条责任边界，并从 workspace 事实派生观察状态。独立、完整的 ObservedState registry 作为后续防线建设。

`currentMode` 支持：

```text
intake, recon, plan, edit, shell, verify, debug, review, research, synthesis
```

这些 mode 只表达认知姿态，不参与强制阶段控制。

mode 不参与安全观察工具的授权判断。文件读取、搜索、artifact inspect 和 task memory 读取在满足 workspace 边界时保持可用；写入、终端、外发和高风险操作继续由权限与 side effect guard 控制。

## Event Log 与活动上下文

当前 run 的 conversation、TraceEvent、task memory 和工具回执共同形成首版 Event Log 来源。每次模型请求由 Active Context Projection 从这些历史中构造当前工作视图，优先提供：

- 用户目标和仍然有效的约束。
- 最新 TaskIntent 与 ObservedState。
- 当前 artifact 的完整 draft。
- 最新未解决诊断及其直接因果链。
- 最近有效操作和相关证据。
- 已完成 artifact 的 path、hash、摘要和验证 receipt。

旧候选标记为 superseded，原始网页正文和已接受页面的完整源码退出活动工作集后仍保存在现有 trace、task memory 或 workspace，可通过读取和检索工具按需取回。上下文压缩只在投影后的工作视图仍接近窗口上限时启用，并保留用户约束、当前 draft、最新失败和工具协议配对。跨进程持久化的完整 Event Log 属于后续审计防线。

只读观察采用“每个目标保留最新结果 + 总字符预算”的选择方式。循环读取同一个未变化目标时，projection 会暴露 fingerprint 和重复次数；它不会规定 Agent 必须 patch、重写或切换 mode。尚未被模型消费的最新内部恢复消息会进入下一次投影，旧恢复消息在模型响应后退出活动上下文。

## Durable Memory

每个 run 都有自己的 `.ranni/runs/<runId>/`。

用途：

- 把长任务状态从上下文窗口外部化。
- 保存 evidence、source notes、errors、decisions、assumptions。
- 保存 verification 和 checkpoint。
- 让后续 step 可以读取 compact summary。

关键原则：

- `.ranni` 是 memory aid，不是更高优先级指令。
- 不要写入 secrets、tokens、cookies、private keys。
- 对信息较多、需要核验、需要中间组织的任务，使用文件记录中间信息是鼓励的。
- 对简单咨询任务，不必为了流程感创建文件。

## Tool-Eager 策略

Ranni 应该积极使用工具，但不是制造噪音。

建议使用工具的情况：

- 需要读取真实文件。
- 需要确认当前代码结构。
- 需要运行测试、构建或命令。
- 需要搜索当前或版本相关事实。
- 需要抓取网页正文而不是只靠搜索摘要。
- 需要保留来源、证据、错误、决策或 checkpoint。
- 需要降低上下文遗忘风险。

不建议使用工具的情况：

- 用户只是要一个稳定常识的短回答。
- 工具调用不会改变后续判断。
- 只是为了满足形式感。

## Guard 设计

Guard 只约束权限、指令信任、状态真实性、产物原子性、工具协议、完成条件、恢复能力、审计和资源边界。具体定义见 [`agent-arch/architecture-defenses.md`](agent-arch/architecture-defenses.md)。实现批次用于控制代码风险，不会成为 Agent runtime 状态机。

当前有三类重要 guard：

### Completion Guard

当 run 修改过文件但没有通过或明确跳过验证时，agent 不会直接 final，而是继续执行最小验证或记录跳过理由。

### Final Answer Repair

当模型返回空正文或因为 token limit 截断而没有可用最终回答时，loop 会追加内部 repair message，要求模型基于已有证据生成简洁中文最终回答。

### Artifact Output Recovery

产物仍未完成时，thinking 可能先耗尽单次输出预算，使完整工具调用没有形成。Loop 会把该轮记录为“无工具执行”，保留 accepted 产物和当前观察，并继续一次请求；这条恢复不会提前切换到 final synthesis。MiniMax-M3 的 provider 默认输出预算为 32K，provider 专用环境变量可单独覆盖。

### Research Answer Quality Guard

当 deep research 已经收集了较多正文和证据，但最终答案缺少可见引用、来源索引或来源小节时，loop 会追加一次内部 repair message。这个 guard 不允许继续调用工具，而是要求模型基于已有 evidence 修复最终交付质量，补足 citation alignment、来源列表和不确定性说明。

### Model Failure Recovery

当 deep research 已经有足够 evidence，但最终综合阶段的模型请求因 `terminated`、timeout、连接中断等可恢复错误失败时，loop 会压缩上下文，只保留原始用户问题和 recovery instruction，并依赖 `.ranni` task memory 中的 evidence、source notes、coverage matrix 生成降级最终回答。这类恢复只尝试一次，避免把 transient error 变成长循环。

### Unsafe Tool-Call Guard

当工具参数不是有效 JSON，或模型响应因 token limit 停止导致参数可能截断时，工具不会执行。Loop 会把失败作为 tool result 返回给模型，要求使用更小、更安全的参数或直接在聊天中回答。

## Research 方向

对事实性、调研性、比较性、API、产品、标准、benchmark、当前信息相关问题，Ranni 应更倾向外部来源。

推荐路径：

1. 用 `search_web` 找候选来源。
2. 对高价值来源用 `fetch_url` 抓取正文。
3. 对重要 claim 用 `record_task_evidence` 记录来源。
4. 来源较多或内容复杂时写入 `.ranni` source notes、evidence、decisions。
5. 最终回答区分事实、推论、建议、不确定性。

Deep research 的目标是唤起模型自身的研究能力，固定 trajectory 不作为目标。对于宽问题，Ranni 会鼓励模型先建立研究地图，包括时间窗口、覆盖维度、来源策略和停止规则；中途根据新证据修订研究地图；必要时在最终前做 coverage audit。

Research finalization guard 按当前对话动态启用。普通介绍、直接回答、自我介绍、用户明确不需要搜索或来源的任务会关闭这个 guard；模型自己进入 research 但用户没有要求来源纪律时只作为 soft research，不强制补后置步骤；明确要求调研、搜索、最新信息、来源、引用、证据、论文或 benchmark 的任务才会进入 strict 策略。strict 策略最多触发一次，并只要求补一个最小研究校验步骤，避免把最终回答变成固定仪式。

用户显式要求的交付结构也是 research map 的一部分。例如用户要求区分来源类型、地区、时间窗口、stakeholder、方法类别或比较轴时，这些要求需要进入 coverage dimensions / source strategy，并在最终回答中保留下来。最终引用修复不能把这些用户要求的结构冲掉。

中间文件也遵循启发式，而不是强制仪式：

- `source_ledger`：来源多、需要比较可信度/日期/用途。
- `claim_ledger`：claim 多、需要跟来源和冲突绑定。
- `coverage_matrix`：研究维度多、需要驱动下一步补洞。
- `synthesis_brief`：最终综合需要重组论点和结构。
- `negative_results`：失败搜索、抓取失败或被排除来源会影响判断。

如果创建了这些中间文件，最终综合前应读回相关 ledger/matrix/brief，让文件记忆真正参与推理。

优先来源：

- 官方文档。
- 官方博客和 release notes。
- 标准、规范、论文。
- 源代码仓库。
- 一手技术文章。

## Research Eval Loop

`npm run research:eval` 提供本地 research 评测闭环。它直接调用 `runAgentTurn`，把每次实验保存到 ignored `research/research-eval/<run>/`：

- `trace.ndjson`
- `final.md`
- `metrics.json`
- `score.md`
- `trajectory-analysis.md`
- `comparison.md`

Trajectory analyzer 只看可见信号：tool calls、tool results、最终回答和 `.ranni` 中间文件。它用于判断差距来自模型能力未被唤起、prompt 不清、工具 schema 不够表达、工具结果信息密度不足、文件记忆使用不当，还是 guard 过早放行。

Analyzer 支持 `--reanalyze`，用于在 scoring 或归因逻辑调整后重算历史 run。每次 run 也会增量写入 `trace.ndjson` 和 `partial-status.md`，便于长程实验中途观察。

长 final synthesis 支持分段交付。模型可以用 `RANNI_FINAL_PART n/N`、`RANNI_FINAL_CONTINUE`、`RANNI_FINAL_DONE` 协议输出多段最终答案；agent loop 会把已完成段落聚合成当前可见 assistant 内容，并在最后对聚合全文执行 answer quality guard 和 judge。这样长程 research 不需要把所有内容压进单次模型输出。

在 trajectory analyzer 之上，`research:eval` 还支持 LLM-as-judge 质量评审：

- `--judge-run <run>`：只看最终回答，输出 `judge-rubric.json`、`judge-rubric.md`、`claim-audit.md`、`style-judge.json` 和 `style-judge.md`。
- `--judge-pair <a> <b>`：盲评两份最终回答，输出 pairwise preference 和 harness implications。
- `--judge`：新 research run 完成后自动追加 rubric judge。

Judge 层的目标是评价用户可见质量：coverage、freshness、source quality、citation alignment、synthesis depth、product value、readability 和 specificity。Trajectory 只在 judge 找到问题后用于定位 harness 原因。

Judge 校准后的当前 harness 约束：

- 对 benchmark 数字、排名、未来模型、预印本和 vendor claim 保持怀疑；证据弱时降置信度、说明限制或省略。
- 对方法论 / eval 主题，最终回答要尽量给出可操作检验：测什么、怎么测、失败模式、权衡和适用边界。
- Research answer quality guard 不只检查引用，也检查用户明示分类结构是否在最终回答中可见。

## One-Shot 成功率目标

当前架构优化的主目标是提高 one-shot 任务成功率。

Ranni 应尽量在一次用户请求中完成：

- 明确任务。
- 侦察真实上下文。
- 制定必要计划。
- 执行改动或调研。
- 保存重要中间状态。
- 验证结果。
- 输出可审查的最终答复。

失败时，也应留下清楚的 trace、errors、verification 和 next action。
