---
author: claude
version: v1
date: 2026-07-06
subject: Ranni v2 重构后续修改建议（可执行清单）
audience: 执行重构的编码 agent
baseline: commit 86a37b4 之上的当前工作区改动
---

# 给 Ranni-claude 的修改建议

## 背景与总体原则

本仓库的 v2 事件驱动重构整体质量很高，是同基线两个实现里**核心架构最贴合设计文档**的版本（三层 + 三段式 + durable/live、session 级 EventBus、subscribeAll 投影层、Command + SSE 都已正确落地，typecheck / build / lint 全过）。

下面是收尾阶段的改进清单，目标是把「前端只读渲染器」走完最后一步，并补齐工程规范上的缺口。**所有改动以当前 Ranni-claude 实现为准**，不要退化回旧命名；遇到不确定的取舍，优先遵守 `docs/tech/v2-architecture/` 两份设计文档与项目 `AGENTS.md`（= `CLAUDE.md`）。

对照参考仓库（仅作思路参照，**不要照抄命名**，因为本仓库的 v2 命名更先进）：
`/Users/sunkaiyi/Projects/agent-monorepo/Ranni/`

每项改完后跑验证清单（见文末）。

---

## P0 —— 核心架构收尾（必做）

### P0-1. 前端「主状态从 Layer2 推导」改为「消费 Layer3 notification」

**问题**
`components/agent-console.tsx` 的 `dispatchEventRef.current`（约 4714-4837 行）在 Layer3 分支之后，仍有一段 Layer2 处理（约 4813-4836 行）：

```
// Layer 2：TraceEvent → trace/debug 视图重建（+ research/thinking 副作用）。
const legacy = toLegacyStreamEvent(event);
if (!legacy) return;
applyTraceEvent(sessionId, legacy);

if (legacy.type === "research_state") {
  updateSession(sessionId, (session) => ({ ...session, researchContext: legacy.researchState }));
}
if (legacy.type === "thinking" && settings.showThinkingInFeed) {
  finalizeThinkingStream({ ... });
}
```

`applyTraceEvent` 用于 trace/debug 视图重建，这一行保留没问题。问题在于后面两个分支：它们让**主消息流状态**（`session.researchContext`、thinking feed 流）从 Layer2 TraceEvent 反向推导，违背了设计文档 §3.2「前端退化为纯粹的只读渲染器，接收到什么就渲染什么」——这是「纯只读渲染器」最后没走完的一步。

**目标改法**
让这两部分状态由 Layer3 ClientNotification 驱动，Layer2 分支只保留 `applyTraceEvent`（debug 视图）。

1. **后端 `lib/runs/event-mapper.ts` 增加投影**：
   - 把 Layer2 `research.state` 投影成一个新的 Layer3 notification，例如 `research.context.updated`（携带 `researchContext` 字段）。可参考 Ranni 仓库 `lib/event-mapper.ts` 里对 `research_state` 的处理（它发了 `research.context.updated`），但字段命名要与本仓库 `lib/events/schema.ts` 的 `ClientNotification` 风格一致（带 `runId` / `sessionId`）。
   - 把 Layer2 `thinking.completed`（若 `showThinkingInFeed` 场景需要把思考文案作为 feed 项展示）投影成一个 Layer3 notification，例如 `thinking.message` 或复用 `activity.appended`（`activityType: "thinking"`，`display` 由 `display-fallback.ts` 的 `createThinkingDisplay` 生成）。
   - 这两类 notification 都要在 `lib/events/schema.ts` 的 `ClientNotification` 联合类型与 `DURABLE_EVENT_TYPES` 集合里登记。
2. **前端 `components/agent-console.tsx`**：
   - 在 Layer3 分支里新增对上面两个 notification 的处理：`research.context.updated` → `updateSession` 写 `researchContext`；`thinking.message`/对应 activity → 走原本 `finalizeThinkingStream` 等价逻辑。
   - **删除** Layer2 分支里对 `research_state` 和 `thinking` 的 `updateSession` / `finalizeThinkingStream` 调用（即 4820-4836 这两段），只保留 `applyTraceEvent(sessionId, legacy)` 一行用于 debug 视图。
