# Update 020 - Judge Driven Research Harness

本次更新根据 deep research judge 的校准结果反推 agent harness。重点不是增加固定 trajectory，而是让最终回答更符合用户可见质量。

## 主要变化

- Agent prompt 将用户明示的分类轴、比较轴、来源类型、地区、时间窗口和输出格式视为 deliverable contract。
- `plan_research` 工具描述要求把用户明示结构写入 coverage dimensions、source strategy 和 stop rules。
- `record_research_finding` 工具描述要求 finding 绑定用户要求的 category label，并为 benchmark / numeric claim 保留 measurement context。
- Research answer quality guard 增加结构保真检查：如果用户要求区分若干类别，最终回答需要保留这些可见标签。
- Final repair、answer quality repair、model failure recovery 都要求保留用户明示结构，而不只是补引用。
- 对 benchmark 数字、排名、vendor claim、预印本、未来模型和未发布模型声明增加怀疑原则：证据弱时降置信度、说明限制或省略。
- 方法论和 eval 主题要求尽量输出可操作检验：测什么、怎么测、失败模式、权衡和适用边界。

## 背景

Judge 校准显示：

- 更强引用不一定等于更好产品答案；如果丢失用户明示分类结构，pairwise judge 会偏向旧版本。
- trajectory score 高的报告仍可能因未证实 benchmark claim、成本维度浅、冲突处理不足而被用户质疑。

## 验证

建议验证：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 用 `--judge-pair` 对比 source-type framing 修复前后的 context case。
