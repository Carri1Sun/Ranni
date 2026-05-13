# Research Agent Evals Guide

这份文档总结一套面向信息检索类 agent 的 evals 设计方法。它来自 Ranni deep research harness 的迭代经验，但目标不是介绍某个具体 harness，而是给其他做 research agent、deep research、web agent、检索增强写作系统的人提供一套可复用的评测框架。

核心判断：

- 研究类 agent 的可评测数据主要有两类：`trace` 和 `final artifact`。
- `final artifact` 是优化目标，因为用户最终读到的是研究结果。
- `trace` 是归因数据，因为它能解释为什么最终结果好或不好。
- 好的 eval 不能只奖励“跑了很多工具”，也不能只看“答案写得流畅”。它必须同时衡量研究过程的证据纪律、最终产物的用户价值，以及两者之间的对齐关系。

## 1. 先把 eval 对象分清楚

Research agent 的 eval 很容易混在一起：有人评估搜索轨迹，有人评估最终答案，有人评估工具调用效率，有人评估事实准确性。建议先把评测对象拆开。

| 数据 | 主要用途 | 不适合承担的职责 |
|---|---|---|
| Trace | 诊断 agent 是否会规划、搜索、核验、补洞、记录证据、处理失败 | 不应作为最终质量的唯一目标 |
| Final artifact | 评估用户真正看到的研究结果是否可信、有判断、有行动价值、好读 | 不足以解释失败原因 |
| Intermediate artifacts | 评估外部记忆是否真的帮助综合，如 source ledger、claim ledger、coverage matrix | 不应变成固定流程打卡 |
| Judge artifacts | 保存 rubric、claim audit、style judge、pairwise judge 的判断 | 不应替代人工校准和案例复盘 |

推荐原则是：先用 final artifact 判断“用户会不会觉得好”，再用 trace 判断“为什么会这样”。

如果反过来，很容易优化出一种虚假的好 agent：它搜索很多、调用很多工具、写很多 ledger，但最终答案仍然像资料堆砌，甚至没有解决用户问题。

## 2. Trace Evals: 评估研究行为，而不是工具数量

Trace eval 的目标不是证明 agent 很忙，而是判断它有没有表现出高质量研究者的行为。

### 2.1 Source Discovery

要看 agent 是否能动态扩展问题空间。

高质量信号：

- 初始搜索不只复述用户 query，而是拆出时间窗口、对象范围、来源类型和关键争议。
- 搜索 query 会根据新线索变化，例如从 benchmark 扩到 judge、meta-eval、安全、成本、基础设施、工业实践。
- 会主动寻找一手来源：论文、官方文档、标准、仓库、产品文档、作者博客、公司技术报告。
- 会区分来源类型，而不是把论文、营销页、SEO 汇总、新闻报道混成同等证据。
- 对最新性敏感，能在 fast-moving topic 中显式处理日期和版本。

低质量信号：

- 重复搜索同一个关键词或同义词。
- 长时间停留在搜索摘要，不进入正文。
- 只找支持性资料，不找反例、争议、失败案例和限制。
- 只覆盖最显眼维度，漏掉成本、安全、部署、评测偏差或用户明确要求的分类轴。

可量化指标可以包括搜索次数、query 多样性、来源类型分布、时间分布、一手来源比例。但这些指标只能做辅助，不能简单设成越多越好。

### 2.2 Evidence Acquisition

要看 agent 是否从“发现来源”推进到“核验证据”。

高质量信号：

- 对关键 claim 抓取正文，而不是依赖 snippet。
- 对数字、排名、benchmark 结果、成本、性能、发布日期、产品能力等高风险 claim 做更严格核验。
- 记录来源类型、发布日期、作者或机构、claim span、适用条件和置信度。
- 遇到 vendor claim、排行榜、预印本、未来模型或未发布能力时降低确定性。
- 抓取失败时记录失败原因，并寻找替代来源。

低质量信号：

- 搜到就写，没打开正文。
- 重要数字没有来源，或引用与 claim 不对齐。
- 把多个来源中的不同口径合并成单一确定结论。
- 把抓取失败误判成任务失败，或反过来完全忽略抓取失败带来的覆盖缺口。

Trace eval 应该抽查几类关键 claim：数字型、比较型、因果型、趋势型、推荐型。它们比普通背景事实更容易影响用户判断。

