---
author: manus
version: v2
date: 2026-07-07
subject: Ranni HTML-to-PPTX skill 开发执行指南
audience: 实现 HTML-to-PPTX skill 的 coding agent
prerequisites: skill 动态加载机制已落地（skill-dynamic-loading-plan.md Task 1–6 完成）
related: html-generation-skills-plan.md、slides-skill-plan.md、html-to-pptx-export-guide.md、skill-dynamic-loading-plan.md
---

# Ranni HTML-to-PPTX skill 开发执行指南

## 0. 本指南定位

这是给 coding agent 的执行手册，说明当前 `html-to-pptx` skill 的实现方式、文件边界、工具职责和验收步骤。静态网页创作由 `html` skill 承担，见 `html-generation-skills-plan.md`。

当前 artifact 依赖关系如下。它描述产物成立条件，不规定 Agent 的固定调用顺序：

```text
init_slide_html_workspace
-> set_slide_manifest
-> write_style_fragment（分片）
-> assemble_deck_styles
-> write_slide_fragment（draft、诊断、promote accepted）
-> assemble_slide_deck
-> prepare_slide_html_for_pptx
-> export_html_to_pptx
-> validate_html_pptx_export
```

`inspect_slide_fragment` 与 `patch_slide_fragment` 在需要时使用，Agent 也可以完整重写 draft 或调整共享样式。

## 1. 开工前检查

- 确认 `npm run typecheck` 基线可运行。
- 确认 `lib/tools.ts` export `ToolDefinition` 与 `ToolExecutionContext`。
- 确认 `lib/workspace.ts` export `getWorkspaceRoot`、`resolveWorkspacePath`、`toWorkspaceRelative`。
- 确认 `package.json` 包含 `dom-to-pptx`、`@fontsource-variable/noto-sans-sc`、`playwright`、`jszip`、`pixelmatch`、`pngjs`。
- 确认本机可用 Playwright Chromium 或 Google Chrome。
- 如需 PPTX preview，确认 LibreOffice 和 Poppler 可用。

## 2. 文件清单

