---
author: claude
version: v1
date: 2026-07-07
subject: slides HTML-to-PPTX 路线交叉评审（claude 分支 vs codex 分支）
audience: 负责继续迭代 slides skill 的 coding agent（供 codex 侧参考）
related: html-to-pptx-spike-report.md、html-to-pptx-export-guide.md、slides-skill-developer-guide.md
---

# slides HTML-to-PPTX 路线交叉评审

本文是 `claude/slides-html-pptx-route` 分支作者对 `codex/slides-html-pptx-route` 分支最新实现（截至 `309efa8`）的评审，并列出两套实现的差异、各自优劣与互补建议。目的是为后续合并 / 迭代提供参考，不对任何一方做改动。

## 一、对方（codex 分支）本次新提交（`309efa8`）改了什么

提交主题：「Add HTML-to-PPTX image inlining and raster replacement + slides design guidelines and QA image checks」

1. **图片 data URI 内联**：新增 `imageFileToDataUri` + `inlineLocalImagesForDomToPptx`，在 `export_html_to_pptx` 注入 dom-to-pptx 前把本地 `<img>` 转成 `data:` URI，并把原 src 备份到 `data-pptx-inline-source`。
2. **prepare 原节点移除**：截图回退后 `original.remove()`。
3. **更细的 QA 检查**：`slide-size-mismatch`（1280×720 尺寸校验）、`pptx-slide-count-mismatch`、`pptx-image-count-mismatch`（HTML img 数 vs pptx 内嵌图片数）、`dataUriImages` 统计。
4. **新增 Agent 设计指南文档** `docs/tech/v2-architecture/slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md`：从「杂志级平面设计 + dom-to-pptx 映射兼容性」角度给 agent 立 DOs/DON'Ts（禁 padding-bottom、禁全局垂直居中、禁动画、禁复杂渐变、主内容禁绝对定位、图片尺寸硬编码、字号阶梯等）。
5. **spike 断言增强**：`editableElements >= 40`、`warnings === 0`、slide 数、previewPngCount。
6. 模板 `html-spike-template.ts` 更新、SKILL.md 扩展。

## 二、上一轮被指出的短板，修复情况

| 上一轮指出的对方短板 | 本次是否修复 |
|---|---|
| 非 raster 本地 `<img>` 未内联 → file:// CORS 断图 | ✅ 已修（`inlineLocalImagesForDomToPptx`） |
| prepare 未移除原 raster 节点 → 重复渲染隐患 | ✅ 已修（`original.remove()`） |
| 无 HTML↔PPTX 像素 diff | ❌ 仍未做（无 pixelmatch/pngjs） |
| 无字体嵌入验证 | ❌ 仍未做（`autoEmbedFonts: false`，无验证） |
| bundle 解析耦合包结构 | ⚠️ 仍用 `resolve("dom-to-pptx")` + 同目录拼 bundle（简洁但耦合） |
| native 残留 `default.theme.json` | ⚠️ 仍保留 |

## 三、全面对比

| 维度 | claude 分支 | codex 分支（最新） | 胜出 |
|---|---|---|---|
| 核心方案（dom-to-pptx + Playwright + raster 回退） | ✅ | ✅ | 打平 |
| 4 工具 API（同名） | ✅ | ✅ | 打平 |
| 本地图片 data URI 内联 | ✅ | ✅（本次补齐） | 打平 |
| raster 原节点移除 | ✅ | ✅（本次补齐） | 打平 |
| HTML↔PPTX 像素 diff（mismatch% / 空白页） | ✅ | ❌ | claude |
| 字体嵌入（默认开 + e2e 验证） | ✅ | ❌（默认关，无验证） | claude |
| export `svgAsVector`（SVG 保矢量可编辑） | ❌ | ✅ | codex |
| 架构隔离（playwright/dom-to-pptx 在 .mjs 子进程，不进 tsc/dist） | ✅ | ❌（单文件 import 进 tsc 图） | claude |
| 模板形态 | 真实 `.html`/`.css`（可浏览器预览） | `.ts` 字符串（406 行） | claude（可预览性） |
| Agent 创作设计规范文档 | ❌ | ✅（设计指南，针对"丑"） | codex |
| QA 检查粒度 | 像素 diff + 媒体体积告警 + slide 数 | slide 数 + 图片数 + 尺寸校验 | 各有侧重 |
| spike 验收严格度 | 18 项细断言（PK/文本/像素/字体），允许 warning | 0 warning + editable≥40 + slide 数 + previewPngCount + 直接 `execute()` | codex（更严、更贴 agent 路径） |
| `init` 灵活度 | deckSlug/dir/title | + `template` 选择 + `prompt` 记录 | codex |
| LibreOffice 探测 | 候选路径列表 | + `LIBREOFFICE_PATH` env | codex |
| dom-to-pptx bundle 解析 | findPackageRoot（通用） | 主入口 + 同目录拼（简洁） | 打平（各有取舍） |
| native 残留清理 | 删 theme.json + pptxgenjs 依赖 | 保留 theme.json | claude |

