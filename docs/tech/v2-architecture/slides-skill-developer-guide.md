---
author: manus
version: v2
date: 2026-07-07
subject: Ranni slides skill 开发执行指南（HTML-to-PPTX）
audience: 实现 slides skill 的 coding agent
prerequisites: skill 动态加载机制已落地（skill-dynamic-loading-plan.md Task 1–6 完成）
related: slides-skill-plan.md、html-to-pptx-export-guide.md、slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md、skill-dynamic-loading-plan.md
---

# Ranni slides skill 开发执行指南

## 0. 本指南定位

这是给 coding agent 的执行手册，说明当前 slides skill 的 HTML-to-PPTX 实现方式、文件边界、工具职责和验收步骤。

当前能力链路：

```text
init_slide_html_workspace
-> 编辑 deck.html / styles.css
-> prepare_slide_html_for_pptx
-> export_html_to_pptx
-> validate_html_pptx_export
```

## 1. 开工前检查

- 确认 `npm run typecheck` 基线可运行。
- 确认 `lib/tools.ts` export `ToolDefinition` 与 `ToolExecutionContext`。
- 确认 `lib/workspace.ts` export `getWorkspaceRoot`、`resolveWorkspacePath`、`toWorkspaceRelative`。
- 确认 `package.json` 包含 `dom-to-pptx`、`playwright`、`jszip`、`pixelmatch`、`pngjs`。
- 确认本机可用 Playwright Chromium 或 Google Chrome。
- 如需 PPTX preview，确认 LibreOffice 和 Poppler 可用。

## 2. 文件清单

```text
skills/slides/
  SKILL.md
  tools.ts
  scripts/html-pptx/
    lib.mjs
    prepare.mjs
    export.mjs
    validate.mjs
  templates/default-business/
    deck.html
    styles.css
    manifest.json
    tokens.json
    guidance.md
    assets/

scripts/
  slides-html-pptx-spike.ts

docs/tech/v2-architecture/slides-skill-design/
  HTML-to-PPTX-Agent-Design-Guidelines.md
```

`SKILL.md` 是 agent 选择路线的主要提示来源，必须保持为 HTML-to-PPTX 单一路线说明。

`tools.ts` 只保留 schema、workspace resolver、模板初始化和脚本调度；Playwright、LibreOffice、Poppler、`dom-to-pptx` 和 PPTX/PNG 检查逻辑放在 `scripts/html-pptx/*.mjs`。模板 registry 由 `lib/slides/templates.ts` 扫描 `skills/slides/templates/*/manifest.json`。

## 3. 工具实现要求

### `init_slide_html_workspace`

- 输入 `deckSlug`、可选 `dir`、`title`、`prompt`、`template`、`templateId`、`overwrite`。
- 通过 workspace resolver 创建 deck 目录。
- 创建 `deck.html`、`styles.css`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/`、`final/`。
- 传入 `prompt` 时写入 `prompt.txt` 和 `html-generation-report.json`。
- `template: "spike-sample"` 从默认模板包拷贝 8 页示例 deck。
- `templateId` 或 `toolSettings.slides.templateId` 可指定模板包，优先级高于 `template` 默认值。
- `html-generation-report.json` 记录 `templateId`、`templateName` 和 `templateVersion`。

### `prepare_slide_html_for_pptx`

- 用 Playwright 打开 `deck.html`。
- 等待字体和首帧渲染完成。
- 校验每个 `.slide` 的尺寸、滚动状态和 `data-slide-id`。
- 统计 `data-pptx-editable` 与 `data-pptx-ignore`。
- 检查设计准则：动画、hover、padding-bottom、box-shadow、大圆角、主内容绝对定位、标题字号、正文行高、图片尺寸和 DOM 嵌套深度。
- 在转换前截图每个 `data-pptx-raster` 节点，保存到 `fallback-assets/`。
- 用同尺寸 `<img>` 替换截图回退节点；普通流和 `position: relative` 节点原地替换，绝对定位装饰按 slide 坐标回放。
- 写出 `measurements.json`，包含 slide 测量、截图回退、warning。

### `export_html_to_pptx`

- 用 Playwright 打开 `deck.prepared.html`。
- 将 workspace 内本地 `<img>` 内联为 data URI，避免 `dom-to-pptx` 跳过相对路径或 `file://` 图片。
- 注入 `dom-to-pptx` browser bundle。
- 只把 `.slide` 节点作为导出页。
- 设置 16:9 宽高、标题、作者。
- 写出 `final/<deck-slug>.pptx`。

