# Reply Rules

You should reply to user in Chinese.

## Communication Style

- 使用清晰、正向、可核对的语言。
- 避免使用二元否定对比句式，直接说明对象、边界和结论。
- 讨论 UI、Agent Runtime、Context、状态、Skill、事件和模块时，使用本文件指定的权威命名文档。
- 当“状态”“计划”“阶段”“上下文”“结果”“完成”等词可能指向多个对象时，补全限定词。

## Commit Message Format

Use Conventional Commit types, but keep the subject line as type only.

Format:

```text
<type>:
- <change summary 1>
- <change summary 2>
- Tests: <status>
```

Rules:

- type in `{feat, fix, refactor, chore, docs, test, perf}`
- one change per bullet, start with a verb, keep each line short
- include a Tests line when relevant, for example `Tests: not run (not requested)`

## Branch Rules

This project is currently in the debugging phase and does not need to adhere to strict branching rules, only commit conventions. All current work is being executed on the main branch.

## Project Facts

- Ranni 是 local-first Web Agent 工作台，运行形态为浏览器前端与本地 Node 后台。
- 选中的 Session 工作区是 Agent 执行边界。文件工具、终端工具、研究输出、工件和 `.ranni` 任务记忆必须使用该工作区。
- `lib/agent.ts` 是稳定公共 facade。Run Controller、Step Runner、Tool Batch Executor、Run State、Finalization、Recovery、Policy 和 Event Sink 位于 `lib/agent/` 及其专属模块。
- Context Composer V2 只在安全输入预算需要时压缩较老历史。最近完整 Causal Turn、上一轮工具调用与结果配对、Task Contract、Working Set 和补充要求拥有明确保留语义。
- Task Contract 保存用户目标、交付要求、约束和授权边界。Agent Note 保存模型当前工作判断。Observed State 由 Tool Receipt 投影产生，作为文件、命令、证据、工件、验证和错误事实的权威来源。
- `TaskState` 是兼容聚合投影。讨论事实或模型判断时分别使用 Task Contract、Agent Note、Observed State、Working Plan、Acceptance Snapshot 等精确名称。`TaskState.plan` 是 Working Plan 标题列表的兼容投影。
- `update_task_state` 只更新 Agent Note 和兼容字段。`update_plan` 修订 Working Plan、`replace_attempt` 替换具体工作路线。这三类协调工具的成功回执都不构成交付推进。
- Receipt Registry 汇总 Tool Receipt 并生成 Observed State。Plan Ledger 管理 Working Plan、Plan Item、Plan Revision、Objective Projection 和 Plan Focus；`PlanAttemptLedger` 管理 Attempt、假设、失败与路线替代。Acceptance Ledger 和 Progress Tracker 基于客观回执协调验收与进展。
- Skill 由 Skill Index、Skill Body、资源和可选专属工具组成。用户选择与模型 `load_skill` 最终进入同一 Active Skill 集合，并在下一 Step 更新指令、工具和交付契约。
- Artifact Policy 可以维护工件关注点并约束工件不变量，同时持续保留研究、读取、安全观察、制作和验证所需能力。
- Finalization Controller 只接受具备客观完成依据的最终回答。Completion Guard 打回缺少工件或验证依据的候选结果。
- Provider 有界重试复用同一模型请求，不提交半截响应，不重复执行已完成工具。重试耗尽后 Recovery Controller 保留 Causal Tail、Observed State、Working Plan、Acceptance、Progress 和当前 Attempt；同 Session、同 workspace 的下一 Run 可以继续该现场。
- Event Log、持久化 Trace、Run 概览和 Step I/O 是运行事实的可观测投影。主消息流由 Client Notification 驱动，Trace 保留精确请求、响应、回执、Plan Revision、Objective Projection 和 Attempt 变化。
- 长回答可以使用 Chunked Final 协议；完整聚合结果进入 Finalization 与 Acceptance 判定。
- Runtime 输出 `research/`、`.ranni/` 和 `dist/` 已忽略。需要长期维护的内容应整理后放入 `docs/`。
- 浏览器中的设置键属于 localStorage 本地便利数据，不作为生产密钥存储。
- 模型返回的 `thinking` 属于可观察 Trace 与展示面；完整原始 Context 只在 Trace 和调试视图中查看。

