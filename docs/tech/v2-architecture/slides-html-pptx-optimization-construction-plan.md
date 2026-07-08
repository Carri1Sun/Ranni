---
author: manus
version: v2
date: 2026-07-07
subject: slides HTML-to-PPTX 优化施工方案
audience: 继续实现和验收 slides skill 的 coding agent
related: slides-html-pptx-merge-construction-review.md、slides-html-pptx-cross-review.md、slides-skill-plan.md、slides-skill-developer-guide.md、html-to-pptx-export-guide.md
---

# slides HTML-to-PPTX 优化施工方案

## 当前落地状态

本方案中阶段一到阶段四已在当前分支落地：

- 已删除旧 native theme 残留，并保留历史研究文档中的背景说明。
- 已将 spike 示例迁移为 `skills/html-to-pptx/examples/default-business/` 下的内部示例 deck，包含 `manifest.json`、`tokens.json`、`guidance.md`、`deck.html`、`styles.css` 和 `assets/`。
- 已将 prepare、export、validate 的重逻辑拆入 `skills/html-to-pptx/scripts/html-pptx/*.mjs`，`skills/html-to-pptx/tools.ts` 保留 schema、workspace resolver、空白 workspace 初始化、内部示例 deck 初始化和脚本调度。
- 已新增基于 `pixelmatch` 与 `pngjs` 的客观视觉 smoke check，`qa-report.json.visualSmoke` 记录空白页风险、预览页数不一致和高阈值视觉差异。

阶段五字体嵌入验证仍作为后续可选能力推进。

## 0. 施工目标

本方案面向 slides skill 的下一轮优化，目标是把当前已跑通的 HTML-to-PPTX 路线从 spike 能力推进到稳定可维护的产品化能力。

核心目标：

- 保留当前 Codex 分支已验证的真实 Ranni agent 路线、设计规范、`svgAsVector`、图片数量 QA 和 0 warning 验收。
- 吸收 Claude 分支在脚本隔离、真实 HTML/CSS 模板、客观视觉 smoke check、字体嵌入验证上的工程优势。
- 明确自动检查的边界：自动化负责客观故障，审美质量主要靠设计约束、模板和人工预览判断。
- 保持所有输入输出在 session workspace 内，工具 `cwd` 使用 session workspace。

## 1. 当前基线

以当前 `codex/slides-html-pptx-route` 为施工基线。

已具备能力：

- 四工具链路：`init_slide_html_workspace` → `prepare_slide_html_for_pptx` → `export_html_to_pptx` → `validate_html_pptx_export`。
- Playwright 渲染、测量、局部截图回退。
- 本地图片导出前 data URI 内联，避免 `dom-to-pptx` 跳过相对路径。
- 普通流 / `position: relative` 的 raster 节点原地替换，绝对定位装饰按坐标回放。
- `svgAsVector: true`，保留 SVG 后续在 PowerPoint 中转形状的可能性。
- `qa-report.json` 记录 slide、editable、raster、warning、PPTX 结构、PPTX preview、prepared HTML 图片数量、设计规范状态。
- 设计指南已进入 skill 行为约束和 QA：`slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md`。
- 已通过脚本 spike 和真实 Ranni agent E2E 验证。

当前短板：

- `skills/slides/tools.ts` 承载过多逻辑，后续维护成本偏高。
- spike 模板仍是 TypeScript 字符串，人工预览和编辑体验弱于真实 HTML/CSS 模板目录。
- 视觉检查还停留在结构和资源数量，缺少空白页 / 大范围漂移等客观 smoke check。
- 字体嵌入尚无独立验证。
- 存在未引用的 native 旧模板文件，容易造成路线理解混乱。

## 2. 总体策略

施工采用小步合并策略：

1. 先清理旧路线残留，降低误解成本。
2. 再把示例模板从 TS 字符串迁移到真实 HTML/CSS 文件。
3. 然后拆分工具实现，将运行时重逻辑迁移到 `.mjs` 子进程。
4. 最后增加客观视觉 smoke check 与字体嵌入可选验证。

每个阶段都必须独立可验收。任何阶段失败时，应回退该阶段，不影响当前已可用的 HTML-to-PPTX 主链路。

## 3. 阶段一：旧路线残留清理

### 3.1 改动范围

- 删除 `skills/slides/templates/default.theme.json`。
- 检查并更新 slides 相关文档，明确当前 slides skill 不提供 native PptxGenJS 直生成工具。
- 在文档中说明 lockfile 中的 `pptxgenjs` 来自 `dom-to-pptx` 传递依赖。

### 3.2 施工步骤

