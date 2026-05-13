export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("模型返回为空，无法解析 JSON。");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstObject = candidate.indexOf("{");
    const lastObject = candidate.lastIndexOf("}");

    if (firstObject >= 0 && lastObject > firstObject) {
      return JSON.parse(candidate.slice(firstObject, lastObject + 1));
    }

    const firstArray = candidate.indexOf("[");
    const lastArray = candidate.lastIndexOf("]");

    if (firstArray >= 0 && lastArray > firstArray) {
      return JSON.parse(candidate.slice(firstArray, lastArray + 1));
    }
  }

  throw new Error(`无法从模型输出中解析 JSON：${trimmed.slice(0, 500)}`);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
