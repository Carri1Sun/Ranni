---
author: claude
version: v2
date: 2026-07-06
subject: Ranni Skill 动态加载机制开发计划
audience: 执行该能力的 coding agent
baseline: commit a7cd763（v2 事件驱动架构落地后）
scope: 仅 skill 动态加载机制本身 + 最小验证 skill，不含 slides 等具体 skill 的完整内容
---

# Ranni Skill 动态加载机制开发计划

## 0. 摘要

为 Ranni 引入一套 **Skill 动态加载机制**，把给模型的知识分成两层：第一层常驻（基础做事风格、状态管理、常驻工具、所有 skill 的轻量索引），第二层按需加载（特定 skill 的正文指令、专属工具、辅助脚本、模板资源）。设计目标是在不撑爆常驻 system prompt 的前提下，支撑 slides 生成、图片生成等重型领域知识按需进入上下文。

机制本身是地基，先用一个最小占位 skill 跑通通路，再逐步填入真实 skill 内容（slides 是首个真实 skill，其方法论见 `document-generation-research.md`）。

## 1. 背景与目标

### 1.1 为什么做

- 后续要加的领域知识（如 slides 生成的 deck 编译流水线、contract/slot/质量门方法论）体量很大，全量塞进常驻 system prompt 会吃掉大量 token，且对不需要该能力的任务形成噪声。
- 不同的领域知识应能独立打包、独立演进、按需进入。
- 用户希望能通过 UI 显式选择能力（如"slides 生成"按钮），让对应知识必然进入上下文。

### 1.2 目标

- 建立标准化的 Skill 包结构与注册表。
- 实现两层加载：常驻索引 + 按需正文。
- 支持两种触发：① agent 自主路由（读 description 判断后 load）；② 用户显式选择（UI 按钮 → 强制加载）。
- 工具列表随 skill 动态化：常驻工具始终可用，skill 专属工具随 skill 加载而注册。
- 用一个最小占位 skill 端到端验证通路。

### 1.3 非目标（本计划不做）

- 不写 slides / 图片生成等真实 skill 的完整正文与脚本（机制验证后再填）。
- 不做 skill 的"权重 boost"软提权机制（用户显式选择直接走强制加载，行为可预测；软权重博弈收益低）。
- 不做 skill 的远程拉取 / 在线安装 / 热更新（先支持本地 `skills/` 目录）。
- 不改 v2 事件驱动架构本身（skill 加载只改 system prompt 组装与工具列表生成）。

## 2. 设计概览

### 2.1 两层知识模型

| 层 | 内容 | 加载时机 | 位置 |
|---|---|---|---|
| 第一层（常驻） | base 做事风格、plan / 状态管理规范、常驻工具说明、**所有 skill 的 `{name, description}` 索引** | 每个 run 必加载 | system prompt |
| 第二层（动态） | skill 正文（SKILL.md body）、专属工具、references 深度文档、scripts / templates | 触发才加载 | 正文进 system prompt；脚本/资源随工具执行时引用 |

核心：**skill 的 `description` 属于第一层**（让模型知道"有这个能力 + 何时该用"），正文才属于第二层。这是 Claude Code skills / Codex skills 的通用范式。

### 2.2 Skill 包结构

放在仓库根 `skills/` 下，每个 skill 一个目录：

```
skills/
  <skill-name>/
    SKILL.md          # frontmatter: name + description（进第一层索引）+ body（第二层正文）
    tools.ts          # （可选）该 skill 的专属工具定义，导出 AgentToolDefinition[]
    scripts/          # （可选）辅助脚本（渲染/校验等），工具执行时调用
    references/       # （可选）深度文档，正文提到时 agent 再 read_file
    templates/        # （可选）模板/静态资源
```

SKILL.md frontmatter 约定（与 Claude Code skills 对齐）：

```markdown
---
name: slides
description: Use when the user wants to create or edit PowerPoint decks (.pptx). Covers deck planning, editable pptx generation, layout helpers, and render validation.
---

（正文：keep editable 原则、deck 编译流水线、布局规范等，按需加载）
```

### 2.3 三种触发与统一模型

用 **`loadedSkills: Set<string>`**（run 内部状态）统一两种触发：

- **用户显式选择（force）**：UI 选中的 skill 写入 session 的 `activeSkills`，run 开始时 `loadedSkills` 初始化为 `activeSkills`，这些 skill 的正文直接进 system prompt、专属工具直接注册。
- **agent 自主路由（auto）**：agent 读第一层的 description 索引，判断需要某个 skill 时，调用 `load_skill` 工具。该工具有副作用：把目标 skill 加入 `loadedSkills`（后续步骤其正文进入 prompt、专属工具进入工具列表）。
- 每一步 LLM 调用的工具集 = 常驻工具 ∪ `loadedSkills` 各 skill 的专属工具。
- 每一步的 system prompt = base + 全部 skill 的 description 索引 + `loadedSkills` 各 skill 的正文。

