# Ranni Light Theme — Ivory Moon UI

> 给 coding agent 使用的浅色模式改造说明。目标是在不破坏现有功能、后端 API、状态逻辑和暗色模式的前提下，为 Ranni 实现一套稳定、有品位、可读性好的浅色主题。

---

## 1. Theme Name

浅色主题名称：**Ivory Moon UI**

Ranni 的浅色模式不是普通 white SaaS，也不是把暗色模式简单反转，而是：

> 象牙纸面 + 月石灰 + 冷蓝墨水 + 雾紫点缀 + 轻微奥术气质

视觉关键词：

- ivory paper
- moonstone
- pale parchment
- blue-gray ink
- soft lavender
- scholarly
- calm
- readable
- premium
- restrained

浅色模式必须保留 Ranni 的研究型、编辑部式、月夜气质。不要变成高饱和、卡通、neo-brutalism 或普通管理后台。

---

## 2. Design Principles

### 2.1 不使用纯白作为主背景

避免：

```css
background: #ffffff;
```

主背景应该略带暖调或石色，否则会显得刺眼、廉价、没有 Ranni 的气质。

推荐主背景色：

```css
#F6F0E6
#F7F2E8
#F9F5EC
#FBF8F1
```

### 2.2 不使用纯黑作为主文本

避免：

```css
color: #000000;
```

正文应该像“深蓝墨水”，不是纯黑。

推荐文本色：

```css
#172033
#1D2638
#263047
```

### 2.3 Accent 必须冷静

Ranni 的主 accent 应该是低饱和月光蓝、钢蓝、雾紫。不要使用高饱和橙色、荧光青、亮粉色作为主色。

避免：

```css
#ff7a00
#00e0ff
#ff4d6d
#ffd84d
#ff9de1
```

推荐：

```css
#2F4F8F
#4B5FA8
#5A4FA3
#8FA7E6
#D8C48F
```

### 2.4 浅色模式也必须有层级

不要所有面板都是白色。至少要有 4 层：

1. App background
2. Sidebar / workspace background
3. Card / panel surface
4. Elevated popover / modal surface

### 2.5 浅色模式的目标感受

应用浅色模式后，Ranni 应该像：

- 安静的研究桌面
- 高级的写作工具
- 档案馆 / notebook 系统
- 本地 AI workbench
- 有一点月光感，但不幻想化

不应该像：

- 玩具 dashboard
- 普通 SaaS 管理后台
- 彩色 neo-brutalist 网站
- 游戏 UI
- 纯白 chatbot

---

## 3. Core Palette

### 3.1 Background

| Token | Color | Usage |
|---|---:|---|
| `--ranni-light-bg` | `#F6F0E6` | App 整体背景，象牙纸色 |
| `--ranni-light-bg-soft` | `#F9F5EC` | 主工作区背景 |
| `--ranni-light-bg-cool` | `#F3F5FA` | 冷色辅助背景，用于 report / inspector |
| `--ranni-light-canvas` | `#FBF8F1` | 报告阅读区、正文纸面 |
| `--ranni-light-surface` | `#FFFCF7` | 普通卡片、输入框、panel |
| `--ranni-light-surface-muted` | `#F4EEE2` | 次级 surface |
| `--ranni-light-surface-elevated` | `#FFFFFF` | 弹窗、浮层、菜单 |
| `--ranni-light-sidebar` | `#ECE5D8` | 侧边栏背景 |
| `--ranni-light-sidebar-active` | `#E6ECFF` | 侧边栏 active item 背景 |

### 3.2 Text

| Token | Color | Usage |
|---|---:|---|
| `--ranni-light-text` | `#172033` | 主文本、标题、重要信息 |
| `--ranni-light-text-strong` | `#0F1728` | 特别强调的标题 |
| `--ranni-light-text-muted` | `#4B5570` | 次级文本 |
| `--ranni-light-text-subtle` | `#747D96` | placeholder、meta、timestamp |
| `--ranni-light-text-disabled` | `#A3A9B8` | disabled 状态 |
| `--ranni-light-text-inverse` | `#F8FAFF` | 深色按钮上的文字 |

### 3.3 Border

