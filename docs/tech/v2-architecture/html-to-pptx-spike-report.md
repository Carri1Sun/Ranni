---
author: manus
version: v2
date: 2026-07-07
subject: Ranni HTML-to-PPTX spike 落地报告与已知限制
audience: 维护 slides skill 与导出路线的 coding agent
prerequisites: slides skill 已落地 native PptxGenJS 路线
related: html-to-pptx-export-guide.md、slides-skill-plan.md、slides-skill-developer-guide.md
---

# Ranni HTML-to-PPTX spike 落地报告

## 0. 定位

本报告记录 HTML-to-PPTX spike（P0）的落地结果、验证数据、关键发现与已知限制，作为后续 P1 产品化接入的依据。设计目标与方案选型见 `html-to-pptx-export-guide.md`，本文只记录「实际跑通后的结论」。

HTML-to-PPTX 现为 slides skill 的**唯一**生成路线（自 2026-07-07 起，native PptxGenJS 路线 `init_deck_workspace` / `generate_pptx` 已下线）：

- HTML 路线：`init_slide_html_workspace` → `prepare_slide_html_for_pptx` → `export_html_to_pptx` → `validate_html_pptx_export`，先创作受限 slide HTML，再经 dom-to-pptx 转换。

## 1. 已落地能力

### 1.1 工具（skills/slides/tools.ts）

| 工具 | 职责 |
|---|---|
| `init_slide_html_workspace` | 在 session workspace 下创建 deck 目录，拷贝受限 slide HTML 模板（含 8 页 spike 示例 deck、styles.css、assets/），建立 final/preview-html/preview-pptx/fallback-assets 子目录。 |
| `prepare_slide_html_for_pptx` | Playwright 打开 deck.html，测量每个 `.slide` 与 `[data-pptx-raster]` 节点，对回退节点截图保存到 fallback-assets/，原位替换为等尺寸 `<img>`，把所有本地图片内联为 data URI，输出 deck.prepared.html 与 measurements.json。 |
| `export_html_to_pptx` | Playwright 打开 deck.prepared.html，注入 dom-to-pptx 浏览器 bundle，调用 `exportToPptx` 拿到 Blob 落盘为 `.pptx`。 |
| `validate_html_pptx_export` | 渲染 preview-html/，探测 LibreOffice 渲染 preview-pptx/，用 jszip 读 pptx slide 数量比对，检查回退资源，写 qa-report.json。 |

工具层只做薄壳：用 `resolveWorkspacePath` 守住路径边界，把绝对路径以 JSON 参数交给 `skills/slides/scripts/html-pptx/*.mjs` 子进程执行，`cwd` 为 session workspace。playwright 与 dom-to-pptx 只在子进程里引入，不进入 tsc 构建图与 dist bundle。

### 1.2 脚本（skills/slides/scripts/html-pptx/）

- `lib.mjs`：固定画布常量（1280x720）、浏览器启动（chromium 优先、系统 Chrome 回退）、dom-to-pptx bundle 解析、本地图片 data URI 编码、LibreOffice 探测、jszip 加载。
- `prepare.mjs`：测量 + 截图回退 + 原位替换 + data URI 内联 + 写 prepared.html/measurements.json。
- `export.mjs`：注入 bundle + 导出 pptx，并收集页面 console 错误供追溯。
- `validate.mjs`：预览渲染 + slide 计数 + 回退资源检查 + qa-report.json。

### 1.3 受限 slide HTML 规范（skills/slides/templates/slide-html/）

- 每页 `.slide` 固定 1280x720、`overflow:hidden`、`box-sizing:border-box`。
- 支持标注：`data-pptx-deck`、`data-slide-id`、`data-pptx-editable`、`data-pptx-raster`、`data-pptx-alt`、（保留 `data-pptx-ignore` 语义位）。
- 仅用系统字体，避免离线环境字体抓取失败。
- 示例 deck 覆盖 8 类页型：封面、目录、文本、双栏图文、数据/表格、复杂图表截图回退、时间线、总结。

### 1.4 产物结构

每次跑完四步工具，deck 目录会保留：

```text
<deck>/
  deck.html               # 原始受限 slide HTML（来自模板）
  deck.prepared.html      # 截图回退 + data URI 内联后的自包含 HTML
  styles.css
  assets/                 # 本地图片资产
  fallback-assets/        # data-pptx-raster 节点的截图
  preview-html/           # 每个 .slide 的 HTML 预览 PNG
  preview-pptx/           # pptx 渲染预览（需 LibreOffice，缺失时为空）
  measurements.json       # 测量与统计
  qa-report.json          # 质量校验报告
  final/
    <deck>.pptx           # dom-to-pptx 产出的有限可编辑 pptx
```

