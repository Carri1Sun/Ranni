---
author: claude
version: v2
date: 2026-07-06
subject: Ranni slides skill 实现方案（native editable PPT）
audience: 执行该能力的 coding agent
baseline: commit a7cd763
prerequisites: skill 动态加载机制已落地（见 skill-dynamic-loading-plan.md）
related: document-generation-research.md（业界调研与选型）、skill-dynamic-loading-plan.md（skill 机制）
---

# Ranni slides skill 实现方案（native editable PPT）

> **状态（2026-07-07 更新）**：本文描述的 native PptxGenJS 路线（`init_deck_workspace` / `generate_pptx`）**已下线**，slides skill 现仅保留 HTML-to-PPTX 路线。下文 native 相关内容保留为历史设计参考，现状以 `html-to-pptx-spike-report.md` 为准。

## 0. 摘要

为 Ranni 实现首个真实 skill——`slides`：让 agent 产出**可编辑的 native `.pptx`**，并附带 deck 编译流水线、生成后自检、deck 产物与证据包。技术主干用 PptxGenJS（纯 JS，与 Codex 官方 slides skill 同款）；方法论骨架借鉴社区 `ppt-polished-deck-collab` 的 deck 编译系统（contract / slide_contract / asset_slot / 三阶段质量门），用 JS 重新实现并做轻量化裁剪；生成后自检靠脚本检测 pptx 的 overflow/overlap/font，加人工看预览图兜底。

本方案是 `skill-dynamic-loading-plan.md` 的后续，假定 skill 机制（SkillRegistry、动态工具、两层 prompt、`load_skill`）已就绪。slides 作为 `skills/slides/` 目录下的一个 skill 包实现。

## 1. 背景与选型结论

### 1.1 为什么 native editable

业界两个权威实现（OpenAI Codex 官方 slides skill、社区 ppt-polished-deck-collab）都不约而同走 native editable，没有任何一个走 HTML→图片型 pptx。企业/工作场景里 ppt 几乎都要交付后改，可编辑是被实战验证的硬需求。因此 Ranni 的 PPT 主路线定为 native editable（PptxGenJS），不走上一版调研 doc 里一度考虑的 HTML→图片型路线。

### 1.2 选型结论（详见 document-generation-research.md）

| 维度 | 选择 | 理由 |
|---|---|---|
| 生成库 | PptxGenJS（JS） | 纯 JS，与 Ranni 的 Node/TS 栈对路；Codex 官方同款；python-pptx 因无 Python 运行时排除 |
| 方法论骨架 | 借社区版 deck 编译流水线，JS 化轻量化 | 社区版的 contract/slot/质量门是拉开质量差距的关键，但不抄 python 实现 |
| 视觉自检 | render PNG + overflow/overlap/font 脚本检测 + 人工看预览图 | 不依赖屏幕操作；脚本查结构层问题，人工看 contact sheet 兜底 |
| 预览旁路 | Marp（可选，P2） | 写 Markdown 秒预览，作为非正式场景旁路，不做主干 |
| SaaS | 不接入 | local-first 定位 |

### 1.3 与 PDF 导出的关系

PDF 导出（Puppeteer，HTML→PDF）语义上属于"文档生成"而非"幻灯片生成"，建议作为独立的 `documents` skill 或常驻 `export_document` 工具实现，不在本 skill 范围。本方案仅在 deck 产物中保留"PPT 导出 PDF"的能力位（P2）。

## 2. 前置条件

skill 动态加载机制（`skill-dynamic-loading-plan.md` 的 Task 1–6）已落地，具备：

- `skills/<name>/` 包结构被 SkillRegistry 扫描；`SKILL.md` 的 `name + description` 进第一层索引，body 进第二层。
- `skills/<name>/tools.ts` 导出的 `ToolDefinition[]` 随 skill 激活而注册。
- `load_skill` 工具可用；`activeSkills` 可经 `ToolSettings` 透传。
- 工具 execute 复用 `ToolExecutionContext`（含 `workspaceRoot`、`toolSettings`）。

## 3. Skill 包结构

