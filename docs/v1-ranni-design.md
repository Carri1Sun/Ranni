# Ranni UI Design System — Moonlit Research Workbench

版本：v1.0  
用途：给 coding agent / 前端实现者使用，用来把现有 Ranni 前端从 bright neobrutalism 改造成更符合产品气质的本地 AI Agent 桌面界面。

---

## 1. 产品气质

Ranni 是一个 local-first AI Agent。她能处理本地文件、搜索、抓取网页、执行工具、记录 trace，并特别擅长复杂调研与产出深度报告。

前端设计不要做成普通聊天机器人，也不要做成游戏同人界面。目标气质是：

- 冷静、聪明、克制。
- 研究者 / 编辑部 / 桌面工作台，而不是玩具式助手。
- 有轻微 moon / arcane / scholar 氛围，但必须保持可读、可用、专业。
- 深色为主，局部可以用 ivory report surface 做长文阅读。
- 视觉记忆点来自月相、星图线、精致排版、安静的蓝紫色光，而不是大面积装饰。

核心风格名称：**Moonlit Research Workbench**。

风格配比：

- 45% Desktop Productivity / Local Agent Workbench
- 30% Editorial Minimalism / Swiss Grid
- 15% Dark Academia / Arcane Scholar
- 10% Subtle Glass / Moonlit Atmosphere

避免：

- 不要继续使用大面积明黄、亮橙、亮粉、亮青的 neobrutalism 色块。
- 不要使用 3px 纯黑粗边框和大硬阴影作为默认组件语言。
- 不要使用 Elden Ring 角色图像、游戏截图、符号或任何直接可识别的版权素材。
- 不要做成高饱和 cyberpunk，不要过量霓虹，不要牺牲长文可读性。

---

## 2. 当前项目改造方向

当前项目已有这些主要前端文件：

- `src/renderer/globals.css`：全局变量、字体、body 背景、splash 样式。
- `components/agent-console.tsx`：核心 Agent Console UI、session、chat feed、trace view、message composer。
- `components/agent-console.module.css`：当前主要 UI 样式。
- `components/markdown-content.tsx`：Markdown 渲染组件。
- `components/markdown-content.module.css`：Markdown 内容样式。

这次改造的重点不是重写 agent 后端，而是：

1. 保留现有 `/api/runtime` 与 `/api/chat` 的交互逻辑。
2. 保留 session、chat、trace、tool call、tool result、copy/export 等已有能力。
3. 用新的 design tokens 和布局语言替换当前的 bright neobrutalism。
4. 让产品从“醒目的实验原型”变成“可信、有品位的本地研究型 Agent”。

---

## 3. 颜色系统

### 3.1 默认深色主题

请在 `src/renderer/globals.css` 中建立新的 token。可以保留旧变量名用于兼容，但视觉上应切换到以下语义变量。

```css
:root {
  color-scheme: dark;

  /* Background */
  --ranni-bg-0: #050812;
  --ranni-bg-1: #080d19;
  --ranni-bg-2: #0c1323;
  --ranni-bg-radial-1: rgba(104, 123, 255, 0.18);
  --ranni-bg-radial-2: rgba(190, 168, 255, 0.10);

  /* Surfaces */
  --ranni-surface-0: rgba(12, 18, 32, 0.86);
  --ranni-surface-1: rgba(17, 25, 43, 0.84);
  --ranni-surface-2: rgba(23, 33, 55, 0.78);
  --ranni-surface-solid: #101827;
  --ranni-surface-raised: #151f34;
  --ranni-surface-hover: #1b2944;

  /* Text */
  --ranni-text-0: #f1f4fb;
  --ranni-text-1: #c9d2e8;
  --ranni-text-2: #9aa7c0;
  --ranni-text-3: #6f7b94;

  /* Lines */
  --ranni-line-0: rgba(212, 222, 255, 0.10);
  --ranni-line-1: rgba(212, 222, 255, 0.16);
  --ranni-line-2: rgba(212, 222, 255, 0.26);

  /* Brand / accent */
  --ranni-accent-0: #8fa7ff;
  --ranni-accent-1: #a996ff;
  --ranni-accent-2: #c8d7ff;
  --ranni-accent-soft: rgba(143, 167, 255, 0.16);
  --ranni-accent-glow: rgba(143, 167, 255, 0.30);
  --ranni-gold: #c8b27d;
  --ranni-gold-soft: rgba(200, 178, 125, 0.16);

  /* Status */
  --ranni-success: #68d6a3;
  --ranni-warning: #e6c36a;
  --ranni-danger: #ff6b7a;
  --ranni-info: #86c7ff;

  /* Report light surface, optional */
  --ranni-ivory-0: #f7f3ea;
  --ranni-ivory-1: #ede5d7;
  --ranni-ink: #142033;
  --ranni-ink-muted: #5c6577;

  /* Geometry */
  --radius-xs: 6px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 999px;

  /* Spacing scale: 4/8 system */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Shadows / glow */
  --shadow-soft: 0 18px 60px rgba(0, 0, 0, 0.34);
  --shadow-panel: 0 12px 36px rgba(0, 0, 0, 0.28);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --glow-accent: 0 0 32px rgba(143, 167, 255, 0.22);

  /* Typography */
  --font-ui: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
  --font-serif: "Iowan Old Style", "New York", Georgia, "Songti SC", serif;
  --font-mono: "IBM Plex Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
}
```

