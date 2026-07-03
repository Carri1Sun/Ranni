---
author: codex
version: v1
date: 2026-05-12
---

# Deep Research Quality Spec

这份 spec 定义 deep research 最终产物的质量目标。它服务于 judge harness、人工 review 和后续 prompt / tool / guard 迭代。

核心原则：trajectory 是诊断信号，不是最终质量。最终优化目标是让用户读到的 research result 更可信、更有判断力、更有行动价值。

## 两轮指标汇总

第一轮指标解决“研究是不是扎实”。它偏 objective：覆盖面、最新性、来源质量、引用对齐、证据纪律、冲突处理、综合深度和 query specificity。它适合做 rubric judge、claim audit 和 trajectory 归因。

第二轮指标解决“人是否愿意读、是否觉得好”。它偏 product / style：第一屏价值、作者判断、叙事流、段落质量、格式品味、低 AI 味、认知负荷、读者引导、引用融入和领域语气。它适合独立 style judge 与 pairwise preference，避免把“可读性问题”误判成“证据问题”。

| 指标族 | 评价对象 | 主要问题 | 可执行产物 |
|---|---|---|---|
| Objective Spec | 最终答案的研究质量 | 查得是否全、证据是否硬、结论是否可审计 | `judge-rubric.json/md`、`claim-audit.md` |
| Product / User Spec | 最终答案的用户价值 | 是否帮用户减少工作、形成判断和下一步行动 | `judge-rubric.json/md`、pairwise judge |
| Style / Reader Spec | 最终答案的阅读体验 | 是否像有判断的研究备忘录，而不是模板报告 | `style-judge.json/md`、pairwise judge |

## 质量层级

### Objective Spec

这些维度适合 LLM-as-judge 和结构化评分：

| 维度 | 高质量表现 | 低质量信号 |
|---|---|---|
| Coverage | 覆盖问题空间的关键维度，说明边界和遗漏 | 只覆盖显眼子题，漏掉安全、成本、反例或工业实践 |
| Freshness | 明确时间窗口，纳入最新论文、产品文档、标准和工业动态 | 主要依赖过时资料，未标注日期风险 |
| Source Quality | 优先论文、官方文档、标准、仓库、一手工程博客 | SEO 汇总、二手转述、搜索摘要占主导 |
| Citation Alignment | 关键 claim 能回溯到正确来源，引用粒度合适 | 引用堆在段末，claim 与来源不匹配 |
| Evidence Discipline | 数字、排名、benchmark、因果判断有证据和置信度 | 重要数字无来源，强判断没有支撑 |
| Conflict Handling | 标出争议、反例、评测偏差、弱证据和未解问题 | 把所有来源合成单一确定叙事 |
| Synthesis Depth | 有核心判断、趋势、方法论抽象和跨来源综合 | 按资料出现顺序罗列，像资料清单 |
| Specificity | 针对用户 query 的语境组织答案 | 套通用模板，换个 query 也差不多 |

### Product / User Spec

这些维度更接近人类用户的真实感受：

| 维度 | 用户视角问题 |
|---|---|
| First-screen Value | 第一屏是否给出清晰核心判断，而不是铺垫 |
| Trust | 用户是否觉得“这确实查过、能追溯、没乱编” |
| Work Reduction | 是否替用户减少搜索、筛选、比较和整理成本 |
| New Insight | 是否发现用户可能没想到的维度、风险、反例或抽象 |
| Decision Value | 是否能帮助用户形成下一步判断、路线或取舍 |
| Readability | 结构是否清晰，密度是否合适，是否避免冗长模板 |
| Honesty | 是否坦诚说明不确定性、覆盖边界和来源弱点 |
| Fit | 是否贴合用户的真实任务，而不是泛泛百科回答 |

### Style / Reader Spec

这组指标专门捕捉“读起来像不像一个有判断力的人写的研究结果”。它不奖励无来源的散文化表达，也不奖励引用堆砌的机械清单；目标是“研究报告的可信度 + 文章式的阅读流”。

