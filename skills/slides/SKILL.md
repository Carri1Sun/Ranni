---
name: slides
description: Use when the user wants to create or edit PowerPoint decks (.pptx): research reports, executive decks, strategy narratives, technical explainers, keynote-style talks. Produces editable native pptx with deck planning, layout helpers, and post-generation validation.
---

# slides 技能

## 何时使用
用户要做 PPT、演示稿、汇报 deck、路演稿、研究汇报、技术方案 deck、教学或培训材料，并希望输出可在 PowerPoint、Keynote 或 WPS 里继续编辑的 `.pptx`。

## keep editable 原则
- 文字必须保持为 PowerPoint 文本对象，不要把整页栅格化成图片。
- 简单图表优先用 native chart，保证后续能改数。
- 图片只作为独立资产放入页面，不承载整页文字。
- 产物应是 native editable `.pptx`，不是截图集合。

## deck 编译流水线
1. 对非平凡 deck，先调用 `init_deck_workspace` 建立 `brief.md`、`deck_narrative.md`、`slide_specs.yaml`、`final/`、`preview/`、`validation/` 和 `assets/`。
2. 先写清读者、使用场景、目标动作、叙事结构和逐页任务，再生成 PPTX。不要边画边想。
3. 调用 `generate_pptx` 时传语义化 layout：`title`、`title-bullets`、`title-content`、`two-col`、`section` 或 `blank`。工具内部负责坐标与基础样式。
4. 生成后做最小自检：确认路径、页数、关键页面内容和可编辑性；需要时读取 PPTX XML 检查 `<a:t>` 文本节点。
5. 交付时给出 `.pptx` 路径，并说明这是可编辑 native PPTX。

## 每页独立决策
逐页判断读者问题、页面任务、核心结论和资产模式。不要对所有页面套同一个密度和版式。

## 资产路由
- 可改数的数据：native chart。
- 结构化对比：文本列或表格。
- 氛围图或复杂视觉：单独图片资产。
- 流程和架构图：后续 P1/P2 再用 native shape 与 connector 扩展。

## 默认产物位置
没有用户指定输出路径时，把 deck workspace 放在当前 session workspace 的 `.ranni/decks/<deck-slug>/` 下，最终 PPTX 放在 `final/<deck-slug>.pptx`。`.ranni/` 是本地运行产物目录，已被仓库忽略。

## 边界
- 当前 P0 支持基础版式、文字、图片和简单 native chart。
- 当前 P0 不依赖屏幕操作类工具。
- 渲染预览、结构化 layout 检查、模板继承、复杂图表和 diagram 属于后续阶段。