> 设计要点：`load_skill` 不是单纯读文件，而是"激活"一个 skill（读正文 + 注册工具）。这样自动路由也能用到专属工具，闭环完整。`load_skill` 本身是常驻工具。

## 3. 现状与落点

| 关注点 | 现状 | 文件:行 |
|---|---|---|
| system prompt 组装 | 一个函数拼数组 `.join("\n")`，`Runtime context` 段在 382-394，387 行拼 `Available tools` | `lib/agent.ts`（buildSystemPrompt，约 320-394） |
| 工具定义导出 | 全量 `[...toolRegistry.values()].map(e => e.tool)` | `lib/tools.ts:1930` |
| 工具注册表 | `toolRegistry = new Map<string, ToolDefinition>` | `lib/tools.ts:1173` |
| 工具执行 | `executeTool(name, rawArgs, context)` 从 `toolRegistry.get(name)` 取 | `lib/tools.ts:1938` |
| 工具列表传给 LLM | `runAgentTurn` 开头 `getToolDefinitions()` 一次性全量，循环中复用 | `lib/agent.ts:1514`，调用处在 1743 / 1759 / 1825 |
| session 配置透传链路 | `ToolSettings`：定义 → RunContext 字段 → runAgentTurn 入参 → /api/runs → 前端 | `lib/tools.ts:35`、`lib/agent.ts:75`、`lib/agent.ts:1511`、`src/server/app.ts:787`、`components/agent-console.tsx:5352` |
| 工具执行 context 类型 | `ToolExecutionContext`（含 workspaceRoot、toolSettings、taskState 等） | `lib/tools.ts:41-49` |

`ToolSettings` 已贯通"前端 → /api/runs → runAgentTurn → context"全链路，**`activeSkills` 直接挂在 `ToolSettings` 上即可复用这条链路**，零新增透传成本。

## 4. 实现任务分解

按顺序执行，每个 Task 可独立提交。

### Task 1：Skill 包结构 + SkillRegistry

**新增 `lib/skills/registry.ts`**：

- 定义类型：
  ```ts
  export type SkillManifest = {
    name: string;
    description: string;        // 进第一层索引
    body: string;               // SKILL.md 正文（第二层）
    dir: string;                // skill 包绝对路径
    tools?: ToolDefinition[];   // 从该包的 tools.ts 加载（可选）
  };
  ```
- 启动时扫描 `skills/*/SKILL.md`，解析 frontmatter（用现有依赖，不引新库；可最小手写解析或用 `gray-matter`——优先手写，避免新依赖）。
- 导出：
  - `listSkillIndices(): { name, description }[]` —— 给第一层索引用
  - `getSkillBody(name): string` —— 给第二层正文用
  - `getSkillTools(name): ToolDefinition[]` —— 给专属工具注册用
  - `hasSkill(name): boolean`
- skill 包的 `tools.ts` 约定：`export const tools: ToolDefinition[] = [...]`，registry 用动态 `import()` 加载。
- 无 skill 目录时优雅降级（返回空数组），保证不破坏现有行为。

### Task 2：工具动态化

**改 `lib/tools.ts`**：

- `toolRegistry` 保持现状（常驻工具）。
- `getToolDefinitions()` 改签名：
  ```ts
  export function getToolDefinitions(activeSkillNames: string[] = []) {
    const base = [...toolRegistry.values()].map((e) => e.tool);
    const skillTools = activeSkillNames
      .flatMap((name) => getSkillTools(name))
      .map((e) => e.tool);
    // 去重（按 tool.name）
    return dedupByName([...base, ...skillTools]);
  }
  ```
- `executeTool` 改为先查 `toolRegistry`，未命中再查 active skill 的 tools（需要把 activeSkillNames 透传进 context，或在 executeTool 增加 skill 工具查找）。建议：把 `activeSkillNames` 加入 `ToolExecutionContext`，`executeTool` 内合并查找。
- `ToolSettings` 增加 `activeSkills?: string[]`。
- 新增常驻工具 `load_skill`（注册进 `toolRegistry`）：
  - schema：`{ name: string }`
  - execute：校验 `hasSkill(name)`，返回"已激活 + 正文摘要"，副作用通过 context 回写（见 Task 3 的 loadedSkills 状态）。

### Task 3：system prompt 两层拼装 + loadedSkills 状态

**改 `lib/agent.ts`**：

