import dotenv from "dotenv";
import path from "node:path";
import { extractJsonObject } from "./json";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });
dotenv.config({ override: true, path: path.resolve(process.cwd(), ".env.local"), quiet: true });

type ChatMessage = {
  content: string;
  role: "system" | "user";
};

type ChatResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: unknown;
};

type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  enableThinking: boolean;
  maxTokens: number;
  model: string;
  provider: string;
  reasoningEffort: string;
  temperature: number;
  timeoutMs: number;
};

function readEnv(names: string[], fallback = "") {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  return fallback;
}

function readNumberEnv(names: string[], fallback: number) {
  const raw = readEnv(names);
  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBooleanEnv(names: string[], fallback: boolean) {
  const raw = readEnv(names);

  if (!raw) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function resolveLlmConfig(): LlmConfig {
  return {
    apiKey: readEnv(["OPEN_EVALS_LLM_API_KEY", "DEEPSEEK_API_KEY", "LLM_API_KEY"]),
    baseUrl: readEnv(["OPEN_EVALS_LLM_BASE_URL", "LLM_BASE_URL"], "https://api.deepseek.com").replace(
      /\/+$/,
      "",
    ),
    enableThinking: readBooleanEnv(["OPEN_EVALS_LLM_ENABLE_THINKING", "LLM_ENABLE_THINKING"], true),
    maxTokens: readNumberEnv(["OPEN_EVALS_LLM_MAX_TOKENS", "LLM_MAX_TOKENS"], 4096),
    model: readEnv(["OPEN_EVALS_LLM_MODEL", "LLM_MODEL"], "deepseek-v4-pro"),
    provider: readEnv(["OPEN_EVALS_LLM_PROVIDER", "LLM_PROVIDER"], "deepseek"),
    reasoningEffort: readEnv(["OPEN_EVALS_LLM_REASONING_EFFORT", "LLM_REASONING_EFFORT"], "high"),
    temperature: readNumberEnv(["OPEN_EVALS_LLM_TEMPERATURE", "LLM_TEMPERATURE"], 0.1),
    timeoutMs: readNumberEnv(["OPEN_EVALS_LLM_TIMEOUT_MS", "LLM_TIMEOUT_MS"], 120_000),
  };
}

export async function callJudgeLlm({
  messages,
  maxTokens,
  temperature,
}: {
  maxTokens?: number;
  messages: ChatMessage[];
  temperature?: number;
}) {
  const config = resolveLlmConfig();

  if (!config.apiKey) {
    throw new Error(
      "缺少 LLM API Key。请配置 OPEN_EVALS_LLM_API_KEY、DEEPSEEK_API_KEY 或 LLM_API_KEY。",
    );
  }

  const requestBody: Record<string, unknown> = {
    max_tokens: maxTokens ?? config.maxTokens,
    messages,
    model: config.model,
    temperature: temperature ?? config.temperature,
  };

  if (config.enableThinking && config.provider.toLowerCase().includes("deepseek")) {
    requestBody.reasoning_effort = config.reasoningEffort;
    requestBody.thinking = { type: "enabled" };
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      body: JSON.stringify(requestBody),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: abortController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`LLM judge 请求超时：${config.timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json()) as ChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `LLM judge 请求失败：HTTP ${response.status}`);
  }

  const choice = payload.choices?.[0];
  const content =
    choice?.message?.content?.trim() || choice?.message?.reasoning_content?.trim() || "";

  if (!content) {
    throw new Error(
      `LLM judge 返回为空。finish_reason=${choice?.finish_reason ?? "unknown"}，可尝试提高 OPEN_EVALS_LLM_MAX_TOKENS 或关闭 thinking。`,
    );
  }

  return {
    content,
    usage: payload.usage,
  };
}

export async function callJsonJudge<T>({
  maxTokens,
  system,
  temperature,
  user,
}: {
  maxTokens?: number;
  system: string;
  temperature?: number;
  user: string;
}): Promise<T> {
  const result = await callJudgeLlm({
    maxTokens,
    messages: [
      { content: system, role: "system" },
      { content: user, role: "user" },
    ],
    temperature,
  });

  return extractJsonObject(result.content) as T;
}
