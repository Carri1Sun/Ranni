---
author: claude
version: v2
date: 2026-07-06
subject: Ranni 文档生成能力调研与整合方案（PDF / PPT）
audience: 负责实现该能力的编码 agent
baseline: commit a7cd763（v2 事件驱动架构落地后）
---

# Ranni 文档生成能力调研与整合方案（PDF / PPT）

本文档调研业界（2025–2026）使用 agent 生成 PDF 与 PPT 的主流方案，结合 Ranni 当前的 v2 架构（工具注册表、workspace 边界、三层事件、前端 markdown 渲染）给出整合方案与分阶段落地路径。已确认的选型方向：PDF 主路径走 Puppeteer 浏览器渲染；PPT 走「HTML 幻灯片 → PPTX」路线，且 HTML / PDF / PPTX 三种产物都要能展示。

## 1. 背景与目标

Ranni 已具备完整的 agent loop、文件工具、research 流水线与 markdown 前端渲染，但缺少把 agent 产出转化为可分享文档（PDF / PPT）的能力。目标是让 agent 在 session workspace 内自主产出保真度高、可预览、可下载的 PDF 与 PPT，且不破坏 local-first 与 workspace 隔离两项核心约束。

约束条件：

- local-first：不依赖把用户内容外发的 SaaS API（Gamma / Api2Pdf / Foxit 云等不纳入主路径）。
- 纯 Node/TS 运行时：尽量避免重 native 依赖，注意首次安装体验。
- workspace 隔离：所有产物落盘到选定 session workspace，复用现有路径安全校验。
- 复用 v2 事件驱动架构：工具调用自动走 `tool.started` / `tool.completed`，前端通过 EventMapper 渲染，尽量零改动接入。

## 2. 业界方案地图

所有成熟方案的共同模式：**LLM 生成中间表示 → 工具调用渲染引擎 → 落盘**。中间表示有三类：Markdown、HTML/CSS、领域 DSL（Typst / 结构化 JSON）。没有任何主流方案让 LLM 直接生成二进制文件。

### 2.1 PDF 三条主路线

| 路线 | 代表栈 | 优势 | 短板 | 适用场景 |
|---|---|---|---|---|
| Markdown → Typst | pandoc + typst、typst.ts | LaTeX 级排版质量，速度比 XeLaTeX 快一个量级，错误信息友好，原生支持公式/目录/分栏 | LLM 对 Typst 语法的掌握仍在爬坡（Claude Sonnet 4 / GPT-5 较好） | 长报告、学术、带公式的研究稿 |
| HTML/CSS → Headless Chrome | Puppeteer、Playwright | LLM 最擅长 HTML/CSS，像素级精准，与 Web 同源 | 需下载 Chromium（约 150MB），启动较慢 | 设计感强、图文混排、所见即所得 |
| 纯 JS 生成 | @react-pdf/renderer、pdf-lib | 零 native 依赖，声明式 | 复杂版面能力弱 | 简历、发票、结构化表单 |

2025 年的明显趋势是 Typst 取代 XeLaTeX 成为 pandoc 推荐引擎；`typst.ts`（`@myriaddreamin/typst-ts-node-compiler`）把 Typst 编译为 WASM，Node 环境无需 native binary 即可出 PDF，对纯 Node 项目尤为友好。

### 2.2 PPT 两条根本不同的路线

PPT 领域存在两条产物形态完全不同的路线，需先明确目标产物：

| 路线 | 代表栈 | 产物 | 优势 | 短板 |
|---|---|---|---|---|
| Native .pptx | pptxgenjs、python-pptx、pptx-automizer | 可在 PowerPoint / Keynote 编辑的 .pptx | 可二次编辑，企业可用 | 排版需手写坐标，美观度上限低 |
| HTML / Markdown slides | Marp（marp-core）、Slidev、reveal.js | HTML 演示，可导出 PDF / PPTX | 写 Markdown 即出稿，主题美观，前端可直接预览 | 导出的 PPTX 为图片型，文字不可编辑 |

HTML → PPTX 的根本限制：HTML/CSS 的视觉表达无法无损映射到 OOXML，因此所有「HTML → PPTX」工具（Marp、reveal.js 转 PPTX）本质上都是把每页幻灯片截图后拼装成图片型 PPTX，保真度高但文字不可编辑。这是该路线的固有取舍。

### 2.3 SaaS 与 MCP 生态（仅作参考）

SaaS 那一侧，Gamma 凭「AI 理解结构 + 自动排版」跑到 7000 万用户、21 亿美金估值，Tome 则在 2025 年关停了演示产品。Agent 侧出现了一批 MCP 化封装（`samos123/pptx-mcp`、Foxit PDF MCP 30+ 工具、Document Generator MCP），本质都是把上述库包成工具暴露给模型。这些方案与 Ranni 的 local-first 定位冲突，不纳入主路径；Ranni 已有自己的工具注册表，直接加 internal tool 比引入 MCP 客户端架构更顺。

## 3. 选型决策

