# Update 022: Thinking Feed Display

## 背景

模型已经会把 provider 返回的 thinking 写入 run trace，但前端只在运行详情里用普通 `pre` 块展示；会话流中 thinking 与 status 混在一起，阅读和调试都不够清晰。

## 改动

- 新增 `thinking` 会话过程类型。
- SSE 收到 `thinking` event 时，会在会话流中追加独立的 thinking 卡片。
- Thinking 卡片默认折叠，展示短摘要，展开后可阅读完整内容。
- Thinking 卡片支持复制，并在 Debug 详情开启时可跳到关联 trace。
- Debug 设置新增“在会话流显示模型思考”开关。
- 运行详情中的 Thinking 区从普通 raw block 升级为专门阅读面板，包含 step、stop reason、tool call 数量和复制按钮。
- 为避免重复，收到 thinking event 后会移除同 step 下内容相同的 status activity。

## 影响

这次只改变展示层，不改变 agent loop、provider thinking replay 或工具行为。完整 thinking 仍保存在 trace 中；会话流只提供更适合阅读的入口。

## 验证

- `npm run typecheck`
