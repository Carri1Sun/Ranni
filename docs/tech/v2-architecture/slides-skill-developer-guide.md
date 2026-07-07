---
author: claude
version: v2
date: 2026-07-06
subject: Ranni slides skill 开发执行指南（P0，不依赖 computer-use）
audience: 实现 slides skill 的 coding agent
prerequisites: skill 动态加载机制已落地（skill-dynamic-loading-plan.md Task 1–6 完成）
related: slides-skill-plan.md（设计决策）、skill-dynamic-loading-plan.md（skill 机制）、document-generation-research.md（调研）
---

# Ranni slides skill 开发执行指南

> **状态（2026-07-07 更新）**：本文第 1–10 节描述的 native PptxGenJS 路线（`init_deck_workspace` / `generate_pptx`）**已下线**，slides skill 现仅保留 HTML-to-PPTX 路线（见第 11 节）。第 1–10 节保留为历史参考，新代码以第 11 节 + `html-to-pptx-spike-report.md` 为准。

## 0. 本指南定位

这是给 coding agent 的**执行手册**，讲"怎么动手写"，按步骤给可直接用的文件内容与代码骨架。设计决策（为何 native editable、为何 PptxGenJS、分阶段理由、概念定义）见 `slides-skill-plan.md`，本指南不重复。

**两条硬约束贯穿全文：**

1. **前置依赖**：skill 动态加载机制必须先落地——`skills/` 目录被 SkillRegistry 扫描、`skills/<name>/tools.ts` 导出的工具随激活注册、`load_skill` 可用。未就绪则先做 `skill-dynamic-loading-plan.md`。
2. **不依赖 computer-use**：本 skill 全程不调用 `operate_computer` 或任何屏幕操作类工具。视觉复核 = P1 的 `check_pptx_layout`（解析 pptx XML 检测 overflow/overlap/font）+ 人工看 preview/contact sheet。验收时须 `grep` 确认 `skills/slides/` 内无 `operate_computer`。

本指南覆盖 **P0**（可编辑 native pptx 主干跑通）。P1/P2 见第 7 节概要，详见 plan。

## 1. 开工前检查

- `npm run typecheck` 基线绿。
- 确认 `lib/tools.ts` 已 export `ToolDefinition` 与 `ToolExecutionContext` 类型（skill 的 `tools.ts` 需要 import）。若未 export，先补 `export type ToolDefinition = ...` / `export type ToolExecutionContext = ...`。
- 确认 `lib/workspace.ts` export 了 `resolveWorkspacePath` 与 `toWorkspaceRelative`（已确认存在）。
- 确认 `package.json` 暂无 `pptxgenjs`（第 5 步安装）。

## 2. P0 文件清单（按顺序）

```
skills/slides/
  SKILL.md                       # Step 1
  templates/default.theme.json   # Step 2
  tools.ts                       # Step 3（含 generate_pptx + init_deck_workspace，内联布局计算）
```

依赖安装见 Step 4。P0 不拆 `scripts/`，布局计算内联进 `tools.ts`，减少 agent 执行面。

## 3. Step 1 — SKILL.md

直接使用以下内容（中文正文，已去除任何屏幕操作依赖）：

