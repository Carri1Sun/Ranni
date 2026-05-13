# Open Evals

`open-evals/` 是一组可独立使用的信息检索类 agent 评测脚本。它不负责运行 agent、不负责搜索、不负责失败恢复；当前只处理已经收集好的调研报告和 trace。

输入分两类：

- Final artifact：用户最终看到的 Markdown 调研报告。
- Trace：agent 运行过程数据，用于归因分析。

核心原则：

- Final artifact eval 是主评测目标。
- Trace analyzer 只用于解释 final 为什么好或不好。
- LLM-as-judge 负责语义质量判断。
- 程序化 checks 负责硬门禁、格式风险、截断、协议泄漏和基础统计。

详细方法论见 [research-agent-evals-guide.md](./research-agent-evals-guide.md)。

## 环境变量

脚本默认用 DeepSeek OpenAI-compatible API，默认模型是 `deepseek-v4-pro`。会读取项目根目录的 `.env` 和 `.env.local`，其中 `.env.local` 覆盖 `.env`。

推荐配置：

```bash
DEEPSEEK_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-pro
LLM_MAX_TOKENS=4096
LLM_ENABLE_THINKING=true
LLM_REASONING_EFFORT=high
```

也可以使用 `OPEN_EVALS_` 前缀只影响这些 eval 脚本：

```bash
OPEN_EVALS_LLM_API_KEY=sk-...
OPEN_EVALS_LLM_BASE_URL=https://api.deepseek.com
OPEN_EVALS_LLM_MODEL=deepseek-v4-pro
OPEN_EVALS_LLM_MAX_TOKENS=4096
OPEN_EVALS_LLM_ENABLE_THINKING=true
OPEN_EVALS_LLM_REASONING_EFFORT=high
OPEN_EVALS_LLM_TEMPERATURE=0.1
OPEN_EVALS_LLM_TIMEOUT_MS=120000
```

LLM 调用封装在 [lib/llm.ts](./lib/llm.ts)。如果要换自己的 provider：

- 如果 provider 兼容 OpenAI Chat Completions，只需要改环境变量中的 base URL、model 和 API key。
- 如果 provider 不兼容 OpenAI Chat Completions，直接改 [lib/llm.ts](./lib/llm.ts) 的 `callJudgeLlm`。
- 如果 provider 不支持 DeepSeek thinking 参数，把 `OPEN_EVALS_LLM_ENABLE_THINKING=false`。

## Final Artifact Evals

这些脚本输入 `query` 和一份 Markdown 结果文件。

### Rubric

评估 objective / product quality：覆盖、最新性、来源质量、引用对齐、证据纪律、冲突处理、综合深度、用户价值等。

```bash
npx tsx open-evals/rubric-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --out open-evals/out/rubric.json
```

### Style

评估用户阅读体验：第一屏价值、作者判断、叙事流、段落质量、格式品味、AI 味、读者引导等。

```bash
npx tsx open-evals/style-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --out open-evals/out/style.json
```

### Claim Audit

抽取关键 claim，检查引用和来源支撑。

```bash
npx tsx open-evals/claim-audit-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --out open-evals/out/claim-audit.json
```

如果有 source ledger、抓取正文摘要或来源上下文，可以传 `--sources` 做 source-aware audit：

```bash
npx tsx open-evals/claim-audit-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --sources path/to/sources.md \
  --out open-evals/out/claim-audit.json
```

### 一键 Final Artifact Eval

同时运行 rubric、style、claim audit 和 deterministic final checks。

```bash
npx tsx open-evals/final-artifact-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --sources path/to/sources.md \
  --out-dir open-evals/out/run-1
```

输出：

- `rubric.json`
- `style.json`
- `claim-audit.json`
- `final-checks.json`
- `summary.json`

`summary.json` 会包含简单 result check：

- `pass`
- `needs_review`
- `fail`

当前 result check 只用于已完成报告的质量门禁，不处理 agent run 失败恢复。

## Pairwise Eval

Pairwise 用来比较 baseline 和 candidate，更接近真实产品判断。

```bash
npx tsx open-evals/pairwise-eval.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --answer-a path/to/baseline.md \
  --answer-b path/to/candidate.md \
  --out open-evals/out/pairwise.json
```

Pairwise grader 会盲评 A/B，输出：