### 2.3 Research Control

要看 agent 是否会中途调整研究计划。

高质量信号：

- 先建立研究地图：问题空间、来源层级、覆盖维度、停止条件。
- 中途根据新发现改写计划，而不是机械执行初始清单。
- 最终前做 coverage audit，检查遗漏、弱来源、冲突、过时风险和未验证数字。
- 有明确 stop rule：不是“还有网页就继续查”，而是“关键维度已有足够一手证据，剩余缺口已说明”。
- 面对冲突资料时做来源质量比较，而不是平均化。

低质量信号：

- 一开始列了计划，后面再也不更新。
- 没有最终审稿动作。
- 发现新方向但没有补搜。
- 过早 final，或者一直搜索不收敛。

这部分最适合 LLM trace analyzer 做行为归因，但 analyzer 的输出应该是“发现和原因”，而不只是一个总分。

### 2.4 Memory And Intermediate Artifacts

文件记忆和中间产物不是越多越好。它们的价值在于帮助 agent 跨上下文组织证据和综合判断。

建议 eval 关注三个问题：

- 什么时候写：来源多、claim 多、存在冲突、需要跨轮比较、接近上下文上限、最终 synthesis 需要重组时才值得写。
- 写什么：高价值来源、关键 claim、覆盖矩阵、阶段性 synthesis、负结果。
- 是否读回并使用：最终答案是否真的吸收了 ledger / matrix 中的结论，而不是写完就遗忘。

高质量中间产物：

- `source-ledger`：记录高价值来源、类型、日期、可信度、用途。
- `claim-ledger`：记录重要 claim、支持来源、冲突、置信度。
- `coverage-matrix`：记录覆盖维度、已覆盖来源、缺口、下一步搜索。
- `synthesis-brief`：记录阶段性总判断、候选结构、需要反证的问题。
- `negative-results`：记录搜索无果、抓取失败、排除来源和原因。

低质量信号：

- 把低价值 snippet 批量写文件。
- 文件只是流程感打卡，最终前没有读回。
- 每个任务都强制写同样文件，导致固定 trajectory。
- ledger 太长，反而污染最终 synthesis。

### 2.5 Finalization Behavior

Trace eval 还要覆盖最后一步，因为很多 research agent 失败不是失败在搜索，而是失败在交付。

需要看：

- 是否过早 final。
- 是否在 final 前有 evidence / coverage / synthesis 的收敛动作。
- 最终答案是否把 evidence chain 外显给读者。
- 长答案是否被截断。
- 模型请求失败后是否有恢复策略。
- 如果分段输出，是否聚合后再评估完整答案。

一个重要原则：没有 final answer 的 run 必须被严格惩罚。再漂亮的 trace 也不能弥补没有交付。

## 3. Final Artifact Evals: 评估用户真正读到的东西

Final artifact eval 应该默认不看 trace。原因很简单：真实用户不会因为 agent 很努力就原谅一份糟糕报告。

建议把最终产物拆成三组指标。

### 3.1 Objective Quality

这组指标回答“研究是否扎实”。

| 维度 | 高质量表现 | 低质量信号 |
|---|---|---|
| Coverage | 覆盖问题空间的关键维度，并说明边界 | 只覆盖显眼子题 |
| Freshness | 明确时间窗口，纳入最新资料并处理日期风险 | 主要依赖过时资料 |
| Source Quality | 优先一手来源和高可信来源 | SEO 汇总、二手转述占主导 |
| Citation Alignment | 关键 claim 能回溯到正确来源 | 引用堆在段末，claim 与来源错位 |
| Evidence Discipline | 数字、排名、benchmark、因果判断有证据和置信度 | 强判断没有支撑 |
| Conflict Handling | 标出争议、反例、弱证据和未解问题 | 把冲突资料压平成单一叙事 |
| Synthesis Depth | 有核心判断、趋势和方法论抽象 | 按资料出现顺序罗列 |
| Specificity | 贴合用户 query 的语境和约束 | 换个 query 也差不多 |

Objective judge 可以用 0 到 5 分维度评分，也可以输出 100 分总分。更重要的是要求 judge 给出扣分原因和具体修改建议。

### 3.2 Product / User Value

这组指标回答“用户会不会觉得这份结果有用”。

