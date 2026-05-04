# Update 013: Agent 架构文档重组

- Commit: `32b28c74a7c47dd9b06eac47664008275ce716be`
- Date: `2026-05-04T16:47:06+08:00`
- Type: `docs`
- Tests: not run, docs only

## 变更概述

这一版把 agent 架构相关文档从 `docs/core-concept/` 移到 `docs/agent-arch/`，并新增架构优化指导文档。

## 读到的改动

- 移动以下文档到 `docs/agent-arch/`：
  - `agent-action-way-implementation.md`
  - `agent-loop-implementation.md`
  - `effective-agent-action-way.md`
  - `effective-agent-loop.md`
- 新增 `docs/agent-arch/agent-arch-optimize.md`。
- `docs/core-concept/` 保留更基础的核心概念，例如 harness。

## 设计理解

文档分层更清楚：`core-concept` 放基础概念，`agent-arch` 放 agent 编排、行为、loop、实现和优化策略。

新增的 `agent-arch-optimize.md` 进一步明确：给 LLM 的约束不应是僵硬流程，而应是帮助模型保持目标、证据、状态、验证、工具使用和交付质量的认知脚手架。

## 影响范围

- 文档查找路径更符合主题。
- 后续 agent 架构改动应优先更新 `docs/agent-arch/`。

## 后续注意

引用旧路径的 README、说明文档或对话记录需要同步到新路径。