```
skills/slides/
  SKILL.md                  # description（第一层索引）+ 方法论正文（第二层）
  tools.ts                  # 导出本 skill 专属工具：generate_pptx / init_deck_workspace / ...
  scripts/
    layout-helpers.mjs      # 间距/字号/图片放置的共享计算（agent 不直接写坐标）
    render-preview.mjs      # pptx → 逐页 PNG（P1，调 LibreOffice/PowerPoint）
    check-layout.mjs        # 解析 pptx 检测 overflow/overlap/font（P1）
    build-montage.mjs       # 拼contact sheet（P1）
  references/
    deck-contract.md        # deck_contract 字段说明（正文提到时 agent 再读）
    asset-slots.md          # asset_slot 路由决策表
    quality-gates.md        # 三阶段质量门细则
    layout-recipes.md       # archetype → layout_recipe 配方库
  templates/
    default.theme.json      # theme_tokens（字号/配色/间距）
    default.pptx            # 可选：继承用的空白模板（P2 模板审计）
```

## 4. 核心概念（JS 化轻量化）

从社区版借鉴四个主概念，裁剪掉对 Ranni P0/P1 非必要的重型字段（如完整的 profile 组合坐标、domain_profile 等），保留可执行骨架：

### 4.1 deck_contract（deck 级全局合同）

记录整套 deck 的约束，写在 deck 产物目录的 `brief.md` frontmatter。P1 字段：

- `audience`（目标读者）、`delivery`（自读 / 配合讲 / 讲完转发）、`editability`（默认 `editable`）
- `aspect`（默认 `16:9`）、`theme`（指向 templates 下的 theme_tokens）
- `typography_policy`（标题类 1.0 倍行距、正文类 1.5 倍行距；中文宋体 + 英文 Times New Roman 作为无模板回退）
- `validation`（要跑哪些质量门）

### 4.2 slide_contract（每页语法）

每页至少：`reader_question` / `page_task` / `archetype` / `asset_mode` / `key_message`。复杂页补 `layout_recipe` / `asset_slots`。

P0 简化：`generate_pptx` 工具直接接收结构化 JSON（title / bullets / image / notes / 可选 chart），工具内部按 archetype 默认 layout_recipe 布局，agent 无需手写 slide_contract 全字段。P1 再支持从 `slide_specs.yaml` 读完整 contract。

### 4.3 asset_slot（资产统一接口）

所有图表 / 图 / 表格 / diagram / icon 先登记为 slot，再由对应模块生产。路由决策（P1+）：

| 资产类型 | slot 模式 | 说明 |
|---|---|---|
| 准确数据、会改数 | `chart-native` | PptxGenJS native chart，保可编辑 |
| 结构化对比 | `table-native` | native table |
| 复杂研究图/热力图 | `figure-image` | 外部生成图片后放置（P2） |
| 流程/架构图 | `diagram-connector` | native shape + connector（P2） |
| 氛围/hero 图 | `image-generation` | 接 gpt-image 或 manual-web（P2） |

### 4.4 三阶段质量门（P1）

`package_preflight`（包结构/安全）→ `structure_precheck`（文本框 fit / 对象 overlap / 排版边界）→ `render_review`（渲染后视觉边界触墨）。`not_checked` 必须显式写入报告，不能当通过。

## 5. 专属工具设计

工具定义在 `skills/slides/tools.ts`，按 skill 机制随激活注册。复用 `resolveWorkspacePath` / `toWorkspaceRelative` / `ToolExecutionContext`。

### 5.1 P0 工具

#### `generate_pptx`

```ts
schema: z.object({
  outputPath: z.string(),                       // 输出 .pptx 路径
  slides: z.array(z.object({
    layout: z.enum(["title","title-bullets","title-content","section","two-col","blank"])
             .default("title-bullets"),
    title: z.string(),
    bullets: z.array(z.union([z.string(), z.object({ text: z.string(), level: z.number().default(0) })])).optional(),
    image: z.object({ path: z.string(), placement: z.enum(["fit","fill"]).default("fit") }).optional(),
    chart: z.object({ type: z.enum(["bar","line","pie"]), data: z.unknown(), title: z.string().optional() }).optional(),
    notes: z.string().optional(),               // 讲者备注，进 notes pane
  })).min(1),
  theme: z.string().default("default"),          // 对应 templates/*.theme.json
  aspect: z.enum(["16:9","4:3"]).default("16:9"),
})
```