## 2. 验证结果

### 2.1 示例 deck（8 页，session workspace）

| 指标 | 值 |
|---|---|
| HTML / PPTX slide 数 | 8 / 8（jszip 解析一致） |
| 可编辑元素（`data-pptx-editable`） | 79 |
| PPTX 内 `<a:t>` 文本运行 | 每页 6–29 段，全部保留为真文本 |
| 截图回退（`data-pptx-raster`） | 1（chart 页，已嵌入 pptx） |
| 忽略节点（`data-pptx-ignore`） | 6（去除 HTML 分页页码 `NN/08`） |
| 内联图片 | 2（插画 SVG + 回退 PNG） |
| 导出过程页面错误 | 0（data URI 内联修复 CORS 后） |
| preview-html / preview-pptx 截图 | 8 / 8（LibreOffice 渲染） |
| 像素 diff（HTML vs PPTX 预览） | 可用，逐页 mismatch 0.78%–4.5% |
| LibreOffice 兼容性 | rendered（已真实渲染预览） |
| 媒体内嵌总计 / 最大 | 1.76MB / 742KB（复杂渐变背景被光栅化，已告警） |

可编辑性抽样：解压 `ppt/slides/slide3.xml`，标题、正文、列表均为 `<a:t>` 文本节点，可在 PowerPoint/Keynote 直接编辑；复杂图表以图片形式嵌入（slide6 的 image-6-1）。

### 2.2 端到端自动化验证（`skills/slides/scripts/html-pptx/e2e.mjs`）

`node skills/slides/scripts/html-pptx/e2e.mjs` 跑通"结构化 prompt → 确定性 builder 生成受限 slide HTML → prepare → export → validate → 断言"全链路，并含字体嵌入子用例。创作步骤用确定性 `buildDeckHtml(prompt)` 代替 LLM 以保证可复现。最近一次运行 18/18 通过，断言包括：

- prepare 识别全部页、命中截图回退。
- export 无页面错误，pptx 为有效 zip、slide 数与 prompt 一致、关键文本为可编辑 `<a:t>`。
- qa-report `libreoffice=rendered`、像素 diff 可用、无空白页、最大页差异 < 25%（实测 3.86%）。
- `@font-face E2EIcon` 字体被自动嵌入（pptx 出现 `embeddedFontLst`）。

## 3. 关键发现与已处理问题

### 3.1 file:// 下 `<img>` 触发 CORS（已处理）

dom-to-pptx 用离屏 canvas 做圆角图片防白边处理，需要读取图片像素。在 `file://` 页面里读取 `file://` 图片会被 Chromium 的 CORS 策略拦截（origin `null`），导致插画与截图回退图片均无法嵌入。

处理方式：在 prepare 阶段把所有本地 `<img>` 内联成 data URI（`data:image/...;base64,...`），data URI 无 CORS 限制，同时让 deck.prepared.html 自包含。修复后导出过程页面错误归零，图片正确嵌入。

### 3.2 复杂渐变背景会被光栅化（已知限制）

封面与总结页使用多层 radial-gradient 背景，dom-to-pptx 无法映射为原生形状，会光栅化成大尺寸 PNG（封面约 574KB、总结约 760KB）。这些页面的文字仍保持可编辑，背景失去原生可编辑性。这是 dom-to-pptx 对复杂 CSS 装饰的固有限制。

### 3.3 dom-to-pptx 的 exports 屏蔽 `./package.json`（已处理）

dom-to-pptx 的 `exports` 字段未暴露 `./package.json`，`require.resolve("dom-to-pptx/package.json")` 会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。处理方式：改为 `require.resolve("dom-to-pptx")` 解析主入口，再向上查找 `name === "dom-to-pptx"` 的 package.json 定位包根目录。

### 3.4 dom-to-pptx 不读取 Flexbox/Grid 定义

dom-to-pptx 测量每个元素相对 slide 根的最终 x/y/w/h 绝对定位，不读取布局算法本身。这对版式还原是优点（任意布局都能还原），但也意味着 HTML 端的响应式/自适应在导出后不成立——导出的是固定坐标快照。

### 3.5 像素差异质量门已落地（LibreOffice + pdftoppm + pixelmatch）