| Token | Color | Usage |
|---|---:|---|
| `--ranni-light-border` | `#DED5C5` | 默认边框 |
| `--ranni-light-border-soft` | `#E9E1D4` | 弱分割线 |
| `--ranni-light-border-cool` | `#D7DEEF` | 冷色面板边框 |
| `--ranni-light-border-strong` | `#C9BDAA` | 需要强调的边框 |
| `--ranni-light-focus` | `#6F8FE8` | focus ring |

### 3.4 Accent

| Token | Color | Usage |
|---|---:|---|
| `--ranni-light-accent` | `#2F4F8F` | 主按钮、链接、重要状态 |
| `--ranni-light-accent-hover` | `#263F73` | 主按钮 hover |
| `--ranni-light-accent-active` | `#1E315A` | 主按钮 pressed / active |
| `--ranni-light-accent-soft` | `#E6ECFF` | active 背景、轻提示 |
| `--ranni-light-accent-subtle` | `#F1F4FF` | 更弱的蓝色背景 |
| `--ranni-light-violet` | `#5A4FA3` | 奥术 / report / trace 点缀 |
| `--ranni-light-violet-soft` | `#EEEAFE` | 紫色轻背景 |
| `--ranni-light-gold` | `#8A5A18` | 少量高级强调，不做大面积按钮 |
| `--ranni-light-gold-soft` | `#FFF3D5` | 引用、提示、empty state 点缀 |

### 3.5 Semantic Colors

| Token | Color | Usage |
|---|---:|---|
| `--ranni-light-success` | `#2B6A4F` | 成功状态 |
| `--ranni-light-success-soft` | `#E5F3EC` | 成功背景 |
| `--ranni-light-warning` | `#8A5A18` | 警告文本 |
| `--ranni-light-warning-soft` | `#FFF3D5` | 警告背景 |
| `--ranni-light-danger` | `#A43B45` | 危险操作 |
| `--ranni-light-danger-soft` | `#FCE8EA` | 危险背景 |
| `--ranni-light-info` | `#2F4F8F` | 信息提示 |
| `--ranni-light-info-soft` | `#E6ECFF` | 信息提示背景 |

### 3.6 Decorative Colors

这些颜色只用于少量装饰，不用于大面积 UI。

```css
--ranni-moon-silver: #C9D3E8;
--ranni-moon-blue: #8FA7E6;
--ranni-mist-violet: #C8BDF2;
--ranni-old-gold: #D8C48F;
--ranni-ink-blue: #172033;
```

使用限制：

- 月相 icon 可以用 `#8FA7E6`
- 分隔线小星点可以用 `#D8C48F`
- loading ring 可以用 `#5A4FA3`
- 装饰元素不要超过界面视觉面积的 5%

---

## 4. CSS Variables

把下面变量加入 light theme。可以放在 `src/renderer/globals.css`，也可以映射到项目当前使用的 theme selector。

