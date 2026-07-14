# Default Business 示例 Deck 准则

## 定位

适合商务汇报、研究摘要、产品策略、技术方案、项目复盘和数据解读。视觉气质应稳定、清晰、可编辑，避免网页 UI 化。

## 必须遵守

- 每页使用现有 `.slide` 结构，固定 `1280px x 720px`。
- 示例页只用于脚本验收；真实用户 deck 应按用户内容重新规划页面结构。
- 关键标题、正文、列表、表格文字必须保留为 DOM 文本，并标记 `data-pptx-editable`。
- chip、指标值、数字单位和短标题必须保持为叶子节点，设置 `white-space: nowrap; word-break: keep-all; overflow-wrap: normal;`，并至少预留 `5%`、不低于 `8px` 的横向余量。
- 中文内容使用覆盖 Latin/CJK 的确定字体；转换器会加载并嵌入 Noto Sans SC 字符子集，品牌字体需通过合法可嵌入的 `@font-face` 提供。
- 复杂图表、canvas、密集 SVG、多层视觉组合必须放进固定尺寸容器，并标记 `data-pptx-raster` 和 `data-pptx-alt`。
- 图片和图形资产放入 `assets/`，引用相对路径，并硬编码宽高或让 CSS 明确尺寸。
- 使用稳定的颜色、字号、间距和低圆角，不使用 `box-shadow`、动画、hover 或主内容绝对定位。

## 页面选择

- `cover`：主题明确、少量说明和底部元信息。
- `agenda`：4 个以内章节，使用编号和简短说明。
- `text`：概念解释、方法边界、核心原则。
- `two-column`：左侧文字、右侧资产或图示。
- `data-table`：指标、对比、QA 或小型表格。
- `chart-raster`：复杂图表或需要视觉稳定性的页面。
- `timeline`：阶段、路线图、里程碑。
- `summary`：结论、下一步和关键取舍。

## 输出要求

导出前如果发现受限 HTML 规则被破坏，应先修复 HTML/CSS，再继续 prepare/export/validate。
