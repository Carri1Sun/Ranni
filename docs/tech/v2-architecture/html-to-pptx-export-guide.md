---
author: manus
version: v2
date: 2026-07-07
subject: Ranni HTML 到有限可编辑 PPTX 导出开发指南
audience: 实现 slides 导出能力的 coding agent
prerequisites: slides skill 与 session workspace 机制已落地
related: slides-skill-plan.md、slides-skill-developer-guide.md、document-generation-research.md
---

# Ranni HTML 到有限可编辑 PPTX 导出开发指南

## 0. 定位

本指南描述 Ranni slides skill 的下一阶段导出路线：让 agent 先创作受限的 slide HTML，再通过 DOM 到 PPTX 的转换工具生成有限可编辑的 `.pptx`，并对复杂元素做截图回退。

目标效果：

- 保留 HTML/CSS 的创作效率与预览体验。
- 保留主要文本、图片、基础形状、表格的 PPTX 可编辑性。
- 对复杂图表、复杂 CSS 装饰、canvas/SVG 组合视觉做局部截图回退。
- 所有产物、中间文件、预览、诊断报告都落在当前 session workspace。

本方案已接入 slides skill 当前主流程。skill 当前只暴露 HTML-to-PPTX 工具链，agent 生成幻灯片时应先创作受限 slide HTML，再通过准备、导出、验证三步产出 `.pptx`。

## 1. 方案摘要

推荐路线：

```text
受限 slide HTML
-> Playwright 渲染
-> 识别截图回退节点
-> 将复杂节点截图并替换为 img
-> dom-to-pptx 生成 .pptx
-> 渲染 PPTX 预览
-> 对比 HTML 预览与 PPTX 预览
-> 产出 qa-report.json
```

核心判断：

- `dom-to-pptx` 负责把可映射 DOM 转成 PPTX 原生对象。
- Playwright 负责真实浏览器渲染、元素测量、节点截图。
- 截图回退放在转换前执行，让转换器面对更稳定的 HTML 子集。
- 可编辑性按元素粒度保留，视觉稳定性由截图回退兜底。

## 2. 适用范围

优先支持：

- 固定 16:9 幻灯片。
- 标题、正文、列表、引用、脚注等文本元素。
- 图片、图标、简单 SVG。
- 简单表格与指标卡。
- 基于绝对定位或受控 grid/flex 的版式。
- 被明确标注为截图回退的复杂视觉块。

暂缓支持：

- 任意网页转换。
- 页面滚动与响应式断点。
- 复杂 CSS 动画。
- 需要完整原生可编辑的 D3、ECharts、Chart.js 图表。
- PowerPoint 内可继续编辑数据源的高级图表。

## 3. 受限 HTML 规范

agent 生成的 HTML 必须面向 PPTX 导出设计。建议每个 deck 是一个自包含目录：

```text
slides/
  deck.html
  styles.css
  assets/
  fallback-assets/
  preview/
  measurements.json
  qa-report.json
  final/
    deck.pptx
```

页面结构：

```html
<main class="deck" data-pptx-deck>
  <section class="slide" data-slide-id="cover">
    <h1 class="slide-title">...</h1>
    <p class="slide-subtitle">...</p>
  </section>

  <section class="slide" data-slide-id="market">
    <div class="chart-block" data-pptx-raster>
      ...
    </div>
    <div class="text-block" data-pptx-editable>
      ...
    </div>
  </section>
</main>
```

尺寸规则：

- `.slide` 固定为 `1280px × 720px`，对应 16:9。
- 导出视口使用 `1280x720` 或按页截图时使用元素 bounding box。
- 每个 `.slide` 禁止滚动。
- `body` 背景透明或与 slide 背景一致。
- 设计和排版遵守 `slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md`，包括固定标题节奏、Grid/Flex 主内容、主内容文本避免绝对定位、正文行高 1.5 到 1.6、内容块间距至少 30px、低圆角和静态输出。

推荐 CSS：

```css
.deck {
  width: 1280px;
}

.slide {
  position: relative;
  width: 1280px;
  height: 720px;
  overflow: hidden;
  box-sizing: border-box;
}

.slide * {
  box-sizing: border-box;
}
```

元素标注：

| 标注 | 含义 |
|---|---|
| `data-pptx-deck` | deck 根节点 |
| `data-slide-id` | slide 稳定标识 |
| `data-pptx-editable` | 倾向转成 PPTX 原生对象 |
| `data-pptx-raster` | 转换前截图回退 |
| `data-pptx-ignore` | 导出时忽略 |
| `data-pptx-alt` | 图片或截图回退元素的替代文本 |

