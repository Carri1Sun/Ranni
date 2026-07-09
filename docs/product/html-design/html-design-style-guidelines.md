---
author: codex
version: v1
date: 2026-07-08
---

# HTML 设计风格指导

本文档说明 10 个设计风格内容资产的维护规范。公共底线适用于所有风格：响应式布局、清楚标题层级、正文可扫读、普通文本对比度至少 4.5:1、大文本至少 3:1、图片有 alt、CTA 文案明确。

## 文件规范

设计风格内容资产位于 `skills/html-design/styles/*/`。每个目录对应一个设计风格，目录名建议使用数字前缀保留默认排序，例如 `01-minimal-saas/`。

frontmatter 必须包含：

- `id`：稳定标识，用于 API、工具参数和预览文件名。
- `name`：前端展示名称。
- `description`：前端展示短说明。
- `accentColor`、`surfaceColor`：6 位十六进制颜色。
- `preview`：浏览器可访问的预览图路径。
- `tags`：JSON 兼容的 flow 字符串数组。
- `sources`：机器参考来源，指向同目录本地参考资料，例如 `["reference.md#来源"]`，catalog 不解析该字段，也不传给 agent。

`guide.md` 正文只写 agent guidance，推荐使用 Markdown 列表。`lib/html-design/catalog.ts` 会把列表项转为 `guidance: string[]`。加载失败时该目录会被跳过；全部目录不可用时返回空列表。

`skills/html-design/reference-materials/base-html-design-guide.md` 是 HTML 创作的产品级基础 guide，`html` 和 `html-to-pptx` skill 激活时会由 runtime instruction registry 注入。单个 style 的 `guide.md` 只记录本地参考资料路径，不反向引用本地 guide。

每个设计风格可以在同目录放置 `reference.md`。参考资料使用本地化来源笔记、设计思路、来源链接、组件建议和常见失误；默认 prompt 只提供本地路径，并提示 agent 在需要更细致的设计思路了解时阅读参考资料。参考资料已承载来源思路，运行时不需要访问外部 URL。

## 调研来源

- 本地运行资料：`skills/html-design/reference-materials/base-html-design-guide.md`
- Material Design Responsive layout grid：<https://m2.material.io/design/layout/responsive-layout-grid.html>
- Carbon Design System 2x Grid：<https://carbondesignsystem.com/elements/2x-grid/overview/>
- Nielsen Norman Group Homepage Design Principles：<https://www.nngroup.com/articles/homepage-design-principles/>
- Nielsen Norman Group How People Read Online：<https://www.nngroup.com/articles/how-people-read-online/>
- W3C WCAG 2.2 Contrast Minimum：<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- web.dev Web Vitals：<https://web.dev/articles/vitals>
- Apple HIG Typography：<https://developer.apple.com/design/human-interface-guidelines/typography>

## 极简 SaaS 风

- 适合：产品介绍页、等候名单页、功能发布页。
- 布局：首屏大留白，主标题、简短解释、一个主 CTA 和一个次 CTA；下方用 3 到 4 个清楚功能块展开。
- 视觉：浅色背景，主色控制在一个，阴影极轻，靠边框、留白和字号层级建立秩序。
- 文案：首屏直接说明产品解决的问题、目标用户和核心收益。
- 兼容性：避免复杂背景和过量动画；图片使用固定比例容器，移动端单列堆叠。
- 来源：本地产品输入、NN/g 首页价值主张、Material 响应式网格、WCAG 对比度。

## Bento Grid 风

- 适合：功能展示、产品卖点、个人主页、数据总结。
- 布局：使用 12 或 16 列网格，主信息占大卡片，辅助信息占小卡片，同屏信息有明确主次。
- 视觉：卡片尺寸形成节奏，卡片内部固定标题、数字、说明和图标顺序。
- 文案：每个模块只表达一个观点，标题可以短，说明要具体。
- 兼容性：移动端按重要性排序，所有卡片转为单列或双列；避免 masonry 造成阅读顺序混乱。
- 来源：本地产品输入、Carbon 2x Grid、Material responsive grid。

## 新粗野派风