```markdown
---
name: slides
description: Use when the user wants to create or edit PowerPoint decks (.pptx) — research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Produces editable native pptx with deck planning, layout helpers, and post-generation validation.
---

# slides 技能

## 何时使用
用户要做 PPT / 演示稿 / 汇报 deck / 路演稿 / 研究汇报 / 技术方案 deck / 教学或培训材料，且希望输出是可在 PowerPoint/Keynote 编辑的 .pptx。

## keep editable 原则（硬性）
- 文字保持文字（addText），绝不整页栅格化成图片。
- 简单图表（bar/line/pie/histogram）用 native chart（addChart），保持可编辑。
- 只有太自定义、native 对象做不出来的视觉，才用图片单独放置，并用 native 线条连接。
- 整页位图是禁止的例外，不是常规做法。

## deck 编译流水线（禁止边画边想）
1. init_deck_workspace 建立产物目录（brief.md / deck_narrative.md / slide_specs.yaml / final/ / preview/ / validation/）。
2. 先写 brief.md（deck 合同：读者、使用场景、可编辑性、aspect、theme）和 deck_narrative.md（顶层叙事）。
3. 派生 slide_specs.yaml（每页 reader_question / page_task / archetype / key_message）。
4. generate_pptx 按 specs 生成 native pptx，输出到 final/。
5. 生成后自检：跑 check_pptx_layout（P1）检测溢出/重叠/字体替换；人工看 preview 或 contact sheet 兜底。
6. 交付初稿，给人类修订 checkpoint。

## 每页独立决策
逐页判断：保留原稿 / 改 headline / 清理 asset。不一刀切批量。

## 布局
调 generate_pptx 时给语义化 layout（title / title-bullets / title-content / two-col / section / blank）。工具内部用布局规则算坐标，不要自己写坐标。

## 资产路由
- 准确数据、之后要改数 → native chart（addChart）
- 结构化对比 → native table
- 复杂研究图/热力图 → figure-image（P2）
- 流程/架构图 → diagram（P2）
- 氛围/hero 图 → image generation（P2）

## 检查点
- 正式 deck：narrative 锁定后给人类一次 planning checkpoint。
- 初稿（pptx + 预览 + validation）齐全后给一次修订 checkpoint，明确告知进一步精修会增加 token 消耗。

## 边界
- 不依赖屏幕操作类工具。视觉复核靠脚本检测 + 人工看预览图。
- skill 正文只描述 deck 创作方法和产物组织；执行目录和路径边界由基础 guideline 与 runtime 统一负责。
```

> 注意：`description` 进第一层 prompt 索引，必须写清"何时用"。正文（第二层）只在 skill 激活时加载，深度内容（完整 contract 字段、layout 配方表）留到 P1 的 `references/`，正文保持精炼控 token。

## 4. Step 2 — templates/default.theme.json

```json
{
  "name": "default",
  "aspect": "16:9",
  "margins": { "x": 0.6, "y": 0.5 },
  "gap": 0.4,
  "titleSize": 28,
  "bodySize": 18,
  "colors": {
    "title": "1F2937",
    "body": "374151",
    "accent": "2563EB",
    "background": "FFFFFF"
  },
  "lineSpacing": { "title": 1.0, "body": 1.5 }
}
```

单位：坐标与尺寸用**英寸**（PptxGenJS 约定）。字号用 pt。颜色用 hex 字符串（不带 `#`）。

## 5. Step 3 — tools.ts

完整骨架，agent 补齐 `// TODO` 处的坐标细节即可运行：