如果不引入外部字体，使用系统 fallback 即可。不要为了字体加载破坏 Electron 本地启动体验。

### 3.2 色彩使用规则

- 大面积背景：`--ranni-bg-0` / `--ranni-bg-1`。
- 主容器：`--ranni-surface-0`。
- 卡片：`--ranni-surface-1` / `--ranni-surface-2`。
- 描边：默认 `--ranni-line-1`，重要边界 `--ranni-line-2`。
- 主行动按钮：`--ranni-accent-0` 背景或描边。
- 进行中状态：`--ranni-accent-0`。
- 完成状态：`--ranni-success`。
- 错误状态：`--ranni-danger`。
- 装饰性月相 / 星图线：`--ranni-gold`，透明度控制在 12%–32%。

页面中高饱和颜色最多只用于状态点、进度条、当前 tab、primary button。不要用大面积纯色块。

---

## 4. 排版系统

### 4.1 字体角色

- UI 文本：`var(--font-ui)`。
- Logo、报告标题、大标题：`var(--font-serif)`。
- Trace、tool call、路径、模型名、token 数：`var(--font-mono)`。

### 4.2 字号建议

```css
--text-xs: 11px;
--text-sm: 12px;
--text-md: 14px;
--text-lg: 16px;
--text-xl: 20px;
--text-2xl: 28px;
--text-3xl: 40px;
```

具体规则：

- Sidebar item：13px–14px，line-height 1.3。
- Panel title：12px uppercase 或 15px semibold。
- Chat body：14px–15px，line-height 1.65。
- Report body：16px，line-height 1.75。
- Report h1：36px–48px serif，line-height 1.05。
- Report h2：22px–28px serif，line-height 1.18。
- Trace/code：12px–13px mono，line-height 1.65。

### 4.3 文本风格

- 标题不要过度加粗。Ranni 的高级感来自字距、留白和层级，不来自粗黑大字。
- 英文小标题可使用 uppercase + letter-spacing，例如 `letter-spacing: 0.12em`。
- 正文颜色不要用纯白，优先 `--ranni-text-1`。
- 次级信息使用 `--ranni-text-2` 或 `--ranni-text-3`。

---

## 5. 布局系统

### 5.1 App Shell

桌面端采用三层工作台结构：

```text
┌───────────────────────────────────────────────────────────────┐
│ App Window                                                     │
│ ┌──────────────┬────────────────────────────┬───────────────┐ │
│ │ Sidebar      │ Main Workbench             │ Inspector     │ │
│ │ Sessions     │ Chat / Research / Trace    │ Runtime       │ │
│ │ Navigation   │ Report / Tool stream       │ Sources/Trace │ │
│ └──────────────┴────────────────────────────┴───────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

建议尺寸：

```css
.shell {
  width: min(100vw, 1500px);
  height: 100dvh;
  margin: 0 auto;
  padding: 14px;
}

.workspace {
  height: 100%;
  display: grid;
  grid-template-columns: 280px minmax(560px, 1fr) 340px;
  gap: 14px;
  min-height: 0;
}
```

如果暂时不想重构 TSX 为三列，可以先保持两列：left session sidebar + main panel，然后在 main panel 内部拆 header / feed / trace inspector。但视觉上仍按三列工作台设计。

### 5.2 响应式

- `>= 1280px`：三列完整显示。
- `980px–1279px`：右侧 inspector 收进 main 的 tab，sidebar 仍保留。
- `< 980px`：单列布局，sidebar 变成顶部 session selector，inspector 移到下方。

Electron 当前窗口最小宽度接近桌面应用，不要为了移动端过度牺牲桌面体验。

---

## 6. 组件风格

### 6.1 Panel / Card

默认面板：

```css
.panel {
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)),
    var(--ranni-surface-0);
  box-shadow: var(--shadow-panel), var(--shadow-inset);
  backdrop-filter: blur(18px);
}
```

规则：

- 不使用 3px 纯黑边框。
- 不使用硬阴影 `8px 8px 0 #111`。
- 鼠标 hover 只做轻微 background、border、translateY(-1px)，不要跳动。

### 6.2 Sidebar

Sidebar 目标：像本地工作台，不像网页导航。