| 维度 | 评估问题 |
|---|---|
| First-screen Value | 第一屏是否给出核心判断，而不是背景铺垫 |
| Trust | 用户是否觉得这确实查过、能追溯、没乱编 |
| Work Reduction | 是否替用户减少搜索、筛选、比较和整理成本 |
| New Insight | 是否提出用户可能没想到的维度、风险或抽象 |
| Decision Value | 是否帮助用户形成下一步判断、路线或取舍 |
| Honesty | 是否坦诚说明不确定性、覆盖边界和来源弱点 |
| Fit | 是否匹配用户真实意图，而不是泛泛百科回答 |

Product eval 往往比 objective eval 更接近真实满意度。很多答案“事实都对”，但用户仍然不喜欢，因为它没有形成判断，没有告诉用户“所以呢”。

### 3.3 Style / Reader Experience

这组指标回答“读起来是否像一个有判断力的人写的研究备忘录”。

它不是要求答案散文化，也不是奖励华丽表达。它评估的是信息组织、阅读节奏和表达品味。

| 维度 | 高质量表现 | 低质量信号 |
|---|---|---|
| Opening Value | 开头直接给判断、变化和重要性 | 先写定义、免责声明、流程统计 |
| Authorial Voice | 有取舍、有独立判断 | 语气平均，像模板填空 |
| Narrative Flow | 段落之间有论证推进 | 章节互不相干 |
| Paragraph Craft | 段落包含观点、证据、含义 | 每段只是孤立 bullet |
| Format Taste | 表格和列表服务比较、扫描和决策 | 为结构化而结构化 |
| Anti-template Naturalness | 少套话、少机械对称、少空泛总结 | 明显 AI 报告味 |
| Cognitive Load | 密度高但可读 | 链接、数字和术语堆叠 |
| Reader Guidance | 告诉用户该看什么、怎么用 | 只告诉用户“有什么” |
| Citation Integration | 引用贴近 claim 且不打断阅读 | 段末堆链接 |
| Domain Register | 语气匹配专业读者和场景 | 过度科普或营销化 |

这个维度很关键。很多 research agent 的优化会把答案推向更长、更全、更表格化，但用户感受到的是更累、更模板、更没有人味。Style eval 可以防止这种局部最优。

## 4. Claim Audit: 用关键 claim 抽检证据链

Claim audit 是 final artifact eval 中最有用的一类细粒度检查。

推荐流程：

1. 从最终答案中抽取 10 到 20 条关键 claim。
2. 给 claim 分类：数字型、比较型、趋势型、方法论型、推荐型、风险型。
3. 检查每条 claim 是否有引用。
4. 检查引用是否真的支持该 claim。
5. 标注结果：supported、partially supported、unsupported、contradicted、uncited、overclaimed。
6. 输出最需要修复的 claim，而不是只给一个总分。

Claim audit 特别适合发现这些问题：

- 引用存在但不支持正文。
- 数字或 benchmark 结果被过度泛化。
- 预印本、vendor blog、排行榜被当成稳定事实。
- 多个不同口径的结果被合并成单一结论。
- 最新性 claim 没有日期支撑。

对 research agent 来说，claim audit 往往比普通 factuality judge 更有效，因为它直接检查“研究报告里的关键判断是否可审计”。

## 5. Pairwise Evals: 更接近真实产品选择

单份绝对评分容易随 judge 漂移，也容易被 rubric 文本影响。Pairwise eval 更接近真实产品问题：如果把两份报告给用户，他更愿意读哪份？

Pairwise judge 建议盲评，不暴露版本名、模型名、工具次数。

应该问 judge：

- 哪份更能回答用户原始问题？
- 哪份更可信、证据更可审计？
- 哪份更有综合判断，而不是资料堆砌？
- 哪份更能指导下一步行动？
- 哪份更好读、更少模板感？
- 哪份更好处理不确定性和冲突？
- 如果只能交给用户一份，选哪份，为什么？

主指标建议看 win-rate，而不是只看平均分。尤其在 harness 迭代中，pairwise 能发现一些绝对分不敏感的问题。例如：一个版本引用更多，但丢失了用户明确要求的分类结构，真实用户可能更偏好旧版。

## 6. Case Suite: 不要只评一个 query

Research agent 很容易过拟合某个主题或某类轨迹。eval suite 应覆盖不同研究形态。

建议至少包含：

