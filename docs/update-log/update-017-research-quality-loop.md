# Update 017 - Deep Research Quality Loop

本次更新为 Ranni 增加 deep research 质量迭代闭环，目标是用可见 trace 和中间文件分析 agent 的实际研究行为，而不是靠固定轨迹脚本提升单个 query。

## 主要变化

- 新增 `npm run research:eval`，可脚本化运行 research case 并输出 `trace.ndjson`、`final.md`、`metrics.json`、`score.md`、`trajectory-analysis.md`、`comparison.md`。
- 新增 trajectory analyzer，统计搜索扩展、正文抓取、证据记录、coverage audit、中间文件写入和读回，并支持 `--reanalyze` 重算历史 run。
- 扩展 research notebook schema：coverage dimensions、source strategy、stop rules、source type、published date、claim span。
- 扩展 task memory：`source-ledger.md`、`claim-ledger.md`、`coverage-matrix.md`、`synthesis-brief.md`。
- 增加 research finalization guard，防止非平凡调研任务缺少正文核验、证据记录或覆盖审查时过早 final。
- 增加 research answer quality guard，在最终答案缺少可见引用或来源小节时用已有证据做一次最终修复。
- 增加 model failure recovery，当 deep research 已有足够 evidence 但最终综合阶段模型请求失败时，压缩上下文并基于 task memory 恢复最终回答。
- 更新 agent research prompt，强调动态研究地图、来源层级、反证补洞、文件记忆启发式和 thesis-driven synthesis。
- 收紧 abort error 判断并扩展 retryable model error，避免单个网页抓取超时被误判为整轮用户取消，也避免 `terminated` 这类模型连接错误直接杀死最终综合。
- 调整 eval scoring：failed/no-final run 会被总分 cap，避免只因搜索过程强就掩盖交付失败。

## 验证

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `npm run research:eval -- --help`
- `npm run research:eval -- --case agent-eval-landscape --label v2-incremental-agent-eval --repeats 1 --timeout-ms 1200000`：暴露 fetch timeout 被误判为取消，样本提前结束，得分 13/30。
- `npm run research:eval -- --case agent-eval-landscape --label v3-abort-fix-agent-eval --repeats 1 --timeout-ms 1200000`：完成核心 query，重算后 30/30；trace 中有动态搜索、正文抓取、evidence、coverage review 和文件记忆复用。
- `npm run research:eval -- --case agent-context-engineering --label v3-generalization-context --repeats 1 --timeout-ms 1200000`：泛化样本 trajectory 强，但最终可见引用不足，按新评分重算 28/30。
- `npm run research:eval -- --case agent-context-engineering --label v4-citation-guard-context --repeats 1 --timeout-ms 1500000`：answer quality guard 触发，最终引用信号提升到 69 个，总分 29.4/30。
- `npm run research:eval -- --case enterprise-rag-evaluation --label v4-generalization-rag --repeats 1 --timeout-ms 1500000`：trajectory 强但最终模型请求 `terminated`，无 final；按新评分重算 12/30。
- `npm run research:eval -- --case enterprise-rag-evaluation --label v5-model-recovery-rag --repeats 1 --timeout-ms 1500000`：完成泛化 case，20 次抓取、9 条 finding、14 条 evidence、引用信号 116 个，总分 28.1/30。

完整 high suite 多重复仍应继续跑平均分和最差样本；当前高预算样本运行产物写入 ignored `research/research-eval/`。