```css
:root[data-theme="light"],
.theme-light {
  color-scheme: light;

  /* Background */
  --ranni-bg: #F6F0E6;
  --ranni-bg-soft: #F9F5EC;
  --ranni-bg-cool: #F3F5FA;
  --ranni-canvas: #FBF8F1;

  /* Surfaces */
  --ranni-surface: #FFFCF7;
  --ranni-surface-muted: #F4EEE2;
  --ranni-surface-elevated: #FFFFFF;
  --ranni-sidebar: #ECE5D8;
  --ranni-sidebar-active: #E6ECFF;

  /* Text */
  --ranni-text: #172033;
  --ranni-text-strong: #0F1728;
  --ranni-text-muted: #4B5570;
  --ranni-text-subtle: #747D96;
  --ranni-text-disabled: #A3A9B8;
  --ranni-text-inverse: #F8FAFF;

  /* Borders */
  --ranni-border: #DED5C5;
  --ranni-border-soft: #E9E1D4;
  --ranni-border-cool: #D7DEEF;
  --ranni-border-strong: #C9BDAA;

  /* Accent */
  --ranni-accent: #2F4F8F;
  --ranni-accent-hover: #263F73;
  --ranni-accent-active: #1E315A;
  --ranni-accent-soft: #E6ECFF;
  --ranni-accent-subtle: #F1F4FF;

  --ranni-violet: #5A4FA3;
  --ranni-violet-soft: #EEEAFE;

  --ranni-gold: #8A5A18;
  --ranni-gold-soft: #FFF3D5;

  /* Semantic */
  --ranni-success: #2B6A4F;
  --ranni-success-soft: #E5F3EC;

  --ranni-warning: #8A5A18;
  --ranni-warning-soft: #FFF3D5;

  --ranni-danger: #A43B45;
  --ranni-danger-soft: #FCE8EA;

  --ranni-info: #2F4F8F;
  --ranni-info-soft: #E6ECFF;

  /* Inputs */
  --ranni-input-bg: #FFFCF7;
  --ranni-input-border: #D7CBBB;
  --ranni-input-placeholder: #8A91A5;
  --ranni-input-focus-border: #6F8FE8;
  --ranni-input-focus-ring: rgba(111, 143, 232, 0.22);

  /* Shadows */
  --ranni-shadow-xs: 0 1px 2px rgba(23, 32, 51, 0.06);
  --ranni-shadow-sm: 0 4px 12px rgba(23, 32, 51, 0.08);
  --ranni-shadow-md: 0 12px 32px rgba(23, 32, 51, 0.12);
  --ranni-shadow-lg: 0 24px 72px rgba(23, 32, 51, 0.16);
  --ranni-shadow-glow: 0 0 32px rgba(111, 143, 232, 0.14);

  /* Radius */
  --ranni-radius-xs: 6px;
  --ranni-radius-sm: 10px;
  --ranni-radius-md: 14px;
  --ranni-radius-lg: 20px;
  --ranni-radius-xl: 28px;

  /* Selection */
  --ranni-selection-bg: #DDE7FF;
  --ranni-selection-text: #172033;

  /* Code */
  --ranni-code-bg: #F0E8DA;
  --ranni-code-border: #DED5C5;
  --ranni-code-text: #263047;
}
```

如果项目当前还有旧变量，比如：

```css
--background
--background-strong
--accent
--accent-strong
--shadow
--border
```

需要把它们映射到新的 Ranni token，避免旧 neo-brutalism 颜色继续泄漏。

示例：

```css
:root[data-theme="light"],
.theme-light {
  --background: var(--ranni-bg);
  --background-soft: var(--ranni-bg-soft);
  --surface: var(--ranni-surface);
  --text: var(--ranni-text);
  --text-muted: var(--ranni-text-muted);
  --border: var(--ranni-border);
  --accent: var(--ranni-accent);
  --shadow: var(--ranni-shadow-md);
}
```

---

## 5. Body Background

浅色模式的背景不要是一整块纯色。推荐使用非常轻的月石渐变。

```css
body {
  background:
    radial-gradient(circle at 16% 8%, rgba(111, 143, 232, 0.16), transparent 28%),
    radial-gradient(circle at 88% 12%, rgba(90, 79, 163, 0.10), transparent 24%),
    linear-gradient(135deg, #F6F0E6 0%, #F9F5EC 48%, #F3F5FA 100%);
  color: var(--ranni-text);
}
```

不要使用高饱和大色块背景。浅色 Ranni 应该像纸面、月光、石材，而不是糖果色。

---

## 6. Component Rules

### 6.1 App Shell

```css
.appShell {
  background: rgba(255, 252, 247, 0.72);
  border: 1px solid var(--ranni-border);
  box-shadow: var(--ranni-shadow-lg);
  backdrop-filter: blur(18px);
}
```

### 6.2 Sidebar

Sidebar 应该比主内容略深，像“档案馆侧栏”。

```css
.sidebar {
  background:
    linear-gradient(180deg, rgba(236, 229, 216, 0.96), rgba(244, 238, 226, 0.9));
  border-right: 1px solid var(--ranni-border);
  color: var(--ranni-text-muted);
}
```

Active item：

```css
.navItemActive {
  background: var(--ranni-sidebar-active);
  color: var(--ranni-accent);
  border: 1px solid var(--ranni-border-cool);
  box-shadow: 0 8px 24px rgba(47, 79, 143, 0.10);
}
```

禁止在 light theme 里使用粗黑边框或硬阴影。

### 6.3 Main Panel / Cards

