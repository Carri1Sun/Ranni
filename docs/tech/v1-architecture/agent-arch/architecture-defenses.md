---
author: codex
version: v1
date: 2026-07-13
---

# Agent Architecture Defenses

这份文档定义 Ranni harness 的目标架构防线，以及防线与 Agent 自主判断之间的边界。各项能力按施工批次渐进落地，文末记录当前实现边界。核心原则是：

> Guard invariants, expose reality, preserve agency.

Harness 负责守住不可被模型语言覆盖的事实、安全和交付条件；Agent 根据目标、观察和工具回执，自主选择规划、诊断、修改和验证路径。

## 设计边界

架构防线只约束以下内容：

- 权限和用户授权。
- 外部内容的信任边界。
- 工具协议完整性。
- 状态真实性。
- 产物原子性与可恢复性。
- 完成声明需要满足的客观条件。
- 资源、取消和运行上限。

以下内容保留给 Agent 判断：

- 是否先规划、搜索、读取、渲染或直接修改。
- 失败后选择 patch、重写、修改共享样式或更换设计。
- 需要读取哪些历史证据和工件。
- 何时增加验证深度。
- 如何组织最终回答。

`currentMode` 表达当前认知姿态和 UI 状态，不参与安全观察工具的授权判断。代码施工批次也不映射为 Agent runtime 状态机。

## Task Contract、Agent Note 与 Observed State

任务状态按责任来源分成三个逻辑区域。

### Task Contract

Task Contract 由用户消息和 Harness 维护，用于稳定表达 goal、deliverable、constraints、success criteria 和 authorization boundary。Steering 在下一轮边界追加用户约束。模型可以请求澄清，不能通过状态工具覆盖这份契约。

### Agent Note

Agent Note 表达模型当前的 current mode、next action、assumptions、plan 和 open questions。`update_task_state` 只更新这些策略字段；同义更新返回 `noChange`，也不会产生客观进展。

### ObservedState

Observed State 由 Receipt Registry 根据工具回执和文件系统现实维护：

- 实际存在的文件。
- 成功写入的文件及 hash。
- draft 与 accepted artifact。
- 工具错误和结构化诊断。
- 命令退出码。
- 验证状态和验证回执。
- 最终交付文件的存在性和版本。

模型可以提出策略更新，工具执行结果拥有事实优先级。失败的写入不得进入成功文件集合，语言声明也不能把缺失工件标记为已交付。

## Event Log 与 Context Composer V2

完整 Event Log 追加保存模型消息、tool call、tool result、状态变化和验证事件，用于审计、回放和按需恢复。RunTraceStore 将脱敏事件写入 `.ranni/runs/<runId>/trace.jsonl`，并保存 Run / Step 索引和逐 Step I/O。

每次模型请求通过 Context Composer 构造当前工作视图。Context Envelope 优先包含：

1. 用户目标和仍然有效的约束。
2. Agent Note 与最新 Observed State。
3. 当前关注的 artifact，包括完整 draft。
4. 最新未解决诊断及其直接因果链。
5. 最近四个完整 Causal Turn。
6. 与当前决策有关的证据和来源。
7. 已完成 artifact 的 receipt。
8. 当前可用工具和真实安全边界。

上一轮全部 tool call 和 tool result 作为一个因果批次进入下一轮，Composer 在发请求前验证 toolUseId 配对。相同执行或观察通过 input/result fingerprint 产生 unchanged 信号；这个信号只描述观察是否推进，后续策略继续由 Agent 选择。

已接受的旧工件可以投影为 path、hash、验证状态和简短摘要。失效路线在 Plan / Attempt Ledger 中标记为 failed 或 superseded。原始网页正文、旧 HTML 和完整 Trace 继续保留在 Event Log 或 workspace，通过读取和检索工具按需取回。

上下文压缩只在估计输入达到安全预算 75% 后处理较老历史。压缩不能丢失用户约束、当前 draft、最新失败、上一轮 tool call/result 配对和完成条件。Skill 或 artifact 关注点变化不会触发容量压缩。

## Artifact 生命周期

可写工件采用 draft / accepted 双层语义：

```text
生成或 patch draft
-> 客观诊断
-> 通过硬性检查
-> 原子 promote 为 accepted
```

关键不变量：

- 失败候选保存在 draft，便于 Agent 读取、截图和局部修改。
- accepted 始终指向最近一次通过检查的版本。
- promote 使用同文件系统内的原子替换。
- 失败不能破坏已有 accepted。
- assemble 和最终导出只消费 accepted。
- 每次诊断绑定 artifact hash，避免把旧结果应用到新版本。

HTML-to-PPTX 的语义诊断需要区分正文裁切和允许裁切的背景装饰。错误回执应提供责任元素、边界、相关 CSS、文本属性、截图路径和错误签名，修复路径由 Agent 判断。