```ts
import { z } from "zod";
import pptxgen from "pptxgenjs";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveWorkspacePath, toWorkspaceRelative } from "../../lib/workspace";
import type { ToolDefinition } from "../../lib/tools";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));

type Theme = {
  margins: { x: number; y: number };
  gap: number;
  titleSize: number;
  bodySize: number;
  colors: Record<string, string>;
};

async function loadTheme(name: string): Promise<Theme> {
  const file = path.join(SKILL_DIR, "templates", `${name}.theme.json`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

// 16:9 画布 13.333 x 7.5 英寸；4:3 为 10 x 7.5
function canvasSize(aspect: "16:9" | "4:3") {
  return aspect === "4:3" ? { w: 10, h: 7.5 } : { w: 13.333, h: 7.5 };
}

// 语义化 layout → 每页元素坐标（英寸）。agent 按需补全 section/title-content/blank。
function resolveLayout(layout: string, theme: Theme, aspect: "16:9" | "4:3") {
  const { w: W, h: H } = canvasSize(aspect);
  const mx = theme.margins.x;
  const my = theme.margins.y;
  switch (layout) {
    case "title":
      return {
        title: { x: mx, y: H * 0.38, w: W - 2 * mx, h: 1.6, fontSize: theme.titleSize + 6, align: "center", color: theme.colors.title },
      };
    case "title-bullets":
      return {
        title: { x: mx, y: my, w: W - 2 * mx, h: 1.0, fontSize: theme.titleSize, color: theme.colors.title, bold: true },
        body:  { x: mx, y: my + 1.2, w: W - 2 * mx, h: H - my - 1.7, fontSize: theme.bodySize, color: theme.colors.body },
      };
    case "two-col":
      const colW = (W - 2 * mx - theme.gap) / 2;
      return {
        title: { x: mx, y: my, w: W - 2 * mx, h: 1.0, fontSize: theme.titleSize, color: theme.colors.title, bold: true },
        left:  { x: mx, y: my + 1.2, w: colW, h: H - my - 1.7, fontSize: theme.bodySize, color: theme.colors.body },
        right: { x: mx + colW + theme.gap, y: my + 1.2, w: colW, h: H - my - 1.7, fontSize: theme.bodySize, color: theme.colors.body },
      };
    // TODO: section / title-content / blank
    default:
      return resolveLayout("title-bullets", theme, aspect);
  }
}

const generatePptxSchema = z.object({
  outputPath: z.string().min(1),
  slides: z
    .array(
      z.object({
        layout: z.enum(["title", "title-bullets", "title-content", "two-col", "section", "blank"]).default("title-bullets"),
        title: z.string(),
        bullets: z
          .array(z.union([z.string(), z.object({ text: z.string(), level: z.number().default(0) })]))
          .optional(),
        image: z.object({ path: z.string(), placement: z.enum(["fit", "fill"]).default("fit") }).optional(),
        chart: z
          .object({ type: z.enum(["bar", "line", "pie"]), data: z.unknown(), title: z.string().optional() })
          .optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
  theme: z.string().default("default"),
  aspect: z.enum(["16:9", "4:3"]).default("16:9"),
});

const initDeckSchema = z.object({
  dir: z.string().min(1),
  title: z.string(),
  audience: z.string().optional(),
  delivery: z.enum(["self-read", "speaker-led", "forward"]).default("self-read"),
});

export const tools: ToolDefinition[] = [
  {
    schema: generatePptxSchema,
    tool: {
      name: "generate_pptx",
      description:
        "Generate an editable native .pptx from structured slide specs. Keeps text as text and simple charts as native charts (editable in PowerPoint/Keynote).",
      input_schema: {
        type: "object",
        properties: {
          outputPath: { type: "string", description: "Output .pptx path." },
          slides: { type: "array", items: { type: "object" }, description: "Slides to render." },
          theme: { type: "string", default: "default" },
          aspect: { type: "string", enum: ["16:9", "4:3"], default: "16:9" },
        },
        required: ["outputPath", "slides"],
      },
    },
    execute: async (rawArgs, context) => {
      const args = generatePptxSchema.parse(rawArgs);
      const theme = await loadTheme(args.theme);
      const pres = new pptxgen();
      pres.layout = args.aspect === "4:3" ? "LAYOUT_4x3" : "LAYOUT_16x9";
      pres.author = "Ranni";

      for (const s of args.slides) {
        const L = resolveLayout(s.layout, theme, args.aspect);
        const slide = pres.addSlide();
        if (s.title && L.title) slide.addText(s.title, L.title);
        if (s.bullets && L.body) {
          const rows = s.bullets.map((b) =>
            typeof b === "string" ? { text: b } : { text: b.text, options: { indentLevel: b.level } },
          );
          slide.addText(rows, L.body);
        }
        // TODO two-col: 把 bullets 分到 L.left / L.right
        if (s.image) {
          const imgAbs = resolveWorkspacePath(s.image.path, context.workspaceRoot);
          slide.addImage({ path: imgAbs, x: L.body?.x ?? 1, y: L.body?.y ?? 2, w: 4, h: 3 });
        }
        if (s.chart) {
          slide.addChart(
            (pres.ChartType as any)[s.chart.type[0].toUpperCase() + s.chart.type.slice(1)],
            s.chart.data as any,
            { title: s.chart.title, x: 1, y: 2, w: 6, h: 4 },
          );
        }
        if (s.notes) slide.addNotes(s.notes);
      }

      const outAbs = resolveWorkspacePath(args.outputPath, context.workspaceRoot);
      await fs.mkdir(path.dirname(outAbs), { recursive: true });
      await pres.writeFile({ path: outAbs });
      return [
        "已生成可编辑 pptx。",
        `路径：${toWorkspaceRelative(outAbs, context.workspaceRoot)}`,
        `页数：${args.slides.length}`,
        "提示：可在 PowerPoint/Keynote 打开并直接编辑文字与图表。",
      ].join("\n");
    },
  },
  {
    schema: initDeckSchema,
    tool: {
      name: "init_deck_workspace",
      description:
        "Initialize a deck artifact directory with brief.md, deck_narrative.md, slide_specs.yaml, and final/preview/validation subfolders. Call this before generate_pptx for any non-trivial deck.",
      input_schema: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Deck artifact directory." },
          title: { type: "string" },
          audience: { type: "string" },
          delivery: { type: "string", enum: ["self-read", "speaker-led", "forward"] },
        },
        required: ["dir", "title"],
      },
    },
    execute: async (rawArgs, context) => {
      const args = initDeckSchema.parse(rawArgs);
      const baseAbs = resolveWorkspacePath(args.dir, context.workspaceRoot);
      for (const sub of ["final", "preview", "validation", "assets"]) {
        await fs.mkdir(path.join(baseAbs, sub), { recursive: true });
      }
      const brief = [
        "---",
        `title: ${args.title}`,
        `audience: ${args.audience ?? ""}`,
        `delivery: ${args.delivery}`,
        `editability: editable`,
        `aspect: "16:9"`,
        `theme: default`,
        "---",
        "",
        "# Deck Brief",
        "（在此写目标读者、使用场景、目标动作、视觉方向、信息密度）",
      ].join("\n");
      await fs.writeFile(path.join(baseAbs, "brief.md"), brief, "utf8");
      await fs.writeFile(
        path.join(baseAbs, "deck_narrative.md"),
        `# ${args.title}\n\n（顶层叙事：章节结构、每页任务、读者问题、关键结论）\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(baseAbs, "slide_specs.yaml"),
        "# 每页合同：reader_question / page_task / archetype / layout / key_message\nslides: []\n",
        "utf8",
      );
      return [
        "已初始化 deck 产物目录。",
        `目录：${toWorkspaceRelative(baseAbs, context.workspaceRoot)}`,
        "包含：brief.md / deck_narrative.md / slide_specs.yaml / final/ / preview/ / validation/ / assets/",
      ].join("\n");
    },
  },
];
```

实现要点：

- 复用 `resolveWorkspacePath` / `toWorkspaceRelative`（`lib/workspace.ts`）确保路径受基础 workspace 边界约束；`context.workspaceRoot` 来自 `ToolExecutionContext`。
- 仿 `lib/research.ts` 里 `saveCheckpoint` 的落盘范式（resolve → mkdir → writeFile → 返回相对路径）。
- **keep editable**：title/bullets 用 `addText`，chart 用 `addChart`。验收时解压 pptx 确认文本是 `<a:t>` 节点而非图片（见第 6 节）。
- 坐标全用英寸，参考 `canvasSize` 与 `resolveLayout`。
- `pres.ChartType.bar` 这类枚举访问用大写首字母映射，避免 TS 字面量类型报错。
- 若 `lib/tools.ts` 未 export `ToolDefinition`，先补 export，再 import。

## 6. Step 4 — 安装依赖

```bash
npm install pptxgenjs
```

P0 仅此一个新依赖。`pptxgenjs` 是纯 JS，无 native 依赖。

## 7. P1 / P2 展望（本指南不含实现，见 plan）

- **P1**：拆 `scripts/`（`check-layout.mjs` 用 `jszip` 解析 pptx 做 overflow/overlap/font 检测；`render-preview.mjs` 探测系统 LibreOffice/PowerPoint 出逐页 PNG）；新增 `render_pptx_preview` / `check_pptx_layout` / `derive_slide_specs` 工具；补 `references/`；三阶段质量门。
- **P2**：native chart 完善、`add_diagram`、`generate_slide_image`（image generation backend）、`audit_pptx_template`、Marp 预览旁路、PPT 导出 PDF。
- **P2 视觉复核仍不依赖 computer-use**：保持"脚本检测 + 人工看预览图"，不引入屏幕操作工具。

## 8. 端到端验收清单（P0 完成标志）

全部通过才算 P0 完成：

- [ ] `npm run typecheck && npm run lint && npm run build` 全绿。
- [ ] `grep -rn "operate_computer\|computer-use" skills/slides/` 无输出（无屏幕操作依赖）。
- [ ] 激活 slides skill（输入框“幻灯片”开关、设置页能力开关或 `load_skill`）后，agent 依次调 `init_deck_workspace` + `generate_pptx`，产出可编辑 `.pptx` 并保留 deck 产物目录。
- [ ] 用 PowerPoint / Keynote / WPS 打开产物：文字可点击编辑、布局正常、chart 是可编辑 native chart（非图片）。
- [ ] **keep editable 校验**：`unzip -p <产物>.pptx ppt/slides/slide1.xml | grep "<a:t>"` 能命中文本节点（title/bullets 是真文本，不是图片）。
- [ ] 未激活 slides 时，trace 里 system prompt 不含 slides 正文（对比激活前后 `systemPromptChars` 有明显差值）。
- [ ] 回归：skill 未激活时 agent 行为与现状一致（常驻工具、无 slides 工具）。

## 9. 常见坑

- **坐标单位**：PptxGenJS 用英寸。16:9 画布是 13.333 × 7.5。
- **import 路径**：`skills/slides/tools.ts` 回 `lib` 用 `../../lib/...`；确认打包（vite/tsx watch）能解析到。若 skill 机制用动态 `import()` 加载 `tools.ts`，确认动态 import 路径正确（见 skill-dynamic-loading-plan.md Task 1）。
- **类型 export**：`ToolDefinition` / `ToolExecutionContext` 必须从 `lib/tools.ts` export，否则 skill `tools.ts` 无法 import。
- **theme 读取**：用 `import.meta.url` 定位 skill 包目录，读 `templates/*.theme.json`，不要硬编码绝对路径。
- **不要调 operate_computer**：视觉问题一律走 `check_pptx_layout`（P1）+ 人工看 preview。本 skill 不依赖屏幕操作。
- **不要整页栅格化**：所有文字走 `addText`，绝不把整页渲染成图片塞进去。

## 10. 参考

- 本仓库 `slides-skill-plan.md`（设计决策与概念定义）
- 本仓库 `skill-dynamic-loading-plan.md`（skill 机制前置）
- 本仓库 `document-generation-research.md`（业界调研与选型推理）
- [pptxgenjs – NPM](https://www.npmjs.com/package/pptxgenjs)
- [Generate slide decks | Codex use cases](https://developers.openai.com/codex/use-cases/generate-slide-decks)（keep editable 原则来源）

## 11. HTML-to-PPTX 路线（spike，补充）

本节给维护 HTML 路线的 coding agent。设计决策与产物见 `html-to-pptx-export-guide.md`，落地数据与限制见 `html-to-pptx-spike-report.md`。

### 11.1 文件清单

```
skills/slides/
  tools.ts                                  # 新增 4 个工具（薄壳）
  scripts/html-pptx/
    lib.mjs                                 # 浏览器启动、bundle 解析、data URI、LibreOffice 探测
    prepare.mjs                             # 测量 + 截图回退 + 原位替换 + 内联 + 写 prepared.html/measurements.json
    export.mjs                              # 注入 dom-to-pptx bundle + 导出 pptx
    validate.mjs                            # 预览 + slide 计数 + 回退检查 + qa-report.json
  templates/slide-html/
    deck.html                               # 8 页 spike 示例 deck
    styles.css                              # 受限 slide HTML 规范样式
    assets/illustration.svg                 # 本地资产示例
```

### 11.2 工具与脚本的边界

工具（`tools.ts`）只负责路径安全与子进程调度：

- 用 `resolveWorkspacePath` 把所有输入输出解析成 workspace 内绝对路径。
- 用 `spawn(process.execPath, [scriptPath, JSON.stringify(config)])` 启动 `.mjs`，`cwd` 为 session workspace，并注入 `AGENT_WORKSPACE_ROOT`。
- 解析脚本 stdout 最后一行 JSON 作为结果，转成 workspace-relative 摘要返回。

脚本（`.mjs`）是自包含 ESM，直接 `import "playwright"`，用 `createRequire` 解析 `dom-to-pptx` 与 `jszip`。这样 playwright / dom-to-pptx 不进入 `tsconfig.node.json` 的 tsc 图，也不进入 vite 的 dist bundle。

### 11.3 必须注意的实现点

- **CORS 与 data URI 内联**：dom-to-pptx 用 canvas 读图片像素做圆角防白边，`file://` 页面读 `file://` 图片会被 Chromium CORS 拦截。prepare 阶段必须把所有本地 `<img>` 内联成 data URI，否则插画与截图回退图片无法嵌入。
- **dom-to-pptx bundle 解析**：包的 `exports` 屏蔽了 `./package.json`，不能 `require.resolve("dom-to-pptx/package.json")`；改用 `require.resolve("dom-to-pptx")` 解析主入口后向上找 `name === "dom-to-pptx"` 的 package.json。
- **导出拿 Blob**：页内调用 `window.domToPptx.exportToPptx(slides, { skipDownload: true, layout: "LAYOUT_WIDE", autoEmbedFonts })`，返回 Blob 转 `ArrayBuffer` 以字节数组回传 Node 落盘。`LAYOUT_WIDE`（13.333x7.5in）让 pptx 在 192dpi 下与 1280x720 HTML 的 dsf2 预览（均 2560x1440）逐像素对齐，便于像素 diff。
- **字体嵌入**：`autoEmbedFonts` 默认开启。默认 deck 用系统字体（无 `@font-face`）时无字体可嵌入；deck 用 `@font-face`（字体放 `assets/fonts/`）时 dom-to-pptx 会自动嵌入，端到端已验证（pptx 出现 `embeddedFontLst`）。
- **截图回退原位替换**：不清空父布局，保持原节点盒子与文档流，把节点内容替换为 `position:absolute;inset:0` 的 `<img>`，避免版式漂移。
- **`data-pptx-ignore` 处理**：prepare 阶段直接从 DOM 移除 `[data-pptx-ignore]` 节点（如 HTML 分页页码），让它们不进入 prepared.html 与 pptx，并在 measurements.json 计入 `ignored`。
- **像素差异质量门**：validate 用 LibreOffice 把 pptx 转 pdf、poppler `pdftoppm` 拆逐页 png，与 preview-html 用 pixelmatch 逐页比对；对 ≤2px 渲染舍入做裁剪对齐，告警"差异过大（>70%）"与"近乎纯色（空白页风险）"。缺 LibreOffice/poppler/pixelmatch 任一项都显式降级告警。
- **栅格化检测**：validate 用 jszip 统计 pptx 内嵌媒体体积，对最大图片 >400KB、媒体总计 >1.5MB 自动告警（复杂背景被动光栅化信号）。

### 11.4 验证

代码改动跑 `npm run typecheck && npm run lint && npm run build`；端到端跑 `node skills/slides/scripts/html-pptx/e2e.mjs`，它从结构化 prompt 用确定性 builder 生成受限 slide HTML，依次跑 prepare/export/validate 并断言：pptx 有效 zip、slide 数一致、关键文本为可编辑 `<a:t>`、qa-report `libreoffice=rendered`、像素 diff 可用且无空白页、`@font-face` 字体被嵌入。e2e 的字体子用例复用 `node_modules/playwright-core` 的 codicon.ttf。
