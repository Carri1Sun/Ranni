# Update 008: Agent 手动终止

- Commit: `c01b7844ff8ba342043effa763206c6298b76fc8`
- Date: `2026-05-04T01:03:03+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版增加 agent 运行过程中的手动终止能力，并把 abort signal 贯穿前端、服务端、模型 provider 和工具执行。

## 读到的改动

- 前端新增 `ActiveAgentRequest`，运行中保存 `AbortController`、session id 和 run id。
- 输入区运行时显示终止按钮，点击后 abort 当前请求。
- `components/agent-console.tsx` 能把 running run/step 标记为 `cancelled`。
- `src/server/app.ts` 在 `/api/chat` 中监听客户端断开和 request abort，向 `runAgentTurn` 传入 signal。
- `lib/agent.ts` 在每个关键阶段检查 abort，并输出 cancelled run/step。
- `lib/llm/providers/openai-compatible.ts` 的 fetch 和 retry sleep 支持 abort。
- `lib/tools.ts` 的 `run_terminal`、`search_web`、`fetch_url` 等工具支持 abort；终端命令会尝试终止子进程。
- `lib/trace.ts` 增加 `cancelled` 状态类型。

## 设计理解

手动终止不能只在 UI 层“停止显示”。真正的终止需要让请求链路向下传播，模型请求、工具调用、终端子进程都要能收到中止信号。

## 影响范围

- 用户可以停止长任务、卡住的网页请求或不再需要的运行。
- Trace 可以记录 cancelled 状态，便于区分失败和主动终止。

## 后续注意

新增长耗时工具时，必须接入 `AbortSignal`，否则终止按钮会出现“前端停了但后端还在跑”的假象。

