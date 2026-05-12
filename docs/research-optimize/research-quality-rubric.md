# Deep Research Quality Rubric

这份 rubric 用于评估 Ranni deep research run 的结果和可见 trajectory。它不是固定执行流程，而是用于分析模型能力是否被 harness、prompt、工具和文件记忆充分唤起。

## 评分维度

每项 0-5 分，总分 30 分。

| 维度 | 高分表现 | 低分信号 |
|---|---|---|
| Source discovery | 搜索 query 会动态扩展，覆盖学术、工业、方法论、安全、基础设施和反证方向 | 只搜索用户原词或重复同义词 |
| Evidence discipline | 对关键 claim 抓取正文、记录 finding/evidence、标注来源类型/日期/置信度 | 从搜索摘要直接写最终结论 |
| Coverage | 最终前检查 source mix、coverage gaps、低置信 claim、冲突和未解问题 | 按资料出现顺序罗列，缺少补洞 |
| Memory use | 来源多或 claim 多时使用 source/claim/coverage/synthesis 文件，并在综合前读回 | 写文件只是堆材料，或复杂任务完全依赖上下文 |
| Synthesis | 总判断清晰，按主题和方法论综合，有趋势、边界和未解问题 | 表格堆 benchmark，缺少抽象判断 |
| Trajectory | trace 能看到计划修订、来源筛选、正文核验、反证/补洞和审稿 | 过早 final，缺少可审计过程 |

## 中间文件启发式

写文件的条件：

- 来源多到需要比较可信度、日期或用途。
- claim 多到需要明确每条 claim 的支持来源和冲突。
- 研究维度较多，需要知道哪些方向还缺证据。
- 最终报告需要重组 thesis、结构或反证问题。
- 搜索失败、抓取失败或排除来源本身会影响判断。

不写文件的条件：

- 单个稳定事实或很短回答。
- 低价值 snippet、重复网页、不会进入最终论证链的信息。
- 文件只是为了流程感存在，后续不会读回或使用。

推荐文件：

- `source-ledger.md`：高价值来源、类型、日期、可信度、关键用途。
- `claim-ledger.md`：重要 claim、支持来源、冲突、置信度。
- `coverage-matrix.md`：覆盖维度、已有证据、缺口、下一步搜索方向。
- `synthesis-brief.md`：阶段性总判断、候选结构、需要反证的问题。
- `negative_results.md`：失败搜索、抓取失败、被排除来源和原因。

## 轨迹归因

常见归因：

- 没有 web discovery：模型能力未被 research prompt 唤起。
- 只搜不抓：工具结果信息密度不足，停留在 snippet。
- 抓了不记：证据纪律不足，finding/evidence 没有外部化。
- 没有 coverage audit：缺少最终审稿行为。
- 写了不读：文件记忆没有参与最终综合。
- 过程强但最终少引用：final synthesis 没有把 evidence chain 外显给读者。
- 过程强但没有 final：最终综合阶段模型失败或截断后没有恢复交付。
- 总分低但无 guard：harness 放行过早。

## 验收目标

当前 `agent-eval-landscape` case 应接近 ChatGPT Pro reference 的表现：

- 有动态搜索扩展，而不是只列已知 benchmark。
- 兼顾学术 benchmark、工业 eval SOP、judge/meta-eval、安全、基础设施、成本和未解问题。
- 关键事实来自一手来源或论文正文，而不是搜索摘要。
- 最终报告以总判断和方法论综合为主，引用和不确定性清楚。

额外 high suite case 用于检查泛化：Ranni 不应把 agent eval 的固定轨迹硬套到其他主题。

## 迭代后的评分注意事项

如果 run 抓取了多个来源，但最终答案的可见引用或来源索引少于 5 个，`Evidence discipline` 会被压低。这个规则用于区分“trace 内部有证据”和“读者能审计证据”。

如果 run 状态为 failed，尤其是没有 final answer，评分会被总分 cap。deep research 的目标不是只跑出漂亮 trajectory，而是交付可审计的综合报告。

`researchAnswerQualityGuard` 只应在最终交付质量不足时触发一次。触发后模型不应继续搜索，而应基于已有 evidence、source ledger、coverage matrix 和 synthesis brief 修复最终答案。
