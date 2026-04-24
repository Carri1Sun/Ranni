先说结论：成熟 agent 的 `conversation` 几乎都不是一个简单的 `messages[]`。真正决定上限的，是“上下文编排器”怎么把稳定指令、会话历史、工具观察、外部记忆、压缩摘要、子 agent 总结，分层拼进模型输入里。

有两个边界先说明：
1. `Claude Code` 我只用了 Anthropic 公开文档，不会基于泄露代码下结论。
2. `Manus` 官方公开的是产品架构和能力，不公开底层 prompt / message schema，所以它那部分我会明确区分“可验证事实”和“推断”。

**各家怎么组织 conversation**
1. `OpenClaw` 把 `context` 明确定义成“一次 run 发给模型的全部内容”，包括 system prompt、会话历史、tool call/result、附件、compaction 摘要等。它不是把 conversation 当一个普通数组，而是交给一个可插拔的 `Context Engine` 管：`ingest -> assemble -> compact -> after turn`。也就是说，消息是否进上下文、以什么顺序进、何时摘要，都有独立生命周期。它还专门区分了“session transcript 持久化”和“本轮 prompt 裁剪”：pruning 可以把旧 tool result 从本轮 prompt 里移走，但不改磁盘 transcript；compaction 会把旧历史压成摘要，并且保证 assistant 的 tool call 和对应的 tool result 不被拆散。这个设计很强，因为它把“conversation 拼装”提升成了一等架构对象。

2. `Hermes` 的核心不是“历史消息数组”，而是“分槽 system prompt + 会话 transcript + 延迟注入”。`SOUL.md` 是 system prompt 的 slot #1，项目上下文文件按优先级只选一种主类型进入启动 prompt；`AGENTS.md` 支持层级组合。更关键的是它很在意 prompt cache 稳定性，所以持久记忆 `MEMORY.md/USER.md` 只在 session 启动时注入一次，形成 frozen snapshot；你本轮里新写入 memory，不会立刻改 system prompt，而是等下个 session。子目录规则也不是启动时全塞进去，而是在工具调用触达某个路径后，作为 hint 附着到 tool result 里自然进入上下文。Hermes 甚至把“预算压力警告”也塞进最后一个 tool result 的 JSON，而不是新增消息，就是为了少破坏上下文结构。它的 conversation 组织理念很清楚：稳定前缀尽量不动，动态信息尽量挂在 observation 上。

3. `Claude Code` 从公开文档看，最像“产品化上下文管理器”。它把每个 session 存成本地 JSONL，里面有 message、tool use、tool result；`resume` 是恢复同一个 session，`fork-session` 是复制历史后开新 session。每个新 session 都是 fresh context，跨 session 的持久知识不靠聊天历史，而靠 `CLAUDE.md` 和 auto memory。`CLAUDE.md` 会从当前目录一路向上加载，子目录里的 `CLAUDE.md` 则是 lazy load，只有你读到对应子树文件时才进上下文。上下文快满时，它先清旧 tool output，再做 conversation summary；而 path-scoped rules、nested `CLAUDE.md` 这类懒加载内容在 compaction 后会丢，直到再次读到对应文件才回到上下文。它还把 MCP 工具定义默认延迟到 tool search 阶段，避免一开始把大堆 schema 塞满窗口。这个体系的重点不是“历史尽量全带”，而是“哪些信息该长期常驻，哪些该按需重载”。

4. `Codex` 是我看到公开资料里最“协议化”的实现。它不是传统 chat message 列表，而是 Responses API 的 `input items`：developer 消息、用户消息、`reasoning`、`function_call`、`function_call_output`、assistant 消息，全部是 typed items。初始化时，它会先把 sandbox 权限说明、用户 `config.toml` 里的 developer instructions、聚合后的 `AGENTS.md`/skills 信息、`environment_context` 等拼进 `input`，最后再追加用户消息。进入工具循环后，不是覆盖旧输入，而是在原有 `input` 后面继续 append `reasoning -> function_call -> function_call_output`，让“旧 prompt 成为新 prompt 的精确前缀”，以便最大化 prompt caching。就连 cwd 或权限模式变化，也尽量通过“追加一条新的 developer/user 消息”来表达，而不是回写旧前缀。上下文太长时，它用 `/responses/compact` 返回新的 item 列表，其中有专门的 `compaction` item 和 `encrypted_content`。Codex 的本质是：conversation 不是字符串，而是一个严格类型化、前缀稳定、可压缩的事件流。

5. `Manus` 公开资料里，最清晰的不是 prompt 拼装，而是“任务上下文的承载体”。官方明确说每个 task 有自己的 Sandbox VM，里面有网络、文件系统、浏览器、软件工具、持久文件；sleep/wake 期间文件不变，recycle 后会恢复重要 artifacts / attachments / project files。`Wide Research` 则是主 agent 把任务拆成大量独立子任务，每个子 agent 拿自己的 fresh context 独立执行，最后由主 agent 汇总。也就是说，Manus 公开强调的是“上下文分片”和“工作区持久化”，而不是 chat transcript 细节。基于公开材料，我只能谨慎推断：Manus 很可能把大量长期状态外部化到 sandbox/task files 里，而不是只靠长 conversation 顶着跑；但它的具体 message schema、compaction 规则、tool result 结构，官方没有公开。

