---
name: slides
description: Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Authors restricted slide HTML and converts it to a limited-editable .pptx with preview + QA.
---

# slides 技能

## 何时使用
用户要做 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料，并希望输出可在 PowerPoint、Keynote 或 WPS 里继续编辑的 `.pptx`。

## 执行硬规则（必须遵守）

1. **生成 `.pptx` 必须走 HTML 路线，按顺序调用这四个注册工具：**
   `init_slide_html_workspace` → `prepare_slide_html_for_pptx` → `export_html_to_pptx` → `validate_html_pptx_export`
2. **禁止用 `terminal` / `write_file` 跑 Python、Node 或任何第三方库（python-pptx、报告生成库等）自行组装 pptx。** 本环境**没有 Python slides 工具**，不存在 python-pptx 路线，也没有 native PptxGenJS 直生成路线。看到"用 python-pptx / 写脚本生成 pptx / 直接组装 OOXML"的念头时，立刻改用上面四个工具。
3. **向用户解释实现方式时，必须如实报告实际调用的工具名**。不得编造、不得套用外部方案的说辞（例如声称"用 Python 直接组装 OOXML""零 Node.js"等）。讲不清就列实际调用的工具序列。
4. 工具执行边界、工作目录由基础 guideline 与 runtime 负责；skill 正文只描述创作方法。

## 工具流水线

1. `init_slide_html_workspace` 建 deck 目录并拷贝受限 slide HTML 模板（含示例 deck 与 styles.css）。用语义化 `deckSlug` 命名产物目录与最终 pptx。
2. 编辑 `deck.html` 创作页面：版式写进受限 HTML，重要文本加 `data-pptx-editable`，复杂图表/装饰加 `data-pptx-raster`，冗余元素加 `data-pptx-ignore`。
3. `prepare_slide_html_for_pptx` 做截图回退预处理 + 本地图片 data URI 内联，输出 `deck.prepared.html` 与 `measurements.json`。
4. `export_html_to_pptx` 用 dom-to-pptx 把 `deck.prepared.html` 转成 `final/<deck-slug>.pptx`。
5. `validate_html_pptx_export` 生成 preview-html、preview-pptx、HTML↔PPTX 像素差异、qa-report.json。

## 受限 slide HTML 规范
每页一个 `<section class="slide">`，固定 `1280x720`、`overflow:hidden`，禁止滚动。标注：
- `data-pptx-deck`：deck 根节点
- `data-slide-id`：slide 稳定标识
- `data-pptx-editable`：重要文本（保留为 PPTX 文本对象）
- `data-pptx-raster`：复杂视觉块（转换前截图回退）
- `data-pptx-ignore`：导出时忽略（如 HTML 分页页码）
- `data-pptx-alt`：图片/截图的替代文本

只用系统字体（或 `assets/fonts/` 下的 `@font-face` 本地字体，会被自动嵌入），相对路径引用本地资产，避免外部 CDN。模板里的 styles.css 已定义一套可用版式（封面、目录、文本、双栏图文、数据表格、时间线、总结等），优先复用其类名，保证导出稳定性。

## 创作约束
- 重要文本加 `data-pptx-editable`，保留可编辑。
- 复杂视觉加 `data-pptx-raster` 做局部截图，不要整页栅格化。
- 远程图片先下载到 `assets/` 再引用。
- 复杂多层渐变/滤镜背景会被自动光栅化，追求可编辑性时用更克制的背景。

## 共性原则
- **keep editable**：文字保文本对象，只有太自定义的视觉才用图片或局部截图，不整页栅格化。
- **每页独立决策**：逐页判断读者问题、页面任务、核心结论和资产模式，不要所有页套同一密度。
- **默认产物组织**：用语义化 deck slug 命名产物目录与 PPTX，最终放 `final/<deck-slug>.pptx`。

## 边界
- 渲染预览/像素差异需要系统 LibreOffice + poppler（validate 在缺失时会显式降级告警，不静默通过）。
- 实现细节、验证数据见 `docs/tech/v2-architecture/html-to-pptx-spike-report.md` 与 `slides-skill-developer-guide.md`。