3. 注意：`thinking.delta`（live-only）已在 Layer1 处理（4737-4746），本次只动 `thinking.completed` 的主状态副作用。

**验收**
- `grep -n "research_state\|legacy.type === \"thinking\"" components/agent-console.tsx` 不应出现在 `dispatchEventRef` 内的主状态写入路径（debug 视图的 `applyTraceEvent` 仍可能间接触发，以行为为准：主状态写入只来自 Layer3）。
- 实际跑一个带 research 工具的任务，确认 research 面板的 context 仍能更新（现在由 Layer3 驱动）。
- typecheck / build / lint 通过。

---

## P1 —— 工程规范（应做）

### P1-1. 同步架构与产品文档

**问题**
本仓库未更新任何 v1 架构文档与产品文档，违反 `AGENTS.md` 的 Documentation Rules（「For architecture or agent behavior changes, update the matching docs under `docs/tech/`」「For product-level UI or capability changes, update the matching docs under `docs/product/`」）。

**目标改法**
按本仓库**实际实现**（不要照抄 Ranni 的描述，因为端点、事件命名、结构都不同）更新：

1. `docs/tech/v1-architecture/runtime-architecture.md`：把通信层描述从「单次 HTTP + NDJSON」更新为「Command（`POST /api/runs`、`/api/runs/:id/steer`、`/api/runs/:id/abort`）+ SSE（`GET /api/events`，streamKey=session，Last-Event-ID 续传）」；描述三层事件（ProviderEvent / TraceEvent / ClientNotification）与 EventMapper 投影。
2. `docs/tech/v1-architecture/component-map.md`：补 `lib/events/`、`lib/runs/` 两个新目录的职责说明。
3. `README.md`：若提到了启动 / 接口 / 架构概述，对齐到新的 `/api/runs` 流程。
4. `UI-NAMING.md`：如果新增了可见 UI 模块（例如 steer 活动卡片），按规则补词条；若无新可见模块可跳过。
5. 所有新增/修改的 `docs/**` markdown 保留 frontmatter（`author` / `version` / `date`），按规则 v2 架构文档用 `author: manus, version: v2`，其余默认 `author: codex, version: v1`。

可参照 Ranni 仓库同名文件的改动范围（`git -C /Users/sunkaiyi/Projects/agent-monorepo/Ranni diff HEAD -- docs/tech/v1-architecture/runtime-architecture.md docs/tech/v1-architecture/component-map.md README.md UI-NAMING.md`）了解需要覆盖到什么程度，但内容要按本仓库实现写。

**验收**
- `git diff` 涵盖上述文档；描述与本仓库代码（端点名、事件命名、目录结构）一致。

### P1-2. 修复 `node_modules` 未被 ignore

**问题**
`git status` 仍显示 `?? node_modules`，尽管 `.gitignore` 第 3 行写了 `node_modules/`。`git check-ignore node_modules` 也判定未忽略。说明 ignore 规则未生效（典型原因：该目录或其内文件曾被 `git add` 进索引，或路径匹配异常）。

**目标改法**
1. 跑 `git check-ignore -v node_modules` 与 `git ls-files --error-unmatch node_modules 2>&1 | head` 诊断。
2. 若索引里存在：`git rm -r --cached node_modules`（不要加 `--cached` 之外的删除，避免误删工作区文件——`--cached` 只移除索引）。
3. 确认 `.gitignore` 的 `node_modules/` 规则生效后，`git status` 不再显示 `node_modules`。

**验收**
- `git status --short` 不再出现 `node_modules`。

### P1-3. 合入 SSE 解析健壮性修复

**问题**
本仓库 `lib/llm/providers/openai-compatible.ts` 的流式解析假设「一个 SSE `data:` 块只含一条 JSON」。某些 OpenAI 兼容 provider 会把多条 JSON（或 `[DONE]` 与 JSON）拼在同一个 `data:` 块里，导致 `JSON.parse` 抛错中断流。Ranni 仓库已修复此 bug。

