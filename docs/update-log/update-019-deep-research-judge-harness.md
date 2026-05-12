# Update 019 - Deep Research Judge Harness

本次更新把 deep research 优化从 trajectory 诊断推进到最终产物质量评估。目标是让 harness 围绕用户可见质量迭代，而不是只优化工具调用形态。

## 主要变化

- 新增 `docs/research-optimize/deep-research-quality-spec.md`，定义 objective spec 和 product/user spec。
- `research:eval` 新增 `--judge-run <run>`，对既有 run 的 `final.md` 做 rubric judge。
- `research:eval` 新增 `--judge-pair <a> <b>`，对两份最终回答做盲评 pairwise judge。
- `research:eval` 新增 `--judge`，新 research run 完成后自动追加 judge。
- judge run 会输出 `judge-rubric.json`、`judge-rubric.md`、`claim-audit.md`。
- pairwise judge 会输出 `judge-pair-*.json` 和 `judge-pair-*.md`。

## 设计原则

- Judge 默认只看最终回答，不奖励 trajectory、工具调用或 effort。
- Trajectory analyzer 保持为 debug 层，在 judge 扣分后用于归因。
- Rubric judge 关注覆盖、最新性、来源质量、引用对齐、证据纪律、冲突处理、综合深度、产品价值、可读性和具体性。
- Pairwise judge 作为主产品指标，用 win-rate 贴近用户偏好。

## 验证

- `npm run research:eval -- --help`
- `npm run research:eval -- --judge-run v5-model-recovery-rag`：生成 judge rubric，overall 85/100。
- `npm run research:eval -- --judge-run v3-abort-fix-agent-eval`：生成 judge rubric，overall 85/100；fallback JSON judge 生效。
- `npm run research:eval -- --judge-pair v3-generalization-context v4-citation-guard-context --label context-citation-guard`：生成 pairwise judge，选择 A；暴露新版保留用户要求分类维度不足。

工程验证应继续运行：

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