1. 使用 `rg "default.theme|init_deck_workspace|generate_pptx|PptxGenJS|pptxgenjs"` 扫描当前仓库。
2. 对还在描述当前 slides skill 路线的文档做更新。
3. 删除未引用的 `default.theme.json`。
4. 保留历史研究文档里的 PptxGenJS 背景，不强行重写历史方案，只在当前路线文档中说明现状。

### 3.3 验收标准

- `skills/slides/` 下不再有 native 模板残留。
- `skills/slides/SKILL.md` 只描述 HTML-to-PPTX 工具链。
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

## 4. 阶段二：真实 HTML/CSS 示例目录

### 4.1 改动范围

- 新增 `skills/html-to-pptx/examples/default-business/`：
  - `deck.html`
  - `styles.css`
  - `assets/`
- 用户路径下 `init_slide_html_workspace` 生成最小可编辑工作区。
- 本地 spike 脚本通过内部 `exampleDeck: "spike-sample"` 拷贝真实示例目录。
- 逐步移除或降级 `skills/slides/html-spike-template.ts` 的长字符串职责。

### 4.2 示例原则

内部示例必须体现设计指南：

- 每页 `.slide` 固定 `1280x720`。
- 标题、正文、列表、表格文本使用 `data-pptx-editable`。
- 复杂图表或复杂装饰用 `data-pptx-raster` 和 `data-pptx-alt`。
- 图片使用本地 `assets/`，并硬编码宽高。
- 页面类型覆盖封面、目录、文本、双栏图文、数据表格、复杂图表、时间线、总结。
- 控制圆角、阴影、动画、hover、复杂渐变，避免和设计指南冲突。

### 4.3 施工步骤

1. 从 Claude 分支模板中挑选可用结构，剔除与当前设计指南冲突的 CSS。
2. 将 Codex 当前 spike 模板的视觉和 QA 通过点迁入真实 HTML/CSS。
3. 调整 `init_slide_html_workspace`：
   - `spike-sample` 拷贝真实模板。
   - `blank` 写入最小 HTML/CSS。
   - 继续创建 `assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/`、`final/`。
4. 更新 `scripts/slides-html-pptx-spike.ts`，使用真实模板跑验收。

### 4.4 验收标准

- `npm run slides:html-spike` 通过。
- spike deck 仍为 8 页。
- `qa-report.json.warnings.length === 0`。
- `qa-report.json.designGuidelines.status === "passed"`。
- PPTX preview rendered。
- prepared HTML 中不残留 `data-pptx-raster` 节点。
- 浏览器可直接打开模板 HTML 做人工预览。

## 5. 阶段三：工具脚本化拆分

### 5.1 改动范围

新增：

```text
skills/slides/scripts/html-pptx/
  lib.mjs
  prepare.mjs
  export.mjs
  validate.mjs
```

调整：

- `skills/slides/tools.ts` 保留 schema、workspace resolver、工具描述、子进程调度。
- 将 Playwright、LibreOffice、Poppler、dom-to-pptx、JSZip 细节迁移到 `.mjs`。
- `eslint.config.mjs` 覆盖 `.mjs`。

### 5.2 必须保留的 Codex 行为

迁移时必须保留：

- 所有路径通过 workspace resolver 进入脚本。
- 子进程 `cwd` 为 session workspace。
- `prepare` 执行设计规范检查并写入 `measurements.json`。
- raster 按定位模式替换。
- `export` 在转换前内联本地图片。
- `export` 使用 `svgAsVector: true`。
- `validate` 记录 `preparedHtmlImages`、`pptxInspection`、`designGuidelines`、`pptxPreview`。
- `LIBREOFFICE_PATH` 仍可覆盖 LibreOffice 路径。

### 5.3 可吸收的 Claude 行为

建议吸收：

- `findPackageRoot` 解析 `dom-to-pptx` 包根目录。
- 子进程 stdout 最后一行 JSON 作为结构化结果。
- export 收集 page error 和 console error。
- LibreOffice 使用隔离 profile，减少并发锁冲突。
- `jszip` 媒体体积统计。

### 5.4 施工步骤

1. 先创建 `lib.mjs`，放浏览器启动、路径辅助、bundle 解析、命令探测。
2. 迁移 `prepare`，保持输出字段与当前 `measurements.json` 兼容。
3. 迁移 `export`，保持工具返回文本基本稳定。
4. 迁移 `validate`，保持 `qa-report.json` 字段向后兼容。
5. 收缩 `tools.ts`，只保留工具壳。
6. 更新文档和 spike 脚本。