```css
.card {
  background: var(--ranni-surface);
  border: 1px solid var(--ranni-border-soft);
  border-radius: var(--ranni-radius-lg);
  box-shadow: var(--ranni-shadow-sm);
}
```

Hover：

```css
.card:hover {
  border-color: var(--ranni-border-cool);
  box-shadow: var(--ranni-shadow-md);
}
```

### 6.4 Primary Button

```css
.buttonPrimary {
  background: linear-gradient(180deg, #355A9F 0%, #2F4F8F 100%);
  color: var(--ranni-text-inverse);
  border: 1px solid rgba(15, 23, 40, 0.12);
  box-shadow:
    0 8px 18px rgba(47, 79, 143, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.24);
}
```

Hover：

```css
.buttonPrimary:hover {
  background: linear-gradient(180deg, #2F4F8F 0%, #263F73 100%);
}
```

Pressed：

```css
.buttonPrimary:active {
  background: #1E315A;
  transform: translateY(1px);
}
```

### 6.5 Secondary Button

```css
.buttonSecondary {
  background: var(--ranni-surface);
  color: var(--ranni-text);
  border: 1px solid var(--ranni-border);
  box-shadow: var(--ranni-shadow-xs);
}
```

Hover：

```css
.buttonSecondary:hover {
  background: var(--ranni-accent-subtle);
  border-color: var(--ranni-border-cool);
  color: var(--ranni-accent);
}
```

### 6.6 Ghost Button

```css
.buttonGhost {
  background: transparent;
  color: var(--ranni-text-muted);
  border: 1px solid transparent;
}
```

Hover：

```css
.buttonGhost:hover {
  background: rgba(47, 79, 143, 0.08);
  color: var(--ranni-accent);
}
```

### 6.7 Inputs

```css
.input,
.textarea {
  background: var(--ranni-input-bg);
  color: var(--ranni-text);
  border: 1px solid var(--ranni-input-border);
  border-radius: var(--ranni-radius-md);
  box-shadow: inset 0 1px 2px rgba(23, 32, 51, 0.04);
}
```

Focus：

```css
.input:focus,
.textarea:focus {
  outline: none;
  border-color: var(--ranni-input-focus-border);
  box-shadow:
    0 0 0 4px var(--ranni-input-focus-ring),
    inset 0 1px 2px rgba(23, 32, 51, 0.04);
}
```

Placeholder：

```css
.input::placeholder,
.textarea::placeholder {
  color: var(--ranni-input-placeholder);
}
```

---

## 7. Report / Markdown Rules

Report 是 Ranni 最重要的界面之一。浅色模式下，报告区应该像一张高级纸面，不要像普通卡片。

### 7.1 Report Canvas

```css
.reportCanvas {
  background: var(--ranni-canvas);
  color: var(--ranni-text);
  border: 1px solid var(--ranni-border-soft);
  box-shadow: var(--ranni-shadow-md);
}
```

### 7.2 Markdown Typography

```css
.markdown {
  color: var(--ranni-text);
}

.markdown h1,
.markdown h2,
.markdown h3 {
  color: var(--ranni-text-strong);
}

.markdown h1 {
  border-bottom: 1px solid var(--ranni-border-soft);
}

.markdown h2 {
  color: var(--ranni-accent);
}

.markdown p,
.markdown li {
  color: var(--ranni-text);
}

.markdown a {
  color: var(--ranni-accent);
  text-decoration-color: rgba(47, 79, 143, 0.32);
}

.markdown a:hover {
  text-decoration-color: var(--ranni-accent);
}
```

### 7.3 Blockquote

Blockquote 不要用黑边黄底。使用“旧纸 + 蓝色边线”。

```css
.markdown blockquote {
  background: linear-gradient(90deg, rgba(230, 236, 255, 0.72), rgba(255, 252, 247, 0.9));
  border-left: 3px solid var(--ranni-accent);
  color: var(--ranni-text-muted);
}
```

### 7.4 Inline Code

```css
.markdown code {
  background: var(--ranni-code-bg);
  color: var(--ranni-code-text);
  border: 1px solid var(--ranni-code-border);
}
```

### 7.5 Code Block

```css
.markdown pre {
  background: #F0E8DA;
  color: #263047;
  border: 1px solid var(--ranni-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42);
}
```