| 维度 | 高质量表现 | 低质量信号 |
|---|---|---|
| Opening Value | 第一屏给出判断、变化和重要性 | 先铺定义、背景、免责声明 |
| Authorial Voice | 有清晰取舍和独立判断 | 语气平均、像通用模板填空 |
| Narrative Flow | 段落之间形成论证推进 | 章节互不相干，像资料贴片 |
| Paragraph Craft | 段落包含观点、证据、含义 | 每段只是孤立 bullet 或长句 |
| Format Taste | 表格、列表、标题减少读者工作 | 为了结构化而结构化，装饰性格式过多 |
| Anti-template Naturalness | 少套话，少对称机械结构 | “AI 报告味”、口号式总结、重复空话 |
| Cognitive Load | 密度高但可扫描 | 数字、名词、链接堆叠造成疲劳 |
| Reader Guidance | 明确告诉用户该看什么、怎么用 | 只告诉用户“有什么”，不说明“所以呢” |
| Citation Integration | 引用贴近 claim 且不打断阅读 | 段末堆链接或来源和 claim 错位 |
| Domain Register | 语气匹配专业读者和任务场景 | 过度科普、营销化或机械学术腔 |

风格目标不是固定成散文。表格、清单和短句仍然可以是最优形式，但它们必须服务于判断、比较和决策，而不是形成固定 trajectory 或固定版式。

## Judge 任务

Judge 分四类：

- Rubric judge：只看 final answer，按 spec 评分并输出扣分原因。
- Style judge：只看 final answer，单独评价阅读体验、格式品味和 AI 味风险。
- Pairwise judge：盲评两份 final answer，判断哪份对用户更有价值。
- Claim audit：抽取关键 claim，检查来源支撑和 citation alignment。

Judge 默认不看 trajectory。只有当 rubric 或 pairwise 发现问题后，trajectory analyzer 才用于归因：到底是 prompt、工具、文件记忆、guard、模型输出预算还是最终修复链路的问题。

Judge 输出必须优先保证机器可解析。长解释应进入 Markdown render，不应塞满 JSON；如果主 judge JSON 解析失败，harness 可以用更小 schema 和更短 final context 做 fallback judge。

## Rubric 评分

每个维度 0-5 分，总分 100。建议维度：

- Coverage
- Freshness
- Source Quality
- Citation Alignment
- Evidence Discipline
- Conflict Handling
- Synthesis Depth
- Product Value
- Readability
- Specificity

Style judge 单独输出：

- Style Score
- Reader Value Score
- AI Flavor Risk
- style dimension scores
- rewrite advice
- harness implications

总分不是唯一目标。更重要的是 judge 给出：

- top strengths
- top weaknesses
- likely user complaints
- concrete revision advice
- harness implications

## Pairwise 评审

Pairwise judge 应回答：

- 用户更愿意读哪份？
- 哪份更可信？
- 哪份更有综合判断？
- 哪份更能指导下一步行动？
- 哪份更少模板感和废话？
- 哪份的 citation alignment 更好？

主指标是 win-rate，而不是单份绝对分。绝对分容易随 judge 漂移，pairwise 更贴近产品感知。

## Harness 归因映射

| Judge 扣分 | 可能 harness 原因 | 优先调整 |
|---|---|---|
| 缺核心判断 | final prompt / repair guard 没要求 thesis-first | 强化 final synthesis 结构 |
| 像资料堆砌 | synthesis brief 不足或未读回 | 改 synthesis memory 和 final guard |
| 来源弱 | source strategy 不清 | 改 plan_research 和 search/fetch 优先级 |
| citation 不对齐 | final citation guard 太粗 | 增加 claim audit 和引用检查 |
| 覆盖漏维度 | coverage audit 太晚或太弱 | 改 coverage_dimensions 和 stop rules |
| 没有用户价值 | deliverable framing 不足 | 让 plan/final 绑定用户决策语境 |
| 长但不清晰 | 输出预算和结构控制不足 | 压缩 evidence、强化 first-screen value |
| AI 味重 | final prompt 只要求结构化，缺少表达品味 | 增加研究备忘录式 synthesis 要求 |
| 过度清单化 | guard 奖励覆盖和引用，未约束阅读流 | 增加 style judge 和 readability repair |
| 散文化但不可审计 | 风格提示压过证据纪律 | 保持 citation alignment 和 claim audit 独立 |
| 长答案截断 | final synthesis 试图一次输出完整报告 | 启用 chunked final protocol，按段聚合后再 judge |
| 失败无 final | recovery guard 不足 | 强化 model failure / length recovery |

## 验收目标

一个可接受的 deep research harness 应满足：

- Rubric judge 分数相对 baseline 稳定提升。
- Pairwise judge 对 candidate 的偏好率高于 baseline。
- Claim audit 中关键 claim 的 supported / partially supported 比例提升。
- 用户视角扣分集中减少：核心判断、可信度、可读性、行动价值。
- Style judge 稳定提升，AI Flavor Risk 下降。
- 改动能泛化到多个 case，而不是只优化某个 query。