- Emerging topic：信息快速变化，考验最新性和来源质量。
- Comparative landscape：需要横向比较论文、产品、方法或公司实践。
- Controversial topic：来源冲突明显，考验反证和不确定性。
- Product decision：用户需要路线、选型、风险和成本判断。
- Multilingual / regional context：考验是否只依赖英文主流来源。
- Long synthesis：需要长答案、外部记忆和分段 final。
- Failure-prone retrieval：网页抓取失败、来源失效、搜索结果噪声高。

每个重点 case 至少跑 2 到 3 次。研究 agent 的稳定性很重要，平均分提升但最差样本崩掉，产品上仍然危险。

建议记录：

- 平均分。
- 最差样本。
- Pairwise win-rate。
- Claim audit supported ratio。
- Style score 和 AI flavor risk。
- No-final / failed-run rate。
- 主要 failure taxonomy。

## 7. 评分和归因要分层

一个实用的评测闭环可以这样设计：

1. 先看 final artifact judge：rubric、style、claim audit、pairwise。
2. 如果 final 不好，再看 trace analyzer。
3. 用 trace 归因到 failure type。
4. 只改一个或少数几个 harness 点。
5. 重新跑同一 case 和泛化 case。
6. 看平均分、最差样本、pairwise、失败率是否同时改善。

常见归因映射：

| Final 问题 | Trace 上可能看到的原因 | 应优先考虑的改动 |
|---|---|---|
| 覆盖漏维度 | 初始 plan 没拆出用户关键轴，coverage audit 太晚 | 改 plan schema / coverage eval |
| 来源弱 | 搜索停在二手资料，缺少 source strategy | 改来源策略提示和 source-quality judge |
| citation 不对齐 | 抓了正文但 final 没把证据链外显 | 加 claim audit / final citation guard |
| 像资料堆砌 | 没有 synthesis brief，或 final prompt 只要求覆盖 | 强化 thesis-first synthesis |
| 没有用户价值 | trace 在查资料，但没围绕用户决策组织 | 加 product-value rubric |
| AI 味重 | 最终答案机械表格化、开头流程化 | 加 style judge 和 reader guard |
| 过早 final | trace 缺少 evidence / coverage / review | 加 finalization guard |
| 长答案截断 | final synthesis 一次性输出过长 | 分段输出并聚合后 judge |
| 无 final | 模型失败或工具失败没有恢复 | 加 no-final cap 和 recovery eval |

这里最重要的是顺序：final judge 决定问题是否存在，trace analyzer 决定问题怎么修。

## 8. LLM-as-Judge 的设计注意事项

LLM judge 可以很有用，但需要约束。

建议：

- Judge 默认只看 final answer，不看 trace，不奖励隐藏努力。
- Rubric judge、style judge、claim audit、pairwise judge 分开做。
- JSON 输出负责机器可解析，Markdown 输出负责解释。
- Judge prompt 要要求“给出用户会抱怨什么”，这比抽象扣分更有用。
- Pairwise judge 要盲评，避免版本名和工具数量泄漏。
- 对长答案可以裁剪上下文，但 claim audit 不应只看开头。
- 用人工抽样校准 judge，特别是 style 和 product value。

不要让 judge 成为单一权威。更稳妥的方式是把 judge 当成可重复的审稿人：它帮助发现问题、排序问题、给出修改方向，但最终仍需要看样本和人工判断。

## 9. Grader 设计逻辑

为了能直接落地，建议把 grader 拆成多个小 grader，而不是写一个“万能评审”。万能 judge 很容易混淆过程努力、最终质量、事实性和写作风格，导致分数不可解释。

推荐 grader pipeline：

1. `precheck`：程序化检查 run 是否有效，是否有 final，是否截断，是否泄漏工具协议。
2. `artifact_rubric_grader`：只看 final answer，评估 objective / product quality。
3. `style_grader`：只看 final answer，评估阅读体验、AI 味和表达品味。
4. `claim_audit_grader`：抽取关键 claim，检查引用和来源支撑。
5. `trace_grader`：只在 final 扣分后使用，分析 trace 中的行为原因。
6. `pairwise_grader`：盲评 baseline 和 candidate，输出用户偏好。
7. `result_check`：把程序检查、grader 结果和回归阈值合成 pass / fail / needs review。

### 9.1 Case Spec

每个 eval case 不应只有一个 query。它应该显式写出用户合同和评测关注点。

