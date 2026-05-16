import path from "node:path";

import type { ToolSettings } from "../tools";
import {
  captureMacScreenshot,
  executeMacAction,
  type ComputerAction,
  type ComputerScreenshot,
} from "./macos-adapter";

export type ComputerUseRunOptions = {
  apiKey: string;
  baseUrl: string;
  maxSteps: number;
  model: string;
  signal?: AbortSignal;
  task: string;
  workspaceRoot?: string;
  workingDirectory: string;
};

export type ComputerUseRunResult = {
  finalText: string;
  model: string;
  requestId: string | null;
  screenshots: string[];
  steps: string[];
  stoppedReason: string;
};

type ResponseOutputItem = {
  action?: ComputerAction;
  actions?: ComputerAction[];
  call_id?: string;
  content?: Array<{
    text?: string;
    type?: string;
  }>;
  id?: string;
  pending_safety_checks?: Array<{
    code?: string;
    message?: string;
  }>;
  status?: string;
  type?: string;
};

type OpenAIResponsePayload = {
  error?: {
    code?: string | null;
    message?: string;
    type?: string;
  };
  id?: string;
  model?: string;
  output?: ResponseOutputItem[];
};

export function getComputerUseApiKey(toolSettings?: ToolSettings) {
  const apiKey =
    toolSettings?.computerUseApiKey?.trim() ||
    process.env.OPENAI_COMPUTER_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "未配置 Computer use OpenAI API Key。请在设置页填写 Computer use API Key，或在 .env.local 中设置 OPENAI_COMPUTER_API_KEY / OPENAI_API_KEY。",
    );
  }

  return apiKey;
}

export function getComputerUseBaseUrl() {
  return (
    process.env.OPENAI_COMPUTER_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "") ||
    "https://api.openai.com/v1"
  );
}

export function getComputerUseModel(toolSettings?: ToolSettings) {
  return (
    toolSettings?.computerUseModel?.trim() ||
    process.env.OPENAI_COMPUTER_MODEL?.trim() ||
    "gpt-5.5"
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error);
}

function getComputerCall(payload: OpenAIResponsePayload) {
  return payload.output?.find((item) => item.type === "computer_call") ?? null;
}

function getComputerActions(call: ResponseOutputItem) {
  if (Array.isArray(call.actions) && call.actions.length > 0) {
    return call.actions;
  }

  return call.action ? [call.action] : [];
}

function extractFinalText(payload: OpenAIResponsePayload) {
  const parts: string[] = [];

  for (const item of payload.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) {
        parts.push(content.text.trim());
      }
    }
  }

  return parts.join("\n\n").trim();
}

function formatOpenAIError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as OpenAIResponsePayload;
    const message = parsed.error?.message?.trim();

    if (message) {
      return `OpenAI computer-use 请求失败：HTTP ${status} | ${message}`;
    }
  } catch {
    // Use the raw body below.
  }

  return `OpenAI computer-use 请求失败：HTTP ${status}${body ? ` | ${body.slice(0, 800)}` : ""}`;
}

async function createComputerResponse({
  apiKey,
  baseUrl,
  body,
  signal,
}: {
  apiKey: string;
  baseUrl: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(formatOpenAIError(response.status, text));
  }

  return JSON.parse(text) as OpenAIResponsePayload;
}

function buildTaskPrompt(task: string) {
  return [
    "You are operating a local macOS desktop through a constrained computer-use adapter.",
    "Complete only the user's requested desktop task.",
    "Request or use a screenshot before any click, typing, scrolling, or drag operation.",
    "Do not perform purchases, payments, account deletion, credential changes, or irreversible actions.",
    "If a task requires login, payment, privacy-sensitive information, or destructive confirmation, stop and explain what user confirmation is needed.",
    "",
    "Task:",
    task,
  ].join("\n");
}

function relativePath(filePath: string, workspaceRoot?: string) {
  if (!workspaceRoot) {
    return filePath;
  }

  return path.relative(workspaceRoot, filePath) || ".";
}