## 工具暴露与执行防线

安全观察工具在 skill 激活期间保持可用，例如：

- `list_files`
- `read_file`
- `search_in_files`
- task memory 读取
- artifact inspect
- `search_web`
- `fetch_url`

mode 切换和 artifact 里程碑不隐藏这些能力。写入、执行、删除、外发和桌面操作继续经过 workspace、side effect、权限与用户授权检查。

工具可以通过前置条件返回结构化事实，例如缺少 manifest、样式尚未组装或 accepted 页面不完整。错误信息应描述实际原因、当前 artifact 和可观察数据，避免规定唯一恢复步骤。

## 九类架构防线

| 防线 | Harness 保证的不变量 |
| --- | --- |
| 权限防线 | 工作区边界、危险操作授权、密钥保护、外部影响范围和取消传播始终有效 |
| 指令防线 | 网页、文件、日志和工具输出按不可信数据处理，不能提升为高优先级指令 |
| 状态真实性防线 | 文件、hash、命令结果和验证状态只由可核验回执更新 |
| 产物原子性防线 | draft 失败不覆盖 accepted，组装与导出只读取通过检查的版本 |
| 协议防线 | 截断、无效 JSON、未闭合工具块和 tool call/result 失配不能执行 |
| 完成防线 | 交付物存在、版本一致、验证回执满足后才能宣称完成 |
| 恢复防线 | 最近 accepted 可继续使用，失败 draft、诊断和历史证据可读取 |
| 审计防线 | 完整 Event Log 持久保存，活动上下文投影不会删除历史事实 |
| 资源防线 | 步数、时间、并发、上下文和取消边界可观测且可执行 |

## 失败恢复契约

失败后的下一次请求应提高观察质量：

- 保留当前失败 draft。
- 返回结构化错误码和责任对象。
- 展示最近修改是否改变错误签名。
- 恢复用户配置的 thinking 能力。
- 保持安全观察和工件工具可用。
- 明确相同诊断的累计次数。

重复错误检测用于提供事实信号，例如“最近三次修改没有改变责任元素及越界尺寸”。Harness 不指定下一步工具，也不把普通失败强制转换为固定 debug 流程。

Provider 响应截断或连接提前结束时，Harness 不会把半截工具调用加入正式 conversation。ChatGPT Subscription Provider 会对明确的瞬时故障额外重试至多两次；重试复用相同 Context 和工具定义。重试耗尽后保留 accepted 工件、Observed State、Causal Tail hash、Acceptance 与当前 Attempt，并在交付有缺口时返回可恢复 checkpoint。

## 完成契约

完成判断同时读取 Deliverable Contract、Acceptance Ledger 和 Observed State：

- 用户要求的 deliverable 已映射到实际文件或最终回答。
- 交付文件存在，且 hash 与最后一次 accepted receipt 一致。
- 必要验证已经通过，或用户通过消息明确豁免对应 criterion。
- manifest、组装产物和导出产物的页面集合一致。
- 当前没有覆盖交付结果的 unresolved hard error。

模型负责解释结果，harness 负责验证完成条件。

## 施工批次与 runtime 的关系

实现工作可以按以下批次推进：

1. 语义诊断、draft / accepted、inspect / patch 和状态真实性。
2. thinking 与安全观察工具解耦，移除阶段式严格白名单。
3. Task Contract / Agent Note / Observed State 和 Context Composer V2。
4. Event Log 持久化、Acceptance、Progress、Attempt 和恢复防线。

这些批次用于降低代码变更风险。运行时继续让 Agent 根据当前目标和观察自由组合工具，不引入与施工批次对应的固定阶段。

## 当前实现边界

当前已落地 Context Composer V2、完整最近因果尾部、Receipt Registry、Task Contract / Agent Note / Observed State 责任边界、Acceptance / Progress / Attempt、HTML-to-PPTX 的 draft / accepted 与语义诊断、Provider 原子重试和 Recovery checkpoint，以及安全观察工具与 `currentMode` 的解耦。

以下能力属于后续防线：

- 覆盖所有 mutation 工具的统一 SideEffectGate。
- 服务重启后扫描历史 Run 并恢复 Trace 查询映射。
- checkpoint 自动 resume 与完整用户控制入口。
- Raw / Diff / 区间导出 API。

现有 workspace、危险命令黑名单、专用工件工具和 Tool Batch Executor 继续共同承担 side-effect 防线。

## 评审问题

新增 guard、mode 或工具限制前，需要回答：

1. 它守护了哪个不可妥协的不变量？
2. 该不变量能否通过更准确的观察或更小的执行边界实现？
3. 它是否隐藏了 Agent 诊断当前问题所需的安全能力？
4. 错误回执是否提供了足够现实信息？
5. 它是否允许 Agent 选择其他安全恢复路径？

无法明确对应不变量的流程约束，应优先删除或降级为提示。