execute 要点：
- 读 `templates/<theme>.theme.json` 拿 theme_tokens；调 `layout-helpers.mjs` 按 `layout` 计算每页坐标（agent 给语义，工具算坐标）。
- **keep editable**：title/bullets 走 `addText`，chart 走 `addChart`（native），image 走 `addImage`。绝不整页栅格化。
- `pptxgenjs.writeFile({ path })` 落盘到 `resolveWorkspacePath(outputPath)`。
- 返回产物路径 + 页数。

#### `init_deck_workspace`

```ts
schema: z.object({
  dir: z.string(),                               // deck 产物目录
  title: z.string(),
  audience: z.string().optional(),
  delivery: z.enum(["self-read","speaker-led","forward"]).default("self-read"),
})
```

execute：创建 `brief.md`（含 deck_contract frontmatter）、`deck_narrative.md`、`slide_specs.yaml`、`assets/`、`final/`、`validation/`、`preview/` 目录结构。仿 `save_research_checkpoint`（`lib/research.ts:479`）的落盘范式。

### 5.2 P1 工具

- `render_pptx_preview`：`{ pptx, outDir }` → 逐页 PNG（探测系统 LibreOffice/PowerPoint，调 `render-preview.mjs`）。
- `check_pptx_layout`：`{ pptx }` → 解析 pptx XML，检测文本溢出 / 对象重叠 / 字体替换，输出报告写 `validation/structure_precheck/`。
- `derive_slide_specs`：`{ narrative }` → 从 `deck_narrative.md` 派生 `slide_specs.yaml`。

### 5.3 P2 工具

- `audit_pptx_template`：审计用户提供的模板（master/layout/真实字号），支持 `template_locked` 继承。
- `add_diagram`：native shape + connector 的流程/架构图。
- `generate_slide_image`：接 image generation backend（gpt-image-api / manual-web）。

## 6. SKILL.md 正文要点

description（进第一层索引）：

```
Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Produces editable native pptx with deck planning, layout helpers, and render validation.
```

body（第二层，按需加载）覆盖：

1. **keep editable 原则**：文字保文字、简单图表（bar/line/pie/histogram）保 native chart、只有太自定义的视觉才用 SVG/图片单独放置（用 native 线条连接），不整页栅格化。
2. **deck 编译流水线**：先 `init_deck_workspace` → 写 `brief.md` / `deck_narrative.md` → 派生 `slide_specs.yaml` → `generate_pptx` → 质量门 → 预览 → 交付。禁止"边画边想"。
3. **每页独立决策**：逐页判断保留 / 改 headline / 清理 asset，不一刀切批量。
4. **layout helpers 复用**：调 `generate_pptx` 给语义化 layout，不自己算坐标。
5. **生成后自检**：`generate_pptx` 后必跑 `check_pptx_layout`（P1），密集页或紧边距必跑。
6. **asset_slot 路由**：见 `references/asset-slots.md`，按"是否要改数 / 是否复杂"选 native chart / table / figure-image / diagram / image-generation。
7. **checkpoint**：正式 deck 在 narrative 锁定后给人类一次 planning checkpoint；初稿（pptx + 预览 + validation）齐全后给一次修订 checkpoint。

正文要精炼（控 token），深度内容放 `references/`，正文提到时 agent 再 `read_file`。

## 7. 辅助脚本与模板

- `scripts/layout-helpers.mjs`：导出 `resolveLayout(layout, theme, aspect)` → 返回每页各元素的 `{x,y,w,h}`（英寸）。`generate_pptx` 内部调用。
- `scripts/render-preview.mjs`：探测渲染后端优先级 LibreOffice (`soffice --headless --convert-to png`) > PowerPoint（AppleScript，darwin）> 兜底报错。逐页导出 PNG。
- `scripts/check-layout.mjs`：用 `jszip`（已在依赖）解析 pptx，读 slide XML 的 shape 坐标与文本框，几何计算 overlap + 文本估算溢出。报告 JSON + markdown。
- `templates/default.theme.json`：`{ titleSize, bodySize, colors, margins, gap }`，作为无模板回退基线。

