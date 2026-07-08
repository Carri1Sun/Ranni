---
author: manus
version: v2
date: 2026-07-07
subject: slides HTML-to-PPTX 双分支实现复盘与施工建议
audience: 继续迭代 slides skill 的 coding agent
related: html-to-pptx-export-guide.md、slides-skill-plan.md、slides-skill-developer-guide.md、slides-html-pptx-cross-review.md
---

# slides HTML-to-PPTX 双分支实现复盘与施工建议

## 0. 阅读范围

本次复盘基于以下当前证据：

- 已执行 `git fetch origin`。
- Claude 分支：`origin/claude/slides-html-pptx-route`，最新提交 `160c867`，核心实现提交 `30826f2`。
- Codex 分支：`origin/codex/slides-html-pptx-route` / 当前 HEAD `309efa8`。
- 已读取 Claude 分支核心实现：`skills/slides/tools.ts`、`skills/slides/scripts/html-pptx/*.mjs`、`skills/slides/templates/slide-html/*`、`docs/tech/v2-architecture/html-to-pptx-spike-report.md`。
- 已读取 Codex 当前实现：`skills/slides/tools.ts`、`skills/slides/SKILL.md`、`skills/slides/html-spike-template.ts`、`scripts/slides-html-pptx-spike.ts`、设计指南文档。
- 已读取 Claude 分支交叉评审：`docs/tech/v2-architecture/slides-html-pptx-cross-review.md`。

## 1. Claude 分支实现逻辑

Claude 分支采用“工具薄壳 + 子进程脚本”的结构。

`skills/slides/tools.ts` 只负责：

- 用 `resolveWorkspacePath` 解析输入输出路径。
- 把绝对路径通过 JSON 传给 `skills/slides/scripts/html-pptx/*.mjs`。
- 使用 session workspace 作为子进程 `cwd`。
- 暴露四个工具：`init_slide_html_workspace`、`prepare_slide_html_for_pptx`、`export_html_to_pptx`、`validate_html_pptx_export`。

`prepare.mjs` 的核心流程：

- Playwright 打开 `deck.html`。
- 测量 `.slide` 与 `[data-pptx-raster]`。
- 对每个 raster 节点截图到 `fallback-assets/`。
- 保留原 raster 容器，将其内容替换为等尺寸 `<img>`，保持原盒子和文档流。
- 移除 `[data-pptx-ignore]`。
- 将所有本地 `<img>` 内联为 data URI，写出自包含的 `deck.prepared.html`。
- 写出 `measurements.json`。

`export.mjs` 的核心流程：

- Playwright 打开 `deck.prepared.html`。
- 注入 `dom-to-pptx` browser bundle。
- 使用 `.slide` 节点数组导出 `LAYOUT_WIDE` PPTX。
- 默认开启 `autoEmbedFonts`。
- 收集 page error 和 console error。

`validate.mjs` 的核心流程：

- Playwright 渲染 HTML 逐页 PNG。
- LibreOffice 将 PPTX 转 PDF，Poppler `pdftoppm` 转逐页 PNG。
- `pixelmatch` 比对 HTML/PPTX 预览，记录 mismatch 百分比，检测近似空白页和大范围视觉漂移。
- `jszip` 读取 PPTX slide 数和媒体体积。
- 检查 fallback assets 是否存在。
- 写入 `qa-report.json`，并将 PowerPoint / Keynote 标为人工检查待办。

Claude 分支还提供真实 `.html` / `.css` 模板目录 `skills/slides/templates/slide-html/`，可直接浏览器打开预览；`e2e.mjs` 用确定性 builder 跑脚本级全链路，并额外验证本地 `@font-face` 字体嵌入。

## 2. Codex 当前实现逻辑

Codex 分支采用“单文件工具 + 内置模板生成器”的结构。

`skills/slides/tools.ts` 直接实现四个工具：

- `init_slide_html_workspace` 创建 `deck.html`、`styles.css`、`assets/`、`fallback-assets/`、`preview-html/`、`preview-pptx/`、`final/`，支持 `template: "blank" | "spike-sample"`，并保存 prompt。
- `prepare_slide_html_for_pptx` 使用 Playwright 测量 slide、截图 raster、移除 ignore、执行设计合规检查，写出 `deck.prepared.html` 和 `measurements.json`。
- `export_html_to_pptx` 打开 prepared HTML，在导出前把 workspace 内本地 `<img>` 内联为 data URI，然后注入 `dom-to-pptx`，使用 `svgAsVector: true` 导出 PPTX。
- `validate_html_pptx_export` 渲染 HTML/PPTX 预览，读取 PPTX XML，统计 slide、text run、picture、media，校验 prepared HTML 图片数量与 PPTX 图片对象数量，写出 `qa-report.json`。