- 总体偏好。
- 置信度。
- trust / coverage / synthesis / readability / decision value / citation quality / style 等维度赢家。
- 对 harness 迭代的启发。

## Trace Analyzer

Trace analyzer 输入 `query`、最终 Markdown 和 trace 文件。它会先做程序化 trace features，再调用 LLM 做行为归因。

```bash
npx tsx open-evals/trace-analyzer.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --trace path/to/trace.ndjson \
  --out open-evals/out/trace-analysis.json
```

只跑程序化检查，不调用 LLM：

```bash
npx tsx open-evals/trace-analyzer.ts \
  --query "介绍学术界和工业界最新的 Agent 评测工作和方法论" \
  --result path/to/final.md \
  --trace path/to/trace.ndjson \
  --static-only
```

输出包含：

- final static checks。
- trace static features。
- LLM trace grade。
- observed failures。
- likely fixes。

## Trace 数据结构

脚本支持三种格式：

- JSON array。
- JSON object with `events`。
- NDJSON，每行一个 event。

推荐 event 结构：

```ts
type OpenEvalTraceEvent = {
  type: string;
  name?: string;
  timestamp?: string;
  content?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
};
```

示例 NDJSON：

```jsonl
{"type":"tool_call","name":"search_web","input":{"query":"agent evaluation benchmarks 2026"}}
{"type":"tool_result","name":"search_web","output":{"results":[{"title":"GAIA","url":"https://example.com"}]}}
{"type":"tool_call","name":"fetch_url","input":{"url":"https://example.com"}}
{"type":"tool_call","name":"record_research_finding","input":{"claim":"GAIA evaluates general AI assistants","source_type":"paper"}}
{"type":"tool_call","name":"review_research_state","input":{"coverage_dimensions":["benchmarks","industry","safety"]}}
```

你需要自己把 agent 原始 trace 转换成这个结构；或者直接改 [lib/trace.ts](./lib/trace.ts) 和 [lib/static-checks.ts](./lib/static-checks.ts)，适配自己的 trace schema。

Trace analyzer 的程序化 features 会尝试识别：

- search call count。
- fetch call count。
- evidence / finding 记录。
- coverage audit。
- memory write / readback signal。
- guard / repair。
- errors。
- chunked final signals。

这些识别是启发式的。不同 agent 的 trace 命名不同，建议根据自己的工具名调整正则。

## 可选参数

所有 final artifact / pairwise / trace 脚本都支持：

```bash
--dimensions "academic benchmarks,industry practice,judge methodology,safety,cost"
```

`--dimensions` 用来告诉 judge 用户 query 中必须保留的结构轴。它不是金标准答案，只是 query contract。

## Grader 逻辑

当前脚本分工：

| 脚本 | 方法 | 作用 |
|---|---|---|
| `rubric-eval.ts` | LLM-as-judge | final answer 的研究质量和用户价值 |
| `style-eval.ts` | LLM-as-judge | final answer 的阅读体验和 AI 味 |
| `claim-audit-eval.ts` | LLM-as-judge + 可选 sources | 关键 claim 支撑情况 |
| `final-artifact-eval.ts` | deterministic checks + 三个 LLM graders | final artifact 一键评测 |
| `pairwise-eval.ts` | LLM-as-judge | 两份 final answer 盲评偏好 |
| `trace-analyzer.ts` | deterministic trace features + LLM analyzer | trace 行为归因 |

设计上刻意避免一个万能 judge：

- Rubric judge 不评隐藏 trace。
- Style judge 不重新评覆盖面。
- Trace analyzer 不给 final 加努力分。
- Result check 用硬规则和阈值做发布判断。

## 输出如何使用

建议迭代顺序：

1. 先跑 `final-artifact-eval.ts`。
2. 看 `summary.json` 中的 `resultCheck`、rubric 弱点、style 弱点和 claim audit。
3. 如果 final 有问题，再跑 `trace-analyzer.ts` 归因。
4. 修改 prompt、tool schema、memory、retrieval 或 final synthesis。
5. 用 `pairwise-eval.ts` 比较 baseline 和 candidate。

不要只看单个总分。重点看：

- 关键 claim 是否可审计。
- 用户是否能第一屏看到判断。
- 是否保留用户明示维度。
- 是否比 baseline 更值得交给用户。
- 是否只是引用更多、字数更长，但阅读体验变差。