- `runAgentTurn` 内维护 `const loadedSkills = new Set<string>(context.toolSettings?.activeSkills ?? [])`。
- 改 system prompt 组装函数：
  - 新增"可用技能"段：列出 `listSkillIndices()`，每条 `name — description`，并提示"需要时调用 load_skill 激活，或已由用户激活的会直接可用"。
  - 新增"已激活技能正文"段：对 `loadedSkills` 中的每个 skill，拼入 `getSkillBody(name)`。
  - `Available tools` 段（387 行）改用动态 `getToolDefinitions([...loadedSkills])` 的名字列表。
- 工具列表（1514 行）改为每步重新生成：`const tools = getToolDefinitions([...loadedSkills])`，在 tool_use 循环每轮 createMessage 前刷新（1743 / 1759 / 1825 处）。
- `load_skill` 工具执行成功后，把 `name` 加入 `loadedSkills`（该工具的 execute 通过闭包或 context 回调写入；推荐让 load_skill 的 execute 接收一个 `onActivate` 回调，由 agent.ts 注入）。
- `toTraceToolDefinitions()`（484 行）同步改为按 active skills 过滤，保证 trace 准确。

### Task 4：配置透传（activeSkills）

- `ToolSettings`（`lib/tools.ts:35`）加 `activeSkills?: string[]`。
- `/api/runs`（`src/server/app.ts:738-787`）从 request body 读 `activeSkills`，透传进 `runAgentTurn` 的 `toolSettings`。
- 前端 `components/agent-console.tsx:5352` 的 `/api/runs` fetch body 带上当前 session 选中的 `activeSkills`。

### Task 5：前端能力开关 UI

- 在 session/设置区（参考现有 toolSettings 相关的设置入口）新增"能力"开关组：列出 `listSkillIndices()` 返回的 skill（需新增一个轻量 `/api/skills` GET 接口返回索引；或复用 `/api/runtime`）。
- 选中态写入 session 本地状态，启动 run 时随 body 传 `activeSkills`。
- 开关文案用中文（如"幻灯片生成""图片生成"），对应 skill 的 `name` 作为值。
- UI 状态遵循 UI-NAMING.md；若新增可见模块，同步更新 UI-NAMING.md。

### Task 6：最小验证 skill

新增 `skills/demo/SKILL.md`（仅用于端到端验证通路）：

```markdown
---
name: demo
description: Use when the user asks for a demo of the skill loading mechanism. Returns a fixed confirmation.
---

激活 demo 技能后，面对"演示技能加载"类请求，回答时附上标记 `[demo-skill-active]`，并说明这是从动态加载的第二层知识读到的。
```

可选加 `skills/demo/tools.ts` 导出一个 `demo_echo` 占位工具，验证专属工具随激活注册。

## 5. 关键接口骨架

```ts
// lib/skills/registry.ts
export type SkillIndex = { name: string; description: string };
export type SkillManifest = SkillIndex & { body: string; dir: string; tools?: ToolDefinition[] };

export function listSkillIndices(): SkillIndex[];
export function getSkillBody(name: string): string;
export function getSkillTools(name: string): ToolDefinition[];
export function hasSkill(name: string): boolean;
```

```ts
// lib/tools.ts（改动点）
export type ToolSettings = {
  tavilyApiKey?: string;
  computerUseApiKey?: string;
  // ... 现有字段
  activeSkills?: string[];          // 新增
};

export function getToolDefinitions(activeSkillNames: string[] = []): AgentToolDefinition[];
```

```ts
// lib/agent.ts（runAgentTurn 内）
const loadedSkills = new Set<string>(context.toolSettings?.activeSkills ?? []);
// 每轮循环：
const tools = getToolDefinitions([...loadedSkills]);
const system = buildSystemPrompt({ ..., loadedSkills: [...loadedSkills] });
// load_skill 工具激活后：loadedSkills.add(name)
```

## 6. 验证方式

完成后端到端验证（每条都要过）：

1. **`npm run typecheck && npm run lint && npm run build`** 全绿。
2. **空 skill 目录回归**：`skills/` 不存在或为空时，agent 行为与现状完全一致（常驻工具、system prompt 不含技能段或段为空）。
3. **强制加载通路**：UI 开启 `demo` 能力 → 启动 run → 检查 trace 里 system prompt 含 demo 正文、工具列表含其专属工具（若有）；问"演示技能加载"，回答带 `[demo-skill-active]`。
4. **自动路由通路**：UI 不选任何能力 → 问"演示技能加载" → agent 自主调用 `load_skill({name:"demo"})` → 后续步骤 system prompt 含 demo 正文、回答带标记。
5. **token 隔离**：未激活任何 skill 时，system prompt 不含任何 skill 正文（只含轻量索引段），对比激活前后 `systemPromptChars`（trace 已有该字段，见 `lib/agent.ts:536`）应有明显差值。
6. **路径安全**：skill 的 scripts / templates 引用不得逃逸 workspace（复用 `resolveWorkspacePath` 校验，若 skill 资源在仓库内则走只读绝对路径，禁止写入仓库目录）。