## 4. 截图回退策略

截图回退面向难以稳定映射的视觉块。agent 或预处理器可以主动标注：

```html
<div class="complex-map" data-pptx-raster data-pptx-alt="区域增长热力图">
  ...
</div>
```

自动回退规则建议：

- `canvas` 节点默认回退。
- 含 `filter`、`mix-blend-mode`、`clip-path` 的节点默认回退。
- 含动画但最终需要静态输出的节点默认回退。
- 复杂渐变、复杂阴影、遮罩叠加区域默认回退。
- 外部图表库渲染区域默认回退，除非已经有可转成 PowerPoint 可编辑图表的数据结构。

预处理步骤：

1. Playwright 打开 `deck.html`。
2. 遍历每个 `.slide` 内的 `[data-pptx-raster]`。
3. 对元素调用截图，保存为 `fallback-assets/<slide-id>-<index>.png`。
4. 记录原元素位置、尺寸、z-index、alt 到 `measurements.json`。
5. 在 DOM 中用等尺寸 `<img>` 替换原节点；普通流或 `position: relative` 节点原地替换，`absolute` / `fixed` 装饰节点按 slide 坐标回放。
6. 把替换后的 HTML 保存为 `deck.prepared.html`。
7. 导出前把 workspace 内本地 `<img>` 内联为 data URI，再将 `deck.prepared.html` 交给 `dom-to-pptx`。

截图参数：

- 使用透明背景时启用 `omitBackground: true`。
- 对半透明叠加元素保持 PNG。
- 对照片类大图可用 JPEG，减少文件体积。
- 截图分辨率至少按 2x device scale factor 生成。

## 5. Spike 计划

Spike 的目标是验证 `dom-to-pptx` 在 Ranni 真实创作场景中的表现，暂时不接入主流程。

### 5.1 测试 deck

准备 6 到 8 页覆盖典型场景：

1. 封面：大标题、背景图、半透明遮罩。
2. 目录：多级文本和页码。
3. 文本页：标题、要点列表、引用。
4. 双栏页：左文右图，含裁切图片。
5. 数据页：表格、指标卡、简单图表。
6. 复杂图表页：canvas 或 SVG 图表，使用 `data-pptx-raster`。
7. 时间线：基础形状、连线、图标。
8. 总结页：多文本块和装饰背景。

### 5.2 验证维度

| 维度 | 检查点 |
|---|---|
| 中文排版 | 字体、字重、行高、换行是否稳定 |
| 可编辑性 | PPTX 中标题、正文、列表是否可编辑 |
| 布局 | 绝对定位、grid、flex 的还原差异 |
| 图片 | 裁切、透明 PNG、SVG、远程资源本地化 |
| 回退 | 截图节点的透明背景、层级、尺寸、裁切 |
| 多页 | slide selector、页序、空白页风险 |
| 兼容性 | PowerPoint、Keynote、LibreOffice 打开效果 |
| 体积 | 图片回退对文件大小的影响 |
| 设计合规 | `qa-report.json.designGuidelines.status` 为 `passed`，且无 `design-*` warning |

### 5.3 验收输出

Spike 结束后在 session workspace 中保留：

```text
slides-html-pptx-spike/
  deck.html
  deck.prepared.html
  styles.css
  assets/
  fallback-assets/
  preview-html/
  preview-pptx/
  measurements.json
  qa-report.json
  final/
    deck.pptx
```

`qa-report.json` 建议字段：

```json
{
  "deck": "final/deck.pptx",
  "slides": 8,
  "editableElements": 64,
  "rasterFallbacks": 7,
  "warnings": [
    {
      "slideId": "market",
      "type": "text-wrap-drift",
      "message": "正文块在 PPTX 预览中多出一行"
    }
  ],
  "compatibility": {
    "powerpoint": "manual-check-pending",
    "keynote": "manual-check-pending",
    "libreoffice": "rendered"
  }
}
```

## 6. 工具设计

建议新增或扩展 slides skill 工具：

### 6.1 `init_slide_html_workspace`

职责：

- 在当前 session workspace 下创建 deck 目录。
- 写入基础 `deck.html`、`styles.css`、`assets/`、`fallback-assets/`。
- 返回所有路径，路径必须是 workspace-relative。

输入：

```json
{
  "deckSlug": "market-analysis"
}
```

输出：

```json
{
  "dir": "market-analysis",
  "html": "market-analysis/deck.html",
  "css": "market-analysis/styles.css",
  "finalPptx": "market-analysis/final/market-analysis.pptx"
}
```

### 6.2 `prepare_slide_html_for_pptx`

