---
name: slides
description: Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Creates restricted slide HTML first, then exports a limited editable PPTX with Playwright, dom-to-pptx, and local raster fallback for complex visuals.
---

# slides 技能

## 何时使用

用户要做 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料，并希望输出可在 PowerPoint、Keynote 或 WPS 里继续编辑的 `.pptx`。

## 默认创作路线

slides skill 当前只暴露 HTML-to-PPTX 工具链。做幻灯片时先创作受限 slide HTML，通过浏览器预览与测量确认版式，再导出有限可编辑 `.pptx`。

工具顺序：

1. `init_slide_html_workspace`：创建 `deck.html`、`styles.css`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/` 和 `final/`。需要样例时传 `template: "spike-sample"`，并用 `prompt` 保存创作输入。
2. 编辑 `deck.html` 和 `styles.css`：每页一个 `.slide`，固定 1280x720，重要文本保留为 HTML 文本。
3. `prepare_slide_html_for_pptx`：用 Playwright 渲染 HTML，测量 `.slide`，把 `data-pptx-raster` 节点截图到 `fallback-assets/`，再写出 `deck.prepared.html` 和 `measurements.json`。
4. `export_html_to_pptx`：在 Playwright 页面中注入 `dom-to-pptx`，把 `deck.prepared.html` 转为 `.pptx`。
5. `validate_html_pptx_export`：渲染 HTML 预览，尝试渲染 PPTX 预览，检查 PPTX slide XML，并写出 `qa-report.json`。

本地自动化验收入口：

```bash
npm run slides:html-spike
```

该脚本会从 prompt 生成示例 HTML，执行完整导出链路，并断言 `qa-report.json` 无 warning、PPTX preview 已渲染为逐页 PNG、PPTX XML 中存在可编辑文本 run。

## 受限 HTML 规范

- 每页使用 `.slide`，固定 `1280px x 720px`，页内 `overflow: hidden`。
- 每页设置 `data-slide-id`。
- 重要文本使用 `data-pptx-editable`。
- 复杂视觉使用 `data-pptx-raster`，并提供 `data-pptx-alt`。
- 导出时跳过的装饰或辅助元素使用 `data-pptx-ignore`。
- CSS 面向固定画布编写，避免滚动、动画、响应式断点和依赖视口宽度的字体缩放。

## 可编辑性原则

- 重要标题、正文、列表、表格文字优先保留为 DOM 文本，并标记 `data-pptx-editable`。
- 复杂图表、复杂 CSS 装饰、canvas/SVG 组合视觉使用 `data-pptx-raster` 做局部截图回退。
- 截图回退只包住复杂视觉块，避免整页截图。
- 图片使用 `assets/` 或 `fallback-assets/` 内的本地资产，并提供明确 alt 文本。
- `dom-to-pptx` 覆盖不到的样式边界记录到 `qa-report.json` warning，交付时说明。

## 每页独立决策

逐页判断读者问题、页面任务、核心结论和资产模式。封面、目录、文本页、图文页、数据页、复杂视觉页、时间线页和总结页应根据内容选择不同结构，避免所有页面使用同一种密度和版式。

## 默认产物组织

没有用户指定文件名时，使用语义化 deck slug 命名产物目录和 PPTX 文件。产物目录保留：

- `deck.html`
- `deck.prepared.html`
- `styles.css`
- `assets/`
- `fallback-assets/`
- `preview-html/`
- `preview-pptx/`
- `measurements.json`
- `qa-report.json`
- `final/<deck-slug>.pptx`

所有路径必须落在当前 session workspace 内。

## 边界

- 当前路线提供有限可编辑 PPTX，主要保障文本、图片、基础形状和表格的可编辑性。
- 高级图表数据源、复杂动画、任意网页转换、响应式页面和完整 CSS 覆盖暂不承诺。
- PPTX 预览依赖本机 LibreOffice 与 Poppler；缺失时应把预览失败写入 `qa-report.json` warning。