基于已确认方向（Puppeteer 出 PDF + HTML → PPTX + 三种产物都要展示），得出一个统一模型：**以 HTML 为中心渲染层，三个产物出口**。

### 3.1 统一渲染模型

```
agent 产出 Markdown
  ├─ 文档语义（普通 markdown）
  └─ 幻灯片语义（marp 指令：--- 分页、theme、size）
        │
        ▼  前端（展示）
  marp-core / react-markdown 直接渲染 HTML 预览
        │
        ▼  export_document 工具（后端 Puppeteer）
  ├─ 文档模式：page.pdf()              → PDF
  └─ 幻灯片模式：逐页 screenshot       → pptxgenjs 拼装 → PPTX（图片型）
```

三种产物（HTML 预览 / PDF / PPTX）共享同一个 Markdown 源与同一个 Puppeteer 实例，前端预览与最终导出视觉一致。

### 3.2 PDF：Puppeteer

`page.pdf()` 把渲染好的 HTML 打印为 PDF。Ranni 的 research 产物本就是 Markdown，前端已有 `react-markdown` 渲染能力，Markdown → HTML → PDF 链路复用度最高。Typst 作为「长报告 / 公式 / 目录」场景的高级后端，列入 P1 可选 engine，不影响 P0 主路径。

### 3.3 PPT：HTML 幻灯片 → PPTX

- 幻灯片用 Marp 的 Markdown 指令（`---` 分页、`<!-- theme -->` 等）书写，前端用 `@marp-team/marp-core` 直接渲染为 HTML 幻灯片预览，零额外成本实现「展示」。
- PPTX 导出采用 **marp-core 渲染 HTML + Puppeteer 逐页截图 + pptxgenjs 拼装** 的自研组合，产物为图片型 PPTX（高保真）。相比直接调用 `marp-cli` 子进程，该组合依赖更干净（不引入 marp-cli）、产物路径与超时完全可控，且 pptxgenjs 已是必装依赖（为 P2 的可编辑 pptx 预留）。

### 3.4 取舍清单

| 维度 | 决策 | 影响 |
|---|---|---|
| PPTX 可编辑性 | P0 产物为图片型，文字不可编辑 | 满足「任意格式都展示」的保真诉求；可编辑 pptx 列入 P2（走 pptxgenjs 结构化 JSON 路线） |
| 依赖体积 | Puppeteer 首次下载 Chromium 约 150MB | local-first 可接受；提供「使用系统 Chrome」作为后续优化项 |
| Python 运行时 | 不引入 | python-pptx 等路线排除 |
| SaaS 外发 | 不接入 | Gamma / Api2Pdf 等排除 |

## 4. Ranni 整合架构

### 4.1 复用的现有基础设施

| 现有能力 | 文件 | 复用方式 |
|---|---|---|
| 工具注册表 | `lib/tools.ts`（`toolRegistry` Map，约 1173 行起） | 直接新增工具条目，仿照 `write_file`（约 1476 行）模式 |
| Workspace 边界 | `lib/workspace.ts`（`resolveWorkspacePath` / `toWorkspaceRelative`） | 所有产物落盘到 session workspace，复用路径安全校验 |
| 三层事件 + EventMapper | `lib/events/*`、`lib/runs/event-mapper.ts` | 工具的 `tool.started` / `tool.completed` 自动出 UI 文案，前端零改动 |
| Markdown 渲染 | `components/markdown-content.tsx`（react-markdown + remark-gfm） | 文档预览复用；幻灯片预览额外引入 marp-core |
| Agent loop | `lib/agent.ts`（`runAgentTurn`，约 1502 行） | 工具自动接入现有 tool_use → execute → tool_result 流程 |

### 4.2 新增工具签名

新增两个工具，语义清晰、便于 LLM 准确调用。内容创作与渲染解耦：agent 继续用 `write_file` 写源文件，再调导出工具渲染。

```ts
// lib/tools.ts，仿照 write_file 模式新增
[
  "export_document",
  {
    schema: z.object({
      sourcePath: z.string().min(1),           // workspace 内的 .md 文件
      format: z.enum(["pdf", "pptx"]),
      mode: z.enum(["document", "slides"]).default("document"),
      engine: z.enum(["browser", "typst"]).default("browser"),  // typst 留作 P1
      template: z.string().optional(),
    }),
    tool: {
      name: "export_document",
      description: "Render a markdown file in the workspace to PDF or PPTX",
      input_schema: { /* 与 schema 对应的 JSON Schema */ },
    },
    execute: async (rawArgs, ctx) => {
      // 1. resolveWorkspacePath 校验并沙箱化 sourcePath
      // 2. 按 mode/format/engine 路由到 lib/render/*
      // 3. 产物写到 sourcePath 同目录的 exports/ 子目录
      // 4. 返回 toWorkspaceRelative(产物路径)，EventMapper 自动展示
    },
  }
]
```

