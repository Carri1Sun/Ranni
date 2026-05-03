# Harness

## 一句话定义

Harness 是包在模型或被测系统外面的运行与控制层。它不是模型本身，而是负责把模型、上下文、工具、环境和结果处理组织成一个可持续工作的系统。

在 AI agent 场景里，可以近似理解为：

```text
Agent = Model + Harness
```

模型负责语言理解、推理和生成；harness 负责让模型能稳定地感知环境、调用工具、维护上下文、处理错误并完成多步任务。

## 传统软件里的 harness

在传统软件工程中，最常见的是 test harness。

Test harness 通常包含：

- 测试数据
- 测试执行器
- driver 和 stub
- 测试脚本
- 结果收集和报告

它的作用是把被测代码放进一个可控环境中运行，让开发者可以重复执行、观察结果、定位问题。

## AI agent 里的 harness

在 AI agent 中，harness 是 LLM 外围的工程系统。它通常负责：

- 组装 system prompt 和用户消息
- 管理多轮上下文和历史压缩
- 选择模型 provider
- 调用工具并把结果回填给模型
- 管理文件、终端、浏览器、搜索等执行环境
- 处理权限、安全边界和错误重试
- 记录 trace、token、耗时、工具调用和模型响应
- 保存记忆、会话和运行状态
- 把模型输出转换成 UI 或 API 可消费的结果

因此，agent 失败不一定是模型能力问题，也可能是 harness 问题。例如上下文拼错、工具 schema 不兼容、API 特殊字段没有回传、错误重试策略不合理，都会让同一个模型表现差很多。

## 在当前项目里的对应关系

在 Ranni / numas-agent 中，harness 主要对应以下部分：

- `lib/agent.ts`：agent 主循环，负责多步执行、工具调用、上下文快照和 trace 事件。
- `lib/llm/`：模型 provider 层，负责 DeepSeek、Qwen、自定义 OpenAI-compatible API 的请求和响应适配。
- `lib/tools.ts`：工具定义和执行入口。
- `lib/trace.ts`：运行状态、模型请求、工具调用、thinking、响应等结构化记录。
- `src/server/app.ts`：把前端会话请求接入 agent 运行流程。
- `components/agent-console.tsx`：展示会话、运行状态、trace 和设置。

这个项目里的 harness 不是单个文件，而是一组协作机制：前端提交用户消息，服务端启动 agent loop，provider 请求模型，模型返回 tool call，harness 执行工具，再把 tool result 回传给模型，直到得到最终回答。

## 一个具体例子：DeepSeek thinking mode

DeepSeek 在 thinking mode 下会返回 `reasoning_content`。如果模型在 thinking mode 中发起 tool call，后续请求必须把上一轮 assistant 的 `reasoning_content` 连同 `tool_calls` 一起传回 API。

如果 harness 只保存可见的 `content` 和 `tool_calls`，却丢掉 `reasoning_content`，DeepSeek 会返回类似错误：

```text
The reasoning_content in the thinking mode must be passed back to the API.
```

这不是模型不会回答，而是 harness 没有遵守该 provider 的上下文协议。修复点也不在 prompt，而在 provider 适配层：需要把内部 thinking block 重新序列化为 DeepSeek 需要的 `reasoning_content`。

## 和相近概念的区别

- Model：模型权重和推理服务，负责生成输出。
- Tool：模型可以调用的外部能力，例如读文件、运行命令、搜索网页。
- Skill：面向某类任务的可复用指令、流程或领域知识。
- Runtime：代码实际运行的环境，例如 Node 进程、浏览器、沙箱、服务器。
- Harness：把模型、工具、上下文、runtime、状态和错误处理串起来的控制层。
- Eval harness：专门用于评测和回归测试 agent 或模型表现的 harness。

## 设计原则

一个好的 agent harness 应该：

- 明确模型和工具的边界
- 让上下文构造可解释、可追踪
- 保留 provider 必需的协议字段
- 对错误和重试有明确策略
- 能记录足够的信息来复盘失败
- 尽量把业务能力沉淀到工具和 skill 中，而不是塞进单次 prompt
- 让同一个任务在不同运行中尽量可复现

