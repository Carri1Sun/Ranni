# Plan Prompt Lab

一个用于调试 `prompt.md` 规划策略的本地交互页面。页面把任务提交给服务端，由服务端读取最新的 `prompt.md`，并通过阿里云百炼 Token Plan 调用 `qwen3.8-max`。

## 配置

1. 订阅阿里云百炼 Token Plan，并在“我的订阅”中生成 `sk-sp-` 开头的专属 API Key。
2. 复制 `.env.example` 为 `.env.local`。
3. 填写 `QWEN_TOKEN_PLAN_API_KEY` 和 `TAVILY_API_KEY`。

```bash
cp .env.example .env.local
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 调用方式

服务端请求 OpenAI 兼容接口：

```text
POST https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions
Authorization: Bearer sk-sp-...
```

每次请求都会从项目根目录重新读取 `prompt.md`。修改提示词后刷新并再次提交即可，无需重启开发服务器。

请求采用流式研究流程：Qwen 先判断任务是否需要外部信息并设计搜索词，服务端通过 Tavily Search 获取来源，随后将检索上下文交给 `prompt.md` 生成最终规划决策。聊天页面会实时展示可审阅的研究进度、搜索词和来源，并在思考面板中流式展示模型的思考过程；最终决策解析为结构化结果，以类型标签（`direct` / `plan` / `clarify`）加 Markdown 卡片呈现，并可导出为 JSON。

## 会话持久化

对话按会话（session）组织，每轮流式结束后（query、思考过程、决策结果、研究活动）自动写入本地 SQLite 数据库 `data/plan-lab.db`（已 gitignore）。左侧会话列表支持新建、切换与删除，刷新页面后自动恢复最近一次会话。

> Token Plan 的官方使用范围是 AI 工具交互式调用。本项目按本地 Prompt 调试工具设计；线上后端服务应改用百炼按量付费 API Key 与对应 Base URL。

## Prompt 翻译
npm run translate
删除现有的 prompt-cn.md，然后调用 
  .env 中的 key 很 qwen3.6-flash 模型将 prompt.md   
  翻译成 prompt-cn.md 创建新的
