# Research Optimize Iteration Notes

## 初始对比

ChatGPT Pro 的参考 trace 显示出几个强行为：

- 先围绕用户 query 建立研究空间，再持续扩展到 benchmark、工业实践、judge、meta-eval、成本、安全和基础设施。
- 搜索不是一次性清单，而是根据新线索不断改写 query。
- 结果不是 benchmark 表格，而是 thesis-driven synthesis：先给总判断，再按主题抽象方法论和未解问题。
- 对 leaderboard 分数、benchmark 可信度、harness/scaffold 干扰、eval awareness 这类方法论问题保持警惕。

当前 Ranni 参考结果的主要弱点：

- 更像静态百科式覆盖，动态扩展和反证补洞不明显。
- 一些最新性和数值 claim 缺少可见正文核验。
- 中间证据、coverage gaps、低置信 claim 没有形成可审计 ledger。
- 最终综合里方法论判断密度不如 Pro。

## v1 改动方向

- 建立 `research:eval` CLI，先让每次 run 可保存 trace、final、metrics、score、trajectory analysis 和 comparison。
- 扩展 research schema，让模型能表达 coverage dimensions、source strategy、stop rules、source type/date 和 claim span。
- 增加 research finalization guard，在非平凡 research 过早 final 时提醒补搜索、fetch、evidence、coverage review 或文件记忆。
- 把 source/claim/coverage/synthesis 文件记忆纳入 task memory，而不是只依赖上下文。

## 后续迭代规则

- 每轮先看 `trajectory-analysis.md`，再决定改 prompt、tool schema、guard 还是 eval harness。
- 不把 ChatGPT Pro 的具体答案写入 prompt。
- 优先修实际 trace 暴露的瓶颈，例如只搜不抓、抓了不记、写了不读、没有 coverage audit。
- high suite 重复运行时同时看平均分和最差样本。

## 真实运行迭代记录

### v1: eval harness 先暴露过程

第一次真实运行 `agent-eval-landscape` 时，agent 长时间工作但 CLI 只在结束后写产物。这个行为本身降低了迭代效率：无法中途判断是模型在有效研究、工具卡住，还是进入低价值循环。

调整：

- `trace.ndjson`、`partial-status.md` 和草稿 `final.md` 改为增量写入。
- 增加 `--timeout-ms`，让高预算 run 有明确墙钟边界。

结论：deep research eval 的第一优先级不是评分，而是让 trajectory 可观察。否则后续 prompt 和 harness 归因都不可靠。

### v2: fetch timeout 不应被当成用户取消

`v2-incremental-agent-eval` 运行中出现 URL 抓取超时，错误文本包含“中止”，旧的 abort 判断把它误判为整轮用户取消，导致 run 提前结束。该样本有 7 次搜索和 5 次正文抓取，但没有进入 evidence/coverage 阶段，得分 13/30。

调整：

- 收紧 `isAbortError`：只接受 `AbortError`、精确取消消息或精确 agent cancelled 文本。

结论：长程研究中，单个网页失败是普通负样本，不是全局取消信号。guard 和错误分类必须区分“局部来源不可用”和“用户终止任务”。

### v3: 当前 query 达到 Pro-like 轨迹

`v3-abort-fix-agent-eval` 成功完成 `agent-eval-landscape`。关键指标：

- 10 次搜索、11 次正文抓取、7 条 research finding、7 条 task evidence。
- 2 次 `review_research_state`，1 次 research finalization guard。
- 写入并复用 `coverage-matrix`、`synthesis-brief`、`evidence.md`。
- 最终回答约 7.8k 字符，可见引用/来源信号 45 个。

初版 analyzer 把 memory readback 记为 0，但 trace 显示 task memory 已通过 `context_snapshot.systemPrompt` 自动注入。这里是分析器误判，不是 agent 没读文件。

调整：

- `--reanalyze` 支持对历史 run 重算 metrics/score。
- analyzer 增加系统 prompt 自动注入的 readback 识别。