```ts
type ResearchEvalCase = {
  id: string;
  query: string;
  intent: "landscape" | "decision" | "controversy" | "freshness" | "long_synthesis";
  timeWindow?: string;
  audience?: string;
  requiredDimensions: string[];
  preferredSourceTypes: string[];
  riskClaims: Array<"numbers" | "benchmarks" | "vendor_claims" | "future_models" | "medical_legal_financial" | "fast_changing">;
  expectedDeliverables: string[];
  disallowedPatterns?: string[];
};
```

示例：

```json
{
  "id": "agent-eval-landscape",
  "query": "介绍学术界和工业界最新的 Agent 评测工作和方法论",
  "intent": "landscape",
  "timeWindow": "2024-2026",
  "audience": "正在设计 agent eval harness 的工程团队",
  "requiredDimensions": [
    "academic benchmarks",
    "industry practice",
    "judge methodology",
    "safety and reliability",
    "cost and infrastructure",
    "open problems"
  ],
  "preferredSourceTypes": ["paper", "official docs", "benchmark repo", "company technical report"],
  "riskClaims": ["numbers", "benchmarks", "vendor_claims", "fast_changing"],
  "expectedDeliverables": ["core thesis", "source-backed synthesis", "methodology abstraction", "uncertainties"]
}
```

这里的 `requiredDimensions` 不是金标准答案，而是用户明示需求的可检查合同。它能防止 agent 为了追求引用数量，丢掉用户真正要求的分类结构。

### 9.2 Run Artifact

一次 run 至少保存这些数据：

```ts
type ResearchRunArtifact = {
  runId: string;
  caseId: string;
  status: "completed" | "failed" | "cancelled" | "timeout";
  finalMarkdown: string;
  traceEvents: TraceEvent[];
  intermediateFiles?: Record<string, string>;
  errors?: Array<{ stage: string; message: string }>;
  usage?: {
    wallClockMs?: number;
    modelCalls?: number;
    toolCalls?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
};
```

如果没有 `finalMarkdown`，这次 run 应直接进入 failed/no-final 分支。不要为了跑 judge 生成伪 final。

### 9.3 Artifact Rubric Grader

这个 grader 只看 final answer 和 case spec，不看 trace。

输入：

- case query
- case required dimensions
- final answer

输出建议：

```ts
type ArtifactRubricGrade = {
  overallScore: number;      // 0-100
  objectiveScore: number;    // 0-100
  productScore: number;      // 0-100
  dimensionScores: Array<{
    name: "coverage" | "freshness" | "source_quality" | "citation_alignment" | "evidence_discipline" | "conflict_handling" | "synthesis_depth" | "specificity" | "decision_value" | "honesty";
    score: number;           // 0-5
    reason: string;
    evidenceFromAnswer?: string;
  }>;
  strengths: string[];
  weaknesses: string[];
  likelyUserComplaints: string[];
  revisionAdvice: string[];
  harnessImplications: string[];
};
```

Prompt 约束：

- 明确写“只评估用户可见 final answer，不奖励隐藏 trace、工具调用或努力程度”。
- 要求 judge 引用 final answer 中的短片段作为评分依据。
- 要求区分 `weaknesses` 和 `harnessImplications`：前者是用户看到的问题，后者才是工程改动方向。
- 要求如果 final 没有回答用户明示维度，必须扣 coverage / specificity。
- 要求如果有数字、排名、benchmark、成本、发布日期但无来源，必须扣 evidence discipline。

### 9.4 Style Grader

Style grader 也只看 final answer。它不重新评事实覆盖，除非事实表达影响用户信任。

输出建议：

```ts
type StyleGrade = {
  styleScore: number;        // 0-100
  readerValueScore: number;  // 0-100
  aiFlavorRisk: number;      // 0-100, 越高越像模板 AI 报告
  dimensionScores: Array<{
    name: "opening_value" | "authorial_voice" | "narrative_flow" | "paragraph_craft" | "format_taste" | "anti_template_naturalness" | "cognitive_load" | "reader_guidance" | "citation_integration" | "domain_register";
    score: number;           // 0-5
    reason: string;
  }>;
  readerExperience: string;
  rewriteAdvice: string[];
  harnessImplications: string[];
};
```

Style grader 的关键是防止一种常见退化：答案越来越长、越来越全、引用越来越多，但读起来越来越像模板和资料堆。