```text
skills/html-to-pptx/
  SKILL.md
  tools.ts
  scripts/html-pptx/
    lib.mjs
    preflight.mjs
    prepare.mjs
    export.mjs
    validate.mjs
  examples/default-business/
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

`tools.ts` 保留 schema、workspace resolver、空白 workspace 初始化、逐页 fragment 原子写入、确定性组装、内部示例 deck 初始化和脚本调度；Playwright、LibreOffice、Poppler、`dom-to-pptx` 和 PPTX/PNG 检查逻辑放在 `scripts/html-pptx/*.mjs`。PPTX 用户路径不提供模板选择，agent 需要按用户内容和设计风格规划页面结构。

## 3. 工具实现要求

### `init_slide_html_workspace`

- 输入 `deckSlug`、可选 `dir`、`title`、`prompt`、`styleId`、`overwrite`。
- 通过 workspace resolver 创建 deck 目录。
- 创建 `deck.html`、`styles.css`、`styles/`、`slides/`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/`、`final/`。
- 传入 `prompt` 时写入 `prompt.txt` 和 `html-generation-report.json`。
- 本地 spike 脚本可通过内部 `exampleDeck: "spike-sample"` 拷贝 8 页示例 deck；该参数不出现在模型可见工具说明中。
- `styleId` 或 `toolSettings.htmlToPptx.styleId` 可指定共享设计风格。
- `html-generation-report.json` 记录 `designStyleId`、`designStyleName` 和内部示例 deck 信息。

### `set_slide_manifest`

- 在逐页输出前写入完整、有序、无重复的页面 ID 列表。
- 拒绝 `style`、`styles`、`css`、`theme` 等保留 ID。
- 第一个 accepted slide 产生后仅允许幂等重写相同清单。
- `assemble_slide_deck` 从 manifest 读取顺序，模型不在最终组装时重新声明页序。

### `write_style_fragment` 与 `assemble_deck_styles`

- CSS 按 `styles/<style-id>.css` 分片，每片不超过 4000 字符并保持语法结构独立闭合。
- 分片写入前检查未闭合注释、字符串、规则块和多余右花括号。
- 拒绝 `.slide > *` 统一覆盖 `position`，避免内容层规则改变背景层定位。
- 组装时逐片重新校验并按 `styleIds` 顺序合并。
- 候选 `styles.css` 先通过 Chromium 预检，确认 `.slide` 为 1280x720 且 `overflow: hidden`，随后原子替换正式文件。

### `write_slide_fragment`

- 每次调用只写一个顶层 `.slide`；同一模型响应仍可组合安全观察或其他满足前置条件的工具。
- 输入 HTML 不超过 8000 字符，`slideId` 与 `data-slide-id` 必须一致。
- 拒绝 `html`、`head`、`body` 包装、多页 fragment、路径型或保留 slide ID、清单外 ID、空白内容和内嵌 `script` / `style` / `link`。
- 先原子保存 `slides/.draft/<slide-id>.html`，并为诊断绑定内容 hash。
- 用 Chromium 验证 1280x720 尺寸、`overflow: hidden` 和语义化内容边界。
- 普通流、Flex、Grid 中的正文、表格、可编辑文本和核心图片越界返回 error；绝对定位、无文本的背景装饰被画布裁切返回 warning。
- 诊断通过后把 draft 原子 promote 为 `slides/<slide-id>.html`；失败时保留最近 accepted 和失败 draft。
- 返回结构化错误码、责任 selector、DOM 边界、相关 CSS、文本属性、截图路径、draft 路径和 hash。

### `inspect_slide_fragment` 与 `patch_slide_fragment`

- `inspect_slide_fragment` 默认读取最新 draft，返回结构化诊断、截图和当前 accepted receipt。
- `patch_slide_fragment` 基于目标 hash 执行精确替换，拒绝过期版本、零匹配和多匹配。
- patch 后自动重跑同一套语义诊断，通过时原子 promote。
- Agent 可以选择 inspect、patch、完整重写、修改共享 CSS 或更换页面设计。

### `assemble_slide_deck`

- 从 `slide-manifest.json` 读取完整、有序、无重复的页面 ID。
- 在写入前逐页检查 accepted 文件存在性、单页结构、页面 ID 和 receipt hash。
- 按声明顺序确定性组装 `deck.html`，保留 `styles.css` 的相对引用。
- 缺页或无效页面时拒绝生成，避免后续导出半成品。

### Agent 运行与工具可用性

- manifest、CSS、accepted 页面和组装产物是 artifact 里程碑，用于表达依赖和事实。
- `currentMode` 只表达认知姿态，不控制安全观察工具授权。
- thinking 沿用用户和 provider 配置，工件写入期间保持可用。
- 文件列表、读取、内容搜索、task memory 读取和 slide inspect 在 skill 激活期间保持可用。
- mutation 工具自行检查依赖、workspace、side effect 和产物不变量，并返回结构化错误。
- 错误回执描述失败原因、当前 artifact 和可用观察，不规定 Agent 的下一步工具。
- Provider 为每个流式工具块记录完整性；`max_tokens` 只拦截未闭合或 JSON 无效的工具块，已经闭合并通过解析的较早调用继续执行。
- 代码施工批次用于控制实现风险，不映射为 Agent runtime 状态机。

### `prepare_slide_html_for_pptx`

- 用 Playwright 打开 `deck.html`。
- 等待字体和首帧渲染完成。
- 校验每个 `.slide` 的尺寸、滚动状态和 `data-slide-id`。
- 统计 `data-pptx-editable` 与 `data-pptx-ignore`。
- 测量叶子文本的内容宽度、字形宽度、行数和横向余量，记录零余量单行文本候选。
- 中文 deck 按实际字符加载 Noto Sans SC WOFF2 子集，使浏览器测量和 PPTX 嵌入共享字形度量。
- 通过 Chromium CDP 记录文本实际使用的平台字体，区分 CSS 字体栈和真实字形字体。
- 检查设计准则：动画、hover、padding-bottom、box-shadow、大圆角、主内容绝对定位、标题字号、正文行高、图片尺寸和 DOM 嵌套深度。
- 在转换前截图每个 `data-pptx-raster` 节点，保存到 `fallback-assets/`。
- 用同尺寸 `<img>` 替换截图回退节点；普通流和 `position: relative` 节点原地替换，绝对定位装饰按 slide 坐标回放。
- 写出 `measurements.json`，包含 slide 测量、截图回退、warning。

### `export_html_to_pptx`

- 用 Playwright 打开 `deck.prepared.html`。
- 将 workspace 内本地 `<img>` 内联为 data URI，避免 `dom-to-pptx` 跳过相对路径或 `file://` 图片。
- 将 Chromium 实际字体写回导出 DOM；中文 deck 合并并嵌入本次使用的 Noto Sans SC 子集，自定义 Web 字体存在时同时开启自动发现。
- 对零余量或已经意外换行的原子文本设置 `nowrap`，按无换行宽度重新测量，并为可调整的 Flex/Grid 文本项增加 `5%`、最少 `8px`、最多 `16px` 的宽度缓冲。
- 注入 `dom-to-pptx` browser bundle。
- 只把 `.slide` 节点作为导出页。
- 使用 `1280 / 96 × 720 / 96` 的精确 16:9 英寸尺寸，设置标题、作者。
- 写出 `final/<deck-slug>.pptx`。

### `validate_html_pptx_export`

- 清理并重建 `preview-html/` 与 `preview-pptx/`。
- 用 Playwright 输出 HTML 逐页 PNG。
- 尝试用 LibreOffice 转 PDF，再用 Poppler 输出 PPTX 逐页 PNG。
- 用 `jszip` 检查 PPTX slide XML、精确画布尺寸、文本 run、字体声明、`wrap` 策略和图片对象数量，并与 prepared HTML 图片数量对齐。
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
- 遵守 `skills/html-to-pptx/reference-materials/html-to-pptx-agent-design-guidelines.md`：主内容用 Grid/Flex 和标准文档流，文本不使用绝对定位，正文行高保持 1.5 到 1.6，内容块间距至少 30px，卡片圆角不超过 8px，不使用卡片阴影。
- chip、短标题、数字单位、百分比、指标值和短标签使用叶子文本节点，设置 `white-space: nowrap`、`word-break: keep-all`、`overflow-wrap: normal`，并预留至少 `5%`、不低于 `8px` 的横向余量。
- 中文 deck 使用覆盖 Latin/CJK 的确定字体；默认转换链路会加载并嵌入 Noto Sans SC 字符子集，品牌字体需提供合法可嵌入的 `@font-face`。
- 移除阴影、hover、复杂渐变或绝对定位文本后，必须使用 PPTX 友好的视觉补偿：色带、细边框、分区底色、背景几何块、时间线轨道、节点圆环和页码锚点。

## 5. Spike 示例 deck

`examples/default-business/` 的样例应覆盖：

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
- `qa-report.json.pptxInspection.slideSize` 等于 `12192000 × 6858000 EMU`。
- `qa-report.json.textLayout.status` 为 `passed`，实际 CJK 字体和单行文本 `wrap` 策略通过检查。
- `qa-report.json.visualSmoke.available` 在 PPTX PNG 预览可用时为 `true`。
- 视觉 smoke check 不产生空白页、页数不一致或高差异 warning。
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
npm run test:artifact-writing
npm run typecheck
npm run lint
npm run build
git diff --check
```

`test:artifact-writing` 至少覆盖：

- 画布外无文本背景装饰返回 warning，页面可以 promote。
- 正文、表格、可编辑文本和核心图片越界返回 error，并指出责任元素。
- 失败 draft 保留，已有 accepted 内容和 hash 不变。
- inspect 返回与 draft hash 对应的诊断和截图。
- patch 拒绝过期 hash、零匹配和多匹配，成功修改后重新诊断。

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
