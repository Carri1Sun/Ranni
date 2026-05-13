import { readTextFile } from "./io";
import type { OpenEvalTraceEvent } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEvent(value: unknown, index: number): OpenEvalTraceEvent {
  if (!isRecord(value)) {
    return {
      content: String(value),
      type: "custom",
    };
  }

  return {
    content: typeof value.content === "string" ? value.content : undefined,
    input: value.input,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    output: value.output,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    type: typeof value.type === "string" ? value.type : `event_${index}`,
  };
}

export async function readTraceEvents(tracePath: string): Promise<OpenEvalTraceEvent[]> {
  const text = await readTextFile(tracePath);
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        return parsed.map(normalizeEvent);
      }

      if (isRecord(parsed) && Array.isArray(parsed.events)) {
        return parsed.events.map(normalizeEvent);
      }

      return [normalizeEvent(parsed, 0)];
    } catch {
      // A NDJSON trace also starts with "{". Fall through to line-by-line parsing.
    }
  }

  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => normalizeEvent(JSON.parse(line) as unknown, index));
}

export function compactTraceForJudge(events: OpenEvalTraceEvent[], limit = 80) {
  const selected =
    events.length <= limit
      ? events
      : [...events.slice(0, Math.floor(limit / 2)), ...events.slice(-Math.ceil(limit / 2))];

  return selected.map((event, index) => ({
    content: event.content?.slice(0, 700),
    input: event.input,
    name: event.name,
    output:
      typeof event.output === "string"
        ? event.output.slice(0, 700)
        : event.output,
    timestamp: event.timestamp,
    traceIndex: index,
    type: event.type,
  }));
}
