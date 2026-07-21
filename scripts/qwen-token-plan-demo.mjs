#!/usr/bin/env node
// 阿里云百炼 Token Plan（中国大陆）接入连通性 demo。
//
// 用法：
//   set -a; source .env.local; set +a
//   node scripts/qwen-token-plan-demo.mjs [model]
//
// 环境变量：
//   QWEN_TOKEN_PLAN_KEY       Token Plan 专属 API Key（必填）
//   QWEN_TOKEN_PLAN_BASE_URL  可选，默认北京地域 OpenAI 兼容入口

const model = process.argv[2] || "qwen3.7-max";
const apiKey = process.env.QWEN_TOKEN_PLAN_KEY;
const baseUrl =
  process.env.QWEN_TOKEN_PLAN_BASE_URL ||
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";

if (!apiKey) {
  console.error("缺少环境变量 QWEN_TOKEN_PLAN_KEY");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "用一句话回答：1+1等于几？" }],
    max_tokens: 64,
    stream: false,
  }),
});

const text = await res.text();
console.log(`base_url: ${baseUrl}`);
console.log(`model:    ${model}`);
console.log(`http:     ${res.status}`);

if (!res.ok) {
  console.log(`error:    ${text.slice(0, 2000)}`);
  process.exit(2);
}

const data = JSON.parse(text);
console.log(`served:   ${data.model}`);
console.log(`reply:    ${data.choices?.[0]?.message?.content}`);
console.log(`usage:    ${JSON.stringify(data.usage)}`);