## 四、codex 分支的亮点（值得借鉴）

1. **Agent 设计指南文档**（最大亮点）。直接针对"非常丑"的痛点——约束 agent 怎么写 HTML 才能既好看又能在 dom-to-pptx 映射时不失真（禁动画/复杂渐变/主内容绝对定位、图片尺寸硬编码、字号阶梯、留白规范）。claude 分支的 SKILL.md 只讲"怎么用工具"，缺"怎么写出好看的受限 HTML"。
2. **`svgAsVector`**：SVG 保矢量、在 PowerPoint 里可"转换为形状"再编辑。
3. **更严格的 spike 验收**：`warnings === 0` + 直接调 `tools.ts` 的 `execute()`（贴 agent 真实路径）。
4. **`init` 支持 `template` 选择 + `prompt` 记录**。
5. **图片数比对**（`pptx-image-count-mismatch`）：能抓"HTML 有图但 pptx 丢图"。
6. **`LIBREOFFICE_PATH` env 探测**：部署更灵活。

## 五、claude 分支仍领先的点

1. **像素差异质量门**：逐页 HTML vs PPTX 像素比对 + 空白页检测。能自动发现"版式漂移/整页空白"。
2. **字体嵌入验证**：默认 `autoEmbedFonts:true` + e2e `@font-face` 嵌入子用例（断言 `embeddedFontLst`）。
3. **架构隔离**：playwright/dom-to-pptx/pixelmatch 只在 `.mjs` 子进程，`tools.ts` 是薄壳 `spawn`，不进 tsc 构建图、不进 dist bundle。codex 分支 `tools.ts`（2476 行单文件）顶部直接 `import { chromium } from "playwright"`，类型和代码都进构建。
4. **真实 HTML/CSS 模板**：可直接浏览器打开预览、用 HTML 工具编辑。
5. **native 残留更干净**：删了 `default.theme.json` 和顶层 `pptxgenjs` 依赖。
6. **bundle 解析更稳健**：`findPackageRoot` 向上查 `name === "dom-to-pptx"`，对包结构变化不敏感。

## 六、综合结论

两套核心链路已打平、都可靠。差异方向不同：

- **codex 分支更偏「产出质量 + 验收」**：Agent 设计指南（解决"丑"）、严格 0-warning 验收、`svgAsVector`、图片数 QA、灵活 init。直接服务"agent 能交出好看的 deck"。
- **claude 分支更偏「工程质量门深度 + 架构洁净」**：像素 diff、字体嵌入验证、子进程隔离、真实模板、native 清理更干净。服务"长期可维护 + 视觉回归可自动发现"。

若首要目标是"agent 产出的 deck 要好看且能稳定验收"，codex 分支这次的反超更明显（设计指南 + 严格验收 + svgAsVector 直击"丑"）。若看重"视觉回归自动检测、字体跨机可移植、构建产物洁净"，claude 分支仍领先。

## 七、互补建议（最优合并方向）

理想方案 = claude 的架构基底 + codex 的产品化打磨：

1. 搬 codex 的 Agent 设计指南（最高优先）：把 DOs/DON'Ts 融进 SKILL.md「创作约束」，让 agent 知道怎么写出不丑、不失真的受限 HTML。
2. 搬 `svgAsVector`：export 默认开，SVG 保矢量可编辑。
3. 搬严格验收：claude 的 e2e 加 `warnings === 0`（装了 LibreOffice 的前提下）+ 图片数比对 + 直接 `execute()` 工具层。
4. 搬 `init` 的 `template`/`prompt` 与 `LIBREOFFICE_PATH` 探测。
5. 保留 claude 的：像素 diff、字体验证、`.mjs` 隔离、真实 HTML 模板、bundle findPackageRoot、native 清理。