function getSafetyMessage(call: ResponseOutputItem) {
  const checks = call.pending_safety_checks ?? [];

  if (checks.length === 0) {
    return "";
  }

  return checks
    .map((check) =>
      [check.code ? `[${check.code}]` : "", check.message ?? ""]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");
}

function describeAction(action: ComputerAction) {
  const type = String(action.type ?? action.action ?? "unknown");
  const x = typeof action.x === "number" ? Math.round(action.x) : null;
  const y = typeof action.y === "number" ? Math.round(action.y) : null;
  const suffix = x !== null && y !== null ? ` at (${x}, ${y})` : "";
  return `${type}${suffix}`;
}

export async function runOpenAIComputerUse({
  apiKey,
  baseUrl,
  maxSteps,
  model,
  signal,
  task,
  workspaceRoot,
  workingDirectory,
}: ComputerUseRunOptions): Promise<ComputerUseRunResult> {
  const steps: string[] = [];
  const screenshots: string[] = [];
  let latestScreenshot: ComputerScreenshot = await captureMacScreenshot({
    directory: workingDirectory,
    index: 0,
    signal,
  });
  screenshots.push(relativePath(latestScreenshot.path, workspaceRoot));

  let payload = await createComputerResponse({
    apiKey,
    baseUrl,
    body: {
      input: buildTaskPrompt(task),
      model,
      tools: [
        {
          type: "computer",
        },
      ],
      truncation: "auto",
    },
    signal,
  });
  let requestId = payload.id ?? null;
  let responseModel = payload.model ?? model;

  for (let index = 1; index <= maxSteps; index += 1) {
    const call = getComputerCall(payload);

    if (!call) {
      return {
        finalText: extractFinalText(payload),
        model: responseModel,
        requestId,
        screenshots,
        steps,
        stoppedReason: "completed",
      };
    }

    const safetyMessage = getSafetyMessage(call);

    if (safetyMessage) {
      return {
        finalText: safetyMessage,
        model: responseModel,
        requestId,
        screenshots,
        steps,
        stoppedReason: "pending_safety_check",
      };
    }

    const actions = getComputerActions(call);

    if (!call.call_id || actions.length === 0) {
      throw new Error("OpenAI computer-use 返回了不完整的 computer_call。");
    }

    for (const [actionIndex, action] of actions.entries()) {
      const actionResult = await executeMacAction({
        action,
        screenshot: latestScreenshot,
        signal,
      });
      const label =
        actions.length > 1 ? `${index}.${actionIndex + 1}` : String(index);
      steps.push(`${label}. ${describeAction(action)} -> ${actionResult.description}`);
    }

    latestScreenshot = await captureMacScreenshot({
      directory: workingDirectory,
      index,
      signal,
    });
    screenshots.push(relativePath(latestScreenshot.path, workspaceRoot));

    payload = await createComputerResponse({
      apiKey,
      baseUrl,
      body: {
        input: [
          {
            type: "computer_call_output",
            call_id: call.call_id,
            output: {
              type: "computer_screenshot",
              image_url: latestScreenshot.dataUrl,
            },
          },
        ],
        model,
        previous_response_id: payload.id,
        tools: [
          {
            type: "computer",
          },
        ],
        truncation: "auto",
      },
      signal,
    });
    requestId = payload.id ?? requestId;
    responseModel = payload.model ?? responseModel;
  }

  return {
    finalText: "已达到 operate_computer 的最大步数限制。",
    model: responseModel,
    requestId,
    screenshots,
    steps,
    stoppedReason: "max_steps",
  };
}

export async function testComputerUseAvailability(toolSettings: ToolSettings = {}) {
  const apiKey = getComputerUseApiKey(toolSettings);
  const baseUrl = getComputerUseBaseUrl();
  const model = getComputerUseModel(toolSettings);
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: "Validate computer-use tool availability only. Do not request actions.",
      max_output_tokens: 16,
      model,
      tools: [
        {
          type: "computer",
        },
      ],
      truncation: "auto",
    }),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(formatOpenAIError(response.status, text));
  }

  const payload = JSON.parse(text) as OpenAIResponsePayload;

  return {
    model: payload.model?.trim() || model,
    requestId: payload.id?.trim() || null,
  };
}

export function formatComputerUseFailure(error: unknown) {
  return getErrorMessage(error);
}