### 9.5 Claim Audit Grader

Claim audit 可以分两种模式：

- `final-only mode`：只看最终答案，检查 claim 是否有可见引用。
- `source-aware mode`：同时看 final、source ledger、fetch 摘要或抓取正文，检查引用是否真的支持 claim。

如果条件允许，应优先做 source-aware mode。

输出建议：

```ts
type ClaimAuditGrade = {
  claims: Array<{
    claim: string;
    type: "number" | "comparison" | "trend" | "methodology" | "recommendation" | "risk" | "factual";
    importance: "high" | "medium" | "low";
    citationStatus: "cited" | "uncited" | "unclear";
    supportStatus: "supported" | "partially_supported" | "unsupported" | "contradicted" | "overclaimed" | "not_checked";
    reason: string;
    citedSources?: string[];
  }>;
  supportedRatio: number;
  highRiskUnsupportedClaims: string[];
  citationAlignmentIssues: string[];
};
```

Result check 可以把这些情况设为硬风险：

- high-importance claim 未引用。
- benchmark / ranking / cost 数字 unsupported。
- citation 存在但明显不支持正文。
- 最新性 claim 没有日期或版本。

### 9.6 Trace Grader

Trace grader 不应该替 final artifact 加分。它的职责是归因。

输入：

- trace events
- intermediate files
- final judge weaknesses
- case spec

输出建议：

```ts
type TraceGrade = {
  behaviorScores: Array<{
    name: "source_discovery" | "evidence_acquisition" | "research_control" | "memory_use" | "finalization";
    score: number;           // 0-5
    reason: string;
  }>;
  observedFailures: Array<{
    type: "no_fetch" | "snippet_only" | "no_coverage_audit" | "write_without_readback" | "weak_source_strategy" | "premature_final" | "length_truncation" | "model_failure" | "citation_not_externalized" | "query_contract_lost";
    evidence: string;
    likelyFix: string;
  }>;
  positiveBehaviors: string[];
};
```

Trace grader 要特别避免“工具调用越多分越高”。合理做法是先用程序统计生成 features，再让 LLM analyzer 解释这些 features。

### 9.7 Pairwise Grader

Pairwise grader 用于发布前判断候选版本是否真的更好。

输入时要盲化：

```ts
type PairwiseInput = {
  caseSpec: ResearchEvalCase;
  answerA: string;
  answerB: string;
};
```

输出：

```ts
type PairwiseGrade = {
  decision: "A" | "B" | "tie";
  confidence: number;        // 0-1
  rationale: string;
  userPreferenceReason: string;
  dimensionWinners: Array<{
    dimension: "trust" | "coverage" | "synthesis" | "readability" | "decision_value" | "citation_quality" | "style";
    winner: "A" | "B" | "tie";
    reason: string;
  }>;
  harnessImplications: string[];
};
```

Pairwise 的主指标是 win-rate。单份分数可以辅助，但发布判断不应只看绝对分。

## 10. Result Check 设计逻辑

Grader 给出判断，result check 负责把判断变成可执行的 pass / fail / needs review。它应该包含 deterministic checks、LLM grader checks 和 regression checks 三层。

### 10.1 Deterministic Checks

这些检查不需要 LLM，应该先跑。

```ts
type DeterministicCheckResult = {
  passed: boolean;
  hardFailures: string[];
  warnings: string[];
  features: {
    finalCharCount: number;
    citationCount: number;
    uniqueDomainCount: number;
    sourceSectionPresent: boolean;
    hasTruncationMarker: boolean;
    hasDanglingProtocolToken: boolean;
    firstScreenHasThesisSignal: boolean;
    headingCount: number;
    tableCount: number;
    listItemCount: number;
    searchCallCount?: number;
    fetchCallCount?: number;
    evidenceRecordCount?: number;
    coverageReviewCount?: number;
    memoryWriteCount?: number;
    memoryReadbackSignal?: boolean;
  };
};
```

建议硬失败：

- run status 不是 completed。
- `finalMarkdown` 为空。
- final 仍包含内部协议 token，例如 chunk marker、tool JSON、debug trace。
- final 明显截断，例如停在半个表格、半个列表、未闭合代码块或 continuation marker。
- 长程 research 没有任何可见来源。
- judge JSON 解析失败且 fallback 仍失败。