结果：重算后 `agent-eval-landscape` 为 30/30。该结果的质量提升不是来自固定答案，而是来自动态搜索、正文核验、证据外部化、coverage audit 和最终综合结构。

### v4: 泛化样本暴露最终引用纪律不足

`v3-generalization-context` 在 `agent-context-engineering` 上 trajectory 很强：10 次搜索、13 次抓取、5 条 finding/evidence、1 次 coverage review，最终内容结构也较好。但最终答案只保留了 2 个显式来源链接，读者难以把关键 claim 回溯到证据链。

调整：

- 评分增加 evidence discipline 上限：如果抓取了多个来源但最终可见引用少于 5，则该维度最多 3 分。
- 增加 `researchAnswerQualityGuard`：非平凡研究已收集足够证据时，如果最终答案缺少可见引用或来源小节，触发一次不调用工具的最终答案修复。

结果：

- 旧样本重算为 28/30，明确暴露最终引用缺口。
- `v4-citation-guard-context` 触发 1 次 answer quality guard，最终可见引用/来源信号增至 69 个，总分 29.4/30。

结论：强 trajectory 不自动保证强 final。final guard 应该审查最终读者可见质量，尤其是 citation alignment、来源索引和不确定性标注。

### v5: RAG 泛化样本暴露最终综合阶段的脆弱性

`v4-generalization-rag` 在 `enterprise-rag-evaluation` 上有很强的研究过程：16 次搜索、18 次正文抓取、6 条 task evidence、1 次 coverage review。但最终综合阶段 DeepSeek 请求返回 `terminated`，run 失败且没有 final。重算后分数从旧算法的 20.2/30 降为 12/30。

调整：

- provider 将 `terminated` 识别为可重试模型错误。
- agent loop 增加 `model_failure_recovery`：当非平凡 research 已有足够 evidence、最终综合阶段模型请求失败时，压缩 conversation 为原始问题 + recovery instruction，并依赖 task memory/evidence 生成降级最终回答。
- eval scoring 对 failed/no-final run 增加总分 cap，避免“过程强但没有交付”被高估。
- final repair、answer quality guard、model failure recovery 都要求研究答案先给 `核心判断`，避免只有覆盖清单没有 thesis。

结果：

- `v5-model-recovery-rag` 完成，28.1/30。
- 15 次搜索、20 次正文抓取、9 条 research finding、14 条 task evidence、1 次 coverage review。
- 触发并通过 unsafe tool-call guard、empty final repair、research finalization guard、answer quality guard。
- 最终答案约 8.4k 字符，引用信号 116 个。

结论：这轮证明 harness 需要覆盖“研究过程已经足够，但最终生成链路失败”的情况。deep research 优化不能只看 search/fetch/evidence，还要把最终交付失败作为一等故障类型。

## 当前残余风险

- 尚未完整运行 `--suite high --repeats 3`，当前覆盖了核心 query、context engineering、enterprise RAG 三类样本。
- 长程 run 仍容易接近输出长度边界；后续可优化为更早压缩 evidence、限制单轮 finding 数量，避免最终阶段被 token budget 挤压。
- memory readback 现在能识别系统 prompt 注入，但还可以进一步分析 agent 是否真的在最终结构中使用了 ledger 内容，而不只是被动带入上下文。

## 下一阶段：最终产物质量 judge

今天前几轮主要解决 harness 可观察性和 trajectory 纪律。下一阶段的主目标转为：让最终 deep research 产物在 objective spec 和用户产品感知上变好。

新增原则：

- Judge 默认只看 final answer，不奖励 tool calls 或 trajectory 努力。
- Trajectory analyzer 只在 judge 扣分后用于归因。
- 主指标从单次 trajectory score 转为 rubric score + pairwise win-rate。
- Claim audit 用来检查关键 claim 是否能被来源支撑。

新增产物：