职责：

- 使用 Playwright 打开 HTML。
- 截图 `data-pptx-raster` 节点。
- 替换 DOM。
- 输出 `deck.prepared.html` 与 `measurements.json`。

输入：

```json
{
  "html": "market-analysis/deck.html",
  "outHtml": "market-analysis/deck.prepared.html"
}
```

### 6.3 `export_html_to_pptx`

职责：

- 调用 `dom-to-pptx` 或其 CLI。
- 将 `deck.prepared.html` 转成 `.pptx`。
- 输出初始转换报告。

输入：

```json
{
  "html": "market-analysis/deck.prepared.html",
  "outPptx": "market-analysis/final/market-analysis.pptx",
  "slideSelector": ".slide"
}
```

### 6.4 `validate_html_pptx_export`

职责：

- 渲染 HTML 预览。
- 渲染 PPTX 预览。
- 生成 contact sheet。
- 检查明显空白页、尺寸异常、回退资源缺失、文本漂移风险。
- 写入 `qa-report.json`。

输入：

```json
{
  "html": "market-analysis/deck.html",
  "pptx": "market-analysis/final/market-analysis.pptx"
}
```

## 7. 运行时约束

所有工具都必须遵守当前 Ranni session workspace 规则：

- 输入路径先通过 workspace resolver 解析。
- 输出路径必须落在 workspace 内。
- 工具执行时的 `cwd` 使用 session workspace。
- 生成的 `.ranni/`、预览、截图、诊断报告都在 session workspace。
- skill 文档只描述任务方法，工作目录规则由基础 guideline 约束。

对外部资源的处理：

- 远程图片必须下载到 `assets/` 后再引用。
- 本地 `<img>` 可以使用 `assets/` 或 `fallback-assets/` 相对路径；`export_html_to_pptx` 会在转换前内联为 data URI，规避 `dom-to-pptx` 对相对路径和 `file://` 图片的限制。
- 字体文件如需使用，放在 `assets/fonts/`。
- HTML 中避免依赖外部 CDN。
- 所有资源使用相对路径，便于导出与复现。

## 8. 产品化路线

### P0：Spike

- 安装并验证 `dom-to-pptx`。
- 手写测试 deck。
- 实现截图回退预处理脚本。
- 输出 `qa-report.json`。
- 形成表现结论：可用子集、风险清单、失败样例。

### P1：Skill 接入

- 在 slides skill 中提供 HTML-to-PPTX 工具链。
- 前端入口通过“幻灯片”能力开关加载该路线。
- agent 激活 slides skill 后，按受限 slide HTML 规范创作 deck。
- 所有导出产物进入 session workspace。

### P2：质量门

- 增加 HTML preview 与 PPTX preview 的图像差异检测。
- 增加文本可编辑性统计。
- 增加字体缺失检测。
- 增加元素越界、空白页、截图资源缺失检测。

### P3：自研 mapper

当 `dom-to-pptx` 覆盖率或稳定性不足时，再进入自研 mapper：

```text
computed style + DOM box
-> slide IR
-> OOXML writer
```

自研 mapper 只覆盖 Ranni 受限 HTML 规范中长期稳定的元素集合，复杂视觉继续走截图回退。

## 9. 当前 skill 路线

当前 slides skill 的可调用工具只包含 HTML-to-PPTX 路线，适合视觉创作效率更高、预览更直接的场景。

当前工具链：

| 阶段 | 工具 | 产物 |
|---|---|---|
| 初始化 | `init_slide_html_workspace` | `deck.html`、`styles.css`、资产目录 |
| 准备 | `prepare_slide_html_for_pptx` | `deck.prepared.html`、`measurements.json`、`fallback-assets/` |
| 导出 | `export_html_to_pptx` | `final/*.pptx` |
| 验证 | `validate_html_pptx_export` | `preview-html/`、`preview-pptx/`、`qa-report.json` |

后续如需更强结构可编辑性，应在稳定 HTML 子集上沉淀 mapper 或模板能力，并继续沿用局部截图回退策略。

## 10. 风险与缓解

| 风险 | 表现 | 缓解 |
|---|---|---|
| 文本漂移 | PPTX 中换行和 HTML 预览不同 | 限制文本框宽度、固定字体、QA 检测换行风险 |
| 字体缺失 | 用户机器打开后变形 | 使用常见字体，必要时记录字体要求 |
| CSS 覆盖不足 | 阴影、滤镜、遮罩失真 | 标注 `data-pptx-raster` |
| 图片资源丢失 | PPTX 中空白或断图 | 所有资源本地化到 `assets/` |
| 文件体积过大 | 回退截图过多 | 控制截图分辨率，照片使用 JPEG |
| 层级错误 | 截图遮挡可编辑文本 | 回退块尽量只包复杂视觉，不包关键文本 |
| 工具成熟度不足 | CLI 失败或输出不稳定 | 记录 warning，缩小受限 HTML 子集，必要时沉淀自研 mapper |