建议 warning：

- citation count 很低。
- 来源域名过度集中。
- 第一屏没有核心判断。
- 表格或列表占比过高。
- final 开头暴露“我搜索了 X 次 / 抓取了 Y 个网页”等过程统计。
- trace 中搜索很多但正文抓取很少。
- trace 中写了 memory 但没有 readback 信号。
- 多次 guard 修复后才通过，说明 harness 有脆弱点。

### 10.2 Final Answer Static Checks

这些检查可以用规则实现，作为 judge 前的 cheap signals。

| Check | 逻辑 |
|---|---|
| Empty / no-final | final 去空白后长度为 0，直接 fail |
| Truncation | 检查未闭合 markdown fence、未闭合表格、末尾悬空编号、`continue` / `truncated` / 内部 chunk token |
| Citation count | 统计 URL、Markdown link、脚注、来源小节 |
| Source diversity | 提取 domain，计算 unique domain 和 top domain 占比 |
| First-screen thesis | 前 800 到 1200 字是否出现判断性信号，如“核心判断 / 总体判断 / 结论 / 我的判断 / 关键变化” |
| Process leakage | 检查“我搜索了”“工具调用”“trace”“guard”“RANNI_FINAL_PART”等内部过程词 |
| Format load | 统计 heading、table、list item 与总长度比例，标记过度表格化或清单化 |
| Query contract terms | 检查 case `requiredDimensions` 的关键词是否在 final 中可见 |
| Unsafe certainty | 检查“唯一 / 必然 / 最新 / 最强 / 已证明”等强断言是否有引用或限定 |

这些 static checks 不应单独决定质量高低，但它们很适合做 hard gate、warning 和 judge 输入特征。

### 10.3 Trace Static Checks

Trace 也可以先做程序统计。

| Check | 逻辑 |
|---|---|
| Search diversity | query 去重数、query 编辑距离、是否覆盖 required dimensions |
| Fetch ratio | `fetch_url / search_web`，过低说明可能停留在 snippet |
| Evidence externalization | finding / evidence / ledger 数量 |
| Coverage audit | 是否出现 coverage review、source mix、gap review 或 equivalent event |
| Memory use | 是否写入 source / claim / coverage / synthesis artifact，最终前是否读回或注入 |
| Error handling | 抓取失败是否被局部处理，而不是终止整轮 |
| Finalization guards | 是否过早 final，是否有 answer-quality repair，是否多次 repair |
| Chunk completeness | 如果分段输出，part 是否连续、是否聚合完整、最终是否清理 chunk state |

Trace static checks 的结果不应直接覆盖 final judge。它们用于解释为什么 final 失败，以及发现 harness bug。

### 10.4 Score Aggregation

一个简单可落地的聚合方式：

```ts
type ResearchEvalSummary = {
  status: "pass" | "fail" | "needs_review";
  overallScore: number;
  objectiveScore: number;
  productScore: number;
  styleScore: number;
  aiFlavorRisk: number;
  claimSupportedRatio: number;
  hardFailures: string[];
  warnings: string[];
  topRegressions: string[];
  releaseRecommendation: "ship" | "hold" | "manual_review";
};
```

示例规则：

- 有 hard failure：`fail`。
- no-final：`fail`，总分 cap 到很低。
- objectiveScore < 75：`needs_review` 或 `fail`，取决于场景。
- productScore < 75：`needs_review`。
- styleScore < 70 且 AI flavor risk > 60：`needs_review`。
- high-risk unsupported claim > 0：`needs_review`；如果是医疗、法律、金融或安全场景，直接 `fail`。
- pairwise win-rate 相对 baseline < 50%：不能发布。
- 平均分提升但最差样本下降明显：`manual_review`。

不要把所有分数简单加权成一个数字后自动发布。Research eval 的失败通常是局部但严重的，例如一个 unsupported benchmark claim 就可能破坏整份报告信任。

### 10.5 Regression Checks

每次 harness 改动后，应至少比较：

- 同 case baseline vs candidate。
- 泛化 case baseline vs candidate。
- 平均分变化。
- 最差样本变化。
- failed/no-final rate。
- claim supported ratio。
- style score 和 AI flavor risk。
- pairwise win-rate。
- 主要 warning 类型是否变化。

推荐发布门槛：