- 适合：创作者工具、年轻化产品、社区项目。
- 布局：粗线框和硬阴影可以强烈，但所有元素仍需按网格对齐。
- 视觉：高对比、大色块、实体按钮和夸张标题，黑色边框形成统一视觉语言。
- 文案：语气可以直接、有态度，但说明和 CTA 保持清楚。
- 兼容性：大色块必须通过 WCAG 对比度；硬阴影用纯 CSS，避免依赖 hover 才能理解层级。
- 来源：本地产品输入、Material 网格、NN/g 扫读研究、WCAG 对比度。

## 新拟态风

- 适合：轻量工具、健康类、个人页、生活方式内容。
- 布局：使用浅色背景和柔和组件，重点内容仍要靠字号、间距和位置突出。
- 视觉：阴影和高光成对出现，边缘柔和，控件像从背景中浮起。
- 文案：语气平静，内容密度偏低。
- 兼容性：按钮、输入框和正文不能因低对比而不可读；移动端减少阴影层数。
- 来源：本地产品输入、Apple Typography、WCAG 对比度。

## 玻璃拟态风

- 适合：AI、Web3、未来感产品、实验性工具。
- 布局：背景可使用渐变或暗色图层，核心内容放在低噪声区域。
- 视觉：半透明卡片、模糊、细边框和少量发光建立空间层次。
- 文案：首屏信息要短，避免长正文压在复杂背景上。
- 兼容性：重要文字必须有实色或低噪声底；模糊和阴影数量要少，避免影响性能。
- 来源：本地产品输入、WCAG 对比度、web.dev Web Vitals。

## 扁平插画风

- 适合：教育、知识讲解、活动报名、轻产品。
- 布局：图解、步骤和示例应服务理解，插画与内容块成组出现。
- 视觉：明亮但克制的配色，图标和插画统一笔触、圆角和色彩系统。
- 文案：解释内容要拆成短段、步骤和小结。
- 兼容性：插画不能承载关键文字；移动端插画可缩小或后置。
- 来源：本地产品输入、NN/g 扫读研究、WCAG 对比度。

## 像素复古风

- 适合：游戏、开发者项目、开源工具、meme 社区。
- 布局：像素边框、终端式模块和硬切色块，阅读顺序保持线性。
- 视觉：等宽字体、低分辨率图标、复古按钮和高对比色块。
- 文案：可以更有趣，但正文要保持清楚行高。
- 兼容性：像素字体只用于标题或标签，长正文使用可读字体；移动端减少密集装饰。
- 来源：本地产品输入、NN/g 扫读研究、WCAG 对比度。

## 素雅 Muji 风

- 适合：个人主页、生活方式、知识内容、手作品牌。
- 布局：留白、细线、窄正文和少量图片形成安静节奏。
- 视觉：米白、浅灰、木色和淡黑文字；圆角小，装饰少。
- 文案：语气克制，重点放在内容质感和真实信息。
- 兼容性：低饱和配色仍要满足对比度；避免全页面米色导致层级消失。
- 来源：本地产品输入、Apple Typography、WCAG 对比度。

## 杂志编辑风

- 适合：知识讲解页、报告页、个人品牌页、长阅读内容。
- 布局：大标题、章节编号、栏目感、图片穿插和引用块建立阅读节奏。
- 视觉：避免所有内容卡片化，使用分割线、栏宽和图文比例表达层级。
- 文案：标题要有信息量，正文宽度控制在舒适阅读区间。
- 兼容性：移动端改为单栏阅读，引用块不压缩正文宽度。
- 来源：本地产品输入、NN/g 扫读研究、Apple Typography。

## 未来科技风

- 适合：AI、开发者工具、数据产品、趋势报告。
- 布局：深色背景上使用网格、数据面板、流程线和指标卡。
- 视觉：蓝、绿、青等荧光色只用于强调；发光和线框数量受控。
- 文案：指标和结论优先，技术描述服务用户收益。
- 兼容性：深色主题检查正文对比度；动效和发光避免影响 Web Vitals。
- 来源：本地产品输入、WCAG 对比度、web.dev Web Vitals。
