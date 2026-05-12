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