## 7. 范围边界与约定

- skill 正文进 system prompt 会吃 token：正文要精炼，深度内容放 `references/` 让 agent 按需 `read_file`，不要全塞进 SKILL.md body。
- `description` 是自动路由准确性的关键，要写清"何时用"（Use when ...），参考 Claude Code skills 写法。
- 一个 run 内 `loadedSkills` 单调递增（激活后不卸载），避免工具/知识在中途消失导致 agent 行为不一致。
- skill 的专属工具与常驻工具同名时，常驻优先（`dedupByName` 保留 base）。
- skill 包内脚本执行复用 `run_terminal` 的安全约束；skill 资源文件以只读方式引用。

## 8. 风险与注意点

- **frontmatter 解析**：优先手写最小解析（split `---`），避免引入 `gray-matter` 依赖；若 SKILL.md 格式简单（只 name + description），手写足够。
- **动态 import skill tools**：`tools.ts` 用动态 `import()`，注意打包（vite/tsx watch）能否正确解析 `skills/*/tools.ts` 路径；若打包有困难，可退化为"skill 工具在 registry 启动时静态扫描注册"。
- **trace 一致性**：`toTraceToolDefinitions` 与实际传给 LLM 的工具列表必须同步按 active skills 过滤，否则 trace 误导调试。
- **行号偏移**：本计划引用的行号为 baseline 快照，实现以当前工作区为准。

## 9. 后续（机制就绪后）

- 填入首个真实 skill：`skills/slides/`（SKILL.md 正文描述受限 slide HTML 创作方法，专属工具覆盖 HTML workspace 初始化、准备、导出和验证，scripts 放端到端 spike runner）。
- 第二个 skill：图片生成（可对接 gpt-image 或 manual-web 两条 backend）。
- 视 skill 数量增长，再考虑 skill 的远程分发与版本化（当前不做）。

## 10. 当前实现状态

- 已新增 `lib/skills/registry.ts`，负责扫描 `skills/*/SKILL.md`、解析 `{name, description}` 索引、读取正文，并加载可选 `tools.ts`。
- 已在 `lib/tools.ts` 增加常驻 `load_skill` 工具，`getToolDefinitions(activeSkillNames)` 和 `executeTool` 会合并已激活 skill 的专属工具。
- 已在 `lib/agent.ts` 增加 run 内 `loadedSkills` 状态，每个 step 会按当前技能集合重新组装 system prompt、工具列表和 trace 工具快照。
- 已新增 `GET /api/skills`，前端设置弹窗新增“能力”页，选中能力会随 `toolSettings.activeSkills` 传入 `/api/runs`。
- 前端已为 `load_skill` 增加专门的过程项展示：工具名显示为“激活技能”，图标使用 spark，详情展示技能中文名与原始 skill name。
- “能力”设置页会展示本地 skill 索引、强制加载开关、加载失败/空列表状态，并根据当前会话 trace 中的 `load_skill` 工具调用展示能力运行状态。
- 已新增 `skills/demo/` 验证包，包含 `SKILL.md` 与 `demo_echo` 专属工具。
- 已验证：`npm run typecheck`、`npm run lint`、`npm run build`、编译产物 registry 加载 demo skill 与 `demo_echo`。

### 10.1 前端展示约定

- `getToolDisplayName("load_skill")` 固定显示为“激活技能”，避免消息流直接暴露底层工具名。
- `createToolCallDisplay("load_skill", args)` 使用 `args.name` 生成过程项详情；已知技能名可通过 `getSkillDisplayLabel` 映射到中文能力名，未知技能保留为“能力 <name>”。
- 能力设置页中的开关表示“下一次 run 启动时强制加载”，写入浏览器本地设置 `activeSkills`，随后通过 `/api/runs` 的 `toolSettings.activeSkills` 传给后端。
- 能力设置页中的运行状态来自两类信号：用户已选中的 `activeSkills`，以及当前会话 trace 中已经出现的 `load_skill` 工具调用。
- `loadedSkills` 的真实生效边界仍是单个 agent run。前端展示如需表达“当前运行中”，应优先绑定当前 active run 的 trace，避免把历史 run 的技能激活误读为当前运行状态。