Codex 分支重点补了产品约束：

- `docs/tech/v2-architecture/slides-skill-design/HTML-to-PPTX-Agent-Design-Guidelines.md` 约束 agent 的审美、排版、DOM 映射兼容性。
- `SKILL.md` 明确 slides 当前路线只暴露 HTML-to-PPTX，并要求 agent 先画 HTML 再转换。
- 设计合规检查进入 `prepare_slide_html_for_pptx` 和 `qa-report.json.designGuidelines`。
- raster 替换已按定位模式处理：普通流和 `position: relative` 节点原地替换为等尺寸 `<img>`；绝对定位装饰按 slide 坐标放回。
- 本地图片在 export 阶段内联，prepared HTML 保持相对路径，便于人工检查 `assets/` 和 `fallback-assets/`。
- `scripts/slides-html-pptx-spike.ts` 直接调用 tools 实现，验证 8 页 spike deck、0 warning、design passed、图片对象、预览产物。

Codex 分支已做过一次真实 Ranni agent 端到端验证：通过 `/api/runs` + active `slides` skill + DeepSeek runtime，真实调用四个工具生成 deck，并修复了封面装饰、右侧 SVG、本地图表回退进入 PPTX 的问题。

## 3. 对 cross-review 的校准

Claude 的 cross-review 对两边优劣判断整体准确，尤其是：

- Claude 在子进程隔离、像素 diff、字体嵌入验证、真实 HTML/CSS 模板、bundle 根目录解析上更完整。
- Codex 在 agent 设计指南、`svgAsVector`、严格 0 warning 验收、图片数量 QA、`init` 灵活度和 `LIBREOFFICE_PATH` 支持上更贴近产品化。

需要基于当前代码修正三点：

1. Codex 当前 `309efa8` 已经是定位感知 raster 替换：普通流 / relative 节点原地替换，absolute 节点按坐标回放。cross-review 中“仍然 append/remove”的描述对当前代码已经过期。
2. Claude 分支的 `validate.mjs` 依赖 `jszip`，但 `package.json` 没有直接声明 `jszip`，会依赖传递依赖可用性；Codex 分支保留了直接依赖。
3. 用户已经明确倾向：自动检查应聚焦客观问题，审美由约束和人工预览兜底。像素 diff 可以作为空白页、丢图、大范围漂移的辅助信号，不应成为开放式审美收敛机制。

## 4. 施工总原则

建议以 Codex 当前分支作为产品化基线，再分阶段吸收 Claude 的工程能力。

理由：

- 当前 Codex 分支已经接入 Ranni agent 真实运行路径，且经过真实模型生成、工具调用、PPTX 预览验证。
- 设计指南和设计 warning 是解决“agent 产出不好看”的核心约束，应作为 slides skill 的长期行为边界。
- Codex 的 `svgAsVector` 和图片数量 QA 直接命中本轮发现的丢图问题。
- Claude 的脚本化架构、像素 diff、字体用例非常值得吸收，但整体替换会同时丢失 Codex 当前的设计约束、真实 agent 验收和灵活 init 行为。

## 5. 推荐施工方案

### P0：保持当前 Codex 基线，做低风险清理

目标：减少旧路线残留，避免 agent 或维护者误解当前 slides 路线。

建议改动：

1. 删除未被引用的 `skills/slides/templates/default.theme.json`。
2. 在文档里说明 `pptxgenjs` 出现在 lockfile 是 `dom-to-pptx` 的传递依赖，不代表 native 路线仍可用。
3. 将 cross-review 中与当前代码不符的点记录为“已校准”，避免后续按过期结论施工。

验收：