内容建议：

- 顶部：Ranni logo / wordmark / subtitle `Local AI Agent`。
- 主导航：Console、Research、Browser、Files、Knowledge、Reports、Settings。
- Session 列表：保留现有 session 数据。
- 底部：Local Model / Workspace / API status 简卡。

视觉：

```css
.sidebar {
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 50% 0%, rgba(143,167,255,0.12), transparent 38%),
    rgba(8, 13, 25, 0.86);
  color: var(--ranni-text-1);
}
```

Active item：

```css
.navItemActive {
  color: var(--ranni-text-0);
  background: rgba(143, 167, 255, 0.14);
  border: 1px solid rgba(143, 167, 255, 0.28);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
}
```

### 6.3 Header

Header 应展示：

- 当前 session / 当前任务标题。
- runtime status：模型、provider、workspace root。
- view toggle：Console / Trace / Research State。
- 重要按钮：New Session、Export、Copy、Stop/Pause（如果已有逻辑）。

Header 高度控制在 64px–88px。不要把 header 做得过重。

### 6.4 Buttons

Primary button：

```css
.primaryButton {
  height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(143, 167, 255, 0.38);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(143,167,255,0.30), rgba(143,167,255,0.18));
  color: var(--ranni-text-0);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.03) inset, 0 10px 24px rgba(81, 95, 180, 0.18);
}
```

Secondary button：transparent / surface background + border。

Danger button：仅在停止任务、错误操作时使用 `--ranni-danger`，面积要小。

### 6.5 Input / Composer

Composer 应像“命令台 + 研究助手输入框”，不要像彩色便签。

建议：

```css
.composer {
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-lg);
  background: rgba(10, 15, 27, 0.92);
  box-shadow: var(--shadow-inset);
}

.textarea {
  min-height: 64px;
  max-height: 220px;
  padding: 14px 108px 42px 16px;
  color: var(--ranni-text-0);
  background: transparent;
  border: 0;
  outline: none;
  line-height: 1.6;
}
```

Placeholder：`Ask Ranni to research, inspect files, or draft a report…`

### 6.6 Chat Message

Assistant message：偏 report card，适合长文本。

User message：偏 compact bubble，但仍保持冷静。

```css
.message {
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
  max-width: min(860px, 88%);
}

.assistantMessage {
  background: rgba(17, 25, 43, 0.82);
}

.userMessage {
  background: rgba(143, 167, 255, 0.14);
  border-color: rgba(143, 167, 255, 0.26);
}
```

Tool/status message 不要抢主内容风头。用 compact activity row：

- `status`：灰蓝。
- `tool_call`：紫蓝。
- `tool_result`：绿色成功态。
- `error`：红色边框 + 深色背景。

### 6.7 Trace View

Trace 是 Ranni 的“可审计性”核心，应视觉上像 instrumentation panel。

建议结构：

- 左：Runs 列表。
- 中：Step overview + context/request/response/tool blocks。
- 右或顶部：当前 step summary cards：Duration、Output tokens、Tool calls、Status。

Trace block：

```css
.traceBlock pre {
  max-height: 420px;
  overflow: auto;
  padding: 14px 16px;
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-md);
  background: rgba(4, 7, 14, 0.72);
  color: #d7e0f7;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
}
```

### 6.8 Markdown / Report Surface

Ranni 的核心卖点是研究报告。Markdown 渲染要明显优于普通聊天文本。

`components/markdown-content.module.css` 应改成 report-like 样式：

```css
.markdown {
  display: grid;
  gap: 1rem;
  color: var(--ranni-text-1);
  line-height: 1.72;
  font-weight: 450;
}

.markdown h1,
.markdown h2,
.markdown h3 {
  color: var(--ranni-text-0);
  font-family: var(--font-serif);
  font-weight: 500;
  letter-spacing: -0.025em;
}

.markdown h1 { font-size: 2rem; line-height: 1.08; }
.markdown h2 { font-size: 1.45rem; margin-top: 0.4rem; }
.markdown h3 { font-size: 1.16rem; }

.markdown blockquote {
  padding: 0.85rem 1rem;
  border-left: 2px solid var(--ranni-gold);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: rgba(200, 178, 125, 0.08);
  color: var(--ranni-text-1);
}

.markdown table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-md);
}

.markdown th {
  background: rgba(143, 167, 255, 0.10);
  color: var(--ranni-text-0);
}

.markdown th,
.markdown td {
  padding: 0.7rem 0.8rem;
  border-bottom: 1px solid var(--ranni-line-0);
  text-align: left;
  vertical-align: top;
}

.markdown code {
  font-family: var(--font-mono);
}

.markdown :not(pre) > code {
  padding: 0.12rem 0.34rem;
  border: 1px solid var(--ranni-line-1);
  border-radius: 6px;
  background: rgba(255,255,255,0.05);
}

.markdown pre {
  padding: 0.9rem 1rem;
  border: 1px solid var(--ranni-line-1);
  border-radius: var(--radius-md);
  background: rgba(4,7,14,0.76);
}
```

