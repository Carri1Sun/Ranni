# Bento Grid 风参考资料

## 来源

- Carbon Design System 2x Grid: https://carbondesignsystem.com/elements/2x-grid/overview/
- Material Design Responsive Layout Grid: https://m2.material.io/design/layout/responsive-layout-grid.html
- W3C WCAG 2.2 Contrast Minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html

这些 URL 仅用于人工溯源。以下内容已经把来源思路本地化，agent 运行时不要访问外部 URL。

## 本地化来源笔记

### Carbon 2x Grid

- 2x Grid 的核心是通过二分和倍增形成视觉节奏。流体网格用空间分割得到列，固定网格用固定尺寸单元平铺和换行。
- columns 和 rows 会形成 key lines。Bento 卡片的边缘、标题起点、数字基线、图标中心和截图边界都应落在这些 key lines 上。
- 在同一断点内，列数应保持稳定，单元尺寸可以随屏幕宽度变化；这让卡片在不同视口下保持同一种结构逻辑。
- 固定 margin、padding 和 gutter 可以让信息块密集时仍有秩序。对于 dense content，可使用更小的 mini units 继续对齐内部元素。
- Bento 不是随机拼贴。主卡片、中卡片和小卡片的跨度应来自内容权重，而不是视觉趣味。

### Material Responsive Layout Grid

- 响应式布局需要 columns、gutters、margins 共同定义。卡片内容放在 columns 里，gutters 负责区分模块，margins 控制页面呼吸感。
- 断点应按内容需要设置。桌面端可展示拼图式信息结构，移动端应按业务优先级排序，而不是保留桌面视觉顺序。
- 卡片内边距和卡片间 gap 需要来自同一尺度体系，避免卡片很多时出现视觉噪声。

### WCAG Contrast Minimum

- 每张卡片里的标签、说明、图标文本、数字和 CTA 都要满足对比要求。Bento 页面常用浅彩底，容易让次级文字过浅。
- 不要只靠颜色区分主卡片和普通卡片。还应使用尺寸、位置、标题层级、边框强度和内容密度建立主次。

## 可提炼设计原则

- Bento Grid 适合把多个卖点、截图、指标和功能状态放进同一屏。关键是明确哪个模块最大、哪个模块支持，避免所有卡片等权。
- 网格应有可解释的尺度系统。列数、gap、卡片跨度和边距保持规律，卡片边缘和文本起点落在一致 key lines 上。
- 每张卡片只承担一个信息任务。卡片标题说明结论，说明文字补充细节，图像或数字提供证据。
- 大卡片负责主叙事，例如核心截图、关键指标或最强卖点。中小卡片负责补充场景、集成、步骤、状态和证明。
- 多卡片页面容易产生视觉噪声。需要控制背景色、边框、图标尺寸和标签样式，让用户能按权重扫描。

## 版式和组件

- 桌面端可使用 12 列或 16 列网格，让主卡片跨 6 到 8 列，中卡片跨 3 到 4 列，小卡片跨 2 到 3 列。
- 卡片内部使用固定结构：标签、标题、说明、视觉资产或数据。不要让不同卡片的文本起点和内边距随机变化。
- 图片和图表放入固定比例容器。卡片内图形宁可简化，也要确保文本和视觉不会互相挤压。
- 移动端按重要性线性化。桌面端的拼图顺序不能成为小屏阅读顺序的唯一依据。

## 常见失误

- 只做很多圆角卡片，缺少一个主卡片承担页面焦点。
- 卡片高度随内容任意变化，破坏网格节奏。
- 强调色过多，导致每个卡片都像 CTA。
- 小屏直接保留复杂多列布局，正文和截图变得不可读。
