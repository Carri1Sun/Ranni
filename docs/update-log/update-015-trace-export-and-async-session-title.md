# Update 015: Trace 导出与异步 Session 命名

- Commit: `2d25a026625280e2ff4366f3c0785327b765293d`
- Date: `2026-05-04T16:47:25+08:00`
- Type: `feat`
- Tests: `npm run typecheck`; `npm run lint`; `npm run build`

## 变更概述

这一版为模型回复增加 trace 导出按钮，并把首条消息命名 session 的逻辑改成异步后台执行。

## 读到的改动

- `ChatMessage` 增加 `traceRunId`。
- assistant SSE event 关联 run id，前端把回复消息和对应 trace run 绑定。
- 消息操作区新增 `导出 trace`。
- Trace 导出通过浏览器下载 `trace.txt`，文件名使用当前时间戳，例如 `2026-05-04T08-15-58-018Z-trace.txt`。
- 导出内容包含 session 元信息、assistant 消息正文和完整 run JSON。
- 服务端新增 `/api/session/title`。
- 首条用户消息发送后，前端保持默认名 `新研究会话`，并在后台调用模型生成十五字以内中文标题。
- 命名请求失败不阻塞主 `/api/chat` 流程。
- 如果用户已经手动改名或 session 不再是默认名，异步命名结果不会覆盖。

## 设计理解

Trace 导出让失败分析从“描述症状”变成“提供完整运行证据”。异步 session 命名则把辅助体验从主路径中移除，避免命名模型请求拖慢真正的 agent 执行。

## 影响范围

- 用户可以把完整 trace 发给开发者分析。
- 新 session 的首轮对话响应速度不再受命名请求影响。
- Session 列表仍能在稍后获得可读标题。

## 后续注意

Trace 文件可能包含用户输入、文件路径、工具输出和模型上下文。分享前应提醒用户注意隐私和敏感信息。

