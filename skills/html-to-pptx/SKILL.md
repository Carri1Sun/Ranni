---
name: html-to-pptx
description: Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Creates restricted slide HTML first, then exports a limited editable PPTX with Playwright, dom-to-pptx, and local raster fallback for complex visuals.
---

# HTML-to-PPTX 技能

## 何时使用

用户要做 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料，并希望输出可在 PowerPoint、Keynote 或 WPS 里继续编辑的 `.pptx`。

## 默认创作路线

HTML-to-PPTX skill 当前只暴露 HTML-to-PPTX 工具链。做幻灯片时先规划 deck 叙事、页面清单、视觉系统、内容密度和截图回退边界，再创作受限 slide HTML，通过浏览器预览与测量确认版式，最后导出有限可编辑 `.pptx`。

工具顺序：

1. `init_slide_html_workspace`：创建 `deck.html`、`styles.css`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/` 和 `final/`，并用 `prompt` 保存创作输入。
2. 编辑 `deck.html` 和 `styles.css`：每页一个 `.slide`，固定 1280x720；根据用户内容自由规划页面结构，重要文本保留为 HTML 文本。
3. `prepare_slide_html_for_pptx`：用 Playwright 渲染 HTML，测量 `.slide`，把 `data-pptx-raster` 节点截图到 `fallback-assets/`，再写出 `deck.prepared.html` 和 `measurements.json`。
4. `export_html_to_pptx`：在 Playwright 页面中注入 `dom-to-pptx`，导出前把 workspace 内本地 `<img>` 内联为 data URI，再把 `deck.prepared.html` 转为 `.pptx`。
5. `validate_html_pptx_export`：渲染 HTML 预览，尝试渲染 PPTX 预览，检查 PPTX slide XML，执行客观视觉 smoke check，并写出 `qa-report.json`。

本地自动化验收入口：

```bash
npm run slides:html-spike
```

该脚本会从内部 8 页示例 deck 初始化 workspace，执行完整导出链路，并断言 `qa-report.json` 无 warning、PPTX preview 已渲染为逐页 PNG、PPTX XML 中存在可编辑文本 run。

## 受限 HTML 规范

- 每页使用 `.slide`，固定 `1280px x 720px`，页内 `overflow: hidden`。
- 每页设置 `data-slide-id`。
- 重要文本使用 `data-pptx-editable`。
- 复杂视觉使用 `data-pptx-raster`，并提供 `data-pptx-alt`。
- 导出时跳过的装饰或辅助元素使用 `data-pptx-ignore`。
- CSS 面向固定画布编写，避免滚动、动画、响应式断点和依赖视口宽度的字体缩放。
- 本地图片使用 `assets/` 或 `fallback-assets/` 内资源，仍需明确像素宽高；导出工具会在转换前内联，避免相对路径被 `dom-to-pptx` 跳过。

## 设计与排版硬性准则

创作 slide HTML 时必须遵守 `skills/html-to-pptx/reference-materials/html-to-pptx-agent-design-guidelines.md`。以下规则属于强约束，违反时应修改 HTML/CSS，不能继续导出：

- 画布和盒模型：`.deck` 固定宽度 `1280px`；`.slide` 固定 `1280px x 720px`；全局使用 `box-sizing: border-box`；页面和 slide 都禁止滚动。
- 垂直节奏：主要内容使用固定 `padding-top` 对齐标题；主要内容流禁止 `padding-bottom`；内部内容块优先使用 `min-height`，避免正文被固定高度截断。
- 版式结构：主内容区必须使用 Grid/Flex 或标准文档流排版；包含标题、段落、列表、表格的主内容禁止使用 `position: absolute`；绝对定位只用于背景装饰、视觉锚点和 `data-pptx-raster` 内部复杂视觉。
- 字体和字号：每套 deck 最多使用 2 种字体；正文使用系统或标准 Web 字体 fallback；封面标题约 `64px`，内容页标题约 `32px`，重点副标题或指标 `24px` 到 `28px`，正文 `16px` 到 `20px`。
- 留白和文本密度：正文 `line-height` 使用 `1.5` 到 `1.6`；内容块之间的 `gap` 或 `margin-bottom` 至少 `30px`；每页正文段落不超过 3 段，每段不超过 3 行，长文本应提炼为列表或小标题块。
- 视觉风格：追求平面设计和杂志感；避免网页 UI 感；卡片圆角不得超过 `8px`；不要使用 `box-shadow` 做卡片阴影；每页除黑白灰外最多使用 2 到 3 种主题色。
- 视觉补偿：移除阴影、hover、复杂渐变、绝对定位文字等不稳定效果时，必须用 PPTX 友好的替代方式补足层次，例如色带、细边框、分区底色、背景几何块、连接轨道、节点圆环、页码锚点和留白节奏。
- 静态输出：禁止 `@keyframes`、CSS animation、`transition` 和 `:hover`；禁止用伪元素 `content` 注入关键文字；伪元素只可用于纯装饰。
- PPTX 兼容：背景层使用 `z-index: 1`，主内容层使用 `z-index: 10`；图片和 canvas 必须有明确像素级宽高，并设置合适的 `object-fit`；表格使用标准 `<table>`、`<tr>`、`<td>`。
- 装饰和复杂视觉：背景几何图形可绝对定位；复杂图表、canvas、D3/Chart.js、复杂渐变或多层视觉必须放进固定尺寸容器，并标记 `data-pptx-raster` 和 `data-pptx-alt`。

如果本次 run 选择了共享 HTML 设计风格，必须遵守 system prompt 中的 `HTML design selection`。产品级基础 guide 会由 runtime instruction registry 从 `skills/html-design/reference-materials/base-html-design-guide.md` 注入，设计风格是补充约束。

设计内容资产存放在：

- `skills/html-design/styles/*/guide.md`
- `skills/html-design/styles/*/reference.md`

system prompt 中出现“参考资料”路径时，在需要更细致的设计思路了解时，阅读参考资料；参考资料已包含本地化来源笔记，不需要访问外部 URL。

## 创作规划

开始写 HTML 前，先在当前 run 内完成简短规划：

- 明确 deck 目标、受众、主线结论和页数。
- 列出每页的页面任务，例如封面、目录、关键洞察、论证、数据、路线图、风险、结论。
- 定义视觉系统：字体、主题色、背景方式、图标/图片/表格风格、对齐网格和留白节奏。
- 为每页判断可编辑文本、普通图片、表格和 `data-pptx-raster` 局部截图回退的边界。
- 每页只承担一个主要信息任务，避免把长报告段落直接塞进幻灯片。

好的 PPTX 应该有清晰叙事、强标题、稳定层级、足够留白、可扫读结构、一致对齐、可靠资产和可编辑核心文本。agent 可自由设计页面模块，但必须遵守受限 HTML、设计风格和 PPTX 兼容规则。

## 可编辑性原则

- 重要标题、正文、列表、表格文字优先保留为 DOM 文本，并标记 `data-pptx-editable`。
- 复杂图表、复杂 CSS 装饰、canvas/SVG 组合视觉使用 `data-pptx-raster` 做局部截图回退。
- 截图回退只包住复杂视觉块，避免整页截图。
- 普通流或 `position: relative` 的截图回退节点应留在主布局中；准备阶段会原地替换为等尺寸 `<img>`，保持 Flex/Grid 间距和层级。绝对定位装饰可以继续使用 slide 坐标回放。
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
- 视觉 smoke check 只检查空白页、预览页数不一致和高阈值视觉差异；最终审美由用户打开预览和 `.pptx` 判断。