## Canonical Naming

- 使用 `UI-NAMING.md` 作为页面区域、可见 UI 元素、消息流元素和事件到 UI 投影的权威词表。
- 使用 `CONCEPT-NAMING.md` 作为 Agent Loop、Context、状态、Skill、Policy、Receipt、Acceptance、Recovery、事件层和模块边界的权威词表。
- 使用 `docs/tech/architecture-global/glossary.md` 查询规范概念对应的代码落点和跨架构实现细节；该文件不另建同义词体系。
- `docs/tech/v2-architecture/agent-arch/general-agent-harness/` 保存通用 Agent Harness 的详细设计与实现契约。概念名必须与 `CONCEPT-NAMING.md` 一致。
- 产品讨论、Issue、代码 Review 和文档优先使用权威中文名；首次出现时可以补充英文名或代码标识。
- 新增或重命名可见 UI 元素时，在同一变更中更新 `UI-NAMING.md`。
- 新增或重命名 Agent Runtime 概念、公共状态语义、事件层或模块责任时，在同一变更中更新 `CONCEPT-NAMING.md` 和对应技术文档。
- UI 元素引用运行时概念时，UI 名称由 `UI-NAMING.md` 定义，概念语义由 `CONCEPT-NAMING.md` 定义。
- 兼容字段和旧事件名只在说明兼容协议时使用，并明确标注“兼容”。

## Documentation Rules

- Keep README aligned with current user-facing functionality and startup instructions.
- `AGENTS.md`、`UI-NAMING.md` 和 `CONCEPT-NAMING.md` 是仓库根目录下的协作契约，无需 docs metadata front matter。
- Use the current docs taxonomy:
  - `docs/tech/` stores technical and architecture documents.
  - `docs/product/` stores product and UI design documents.
  - `docs/manuel/` stores usage guidance and teaching documents.
- Every markdown document under `docs/` must start with metadata front matter:
  - `author: <name>`
  - `version: <version>`
  - `date: YYYY-MM-DD`
- When creating or editing docs, preserve or add the metadata front matter. Use the file creation date for `date` when available; if unavailable, use the current date.
- Default docs metadata is `author: codex` and `version: v1`.
- Documents under `docs/tech/v2-architecture/` use `author: manus` and `version: v2`.
- For architecture or Agent behavior changes, update the matching docs under `docs/tech/`.
- For component or directory ownership changes, update `docs/tech/v1-architecture/component-map.md` or the current matching tech architecture document.
- For product-level UI or capability changes, update the matching docs under `docs/product/`.
- For user-facing usage guidance changes, update the matching docs under `docs/manuel/`.
- Keep concept docs separate from implementation docs:
  - `docs/tech/**/core-concept/` is for foundational concepts.
  - `docs/tech/**/agent-arch/` is for Agent Loop、action way、implementation notes and architecture optimization.

## Quality and Evaluation

- 优先优化用户可见的最终结果和真实任务完成能力。
- Trace、Task Memory、Source Ledger、Claim Ledger、Coverage Matrix 和 Judge 输出用于诊断，不作为模型必须遵循的固定轨迹。
- `npm run research:eval` 是本地深度研究评测入口，可运行案例、复析 Trace、比较 Run，并在已忽略的 `research/research-eval/` 下生成评测产物。
- 研究质量改造在模型和 Tavily 配置可用时，优先运行至少一个定向 `npm run research:eval -- --case ... --judge`。
- 行为改造完成后，优先通过真实 Ranni Run 检查研究、工具使用、工件生成、验证、错误恢复和最终交付。

## Verification

- For code changes, prefer `npm run typecheck`, `npm run lint`, and `npm run build` unless the change is clearly docs-only.
- For targeted runtime changes, run the closest unit and integration tests before full verification.
- For docs-only changes, run `git diff --check` and scan canonical terms across `AGENTS.md`, `UI-NAMING.md`, `CONCEPT-NAMING.md`, and the matching architecture docs.
