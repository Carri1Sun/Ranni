---
name: html-to-pptx
description: "Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Creates restricted slide HTML first, then exports a limited editable PPTX with Playwright, dom-to-pptx, and local raster fallback for complex visuals."
---

# HTML-to-PPTX 技能

## 何时使用

用户要做 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料，并希望输出可在 PowerPoint、Keynote 或 WPS 里继续编辑的 `.pptx`。

## 默认创作路线

HTML-to-PPTX skill 当前只暴露 HTML-to-PPTX 工具链。做幻灯片时先规划 deck 叙事、页面清单、视觉系统、内容密度和截图回退边界，再创作受限 slide HTML，通过浏览器预览与测量确认版式，最后导出有限可编辑 `.pptx`。

常用路线：

1. 先完成叙事、页面清单、页面 ID、视觉系统和资产规划，再进入文件输出。
2. `init_slide_html_workspace`：创建 `deck.html`、`styles.css`、`styles/`、`slides/`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/` 和 `final/`，并用 `prompt` 保存创作输入。
3. `set_slide_manifest`：保存完整、有序且无重复的页面 ID。第一个 slide fragment 写入后清单保持不变；`style`、`styles`、`css`、`theme` 是保留 ID。
4. `write_style_fragment`：把视觉系统拆成紧凑、完整的 CSS 片段，每个片段独立闭合；工具会在原子写入前检查注释、字符串和规则块完整性。
5. `assemble_deck_styles`：按声明顺序组装 `styles.css`，通过浏览器确认 `.slide` 的 1280x720 尺寸与 overflow 后原子替换当前样式。
6. `write_slide_fragment`：把候选页原子保存到 `slides/.draft/`，执行结构和语义化浏览器诊断；通过硬约束后再原子提升到 `slides/`。单页 HTML 建议控制在 8000 字符内。
7. 写入失败时用 `inspect_slide_fragment` 查看完整 draft、hash 和责任元素。agent 可根据观察结果选择完整重写，或用 `patch_slide_fragment` 按 `baseHash` 和精确匹配次数做局部修改。
8. `assemble_slide_deck`：从 manifest 读取固定页序，只使用 accepted fragment 确定性组装 `deck.html`。
9. `prepare_slide_html_for_pptx`：用 Playwright 渲染 HTML，测量 `.slide`，把 `data-pptx-raster` 节点截图到 `fallback-assets/`，再写出 `deck.prepared.html` 和 `measurements.json`。
10. `export_html_to_pptx`：在 Playwright 页面中注入 `dom-to-pptx`，导出前把 workspace 内本地 `<img>` 内联为 data URI，再把 `deck.prepared.html` 转为 `.pptx`。
11. `validate_html_pptx_export`：渲染 HTML 预览，尝试渲染 PPTX 预览，检查 PPTX slide XML，执行客观视觉 smoke check，并写出 `qa-report.json`。

失败回执提供真实诊断，不规定修复路线。agent 可以继续读取、搜索、inspect、patch、修改 CSS 或重写当前页；相同错误重复出现时先重新判断责任元素和假设。

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

## 架构防线与设计建议

阅读 `skills/html-to-pptx/reference-materials/html-to-pptx-agent-design-guidelines.md`。工具只用硬错误守住结构、安全、内容完整性和原子性：

- 每个 fragment 只包含一个顶层 `.slide`，ID 必须与 manifest 一致；禁止在 fragment 中嵌入 `script`、`style`、`link` 或完整文档 wrapper。
- `.slide` 固定 `1280px x 720px` 并设置 `overflow: hidden`。正文、关键图片和可编辑文本不能被自身容器或 slide 画布裁切。
- 无文本绝对定位装饰可以延伸到画布外，由 slide 裁切时只产生 warning；诊断会返回 selector、坐标和相关 CSS。
- 所有文件保持在 session workspace。失败候选只更新 draft，accepted 版本保持可用；通过同一语义诊断后再原子提升。

以下内容用于提高视觉质量和 PPTX 映射稳定性，由 agent 结合页面任务判断；偏离时记录 warning 或建议：

- 主内容优先使用 Grid、Flex 或标准文档流；绝对定位更适合背景装饰、视觉锚点和固定尺寸复杂视觉。
- 正文优先使用系统或标准 Web 字体 fallback；中文 deck 选择覆盖 Latin/CJK 的确定字体。导出器会按当前字符集加载并嵌入 Noto Sans SC 子集。
- chip、badge、短标题、数字单位和指标值适合使用叶子文本节点，并设置 `white-space: nowrap; word-break: keep-all; overflow-wrap: normal;`；单行文本预留至少 `5%`、不低于 `8px` 的横向余量。
- 固定多行内容优先拆为独立 block span。使用 `<br>` 时为最长一行保留宽度，避免叠加自动换行。
- 通过字号、留白、色带、边框、分区底色和背景几何建立层级。圆角、阴影、颜色数量、段落数量和字体数量属于设计建议。
- 动画、hover、复杂图表和多层视觉可能降低静态导出稳定性；复杂视觉可放入固定尺寸的 `data-pptx-raster` 容器，并提供 `data-pptx-alt`。

如果本次 run 选择了共享 HTML 设计风格，把 system prompt 中的 `HTML design selection` 作为视觉方向。产品级基础 guide 会由 runtime instruction registry 从 `skills/html-design/reference-materials/base-html-design-guide.md` 注入，设计风格用于补充页面判断。

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

好的 PPTX 应该有清晰叙事、强标题、稳定层级、足够留白、可扫读结构、一致对齐、可靠资产和可编辑核心文本。agent 可自由设计页面模块，同时守住受限 HTML、内容完整性和原子产物防线。

## 可编辑性原则

- 重要标题、正文、列表、表格文字优先保留为 DOM 文本，并标记 `data-pptx-editable`。
- `data-pptx-editable` 标在承担文字语义的叶子节点；当前属性用于统计和 QA，不参与字体、宽度、换行或文本框分组决策。
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
- `styles/<style-id>.css`
- `slide-manifest.json`
- `slides/<slide-id>.html`
- `slides/.draft/<slide-id>.html`
- `slides/.draft/<slide-id>.diagnostics.json`
- `slides/.draft/<slide-id>.png`
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