### `validate_html_pptx_export`

- 清理并重建 `preview-html/` 与 `preview-pptx/`。
- 用 Playwright 输出 HTML 逐页 PNG。
- 尝试用 LibreOffice 转 PDF，再用 Poppler 输出 PPTX 逐页 PNG。
- 用 `jszip` 检查 PPTX slide XML、文本 run 和图片对象数量，并与 prepared HTML 图片数量对齐。
- 用 `pixelmatch` 和 `pngjs` 执行客观视觉 smoke check，只记录空白页风险、预览页数不一致和大范围视觉漂移。
- 写出 `qa-report.json`。

## 4. 受限 HTML 编写规则

- 每页使用 `.slide`，固定 `1280px x 720px`。
- 页面、deck 和 slide 都避免滚动。
- 每页设置唯一 `data-slide-id`。
- 关键文本加 `data-pptx-editable`。
- 复杂视觉加 `data-pptx-raster` 和 `data-pptx-alt`。
- 辅助节点加 `data-pptx-ignore`。
- 使用本地 `assets/` 内资源。
- 避免动画、CDN、动态布局和 viewport 字体缩放。
- 遵守 `slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md`：主内容用 Grid/Flex 和标准文档流，文本不使用绝对定位，正文行高保持 1.5 到 1.6，内容块间距至少 30px，卡片圆角不超过 8px，不使用卡片阴影。
- 移除阴影、hover、复杂渐变或绝对定位文本后，必须使用 PPTX 友好的视觉补偿：色带、细边框、分区底色、背景几何块、时间线轨道、节点圆环和页码锚点。

## 5. Spike 示例 deck

`templates/default-business/` 的样例应覆盖：

- 封面
- 目录
- 文本页
- 双栏图文页
- 数据/表格页
- 复杂图表截图回退页
- 时间线页
- 总结页

样例应包含至少一个 `data-pptx-raster` 节点，并保持关键文本可编辑。

## 6. 自动化验收脚本

运行：

```bash
npm run slides:html-spike
```

默认产物目录：

```text
~/Documents/Ranni-Workspace/ranni-session-html-pptx-spike/slides-html-pptx-spike/
```

脚本必须校验：

- 核心产物存在。
- prepared HTML 已把截图回退节点替换为图片。
- `qa-report.json` 无 warning。
- `qa-report.json.designGuidelines.status` 为 `passed`。
- `qa-report.json.preparedHtmlImages.images` 不高于 `qa-report.json.pptxInspection.pictureCount`。
- `qa-report.json.visualSmoke.available` 在 PPTX PNG 预览可用时为 `true`。
- 视觉 smoke check 不产生空白页、页数不一致或高差异 warning。
- `qa-report.json.template.sourceTemplateId` 记录实际模板 ID。
- 样例时间线保留轨道和节点等可映射视觉层级，避免合规后变成平铺卡片。
- slide 数为 8。
- 可编辑元素数量达到样例下限。
- 截图回退数量至少为 1。
- PPTX slide XML 数量匹配 HTML slide 数量。
- PPTX XML 中存在文本 run。
- HTML preview 与 PPTX preview 都有 8 张 PNG。

## 7. 项目验证

代码变更后运行：

```bash
npm run typecheck
npm run lint
npm run build
git diff --check
```

依赖变化后额外运行：

```bash
npm audit
```

## 8. 当前限制

- `dom-to-pptx` 对 CSS 的覆盖有限，实际边界写入 `qa-report.json`。
- 高级图表数据源暂不保持为 PowerPoint 可编辑数据。
- 复杂视觉通过局部图片保证视觉稳定性。
- PPTX preview 依赖本机 LibreOffice 与 Poppler。
- 所有新增工具都应保持 session workspace 边界，禁止写入项目根目录或全局临时目录。
