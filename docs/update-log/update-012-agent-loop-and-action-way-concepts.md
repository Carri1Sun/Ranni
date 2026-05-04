# Update 012: Agent Loop 与 Action Way 概念文档

- Commit: `9f14ba16a468a16c7def574bc04b4e1d4256b080`
- Date: `2026-05-04T14:16:54+08:00`
- Type: `docs`
- Tests: not run, docs only

## 变更概述

这一版新增 agent loop 和 stateful action way 的概念文档。

## 读到的改动

- 新增 `effective-agent-loop.md`。
- 新增 `effective-agent-action-way.md`。
- 文档讨论如何通过任务状态、递归规划、证据记录、验证、记忆文件提升 one-shot 成功率。
- 文档强调工具调用、文件记录、外部证据和上下文管理是 agent 能力的一部分。

## 设计理解

这两篇文档属于设计思想层，不是实现说明。它们回答的问题是：agent 为什么需要 loop、为什么需要 action way、为什么不能把所有能力都压进 prompt。

## 影响范围

- 后续架构优化有了理论来源。
- 实现文档和概念文档开始分离。

## 后续注意

概念文档应保持“原则”和“方向”，具体落地细节应放在 implementation 文档里，避免混淆。