### 7.6 Tables

```css
.markdown table {
  border: 1px solid var(--ranni-border);
  background: var(--ranni-surface);
}

.markdown th {
  background: #EEF2FF;
  color: var(--ranni-accent);
  border-bottom: 1px solid var(--ranni-border-cool);
}

.markdown td {
  border-bottom: 1px solid var(--ranni-border-soft);
}
```

---

## 8. Trace / Developer View Rules

Trace 视图不能太花。浅色模式下，它应该像“审计日志 / 研究过程档案”。

### 8.1 Trace Panel

```css
.tracePanel {
  background: #F8F4EA;
  border: 1px solid var(--ranni-border);
}
```

### 8.2 Run Item

```css
.traceRunItem {
  background: var(--ranni-surface);
  border: 1px solid var(--ranni-border-soft);
}
```

### 8.3 Selected Run

```css
.traceRunItemSelected {
  background: var(--ranni-accent-soft);
  border-color: var(--ranni-border-cool);
  color: var(--ranni-accent);
}
```

### 8.4 Tool Call

```css
.toolCall {
  background: #F1F4FF;
  border: 1px solid #D7DEEF;
}
```

### 8.5 Tool Result

```css
.toolResult {
  background: #F6F0E6;
  border: 1px solid #DED5C5;
}
```

### 8.6 Error

```css
.traceError {
  background: var(--ranni-danger-soft);
  border: 1px solid rgba(164, 59, 69, 0.28);
  color: var(--ranni-danger);
}
```

---

## 9. Status Colors

### 9.1 Running

```css
.statusRunning {
  background: var(--ranni-info-soft);
  color: var(--ranni-info);
  border: 1px solid rgba(47, 79, 143, 0.18);
}
```

### 9.2 Completed

```css
.statusCompleted {
  background: var(--ranni-success-soft);
  color: var(--ranni-success);
  border: 1px solid rgba(43, 106, 79, 0.18);
}
```

### 9.3 Warning

```css
.statusWarning {
  background: var(--ranni-warning-soft);
  color: var(--ranni-warning);
  border: 1px solid rgba(138, 90, 24, 0.22);
}
```

### 9.4 Error

```css
.statusError {
  background: var(--ranni-danger-soft);
  color: var(--ranni-danger);
  border: 1px solid rgba(164, 59, 69, 0.22);
}
```

---

## 10. Agent Message Colors

### 10.1 User Message

```css
.messageUser {
  background: #EEF2FF;
  border: 1px solid #D7DEEF;
  color: var(--ranni-text);
}
```

### 10.2 Assistant Message

```css
.messageAssistant {
  background: var(--ranni-surface);
  border: 1px solid var(--ranni-border-soft);
  color: var(--ranni-text);
}
```

### 10.3 System / Runtime Message

```css
.messageSystem {
  background: #F4EEE2;
  border: 1px dashed var(--ranni-border-strong);
  color: var(--ranni-text-muted);
}
```

---

## 11. Shadows

浅色模式里阴影要柔，不要硬黑阴影。

避免：

```css
box-shadow: 8px 8px 0 #111111;
box-shadow: 4px 4px 0 #111111;
```

推荐：

```css
box-shadow: 0 12px 32px rgba(23, 32, 51, 0.12);
```

层级建议：

```css
--shadow-card: 0 4px 12px rgba(23, 32, 51, 0.08);
--shadow-panel: 0 12px 32px rgba(23, 32, 51, 0.12);
--shadow-modal: 0 24px 72px rgba(23, 32, 51, 0.16);
--shadow-glow: 0 0 32px rgba(111, 143, 232, 0.14);
```

---

## 12. Recommended Light Mode Layout Feel

浅色模式下，各区域大致应该这样分配颜色：

```txt
App background:
  #F6F0E6 / #F9F5EC subtle gradient

Sidebar:
  #ECE5D8

Main workspace:
  #F9F5EC

Report canvas:
  #FBF8F1

Cards:
  #FFFCF7

Right inspector:
  #F3F5FA or #FFFCF7

Active navigation:
  #E6ECFF

Primary action:
  #2F4F8F

Secondary action:
  #FFFCF7 with border #DED5C5
```

---

## 13. What To Remove From Existing Light Mode