幻灯片内容建议仍以 Markdown（marp 指令）书写，`mode: "slides"` 时由 marp-core 解析。若 P2 需要可编辑 pptx，再追加一个 `generate_pptx` 工具接收结构化 JSON（title / bullets / image / chart），直接走 pptxgenjs，不经过 HTML。

### 4.3 渲染层设计

新建 `lib/render/` 目录，与工具层解耦：

```
lib/render/
  browser-pdf.ts      // Puppeteer page.pdf()，文档模式
  slides-to-pptx.ts   // marp-core 渲染 HTML → Puppeteer 逐页截图 → pptxgenjs 拼装
  puppeteer-pool.ts   // 复用浏览器实例，控制并发与超时
  index.ts            // 按 engine/format 统一入口
```

渲染层只接收已校验的绝对路径与参数，不直接接触 LLM，便于单测与未来替换。

### 4.4 前端产物区与预览

- 产物落到 workspace 的 `exports/` 子目录，前端在已有文件列表里新增「产物」分组。
- PDF 产物用 iframe + blob 预览；HTML 幻灯片用 marp-core 实时渲染预览；PPTX 提供下载入口。
- 在 agent 输出区加「视图切换：文档 / 幻灯片 / PDF」toggle，复用 `agent-console.tsx` 已有的导出按钮框架。

### 4.5 安全边界

- 渲染只在 workspace 内读写，全部路径经 `resolveWorkspacePath` 校验，禁止逃逸。
- Headless Chromium 启用 sandbox，单次渲染设硬超时（建议 30s），超时即终止进程。
- 关闭 Chromium 对本地文件的越权访问（`--allow-local-files` 类能力默认禁用，按需白名单）。

## 5. 分阶段落地

| 阶段 | 内容 | 交付价值 |
|---|---|---|
| **P0** | `export_document` 工具（browser PDF + slides→pptx）；`lib/render/` 骨架；产物落 workspace；前端产物区 + PDF/HTML 预览 | 跑通「agent → 可分享 PDF/PPT」主链路 |
| **P1** | Typst.ts 高质量报告后端（`engine: "typst"`）；marp 主题与模板系统；产物管理 UI 打磨 | 长报告质量与幻灯片美观度提升 |
| **P2** | `generate_pptx` 结构化 JSON 工具（可编辑 pptx）；图表（Chart.js → 图片嵌入）；图片抓取与嵌入；批量产物 | 覆盖可编辑 pptx 与数据可视化场景 |

P0 改动范围可控：1 个 `lib/render/` 目录 + `tools.ts` 新增一个工具条目 + `agent-console.tsx` 新增产物区。预计新增依赖：`puppeteer`、`@marp-team/marp-core`、`pptxgenjs`。

## 6. 风险与待确认

- **Chromium 下载体积**：Puppeteer 首次安装下载约 150MB Chromium，影响首次装机体验。缓解：提供「使用系统已装 Chrome」的配置项（`executablePath` 指向本地 Chrome），或改用 `puppeteer-core` 让用户自备浏览器。
- **图片型 PPTX 的用户预期**：需在 UI 上明确标注「该 PPTX 为高保真图片型，文字不可编辑」，避免用户预期错位；可编辑版本走 P2。
- **marp 主题适配**：默认主题偏极简，正式场景需自定义 CSS 主题，P1 的模板系统需投入一定设计工作。
- **行号偏移**：本文引用的 `lib/tools.ts` / `lib/agent.ts` 行号为调研时快照，实现前以当前工作区为准。

## 7. 参考来源

- [Using Pandoc and Typst to Produce PDFs – Imaginary Text](https://imaginarytext.ca/posts/2024/pandoc-typst-tutorial/)
- [Typst with Pandoc: A Modern, Fast Alternative to (Xe)LaTeX for PDF](https://slhck.info/software/2025/10/25/typst-pdf-generation-xelatex-alternative.html)
- [Automated PDF Generation with Typst – Official Typst Blog](https://typst.app/blog/2025/automated-generation/)
- [@myriaddreamin/typst-ts-node-compiler — NPM](https://www.npmjs.com/package/@myriaddreamin/typst-ts-node-compiler)
- [Marp: Markdown Presentation Ecosystem](https://marp.app/)
- [@marp-team/marp-cli — NPM](https://www.npmjs.com/package/@marp-team/marp-cli)
- [Marp Alternatives: 6 Better Tools for Markdown Slides — Deckary](https://deckary.com/blog/marp-alternatives)（PPTX 图片型取舍）
- [Slidev vs Marp vs Reveal.js 2026 — PkgPulse](https://www.pkgpulse.com/guides/slidev-vs-marp-vs-revealjs-code-first-presentations-2026)
- [pptxgenjs — NPM](https://www.npmjs.com/package/pptxgenjs)
- [astefanutti/decktape — GitHub](https://github.com/astefanutti/decktape)（HTML 演示逐页截图方案参考）
- [Best AI Presentation Makers 2026 — deckary.com](https://deckary.com/blog/best-ai-presentation-maker)（Gamma / Tome 市场状态）
