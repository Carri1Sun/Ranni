import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SessionRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string | null;
  query: string | null;
  thinking: string | null;
  decision: string | null;
  meta: string | null;
  activities: string | null;
  error: number;
  created_at: string;
};

// 持久化消息：decision/meta/activities 以 JSON 文本列存储，读取时还原为对象。
export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  query?: string;
  thinking?: string;
  decision?: { type: string; message: string };
  meta?: Record<string, unknown>;
  activities?: unknown[];
  error?: boolean;
};

const dataDir = path.join(process.cwd(), "data");

function openDatabase(): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "plan-lab.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT,
      query TEXT,
      thinking TEXT,
      decision TEXT,
      meta TEXT,
      activities TEXT,
      error INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
  `);
  return db;
}

// dev 模式热重载会重新加载模块，用 globalThis 缓存避免重复打开连接。
const globalForDb = globalThis as unknown as { __planLabDb?: Database.Database };
export const db = globalForDb.__planLabDb ?? openDatabase();
if (process.env.NODE_ENV !== "production") globalForDb.__planLabDb = db;

export function listSessions(): SessionRow[] {
  return db
    .prepare("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
    .all() as SessionRow[];
}

export function getSession(id: string): SessionRow | undefined {
  return db
    .prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?")
    .get(id) as SessionRow | undefined;
}

export function createSession(title: string): SessionRow {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run(id, title, now, now);
  return { id, title, created_at: now, updated_at: now };
}

export function deleteSession(id: string): boolean {
  return db.prepare("DELETE FROM sessions WHERE id = ?").run(id).changes > 0;
}

function parseJsonColumn<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function listMessages(sessionId: string): StoredMessage[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC")
    .all(sessionId) as MessageRow[];
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content ?? undefined,
    query: row.query ?? undefined,
    thinking: row.thinking ?? undefined,
    decision: parseJsonColumn<StoredMessage["decision"]>(row.decision),
    meta: parseJsonColumn<StoredMessage["meta"]>(row.meta),
    activities: parseJsonColumn<unknown[]>(row.activities),
    error: row.error === 1,
  }));
}

export function appendMessages(sessionId: string, messages: StoredMessage[]): void {
  const maxRow = db
    .prepare("SELECT COALESCE(MAX(seq), 0) AS max FROM messages WHERE session_id = ?")
    .get(sessionId) as { max: number };
  let seq = maxRow.max;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO messages (id, session_id, seq, role, content, query, thinking, decision, meta, activities, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const touch = db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");
  db.transaction(() => {
    for (const message of messages) {
      seq += 1;
      insert.run(
        message.id,
        sessionId,
        seq,
        message.role,
        message.content ?? null,
        message.query ?? null,
        message.thinking ?? null,
        message.decision ? JSON.stringify(message.decision) : null,
        message.meta ? JSON.stringify(message.meta) : null,
        message.activities ? JSON.stringify(message.activities) : null,
        message.error ? 1 : 0,
        now,
      );
    }
    touch.run(now, sessionId);
  })();
}