Coding agent should remove or replace these visual patterns in light mode:

```css
3px solid #111111
4px 4px 0 #111111
8px 8px 0 #111111
#ffd84d
#ff7a00
#ff4d6d
#00e0ff
#ff9de1
#ffffff as full-page background
#000000 as main text
```

这些属于旧 neo-brutalist 方向，和 Ranni 当前的视觉身份冲突。

---

## 14. Implementation Priority

请按这个顺序实现，不要一次性重构过多逻辑。

### P0 — Replace global light theme tokens

优先修改：

```txt
src/renderer/globals.css
```

目标：

- 加入 Ivory Moon light theme variables
- 移除 light theme 中的旧 neo-brutalism 颜色
- 保持 dark theme 行为不变
- 保证 body、root、app shell 在 light theme 下都使用新的浅色背景

### P1 — Replace hard-coded component colors

优先修改：

```txt
components/agent-console.module.css
components/markdown-content.module.css
```

目标：

- 移除 `#111111` 粗黑边
- 移除硬黑 offset shadow
- 移除黄色、橙色、荧光青、亮粉等旧高饱和色
- 所有主要组件改用 `--ranni-*` token

### P1 — Fix report / markdown reading experience

报告区必须优先处理，因为 Ranni 的核心能力是产出研究报告。

目标：

- report background 使用 `--ranni-canvas`
- markdown 标题有编辑部式层级
- blockquote 使用蓝色左边线 + 纸面底色
- code block 使用柔和米灰背景
- table 不使用高饱和 header

### P2 — Fix trace / tool call appearance

目标：

- trace 视图像审计档案，不像彩色 debug 面板
- tool call 使用冷蓝浅底
- tool result 使用纸面浅底
- error 使用柔和红色语义色

### P2 — Fix buttons, inputs, nav states

目标：

- primary button 使用冷蓝渐变
- secondary button 使用纸面背景 + 柔边框
- input focus 使用蓝色 focus ring
- active nav 使用淡蓝底，不使用亮黄色或硬边框

---

## 15. Non-Goals

本次不要做这些事情：

- 不要修改 `/api/runtime`
- 不要修改 `/api/chat`
- 不要改 agent 执行逻辑
- 不要改 streaming 逻辑
- 不要重写 session 管理
- 不要重构整个前端架构
- 不要破坏 dark theme
- 不要引入新的 UI library，除非项目已经使用
- 不要为了浅色主题添加复杂动效

---

## 16. Acceptance Criteria

实现完成后，至少满足以下标准：

1. Light theme 不再出现明显 neo-brutalist 视觉残留。
2. 页面主背景不是纯白，而是 ivory / moonstone 风格渐变。
3. 主文本不是纯黑，而是深蓝墨水色。
4. 不再有 `3px solid #111111` 类型的粗黑边框。
5. 不再有 `8px 8px 0 #111111` 类型的硬黑阴影。
6. Sidebar、main workspace、cards、report canvas 有明确层级。
7. Report / Markdown 在浅色模式下可长时间阅读。
8. Buttons、inputs、tabs、nav active states 都使用统一 token。
9. Status colors 有语义区分，但不刺眼。
10. Dark theme 行为不变。
11. 不破坏现有后端 API 和 agent 运行逻辑。
12. 通过项目现有的 typecheck / lint / build。

---

## 17. Suggested Final Coding Agent Prompt

可以直接把下面这段作为执行指令：

```txt
Implement the Ivory Moon light theme from this file.

Do not simply invert the dark theme.
Do not preserve old neo-brutalist colors, hard black borders, or hard offset shadows.

Priority:
1. Replace global light theme tokens in src/renderer/globals.css.
2. Replace hard-coded bright colors in components/agent-console.module.css.
3. Make report/markdown reading area look like ivory editorial paper in components/markdown-content.module.css.
4. Keep dark theme behavior unchanged.
5. Keep all backend APIs and existing UI logic unchanged.
6. Do not modify /api/runtime or /api/chat behavior.
7. Run typecheck, lint, and build after changes.

Target visual direction:
Ivory paper background, moonstone surfaces, blue-gray ink text, cool blue accents, soft lavender highlights, subtle old-gold decorative details, quiet scholarly research workbench.
```