## 8. deck 产物结构

每次 deck 生成都会维护一个可审查、可迭代的产物目录：

```
<deck-artifact-dir>/
  brief.md                 # deck_contract
  deck_narrative.md        # 顶层叙事
  slide_specs.yaml         # 派生的逐页合同
  assets/                  # 图片 / figure 资产
  final/
    <deck>.pptx            # 可编辑 native pptx
  preview/                 # 逐页 PNG + contact_sheet.png（P1）
  validation/
    package_preflight/     # （P1）
    structure_precheck/    # （P1）
    render_review/         # （P1）
```

工具执行仍通过 `resolveWorkspacePath` 受基础 workspace 边界约束；skill 正文只描述 deck 创作方法和产物组织，不规定执行目录或 session 目录。

## 9. 分阶段任务

### P0 — 可编辑 pptx 主干跑通

- [x] `skills/slides/SKILL.md`（description + keep editable + 简化流水线正文）
- [x] `skills/slides/tools.ts`：`generate_pptx` + `init_deck_workspace`
- [x] P0 内联基础 layout 坐标计算（P1 再拆 `scripts/layout-helpers.mjs`）
- [x] `skills/slides/templates/default.theme.json`
- [x] 新增依赖：`pptxgenjs`
- [x] 交付物：agent 能从结构化输入产出可在 PowerPoint/Keynote 编辑的 `.pptx`

### P1 — deck 编译流水线 + 结构自检

- [ ] `derive_slide_specs` 工具 + `references/deck-contract.md` / `asset-slots.md` / `layout-recipes.md`
- [ ] `render_pptx_preview` + `check_pptx_layout` 工具 + `scripts/render-preview.mjs` / `check-layout.mjs` / `build-montage.mjs`
- [ ] 三阶段质量门落 `validation/`
- [ ] 渲染后端探测（LibreOffice/PowerPoint）
- [ ] SKILL.md 正文补全完整方法论
- [ ] 交付物：deck 产物目录（含 specs / preview / validation 证据包）

### P2 — 复杂资产 + 预览旁路

- [ ] native chart 完善、`add_diagram`（connector）、`generate_slide_image`（image generation backend）
- [ ] `audit_pptx_template`（模板审计与继承）
- [ ] Marp 预览旁路：前端用 `@marp-team/marp-core` 把 markdown 渲染成幻灯片预览（可选）
- [ ] PPT 导出 PDF 能力位

## 10. 依赖

| 依赖 | 用途 | 阶段 | 备注 |
|---|---|---|---|
| `pptxgenjs` | native pptx 生成 | P0 | 纯 JS，核心 |
| `jszip` | 解析 pptx XML 做布局检测 | P1 | 检查是否已被间接引入；pptxgenjs 自带依赖可复用 |
| LibreOffice / PowerShell—PowerPoint | pptx→PNG 渲染 | P1 | 系统级，探测已装，不打包；无则该质量门标 `not_checked` |
| `puppeteer` / `puppeteer-core` | PPT 导出 PDF / Marp 渲染 | P2 | 与 documents skill 共享 |
| `@marp-team/marp-core` | markdown 幻灯片预览旁路 | P2 | 可选 |

P0 只新增 `pptxgenjs`，依赖增量最小。

## 11. 验证方式

前置：skill 机制验证已过（见 skill-dynamic-loading-plan.md 第 6 节）。

1. **typecheck / lint / build** 全绿。
2. **P0 端到端**：激活 slides skill → agent 调 `init_deck_workspace` + `generate_pptx` → 产出 `.pptx` → 用 PowerPoint/Keynote 打开，确认文字可编辑、布局正常、chart 是 native。
3. **keep editable 校验**：生成的 pptx 解压后，slide XML 里 title/bullets 是 `<a:t>` 文本节点而非图片；chart 是 native chart XML。
4. **P1 自检**：故意构造溢出文本，`check_pptx_layout` 能检出并在报告标 warning/error。
5. **token 隔离**：未激活 slides 时 system prompt 不含其正文；激活前后 `systemPromptChars` 有差值。
6. **deck 产物**：`generate_pptx` 后 `final/` 有 pptx、（P1）`preview/` 有逐页 PNG、`validation/` 有报告。
7. **回归**：skill 未激活时 agent 行为与现状一致。

