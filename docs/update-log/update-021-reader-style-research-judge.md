# Update 021: Reader Style Research Judge

## 背景

前一轮 deep research judge 主要覆盖 objective spec 和 product value，但用户反馈进一步指出：人类评价 research 结果时，不只看覆盖面和引用，也会强烈感知语言风格、结构品味、第一屏判断和“AI 味”。

## 改动

- `research:eval` 的 `--judge` / `--judge-run` 新增 `style-judge.json` 和 `style-judge.md`。
- Style judge 单独评分阅读体验，不把事实覆盖和表达风格混成一个分数。
- Style 维度包括 opening value、authorial voice、narrative flow、paragraph craft、format taste、anti-template naturalness、cognitive load、reader guidance、citation integration 和 domain register。
- Agent research prompt 增加启发式写作要求：最终答案应像紧凑研究备忘录，用段落把证据连接成论证，表格和清单只在降低读者负担时使用。
- Research answer quality guard 除了引用和用户结构外，也会识别明显缺少第一屏判断、过度清单化等阅读体验问题。
- 长 research final 支持 `RANNI_FINAL_PART n/N` 分段协议，harness 会聚合分段内容，避免最终综合因单次输出长度截断反复失败。
- `deep-research-quality-spec.md` 汇总 objective / product / style 三组指标，明确它们分别对应的 judge 产物。

## 设计原则

风格优化不能把 agent 训练成固定版式。Harness 只提供启发式目标：有判断、有流动、能审计、少模板感。具体结构由模型根据用户 query、证据形态和最终论证需要自行选择。

## 验证

后续应使用历史 run 做 judge 校准，再运行长程 research eval，比较：

- rubric score 是否稳定。
- style score 是否提升。
- AI flavor risk 是否下降。
- pairwise judge 是否更偏好 candidate。
- trace 是否仍保持动态扩展、正文核验、coverage audit 和文件记忆复用。
