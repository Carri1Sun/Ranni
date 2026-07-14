import fs from "node:fs/promises";
import path from "node:path";

export const SESSION_HISTORY_SCHEMA = "ranni.session-history.v1" as const;
export const SESSION_HISTORY_RELATIVE_PATH = path.join(
  ".ranni",
  "session-history.json",
);

export type SessionHistoryMessage = {
  content: string;
  id: string;
  role: "assistant" | "user";
  updatedAt: number;
};

export type SessionHistoryRecord = {
  createdAt: number;
  messages: SessionHistoryMessage[];
  schema: typeof SESSION_HISTORY_SCHEMA;
  sessionId: string;
  title: string;
  updatedAt: number;
};

export type SessionHistorySummary = Omit<SessionHistoryRecord, "messages"> & {
  messageCount: number;
  workspaceRoot: string;
};

export type UpsertSessionHistoryInput = {
  createdAt: number;
  messages: SessionHistoryMessage[];
  sessionId: string;
  title: string;
  updatedAt: number;
  workspaceRoot: string;
};

const writeQueues = new Map<string, Promise<unknown>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeMessage(value: unknown): SessionHistoryMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.content !== "string" ||
    (value.role !== "assistant" && value.role !== "user")
  ) {
    return null;
  }

  return {
    content: value.content,
    id: value.id,
    role: value.role,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : 0,
  };
}

function sanitizeHistory(value: unknown): SessionHistoryRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.schema !== SESSION_HISTORY_SCHEMA ||
    typeof value.sessionId !== "string" ||
    !value.sessionId.trim() ||
    typeof value.title !== "string" ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.messages)
  ) {
    return null;
  }

  const messages = value.messages
    .map(sanitizeMessage)
    .filter((message): message is SessionHistoryMessage => message !== null);

  return {
    createdAt: value.createdAt,
    messages,
    schema: SESSION_HISTORY_SCHEMA,
    sessionId: value.sessionId,
    title: value.title,
    updatedAt: value.updatedAt,
  };
}

function getHistoryPath(workspaceRoot: string) {
  return path.join(workspaceRoot, SESSION_HISTORY_RELATIVE_PATH);
}

async function readHistoryFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const history = sanitizeHistory(JSON.parse(content));

    if (!history) {
      throw new Error(`Session 历史文件格式无效：${filePath}`);
    }

    return history;
  } catch (error) {
    if (
      isRecord(error) &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

async function writeHistoryFile(
  filePath: string,
  history: SessionHistoryRecord,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(history, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function enqueueHistoryWrite<T>(filePath: string, operation: () => Promise<T>) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);

  writeQueues.set(filePath, next);

  return next.finally(() => {
    if (writeQueues.get(filePath) === next) {
      writeQueues.delete(filePath);
    }
  });
}

export async function readSessionHistory(workspaceRoot: string) {
  const filePath = getHistoryPath(workspaceRoot);
  const pendingWrite = writeQueues.get(filePath);

  if (pendingWrite) {
    await pendingWrite.catch(() => undefined);
  }

  return readHistoryFile(filePath);
}

export async function upsertSessionHistory(
  input: UpsertSessionHistoryInput,
) {
  const filePath = getHistoryPath(input.workspaceRoot);

  return enqueueHistoryWrite(filePath, async () => {
    const current = await readHistoryFile(filePath);

    if (current && current.sessionId !== input.sessionId) {
      throw new Error("Session ID 与 workspace 中的历史文件不一致。");
    }

    const messages = current ? [...current.messages] : [];
    const messageIndices = new Map(
      messages.map((message, index) => [message.id, index]),
    );

    for (const incoming of input.messages) {
      const existingIndex = messageIndices.get(incoming.id);

      if (existingIndex === undefined) {
        messageIndices.set(incoming.id, messages.length);
        messages.push(incoming);
        continue;
      }

      const existing = messages[existingIndex];

      if (!existing || incoming.updatedAt < existing.updatedAt) {
        continue;
      }

      messages[existingIndex] = incoming;
    }

    const history: SessionHistoryRecord = {
      createdAt: current
        ? Math.min(current.createdAt, input.createdAt)
        : input.createdAt,
      messages,
      schema: SESSION_HISTORY_SCHEMA,
      sessionId: input.sessionId,
      title:
        !current || input.updatedAt >= current.updatedAt
          ? input.title.trim() || current?.title || "新研究会话"
          : current.title,
      updatedAt: Math.max(current?.updatedAt ?? 0, input.updatedAt),
    };

    await writeHistoryFile(filePath, history);

    return history;
  });
}

export async function listSessionHistories(workspaceBase: string) {
  let entries: Array<{ isDirectory: () => boolean; name: string }>;

  try {
    entries = await fs.readdir(workspaceBase, { withFileTypes: true });
  } catch (error) {
    if (
      isRecord(error) &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }

  const summaries = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.startsWith("ranni-session-"),
      )
      .map(async (entry) => {
        const workspaceRoot = path.join(workspaceBase, entry.name);

        try {
          const history = await readSessionHistory(workspaceRoot);

          if (!history) {
            return null;
          }

          return {
            createdAt: history.createdAt,
            messageCount: history.messages.length,
            schema: history.schema,
            sessionId: history.sessionId,
            title: history.title,
            updatedAt: history.updatedAt,
            workspaceRoot,
          } satisfies SessionHistorySummary;
        } catch (error) {
          console.warn(
            `无法读取 Session 历史：${workspaceRoot}`,
            error instanceof Error ? error.message : error,
          );
          return null;
        }
      }),
  );

  return summaries
    .filter((summary): summary is SessionHistorySummary => summary !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
