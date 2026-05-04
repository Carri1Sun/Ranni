# Update 004: Harness 核心概念

- Commit: `ced9cb1276072bb467e0ed54ba76884cc500abd9`
- Date: `2026-05-03T18:34:15+08:00`
- Type: `docs`
- Tests: not run, docs only

## 变更概述

这一版新增 `docs/core-concept/harness.md`，用来解释 harness 对 Ranni 的意义。

## 读到的改动

- 新增文档定义 harness：它不是模型本身，而是模型之外的执行、上下文、工具、错误、追踪控制层。
- 把 harness 映射到 Ranni 当前架构：
  - `lib/agent.ts`
  - `lib/llm`
  - `lib/tools.ts`
  - `lib/trace.ts`
  - `src/server/app.ts`
  - `components/agent-console.tsx`
- 文档用 DeepSeek thinking mode 说明：provider 协议细节也是 harness 的责任。

## 设计理解

这个文档把“模型能力”和“agent 运行环境”分开。模型负责推理和生成，harness 负责把模型放进一个可运行、可观察、可恢复、可校验的系统里。

## 影响范围

- 后续讨论 agent 架构时有了统一术语。
- Trace、工具、上下文压缩、provider 协议都可以放到 harness 视角下理解。

## 后续注意

架构优化不应只改 prompt。很多成功率问题需要通过 harness 提供状态、工具协议、错误恢复和观测能力来解决。

