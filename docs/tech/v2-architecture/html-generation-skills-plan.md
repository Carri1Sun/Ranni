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
- `lib/agent.ts`：`activeSkills` 对应的 SKILL 正文进入 system prompt，运行时增强指令从统一 registry 注入。
- `lib/skills/runtime-instructions.ts`：集中注册按 skill 注入的 runtime instruction builder，隔离具体 skill 的 `toolSettings` 拼装细节。
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

共享 catalog 的内容资产位于 `skills/html-design/`，`lib/html-design/catalog.ts` 负责加载、校验、查询和生成 prompt 片段。TypeScript 代码不保存设计内容 fallback，目录缺失、单个文件解析失败或全部文件不可用时返回空数组，前端沿用现有空态和禁用逻辑。

资产目录：

- `skills/html-design/styles/*/guide.md`：设计风格 guidance。
- `skills/html-design/styles/*/reference.md`：同目录设计风格参考资料。
- `skills/html-design/patterns/*/guide.md`：HTML 页面 pattern guidance。
- `skills/html-design/patterns/*/reference.md`：同目录页面 pattern 参考资料。
- `skills/html-design/reference-materials/base-html-design-guide.md`：运行时注入的产品级基础 guide。

每个 Markdown 文件使用 frontmatter 保存字段：

- 运行时字段：`id`、`name`、`description`、`accentColor`、`surfaceColor`、`preview`、`tags`。
- 页面 pattern 额外字段：`sections`。
- `sources` 是机器参考字段，指向同目录本地参考资料，例如 `["reference.md#来源"]`。catalog 不解析该字段，API 和 runtime prompt 都不返回外部 URL。
- `tags`、`sections` 使用 JSON 兼容的 flow 数组写法，便于 loader 直接解析。
- 正文使用 Markdown 列表保存 agent 可执行的 guidance，loader 会转成 API 返回结构中的 `guidance: string[]`。
- 每个资产目录内的 `reference.md` 使用本地化来源笔记、设计推导、常见失误和组件建议承载参考资料。默认 runtime prompt 不注入参考资料正文，只在同目录文件存在时提供本地路径，并提示 agent 在需要更细致的设计思路了解时阅读参考资料。参考资料已包含来源思路，agent 运行时不需要访问外部 URL。

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

`html` skill 同时使用设计风格和网页类型模板。`html-to-pptx` skill 只使用设计风格，并继续由 agent 根据用户内容规划 deck 叙事、页面结构和截图回退边界。

## Runtime instruction registry

`lib/skills/runtime-instructions.ts` 是 skill runtime instruction 的统一入口。`lib/agent.ts` 只把 `activeSkillNames` 和 `toolSettings` 传给 `buildSkillRuntimeInstructions`，不直接感知 `htmlDesign`、`htmlToPptx` 或 HTML design prompt 的拼装方式。

当前 registry 包含：

- `html`：先注入 `skills/html-design/reference-materials/base-html-design-guide.md` 作为产品级基础 guide，再读取 `toolSettings.htmlDesign`，注入设计风格和页面 pattern 规则，以及可选参考资料路径。
- `html-to-pptx`：先注入同一份产品级基础 guide，再读取 `toolSettings.htmlToPptx.styleId`，只注入设计风格规则和可选参考资料路径，不提供 PPTX 模板选择。

运行时资料必须放在 `skills/` 下。`docs/` 只保存开发和产品文档，不能作为 agent runtime instruction 或 SKILL 行为约束的读取来源。

新增 skill 需要 runtime 增强指令时，应在 registry 中新增 builder，让 agent 主循环保持稳定。

## API

- `GET /api/html-design/options`：返回设计风格和网页类型模板。
- `POST /api/runs`：接收 `toolSettings.htmlDesign` 和 `toolSettings.htmlToPptx`。

## 前端交互

输入框快捷能力区提供两个互斥按钮：

- `网页`：强制加载 `html` skill，展示设计风格和网页类型。
- `PPTX`：强制加载 `html-to-pptx` skill，只展示设计风格；页面结构由 agent 根据用户内容规划。

选择卡片展示预览图、名称和说明。预览资源由 `npm run html-design:previews` 生成到 `public/html-design-previews/`。

## 当前限制

- 网页类型模板目前提供结构和指导，不提供完整站点内容生成器；具体内容仍由 agent 根据用户 prompt 创作。
- 静态网页 QA 只做 title、lang、正文量、图片 alt、链接文本和水平溢出 smoke check。
- HTML-to-PPTX 继续受 `dom-to-pptx` CSS 覆盖能力限制，复杂视觉仍使用局部截图回退。
