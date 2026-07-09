---
name: html
description: Use when the user wants to create a static webpage, landing page, personal site, portfolio, product page, tutorial, event page, or data insight page. Creates editable HTML/CSS in the session workspace and validates responsive previews with Playwright.
---

# HTML 技能

## 何时使用

用户要生成静态网页、产品介绍页、等候名单页、功能发布页、知识讲解页、教程页、个人主页、作品集、服务官网、活动报名页或数据洞察页，并希望得到可直接打开或继续编辑的 HTML/CSS。

## 默认创作路线

HTML skill 只负责静态网页产物，不导出 PPTX。创作时先初始化 workspace，再编辑 HTML/CSS，最后用浏览器预览和 QA 检查。

工具顺序：

1. `init_html_workspace`：创建 `index.html`、`styles.css`、`assets/`、`preview/`、`qa-report.json` 和可选 `prompt.txt`。如果 run 选择了设计风格或网页类型，必须传入对应 `styleId` 和 `templateId`，工具也会从 `toolSettings.htmlDesign` 读取默认值。
2. 编辑 `index.html` 和 `styles.css`：使用语义化 HTML、响应式布局、清楚标题层级、明确图片 alt 和可访问 CTA。
3. `validate_static_html`：用 Playwright 渲染桌面和移动视口，保存 `preview/desktop.png`、`preview/mobile.png`，检查标题、正文量、图片 alt、空链接和水平溢出，并写出 `qa-report.json`。

## 设计风格和网页类型

如果本次 run 选择了设计风格，必须遵守 system prompt 中的 `HTML design selection`。如果选择了网页类型模板，页面结构必须覆盖对应 section pattern。产品级基础 guide 会由 runtime instruction registry 从 `skills/html-design/reference-materials/base-html-design-guide.md` 注入，设计风格和网页类型是补充约束。

设计内容资产存放在：

- `skills/html-design/styles/*/guide.md`
- `skills/html-design/styles/*/reference.md`
- `skills/html-design/patterns/*/guide.md`
- `skills/html-design/patterns/*/reference.md`

system prompt 中出现“参考资料”路径时，在需要更细致的设计思路了解时，阅读参考资料；参考资料已包含本地化来源笔记，不需要访问外部 URL。

## 静态网页约束

- 输出必须是可直接浏览器打开的静态 HTML/CSS，默认入口为 `index.html`。
- 所有路径必须落在当前 session workspace 内。
- 默认目录保留 `assets/`、`preview/` 和 `qa-report.json`。
- 使用响应式 CSS，至少保证桌面宽度和移动宽度不出现水平滚动。
- 正文文本使用真实 DOM 文本，避免把重要文字烘焙进图片。
- 图片、图标和插画必须有可读 alt；纯装饰图片使用空 alt。
- 表单字段要有 label；CTA 文案说明用户点击后会得到什么。
- 不依赖远程构建步骤；如需外部字体或图片，优先下载或替换为本地资产。

## 交付边界

- HTML skill 生成静态网页，不负责部署、后端表单提交、登录系统、数据库或 CMS。
- 复杂交互可以用少量原生 JS，但必须在 `validate_static_html` 后确认页面可渲染。
- 视觉审美由设计风格和网页类型约束；QA 只做客观 smoke check。
