---
author: codex
version: v1
date: 2026-07-14
---

# Ranni 架构全局文档（architecture-global）

这一目录用于「概念对齐」：把 Ranni 当前真实运行的架构主体、能力延展、流程、限制和概念定义，整理成可与代码逐条对照的文档。目标是让沟通时使用的名词和边界保持一致。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [glossary.md](./glossary.md) | 概念词典。每个名词对应代码落点，是「对齐概念」的首选入口。 |
| [ranni-architecture-report.md](./ranni-architecture-report.md) | 架构主报告。总览、主循环、能力、限制、运行时、provider、skill、已实现 vs 规划中。 |

## 阅读建议

- 第一次对齐概念：先读 `glossary.md`，再读主报告第 1、8 章。
- 想理解一轮 Run 怎么走：主报告第 2 章。
- 想知道某个动作会不会被拦 / 被限：主报告第 4 章 + `glossary.md` 的 Guard / Workspace 边界词条。
- 想区分「文档写了但代码没做」：主报告第 8 章。

## 与既有文档的关系

本目录是当前代码快照的「对齐版」总结，不替代以下既有文档，而是在它们之上做概念收敛：

- 设计哲学与原则：`docs/tech/v1-architecture/agent-arch/`（agent-arch-optimize、effective-agent-loop、effective-agent-action-way、architecture-defenses）。
- 落地实现记录：`docs/tech/v1-architecture/agent-arch/agent-loop-implementation.md`、`agent-action-way-implementation.md`。
- 运行时与组件：`docs/tech/v1-architecture/runtime-architecture.md`、`component-map.md`、`agent-orchestration.md`。
- 事件驱动重构：`docs/tech/v2-architecture/`。
- 核心概念：`docs/tech/v1-architecture/core-concept/harness.md`。

## 校对说明

主报告经过「读代码 → 产出报告 → 用报告对照代码 review」的多轮循环校对，关键结论都标注了代码落点。如发现描述与代码不符，以代码为准，并回头修正本目录文档。
