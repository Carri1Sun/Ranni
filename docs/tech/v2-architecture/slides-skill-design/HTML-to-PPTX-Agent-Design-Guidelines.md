---
author: manus
version: v2
date: 2026-07-07
subject: HTML-to-PPTX Agent 设计与排版执行规范
audience: 负责生成幻灯片 HTML 代码的 coding agent
related: ../slides-skill-plan.md、../slides-skill-developer-guide.md、../html-to-pptx-export-guide.md
---

# HTML to PPTX Agent 设计与排版执行规范

> **目标受众**: 负责生成幻灯片 HTML 代码的 Coding Agent
> **技术栈背景**: Agent 输出 HTML/CSS，随后通过 `dom-to-pptx` (或类似 DOM 映射工具) 转换为原生 PPTX。
> **核心目标**: 确保生成的 HTML 具有顶级的平面设计美感，同时保证在 DOM 映射到 PPTX 过程中的高保真度和兼容性。

---

## 1. 容器与画布约束 (Canvas Constraints)

为了保证 HTML 在 16:9 画幅下完美适配 PPTX 尺寸，必须严格控制外层容器。

### 🟢 DOs (必须执行)
- **固定视口**: 必须设定一个全局外层容器（如 `.slide-container`），并严格锁定尺寸为 `width: 1280px; min-height: 720px;`。
- **盒模型**: 全局应用 `box-sizing: border-box;`。
- **溢出控制**: 在外层容器使用 `overflow: hidden;`，确保装饰元素不会撑破画布。
- **高度控制**: 所有的内部内容块（Content Blocks）必须使用 `min-height` 而不是固定的 `height`，防止文本过多时发生内容截断。

### 🔴 DON'Ts (绝对禁止)
- **禁止使用 Padding Bottom**: 在外层容器或主要内容流中，**绝对禁止**使用 `padding-bottom`。仅使用 `padding-top` 和 `margin-bottom` 来控制垂直间距，以防止在映射 PPTX 时计算整体高度出错导致溢出。
- **禁止全局垂直居中**: 不要对外层容器使用 `align-items: center` 强制全局垂直居中，这会导致多页幻灯片的标题高度跳跃。应使用固定的 `padding-top`（如 80px）来对齐所有页面的主标题。

---

## 2. 视觉美学与排版 (Aesthetics & Typography)

幻灯片是静态的演示媒介，必须摒弃“网页 UI 感”，追求“杂志级平面设计感”。

### 🟢 DOs (必须执行)
- **极简字体栈**: 每套幻灯片最多使用 2 种字体（建议统一使用 1 种无衬线几何字体，如 `Space Grotesk`, `Inter`, `Montserrat`）。
- **严格的字号层级**: 必须遵循固定的字号阶梯。例如：
  - 封面大标题: `64px`
  - 内容页标题: `32px`
  - 重点副标题/强调数据: `24px` - `28px`
  - 正文文本: `16px` - `20px`
- **充足的留白 (White Space)**: 文本行高 (`line-height`) 建议设置为 `1.5` 到 `1.6`。不同内容块之间的 `gap` 或 `margin-bottom` 至少为 `30px`。
- **水平布局优先**: 幻灯片适合横向阅读。多条并列信息必须使用 CSS Grid (`grid-template-columns: repeat(X, 1fr)`) 或 Flexbox 进行水平并排展示。

### 🔴 DON'Ts (绝对禁止)
- **禁止“网页感” UI 组件**: **绝对禁止**使用大圆角 (`border-radius: >8px`)、带有严重投影的卡片 (`box-shadow`)。
- **禁止任何动画**: **绝对禁止**使用 CSS 动画、`@keyframes`、`transition` 或 `:hover` 伪类。幻灯片是静态的，动画会导致截图或解析引擎出错。
- **禁止过长的文本**: 每页幻灯片的正文段落不应超过 3 段，每段不超过 3 行。长文本必须提炼为带有图标或小标题的列表。

---

## 3. 装饰元素与色彩 (Decoration & Colors)

### 🟢 DOs (必须执行)
- **限制色彩数量**: 每页幻灯片除了黑/白/灰背景外，最多只能使用 2-3 种主题色（主色、辅色、强调色）。
- **绝对定位的背景装饰**: 使用 `position: absolute; z-index: 1;` 放置背景几何图形（如大圆、色块）。这可以极大地提升设计感，同时不会干扰 `dom-to-pptx` 对正常文本流的解析。
- **视觉锚点**: 建议在每页的固定位置（如右上角或左下角）放置一个巨型的、低透明度的页码（如 `120pt`, `opacity: 0.1`），作为视觉锚点。

### 🔴 DON'Ts (绝对禁止)
- **禁止复杂的内联 SVG 绘图**: 不要尝试在 HTML 中直接手写复杂的 `<svg>` 路径绘图。如果需要插图，请使用标准的 `<img>` 标签引入外部图片。
- **禁止复杂的 CSS 渐变**: 尽量使用纯色或极简的单向线性渐变。复杂的径向渐变或多重渐变在转换为 PPTX 原生形状时极易丢失或变异。

---

## 4. DOM 映射与 PPTX 兼容性优化 (DOM-to-PPTX Compatibility)

这是确保 HTML 能够被解析器完美转换为 PPTX 元素的关键。

### 🟢 DOs (必须执行)
- **明确的层级结构 (z-index)**: 背景层 (`z-index: 1`)，主内容层 (`z-index: 10`) 必须严格分离。这有助于映射引擎将背景元素识别为 PPT 的底层形状，将文本识别为顶层文本框。
- **图片尺寸硬编码**: 所有 `<img>` 标签或包含背景图的 `<div>`，必须具有明确的像素级宽度和高度（如 `width: 400px; height: 300px;`），并配合 `object-fit: contain;`。禁止使用百分比宽度，防止解析器无法计算绝对坐标。
- **使用标准 Web 字体或系统字体**: 如果使用了 Google Fonts，确保在 CSS 中提供安全的 Fallback 字体（如 `sans-serif`）。

### 🔴 DON'Ts (绝对禁止)
- **禁止在主内容区使用绝对定位**: 除了背景装饰物，**绝对禁止**对包含文本的主内容（标题、段落、列表）使用 `position: absolute`。必须使用 Flexbox 或 Grid 进行标准文档流布局。绝对定位的文本极易在映射时发生坐标偏移或重叠。
- **避免深层嵌套的 Flex/Grid**: 尽量保持 DOM 结构扁平。超过 4 层的 Flex 嵌套可能会导致部分轻量级 DOM 解析器计算坐标失败。
- **禁止使用 CSS 伪元素注入关键内容**: 不要使用 `::before` 或 `::after` 的 `content: "关键文本"` 来注入重要文字。很多解析器无法提取伪元素中的文本。伪元素仅限用于纯装饰（如画一条线或一个圆点）。

---

## 5. 组件级建议 (Component Recommendations)

- **图标库**: 推荐使用 Font Awesome 等基于类名的字体图标（如 `<i class="fas fa-rocket"></i>`）。它们在映射时通常会被解析为普通文本符号，保留矢量特性且容易变色。
- **数据可视化**: 如果使用 Chart.js 或 D3.js，**必须**将其 Canvas 放置在一个拥有固定像素高度和宽度的父级 `<div>` 中。映射引擎通常会等待 Canvas 渲染完成后，将其截取为 Base64 图片插入 PPTX。
- **表格**: 使用标准的 `<table>`, `<tr>`, `<td>` 结构。大多数 `dom-to-pptx` 库对标准表格标签有专门的原生映射逻辑。避免用 Flexbox 强行模拟表格。