- `rg "default.theme|init_deck_workspace|generate_pptx" skills src scripts docs/tech/v2-architecture` 不再发现 slides skill 当前路线里的可执行入口残留。
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`

### P1：吸收 Claude 的真实 HTML/CSS 模板

目标：让模板和样例 deck 更易编辑、预览和复用。

建议改动：

1. 新增 `skills/slides/templates/default-business/`，采用真实 `deck.html`、`styles.css`、`assets/`，并补充 `manifest.json`、`tokens.json` 和 `guidance.md`。
2. 保留 Codex 的 `template: "blank" | "spike-sample"` 语义：`blank` 生成极简工作区，`spike-sample` 拷贝真实模板。
3. 将 Codex 设计指南同步进模板 CSS：减少大圆角、box-shadow、多层复杂渐变，强化页面类型差异。
4. 保留 prompt 记录和语义化 deck slug。

验收：

- `init_slide_html_workspace({ template: "spike-sample" })` 产出真实 HTML/CSS 文件。
- 浏览器直接打开模板 HTML 可预览。
- `npm run slides:html-spike` 仍通过。

### P2：拆分工具实现，吸收 Claude 的子进程架构

目标：降低 `skills/slides/tools.ts` 复杂度，把 Playwright、LibreOffice、pixelmatch 等重依赖隔离到运行脚本中。

建议改动：

1. 将 prepare/export/validate 主体迁移到 `skills/slides/scripts/html-pptx/*.mjs`。
2. `tools.ts` 保留 zod schema、workspace resolver、工具描述和子进程调度。
3. 子进程 `cwd` 使用 session workspace，输入输出仍由 `resolveWorkspacePath` 约束。
4. 保留 Codex 当前行为：export 阶段本地图片内联、`svgAsVector: true`、`LIBREOFFICE_PATH` 探测、设计 warning、图片数量 QA。
5. 迁移后补充 mjs lint 配置，避免脚本成为未检查区域。

验收：

- `tools.ts` 行数和职责明显下降。
- `npm run typecheck` 不再把 Playwright/dom-to-pptx 运行细节耦合进工具主体。
- `npm run slides:html-spike` 通过。
- 使用 Ranni `/api/runs` 的真实 agent E2E 至少跑一次。

### P3：增加客观视觉 smoke check，暂缓审美 diff

目标：自动抓客观渲染事故，保持人工预览作为审美最终判断。

建议改动：

1. 可引入 `pixelmatch` + `pngjs`，但只产出诊断字段，不做开放式审美终止条件。
2. 只把以下情况作为 warning：
   - PPTX 预览近似空白。
   - HTML/PPTX 页数不一致。
   - 大范围视觉差异超过高阈值，例如 70%。
   - prepared HTML 图片数量高于 PPTX 图片对象数量。
3. 不让 agent 基于像素 diff 反复“审美优化”。自动修复最多 1 到 2 轮；仍无法处理时交付最好版本和预览路径。

验收：

- `qa-report.json.visualSmoke` 或 `previewDiff` 只记录客观指标。
- 0 warning 仍以结构正确、资源存在、预览可渲染为主。
- 文档明确最终审美核验由用户打开 `preview-html/`、`preview-pptx/` 和 `.pptx` 完成。

### P4：字体嵌入作为可选能力

目标：提升跨机器视觉一致性，同时控制复杂度。

建议改动：

1. 默认继续使用系统字体栈，避免生成器强依赖外部字体。
2. 仅当 deck 使用本地 `assets/fonts/` 的 `@font-face` 时开启或测试 `autoEmbedFonts`。
3. 引入 Claude 的字体嵌入 e2e 子用例，但保留失败诊断，不把普通系统字体 deck 的字体嵌入作为硬要求。

验收：

- 本地字体 deck 能在 PPTX 中出现 `embeddedFontLst` 或 `ppt/fonts/`。
- 普通 deck 不因字体嵌入失败阻塞交付。

## 6. 不建议的施工方式

- 不建议用 Claude 分支整体覆盖 Codex 分支。这样会丢掉当前的设计指南、真实 agent 验证路径、`svgAsVector`、图片数量 QA 和严格 0 warning spike。
- 不建议把像素 diff 扩展成审美评分或多轮自我优化。审美标准难以收敛，容易造成 agent 在非确定目标上反复修改。
- 不建议继续扩大单文件 `tools.ts`。当前文件已经承载 prepare/export/validate/QA/preview 多类职责，后续应拆分。
- 不建议依赖传递依赖提供 `jszip`。PPTX 结构检查是 validate 的核心能力，应直接声明依赖。

## 7. 最终结论

最优路线是：

1. 以 Codex 当前分支为基线继续推进。
2. 短期清理 native 残留并保留设计指南。
3. 中期吸收 Claude 的真实模板目录、子进程脚本化架构、bundle 根目录解析、字体用例。
4. 视觉检查只做客观 smoke check，作为人工预览前的安全网。
5. 每次大改后都补一条真实 Ranni agent E2E，确保 agent 主循环、skill 动态加载、workspace resolver 和工具调用链都仍然可用。