## 12. 风险与边界

- **pptx→PNG 渲染依赖系统软件**：LibreOffice/PowerPoint 不一定存在。P1 必须做后端探测，缺失时 `render_review` / `render_pptx_preview` 显式标 `not_checked`，不静默降级。
- **layout 质量**：PptxGenJS 坐标布局的美观度上限低于 HTML/CSS。靠 layout-recipes 配方库 + theme_tokens + 模板（P2）逐步补齐；不强求 P0 达到设计软件水准。
- **token 成本**：完整 deck_contract / slide_contract 方法论重，正文要精炼，深度内容进 `references/` 按需读（skill 机制已保证分层加载）。
- **不动 lib/tools.ts 的常驻工具**：slides 工具全部在 `skills/slides/tools.ts`，靠 skill 机制注册；`lib/tools.ts` 只在 P0 前已按 skill 机制改造完毕。
- **行号偏移**：引用的现有代码位置（如 `lib/research.ts:479`）为 baseline 快照，以当前工作区为准。

## 13. 参考

- [Generate slide decks | Codex use cases – OpenAI Developers](https://developers.openai.com/codex/use-cases/generate-slide-decks)
- [Sven-LI-sankyuu/presentation-skills – GitHub](https://github.com/Sven-LI-sankyuu/presentation-skills)（ppt-polished-deck-collab 方法论来源）
- [pptxgenjs – NPM](https://www.npmjs.com/package/pptxgenjs)
- 本仓库 `document-generation-research.md`（业界调研与选型推理）
- 本仓库 `skill-dynamic-loading-plan.md`（skill 动态加载机制）

## 14. 当前实现状态

- 已新增 `skills/slides/` skill 包，`SKILL.md` 进入动态 skill 索引，激活后正文注入 system prompt。
- 已新增 `init_deck_workspace` 和 `generate_pptx` 两个 skill 专属工具，随 `slides` 激活后进入工具列表。
- `generate_pptx` 使用 PptxGenJS 生成 native editable `.pptx`，支持 `title`、`title-bullets`、`title-content`、`two-col`、`section`、`blank` 基础 layout，支持文本、图片和 `bar` / `line` / `pie` native chart。
- 前端输入框新增“幻灯片”开关，只影响下一次发送，会把 `slides` 合并进本次 `/api/runs` 的 `toolSettings.activeSkills`。
- 默认建议使用语义化 deck slug 组织产物目录，最终文件放 `final/<deck-slug>.pptx`。
- 已完成 smoke 验证：调用 `init_deck_workspace` + `generate_pptx` 生成 3 页 PPTX；解压 `slide1.xml` 可见 `<a:t>` 文本节点；native chart smoke 可生成。
- 已新增 HTML-to-PPTX spike 路线，与 native 路线并存、互不干扰：四步工具 `init_slide_html_workspace` / `prepare_slide_html_for_pptx` / `export_html_to_pptx` / `validate_html_pptx_export`，底层脚本在 `skills/slides/scripts/html-pptx/`，受限 slide HTML 模板与 8 页示例 deck 在 `skills/slides/templates/slide-html/`。
- HTML 路线用 Playwright 做渲染/测量/`data-pptx-raster` 截图回退，用 dom-to-pptx 做 DOM 到 PPTX 映射；spike 端到端跑通 8 页示例 deck，79 个可编辑元素全部保留为 `<a:t>` 文本，1 个复杂图表走截图回退。新增依赖 `playwright` 与 `dom-to-pptx`。
- HTML 路线的落地细节、验证数据与已知限制见 `html-to-pptx-spike-report.md`，设计依据见 `html-to-pptx-export-guide.md`。
