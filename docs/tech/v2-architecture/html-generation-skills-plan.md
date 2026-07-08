---
author: manus
version: v2
date: 2026-07-08
---

# HTML 与 HTML-to-PPTX Skill 结构

本文档记录网页创作和 HTML-to-PPTX 两条能力的拆分方案、共享设计选择机制和调研来源。

## 代码调研来源

- `lib/skills/registry.ts`：Ranni 通过扫描 `skills/*/SKILL.md` 注册动态 skill，并读取同目录 `tools.ts` 暴露专属工具。
- `lib/tools.ts`：`ToolSettings` 是前端到 `/api/runs` 再到工具上下文的透传结构。
- `lib/agent.ts`：`activeSkills` 对应的 SKILL 正文进入 system prompt，适合注入模板和风格约束。
- `src/server/app.ts`：`toolSettingsSchema` 校验前端透传，`/api/skills` 和模板列表接口向前端提供选择项。
- `components/agent-console.tsx`：输入框快捷 skill 开关通过 `extraActiveSkills` 写入 `toolSettings.activeSkills`。
- `skills/html-to-pptx/tools.ts`：现有 HTML-to-PPTX 工具链已经通过 workspace resolver、Playwright、dom-to-pptx 和 QA 报告稳定执行。

## 公开调研来源

- Material Design responsive layout grid：<https://m2.material.io/design/layout/responsive-layout-grid.html>
- Carbon Design System 2x Grid：<https://carbondesignsystem.com/elements/2x-grid/overview/>
- Nielsen Norman Group Homepage Design Principles：<https://www.nngroup.com/articles/homepage-design-principles/>
- Nielsen Norman Group How People Read Online：<https://www.nngroup.com/articles/how-people-read-online/>
- Nielsen Norman Group Forms：<https://www.nngroup.com/topic/forms/>
- Nielsen Norman Group UX Design Portfolios：<https://www.nngroup.com/articles/ux-design-portfolios/>
- Baymard Product Page UX：<https://baymard.com/blog/current-state-ecommerce-product-page-ux>
- W3C WCAG 2.2 Contrast Minimum：<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
- web.dev Responsive web design basics：<https://web.dev/articles/responsive-web-design-basics>
- web.dev Web Vitals：<https://web.dev/articles/vitals>
- Apple HIG Typography：<https://developer.apple.com/design/human-interface-guidelines/typography>

## Skill 拆分

### `html`

用途：生成静态网页。该 skill 不导出 PPTX，默认产物是 `index.html`、`styles.css`、`assets/`、`preview/` 和 `qa-report.json`。

工具：

- `init_html_workspace`：在 session workspace 内创建静态网页目录，写入初始 HTML/CSS 和生成报告。
- `validate_static_html`：用 Playwright 渲染桌面与移动视口，生成预览截图和 QA 报告。

### `html-to-pptx`

用途：生成可有限编辑的 `.pptx`。该 skill 沿用受限 slide HTML 路线，工具链为初始化、准备、导出和验证。

工具：

- `init_slide_html_workspace`
- `prepare_slide_html_for_pptx`
- `export_html_to_pptx`
- `validate_html_pptx_export`

## 共享设计选择

共享 catalog 位于 `lib/html-design/catalog.ts`。

设计风格：

- `minimal-saas`
- `bento-grid`
- `neo-brutalism`
- `neumorphism`
- `glassmorphism`
- `flat-illustration`
- `pixel-retro`
- `muji-minimal`
- `editorial-magazine`
- `future-tech`

网页类型模板：

- `product-intro`
- `waitlist-teaser`
- `feature-launch`
- `knowledge-explainer`
- `interactive-tutorial`
- `personal-homepage`
- `portfolio`
- `studio-service`
- `event-course`
- `data-insight`

`html` skill 同时使用设计风格和网页类型模板。`html-to-pptx` skill 使用设计风格和 PPTX 模板包。agent system prompt 通过 `buildHtmlDesignRuntimeInstruction` 和 `buildHtmlToPptxTemplateRuntimeInstruction` 注入具体规则、来源和限制。

## API

- `GET /api/html-design/options`：返回设计风格和网页类型模板。
- `GET /api/html-to-pptx/templates`：返回 PPTX 模板包。
- `GET /api/slides/templates`：保留兼容入口，返回同一组 PPTX 模板包。
- `POST /api/runs`：接收 `toolSettings.htmlDesign` 和 `toolSettings.htmlToPptx`。

## 前端交互

输入框快捷能力区提供两个互斥按钮：

- `网页`：强制加载 `html` skill，展示设计风格和网页类型。
- `PPTX`：强制加载 `html-to-pptx` skill，展示设计风格和 PPTX 模板。

选择卡片展示预览图、名称和说明。预览资源由 `npm run html-design:previews` 生成到 `public/html-design-previews/`。

## 当前限制

- 网页类型模板目前提供结构和指导，不提供完整站点内容生成器；具体内容仍由 agent 根据用户 prompt 创作。
- 静态网页 QA 只做 title、lang、正文量、图片 alt、链接文本和水平溢出 smoke check。
- HTML-to-PPTX 继续受 `dom-to-pptx` CSS 覆盖能力限制，复杂视觉仍使用局部截图回退。