## 11. 推荐实现顺序

1. 新建 spike 目录与样例 deck。
2. 接入 Playwright 渲染与截图回退脚本。
3. 接入 `dom-to-pptx` browser bundle。
4. 生成 HTML 预览和 PPTX 预览。
5. 记录可编辑对象统计和截图回退统计。
6. 用 PowerPoint、Keynote、LibreOffice 做一次手动兼容检查。
7. 将成功子集写回 slides skill 规范。

完成 P0 后，再决定是否进入 P1 skill 工具化。验收标准以“Ranni 能稳定交付有限可编辑且视觉可靠的 PPTX”为准。

## 12. 当前实现状态

已在 `skills/slides/` 中接入 HTML-to-PPTX 路线，当前可调用工具为以下四个。

新增依赖：

| 依赖 | 用途 |
|---|---|
| `dom-to-pptx` | 在浏览器上下文中把 prepared slide DOM 转为 `.pptx` |
| `playwright` | 渲染 HTML、测量 DOM、截图 `data-pptx-raster` 节点、输出 HTML preview |
| `jszip` | 检查 PPTX 内 slide XML、文本 run 和图片对象数量 |

新增工具：

| 工具 | 作用 |
|---|---|
| `init_slide_html_workspace` | 创建受限 slide HTML deck 目录，可生成 8 页 spike 示例 |
| `prepare_slide_html_for_pptx` | 执行 Playwright 测量、截图回退和 `deck.prepared.html` 写出 |
| `export_html_to_pptx` | 注入 `dom-to-pptx` browser bundle 并导出最终 `.pptx` |
| `validate_html_pptx_export` | 输出 HTML preview、尝试 PPTX preview、写 `qa-report.json` |

本地 spike runner：

```bash
npm run slides:html-spike
```

默认会创建或复用：

```text
~/Documents/Ranni-Workspace/ranni-session-html-pptx-spike/slides-html-pptx-spike/
```

目录内保留：

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
final/slides-html-pptx-spike.pptx
```

当前样例覆盖 8 页：封面、目录、文本页、双栏图文页、数据/表格页、复杂图表截图回退页、时间线页、总结页。

runner 会保存 prompt 证据：

```text
prompt.txt
html-generation-report.json
```

`slides:html-spike` 会执行严格端到端断言：

- prompt 已保存并进入 HTML 生成报告。
- 所有核心产物存在。
- `qa-report.json` 无 warning。
- PPTX XML slide 数等于 HTML slide 数。
- PPTX XML 中存在 `<a:t>` 文本 run。
- PPTX preview 状态为 `rendered`。
- `preview-pptx/` 中存在 8 张逐页 PNG。

当前 `qa-report.json` 字段包括：

- `slides`
- `editableElements`
- `rasterFallbacks`
- `warnings`
- `generatedPptxPath`
- `preparedHtmlImages`
- `pptxInspection`
- `htmlPreviewPaths`
- `pptxPreview`

已知限制：

- `dom-to-pptx` 转换能力按真实输出记录到 `qa-report.json`，当前不承诺完整 CSS 覆盖。
- PPTX 预览依赖 LibreOffice 和 Poppler；渲染失败时会在 `preview-pptx/render-status.json` 与 `qa-report.json` 中记录原因。
- 复杂视觉推荐只包裹局部节点并标记 `data-pptx-raster`，关键文本继续单独标记为 `data-pptx-editable`。
- `data-pptx-raster` 按原定位模式替换：普通流和 `position: relative` 节点原地替换为等尺寸 `<img>`，绝对定位装饰按测量坐标放回 slide。
- `validate_html_pptx_export` 会记录 prepared HTML 图片数量和 PPTX 图片对象数量；图片数量不匹配时写入 `pptx-image-count-mismatch` warning。
- macOS headless LibreOffice 渲染依赖 Homebrew 运行库；当前验证环境已补齐 `little-cms2` 和 `fontconfig`。

后续产品化计划：

1. 增加 HTML preview 与 PPTX preview 的图像差异检测。
2. 统计 PPTX 中可编辑文本与源 HTML 标注的对应关系。
3. 增加字体可用性与替换风险检查。
4. 为稳定 HTML 子集沉淀自研 mapper，继续保留局部截图回退策略。