validate 把 pptx 经 LibreOffice 转 pdf、再用 poppler `pdftoppm` 拆成逐页 png，与 Playwright 的 preview-html 用 `pixelmatch` 逐页比对。为让两侧逐像素对齐：导出固定用 `LAYOUT_WIDE`（13.333x7.5in），preview-html 用 dsf2、pptx 用 192dpi，均为 2560x1440；对 LibreOffice 的 1px 舍入做 ≤2px 裁剪对齐。示例 deck 逐页 mismatch 0.78%–4.5%，并自动告警"差异过大（>70%）"与"近乎纯色（空白页风险）"两类问题。

### 3.6 字体嵌入机制已验证

导出默认开启 `autoEmbedFonts`。受限 deck 默认用系统字体（无 `@font-face`，无需嵌入）。当 deck 通过 `@font-face` 声明本地字体（放 `assets/fonts/`）时，dom-to-pptx 会自动把它嵌入 pptx（端到端用例验证 pptx 出现 `embeddedFontLst`）。styles.css 内附 `@font-face` 注释模板。

### 3.7 复杂背景光栅化的自动检测

dom-to-pptx 无法把多层 radial-gradient 背景映射为原生形状，会光栅化成大尺寸 PNG。validate 现在用 jszip 统计 pptx 内嵌媒体体积，对"最大图片 > 400KB"与"媒体总计 > 1.5MB"自动告警，提示存在被动光栅化。封面/总结页的渐变背景会触发该告警（文字仍可编辑）。

### 3.8 依赖漏洞处理

`npm install` 引入的依赖树原本报告 9 个漏洞（vite/esbuild/concurrently 的 shell-quote、cheerio/jsdom 的 undici 等，多为 dev 工具链）。`npm audit fix` 后降到 1 个 low：esbuild 在 Windows dev server 上的任意文件读（仅 Windows、仅 dev、macOS 不受影响），无法在不破坏 vite 锁定的情况下自动修复，作为可接受残留。dom-to-pptx 间接拉入的 puppeteer 用于其官方 CLI 导出器；本 spike 直接用 Playwright 驱动 dom-to-pptx bundle，不调用该 CLI，因此 puppeteer 的浏览器下载（被 npm allow-scripts 拦截）不影响功能。

## 4. 已知限制

- **PowerPoint / Keynote 兼容性仍需人工**：LibreOffice 渲染可产出 preview-pptx 并做像素 diff，但 PowerPoint/Keynote 的最终呈现仍建议人工打开核对（qa-report 中两者标记 `manual-check-pending`）。
- **复杂视觉仍可能整块光栅化**：除显式 `data-pptx-raster` 外，复杂渐变/滤镜/遮罩背景会被 dom-to-pptx 自动光栅化，失去原生可编辑性（validate 已对大尺寸内嵌媒体告警）。建议对深色/多层渐变背景的页面改用更克制的实色/单层渐变以降低光栅化。
- **产物体积**：含光栅化背景与 2x 截图回退时，pptx 体积偏大（示例约 1.7MB）。照片类资产可用 JPEG、截图回退可调低 deviceScaleFactor 控制体积。
- **像素 diff 是粗粒度信号**：文本渲染差异、字体替换会造成基础 mismatch，diff 阈值用于抓"空白页/大范围栅格化/版式漂移"等明显异常，不做像素级一致性判定。
- **运行时模板路径**：`init_slide_html_workspace` 从源码树 `skills/slides/templates/slide-html/` 读取模板，依赖源码目录存在（local-first 运行方式下成立）。
- **e2e 测试字体来源**：`e2e.mjs` 的字体嵌入子用例复用 `node_modules/playwright-core` 自带的 codicon.ttf 作为测试字体，路径变化时会明确报错（仅影响测试，不影响运行时）。

## 5. 下一步建议（P1）

1. **前端入口**：在输入框 slides 开关之外，增加 native 路线与 HTML 路线的选择，按 deck 类型路由。
2. **真实 LLM 创作 HTML**：e2e 目前用确定性 builder 代替 LLM 创作；接入后可补一条用真实模型从自然语言生成受限 slide HTML 的回归用例。
3. **像素 diff 精化**：把文本区与背景区分层比对，降低字体替换带来的基础 mismatch，让阈值更有区分度。
4. **复杂背景治理**：为渐变/滤镜背景提供 `data-pptx-raster` 自动建议或更克制的默认主题，降低被动光栅化与体积。
5. **产物体积治理**：照片类回退用 JPEG、控制截图分辨率，评估大 deck 体积。
6. **能力边界文档化**：把「dom-to-pptx 可稳定映射的子集」沉淀进 slides skill 的 references，作为 agent 创作 slide HTML 时的硬约束。