**抽象下来，成熟 agent 的共同规律**
1. `conversation` 不是单层列表，而至少分成 6 层：稳定系统前缀、会话历史、tool observation、按需注入的上下文、压缩产物、子 agent 摘要。
2. 真正值钱的是“稳定前缀”。Codex 追求 exact prefix；Hermes 把 memory 冻结到 session start；Claude Code 把 CLAUDE.md 和 auto memory 放启动阶段；OpenClaw 甚至把 context assembly 独立成 engine。
3. 大而易变的信息不能默认常驻。技能正文、嵌套规则、MCP schema、子目录上下文、巨型 tool result，都要按需加载或延迟注入。
4. `tool_result` 不应该无脑原样回灌。成熟方案会做配对、裁剪、去重、清理、摘要，甚至干脆隔离到子 agent，只把 summary 回主线程。
5. `memory` 应和 `conversation` 分开。Claude Code 的 auto memory、Hermes 的 MEMORY/USER、OpenClaw 的 memory/session separation，本质都是把“长期知识”从“本轮推理轨迹”里剥离。
6. `subagent` 的最大价值不是并行，而是 context sharding。Manus Wide Research、Claude Code subagents、Hermes delegation、OpenClaw subagent prompt mode，都是在把高噪声工作移出主上下文。
7. `compaction` 不是“粗暴摘要”，而是 conversation 协议的一部分。Codex 有专门 compaction item，OpenClaw 保 tool call/result 配对，Claude Code 区分哪些机制 compaction 后会自动重载，Hermes 甚至把压缩后的 continuation session 当新 lineage。

**如果落到你这个 agent，我会这样设计**
1. 不要把 conversation 存成单一 `messages[]`，而要拆成：
`stable_prefix`
`session_transcript`
`dynamic_injections`
`tool_observations`
`memory_snapshot`
`compaction_artifacts`
`child_agent_summaries`

2. 每次推理时不要“全量重拼一坨字符串”，而是做一个 `assembleContext()`：
先放稳定前缀
再放 session transcript
再按 budget 注入最近 observation
再按需注入路径规则 / skill / memory
最后决定是否 compact

3. `tool_result` 至少分三类：
`stateful result`：必须进主上下文
`ephemeral result`：只展示给用户或只保存在 transcript
`bulk result`：落文件 / 落 artifact / 交给子 agent，总结后回主上下文

4. 尽早做“稳定前缀 + lazy load + child summary”三件事，这比单纯优化 prompt 文案更决定上限。

一句话总结：
`Manus` 强在把上下文分片到大量独立 agent 和 sandbox；
`OpenClaw` 强在把 context assembly 做成可插拔引擎；
`Hermes` 强在围绕 prompt cache 组织 conversation；
`Claude Code` 强在懒加载和产品级上下文卫生；
`Codex` 强在 typed-item 协议和前缀稳定。

来源：
- OpenClaw Context: [docs.openclaw.ai/concepts/context](https://docs.openclaw.ai/concepts/context)
- OpenClaw Agent Loop: [docs.openclaw.ai/concepts/agent-loop](https://docs.openclaw.ai/concepts/agent-loop)
- OpenClaw Context Engine: [docs.openclaw.ai/concepts/context-engine](https://docs.openclaw.ai/concepts/context-engine)
- OpenClaw Compaction: [docs.openclaw.ai/concepts/compaction](https://docs.openclaw.ai/concepts/compaction)
- OpenClaw Session Management: [docs.openclaw.ai/concepts/session](https://docs.openclaw.ai/concepts/session)
- OpenClaw System Prompt: [docs.openclaw.ai/concepts/system-prompt](https://docs.openclaw.ai/concepts/system-prompt)
- Hermes Context Files: [hermes-agent.nousresearch.com/docs/user-guide/features/context-files/](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files/)
- Hermes Memory: [hermes-agent.nousresearch.com/docs/user-guide/features/memory/](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)
- Hermes Sessions: [hermes-agent.nousresearch.com/docs/user-guide/sessions/](https://hermes-agent.nousresearch.com/docs/user-guide/sessions/)
- Hermes Configuration: [hermes-agent.nousresearch.com/docs/user-guide/configuration/](https://hermes-agent.nousresearch.com/docs/user-guide/configuration/)
- Hermes Tools Reference: [hermes-agent.nousresearch.com/docs/reference/tools-reference/](https://hermes-agent.nousresearch.com/docs/reference/tools-reference/)
- Claude Code Memory: [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- Claude Code How It Works: [code.claude.com/docs/en/how-claude-code-works](https://code.claude.com/docs/en/how-claude-code-works)
- Claude Code Context Window: [code.claude.com/docs/en/context-window](https://code.claude.com/docs/en/context-window)
- Claude Code Subagents: [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents)
- Claude Code Tutorials: [code.claude.com/docs/en/tutorials](https://code.claude.com/docs/en/tutorials)
- Codex Agent Loop: [openai.com/index/unrolling-the-codex-agent-loop/](https://openai.com/index/unrolling-the-codex-agent-loop/)
- Manus Welcome: [manus.im/docs/introduction/welcome](https://manus.im/docs/introduction/welcome)
- Manus Wide Research: [manus.im/docs/features/wide-research](https://manus.im/docs/features/wide-research)
- Manus Sandbox: [manus.im/blog/manus-sandbox](https://manus.im/blog/manus-sandbox)

如果你要，我下一步可以直接把这份调研收敛成一个“你这个 Node agent 应该怎么设计 `conversation schema`”的具体数据结构和组装流程图。