- `deep-research-quality-spec.md`：定义 objective spec 和 product/user spec。
- `judge-rubric.json` / `judge-rubric.md`：单份 final 的质量评审。
- `claim-audit.md`：关键 claim 支撑情况。
- `judge-pair-*.md` / `.json`：两份 final 的盲评偏好。

后续每次 harness 改动应先看 judge 扣分，再看 trace 归因，而不是直接根据 trace 美观度加规则。

### Judge 校准观察

`v5-model-recovery-rag` 的 trajectory score 是 28.1/30，rubric judge 给 85/100。Judge 没有被高引用数量完全说服，指出：

- 出现 GPT-5 类未发布模型 benchmark 声明，证据薄弱。
- 成本维度偏重博客，缺少企业级核算框架。
- Citation quality 有概念但缺少可操作检验。

`v3-abort-fix-agent-eval` 的 trajectory score 是 30/30，rubric judge 给 85/100。Judge 指出：

- 冲突观点处理不足。
- 部分数据出处不够清楚。
- 缺少中国公司或中文语境下的工业实践。

`v3-generalization-context` vs `v4-citation-guard-context` 的 pairwise judge 选择了旧版 `v3`。原因不是 citation guard 无效，而是旧版更好地区分了“学术论文 / 产品文档 / 工程博客”，更贴合用户明示要求。新版 `v4` 在 trust 和 uncertainty 上更好，但 source-type framing 变弱。

这说明下一轮 harness 不能只强化引用数量，还要保留用户 query 的显式结构要求。`plan_research` 和 final synthesis guard 需要把用户要求的分类维度当作 first-class deliverable，而不是在最终引用修复时被冲掉。

## v6: 用 judge 信号反推 agent harness

本轮不是继续追求更漂亮的 trajectory，而是根据 judge 暴露的用户可见缺口改 agent 行为。

改动方向：

- 用户明示的分类轴、比较轴、地区、时间窗口、来源类型和输出格式被视为 deliverable contract。
- `plan_research` 描述要求把这些用户轴写进 coverage dimensions、source strategy 和 stop rules。
- `record_research_finding` 描述要求 finding 绑定用户要求的 category label，尤其是来源类型和 benchmark/numeric claim 的 measurement context。
- Research answer quality guard 不只检查引用，还检查显式分类结构是否在最终回答中可见。
- 对 benchmark 数字、排名、vendor claim、预印本、未来模型或未发布模型声明加入更强怀疑：证据弱则降置信度、说明限制或省略。
- 方法论 / eval 主题最终回答要尽量输出可操作检验：测什么、怎么测、失败模式、权衡和适用边界。

这直接对应 judge 校准结果：

- `v4-citation-guard-context` 引用更强，但丢失“学术论文 / 产品文档 / 工程博客”结构，所以 pairwise 输给旧版。
- `v5-model-recovery-rag` 被扣在 GPT-5 类未证实 benchmark claim、成本维度不够可操作。
- `v3-abort-fix-agent-eval` 被扣在冲突观点和中文/中国公司语境不足。

下一步 eval 应重点看：answer quality guard 是否能在保留 source audit 的同时保留用户明示结构，以及 benchmark/numeric claim 是否更少出现未限定的强断言。

## v7: 用户阅读风格与长答案分段

本轮把第二组“人是否觉得好读”的指标落成独立 style judge，避免只用 coverage / citation 指标优化出更长、更表格化、更像模板的报告。

两轮指标汇总：

- Objective / Product judge：覆盖、最新性、来源质量、引用对齐、证据纪律、冲突处理、综合深度、产品价值、可读性和 specificity。
- Style / Reader judge：opening value、authorial voice、narrative flow、paragraph craft、format taste、anti-template naturalness、cognitive load、reader guidance、citation integration 和 domain register。

校准结果：

- `v3-abort-fix-agent-eval`：rubric overall 90/100，style 78/100，AI Flavor Risk 85/100。说明研究质量强，但仍有明显模板味和过程元信息暴露。
- `v5-model-recovery-rag`：rubric overall 78/100，style 62/100，AI Flavor Risk 45/100。主要问题是开篇过程统计、表格/清单过载、缺少论证骨架。

