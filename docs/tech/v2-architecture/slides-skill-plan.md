---
author: manus
version: v2
date: 2026-07-07
subject: Ranni slides skill 实现方案（HTML-to-PPTX）
audience: 执行该能力的 coding agent
baseline: HTML-to-PPTX spike 已接入
prerequisites: skill 动态加载机制已落地（见 skill-dynamic-loading-plan.md）
related: html-to-pptx-export-guide.md、slides-skill-developer-guide.md、skill-dynamic-loading-plan.md
---

# Ranni slides skill 实现方案（HTML-to-PPTX）

## 0. 当前结论

Ranni `slides` skill 当前采用 HTML-to-PPTX 路线：agent 先创作受限 slide HTML，再用 Playwright 完成渲染、DOM 测量和局部截图回退，最后通过 `dom-to-pptx` 导出有限可编辑 `.pptx` 并生成 QA 报告。

早期直出工具已从当前工具注册、skill prompt 和用户文档入口中移除。后续幻灯片生成任务默认进入 HTML 创作与转换链路。

## 1. 目标

- 让 agent 能用 HTML/CSS 快速创作视觉质量更高的 deck。
- 让关键标题、正文、列表、表格文字尽量保留为 PPTX 可编辑文本。
- 让复杂图表、复杂装饰、canvas/SVG 组合视觉通过局部截图回退稳定呈现。
- 让所有输入输出落在当前 session workspace 内。
- 让每次导出都保留 HTML、prepared HTML、预览、测量数据和 QA 报告，便于调试与复现。

## 2. 架构流程

```text
用户幻灯片任务
-> load_skill("slides")
-> init_slide_html_workspace
-> 创作 deck.html + styles.css + assets/
-> prepare_slide_html_for_pptx
-> export_html_to_pptx
-> validate_html_pptx_export
-> final/*.pptx + qa-report.json
```

核心职责：

- `skills/slides/SKILL.md` 描述 slides 任务方法、受限 HTML 规范和工具顺序。
- `skills/slides/tools.ts` 提供四个 HTML-to-PPTX 工具。
- `skills/slides/html-spike-template.ts` 提供 8 页 spike 示例模板。
- `scripts/slides-html-pptx-spike.ts` 提供端到端本地验收入口。

## 3. 工具接口

| 工具 | 输入重点 | 输出重点 |
|---|---|---|
| `init_slide_html_workspace` | `deckSlug`、`dir`、`title`、`prompt`、`template` | `deck.html`、`styles.css`、`assets/`、`fallback-assets/`、`preview-*`、`final/` |
| `prepare_slide_html_for_pptx` | `html`、`outHtml`、`measurementsPath`、`fallbackAssetsDir` | `deck.prepared.html`、`measurements.json`、局部截图资产 |
| `export_html_to_pptx` | `html`、`outPptx`、`title`、`author` | `final/*.pptx` |
| `validate_html_pptx_export` | `html`、`preparedHtml`、`pptx`、`qaReportPath` | HTML preview、PPTX preview、`qa-report.json` |

所有路径参数都必须通过 workspace resolver 解析。工具执行 `cwd` 使用 session workspace。

## 4. 受限 HTML 规范

- 每页是一个 `.slide`。
- 固定尺寸 `1280px x 720px`。
- 页面与 slide 内部使用 `overflow: hidden`。
- 每页必须设置 `data-slide-id`。
- 关键文本使用 `data-pptx-editable`。
- 复杂视觉使用 `data-pptx-raster`，并提供 `data-pptx-alt`。
- 装饰或导出辅助节点使用 `data-pptx-ignore`。
- CSS 面向固定画布，避免动画、滚动、响应式断点和依赖视口宽度的字体缩放。

## 5. 输出目录

每个 deck 目录保留：

```text
deck.html
deck.prepared.html
styles.css
assets/
fallback-assets/
preview-html/
preview-pptx/
measurements.json
qa-report.json
final/<deck-slug>.pptx
```

带 prompt 的任务额外保留：

```text
prompt.txt
html-generation-report.json
```

## 6. QA 报告

`qa-report.json` 至少包含：

- `slides`
- `editableElements`
- `rasterFallbacks`
- `warnings`
- `generatedPptxPath`
- `pptxInspection`
- `htmlPreviewPaths`
- `pptxPreview`

warning 用于记录转换边界。遇到 `dom-to-pptx` 覆盖不足时，应缩小 HTML 子集、增加局部截图回退或写入 warning，避免临时扩大能力承诺。

## 7. 验收

本地端到端验收入口：

```bash
npm run slides:html-spike
```

项目级验证：

```bash
npm run typecheck
npm run lint
npm run build
git diff --check
```

`slides:html-spike` 应覆盖 8 页：封面、目录、文本页、双栏图文页、数据/表格页、复杂图表截图回退页、时间线页、总结页。

## 8. 当前限制

- `.pptx` 为有限可编辑，主要保障文本、图片、基础形状和表格。
- 高级图表数据源、复杂动画、任意网页转换和完整 CSS 覆盖暂不承诺。
- PPTX preview 依赖 LibreOffice 与 Poppler；缺失时记录 warning。
- 复杂视觉应优先做局部截图回退，避免整页截图。

## 9. 后续计划

1. 增加 HTML preview 与 PPTX preview 的图像差异检测。
2. 统计源 HTML 标注与 PPTX 文本 run 的对应关系。
3. 增加字体可用性与替换风险检查。
4. 沉淀稳定 HTML 子集的自研 mapper。
5. 为常见 deck 类型增加 HTML 模板与主题。