### 5.5 验收标准

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run slides:html-spike`
- `git diff --check`
- 使用真实 Ranni `/api/runs` 触发一次 4 页以上 deck：
  - 工具调用链包含四个 slides 工具。
  - 产物落在 session workspace。
  - `qa-report.json.warnings.length === 0`。
  - PPTX preview 中封面装饰、右侧图片和复杂图表可见。

## 6. 阶段四：客观视觉 smoke check

### 6.1 目标边界

视觉 smoke check 只负责客观事故：

- PPTX 预览近似空白。
- HTML/PPTX 页数不一致。
- 大范围视觉漂移。
- 图片或 fallback 明显丢失。

它不负责判断“是否高级”“是否更好看”“是否符合某种主观审美”。审美优化依赖设计指南、agent 规划和人工预览。

### 6.2 改动范围

可新增依赖：

- `pixelmatch`
- `pngjs`

`qa-report.json` 可新增：

```json
{
  "visualSmoke": {
    "available": true,
    "slides": [
      {
        "index": 1,
        "mismatchPercent": 3.2,
        "blankRisk": false,
        "status": "ok"
      }
    ]
  }
}
```

### 6.3 规则建议

- `blankRisk`：PPTX PNG 亮度方差极低时 warning。
- `high-visual-diff`：HTML/PPTX mismatch 超过高阈值时 warning，建议初始阈值 70%。
- `preview-count-mismatch`：HTML/PPTX 预览页数不一致时 warning。
- 不因 5% 到 30% 的普通字体和抗锯齿差异阻塞。

### 6.4 Agent 行为约束

- agent 最多执行 1 到 2 轮自动修复。
- 修复对象只限客观 warning，如丢图、空白、页数不一致、文本 run 缺失。
- 自动修复仍无法清除非阻塞 warning 时，交付最好版本，并说明预览和 QA 路径。
- 禁止基于像素 diff 做开放式审美重写。

### 6.5 验收标准

- 缺少 LibreOffice / Poppler / pixelmatch 时，`qa-report.json` 明确降级，不静默通过。
- 有空白页样例时能触发 warning。
- 正常 spike deck 不产生视觉 smoke warning。

## 7. 阶段五：字体嵌入可选验证

### 7.1 目标边界

默认 deck 使用系统字体栈，不强制字体嵌入。仅当 deck 使用本地 `assets/fonts/` 中的 `@font-face` 时，才验证字体嵌入。

### 7.2 改动范围

- `export_html_to_pptx` 增加可配置 `autoEmbedFonts`，默认策略需谨慎：
  - 普通 deck 可保持当前稳定默认。
  - 本地 `@font-face` deck 开启嵌入。
- e2e 增加一个字体子用例。
- `qa-report.json` 可记录 `fontEmbedding` 诊断。

### 7.3 验收标准

- 本地字体样例 PPTX 中出现 `embeddedFontLst` 或 `ppt/fonts/`。
- 普通 deck 不因字体嵌入失败阻塞。
- 文档说明字体嵌入是可选增强。

## 8. 推荐排期

建议按以下顺序施工：

1. P0 和 P1 合成第一批 PR：清理残留 + 真实示例目录。
2. P2 单独作为第二批 PR：脚本化拆分，重点控制回归。
3. P3 单独作为第三批 PR：客观视觉 smoke check。
4. P4 作为增强 PR：字体嵌入可选验证。

每批 PR 都必须保留 `npm run slides:html-spike` 和真实 Ranni agent E2E 证据。P2 之后的每批改动都应附带至少一张 `preview-pptx/slide-*.png` 的人工检查结论。

## 9. 风险与回退

| 风险 | 表现 | 回退策略 |
|---|---|---|
| 示例迁移导致设计 warning 增加 | `designGuidelines.status=violations` | 暂时保留 TS 示例，逐页迁移真实示例 |
| 子进程拆分引入路径错误 | 产物写到 workspace 外或脚本找不到文件 | 回退 `tools.ts` 单文件实现，先补路径测试 |
| pixel diff 噪声过大 | 正常页频繁 warning | 提高阈值，只保留空白页和页数类客观 warning |
| 字体嵌入跨平台不稳定 | PPTX 体积增加或导出失败 | 默认关闭，仅本地字体测试场景开启 |
| 真实 agent 仍生成不佳布局 | 预览可用但观感差 | 强化设计准则、规划提示和 SKILL.md 约束，保持人工预览验收 |

## 10. 最终交付定义

完成本方案后，slides skill 应满足：

- agent 默认走 HTML-to-PPTX 路线。
- 受限 slide HTML 创作规则清晰，内部示例可直接预览和用于验收。
- 工具实现职责清楚，运行重依赖集中在脚本层。
- QA 能发现客观结构、资源和渲染事故。
- agent 自动修复有明确轮次上限，不能用审美 diff 做开放式收敛。
- 用户始终能拿到 `.pptx`、HTML 预览、PPTX 预览和 `qa-report.json`，由人工做最终审美判断。
