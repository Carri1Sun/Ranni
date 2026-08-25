#!/usr/bin/env node
/**
 * 翻译脚本：删除旧的 prompt-cn.md，调用 Qwen 将 prompt.md 翻译为中文并重新生成 prompt-cn.md。
 *
 * 用法：
 *   node scripts/translate-prompt.mjs [model]
 *   npm run translate
 *
 * 配置（来自 .env 或进程环境变量）：
 *   QWEN_TOKEN_PLAN_API_KEY  Token Plan API Key（必填）
 *   QWEN_BASE_URL            OpenAI 兼容端点（可选，默认 Token Plan 北京地域端点）
 *   QWEN_MODEL               默认模型（可选，命令行参数优先，最终默认 qwen3.6-flash）
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'prompt.md');
const TARGET = join(ROOT, 'prompt-cn.md');
const DEFAULT_BASE_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

const SYSTEM_PROMPT = `你是专业技术文档译者。将用户发送的英文 Markdown 文档完整翻译为简体中文，直接输出译文全文，不要附加任何解释、前言或总结。

翻译规则：
1. 逐段对应翻译，Markdown 结构与原文完全一致：标题层级、列表符号、编号、加粗、行内代码、代码块围栏、空行结构不得增删或改变。
2. 行内代码与代码块中的标识符、JSON key、枚举值（如 direct、plan、clarify、reason_codes、<research_context>）保持英文原样。
3. 代码块中的自然语言内容（如 Markdown 回复模板）照常翻译成中文。
4. 术语全篇统一：consequential 译为"影响重大的"，substantially / materially 译为"实质性"，meaningfully different 译为"有实质差异的"，assumption 译为"假设"，scope 译为"范围"。
5. 不使用"不是 a，而是 b"或"而非"一类对照句式，用语序通顺的直陈句表达。
6. 输出不要包裹在代码块围栏中，以译文第一行开始、最后一行结束。`;

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function extractTranslation(raw) {
  let text = typeof raw === 'string' ? raw : '';
  // 兼容思考型模型：剥离 <think> 推理块
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // 剥离模型可能自行包裹的代码围栏
  const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  return text;
}

async function main() {
  loadEnv();

  const apiKey = process.env.QWEN_TOKEN_PLAN_API_KEY;
  if (!apiKey) {
    console.error('缺少 QWEN_TOKEN_PLAN_API_KEY，请检查 .env');
    process.exit(1);
  }
  const baseUrl = (process.env.QWEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = process.argv[2] || process.env.QWEN_MODEL || 'qwen3.6-flash';

  const source = readFileSync(SOURCE, 'utf8');
  rmSync(TARGET, { force: true });
  console.log(`已删除旧的 prompt-cn.md`);
  console.log(`调用 ${model} 翻译 prompt.md（${source.length} 字符）...`);

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: source },
        ],
      }),
    });
  } catch (error) {
    console.error(`请求失败：${error.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`API 返回 ${response.status}：${await response.text()}`);
    process.exit(1);
  }

  const data = await response.json();
  const translation = extractTranslation(data.choices?.[0]?.message?.content);
  if (!translation) {
    console.error('模型未返回有效译文，原始响应：');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  writeFileSync(TARGET, `${translation}\n`);
  console.log(`翻译完成，已生成 prompt-cn.md（${translation.length} 字符）`);
}

main();