- Candidate 在主 case pairwise win-rate 高于 baseline。
- 泛化 case 没有明显退化。
- No-final / timeout / truncation rate 不上升。
- High-risk unsupported claims 不增加。
- Style score 不下降，AI flavor risk 不上升。
- 如果某项下降，必须有人工接受的产品理由。

### 10.6 Result Check 输出格式

最终输出应该同时给机器和人看。

机器可读：

```json
{
  "status": "needs_review",
  "overallScore": 86,
  "objectiveScore": 89,
  "productScore": 84,
  "styleScore": 78,
  "aiFlavorRisk": 42,
  "claimSupportedRatio": 0.82,
  "hardFailures": [],
  "warnings": ["first_screen_weak_thesis", "source_domain_concentration"],
  "topRegressions": ["style_score -6 vs baseline"],
  "releaseRecommendation": "manual_review"
}
```

人类可读：

- 本次是否可发布。
- 最主要的 3 个质量问题。
- 这些问题来自 final artifact 还是 trace。
- 建议改 prompt、tool schema、memory、guard、retrieval，还是只需要修最终写作。
- 与 baseline 相比，是实质提升、持平、还是假性提升。

## 11. 反作弊和反过拟合原则

Research agent eval 很容易被 harness 规则带偏。建议避免这些误区：

- 不要把工具调用次数当作主指标。
- 不要把引用数量当作 citation quality。
- 不要把长答案当作深度。
- 不要把表格数量当作结构化能力。
- 不要把中间文件数量当作 memory use。
- 不要把某个参考答案的知识点硬塞进 prompt。
- 不要只在一个 case 上迭代。
- 不要只看平均分，不看最差样本和失败率。

好的 eval 应该奖励可泛化的研究行为：

- 能拆解问题。
- 能动态扩展。
- 能核验证据。
- 能处理冲突。
- 能外部化重要记忆。
- 能形成综合判断。
- 能把结果写成用户愿意读、能使用、能追溯的产物。

## 12. Harness 设计只需要服务 eval

如果要搭一个最小可用的 research eval harness，建议保留这些产物：

- `trace.ndjson`：每个工具调用、模型消息、错误、guard 触发。
- `final.md`：用户可见最终答案。
- `metrics.json`：基础统计和失败状态。
- `trajectory-analysis.md`：trace 行为分析和 failure taxonomy。
- `judge-rubric.json/md`：最终产物 objective / product 评分。
- `claim-audit.md`：关键 claim 支撑情况。
- `style-judge.json/md`：阅读体验和 AI 味评估。
- `pairwise-judge.json/md`：版本对比偏好。

Harness 本身可以很简单，但要满足几个要求：

- 运行产物可复现、可比较、可重算。
- 失败时保留部分 trace，不生成伪 final。
- 缺少模型 key 或搜索 key 时明确失败。
- 长 final 要在聚合后再 judge。
- Analyzer 和 judge 变更后可以 reanalyze 历史 run。
- 每次改动都能和 baseline 做 pairwise 或至少同 case 对比。

## 13. 推荐的迭代节奏

一个实际可执行的节奏：

1. 先跑 baseline，保存 trace 和 final。
2. 用 final-only judge 评估用户可见质量。
3. 用 claim audit 找关键证据问题。
4. 用 style judge 找阅读体验问题。
5. 用 trace analyzer 给扣分归因。
6. 做最小 harness / prompt / tool schema 修改。
7. 跑同 case 确认修复。
8. 跑泛化 case 确认没有过拟合。
9. 用 pairwise judge 比较 baseline 和 candidate。
10. 把本轮观察、改动、结果、残余风险记录下来。

不要一开始就设计一个完美流程。更有效的方法是让真实 trajectory 暴露瓶颈，再把瓶颈转成 eval 指标和 harness 改动。

## 14. 最终目标

信息检索类 agent 的 eval 不应只是问“有没有查到资料”。更好的问题是：

- 它是否像一个有判断力的研究者一样工作？
- 它是否把关键证据变成了可审计的判断？
- 它是否减少了用户的搜索、筛选、比较和决策成本？
- 它是否知道自己不知道什么？
- 它是否把复杂信息写成了人愿意读、读完能用的研究结果？

Trace eval 让我们知道 agent 是否以合理方式工作。Artifact eval 让我们知道用户是否真的得到价值。两者结合，才是 research agent 迭代中最稳的评测基础。