如果做 ivory report mode，可给 report preview 单独使用：

- 背景：`--ranni-ivory-0`
- 正文：`--ranni-ink`
- 描边：`rgba(20, 32, 51, 0.10)`
- 标题：深蓝 serif

但不要让整个 app 变浅色。浅色只适合 report/editor 画布。

---

## 7. 装饰语言

装饰只允许作为“轻微品牌识别”。

可使用：

- crescent moon icon
- moon phase dots
- star / sparkle divider
- thin constellation lines
- circular astrolabe-like progress indicator
- subtle radial glow

实现方式：

- 优先用 CSS pseudo-elements、inline SVG、简单 Unicode glyph。
- 不要引入复杂图片素材。
- 不要使用 Elden Ring 原始图案或角色元素。

示例：

```css
.brandMark::before {
  content: "☾";
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: var(--ranni-accent-2);
  background: radial-gradient(circle, rgba(143,167,255,0.22), rgba(143,167,255,0.06));
  border: 1px solid rgba(143,167,255,0.22);
  box-shadow: var(--glow-accent);
}
```

---

## 8. Motion

Ranni 的动效应该像“雾中浮现”，而不是弹跳。

默认：

```css
--motion-fast: 120ms;
--motion-base: 180ms;
--motion-slow: 260ms;
--ease-ranni: cubic-bezier(0.22, 1, 0.36, 1);
```

规则：

- hover：背景 / border / opacity / translateY(-1px)。
- panel enter：opacity + 4px translateY。
- loading / thinking：微弱脉冲或月相环，避免强闪烁。
- 尊重 `prefers-reduced-motion`。

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

## 9. 可访问性与可读性

必须满足：

- 所有正文与背景的对比度足够，不要把文字放在高透明 glass 上。
- focus-visible 明确可见，使用 accent outline。
- 按钮 disabled 态必须清晰。
- 错误信息必须可读，不只靠颜色表示。
- 长文本宽度控制在合适范围，报告正文建议 `max-width: 820px`。
- 不要把 tiny uppercase 用于正文，只用于标签和 eyebrow。

---

## 10. 实现映射建议

### 10.1 `src/renderer/globals.css`

改动：

- 替换当前 bright neobrutalism 变量。
- body 背景改为深色月夜背景。
- splash card 改为 dark glass panel。

建议 body 背景：

```css
body {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ranni-text-0);
  background:
    radial-gradient(circle at 12% 0%, var(--ranni-bg-radial-1), transparent 30%),
    radial-gradient(circle at 88% 8%, var(--ranni-bg-radial-2), transparent 26%),
    linear-gradient(180deg, var(--ranni-bg-0) 0%, var(--ranni-bg-1) 58%, #050713 100%);
  font-family: var(--font-ui);
}
```

### 10.2 `components/agent-console.module.css`

优先替换这些类的视觉：

- `.shell`
- `.workspace`
- `.sidebar`
- `.primarySidebarButton`
- `.iconButton`
- `.sessionItem`
- `.chatShell`
- `.chatHeader`
- `.viewButton`
- `.chatMeta`
- `.feed`
- `.message`
- `.assistantMessage`
- `.userMessage`
- `.activity`
- `.status`
- `.tool_call`
- `.tool_result`
- `.error`
- `.composer`
- `.textarea`
- `.submitButton`
- `.traceShell`
- `.traceSidebar`
- `.traceDetailPanel`
- `.traceBlock`
- `.summaryCard`
- `.infoPanel`
- `.floatingInfoButton`

删除或覆盖这些旧视觉特征：

- `border: 3px solid #111111`
- `box-shadow: 6px 6px 0 #111111`
- `background: #ffd84d`, `#ff7a00`, `#ff9de1`, `#00e0ff`, `#c9ff66`
- hover 时的大幅移动和硬阴影

### 10.3 `components/markdown-content.module.css`

把当前粗黑边、亮色表头、厚重 blockquote 改成 report-like 样式。Markdown 是产品的核心输出，不要只是消息气泡里的普通文本。

---

## 11. 质量判断标准

改造完成后，界面应该满足：

- 看起来像一个本地 AI research workbench，不像普通 web chat。
- 即使没有装饰图，也能通过排版、色彩和层级体现 Ranni 的气质。
- Trace、tool call、tool result 的可审计性比改造前更清楚。
- 长篇 Markdown 报告的阅读体验明显提升。
- 深色环境下连续使用 30 分钟不刺眼。
- 任何页面都不依赖版权角色形象或游戏素材。