**目标改法**
参照 `/Users/sunkaiyi/Projects/agent-monorepo/Ranni/lib/llm/providers/openai-compatible.ts` 的 `splitSseDataMessages`（把一个 `data:` 内容按行拆成多条候选 JSON，单条合法 JSON 直接返回），合入本仓库同名文件，并在两处 `processData(parseSseData(block))` 改为遍历 `splitSseDataMessages(parseSseData(block))`；同时把 `JSON.parse(data)` 改为 `JSON.parse(data.trim())`。

**验收**
- 本仓库 `readStreamingResponse` 对多 JSON 拼接块不再整体失败。
- typecheck / build 通过。

---

## P2 —— 可选改进

### P2-1. 放宽 `runAgentTurn` 对 `RunRegistry` 的直接依赖

**问题**
`lib/agent.ts` 的 `RunAgentTurnOptions`（约 67-73 行）直接依赖 `registry: RunRegistry`，`runAgentTurn` 内部在 1690 行调 `registry.drainSteer(runId)`。这让 agent 与具体容器类型耦合，降低了 agent 在评测 / 测试场景下的可独立性。

**目标改法**
把 `registry` 替换为一个窄接口回调，例如：
```ts
type RunAgentTurnOptions = {
  // ...
  drainSteer?: (runId: string) => PlainMessage[];
  // 或 getSteeringMessages?: () => PlainMessage[] | Promise<PlainMessage[]>;
};
```
agent 内部 `const steerMessages = options.drainSteer?.(runId) ?? [];`。`src/server/app.ts` 传入 `drainSteer: (id) => registry.drainSteer(id)`；`scripts/research-eval.ts` 对应改为不传或传空实现。

注意：不要因此改变事件发布方式（仍走 emit 适配层 → EventBus），只解耦 steering 这一处。

**验收**
- `runAgentTurn` 的入参不再出现 `RunRegistry` 类型；`app.ts` 与 `research-eval.ts` 相应更新；typecheck / build / lint 通过；research-eval 能正常跑（无需 API key 时至少能启动到模型调用前）。

### P2-2. 跨仓库端点术语对齐（仅当你打算与 Ranni 合并基线时）

`abort`（本仓库）vs `stop`（Ranni）命名不一致。本仓库内部是一致的（前端调 `/abort`，后端有 `/abort`），**单独看不是 bug**。只有当你计划与 Ranni 合并 / 对齐 API 文档时，才需要统一二者（建议保留 `abort`，与 `RunRegistry.abort()` 方法名一致）。否则可忽略此项。

---

## 不要做的事（避免回退）

- **不要**把 v2 事件命名（`activity.appended` / `lifecycle` / `text.delta` / `tool.started/completed` 等）改回 Ranni 的 v1 命名（`feed.*` / `stream.done`）。本仓库的三层命名更贴合设计文档。
- **不要**把 session 级 SSE 改回 per-run 短连接。session 级长连接 + Last-Event-ID 是正确的目标形态。
- **不要**把 `EventBus` 的 durable/live 区分退化掉。这是核心机制。
- **不要**删除前端 `applyTraceEvent` 的 debug 视图能力（P0-1 只移除主状态推导，保留 debug 视图消费 Layer2）。

---

## 验证清单（每项改完后跑）

```bash
npm run typecheck
npm run build
npm run lint
```

涉及 agent 行为改动（P0-1、P2-1）时，若有 model + Tavily key，建议额外跑一次定向评测：
```bash
npm run research:eval -- --case <某 case> --judge
```
确认事件流（尤其 research context、thinking）在新链路上仍能正确采集与展示。

---

## 优先级总结

| 优先级 | 项 | 一句话 |
|---|---|---|
| P0 | P0-1 | 前端 research/thinking 主状态从 Layer2 推导改为 Layer3 notification 驱动，补后端投影 |
| P1 | P1-1 | 同步 v1 架构文档 / README / UI-NAMING |
| P1 | P1-2 | 修复 node_modules 未 ignore |
| P1 | P1-3 | 合入 SSE 多 JSON 解析修复 |
| P2 | P2-1 | runAgentTurn 解耦 RunRegistry（改回调） |
| P2 | P2-2 | 与 Ranni 合并时统一 abort/stop 命名 |

完成 P0 + P1 即可得到「核心架构彻底 + 周边齐全」的版本。P2 视精力安排。