对应 harness 改动：

- `--judge` / `--judge-run` 增加 `style-judge.json` 和 `style-judge.md`。
- Research prompt 要求最终答案像紧凑研究备忘录，用 prose 连接证据与含义。
- Answer quality guard 增加开篇过程计数、第一屏缺判断、列表/表格过载等 reader-experience 检查。
- `plan_research` / `record_research_finding` 强化成本、安全、数字 claim 的来源策略与评估条件记录。

新发现的瓶颈：

- `v7-style-memo-rag` 在 11 次 search、19 次 fetch、8 条 evidence、2 次 coverage review 后进入 final synthesis，但连续触发 `length_final_repair` / `model_failure_recovery`，说明长程 research 不应继续依赖单次最终输出。

新增改动：

- Agent loop 支持 `RANNI_FINAL_PART n/N` 分段最终回答协议。
- 遇到长 final 截断且已有足够 research evidence 时，harness 会切到 chunked final mode。
- 每段输出后，harness 聚合已完成内容为当前可见 assistant message，并请求下一段。
- 最后一段完成后，再对聚合全文跑 answer quality guard、metrics 和 judge。

下一轮 eval 要重点确认：

- 长程 RAG case 是否不再因为 final synthesis 截断失败。
- Chunked final 是否降低 style judge 对“清单化/表格化”的扣分，而不是只变成长篇堆料。
- 分段协议是否会引入重复段落、引用漂移或结构断裂。

### v8 Chunked Final Eval

`v8-chunked-style-rag` 重新运行 enterprise RAG case：

- search_web: 13
- fetch_url: 10
- record_task_evidence: 8
- length_final_chunk_repair: 1
- chunked_final_continue: 3
- trajectory score: 30/30
- rubric judge: overall 91/100, product 93/100
- style judge: 80/100, AI Flavor Risk 30/100

对比 `v5-model-recovery-rag`：

- rubric overall 从 78 提升到 91。
- style 从 62 提升到 80。
- AI Flavor Risk 从 45 降到 30。
- final synthesis 不再因单次输出长度失败，而是聚合了 4 段完整回答。

新观察：

- 分段协议有效，但完成第 4/4 段后，旧的 chunk state 没有立即清理，后续 finalization guard 补记忆时误触发了 `chunked_final_protocol_repair`。
- 已修复：最终段完成后清空 chunk state；`record_task_evidence` 也被视为外部 evidence memory，不再要求 agent 额外写一份重复 ledger 才算有外部记忆。

下一步泛化验证：

- 需要在非 RAG case（例如 context engineering 或 browser/computer-use eval）上跑一次带 judge 的长程 eval，确认分段协议不会诱导所有 research 都变成长篇报告。

### v9 Generalization Eval

`v9-chunked-style-context` 运行 agent context engineering case：

- search_web: 13
- fetch_url: 17
- record_research_finding: 5
- review_research_state: 1
- length_final_chunk_repair: 2
- chunked_final_continue: 7
- trajectory score: 30/30
- rubric judge: overall 92/100, product 93/100
- style judge: 88/100, AI Flavor Risk 12/100

正向信号：

- 保留了用户要求的“学术论文 / 产品文档 / 工程博客”来源结构。
- 输出不只是来源堆砌，有 context engineering 的核心 thesis 和可落地方法论。
- Style judge 明显高于旧 context 样本，说明 memo-style synthesis 没有牺牲可读性。

负向信号：

- 因 guard 没把 `record_research_finding` 视为外部 research memory，完整分段 final 后仍触发一次 finalization guard。
- 这导致模型又补了 `record_task_evidence` / task memory，并重新生成了一轮分段 final，预算浪费明显。

修复：

- `record_research_finding` 和 `record_task_evidence` 都计入 external memory，避免 agent 已有结构化 evidence 时被迫再写重复 ledger。
